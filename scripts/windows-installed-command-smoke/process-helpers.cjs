'use strict';

/**
 * Process-tree inspection and cross-platform sleep helpers for the Windows
 * smoke. These use PowerShell/CIM to enumerate descendants and a synchronous
 * Node delay primitive (Atomics.wait) that works on Windows without busy
 * spinning.
 */

const { spawnSync, spawn } = require('node:child_process');

/**
 * Synchronous sleep that works cross-platform. Prefers Atomics.wait (no extra
 * process, no busy spin). Falls back to PowerShell Start-Sleep, checking the
 * result so a spawn error does not silently produce a zero-length sleep.
 */
function sleepMs(ms) {
  try {
    const sab = new SharedArrayBuffer(4);
    const i32 = new Int32Array(sab);
    Atomics.wait(i32, 0, 0, ms);
  } catch {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Start-Sleep -Milliseconds ${ms}`],
      {
        stdio: 'ignore',
        timeout: ms + 2_000,
      },
    );
    if (r.error || r.status !== 0) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        // spin
      }
    }
  }
}

/**
 * Synchronously inspects the process tree under rootPid via PowerShell/CIM.
 * Throws on spawn error or non-zero PowerShell exit so a failure is visible,
 * rather than returning an empty tree silently (which would cause misleading
 * assertion failures).
 */
function inspectProcessTreeSync(rootPid) {
  if (!rootPid)
    return { bunPresent: false, nodePresent: false, descendants: [] };
  const script = [
    `function Get-Descendants($root) {`,
    `  $result = @()`,
    `  $queue = @($root)`,
    `  for ($i=0; $i -lt 4 -and $queue.Count -gt 0; $i++) {`,
    `    $next = @()`,
    `    foreach ($p in $queue) {`,
    `      $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p)" -ErrorAction SilentlyContinue`,
    `      if ($kids) { $result += $kids; $next += $kids.ProcessId }`,
    `    }`,
    `    $queue = $next`,
    `  }`,
    `  return $result`,
    `}`,
    `Get-Descendants ${rootPid} | Select-Object ProcessId,Name | ConvertTo-Json -Compress`,
  ].join('\n');
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (ps.error) {
    throw new Error(
      `inspectProcessTreeSync: PowerShell spawn failed: ${ps.error.message}`,
    );
  }
  if (ps.status !== 0) {
    throw new Error(
      `inspectProcessTreeSync: PowerShell exited ${ps.status} (signal=${ps.signal ?? 'none'}): ${ps.stderr || ps.stdout}`,
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
  sleepMs,
  inspectProcessTreeSync,
  spawn,
};
