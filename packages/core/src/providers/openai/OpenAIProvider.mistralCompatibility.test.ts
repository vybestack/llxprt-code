/**
 * Tests for Mistral API compatibility
 *
 * Mistral's OpenAI-compatible API has strict requirements:
 * 1. Assistant messages with tool_calls MUST NOT have a content key (not even null)
 * 2. Tool messages MUST include a name field matching the function name
 *
 * @see https://docs.mistral.ai/capabilities/function_calling
 * @issue #760
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '../../services/history/IContent.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type OpenAI from 'openai';

describe('OpenAIProvider Mistral API Compatibility @issue:760', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider('test-api-key', 'https://api.mistral.ai/v1');
  });

  /**
   * Helper to create mock options with settings
   */
  const createMockOptions = (
    settingsMap: Record<string, unknown> = {},
  ): NormalizedGenerateChatOptions =>
    ({
      settings: {
        get: (key: string) => settingsMap[key],
      },
      invocation: {
        requestId: 'test-request',
        timestamp: Date.now(),
      },
      resolved: {
        model: 'mistral-large-latest',
        authToken: { token: 'test-token', type: 'api-key' },
      },
      metadata: {},
      config: undefined,
    }) as unknown as NormalizedGenerateChatOptions;

  describe('Assistant messages with tool_calls must not have content property', () => {
    it('should omit content property when tool_calls are present (empty text)', () => {
      const contents: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_123',
              name: 'test_tool',
              parameters: { foo: 'bar' },
            } as ToolCallBlock,
          ],
        },
      ];

      const options = createMockOptions({
        'reasoning.includeInContext': false,
        'reasoning.stripFromContext': 'none',
      });

      const messages = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(messages).toHaveLength(1);
      const assistantMsg =
        messages[0] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.tool_calls).toHaveLength(1);

      // CRITICAL: content property must not exist at all
      expect('content' in assistantMsg).toBe(false);
    });

    it('should omit content property when tool_calls are present (with text)', () => {
      const contents: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'text',
              text: 'Let me call a tool',
            },
            {
              type: 'tool_call',
              id: 'call_456',
              name: 'another_tool',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
      ];

      const options = createMockOptions({
        'reasoning.includeInContext': false,
        'reasoning.stripFromContext': 'none',
      });

      const messages = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(messages).toHaveLength(1);
      const assistantMsg =
        messages[0] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.tool_calls).toHaveLength(1);

      // CRITICAL: content property must not exist at all, even with text
      expect('content' in assistantMsg).toBe(false);
    });

    it('should omit content property when tool_calls are present (null content)', () => {
      const contents: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_789',
              name: 'third_tool',
              parameters: { param: 'value' },
            } as ToolCallBlock,
          ],
        },
      ];

      const options = createMockOptions({
        'reasoning.includeInContext': false,
        'reasoning.stripFromContext': 'none',
      });

      const messages = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      const assistantMsg =
        messages[0] as OpenAI.Chat.ChatCompletionAssistantMessageParam;

      // Verify content is not set to null either
      expect(assistantMsg.content).toBeUndefined();
      expect('content' in assistantMsg).toBe(false);
    });

    it('should include content property when no tool_calls are present', () => {
      const contents: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'text',
              text: 'Just a regular response',
            },
          ],
        },
      ];

      const options = createMockOptions({
        'reasoning.includeInContext': false,
        'reasoning.stripFromContext': 'none',
      });

      const messages = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options);

      expect(messages).toHaveLength(1);
      const assistantMsg =
        messages[0] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.content).toBe('Just a regular response');
      expect('tool_calls' in assistantMsg).toBe(false);
    });
  });

  describe('Tool response messages must include name field', () => {
    it('should include name field in tool response messages', () => {
      const contents: IContent[] = [
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_123',
              toolName: 'test_tool',
              result: { output: 'success' },
            } as ToolResponseBlock,
          ],
        },
      ];

      const options = createMockOptions({
        'reasoning.includeInContext': false,
        'reasoning.stripFromContext': 'none',
      });

      const messages = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
            toolFormat?: 'openai' | 'qwen' | 'kimi' | 'mistral',
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options, 'mistral');

      expect(messages).toHaveLength(1);
      const toolMsg = messages[0] as OpenAI.Chat.ChatCompletionToolMessageParam;
      expect(toolMsg.role).toBe('tool');
      expect(toolMsg.tool_call_id).toMatch(/^[A-Za-z0-9]{9}$/);

      // CRITICAL: name field must be present
      expect(toolMsg.name).toBe('test_tool');
    });

    it('should include name field for multiple tool responses', () => {
      const contents: IContent[] = [
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_456',
              toolName: 'read_file',
              result: 'file contents',
            } as ToolResponseBlock,
            {
              type: 'tool_response',
              callId: 'call_789',
              toolName: 'write_file',
              result: { status: 'written' },
            } as ToolResponseBlock,
          ],
        },
      ];

      const options = createMockOptions({
        'reasoning.includeInContext': false,
        'reasoning.stripFromContext': 'none',
      });

      const messages = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
            toolFormat?: 'openai' | 'qwen' | 'kimi' | 'mistral',
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options, 'mistral');

      expect(messages).toHaveLength(2);

      const toolMsg1 =
        messages[0] as OpenAI.Chat.ChatCompletionToolMessageParam;
      expect(toolMsg1.role).toBe('tool');
      expect(toolMsg1.tool_call_id).toMatch(/^[A-Za-z0-9]{9}$/);
      expect(toolMsg1.name).toBe('read_file');

      const toolMsg2 =
        messages[1] as OpenAI.Chat.ChatCompletionToolMessageParam;
      expect(toolMsg2.role).toBe('tool');
      expect(toolMsg2.tool_call_id).toMatch(/^[A-Za-z0-9]{9}$/);
      expect(toolMsg2.name).toBe('write_file');
    });

    it('should omit name field for standard openai-format tool responses', () => {
      const openaiProvider = new OpenAIProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );

      const contents: IContent[] = [
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_123',
              toolName: 'read_file',
              result: 'file contents',
            } as ToolResponseBlock,
          ],
        },
      ];

      const options = createMockOptions({
        'reasoning.includeInContext': false,
        'reasoning.stripFromContext': 'none',
      });

      const messages = (
        openaiProvider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
            toolFormat?: 'openai' | 'qwen' | 'kimi' | 'mistral',
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options, 'openai');

      expect(messages).toHaveLength(1);
      const toolMsg = messages[0] as Record<string, unknown>;
      expect(toolMsg.role).toBe('tool');
      expect(toolMsg.tool_call_id).toBe('call_123');
      expect(toolMsg).not.toHaveProperty('name');
    });

    it('should preserve contiguous tool responses after an assistant tool_call', () => {
      const messages = [
        {
          role: 'user',
          content: 'Read test file',
        },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_glob_1',
              type: 'function',
              function: {
                name: 'glob',
                arguments: JSON.stringify({ pattern: '**/*' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_glob_1',
          name: 'glob',
          content: 'Result for glob: ["/tmp/test.txt"]',
        },
        {
          role: 'tool',
          tool_call_id: 'call_glob_1',
          name: 'glob',
          content: '/tmp/test.txt',
        },
      ] as OpenAI.Chat.ChatCompletionMessageParam[];

      const validated = (
        provider as unknown as {
          validateToolMessageSequence: (
            messages: OpenAI.Chat.ChatCompletionMessageParam[],
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).validateToolMessageSequence(messages);

      // Regression guard: both tool responses must remain in sequence.
      // A tool response should not clear the active assistant tool_call context.
      expect(validated).toHaveLength(4);

      const assistantMsg =
        validated[1] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.tool_calls).toHaveLength(1);
      expect(assistantMsg.tool_calls?.[0]?.id).toBe('call_glob_1');

      const toolMsg1 =
        validated[2] as OpenAI.Chat.ChatCompletionToolMessageParam;
      const toolMsg2 =
        validated[3] as OpenAI.Chat.ChatCompletionToolMessageParam;
      expect(toolMsg1.role).toBe('tool');
      expect(toolMsg2.role).toBe('tool');
      expect(toolMsg1.tool_call_id).toBe('call_glob_1');
      expect(toolMsg2.tool_call_id).toBe('call_glob_1');
      expect(toolMsg1.name).toBe('glob');
      expect(toolMsg2.name).toBe('glob');
    });
  });

  describe('Full conversation flow with tool calls', () => {
    it('should properly format a complete tool call conversation for Mistral', () => {
      const contents: IContent[] = [
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: 'List the files in the docs directory',
            },
          ],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_ls_123',
              name: 'bash',
              parameters: { command: 'ls docs/' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_ls_123',
              toolName: 'bash',
              result: 'README.md\nAPI.md\n',
            } as ToolResponseBlock,
          ],
        },
      ];

      const options = createMockOptions({
        'reasoning.includeInContext': false,
        'reasoning.stripFromContext': 'none',
      });

      const messages = (
        provider as unknown as {
          buildMessagesWithReasoning: (
            contents: IContent[],
            options: NormalizedGenerateChatOptions,
            toolFormat?: 'openai' | 'qwen' | 'kimi' | 'mistral',
          ) => OpenAI.Chat.ChatCompletionMessageParam[];
        }
      ).buildMessagesWithReasoning(contents, options, 'mistral');

      expect(messages).toHaveLength(3);

      // User message
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('List the files in the docs directory');

      // Assistant message with tool call
      const assistantMsg =
        messages[1] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.tool_calls).toHaveLength(1);
      expect(assistantMsg.tool_calls?.[0]?.function.name).toBe('bash');
      // MUST NOT have content property
      expect('content' in assistantMsg).toBe(false);

      // Tool response
      const toolMsg = messages[2] as OpenAI.Chat.ChatCompletionToolMessageParam;
      expect(toolMsg.role).toBe('tool');
      expect(toolMsg.tool_call_id).toMatch(/^[A-Za-z0-9]{9}$/);
      // MUST have name field
      expect(toolMsg.name).toBe('bash');
    });
  });
});
