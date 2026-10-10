/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { open, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AggregateDisposeError } from '../disposeErrors.js';
import { SessionLifecycle } from '../sessionLifecycle.js';
import { gate } from './helpers/recording-finalizer-join-fixture.js';

describe('SessionLifecycle shutdown', () => {
  it('retains both aggregate contracts and releases later physical resources after closure failures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shutdown-errors-'));
    const first = await open(join(directory, 'first'), 'w+');
    const last = await open(join(directory, 'last'), 'w+');
    await first.close();
    const primary = new Error('External acquisition failed');
    let closure: unknown;
    const lifecycle = new SessionLifecycle({
      stopAdmissions: [
        () => {
          throw primary;
        },
      ],
      abortActiveAndPending: [],
      cancelAndJoinOwnedWork: [
        async () => {
          try {
            await first.write('closed descriptor');
          } catch (error) {
            closure = error;
            throw new AggregateDisposeError([new AggregateError([error])]);
          }
        },
      ],
      flushRecording: [],
      releaseResources: [() => last.close()],
    });
    try {
      const result = await lifecycle.dispose().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(result).toBeInstanceOf(AggregateDisposeError);
      if (!(result instanceof AggregateDisposeError))
        throw new Error('Missing disposal aggregate');
      expect(result.errors).toStrictEqual([primary, closure]);
      await expect(last.write('after retirement')).rejects.toThrow(
        'Bad file descriptor',
      );
    } finally {
      await last.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('starts independent cancellations together and denies admission while a join is held', async () => {
    const pending = gate();
    const cancellation = new AbortController();
    const cancelled = new Promise<void>((resolve) => {
      cancellation.signal.addEventListener('abort', () => resolve(), {
        once: true,
      });
    });
    const lifecycle = new SessionLifecycle({
      stopAdmissions: [],
      abortActiveAndPending: [
        () => pending.promise,
        () => cancellation.abort(),
      ],
      cancelAndJoinOwnedWork: [],
      flushRecording: [],
      releaseResources: [],
    });
    const closing = lifecycle.dispose();
    try {
      expect(new Set([closing, lifecycle.dispose()]).size).toBe(1);
      expect(() => lifecycle.assertAccepting()).toThrow('disposing');
      await cancelled;
      expect(cancellation.signal.aborted).toBe(true);
    } finally {
      pending.release();
      await closing;
    }
  });
});
