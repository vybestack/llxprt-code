#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Custom preflight script for CI/CD that handles the rollup platform dependency issue
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * The ordered preflight step sequence.
 *
 * `build` must run before `lint:ci` because the type-aware ESLint rules
 * (typescript-eslint `projectService` / tsserver) require compiled `dist/*.d.ts`
 * declarations on disk to resolve cross-workspace imports. Without them, every
 * cross-package import silently resolves to `any`, producing hundreds of
 * phantom `strict-boolean-expressions` and `no-unnecessary-type-assertion`
 * errors. This mirrors the build-before-lint ordering in ci.yml. See issue
 * #2339.
 *
 * `lint:agents-api-surface` must run before `test:ci` because the agents
 * package API-surface guard test fails closed when the surface report
 * (`node_modules/.cache/agents-api-surface/report.json`) is absent. `clean`
 * and `npm ci` are not part of this array because the rollup platform fix must
 * run between them. See issue #2323.
 *
 * @returns {Array<{ command: string }>}
 */
export function preflightSteps() {
  return [
    { command: 'npm run format' },
    { command: 'npm run build' },
    { command: 'npm run lint:ci' },
    { command: 'npm run typecheck' },
    { command: 'npm run lint:agents-api-surface' },
    { command: 'npm run test:ci' },
  ];
}

function tryRun(cmd) {
  console.log(`Running: ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', env: { ...process.env } });
    return true;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function run(cmd) {
  if (!tryRun(cmd)) {
    throw new Error(`Failed to run: ${cmd}`);
  }
}

export function runPreflight() {
  run('npm run clean');
  run('npm ci');

  // Fix for rollup platform dependency issue on Node 24
  // See: https://github.com/npm/cli/issues/4828
  console.log('Installing platform-specific rollup dependency...');
  const rollupOk = tryRun('npm install @rollup/rollup-linux-x64-gnu --no-save');
  if (!rollupOk) {
    console.log(
      'Note: Platform-specific dependency installation failed (this is OK on non-Linux systems)',
    );
  }

  // Every step runs uniformly via run(step.command). The lint:ci step sets its
  // own NODE_OPTIONS=--max-old-space-size=8192 via cross-env in package.json,
  // so no special heap handling is needed here.
  for (const step of preflightSteps()) {
    run(step.command);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    runPreflight();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
