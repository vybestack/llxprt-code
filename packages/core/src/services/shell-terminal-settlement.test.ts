/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import {
  deadline,
  processGone,
  withTerminalFixture,
} from './shell-terminal-test-helper.js';

async function disposalError(
  operation: Promise<void>,
): Promise<AggregateError> {
  const [result] = await Promise.allSettled([deadline(operation)]);
  if (
    result.status !== 'rejected' ||
    !(result.reason instanceof AggregateError)
  ) {
    throw new Error('Expected disposal to report terminal subscriber failures');
  }
  return result.reason;
}

describe('shell terminal subscriber settlement', () => {
  describe.skipIf(process.platform === 'win32')(
    'POSIX tracked processes',
    () => {
      it('settles cancel after tracked exit, delivers later subscribers and retains errors after eviction', async () => {
        await withTerminalFixture(async (manager, launch) => {
          const first = new Error('first terminal delivery failure');
          const second = new Error('second terminal delivery failure');
          const job = await launch();
          expect(existsSync(job.logPath)).toBe(true);
          const notices: string[] = [];
          manager.onJobCancelled(() => {
            throw first;
          });
          manager.onJobCancelled((notice) => {
            notices.push(notice.id);
          });
          manager.onJobCancelled(() => {
            throw second;
          });

          const cancellation = manager.cancel(job.id);
          const duplicate = manager.cancel(job.id);
          expect(await deadline(cancellation)).toBe(true);
          expect(await deadline(duplicate)).toBe(false);
          expect(processGone(job.pid)).toBe(true);
          expect(manager.get(job.id)?.state).toBe('cancelled');
          expect(notices).toStrictEqual([job.id]);
          manager.markNotified([job.id]);

          for (let i = 0; i < 2; i++) {
            const next = await launch();
            expect(await deadline(manager.cancel(next.id))).toBe(true);
            expect(processGone(next.pid)).toBe(true);
            manager.markNotified([next.id]);
          }
          expect(manager.get(job.id)).toBeUndefined();
          expect(existsSync(job.logPath)).toBe(false);
          const disposal = manager.dispose();
          expect(manager.dispose()).toBe(disposal);
          const error = await disposalError(disposal);
          expect(error.errors).toStrictEqual([
            first,
            second,
            first,
            second,
            first,
            second,
          ]);
          expect(await disposalError(manager.dispose())).toBe(error);
          expect(manager.list()).toStrictEqual([]);
          return error;
        });
      }, 30000);

      it('finishes disposal cleanup before reporting a throwing cancellation subscriber', async () => {
        await withTerminalFixture(async (manager, launch) => {
          const job = await launch();
          expect(existsSync(job.logPath)).toBe(true);
          const failure = new Error('dispose terminal delivery failure');
          manager.onJobCancelled(() => {
            throw failure;
          });
          const error = await disposalError(manager.dispose());
          expect(error.errors).toStrictEqual([failure]);
          expect(processGone(job.pid)).toBe(true);
          expect(existsSync(job.logPath)).toBe(false);
          expect(manager.list()).toStrictEqual([]);
          return error;
        });
      }, 30000);

      it('keeps the listener snapshot and reports failures when a subscriber starts disposal', async () => {
        await withTerminalFixture(async (manager, launch) => {
          const job = await launch();
          expect(existsSync(job.logPath)).toBe(true);
          const failure = new Error('failure after reentrant disposal');
          let result: Promise<AggregateError> | undefined;
          let laterNotices = 0;
          manager.onJobCancelled(() => {
            unsubscribe();
            result = disposalError(manager.dispose());
            expect(() =>
              manager.launch({ command: 'true', cwd: job.cwd }),
            ).toThrow('disposing or disposed');
          });
          const unsubscribe = manager.onJobCancelled(() => {
            laterNotices++;
            throw failure;
          });
          expect(await deadline(manager.cancel(job.id))).toBe(true);
          expect(laterNotices).toBe(1);
          if (!result) throw new Error('Subscriber did not start disposal');
          const error = await result;
          expect(error.errors).toStrictEqual([failure]);
          expect(processGone(job.pid)).toBe(true);
          expect(existsSync(job.logPath)).toBe(false);
          return error;
        });
      }, 30000);

      for (const exitCode of [0, 3]) {
        it(`delivers all exit-${exitCode} notices and surfaces subscriber failures on disposal`, async () => {
          await withTerminalFixture(async (manager, launch, exit) => {
            const job = await launch();
            expect(existsSync(job.logPath)).toBe(true);
            const failure = new Error(`exit-${exitCode} delivery failure`);
            const subscribe =
              exitCode === 0
                ? manager.onJobCompleted.bind(manager)
                : manager.onJobFailed.bind(manager);
            subscribe(() => {
              throw failure;
            });
            const delivered = new Promise<string>((resolve) => {
              subscribe((notice) => resolve(notice.id));
            });
            exit(exitCode);
            expect(await deadline(delivered)).toBe(job.id);
            expect(processGone(job.pid)).toBe(true);
            expect(manager.get(job.id)?.exitCode).toBe(exitCode);
            const error = await disposalError(manager.dispose());
            expect(error.errors).toStrictEqual([failure]);
            expect(existsSync(job.logPath)).toBe(false);
            return error;
          });
        }, 30000);
      }
    },
  );
});
