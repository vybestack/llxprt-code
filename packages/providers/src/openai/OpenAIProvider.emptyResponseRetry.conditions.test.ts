/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import type { IMessage } from '../IMessage.js';
import type { ITool } from '../ITool.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';
import { resetSettingsService } from '@vybestack/llxprt-code-settings';
import { initializeTestProviderRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '../IMessage.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('OpenAIProvider empty response retry conditions (issue #584)', () => {
  let provider: OpenAIProvider;
  let settingsService: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSettingsService();
    const runtime = initializeTestProviderRuntime({
      runtimeId: `openai-provider.emptyResponseRetry.${Math.random()
        .toString(36)
        .slice(2, 10)}`,
      metadata: {
        suite: 'OpenAIProvider.emptyResponseRetry.test',
      },
      configOverrides: {
        getProvider: () => 'openai',
        getModel: () => 'openai/gpt-oss-120b',
        getEphemeralSettings: () => ({ model: 'openai/gpt-oss-120b' }),
      },
    });
    settingsService = runtime.settingsService;
    provider = new OpenAIProvider('test-key', 'https://openrouter.ai/api/v1/');
    provider.setRuntimeSettingsService(settingsService);
    provider.setConfig?.(runtime.config);
    settingsService.set('model', 'openai/gpt-oss-120b');
    settingsService.setProviderSetting(
      provider.name,
      'model',
      'openai/gpt-oss-120b',
    );
    settingsService.set('reasoning.includeInContext', false);
  });

  function createStreamingResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => {
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        });
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  it('should not retry when text is already present with tool calls', async () => {
    // Response: tool call WITH text content - no retry needed
    const responseChunks = [
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'FindFiles',
                    arguments: '{"pattern":"**/*.ts"}',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            index: 0,
            delta: {
              content: 'Let me search for TypeScript files.',
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      }),
    ];

    vi.mocked(global.fetch).mockResolvedValueOnce(
      createStreamingResponse(responseChunks),
    );

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'look through the codebase',
      },
    ];

    const tools: ITool[] = [
      {
        functionDeclarations: [
          {
            name: 'FindFiles',
            description: 'Find files matching a pattern',
            parametersJsonSchema: {
              type: 'object',
              properties: {
                pattern: {
                  type: 'string',
                  description: 'The glob pattern to match',
                },
              },
              required: ['pattern'],
            },
          },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(messages, tools, {
      stream: true,
    });

    const contents: IContent[] = [];
    for await (const content of generator) {
      contents.push(content);
    }

    // Verify we got both tool calls and text
    expect(
      contents.some((c): boolean =>
        c.blocks.some((b) => b.type === 'tool_call'),
      ),
    ).toBe(true);
    expect(
      contents.some((c): boolean => c.blocks.some((b) => b.type === 'text')),
    ).toBe(true);

    // Verify fetch was called only once (no retry)
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it('should not retry on finish_reason=length', async () => {
    // Response: tool call with finish_reason=length (truncated, not empty)
    const responseChunks = [
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'FindFiles',
                    arguments: '{"pattern":"**/*.ts"}',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'length',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 4096,
          total_tokens: 4196,
        },
      }),
    ];

    vi.mocked(global.fetch).mockResolvedValueOnce(
      createStreamingResponse(responseChunks),
    );

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'analyze the code',
      },
    ];

    const tools: ITool[] = [
      {
        functionDeclarations: [
          {
            name: 'FindFiles',
            description: 'Find files matching a pattern',
            parametersJsonSchema: {
              type: 'object',
              properties: {
                pattern: {
                  type: 'string',
                  description: 'The glob pattern to match',
                },
              },
              required: ['pattern'],
            },
          },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(messages, tools, {
      stream: true,
    });

    const contents: IContent[] = [];
    for await (const content of generator) {
      contents.push(content);
    }

    // Verify we got tool calls
    expect(
      contents.some((c): boolean =>
        c.blocks.some((b) => b.type === 'tool_call'),
      ),
    ).toBe(true);

    // Verify fetch was called only once (no retry for length)
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });
});
