/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { waitForCondition } from '../test-utils/eventLoop.js';
import { z } from 'zod';
import { Turn, AgentEventType, type ServerAgentStreamEvent } from './turn.js';
import { installResponsesLifecycleFixture } from './__tests__/responses-lifecycle-fixture.js';
import {
  SocketHarness,
  completingWithId,
  connectionLimitErrorFrame,
  frame,
  userTextsOf,
  type FakeSocket,
} from '../../../providers/src/openai-responses/__tests__/openAIResponsesWebSocketTransport.test-helpers.js';

const createFixture = installResponsesLifecycleFixture();
const envelope = z.object({
  previous_response_id: z.string().optional(),
  input: z.array(z.unknown()),
});
function sent(
  harness: SocketHarness,
  socket: number,
  request = 0,
): z.infer<typeof envelope> {
  return envelope.parse(JSON.parse(harness.sockets[socket].sent[request]));
}
function tool(socket: FakeSocket, id: string): void {
  socket.message(
    frame({
      type: 'response.output_item.added',
      item: {
        type: 'function_call',
        id,
        call_id: id,
        name: 'read_file',
        arguments: '{"file_path":"README.md"}',
      },
    }),
  );
  socket.message(
    frame({
      type: 'response.function_call_arguments.done',
      item_id: id,
      arguments: '{"file_path":"README.md"}',
    }),
  );
}
async function collect(
  turn: Turn,
  message: string,
  onEvent?: (event: ServerAgentStreamEvent) => void,
  signal = new AbortController().signal,
): Promise<ServerAgentStreamEvent[]> {
  const events: ServerAgentStreamEvent[] = [];
  for await (const event of turn.run(
    [{ type: 'text', text: message }],
    signal,
  )) {
    events.push(event);
    onEvent?.(event);
  }
  return events;
}

function failing(socket: FakeSocket): void {
  socket.open();
  socket.onSend = () => {
    socket.message(
      frame({ type: 'response.output_text.delta', delta: 'abandoned prefix' }),
    );
    tool(socket, 'abandoned-A');
    socket.message(connectionLimitErrorFrame());
  };
}

