/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
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
});
