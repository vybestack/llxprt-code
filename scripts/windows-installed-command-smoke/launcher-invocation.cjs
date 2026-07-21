'use strict';

/**
 * Launcher invocation helpers: spawn cmd/PowerShell launchers with the
 * constrained PATH, parse probe JSON output, and quote arguments safely.
 */

const { spawnSync } = require('node:child_process');
const { CONSTRAINED_PATH } = require('./constants.cjs');

function probeArg(request) {
  return 'LLXPRT_PROBE=' + JSON.stringify(request);
}

function parseProbeOutput(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `no JSON object in probe output: ${JSON.stringify(stdout)}`,
    );
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

function invokeCmd(cmdPath, args, opts) {
  const r = spawnSync('cmd', ['/c', cmdPath, ...args], {
    encoding: 'utf8',
    timeout: opts?.timeout ?? 30_000,
    input: opts?.input,
    env: { ...process.env, PATH: CONSTRAINED_PATH, ...(opts?.env || {}) },
    windowsHide: true,
  });
  return r;
}

function pwshQuote(s) {
  if (/^[\w./:=@-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "''") + "'";
}

function invokePwsh(ps1Path, args, opts) {
  const argString = args.map((a) => pwshQuote(a)).join(' ');
  const r = spawnSync(
    'powershell',
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
  return r;
}

module.exports = {
  probeArg,
  parseProbeOutput,
  invokeCmd,
  invokePwsh,
  pwshQuote,
};
