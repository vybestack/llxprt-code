/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for OpenAI Responses HTTP/SSE stream integrity (issue #3049).
 *
 * AC1: no internal replay after output — a mid-body error after content was
 *      yielded rethrows and issues no second fetch.
 * AC2: internal and orchestrator attempts share one transport budget, so the
 *      total fetch count for `retries: N` is N, not N*N.
 * AC3: abrupt reader EOF without an accepted terminal response event raises a
 *      StreamInterruptionError instead of completing normally.
 *
 * Only the fetch boundary is faked. The real executor, the real SSE parser,
 * and (for AC2) the real RetryOrchestrator wrapping a real executor-backed
 * provider all run.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  executeOpenAIResponsesRequest,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import type { IModel } from '../IModel.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';

const TERMINAL_EVENT =
  'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}\n\n';

const encoder = new TextEncoder();

function encodeSse(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** A body that emits one text delta then errors the ReadableStream. */
function erroringAfterDeltaBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
        ),
      );
    },
    pull(controller) {
      // Reached only on the second read (after the enqueued delta is
      // consumed), simulating a body failure mid-stream.
      controller.error(new TypeError('body errored mid-stream'));
    },
  });
}

interface FetchMock {
  readonly calls: { count: number };
  restore(): void;
}

function installFetch(
  handler: (callIndex: number) => Promise<Response>,
): FetchMock {
  const original = globalThis.fetch;
  const calls = { count: 0 };
  const impl: typeof fetch = (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ): Promise<Response> => {
    const index = calls.count;
    calls.count += 1;
    return handler(index);
  };
  globalThis.fetch = impl;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

async function preOutputFailureThenSuccess(call: number): Promise<Response> {
  if (call === 0) throw new TypeError('fetch failed');
  return new Response(
    encodeSse([
      'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      TERMINAL_EVENT,
    ]),
    { status: 200 },
  );
}

function buildNormalizedOptions(
  overrides: {
    ephemerals?: Record<string, unknown>;
  } & Partial<NormalizedGenerateChatOptions> = {},
): NormalizedGenerateChatOptions {
  const { ephemerals = {}, ...optionOverrides } = overrides;
  const settings = new SettingsService();
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'test-runtime',
  });
  const config = createRuntimeConfigStub(settings, {});
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'openai-responses',
    ephemeralsSnapshot: ephemerals,
    fallbackRuntimeId: 'test-runtime',
  });
  const base = {
    contents: [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'Hello' }],
      },
    ],
    settings,
    config,
    runtime,
    invocation,
    userMemory: undefined,
    tools: undefined,
    systemInstruction: 'test system prompt',
    metadata: {},
    resolved: {
      model: 'gpt-5',
      baseURL: 'https://api.openai.com/v1',
      authToken: 'test-token',
    },
  } as unknown as NormalizedGenerateChatOptions;
  return { ...base, ...optionOverrides };
}

function buildDeps(
  overrides: Partial<ResponsesExecutorDeps> = {},
): ResponsesExecutorDeps {
  return {
    providerName: 'openai-responses',
    logger: {
      debug: () => undefined,
    } as unknown as ResponsesExecutorDeps['logger'],
    getProviderBaseURL: () => 'https://api.openai.com/v1',
    getCustomHeaders: () => undefined,
    isCodexBaseURL: () => false,
    getCodexAccountId: async () => 'codex-account',
    resolveAuthTokenForPrompt: async () => '',
    shouldRetryOnError: () => true,
    getDefaultModel: () => 'gpt-5',
    getGlobalConfig: () => undefined,
    ...overrides,
  };
}

/**
 * User-defined type guard bridging the IProvider contract (GenerateChatOptions)
 * to the executor's NormalizedGenerateChatOptions, mirroring how BaseProvider
 * normalizes before dispatching. Avoids an unsafe assertion.
 */
function isNormalizedOptions(
  options: GenerateChatOptions,
): options is NormalizedGenerateChatOptions {
  return (
    typeof options === 'object' &&
    'settings' in options &&
    'invocation' in options &&
    'resolved' in options
  );
}

