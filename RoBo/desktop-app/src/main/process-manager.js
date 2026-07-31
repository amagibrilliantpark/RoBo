const { spawn, exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const unzipper = require('unzipper');
const log = require('./logger');

/** Execute a shell command asynchronously with timeout. */
function execAsync(command, timeout = 5000) {
  return new Promise((resolve) => {
    exec(command, { encoding: 'utf-8', timeout }, (error, stdout) => {
      if (error) {
        resolve('');
      } else {
        resolve((stdout || '').trim());
      }
    });
  });
}

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

  // The ONLY accepted version. We pin to a single known-good build so
  // every RoBo install runs the exact same OpenCode (and gets the same
  // event payload shapes). Any other version gets re-downloaded.
  const TARGET_VERSION = '1.17.18';
  const DOWNLOAD_VERSION = '1.17.18';
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
      log.info('OPENCODE', `  - Action: will download v${DOWNLOAD_VERSION} → ${path.join(project.path, 'opencode.exe')}`);
    }
    log.info('OPENCODE', '============================================================');
  } else {
    log.info('OPENCODE',
      found
        ? `Using bundled opencode.exe (source: ${found.source}) at ${found.path} — NOT the PATH CLI`
        : `No bundled opencode.exe found, will download v${DOWNLOAD_VERSION} into project — NOT the PATH CLI`);
  }

  let opencodePath = found ? found.path : null;

  // 2) Validate the candidate: must exist and be at or above REQUIRED_VERSION.
  let needDownload = false;
  if (!opencodePath) {
    needDownload = true;
    if (!isDev) {
      log.warn('OPENCODE', `OpenCode.exe not found next to the project or in app resources, downloading v${DOWNLOAD_VERSION}…`);
    }
  } else {
    const versionValid = await checkOpencodeVersion(opencodePath);
    if (!versionValid) {
      if (isDev) {
        log.warn('OPENCODE', `Bundled opencode.exe is not v${TARGET_VERSION}, will re-download`);
      } else {
        log.warn('OPENCODE', `OpenCode at ${opencodePath} is not v${TARGET_VERSION}, downloading v${DOWNLOAD_VERSION}…`);
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
      log.error('OPENCODE', `Failed to download OpenCode v${DOWNLOAD_VERSION}: ${error.message}`);
      throw new Error(`OpenCode v${DOWNLOAD_VERSION} could not be installed automatically. ` +
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

/** Find opencode.exe in the project dir, packaged resources, or the
 *  parent of the project dir. Returns an object with the absolute path
 *  and the source label, or null if no bundled copy is found. PATH is
 *  intentionally NOT consulted — see startOpencode() for the CLI-free
 *  resolution policy. */
function findOpencodeExecutable(projectPath) {
  // 1) Bundled alongside the project (dev or user-data copy)
  const localOpencode = path.join(projectPath, 'opencode.exe');
  if (fs.existsSync(localOpencode)) {
    return { path: localOpencode, source: 'project' };
  }

  // 2) Packaged as an extraResource (NSIS / portable → resources/opencode.exe)
  if (process.resourcesPath) {
    const resourcesOpencode = path.join(process.resourcesPath, 'opencode.exe');
    if (fs.existsSync(resourcesOpencode)) {
      return { path: resourcesOpencode, source: 'resources' };
    }
  }

  // 3) Parent directory (portable exe sitting next to the project folder)
  const parentOpencode = path.join(path.dirname(projectPath), 'opencode.exe');
  if (fs.existsSync(parentOpencode)) {
    return { path: parentOpencode, source: 'parent' };
  }

  // No bundled copy — caller will trigger a download into projectPath.
  return null;
}

/** Check if opencode version is EXACTLY v1.17.18.
 *  We do not accept any other version on purpose:
 *  - Different minor versions can change SSE event payload schemas
 *    (we just verified this against the OpenAPI spec).
 *  - Pinning to a single known-good build eliminates session drift
 *    between RoBo and the bundled OpenCode.
 *  - Any "newer" version found in the wild gets replaced by our
 *    v1.17.18 download — there's no situation where we'd want to
 *    honor a different version. */
async function checkOpencodeVersion(opencodePath) {
  try {
    const result = await execAsync(`"${opencodePath}" -v`, 5000);
    const versionMatch = result.match(/v?(\d+\.\d+\.\d+)/);
    if (!versionMatch) {
      log.warn('OPENCODE', `Could not parse version from: ${result}`);
      return false;
    }
    const version = versionMatch[1];
    log.info('OPENCODE', `Found OpenCode version: ${version}`);

    // STRICT equality — not ">=". A 1.17.19 or 1.18.0 build will fail
    // this check and trigger a re-download to v1.17.18.
    const TARGET_VERSION = '1.17.18';
    if (version !== TARGET_VERSION) {
      log.warn('OPENCODE', `OpenCode version ${version} does not match required ${TARGET_VERSION} (strict pin)`);
      return false;
    }

    return true;
  } catch (error) {
    log.warn('OPENCODE', `Failed to check OpenCode version: ${error.message}`);
    return false;
  }
}

/** Download OpenCode v1.17.18 as a .zip and extract opencode.exe.
 *  The version is a constant on purpose — we pin to a known-good build
 *  so RoBo and the CLI can never drift. The destination is always
 *  <projectPath>/opencode.exe. */
function downloadWithRedirect(url, zipPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(zipPath);
    function follow(currentUrl) {
      https.get(currentUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          follow(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          file.close(() => fs.unlink(zipPath, () => {}));
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }
        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;
        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize) {
            const progress = Math.round((downloadedSize / totalSize) * 100);
            if (progress % 10 === 0) log.info('OPENCODE', `Download progress: ${progress}%`);
          }
        });
        response.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      }).on('error', reject);
    }
    follow(url);
  });
}

