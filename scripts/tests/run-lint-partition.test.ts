/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end tests for the lint partition introduced by issue #3387.
 *
 * The unit tests in run-lint.test.ts assert the shape of the commands the
 * runner builds. They cannot prove the partition is complete, because they
 * feed package discovery straight back into the builder and check that the
 * same names come out. This file closes that gap by running the REAL ESLint
 * binary over a REAL fixture tree and comparing the set of files linted by
 * `eslint .` against the union of the files linted by the partitioned
 * commands. If the partition ever drops or double-lints a file, these fail.
 *
 * The fixture deliberately includes a file sitting directly in `packages/`,
 * which belongs to no package group, and a dot-named package directory.
 *
 * The execution tests spawn real short-lived child processes rather than
 * mocks, so failure accumulation, exit-code fidelity and signal abort are
 * observed rather than asserted against call counts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execa } from 'execa';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const RUNNER_PATH = join(REPO_ROOT, 'scripts', 'run-lint.ts');
const ESLINT_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'eslint');

interface LintCommand {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly nodeOptions: string;
  readonly label: string;
}

interface RunnerModule {
  buildLintCommands: (params: {
    targets: readonly string[] | null;
    forwardedArgs: readonly string[];
    cache: boolean;
    packageDirs?: readonly string[];
  }) => readonly LintCommand[];
  readPackageDirs: (repoRoot: string) => readonly string[];
  executeLintCommands: (commands: readonly LintCommand[]) => Promise<void>;
}

async function loadRunner(): Promise<RunnerModule> {
  return await import(RUNNER_PATH);
}

let fixtureRoot: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'llxprt-lint-partition-'));
  // A flat-config fixture with no type-aware rules: this exercises ESLint's
  // file discovery and ignore semantics, which is what the partition depends
  // on, without paying for a TypeScript program.
  writeFileSync(
    join(fixtureRoot, 'eslint.config.js'),
    "export default [{ files: ['**/*.js'], rules: {} }];\n",
  );
  writeFileSync(join(fixtureRoot, 'root.js'), 'const root = 1;\n');
  mkdirSync(join(fixtureRoot, 'scripts'), { recursive: true });
  writeFileSync(join(fixtureRoot, 'scripts', 'tool.js'), 'const tool = 1;\n');
  mkdirSync(join(fixtureRoot, 'packages', 'alpha', 'src'), { recursive: true });
  writeFileSync(
    join(fixtureRoot, 'packages', 'alpha', 'src', 'a.js'),
    'const a = 1;\n',
  );
  mkdirSync(join(fixtureRoot, 'packages', 'beta'), { recursive: true });
  writeFileSync(
    join(fixtureRoot, 'packages', 'beta', 'b.js'),
    'const b = 1;\n',
  );
  // Belongs to no package group: only the rest-of-tree group can reach it.
  writeFileSync(
    join(fixtureRoot, 'packages', 'direct.js'),
    'const direct = 1;\n',
  );
  // A dot-named package directory, which readdirSync still reports.
  mkdirSync(join(fixtureRoot, 'packages', '.hidden'), { recursive: true });
  writeFileSync(
    join(fixtureRoot, 'packages', '.hidden', 'h.js'),
    'const h = 1;\n',
  );
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Runs the real ESLint binary in the fixture and returns the files it linted. */
async function lintedFiles(args: readonly string[]): Promise<string[]> {
  const outputPath = join(fixtureRoot, `out-${Math.random()}.json`);
  await execa(ESLINT_BIN, [...args, '--format', 'json', '-o', outputPath], {
    cwd: fixtureRoot,
    reject: false,
  });
  const results = JSON.parse(readFileSync(outputPath, 'utf8')) as Array<{
    filePath: string;
  }>;
  rmSync(outputPath, { force: true });
  return results.map((result) => result.filePath);
}

