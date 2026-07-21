'use strict';

/**
 * Release-like CLI pack helper for issue #2603 offline install tests.
 *
 * The raw workspace tarball has `file:` internal deps that fail in an isolated
 * install. This helper produces TWO distinct artifacts from a temporary repo
 * copy (the real repo is never mutated):
 *
 *  1. RELEASE ARTIFACT (integrity): the CLI tarball after `bind-release-deps`
 *     rewrites every `file:`/`workspace:` internal dep to an exact version
 *     range. Its manifest is asserted to have NO `file:`/`workspace:`/`link:`
 *     deps and to contain the required assets (launcher, installer, entry,
 *     README, LICENSE). This is the release-faithful manifest shape.
 *
 *  2. LOCAL-INSTALL REPLICA: a separate, offline-installable variant where the
 *     CLI's exact-version internal deps are repointed at packed local tarballs
 *     so `npm install` succeeds without network/registry access. This is a
 *     test transport, NOT the release artifact — the release artifact above is
 *     the integrity reference.
 *
 * Both are cached in a temp dir and reused across test runs.
 */

const { spawnSync } = require('node:child_process');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
  cpSync,
  copyFileSync,
} = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { npmInvocation } = require('../lib/npm-command.cjs');

/**
 * Derive the cache dir, filename, and version from the CLI manifest so the
 * cache key tracks the actual published version. A stale hardcoded name would
 * serve a wrong-version artifact after a version bump.
 */
