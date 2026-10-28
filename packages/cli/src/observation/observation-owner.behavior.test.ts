/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { todoEvents } from '@vybestack/llxprt-code-core';
import {
  createObservationOwner,
  createObservationProducer,
  createTodoObservationSubscription,
} from './jspWiring.js';
import type { JspBoundDocument } from './jspDocuments.js';

function session(name: string) {
  const documents: JspBoundDocument[] = [];
  const producer = createObservationProducer(
    {
      schema: 1,
      protocol: 'jsp/1',
      endpoint: 'http://127.0.0.1:9123/jsp/1',
      registrationId: name,
      publisherCredential: 'test-only',
      agentId: name,
      lifecycleGeneration: 1,
    },
    {
      repository: 'test',
      path: '/test',
      agentKind: 'llxprt',
      displayName: name,
    },
    {
      register: async () => ({ kind: 'ok' }),
      publish: async (document) => {
        documents.push(document);
        return { kind: 'ok' };
      },
      heartbeat: async () => ({ kind: 'ok' }),
    },
  );
  if (producer === null)
    throw new Error('Enabled producer was not constructed');
  const owner = createObservationOwner({
    producer,
    subscribeTodos: (observe) =>
      createTodoObservationSubscription(name, observe),
  });
  return { owner, producer, documents };
}

describe('observation ownership', () => {
  it('keeps stream events and todo subscriptions isolated and unsubscribes on cleanup', async () => {
    const first = session('first');
    const second = session('second');
    try {
      await first.producer.flush();
      await second.producer.flush();
      first.owner.callbacks.observeTurnStarted();
      first.owner.callbacks.observeAssistantMessageCommitted('first reply', 1);
      second.owner.callbacks.observeTurnStarted();
      second.owner.callbacks.observeAssistantMessageCommitted(
        'second reply',
        2,
      );
      await first.producer.flush();
      await second.producer.flush();
      const messages = (documents: JspBoundDocument[]) =>
        documents.flatMap((document) =>
          document.kind === 'event' &&
          document.event.type === 'assistant_message.displayed'
            ? [document.event.content]
            : [],
        );
      expect(messages(first.documents)).toStrictEqual(['first reply']);
      expect(messages(second.documents)).toStrictEqual(['second reply']);
      todoEvents.emitTodoUpdated({
        sessionId: 'first',
        timestamp: new Date(0),
        todos: [{ id: 'a', content: 'First task', status: 'pending' }],
      });
      todoEvents.emitTodoUpdated({
        sessionId: 'second',
        timestamp: new Date(0),
        todos: [{ id: 'b', content: 'Second task', status: 'pending' }],
      });
      await first.producer.flush();
      await second.producer.flush();
      const todoLists = (documents: JspBoundDocument[]) =>
        documents.flatMap((document) =>
          document.kind === 'event' && document.event.type === 'todos.replaced'
            ? [document.event.items.map((item) => item.text)]
            : [],
        );
      expect(todoLists(first.documents)).toStrictEqual([['First task']]);
      expect(todoLists(second.documents)).toStrictEqual([['Second task']]);
      const listenerCount = todoEvents.listenerCount('todo-updated');
      await first.owner.cleanup();
      expect(todoEvents.listenerCount('todo-updated')).toBe(listenerCount - 1);
      await first.owner.cleanup();
      expect(todoEvents.listenerCount('todo-updated')).toBe(listenerCount - 1);
      second.owner.callbacks.observeAssistantMessageCommitted(
        'still active',
        3,
      );
      await second.producer.flush();
      expect(messages(second.documents)).toStrictEqual([
        'second reply',
        'still active',
      ]);
    } finally {
      await first.owner.cleanup();
      await second.owner.cleanup();
    }
  });
});
