/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs, type CommandRunner, orchestrateTests } from '../test.ts';

// Shared recording runner factory; the identical helper in
// test-orchestrator.test.ts serves that file's own describe blocks. Kept
// local (not imported) to avoid coupling the two test files' setup paths.
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

const fixtures: string[] = [];

afterAll(() => {
  while (fixtures.length > 0) {
    const dir = fixtures.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      // Best-effort cleanup; surface the path so a failed cleanup is diagnosable.
      console.warn(`Failed to clean up fixture ${dir}: ${err}`);
    }
  }
});

interface FixtureWorkspace {
  dir: string;
  name: string;
  scripts: Record<string, string>;
}

function createFixtureRepo(workspaces: FixtureWorkspace[]): string {
  const root = mkdtempSync(join(tmpdir(), 'test-shard-'));
  fixtures.push(root);

  const wsGlobs = workspaces.map((w) => w.dir);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'root', workspaces: wsGlobs }, null, 2),
  );

  for (const ws of workspaces) {
    mkdirSync(join(root, ws.dir), { recursive: true });
    writeFileSync(
      join(root, ws.dir, 'package.json'),
      JSON.stringify({ name: ws.name, scripts: ws.scripts }, null, 2),
    );
  }
  return root;
}

describe('parseArgs (--shard)', () => {
  it('parses --shard with a value', () => {
    const opts = parseArgs(['--shard', 'cli']);
    expect(opts.shardFilter).toBe('cli');
  });

  it('parses -s shorthand for --shard', () => {
    const opts = parseArgs(['-s', 'core']);
    expect(opts.shardFilter).toBe('core');
  });

  it('throws when --shard has no value', () => {
    expect(() => parseArgs(['--shard'])).toThrow(/requires a value/u);
  });

  it('parses --shard alongside other flags', () => {
    const opts = parseArgs(['--shard', 'rest', '--skip-pretest']);
    expect(opts.shardFilter).toBe('rest');
    expect(opts.skipPretest).toBe(true);
  });
});

