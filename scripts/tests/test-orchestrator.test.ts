/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  discoverWorkspaces,
  parseArgs,
  type CommandRunner,
  type TestOptions,
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

function failingRunner(): CommandRunner {
  return () => ({ success: false, exitCode: 1 });
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

  it('detects the pretest script in the agents package', () => {
    const workspaces = discoverWorkspaces(repoRoot);
    const agents = workspaces.find(
      (w) => w.name === '@vybestack/llxprt-code-agents',
    );
    expect(agents).toBeDefined();
    expect(agents!.hasPretest).toBe(true);
    expect(agents!.pretestScript).toContain('check-agents-api-surface');
  });

  it('detects test scripts in all workspaces', () => {
    const workspaces = discoverWorkspaces(repoRoot);
    for (const ws of workspaces) {
      expect(ws.hasTest, `${ws.name} should have a test script`).toBe(true);
    }
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
      expect(ws.relativePath).toMatch(/^packages\//);
      expect(resolve(repoRoot, ws.relativePath)).toBe(ws.absolutePath);
    }
  });

  it('reads workspace names from package.json', () => {
    const workspaces = discoverWorkspaces(repoRoot);
    const names = workspaces.map((w) => w.name);
    expect(names).toContain('@vybestack/llxprt-code-core');
    expect(names).toContain('@vybestack/llxprt-code-agents');
    expect(names).toContain('@vybestack/llxprt-code-tools');
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

  it('ignores unknown arguments', () => {
    const opts = parseArgs(['--unknown-flag', '--workspace', 'tools']);
    expect(opts.workspaceFilter).toBe('tools');
  });

  it('throws when --workspace has no value', () => {
    expect(() => parseArgs(['--workspace'])).toThrow(
      '--workspace requires a value',
    );
  });

  it('throws when -w shorthand has no value', () => {
    expect(() => parseArgs(['-w'])).toThrow('--workspace requires a value');
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
      if (command === failCommand && cwd.endsWith(failCwdSuffix)) {
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
    expect(summary.passed).toBe(2);
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
    const ranB = commands.some((c) => c.cwd.endsWith('packages/b'));
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
    const ranB = commands.some((c) => c.cwd.endsWith('packages/b'));
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
    expect(commands[0].cwd.endsWith('packages/b')).toBe(true);
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
    expect(commands[0].cwd.endsWith('packages/a')).toBe(true);
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

    orchestrateTests(root, parseArgs(['--skip-scripts']), failingPretest);
    const testRan = commands.some((c) => c.command === 'vitest run');
    expect(testRan).toBe(false);
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
});

describe('formatSummary', () => {
  it('formats a passing summary', () => {
    const summary = orchestrateTests(
      createFixtureRepo([
        {
          dir: 'packages/a',
          name: 'pkg-a',
          scripts: { test: 'vitest run' },
        },
      ]),
      parseArgs(['--skip-scripts']),
      succeedingRunner(),
    );
    const output = formatSummary(summary);
    expect(output).toContain('PASS');
    expect(output).toContain('pkg-a');
  });

  it('formats a failing summary', () => {
    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: { test: 'vitest run' },
      },
    ]);
    const summary = orchestrateTests(
      root,
      parseArgs(['--skip-scripts']),
      failingRunner(),
    );
    const output = formatSummary(summary);
    expect(output).toContain('FAIL');
    expect(output).toContain('pkg-a');
  });

  it('includes duration information', () => {
    const root = createFixtureRepo([
      {
        dir: 'packages/a',
        name: 'pkg-a',
        scripts: { test: 'vitest run' },
      },
    ]);
    const summary = orchestrateTests(
      root,
      parseArgs(['--skip-scripts']),
      succeedingRunner(),
    );
    const output = formatSummary(summary);
    expect(output).toMatch(/Duration:.*(?:ms|s)/u);
    expect(output).toMatch(/[0-9]/u);
  });
});
