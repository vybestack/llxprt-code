/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { JspBoundDocument } from './jspDocuments.js';
import {
  JspProducer,
  OBSERVER_LEASE_MS,
  type JspProducerHooks,
} from './jspProducer.js';
import type { JspPostResult } from './jspPublisher.js';
import type { JspBootstrap, JspProducerIdentity } from './jspSchema.js';

const OK: JspPostResult = { kind: 'ok' };
const REJECTED_409: JspPostResult = { kind: 'rejected', status: 409 };
const REJECTED_401: JspPostResult = { kind: 'rejected', status: 401 };
const REJECTED_403: JspPostResult = { kind: 'rejected', status: 403 };
const TRANSPORT: JspPostResult = { kind: 'transport' };

const bootstrap: JspBootstrap = {
  schema: 1,
  protocol: 'jsp/1',
  endpoint: 'http://127.0.0.1:9123/jsp/1',
  registrationId: 'reg-abc',
  publisherCredential: 'pub-secret-xyz',
  agentId: 'agent-alex',
  lifecycleGeneration: 7,
};

const nativeSession = {
  repository: 'vybestack/llxprt-code',
  path: '/src/llxprt-code',
  agent_kind: 'llxprt',
  pid: 12345,
  display_name: 'main-worker',
};

function makeHarness(): {
  readonly hooks: JspProducerHooks;
  readonly published: JspBoundDocument[];
} {
  const published: JspBoundDocument[] = [];
  const identity: JspProducerIdentity = {
    agentId: bootstrap.agentId,
    lifecycleGeneration: bootstrap.lifecycleGeneration,
    sourceEpoch: 'ep-test-fixed',
    startedAtMs: 1000,
    pid: nativeSession.pid,
  };
  return {
    published,
    hooks: {
      now: () => 5000,
      createIdentity: () => identity,
      register: (snapshot) => {
        published.push(snapshot);
        return Promise.resolve(OK);
      },
      publish: (document) => {
        published.push(document);
        return Promise.resolve(OK);
      },
      heartbeat: () => Promise.resolve(OK),
    },
  };
}

function eventTypes(documents: readonly JspBoundDocument[]): string[] {
  return documents.flatMap((document) =>
    document.kind === 'event' ? [document.event.type] : [],
  );
}

describe('heartbeat cadence', () => {
  it('heartbeats at least three times within the observer lease', async () => {
    const bootstrapped = makeHarness();
    const sent: number[] = [];
    const clock = 0;
    const hooks: JspProducerHooks = {
      ...bootstrapped.hooks,
      now: () => clock,
      register: () => Promise.resolve(OK),
      publish: () => Promise.resolve(OK),
      heartbeat: () => {
        sent.push(clock);
        return Promise.resolve(OK);
      },
    };
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    await producer.flush();
    // A heartbeat interval equal to the lease makes expiry a race with
    // scheduling jitter, so require headroom for two lost heartbeats.
    const interval = producer.heartbeatIntervalMs();
    expect(interval * 3).toBeLessThanOrEqual(OBSERVER_LEASE_MS);
    producer.stop();
  });
});

