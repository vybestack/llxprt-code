'use strict';

/**
 * Standalone release-install smoke for issue #2603.
 *
 * This script is intentionally OUTSIDE the Vitest worker because the release
 * pack + npm install sequence is long-running and blocks the event loop, which
 * starves Vitest's worker RPC heartbeat (onTaskUpdate) and causes an unhandled
 * timeout error. By running as a detached child process, the Vitest test stays
 * async and the event loop is free to answer RPC pings.
 *
 * The script:
 *   1. Packs a release-like CLI tarball (exact-version manifest) and a separate
 *      offline-installable replica (local tarball refs) via the shared helper.
 *   2. Installs the replica globally into an isolated prefix and locally into a
 *      consumer project, then runs `--version` in each.
 *   3. Extracts the release artifact and asserts its manifest has exact-version
 *      internal deps (no file:/workspace:/link:).
 *
 * Exit code 0 = all assertions passed. Non-zero = failure (with diagnostics on
 * stderr). Output is also printed to stdout for the test to capture.
 *
 * Usage: node scripts/tests/issue-2603-release-install-smoke.cjs [repoRoot]
 */

const { spawnSync } = require('node:child_process');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { createRequire } = require('node:module');

const repoRoot = resolve(process.argv[2] || process.cwd());
const nodeRequire = createRequire(__filename);
const releasePackHelperPath = join(
  repoRoot,
  'scripts',
  'tests',
  'issue-2603-release-pack.cjs',
);

let failed = false;
const failures = [];

function fail(msg) {
  failed = true;
  failures.push(msg);
  console.error('FAIL: ' + msg);
}

function assert(condition, msg) {
  if (!condition) {
    fail(msg);
  }
  return condition;
}

function assertExactVersions(deps) {
  if (!deps) return;
  for (const [name, spec] of Object.entries(deps)) {
    if (
      typeof spec === 'string' &&
      (spec.startsWith('file:') ||
        spec.startsWith('workspace:') ||
        spec.startsWith('link:'))
    ) {
      throw new Error(`release manifest has non-exact dep ${name}="${spec}"`);
    }
  }
}

function runStep(label, fn) {
  process.stdout.write(`[${label}] starting...\n`);
  try {
    fn();
    process.stdout.write(`[${label}] OK\n`);
  } catch (err) {
    fail(`${label}: ${err.message}`);
  }
}

/**
 * Robustly removes a temp dir, swallowing cleanup errors so they never mask a
 * test failure summary. Cleanup failures are logged to stderr as warnings.
 */
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
 * Spawns tar extract with spawn-error diagnostics. GitHub Windows runners
 * ship bsdtar, but a spawn failure (ENOENT) must produce a clear diagnostic
 * rather than an opaque null status.
 */
