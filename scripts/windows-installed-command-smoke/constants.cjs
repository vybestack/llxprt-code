'use strict';

const path = require('node:path');

/**
 * Shared constants for the Windows installed-command smoke harness.
 */

// Build the constrained PATH from process.env.SystemRoot so non-English or
// non-default Windows installations are handled correctly. Falls back to
// C:\Windows only if SystemRoot is unset (extremely rare).
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const CONSTRAINED_PATH = [
  path.join(systemRoot, 'System32'),
  systemRoot,
  path.join(systemRoot, 'System32', 'Wbem'),
].join(';');
const OWNERSHIP_SENTINEL =
  'LLXPRT_NATIVE_LAUNCHER owned by @vybestack/llxprt-code';
const VERSION_RE = /^\d+\.\d+\.\d+/;
const LAUNCH_ERROR_EXIT = 43;

/**
 * The exact Bun version expected to be bundled, as declared by the CLI
 * manifest ("bun" field in packages/cli/package.json). The smoke asserts the
 * installed bun.exe reports this version so a partial/incorrect install (e.g.
 * a non-Windows bun binary from a timed-out install) is caught explicitly.
 */
const EXPECTED_BUN_VERSION = '1.3.14';

/**
 * Installer/operation timeouts. All are env-configurable so a slow runner can
 * raise them without a code change, while staying well under the 60-minute job
 * timeout. Default values are deliberately generous because npm installs from a
 * warmed cache are fast on a warm runner but the first run pays cold-cache + Bun
 * postinstall costs.
 *
 * LLXPRT_SMOKE_* env vars are intentionally prefixed to avoid collisions.
 */
function readEnvMs(name, defaultMs) {
  const raw = process.env[name];
  if (!raw) return defaultMs;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return defaultMs;
  return n;
}

// 8 minutes for a single npm install (global/local/exec). The warmed cache
// makes this fast, but give headroom for cold-cache first-run + Bun postinstall.
const INSTALL_TIMEOUT_MS = readEnvMs(
  'LLXPRT_SMOKE_INSTALL_TIMEOUT_MS',
  480_000,
);
// 15 minutes for npm exec (npx) which can populate its own cache.
const NPM_EXEC_TIMEOUT_MS = readEnvMs(
  'LLXPRT_SMOKE_NPM_EXEC_TIMEOUT_MS',
  900_000,
);
// Per-launcher behavioral probe (fast: just bun -> index.ts).
const PROBE_TIMEOUT_MS = readEnvMs('LLXPRT_SMOKE_PROBE_TIMEOUT_MS', 30_000);
// Version probe (fast).
const VERSION_TIMEOUT_MS = readEnvMs('LLXPRT_SMOKE_VERSION_TIMEOUT_MS', 30_000);

module.exports = {
  CONSTRAINED_PATH,
  OWNERSHIP_SENTINEL,
  VERSION_RE,
  LAUNCH_ERROR_EXIT,
  EXPECTED_BUN_VERSION,
  INSTALL_TIMEOUT_MS,
  NPM_EXEC_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  VERSION_TIMEOUT_MS,
};
