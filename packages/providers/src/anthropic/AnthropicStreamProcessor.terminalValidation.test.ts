/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #2532 (AC-06): Anthropic stream terminal-event validation.
 *
 * A streaming turn is only a success when the provider protocol delivers its
 * terminal event (message_stop). An SSE stream that ends without it is a
 * truncated failure — even if text, thinking, or tool output already
 * escaped — and must never complete as a successful turn. Deterministic
 * protocol violations (input_json_delta with no open tool_use block) are
 * malformed failures. Both stay retryable before any output escapes, and
 * never replay after it.
 *
 * The tests compose the real stream processor, the real retry orchestrator,
 * and (for wiring) the real AnthropicProvider. No unit under test is mocked.
 */

import { vi, describe, it, expect, afterEach } from 'bun:test';
import type Anthropic from '@anthropic-ai/sdk';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import {
  processAnthropicStream,
  type StreamProcessorOptions,
} from './AnthropicStreamProcessor.js';
import { decodeRetryFailure } from '../retryFailureTaxonomy.js';
import {
  StreamTruncatedError,
  MalformedStreamEventError,
} from '../streamProtocolErrors.js';
import {
  findRequestCommitState,
  getRequestCommitState,
  resolveRetryRequestContext,
} from '../retryRequestContext.js';
import { isTerminalRetryError } from '../retryErrorClassification.js';
import {
  setupAnthropicProvider,
  type AnthropicTestSetup,
} from './test-utils/anthropicProviderTestSetup.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

const baseProcessorOptions: StreamProcessorOptions = {
  isOAuth: false,
  tools: undefined,
  unprefixToolName: (name) => name,
  findToolSchema: () => undefined,
  logger: { debug: () => undefined },
  cacheLogger: { debug: () => undefined },
  rateLimitLogger: { debug: () => undefined },
  includeThinkingInResponse: true,
};

type Event = Anthropic.MessageStreamEvent;

function ev(value: unknown): Event {
  return value as Event;
}

const messageStart = ev({
  type: 'message_start',
  message: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content: [],
    model: 'claude-test',
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 0 },
  },
});

const messageStop = ev({ type: 'message_stop' });
const ping = ev({ type: 'ping' });
const textStart = ev({
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'text', text: '' },
});
const textStop = ev({ type: 'content_block_stop', index: 0 });
const messageDeltaStop = ev({
  type: 'message_delta',
  delta: { stop_reason: 'end_turn', stop_sequence: null },
  usage: { output_tokens: 2 },
});

function textDelta(text: string): Event {
  return ev({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  });
}

const thinkingStart = ev({
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'thinking' },
});

function thinkingDelta(thought: string): Event {
  return ev({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'thinking_delta', thinking: thought },
  });
}

const toolStart = ev({
  type: 'content_block_start',
  index: 1,
  content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather' },
});

function jsonDelta(partial: string): Event {
  return ev({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: partial },
  });
}

const toolStop = ev({ type: 'content_block_stop', index: 1 });

async function* sse(
  ...events: Event[]
): AsyncGenerator<Anthropic.MessageStreamEvent> {
  for (const event of events) yield event;
}

async function* sseThenThrow(
  events: Event[],
  error: unknown,
): AsyncGenerator<Anthropic.MessageStreamEvent> {
  for (const event of events) yield event;
  throw error;
}

/** Anthropic HTTP-200 in-band overload (SSE error event body). */
function inBandOverloadError(): Error {
  const error = new Error('Overloaded') as Error & {
    error?: { type: string; error?: { type: string } };
  };
  error.error = {
    type: 'error',
    error: { type: 'overloaded_error' },
  };
  return error;
}

function connectionResetError(): Error {
  const error = new Error('Connection reset') as Error & { code: string };
  error.code = 'ECONNRESET';
  return error;
}