async function downloadOpencodeBinary(projectPath) {
  const VERSION = '1.17.18';
  const downloadUrl = `https://github.com/anomalyco/opencode/releases/download/v${VERSION}/opencode-windows-x64.zip`;
  const targetPath = path.join(projectPath, 'opencode.exe');
  const zipPath = path.join(projectPath, 'opencode-temp.zip');

  log.info('OPENCODE', `Downloading OpenCode v${VERSION} from ${downloadUrl}`);

  try {
    await downloadWithRedirect(downloadUrl, zipPath);
    log.info('OPENCODE', `Download complete, extracting opencode.exe...`);

    const dir = await unzipper.Open.file(zipPath);
    const exe = dir.files.find(f => f.path === 'opencode.exe');
    if (!exe) {
      throw new Error('opencode.exe not found inside zip');
    }

    await new Promise((resolve, reject) => {
      exe.stream()
        .pipe(fs.createWriteStream(targetPath))
        .on('finish', resolve)
        .on('error', reject);
    });

    fs.unlinkSync(zipPath);
    log.info('OPENCODE', `OpenCode v${VERSION} installed at ${targetPath}`);
    return targetPath;
  } catch (error) {
    fs.unlink(zipPath, () => {});
    throw error;
  }
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

/** Kill any process already listening on the given ports. */
async function killProcessesOnPorts(syncroPort, opencodePort) {
  for (const port of [syncroPort, opencodePort]) {
    try {
      if (process.platform === 'win32') {
        const result = await execAsync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`, 5000);
        if (result) {
          const pids = result.split(/\s+/).filter(p => p.trim());
          for (const pid of pids) {
            const pidNum = parseInt(pid);
            if (pidNum && pidNum > 0 && pidNum !== 0) {
              try { await execAsync(`taskkill /PID ${pidNum} /F`, 3000); } catch {}
            }
          }
        }
      } else {
        const result = await execAsync(`lsof -ti :${port}`, 5000);
        if (result) {
          const pids = result.split('\n').filter(p => p.trim());
          for (const pid of pids) {
            try { await execAsync(`kill -9 ${pid.trim()}`, 3000); } catch {}
          }
        }
      }
    } catch {}
  }
  await sleep(500);
}

/** Promise-based sleep. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Check whether a PID is still alive (running). */
function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      const out = require('child_process').execSync(
        `tasklist /FI "PID eq ${pid}" /NH`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }
      );
      return out.trim().length > 0 && !/no tasks are running/i.test(out);
    } else {
      process.kill(pid, 0);
      return true;
    }
  } catch {
    return false;
  }
}

/** Kill a process gracefully first (so cleanup runs and exit code is clean),
 *  then force-kill only if it survives the grace period.
 *  Windows: `taskkill /PID` (WM_CLOSE / CTRL_C) without /F is a polite request.
 *  POSIX:   SIGTERM. */
async function gracefulKill(pid, graceMs = 1500) {
  if (!pid || !isPidAlive(pid)) return;
  try {
    if (process.platform === 'win32') {
      // /PID without /F sends a graceful terminate. We intentionally do NOT
      // use /T here for the first pass so the main process can cleanly
      // reap its own children; the follow-up force pass uses /F /T.
      await execAsync(`taskkill /PID ${pid}`, 3000);
    } else {
      try { process.kill(-pid, 'SIGTERM'); } catch {}
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
  } catch {
    // Polite kill failed (e.g. permission denied) — skip grace and fall
    // through to force. Nothing to log, the force pass is coming anyway.
  }
  // Wait up to `graceMs` for the process to exit on its own.
  const start = Date.now();
  while (Date.now() - start < graceMs && isPidAlive(pid)) {
    await sleep(100);
  }
}

/** Kill a process AND its entire child tree, gracefully-then-forcefully.
 *  Windows:
 *    Pass 1: taskkill /PID (no /F) = graceful terminate request.
 *            Wait ~1.5s for clean exit.
 *    Pass 2: taskkill /F /T = hard terminate tree (exit codes 1 prevention
 *            gone — most processes will report clean 0 from pass 1).
 *  POSIX:
 *    Pass 1: SIGTERM to process group + pid, wait.
 *    Pass 2: SIGKILL to process group + pid. */
async function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      await gracefulKill(pid, 1500);
      if (isPidAlive(pid)) {
        // Still running after grace — aggressive tree kill.
        try { await execAsync(`taskkill /F /T /PID ${pid}`, 5000); } catch {}
      }
    } else {
      await gracefulKill(pid, 1500);
      try { process.kill(-pid, 'SIGKILL'); } catch {}
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  } catch {}
}

/** Safety net: kill every process whose image name matches one of `names`.
 *  Used after a tree-kill because some grandchildren (notably Bun runtime
 *  workers spawned by opencode.exe) can reparent to the system root and
 *  escape `taskkill /T`. Matching by image name catches them regardless of
 *  parent PID. Each call is best-effort and never throws. */
async function killByImageName(names) {
  for (const name of names) {
    if (!name) continue;
    try {
      if (process.platform === 'win32') {
        // `/F /T` is the most aggressive combo: force-kill AND walk the tree.
        // Exit codes 0/128 are success; 128/1 mean "no match" which is fine.
        await execAsync(`taskkill /F /T /IM "${name}"`, 5000);
      } else {
        await execAsync(`pkill -9 -f "${name}"`, 5000);
      }
    } catch {
      // No matching process → nothing to kill. Swallow.
    }
  }
}

module.exports = { startOpencode, startSyncRo, findSyncRoExecutable, findOpencodeExecutable, checkOpencodeVersion, downloadOpencodeBinary, killProcessesOnPorts, killProcessTree, killByImageName, gracefulKill, isPidAlive, sleep };
