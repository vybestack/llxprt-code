/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Contract tests for the owner marker `scripts/run_bun_tests.ts` appends to
 * every `bun test` it spawns (issue #3514). The pre-run reaper only acts on
 * orphans carrying this checkout's marker, so the marker's shape and its
 * agreement with the reaper are an external contract of the runner.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveTsconfigOverride,
  runBunTests,
  type BunGlobalSetupModule,
  type BunTestRunnerDependencies,
  type ChildExitInfo,
} from '../run_bun_tests.js';
import { RealHomeSentinelGuard } from '../lib/real-home-sentinel.js';
import { reapStaleBunTestProcesses } from '../lib/bun-test-reaper.js';

const OWNER_MARKER_PATTERN = /^llxprt-bun-runner-owner-[0-9a-f]{16}$/;

/** Global setup loader stub for runs whose entries declare none. */
const noGlobalSetup = async (): Promise<BunGlobalSetupModule> => ({});

interface RunnerEntry {
  readonly cwd: string;
  readonly file: string;
  readonly retries?: number;
}

/** Runs one entry under `repoRoot` and returns the argv of every spawn. */
async function spawnedCommands(
  repoRoot: string,
  entry: RunnerEntry,
  outcomes: readonly ChildExitInfo[],
): Promise<ReadonlyArray<readonly string[]>> {
  const commands: Array<readonly string[]> = [];
  const dependencies: BunTestRunnerDependencies = {
    repoRoot,
    invocationDirectory: '/invoke',
    executable: '/bin/bun',
    environment: {},
    resolveFiles: () => [{ ...entry, preloads: [] }],
    resolveTsconfig: resolveTsconfigOverride,
    createSentinelGuard: () => new RealHomeSentinelGuard({ targets: [] }),
    spawn: (command): ChildExitInfo => {
      commands.push(command);
      return outcomes[commands.length - 1] ?? { exitCode: 0, signalCode: null };
    },
    loadGlobalSetup: noGlobalSetup,
    stdout: () => {},
    stderr: () => {},
  };
  await runBunTests([], dependencies);
  return commands;
}

interface OrphanProcess {
  readonly spawnSync: (cmd: readonly string[]) => { stdout: string | null };
  readonly kill: (pid: number, signal: string | number) => void;
  readonly alive: () => boolean;
}

/** A minimal `ps` and `kill` pair over one orphan running `command`. */
function orphanRunning(command: readonly string[]): OrphanProcess {
  let alive = true;
  const psOutput = (cmd: readonly string[]): string => {
    if (!alive) return '';
    if (cmd.some((arg) => arg.includes('comm='))) return '  500 /bin/bun';
    return `  500  1  ${command.join(' ')}`;
  };
  return {
    spawnSync: (cmd): { stdout: string | null } => ({
      stdout: psOutput(cmd),
    }),
    kill: (_pid, signal): void => {
      if (!alive) {
        throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
      }
      if (signal === 'SIGTERM') alive = false;
    },
    alive: (): boolean => alive,
  };
}

function entryAt(root: string): RunnerEntry {
  return { cwd: `${root}/ws`, file: `${root}/ws/a.test.ts` };
}

