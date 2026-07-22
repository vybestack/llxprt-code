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
 *   2. Installs the replica globally and locally (REQUIRED setup: a failure
 *      aborts dependent checks via runRequiredStep — no cascade).
 *   3. Creates a TEMP installed-package fixture whose index.ts is replaced
 *      with an instrumented probe. The copied bun.exe is validated (PE magic +
 *      exact version) BEFORE the fixture is used.
 *   4. Invokes both launchers through the real cmd and PowerShell, asserting
 *      args, stdio, exit codes, execPath, and the process tree.
 *   5. Tests missing-Bun and corrupt-Bun error contracts.
 *   6. Tests actual ephemeral `npm exec --package <tarball> -- llxprt`.
 *   7. Tests package-local bun.exe presence and PE/version integrity.
 *   8. After all behavioral checks pass, runs the startup benchmark as a
 *      child process using the INSTALLED launcher + platform bun (no separate
 *      reinstall/repack) before cleanup, so the workflow needs only one step.
 *
 * Benchmark handoff (root cause E):
 *   On success, before cleanup, this process writes the installed paths
 *   (launcher, packageRoot, bun.exe) to a stable diagnostic JSON under
 *   RUNNER_TEMP and invokes the benchmark child with LLXPRT_BENCH_LAUNCHER /
 *   LLXPRT_BENCH_BUN env vars so it does not repack/reinstall.
 *
 * Diagnostics on failure (root cause I):
 *   On failure a small diagnostic JSON (no node_modules) is written next to
 *   the temp dir so the workflow can upload it as an artifact. The large temp
 *   fixture itself lives in the hosted runner temp which vanishes post-job.
 *
 * This is a Node script so the test driver does not depend on a pre-installed
 * Bun. The release-pack helper invokes Bun for bind-release-deps, so Bun must
 * be set up in the workflow before this runs.
 */

const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
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

/**
 * Writes a small diagnostic JSON (no node_modules) capturing the smoke result
 * and key paths. GitHub hosted runner temp vanishes after the job, so this
 * small artifact is what the workflow can upload via `actions/upload-artifact`
 * on failure for offline debugging. Kept tiny on purpose (no giant dirs).
 */
function writeDiagnostic(status, details) {
  const diagDir = process.env.RUNNER_TEMP || tmpdir();
  const diagPath = join(
    diagDir,
    `llxprt-win-smoke-diagnostic-${process.pid}.json`,
  );
  try {
    const { failed, failures } = getState();
    writeFileSync(
      diagPath,
      JSON.stringify(
        {
          status,
          pid: process.pid,
          platform: process.platform,
          timestamp: new Date().toISOString(),
          failed,
          failures,
          ...details,
        },
        null,
        2,
      ),
    );
    process.stdout.write(`diagnostic=${diagPath}\n`);
  } catch (e) {
    console.error(`Warning: could not write diagnostic JSON: ${e.message}`);
  }
}

/**
 * Runs the startup benchmark as a CHILD process, pointing it at the already
 * installed launcher and platform bun via env vars so it does NOT repack or
 * reinstall (root cause E). Invoked before cleanup so the fixture is still
 * present. Failures here are reported but do NOT fail the smoke (the benchmark
 * is a measurement tool with no threshold gate).
 *
 * @param {string} cmdLauncher - absolute path to the installed llxprt.cmd
 * @param {string} bunExe - absolute path to the platform bun.exe
 */
function runBenchmarkChild(cmdLauncher, bunExe, entry) {
  const benchScript = join(
    repoRoot,
    'scripts',
    'tests',
    'issue-2603-startup-benchmark.cjs',
  );
  if (!existsSync(benchScript)) {
    console.error(`benchmark step skipped: script not found at ${benchScript}`);
    return;
  }
  process.stdout.write('[benchmark] starting...\n');
  const r = spawnSync(process.execPath, [benchScript, repoRoot, '15'], {
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      LLXPRT_BENCH_LAUNCHER: cmdLauncher,
      LLXPRT_BENCH_BUN: bunExe,
      LLXPRT_BENCH_ENTRY: entry,
    },
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) {
    console.error(`[benchmark] spawn failed: ${r.error.message}`);
    return;
  }
  if (r.signal) {
    console.error(`[benchmark] terminated by signal ${r.signal}`);
    return;
  }
  if (r.status !== 0) {
    console.error(`[benchmark] exited ${r.status} (non-fatal)`);
    return;
  }
  process.stdout.write('[benchmark] OK\n');
}

