'use strict';

/**
 * Robust PowerShell executable resolver for the Windows installed-command
 * smoke harness.
 *
 * Background (CI run 29850614559):
 *   windows-latest runners ship PowerShell 7 (`pwsh.exe`) but do NOT ship
 *   Windows PowerShell 5.1 (`powershell.exe`) on PATH. The previous harness
 *   hardcoded `powershell`, so every PowerShell-gated step failed with
 *   `spawnSync powershell ENOENT`.
 *
 * Resolution order (highest priority first):
 *   1. process.env.PWSH_PATH — set explicitly by the workflow from
 *      `(Get-Command pwsh).Source`. This is the most reliable source because
 *      it is derived from the actual runner toolchain before the smoke runs.
 *   2. `pwsh.exe` — PowerShell 7+, present on windows-latest.
 *   3. `powershell.exe` — legacy Windows PowerShell, present on some images.
 *
 * A bare name (`pwsh.exe`) relies on PATH lookup. The CONSTRAINED_PATH used by
 * the smoke intentionally strips most of PATH to prove the launcher does not
 * depend on ambient tooling, so a bare name can fail even when the binary
 * exists. To stay robust under a constrained PATH, resolve an ABSOLUTE path via
 * `where.exe` before falling back to the bare name. This keeps the constrained
 * PATH for the LAUNCHED command while still locating the shell reliably.
 */

const { spawnSync } = require('node:child_process');
const { statSync } = require('node:fs');

/**
 * @typedef {{
 *   platform?: string;
 *   env?: NodeJS.ProcessEnv;
 *   spawnSync?: typeof import('node:child_process').spawnSync;
 *   existsSync?: typeof import('node:fs').existsSync;
 *   statSync?: typeof import('node:fs').statSync;
 * }} ResolverOptions
 */

/**
 * Resolves an absolute path to a command via `where.exe` on Windows. Returns
 * null when the command is not found or this is not Windows. `where.exe`
 * searches the REAL process PATH (the resolver is invoked before the
 * constrained-PATH spawn), so it sees the full runner PATH.
 *
 * @param {string} command - bare command name, e.g. 'pwsh.exe'.
 * @param {ResolverOptions} [options]
 * @returns {string | null}
 */
function whereResolve(command, options) {
  const platform = (options && options.platform) || process.platform;
  if (platform !== 'win32') return null;
  const spawn = (options && options.spawnSync) || spawnSync;
  const r = spawn('where.exe', [command], {
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  });
  if (r.error || r.status !== 0 || !r.stdout) {
    return null;
  }
  const first = String(r.stdout).trim().split(/\r?\n/)[0];
  if (!first) return null;
  // where.exe may return a path enclosed in double quotes on some Windows
  // builds; strip surrounding quotes so the result is a usable bare path.
  const unquoted = first.replace(/^"(.*)"$/, '$1');
  return unquoted || null;
}

/**
 * Resolves the PowerShell executable to use for spawning .ps1 launchers and
 * process-tree inspection.
 *
 * @param {ResolverOptions} [options]
 * @returns {string} the PowerShell executable (absolute when resolvable,
 *   otherwise the bare fallback name so PATH lookup is attempted last).
 */
function resolvePwsh(options) {
  const platform = (options && options.platform) || process.platform;
  if (platform !== 'win32') {
    // Non-Windows: there is no pwsh.exe. Tests inject options to exercise the
    // Windows branches; on real POSIX hosts this function is never called by
    // the runtime (the top-level smoke exits 0 on non-Windows).
    return 'pwsh';
  }
  const env = (options && options.env) || process.env;
  const stat =
    options && typeof options.statSync === 'function'
      ? options.statSync
      : statSync;

  // PWSH_PATH must point to a real FILE (the pwsh executable), not a
  // directory. Use a single statSync call (not existsSync + statSync) to
  // avoid a TOCTOU race where the file is removed between the two calls.
  if (env.PWSH_PATH) {
    try {
      if (stat(env.PWSH_PATH).isFile()) {
        return env.PWSH_PATH;
      }
    } catch {
      // stat failed (file does not exist or is inaccessible); fall through
      // to the next resolution strategy.
    }
  }

  // 2. pwsh.exe (PowerShell 7+) — present on windows-latest.
  const pwshAbs = whereResolve('pwsh.exe', options);
  if (pwshAbs) {
    return pwshAbs;
  }

  // 3. powershell.exe (legacy Windows PowerShell).
  const powershellAbs = whereResolve('powershell.exe', options);
  if (powershellAbs) {
    return powershellAbs;
  }

  // Last resort: bare names so Node attempts a PATH lookup at spawn time.
  // Prefer pwsh.exe (PowerShell 7+) since windows-latest ships it.
  return 'pwsh.exe';
}

module.exports = {
  resolvePwsh,
  whereResolve,
};
