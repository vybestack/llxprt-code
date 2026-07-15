/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import {
  processAnthropicStream,
  type StreamProcessorOptions,
} from './AnthropicStreamProcessor.js';

const streamOptions: StreamProcessorOptions = {
  isOAuth: false,
  tools: undefined,
  unprefixToolName: (name) => name,
  findToolSchema: () => undefined,
  logger: { debug: () => undefined },
  cacheLogger: { debug: () => undefined },
  rateLimitLogger: { debug: () => undefined },
};

async function* failingAnthropicStream(): AsyncGenerator<Anthropic.MessageStreamEvent> {
  yield await Promise.reject<Anthropic.MessageStreamEvent>(
    new Error('fetch failed'),
  );
}

async function collect(stream: AsyncIterable<IContent>): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('Anthropic stream retry ownership', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses only the central transport attempt budget for stream network failures', async () => {
    let transportCalls = 0;
    const transport: IProvider = {
      name: 'anthropic',
      async *generateChatCompletion() {
        transportCalls++;
        if (transportCalls < 3) {
          yield* processAnthropicStream(
            failingAnthropicStream(),
            streamOptions,
          );
          return;
        }
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'claude-test',
      getServerTools: () => [],
      invokeServerTool: async () => null,
    };
    const provider = new RetryOrchestrator(transport, {
      maxAttempts: 3,
      initialDelayMs: 0,
    });

    const chunks = await collect(
      provider.generateChatCompletion({
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
      }),
    );

    expect(transportCalls).toBe(3);
    expect(chunks).toStrictEqual([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] },
    ]);
  });

  it('does not start another Anthropic transport after abort during backoff', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let transportCalls = 0;
    const transport: IProvider = {
      name: 'anthropic',
      async *generateChatCompletion(_options: GenerateChatOptions) {
        transportCalls++;
        yield* processAnthropicStream(failingAnthropicStream(), streamOptions);
      },
      getModels: async () => [],
      getDefaultModel: () => 'claude-test',
      getServerTools: () => [],
      invokeServerTool: async () => null,
    };
    const provider = new RetryOrchestrator(transport, {
      maxAttempts: 3,
      initialDelayMs: 100,
    });
    const result = collect(
      provider.generateChatCompletion({
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
        metadata: { abortSignal: controller.signal },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(transportCalls).toBe(1);
  });
});
