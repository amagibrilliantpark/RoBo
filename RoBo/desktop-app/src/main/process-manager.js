/** Process lifecycle for the two bundled children: OpenCode (the AI
 *  engine) and SyncRo (the Studio bridge).
 *
 *  This module owns the SPAWN side. The supporting machinery now lives in
 *  sibling modules (all re-exported here so callers keep a single import):
 *    - proc-utils.js       execAsync / sleep / isPidAlive
 *    - opencode-binary.js  version pin, resolution & download
 *    - process-kill.js     port sweeps, tree kills, image-name sweep */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const log = require('./logger');
const { execAsync, sleep, isPidAlive } = require('./proc-utils');
const { OPENCODE_VERSION, findOpencodeExecutable, checkOpencodeVersion, downloadOpencodeBinary } = require('./opencode-binary');
const { killProcessesOnPorts, gracefulKill, killProcessTree, killByImageName } = require('./process-kill');

/** Spawn the OpenCode serve process and resolve when it's ready.
 *
 *  OpenCode resolution policy (intentionally CLI-free):
 *  1. <projectPath>/opencode.exe                 — dev / user-data copy
 *  2. <resourcesPath>/opencode.exe               — packaged with the app
 *     (NSIS installer, portable zip → resources/opencode.exe)
 *  3. <parent(projectPath)>/opencode.exe         — portable exe next to
 *     the project folder
 *  4. Not found / below v1.17.18                  — auto-download v1.17.18
 *     into <projectPath>/opencode.exe
 *
 *  PATH is NOT consulted on purpose: mixing the system-wide `opencode`
 *  CLI with the bundled binary was causing session/status drift between
 *  CLI and RoBo runs. By always running the bundled executable we get
 *  one OpenCode build, one set of events, and one place to update. */
