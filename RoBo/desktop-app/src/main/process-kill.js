/** Process termination helpers: port sweeps, graceful-then-forceful tree
 *  kills, and the image-name safety net for orphans (notably Bun runtime
 *  workers spawned by opencode.exe that reparent to the system root). */
const log = require('./logger');
const { execAsync, sleep, isPidAlive } = require('./proc-utils');

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

module.exports = { killProcessesOnPorts, gracefulKill, killProcessTree, killByImageName };
