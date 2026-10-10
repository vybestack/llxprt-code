/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deadline,
  processGone,
  suspendSupervisor,
  withTerminalFixture,
} from './shell-terminal-test-helper.js';

describe('shell log-cap lifecycle', () => {
  describe.skipIf(process.platform === 'win32')(
    'POSIX log-cap leader join',
    () => {
      for (const subscriberThrows of [false, true]) {
        it(`joins the failed writer before log cleanup (subscriber throws: ${subscriberThrows})`, async () => {
          await withTerminalFixture(
            async (manager, launch, _exit, request) => {
              const job = await launch();
              const failure = new Error('cap notification delivery failed');
              let notices = 0;
              manager.onJobFailed(() => {
                notices++;
                if (subscriberThrows) throw failure;
              });
              const failed = new Promise<void>((resolve) =>
                manager.onJobFailed(() => resolve()),
              );
              // The supervisor SIGKILLs the group 200ms after its SIGTERM, which
              // a loaded runner can outrun before the 'beat' round-trip below.
              // Freeze it so the writer's lifetime is decided only by this test,
              // and deliver SIGTERM to the writer directly.
              const resumeSupervisor = suspendSupervisor(job);
              let cancellation: Promise<boolean>;
              let duplicate: Promise<boolean>;
              let outcome: Promise<unknown>;
              let disposal: Promise<void>;
              try {
                await request('cap');
                await deadline(failed);
                process.kill(job.pid, 'SIGTERM');
                await request('term');
                expect(manager.get(job.id)?.failureReason).toContain(
                  'exceeded cap',
                );
                expect(processGone(job.pid)).toBe(false);
                expect(existsSync(job.logPath)).toBe(true);
                const heartbeat = join(job.cwd, `heartbeat-${job.pid}`);
                const before = readFileSync(heartbeat, 'utf8');
                let settled = false;
                disposal = manager.dispose();
                outcome = disposal.then(
                  () => {
                    settled = true;
                    return undefined;
                  },
                  (error: unknown) => {
                    settled = true;
                    return error;
                  },
                );
                expect(manager.dispose()).toBe(disposal);
                await request('cap');
                cancellation = manager.cancel(job.id);
                duplicate = manager.cancel(job.id);
                expect(await request('beat')).toBe('1');
                expect(readFileSync(heartbeat, 'utf8')).not.toBe(before);
                expect(settled).toBe(false);
                expect(existsSync(job.logPath)).toBe(true);
              } finally {
                resumeSupervisor();
              }
              expect(await deadline(cancellation)).toBe(false);
              expect(await deadline(duplicate)).toBe(false);
              const error = await deadline(outcome);
              expect(processGone(job.pid)).toBe(true);
              expect(existsSync(job.logPath)).toBe(false);
              expect(notices).toBe(1);
              expect(manager.list()).toStrictEqual([]);
              expect(manager.dispose()).toBe(disposal);
              if (error !== undefined && !(error instanceof AggregateError)) {
                throw new Error('Unexpected disposal failure', {
                  cause: error,
                });
              }
              expect(error?.errors ?? []).toStrictEqual(
                subscriberThrows ? [failure] : [],
              );
              return error;
            },
            { logMaxBytes: 256 },
          );
        }, 60000);
      }

      it('retains a notified live writer under history pressure until its actual exit', async () => {
        await withTerminalFixture(
          async (manager, launch, exit, request) => {
            const job = await launch();
            // The supervisor SIGKILLs the group 200ms after its SIGTERM, which
            // a loaded runner can outrun. Freeze it so the writer's lifetime is
            // decided only by this test, and deliver SIGTERM to the writer directly.
            const resumeSupervisor = suspendSupervisor(job);
            try {
              const failed = new Promise<void>((resolve) =>
                manager.onJobFailed(() => resolve()),
              );
              await request('cap');
              await deadline(failed);
              process.kill(job.pid, 'SIGTERM');
              await request('term');
              manager.markNotified([job.id]);
              manager.setMaxBackgroundJobs(0);
              manager.markNotified([job.id]);
              expect(processGone(job.pid)).toBe(false);
              expect(manager.get(job.id)?.state).toBe('failed');
              expect(existsSync(job.logPath)).toBe(true);
              expect(await request('beat')).toBe('1');
              exit(0);
            } finally {
              resumeSupervisor();
            }
            await deadline(manager.dispose());
            expect(processGone(job.pid)).toBe(true);
            expect(existsSync(job.logPath)).toBe(false);
          },
          { logMaxBytes: 256 },
        );
      }, 60000);
    },
  );
});
