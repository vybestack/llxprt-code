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
const { npmInvocation } = require('../lib/npm-command.cjs');
const { spawnTarExtract } = require('../lib/tar-command.cjs');

/**
 * Platform-aware PATH that proves the launcher needs NO global Bun or Node.
 * On POSIX, only /usr/bin and /bin are present (intentionally excludes
 * /usr/local/bin so a globally installed bun cannot be accidentally resolved).
 * On Windows, SystemRoot-derived paths are used (via process.env.SystemRoot,
 * NOT a hardcoded C:\Windows, so non-English/non-default Windows installations
 * work correctly) so cmd.exe remains reachable for the .cmd wrapper; no global
 * Bun/Node paths are included.
 */
function constrainedPath() {
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    return [join(root, 'System32'), root, join(root, 'System32', 'Wbem')].join(
      ';',
    );
  }
  return '/usr/bin:/bin';
}

/**
 * Resolves the installed bin path for a global npm install.
 * On Windows, the wrapper is at <prefix>/llxprt.cmd (npm writes the .cmd at
 * the prefix root for global installs). On POSIX, it is at <prefix>/bin/llxprt.
 */
function resolveGlobalBin(prefix) {
  if (process.platform === 'win32') {
    return join(prefix, 'llxprt.cmd');
  }
  return join(prefix, 'bin', 'llxprt');
}

/**
 * Resolves the installed bin path for a local (non-global) npm install.
 * On Windows, the wrapper is at <consumer>/node_modules/.bin/llxprt.cmd.
 * On POSIX, it is at <consumer>/node_modules/.bin/llxprt.
 */
function resolveLocalBin(consumerDir) {
  const base = join(consumerDir, 'node_modules', '.bin', 'llxprt');
  return process.platform === 'win32' ? base + '.cmd' : base;
}

/**
 * Returns {command, baseArgs} for invoking a resolved bin path. The caller
 * appends additional args (e.g. --version) to baseArgs. On Windows, .cmd
 * files cannot be spawned directly (EINVAL/ENOENT), so cmd.exe /c is used
 * with the wrapper path as the first argument — argv boundaries are preserved
 * (no shell string). On POSIX, the shebanged launcher is exec'd directly.
 */
function resolveBinInvocation(binPath) {
  if (process.platform === 'win32') {
    return { command: 'cmd', baseArgs: ['/c', binPath] };
  }
  return { command: binPath, baseArgs: [] };
}

const repoRoot = resolve(process.argv[2] || process.cwd());
// Validate repoRoot early so an invalid path produces a clear error instead of
// a confusing failure deep inside packReleaseLikeCli.
if (!existsSync(join(repoRoot, 'package.json'))) {
  console.error(`Invalid repo root (no package.json found): ${repoRoot}`);
  process.exit(1);
}
if (!existsSync(join(repoRoot, 'packages', 'cli', 'package.json'))) {
  console.error(
    `Invalid repo root (no packages/cli/package.json found): ${repoRoot}`,
  );
  process.exit(1);
}
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

// Shared list of non-NPM release packages, imported from a single .cjs source
// so the test stays in sync with release-pack.cjs without manual duplication.
const {
  NON_NPM_RELEASE_PACKAGES,
} = require('../lib/non-npm-release-packages.cjs');

function assertExactVersions(deps) {
  if (!deps) return;
  for (const [name, spec] of Object.entries(deps)) {
    if (
      typeof spec === 'string' &&
      (spec.startsWith('file:') ||
        spec.startsWith('workspace:') ||
        spec.startsWith('link:'))
    ) {
      // Non-NPM internal packages (test-utils, a2a-server, vscode-companion)
      // are intentionally left as file: refs by bind-release-deps because
      // they are never published to the registry. They are resolved by the
      // real release pipeline at publish time, so a file: spec here is not a
      // release-integrity violation.
      if (NON_NPM_RELEASE_PACKAGES.has(name)) continue;
      throw new Error(`release manifest has non-exact dep ${name}="${spec}"`);
    }
  }
}

/**
 * Assert the release manifest has no non-exact deps in ANY dependency field:
 * dependencies, devDependencies, optionalDependencies, and peerDependencies. A
 * release artifact with a file:/workspace:/link: spec in any of these fields
 * would fail in an isolated install, so all four are validated.
 */
