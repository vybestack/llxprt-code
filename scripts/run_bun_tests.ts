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
 * Usage:
 *   bun scripts/run_bun_tests.ts [options]
 *
 * Options:
 *   --cwd <dir>           Working directory (defaults to process.cwd())
 *   --exclude <pattern>   Glob pattern to exclude (can be repeated)
 *   --tsconfig <path>     Path to tsconfig override (passed via --tsconfig-override)
 *   --include <pattern>   Glob pattern to include (can be repeated, defaults to standard test patterns)
 *   --timeout <ms>        Per-test timeout in milliseconds (defaults to 30000)
 *   --dry-run             List files that would be run without executing them
 */

interface CliOptions {
  cwd: string;
  exclude: string[];
  include: string[];
  tsconfig: string | null;
  timeout: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    cwd: process.cwd(),
    exclude: [],
    include: [],
    tsconfig: null,
    timeout: 30_000,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--cwd':
        options.cwd = argv[++i] ?? options.cwd;
        break;
      case '--exclude':
        options.exclude.push(argv[++i] ?? '');
        break;
      case '--include':
        options.include.push(argv[++i] ?? '');
        break;
      case '--tsconfig':
        options.tsconfig = argv[++i] ?? null;
        break;
      case '--timeout':
        options.timeout = Number(argv[++i] ?? options.timeout);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
    }
  }

  return options;
}

const DEFAULT_INCLUDE_PATTERNS = ['src/**/*.{test,spec}.{ts,tsx,js,jsx}'];

function collectTestFiles(options: CliOptions): string[] {
  const includePatterns =
    options.include.length > 0 ? options.include : DEFAULT_INCLUDE_PATTERNS;

  const defaultExcludes = ['node_modules', 'dist', 'tmp'];

  const allExcludes = [...defaultExcludes, ...options.exclude];

  // Build a set of all excluded file paths by scanning each exclude pattern
  const excludedFiles = new Set<string>();
  for (const pattern of allExcludes) {
    const glob = new Bun.Glob(pattern);
    for (const file of glob.scanSync({
      cwd: options.cwd,
      onlyFiles: true,
    })) {
      excludedFiles.add(file);
    }
  }

  const allFiles = new Set<string>();

  for (const pattern of includePatterns) {
    const glob = new Bun.Glob(pattern);
    for (const file of glob.scanSync({
      cwd: options.cwd,
      onlyFiles: true,
    })) {
      if (!excludedFiles.has(file)) {
        allFiles.add(file);
      }
    }
  }

  return Array.from(allFiles).sort();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const files = collectTestFiles(options);

  if (files.length === 0) {
    console.error(`No native Bun test files found under ${options.cwd}`);
    process.exit(1);
  }

  if (options.dryRun) {
    console.log(`Dry run: ${files.length} files would be executed:`);
    for (const file of files) {
      console.log(`  ${file}`);
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

  for (const file of files) {
    const child = Bun.spawnSync([process.execPath, ...baseArgs, file], {
      cwd: options.cwd,
      env: process.env,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });

    if (child.exitCode !== 0) {
      console.error(`Native Bun test failed: ${file}`);
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
