/** OpenCode binary management: locating, version-checking and downloading
 *  the pinned v1.17.18 executable. Shared constants here so the resolution
 *  policy (see startOpencode in process-manager.js) and the download path
 *  can never drift apart. */
const path = require('path');
const fs = require('fs');
const https = require('https');
const unzipper = require('unzipper');
const log = require('./logger');
const { execAsync } = require('./proc-utils');

/** The ONLY accepted version. We pin to a single known-good build so every
 *  RoBo install runs the exact same OpenCode (and gets the same event
 *  payload shapes). Any other version gets re-downloaded. */
const OPENCODE_VERSION = '1.17.18';

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
    if (version !== OPENCODE_VERSION) {
      log.warn('OPENCODE', `OpenCode version ${version} does not match required ${OPENCODE_VERSION} (strict pin)`);
      return false;
    }

    return true;
  } catch (error) {
    log.warn('OPENCODE', `Failed to check OpenCode version: ${error.message}`);
    return false;
  }
}

/** Download a URL following redirects into a local file (used for the
 *  GitHub release zip). */
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

/** Download OpenCode as a .zip and extract opencode.exe. The version is a
 *  constant on purpose — we pin to a known-good build so RoBo and the CLI
 *  can never drift. The destination is always <projectPath>/opencode.exe. */
async function downloadOpencodeBinary(projectPath) {
  const downloadUrl = `https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-windows-x64.zip`;
  const targetPath = path.join(projectPath, 'opencode.exe');
  const zipPath = path.join(projectPath, 'opencode-temp.zip');

  log.info('OPENCODE', `Downloading OpenCode v${OPENCODE_VERSION} from ${downloadUrl}`);

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
    log.info('OPENCODE', `OpenCode v${OPENCODE_VERSION} installed at ${targetPath}`);
    return targetPath;
  } catch (error) {
    fs.unlink(zipPath, () => {});
    throw error;
  }
}

module.exports = { OPENCODE_VERSION, findOpencodeExecutable, checkOpencodeVersion, downloadOpencodeBinary };