describe('JspProducer', () => {
  it('registers snapshot-first and emits contiguous native transitions', async () => {
    const { hooks, published } = makeHarness();
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    await producer.flush();
    producer.observeTurnStarted();
    producer.observeActivityChanged('acting');
    producer.observeWaitOpened('permission');
    producer.observeWaitResolved();
    producer.observeTodosReplaced('session', undefined, [
      { content: 'Ship it', status: 'in_progress' },
    ]);
    producer.observeToolCreated('read_file', 'proposed');
    producer.observeToolPhaseChanged('read_file', 'succeeded');
    producer.observeAssistantChunk('private draft');
    producer.observeAssistantMessageDisplayed('Done.', 4999);
    producer.observeTurnEnded('completed');
    await producer.flush();

    expect(published[0]?.kind).toBe('snapshot');
    expect(eventTypes(published)).toStrictEqual([
      'turn.started',
      'activity.changed',
      'wait.opened',
      'wait.resolved',
      'todos.replaced',
      'tool_call.created',
      'tool_call.phase_changed',
      'assistant_message.displayed',
      'turn.ended',
    ]);
    expect(JSON.stringify(published)).not.toContain('private draft');
    producer.stop();
  });

  it('filters todos and keeps the latest-created tool as the headline', async () => {
    const { hooks, published } = makeHarness();
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.setSession('mine', 'primary');
    producer.start();
    await producer.flush();
    published.length = 0;
    producer.observeTodosReplaced('other', 'agent-2', [
      { content: 'not mine', status: 'pending' },
    ]);
    producer.observeTodosReplaced('mine', 'primary', [
      { content: 'mine', status: 'completed' },
    ]);
    producer.observeToolCreated('read_file', 'proposed');
    producer.observeToolCreated('run_shell', 'scheduled');
    producer.observeToolPhaseChanged('read_file', 'succeeded');
    await producer.flush();

    expect(eventTypes(published)).toStrictEqual([
      'todos.replaced',
      'tool_call.created',
      'tool_call.created',
      'tool_call.phase_changed',
    ]);
    const headline = producer.snapshot().last_created_tool_call;
    expect(headline).toMatchObject({
      availability: 'known',
      value: { label: 'run_shell', phase: 'scheduled' },
    });
    producer.stop();
  });

  it('flushes the terminal snapshot before shutdown', async () => {
    const { hooks, published } = makeHarness();
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    await producer.flush();
    producer.observeTodosReplaced('session', undefined, [
      { content: 'Completed task', status: 'completed' },
    ]);
    producer.observeAssistantMessageDisplayed('Committed reply', 4999);
    producer.observeTurnEnded('completed');

    await producer.shutdown();

    expect(published.at(-1)).toMatchObject({
      kind: 'snapshot',
      todos: {
        availability: 'known',
        value: {
          items: [{ text: 'Completed task', completed: true }],
        },
      },
      last_displayed_assistant_message: {
        availability: 'known',
        value: { content: 'Committed reply' },
      },
      current_turn: {
        availability: 'known',
        value: null,
      },
    });
  });

  it('never blocks or throws when registration and publication fail', () => {
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    const hooks: JspProducerHooks = {
      now: () => 100,
      createIdentity: () => identity,
      register: () => Promise.resolve(REJECTED_409),
      publish: () => Promise.reject(new Error('offline')),
      heartbeat: () => Promise.resolve(TRANSPORT),
    };
    const producer = new JspProducer(bootstrap, nativeSession, hooks, {
      capacity: 1,
    });
    expect(() => {
      producer.start();
      producer.observeTurnStarted();
      producer.observeActivityChanged('acting');
      producer.observeTurnEnded('completed');
    }).not.toThrow();
    producer.stop();
  });

  it('does not retry registration after a 409 (epoch conflict is terminal)', async () => {
    let registerCalls = 0;
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    const hooks: JspProducerHooks = {
      now: () => 5000,
      createIdentity: () => identity,
      register: () => {
        registerCalls += 1;
        return Promise.resolve(REJECTED_409);
      },
      publish: () => Promise.resolve(OK),
      heartbeat: () => Promise.resolve(OK),
    };
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    await producer.flush();
    // After the terminal rejection, subsequent foreground events must not
    // trigger another registration attempt.
    producer.observeTurnStarted();
    producer.observeActivityChanged('acting');
    producer.observeTurnEnded('completed');
    await producer.flush();
    expect(registerCalls).toBe(1);
    producer.stop();
  });

  it('stops the producer permanently on a 401 (credential revoked)', async () => {
    let registerCalls = 0;
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    const hooks: JspProducerHooks = {
      now: () => 5000,
      createIdentity: () => identity,
      register: () => {
        registerCalls += 1;
        return Promise.resolve(REJECTED_401);
      },
      publish: () => Promise.resolve(OK),
      heartbeat: () => Promise.resolve(OK),
    };
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    await producer.flush();
    producer.observeTurnStarted();
    await producer.flush();
    expect(registerCalls).toBe(1);
    producer.stop();
  });

  it('stops the producer permanently on a 403 (credential forbidden)', async () => {
    let registerCalls = 0;
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    const hooks: JspProducerHooks = {
      now: () => 5000,
      createIdentity: () => identity,
      register: () => {
        registerCalls += 1;
        return Promise.resolve(REJECTED_403);
      },
      publish: () => Promise.resolve(OK),
      heartbeat: () => Promise.resolve(OK),
    };
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    await producer.flush();
    producer.observeTurnStarted();
    await producer.flush();
    expect(registerCalls).toBe(1);
    producer.stop();
  });

  it('retries registration after a transport failure and then succeeds', async () => {
    let registerCalls = 0;
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    const published: JspBoundDocument[] = [];
    let heartbeatStarted = false;
    let clock = 0;
    const hooks: JspProducerHooks = {
      now: () => clock,
      createIdentity: () => identity,
      register: () => {
        registerCalls += 1;
        // First attempt: transport failure. Second attempt: succeed.
        if (registerCalls === 1) {
          return Promise.resolve(TRANSPORT);
        }
        return Promise.resolve(OK);
      },
      publish: (document) => {
        published.push(document);
        return Promise.resolve(OK);
      },
      heartbeat: () => {
        heartbeatStarted = true;
        return Promise.resolve(OK);
      },
    };
    const producer = new JspProducer(bootstrap, nativeSession, hooks, {
      heartbeatMs: 10,
    });
    producer.start();
    await producer.flush();
    expect(registerCalls).toBe(1);
    expect(heartbeatStarted).toBe(false);
    // Advance the clock past the backoff window, then trigger another event.
    clock += 6_000;
    producer.observeTurnStarted();
    await producer.flush();
    expect(registerCalls).toBe(2);
    // Give the short heartbeat interval time to fire.
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(heartbeatStarted).toBe(true);
    producer.stop();
  });

  it('starts the heartbeat after a successful registration', async () => {
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    let heartbeatCount = 0;
    const hooks: JspProducerHooks = {
      now: () => 5000,
      createIdentity: () => identity,
      register: () => Promise.resolve(OK),
      publish: () => Promise.resolve(OK),
      heartbeat: () => {
        heartbeatCount += 1;
        return Promise.resolve(OK);
      },
    };
    const producer = new JspProducer(bootstrap, nativeSession, hooks, {
      heartbeatMs: 10,
    });
    producer.start();
    await producer.flush();
    // Wait long enough for at least one heartbeat interval to fire.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(heartbeatCount).toBeGreaterThan(0);
    producer.stop();
  });

  it('does not mutate state after stop (stopped producer is inert)', async () => {
    const { hooks, published } = makeHarness();
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    await producer.flush();
    const sequenceBefore = producer.snapshot().source_sequence;
    producer.stop();
    published.length = 0;
    producer.observeTurnStarted();
    producer.observeActivityChanged('acting');
    producer.observeTurnEnded('completed');
    // State and published documents must be unchanged after stop.
    expect(producer.snapshot().source_sequence).toBe(sequenceBefore);
    expect(published).toStrictEqual([]);
  });

  it('is restart-safe: stop then start re-registers and re-establishes heartbeat', async () => {
    let registerCalls = 0;
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    let heartbeatCount = 0;
    const published: JspBoundDocument[] = [];
    const hooks: JspProducerHooks = {
      now: () => 5000,
      createIdentity: () => identity,
      register: (snapshot) => {
        registerCalls += 1;
        published.push(snapshot);
        return Promise.resolve(OK);
      },
      publish: (document) => {
        published.push(document);
        return Promise.resolve(OK);
      },
      heartbeat: () => {
        heartbeatCount += 1;
        return Promise.resolve(OK);
      },
    };
    const producer = new JspProducer(bootstrap, nativeSession, hooks, {
      heartbeatMs: 10,
    });
    producer.start();
    await producer.flush();
    expect(registerCalls).toBe(1);
    producer.stop();

    // After stop, a restart must re-register and resume publishing events.
    published.length = 0;
    heartbeatCount = 0;
    producer.start();
    await producer.flush();
    expect(registerCalls).toBe(2);
    producer.observeTurnStarted();
    await producer.flush();
    expect(eventTypes(published)).toContain('turn.started');
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(heartbeatCount).toBeGreaterThan(0);
    producer.stop();
  });

  it('does not re-register on restart after a terminal 409 rejection', async () => {
    let registerCalls = 0;
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    const hooks: JspProducerHooks = {
      now: () => 5000,
      createIdentity: () => identity,
      register: () => {
        registerCalls += 1;
        return Promise.resolve(REJECTED_409);
      },
      publish: () => Promise.resolve(OK),
      heartbeat: () => Promise.resolve(OK),
    };
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    await producer.flush();
    expect(registerCalls).toBe(1);
    // A terminal rejection must persist across stop/start so the producer
    // does not silently re-register into a broker that has rejected it.
    producer.stop();
    producer.start();
    producer.observeTurnStarted();
    await producer.flush();
    expect(registerCalls).toBe(1);
    producer.stop();
  });

  it('does not re-register on restart after a terminal 401 rejection', async () => {
    let registerCalls = 0;
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    const hooks: JspProducerHooks = {
      now: () => 5000,
      createIdentity: () => identity,
      register: () => {
        registerCalls += 1;
        return Promise.resolve(REJECTED_401);
      },
      publish: () => Promise.resolve(OK),
      heartbeat: () => Promise.resolve(OK),
    };
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    await producer.flush();
    expect(registerCalls).toBe(1);
    producer.stop();
    producer.start();
    producer.observeTurnStarted();
    await producer.flush();
    expect(registerCalls).toBe(1);
    producer.stop();
  });
});