describe('runner ownership marker (#3514)', () => {
  it('ends every spawn, retries included, with the same owner marker after the test file', async () => {
    const commands = await spawnedCommands(
      '/checkout-a',
      { ...entryAt('/checkout-a'), retries: 2 },
      [
        { exitCode: 1, signalCode: null },
        { exitCode: 1, signalCode: null },
        { exitCode: 0, signalCode: null },
      ],
    );

    expect(commands).toHaveLength(3);
    for (const command of commands) {
      expect(command.at(-2)).toBe('/checkout-a/ws/a.test.ts');
      expect(command.at(-1)).toMatch(OWNER_MARKER_PATTERN);
    }
    expect(new Set(commands.map((command) => command.at(-1))).size).toBe(1);
  });

  it('derives a different owner marker for each checkout root and a stable one for the same root', async () => {
    const [a, repeatA, b] = await Promise.all([
      spawnedCommands('/checkout-a', entryAt('/checkout-a'), []),
      spawnedCommands('/checkout-a', entryAt('/checkout-a'), []),
      spawnedCommands('/checkout-b', entryAt('/checkout-b'), []),
    ]);

    expect(a.at(0)?.at(-1)).toMatch(OWNER_MARKER_PATTERN);
    expect(b.at(0)?.at(-1)).toMatch(OWNER_MARKER_PATTERN);
    expect(a.at(0)?.at(-1)).toBe(repeatA.at(0)?.at(-1));
    expect(a.at(0)?.at(-1)).not.toBe(b.at(0)?.at(-1));
  });

  it('spawns argv that the reaper accepts for the same checkout and rejects for another', async () => {
    const commandsA = await spawnedCommands(
      '/checkout-a',
      entryAt('/checkout-a'),
      [],
    );
    const commandsB = await spawnedCommands(
      '/checkout-b',
      entryAt('/checkout-b'),
      [],
    );
    const commandA = commandsA.at(0);
    const tokenA = commandA?.at(-1);
    const tokenB = commandsB.at(0)?.at(-1);
    expect(commandA).toBeDefined();
    expect(tokenA).toMatch(OWNER_MARKER_PATTERN);
    expect(tokenB).toMatch(OWNER_MARKER_PATTERN);

    const sameCheckout = orphanRunning(commandA ?? []);
    const reapedBySame = reapStaleBunTestProcesses(
      sameCheckout.spawnSync,
      sameCheckout.kill,
      99999,
      tokenA ?? '',
      () => {},
    );
    const otherCheckout = orphanRunning(commandA ?? []);
    const reapedByOther = reapStaleBunTestProcesses(
      otherCheckout.spawnSync,
      otherCheckout.kill,
      99999,
      tokenB ?? '',
      () => {},
    );

    expect({
      reapedBySame,
      sameAlive: sameCheckout.alive(),
      reapedByOther,
      otherAlive: otherCheckout.alive(),
    }).toEqual({
      reapedBySame: 1,
      sameAlive: false,
      reapedByOther: 0,
      otherAlive: true,
    });
  });

  it('lets a real bun test run exactly the absolute test file, treating the marker as no extra test selection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bun-runner-marker-'));
    try {
      const file = join(dir, 'selected.test.ts');
      writeFileSync(
        file,
        "import { it, expect } from 'bun:test';\nit('selected', () => { expect(1).toBe(1); });\n",
      );
      writeFileSync(
        join(dir, 'sibling.test.ts'),
        "import { it, expect } from 'bun:test';\nit('sibling', () => { expect(1).toBe(2); });\n",
      );
      const childOutput: string[] = [];
      const dependencies: BunTestRunnerDependencies = {
        repoRoot: dir,
        invocationDirectory: dir,
        executable: process.execPath,
        environment: process.env,
        resolveFiles: () => [{ cwd: dir, file, preloads: [] }],
        resolveTsconfig: resolveTsconfigOverride,
        createSentinelGuard: () => new RealHomeSentinelGuard({ targets: [] }),
        spawn: (command, options): ChildExitInfo => {
          const result = Bun.spawnSync({
            cmd: [...command],
            cwd: options.cwd,
            env: options.env,
            stdout: 'pipe',
            stderr: 'pipe',
          });
          const output = `${result.stdout.toString()}${result.stderr.toString()}`;
          childOutput.push(output);
          return {
            exitCode: result.exitCode,
            signalCode: null,
            stdout: output,
          };
        },
        loadGlobalSetup: noGlobalSetup,
        stdout: () => {},
        stderr: () => {},
      };

      const status = await runBunTests([], dependencies);

      expect(status).toBe(0);
      expect(childOutput).toHaveLength(1);
      expect(childOutput[0]).toContain('Ran 1 test across 1 file.');
      expect(childOutput[0]).not.toContain('sibling');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
