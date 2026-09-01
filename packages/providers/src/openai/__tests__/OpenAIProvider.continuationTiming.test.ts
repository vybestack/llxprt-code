/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #3473 OCR remediation: the continuation request
 * issued after tool-calls-without-text belongs to the same attempt, so every
 * token-bearing continuation raw delta (content, reasoning_content/reasoning,
 * tool_calls fragments) must fire the attempt-lifecycle raw-delta notifier
 * exactly once. Visible output is unchanged: only content deltas yield text;
 * continuation reasoning and tool-call fragments were never emitted and must
 * stay invisible.
 *
 * Composition: the real OpenAIProvider over the real stream processor and
 * the real continuation request path. Only the OpenAI SDK client (the
 * external HTTP boundary) is replaced, following the OpenAIProvider.e2e
 * precedent.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import type OpenAI from 'openai';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { OpenAIProvider } from '../OpenAIProvider.js';
import { initializeTestProviderRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { resetSettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import {
  ATTEMPT_LIFECYCLE_KEY,
  type AttemptLifecycleObserver,
} from '../../logging/attemptLifecycle.js';

const mockChatCompletionsCreate = vi.fn();

void vi.mock('openai', () => ({
  default: class MockOpenAI {
    readonly chat = {
      completions: { create: mockChatCompletionsCreate },
    };
  },
}));

/** Wire delta shape including the vLLM/DeepSeek reasoning stream field. */
type WireDelta = OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
  reasoning_content?: string;
};

type WireFinishReason =
  OpenAI.Chat.Completions.ChatCompletionChunk.Choice['finish_reason'];

function makeChunk(
  delta: WireDelta,
  finishReason: WireFinishReason,
  usage?: OpenAI.Chat.Completions.ChatCompletionChunk['usage'],
): OpenAI.Chat.Completions.ChatCompletionChunk {
  const chunk: OpenAI.Chat.Completions.ChatCompletionChunk = {
    id: 'chunk-continuation-test',
    object: 'chat.completion.chunk',
    created: 1000000,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  };
  if (usage !== undefined) {
    chunk.usage = usage;
  }
  return chunk;
}

function streamOf(
  chunks: readonly OpenAI.Chat.Completions.ChatCompletionChunk[],
): AsyncGenerator<
  OpenAI.Chat.Completions.ChatCompletionChunk,
  void,
  undefined
> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

/**
 * Primary stream: one complete tool-call fragment, then finish with usage.
 * Tool calls with no text and finish_reason=stop trigger the real
 * continuation request. The fragment delta fires the raw notifier once;
 * the empty finish delta is not token-bearing and must not fire.
 */
function primaryToolCallStream(): AsyncGenerator<
  OpenAI.Chat.Completions.ChatCompletionChunk,
  void,
  undefined
> {
  return streamOf([
    makeChunk(
      {
        tool_calls: [
          {
            index: 0,
            id: 'call_0',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city":"SF"}',
            },
          },
        ],
      },
      null,
    ),
    makeChunk({}, 'stop', {
      prompt_tokens: 50,
      completion_tokens: 40,
      total_tokens: 90,
    }),
  ]);
}

function continuationFinishChunk(): OpenAI.Chat.Completions.ChatCompletionChunk {
  return makeChunk({}, 'stop', {
    prompt_tokens: 60,
    completion_tokens: 20,
    total_tokens: 80,
  });
}

function makeCountingObserver(): {
  observer: AttemptLifecycleObserver;
  rawDeltaCount: () => number;
} {
  let rawDeltas = 0;
  const observer: AttemptLifecycleObserver = {
    onAttemptStart: () => {},
    onAttemptEnd: () => {},
    onRawTokenDelta: () => {
      rawDeltas++;
    },
  };
  return { observer, rawDeltaCount: () => rawDeltas };
}

function makeToolFragmentDelta(): WireDelta {
  return {
    tool_calls: [
      {
        index: 1,
        function: {
          arguments: '{"city":"OA',
        },
      },
    ],
  };
}

function collectText(chunks: readonly IContent[]): string {
  let out = '';
  for (const chunk of chunks) {
    for (const block of chunk.blocks) {
      if (block.type === 'text' && 'text' in block) {
        out += block.text;
      }
    }
  }
  return out;
}

