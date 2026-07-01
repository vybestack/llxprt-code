#!/usr/bin/env node

/**
 * Postinstall script to build the CLI when installing from GitHub.
 * This enables `npx github:vybestack/llxprt-code` to work properly.
 *
 * The published npm package (@vybestack/llxprt-code, i.e. packages/cli) already
 * ships a built `dist/`, so this bootstrap only runs for GitHub-source installs
 * of the repository root, which arrive without compiled output.
 */

/* eslint-env node */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { detectInstaller } = require('./detect-installer.cjs');

const lockfilePath = path.join(__dirname, '..', 'package-lock.json');
const repoRoot = path.join(__dirname, '..');

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
  return stat.isDirectory() && !stat.isSymbolicLink();
}

/**
 * Atomically replaces `target` (a static workspace copy directory) with a
 * symlink to `rel`. The static copy is renamed aside first, so a failure to
 * create the symlink restores the original rather than leaving the dependency
 * missing.
 */
function replaceWithSymlink(target, rel) {
  const backup = `${target}.postinstall-bak`;
  // Clear any stale backup left by a previously interrupted run, otherwise
  // renameSync onto a non-empty directory fails with ENOTEMPTY and leaves the
  // static copy orphaned (no symlink at `target`).
  fs.rmSync(backup, { recursive: true, force: true });
  fs.renameSync(target, backup);
  try {
    // 'dir' is required on Windows, where the link type is not inferred from
    // the target and would otherwise default to a (broken) file symlink.
    fs.symlinkSync(rel, target, 'dir');
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (e) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(backup, target);
    throw e;
  }
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
    replaceWithSymlink(target, rel);
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
// must not mutate it), and the GitHub-source build bootstrap shells out to
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

// The published CLI package ships a built `dist/`; GitHub-source installs of
// the repository root do not. Detect an already-built CLI so we skip the
// (expensive) build for normal npm installs. The entry alone is not enough:
// npm force-includes the `bin` target in a packed install, so `dist/index.js`
// can exist without the sibling modules it imports. Require both the entry and
// a key imported module (the launcher) before treating the build as complete.
const cliDistDir = path.join(__dirname, '..', 'packages', 'cli', 'dist');
const cliEntryPath = path.join(cliDistDir, 'index.js');
const cliLauncherPath = path.join(
  cliDistDir,
  'src',
  'launcher',
  'bun-launcher.js',
);
const hasBuild = fs.existsSync(cliEntryPath) && fs.existsSync(cliLauncherPath);

// Early exit if the CLI is already built - handles published npm packages and
// rebuilds. Exit silently to not clutter npm install output.
if (hasBuild) {
  process.exit(0);
}

// Check if this is a GitHub installation with source files
const hasSourceFiles = fs.existsSync(path.join(__dirname, '..', 'packages'));

// Only build if we have source files but no built CLI (GitHub installation)
if (hasSourceFiles && !hasBuild) {
  console.log('Building LLxprt Code for GitHub installation...');

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

    // Build the packages (produces packages/cli/dist/index.js, the launcher
    // entry that the root `bin` resolves to).
    console.log('Building packages...');
    execSync('npm run build', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, LLXPRT_POSTINSTALL_RUNNING: 'true' },
    });

    console.log('[OK] LLxprt Code built successfully!');
  } catch (error) {
    console.error('Failed to build LLxprt Code:', error.message);
    console.error('You may need to build manually with: npm run build');
    process.exit(1);
  }
} else {
  // No source files found - unexpected installation type
  console.log('Note: LLxprt Code source files not found, skipping build.');
}
