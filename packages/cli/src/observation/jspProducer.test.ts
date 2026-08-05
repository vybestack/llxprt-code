/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  JspBoundDocument,
  JspSnapshotDocument,
  JspTodoItem,
} from './jspDocuments.js';
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

/**
 * Pull the task-list items out of a published `todos.replaced` event so a test
 * can assert them exactly. The consumer schema is closed, so an extra member is
 * rejected at ingress; a partial matcher would let one through.
 */
function todoItemsOfEvent(
  document: JspBoundDocument,
): readonly JspTodoItem[] | undefined {
  if (document.kind !== 'event' || document.event.type !== 'todos.replaced') {
    return undefined;
  }
  return document.event.items;
}

/** The same, for the task list carried on a snapshot. */
function todoItemsOfSnapshot(
  snapshot: JspSnapshotDocument,
): readonly JspTodoItem[] | undefined {
  const { todos } = snapshot;
  if (todos === 'unsupported' || todos.availability !== 'known') {
    return undefined;
  }
  return todos.value.items;
}

describe('heartbeat cadence', () => {
  it('delivers at least three heartbeats within the observer lease on the shipped default interval', async () => {
    vi.useFakeTimers();
    let producer: JspProducer | undefined;
    try {
      const bootstrapped = makeHarness();
      let heartbeats = 0;
      const hooks: JspProducerHooks = {
        ...bootstrapped.hooks,
        register: () => Promise.resolve(OK),
        publish: () => Promise.resolve(OK),
        heartbeat: () => {
          heartbeats += 1;
          return Promise.resolve(OK);
        },
      };
      // No heartbeatMs override: the shipped DEFAULT interval is the value
      // under test. The cadence property only holds if that shipped value
      // leaves room for two lost heartbeats inside one lease.
      producer = new JspProducer(bootstrap, nativeSession, hooks);
      const interval = producer.heartbeatIntervalMs();
      producer.start();
      await producer.flush();
      // Advance a full lease window so the interval has fired repeatedly.
      await vi.advanceTimersByTimeAsync(OBSERVER_LEASE_MS);
      // An observer must be able to lose two consecutive heartbeats inside
      // one lease, so at least three must actually be delivered.
      expect(heartbeats).toBeGreaterThanOrEqual(3);
      expect(interval * 3).toBeLessThanOrEqual(OBSERVER_LEASE_MS);
    } finally {
      // Restore real timers before stopping: restoration discards the fake
      // interval outright, so it cannot be skipped by anything stop() does,
      // and a failed assertion still cannot leave fake timers installed for
      // the rest of the file. stop() then releases the producer itself.
      vi.useRealTimers();
      producer?.stop();
    }
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
    producer.observeTodosReplaced(undefined, [
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
      // Ending the turn returns activity to idle. The turn.ended event carries
      // only the outcome, so the resulting activity is announced explicitly or
      // an observer replaying the stream would stay on the previous activity.
      'activity.changed',
    ]);
    expect(JSON.stringify(published)).not.toContain('private draft');
    producer.stop();
  });

  it('keeps publishing todos after the CLI session id is rebound', async () => {
    // Regression for #2963. `Config.adoptSessionId` rebinds the session id at
    // runtime (resume, session browser, /chat resume). The producer used to
    // compare each replacement against a session id captured at startup, so
    // every list published after such a rebind was silently dropped and Jefe
    // rendered the pane as unknown for the rest of the session. Todos are the
    // only field gated that way, which is why status and the last message
    // kept working.
    const { hooks, published } = makeHarness();
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.setAgentScope(undefined);
    producer.start();
    await producer.flush();
    published.length = 0;

    // The tool dispatcher always supplies a concrete agent id, and the primary
    // agent's is the default scope; the session id is not part of the decision.
    producer.observeTodosReplaced('primary', [
      { content: 'after resume', status: 'in_progress' },
    ]);
    await producer.flush();

    expect(eventTypes(published)).toStrictEqual(['todos.replaced']);
    expect(producer.snapshot().todos).toMatchObject({
      availability: 'known',
      value: {
        revision: 1,
        items: [{ text: 'after resume', state: 'in_progress' }],
      },
    });
    producer.stop();
  });

  it('publishes the item the agent is working on as in_progress', async () => {
    // The active item is the whole point of the field: a derived boolean
    // collapsed pending and in_progress, so an observer had to guess which
    // entry was live. Prove the distinction survives the wire on the event
    // path as well as the snapshot.
    const { hooks, published } = makeHarness();
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    await producer.flush();
    published.length = 0;

    producer.observeTodosReplaced(undefined, [
      { content: 'Done already', status: 'completed' },
      { content: 'Working on it', status: 'in_progress' },
      { content: 'Not started', status: 'pending' },
    ]);
    await producer.flush();

    // The consumer schema is closed, so assert the published items exactly
    // rather than with a partial match: a surviving `completed` member would
    // be rejected at ingress and take the whole document with it.
    expect(published).toHaveLength(1);
    expect(todoItemsOfEvent(published[0])).toStrictEqual([
      { text: 'Done already', state: 'completed' },
      { text: 'Working on it', state: 'in_progress' },
      { text: 'Not started', state: 'pending' },
    ]);
    expect(todoItemsOfSnapshot(producer.snapshot())).toStrictEqual([
      { text: 'Done already', state: 'completed' },
      { text: 'Working on it', state: 'in_progress' },
      { text: 'Not started', state: 'pending' },
    ]);
    producer.stop();
  });

  it('drops a todo replacement it cannot publish faithfully', async () => {
    // The native status set is a closed enum well inside the bound, so an
    // over-bound status is an impossible state. Publishing a truncated label
    // would put a value the source never reported onto the wire, and
    // publishing the full one would be rejected for the bound and take the
    // whole document with it, so the replacement is refused outright.
    const { hooks, published } = makeHarness();
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    await producer.flush();
    published.length = 0;

    expect(() =>
      producer.observeTodosReplaced(undefined, [
        { content: 'Runaway', status: 'x'.repeat(65) },
      ]),
    ).toThrow(RangeError);
    await producer.flush();

    expect(published).toStrictEqual([]);
    expect(producer.snapshot().todos).toMatchObject({
      availability: 'unknown',
    });

    // The refused replacement must not consume a revision: a hole in the
    // sequence is how an observer detects loss.
    producer.observeTodosReplaced(undefined, [
      { content: 'Recovered', status: 'pending' },
    ]);
    await producer.flush();
    expect(producer.snapshot().todos).toMatchObject({
      availability: 'known',
      value: { revision: 1 },
    });
    producer.stop();
  });

  it('filters todos and keeps the latest-created tool as the headline', async () => {
    const { hooks, published } = makeHarness();
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.setAgentScope('primary');
    producer.start();
    await producer.flush();
    published.length = 0;
    producer.observeTodosReplaced('agent-2', [
      { content: 'not mine', status: 'pending' },
    ]);
    producer.observeTodosReplaced('primary', [
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
    producer.observeTodosReplaced(undefined, [
      { content: 'Completed task', status: 'completed' },
    ]);
    producer.observeAssistantMessageDisplayed('Committed reply', 4999);
    producer.observeTurnEnded('completed');

    await producer.shutdown();

    const terminal = published.at(-1);
    expect(terminal).toMatchObject({
      kind: 'snapshot',
      todos: { availability: 'known' },
      last_displayed_assistant_message: {
        availability: 'known',
        value: { content: 'Committed reply' },
      },
      current_turn: {
        availability: 'known',
        value: null,
      },
    });
    // Assert the task-list items exactly: the consumer schema is closed, so a
    // surviving `completed` member would fail the whole snapshot at ingress
    // and a partial match would not notice it.
    expect(todoItemsOfSnapshot(terminal as JspSnapshotDocument)).toStrictEqual([
      { text: 'Completed task', state: 'completed' },
    ]);
  });

  it('never throws into the foreground when registration is terminally rejected', async () => {
    let publishCalls = 0;
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    const hooks: JspProducerHooks = {
      now: () => 100,
      createIdentity: () => identity,
      register: () => Promise.resolve(REJECTED_409),
      publish: () => {
        publishCalls += 1;
        return Promise.resolve(OK);
      },
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
    await producer.flush();
    // A terminal registration stops the producer before any publish attempt,
    // which is the property the narrowed name claims.
    expect(publishCalls).toBe(0);
    producer.stop();
  });

  it('never throws into the foreground when publication rejects and stays usable', async () => {
    let publishCalls = 0;
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    const hooks: JspProducerHooks = {
      now: () => 5000,
      createIdentity: () => identity,
      register: () => Promise.resolve(OK),
      publish: () => {
        publishCalls += 1;
        return Promise.reject(new Error('offline'));
      },
      heartbeat: () => Promise.resolve(OK),
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
    await producer.flush();
    // The rejecting publish path was genuinely exercised.
    expect(publishCalls).toBeGreaterThan(0);
    // The producer must remain usable: a later observation still advances the
    // sequence, proving the rejection did not strand the foreground stream.
    const before = producer.snapshot().source_sequence;
    producer.observeTurnStarted();
    expect(producer.snapshot().source_sequence).toBeGreaterThan(before);
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

  it('still stops cleanly and publishes the terminal snapshot when every publish fails', async () => {
    const identity = makeHarness().hooks.createIdentity(bootstrap);
    const published: JspBoundDocument[] = [];
    const hooks: JspProducerHooks = {
      now: () => 100,
      createIdentity: () => identity,
      register: () => Promise.resolve(OK),
      publish: (document) => {
        published.push(document);
        return Promise.reject(new Error('broker vanished mid-drain'));
      },
      heartbeat: () => Promise.resolve(OK),
    };
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    // Let registration complete so the following observation enqueues a real
    // event the drain will publish (and reject). Without this, the observation
    // is made while unregistered and never reaches publish, so the drain has
    // nothing to fail on.
    await producer.flush();

    // Burn the queue's one-shot recovery request before shutdown. The failed
    // send below asks the producer for a recovery snapshot, and that request
    // is not renewed until a send actually succeeds. Doing it here means the
    // failures during shutdown cannot inject a queue-authored snapshot, so a
    // snapshot arriving last during shutdown can only be the direct terminal
    // publish. Two flushes: the first settles the failing send, the second the
    // drain carrying the recovery snapshot it asked for.
    producer.observeTurnStarted();
    await producer.flush();
    await producer.flush();
    published.length = 0;

    // shutdown must not propagate the drain failure, and must leave the
    // producer stopped rather than half-torn-down: a stopped producer is
    // inert, so a later observation cannot advance the stream.
    await expect(producer.shutdown()).resolves.toBeUndefined();
    const after = producer.snapshot().source_sequence;
    producer.observeTurnStarted();
    expect(producer.snapshot().source_sequence).toBe(after);

    // Shutdown drains the session.ended event, and every publish rejects. Any
    // snapshot the queue still had to offer was enqueued ahead of that event,
    // so the trailing snapshot is the direct terminal publish: it happened
    // after the failed drain rather than being skipped by it.
    expect(published.some((document) => document.kind === 'event')).toBe(true);
    expect(published.at(-1)?.kind).toBe('snapshot');
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

  it('repairs an overflow through the queue recovery callback with no further observation', async () => {
    // The burst test above can be satisfied by the polling path inside
    // applyAndPublish: a later transition sees needsSnapshotRecovery() and
    // enqueues the snapshot itself. This test isolates the callback path by
    // overflowing and then making NO further observation, so the only route to
    // a published snapshot is JspBoundedQueue's onRecoveryNeeded firing through
    // queueMicrotask.
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
    const producer = new JspProducer(bootstrap, nativeSession, hooks, {
      capacity: 1,
    });
    producer.start();
    await producer.flush();
    published.length = 0;

    // The first event fills the capacity-one buffer. The second overflows: the
    // event is dropped and the queue requests recovery via microtask.
    producer.observeTurnStarted();
    producer.observeActivityChanged('acting');
    // Deliberately make no further observation. The polling path in
    // applyAndPublish is never reached again, so a published snapshot can only
    // arrive through the queue's onRecoveryNeeded callback.
    await producer.flush();
    // The recovery callback runs as a microtask and enqueues its snapshot,
    // which is picked up by whichever drain is live at that moment; a second
    // flush settles that drain.
    await producer.flush();

    expect(published.some((document) => document.kind === 'snapshot')).toBe(
      true,
    );
    producer.stop();
  });
});

describe('event stream reproduces the snapshot', () => {
  it('announces the return to idle when a turn ends', async () => {
    const { hooks, published } = makeHarness();
    const producer = new JspProducer(bootstrap, nativeSession, hooks);
    producer.start();
    await producer.flush();
    published.length = 0;

    producer.observeTurnStarted();
    producer.observeActivityChanged('thinking');
    producer.observeTurnEnded('completed');
    await producer.flush();

    // An observer applies events; it does not synthesize idle on turn end.
    // Without an explicit activity event it would stay on "thinking" forever
    // and report the agent as still working.
    const events = published.filter((document) => document.kind === 'event');
    const last = events.at(-1);
    expect(last).toMatchObject({
      event: { type: 'activity.changed', state: 'idle' },
    });
    // The snapshot and the event stream must agree.
    expect(producer.snapshot().native_activity).toMatchObject({
      availability: 'known',
      value: { state: 'idle' },
    });
    producer.stop();
  });
});