async function startOpencode(instance) {
  const { project, ports } = instance;
  const spawnStart = Date.now();

  const isDev = process.argv.includes('--dev');

  // 1) Pick a candidate. We never look at PATH — see policy above.
  const found = findOpencodeExecutable(project.path);

  // Dev-mode audit log: makes it impossible to mistake what's running.
  // In production this is a single line; in dev we spell out the policy
  // and the source so the developer can confirm "no PATH CLI fallback".
  if (isDev) {
    log.info('OPENCODE', '============================================================');
    log.info('OPENCODE', '  OpenCode resolution (CLI-free policy)');
    log.info('OPENCODE', '  - System PATH `opencode` CLI: explicitly NOT consulted');
    log.info('OPENCODE', '  - Search order: project → resourcesPath → parent dir');
    log.info('OPENCODE', `  - Project path: ${project.path}`);
    if (process.resourcesPath) {
      log.info('OPENCODE', `  - Resources path: ${process.resourcesPath}`);
    }
    if (found) {
      log.info('OPENCODE', `  - Result: using bundled opencode.exe`);
      log.info('OPENCODE', `  - Source: ${found.source}`);
      log.info('OPENCODE', `  - Path:   ${found.path}`);
    } else {
      log.info('OPENCODE', `  - Result: no bundled copy found`);
      log.info('OPENCODE', `  - Action: will download v${OPENCODE_VERSION} → ${path.join(project.path, 'opencode.exe')}`);
    }
    log.info('OPENCODE', '============================================================');
  } else {
    log.info('OPENCODE',
      found
        ? `Using bundled opencode.exe (source: ${found.source}) at ${found.path} — NOT the PATH CLI`
        : `No bundled opencode.exe found, will download v${OPENCODE_VERSION} into project — NOT the PATH CLI`);
  }

  let opencodePath = found ? found.path : null;

  // 2) Validate the candidate: must exist and be at or above REQUIRED_VERSION.
  let needDownload = false;
  if (!opencodePath) {
    needDownload = true;
    if (!isDev) {
      log.warn('OPENCODE', `OpenCode.exe not found next to the project or in app resources, downloading v${OPENCODE_VERSION}…`);
    }
  } else {
    const versionValid = await checkOpencodeVersion(opencodePath);
    if (!versionValid) {
      if (isDev) {
        log.warn('OPENCODE', `Bundled opencode.exe is not v${OPENCODE_VERSION}, will re-download`);
      } else {
        log.warn('OPENCODE', `OpenCode at ${opencodePath} is not v${OPENCODE_VERSION}, downloading v${OPENCODE_VERSION}…`);
      }
      needDownload = true;
    }
  }

  // 3) If we don't have a good local copy, fetch one. We do not fall back
  //    to PATH under any circumstance — the only "no binary" failure mode
  //    is a network error, which the caller will surface to the user.
  if (needDownload) {
    try {
      opencodePath = await downloadOpencodeBinary(project.path);
      if (isDev) {
        log.info('OPENCODE', `Download complete, source now: project (just-downloaded)`);
      }
    } catch (error) {
      log.error('OPENCODE', `Failed to download OpenCode v${OPENCODE_VERSION}: ${error.message}`);
      throw new Error(`OpenCode v${OPENCODE_VERSION} could not be installed automatically. ` +
        `Please place opencode.exe next to your project folder or in the app's resources directory, then restart.`);
    }
  }

  log.info('OPENCODE', `Spawning OpenCode: ${opencodePath} serve --port ${ports.opencode} (cwd: ${project.path})`);

  return new Promise((resolve, reject) => {
    const args = ['serve', '--port', ports.opencode.toString(), '--hostname', '127.0.0.1'];
    // Keep `shell: true` on Windows so opencode.exe inherits the exact same
    // environment & stdout path that the previous build relied on. We still
    // solve the orphan-Bun problem at shutdown via:
    //   - `killProcessTree` (taskkill /F /T) from instance-manager
    //   - `killByImageName` safety net (matches opencode.exe / bun.exe)
    //   - port-based sweep in `killAll`
    // So we don't need to swap the spawn mode here.
    const child = spawn(opencodePath, args, {
      cwd: project.path,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        OPENCODE_CONFIG: path.join(project.path, 'opencode.json')
      }
    });

    instance.opencodeProcess = child;

    let started = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const timeout = setTimeout(() => {
      if (!started) {
        child.kill();
        log.error('OPENCODE', `OpenCode start TIMEOUT after 20s, killing process`);
        reject(new Error('OpenCode start timeout'));
      }
    }, 20000);

    // Progress log every 5s if OpenCode hasn't started
    const progressLog = setInterval(() => {
      if (started) { clearInterval(progressLog); return; }
      log.info('OPENCODE', `Still waiting for OpenCode... (${((Date.now() - spawnStart) / 1000).toFixed(0)}s)`);
    }, 5000);

    child.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      const clean = stdoutBuffer.replace(/\x1b\[[0-9;]*m/g, '').toLowerCase();
      log.info('OPENCODE', 'stdout:', clean.trim());
      if (clean.includes('server listening') || clean.includes('ready') || clean.includes('listening')) {
        if (!started) {
          started = true;
          clearInterval(progressLog);
          clearTimeout(timeout);
          log.info('OPENCODE', `OpenCode ready in ${Date.now() - spawnStart}ms`);
          resolve();
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
      const clean = stderrBuffer.replace(/\x1b\[[0-9;]*m/g, '').toLowerCase();
      log.warn('OPENCODE', 'stderr:', clean.trim());
      if ((clean.includes('error') && !clean.includes('no error')) || clean.includes('fatal') || clean.includes('failed')) {
        if (!started) {
          started = true;
          clearInterval(progressLog);
          clearTimeout(timeout);
          reject(new Error(`OpenCode error: ${stderrBuffer}`));
        }
      }
    });

    child.on('error', (error) => {
      if (!started) {
        started = true;
        clearInterval(progressLog);
        clearTimeout(timeout);
        reject(error);
      }
    });

    child.on('exit', (code) => {
      log.info('OPENCODE', 'Exited with code', code);
      if (!started) {
        started = true;
        clearInterval(progressLog);
        clearTimeout(timeout);
        reject(new Error(`OpenCode exited with code ${code}`));
      }
    });
  });
}

/** Find syncro.exe in the project dir, packaged resources, parent dir, or fall back to PATH. */
function findSyncRoExecutable(projectPath) {
  // 1) Bundled alongside the project (dev or user-data copy)
  const localSyncro = path.join(projectPath, 'syncro.exe');
  if (fs.existsSync(localSyncro)) return localSyncro;

  // 2) Packaged as an extraResource (NSIS / portable → resources/syncro.exe)
  if (process.resourcesPath) {
    const resourcesSyncro = path.join(process.resourcesPath, 'syncro.exe');
    if (fs.existsSync(resourcesSyncro)) return resourcesSyncro;
  }

  // 3) Parent directory (portable exe sitting next to the project folder)
  const parentSyncro = path.join(path.dirname(projectPath), 'syncro.exe');
  if (fs.existsSync(parentSyncro)) return parentSyncro;

  // 4) System PATH
  return 'syncro';
}

/** Spawn the SyncRo process and resolve when it starts listening. */
async function startSyncRo(instance) {
  const { project, ports } = instance;
  const syncroPath = findSyncRoExecutable(project.path);
  const spawnStart = Date.now();
  log.info('SYNCRO', `Spawning SyncRo: ${syncroPath} start --port ${ports.syncro} --path ${project.path}`);

  return new Promise((resolve, reject) => {
    const args = ['start', '--port', ports.syncro.toString(), '--path', project.path];
    const child = spawn(syncroPath, args, {
      cwd: project.path,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    });

    instance.syncroProcess = child;

    let started = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const timeout = setTimeout(() => {
      if (!started) {
        child.kill();
        log.error('SYNCRO', `SyncRo start TIMEOUT after 30s, killing process`);
        reject(new Error('SyncRo start timeout'));
      }
    }, 30000);

    // Progress log every 5s if SyncRo hasn't started
    const progressLog = setInterval(() => {
      if (started) { clearInterval(progressLog); return; }
      log.info('SYNCRO', `Still waiting for SyncRo... (${((Date.now() - spawnStart) / 1000).toFixed(0)}s)`);
    }, 5000);

    child.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      const clean = stdoutBuffer.replace(/\x1b\[[0-9;]*m/g, '').toLowerCase();
      log.info('SYNCRO', 'stdout:', clean.trim());
      if (clean.includes('started') || clean.includes('watching') || clean.includes('listening')) {
        if (!started) {
          started = true;
          clearInterval(progressLog);
          clearTimeout(timeout);
          log.info('SYNCRO', `SyncRo ready in ${Date.now() - spawnStart}ms`);
          resolve();
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
      const raw = stderrBuffer.replace(/\x1b\[[0-9;]*m/g, '');
      const clean = raw.toLowerCase();
      // Chokidar EPERM/ENOSPC watch errors are harmless noise on Windows:
      // SyncRo tries to watch protected paths (node_modules/.cache, .git/objects,
      // desktop-app/dist, etc.) and fails. Down-level from WARN → INFO so the
      // user doesn't see red warnings for something that doesn't affect push.
      const isHarmlessWatchError =
        /chokidar error/.test(clean) &&
        (/eperm/.test(clean) || /enospc/.test(clean) || /operation not permitted/.test(clean) || /watch\s*$/.test(clean.trim()));
      if (isHarmlessWatchError) {
        // Still log but at INFO and only first occurrence per start to avoid spam.
        if (!child._harmlessWatchWarned) {
          child._harmlessWatchWarned = true;
          log.info('SYNCRO', 'chokidar watch errors on protected paths detected (ignored, push unaffected)');
        }
      } else {
        log.warn('SYNCRO', 'stderr:', raw.trim());
      }
      if ((clean.includes('error') && !clean.includes('no error') && !clean.includes('chokidar error')) || clean.includes('fatal') || clean.includes('failed')) {
        if (!started) {
          started = true;
          clearInterval(progressLog);
          clearTimeout(timeout);
          reject(new Error(`SyncRo error: ${stderrBuffer}`));
        }
      }
    });

    child.on('error', (error) => {
      if (!started) {
        started = true;
        clearInterval(progressLog);
        clearTimeout(timeout);
        reject(error);
      }
    });

    child.on('exit', (code) => {
      log.info('SYNCRO', 'Exited with code', code);
      if (!started) {
        started = true;
        clearInterval(progressLog);
        clearTimeout(timeout);
        reject(new Error(`SyncRo exited with code ${code}`));
      }
    });
  });
}

// Re-export the full process-manager surface so existing callers
// (instance-manager.js) keep their single require('./process-manager').
module.exports = {
  startOpencode,
  startSyncRo,
  findSyncRoExecutable,
  findOpencodeExecutable,
  checkOpencodeVersion,
  downloadOpencodeBinary,
  killProcessesOnPorts,
  killProcessTree,
  killByImageName,
  gracefulKill,
  isPidAlive,
  sleep,
  execAsync,
};
