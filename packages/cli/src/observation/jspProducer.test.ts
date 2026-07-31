/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { JspBoundDocument } from './jspDocuments.js';
import { JspProducer, type JspProducerHooks } from './jspProducer.js';
import type { JspBootstrap, JspProducerIdentity } from './jspSchema.js';

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
        return Promise.resolve(true);
      },
      publish: (document) => {
        published.push(document);
        return Promise.resolve(true);
      },
      heartbeat: () => Promise.resolve(true),
    },
  };
}

function eventTypes(documents: readonly JspBoundDocument[]): string[] {
  return documents.flatMap((document) =>
    document.kind === 'event' ? [document.event.type] : [],
  );
}

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
      register: () => Promise.resolve(false),
      publish: () => Promise.reject(new Error('offline')),
      heartbeat: () => Promise.resolve(false),
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
});