function readCliManifest(repoRoot) {
  const cliPkgPath = join(repoRoot, 'packages', 'cli', 'package.json');
  const cliPkg = JSON.parse(readFileSync(cliPkgPath, 'utf8'));
  const version = cliPkg.version || '0.0.0';
  const name = cliPkg.name || '@vybestack/llxprt-code';
  const tarballName = `${name.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
  return { name, version, tarballName };
}

/**
 * Process-specific cache directory (PID + source fingerprint) avoids concurrent
 * test processes corrupting a shared cache. The fingerprint is derived from the
 * CLI manifest path + mtime so a source change invalidates the cache. The dir
 * is cleaned when practical (same-process reuse is fine if both artifacts exist
 * and the fingerprint is stable).
 */
function sourceFingerprint(repoRoot) {
  const cliPkgPath = join(repoRoot, 'packages', 'cli', 'package.json');
  let mtime = 0;
  try {
    mtime = require('node:fs').statSync(cliPkgPath).mtimeMs;
  } catch {
    // stat failure is non-fatal; fingerprint just lacks the mtime component.
  }
  return `${mtime}`.replace(/[^0-9]/g, '0');
}

function processCacheDir(repoRoot) {
  const { version } = readCliManifest(repoRoot);
  const fp = sourceFingerprint(repoRoot);
  return join(
    tmpdir(),
    `llxprt-2603-release-cache-v${version}-${process.pid}-${fp}`,
  );
}

const releaseCacheDir = processCacheDir(
  // Compute lazily at module load using the CWD-derived repoRoot. Callers pass
  // the real repoRoot into packReleaseLikeCli, which re-derives as needed.
  process.cwd(),
);

const NON_NPM_RELEASE_PACKAGES = new Set([
  '@vybestack/llxprt-code-test-utils',
  '@vybestack/llxprt-code-a2a-server',
  'llxprt-code-vscode-ide-companion',
]);

let cachedReleaseTarball = null;
let cachedReplicaTarball = null;

/**
 * Locate the .tgz filename in npm pack output. npm pack prints the tarball
 * filename (ending in .tgz) on its own line, but the output may include
 * warnings/progress lines. Find the .tgz line and validate the file exists
 * rather than assuming the last line is the tarball name.
 */
function findTarballName(packOutput, cacheDir) {
  const lines = packOutput.split(/\r?\n/);
  const tgzLines = lines.filter((l) => l.trim().endsWith('.tgz'));
  if (tgzLines.length === 0) {
    throw new Error(
      `npm pack output did not contain a .tgz line:\n${packOutput}`,
    );
  }
  const tarName = tgzLines[tgzLines.length - 1].trim();
  const tarPath = join(cacheDir, tarName);
  if (!existsSync(tarPath)) {
    throw new Error(
      `npm pack reported tarball ${tarName} but it does not exist at ${tarPath}`,
    );
  }
  return tarName;
}

function packReleaseLikeCli(repoRoot) {
  // Cache hit only when BOTH artifacts exist. A single artifact (e.g. release
  // packed but replica failed) must not be served as a complete result.
  if (
    cachedReleaseTarball &&
    existsSync(cachedReleaseTarball) &&
    cachedReplicaTarball &&
    existsSync(cachedReplicaTarball)
  ) {
    return {
      releaseTarball: cachedReleaseTarball,
      replicaTarball: cachedReplicaTarball,
    };
  }
  // Re-derive the process-specific cache dir from the real repoRoot so the
  // fingerprint tracks the actual source being packed (not the CWD at module
  // load).
  const cacheDir = processCacheDir(repoRoot);
  mkdirSync(cacheDir, { recursive: true });

  const workCopy = mkdtempSync(join(tmpdir(), 'llxprt-release-copy-'));
  try {
    copyRepoExcludingGenerated(repoRoot, workCopy);
    runPreparePackage(workCopy);
    runBindReleaseDeps(workCopy);
    const internalPkgs = collectInternalPackages(workCopy);

    // Assert the release-bound manifest BEFORE creating any local-install
    // replica: the release artifact must have exact versions and no
    // file:/workspace:/link: internal deps.
    assertReleaseBoundManifest(workCopy, internalPkgs);

    // Pack the RELEASE artifact (exact-version manifest), then copy it to a
    // distinct path so the subsequent replica pack (same name/version) does
    // not overwrite it.
    const releasePacked = packCli(workCopy, cacheDir);
    const { tarballName: releaseTarballName } = readCliManifest(repoRoot);
    // Stage the candidate paths locally; only publish to the module-level
    // cache variables after all generation AND validation succeeds.
    const stagedReleaseTarball = join(
      cacheDir,
      `release-${releaseTarballName}`,
    );
    copyFileSync(releasePacked, stagedReleaseTarball);

    // Verify the release tarball contains required assets.
    assertReleaseTarballAssets(stagedReleaseTarball);

    // Now build the SEPARATE local-install replica: repoint ALL internal
    // package deps (including transitive, e.g. agents → policy) at packed
    // local tarballs for offline install.
    const tarballMap = packAllInternal(internalPkgs, workCopy, cacheDir);
    rewriteAllDepsToTarballs(workCopy, internalPkgs, tarballMap);
    // Repack internal packages so their tarballs reflect the rewritten deps.
    packAllInternal(internalPkgs, workCopy, cacheDir);
    const stagedReplicaTarball = packCli(workCopy, cacheDir);

    // Publish to module-level cache only after both artifacts exist and
    // validation passed.
    cachedReleaseTarball = stagedReleaseTarball;
    cachedReplicaTarball = stagedReplicaTarball;

    return {
      releaseTarball: cachedReleaseTarball,
      replicaTarball: cachedReplicaTarball,
    };
  } finally {
    rmSync(workCopy, { recursive: true, force: true });
  }
}

/**
 * Normalizes a repo-relative path for the copy filter so Windows backslash
 * separators match consistently. The filter receives POSIX-style substrings
 * from cpSync, so we match against forward-slash delimited segments.
 */
function shouldCopyRepoEntry(src, repoRoot) {
  const rel = src.slice(repoRoot.length).replace(/\\/g, '/');
  if (rel === '') return true;
  const skipSubstrings = [
    '/node_modules/',
    '/.git/',
    '/dist/',
    'node_modules/',
    '.git/',
  ];
  for (const s of skipSubstrings) {
    if (rel.includes(s)) return false;
  }
  const skipPrefixes = ['/node_modules', '/.git', 'node_modules', '.git'];
  for (const p of skipPrefixes) {
    if (rel === p || rel.startsWith(p + '/')) return false;
  }
  return !rel.endsWith('.tgz');
}

function copyRepoExcludingGenerated(repoRoot, workCopy) {
  cpSync(repoRoot, workCopy, {
    recursive: true,
    filter: (src) => shouldCopyRepoEntry(src, repoRoot),
  });
}

function runPreparePackage(workCopy) {
  // prepare:package copies README.md and LICENSE into packages/cli (and
  // others) so the packed tarball includes them. Without this, the release
  // tarball is missing required assets.
  const result = spawnSync('bun', ['scripts/prepare-package.ts'], {
    cwd: workCopy,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`prepare:package spawn failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `prepare:package failed (exit ${result.status}, timeout=${result.signal ?? 'none'}): ${result.stderr || result.stdout}`,
    );
  }
}

