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
      {
        role: ContentGeneratorRole.MODEL,
        content: {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'pre-tool hidden reasoning that should not be replayed',
              sourceField: 'reasoning_content',
            },
            {
              type: 'text',
              text: 'I will inspect the repository now.',
            },
          ],
        },
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

    settingsService.set('reasoning.includeInContext', true);

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
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: {
            name?: string;
            arguments?: string;
          };
        }>;
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

    // In strict OpenAI-compatible mode we must preserve OpenAI-style IDs in
    // continuation replay (e.g. call_123), not rewritten history IDs.
    const continuationToolCallId =
      assistantMsg?.tool_calls?.[0] &&
      typeof assistantMsg.tool_calls[0].id === 'string'
        ? assistantMsg.tool_calls[0].id
        : undefined;
    expect(continuationToolCallId).toMatch(/^call_/);

    expect(toolResponseMsgs[0]?.content).toBe(
      '[Tool call acknowledged - awaiting execution]',
    );

    // Assistant tool_call IDs and following tool tool_call_id MUST stay aligned.
    // Strict OpenAI-compatible gateways validate adjacency and exact ID matching.
    const assistantToolCallIds =
      assistantMsg?.tool_calls
        ?.map((tc) => tc.id)
        .filter((id): id is string => typeof id === 'string') ?? [];
    const toolResponseIds = toolResponseMsgs
      .map((m) => m.tool_call_id)
      .filter((id): id is string => typeof id === 'string');

    expect(assistantToolCallIds).toEqual(['call_123']);
    expect(toolResponseIds).toEqual(assistantToolCallIds);

    // OpenAI chat-completions tool messages should remain schema-compatible:
    // role/content/tool_call_id only. Some strict OpenAI-compatible backends
    // reject unknown fields on tool messages.
    expect(toolResponseMsgs[0]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_123',
    });
    expect(toolResponseMsgs[0]).not.toHaveProperty('name');

    // Continuation request should not leak reasoning_content fields into replayed
    // history messages. Some strict OpenAI-compatible gateways reject assistant
    // tool-call messages carrying extra fields (e.g. reasoning_content).
    const assistantMessages = continuationMessages.filter(
      (m) => m.role === 'assistant',
    );
    expect(assistantMessages.length).toBeGreaterThan(0);
    for (const assistant of assistantMessages) {
      expect(assistant).not.toHaveProperty('reasoning_content');
    }

    // Should have user continuation prompt
    const continuationPrompt = continuationMessages.find(
      (m) =>
        m.role === 'user' &&
        m.content?.includes('tool calls above have been registered'),
    );
    expect(continuationPrompt).toBeDefined();
  });

  it('should preserve provider tool_call IDs from choice.message in continuation replay', async () => {
    // First response: provider emits tool call in choice.message.tool_calls,
    // but no text. This should still trigger continuation.
    const firstResponseChunks = [
      JSON.stringify({
        id: 'chatcmpl-provider-1',
        object: 'chat.completion.chunk',
        created: 1234567990,
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            index: 0,
            delta: {},
            message: {
              tool_calls: [
                {
                  id: 'call_provider_999',
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
        id: 'chatcmpl-provider-1',
        object: 'chat.completion.chunk',
        created: 1234567990,
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 80,
          completion_tokens: 30,
          total_tokens: 110,
        },
      }),
    ];

    // Continuation response includes text
    const secondResponseChunks = [
      JSON.stringify({
        id: 'chatcmpl-provider-2',
        object: 'chat.completion.chunk',
        created: 1234567991,
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            index: 0,
            delta: {
              content: 'Found matching files and completed the scan.',
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        id: 'chatcmpl-provider-2',
        object: 'chat.completion.chunk',
        created: 1234567991,
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 95,
          completion_tokens: 18,
          total_tokens: 113,
        },
      }),
    ];

    let callCount = 0;
    vi.mocked(global.fetch).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return createStreamingResponse(firstResponseChunks);
      }
      return createStreamingResponse(secondResponseChunks);
    });

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'scan this repository for TypeScript files',
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

    for await (const _content of generator) {
      // Drain stream so continuation request is fully executed.
    }

    expect(callCount).toBe(2);

    const secondFetchCall = vi.mocked(global.fetch).mock.calls[1];
    expect(secondFetchCall).toBeDefined();

    const secondRequestBody = JSON.parse(
      secondFetchCall?.[1]?.body as string,
    ) as {
      messages: Array<{
        role: string;
        content?: string;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: {
            name?: string;
            arguments?: string;
          };
        }>;
        tool_call_id?: string;
      }>;
    };

    const continuationAssistant = secondRequestBody.messages.find(
      (m) => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0,
    );
    expect(continuationAssistant).toBeDefined();

    const continuationTool = secondRequestBody.messages.find(
      (m) => m.role === 'tool',
    );
    expect(continuationTool).toBeDefined();

    const assistantToolCallId = continuationAssistant?.tool_calls?.[0]?.id;
    expect(assistantToolCallId).toBe('call_provider_999');
    expect(continuationTool?.tool_call_id).toBe(assistantToolCallId);
  });
  it('should include tool message name in continuation payload for mistral format', async () => {
    const firstResponseChunks = [
      JSON.stringify({
        id: 'chatcmpl-mistral-1',
        object: 'chat.completion.chunk',
        created: 1234569000,
        model: 'mistral-large-latest',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_mistral_1',
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
        id: 'chatcmpl-mistral-1',
        object: 'chat.completion.chunk',
        created: 1234569000,
        model: 'mistral-large-latest',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      }),
    ];

    const secondResponseChunks = [
      JSON.stringify({
        id: 'chatcmpl-mistral-2',
        object: 'chat.completion.chunk',
        created: 1234569001,
        model: 'mistral-large-latest',
        choices: [
          {
            index: 0,
            delta: { content: 'Done.' },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        id: 'chatcmpl-mistral-2',
        object: 'chat.completion.chunk',
        created: 1234569001,
        model: 'mistral-large-latest',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      }),
    ];

    let callCount = 0;
    vi.mocked(global.fetch).mockImplementation(async () => {
      callCount++;
      return createStreamingResponse(
        callCount === 1 ? firstResponseChunks : secondResponseChunks,
      );
    });

    settingsService.set('model', 'mistral-large-latest');
    settingsService.setProviderSetting(
      provider.name,
      'model',
      'mistral-large-latest',
    );

    const messages: IMessage[] = [
      {
        role: ContentGeneratorRole.USER,
        content: 'find ts files',
      },
    ];

    const tools: ITool[] = [
      {
        functionDeclarations: [
          {
            name: 'FindFiles',
            description: 'Find files',
            parameters: {
              type: 'object',
              properties: {
                pattern: {
                  type: 'string',
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

    for await (const _content of generator) {
      // Drain stream
    }

    expect(callCount).toBe(2);

    const secondFetchCall = vi.mocked(global.fetch).mock.calls[1];
    const secondRequestBody = JSON.parse(
      secondFetchCall?.[1]?.body as string,
    ) as {
      messages: Array<{
        role: string;
        name?: string;
        content?: string;
        tool_call_id?: string;
      }>;
    };

    const toolMessage = secondRequestBody.messages.find(
      (msg) => msg.role === 'tool',
    );

    expect(toolMessage).toBeDefined();
    expect(toolMessage).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_mistral_1',
      name: 'FindFiles',
      content: '[Tool call acknowledged - awaiting execution]',
    });
  });

  it('should keep private method test coupling explicit for buildMessagesWithReasoning', () => {
    // This test intentionally exercises a private helper through type assertion.
    // If the method signature changes, this test should fail loudly so we can
    // update strict gateway payload assertions in lockstep.
    const privateAccessor = provider as unknown as {
      buildMessagesWithReasoning: OpenAIProvider['buildMessagesWithReasoning'];
    };

    expect(typeof privateAccessor.buildMessagesWithReasoning).toBe('function');
  });

  it('should not attach reasoning_content to assistant tool_call messages for strict OpenAI gateways', () => {
    settingsService.set('reasoning.includeInContext', true);

    const contentHistory: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: 'Read test.txt and tell me what is inside.',
          },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'I should call read_file before answering.',
            sourceField: 'reasoning_content',
          },
          {
            type: 'tool_call',
            id: 'call_abc123',
            name: 'read_file',
            parameters: {
              absolute_path: '/tmp/test.txt',
            },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_abc123',
            toolName: 'read_file',
            result: 'hello world',
          },
        ],
      },
    ];

    const options = {
      settings: settingsService,
      config: undefined,
      invocation: {
        modelParams: {},
      },
      metadata: {},
      resolved: {
        model: 'MiniMaxAI/MiniMax-M2.1-TEE',
        authToken: 'test-key',
      },
    } as Parameters<OpenAIProvider['buildMessagesWithReasoning']>[1];

    const buildMessagesWithReasoning = (
      provider as unknown as {
        buildMessagesWithReasoning: OpenAIProvider['buildMessagesWithReasoning'];
      }
    ).buildMessagesWithReasoning;

    const messages = buildMessagesWithReasoning.call(
      provider,
      contentHistory,
      options,
      'openai',
    );

    const assistantToolCallMessage = messages.find(
      (msg) =>
        msg.role === 'assistant' &&
        'tool_calls' in msg &&
        Array.isArray(msg.tool_calls) &&
        msg.tool_calls.length > 0,
    ) as
      | {
          role: string;
          tool_calls?: Array<{ id?: string }>;
          reasoning_content?: unknown;
        }
      | undefined;

    expect(assistantToolCallMessage).toBeDefined();
    expect(assistantToolCallMessage?.tool_calls?.[0]?.id).toBe('call_abc123');
    // Strict OpenAI-compatible endpoints (e.g. Chutes/MiniMax) can reject
    // assistant+tool_calls messages that carry extra fields.
    expect(assistantToolCallMessage).not.toHaveProperty('reasoning_content');
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