describe('issue #3473: continuation raw-delta timing through the lifecycle notifier', () => {
  let provider: OpenAIProvider;
  let settingsService: ReturnType<
    typeof initializeTestProviderRuntime
  >['settingsService'];

  beforeEach(() => {
    vi.clearAllMocks();
    mockChatCompletionsCreate.mockReset();
    resetSettingsService();

    const runtime = initializeTestProviderRuntime({
      runtimeId: `openai-continuation-timing-${Math.random().toString(36).slice(2, 10)}`,
      metadata: { suite: 'OpenAIProvider.continuationTiming.test' },
      configOverrides: {
        getProvider: () => 'openai',
        getModel: () => 'gpt-4o',
        getEphemeralSettings: () => ({ model: 'gpt-4o' }),
      },
    });

    settingsService = runtime.settingsService;
    provider = new OpenAIProvider('test-api-key', 'https://api.openai.com/v1');
    provider.setRuntimeSettingsService(settingsService);
    provider.setConfig?.(runtime.config);

    settingsService.set('activeProvider', provider.name);
    settingsService.set('model', 'gpt-4o');
    settingsService.setProviderSetting(provider.name, 'model', 'gpt-4o');
  });

  async function runWithContinuation(
    observer: AttemptLifecycleObserver,
    continuationChunks: readonly OpenAI.Chat.Completions.ChatCompletionChunk[],
  ): Promise<IContent[]> {
    mockChatCompletionsCreate
      .mockReturnValueOnce(primaryToolCallStream())
      .mockReturnValueOnce(
        streamOf([...continuationChunks, continuationFinishChunk()]),
      );

    const results: IContent[] = [];
    for await (const chunk of provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        settings: settingsService,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'call the tool' }],
          },
        ],
        metadata: { [ATTEMPT_LIFECYCLE_KEY]: observer },
      }),
    )) {
      results.push(chunk);
    }
    return results;
  }

  function expectToolCallBlocks(results: readonly IContent[]): void {
    const toolCallBlocks = results
      .flatMap((chunk) => chunk.blocks)
      .filter((block) => block.type === 'tool_call');
    expect(toolCallBlocks).toHaveLength(1);
  }

  it('CT-1: content-only continuation deltas fire the notifier exactly once per delta', async () => {
    const { observer, rawDeltaCount } = makeCountingObserver();

    const results = await runWithContinuation(observer, [
      makeChunk({ content: 'Hello ' }, null),
      makeChunk({ content: 'world' }, null),
    ]);

    // 1 primary tool-call fragment + 2 continuation content deltas.
    expect(rawDeltaCount()).toBe(3);
    expect(collectText(results)).toBe('Hello world');
    expectToolCallBlocks(results);
  });

  it('CT-2: reasoning-only continuation deltas fire the notifier exactly once per delta', async () => {
    const { observer, rawDeltaCount } = makeCountingObserver();

    const results = await runWithContinuation(observer, [
      makeChunk({ reasoning_content: 'step 1' }, null),
      makeChunk({ reasoning_content: ' step 2' }, null),
      makeChunk({ reasoning_content: ' step 3' }, null),
    ]);

    // 1 primary fragment + 3 reasoning deltas.
    expect(rawDeltaCount()).toBe(4);
    // Visible output unchanged: reasoning deltas yield nothing.
    expect(collectText(results)).toBe('');
    expectToolCallBlocks(results);
  });

  it('CT-3: tool-call-only continuation deltas fire the notifier exactly once per delta', async () => {
    const { observer, rawDeltaCount } = makeCountingObserver();

    const results = await runWithContinuation(observer, [
      makeChunk(makeToolFragmentDelta(), null),
      makeChunk(makeToolFragmentDelta(), null),
      makeChunk(makeToolFragmentDelta(), null),
    ]);

    // 1 primary fragment + 3 continuation fragments.
    expect(rawDeltaCount()).toBe(4);
    // Visible output unchanged: continuation fragments yield nothing and
    // the primary's single tool call still surfaces exactly once.
    expect(collectText(results)).toBe('');
    expectToolCallBlocks(results);
  });

  it('CT-4: mixed continuation deltas fire exactly once per raw delta with no double-stamping', async () => {
    const { observer, rawDeltaCount } = makeCountingObserver();

    const results = await runWithContinuation(observer, [
      makeChunk({ content: 'Answer.', reasoning_content: 'why' }, null),
      makeChunk({ reasoning_content: ' more' }, null),
      makeChunk(makeToolFragmentDelta(), null),
    ]);

    // 1 primary fragment + 3 continuation deltas. The first continuation
    // delta carries content AND reasoning and must still count once, so a
    // double-stamp would surface as 5.
    expect(rawDeltaCount()).toBe(4);
    expect(collectText(results)).toBe('Answer.');
    expectToolCallBlocks(results);
  });
});
