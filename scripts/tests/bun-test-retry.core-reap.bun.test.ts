/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  runCoreTimeoutRetry,
  type CoreRetryOutcome,
} from '../lib/bun-test-retry.js';

describe('core timeout retry reap ownership', () => {
  it('names an unconfirmed first tree when the failed reap carried no message', async () => {
    const outcomes: CoreRetryOutcome[] = [
      { passed: false, timedOut: true, timeoutMs: 30, reapFailed: true },
      { passed: true, timedOut: false, timeoutMs: 30, reapFailed: false },
    ];
    let index = 0;
    const result = await runCoreTimeoutRetry(
      'core.ts',
      async () => outcomes[index++]!,
      () => {},
    );
    expect(result).toEqual({
      passed: false,
      timedOut: true,
      timeoutMs: 30,
      reapFailed: true,
      reapError: 'first attempt process tree was not confirmed closed',
    });
  });
  it('reports both reap failures when neither attempt closed its tree', async () => {
    const outcomes = [
      {
        passed: false,
        timedOut: true,
        timeoutMs: 30,
        reapFailed: true,
        reapError: 'first reap',
      },
      {
        passed: false,
        timedOut: true,
        timeoutMs: 30,
        reapFailed: true,
        reapError: 'second reap',
      },
    ];
    let index = 0;
    const result = await runCoreTimeoutRetry(
      'core.ts',
      async () => outcomes[index++]!,
      () => {},
    );
    expect(result.reapFailed).toBe(true);
    expect(result.reapError).toBe('first reap; second reap');
  });
  it('keeps a second attempt reap failure when the first tree reaped cleanly', async () => {
    const outcomes = [
      { passed: false, timedOut: true, timeoutMs: 30, reapFailed: false },
      {
        passed: false,
        timedOut: true,
        timeoutMs: 30,
        reapFailed: true,
        reapError: 'second reap',
      },
    ];
    let index = 0;
    const result = await runCoreTimeoutRetry(
      'core.ts',
      async () => outcomes[index++]!,
      () => {},
    );
    expect(result).toEqual(outcomes[1]);
  });
});
