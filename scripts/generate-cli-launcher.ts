/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const defaultSource = join(
  repoRoot,
  'packages',
  'cli',
  'src',
  'launcher',
  'cli-bin.cts',
);
const defaultOutput = join(repoRoot, 'packages', 'cli', 'bin', 'llxprt.cjs');

interface GeneratorOptions {
  readonly check: boolean;
  readonly source: string;
  readonly output: string;
}

export interface WorkingDirectoryOperations {
  readonly cwd: () => string;
  readonly chdir: (directory: string) => void;
  readonly reportRestorationFailure: (error: unknown) => void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const defaultWorkingDirectoryOperations: WorkingDirectoryOperations = {
  cwd: () => process.cwd(),
  chdir: (directory) => process.chdir(directory),
  reportRestorationFailure: (error) => {
    process.stderr.write(
      `Additionally failed to restore the working directory (${describeError(error)}).\n`,
    );
  },
};

export async function runInWorkingDirectory<Result>(
  directory: string,
  operation: () => Promise<Result>,
  operations: WorkingDirectoryOperations = defaultWorkingDirectoryOperations,
): Promise<Result> {
  const originalCwd = operations.cwd();
  operations.chdir(directory);
  let outcome:
    | { readonly kind: 'success'; readonly value: Result }
    | { readonly kind: 'failure'; readonly error: unknown };
  try {
    outcome = { kind: 'success', value: await operation() };
  } catch (error) {
    outcome = { kind: 'failure', error };
  }

  let restorationError: unknown;
  try {
    operations.chdir(originalCwd);
  } catch (error) {
    restorationError = error;
  }

  if (outcome.kind === 'failure') {
    if (restorationError !== undefined) {
      try {
        operations.reportRestorationFailure(restorationError);
      } catch {
        process.stderr.write(
          `Additionally failed to restore the working directory (${describeError(restorationError)}).\n`,
        );
      }
    }
    throw outcome.error;
  }
  if (restorationError !== undefined) {
    throw restorationError;
  }
  return outcome.value;
}

function optionValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const equalsPrefix = `${name}=`;
  const equalsArgument = args.findLast((arg) => arg.startsWith(equalsPrefix));
  if (equalsArgument !== undefined) {
    const value = equalsArgument.slice(equalsPrefix.length);
    if (value.length === 0) {
      throw new Error(`${name} requires a path`);
    }
    return resolve(repoRoot, value);
  }

  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a path`);
  }
  return resolve(repoRoot, value);
}

function parseOptions(args: readonly string[]): GeneratorOptions {
  return {
    check: args.includes('--check'),
    source: optionValue(args, '--source') ?? defaultSource,
    output: optionValue(args, '--output') ?? defaultOutput,
  };
}

type LauncherFormatter = (
  source: string,
  options: { readonly parser: 'babel' },
) => Promise<string>;

export async function formatLauncher(
  bundled: string,
  sourcePath: string,
  outputPath: string,
  formatter: LauncherFormatter = format,
): Promise<string> {
  try {
    return await formatter(`#!/usr/bin/env node\n${bundled}`, {
      parser: 'babel',
    });
  } catch (error) {
    throw new Error(
      `Failed to format CLI launcher (source: ${sourcePath}, output: ${outputPath}): ${describeError(error)}`,
      { cause: error },
    );
  }
}

async function buildLauncher(
  sourcePath: string,
  outputPath: string,
): Promise<string> {
  const sourceDir = dirname(sourcePath);
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await runInWorkingDirectory(sourceDir, () =>
      Bun.build({
        entrypoints: [`./${basename(sourcePath)}`],
        root: sourceDir,
        target: 'node',
        format: 'cjs',
        minify: false,
        sourcemap: 'none',
      }),
    );
  } catch (error) {
    throw new Error(
      `Failed to build CLI launcher (source: ${sourcePath}, output: ${outputPath}): ${describeError(error)}`,
      { cause: error },
    );
  }
  if (!result.success || result.outputs.length !== 1) {
    const diagnostics = result.logs.map((log) => log.message).join('\n');
    throw new Error(
      `Failed to build CLI launcher (source: ${sourcePath}, output: ${outputPath}):\n${diagnostics}`,
    );
  }
  const bundled = (await result.outputs[0].text()).replace(
    /^#![^\n]*(?:\n|$)/,
    '',
  );
  return formatLauncher(bundled, sourcePath, outputPath);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

export async function outputMatches(
  outputPath: string,
  generated: string,
): Promise<boolean> {
  try {
    return (await readFile(outputPath, 'utf8')) === generated;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return false;
    }
    throw error;
  }
}

async function writeLauncher(
  outputPath: string,
  generated: string,
): Promise<void> {
  try {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, generated, 'utf8');
    if (process.platform !== 'win32') {
      await chmod(outputPath, 0o755);
    }
  } catch (error) {
    throw new Error(
      `Failed to write CLI launcher to ${outputPath}: ${describeError(error)}`,
      { cause: error },
    );
  }
}

async function main(): Promise<void> {
  if (typeof Bun === 'undefined') {
    throw new Error(
      'CLI launcher generation requires the Bun runtime. Run `npm run generate:cli-launcher` instead of invoking this script with Node.',
    );
  }

  const options = parseOptions(process.argv.slice(2));
  const generated = await buildLauncher(options.source, options.output);

  if (options.check) {
    if (!(await outputMatches(options.output, generated))) {
      process.stderr.write(
        `Generated CLI launcher is stale: ${options.output}\n` +
          'Run `npm run generate:cli-launcher` and commit the result.\n',
      );
      process.exitCode = 1;
    }
    return;
  }

  await writeLauncher(options.output, generated);
}

function normalizeEntryPath(path: string): string {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

const isDirectEntry =
  import.meta.main ??
  (process.argv[1] !== undefined &&
    normalizeEntryPath(fileURLToPath(import.meta.url)) ===
      normalizeEntryPath(process.argv[1]));

if (isDirectEntry) {
  await main();
}