describe('lint partition covers exactly what `eslint .` covers (#3387)', () => {
  it('discovers every package directory in the fixture, including dot-named ones', async () => {
    const { readPackageDirs } = await loadRunner();
    expect([...readPackageDirs(fixtureRoot)].sort()).toEqual([
      'packages/.hidden',
      'packages/alpha',
      'packages/beta',
    ]);
  });

  it('lints the same set of files as a single root invocation', async () => {
    const { buildLintCommands, readPackageDirs } = await loadRunner();
    const baseline = await lintedFiles(['.']);
    // Guards the fixture: an empty baseline would make this vacuous.
    expect(baseline.length).toBeGreaterThan(4);

    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: readPackageDirs(fixtureRoot),
    });
    const partitioned: string[] = [];
    for (const command of commands) {
      partitioned.push(...(await lintedFiles(command.args)));
    }

    expect([...new Set(partitioned)].sort()).toEqual([...baseline].sort());
  });

  it('reaches a file sitting directly in packages/, which no package group covers', async () => {
    const { buildLintCommands, readPackageDirs } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: readPackageDirs(fixtureRoot),
    });
    const partitioned: string[] = [];
    for (const command of commands) {
      partitioned.push(...(await lintedFiles(command.args)));
    }
    expect(
      partitioned.some((file) => file.endsWith('packages/direct.js')),
    ).toBe(true);
  });

  it('lints no file twice, so the groups are a partition rather than an overlap', async () => {
    const { buildLintCommands, readPackageDirs } = await loadRunner();
    const commands = buildLintCommands({
      targets: null,
      forwardedArgs: [],
      cache: false,
      packageDirs: readPackageDirs(fixtureRoot),
    });
    const partitioned: string[] = [];
    for (const command of commands) {
      partitioned.push(...(await lintedFiles(command.args)));
    }
    expect(partitioned.length).toBe(new Set(partitioned).size);
  });
});

/** A command that runs a real shell snippet, shaped like a LintCommand. */
function shellCommand(label: string, script: string): LintCommand {
  return { cmd: '/bin/sh', args: ['-c', script], nodeOptions: '', label };
}

describe('partitioned execution semantics (#3387)', () => {
  it('runs every group even when an earlier group fails', async () => {
    const { executeLintCommands } = await loadRunner();
    const marker = join(fixtureRoot, 'ran.txt');
    rmSync(marker, { force: true });
    const commands = [
      shellCommand('first', `echo first >> ${marker}; exit 1`),
      shellCommand('second', `echo second >> ${marker}`),
      shellCommand('third', `echo third >> ${marker}`),
    ];
    await expect(executeLintCommands(commands)).rejects.toThrow();
    expect(readFileSync(marker, 'utf8').split('\n').filter(Boolean)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('propagates the first failing exit code, not the last', async () => {
    const { executeLintCommands } = await loadRunner();
    const commands = [
      shellCommand('ok', 'true'),
      shellCommand('two', 'exit 2'),
      shellCommand('three', 'exit 3'),
    ];
    const error = await executeLintCommands(commands).catch(
      (caught: unknown) => caught,
    );
    expect((error as { exitCode?: number }).exitCode).toBe(2);
  });

  it('resolves without error when every group succeeds', async () => {
    const { executeLintCommands } = await loadRunner();
    await executeLintCommands([
      shellCommand('a', 'true'),
      shellCommand('b', 'true'),
    ]);
  });

  it('aborts the remaining groups when a group is killed by a signal', async () => {
    const { executeLintCommands } = await loadRunner();
    const marker = join(fixtureRoot, 'signal.txt');
    rmSync(marker, { force: true });
    const commands = [
      shellCommand('killed', 'kill -TERM $$; sleep 5'),
      shellCommand('after', `echo after >> ${marker}`),
    ];
    await expect(executeLintCommands(commands)).rejects.toThrow();
    // An interruption is not a lint result: nothing after it should run.
    expect(() => readFileSync(marker, 'utf8')).toThrow();
  });
});
