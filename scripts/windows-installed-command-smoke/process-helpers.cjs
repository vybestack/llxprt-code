'use strict';

/**
 * Process-tree inspection and cross-platform sleep helpers for the Windows
 * smoke. These use PowerShell/CIM to enumerate descendants via a visited-set
 * BFS that does not silently truncate.
 *
 * The PowerShell executable is resolved via resolvePwsh() (root cause C) so
 * the harness works on windows-latest where only pwsh.exe is present.
 */

const { spawnSync, spawn } = require('node:child_process');
const { resolvePwsh } = require('./pwsh-resolver.cjs');

/**
 * Validates that a value is a positive integer PID suitable for interpolation
 * into a PowerShell command. Prevents command injection if a PID is ever
 * derived from an unexpected source.
 *
 * @param {unknown} pid
 * @returns {asserts pid is number}
 */
function assertValidPid(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid PID: ${JSON.stringify(pid)}`);
  }
}

/**
 * Async readiness poll that yields to the event loop between checks so stdout
 * event handlers fire between checks.
 *
 * Resolves with the accumulated stdout when the ready marker appears, or
 * rejects if the child exits early or the deadline passes.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} readyMarker
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
function waitForReady(child, readyMarker, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let settled = false;

    function done(ok, value) {
      if (settled) return;
      settled = true;
      cleanup();
      if (ok) {
        resolve(value);
      } else {
        reject(new Error(value));
      }
    }

    function onStdout(chunk) {
      stdout += chunk.toString();
      if (stdout.includes(readyMarker)) {
        done(true, stdout);
      }
    }

    function onExit(code, signal) {
      done(
        false,
        `launcher child exited before tree inspection (code=${code}, signal=${signal}, stdout=${JSON.stringify(stdout)})`,
      );
    }

    function onError(err) {
      done(false, `launcher child error: ${err.message}`);
    }

    function onTimeout() {
      done(
        false,
        `probe did not report ready within ${timeoutMs}ms (stdout=${JSON.stringify(stdout)})`,
      );
    }

    const timer = setTimeout(onTimeout, timeoutMs);
    const out = child.stdout;
    if (out) {
      out.on('data', onStdout);
    }
    child.on('exit', onExit);
    child.on('error', onError);

    function cleanup() {
      clearTimeout(timer);
      if (out) {
        out.removeListener('data', onStdout);
      }
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    }
  });
}

/**
 * Terminates the entire process tree rooted at rootPid on Windows using
 * `taskkill /T /F`. Falls back to child.kill() on non-Windows or if taskkill
 * fails. The /T flag kills the entire descendant tree; /F forces termination.
 * Checks the taskkill result and falls back to child.kill() if it failed.
 *
 * @param {import('node:child_process').ChildProcess} child
 */
function killProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === 'win32' && child.pid) {
    try {
      assertValidPid(child.pid);
      const r = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 10_000,
      });
      if (r.error || r.status !== 0) {
        // taskkill failed; fall back to child.kill.
        child.kill('SIGKILL');
      }
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // best effort; child may have exited concurrently
      }
    }
    return;
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // best effort; child may have exited concurrently
  }
}

/**
 * Maximum number of BFS breadth levels to traverse before declaring an
 * explicit failure. This bounds the traversal depth (not the descendant
 * count) so a deep but narrow tree is still fully enumerated, while an
 * unbounded cycle is rejected. Combined with the visited set, this prevents
 * an infinite loop without silently truncating realistic trees.
 */
const MAX_LEVELS = 200;

/**
 * Synchronously inspects the process tree under rootPid via PowerShell/CIM.
 * Uses a visited-set BFS that continues until no new descendants are found or
 * the safe maximum is reached — no silent depth-limited false-negatives.
 *
 * @param {number} rootPid - the root process PID to inspect.
 * @returns {{ bunPresent: boolean, nodePresent: boolean, descendants: Array<{pid: number, name: string}> }}
 * @throws {Error} on invalid PID, spawn error, non-zero PowerShell exit, or
 *   exceeding the safety maximum, so a failure is visible rather than
 *   returning an empty tree.
 */
function inspectProcessTreeSync(rootPid) {
  // An invalid PID is a caller bug (the harness derived it from an unexpected
  // source). Throw via assertValidPid rather than silently returning an empty
  // tree that would mask the failure.
  assertValidPid(rootPid);
  // PowerShell BFS using a visited set: enqueue children, track visited PIDs
  // to avoid cycles, and continue until the queue is empty or the safety
  // maximum level is exceeded. $count tracks breadth levels (depth), not the
  // number of discovered descendants, so a deep narrow tree is fully walked.
  const script = [
    `function Get-Descendants($root) {`,
    `  $result = @()`,
    `  $visited = @{}`,
    `  $queue = @($root)`,
    `  $level = 0`,
    `  while ($queue.Count -gt 0 -and $level -lt ${MAX_LEVELS}) {`,
    `    $next = @()`,
    `    foreach ($p in $queue) {`,
    `      if ($visited.ContainsKey($p)) { continue }`,
    `      $visited[$p] = $true`,
    `      $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p)" -ErrorAction SilentlyContinue`,
    `      if ($kids) { $result += $kids; $next += $kids.ProcessId }`,
    `    }`,
    `    $queue = $next`,
    `    $level++`,
    `  }`,
    `  if ($level -ge ${MAX_LEVELS}) {`,
    `    throw "BFS level count exceeded safety maximum of ${MAX_LEVELS}"`,
    `  }`,
    `  return $result`,
    `}`,
    `Get-Descendants ${rootPid} | Select-Object ProcessId,Name | ConvertTo-Json -Compress`,
  ].join('\n');
  // Resolve PowerShell robustly (PWSH_PATH -> pwsh.exe -> powershell.exe).
  const pwshExe = resolvePwsh();
  const ps = spawnSync(pwshExe, ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (ps.error) {
    throw new Error(
      `inspectProcessTreeSync: PowerShell spawn failed: ${ps.error.message}`,
    );
  }
  if (ps.signal) {
    throw new Error(
      `inspectProcessTreeSync: PowerShell terminated by signal ${ps.signal}`,
    );
  }
  if (ps.status !== 0) {
    throw new Error(
      `inspectProcessTreeSync: PowerShell exited ${ps.status}: ${ps.stderr || ps.stdout}`,
    );
  }
  const descendants = [];
  const raw = ps.stdout.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const p of arr) {
        descendants.push({ pid: p.ProcessId, name: p.Name });
      }
    } catch (e) {
      throw new Error(
        `inspectProcessTreeSync: failed to parse PowerShell JSON output: ${e.message}\nraw=${JSON.stringify(raw)}`,
      );
    }
  }
  const names = descendants.map((d) => String(d.name).toLowerCase());
  const bunPresent = names.some((n) => n === 'bun.exe' || n === 'bun');
  const nodePresent = names.some((n) => n === 'node.exe' || n === 'node');
  return { bunPresent, nodePresent, descendants };
}

module.exports = {
  waitForReady,
  killProcessTree,
  inspectProcessTreeSync,
  spawn,
  assertValidPid,
  MAX_LEVELS,
};
