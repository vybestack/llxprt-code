/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatFailureReason,
  generateJUnit,
  runTestFile,
  runTestFileWithTimeoutRetry,
  type TestResult,
} from '../../run-bun-tests.js';
import { DEFAULT_PER_FILE_TIMEOUT_MS } from '../../../../scripts/lib/bun-test-policy.js';

/**
 * Derived from the shared policy rather than hardcoded: the assertion is that
 * the reason names the budget that was actually applied, not that the budget
 * has one particular value (issue #3139).
 */
const EXPECTED_TIMEOUT_REASON = `Timed out after ${DEFAULT_PER_FILE_TIMEOUT_MS / 1000}s`;

describe('auth run-bun-tests JUnit failure reporting', () => {
  const baseResult: TestResult = {
    file: 'src/sample.test.ts',
    passed: false,
    exitCode: null,
    timedOut: false,
    signal: null,
  };

  it('identifies signal termination in JUnit failure text', () => {
    const xml = generateJUnit([{ ...baseResult, signal: 'SIGTERM' }], 1, 1);
    expect(xml).toContain('Killed by signal SIGTERM');
  });

  it('reports a nonzero numeric exit code', () => {
    const xml = generateJUnit(
      [{ ...baseResult, exitCode: 1, signal: null }],
      1,
      1,
    );
    expect(xml).toContain('Exit code 1');
  });

  it('reports a timeout', () => {
    const xml = generateJUnit([{ ...baseResult, timedOut: true }], 1, 1);
    expect(xml).toContain(EXPECTED_TIMEOUT_REASON);
  });

  it('falls back to an exit code when neither signal nor timeout is present', () => {
    const xml = generateJUnit(
      [{ ...baseResult, exitCode: null, signal: null, timedOut: false }],
      1,
      1,
    );
    expect(xml).toContain('Exit code -1');
  });
});

describe('auth run-bun-tests failure reason formatting', () => {
  const baseResult: TestResult = {
    file: 'src/sample.test.ts',
    passed: false,
    exitCode: null,
    timedOut: false,
    signal: null,
  };

  it('prioritizes timeout over signal and exit code', () => {
    const reason = formatFailureReason({
      ...baseResult,
      timedOut: true,
      signal: 'SIGTERM',
      exitCode: 1,
    });
    expect(reason).toBe(EXPECTED_TIMEOUT_REASON);
  });

  it('reports a signal before an exit code', () => {
    const reason = formatFailureReason({
      ...baseResult,
      signal: 'SIGKILL',
      exitCode: 1,
    });
    expect(reason).toBe('Killed by signal SIGKILL');
  });

  it('reports a numeric exit code when there is no timeout or signal', () => {
    const reason = formatFailureReason({
      ...baseResult,
      exitCode: 7,
      signal: null,
    });
    expect(reason).toBe('Exit code 7');
  });

  it('falls back to exit code -1 when the exit code is null', () => {
    const reason = formatFailureReason({
      ...baseResult,
      exitCode: null,
      signal: null,
    });
    expect(reason).toBe('Exit code -1');
  });
});

describe('auth run-bun-tests timeout retry', () => {
  it('retries once after a timed-out attempt and returns the passing retry', async () => {
    const outcomes: Array<{ passed: boolean; timedOut: boolean } | undefined> =
      [
        { passed: false, timedOut: true },
        { passed: true, timedOut: false },
      ];
    let attempts = 0;
    const logs: string[] = [];

    const result = await runTestFileWithTimeoutRetry(
      'src/freeze.test.ts',
      async () => {
        const outcome = outcomes[attempts];
        if (outcome === undefined) {
          throw new Error(`unexpected attempt ${attempts + 1}`);
        }
        attempts++;
        return outcome;
      },
      (message) => logs.push(message),
    );

    expect({ result, attempts, logs }).toStrictEqual({
      result: { passed: true, timedOut: false },
      attempts: 2,
      logs: ['RETRY (2/2): src/freeze.test.ts after per-file timeout'],
    });
  });

  it('returns a non-timeout failure after a single attempt', async () => {
    let attempts = 0;
    const logs: string[] = [];

    const result = await runTestFileWithTimeoutRetry(
      'src/assertion.test.ts',
      async () => {
        attempts++;
        return { passed: false, timedOut: false };
      },
      (message) => logs.push(message),
    );

    expect({ result, attempts, logs }).toStrictEqual({
      result: { passed: false, timedOut: false },
      attempts: 1,
      logs: [],
    });
  });

  it('returns the second timeout as the final failure', async () => {
    let attempts = 0;

    const result = await runTestFileWithTimeoutRetry(
      'src/hang.test.ts',
      async () => {
        attempts++;
        return { passed: false, timedOut: true };
      },
      () => undefined,
    );

    expect({ result, attempts }).toStrictEqual({
      result: { passed: false, timedOut: true },
      attempts: 2,
    });
  });
});

const isWindows = process.platform === 'win32';
const testDirectory = dirname(fileURLToPath(import.meta.url));

describe('auth run-bun-tests real child signal propagation', () => {
  describe.skipIf(isWindows)(() => {
    it('carries a real SIGTERM child exit into the result and JUnit failure text', async () => {
      const fixturePath = join(
        testDirectory,
        '../../test-fixtures/self-sigterm.fixture.ts',
      );
      const result = await runTestFile(fixturePath);

      expect(result.signal).toBe('SIGTERM');
      expect(result.passed).toBe(false);

      const xml = generateJUnit([result], 1, 1);
      expect(xml).toContain('Killed by signal SIGTERM');
    });
  });
});
