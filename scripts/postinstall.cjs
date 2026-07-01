#!/usr/bin/env node

/**
 * Postinstall script to build the bundle when installing from GitHub
 * This enables `npx github:vybestack/llxprt-code` to work properly
 */

/* eslint-env node */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { detectInstaller } = require('./detect-installer.cjs');

const lockfilePath = path.join(__dirname, '..', 'package-lock.json');
const repoRoot = path.join(__dirname, '..');

/**
 * Resolves the workspace directories declared in the root package.json
 * `workspaces` glob. Supports `packages/*` style globs and literal paths.
 *
 * @returns {Array<{name: string, dir: string}>} Workspace package names and
 *   their repo-relative directories.
 */
/**
 * Expands a single root-`workspaces` entry (a `packages/*`-style glob or a
 * literal path) into the list of repo-relative workspace directories it
 * matches that contain a `package.json`.
 */
function expandWorkspaceGlob(g) {
  if (g.endsWith('/*')) {
    const base = g.slice(0, -2);
    const baseAbs = path.join(repoRoot, base);
    if (!fs.existsSync(baseAbs)) {
      return [];
    }
    return fs
      .readdirSync(baseAbs)
      .filter((entry) =>
        fs.existsSync(path.join(baseAbs, entry, 'package.json')),
      )
      .map((entry) => path.join(base, entry));
  }
  if (fs.existsSync(path.join(repoRoot, g, 'package.json'))) {
    return [g];
  }
  return [];
}

/**
 * Resolves the workspace directories declared in the root package.json
 * `workspaces` globs.
 *
 * @returns {Array<{name: string, dir: string}>} Workspace package names and
 *   their repo-relative directories.
 */
function readWorkspaces() {
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'),
  );
  const dirs = [];
  for (const g of rootPkg.workspaces || []) {
    dirs.push(...expandWorkspaceGlob(g));
  }
  return dirs
    .map((dir) => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf-8'),
      );
      return { name: pkg.name, dir };
    })
    .filter((w) => w.name);
}

/**
 * Returns true when `target` is a real directory (not a symlink) for a local
 * workspace package named `fullName` — i.e. one of Bun's static copies that
 * should be replaced with a symlink.
 */
function isStaticWorkspaceCopy(nameToDir, fullName, target) {
  if (!nameToDir[fullName]) {
    return false;
  }
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return false;
  }
  return !stat.isSymbolicLink();
}

/**
 * Replaces every nested static workspace copy under one workspace's
 * `node_modules/@vybestack` with a relative symlink to the real workspace dir.
 * Returns the count of copies replaced.
 */
function symlinkScopedCopies(wsDir, nameToDir) {
  const scopedAbs = path.join(repoRoot, wsDir, 'node_modules', '@vybestack');
  if (!fs.existsSync(scopedAbs)) {
    return 0;
  }
  let replaced = 0;
  for (const entry of fs.readdirSync(scopedAbs)) {
    const fullName = '@vybestack/' + entry;
    const target = path.join(scopedAbs, entry);
    if (!isStaticWorkspaceCopy(nameToDir, fullName, target)) {
      continue;
    }
    const realWs = path.join(repoRoot, nameToDir[fullName]);
    const rel = path.relative(path.dirname(target), realWs);
    fs.rmSync(target, { recursive: true, force: true });
    fs.symlinkSync(rel, target);
    replaced++;
  }
  return replaced;
}

/**
 * Under Bun's hoisted linker, a version conflict causes a workspace package to
 * be installed as a static copy inside another workspace's
 * `node_modules/@vybestack/` rather than a symlink to the real workspace dir.
 * Those copies are snapshots of the source tree _before_ `tsc` runs, so they
 * lack `dist/` — which breaks esbuild/vite resolution. This function replaces
 * every nested static workspace copy with a relative symlink to the real
 * workspace directory, matching npm's behavior. It is idempotent: an existing
 * symlink is left as-is.
 */
