/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  spawnRun,
  spawnRunWithTimeout,
  type RunCapture,
  type RunContext,
} from './process-run.js';

const tempDirs: string[] = [];
const SPAWN_TIMEOUT_MS = 1500;

afterEach(() => {
  const dirs = tempDirs.slice();
  tempDirs.length = 0;
  const errors: unknown[] = [];
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      'Failed to clean process-run test directories',
    );
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'process-run-test-'));
  tempDirs.push(dir);
  return dir;
}

function bunContext(code: string, cwd: string): RunContext {
  return {
    command: 'bun',
    commandArgs: ['-e', code],
    testDir: cwd,
  };
}

const identityTransform = (stdout: string): string => stdout;

async function expectRejection(
  promise: Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new Error(`Expected Error, received ${String(error)}`);
    }
    expect(error.message).toMatch(pattern);
  }
}

describe('process run capture', () => {
  it('reports separate stdout and stderr before resolving JSON output', async () => {
    let capture: RunCapture | undefined;
    const result = await spawnRun(
      bunContext(
        'process.stdout.write("hello out"); process.stderr.write("hello err");',
        makeTempDir(),
      ),
      {},
      true,
      identityTransform,
      (value) => {
        capture = value;
      },
    );

    expect(result).toBe('hello out');
    expect(capture).toEqual({
      stdout: 'hello out',
      stderr: 'hello err',
      exitCode: 0,
      timedOut: false,
    });
  });

  it('preserves the existing plain-text stderr append behavior', async () => {
    const result = await spawnRun(
      bunContext('process.stderr.write("warn line");', makeTempDir()),
      {},
      false,
      identityTransform,
    );

    expect(result).toContain('warn line');
    expect(result).toMatch(/StdErr:/);
  });

  it('reports partial streams for a nonzero exit', async () => {
    let capture: RunCapture | undefined;
    const run = spawnRun(
      bunContext(
        'process.stdout.write("partial out"); process.stderr.write("partial err"); process.exit(3);',
        makeTempDir(),
      ),
      {},
      false,
      identityTransform,
      (value) => {
        capture = value;
      },
    );

    await expectRejection(run, /code 3/);
    expect(capture).toEqual({
      stdout: 'partial out',
      stderr: 'partial err',
      exitCode: 3,
      timedOut: false,
    });
  });

  it('captures a timed-out run that exits gracefully after SIGTERM', async () => {
    let capture: RunCapture | undefined;
    const run = spawnRunWithTimeout(
      bunContext(
        [
          'process.on("SIGTERM", () => {',
          '  process.stdout.write(" graceful-out");',
          '  process.stderr.write("graceful-err");',
          '  process.exit(0);',
          '});',
          'process.stdout.write("started");',
          'setInterval(() => {}, 1000);',
        ].join('\n'),
        makeTempDir(),
      ),
      {},
      false,
      identityTransform,
      SPAWN_TIMEOUT_MS,
      (value) => {
        capture = value;
      },
    );

    await expectRejection(run, /timed out/);
    expect(capture).toEqual({
      stdout: 'started graceful-out',
      stderr: 'graceful-err',
      exitCode: 0,
      timedOut: true,
    });
  });

  it('captures shutdown output and force-kills a run that ignores SIGTERM', async () => {
    let capture: RunCapture | undefined;
    const run = spawnRunWithTimeout(
      bunContext(
        [
          'process.on("SIGTERM", () => {',
          '  process.stdout.write(" shutdown-out");',
          '  process.stderr.write("shutdown-err");',
          '});',
          'process.stdout.write("started");',
          'setInterval(() => {}, 1000);',
        ].join('\n'),
        makeTempDir(),
      ),
      {},
      false,
      identityTransform,
      SPAWN_TIMEOUT_MS,
      (value) => {
        capture = value;
      },
    );

    await expectRejection(run, /timed out/);
    expect(capture).toEqual({
      stdout: 'started shutdown-out',
      stderr: 'shutdown-err',
      exitCode: null,
      timedOut: true,
    });
  });

  it('preserves process and capture failures together', async () => {
    const processErrorPattern = /code 3/;
    const captureError = new Error('capture handler failed');
    const run = spawnRun(
      bunContext('process.exit(3);', makeTempDir()),
      {},
      false,
      identityTransform,
      () => {
        throw captureError;
      },
    );

    try {
      await run;
      throw new Error('Expected promise to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      const aggregate = error as AggregateError;
      expect(aggregate.errors).toHaveLength(2);
      expect((aggregate.errors[0] as Error).message).toMatch(
        processErrorPattern,
      );
      expect(aggregate.errors[1]).toBe(captureError);
    }
  });

  it('captures and rejects child-process spawn errors', async () => {
    let capture: RunCapture | undefined;
    const run = spawnRun(
      {
        command: join(makeTempDir(), 'missing-command'),
        commandArgs: [],
        testDir: makeTempDir(),
      },
      {},
      false,
      identityTransform,
      (value) => {
        capture = value;
      },
    );

    await expectRejection(run, /ENOENT/);
    expect(capture).toEqual({
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
    });
  });

  it('rejects instead of throwing when a capture handler fails', async () => {
    const run = spawnRun(
      bunContext('process.stdout.write("captured");', makeTempDir()),
      {},
      true,
      identityTransform,
      () => {
        throw new Error('capture handler failed');
      },
    );

    await expectRejection(run, /capture handler failed/);
  });

  it('isolates capture handler failures in timeout-managed runs', async () => {
    const run = spawnRunWithTimeout(
      bunContext('process.stdout.write("captured");', makeTempDir()),
      {},
      true,
      identityTransform,
      SPAWN_TIMEOUT_MS * 4,
      () => {
        throw new Error('timeout capture handler failed');
      },
    );

    await expectRejection(run, /timeout capture handler failed/);
  });

  it('keeps concurrent run captures isolated by callback', async () => {
    let firstCapture: RunCapture | undefined;
    let secondCapture: RunCapture | undefined;

    await Promise.all([
      spawnRun(
        bunContext('process.stdout.write("first");', makeTempDir()),
        {},
        true,
        identityTransform,
        (value) => {
          firstCapture = value;
        },
      ),
      spawnRun(
        bunContext('process.stdout.write("second");', makeTempDir()),
        {},
        true,
        identityTransform,
        (value) => {
          secondCapture = value;
        },
      ),
    ]);

    expect(firstCapture?.stdout).toBe('first');
    expect(secondCapture?.stdout).toBe('second');
  });
});