function runInstalledBenchmark({
  succeeded,
  cmdLauncher,
  bunExe,
  installedPackageRoot,
}) {
  if (!succeeded || !cmdLauncher || !bunExe || !installedPackageRoot) {
    return;
  }
  if (!existsSync(cmdLauncher)) {
    return;
  }
  runBenchmarkChild(
    cmdLauncher,
    bunExe,
    join(installedPackageRoot, 'index.ts'),
  );
}

/**
 * Runs all behavioral checks (argv, stdio, exit codes, process tree, missing/
 * corrupt Bun, npm exec) on the installed launcher fixture. Extracted from
 * runSmoke to keep it under the max-lines-per-function lint limit.
 */
function runBehavioralChecks(ctx) {
  const { probeFixture, tempDir, installedPackageRoot, replicaTarball } = ctx;
  checks.checkCmdArgFidelity(probeFixture);
  checks.checkPwshArgFidelity(probeFixture);
  checks.checkInjectionGuard(probeFixture, tempDir);
  checks.checkStdioForwarding(probeFixture);
  checks.checkCmdExitCodePreservation(probeFixture);
  checks.checkPwshExitPropagation(probeFixture);
  checks.checkExecPathIsBundledBun(probeFixture);
  checks.checkMissingBun({ installedPackageRoot }, tempDir, repoRoot);
  checks.checkCorruptBun({ installedPackageRoot }, tempDir, repoRoot);
  checks.checkNpmExecEphemeral(tempDir, replicaTarball);
}

function runSmoke() {
  resetState();
  let tempDir;
  let succeeded = false;
  let cmdLauncher;
  let bunExe;
  let installedPackageRoot;
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

      installedPackageRoot = findInstalledPackageRoot(prefix);
      bunExe = findBundledBun(installedPackageRoot);
      cmdLauncher = join(prefix, 'llxprt.cmd');

      const probeFixture = checks.buildProbeFixture(
        installedPackageRoot,
        tempDir,
        'main',
        repoRoot,
      );

      runBehavioralChecks({
        probeFixture,
        tempDir,
        installedPackageRoot,
        replicaTarball,
      });
      await checks.checkProcessTreeNoNode(probeFixture);

      const consumerDir = localInstall(tempDir, replicaTarball);
      checkLocalCmdVersion(consumerDir);
      checkPackageLocalBun(prefix, findInstalledPackageRoot, findBundledBun);
      // Gate succeeded on the assertion state so a runStep failure (which
      // records via fail() without throwing) is not masked as success.
      // Without this guard, a local-cmd-version or package-local-bun failure
      // would write a success diagnostic, run the benchmark, and delete the
      // temp fixture that the failure diagnostic says to preserve.
      const { failed } = getState();
      if (failed) {
        throw new Error(
          'prerequisite checks failed (local-cmd-version or package-local-bun); aborting before success',
        );
      }
      succeeded = true;
    } catch (err) {
      fail(`unexpected error: ${err.stack || err.message}`);
    } finally {
      runInstalledBenchmark({
        succeeded,
        cmdLauncher,
        bunExe,
        installedPackageRoot,
      });
      if (succeeded) {
        writeDiagnostic('success', {
          cmdLauncher,
          bunExe,
          tempDir,
        });
        safeCleanup(tempDir);
      } else {
        writeDiagnostic('failure', {
          tempDir: tempDir || null,
          cmdLauncher: cmdLauncher || null,
          bunExe: bunExe || null,
        });
        if (tempDir) {
          console.error(
            `\nTemp fixture preserved for debugging at:\n  ${tempDir}\n` +
              `(Hosted runner temp vanishes post-job; the diagnostic JSON ` +
              `above should be uploaded as an artifact by the workflow.)\n`,
          );
        }
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
    // Normalize non-Error rejections so the message extraction never throws.
    let detail;
    if (err && typeof err === 'object' && typeof err.stack === 'string') {
      detail = err.stack;
    } else if (
      err &&
      typeof err === 'object' &&
      typeof err.message === 'string'
    ) {
      detail = err.message;
    } else {
      detail = String(err);
    }
    fail(`runSmoke rejected unexpectedly: ${detail}`);
    reportAndExit();
  });
