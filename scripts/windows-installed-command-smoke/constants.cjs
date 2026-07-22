'use strict';

const path = require('node:path');
const fs = require('node:fs');

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
// Strict exact semver: X.Y.Z with optional prerelease, anchored at both ends.
// Used by resolveExpectedBunVersion to validate the manifest bun spec is a
// COMPLETE exact version — not a range (^, ~, >=) or a non-exact digit-leading
// spec (1.x, 1.3.14 - 2.0.0). Range prefixes must NOT be stripped.
//
// VERSION_RE and EXACT_SEMVER_RE are intentionally the same pattern: both
// enforce a strict start-to-end match. VERSION_RE is used by behavioral
// checks (checks.cjs) to validate --version output, and EXACT_SEMVER_RE is
// used by resolveExpectedBunVersion to validate the manifest spec. Both need
// the same exact-match semantics, so they share the same source pattern.
const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const VERSION_RE = EXACT_SEMVER_RE;
// Project-wide launcher-failure exit code convention: used consistently in
// packages/cli/bin/llxprt, install-native-launchers.cjs, and all smoke/launcher
// tests to signal a bundled-runtime launch failure (missing/corrupt Bun,
// wrong platform, missing entry point). Changing this value requires updating
// all referenced locations.
const LAUNCH_ERROR_EXIT = 43;

/**
 * Resolves the bundled Bun version from the CLI manifest so the smoke stays
 * in sync with the actual declared dependency. A hardcoded constant drifts
 * silently when the manifest is bumped. repoRoot is resolved relative to this
 * module (scripts/windows-installed-command-smoke/ -> repo root is two levels
 * up). The manifest must declare an EXACT semver pin (e.g. "1.3.14"); a range
 * spec (^, ~, >=, *) is rejected and the function returns undefined so the
 * health check fails loudly (a version mismatch against undefined) rather than
 * masking the misconfiguration. Range prefixes are NOT stripped: pretending a
 * range is exact would weaken the install-integrity guard.
 *
 * @param {{ cliPkgPath?: string, readFileSync?: (p: string) => string }} [options]
 *   Injection seam for deterministic testing.
 * @returns {string | undefined} the exact version, or undefined if the manifest
 *   is missing/unreadable or the bun spec is not a complete exact semver.
 */
function resolveExpectedBunVersion(options) {
  const moduleDir = __dirname;
  // __dirname is scripts/windows-installed-command-smoke; two levels up is
  // the repo root, then packages/cli/package.json.
  const cliPkgPath =
    (options && options.cliPkgPath) ||
    path.join(moduleDir, '..', '..', 'packages', 'cli', 'package.json');
  const readFile =
    (options && options.readFileSync) || ((p) => fs.readFileSync(p, 'utf8'));
  let cliPkg;
  try {
    cliPkg = JSON.parse(readFile(cliPkgPath));
  } catch {
    // Missing/unreadable manifest: return undefined so the health check fails
    // loudly. Do NOT mask this as a default version.
    return undefined;
  }
  const bunSpec = cliPkg && cliPkg.dependencies && cliPkg.dependencies.bun;
  if (typeof bunSpec !== 'string' || bunSpec.length === 0) {
    return undefined;
  }
  // The manifest must declare an EXACT version (strict X.Y.Z). A range prefix
  // (^, ~, >=, >, *) or a non-exact digit-leading spec (1.x, 1.3.14 - 2.0.0)
  // is NOT exact and must not be treated as one. Return undefined so the smoke
  // fails loudly rather than silently comparing against a stripped base.
  if (EXACT_SEMVER_RE.test(bunSpec)) {
    return bunSpec;
  }
  return undefined;
}

/**
 * The exact Bun version expected to be bundled, derived from the CLI manifest
 * ("bun" field in packages/cli/package.json). The smoke asserts the installed
 * bun.exe reports this version so a partial/incorrect install (e.g. a
 * non-Windows bun binary from a timed-out install) is caught explicitly.
 */
const EXPECTED_BUN_VERSION = resolveExpectedBunVersion();

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

// 10 minutes for a single npm install (global/local). The warmed cache makes
// this fast on a warm runner, but CI runner variance is significant: the prior
// successful global install completed in 342_875 ms, yet the smoke then failed
// twice at exactly the old 480_000 ms ceiling (ETIMEDOUT), proving 8 minutes
// was too tight. 10 minutes gives ~1.75x headroom over the observed success
// while preserving fail-fast (a genuine hang still aborts in minutes). The
// aggregate ceiling — 2 installs + 1 npm exec (900_000) + benchmark (300_000)
// — sums to 2_400_000 ms (40 min), well under the 60-minute job budget.
const INSTALL_TIMEOUT_MS = readEnvMs(
  'LLXPRT_SMOKE_INSTALL_TIMEOUT_MS',
  600_000,
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
  EXACT_SEMVER_RE,
  LAUNCH_ERROR_EXIT,
  EXPECTED_BUN_VERSION,
  resolveExpectedBunVersion,
  INSTALL_TIMEOUT_MS,
  NPM_EXEC_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  VERSION_TIMEOUT_MS,
};
