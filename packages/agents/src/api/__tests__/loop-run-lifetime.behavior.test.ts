/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { LoopRunLifetime } from '../loop-run-lifetime.js';
import type { AgenticLoopEvent } from '../runtimeFactories.js';
import { gate } from './helpers/recording-finalizer-join-fixture.js';

function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

describe('loop run lifetime disposal', () => {
  it('fulfills when disposal aborts an active run and the run ends with the abort once', async () => {
    const entered = gate();
    const lifetime = new LoopRunLifetime(
      async function* (_message, signal): AsyncGenerator<AgenticLoopEvent> {
        entered.release();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError()), {
            once: true,
          });
        });
        yield* [];
      },
      async () => undefined,
    );
    const run = lifetime.run('held', new AbortController().signal);
    const callerOutcomes: unknown[] = [];
    const next = run.next().then(
      () => callerOutcomes.push('value'),
      (error: unknown) => callerOutcomes.push(error),
    );
    await entered.promise;
    await lifetime.dispose();
    await next;
    expect(callerOutcomes).toHaveLength(1);
    const [outcome] = callerOutcomes;
    expect(outcome).toBeInstanceOf(Error);
    if (!(outcome instanceof Error)) throw new Error('Missing abort outcome');
    expect(outcome.name).toBe('AbortError');
  });

  it('still reports a failing release step once while the aborted run is not reported', async () => {
    const entered = gate();
    const releaseFailure = new Error('release failed');
    const lifetime = new LoopRunLifetime(
      async function* (_message, signal): AsyncGenerator<AgenticLoopEvent> {
        entered.release();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError()), {
            once: true,
          });
        });
        yield* [];
      },
      () => Promise.reject(releaseFailure),
    );
    const run = lifetime.run('held', new AbortController().signal);
    const next = run.next().then(
      () => undefined,
      (error: unknown) => error,
    );
    await entered.promise;
    const outcome = await lifetime.dispose().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(await next).toBeInstanceOf(Error);
    expect(outcome).toBeInstanceOf(AggregateError);
    if (!(outcome instanceof AggregateError))
      throw new Error('Missing cleanup failure');
    expect(outcome.errors).toStrictEqual([releaseFailure]);
  });
});
