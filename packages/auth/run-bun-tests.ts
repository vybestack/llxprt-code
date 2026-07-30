/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun test runner for the auth workspace that discovers all test files
 * and runs each one in an isolated bun test process.
 *
 * See packages/core/run-bun-tests.ts for rationale (Bun 1.3.x Linux hang).
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PRELOAD = './bun-preload.ts';

function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'dist' || entry === 'node_modules' || entry === 'coverage') {
      continue;
    }
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findTestFiles(fullPath));
    } else if (
      (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) &&
      !entry.endsWith('.d.ts')
    ) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function main(): void {
  const testFiles = findTestFiles('src');
  if (testFiles.length === 0) {
    console.error('No test files found');
    process.exit(1);
  }

  console.log(`Running ${testFiles.length} test files in isolated processes`);

  let passed = 0;
  let failed = 0;

  for (const file of testFiles) {
    const result = spawnSync(
      process.execPath,
      ['test', '--preload', PRELOAD, file],
      {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: process.env,
      },
    );

    if (result.status === 0) {
      passed++;
    } else {
      console.error(`FAILED: ${file} (exit code ${result.status})`);
      failed++;
    }
  }

  console.log(
    `Passed ${passed}/${testFiles.length} test files` +
      (failed > 0 ? ` (${failed} failed)` : ''),
  );
  process.exit(failed > 0 ? 1 : 0);
}

main();
