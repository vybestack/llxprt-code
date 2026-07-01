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

// Under Bun this script is a deliberate no-op: Bun does not consume
// package-lock.json (so the peer-flag sanitization is irrelevant and must not
// mutate it), and the GitHub-source bundle bootstrap below shells out to npm,
// which would defeat a `bun install`. S1 only adopts Bun as the package
// manager; the bundle/build path stays on npm until a later subissue.
if (detectInstaller() === 'bun') {
  process.exit(0);
}

stripPeerFlagsFromLockfile();

// Prevent infinite recursion when npm install triggers postinstall
if (process.env.LLXPRT_POSTINSTALL_RUNNING === 'true') {
  process.exit(0);
}

// The published CLI package ships a built `dist/`; GitHub-source installs of
// the repository root do not. Detect an already-built CLI entry so we skip the
// (expensive) build for normal npm installs.
const cliEntryPath = path.join(
  __dirname,
  '..',
  'packages',
  'cli',
  'dist',
  'index.js',
);
const hasBuild = fs.existsSync(cliEntryPath);

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
