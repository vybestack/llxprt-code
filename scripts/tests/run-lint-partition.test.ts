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
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  escapeShellArg,
  getShellConfiguration,
} from '../../packages/core/src/utils/shell-utils.js';

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
  executeLintCommands: (
    commands: readonly LintCommand[],
    cancelSignal?: AbortSignal,
  ) => Promise<void>;
  classifyRunnerFailure: (error: unknown) => { exitCode: number };
}

/** Imports the real runner module under test; nothing here is stubbed. */
async function loadRunner(): Promise<RunnerModule> {
  return await import(RUNNER_PATH);
}

let fixtureRoot: string;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "llxprt lint partition's Ω-"));
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
      partitioned.some(
        (file) =>
          basename(file) === 'direct.js' &&
          basename(dirname(file)) === 'packages',
      ),
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
function shellCommand(
  label: string,
  status: number | 'signal' | 'hold',
  marker?: string,
): LintCommand {
  const { executable, argsPrefix, shell } = getShellConfiguration();
  const args = [
    process.execPath,
    join(__dirname, 'lint-command-fixture.ts'),
    label,
    String(status),
    ...(marker === undefined ? [] : [marker]),
  ];
  const invocation = args.map((arg) => escapeShellArg(arg, shell)).join(' ');
  if (status === 'hold') {
    // No shell wrapper: cancellation must terminate the long-lived process
    // itself, not only a shell that would leave it running on Windows.
    return {
      cmd: process.execPath,
      args: args.slice(1),
      nodeOptions: '',
      label,
    };
  }
  if (status === 'signal') {
    const script =
      shell === 'powershell'
        ? 'Stop-Process -Id $PID -Force; Start-Sleep -Seconds 5'
        : 'kill -TERM $$; sleep 5';
    return {
      cmd: executable,
      args: [...argsPrefix, script],
      nodeOptions: '',
      label,
    };
  }
  const script =
    shell === 'powershell'
      ? `& ${invocation}; exit $LASTEXITCODE`
      : `exec ${invocation}`;
  return {
    cmd: executable,
    args: [...argsPrefix, script],
    nodeOptions: '',
    label,
  };
}

describe('partitioned execution semantics (#3387)', () => {
  it('runs every group even when an earlier group fails', async () => {
    const { executeLintCommands } = await loadRunner();
    const marker = join(fixtureRoot, 'ran.txt');
    rmSync(marker, { force: true });
    const commands = [
      shellCommand('first', 1, marker),
      shellCommand('second', 0, marker),
      shellCommand('third', 0, marker),
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
      shellCommand('ok', 0),
      shellCommand('two', 2),
      shellCommand('three', 3),
    ];
    const error = await executeLintCommands(commands).catch(
      (caught: unknown) => caught,
    );
    expect((error as { exitCode?: number }).exitCode).toBe(2);
  });

  it('resolves without error when every group succeeds', async () => {
    const { executeLintCommands } = await loadRunner();
    await executeLintCommands([shellCommand('a', 0), shellCommand('b', 0)]);
  });

  // Windows has no signals: a child it terminates is only an exit code. The
  // cancellation test below covers the interruption path that exists there.
  it.skipIf(process.platform === 'win32')(
    'aborts the remaining groups when a group is killed by a signal',
    async () => {
      const { executeLintCommands } = await loadRunner();
      const marker = join(fixtureRoot, 'signal.txt');
      rmSync(marker, { force: true });
      const commands = [
        shellCommand('killed', 'signal'),
        shellCommand('after', 0, marker),
      ];
      await expect(executeLintCommands(commands)).rejects.toThrow();
      // An interruption is not a lint result: nothing after it should run.
      expect(() => readFileSync(marker, 'utf8')).toThrow();
    },
  );

  it('aborts the remaining groups when the runner cancels the running group', async () => {
    const { executeLintCommands, classifyRunnerFailure } = await loadRunner();
    const started = join(fixtureRoot, 'cancel-started.txt');
    const marker = join(fixtureRoot, 'cancel-after.txt');
    rmSync(started, { force: true });
    rmSync(marker, { force: true });
    const cancellation = new AbortController();
    const outcome = executeLintCommands(
      [shellCommand('held', 'hold', started), shellCommand('after', 0, marker)],
      cancellation.signal,
    ).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    // Cancel only once the real child is running, so the runner has to
    // terminate an admitted process rather than refuse to start one.
    while (!existsSync(started)) await Bun.sleep(10);
    cancellation.abort();
    const error = await outcome;
    expect(error).toBeDefined();
    expect(classifyRunnerFailure(error).exitCode).toBe(143);
    expect(existsSync(marker)).toBe(false);
  }, 30_000);
});

