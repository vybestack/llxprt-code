/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runBunTests,
  type BunTestRunnerDependencies,
} from '../run_bun_tests.js';
import { RealHomeSentinelGuard } from '../lib/real-home-sentinel.js';

describe('shared runner timeout retry environment timing', () => {
  let fixture: string;
  let originalBudget: string | undefined;

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), 'retry-env-timing-'));
    originalBudget = process.env['LLXPRT_BUN_TEST_TIMEOUT_RETRIES'];
  });

  afterEach(() => {
    if (originalBudget === undefined) {
      delete process.env['LLXPRT_BUN_TEST_TIMEOUT_RETRIES'];
    } else {
      process.env['LLXPRT_BUN_TEST_TIMEOUT_RETRIES'] = originalBudget;
    }
    rmSync(fixture, { recursive: true, force: true });
  });

  function dependencies(childBudget: string): BunTestRunnerDependencies {
    return {
      repoRoot: fixture,
      invocationDirectory: fixture,
      executable: process.execPath,
      environment: { LLXPRT_BUN_TEST_TIMEOUT_RETRIES: childBudget },
      resolveFiles: () => [
        { cwd: fixture, file: join(fixture, 'case.test.ts'), preloads: [] },
      ],
      resolveTsconfig: () => {
        throw new Error('No tsconfig override expected');
      },
      createSentinelGuard: () => new RealHomeSentinelGuard({ targets: [] }),
      loadGlobalSetup: async () => ({}),
      spawn: () => {
        appendFileSync(join(fixture, 'attempts.txt'), 'attempt\n');
        process.env['LLXPRT_BUN_TEST_TIMEOUT_RETRIES'] = '1';
        return { exitCode: null, signalCode: 'SIGTERM' };
      },
      stdout: () => {},
      stderr: () => {},
    };
  }

  it('rejects invalid runner env before the first attempt can repair it', async () => {
    process.env['LLXPRT_BUN_TEST_TIMEOUT_RETRIES'] = 'invalid';

    await expect(runBunTests([], dependencies('0'))).rejects.toThrow(
      'Invalid LLXPRT_BUN_TEST_TIMEOUT_RETRIES value: invalid (expected a non-negative integer)',
    );

    expect(existsSync(join(fixture, 'attempts.txt'))).toBe(false);
  });

  it('keeps zero runner budget despite child env and first-attempt mutation', async () => {
    process.env['LLXPRT_BUN_TEST_TIMEOUT_RETRIES'] = '0';

    expect(await runBunTests([], dependencies('1'))).toBe(1);

    expect(readFileSync(join(fixture, 'attempts.txt'), 'utf8')).toBe(
      'attempt\n',
    );
  });

  it('uses valid runner budget rather than invalid dependency env', async () => {
    process.env['LLXPRT_BUN_TEST_TIMEOUT_RETRIES'] = '1';

    expect(await runBunTests([], dependencies('invalid'))).toBe(1);

    expect(readFileSync(join(fixture, 'attempts.txt'), 'utf8')).toBe(
      'attempt\nattempt\n',
    );
  });
});
