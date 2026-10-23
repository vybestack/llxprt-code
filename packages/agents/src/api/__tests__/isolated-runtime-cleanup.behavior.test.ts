/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { deferred } from './helpers/shell-owner-gate.js';
import {
  cleanupFailedRuntimeBootstrap,
  closeIsolatedSessionRuntime,
  disposeIsolatedMediaRuntime,
} from '../agentRuntimeAssembly.js';

describe('isolated runtime cleanup with explicit close operations', () => {
  it('joins client cleanup before runtime/config cleanup and media cleanup last', async () => {
    const client = deferred<void>();
    const runtime = deferred<void>();
    const config = deferred<void>();
    let clientClosed = false;
    let runtimeClosed = false;
    let configClosed = false;
    let mediaClosed = false;
    const closing = closeIsolatedSessionRuntime(
      async () => {
        expect(clientClosed).toBe(true);
        await runtime.promise;
        runtimeClosed = true;
      },
      async () => {
        expect(clientClosed).toBe(true);
        await config.promise;
        configClosed = true;
      },
      async () => {
        expect(runtimeClosed && configClosed).toBe(true);
        mediaClosed = true;
      },
      async () => {
        await client.promise;
        clientClosed = true;
      },
    );
    expect(mediaClosed).toBe(false);
    client.resolve();
    runtime.resolve();
    config.resolve();
    await closing;
    expect(mediaClosed).toBe(true);
  });

  it('preserves every cleanup failure in client/runtime/config/media order', async () => {
    const errors = ['client', 'runtime', 'config', 'media'].map(
      (name) => new Error(name),
    );
    const closing = disposeIsolatedMediaRuntime(
      async () => {
        throw errors[1];
      },
      async () => {
        throw errors[2];
      },
      async () => {
        throw errors[3];
      },
      async () => {
        throw errors[0];
      },
    );
    const failure = await closing.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw failure;
    expect(failure.errors).toStrictEqual(errors);
  });

  it('retains the original single failure while closing remaining resources without a client', async () => {
    const failure = new Error('runtime close failed');
    let remainingClosed = 0;
    const closing = disposeIsolatedMediaRuntime(
      async () => {
        throw failure;
      },
      async () => {
        remainingClosed += 1;
      },
      async () => {
        remainingClosed += 1;
      },
      undefined,
    );
    await expect(closing).rejects.toBe(failure);
    expect(remainingClosed).toBe(2);
  });

  it('surfaces the primary bootstrap failure after joining the runtime close', async () => {
    const primary = new Error('bootstrap failed');
    const runtime = deferred<void>();
    let closed = false;
    const failing = cleanupFailedRuntimeBootstrap(
      async () => {
        await runtime.promise;
        closed = true;
      },
      primary,
      'explicit bootstrap',
    );
    runtime.resolve();
    await expect(failing).rejects.toBe(primary);
    expect(closed).toBe(true);
  });

  it('joins bootstrap and runtime-close failures without losing either', async () => {
    const primary = new Error('bootstrap failed');
    const cleanup = new Error('close failed');
    const failure = await cleanupFailedRuntimeBootstrap(
      async () => {
        throw cleanup;
      },
      primary,
      'explicit bootstrap',
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw failure;
    expect(failure.errors).toStrictEqual([primary, cleanup]);
  });
});