describe('construction and shutdown robustness', () => {
  it('rejects a non-positive or non-integer heartbeat interval', () => {
    const { hooks } = makeHarness();
    for (const heartbeatMs of [0, -1, 5.5]) {
      expect(
        () => new JspProducer(bootstrap, nativeSession, hooks, { heartbeatMs }),
      ).toThrow(RangeError);
    }
  });

  it('rejects a non-positive capacity', () => {
    const { hooks } = makeHarness();
    for (const capacity of [0, -5]) {
      expect(
        () => new JspProducer(bootstrap, nativeSession, hooks, { capacity }),
      ).toThrow(RangeError);
    }
  });

  it('still stops cleanly when the final drain rejects', async () => {
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    const hooks: JspProducerHooks = {
      now: () => 100,
      createIdentity: () => identity,
      register: () => Promise.resolve(OK),
      publish: () => Promise.reject(new Error('broker vanished mid-drain')),
      heartbeat: () => Promise.resolve(OK),
    };
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    producer.observeTurnStarted();

    // shutdown must not propagate the drain failure, and must leave the
    // producer stopped rather than half-torn-down: a stopped producer is
    // inert, so a later observation cannot advance the stream.
    await expect(producer.shutdown()).resolves.toBeUndefined();
    const after = producer.snapshot().source_sequence;
    producer.observeTurnStarted();
    expect(producer.snapshot().source_sequence).toBe(after);
  });
});

