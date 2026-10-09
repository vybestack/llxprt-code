/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import * as agents from '../../packages/agents/run-bun-tests.js';
import * as cli from '../../packages/cli/run-bun-tests.js';

const childAcceptance = 'src/core/__tests__/childaccept-memory.test.ts';
const wholeAcceptance = 'src/services/wholememory.test.ts';

describe('runner retry and isolated acceptance integration', () => {
  it('preserves ordinary defaults and measured acceptance backstops', () => {
    const previous = process.env.LLXPRT_TEST_FILE_TIMEOUT_MS;
    try {
      delete process.env.LLXPRT_TEST_FILE_TIMEOUT_MS;
      expect(agents.timeoutForFile('src/ordinary.test.ts')).toBe(180_000);
      expect(agents.fileTimeoutForFile('src/ordinary.test.ts')).toBe(300_000);
      expect(cli.timeoutForFile('src/ordinary.integration.test.ts')).toBe(
        360_000,
      );
      expect(cli.fileTimeoutForFile('src/ordinary.integration.test.ts')).toBe(
        900_000,
      );
      process.env.LLXPRT_TEST_FILE_TIMEOUT_MS = '1234';
      expect(agents.fileTimeoutForFile('src/ordinary.test.ts')).toBe(1234);
      expect(cli.fileTimeoutForFile('src/ordinary.test.ts')).toBe(1234);
      expect(cli.fileTimeoutForFile('src/ordinary.integration.test.ts')).toBe(
        900_000,
      );
      expect(agents.timeoutForFile(childAcceptance)).toBe(7_200_000);
      expect(agents.fileTimeoutForFile(childAcceptance)).toBe(7_260_000);
      expect(cli.timeoutForFile(wholeAcceptance)).toBe(14_400_000);
      expect(cli.fileTimeoutForFile(wholeAcceptance)).toBe(14_460_000);
      process.env.LLXPRT_TEST_FILE_TIMEOUT_MS = '0';
      expect(() => agents.fileTimeoutForFile(childAcceptance)).toThrow();
      expect(() => cli.fileTimeoutForFile(wholeAcceptance)).toThrow();
    } finally {
      if (previous === undefined)
        delete process.env.LLXPRT_TEST_FILE_TIMEOUT_MS;
      else process.env.LLXPRT_TEST_FILE_TIMEOUT_MS = previous;
    }
  });
});

describe('runner acceptance scheduling through timeout retries', () => {
  for (const runner of [
    { implementation: agents, acceptance: childAcceptance, name: 'agents' },
    { implementation: cli, acceptance: wholeAcceptance, name: 'cli' },
  ]) {
    it(`${runner.name} drains retries before acceptance and never overlaps acceptance`, async () => {
      const events: string[] = [];
      let active = 0;
      let releaseRetry: () => void = () => {
        throw new Error('Retry not started');
      };
      let signalRetry: () => void = () => {
        throw new Error('Signal not installed');
      };
      const enteredRetry = new Promise<void>((resolve) => {
        signalRetry = resolve;
      });
      const retryGate = new Promise<void>((resolve) => {
        releaseRetry = resolve;
      });
      const execution = runner.implementation.runTestFiles(
        [runner.acceptance, 'src/slow.test.ts', 'src/fast.test.ts'],
        2,
        async (file) => {
          active += 1;
          events.push(`start:${file}`);
          if (file === runner.acceptance) expect(active).toBe(1);
          let attempts = 0;
          const result =
            await runner.implementation.runTestFileWithTimeoutRetry(
              file,
              async () => {
                attempts += 1;
                if (file === 'src/slow.test.ts' && attempts === 1)
                  return { timedOut: true };
                if (file === 'src/slow.test.ts') {
                  signalRetry();
                  await retryGate;
                }
                return { timedOut: false };
              },
              (message) => {
                events.push(message);
              },
            );
          active -= 1;
          events.push(`end:${file}`);
          return result;
        },
      );
      await enteredRetry;
      try {
        expect(events).not.toContain(`start:${runner.acceptance}`);
      } finally {
        releaseRetry();
      }
      const results = await execution;
      expect(results).toHaveLength(3);
      expect(results.every((result) => !result.timedOut)).toBe(true);
      expect(events.indexOf(`start:${runner.acceptance}`)).toBeGreaterThan(
        events.indexOf('end:src/slow.test.ts'),
      );
      expect(events.filter((event) => event.startsWith('RETRY'))).toHaveLength(
        1,
      );
      expect(active).toBe(0);
    });
  }
});
