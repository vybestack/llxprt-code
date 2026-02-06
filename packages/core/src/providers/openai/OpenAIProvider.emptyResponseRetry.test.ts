import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import { IMessage } from '../IMessage.js';
import { ITool } from '../ITool.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';
import { resetSettingsService } from '../../settings/settingsServiceInstance.js';
import { initializeTestProviderRuntime } from '../../test-utils/runtime.js';
import type { SettingsService } from '../../settings/SettingsService.js';
import type { IContent } from '../IMessage.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('OpenAIProvider empty response retry (issue #584)', () => {
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
    provider.setRuntimeSettingsService?.(settingsService);
    provider.setConfig?.(runtime.config);
    settingsService.set('model', 'openai/gpt-oss-120b');
    settingsService.setProviderSetting(
      provider.name,
      'model',
      'openai/gpt-oss-120b',
    );
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

  it('should request continuation when tool calls complete but no text returned', async () => {
    // First response: tool call with finish_reason=stop but no text
    const firstResponseChunks = [
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

    // Second response: after continuation prompt, model provides text
    const secondResponseChunks = [
      JSON.stringify({
        id: 'chatcmpl-2',
        object: 'chat.completion.chunk',
        created: 1234567891,
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            index: 0,
            delta: {
              content: 'Found 984 TypeScript files in the project.',
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        id: 'chatcmpl-2',
        object: 'chat.completion.chunk',
        created: 1234567891,
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 20,
          total_tokens: 140,
        },
      }),
    ];

    // Mock fetch to return first response, then second response
    let callCount = 0;
    vi.mocked(global.fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return createStreamingResponse(firstResponseChunks);
      } else {
        return createStreamingResponse(secondResponseChunks);
      }
    });

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'look through the codebase and tell me what it does',
      },
    ];

    const tools: ITool[] = [
      {
        functionDeclarations: [
          {
            name: 'FindFiles',
            description: 'Find files matching a pattern',
            parameters: {
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

    // Verify we got tool calls first
    const toolCallContent = contents.find((c) =>
      c.blocks.some((b) => b.type === 'tool_call'),
    );
    expect(toolCallContent).toBeDefined();
    expect(toolCallContent?.blocks.some((b) => b.type === 'tool_call')).toBe(
      true,
    );

    // Verify we got text content (from automatic retry)
    const textContent = contents.find((c) =>
      c.blocks.some((b) => b.type === 'text'),
    );
    expect(textContent).toBeDefined();
    expect(
      textContent?.blocks.some(
        (b) => b.type === 'text' && b.text.includes('TypeScript'),
      ),
    ).toBe(true);

    // Verify fetch was called twice (original + retry)
    expect(callCount).toBe(2);

    // Verify the continuation request structure (CodeRabbit review #764)
    const secondFetchCall = vi.mocked(global.fetch).mock.calls[1];
    expect(secondFetchCall).toBeDefined();
    const secondRequestBody = JSON.parse(
      secondFetchCall?.[1]?.body as string,
    ) as {
      messages: Array<{
        role: string;
        content?: string;
        tool_calls?: unknown[];
        tool_call_id?: string;
      }>;
    };

    // Verify continuation messages structure
    expect(secondRequestBody.messages).toBeDefined();
    const continuationMessages = secondRequestBody.messages;

    // Should have assistant message with tool_calls
    const assistantMsg = continuationMessages.find(
      (m) => m.role === 'assistant' && m.tool_calls,
    );
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.tool_calls).toHaveLength(1);

    // Should have tool response messages with correct placeholder
    const toolResponseMsgs = continuationMessages.filter(
      (m) => m.role === 'tool',
    );
    expect(toolResponseMsgs).toHaveLength(1);
    expect(toolResponseMsgs[0]?.content).toBe(
      '[Tool call acknowledged - awaiting execution]',
    );

    // OpenAI-compatible strict providers (e.g. Chutes/MiniMax) require tool messages
    // to include the function name matching the prior assistant tool call.
    // Regression guard: continuation placeholder tool message must include name.
    expect(toolResponseMsgs[0]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_123',
      name: 'FindFiles',
    });

    // Should have user continuation prompt
    const continuationPrompt = continuationMessages.find(
      (m) =>
        m.role === 'user' &&
        m.content?.includes('tool calls above have been registered'),
    );
    expect(continuationPrompt).toBeDefined();
  });

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
            parameters: {
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
      contents.some((c) => c.blocks.some((b) => b.type === 'tool_call')),
    ).toBe(true);
    expect(contents.some((c) => c.blocks.some((b) => b.type === 'text'))).toBe(
      true,
    );

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
            parameters: {
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
      contents.some((c) => c.blocks.some((b) => b.type === 'tool_call')),
    ).toBe(true);

    // Verify fetch was called only once (no retry for length)
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });
});
