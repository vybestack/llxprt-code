#!/usr/bin/env node

/**
 * Custom preflight script for CI/CD that handles the rollup platform dependency issue
 */

import { execSync } from 'child_process';

function run(cmd) {
  console.log(`Running: ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (_error) {
    console.error(`Failed to run: ${cmd}`);
    process.exit(1);
  }
}

// Run the standard preflight steps
run('npm run clean');
run('npm ci');

// Fix for rollup platform dependency issue on Node 24
// See: https://github.com/npm/cli/issues/4828
console.log('Installing platform-specific rollup dependency...');
try {
  run('npm install @rollup/rollup-linux-x64-gnu --no-save');
} catch (_error) {
  console.log(
    'Note: Platform-specific dependency installation failed (this is OK on non-Linux systems)',
  );
}

// Continue with the rest of preflight
run('npm run format');
run('npm run lint:ci');
run('npm run build');
run('npm run typecheck');
run('npm run test:ci');
