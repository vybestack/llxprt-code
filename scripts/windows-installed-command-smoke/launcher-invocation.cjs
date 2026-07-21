'use strict';

/**
 * Launcher invocation helpers: spawn cmd/PowerShell launchers with the
 * constrained PATH, parse probe JSON output, and quote arguments safely.
 *
 * cmd quoting:
 *   Node's spawnSync('cmd', ['/c', cmdPath, ...args]) passes each argv
 *   element as a separate argument to CreateProcess, which cmd.exe then
 *   re-joins into a single command line. However, cmd.exe parses the joined
 *   line for metacharacters (&, |, <, >, ^, %, !, (, )) even within the
 *   arguments. To safely test .cmd arguments with metacharacters, we wrap
 *   each argument in double quotes and escape internal double quotes by
 *   doubling them (cmd's own quoting rule). This is NOT CodeRabbit's
 *   suggestion of backslash-escaping (that is POSIX shell escaping, not cmd).
 *
 *   Percent signs (%) are a special case: inside a batch file, %VAR% expands
 *   environment/delayed variables; %1..%9 expand positional parameters. The
 *   launcher under test forwards args via %*, not %1..%9, so positional
 *   expansion does not apply to forwarded args. However cmd.exe does still
 *   parse %X patterns for variables when the argument reaches a batch
 *   context. To ensure a literal percent survives cmd.exe's parser verbatim,
 *   it is doubled (%%) — the standard cmd idiom for a literal percent inside
 *   a batch file. Delayed expansion (!VAR!) is off by default in batch files
 *   unless `setlocal enabledelayedexpansion` is used; the generated launcher
 *   does not enable it, so ! is not expanded. We double % and leave ! as-is.
 *
 * PowerShell resolution (root cause C, CI run 29850614559):
 *   windows-latest ships PowerShell 7 (pwsh.exe) but NOT legacy `powershell`
 *   on PATH. The PowerShell executable is resolved via resolvePwsh() (prefers
 *   PWSH_PATH, then pwsh.exe via where.exe, then powershell.exe) so the
 *   harness works on the actual runner image.
 */

const { spawnSync } = require('node:child_process');
const { CONSTRAINED_PATH } = require('./constants.cjs');
const { resolvePwsh } = require('./pwsh-resolver.cjs');

function probeArg(request) {
  return 'LLXPRT_PROBE=' + JSON.stringify(request);
}

/**
 * Parses the probe JSON payload from the launcher's stdout. Wraps JSON.parse
 * in a try/catch and re-throws with the raw stdout context so test failures
 * show the actual malformed content instead of an opaque SyntaxError.
 */
function parseProbeOutput(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `no JSON object in probe output: ${JSON.stringify(stdout)}`,
    );
  }
  const jsonText = stdout.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    throw new Error(
      `failed to parse probe JSON: ${e.message}\njsonText=${JSON.stringify(jsonText)}\nfullStdout=${JSON.stringify(stdout)}`,
    );
  }
}

/**
 * Validates a spawnSync result, throwing on a spawn failure (r.error) or a
 * signal-based termination (r.signal). A nonzero exit status (r.status) is
 * NOT treated as a spawn failure — it is a legitimate child exit code that
 * the caller is responsible for interpreting. This keeps spawn failures
 * (cmd.exe missing, ENOENT) distinct from child exit codes so a launch
 * problem is never silently normalized as a child status.
 *
 * @param {string} label - human-readable label for the error message.
 * @param {import('node:child_process').SpawnSyncReturns} r - spawnSync result.
 * @returns {import('node:child_process').SpawnSyncReturns} the validated result.
 * @throws {Error} when r.error is set or r.signal is non-null.
 */
function validateSpawnResult(label, r) {
  if (r.error) {
    throw new Error(`${label}: spawn failed: ${r.error.message}`);
  }
  if (r.signal) {
    throw new Error(`${label}: terminated by signal ${r.signal}`);
  }
  return r;
}

/**
 * Quotes a single argument for cmd.exe /c invocation. Wraps the value in
 * double quotes and doubles internal double quotes (cmd's quoting rule).
 * Doubles percent signs (%%) so a literal % survives cmd.exe's batch parser
 * (inside a batch file, %VAR% expands variables and %% is a literal %).
 * Delayed expansion (!VAR!) is off by default in batch files; the generated
 * launcher does not enable it, so ! is left as-is.
 */
function cmdQuote(s) {
  let escaped = String(s).replace(/"/g, '""');
  escaped = escaped.replace(/%/g, '%%');
  return `"${escaped}"`;
}

/**
 * Quotes a single argument for PowerShell -Command invocation. Uses single
 * quotes (PowerShell's literal string) and doubles internal single quotes.
 */
function pwshQuote(s) {
  if (/^[\w./:=@-]+$/.test(s)) return s;
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function invokeCmd(cmdPath, args, opts) {
  // Build the full command line: cmdPath followed by quoted args.
  // cmd.exe /c receives each as a separate argv element (CreateProcess
  // boundaries are preserved — no shell string concatenation on our side).
  // The cmdQuote wrapping protects against cmd.exe's own re-parsing.
  const quotedArgs = args.map((a) => cmdQuote(a));
  const r = spawnSync('cmd', ['/c', cmdPath, ...quotedArgs], {
    encoding: 'utf8',
    timeout: opts?.timeout ?? 30_000,
    input: opts?.input,
    env: { ...process.env, PATH: CONSTRAINED_PATH, ...(opts?.env || {}) },
    windowsHide: true,
  });
  // A spawn failure (cmd.exe not found, etc.) is a harness error, not a
  // child exit code. validateSpawnResult throws so callers never confuse a
  // launch problem with a legitimate nonzero status.
  return validateSpawnResult(`invokeCmd(${cmdPath})`, r);
}

function invokePwsh(ps1Path, args, opts) {
  const argString = args.map((a) => pwshQuote(a)).join(' ');
  // Resolve PowerShell robustly: PWSH_PATH, then pwsh.exe, then powershell.exe.
  // Hardcoding 'powershell' failed with ENOENT on windows-latest (run 29850614559).
  const pwshExe = resolvePwsh();
  const r = spawnSync(
    pwshExe,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `& '${ps1Path.replace(/'/g, "''")}' ${argString}`,
    ],
    {
      encoding: 'utf8',
      timeout: opts?.timeout ?? 30_000,
      input: opts?.input,
      env: { ...process.env, PATH: CONSTRAINED_PATH, ...(opts?.env || {}) },
      windowsHide: true,
    },
  );
  return validateSpawnResult(`invokePwsh(${ps1Path})`, r);
}

module.exports = {
  probeArg,
  parseProbeOutput,
  invokeCmd,
  invokePwsh,
  cmdQuote,
  pwshQuote,
  validateSpawnResult,
};
