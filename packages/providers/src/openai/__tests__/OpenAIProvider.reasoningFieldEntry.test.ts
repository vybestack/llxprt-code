/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Provider-entry behavioral tests for issue #2524: prove the full real wiring
 * from settings.get('reasoning.fieldName') through OpenAIProvider →
 * dispatchResponse → StreamProcessorDeps.reasoningFieldName →
 * parseStreamingReasoningDelta → terminal ThinkingBlock.sourceField.
 *
 * These tests exercise the real provider instance (no internal mocking of the
 * stream processor), so they prove the actual end-to-end wiring.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { OpenAIProvider } from '../OpenAIProvider.js';
import type {
  IContent,
  ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { initializeTestProviderRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { resetSettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type OpenAI from 'openai';
import { createOpenAIRawPostTestAdapter } from '../../test-utils/rawPostTestAdapters.js';

const mockChatCompletionsCreate = vi.fn();

void vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockChatCompletionsCreate,
      },
    };
    post = createOpenAIRawPostTestAdapter(mockChatCompletionsCreate).post;
  },
}));

function makeReasoningStreamChunk(
  delta: Record<string, unknown>,
  finishReason: string | null,
): OpenAI.Chat.Completions.ChatCompletionChunk {
  return {
    id: 'chatcmpl-entry',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  } as OpenAI.Chat.Completions.ChatCompletionChunk;
}

function makeStream(
  chunks: OpenAI.Chat.Completions.ChatCompletionChunk[],
): AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function findThinkingBlock(results: IContent[]): ThinkingBlock | undefined {
  for (const content of results) {
    for (const block of content.blocks) {
      if (block.type === 'thinking') {
        return block;
      }
    }
  }
  return undefined;
}

async function collectResults(
  iterable: AsyncIterable<IContent>,
): Promise<IContent[]> {
  const results: IContent[] = [];
  for await (const content of iterable) {
    results.push(content);
  }
  return results;
}

describe('OpenAIProvider reasoning.fieldName entry wiring (#2524)', () => {
  let provider: OpenAIProvider;
  let settingsService: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChatCompletionsCreate.mockClear();
    resetSettingsService();

    const runtime = initializeTestProviderRuntime({
      runtimeId: `openai-reasoning-entry-${Math.random().toString(36).slice(2, 10)}`,
      metadata: { suite: 'OpenAIProvider.reasoningFieldEntry.test' },
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

  it('forwards reasoning.fieldName to capture delta.reasoning with sourceField provenance', async () => {
    settingsService.set('reasoning.fieldName', 'reasoning');

    const chunks = [
      makeReasoningStreamChunk({ reasoning: 'ollama thinking trace' }, null),
      makeReasoningStreamChunk({}, 'stop'),
    ];
    mockChatCompletionsCreate.mockReturnValue(makeStream(chunks));

    const messages: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Test question' }] },
    ];

    const results = await collectResults(
      provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          settings: settingsService,
          contents: messages,
        }),
      ),
    );

    const thinking = findThinkingBlock(results);
    expect(thinking).toBeDefined();
    expect(thinking?.thought).toBe('ollama thinking trace');
    expect(thinking?.sourceField).toBe('reasoning');
  });

  it('does NOT capture reasoning_content when fieldName is explicitly "reasoning"', async () => {
    settingsService.set('reasoning.fieldName', 'reasoning');

    // Emit ONLY reasoning_content (not reasoning) — should produce NO thinking block
    // because the explicit field 'reasoning' is absent and no fallback applies.
    const chunks = [
      makeReasoningStreamChunk(
        { reasoning_content: 'should be ignored' },
        null,
      ),
      makeReasoningStreamChunk({}, 'stop'),
    ];
    mockChatCompletionsCreate.mockReturnValue(makeStream(chunks));

    const messages: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Test question' }] },
    ];

    const results = await collectResults(
      provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          settings: settingsService,
          contents: messages,
        }),
      ),
    );

    const thinking = findThinkingBlock(results);
    expect(thinking).toBeUndefined();
  });

  it('captures reasoning_content with sourceField provenance when fieldName is unset (default path)', async () => {
    // Leave reasoning.fieldName unset — standard provider default behavior
    const chunks = [
      makeReasoningStreamChunk(
        { reasoning_content: 'standard reasoning' },
        null,
      ),
      makeReasoningStreamChunk({}, 'stop'),
    ];
    mockChatCompletionsCreate.mockReturnValue(makeStream(chunks));

    const messages: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Test question' }] },
    ];

    const results = await collectResults(
      provider.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          settings: settingsService,
          contents: messages,
        }),
      ),
    );

    const thinking = findThinkingBlock(results);
    expect(thinking).toBeDefined();
    expect(thinking?.thought).toBe('standard reasoning');
    expect(thinking?.sourceField).toBe('reasoning_content');
  });
});
