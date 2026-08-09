/** Small process/shell utilities shared by opencode-binary.js and
 *  process-kill.js. Kept dependency-free (no log, no fs) so both
 *  modules can require it without cycles. */
const { exec } = require('child_process');

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

module.exports = { execAsync, sleep, isPidAlive };
