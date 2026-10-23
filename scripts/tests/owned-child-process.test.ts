/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { describeOwnedChild, runOwnedChild } from './owned-child-process.ts';

const baseOptions = { cwd: process.cwd(), env: process.env, timeoutMs: 30_000 };

describe('runOwnedChild', () => {
  it('reports exit code and both output streams after the child closes', async () => {
    const result = await runOwnedChild(
      process.execPath,
      [
        '-e',
        'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
      ],
      baseOptions,
    );

    expect(result).toStrictEqual({
      exitCode: 3,
      signal: null,
      stdout: 'out',
      stderr: 'err',
      timedOut: false,
    });
  });

  it('drains output larger than a pipe buffer without stalling the child', async () => {
    const size = 2 * 1024 * 1024;
    const result = await runOwnedChild(
      process.execPath,
      ['-e', `process.stdout.write("x".repeat(${size}))`],
      baseOptions,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toHaveLength(size);
  });

  it('kills a child that exceeds its limit and keeps what it printed', async () => {
    const result = await runOwnedChild(
      process.execPath,
      ['-e', 'console.log("started"); setInterval(() => {}, 1000)'],
      { ...baseOptions, timeoutMs: 1_500 },
    );

    expect(result.timedOut).toBe(true);
    expect(result.stdout).toContain('started');
    expect(describeOwnedChild(result)).toContain('timedOut=true');
  });

  it('rejects when the command cannot be spawned', async () => {
    await expect(
      runOwnedChild('llxprt-owned-child-missing-executable', [], baseOptions),
    ).rejects.toThrow('failed to spawn');
  });
});