function assertReleaseManifestAllFields(pkgJson) {
  assertExactVersions(pkgJson.dependencies);
  assertExactVersions(pkgJson.devDependencies);
  assertExactVersions(pkgJson.optionalDependencies);
  assertExactVersions(pkgJson.peerDependencies);
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
 * Spawns tar extract with spawn-error diagnostics via the shared tar-command
 * helper.
 */
function spawnTarExtractLocal(tarball, extractDir) {
  return spawnTarExtract(tarball, extractDir);
}

// Track tempDir at module scope so signal handlers can clean up even if main
// has not yet reached the finally block.
let _cleanupTempDir = null;

function _signalCleanup() {
  if (_cleanupTempDir) {
    safeCleanup(_cleanupTempDir);
  }
  process.exit(130);
}

process.on('SIGINT', _signalCleanup);
process.on('SIGTERM', _signalCleanup);

function main() {
  let tempDir;
  _cleanupTempDir = null;
  try {
    const { packReleaseLikeCli } = require(releasePackHelperPath);
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
    _cleanupTempDir = tempDir;

    // 1. Release artifact manifest integrity: exact versions, no file:/link:.
    runStep('release-manifest-integrity', () => {
      const extractDir = mkdtempSync(join(tmpdir(), 'llxprt-tarball-check-'));
      try {
        spawnTarExtractLocal(releaseTarball, extractDir);
        const pkgJson = JSON.parse(
          readFileSync(join(extractDir, 'package', 'package.json'), 'utf8'),
        );
        assertReleaseManifestAllFields(pkgJson);
      } finally {
        safeCleanup(extractDir);
      }
    });

    // 2. Global install of replica runs --version and exits 0.
    runStep('global-install-version', () => {
      const prefix = join(tempDir, 'global-prefix');
      mkdirSync(prefix, { recursive: true });
      const { command, args } = npmInvocation([
        'install',
        '--global',
        '--prefix',
        prefix,
        '--cache',
        join(tempDir, 'npm-cache'),
        '--loglevel',
        'error',
        replicaTarball,
      ]);
      const installResult = spawnSync(command, args, {
        encoding: 'utf8',
        timeout: 180_000,
        maxBuffer: 64 * 1024 * 1024,
      });
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
      const binLink = resolveGlobalBin(prefix);
      assert(existsSync(binLink), `global bin link not found: ${binLink}`);
      const binInv = resolveBinInvocation(binLink);
      const result = spawnSync(
        binInv.command,
        [...binInv.baseArgs, '--version'],
        {
          encoding: 'utf8',
          timeout: 30_000,
          // The launcher resolves its own package-local Bun, so it must NOT
          // need a global Bun or Node on PATH. The constrained PATH proves
          // this invariant: if the launcher accidentally relied on a global
          // Bun/Node, it would fail here. On Windows, cmd.exe (in System32)
          // must remain reachable for the .cmd wrapper.
          env: { ...process.env, PATH: constrainedPath() },
        },
      );
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
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
          result.stdout.trim(),
        ),
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
      const { command, args } = npmInvocation([
        'install',
        '--cache',
        join(tempDir, 'npm-cache-local'),
        '--loglevel',
        'error',
        replicaTarball,
      ]);
      const installResult = spawnSync(command, args, {
        cwd: consumerDir,
        encoding: 'utf8',
        timeout: 180_000,
        maxBuffer: 64 * 1024 * 1024,
      });
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
      const binLink = resolveLocalBin(consumerDir);
      assert(existsSync(binLink), `local bin link not found: ${binLink}`);
      const binInv = resolveBinInvocation(binLink);
      const result = spawnSync(
        binInv.command,
        [...binInv.baseArgs, '--version'],
        {
          encoding: 'utf8',
          timeout: 30_000,
          cwd: consumerDir,
          // Constrained PATH proves the launcher needs no global Bun/Node.
          env: { ...process.env, PATH: constrainedPath() },
        },
      );
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
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
          result.stdout.trim(),
        ),
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
      const { command, args } = npmInvocation([
        'exec',
        '--package',
        replicaTarball,
        '--',
        'llxprt',
        '--version',
      ]);
      const result = spawnSync(command, args, {
        cwd: cleanDir,
        encoding: 'utf8',
        timeout: 300_000,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, npm_config_cache: npmCache },
      });
      if (result.error) {
        throw new Error(`npm exec spawn failed: ${result.error.message}`);
      }
      if (result.status !== 0) {
        throw new Error(
          `npm exec --version failed (exit ${result.status}, signal=${result.signal ?? 'none'}): ${result.stderr || result.stdout}`,
        );
      }
      assert(
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
          result.stdout.trim(),
        ),
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
