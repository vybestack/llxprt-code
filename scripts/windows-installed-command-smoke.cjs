'use strict';

/**
 * Hosted Windows behavioral smoke for issue #2603.
 *
 * Runs only on Windows (invoked by the windows-installed-command workflow). It
 * exercises the ACTUAL generated .cmd/.ps1 launchers and the ACTUAL bundled
 * bun.exe (installed as a real dependency), not stubs.
 *
 * This file is the single top-level orchestrator. The behavioral checks, npm
 * install helpers, process-tree inspection, and launcher invocation helpers
 * live in cohesive modules under scripts/windows-installed-command-smoke/.
 * This preserves the single process/workflow entry point while keeping each
 * module focused and under the max-lines limit.
 *
 * The harness:
 *   1. Packs a release-like CLI replica tarball via the shared release-pack
 *      helper (same one POSIX tests use).
 *   2. Installs the replica globally and locally.
 *   3. Creates a TEMP installed-package fixture whose index.ts is replaced
 *      with an instrumented probe.
 *   4. Invokes both launchers through the real cmd and PowerShell, asserting
 *      args, stdio, exit codes, execPath, and the process tree.
 *   5. Tests missing-Bun and corrupt-Bun error contracts.
 *   6. Tests actual ephemeral `npm exec --package <tarball> -- llxprt`.
 *   7. Tests package-local bun.exe presence.
 *
 * This is a Node script so the test driver does not depend on a pre-installed
 * Bun. The release-pack helper invokes Bun for bind-release-deps, so Bun must
 * be set up in the workflow before this runs.
 */

const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { createRequire } = require('node:module');

const isWindows = process.platform === 'win32';
const repoRoot = resolve(process.argv[2] || process.cwd());
const nodeRequire = createRequire(__filename);
const releasePackHelperPath = join(
  repoRoot,
  'scripts',
  'tests',
  'issue-2603-release-pack.cjs',
);

const smokeDir = join(repoRoot, 'scripts', 'windows-installed-command-smoke');
const assertModule = nodeRequire(join(smokeDir, 'assert.cjs'));
const { getState, resetState, assert, fail } = assertModule;
const { findInstalledPackageRoot, findBundledBun } = nodeRequire(
  join(smokeDir, 'package-layout.cjs'),
);
const checks = nodeRequire(join(smokeDir, 'checks.cjs'));
const {
  globalInstall,
  localInstall,
  checkLocalCmdVersion,
  checkPackageLocalBun,
} = nodeRequire(join(smokeDir, 'install-helpers.cjs'));

function safeCleanup(tempDir) {
  if (!tempDir) return;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch (e) {
    console.error(
      `Warning: cleanup of ${tempDir} failed (test result is still valid): ${e.message}`,
    );
  }
}

function runSmoke() {
  resetState();
  let tempDir;
  let succeeded = false;
  return (async () => {
    try {
      const { packReleaseLikeCli } = nodeRequire(releasePackHelperPath);
      const { replicaTarball } = packReleaseLikeCli(repoRoot);

      assert(
        existsSync(replicaTarball),
        `replica tarball not found: ${replicaTarball}`,
      );
      process.stdout.write(`replica=${replicaTarball}\n`);

      tempDir = mkdtempSync(join(tmpdir(), 'llxprt-win-smoke-'));
      const prefix = globalInstall(tempDir, replicaTarball);

      checks.checkLauncherSentinels(prefix);
      checks.checkVersionRuns(prefix);

      const installedPackageRoot = findInstalledPackageRoot(prefix);

      const probeFixture = checks.buildProbeFixture(
        installedPackageRoot,
        tempDir,
        'main',
        repoRoot,
      );

      checks.checkCmdArgFidelity(probeFixture);
      checks.checkPwshArgFidelity(probeFixture);
      checks.checkInjectionGuard(probeFixture, tempDir);
      checks.checkStdioForwarding(probeFixture);
      checks.checkCmdExitCodePreservation(probeFixture);
      checks.checkPwshExitPropagation(probeFixture);
      checks.checkExecPathIsBundledBun(probeFixture);
      await checks.checkProcessTreeNoNode(probeFixture);

      checks.checkMissingBun({ installedPackageRoot }, tempDir, repoRoot);
      checks.checkCorruptBun({ installedPackageRoot }, tempDir, repoRoot);

      checks.checkNpmExecEphemeral(tempDir, replicaTarball);

      const consumerDir = localInstall(tempDir, replicaTarball);
      checkLocalCmdVersion(consumerDir);
      checkPackageLocalBun(prefix, findInstalledPackageRoot, findBundledBun);
      succeeded = true;
    } catch (err) {
      fail(`unexpected error: ${err.stack || err.message}`);
    } finally {
      // Preserve the temp fixture on failure for debugging (print its path so
      // CI logs show where to inspect). Clean up on success to avoid CI disk
      // pressure.
      if (succeeded) {
        safeCleanup(tempDir);
      } else if (tempDir) {
        console.error(
          `\nTemp fixture preserved for debugging at:\n  ${tempDir}\n`,
        );
      }
    }
  })();
}

function reportAndExit() {
  const { failed, failures } = getState();
  if (failed) {
    console.error(`\n${failures.length} failure(s):\n`);
    for (const f of failures) {
      console.error('  - ' + f);
    }
    process.exit(1);
  }
  console.log('\nAll Windows installed-command smoke assertions passed.');
}

if (!isWindows) {
  console.log('Skipping Windows smoke on non-Windows platform.');
  process.exit(0);
}

runSmoke()
  .then(() => {
    reportAndExit();
  })
  .catch((err) => {
    fail(`runSmoke rejected unexpectedly: ${err.stack || err.message}`);
    reportAndExit();
  });
