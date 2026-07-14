/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import path, { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  discoverWorkspaces,
  parseArgs,
  type CommandRunner,
  type TestOptions,
  type TestSummary,
  orchestrateTests,
  formatSummary,
} from '../test.ts';

const repoRoot = resolve(__dirname, '..', '..');
const fixtures: string[] = [];

afterEach(() => {
  while (fixtures.length > 0) {
    const dir = fixtures.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Failed to clean up temp dir ${dir}:`, err);
    }
  }
});

function createFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'test-orch-'));
  fixtures.push(dir);
  return dir;
}

function writePackageJson(
  dir: string,
  scripts: Record<string, string>,
  name = 'fixture-pkg',
): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      { name, version: '0.0.0', type: 'module', scripts },
      null,
      2,
    ),
  );
}

function succeedingRunner(): CommandRunner {
  return () => ({ success: true, exitCode: 0 });
}

function createFixtureRepo(
  workspaces: Array<{
    dir: string;
    name: string;
    scripts: Record<string, string>;
  }>,
): string {
  const root = createFixture();
  const wsPaths: string[] = [];
  for (const ws of workspaces) {
    const wsDir = join(root, ws.dir);
    mkdirSync(wsDir, { recursive: true });
    writePackageJson(wsDir, ws.scripts, ws.name);
    wsPaths.push(ws.dir);
  }
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-root',
        version: '0.0.0',
        private: true,
        workspaces: wsPaths,
      },
      null,
      2,
    ),
  );
  return root;
}

describe('discoverWorkspaces', () => {
  it('finds all declared workspaces from the real repo root', () => {
    const workspaces = discoverWorkspaces(repoRoot);
    const rootPkg = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
    ) as { workspaces?: string[] };
    const expectedCount = (rootPkg.workspaces ?? []).filter((g) =>
      existsSync(join(repoRoot, g, 'package.json')),
    ).length;
    expect(workspaces).toHaveLength(expectedCount);
  });

  it('detects a pretest script via fixture repo', () => {
    const fixtureRoot = createFixtureRepo([
      {
        dir: 'packages/with-pretest',
        name: 'fixture-pretest-pkg',
        scripts: {
          pretest: 'echo running pretest',
          test: 'vitest run',
        },
      },
      {
        dir: 'packages/no-pretest',
        name: 'fixture-no-pretest-pkg',
        scripts: { test: 'vitest run' },
      },
    ]);

    const workspaces = discoverWorkspaces(fixtureRoot);
    const withPretest = workspaces.find(
      (w) => w.name === 'fixture-pretest-pkg',
    );
    expect(withPretest).toBeDefined();
    expect(withPretest!.hasPretest).toBe(true);
    expect(withPretest!.pretestScript).toContain('pretest');

    const withoutPretest = workspaces.find(
      (w) => w.name === 'fixture-no-pretest-pkg',
    );
    expect(withoutPretest).toBeDefined();
    expect(withoutPretest!.hasPretest).toBe(false);
  });

  it('detects test scripts via fixture repo', () => {
    const fixtureRoot = createFixtureRepo([
      {
        dir: 'packages/with-test',
        name: 'fixture-with-test',
        scripts: { test: 'vitest run' },
      },
      {
        dir: 'packages/without-test',
        name: 'fixture-without-test',
        scripts: { build: 'echo build' },
      },
    ]);

    const workspaces = discoverWorkspaces(fixtureRoot);
    const withTest = workspaces.find((w) => w.name === 'fixture-with-test');
    expect(withTest).toBeDefined();
    expect(withTest!.hasTest).toBe(true);

    const withoutTest = workspaces.find(
      (w) => w.name === 'fixture-without-test',
    );
    expect(withoutTest).toBeDefined();
    expect(withoutTest!.hasTest).toBe(false);
  });

  it('returns absolute paths that actually exist', () => {
    const workspaces = discoverWorkspaces(repoRoot);
    for (const ws of workspaces) {
      expect(
        existsSync(ws.absolutePath),
        `${ws.absolutePath} should exist`,
      ).toBe(true);
    }
  });

  it('returns relative paths relative to root', () => {
    const workspaces = discoverWorkspaces(repoRoot);
    for (const ws of workspaces) {
      // relativePath must be genuinely relative (not absolute)
      expect(ws.relativePath).not.toMatch(/^\//u);
      // and must resolve to the same absolute path
      expect(resolve(repoRoot, ws.relativePath)).toBe(ws.absolutePath);
    }
  });

  it('reads workspace names from a fixture repo', () => {
    const fixtureRoot = createFixtureRepo([
      {
        dir: 'packages/alpha',
        name: 'fixture-alpha',
        scripts: { test: 'vitest run' },
      },
      {
        dir: 'packages/beta',
        name: 'fixture-beta',
        scripts: { test: 'vitest run' },
      },
    ]);

    const workspaces = discoverWorkspaces(fixtureRoot);
    const names = workspaces.map((w) => w.name);
    expect(names).toContain('fixture-alpha');
    expect(names).toContain('fixture-beta');
  });
});

describe('parseArgs', () => {
  it('returns defaults with no arguments', () => {
    const opts = parseArgs([]);
    expect(opts.workspaceFilter).toBeUndefined();
    expect(opts.skipScripts).toBe(false);
    expect(opts.skipPretest).toBe(false);
    expect(opts.continueOnError).toBe(false);
  });

  it('parses --workspace with a value', () => {
    const opts = parseArgs(['--workspace', 'core']);
    expect(opts.workspaceFilter).toBe('core');
  });

  it('parses -w shorthand for --workspace', () => {
    const opts = parseArgs(['-w', 'agents']);
    expect(opts.workspaceFilter).toBe('agents');
  });

  it('parses --skip-scripts', () => {
    const opts = parseArgs(['--skip-scripts']);
    expect(opts.skipScripts).toBe(true);
  });

  it('parses --skip-pretest', () => {
    const opts = parseArgs(['--skip-pretest']);
    expect(opts.skipPretest).toBe(true);
  });

  it('parses --continue-on-error', () => {
    const opts = parseArgs(['--continue-on-error']);
    expect(opts.continueOnError).toBe(true);
  });

  it('parses -c shorthand for --continue-on-error', () => {
    const opts = parseArgs(['-c']);
    expect(opts.continueOnError).toBe(true);
  });

  it('parses multiple flags together', () => {
    const opts = parseArgs([
      '-w',
      'core',
      '--skip-scripts',
      '--continue-on-error',
    ]);
    expect(opts.workspaceFilter).toBe('core');
    expect(opts.skipScripts).toBe(true);
    expect(opts.continueOnError).toBe(true);
  });

  it('warns on unknown arguments but still parses known ones', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const opts = parseArgs(['--unknown-flag', '--workspace', 'tools']);
      expect(opts.workspaceFilter).toBe('tools');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('throws when --workspace has no value', () => {
    expect(() => parseArgs(['--workspace'])).toThrow(/requires a value/u);
  });

  it('throws when -w shorthand has no value', () => {
    expect(() => parseArgs(['-w'])).toThrow(/requires a value/u);
  });
});

describe('orchestrateTests', () => {
  function createRecordingRunner(): {
    runner: CommandRunner;
    commands: Array<{ command: string; cwd: string }>;
  } {
    const commands: Array<{ command: string; cwd: string }> = [];
    const runner: CommandRunner = (command, cwd) => {
      commands.push({ command, cwd });
      return { success: true, exitCode: 0 };
    };
    return { runner, commands };
  }

  function createFailingForRunner(
    failCommand: string,
    failCwdSuffix: string,
  ): {
    runner: CommandRunner;
    commands: Array<{ command: string; cwd: string }>;
  } {
    const commands: Array<{ command: string; cwd: string }> = [];
    const runner: CommandRunner = (command, cwd) => {
      commands.push({ command, cwd });
      if (
        command === failCommand &&
        cwd.endsWith(path.normalize(failCwdSuffix))
      ) {
        return { success: false, exitCode: 1 };
      }
      return { success: true, exitCode: 0 };
    };
    return { runner, commands };
  }

  it('runs pretest before test for workspaces that have pretest', () => {
    const { runner, commands } = createRecordingRunner();

    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: {
          pretest: 'echo pretest',
          test: 'vitest run',
        },
      },
    ]);

    const summary = orchestrateTests(
      root,
      parseArgs(['--skip-scripts']),
      runner,
    );
    // 1 workspace with pretest + test both passing = 1 workspace passed
    expect(summary.passed).toBe(1);
    expect(commands[0].command).toBe('echo pretest');
    expect(commands[1].command).toBe('vitest run');
  });

  it('skips pretest when --skip-pretest is set', () => {
    const { runner, commands } = createRecordingRunner();

    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: {
          pretest: 'echo pretest',
          test: 'vitest run',
        },
      },
    ]);

    const opts: TestOptions = { ...parseArgs([]), skipPretest: true };
    orchestrateTests(root, opts, runner);
    expect(commands).toHaveLength(1);
    expect(commands[0].command).toBe('vitest run');
  });

  it('runs only test (no pretest) for workspaces without pretest', () => {
    const { runner, commands } = createRecordingRunner();

    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: { test: 'vitest run' },
      },
    ]);

    orchestrateTests(root, parseArgs(['--skip-scripts']), runner);
    expect(commands).toHaveLength(1);
    expect(commands[0].command).toBe('vitest run');
  });

  it('fails fast by default when a test fails', () => {
    const { runner: failingForA, commands } = createFailingForRunner(
      'vitest run',
      'packages/a',
    );

    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: { test: 'vitest run' },
      },
      {
        dir: 'packages/b',
        name: 'pkg-b',
        scripts: { test: 'vitest run' },
      },
    ]);

    const summary = orchestrateTests(
      root,
      parseArgs(['--skip-scripts']),
      failingForA,
    );
    expect(summary.failed).toBeGreaterThan(0);
    const ranB = commands.some((c) => c.cwd.endsWith(join('packages', 'b')));
    expect(ranB).toBe(false);
  });

  it('continues on error when --continue-on-error is set', () => {
    const { runner: failingForA, commands } = createFailingForRunner(
      'vitest run',
      'packages/a',
    );

    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: { test: 'vitest run' },
      },
      {
        dir: 'packages/b',
        name: 'pkg-b',
        scripts: { test: 'vitest run' },
      },
    ]);

    const opts: TestOptions = { ...parseArgs([]), continueOnError: true };
    const summary = orchestrateTests(root, opts, failingForA);
    expect(summary.failed).toBe(1);
    expect(summary.passed).toBeGreaterThanOrEqual(1);
    const ranB = commands.some((c) => c.cwd.endsWith(join('packages', 'b')));
    expect(ranB).toBe(true);
  });

  it('filters to a specific workspace by directory name', () => {
    const { runner, commands } = createRecordingRunner();

    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: { test: 'vitest run' },
      },
      {
        dir: 'packages/b',
        name: 'pkg-b',
        scripts: { test: 'vitest run' },
      },
    ]);

    const opts: TestOptions = {
      ...parseArgs([]),
      workspaceFilter: 'packages/b',
    };
    const summary = orchestrateTests(root, opts, runner);
    expect(summary.totalWorkspaces).toBe(1);
    expect(commands).toHaveLength(1);
    expect(commands[0].cwd.endsWith(join('packages', 'b'))).toBe(true);
  });

  it('filters by workspace package name', () => {
    const { runner, commands } = createRecordingRunner();

    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: { test: 'vitest run' },
      },
      {
        dir: 'packages/b',
        name: 'pkg-b',
        scripts: { test: 'vitest run' },
      },
    ]);

    const opts: TestOptions = { ...parseArgs([]), workspaceFilter: 'pkg-a' };
    const summary = orchestrateTests(root, opts, runner);
    expect(summary.totalWorkspaces).toBe(1);
    expect(commands).toHaveLength(1);
    expect(commands[0].cwd.endsWith(join('packages', 'a'))).toBe(true);
  });

  it('runs script tests by default', () => {
    const { runner, commands } = createRecordingRunner();

    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: { test: 'vitest run' },
      },
    ]);

    mkdirSync(join(root, 'scripts', 'tests'), { recursive: true });
    writeFileSync(
      join(root, 'scripts', 'tests', 'vitest.config.ts'),
      'export default {};',
    );
    writeFileSync(
      join(root, 'scripts', 'tests', 'dummy.test.ts'),
      `import { describe, it, expect } from 'vitest';
describe('dummy', () => { it('passes', () => { expect(1).toBe(1); }); });`,
    );

    orchestrateTests(root, parseArgs([]), runner);
    const scriptTest = commands.find(
      (c) => c.command.includes('vitest') && c.command.includes('scripts'),
    );
    expect(scriptTest).toBeDefined();
  });

  it('skips script tests when --skip-scripts is set', () => {
    const { runner, commands } = createRecordingRunner();

    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: { test: 'vitest run' },
      },
    ]);

    mkdirSync(join(root, 'scripts', 'tests'), { recursive: true });

    const opts: TestOptions = { ...parseArgs([]), skipScripts: true };
    orchestrateTests(root, opts, runner);
    const scriptTest = commands.find((c) => c.command.includes('scripts'));
    expect(scriptTest).toBeUndefined();
  });

  it('reports pretest failure as a separate phase', () => {
    const { runner: failingPretest } = createFailingForRunner(
      'echo pretest',
      'packages/a',
    );

    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: {
          pretest: 'echo pretest',
          test: 'vitest run',
        },
      },
    ]);

    const summary = orchestrateTests(
      root,
      parseArgs(['--skip-scripts']),
      failingPretest,
    );
    const pretestResult = summary.results.find((r) => r.phase === 'pretest');
    expect(pretestResult).toBeDefined();
    expect(pretestResult!.success).toBe(false);
  });

  it('skips test phase when pretest fails (fail-fast)', () => {
    const { runner: failingPretest, commands } = createFailingForRunner(
      'echo pretest',
      'packages/a',
    );

    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: {
          pretest: 'echo pretest',
          test: 'vitest run',
        },
      },
    ]);

    const summary = orchestrateTests(
      root,
      parseArgs(['--skip-scripts']),
      failingPretest,
    );
    const testRan = commands.some((c) => c.command === 'vitest run');
    expect(testRan).toBe(false);
    expect(summary.failed).toBeGreaterThan(0);
    const pretestResult = summary.results.find((r) => r.phase === 'pretest');
    expect(pretestResult).toBeDefined();
    expect(pretestResult!.success).toBe(false);
  });

  it('returns a summary with total counts', () => {
    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: { test: 'vitest run' },
      },
      {
        dir: 'packages/b',
        name: 'pkg-b',
        scripts: { test: 'vitest run' },
      },
    ]);

    const summary = orchestrateTests(
      root,
      parseArgs(['--skip-scripts']),
      succeedingRunner(),
    );
    expect(summary.totalWorkspaces).toBe(2);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('handles workspace with pretest but no test script', () => {
    const { runner, commands } = createRecordingRunner();

    const root = createFixtureRepo([
      {
        dir: 'packages/pretest-only',
        name: 'pkg-pretest-only',
        scripts: { pretest: 'echo pretest' },
      },
      {
        dir: 'packages/normal',
        name: 'pkg-normal',
        scripts: { test: 'vitest run' },
      },
    ]);

    const summary = orchestrateTests(
      root,
      parseArgs(['--skip-scripts']),
      runner,
    );
    // Pretest-only workspace runs its pretest and is counted as passed
    expect(commands.some((c) => c.command === 'echo pretest')).toBe(true);
    expect(summary.passed).toBe(2);
    // Summary counts must be consistent: passed + failed + skipped = total
    expect(summary.passed + summary.failed + summary.skipped).toBe(
      summary.totalWorkspaces,
    );
  });

  it('skips workspace with neither pretest nor test script', () => {
    const { runner } = createRecordingRunner();

    const root = createFixtureRepo([
      {
        dir: 'packages/no-scripts',
        name: 'pkg-no-scripts',
        scripts: { build: 'echo build' },
      },
      {
        dir: 'packages/normal',
        name: 'pkg-normal',
        scripts: { test: 'vitest run' },
      },
    ]);

    const summary = orchestrateTests(
      root,
      parseArgs(['--skip-scripts']),
      runner,
    );
    // No-scripts workspace is skipped; normal workspace passes
    expect(summary.passed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.passed + summary.failed + summary.skipped).toBe(
      summary.totalWorkspaces,
    );
  });
});

describe('formatSummary', () => {
  function makeSummary(overrides: Partial<TestSummary> = {}): TestSummary {
    return {
      results: [],
      totalWorkspaces: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      skippedWorkspaces: [],
      durationMs: 100,
      ...overrides,
    };
  }

  it('formats a passing summary', () => {
    const summary = makeSummary({
      results: [
        {
          workspace: 'pkg-a',
          phase: 'test',
          success: true,
          exitCode: 0,
          durationMs: 50,
        },
      ],
      totalWorkspaces: 1,
      passed: 1,
    });
    const output = formatSummary(summary);
    expect(output).toContain('PASS');
    expect(output).toContain('pkg-a');
  });

  it('formats a failing summary', () => {
    const summary = makeSummary({
      results: [
        {
          workspace: 'pkg-a',
          phase: 'test',
          success: false,
          exitCode: 1,
          durationMs: 50,
        },
      ],
      totalWorkspaces: 1,
      failed: 1,
    });
    const output = formatSummary(summary);
    expect(output).toContain('FAIL');
    expect(output).toContain('pkg-a');
  });

  it('includes duration information', () => {
    const summary = makeSummary({ durationMs: 100 });
    const output = formatSummary(summary);
    expect(output).toMatch(/Duration:.*(?:ms|s)/u);
    expect(output).toMatch(/[0-9]/u);
  });
});
