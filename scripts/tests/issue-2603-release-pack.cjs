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
const {
  spawnTarList,
  findTarballName: sharedFindTarballName,
} = require('../lib/tar-command.cjs');

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
 * CLI manifest content (SHA-256) so a source change invalidates the cache
 * deterministically regardless of checkout mtime (which varies across clones,
 * CI reruns, and git operations like checkout/reset). The dir is cleaned when
 * practical (same-process reuse is fine if both artifacts exist and the
 * fingerprint is stable).
 */
function sourceFingerprint(repoRoot) {
  const crypto = require('node:crypto');
  const fs = require('node:fs');
  const { join } = require('node:path');
  const hasher = crypto.createHash('sha256');
  // Hash the CLI manifest content (the primary source of truth for what gets
  // packed) AND the packing scripts so a change to the packing logic
  // invalidates the cache, preventing stale artifacts from being served.
  const fingerprintFiles = [
    join(repoRoot, 'packages', 'cli', 'package.json'),
    join(repoRoot, 'package.json'),
    join(repoRoot, 'scripts', 'bind-release-deps.ts'),
    join(repoRoot, 'scripts', 'prepare-package.ts'),
    join(repoRoot, 'scripts', 'lib', 'npm-command.cjs'),
    join(repoRoot, 'scripts', 'tests', 'issue-2603-release-pack.cjs'),
  ];
  for (const f of fingerprintFiles) {
    try {
      const data = fs.readFileSync(f);
      hasher.update(f).update(data);
    } catch {
      // A missing/unreadable fingerprint file is non-fatal; it simply does
      // not contribute to the hash. The manifest is always present for a
      // valid repo, so a missing file indicates a broken checkout that will
      // fail later with a clearer error.
    }
  }
  return hasher.digest('hex').slice(0, 16);
}

function processCacheDir(repoRoot) {
  const { version } = readCliManifest(repoRoot);
  const fp = sourceFingerprint(repoRoot);
  return join(
    tmpdir(),
    `llxprt-2603-release-cache-v${version}-${process.pid}-${fp}`,
  );
}

// Shared list of non-NPM release packages, imported from a single .cjs source
// so release-pack.cjs and release-install-smoke.cjs stay in sync without
// manual duplication.
const {
  NON_NPM_RELEASE_PACKAGES,
} = require('../lib/non-npm-release-packages.cjs');

let cachedReleaseTarball = null;
let cachedReplicaTarball = null;
let cachedRepoRoot = null;
let cachedFingerprint = null;

/**
 * Locate the .tgz filename in npm pack output. Delegates to the shared
 * tar-command helper so spawn/validation logic is centralized.
 */
function findTarballName(packOutput, cacheDir) {
  return sharedFindTarballName(packOutput, cacheDir);
}

/**
 * Returns true when both cached artifacts still exist and the cache key
 * (repoRoot + source fingerprint) matches the current request. Kept as a
 * separate function to avoid exceeding the conditional-operator complexity
 * limit inside packReleaseLikeCli.
 */
function cacheIsValid(repoRoot, fp) {
  if (!cachedReleaseTarball || !existsSync(cachedReleaseTarball)) return false;
  if (!cachedReplicaTarball || !existsSync(cachedReplicaTarball)) return false;
  if (cachedRepoRoot !== repoRoot) return false;
  return cachedFingerprint === fp;
}

function packReleaseLikeCli(repoRoot) {
  // Cache hit only when BOTH artifacts exist AND the repoRoot + source
  // fingerprint match the previous call. A stale cache from a different
  // repoRoot or changed source files must not be served.
  const fp = sourceFingerprint(repoRoot);
  if (cacheIsValid(repoRoot, fp)) {
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
    // The return value (tarballMap) is intentionally not captured: the
    // rewritten tarballs overwrite the same name-version.tgz paths from the
    // first pack, so the original tarballMap's paths remain valid. If npm
    // pack naming ever changes to be non-deterministic, this would surface
    // as a broken install downstream.
    packAllInternal(internalPkgs, workCopy, cacheDir);
    const stagedReplicaTarball = packCli(workCopy, cacheDir);

    // Validate the replica tarball assets as well, so a missing file
    // (launcher, installer, entry, README, LICENSE) fails here with a clear
    // message instead of producing obscure downstream install errors.
    assertReleaseTarballAssets(stagedReplicaTarball);

    // Publish to module-level cache only after both artifacts exist and
    // validation passed. Key by repoRoot + fingerprint so a different source
    // tree or changed files invalidate the cache.
    cachedReleaseTarball = stagedReleaseTarball;
    cachedReplicaTarball = stagedReplicaTarball;
    cachedRepoRoot = repoRoot;
    cachedFingerprint = fp;

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
      `prepare:package failed (exit ${result.status}, signal=${result.signal ?? 'none'}): ${result.stderr || result.stdout}`,
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
      `bind-release-deps failed (exit ${bindResult.status}, signal=${bindResult.signal ?? 'none'}): ${bindResult.stderr || bindResult.stdout}`,
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
  for (const depField of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ]) {
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
  const { stdout } = spawnTarList(releaseTarball);
  const files = new Set(
    stdout
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
  // peerDependencies are intentionally NOT rewritten: peers are
  // consumer-provided and must not be repointed at absolute file tarballs.
  // Rewriting peers would force consumers to install an absolute local
  // tarball path as a peer, breaking the peer contract. Only regular deps,
  // devDeps, and optionalDeps are repointed for the offline install replica.
  for (const depField of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
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
  readCliManifest,
  findTarballName,
  shouldCopyRepoEntry,
  rewriteOnePkgDeps,
};