function createExecutorProvider(deps: ResponsesExecutorDeps): IProvider {
  return {
    name: 'openai-responses',
    async *generateChatCompletion(
      options: GenerateChatOptions,
    ): AsyncIterableIterator<IContent> {
      if (!isNormalizedOptions(options)) {
        throw new Error('test provider requires normalized options');
      }
      yield* executeOpenAIResponsesRequest(options, deps);
    },
    async getModels(): Promise<IModel[]> {
      return [];
    },
    getDefaultModel(): string {
      return 'gpt-5';
    },
  };
}

async function drainWithPossibleRejection(
  iterator: AsyncIterableIterator<IContent>,
): Promise<{ messages: IContent[]; error: unknown | undefined }> {
  const messages: IContent[] = [];
  let error: unknown | undefined;
  try {
    for await (const chunk of iterator) messages.push(chunk);
  } catch (caught) {
    error = caught;
  }
  return { messages, error };
}

describe('OpenAI Responses HTTP/SSE stream integrity @issue:3049', () => {
  let fetchMock: FetchMock | undefined;

  beforeEach(() => {
    fetchMock = undefined;
  });

  afterEach(() => {
    fetchMock?.restore();
  });

  it('AC1: rethrows without replay when the body errors after output', async () => {
    fetchMock = installFetch(
      async () => new Response(erroringAfterDeltaBody(), { status: 200 }),
    );
    const options = buildNormalizedOptions({
      ephemerals: { retries: 3, retrywait: 0 },
    });
    const { messages, error } = await drainWithPossibleRejection(
      executeOpenAIResponsesRequest(options, buildDeps()),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toStrictEqual({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'partial' }],
    });
    expect(error).toBeInstanceOf(Error);
    expect(fetchMock.calls.count).toBe(1);
  });

  it('AC1 control: a pre-output failure still retries and then succeeds', async () => {
    fetchMock = installFetch(preOutputFailureThenSuccess);
    const options = buildNormalizedOptions({
      ephemerals: { retries: 3, retrywait: 0 },
    });
    const messages: IContent[] = [];
    for await (const chunk of executeOpenAIResponsesRequest(
      options,
      buildDeps(),
    )) {
      messages.push(chunk);
    }

    const text = messages
      .flatMap((m) => m.blocks)
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
    expect(text).toBe('ok');
    expect(fetchMock.calls.count).toBe(2);
  });

  it('AC2: shared budget bounds total fetch calls to N, not N*N', async () => {
    const N = 3;
    fetchMock = installFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const provider = createExecutorProvider(buildDeps());
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: N,
      initialDelayMs: 0,
    });
    const options = buildNormalizedOptions({
      ephemerals: { retries: N, retrywait: 1 },
    });

    const { error } = await drainWithPossibleRejection(
      orchestrator.generateChatCompletion(options),
    );

    expect(error).toBeDefined();
    expect(fetchMock.calls.count).toBe(N);
  });

  it('AC3: EOF without a terminal event rejects with StreamInterruptionError', async () => {
    fetchMock = installFetch(
      async () =>
        new Response(
          encodeSse([
            'data: {"type":"response.output_text.delta","delta":"hello"}\n\n',
          ]),
          { status: 200 },
        ),
    );
    const options = buildNormalizedOptions();
    const { error } = await drainWithPossibleRejection(
      executeOpenAIResponsesRequest(options, buildDeps()),
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('StreamInterruptionError');
    expect((error as Error).message).toContain('terminal');
  });

  it('AC3 control: the same body with a terminal event completes normally', async () => {
    fetchMock = installFetch(
      async () =>
        new Response(
          encodeSse([
            'data: {"type":"response.output_text.delta","delta":"hello"}\n\n',
            TERMINAL_EVENT,
          ]),
          { status: 200 },
        ),
    );
    const options = buildNormalizedOptions();
    const messages: IContent[] = [];
    for await (const chunk of executeOpenAIResponsesRequest(
      options,
      buildDeps(),
    )) {
      messages.push(chunk);
    }

    expect(messages.some((m) => m.blocks.some((b) => b.type === 'text'))).toBe(
      true,
    );
    expect(messages.some((m) => m.metadata?.finishReason === 'completed')).toBe(
      true,
    );
  });

  // Regression for issue #3049: a nonterminal lifecycle event following an
  // accepted terminal event in the SAME reader chunk must not mask the
  // terminal. Previously the parser only inspected the last dispatched type
  // after the chunk, so a trailing nonterminal event caused EOF to throw a
  // spurious StreamInterruptionError — behavior that depended on network
  // chunking.

  // SSE frames are terminated by a blank line. Build the terminator from a
  // char code so the fixtures carry no inline escape sequences.
  const FRAME_END = String.fromCharCode(10) + String.fromCharCode(10);
  const sse = (json: string): string => 'data: ' + json + FRAME_END;

  // A valid nonterminal lifecycle event the real parser accepts (default
  // case, no handler). Used as the masking event that follows the terminal.
  const CREATED_EVENT = sse(
    '{"type":"response.created","response":{"id":"resp_1","status":"in_progress"}}',
  );

  const ACCEPTED_TERMINAL_FIXTURES: ReadonlyArray<{
    readonly label: string;
    readonly event: string;
    readonly finishReason: string;
  }> = [
    {
      label: 'response.completed',
      event: TERMINAL_EVENT,
      finishReason: 'completed',
    },
    {
      label: 'response.done',
      event: sse(
        '{"type":"response.done","response":{"id":"resp_1","status":"completed"}}',
      ),
      finishReason: 'completed',
    },
    {
      label: 'response.incomplete',
      event: sse(
        '{"type":"response.incomplete","response":{"id":"resp_1","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}',
      ),
      finishReason: 'incomplete',
    },
  ];

  for (const fixture of ACCEPTED_TERMINAL_FIXTURES) {
    it(`AC4: completes normally when ${fixture.label} is followed by a nonterminal event in one chunk`, async () => {
      fetchMock = installFetch(
        async () =>
          // Both events in a single encoded ReadableStream chunk.
          new Response(encodeSse([fixture.event + CREATED_EVENT]), {
            status: 200,
          }),
      );
      const options = buildNormalizedOptions();
      const { messages, error } = await drainWithPossibleRejection(
        executeOpenAIResponsesRequest(options, buildDeps()),
      );

      expect(error).toBeUndefined();
      expect(
        messages.some((m) => m.metadata?.finishReason === fixture.finishReason),
      ).toBe(true);
    });
  }

  it('AC4: terminal-then-nonterminal is chunk-boundary independent (response.completed)', async () => {
    const fixture = ACCEPTED_TERMINAL_FIXTURES[0];

    // Both events in one reader chunk.
    fetchMock = installFetch(
      async () =>
        new Response(encodeSse([fixture.event + CREATED_EVENT]), {
          status: 200,
        }),
    );
    const single = await drainWithPossibleRejection(
      executeOpenAIResponsesRequest(buildNormalizedOptions(), buildDeps()),
    );
    fetchMock.restore();
    fetchMock = undefined;

    // The identical two events split across separate reader chunks.
    fetchMock = installFetch(
      async () => new Response(encodeSse([fixture.event, CREATED_EVENT])),
    );
    const split = await drainWithPossibleRejection(
      executeOpenAIResponsesRequest(buildNormalizedOptions(), buildDeps()),
    );

    // Both packings must succeed and carry the same terminal metadata,
    // proving the result does not depend on how the network frames chunks.
    expect(single.error).toBeUndefined();
    expect(split.error).toBeUndefined();
    expect(
      single.messages.some(
        (m) => m.metadata?.finishReason === fixture.finishReason,
      ),
    ).toBe(true);
    expect(
      split.messages.some(
        (m) => m.metadata?.finishReason === fixture.finishReason,
      ),
    ).toBe(true);
  });

  it('AC4 precedence: a response.failed after an accepted terminal still throws its provider error', async () => {
    const FAILED_AFTER_COMPLETED =
      TERMINAL_EVENT +
      sse(
        '{"type":"response.failed","response":{"id":"resp_1","status":"failed","error":{"message":"server failed after completion"}}}',
      );
    fetchMock = installFetch(
      async () =>
        // Terminal accepted event, then a protocol failure in the same chunk.
        new Response(encodeSse([FAILED_AFTER_COMPLETED]), { status: 200 }),
    );
    const options = buildNormalizedOptions();
    const { error } = await drainWithPossibleRejection(
      executeOpenAIResponsesRequest(options, buildDeps()),
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('server failed');
    // The terminal-masking fix must never swallow a protocol-failure throw:
    // it surfaces as a retryable interruption error, not a clean completion.
    expect((error as Error).name).toBe('StreamInterruptionError');
  });
});
