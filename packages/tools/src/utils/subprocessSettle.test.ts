/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  createSettleFn,
  type SubprocessSettlement,
  type AbortHandlerRef,
} from './subprocessSettle.js';
import type { ProcessTerminationResult } from './processTermination.js';

class TestLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessLifecycleError';
  }
}

function makeSettlement(): {
  settlement: SubprocessSettlement;
  abortRef: AbortHandlerRef;
  controller: AbortController;
  resolveSpy: (v: string) => void;
  rejectSpy: (e: Error) => void;
  promise: Promise<string>;
} {
  const settlement: SubprocessSettlement = {
    settled: false,
    terminationPromise: null,
  };
  const controller = new AbortController();
  const abortRef: AbortHandlerRef = { handler: () => {} };
  let resolveFn!: (v: string) => void;
  let rejectFn!: (e: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return {
    settlement,
    abortRef,
    controller,
    resolveSpy: resolveFn,
    rejectSpy: rejectFn,
    promise,
  };
}

describe('createSettleFn', () => {
  it('resolves via action on normal close', async () => {
    const ctx = makeSettlement();
    const settle = createSettleFn(
      ctx.settlement,
      ctx.controller.signal,
      ctx.abortRef,
      ctx.rejectSpy,
      TestLifecycleError,
      'test',
    );
    settle(() => ctx.resolveSpy('ok'));
    expect(await ctx.promise).toBe('ok');
  });

  it('rejects when terminationPromise resolves with failure', async () => {
    const ctx = makeSettlement();
    const failResult: ProcessTerminationResult = { outcome: 'failure' };
    ctx.settlement.terminationPromise = Promise.resolve(failResult);
    const settle = createSettleFn(
      ctx.settlement,
      ctx.controller.signal,
      ctx.abortRef,
      ctx.rejectSpy,
      TestLifecycleError,
      'test',
    );
    settle(() => ctx.resolveSpy('should-not-happen'));
    await expect(ctx.promise).rejects.toThrow('test termination failure');
  });

  it('rejects when action throws synchronously', async () => {
    const ctx = makeSettlement();
    const settle = createSettleFn(
      ctx.settlement,
      ctx.controller.signal,
      ctx.abortRef,
      ctx.rejectSpy,
      TestLifecycleError,
      'test',
    );
    settle(() => {
      throw new Error('action boom');
    });
    await expect(ctx.promise).rejects.toThrow('action boom');
  });

  it('rejects when terminationPromise rejects', async () => {
    const ctx = makeSettlement();
    ctx.settlement.terminationPromise = Promise.reject(
      new Error('termination rejected'),
    );
    const settle = createSettleFn(
      ctx.settlement,
      ctx.controller.signal,
      ctx.abortRef,
      ctx.rejectSpy,
      TestLifecycleError,
      'test',
    );
    settle(() => ctx.resolveSpy('should-not-happen'));
    await expect(ctx.promise).rejects.toThrow('termination rejected');
  });

  it('duplicate settle calls do not double-resolve or double-reject', async () => {
    const ctx = makeSettlement();
    let resolveCount = 0;
    const wrappedResolve = (v: string) => {
      resolveCount++;
      ctx.resolveSpy(v);
    };
    const settle = createSettleFn(
      ctx.settlement,
      ctx.controller.signal,
      ctx.abortRef,
      ctx.rejectSpy,
      TestLifecycleError,
      'test',
    );
    settle(() => wrappedResolve('first'));
    settle(() => wrappedResolve('second'));
    expect(await ctx.promise).toBe('first');
    expect(resolveCount).toBe(1);
  });

  it('does not produce an unhandled rejection when action throws', async () => {
    const ctx = makeSettlement();
    const settle = createSettleFn(
      ctx.settlement,
      ctx.controller.signal,
      ctx.abortRef,
      ctx.rejectSpy,
      TestLifecycleError,
      'test',
    );
    settle(() => {
      throw new Error('boom');
    });
    // The promise must reject (not hang forever) — no unhandled rejection.
    const reason = await ctx.promise.catch((e: Error) => e);
    expect(reason).toBeInstanceOf(Error);
    expect((reason as Error).message).toBe('boom');
  });

  const observeRemovesTheAbortListenerAfterSettlingAt156 = async () => {
    const ctx = makeSettlement();
    let handlerRemoved = false;
    const origRemove = ctx.controller.signal.removeEventListener.bind(
      ctx.controller.signal,
    );
    ctx.controller.signal.removeEventListener = ((
      type: string,
      listener: () => void,
    ) => {
      if (type === 'abort' && listener === ctx.abortRef.handler) {
        handlerRemoved = true;
      }
      origRemove(type, listener);
    }) as typeof ctx.controller.signal.removeEventListener;
    const settle = createSettleFn(
      ctx.settlement,
      ctx.controller.signal,
      ctx.abortRef,
      ctx.rejectSpy,
      TestLifecycleError,
      'test',
    );
    settle(() => ctx.resolveSpy('ok'));
    await ctx.promise;
    return { handlerRemoved };
  };

  it('removes the abort listener after settling', async () => {
    const { handlerRemoved } =
      await observeRemovesTheAbortListenerAfterSettlingAt156();
    expect(handlerRemoved).toBe(true);
  });
});