function runBindReleaseDeps(workCopy) {
  const bindResult = spawnSync('bun', ['scripts/bind-release-deps.ts'], {
    cwd: workCopy,
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (bindResult.error) {
    throw new Error(
      `bind-release-deps spawn failed: ${bindResult.error.message}`,
    );
  }
  if (bindResult.status !== 0) {
    throw new Error(
      `bind-release-deps failed (exit ${bindResult.status}, timeout=${bindResult.signal ?? 'none'}): ${bindResult.stderr || bindResult.stdout}`,
    );
  }
}

function collectInternalPackages(workCopy) {
  const rootPkg = JSON.parse(
    readFileSync(join(workCopy, 'package.json'), 'utf8'),
  );
  const internal = [];
  for (const ws of rootPkg.workspaces) {
    const pkgPath = join(workCopy, ws, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (
      pkg.private !== true &&
      pkg.name &&
      pkg.name.startsWith('@vybestack/') &&
      pkg.name !== '@vybestack/llxprt-code'
    ) {
      internal.push({ name: pkg.name, path: pkgPath });
    }
  }
  return internal;
}

/**
 * Assert the release-bound CLI manifest has exact version specs for every
 * PUBLISHED internal dependency (no file:/workspace:/link:). Non-NPM workspace
 * packages (policy, test-utils, a2a-server) are intentionally left as file:
 * refs by bind-release-deps because they are never published to the registry;
 * the real release pipeline resolves them at publish time. This is the
 * release-integrity contract that distinguishes the real release artifact
 * from the offline test replica.
 */
function assertReleaseBoundManifest(workCopy, internalPkgs) {
  const publishedInternalNames = new Set(
    internalPkgs
      .filter((p) => !NON_NPM_RELEASE_PACKAGES.has(p.name))
      .map((p) => p.name),
  );
  const cliPkgPath = join(workCopy, 'packages/cli/package.json');
  const cliPkg = JSON.parse(readFileSync(cliPkgPath, 'utf8'));
  const violations = [];
  for (const depField of ['dependencies', 'optionalDependencies']) {
    const deps = cliPkg[depField];
    if (!deps) continue;
    for (const [depName, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string') continue;
      // After bind-release-deps, PUBLISHED internal deps must be exact versions
      // (no file:/workspace:/link:). Non-NPM internal deps and external deps
      // are not subject to this constraint.
      if (
        publishedInternalNames.has(depName) &&
        (spec.startsWith('file:') ||
          spec.startsWith('workspace:') ||
          spec.startsWith('link:'))
      ) {
        violations.push(
          `packages/cli ${depField}.${depName} = "${spec}" (expected exact version after bind-release-deps)`,
        );
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(
      'Release-bound manifest integrity violations:\n  - ' +
        violations.join('\n  - '),
    );
  }
}

/**
 * Assert the release tarball contains the required assets: POSIX launcher,
 * installer script, TypeScript entry, README, and LICENSE.
 */
function assertReleaseTarballAssets(releaseTarball) {
  const result = spawnSync('tar', ['-tzf', releaseTarball], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) {
    throw new Error(
      `Failed to spawn tar to list release tarball: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Failed to list release tarball (exit ${result.status}, signal=${result.signal ?? 'none'}): ${result.stderr || result.stdout}`,
    );
  }
  const files = new Set(
    result.stdout
      .split(/\r?\n/)
      .map((entry) => entry.replace(/^\.\//, '').replace(/\\/g, '/'))
      .filter(Boolean),
  );
  const required = [
    'package/bin/llxprt',
    'package/scripts/install-native-launchers.cjs',
    'package/index.ts',
    'package/package.json',
    'package/README.md',
    'package/LICENSE',
  ];
  const missing = required.filter((p) => !files.has(p));
  if (missing.length > 0) {
    throw new Error(
      `Release tarball missing required assets: ${missing.join(', ')}; listed entries: ${JSON.stringify([...files])}`,
    );
  }
}

function packAllInternal(internalPkgs, workCopy, cacheDir) {
  const tarballMap = new Map();
  for (const { name } of internalPkgs) {
    const { command, args } = npmInvocation([
      'pack',
      '-w',
      name,
      '--pack-destination',
      cacheDir,
    ]);
    const packResult = spawnSync(command, args, {
      cwd: workCopy,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (packResult.error) {
      throw new Error(
        `npm pack -w ${name} spawn failed: ${packResult.error.message}`,
      );
    }
    if (packResult.status !== 0) {
      throw new Error(
        `npm pack -w ${name} failed (exit ${packResult.status}, signal=${packResult.signal ?? 'none'}): ${packResult.stderr || packResult.stdout}`,
      );
    }
    const tarName = findTarballName(packResult.stdout, cacheDir);
    tarballMap.set(name, join(cacheDir, tarName));
  }
  return tarballMap;
}

/**
 * Repoint internal package deps at packed local tarballs so the replica
 * installs offline. This rewrites BOTH the CLI's deps AND every internal
 * package's deps (e.g. agents → policy), because npm resolves the full
 * transitive tree from each packed tarball's manifest.
 */
function rewriteAllDepsToTarballs(workCopy, internalPkgs, tarballMap) {
  const cliPkgPath = join(workCopy, 'packages/cli/package.json');
  rewriteOnePkgDeps(cliPkgPath, tarballMap);
  for (const { path: pkgPath } of internalPkgs) {
    rewriteOnePkgDeps(pkgPath, tarballMap);
  }
}

function rewriteOnePkgDeps(pkgPath, tarballMap) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  let changed = false;
  for (const depField of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
  ]) {
    const deps = pkg[depField];
    if (!deps) continue;
    for (const [depName, spec] of Object.entries(deps)) {
      if (tarballMap.has(depName) && typeof spec === 'string') {
        deps[depName] = `file:${tarballMap.get(depName)}`;
        changed = true;
      }
    }
  }
  if (changed) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}

function packCli(workCopy, cacheDir) {
  // Derive the package name from the CLI manifest instead of hardcoding it,
  // so this stays correct if the package name/scope ever changes.
  const { name: cliName } = readCliManifest(workCopy);
  const { command, args } = npmInvocation([
    'pack',
    '-w',
    cliName,
    '--pack-destination',
    cacheDir,
  ]);
  const cliPackResult = spawnSync(command, args, {
    cwd: workCopy,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (cliPackResult.error) {
    throw new Error(
      `npm pack CLI spawn failed: ${cliPackResult.error.message}`,
    );
  }
  if (cliPackResult.status !== 0) {
    throw new Error(
      `npm pack CLI failed (exit ${cliPackResult.status}, signal=${cliPackResult.signal ?? 'none'}): ${cliPackResult.stderr || cliPackResult.stdout}`,
    );
  }
  const cliTarName = findTarballName(cliPackResult.stdout, cacheDir);
  return join(cacheDir, cliTarName);
}

module.exports = {
  packReleaseLikeCli,
  releaseCacheDir,
  readCliManifest,
  findTarballName,
  shouldCopyRepoEntry,
};