describe('scoped runs over a package whose files are all ignored (#3984 CI lint)', () => {
  let scopedRoot: string;

  beforeAll(() => {
    scopedRoot = mkdtempSync(join(tmpdir(), 'llxprt lint scoped-'));
    // `packages/ignored` mirrors packages/lsp: eslint.config.js ignores it
    // wholesale, yet CI's affected-target selector can still select it when
    // only its (ignored) test files changed.
    writeFileSync(
      join(scopedRoot, 'eslint.config.js'),
      "export default [{ ignores: ['packages/ignored/**'] }, { files: ['**/*.js'], rules: { 'no-var': 'error' } }];\n",
    );
    mkdirSync(join(scopedRoot, 'packages', 'ignored'), { recursive: true });
    writeFileSync(
      join(scopedRoot, 'packages', 'ignored', 'i.js'),
      'var ignored = 1;\n',
    );
    mkdirSync(join(scopedRoot, 'packages', 'clean'), { recursive: true });
    writeFileSync(
      join(scopedRoot, 'packages', 'clean', 'c.js'),
      'const clean = 1;\n',
    );
    mkdirSync(join(scopedRoot, 'packages', 'dirty'), { recursive: true });
    writeFileSync(
      join(scopedRoot, 'packages', 'dirty', 'd.js'),
      'var dirty = 1;\n',
    );
    // The runner always adds integration-tests to a scoped run.
    mkdirSync(join(scopedRoot, 'integration-tests'), { recursive: true });
    writeFileSync(
      join(scopedRoot, 'integration-tests', 't.js'),
      'const t = 1;\n',
    );
  });

  afterAll(() => {
    rmSync(scopedRoot, { recursive: true, force: true });
  });

  /** Runs every scoped command with real ESLint; returns each exit code by label. */
  async function scopedExitCodes(
    targets: readonly string[],
  ): Promise<Record<string, number | undefined>> {
    const { buildLintCommands, readPackageDirs } = await loadRunner();
    const commands = buildLintCommands({
      targets,
      forwardedArgs: ['--max-warnings', '0'],
      cache: false,
      packageDirs: readPackageDirs(scopedRoot),
    });
    const codes: Record<string, number | undefined> = {};
    for (const command of commands) {
      const result = await execa(command.cmd, [...command.args], {
        cwd: scopedRoot,
        reject: false,
      });
      codes[command.label] = result.exitCode;
    }
    return codes;
  }

  it('does not fail a selected package whose files are all ignored', async () => {
    const codes = await scopedExitCodes(['packages/ignored', 'packages/clean']);
    expect(codes).toEqual({
      'integration-tests': 0,
      'packages/clean': 0,
      'packages/ignored': 0,
    });
  });

  it('still lints real source in a selected package and fails on its findings', async () => {
    const codes = await scopedExitCodes(['packages/ignored', 'packages/dirty']);
    expect(codes['packages/dirty']).toBe(1);
    expect(codes['packages/ignored']).toBe(0);
  });

  it('still fails loudly for a scoped target that is not a package on disk', async () => {
    const codes = await scopedExitCodes(['packages/missing']);
    expect(codes['packages/missing']).toBe(2);
  });
});
