/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanupScenarioProcessGroup } from '../interactive-ui-process-group.ts';

it('kills the scenario group after its harness is terminated', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ui-process-group-'));
  const runner = spawn(
    process.execPath,
    [
      path.resolve('scripts/interactive-ui-process-group.ts'),
      directory,
      'sleep 120 & wait',
    ],
    { stdio: 'ignore' },
  );
  try {
    const file = path.join(directory, 'scenario-pgid');
    for (let index = 0; index < 100 && !existsSync(file); index++)
      await Bun.sleep(20);
    const pid = Number(readFileSync(file, 'utf8'));
    expect(pid).toBeGreaterThan(1);
    process.kill(-pid, 0);
    runner.kill('SIGKILL');
    cleanupScenarioProcessGroup(directory);
    for (let index = 0; index < 100; index++) {
      try {
        process.kill(-pid, 0);
      } catch {
        break;
      }
      await Bun.sleep(20);
    }
    expect(() => process.kill(-pid, 0)).toThrow();
    cleanupScenarioProcessGroup(directory);
  } finally {
    runner.kill('SIGKILL');
    cleanupScenarioProcessGroup(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

it('records a nonzero scenario exit instead of treating a dead pane as success', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ui-process-exit-'));
  const runner = spawn(
    process.execPath,
    [
      path.resolve('scripts/interactive-ui-process-group.ts'),
      directory,
      'exit 17',
    ],
    { stdio: 'ignore' },
  );
  try {
    const exit = await new Promise<number | null>((resolve) =>
      runner.once('exit', resolve),
    );
    expect(exit).toBe(17);
    expect(
      readFileSync(path.join(directory, 'scenario-exit-code'), 'utf8'),
    ).toBe('17');
    expect(existsSync(path.join(directory, 'scenario-pgid'))).toBe(false);
  } finally {
    runner.kill('SIGKILL');
    cleanupScenarioProcessGroup(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});
