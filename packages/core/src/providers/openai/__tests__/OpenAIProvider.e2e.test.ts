/**
 * End-to-end tests for OpenAI provider reasoning/thinking support.
 *
 * @plan PLAN-20251202-THINKING.P16
 * @requirement REQ-THINK-003, REQ-THINK-004, REQ-THINK-005, EC-006
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIProvider } from '../OpenAIProvider';
import type {
  IContent,
  ThinkingBlock,
  TextBlock,
  ToolCallBlock,
} from '../../../services/history/IContent';
import { initializeTestProviderRuntime } from '../../../test-utils/runtime';
import { resetSettingsService } from '../../../settings/settingsServiceInstance';
import type { SettingsService } from '../../../settings/SettingsService';
import type OpenAI from 'openai';

// Mock OpenAI client at the instance level
const mockChatCompletionsCreate = vi.fn();

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockChatCompletionsCreate,
      },
    };
  },
}));

describe('OpenAIProvider E2E Tests @plan:PLAN-20251202-THINKING.P16', () => {
  let provider: OpenAIProvider;
  let settingsService: SettingsService;
  let runtimeConfig: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChatCompletionsCreate.mockClear();
    resetSettingsService();

    const runtime = initializeTestProviderRuntime({
      runtimeId: `openai-e2e-${Math.random().toString(36).slice(2, 10)}`,
      metadata: { suite: 'OpenAIProvider.e2e.test' },
      configOverrides: {
        getProvider: () => 'openai',
        getModel: () => 'gpt-4o',
        getEphemeralSettings: () => ({ model: 'gpt-4o' }),
      },
    });

    settingsService = runtime.settingsService;
    runtimeConfig = runtime.config;
    provider = new OpenAIProvider('test-api-key', 'https://api.openai.com/v1');
    provider.setRuntimeSettingsService?.(settingsService);
    provider.setConfig?.(runtime.config);

    settingsService.set('activeProvider', provider.name);
    settingsService.set('model', 'gpt-4o');
    settingsService.setProviderSetting(provider.name, 'model', 'gpt-4o');
  });

  /**
   * Scenario 1: Streaming with reasoning_content
   * @requirement REQ-THINK-003.1
   */
  describe('Scenario 1: Streaming with reasoning_content', () => {
    it('e2e: yields ThinkingBlock before TextBlock when streaming', async () => {
      // Create mock streaming response
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                delta: { reasoning_content: 'Thinking step 1...' },
                finish_reason: null,
              },
            ],
          } as OpenAI.Chat.Completions.ChatCompletionChunk;

          yield {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                delta: { reasoning_content: ' Step 2...' },
                finish_reason: null,
              },
            ],
          } as OpenAI.Chat.Completions.ChatCompletionChunk;

          yield {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                delta: { content: 'Here is ' },
                finish_reason: null,
              },
            ],
          } as OpenAI.Chat.Completions.ChatCompletionChunk;

          yield {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                delta: { content: 'my answer.' },
                finish_reason: 'stop',
              },
            ],
          } as OpenAI.Chat.Completions.ChatCompletionChunk;
        },
      };

      mockChatCompletionsCreate.mockReturnValue(mockStream);

      const messages: IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Test question' }] },
      ];

      const results: IContent[] = [];
      for await (const content of provider.generateChatCompletion(messages)) {
        results.push(content);
      }

      // Verify we got results
      expect(results.length).toBeGreaterThan(0);

      // Find thinking and text blocks
      const allBlocks = results.flatMap((r) => r.blocks);
      const thinkingBlocks = allBlocks.filter(
        (b) => b.type === 'thinking',
      ) as ThinkingBlock[];
      const textBlocks = allBlocks.filter(
        (b) => b.type === 'text',
      ) as TextBlock[];

      // Should have thinking blocks
      expect(thinkingBlocks.length).toBeGreaterThan(0);
      const fullThought = thinkingBlocks.map((tb) => tb.thought).join('');
      expect(fullThought).toContain('Thinking step 1...');
      expect(fullThought).toContain(' Step 2...');

      // Should have text blocks
      expect(textBlocks.length).toBeGreaterThan(0);
      const fullText = textBlocks.map((tb) => tb.text).join('');
      expect(fullText).toContain('Here is ');
      expect(fullText).toContain('my answer.');

      // Verify sourceField
      thinkingBlocks.forEach((tb) => {
        expect(tb.sourceField).toBe('reasoning_content');
      });
    });
  });

  /**
   * Scenario 2: Non-streaming with reasoning_content
   * @requirement REQ-THINK-003.2, REQ-THINK-003.3
   */
  describe('Scenario 2: Non-streaming with reasoning_content', () => {
    it('e2e: includes ThinkingBlock in non-streaming response', async () => {
      const mockResponse: OpenAI.Chat.Completions.ChatCompletion = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'My answer',
              reasoning_content: 'I thought about this carefully...',
            } as unknown as OpenAI.Chat.Completions.ChatCompletionMessage,
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockChatCompletionsCreate.mockResolvedValue(mockResponse);

      // Set streaming to disabled
      settingsService.set('streaming', 'disabled');

      const messages: IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Test question' }] },
      ];

      const results: IContent[] = [];
      for await (const content of provider.generateChatCompletion(messages)) {
        results.push(content);
      }

      expect(results.length).toBeGreaterThan(0);

      // Find thinking and text blocks
      const allBlocks = results.flatMap((r) => r.blocks);
      const thinking = allBlocks.find((b) => b.type === 'thinking') as
        | ThinkingBlock
        | undefined;
      const text = allBlocks.find((b) => b.type === 'text') as
        | TextBlock
        | undefined;

      expect(thinking).toBeDefined();
      expect(thinking!.thought).toBe('I thought about this carefully...');
      expect(thinking!.sourceField).toBe('reasoning_content');

      expect(text).toBeDefined();
      expect(text!.text).toContain('My answer');
    });
  });

  /**
   * Scenario 3: Round-trip with includeInContext=true
   * @requirement REQ-THINK-004.1, REQ-THINK-004.3
   */
  describe('Scenario 3: Round-trip with includeInContext=true', () => {
    it('e2e: includes reasoning_content in subsequent request when setting enabled', async () => {
      const history: IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Processing...',
              sourceField: 'reasoning_content',
            } as ThinkingBlock,
            { type: 'text', text: 'Hi there!' } as TextBlock,
          ],
        },
      ];

      settingsService.set('reasoning.includeInContext', true);
      settingsService.set('reasoning.stripFromContext', 'none');

      // Build messages using the private method
      const buildMessagesWithReasoning = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: { settings: SettingsService; config: unknown },
          ) => unknown[];
        }
      ).buildMessagesWithReasoning;

      const messages = buildMessagesWithReasoning.call(provider, history, {
        settings: settingsService,
        config: runtimeConfig,
      });

      const assistantMsg = messages.find(
        (m: { role: string }) => m.role === 'assistant',
      ) as
        | {
            reasoning_content?: string;
          }
        | undefined;

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.reasoning_content).toBe('Processing...');
    });
  });

  /**
   * Scenario 3b: Full Round-Trip Verification
   * @requirement REQ-THINK-004.1, REQ-THINK-004.3
   */
  describe('Scenario 3b: Full Round-Trip Verification', () => {
    it('e2e: verifies thinking blocks survive complete round-trip cycle', async () => {
      // STEP 1: Simulate API response with reasoning_content
      const mockApiResponse: OpenAI.Chat.Completions.ChatCompletion = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Final answer',
              reasoning_content: 'Let me think about this carefully...',
            } as unknown as OpenAI.Chat.Completions.ChatCompletionMessage,
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      mockChatCompletionsCreate.mockResolvedValue(mockApiResponse);
      settingsService.set('streaming', 'disabled');

      // STEP 2: Generate response and capture IContent
      const generatedResults: IContent[] = [];
      for await (const content of provider.generateChatCompletion([
        { speaker: 'human', blocks: [{ type: 'text', text: 'Test question' }] },
      ])) {
        generatedResults.push(content);
      }

      // STEP 3: Verify ThinkingBlock was created from parsing
      const allBlocks = generatedResults.flatMap((r) => r.blocks);
      const thinkingBlock = allBlocks.find((b) => b.type === 'thinking') as
        | ThinkingBlock
        | undefined;
      expect(thinkingBlock).toBeDefined();
      expect(thinkingBlock!.thought).toBe(
        'Let me think about this carefully...',
      );
      expect(thinkingBlock!.sourceField).toBe('reasoning_content');

      const textBlock = allBlocks.find((b) => b.type === 'text') as
        | TextBlock
        | undefined;
      expect(textBlock).toBeDefined();
      expect(textBlock!.text).toContain('Final answer');

      // STEP 4: Store in history (simulated) - combine all generated content
      const combinedContent: IContent = {
        speaker: 'ai',
        blocks: allBlocks,
      };
      const history: IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Test question' }] },
        combinedContent,
      ];

      // STEP 5: Build next request with includeInContext=true
      settingsService.set('reasoning.includeInContext', true);
      settingsService.set('reasoning.stripFromContext', 'none');

      const buildMessagesWithReasoning = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: { settings: SettingsService; config: unknown },
          ) => unknown[];
        }
      ).buildMessagesWithReasoning;

      const messages = buildMessagesWithReasoning.call(provider, history, {
        settings: settingsService,
        config: runtimeConfig,
      });

      // STEP 6: Verify reasoning_content appears in built message
      const assistantMsg = messages.find(
        (m: { role: string }) => m.role === 'assistant',
      ) as
        | {
            content?: string;
            reasoning_content?: string;
          }
        | undefined;

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.content).toContain('Final answer');
      expect(assistantMsg!.reasoning_content).toBe(
        'Let me think about this carefully...',
      );

      // STEP 7: Verify round-trip integrity
      expect(assistantMsg!.reasoning_content).toBe(
        (mockApiResponse.choices[0].message as { reasoning_content?: string })
          .reasoning_content,
      );
    });

    it('e2e: verifies round-trip with multiple thinking blocks', async () => {
      const history: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Complex question' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'First thought...',
              sourceField: 'reasoning_content',
            } as ThinkingBlock,
            {
              type: 'thinking',
              thought: 'Second thought...',
              sourceField: 'reasoning_content',
            } as ThinkingBlock,
            { type: 'text', text: 'Answer based on thoughts' } as TextBlock,
          ],
        },
      ];

      settingsService.set('reasoning.includeInContext', true);
      settingsService.set('reasoning.stripFromContext', 'none');

      const buildMessagesWithReasoning = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: { settings: SettingsService; config: unknown },
          ) => unknown[];
        }
      ).buildMessagesWithReasoning;

      const messages = buildMessagesWithReasoning.call(provider, history, {
        settings: settingsService,
        config: runtimeConfig,
      });

      const assistantMsg = messages.find(
        (m: { role: string }) => m.role === 'assistant',
      ) as
        | {
            reasoning_content?: string;
          }
        | undefined;

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.reasoning_content).toBe(
        'First thought...\nSecond thought...',
      );
    });
  });

  /**
   * Scenario 4: Round-trip with includeInContext=false
   * @requirement REQ-THINK-004.4
   */
  describe('Scenario 4: Round-trip with includeInContext=false', () => {
    it('e2e: excludes reasoning_content when setting disabled', async () => {
      const history: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Processing...',
              sourceField: 'reasoning_content',
            } as ThinkingBlock,
            { type: 'text', text: 'Answer' } as TextBlock,
          ],
        },
      ];

      settingsService.set('reasoning.includeInContext', false);

      const buildMessagesWithReasoning = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: { settings: SettingsService; config: unknown },
          ) => unknown[];
        }
      ).buildMessagesWithReasoning;

      const messages = buildMessagesWithReasoning.call(provider, history, {
        settings: settingsService,
        config: runtimeConfig,
      });

      const assistantMsg = messages.find(
        (m: { role: string }) => m.role === 'assistant',
      ) as
        | {
            reasoning_content?: string;
          }
        | undefined;

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.reasoning_content).toBeUndefined();
    });
  });

  /**
   * Scenario 5: Model without reasoning_content
   * @requirement REQ-THINK-003.4
   */
  describe('Scenario 5: Model without reasoning_content', () => {
    it('e2e: gracefully handles non-reasoning model', async () => {
      const mockResponse: OpenAI.Chat.Completions.ChatCompletion = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Normal response',
              // No reasoning_content field
            } as OpenAI.Chat.Completions.ChatCompletionMessage,
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      mockChatCompletionsCreate.mockResolvedValue(mockResponse);
      settingsService.set('streaming', 'disabled');

      const messages: IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Test question' }] },
      ];

      const results: IContent[] = [];
      for await (const content of provider.generateChatCompletion(messages)) {
        results.push(content);
      }

      const allBlocks = results.flatMap((r) => r.blocks);
      const thinking = allBlocks.find((b) => b.type === 'thinking');
      expect(thinking).toBeUndefined();

      const text = allBlocks.find((b) => b.type === 'text') as
        | TextBlock
        | undefined;
      expect(text).toBeDefined();
      expect(text!.text).toContain('Normal response');
    });
  });

  /**
   * Scenario 7a: Tool Call + Reasoning Round-Trip
   * @requirement EC-006
   */
  describe('Scenario 7a: Tool call with reasoning preserved', () => {
    it('e2e: preserves reasoning across tool call boundary when includeInContext=true', async () => {
      const history: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'List files in /tmp' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'User wants to see files in /tmp...',
              sourceField: 'reasoning_content',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'call_1',
              name: 'list_files',
              parameters: { path: '/tmp' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_1',
              toolName: 'list_files',
              result: 'file1.txt\nfile2.txt',
            },
          ],
        },
      ];

      settingsService.set('reasoning.includeInContext', true);
      settingsService.set('reasoning.stripFromContext', 'none');

      const buildMessagesWithReasoning = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: { settings: SettingsService; config: unknown },
          ) => unknown[];
        }
      ).buildMessagesWithReasoning;

      const messages = buildMessagesWithReasoning.call(provider, history, {
        settings: settingsService,
        config: runtimeConfig,
      });

      const assistantMsg = messages.find(
        (m: { role: string; tool_calls?: unknown[] }) =>
          m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0,
      ) as { reasoning_content?: string } | undefined;

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.reasoning_content).toBe(
        'User wants to see files in /tmp...',
      );
    });
  });

  /**
   * Scenario 7b: Tool call without reasoning
   * @requirement EC-006
   */
  describe('Scenario 7b: Tool call without reasoning', () => {
    it('e2e: excludes reasoning but preserves tool calls when includeInContext=false', async () => {
      const history: IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'List files' }] },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Thinking about this...',
              sourceField: 'reasoning_content',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'call_2',
              name: 'list_files',
              parameters: { path: '.' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_2',
              toolName: 'list_files',
              result: 'output',
            },
          ],
        },
      ];

      settingsService.set('reasoning.includeInContext', false);

      const buildMessagesWithReasoning = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: { settings: SettingsService; config: unknown },
          ) => unknown[];
        }
      ).buildMessagesWithReasoning;

      const messages = buildMessagesWithReasoning.call(provider, history, {
        settings: settingsService,
        config: runtimeConfig,
      });

      const assistantMsg = messages.find(
        (m: { role: string }) => m.role === 'assistant',
      ) as
        | {
            tool_calls?: unknown[];
            reasoning_content?: string;
          }
        | undefined;

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.tool_calls).toBeDefined();
      expect(assistantMsg!.reasoning_content).toBeUndefined();
    });
  });

  /**
   * Scenario 7c: Multi-turn with reasoning after tool response
   * @requirement EC-006
   */
  describe('Scenario 7c: Multi-turn with allButLast strip policy', () => {
    it('e2e: handles multi-turn with reasoning after tool response', async () => {
      const history: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What time is it?' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Need to check time...',
              sourceField: 'reasoning_content',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'call_time',
              name: 'get_time',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_time',
              toolName: 'get_time',
              result: '3:45 PM',
            },
          ],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Got the time, formulating response...',
              sourceField: 'reasoning_content',
            } as ThinkingBlock,
            { type: 'text', text: 'It is currently 3:45 PM.' } as TextBlock,
          ],
        },
      ];

      settingsService.set('reasoning.includeInContext', true);
      settingsService.set('reasoning.stripFromContext', 'allButLast');

      const buildMessagesWithReasoning = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: { settings: SettingsService; config: unknown },
          ) => unknown[];
        }
      ).buildMessagesWithReasoning;

      const messages = buildMessagesWithReasoning.call(provider, history, {
        settings: settingsService,
        config: runtimeConfig,
      });

      const assistantMsgs = messages.filter(
        (m: { role: string }) => m.role === 'assistant',
      ) as Array<{
        tool_calls?: unknown[];
        reasoning_content?: string;
      }>;

      expect(assistantMsgs.length).toBe(2);

      // First AI message: NO reasoning (stripped by allButLast)
      expect(assistantMsgs[0].reasoning_content).toBeUndefined();
      expect(assistantMsgs[0].tool_calls).toBeDefined();

      // Second AI message: HAS reasoning (it's the last one)
      expect(assistantMsgs[1].reasoning_content).toBe(
        'Got the time, formulating response...',
      );
    });
  });
});
