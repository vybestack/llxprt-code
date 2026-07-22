'use strict';

/**
 * Process-tree inspection and cross-platform sleep helpers for the Windows
 * smoke. These use PowerShell/CIM to enumerate descendants via a visited-set
 * BFS that does not silently truncate.
 *
 * The PowerShell executable is resolved via resolvePwsh() (root cause C) so
 * the harness works on windows-latest where only pwsh.exe is present.
 */

const { spawnSync } = require('node:child_process');
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
    // Cap stdout accumulation to prevent unbounded memory growth from a
    // misbehaving child process. The probe payload is small (a few KB);
    // 1MB is a generous ceiling that accommodates interleaved log output.
    const MAX_STDOUT_BYTES = 1024 * 1024;

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
      if (stdout.length > MAX_STDOUT_BYTES) {
        done(
          false,
          `probe stdout exceeded ${MAX_STDOUT_BYTES} bytes without ready marker (possible infinite output loop)`,
        );
        return;
      }
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

    // Check for already-exited children BEFORE attaching listeners so a
    // child that exits synchronously between spawn() and the listener
    // attachment does not cause the promise to hang until timeout.
    if (child.exitCode !== null || child.signalCode !== null) {
      clearTimeout(timer);
      reject(
        new Error(
          `launcher child already exited before tree inspection (code=${child.exitCode}, signal=${child.signalCode})`,
        ),
      );
      return;
    }

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
        windowsHide: true,
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
    windowsHide: true,
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

/**
 * Maximum number of ancestry hops to walk from the probe PID back to the
 * spawned launcher root before declaring an explicit failure. Bounds the
 * traversal so a pathological cycle is rejected rather than looping forever.
 * Accounts for intermediary processes (cmd/pwsh launchers, conhost) but
 * stops at the launcher root — it does NOT walk beyond the root because the
 * test harness itself is a Node process.
 */
const MAX_ANCESTRY_HOPS = 32;

/**
 * Pure validation of a bounded ancestry chain. Does not perform any I/O; it
 * inspects an in-memory snapshot of the chain walked from the probe PID
 * toward the root and asserts the required invariants.
 *
 * Invariants enforced:
 *   - rootReached: the chain must terminate at (include) the root PID.
 *   - bunExpected: the chain must include at least one Bun process name.
 *   - nodeRejected: the chain must NOT include any node.exe process (the
 *     launcher must hand off directly to bundled bun.exe, never node).
 *
 * Each entry is { pid, ppid, name }. The first entry is the probe PID (the
 * Bun process that reported the payload); subsequent entries are its
 * ancestors walked toward root, up to and including rootPid.
 *
 * @param {Array<{pid: number, ppid: number, name: string}>} chain - ancestry
 *   chain entries, oldest ancestor last (rootPid is the last entry when
 *   rootReached is true).
 * @param {number} rootPid - the PID the launcher was spawned with.
 * @returns {{ ok: true, chain: Array<{pid: number, ppid: number, name: string}> }}
 * @throws {Error} with a descriptive message when any invariant fails.
 */
function validateProcessLineage(chain, rootPid) {
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error('validateProcessLineage: empty chain');
  }
  const rootEntry = chain[chain.length - 1];
  const rootReached = rootEntry.pid === rootPid;
  const names = chain.map((e) => String(e.name || '').toLowerCase());
  const bunPresent = names.some((n) => n === 'bun.exe' || n === 'bun');
  const nodePresent = names.some((n) => n === 'node.exe' || n === 'node');
  if (!rootReached) {
    throw new Error(
      `lineage root not reached: last ancestor pid=${rootEntry.pid} (name=${rootEntry.name}), expected root pid=${rootPid}`,
    );
  }
  if (!bunPresent) {
    throw new Error(
      `lineage missing bundled bun: no bun.exe/bun in chain ${JSON.stringify(chain)}`,
    );
  }
  if (nodePresent) {
    throw new Error(
      `lineage contains node.exe (must be absent): ${JSON.stringify(chain)}`,
    );
  }
  return { ok: true, chain };
}

/**
 * Synchronously queries a single process snapshot by PID from CIM via
 * PowerShell, returning { pid, ppid, name } or null when the PID is no
 * longer alive. Used as the primitive for the bounded ancestry walk.
 *
 * Diagnostics: spawn failures, non-zero PowerShell exit, and unparseable JSON
 * all throw explicit errors carrying stderr/raw context so the next CI run is
 * actionable. null is returned ONLY when CIM definitively reports the process
 * absent (empty stdout on a successful query) — i.e. the process is no longer
 * alive, which is the one legitimate "not found" outcome for the ancestry walk.
 *
 * @param {number} pid
 * @param {{ resolvePwsh?: () => string, spawnSync?: typeof import('node:child_process').spawnSync, timeout?: number }} [options]
 * @returns {{pid: number, ppid: number, name: string} | null}
 * @throws {Error} on spawn error, signal termination, non-zero PowerShell
 *   exit, or unparseable JSON output.
 */