describe('orchestrateTests (--shard)', () => {
  // Fixture covering the multi-workspace "rest" shard members so shard
  // expansion can be verified against real ids in the canonical map.
  function createRestFixture(): string {
    return createFixtureRepo([
      {
        dir: 'packages/tools',
        name: '@scope/tools',
        scripts: { test: 'vitest run' },
      },
      {
        dir: 'packages/mcp',
        name: '@scope/mcp',
        scripts: { test: 'vitest run' },
      },
      {
        dir: 'packages/cli',
        name: '@scope/cli',
        scripts: { test: 'vitest run' },
      },
    ]);
  }

  it('runs only the workspaces in a named shard', () => {
    const { runner, commands } = createRecordingRunner();
    const fixtureRoot = createRestFixture();

    const summary = orchestrateTests(
      fixtureRoot,
      { ...parseArgs(['--shard', 'rest']), skipScripts: true },
      runner,
    );

    // The "rest" shard expands to tools, mcp, ... (12 ids). The fixture only
    // contains tools, mcp, and cli. Only tools + mcp are in the rest shard;
    // cli is in its own shard, so it must NOT run here.
    const ranNames = commands.map((c) => c.cwd);
    expect(ranNames.some((n) => n.includes('tools'))).toBe(true);
    expect(ranNames.some((n) => n.includes('mcp'))).toBe(true);
    expect(ranNames.some((n) => n.includes('cli'))).toBe(false);
    expect(summary.passed).toBe(2);
  });

  it('does not run the script harness for a workspace shard', () => {
    const { runner, commands } = createRecordingRunner();
    const fixtureRoot = createFixtureRepo([
      {
        dir: 'packages/cli',
        name: '@scope/cli',
        scripts: { test: 'vitest run' },
      },
    ]);

    // Provide a scripts/tests config so runScriptTests cannot early-return
    // due to a missing config. This ensures the test specifically validates
    // the runScriptsPhase gate for the cli shard, not a coincidental absence.
    mkdirSync(join(fixtureRoot, 'scripts', 'tests'), { recursive: true });
    writeFileSync(
      join(fixtureRoot, 'scripts', 'tests', 'dummy.test.ts'),
      'export default {};',
    );

    orchestrateTests(fixtureRoot, { ...parseArgs(['--shard', 'cli']) }, runner);

    // No scripts/tests invocation for a workspace shard.
    const scriptsCommand = commands.find((c) =>
      c.command.includes('--root scripts-tests'),
    );
    expect(scriptsCommand).toBeUndefined();
  });

  it('runs only the script harness for the scripts shard', () => {
    const { runner, commands } = createRecordingRunner();
    // Even with workspaces present, the scripts shard runs no workspace tests.
    const fixtureRoot = createFixtureRepo([
      {
        dir: 'packages/cli',
        name: '@scope/cli',
        scripts: { test: 'vitest run' },
      },
    ]);

    // Provide a scripts/tests config so runScriptTests does not early-return.
    mkdirSync(join(fixtureRoot, 'scripts', 'tests'), { recursive: true });
    writeFileSync(
      join(fixtureRoot, 'scripts', 'tests', 'dummy.test.ts'),
      'export default {};',
    );

    const summary = orchestrateTests(
      fixtureRoot,
      { ...parseArgs(['--shard', 'scripts']) },
      runner,
    );

    const scriptsCommand = commands.find((c) =>
      c.command.includes('--root scripts-tests'),
    );
    expect(scriptsCommand).toBeDefined();
    // No workspace test command ran.
    const wsTest = commands.find((c) => c.command === 'vitest run');
    expect(wsTest).toBeUndefined();
    expect(summary.totalWorkspaces).toBe(0);
  });

  it('throws on an unknown shard name', () => {
    const { runner } = createRecordingRunner();
    const fixtureRoot = createFixtureRepo([]);
    expect(() =>
      orchestrateTests(
        fixtureRoot,
        { ...parseArgs(['--shard', 'ghost']) },
        runner,
      ),
    ).toThrow(/Unknown shard "ghost"/u);
  });

  it('--shard takes precedence over --workspace', () => {
    const { runner, commands } = createRecordingRunner();
    const fixtureRoot = createFixtureRepo([
      {
        dir: 'packages/tools',
        name: '@scope/tools',
        scripts: { test: 'vitest run' },
      },
      {
        dir: 'packages/cli',
        name: '@scope/cli',
        scripts: { test: 'vitest run' },
      },
    ]);

    orchestrateTests(
      fixtureRoot,
      {
        ...parseArgs(['--workspace', 'cli', '--shard', 'rest']),
        skipScripts: true,
      },
      runner,
    );

    // rest shard includes tools but not cli; shard wins over the workspace
    // filter, so only tools runs.
    const ranNames = commands.map((c) => c.cwd);
    expect(ranNames.some((n) => n.includes('tools'))).toBe(true);
    expect(ranNames.some((n) => n.includes('cli'))).toBe(false);
  });

  it('records a failed scripts phase without marking a workspace failed', () => {
    // The scripts shard runs only the harness. A harness failure must appear
    // in summary.results as a failed scripts phase but must NOT inflate the
    // workspace failed count (there are no workspaces). This guards the
    // main() exit-code fix that checks anyPhaseFailed separately.
    const failingRunner: CommandRunner = (command, _cwd) => {
      if (command.includes('--root scripts-tests')) {
        return { success: false, exitCode: 1 };
      }
      return { success: true, exitCode: 0 };
    };
    const fixtureRoot = createFixtureRepo([
      {
        dir: 'packages/cli',
        name: '@scope/cli',
        scripts: { test: 'vitest run' },
      },
    ]);
    mkdirSync(join(fixtureRoot, 'scripts', 'tests'), { recursive: true });
    writeFileSync(
      join(fixtureRoot, 'scripts', 'tests', 'dummy.test.ts'),
      'export default {};',
    );

    const summary = orchestrateTests(
      fixtureRoot,
      { ...parseArgs(['--shard', 'scripts']) },
      failingRunner,
    );

    // No workspace ran, so passed/failed are both 0.
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.totalWorkspaces).toBe(0);
    // But the scripts phase failed — the caller (main) must check results.
    const scriptsResult = summary.results.find((r) => r.phase === 'scripts');
    expect(scriptsResult).toBeDefined();
    expect(scriptsResult!.success).toBe(false);
    expect(summary.results.some((r) => !r.success)).toBe(true);
  });

  // Issue #2780: the long-running release-install smoke test
  // (issue-2603-release-install.test.ts) must run as a SEPARATE Bun-native
  // root, so the far larger timeout it needs does not weaken the budget that
  // catches genuine hangs in the rest of the script harness.
  it('runs the release-install smoke test as a separate root invocation', () => {
    const { runner, commands } = createRecordingRunner();

    const fixtureRoot = createFixtureRepo([
      {
        dir: 'packages/cli',
        name: '@scope/cli',
        scripts: { test: 'vitest run' },
      },
    ]);
    mkdirSync(join(fixtureRoot, 'scripts', 'tests'), { recursive: true });
    writeFileSync(
      join(fixtureRoot, 'scripts', 'tests', 'dummy.test.ts'),
      'export default {};',
    );

    orchestrateTests(
      fixtureRoot,
      { ...parseArgs(['--shard', 'scripts']) },
      runner,
    );

    const scriptsCommands = commands.filter((c) =>
      c.command.includes('--root scripts-tests'),
    );
    // Two invocations: the fast script harness and a dedicated invocation for
    // the release-install smoke, which needs a far larger time budget.
    expect(scriptsCommands).toHaveLength(2);
    expect(
      scriptsCommands.some((c) => c.command.endsWith('--root scripts-tests')),
    ).toBe(true);
    expect(
      scriptsCommands.some((c) =>
        c.command.endsWith('--root scripts-tests-slow'),
      ),
    ).toBe(true);
  });

  it('skips the release-install smoke invocation when the main scripts suite fails', () => {
    const commands: Array<{ command: string; cwd: string }> = [];
    const runner: CommandRunner = (command, cwd) => {
      commands.push({ command, cwd });
      // Fail only the fast script harness; pass everything else so the slow
      // invocation is the only thing that could still run.
      if (command.endsWith('--root scripts-tests')) {
        return { success: false, exitCode: 1 };
      }
      return { success: true, exitCode: 0 };
    };

    const fixtureRoot = createFixtureRepo([
      {
        dir: 'packages/cli',
        name: '@scope/cli',
        scripts: { test: 'vitest run' },
      },
    ]);
    mkdirSync(join(fixtureRoot, 'scripts', 'tests'), { recursive: true });
    writeFileSync(
      join(fixtureRoot, 'scripts', 'tests', 'dummy.test.ts'),
      'export default {};',
    );

    orchestrateTests(
      fixtureRoot,
      { ...parseArgs(['--shard', 'scripts']) },
      runner,
    );

    // The slow smoke invocation must NOT run when the main suite failed
    // (fail-fast semantics).
    const slowCommand = commands.filter((c) =>
      c.command.endsWith('--root scripts-tests-slow'),
    );
    expect(slowCommand).toHaveLength(0);
  });
});