function symlinkBunWorkspaceCopies() {
  const workspaces = readWorkspaces();
  const nameToDir = {};
  for (const ws of workspaces) {
    nameToDir[ws.name] = ws.dir;
  }
  let replaced = 0;
  for (const ws of workspaces) {
    replaced += symlinkScopedCopies(ws.dir, nameToDir);
  }
  if (replaced > 0) {
    console.log(
      `[postinstall] Replaced ${replaced} static workspace cop` +
        (replaced === 1 ? 'y' : 'ies') +
        ' with symlinks (Bun hoisted-linker fix).',
    );
  }
}

function stripPeerFlagsFromLockfile() {
  if (!fs.existsSync(lockfilePath)) {
    return;
  }

  try {
    const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf-8'));
    const packages = lockfile.packages;
    if (!packages) {
      return;
    }

    let modified = false;
    for (const details of Object.values(packages)) {
      if (
        details &&
        typeof details === 'object' &&
        Object.prototype.hasOwnProperty.call(details, 'peer')
      ) {
        delete details.peer;
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`);
      console.log('Removed unsupported "peer" flags from package-lock.json');
    }
  } catch (error) {
    console.warn(
      'Warning: Unable to sanitize package-lock.json "peer" flags:',
      error.message,
    );
  }
}

// Under Bun, only the npm-specific actions below are skipped: Bun does not
// consume package-lock.json (so the peer-flag sanitization is irrelevant and
// must not mutate it), and the GitHub-source bundle bootstrap shells out to
// npm, which would defeat a `bun install`. However, Bun's hoisted linker
// materializes static copies (not symlinks) of local workspace packages inside
// each workspace's own node_modules when a version conflict forces a nested
// install. Because those copies are taken from the source tree before any
// build has run, they lack the dist/ output their package.json entry points
// reference — so downstream bundlers (esbuild/vite) that follow a transitive
// import into a nested workspace copy hit "Could not resolve" errors.
// symlinkBunWorkspaceCopies() replaces every nested static workspace copy with
// a symlink to the real workspace directory (which has dist/ after build),
// matching what npm produces and what the toolchain expects.
if (detectInstaller() === 'bun') {
  symlinkBunWorkspaceCopies();
  process.exit(0);
}

stripPeerFlagsFromLockfile();

// Prevent infinite recursion when npm install triggers postinstall
if (process.env.LLXPRT_POSTINSTALL_RUNNING === 'true') {
  process.exit(0);
}

// Check if bundle already exists (npm packages include it)
const bundlePath = path.join(__dirname, '..', 'bundle', 'llxprt.js');
const hasBundle = fs.existsSync(bundlePath);

// Early exit if bundle exists - this handles npm installs
if (hasBundle) {
  // Bundle already exists - this is an npm package or already built
  // Exit silently to not clutter npm install output
  process.exit(0);
}

// Check if this is a GitHub installation with source files
const hasSourceFiles = fs.existsSync(path.join(__dirname, '..', 'packages'));

// Only build if we have source files but no bundle (GitHub installation)
if (hasSourceFiles && !hasBundle) {
  console.log('Building llxprt bundle for GitHub installation...');

  try {
    // Set env var to prevent recursion
    process.env.LLXPRT_POSTINSTALL_RUNNING = 'true';

    // Install dependencies in workspaces first (with --ignore-scripts to prevent recursion)
    console.log('Installing workspace dependencies...');
    execSync('npm install --workspaces --if-present --ignore-scripts', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, LLXPRT_POSTINSTALL_RUNNING: 'true' },
    });

    // Strip peer flags again after workspace install (npm may have added them back)
    stripPeerFlagsFromLockfile();

    // Build the packages
    console.log('Building packages...');
    execSync('npm run build', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, LLXPRT_POSTINSTALL_RUNNING: 'true' },
    });

    // Create the bundle
    console.log('Creating bundle...');
    execSync('npm run bundle', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, LLXPRT_POSTINSTALL_RUNNING: 'true' },
    });

    console.log('✓ LLxprt Code bundle built successfully!');
  } catch (error) {
    console.error('Failed to build llxprt bundle:', error.message);
    console.error(
      'You may need to build manually with: npm run build && npm run bundle',
    );
    process.exit(1);
  }
} else {
  // No source files found - unexpected installation type
  console.log('Note: LLxprt Code source files not found, skipping build.');
}