describe('Responses lifecycle recovery through real provider, parser, ChatSession and Turn', () => {
  afterEach(() => vi.useRealTimers());

  it('cancels during the logical retry backoff before publishing Retry or opening a replacement', async () => {
    const harness = new SocketHarness([failing]);
    const { chat, provider, httpRequests } = createFixture(harness);
    const controller = new AbortController();
    const observed: ServerAgentStreamEvent[] = [];
    vi.useFakeTimers();
    const result = collect(
      new Turn(chat, 'backoff', 'agent', provider.name),
      'question',
      (event) => observed.push(event),
      controller.signal,
    );
    expect(
      await waitForCondition(
        () => harness.sockets[0]?.closedByClient === true,
        200_000,
      ),
    ).toBe(true);
    await advanceTimersByTimeAsync(250);
    expect(observed.some((event) => event.type === AgentEventType.Retry)).toBe(
      false,
    );
    controller.abort();
    const events = await result;
    expect(
      events.some((event) => event.type === AgentEventType.UserCancelled),
    ).toBe(true);
    expect(harness.sockets).toHaveLength(1);
    expect(harness.sockets[0].sent).toHaveLength(1);
    expect(httpRequests()).toBe(0);
  });
  for (const replacementTool of [false, true]) {
    it(`discards the failed attempt and rebuilds committed state with replacement tool=${replacementTool}`, async () => {
      const harness = new SocketHarness([
        completingWithId('committed-parent', 'earlier committed answer'),
        (socket) => {
          socket.open();
          socket.onSend = () => {
            if (replacementTool) tool(socket, 'successful-B');
            socket.message(
              frame({
                type: 'response.output_text.delta',
                delta: 'successful answer',
              }),
            );
            socket.message(
              frame({
                type: 'response.completed',
                response: { id: 'fresh-parent', status: 'completed' },
              }),
            );
          };
        },
      ]);
      const { chat, history, provider, httpRequests } = createFixture(harness);
      await collect(
        new Turn(chat, 'prior', 'agent', provider.name),
        'earlier question',
      );
      harness.sockets[0].onSend = () => {
        harness.sockets[0].message(
          frame({
            type: 'response.output_text.delta',
            delta: 'abandoned prefix',
          }),
        );
        tool(harness.sockets[0], 'abandoned-A');
        harness.sockets[0].message(connectionLimitErrorFrame());
      };
      const turn = new Turn(chat, 'current', 'agent', provider.name);
      const pendingAtRetry: string[][] = [];
      const events = await collect(turn, 'current question', (event) => {
        if (event.type === AgentEventType.Retry)
          pendingAtRetry.push(turn.pendingToolCalls.map((call) => call.callId));
      });
      expect(pendingAtRetry).toStrictEqual([[]]);
      await chat.waitForIdle();

      expect(
        events.filter((event) => event.type === AgentEventType.Retry),
      ).toHaveLength(1);
      expect(events.some((event) => event.type === AgentEventType.Error)).toBe(
        false,
      );
      const retryIndex = events.findIndex(
        (event) => event.type === AgentEventType.Retry,
      );
      const replacementIndex = events.findIndex(
        (event) =>
          event.type === AgentEventType.Content &&
          event.value.includes('successful answer'),
      );
      expect(replacementIndex).toBeGreaterThan(retryIndex);
      expect(harness.sockets).toHaveLength(2);
      expect(harness.sockets[0].sent).toHaveLength(2);
      expect(harness.sockets[1].sent).toHaveLength(1);
      expect(sent(harness, 0, 1).previous_response_id).toBe('committed-parent');
      expect(sent(harness, 1).previous_response_id).toBeUndefined();
      expect(userTextsOf(sent(harness, 1).input)).toStrictEqual([
        'earlier question',
        'current question',
      ]);
      expect(JSON.stringify(sent(harness, 1).input)).toContain(
        'earlier committed answer',
      );
      expect(JSON.stringify(sent(harness, 1).input)).not.toContain('abandoned');
      expect(turn.pendingToolCalls.map((call) => call.callId)).toStrictEqual(
        replacementTool ? ['successful-B'] : [],
      );
      expect(JSON.stringify(history.getAll())).not.toContain('abandoned');
      expect(
        history
          .getAll()
          .filter((content) => content.speaker === 'ai')
          .map((content) =>
            content.blocks
              .flatMap((block) => (block.type === 'text' ? [block.text] : []))
              .join(''),
          ),
      ).toStrictEqual(['earlier committed answer', 'successful answer']);
      expect(
        history.getAll().filter((content) => content.speaker === 'human'),
      ).toHaveLength(2);
      expect(httpRequests()).toBe(0);
    });
  }

  it('terminates repeated lifecycle failures at the existing two-attempt budget', async () => {
    const harness = new SocketHarness([failing]);
    const { chat, provider, history, httpRequests } = createFixture(harness);
    const events = await collect(
      new Turn(chat, 'budget', 'agent', provider.name),
      'question',
    );
    expect(
      events.filter((event) => event.type === AgentEventType.Retry),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === AgentEventType.Error),
    ).toHaveLength(1);
    expect(harness.sockets).toHaveLength(2);
    expect(harness.sockets.every((socket) => socket.sent.length === 1)).toBe(
      true,
    );
    expect(
      history.getAll().filter((content) => content.speaker === 'ai'),
    ).toHaveLength(0);
    expect(httpRequests()).toBe(0);
  });

  for (const at of ['publication', 'retry']) {
    it(`aborts at ${at} without a replacement request`, async () => {
      const harness = new SocketHarness([failing]);
      const { chat, provider, httpRequests } = createFixture(harness);
      const controller = new AbortController();
      const events = await collect(
        new Turn(chat, 'abort', 'agent', provider.name),
        'question',
        (event) => {
          if (
            event.type ===
            (at === 'publication'
              ? AgentEventType.Content
              : AgentEventType.Retry)
          )
            controller.abort();
        },
        controller.signal,
      );
      expect(harness.sockets).toHaveLength(1);
      expect(harness.sockets[0].sent).toHaveLength(1);
      expect(
        events.some((event) => event.type === AgentEventType.UserCancelled),
      ).toBe(true);
      expect(httpRequests()).toBe(0);
    });
  }

  it('leaves unrelated invalid-request 400 errors terminal after publication', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({ type: 'response.output_text.delta', delta: 'partial' }),
          );
          socket.message(
            frame({
              type: 'error',
              status: 400,
              error: {
                type: 'invalid_request_error',
                code: 'invalid_parameter',
                message: 'Invalid parameter',
              },
            }),
          );
        };
      },
    ]);
    const { chat, provider, httpRequests } = createFixture(harness);
    const events = await collect(
      new Turn(chat, 'terminal', 'agent', provider.name),
      'question',
    );
    expect(events.some((event) => event.type === AgentEventType.Retry)).toBe(
      false,
    );
    expect(
      events.filter((event) => event.type === AgentEventType.Error),
    ).toHaveLength(1);
    expect(harness.sockets).toHaveLength(1);
    expect(httpRequests()).toBe(0);
  });
});
