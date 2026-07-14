/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import type { IModel } from '../IModel.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';

async function collect(stream: AsyncIterable<IContent>): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('RetryOrchestrator timeout cleanup', () => {
  it('aborts and closes a timed-out attempt before starting the retry', async () => {
    let attempts = 0;
    let activeStreams = 0;
    let maximumActiveStreams = 0;
    let observedAborts = 0;
    let finalizedStreams = 0;
    const provider: IProvider = {
      name: 'abort-aware-timeout-provider',
      async *generateChatCompletion(options: GenerateChatOptions) {
        attempts++;
        activeStreams++;
        maximumActiveStreams = Math.max(maximumActiveStreams, activeStreams);
        try {
          if (attempts === 1) {
            const signal = options.invocation?.signal;
            await new Promise<void>((resolve, reject) => {
              const onAbort = () => {
                observedAborts++;
                reject(new Error('transport aborted'));
              };
              signal?.addEventListener('abort', onAbort, { once: true });
              if (signal?.aborted === true) onAbort();
            });
          }
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'success' }],
          } as IContent;
        } finally {
          activeStreams--;
          finalizedStreams++;
        }
      },
      async getModels(): Promise<IModel[]> {
        return [];
      },
      getDefaultModel: () => 'test-model',
      getServerTools: () => [],
      invokeServerTool: async () => null,
    };
    const orchestrator = new RetryOrchestrator(provider, {
      streamingTimeoutMs: 10,
      maxAttempts: 2,
      initialDelayMs: 0,
    });

    const chunks = await collect(
      orchestrator.generateChatCompletion({
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      }),
    );

    expect(chunks).toHaveLength(1);
    expect({
      attempts,
      maximumActiveStreams,
      observedAborts,
      finalizedStreams,
    }).toStrictEqual({
      attempts: 2,
      maximumActiveStreams: 1,
      observedAborts: 1,
      finalizedStreams: 2,
    });
  });
});
