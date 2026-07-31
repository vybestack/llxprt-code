/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun test runner for the core workspace that discovers all test files
 * and runs them in isolated bun test processes with bounded parallelism.
 *
 * This avoids a Bun 1.3.x runtime bug on Linux where `bun test --parallel`
 * hangs during process teardown after all tests have passed. Running each
 * file as a separate `bun test <file>` invocation avoids the multi-file
 * process management that triggers the hang.
 *
 * Files are run in concurrent batches to avoid exceeding CI timeouts.
 * The default batch size is 8 ( empirically tuned for CI runners).
 *
 * Exit code is 0 if all files pass, 1 if any file fails.
 */

import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';

const PRELOAD = './bun-preload.ts';
const CONCURRENCY = Math.min(8, availableParallelism());

function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (entry === 'dist' || entry === 'node_modules' || entry === 'coverage') {
      continue;
    }
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

interface TestResult {
  file: string;
  passed: boolean;
  exitCode: number | null;
  output: string;
}

function runTestFile(file: string): Promise<TestResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['test', '--preload', PRELOAD, file],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      },
    );

    let output = '';
    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on('exit', (code) => {
      resolve({
        file,
        passed: code === 0,
        exitCode: code,
        output,
      });
    });

    child.on('error', () => {
      resolve({
        file,
        passed: false,
        exitCode: -1,
        output,
      });
    });
  });
}

async function main(): Promise<void> {
  const testFiles = [...findTestFiles('src'), ...findTestFiles('test')];
  if (testFiles.length === 0) {
    console.error('No test files found');
    process.exit(1);
  }

  console.log(
    `Running ${testFiles.length} test files with concurrency ${CONCURRENCY}`,
  );

  const results: TestResult[] = [];

  for (let i = 0; i < testFiles.length; i += CONCURRENCY) {
    const batch = testFiles.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(runTestFile));
    results.push(...batchResults);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed);

  for (const result of failed) {
    console.error(`FAILED: ${result.file} (exit code ${result.exitCode})`);
  }

  console.log(
    `Passed ${passed}/${testFiles.length} test files` +
      (failed.length > 0 ? ` (${failed.length} failed)` : ''),
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
