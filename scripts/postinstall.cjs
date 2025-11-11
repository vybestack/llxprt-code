#!/usr/bin/env node

/**
 * Postinstall script to build the bundle when installing from GitHub
 * This enables `npx github:vybestack/llxprt-code` to work properly
 */

/* eslint-env node */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