function spawnTarExtract(tarball, extractDir) {
  const result = spawnSync('tar', ['-xzf', tarball, '-C', extractDir], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) {
    throw new Error(
      `Failed to spawn tar (is it on PATH? GitHub Windows has bsdtar): ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `tar extract failed (exit ${result.status}, signal=${result.signal ?? 'none'}): ${result.stderr}`,
    );
  }
  return result;
}

function main() {
  let tempDir;
  try {
    const { packReleaseLikeCli } = nodeRequire(releasePackHelperPath);
    const { releaseTarball, replicaTarball } = packReleaseLikeCli(repoRoot);

    assert(
      existsSync(releaseTarball),
      `release tarball not found: ${releaseTarball}`,
    );
    assert(
      existsSync(replicaTarball),
      `replica tarball not found: ${replicaTarball}`,
    );
    process.stdout.write(
      `release=${releaseTarball}\nreplica=${replicaTarball}\n`,
    );

    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-2603-smoke-'));

    // 1. Release artifact manifest integrity: exact versions, no file:/link:.
    runStep('release-manifest-integrity', () => {
      const extractDir = mkdtempSync(join(tmpdir(), 'llxprt-tarball-check-'));
      try {
        spawnTarExtract(releaseTarball, extractDir);
        const pkgJson = JSON.parse(
          readFileSync(join(extractDir, 'package', 'package.json'), 'utf8'),
        );
        assertExactVersions(pkgJson.dependencies);
      } finally {
        safeCleanup(extractDir);
      }
    });

    // 2. Global install of replica runs --version and exits 0.
    runStep('global-install-version', () => {
      const prefix = join(tempDir, 'global-prefix');
      mkdirSync(prefix, { recursive: true });
      const installResult = spawnSync(
        'npm',
        [
          'install',
          '--global',
          '--prefix',
          prefix,
          '--cache',
          join(tempDir, 'npm-cache'),
          '--loglevel',
          'error',
          replicaTarball,
        ],
        {
          encoding: 'utf8',
          timeout: 180_000,
          maxBuffer: 64 * 1024 * 1024,
        },
      );
      if (installResult.error) {
        throw new Error(
          `global npm install spawn failed: ${installResult.error.message}`,
        );
      }
      if (installResult.status !== 0) {
        throw new Error(
          `global npm install failed (exit ${installResult.status}, signal=${installResult.signal ?? 'none'}): ${installResult.stderr || installResult.stdout}`,
        );
      }
      const binLink = join(prefix, 'bin', 'llxprt');
      assert(existsSync(binLink), `global bin link not found: ${binLink}`);
      const result = spawnSync(binLink, ['--version'], {
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      });
      if (result.error) {
        throw new Error(
          `global --version spawn failed: ${result.error.message}`,
        );
      }
      if (result.status !== 0) {
        throw new Error(
          `global --version exited ${result.status}: ${result.stderr}`,
        );
      }
      assert(
        /^\d+\.\d+\.\d+/.test(result.stdout.trim()),
        `global --version output unexpected: ${result.stdout}`,
      );
    });

    // 3. Local install of replica runs --version and exits 0.
    runStep('local-install-version', () => {
      const consumerDir = join(tempDir, 'consumer');
      mkdirSync(consumerDir, { recursive: true });
      writeFileSync(
        join(consumerDir, 'package.json'),
        JSON.stringify({ name: 'consumer', version: '0.0.0' }, null, 2),
      );
      const installResult = spawnSync(
        'npm',
        [
          'install',
          '--cache',
          join(tempDir, 'npm-cache-local'),
          '--loglevel',
          'error',
          replicaTarball,
        ],
        {
          cwd: consumerDir,
          encoding: 'utf8',
          timeout: 180_000,
          maxBuffer: 64 * 1024 * 1024,
        },
      );
      if (installResult.error) {
        throw new Error(
          `local npm install spawn failed: ${installResult.error.message}`,
        );
      }
      if (installResult.status !== 0) {
        throw new Error(
          `local npm install failed (exit ${installResult.status}, signal=${installResult.signal ?? 'none'}): ${installResult.stderr || installResult.stdout}`,
        );
      }
      const binLink = join(consumerDir, 'node_modules', '.bin', 'llxprt');
      assert(existsSync(binLink), `local bin link not found: ${binLink}`);
      const result = spawnSync(binLink, ['--version'], {
        encoding: 'utf8',
        timeout: 30_000,
        cwd: consumerDir,
        env: { ...process.env, PATH: '/usr/bin:/bin' },
      });
      if (result.error) {
        throw new Error(
          `local --version spawn failed: ${result.error.message}`,
        );
      }
      if (result.status !== 0) {
        throw new Error(
          `local --version exited ${result.status}: ${result.stderr}`,
        );
      }
      assert(
        /^\d+\.\d+\.\d+/.test(result.stdout.trim()),
        `local --version output unexpected: ${result.stdout}`,
      );
    });

    // 4. ACTUAL ephemeral npm exec install: a CLEAN directory with NO local
    // dependency, using `npm exec --package <replica-tarball> -- llxprt
    // --version`. npm installs the package into the npx cache (running the
    // postinstall lifecycle, which replaces the Windows wrappers on win32)
    // and runs the bin, then leaves the clean dir with no node_modules. This
    // is the real ephemeral install path — NOT `npx llxprt` against an
    // already-local-installed bin, which would only exercise the local .bin
    // link. We use a separate clean cache so the cache install is genuine.
    runStep('npm-exec-ephemeral', () => {
      const cleanDir = join(tempDir, 'npm-exec-clean');
      mkdirSync(cleanDir, { recursive: true });
      writeFileSync(
        join(cleanDir, 'package.json'),
        JSON.stringify({ name: 'clean-consumer', version: '0.0.0' }, null, 2),
      );
      const npmCache = join(tempDir, 'npm-exec-cache');
      const result = spawnSync(
        'npm',
        ['exec', '--package', replicaTarball, '--', 'llxprt', '--version'],
        {
          cwd: cleanDir,
          encoding: 'utf8',
          timeout: 300_000,
          maxBuffer: 64 * 1024 * 1024,
          env: { ...process.env, npm_config_cache: npmCache },
        },
      );
      if (result.error) {
        throw new Error(`npm exec spawn failed: ${result.error.message}`);
      }
      if (result.status !== 0) {
        throw new Error(
          `npm exec --version failed (exit ${result.status}, signal=${result.signal ?? 'none'}): ${result.stderr || result.stdout}`,
        );
      }
      assert(
        /^\d+\.\d+\.\d+/.test(result.stdout.trim()),
        `npm exec --version unexpected output: ${result.stdout}`,
      );
      // The clean dir must NOT have been polluted with a local install —
      // the install must have gone to the npx cache only.
      assert(
        !existsSync(join(cleanDir, 'node_modules')),
        `npm exec polluted the clean dir with node_modules — must be ephemeral`,
      );
    });
  } catch (err) {
    fail(`unexpected error: ${err.stack || err.message}`);
  } finally {
    // Cleanup errors must not mask the test failure summary. safeCleanup
    // logs warnings but never throws.
    safeCleanup(tempDir);
  }

  if (failed) {
    console.error(`\n${failures.length} failure(s):\n`);
    for (const f of failures) {
      console.error('  - ' + f);
    }
    process.exit(1);
  }
  console.log('\nAll release-install smoke assertions passed.');
}

main();