async function collect(
  stream: AsyncIterable<IContent>,
): Promise<{ chunks: IContent[]; error: unknown }> {
  const chunks: IContent[] = [];
  let error: unknown;
  try {
    for await (const chunk of stream) chunks.push(chunk);
  } catch (caught) {
    error = caught;
  }
  return { chunks, error };
}

function freshRequestContext(): ReturnType<
  typeof resolveRetryRequestContext
> & { options: GenerateChatOptions } {
  return resolveRetryRequestContext(
    { contents: [] },
    {
      maxAttempts: 3,
      initialDelayMs: 1,
      authRetryTimeoutMs: 0,
    },
  );
}

describe('AnthropicStreamProcessor terminal-event validation (issue #2532)', () => {
  describe('processor level', () => {
    it('completes a stream that ends with message_stop and records terminalSeen on the shared commit state', async () => {
      const request = freshRequestContext();
      const { chunks, error } = await collect(
        processAnthropicStream(
          sse(
            messageStart,
            textStart,
            textDelta('Hello'),
            textStop,
            messageDeltaStop,
            messageStop,
          ),
          { ...baseProcessorOptions, commitState: request },
        ),
      );

      expect(error).toBeUndefined();
      expect(chunks.length).toBeGreaterThan(0);
      const state = getRequestCommitState(request);
      expect(state.terminalSeen).toBe(true);
      // The processor observes protocol events only; commitment belongs to
      // the guarded stream that yields outward.
      expect(state.committed).toBe(false);
    });

    it('throws a truncated failure when the stream ends without message_stop after output', async () => {
      const { chunks, error } = await collect(
        processAnthropicStream(
          sse(
            messageStart,
            textStart,
            textDelta('Hello'),
            textStop,
            messageDeltaStop,
          ),
          baseProcessorOptions,
        ),
      );

      expect(chunks.length).toBeGreaterThan(0);
      expect(error).toBeInstanceOf(StreamTruncatedError);
      const failure = decodeRetryFailure(error);
      expect(failure.kind).toBe('truncated');
      expect(failure.phase).toBe('stream');
    });

    it('treats an empty stream as truncated, not a successful turn', async () => {
      const { chunks, error } = await collect(
        processAnthropicStream(sse(), baseProcessorOptions),
      );

      expect(chunks).toStrictEqual([]);
      expect(error).toBeInstanceOf(StreamTruncatedError);
      expect(decodeRetryFailure(error).kind).toBe('truncated');
    });

    it('does not treat ping as a terminal event', async () => {
      const { error } = await collect(
        processAnthropicStream(sse(ping), baseProcessorOptions),
      );

      expect(error).toBeInstanceOf(StreamTruncatedError);
    });

    it('throws a malformed failure for input_json_delta without an open tool_use block', async () => {
      const { error } = await collect(
        processAnthropicStream(
          sse(messageStart, jsonDelta('{"city"')),
          baseProcessorOptions,
        ),
      );

      expect(error).toBeInstanceOf(MalformedStreamEventError);
      const failure = decodeRetryFailure(error);
      expect(failure.kind).toBe('malformed');
      expect(failure.phase).toBe('protocol');
    });

    it('still accepts input_json_delta while a tool_use block is open', async () => {
      const { error } = await collect(
        processAnthropicStream(
          sse(
            messageStart,
            toolStart,
            jsonDelta('{"city":"SF"}'),
            toolStop,
            messageStop,
          ),
          baseProcessorOptions,
        ),
      );

      expect(error).toBeUndefined();
    });
  });

  describe('composed with the retry orchestrator', () => {
    interface ScriptedAnthropicOptions {
      readonly scripts: ReadonlyArray<
        () => AsyncGenerator<Anthropic.MessageStreamEvent>
      >;
    }

    /**
     * A transport that behaves like AnthropicProvider's streaming path: it
     * runs the real stream processor and hands it the shared commit state
     * exactly the way the provider wiring does.
     */
    function scriptedAnthropicTransport(options: ScriptedAnthropicOptions): {
      provider: IProvider;
      calls: () => number;
    } {
      let calls = 0;
      const provider: IProvider = {
        name: 'anthropic-scripted',
        generateChatCompletion(
          requestOptions: GenerateChatOptions | IContent[],
        ): AsyncIterableIterator<IContent> {
          const resolved = requestOptions as GenerateChatOptions;
          const script =
            options.scripts[Math.min(calls, options.scripts.length - 1)];
          calls++;
          return processAnthropicStream(script(), {
            ...baseProcessorOptions,
            commitState: findRequestCommitState(resolved),
          });
        },
        getModels: async () => [],
        getDefaultModel: () => 'claude-test',
        getServerTools: () => [],
        invokeServerTool: async () => null,
      };
      return { provider, calls: () => calls };
    }

    function fullStream(): AsyncGenerator<Anthropic.MessageStreamEvent> {
      return sse(
        messageStart,
        textStart,
        textDelta('Hello'),
        textStop,
        messageDeltaStop,
        messageStop,
      );
    }

    it('usage metadata then connection reset: committed, never replayed', async () => {
      const { provider, calls } = scriptedAnthropicTransport({
        scripts: [
          () => sseThenThrow([messageStart], connectionResetError()),
          fullStream,
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 1,
      });

      const { chunks, error } = await collect(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(calls()).toBe(1);
      expect(chunks.length).toBe(1);
      expect(chunks[0]?.blocks).toStrictEqual([]);
      expect(chunks[0]?.metadata?.usage).toBeDefined();
      expect(error).toBeDefined();
      expect(isTerminalRetryError(error)).toBe(true);
    });

    it('HTTP-200 in-band overload before any output: retried within budget', async () => {
      const { provider, calls } = scriptedAnthropicTransport({
        scripts: [() => sseThenThrow([], inBandOverloadError()), fullStream],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 1,
      });

      const { chunks, error } = await collect(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(error).toBeUndefined();
      expect(calls()).toBe(2);
      const text = chunks
        .flatMap((c) => c.blocks)
        .find((b) => b.type === 'text');
      expect(text).toBeDefined();
    });

    it('HTTP-200 in-band overload after usage metadata: never replayed', async () => {
      const { provider, calls } = scriptedAnthropicTransport({
        scripts: [
          () => sseThenThrow([messageStart], inBandOverloadError()),
          fullStream,
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 1,
      });

      const { chunks, error } = await collect(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(calls()).toBe(1);
      expect(chunks.length).toBe(1);
      expect(error).toBeDefined();
      expect(isTerminalRetryError(error)).toBe(true);
    });

    it('HTTP-200 in-band overload after text: never replayed', async () => {
      const { provider, calls } = scriptedAnthropicTransport({
        scripts: [
          () =>
            sseThenThrow(
              [messageStart, textStart, textDelta('partial')],
              inBandOverloadError(),
            ),
          fullStream,
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 1,
      });

      const { chunks, error } = await collect(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(calls()).toBe(1);
      expect(error).toBeDefined();
      expect(isTerminalRetryError(error)).toBe(true);
      const text = chunks
        .flatMap((c) => c.blocks)
        .find((b) => b.type === 'text');
      expect(text).toBeDefined();
    });

    it('truncated stream before any output: retried within budget', async () => {
      const { provider, calls } = scriptedAnthropicTransport({
        scripts: [() => sse(), fullStream],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 1,
      });

      const { chunks, error } = await collect(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(error).toBeUndefined();
      expect(calls()).toBe(2);
      const text = chunks
        .flatMap((c) => c.blocks)
        .find((b) => b.type === 'text');
      expect(text).toBeDefined();
    });

    it('truncated stream after partial output: surfaces the failure, never committed as success', async () => {
      const { provider, calls } = scriptedAnthropicTransport({
        scripts: [
          () => sse(messageStart, textStart, textDelta('partial'), textStop),
          fullStream,
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 1,
      });

      const { chunks, error } = await collect(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(calls()).toBe(1);
      expect(error).toBeInstanceOf(StreamTruncatedError);
      expect(isTerminalRetryError(error)).toBe(true);
      const text = chunks
        .flatMap((c) => c.blocks)
        .find((b) => b.type === 'text');
      expect(text).toBeDefined();
    });

    it('partial thinking then failure: committed, never replayed', async () => {
      const { provider, calls } = scriptedAnthropicTransport({
        scripts: [
          () =>
            sseThenThrow(
              [messageStart, thinkingStart, thinkingDelta('let me think')],
              connectionResetError(),
            ),
          fullStream,
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 1,
      });

      const { chunks, error } = await collect(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(calls()).toBe(1);
      expect(error).toBeDefined();
      expect(isTerminalRetryError(error)).toBe(true);
      const thinking = chunks
        .flatMap((c) => c.blocks)
        .find((b) => b.type === 'thinking');
      expect(thinking).toBeDefined();
    });

    it('completed tool call then failure: committed, never replayed', async () => {
      const { provider, calls } = scriptedAnthropicTransport({
        scripts: [
          () =>
            sseThenThrow(
              [messageStart, toolStart, jsonDelta('{"city":"SF"}'), toolStop],
              connectionResetError(),
            ),
          fullStream,
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 1,
      });

      const { chunks, error } = await collect(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(calls()).toBe(1);
      expect(error).toBeDefined();
      expect(isTerminalRetryError(error)).toBe(true);
      const toolCall = chunks
        .flatMap((c) => c.blocks)
        .find((b) => b.type === 'tool_call');
      expect(toolCall).toBeDefined();
    });

    it('tool assembly interrupted before any emission: nothing escaped, replay allowed', async () => {
      const fullToolStream = () =>
        sse(
          messageStart,
          toolStart,
          jsonDelta('{"city":"SF"}'),
          toolStop,
          messageDeltaStop,
          messageStop,
        );
      const { provider, calls } = scriptedAnthropicTransport({
        scripts: [
          () =>
            sseThenThrow(
              // No message_start: tool assembly alone emits nothing outward.
              [toolStart, jsonDelta('{"city"')],
              connectionResetError(),
            ),
          fullToolStream,
        ],
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 3,
        initialDelayMs: 1,
      });

      const { chunks, error } = await collect(
        orchestrator.generateChatCompletion({ contents: [] }),
      );

      expect(error).toBeUndefined();
      expect(calls()).toBe(2);
      const toolCall = chunks
        .flatMap((c) => c.blocks)
        .find((b) => b.type === 'tool_call');
      expect(toolCall).toBeDefined();
    });
  });

  describe('AnthropicProvider wiring', () => {
    const mockMessagesCreate = vi.fn();

    void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
      getCoreSystemPromptAsync: vi.fn(
        async () => "You are Claude Code, Anthropic's official CLI for Claude.",
      ),
    }));

    void vi.mock('@anthropic-ai/sdk', () => ({
      default: vi.fn().mockImplementation(() => ({
        messages: { create: mockMessagesCreate },
      })),
    }));

    afterEach(() => {
      clearActiveProviderRuntimeContext();
      vi.clearAllMocks();
    });

    it('marks terminalSeen on the shared request commit state through the real provider stream', async () => {
      const setup: AnthropicTestSetup = setupAnthropicProvider();
      const provider = setup.provider;

      mockMessagesCreate.mockResolvedValue(
        (async function* () {
          yield messageStart;
          yield textStart;
          yield textDelta('Hello');
          yield textStop;
          yield messageDeltaStop;
          yield messageStop;
        })(),
      );

      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 2,
        initialDelayMs: 1,
      });
      const request = resolveRetryRequestContext(setup.buildCallOptions([]), {
        maxAttempts: 2,
        initialDelayMs: 1,
        authRetryTimeoutMs: 0,
      });

      const { error } = await collect(
        orchestrator.generateChatCompletion(request.options),
      );

      expect(error).toBeUndefined();
      expect(getRequestCommitState(request).terminalSeen).toBe(true);
    });
  });
});
