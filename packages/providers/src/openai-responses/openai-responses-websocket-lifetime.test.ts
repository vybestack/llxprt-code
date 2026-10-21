/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createCodexResponsesWebSocketTransport,
  isStatefulConnectionRenewalError,
  streamOverWebSocketOrFallback,
  type WebSocketTransport,
} from './openAIResponsesWebSocketTransport.js';
import {
  SocketHarness,
  completingScript,
  complete,
  connectionLimitErrorFrame,
  drain,
  frame,
  options,
  request,
  textContent,
} from './__tests__/openAIResponsesWebSocketTransport.test-helpers.js';

const transports: WebSocketTransport[] = [];

function transportFor(harness: SocketHarness): WebSocketTransport {
  const transport = createCodexResponsesWebSocketTransport({
    openSocket: harness.openSocket,
    streamIdleTimeoutMs: 0,
  });
  transports.push(transport);
  return transport;
}

describe('Responses WebSocket lifetime', () => {
  afterEach(() => {
    for (const transport of transports) transport.close();
    transports.length = 0;
  });

  describe('Responses connection-limit recovery before observable output', () => {
    it('discards hidden reasoning from a rejected attempt and recovers the documented 400', async () => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () => {
            socket.message(
              frame({ type: 'response.created', response: { id: 'rejected' } }),
            );
            socket.message(
              frame({
                type: 'response.reasoning_summary_text.delta',
                delta: 'uncommitted thought',
              }),
            );
            socket.message(connectionLimitErrorFrame());
          };
        },
        completingScript('fresh answer'),
      ]);

      const messages = await drain(
        transportFor(harness).streamResponse(
          request(),
          options({ includeThinkingInResponse: false }),
        ),
      );

      expect(messages.flatMap((message) => message.blocks)).toStrictEqual([
        { type: 'text', text: 'fresh answer' },
      ]);
      expect(harness.sockets).toHaveLength(2);
      expect(harness.sockets[0].closedByClient).toBe(true);
    });

    it('preserves hidden reasoning on a successful response', async () => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () => {
            socket.message(
              frame({
                type: 'response.reasoning_summary_text.done',
                text: 'retained thought',
              }),
            );
            socket.message(
              frame({
                type: 'response.completed',
                response: { id: 'success', status: 'completed' },
              }),
            );
          };
        },
      ]);

      const messages = await drain(
        transportFor(harness).streamResponse(
          request(),
          options({ includeThinkingInResponse: false }),
        ),
      );

      expect(messages.flatMap((message) => message.blocks)).toContainEqual(
        expect.objectContaining({
          type: 'thinking',
          thought: 'retained thought',
          isHidden: true,
        }),
      );
      expect(messages.find((message) => message.metadata)?.metadata?.id).toBe(
        'success',
      );
    });

    it('preserves accepted completion and encrypted prefix FIFO when the consumer subsequently aborts', async () => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () => {
            socket.message(
              frame({
                type: 'response.reasoning_summary_text.done',
                text: 'first thought',
              }),
            );
            socket.message(
              frame({
                type: 'response.output_item.done',
                item: {
                  type: 'reasoning',
                  id: 'retained-id',
                  encrypted_content: 'retained-ciphertext',
                  summary: [{ type: 'summary_text', text: 'second thought' }],
                },
              }),
            );
            complete(socket, 'answer');
          };
        },
      ]);
      const controller = new AbortController();
      const iterator = transportFor(harness).streamResponse(
        request(),
        options({
          includeThinkingInResponse: false,
          abortSignal: controller.signal,
        }),
      );
      const first = await iterator.next();
      expect(first.value?.blocks).toContainEqual(
        expect.objectContaining({
          type: 'thinking',
          thought: 'first thought',
          isHidden: true,
        }),
      );
      controller.abort();
      const rest = await drain(iterator);
      expect(rest.flatMap((message) => message.blocks)).toMatchObject([
        {
          type: 'thinking',
          thought: 'second thought',
          encryptedContent: 'retained-ciphertext',
          providerMetadata: { 'openai.responses.reasoningId': 'retained-id' },
        },
        { type: 'text', text: 'answer' },
      ]);
      expect(rest[rest.length - 1]?.metadata).toMatchObject({
        finishReason: 'stop',
      });
      expect(harness.sockets[0].closedByClient).toBe(false);
    });

    it('keeps liveness active while hidden reasoning is quarantined and aborts without publication', async () => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () =>
            socket.message(
              frame({
                type: 'response.reasoning_summary_text.delta',
                delta: 'still thinking',
              }),
            );
        },
      ]);
      const controller = new AbortController();
      let livenessEvents = 0;
      const iterator = transportFor(harness).streamResponse(
        request(),
        options({
          includeThinkingInResponse: false,
          abortSignal: controller.signal,
          onStreamLiveness: () => {
            livenessEvents++;
            controller.abort();
          },
        }),
      );
      await expect(iterator.next()).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(livenessEvents).toBeGreaterThan(0);
      expect(harness.sockets[0].closedByClient).toBe(true);
    });

    for (const lifecycle of [false, true]) {
      it(`preserves the wrapper replay boundary after hidden reasoning for lifecycle=${lifecycle}`, async () => {
        const harness = new SocketHarness([
          (socket) => {
            socket.open();
            socket.onSend = () => {
              socket.message(
                frame({
                  type: 'response.reasoning_summary_text.delta',
                  delta: 'pending thought',
                }),
              );
              socket.message(
                lifecycle
                  ? connectionLimitErrorFrame()
                  : frame({
                      type: 'error',
                      error: {
                        type: 'server_error',
                        code: 'unrelated_error',
                        message: 'unrelated provider failure',
                      },
                    }),
              );
            };
          },
          completingScript('fresh answer'),
        ]);
        let fallbackRequests = 0;
        let fallbackNotifications = 0;
        const iterator = streamOverWebSocketOrFallback(
          transportFor(harness),
          request(),
          options({ includeThinkingInResponse: false }),
          async function* () {
            fallbackRequests++;
            yield textContent('HTTP replay');
          },
          () => {
            fallbackNotifications++;
          },
          undefined,
        );
        const published = [];
        let failure: unknown;
        try {
          for await (const message of iterator) published.push(message);
        } catch (error) {
          failure = error;
        }

        expect(fallbackRequests).toBe(0);
        expect(fallbackNotifications).toBe(0);
        const unrelatedFailure = {
          details: { providerError: { code: 'unrelated_error' } },
        };
        const hiddenThinking = expect.objectContaining({
          type: 'thinking',
          thought: 'pending thought',
          isHidden: true,
        });
        expect({ failure }).toMatchObject({
          failure: lifecycle ? undefined : unrelatedFailure,
        });
        expect(published.flatMap((message) => message.blocks)).toStrictEqual(
          lifecycle
            ? [{ type: 'text', text: 'fresh answer' }]
            : [hiddenThinking],
        );
        expect(harness.sockets).toHaveLength(lifecycle ? 2 : 1);
      });
    }

    it('rejects abort immediately while flushing a hidden prefix before an unrelated provider error', async () => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () => {
            for (const delta of ['first', ' second'])
              socket.message(
                frame({ type: 'response.reasoning_summary_text.delta', delta }),
              );
            socket.message(
              frame({
                type: 'error',
                error: {
                  type: 'server_error',
                  code: 'unrelated_error',
                  message: 'failed',
                },
              }),
            );
          };
        },
      ]);
      const controller = new AbortController();
      const iterator = transportFor(harness).streamResponse(
        request(),
        options({
          includeThinkingInResponse: false,
          abortSignal: controller.signal,
        }),
      );
      expect((await iterator.next()).value?.blocks).toContainEqual(
        expect.objectContaining({ type: 'thinking', thought: 'first' }),
      );
      controller.abort();
      await expect(iterator.next()).rejects.toMatchObject({
        name: 'AbortError',
      });
    });

    for (const prefix of ['many deltas', 'one large snapshot']) {
      it(`publishes ${prefix} at the quarantine budget and refuses lifecycle replay`, async () => {
        const harness = new SocketHarness([
          (socket) => {
            socket.open();
            socket.onSend = () => {
              const count = prefix === 'many deltas' ? 2048 : 1;
              for (let index = 0; index < count; index++)
                socket.message(
                  frame({
                    type: 'response.reasoning_summary_text.delta',
                    delta:
                      prefix === 'many deltas' ? '界' : '界'.repeat(150000),
                  }),
                );
              socket.message(connectionLimitErrorFrame());
            };
          },
          completingScript('must not replay'),
        ]);
        const iterator = transportFor(harness).streamResponse(
          request(),
          options({ includeThinkingInResponse: false }),
        );
        const published = [];
        let failure: unknown;
        try {
          for await (const message of iterator)
            published.push(...message.blocks);
        } catch (error) {
          failure = error;
        }

        expect(failure).toMatchObject({
          name: 'StreamInterruptionError',
          cause: {
            status: 400,
            code: 'websocket_connection_limit_reached',
          },
        });
        expect(published).toHaveLength(prefix === 'many deltas' ? 2048 : 1);
        expect(
          published.every(
            (block) => block.type === 'thinking' && block.isHidden === true,
          ),
        ).toBe(true);
        expect(harness.sockets).toHaveLength(1);
      });
    }

    for (const ending of ['text', 'tool', 'terminal']) {
      it(`preserves FIFO and encrypted reasoning through prefix overflow before ${ending}`, async () => {
        const harness = new SocketHarness([
          (socket) => {
            socket.open();
            socket.onSend = () => {
              for (let index = 0; index < 2048; index++)
                socket.message(
                  frame({
                    type: 'response.reasoning_summary_text.delta',
                    delta: '界',
                  }),
                );
              socket.message(
                frame({
                  type: 'response.output_item.done',
                  item: {
                    type: 'reasoning',
                    id: 'reasoning-item',
                    encrypted_content: 'encrypted-proof',
                    summary: [{ type: 'summary_text', text: 'final thought' }],
                  },
                }),
              );
              if (ending === 'tool') {
                socket.message(
                  frame({
                    type: 'response.output_item.added',
                    item: {
                      type: 'function_call',
                      id: 'item',
                      call_id: 'call',
                      name: 'charge',
                      arguments: '{}',
                    },
                  }),
                );
                socket.message(
                  frame({
                    type: 'response.function_call_arguments.done',
                    item_id: 'item',
                    arguments: '{}',
                  }),
                );
              }
              complete(socket, ending === 'text' ? 'answer' : undefined);
            };
          },
        ]);
        const messages = await drain(
          transportFor(harness).streamResponse(
            request(),
            options({ includeThinkingInResponse: false }),
          ),
        );
        const blocks = messages.flatMap((message) => message.blocks);

        expect(
          blocks
            .slice(0, 2048)
            .map((block) =>
              block.type === 'thinking' ? block.thought : undefined,
            ),
        ).toStrictEqual(
          Array.from({ length: 2048 }, (_, index) => '界'.repeat(index + 1)),
        );
        expect(blocks[2048]).toMatchObject({
          type: 'thinking',
          thought: '界'.repeat(2048),
          streamStatus: 'complete',
        });
        expect(blocks[2049]).toMatchObject({
          type: 'thinking',
          thought: 'final thought',
          isHidden: true,
          encryptedContent: 'encrypted-proof',
          providerMetadata: {
            'openai.responses.reasoningId': 'reasoning-item',
          },
        });
        const textOutput: ContentBlock[] =
          ending === 'text' ? [{ type: 'text', text: 'answer' }] : [];
        const toolOutput: ContentBlock[] =
          ending === 'tool'
            ? [
                {
                  type: 'tool_call',
                  id: 'call',
                  name: 'charge',
                  parameters: {},
                },
              ]
            : [];
        expect(blocks.slice(2050)).toStrictEqual([
          ...textOutput,
          ...toolOutput,
        ]);
        expect(messages[messages.length - 1]?.metadata).toMatchObject({
          finishReason: 'stop',
          id: 'response',
        });
      });
    }

    for (const publication of ['text', 'tool', 'hidden']) {
      it(`rejects an abort between prefix publications before ${publication} and releases the turn`, async () => {
        const harness = new SocketHarness([
          (socket) => {
            socket.open();
            socket.onSend = () => {
              socket.message(
                frame({
                  type: 'response.reasoning_summary_text.delta',
                  delta: 'first',
                }),
              );
              if (publication === 'hidden')
                socket.message(
                  frame({
                    type: 'response.reasoning_summary_text.delta',
                    delta: 'second',
                  }),
                );
              if (publication === 'tool') {
                socket.message(
                  frame({
                    type: 'response.output_item.added',
                    item: {
                      type: 'function_call',
                      id: 'item',
                      call_id: 'call',
                      name: 'charge',
                      arguments: '{}',
                    },
                  }),
                );
                socket.message(
                  frame({
                    type: 'response.function_call_arguments.done',
                    item_id: 'item',
                    arguments: '{}',
                  }),
                );
              } else
                socket.message(
                  frame({
                    type: 'response.output_text.delta',
                    delta: 'must not publish',
                  }),
                );
            };
          },
          completingScript('later answer'),
        ]);
        const transport = transportFor(harness);
        const controller = new AbortController();
        const iterator = transport.streamResponse(
          request(),
          options({
            includeThinkingInResponse: false,
            abortSignal: controller.signal,
          }),
        );

        expect((await iterator.next()).value?.blocks).toContainEqual(
          expect.objectContaining({ type: 'thinking', thought: 'first' }),
        );
        controller.abort();
        await expect(iterator.next()).rejects.toMatchObject({
          name: 'AbortError',
        });
        expect(harness.sockets[0].closedByClient).toBe(true);
        expect(
          await drain(transport.streamResponse(request(), options())),
        ).toContainEqual(textContent('later answer'));
        expect(harness.sockets).toHaveLength(2);
      });
    }

    for (const visibleEvent of [
      { type: 'response.reasoning_summary_text.done', text: 'visible thought' },
      { type: 'response.output_text.delta', delta: 'visible text' },
    ]) {
      it(`never replays exposed ${visibleEvent.type}`, async () => {
        const harness = new SocketHarness([
          (socket) => {
            socket.open();
            socket.onSend = () => {
              socket.message(frame(visibleEvent));
              socket.message(connectionLimitErrorFrame());
            };
          },
          completingScript('duplicate'),
        ]);
        const iterator = transportFor(harness).streamResponse(
          request(),
          options(),
        );

        expect((await iterator.next()).value?.blocks).not.toHaveLength(0);
        await expect(iterator.next()).rejects.toMatchObject({
          name: 'StreamInterruptionError',
          cause: {
            status: 400,
            code: 'websocket_connection_limit_reached',
          },
        });
        expect(harness.sockets).toHaveLength(1);
      });
    }

    it('does not treat response.created as exposed output', async () => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () => {
            socket.message(
              frame({ type: 'response.created', response: { id: 'rejected' } }),
            );
            socket.message(connectionLimitErrorFrame());
          };
        },
        completingScript('recovered'),
      ]);

      expect(
        await drain(transportFor(harness).streamResponse(request(), options())),
      ).toContainEqual(textContent('recovered'));
    });
  });

  const RENEWAL_MS = 55 * 60 * 1000;

  describe('Responses proactive connection retirement', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it('retires an idle connection at 55 minutes without eagerly reconnecting', async () => {
      const harness = new SocketHarness([completingScript('answer')]);
      const transport = transportFor(harness);
      await drain(transport.streamResponse(request(), options()));

      await advanceTimersByTimeAsync(RENEWAL_MS - 1);
      expect(harness.sockets[0].closedByClient).toBe(false);
      await advanceTimersByTimeAsync(1);
      expect(harness.sockets[0].closedByClient).toBe(true);
      expect(harness.sockets).toHaveLength(1);

      expect(
        await drain(transport.streamResponse(request(), options())),
      ).toContainEqual(textContent('answer'));
      expect(harness.sockets).toHaveLength(2);
    });

    it('checks connection age before sending when the timer has been delayed', async () => {
      const harness = new SocketHarness([completingScript('answer')]);
      const transport = transportFor(harness);
      await drain(transport.streamResponse(request(), options()));
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + RENEWAL_MS);

      await drain(transport.streamResponse(request(), options()));

      expect(harness.sockets).toHaveLength(2);
      expect(harness.sockets[0].sent).toHaveLength(1);
      expect(harness.sockets[0].closedByClient).toBe(true);
    });

    it('hands off a rotated stateful turn before sending its stale parent', async () => {
      const harness = new SocketHarness([completingScript('answer')]);
      const transport = transportFor(harness);
      await drain(transport.streamResponse(request(), options()));
      await advanceTimersByTimeAsync(RENEWAL_MS);

      const error: unknown = await drain(
        transport.streamResponse(
          { ...request(), previous_response_id: 'old-parent' },
          options(),
        ),
      ).catch((reason: unknown) => reason);

      expect(isStatefulConnectionRenewalError(error)).toBe(true);
      expect(harness.sockets).toHaveLength(1);
      expect(harness.sockets[0].sent).toHaveLength(1);
      expect(
        await drain(transport.streamResponse(request(), options())),
      ).toContainEqual(textContent('answer'));
      expect(harness.sockets).toHaveLength(2);
    });

    it('defers retirement while active and completes without interrupting output', async () => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () =>
            socket.message(
              frame({ type: 'response.output_text.delta', delta: 'partial' }),
            );
        },
        completingScript('next'),
      ]);
      const transport = transportFor(harness);
      const iterator = transport.streamResponse(request(), options());
      expect((await iterator.next()).value).toStrictEqual(
        textContent('partial'),
      );

      await advanceTimersByTimeAsync(RENEWAL_MS);
      expect(harness.sockets[0].closedByClient).toBe(false);
      complete(harness.sockets[0], ' rest');
      expect(await drain(iterator)).toContainEqual(textContent(' rest'));
      expect(harness.sockets[0].closedByClient).toBe(true);

      expect(
        await drain(transport.streamResponse(request(), options())),
      ).toContainEqual(textContent('next'));
    });

    it('serializes a queued request across the active renewal boundary', async () => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () =>
            socket.message(
              frame({ type: 'response.output_text.delta', delta: 'first' }),
            );
        },
        completingScript('second'),
      ]);
      const transport = transportFor(harness);
      const first = transport.streamResponse(request(), options());
      await first.next();
      const second = drain(transport.streamResponse(request(), options()));

      await advanceTimersByTimeAsync(RENEWAL_MS);
      expect(harness.sockets).toHaveLength(1);
      complete(harness.sockets[0]);
      await drain(first);

      expect(await second).toContainEqual(textContent('second'));
      expect(harness.sockets[0].sent).toHaveLength(1);
    });

    it('observes a server lifecycle error received between turns', async () => {
      const harness = new SocketHarness([completingScript('answer')]);
      const transport = transportFor(harness);
      await drain(transport.streamResponse(request(), options()));

      harness.sockets[0].message(connectionLimitErrorFrame());

      expect(harness.sockets[0].closedByClient).toBe(true);
      const error: unknown = await drain(
        transport.streamResponse(
          { ...request(), previous_response_id: 'old-parent' },
          options(),
        ),
      ).catch((reason: unknown) => reason);
      expect(isStatefulConnectionRenewalError(error)).toBe(true);
      expect(harness.sockets[0].sent).toHaveLength(1);
    });

    it('ignores a captured old renewal callback after a replacement socket opens', async () => {
      const timers = vi.spyOn(globalThis, 'setTimeout');
      const harness = new SocketHarness([completingScript('answer')]);
      const transport = transportFor(harness);
      await drain(transport.streamResponse(request(), options()));
      const oldCallback = timers.mock.calls.find(
        ([, delay]) => delay === RENEWAL_MS,
      )?.[0];
      if (typeof oldCallback !== 'function')
        throw new Error('Expected connection renewal timer');
      transport.close();
      await drain(transport.streamResponse(request(), options()));

      oldCallback();

      expect(harness.sockets[1].closedByClient).toBe(false);
      expect(
        await drain(
          transport.streamResponse(
            { ...request(), previous_response_id: 'response' },
            options(),
          ),
        ),
      ).toContainEqual(textContent('answer'));
      expect(harness.sockets).toHaveLength(2);
    });

    it('checks age after a queued turn acquires ownership without timer delivery', async () => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () =>
            socket.message(
              frame({ type: 'response.output_text.delta', delta: 'first' }),
            );
        },
        completingScript('second'),
      ]);
      const transport = transportFor(harness);
      const first = transport.streamResponse(request(), options());
      await first.next();
      const queued = drain(transport.streamResponse(request(), options()));
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + RENEWAL_MS);
      expect(harness.sockets[0].closedByClient).toBe(false);
      expect(harness.sockets[0].sent).toHaveLength(1);
      complete(harness.sockets[0]);
      await drain(first);

      expect(await queued).toContainEqual(textContent('second'));
      expect(harness.sockets[0].closedByClient).toBe(true);
      expect(harness.sockets[0].sent).toHaveLength(1);
      expect(harness.sockets).toHaveLength(2);
    });

    it('cancels old connection timers when closed and leaves replacement lifetime intact', async () => {
      const harness = new SocketHarness([completingScript('answer')]);
      const transport = transportFor(harness);
      await drain(transport.streamResponse(request(), options()));
      await advanceTimersByTimeAsync(RENEWAL_MS / 2);
      transport.close();
      await drain(transport.streamResponse(request(), options()));

      await advanceTimersByTimeAsync(RENEWAL_MS / 2);
      expect(harness.sockets[1].closedByClient).toBe(false);
      await advanceTimersByTimeAsync(RENEWAL_MS / 2);
      expect(harness.sockets[1].closedByClient).toBe(true);
    });

    it('releases an aborted active turn when retirement was deferred', async () => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () =>
            socket.message(
              frame({ type: 'response.output_text.delta', delta: 'partial' }),
            );
        },
        completingScript('later'),
      ]);
      const transport = transportFor(harness);
      const controller = new AbortController();
      const iterator = transport.streamResponse(
        request(),
        options({ abortSignal: controller.signal }),
      );
      await iterator.next();
      await advanceTimersByTimeAsync(RENEWAL_MS);
      controller.abort();

      await expect(iterator.next()).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(harness.sockets[0].closedByClient).toBe(true);
      expect(
        await drain(transport.streamResponse(request(), options())),
      ).toContainEqual(textContent('later'));
    });
  });
});
