/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import EventEmitter from 'node:events';
import { describe, expect, it } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import { createCpResultPromise } from './shellCpExecution.js';

/**
 * Deterministic teardown coverage for the child_process drain path of
 * issue #3329: finalization deferred past 'exit' must not leave stream
 * listeners attached when a stream settles via 'end' without 'close' (the
 * Bun behavior the drain design cites) or when the bounded grace timeout
 * fires, and the caller abort listener must be detached on completion.
 *
 * Streams are manual EventEmitters with explicit destroyed/readableEnded
 * flags so the settle contract is exercised precisely; the finalizer under
 * test is the production createCpExitFinalizer.
 *
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-03
 */

interface ManualStream extends EventEmitter {
  destroyed: boolean;
  readableEnded: boolean;
}

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: ManualStream;
  stderr: ManualStream;
  kill: () => boolean;
}

const INACTIVITY_TIMEOUT_MS = 60_000;

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-03 */
function buildManualStream(): ManualStream {
  const stream = new EventEmitter() as ManualStream;
  stream.destroyed = false;
  stream.readableEnded = false;
  return stream;
}

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-03 */
function buildFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = 4242;
  child.stdout = buildManualStream();
  child.stderr = buildManualStream();
  child.kill = () => true;
  return child;
}

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-03 */
async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * AbortSignal is an EventTarget without listenerCount, so track the
 * function listeners production registers/detaches by intercepting the
 * registration APIs.
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-02
 */
function trackSignalListeners(controller: AbortController): () => number {
  const signal = controller.signal;
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  const registered = new Map<EventListener, EventListener>();
  signal.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ) => {
    if (typeof listener === 'function') {
      const once = typeof options === 'object' && options.once === true;
      const effective = once
        ? (...args: Parameters<EventListener>) => {
            registered.delete(listener);
            return listener(...args);
          }
        : listener;
      registered.set(listener, effective);
      return originalAdd(type, effective, options);
    }
    return originalAdd(type, listener, options);
  }) as AbortSignal['addEventListener'];
  signal.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => {
    if (typeof listener === 'function') {
      const effective = registered.get(listener) ?? listener;
      registered.delete(listener);
      return originalRemove(type, effective);
    }
    return originalRemove(type, listener);
  }) as AbortSignal['removeEventListener'];
  return () => registered.size;
}

function waitFor<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label}`));
    }, 3_000);
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

describe('child_process drain teardown paths (issue #3329)', () => {
  /**
   * @plan PLAN-20260825-SHELLMEM.P01
   * @requirement REQ-3329-03
   */
  it('detaches both drain listeners when a stream settles via end without close', async () => {
    const child = buildFakeChild();
    const promise = createCpResultPromise(
      child as unknown as ChildProcess,
      false,
      () => undefined,
      new AbortController().signal,
      INACTIVITY_TIMEOUT_MS,
      undefined,
    );
    child.stdout.emit('data', Buffer.from('hi\n'));
    child.emit('exit', 0, null);
    await tick();

    // Settle both streams via 'end' only; 'close' never arrives.
    for (const stream of [child.stdout, child.stderr]) {
      stream.readableEnded = true;
      stream.emit('end');
    }

    const result = await waitFor(promise, 'end-only settlement');
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('hi');
    for (const stream of [child.stdout, child.stderr]) {
      expect(stream.listenerCount('close')).toBe(0);
      expect(stream.listenerCount('end')).toBe(0);
    }
  });

  /**
   * @plan PLAN-20260825-SHELLMEM.P01
   * @requirement REQ-3329-03
   */
  it('finalizes via the bounded grace timeout and detaches drain listeners', async () => {
    const child = buildFakeChild();
    const promise = createCpResultPromise(
      child as unknown as ChildProcess,
      false,
      () => undefined,
      new AbortController().signal,
      INACTIVITY_TIMEOUT_MS,
      undefined,
    );
    child.stdout.emit('data', Buffer.from('hi\n'));
    child.emit('exit', 0, null);
    await tick();

    // Streams never settle; the 500ms grace timer must finalize.
    const result = await waitFor(promise, 'grace timeout finalization');
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('hi');
    for (const stream of [child.stdout, child.stderr]) {
      expect(stream.listenerCount('close')).toBe(0);
      expect(stream.listenerCount('end')).toBe(0);
    }
  });

  /**
   * @plan PLAN-20260825-SHELLMEM.P01
   * @requirement REQ-3329-02
   */
  it('removes the caller abort listener on completion', async () => {
    const child = buildFakeChild();
    const caller = new AbortController();
    const listenerCount = trackSignalListeners(caller);
    const promise = createCpResultPromise(
      child as unknown as ChildProcess,
      false,
      () => undefined,
      caller.signal,
      INACTIVITY_TIMEOUT_MS,
      undefined,
    );
    child.emit('exit', 0, null);
    await tick();
    for (const stream of [child.stdout, child.stderr]) {
      stream.readableEnded = true;
      stream.emit('end');
    }
    await waitFor(promise, 'caller listener completion');
    expect(listenerCount()).toBe(0);
  });
});
