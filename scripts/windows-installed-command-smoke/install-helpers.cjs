'use strict';

/**
 * npm install helpers for the Windows smoke: global install, local install,
 * and local cmd version verification. These are separated from the behavioral
 * checks so the install lifecycle can be reused independently.
 *
 * Cache policy (root cause A, CI run 29850614559):
 *   Previous versions passed `--cache <empty temp dir>` to each install,
 *   creating a per-fixture ISOLATED EMPTY cache. That forced every install to
 *   re-fetch from the registry, blowing through the synchronous 180s timeout
 *   and producing ETIMEDOUT cascades. The workflow already warms the standard
 *   npm cache via `npm ci`. We now OMIT `--cache` so installs inherit the
 *   warmed default cache, making them fast and reliable.
 *
 * Fail-fast (root cause G):
 *   globalInstall and localInstall are REQUIRED setup steps. A failure must
 *   abort dependent checks, not cascade into dozens of "launcher not found"
 *   failures. They use runRequiredStep (rethrows) instead of runStep.
 */

const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const { assert, runStep, runRequiredStep } = require('./assert.cjs');
const {
  INSTALL_TIMEOUT_MS,
  VERSION_TIMEOUT_MS,
  EXPECTED_BUN_VERSION,
} = require('./constants.cjs');
const { npmInvocation } = require('../lib/npm-command.cjs');
const { assertBundledBunHealthy } = require('./bun-validation.cjs');
const { invokeCmd } = require('./launcher-invocation.cjs');

// Shared maxBuffer for npm install/exec captures. npm/tar can emit verbose
// output that exceeds Node's 1MB default; a single shared constant keeps this
// consistent across globalInstall, localInstall, and the checks.cjs npm exec
// helper.
const SPAWN_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Builds the npm install argument list WITHOUT an explicit `--cache` flag so
 * the install inherits the warmed default npm cache (the same one `npm ci`
 * populated in the workflow). An empty isolated per-fixture cache forced
 * re-fetches and caused the ETIMEDOUT cascades seen in CI run 29850614559.
 *
 * @param {string[]} extraArgs - install arguments to prepend (e.g. global
 *   prefix flags and the tarball path).
 * @returns {string[]} the full argument list for npm install.
 * @throws {TypeError} when extraArgs is not an array.
 */
function buildInstallArgs(extraArgs) {
  if (!Array.isArray(extraArgs)) {
    throw new TypeError(
      `buildInstallArgs: extraArgs must be an array (got ${typeof extraArgs})`,
    );
  }
  return ['install', ...extraArgs, '--loglevel', 'error'];
}

function globalInstall(tempDir, replicaTarball) {
  let prefix;
  // REQUIRED: a global-install failure must abort the entire smoke, not
  // cascade into 30 downstream "launcher not found" failures.
  runRequiredStep('global-install', () => {
    prefix = join(tempDir, 'global-prefix');
    mkdirSync(prefix, { recursive: true });
    // No --cache: inherit the warmed default npm cache populated by `npm ci`.
    const { command, args } = npmInvocation(
      buildInstallArgs(['--global', '--prefix', prefix, replicaTarball]),
    );
    const r = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: SPAWN_MAX_BUFFER,
    });
    if (r.error) {
      throw new Error(`npm global install spawn failed: ${r.error.message}`);
    }
    if (r.signal) {
      throw new Error(`npm global install terminated by signal ${r.signal}`);
    }
    if (r.status !== 0) {
      throw new Error(
        `npm global install failed (exit ${r.status}): ${r.stderr || r.stdout}`,
      );
    }
  });
  return prefix;
}

function localInstall(tempDir, replicaTarball) {
  let consumerDir;
  // REQUIRED: a local-install failure is a setup failure for
  // local-cmd-version; it must not silently continue.
  runRequiredStep('local-install', () => {
    consumerDir = join(tempDir, 'consumer');
    mkdirSync(consumerDir, { recursive: true });
    writeFileSync(
      join(consumerDir, 'package.json'),
      JSON.stringify({ name: 'consumer', version: '0.0.0' }, null, 2),
    );
    // No --cache: inherit the warmed default npm cache.
    const { command, args } = npmInvocation(buildInstallArgs([replicaTarball]));
    const r = spawnSync(command, args, {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: SPAWN_MAX_BUFFER,
    });
    if (r.error) {
      throw new Error(`npm local install spawn failed: ${r.error.message}`);
    }
    if (r.signal) {
      throw new Error(`npm local install terminated by signal ${r.signal}`);
    }
    if (r.status !== 0) {
      throw new Error(
        `npm local install failed (exit ${r.status}): ${r.stderr || r.stdout}`,
      );
    }
  });
  return consumerDir;
}

function checkLocalCmdVersion(consumerDir) {
  runStep('local-cmd-version', () => {
    const cmdPath = join(consumerDir, 'node_modules', '.bin', 'llxprt.cmd');
    assert(existsSync(cmdPath), `local cmd launcher not found: ${cmdPath}`);
    // Use the shared invokeCmd helper which applies the proven cmd.exe /d /s /c
    // + windowsVerbatimArguments construction with proper quoting (cmdQuote).
    // The previous quote-only approach did not use the /d /s /c verbatim
    // quoting and could split paths with spaces. invokeCmd also provides
    // consistent spawn-error diagnostics via validateSpawnResult.
    const r = invokeCmd(cmdPath, ['--version'], {
      timeout: VERSION_TIMEOUT_MS,
    });
    // validateSpawnResult (inside invokeCmd) already covers r.error and
    // r.signal. A nonzero exit status is a legitimate child exit that the
    // caller interprets here.
    if (r.status !== 0) {
      throw new Error(
        `local cmd --version exited ${r.status}: ${r.stderr || r.stdout}`,
      );
    }
  });
}

function checkPackageLocalBun(
  prefix,
  findInstalledPackageRoot,
  findBundledBun,
) {
  runStep('package-local-bun-exists', () => {
    const packageRoot = findInstalledPackageRoot(prefix);
    if (!packageRoot || typeof packageRoot !== 'string') {
      throw new Error(
        `findInstalledPackageRoot returned an invalid path: ${JSON.stringify(packageRoot)}`,
      );
    }
    const bunExe = findBundledBun(packageRoot);
    if (!bunExe || typeof bunExe !== 'string') {
      throw new Error(
        `findBundledBun returned an invalid path: ${JSON.stringify(bunExe)}`,
      );
    }
    assert(existsSync(bunExe), `package-local bun.exe not found: ${bunExe}`);
    // Verify the globally-installed bun.exe is a real Windows PE binary
    // reporting the exact expected version (root cause J). This catches a
    // partial/timed-out install that left a non-Windows or wrong-version binary.
    assertBundledBunHealthy(bunExe, EXPECTED_BUN_VERSION);
  });
}

module.exports = {
  globalInstall,
  localInstall,
  checkLocalCmdVersion,
  checkPackageLocalBun,
  SPAWN_MAX_BUFFER,
  buildInstallArgs,
};
