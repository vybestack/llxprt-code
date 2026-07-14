/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runs native Bun test files in isolated processes.
 *
 * Bun's module mocks are process-wide, unlike Vitest's per-file module graph.
 * A fresh process per file preserves the isolation expected by the existing
 * workspace suites while still executing every test with Bun's native runner.
 *
 * **Important**: This script does NOT discover test files by glob. Only files
 * explicitly listed in `scripts/bun-test-manifest.ts` are executed. Bun's
 * native test runner does not support several Vitest-specific APIs (relative
 * `vi.importActual`, `vi.resetModules`, process-wide `mock.module`), so
 * silently attempting all legacy test files would produce failures that look
 * like real regressions but are actually module-lifecycle incompatibilities.
 * The manifest ensures `test:bun` only runs files that have been verified to
 * pass under Bun, giving honest CI signal.
 *
 * Usage:
 *   bun scripts/run_bun_tests.ts [options]
 *
 * Options:
 *   --workspace <name>    Only run tests for the named workspace
 *   --tsconfig <path>     Path to tsconfig override (passed via --tsconfig-override)
 *   --timeout <ms>        Per-test timeout in milliseconds (defaults to 30000)
 *   --dry-run             List files that would be run without executing them
 */

import { resolve } from 'node:path';
import { resolveBunNativeTestFiles } from './bun-test-manifest.js';

const scriptDir = import.meta.dir;
const repoRoot = resolve(scriptDir, '..');

interface CliOptions {
  workspace: string | null;
  tsconfig: string | null;
  timeout: number;
  dryRun: boolean;
}

function readOptionValue(
  argv: string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    workspace: null,
    tsconfig: null,
    timeout: 30_000,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--workspace':
      case '-w':
        options.workspace = readOptionValue(argv, i++, arg);
        break;
      case '--tsconfig':
        options.tsconfig = readOptionValue(argv, i++, arg);
        break;
      case '--timeout': {
        const value = readOptionValue(argv, i++, arg);
        const timeout = Number(value);
        if (!Number.isFinite(timeout) || timeout <= 0) {
          throw new Error(`Invalid --timeout value: ${value}`);
        }
        options.timeout = timeout;
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const files = resolveBunNativeTestFiles(
    repoRoot,
    options.workspace ?? undefined,
  );

  if (files.length === 0) {
    const scope = options.workspace
      ? `workspace "${options.workspace}"`
      : 'any workspace';
    console.error(`No native Bun test files found for ${scope}.`);
    console.error(
      'Files must be explicitly listed in scripts/bun-test-manifest.ts.',
    );
    process.exit(1);
  }

  if (options.dryRun) {
    console.log(`Dry run: ${files.length} files would be executed:`);
    for (const entry of files) {
      console.log(`  [${entry.cwd}] ${entry.file}`);
    }
    return;
  }

  console.log(
    `Running ${files.length} native Bun test files in isolated processes`,
  );

  const baseArgs = ['test'];
  if (options.tsconfig) {
    baseArgs.push('--tsconfig-override', options.tsconfig);
  }
  baseArgs.push('--max-concurrency', '1', '--timeout', String(options.timeout));

  let passed = 0;
  let failed = 0;

  for (const entry of files) {
    // Each file runs from its workspace root so bunfig.toml preloads apply.
    const child = Bun.spawnSync([process.execPath, ...baseArgs, entry.file], {
      cwd: entry.cwd,
      env: process.env,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });

    if (child.exitCode !== 0) {
      console.error(`Native Bun test failed: ${entry.file}`);
      failed++;
      process.exitCode = 1;
    } else {
      passed++;
    }
  }

  console.log(
    `Passed ${passed}/${files.length} isolated native Bun test files` +
      (failed > 0 ? ` (${failed} failed)` : ''),
  );
}

main();
