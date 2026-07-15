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
import { getRequestSignal } from '../utils/abortSignal.js';

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
            const signal = getRequestSignal(options);
            if (signal === undefined) {
              throw new Error('Retry attempt signal is required');
            }
            await new Promise<void>((resolve, reject) => {
              const onAbort = () => {
                observedAborts++;
                reject(new Error('transport aborted'));
              };
              signal.addEventListener('abort', onAbort, { once: true });
              if (signal.aborted) onAbort();
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
      streamingTimeoutMs: 50,
      maxAttempts: 2,
      initialDelayMs: 0,
    });

    const chunks = await collect(
      orchestrator.generateChatCompletion({
        contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      }),
    );

    expect(chunks).toStrictEqual([
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'success' }],
      },
    ]);
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

  it('does not retry a timeout-wrapped stream after yielding content', async () => {
    let attemptCount = 0;
    const streamFailure = Object.assign(new Error('Connection reset'), {
      code: 'STREAM_INTERRUPTED',
    });
    const provider: IProvider = {
      name: 'timeout-wrapped-streaming-provider',
      async *generateChatCompletion() {
        attemptCount++;
        if (attemptCount === 1) {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'partial' }],
          };
          throw streamFailure;
        }
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'appended retry' }],
        };
      },
      async getModels(): Promise<IModel[]> {
        return [];
      },
      getDefaultModel: () => 'test-model',
      getServerTools: () => [],
      invokeServerTool: async () => null,
    };
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 3,
      initialDelayMs: 0,
      streamingTimeoutMs: 1_000,
    });
    const chunks: IContent[] = [];
    let thrown: unknown;

    try {
      for await (const chunk of orchestrator.generateChatCompletion({
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
      })) {
        chunks.push(chunk);
      }
    } catch (error) {
      thrown = error;
    }

    expect({ attemptCount, chunks, thrown }).toStrictEqual({
      attemptCount: 1,
      chunks: [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'partial' }],
        },
      ],
      thrown: streamFailure,
    });
  });
});