describe('heartbeat resilience', () => {
  it('degrades telemetry only when a heartbeat rejects', async () => {
    vi.useFakeTimers();
    try {
      const identity = makeHarness().hooks.createIdentity(bootstrap);
      let heartbeats = 0;
      const hooks: JspProducerHooks = {
        now: () => 5000,
        createIdentity: () => identity,
        register: () => Promise.resolve(OK),
        publish: () => Promise.resolve(OK),
        heartbeat: () => {
          heartbeats += 1;
          // A transport may throw rather than resolve to a typed rejection.
          return Promise.reject(new Error('transport blew up'));
        },
      };
      const producer = new JspProducer(bootstrap, nativeSession, hooks, {
        heartbeatMs: 10,
      });
      producer.start();
      await producer.flush();
      await vi.advanceTimersByTimeAsync(35);

      // Heartbeats keep being attempted and nothing escapes as an unhandled
      // rejection; the producer is still usable.
      expect(heartbeats).toBeGreaterThanOrEqual(3);
      const before = producer.snapshot().source_sequence;
      producer.observeTurnStarted();
      expect(producer.snapshot().source_sequence).toBeGreaterThan(before);
      producer.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a stale in-flight heartbeat cannot stop a restarted producer', async () => {
    vi.useFakeTimers();
    try {
      const identity = makeHarness().hooks.createIdentity(bootstrap);
      const pending: Array<(result: JspPostResult) => void> = [];
      let stallHeartbeats = true;
      const hooks: JspProducerHooks = {
        now: () => 5000,
        createIdentity: () => identity,
        register: () => Promise.resolve(OK),
        publish: () => Promise.resolve(OK),
        heartbeat: () =>
          stallHeartbeats
            ? new Promise<JspPostResult>((resolve) => pending.push(resolve))
            : Promise.resolve(OK),
      };
      const producer = new JspProducer(bootstrap, nativeSession, hooks, {
        heartbeatMs: 10,
      });

      // First lifecycle: issue a heartbeat and leave it in flight.
      producer.start();
      await producer.flush();
      await vi.advanceTimersByTimeAsync(15);
      expect(pending.length).toBeGreaterThan(0);

      // Restart, then let the stale heartbeat resolve with a credential
      // failure. Without lifecycle binding this would stop the new lifecycle.
      producer.stop();
      stallHeartbeats = false;
      producer.start();
      await producer.flush();
      for (const resolve of pending) {
        resolve(REJECTED_401);
      }
      await vi.advanceTimersByTimeAsync(0);

      // The restarted producer is still live and still publishing.
      const before = producer.snapshot().source_sequence;
      producer.observeTurnStarted();
      expect(producer.snapshot().source_sequence).toBeGreaterThan(before);
      producer.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('overflow recovery', () => {
  it('publishes a fresh snapshot after the queue overflows', async () => {
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    const published: JspBoundDocument[] = [];
    const hooks: JspProducerHooks = {
      now: () => 100,
      createIdentity: () => identity,
      register: () => Promise.resolve(OK),
      publish: (document) => {
        published.push(document);
        return Promise.resolve(OK);
      },
      heartbeat: () => Promise.resolve(OK),
    };
    // Capacity of one makes the second event in a burst overflow.
    const producer = new JspProducer(bootstrap, nativeSession, hooks, {
      capacity: 1,
    });
    producer.start();
    await producer.flush();
    published.length = 0;

    // Burst past capacity in one synchronous run so the drain cannot keep up.
    producer.observeTurnStarted();
    producer.observeActivityChanged('acting');
    producer.observeTurnEnded('completed');
    await producer.flush();
    // Let the recovery microtask and its drain settle.
    await producer.flush();

    // The gap must be reported and repaired by a fresh snapshot, otherwise the
    // observer rejects everything that follows.
    expect(published.some((document) => document.kind === 'snapshot')).toBe(
      true,
    );
    producer.stop();
  });
});