function queryProcessEntry(pid, options) {
  const _spawnSync =
    options && typeof options.spawnSync === 'function'
      ? options.spawnSync
      : spawnSync;
  const _resolvePwsh =
    options && typeof options.resolvePwsh === 'function'
      ? options.resolvePwsh
      : resolvePwsh;
  const timeout = options && options.timeout ? options.timeout : 15_000;
  assertValidPid(pid);
  const script =
    `try { ` +
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction Stop; ` +
    `if ($p) { ` +
    `@{ pid = $p.ProcessId; ppid = $p.ParentProcessId; name = $p.Name } | ConvertTo-Json -Compress ` +
    `} else { '' } ` +
    `} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  const r = _spawnSync(_resolvePwsh(), ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  });
  if (r.error) {
    throw new Error(
      `queryProcessEntry: spawn failed for pid=${pid}: ${r.error.message}`,
    );
  }
  if (r.signal) {
    throw new Error(
      `queryProcessEntry: PowerShell terminated by signal ${r.signal} for pid=${pid} (stderr=${JSON.stringify(r.stderr || '')})`,
    );
  }
  if (r.status !== 0) {
    throw new Error(
      `queryProcessEntry: PowerShell exited ${r.status} for pid=${pid} (stderr=${JSON.stringify(r.stderr || '')}, stdout=${JSON.stringify(r.stdout || '')})`,
    );
  }
  const raw = (r.stdout || '').trim();
  // Empty output on a successful (status 0) query means CIM definitively
  // reports the process absent — the one legitimate "not found" outcome.
  if (!raw) return null;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `queryProcessEntry: failed to parse JSON for pid=${pid}: ${e.message} (raw=${JSON.stringify(raw)}, stderr=${JSON.stringify(r.stderr || '')})`,
    );
  }
  const entryPid = Number(obj.pid);
  const entryPpid = Number(obj.ppid);
  const name = String(obj.name || '');
  if (!Number.isInteger(entryPid) || !Number.isInteger(entryPpid)) {
    throw new Error(
      `queryProcessEntry: non-integer pid/ppid for pid=${pid}: entryPid=${JSON.stringify(obj.pid)}, entryPpid=${JSON.stringify(obj.ppid)} (raw=${JSON.stringify(raw)})`,
    );
  }
  return { pid: entryPid, ppid: entryPpid, name };
}

/**
 * Walks the process ancestry from the probe-reported PID upward toward the
 * spawned launcher root (rootPid), building a bounded chain. Stops when the
 * root PID is reached or when MAX_ANCESTRY_HOPS is exceeded (explicit
 * failure). Does NOT walk beyond the root because the test harness is a Node
 * process.
 *
 * Uses single-PID CIM queries so the walk is deterministic: each hop queries
 * one process rather than racing a descendants snapshot that can miss a
 * process that has just exited.
 *
 * @param {number} probePid - PID reported by the probe payload (the Bun
 *   process that ran index.ts).
 * @param {number} rootPid - PID of the spawned launcher root (child.pid).
 * @param {{ queryProcessEntry?: typeof queryProcessEntry }} [options]
 * @returns {Array<{pid: number, ppid: number, name: string}>}
 * @throws {Error} when a query fails before reaching root or the hop budget
 *   is exhausted without reaching root.
 */
function walkProcessLineage(probePid, rootPid, options) {
  const query =
    options && typeof options.queryProcessEntry === 'function'
      ? options.queryProcessEntry
      : queryProcessEntry;
  assertValidPid(probePid);
  assertValidPid(rootPid);
  const chain = [];
  let current = probePid;
  let hops = 0;
  const visited = new Set();
  while (hops <= MAX_ANCESTRY_HOPS) {
    if (visited.has(current)) {
      throw new Error(
        `walkProcessLineage: cycle detected at pid=${current} before reaching root=${rootPid}`,
      );
    }
    visited.add(current);
    const entry = query(current);
    if (!entry) {
      throw new Error(
        `walkProcessLineage: could not query pid=${current} (hop ${hops}) before reaching root=${rootPid}`,
      );
    }
    chain.push(entry);
    if (entry.pid === rootPid) {
      return chain;
    }
    current = entry.ppid;
    if (!Number.isInteger(current) || current <= 0) {
      throw new Error(
        `walkProcessLineage: invalid ppid=${current} at pid=${entry.pid} before reaching root=${rootPid}`,
      );
    }
    hops++;
  }
  throw new Error(
    `walkProcessLineage: exceeded ${MAX_ANCESTRY_HOPS} hops without reaching root=${rootPid}`,
  );
}

module.exports = {
  waitForReady,
  killProcessTree,
  inspectProcessTreeSync,
  assertValidPid,
  MAX_LEVELS,
  validateProcessLineage,
  walkProcessLineage,
  queryProcessEntry,
  MAX_ANCESTRY_HOPS,
};
