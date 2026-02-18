/**
 * Tests for DeepSeek-reasoner reasoning_content + tool_calls co-emission fix.
 *
 * DeepSeek-reasoner returns reasoning_content in streaming deltas alongside
 * tool_calls. The API requires that on the *next* turn the assistant message
 * includes both the reasoning_content AND the tool_calls in one message.
 * When they are yielded as separate IContent entries the history stores them
 * in separate messages, so buildMessagesWithReasoning cannot attach
 * reasoning_content to the tool_calls message → "Missing reasoning_content
 * field in the assistant message" error on the second request.
 *
 * @issue #1142
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import { resetSettingsService } from '../../settings/settingsServiceInstance.js';
import { initializeTestProviderRuntime } from '../../test-utils/runtime.js';
import type { SettingsService } from '../../settings/SettingsService.js';
import type {
  IContent,
  ThinkingBlock,
  ToolCallBlock,
} from '../../services/history/IContent.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('OpenAIProvider DeepSeek-reasoner reasoning+tool_calls co-emission (issue #1142)', () => {
  let provider: OpenAIProvider;
  let settingsService: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSettingsService();
    const runtime = initializeTestProviderRuntime({
      runtimeId: `openai-provider.deepseekReasoning.${Math.random()
        .toString(36)
        .slice(2, 10)}`,
      metadata: {
        suite: 'OpenAIProvider.deepseekReasoning.test',
      },
      configOverrides: {
        getProvider: () => 'openai',
        getModel: () => 'deepseek-reasoner',
        getEphemeralSettings: () => ({ model: 'deepseek-reasoner' }),
      },
    });
    settingsService = runtime.settingsService;
    provider = new OpenAIProvider('test-key', 'https://api.deepseek.com/v1');
    provider.setRuntimeSettingsService?.(settingsService);
    provider.setConfig?.(runtime.config);
    settingsService.set('model', 'deepseek-reasoner');
    settingsService.setProviderSetting(
      provider.name,
      'model',
      'deepseek-reasoner',
    );
    settingsService.set('reasoning.includeInContext', true);
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

  /**
   * Core regression test: when a streaming response contains reasoning_content
   * AND tool_calls, they must appear in the SAME IContent block so that
   * buildMessagesWithReasoning can attach reasoning_content to the assistant
   * message that has tool_calls.
   */
  it('yields reasoning_content ThinkingBlock and tool_calls in the same IContent (legacy path)', async () => {
    // Simulate DeepSeek-reasoner streaming: first reasoning_content chunks,
    // then a tool_call chunk, then finish.
    const chunks = [
      // Reasoning chunk 1
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              reasoning_content: 'I need to search for the answer.',
              content: null,
            },
            finish_reason: null,
          },
        ],
      }),
      // Reasoning chunk 2
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: {
              reasoning_content: ' Let me call the search tool.',
              content: null,
            },
            finish_reason: null,
          },
        ],
      }),
      // Tool call chunk
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'search',
                    arguments: '{"query":"deepseek reasoning"}',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      // Finish chunk with usage
      JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 30,
          total_tokens: 80,
        },
      }),
    ];

    vi.mocked(global.fetch).mockResolvedValue(createStreamingResponse(chunks));

    const generator = provider.generateChatCompletion(
      [
        {
          role: 'user' as const,
          content: 'Search for deepseek reasoning info',
        },
      ],
      [
        {
          functionDeclarations: [
            {
              name: 'search',
              description: 'Search the web',
              parameters: {
                type: 'object' as const,
                properties: {
                  query: { type: 'string' as const, description: 'Query' },
                },
                required: ['query'],
              },
            },
          ],
        },
      ],
      { stream: true },
    );

    const contents: IContent[] = [];
    for await (const content of generator) {
      contents.push(content);
    }

    // Find the IContent that has tool_calls
    const toolCallContent = contents.find((c) =>
      c.blocks.some((b) => b.type === 'tool_call'),
    );
    expect(toolCallContent).toBeDefined();

    // The ThinkingBlock MUST be in the same IContent as the tool_calls
    const thinkingInToolContent = toolCallContent?.blocks.filter(
      (b): b is ThinkingBlock => b.type === 'thinking',
    );
    expect(thinkingInToolContent).toBeDefined();
    expect(thinkingInToolContent!.length).toBeGreaterThan(0);

    // Verify the thinking block has correct content
    const thinking = thinkingInToolContent![0];
    expect(thinking.thought).toContain('I need to search');
    expect(thinking.sourceField).toBe('reasoning_content');

    // Verify tool call content
    const toolCalls = toolCallContent?.blocks.filter(
      (b): b is ToolCallBlock => b.type === 'tool_call',
    );
    expect(toolCalls!.length).toBe(1);
    expect(toolCalls![0].name).toBe('search');

    // Verify there is NO separate IContent that has only a ThinkingBlock
    // (the old behavior that caused the bug)
    const thinkingOnlyContent = contents.filter(
      (c) =>
        c.blocks.some((b) => b.type === 'thinking') &&
        !c.blocks.some((b) => b.type === 'tool_call'),
    );
    expect(thinkingOnlyContent).toHaveLength(0);
  });

  /**
   * Verify that when reasoning_content is present without tool calls,
   * it is still emitted (as a standalone ThinkingBlock in an IContent).
   * This ensures we don't break non-tool-call reasoning responses.
   */
  it('still yields reasoning_content ThinkingBlock when no tool calls are present', async () => {
    const chunks = [
      JSON.stringify({
        id: 'chatcmpl-2',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              reasoning_content: 'Let me think step by step.',
              content: null,
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        id: 'chatcmpl-2',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: {
              content: 'The answer is 42.',
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        id: 'chatcmpl-2',
        object: 'chat.completion.chunk',
        created: 1234567890,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 15,
          total_tokens: 35,
        },
      }),
    ];

    vi.mocked(global.fetch).mockResolvedValue(createStreamingResponse(chunks));

    const generator = provider.generateChatCompletion(
      [{ role: 'user' as const, content: 'What is the answer?' }],
      [],
      { stream: true },
    );

    const contents: IContent[] = [];
    for await (const content of generator) {
      contents.push(content);
    }

    // Should have at least one ThinkingBlock somewhere
    const allThinkingBlocks = contents.flatMap((c) =>
      c.blocks.filter((b): b is ThinkingBlock => b.type === 'thinking'),
    );
    expect(allThinkingBlocks.length).toBeGreaterThan(0);
    expect(allThinkingBlocks[0].sourceField).toBe('reasoning_content');
    expect(allThinkingBlocks[0].thought).toContain('Let me think');
  });

  /**
   * buildMessagesWithReasoning must find ThinkingBlocks in the same IContent
   * as ToolCallBlocks. This tests the core invariant required to avoid
   * "Missing reasoning_content field" errors.
   */
  it('ThinkingBlock and ToolCallBlock in the same IContent enables buildMessagesWithReasoning to attach reasoning_content', () => {
    // Construct the kind of IContent that the fixed streaming path produces:
    // ThinkingBlock and ToolCallBlock in the same block array.
    const combinedContent: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'I should call the tool.',
          sourceField: 'reasoning_content',
          isHidden: false,
        } as ThinkingBlock,
        {
          type: 'tool_call',
          id: 'call_xyz',
          name: 'my_tool',
          parameters: { arg: 'value' },
        } as ToolCallBlock,
      ],
    };

    // Call buildMessagesWithReasoning (private — accessed via type cast)
    const buildMessages = (
      provider as unknown as {
        buildMessagesWithReasoning: (
          contents: IContent[],
          options: {
            settings: { get: (k: string) => unknown };
            invocation: object;
            resolved: object;
            metadata: object;
            config: { getModel?: () => string };
          },
        ) => Array<Record<string, unknown>>;
      }
    ).buildMessagesWithReasoning;

    const messages = buildMessages.call(provider, [combinedContent], {
      settings: {
        get: (key: string) => {
          if (key === 'reasoning.includeInContext') return true;
          if (key === 'reasoning.stripFromContext') return 'none';
          return undefined;
        },
      },
      invocation: { requestId: 'test', timestamp: Date.now() },
      resolved: {
        model: 'deepseek-reasoner',
        authToken: { token: 'test', type: 'api-key' },
      },
      metadata: {},
      config: {},
    });

    // Must produce exactly one assistant message
    expect(messages).toHaveLength(1);
    const msg = messages[0] as Record<string, unknown>;

    // It must be a tool_calls message
    expect(msg.tool_calls).toBeDefined();
    expect(Array.isArray(msg.tool_calls)).toBe(true);

    // It must have reasoning_content because the ThinkingBlock is in the same IContent
    expect(msg.reasoning_content).toBeDefined();
    expect(msg.reasoning_content).toBe('I should call the tool.');
  });

  /**
   * Regression test: the OLD broken behavior yielded thinking and tool_calls
   * as SEPARATE IContents. buildMessagesWithReasoning would then produce two
   * assistant messages, and the tool_calls message would have no
   * reasoning_content. This test documents what would fail with the old code.
   */
  it('separate ThinkingBlock IContent and ToolCallBlock IContent leads to missing reasoning_content (documents old broken behavior)', () => {
    // Old broken emission: two separate IContent entries
    const thinkingContent: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'I should call the tool.',
          sourceField: 'reasoning_content',
          isHidden: false,
        } as ThinkingBlock,
      ],
    };
    const toolCallContent: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'call_xyz',
          name: 'my_tool',
          parameters: { arg: 'value' },
        } as ToolCallBlock,
      ],
    };

    const buildMessages = (
      provider as unknown as {
        buildMessagesWithReasoning: (
          contents: IContent[],
          options: {
            settings: { get: (k: string) => unknown };
            invocation: object;
            resolved: object;
            metadata: object;
            config: { getModel?: () => string };
          },
        ) => Array<Record<string, unknown>>;
      }
    ).buildMessagesWithReasoning;

    const messages = buildMessages.call(
      provider,
      [thinkingContent, toolCallContent],
      {
        settings: {
          get: (key: string) => {
            if (key === 'reasoning.includeInContext') return true;
            if (key === 'reasoning.stripFromContext') return 'none';
            return undefined;
          },
        },
        invocation: { requestId: 'test', timestamp: Date.now() },
        resolved: {
          model: 'deepseek-reasoner',
          authToken: { token: 'test', type: 'api-key' },
        },
        metadata: {},
        config: {},
      },
    );

    // With old code: two messages are produced
    expect(messages).toHaveLength(2);

    // The tool_calls message is the second one
    const toolCallMsg = messages.find(
      (m) => (m as Record<string, unknown>).tool_calls !== undefined,
    ) as Record<string, unknown> | undefined;
    expect(toolCallMsg).toBeDefined();

    // The tool_calls message has NO reasoning_content — this is what caused the bug
    expect(toolCallMsg!.reasoning_content).toBeUndefined();
  });
});
