/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  InteractiveAuthUnavailableError,
  InteractiveAuthCoordinator,
  type InteractiveAuthChallenge,
  type InteractiveAuthHostHandler,
  type InteractiveAuthOutcome,
  type InteractiveAuthStateChangeEvent,
} from '../interactive-auth-coordinator.js';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

interface HostCall {
  readonly challenge: InteractiveAuthChallenge;
  readonly signal: AbortSignal;
  readonly completion: Deferred<void>;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => {
    throw new Error('Deferred promise was not initialized');
  };
  let rejectPromise: (reason?: unknown) => void = () => {
    throw new Error('Deferred promise was not initialized');
  };
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

class RecordingHost {
  readonly calls: HostCall[] = [];

  readonly handle: InteractiveAuthHostHandler = (challenge, signal) => {
    const completion = createDeferred<void>();
    this.calls.push({ challenge, signal, completion });
    return completion.promise;
  };
}

function createChallenge(
  correlationId: string,
  provider = 'codex',
  bucket = 'work',
): InteractiveAuthChallenge {
  return {
    provider,
    bucket,
    requester: {
      runtimeKind: 'subagent',
      runtimeId: 'runtime-17',
      taskId: 'task-23',
    },
    reason: 'authentication-required',
    correlationId,
  };
}

function getCall(host: RecordingHost, index = 0): HostCall {
  const call = host.calls.find((_hostCall, callIndex) => callIndex === index);
  if (!call) {
    throw new Error(`Expected host call at index ${index}`);
  }
  return call;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function expectPending(promise: Promise<unknown>): Promise<void> {
  let settled = false;
  void promise.finally(() => {
    settled = true;
  });
  await flushMicrotasks();
  expect(settled).toBe(false);
}

/**
 * @plan PLAN-20260827-ISSUE2562.P01
 * @requirement REQ-2562-1
 */
describe('InteractiveAuthCoordinator', () => {
  let coordinator: InteractiveAuthCoordinator;
  beforeEach(async () => {
    coordinator = new InteractiveAuthCoordinator();
    await coordinator.dispose();
    coordinator.unbindHost();
  });

  afterEach(async () => {
    await coordinator.dispose();
    coordinator.unbindHost();
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('fails immediately with an actionable typed error when no host is bound', async () => {
    const host = new RecordingHost();
    coordinator.bindHost(host.handle);
    coordinator.unbindHost();

    const outcome = coordinator.requestAuth(createChallenge('request-no-host'));

    await expect(outcome).rejects.toBeInstanceOf(
      InteractiveAuthUnavailableError,
    );
    await expect(outcome).rejects.toMatchObject({
      outcomeKind: 'failed',
      correlationId: 'request-no-host',
    });
    await expect(outcome).rejects.toThrow(
      'No interactive host is available to run codex/work authentication. Run `/auth codex` from the interactive host session.',
    );
    expect(host.calls).toHaveLength(0);
    expect(coordinator.getActiveSessions()).toStrictEqual([]);
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('coalesces equivalent requests without exposing credentials and succeeds every waiter', async () => {
    const host = new RecordingHost();
    coordinator.bindHost(host.handle);
    const firstChallenge = {
      ...createChallenge('request-a'),
      credentials: 'must-not-cross-the-host-boundary',
    };

    const first = coordinator.requestAuth(firstChallenge);
    const second = coordinator.requestAuth(createChallenge('request-b'));
    await flushMicrotasks();

    expect(host.calls).toHaveLength(1);
    const call = getCall(host);
    expect(call.challenge).toStrictEqual(createChallenge('request-a'));
    expect(
      Object.prototype.hasOwnProperty.call(call.challenge, 'credentials'),
    ).toBe(false);
    expect(coordinator.getActiveSessions()).toStrictEqual([
      {
        provider: 'codex',
        bucket: 'work',
        waiterCount: 2,
        startedAtMs: expect.any(Number),
      },
    ]);

    call.completion.resolve();

    await expect(Promise.all([first, second])).resolves.toStrictEqual([
      { kind: 'succeeded', correlationId: 'request-a' },
      { kind: 'succeeded', correlationId: 'request-b' },
    ]);
    expect(coordinator.getActiveSessions()).toStrictEqual([]);
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('cancels all shared waiters, aborts the attempt, ignores late rejection, and remains reusable', async () => {
    const host = new RecordingHost();
    coordinator.bindHost(host.handle);
    const first = coordinator.requestAuth(createChallenge('cancel-a'));
    const second = coordinator.requestAuth(createChallenge('cancel-b'));
    await flushMicrotasks();
    const cancelledCall = getCall(host);

    const cancelledCount = coordinator.cancelActiveSessions(
      'User cancelled authentication',
    );

    expect(cancelledCount).toBe(1);
    expect(cancelledCall.signal.aborted).toBe(true);
    await expect(Promise.all([first, second])).resolves.toStrictEqual([
      { kind: 'cancelled', correlationId: 'cancel-a' },
      { kind: 'cancelled', correlationId: 'cancel-b' },
    ]);
    expect(coordinator.getActiveSessions()).toStrictEqual([]);

    cancelledCall.completion.reject(new Error('late host rejection'));
    await flushMicrotasks();

    const retry = coordinator.requestAuth(
      createChallenge('retry-after-cancel'),
    );
    await flushMicrotasks();
    expect(host.calls).toHaveLength(2);
    getCall(host, 1).completion.resolve();
    await expect(retry).resolves.toStrictEqual({
      kind: 'succeeded',
      correlationId: 'retry-after-cancel',
    });
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('allows only the first terminal transition to win a cancel and success race', async () => {
    const host = new RecordingHost();
    coordinator.bindHost(host.handle);
    const cancelled = coordinator.requestAuth(
      createChallenge('race-cancel-first'),
    );
    await flushMicrotasks();

    getCall(host).completion.resolve();
    coordinator.cancelActiveSessions();

    await expect(cancelled).resolves.toStrictEqual({
      kind: 'cancelled',
      correlationId: 'race-cancel-first',
    });

    const succeeded = coordinator.requestAuth(
      createChallenge('race-success-first'),
    );
    await flushMicrotasks();
    getCall(host, 1).completion.resolve();
    await expect(succeeded).resolves.toStrictEqual({
      kind: 'succeeded',
      correlationId: 'race-success-first',
    });
    expect(coordinator.cancelActiveSessions()).toBe(0);
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('times out the session, aborts the host signal, and ignores late handler settlement', async () => {
    const host = new RecordingHost();
    coordinator.bindHost(host.handle);

    const outcome = coordinator.requestAuth(
      createChallenge('timeout-request'),
      { timeoutMs: 25 },
    );
    await flushMicrotasks();
    const call = getCall(host);

    await expect(outcome).resolves.toStrictEqual({
      kind: 'timed_out',
      correlationId: 'timeout-request',
    });
    expect(call.signal.aborted).toBe(true);
    expect(coordinator.getActiveSessions()).toStrictEqual([]);

    call.completion.reject(new Error('late timeout rejection'));
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(coordinator.getActiveSessions()).toStrictEqual([]);
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('returns a failed outcome with the host error to every waiter', async () => {
    const host = new RecordingHost();
    coordinator.bindHost(host.handle);
    const failure = new Error('OAuth callback rejected the authorization code');
    const first = coordinator.requestAuth(createChallenge('failure-a'));
    const second = coordinator.requestAuth(createChallenge('failure-b'));
    await flushMicrotasks();
    const call = getCall(host);

    call.completion.reject(failure);

    const outcomes = await Promise.all([first, second]);
    expect(outcomes).toStrictEqual([
      { kind: 'failed', correlationId: 'failure-a', error: failure },
      { kind: 'failed', correlationId: 'failure-b', error: failure },
    ]);
    expect(outcomes.every((outcome) => outcome.error === failure)).toBe(true);
    expect(call.signal.aborted).toBe(true);

    call.completion.resolve();
    await flushMicrotasks();
    expect(coordinator.getActiveSessions()).toStrictEqual([]);
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('treats an AbortError from the host as cancellation', async () => {
    const host = new RecordingHost();
    coordinator.bindHost(host.handle);
    const outcome = coordinator.requestAuth(createChallenge('host-abort'));
    await flushMicrotasks();

    getCall(host).completion.reject(
      new DOMException('Host auth was aborted', 'AbortError'),
    );

    await expect(outcome).resolves.toStrictEqual({
      kind: 'cancelled',
      correlationId: 'host-abort',
    });
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('detaches one aborted waiter without stopping the shared host attempt', async () => {
    const host = new RecordingHost();
    const firstController = new AbortController();
    coordinator.bindHost(host.handle);
    const first = coordinator.requestAuth(createChallenge('detached-a'), {
      signal: firstController.signal,
    });
    const second = coordinator.requestAuth(createChallenge('remaining-b'));
    await flushMicrotasks();
    const call = getCall(host);

    firstController.abort(new DOMException('Task stopped', 'AbortError'));

    await expect(first).resolves.toStrictEqual({
      kind: 'cancelled',
      correlationId: 'detached-a',
    });
    expect(call.signal.aborted).toBe(false);
    expect(coordinator.getActiveSessions()).toStrictEqual([
      {
        provider: 'codex',
        bucket: 'work',
        waiterCount: 1,
        startedAtMs: expect.any(Number),
      },
    ]);
    await expectPending(second);

    call.completion.resolve();
    await expect(second).resolves.toStrictEqual({
      kind: 'succeeded',
      correlationId: 'remaining-b',
    });
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('aborts and removes an orphaned session when its final waiter detaches', async () => {
    const host = new RecordingHost();
    const requesterController = new AbortController();
    coordinator.bindHost(host.handle);
    const outcome = coordinator.requestAuth(createChallenge('only-waiter'), {
      signal: requesterController.signal,
      timeoutMs: 25,
    });
    await flushMicrotasks();
    const call = getCall(host);

    requesterController.abort(new DOMException('Task stopped', 'AbortError'));

    await expect(outcome).resolves.toStrictEqual({
      kind: 'cancelled',
      correlationId: 'only-waiter',
    });
    expect(call.signal.aborted).toBe(true);
    expect(coordinator.getActiveSessions()).toStrictEqual([]);

    await new Promise<void>((resolve) => setTimeout(resolve, 35));
    expect(coordinator.getActiveSessions()).toStrictEqual([]);
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('disposes active sessions with cancelled outcomes exactly once', async () => {
    const host = new RecordingHost();
    coordinator.bindHost(host.handle);
    let settlementCount = 0;
    const outcome = coordinator
      .requestAuth(createChallenge('dispose-request'))
      .then((result): InteractiveAuthOutcome => {
        settlementCount += 1;
        return result;
      });
    await flushMicrotasks();
    const call = getCall(host);

    await Promise.all([coordinator.dispose(), coordinator.dispose()]);

    await expect(outcome).resolves.toStrictEqual({
      kind: 'cancelled',
      correlationId: 'dispose-request',
    });
    expect(settlementCount).toBe(1);
    expect(call.signal.aborted).toBe(true);
    expect(coordinator.getActiveSessions()).toStrictEqual([]);
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('lets timeout win a timeout and cancel race exactly once', async () => {
    const host = new RecordingHost();
    let settlementCount = 0;
    coordinator.bindHost(host.handle);
    const outcome = coordinator
      .requestAuth(createChallenge('timeout-cancel-race'), { timeoutMs: 10 })
      .then((result): InteractiveAuthOutcome => {
        settlementCount += 1;
        return result;
      });

    await expect(outcome).resolves.toStrictEqual({
      kind: 'timed_out',
      correlationId: 'timeout-cancel-race',
    });
    expect(coordinator.cancelActiveSessions()).toBe(0);
    getCall(host).completion.resolve();
    await flushMicrotasks();
    expect(settlementCount).toBe(1);
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('lets dispose win a dispose and success race exactly once', async () => {
    const host = new RecordingHost();
    let settlementCount = 0;
    coordinator.bindHost(host.handle);
    const outcome = coordinator
      .requestAuth(createChallenge('dispose-success-race'))
      .then((result): InteractiveAuthOutcome => {
        settlementCount += 1;
        return result;
      });
    await flushMicrotasks();

    const disposal = coordinator.dispose();
    getCall(host).completion.resolve();
    await disposal;

    await expect(outcome).resolves.toStrictEqual({
      kind: 'cancelled',
      correlationId: 'dispose-success-race',
    });
    await flushMicrotasks();
    expect(settlementCount).toBe(1);
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('lets waiter detachment win a detach and settle race exactly once', async () => {
    const host = new RecordingHost();
    const requesterController = new AbortController();
    let settlementCount = 0;
    coordinator.bindHost(host.handle);
    const outcome = coordinator
      .requestAuth(createChallenge('detach-settle-race'), {
        signal: requesterController.signal,
      })
      .then((result): InteractiveAuthOutcome => {
        settlementCount += 1;
        return result;
      });
    await flushMicrotasks();

    requesterController.abort(new DOMException('Task stopped', 'AbortError'));
    getCall(host).completion.resolve();

    await expect(outcome).resolves.toStrictEqual({
      kind: 'cancelled',
      correlationId: 'detach-settle-race',
    });
    await flushMicrotasks();
    expect(settlementCount).toBe(1);
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('reports waiting and settled state and stops reporting after unsubscribe', async () => {
    const host = new RecordingHost();
    const events: Array<{
      readonly type: string;
      readonly waiterCount: number;
      readonly kind?: string;
    }> = [];
    coordinator.bindHost(host.handle);
    const unsubscribe = coordinator.onStateChange((event) => {
      events.push({
        type: event.type,
        waiterCount: event.waiterCount,
        ...(event.kind === undefined ? {} : { kind: event.kind }),
      });
    });

    const first = coordinator.requestAuth(createChallenge('event-a'));
    const second = coordinator.requestAuth(createChallenge('event-b'));
    await flushMicrotasks();
    getCall(host).completion.resolve();
    await Promise.all([first, second]);

    expect(events).toStrictEqual([
      { type: 'waiting', waiterCount: 1 },
      { type: 'waiting', waiterCount: 2 },
      { type: 'settled', waiterCount: 2, kind: 'succeeded' },
    ]);

    unsubscribe();
    const later = coordinator.requestAuth(
      createChallenge('event-after-unsubscribe'),
    );
    await flushMicrotasks();
    getCall(host, 1).completion.resolve();
    await later;
    expect(events).toHaveLength(3);
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('starts a fresh interaction for a request arriving after settlement', async () => {
    const host = new RecordingHost();
    coordinator.bindHost(host.handle);
    const first = coordinator.requestAuth(createChallenge('first-session'));
    await flushMicrotasks();
    getCall(host).completion.resolve();
    await first;

    const second = coordinator.requestAuth(createChallenge('second-session'));
    await flushMicrotasks();

    expect(host.calls).toHaveLength(2);
    await expectPending(second);
    getCall(host, 1).completion.resolve();
    await expect(second).resolves.toStrictEqual({
      kind: 'succeeded',
      correlationId: 'second-session',
    });
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P01
   * @requirement REQ-2562-1
   */
  it('leaves persistence to a signal-aware host and records credentials only after success', async () => {
    const completions: Array<Deferred<void>> = [];
    const persistedCorrelations: string[] = [];
    const handler: InteractiveAuthHostHandler = async (challenge, signal) => {
      const completion = createDeferred<void>();
      completions.push(completion);
      await completion.promise;
      if (signal.aborted) {
        throw signal.reason;
      }
      persistedCorrelations.push(challenge.correlationId);
    };
    coordinator.bindHost(handler);

    const cancelled = coordinator.requestAuth(
      createChallenge('must-not-persist'),
    );
    await flushMicrotasks();
    coordinator.cancelActiveSessions();
    const cancelledCompletion = completions.find(
      (_completion, index) => index === 0,
    );
    if (!cancelledCompletion) {
      throw new Error('Expected cancelled host completion');
    }
    cancelledCompletion.resolve();
    await cancelled;
    await flushMicrotasks();
    expect(persistedCorrelations).toStrictEqual([]);

    const succeeded = coordinator.requestAuth(
      createChallenge('persist-after-success'),
    );
    await flushMicrotasks();
    const successfulCompletion = completions.find(
      (_completion, index) => index === 1,
    );
    if (!successfulCompletion) {
      throw new Error('Expected successful host completion');
    }
    successfulCompletion.resolve();
    await expect(succeeded).resolves.toStrictEqual({
      kind: 'succeeded',
      correlationId: 'persist-after-success',
    });
    expect(persistedCorrelations).toStrictEqual(['persist-after-success']);
  });

  /**
   * @plan PLAN-20260827-ISSUE2562.P04
   * @requirement REQ-2562-1
   */
  it('settles every waiter exactly once when cancellation re-enters during waiting notifications', async () => {
    // A UI observer cancels every session the instant it sees a waiting
    // event (the user hitting /auth cancel as the dialog appears) while more
    // requests keep arriving. Each request must settle cancelled exactly
    // once, no terminal session may linger, and the coordinator must remain
    // usable for a fresh interaction.
    const host = new RecordingHost();
    const events: InteractiveAuthStateChangeEvent[] = [];
    let cancelOnWaiting = true;
    const unsubscribe = coordinator.onStateChange((event) => {
      events.push(event);
      if (event.type === 'waiting' && cancelOnWaiting) {
        coordinator.cancelActiveSessions('user cancelled immediately');
      }
    });
    coordinator.bindHost(host.handle);

    const first = coordinator.requestAuth(createChallenge('reentrant-1'));
    const second = coordinator.requestAuth(createChallenge('reentrant-2'));

    await expect(first).resolves.toStrictEqual({
      kind: 'cancelled',
      correlationId: 'reentrant-1',
    });
    await expect(second).resolves.toStrictEqual({
      kind: 'cancelled',
      correlationId: 'reentrant-2',
    });
    expect(host.calls).toHaveLength(2);
    expect(coordinator.getActiveSessions()).toStrictEqual([]);

    cancelOnWaiting = false;
    const retry = coordinator.requestAuth(createChallenge('reentrant-retry'));
    await flushMicrotasks();
    expect(coordinator.getActiveSessions()).toHaveLength(1);
    getCall(host, 2).completion.resolve();
    await expect(retry).resolves.toStrictEqual({
      kind: 'succeeded',
      correlationId: 'reentrant-retry',
    });
    unsubscribe();

    const waitingEvents = events.filter((event) => event.type === 'waiting');
    const settledEvents = events.filter((event) => event.type === 'settled');
    expect(waitingEvents).toHaveLength(3);
    expect(settledEvents.map((event) => event.kind)).toStrictEqual([
      'cancelled',
      'cancelled',
      'succeeded',
    ]);
  });
});
