#!/usr/bin/env node

/**
 * Postinstall keeps npm/GitHub-source installs usable without compiling the
 * TypeScript application to JavaScript. The CLI bin is a checked-in launcher that
 * resolves Bun and executes packages/cli/index.ts directly.
 */

/* eslint-env node */
const fs = require('fs');
const path = require('path');
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

/**
 * Points `node_modules/@vybestack/<name>` at the workspace directory via a
 * relative symlink. Returns true when a new link was created or an existing
 * entry was replaced, false when the correct symlink was already in place.
 */
function linkWorkspacePackage(scopedDir, ws) {
  const linkName = ws.name.slice('@vybestack/'.length);
  const target = path.join(scopedDir, linkName);
  const source = path.join(repoRoot, ws.dir);
  const rel = path.relative(path.dirname(target), source);

  let existing;
  try {
    existing = fs.lstatSync(target);
  } catch {
    existing = undefined;
  }

  if (existing?.isSymbolicLink()) {
    if (fs.readlinkSync(target) === rel) {
      return false;
    }
    fs.rmSync(target, { recursive: true, force: true });
  } else if (existing) {
    replaceWithSymlink(target, rel);
    return true;
  }

  fs.symlinkSync(rel, target, 'dir');
  return true;
}

function ensureInternalWorkspaceLinks() {
  const workspaces = readWorkspaces();
  const scopedDir = path.join(repoRoot, 'node_modules', '@vybestack');
  fs.mkdirSync(scopedDir, { recursive: true });

  let linked = 0;
  for (const ws of workspaces) {
    if (
      ws.name.startsWith('@vybestack/') &&
      linkWorkspacePackage(scopedDir, ws)
    ) {
      linked++;
    }
  }

  if (linked > 0) {
    console.log(
      `[postinstall] Linked ${linked} internal workspace package` +
        (linked === 1 ? '' : 's') +
        ' for Bun TypeScript source resolution.',
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

/**
 * Installs the Windows native launchers (cmd/ps1) for the CLI workspace. Both
 * the Bun and npm postinstall branches run this at the same lifecycle point
 * (after their own manager-specific steps) so the launchers are generated
 * exactly once per install with the correct package layout. Errors during
 * launcher generation are surfaced but never fatal: the package still installs.
 */
function installWindowsNativeLaunchers() {
  if (process.platform !== 'win32') {
    return;
  }
  const cliInstaller = path.join(
    repoRoot,
    'packages',
    'cli',
    'scripts',
    'install-native-launchers.cjs',
  );
  if (!fs.existsSync(cliInstaller)) {
    return;
  }
  try {
    const { installNativeLaunchers } = require(cliInstaller);
    installNativeLaunchers({
      packageRoot: path.join(repoRoot, 'packages', 'cli'),
      log: console.log,
    });
  } catch (error) {
    // Normalize non-Error rejections (string, number, null) so the message
    // extraction never throws and postinstall stays non-fatal as documented.
    const msg =
      error && typeof error.message === 'string'
        ? error.message
        : String(error);
    console.warn(
      'Warning: Windows native launcher generation failed (non-fatal):',
      msg,
    );
  }
}

// Under Bun, only the npm-specific actions below are skipped: Bun does not
// consume package-lock.json (so peer-flag sanitization is irrelevant and must
// not mutate it), and it resolves workspace packages through Bun's own install.
// Bun's hoisted linker can materialize static copies of local workspace
// packages inside each workspace's own node_modules; replace those copies with
// symlinks so Bun resolves the live TypeScript source tree consistently.
if (detectInstaller() === 'bun') {
  symlinkBunWorkspaceCopies();
  installWindowsNativeLaunchers();
  process.exit(0);
}

stripPeerFlagsFromLockfile();

const hasWorkspaceSources = fs.existsSync(path.join(repoRoot, 'packages'));

if (hasWorkspaceSources) {
  try {
    ensureInternalWorkspaceLinks();
  } catch (error) {
    console.error(
      'Failed to link LLxprt Code workspace sources:',
      error.message,
    );
    console.error('You may need to rerun: npm install');
    process.exit(1);
  }
}

installWindowsNativeLaunchers();
