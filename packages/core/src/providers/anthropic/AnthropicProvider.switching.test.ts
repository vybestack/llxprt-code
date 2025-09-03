import { describe, it, expect, beforeEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import type { IMessage } from '../IMessage.js';

describe('AnthropicProvider - Provider Switching', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider({
      apiKey: 'test-key',
      model: 'claude-3-sonnet',
    });
  });

  describe('Real-world provider switching scenarios', () => {
    it('should handle OpenAI/Qwen tool IDs when switching from OpenAI', () => {
      // This reproduces the exact error from the debug log
      const messages: IMessage[] = [
        {
          role: 'user',
          content: 'Help me analyze some files',
        },
        {
          role: 'assistant',
          content: "I'll help you analyze files.",
          tool_calls: [
            {
              // OpenAI/Qwen generates short IDs without prefixes
              id: '692a5fddc',
              type: 'function',
              function: {
                name: 'glob',
                arguments: '{"pattern": "**/*.ts"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          // The tool response references the OpenAI ID
          tool_call_id: '692a5fddc',
          name: 'glob',
          content: 'glob output exceeded token limit...',
        },
      ];

      // The provider should handle this without throwing 400 error
      // It needs to either:
      // 1. Map these IDs to Anthropic format (toolu_xxx)
      // 2. Or use a normalization layer
      const anthropicMessages = provider['convertMessages'](messages);

      // Find the tool_use block
      const assistantMsg = anthropicMessages.find(
        (m) => m.role === 'assistant',
      );
      const toolUseBlock = assistantMsg?.content?.find(
        (c: {
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: string;
          text?: string;
        }) => c.type === 'tool_use',
      );

      // Find the tool_result block
      const userMsg = anthropicMessages.find((m) => m.role === 'user');
      const toolResultBlock = userMsg?.content?.find(
        (c: {
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: string;
          text?: string;
        }) => c.type === 'tool_result',
      );

      // The IDs should match (both should be converted to same format)
      expect(toolUseBlock?.id).toBeDefined();
      expect(toolResultBlock?.tool_use_id).toBeDefined();
      expect(toolResultBlock?.tool_use_id).toBe(toolUseBlock?.id);
    });

    it('should handle multiple tool calls with various ID formats', () => {
      const messages: IMessage[] = [
        {
          role: 'assistant',
          tool_calls: [
            {
              id: '123abc',
              type: 'function',
              function: { name: 'tool1', arguments: '{}' },
            },
            {
              id: 'def456',
              type: 'function',
              function: { name: 'tool2', arguments: '{}' },
            },
            {
              id: '789xyz',
              type: 'function',
              function: { name: 'tool3', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: '123abc',
          name: 'tool1',
          content: 'result1',
        },
        {
          role: 'tool',
          tool_call_id: 'def456',
          name: 'tool2',
          content: 'result2',
        },
        {
          role: 'tool',
          tool_call_id: '789xyz',
          name: 'tool3',
          content: 'result3',
        },
      ];

      const anthropicMessages = provider['convertMessages'](messages);

      // Extract all tool_use IDs
      const toolUseIds = new Set<string>();
      const assistantMsg = anthropicMessages.find(
        (m) => m.role === 'assistant',
      );
      assistantMsg?.content?.forEach(
        (c: {
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: string;
          text?: string;
        }) => {
          if (c.type === 'tool_use') {
            toolUseIds.add(c.id);
          }
        },
      );

      // Extract all tool_result IDs
      const toolResultIds = new Set<string>();
      anthropicMessages
        .filter((m) => m.role === 'user')
        .forEach((msg) => {
          msg.content?.forEach(
            (c: {
              type: string;
              id?: string;
              name?: string;
              input?: unknown;
              tool_use_id?: string;
              content?: string;
              text?: string;
            }) => {
              if (c.type === 'tool_result') {
                toolResultIds.add(c.tool_use_id);
              }
            },
          );
        });

      // All tool_result IDs should have matching tool_use IDs
      toolResultIds.forEach((resultId) => {
        expect(toolUseIds.has(resultId)).toBe(true);
      });
    });

    it('should handle Cerebras/Qwen specific ID formats', () => {
      // Cerebras and Qwen often generate short alphanumeric IDs
      const messages: IMessage[] = [
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'a1b2c3',
              type: 'function',
              function: { name: 'search', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'a1b2c3',
          name: 'search',
          content: 'results',
        },
      ];

      const anthropicMessages = provider['convertMessages'](messages);

      // Should not throw and should maintain ID relationships
      expect(anthropicMessages).toBeDefined();
      expect(anthropicMessages.length).toBeGreaterThan(0);
    });

    it('should not fail when tool_call_id is missing or empty', () => {
      const messages: IMessage[] = [
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'test123',
              type: 'function',
              function: { name: 'test', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: '', // Empty ID (happens with some providers)
          name: 'test',
          content: 'result',
        },
      ];

      // Should handle gracefully without throwing
      expect(() => {
        provider['convertMessages'](messages);
      }).not.toThrow();
    });
  });

  describe('ID normalization requirements', () => {
    it('should ensure all tool_use blocks have valid Anthropic IDs', () => {
      const messages: IMessage[] = [
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'openai_id',
              type: 'function',
              function: { name: 'test', arguments: '{}' },
            },
          ],
        },
      ];

      const anthropicMessages = provider['convertMessages'](messages);
      const assistantMsg = anthropicMessages.find(
        (m) => m.role === 'assistant',
      );
      const toolUseBlock = assistantMsg?.content?.find(
        (c: {
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: string;
          text?: string;
        }) => c.type === 'tool_use',
      );

      // Should either keep the ID or convert to Anthropic format
      expect(toolUseBlock?.id).toBeDefined();
      expect(toolUseBlock?.id).not.toBe('');
    });

    it('should maintain ID consistency across tool call/response pairs', () => {
      const originalId = 'qwen_tool_123';
      const messages: IMessage[] = [
        {
          role: 'assistant',
          tool_calls: [
            {
              id: originalId,
              type: 'function',
              function: { name: 'calc', arguments: '{"x": 1}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: originalId,
          name: 'calc',
          content: '42',
        },
      ];

      const anthropicMessages = provider['convertMessages'](messages);

      // Extract the IDs
      let toolUseId: string | undefined;
      let toolResultId: string | undefined;

      anthropicMessages.forEach((msg) => {
        msg.content?.forEach(
          (c: {
            type: string;
            id?: string;
            name?: string;
            input?: unknown;
            tool_use_id?: string;
            content?: string;
            text?: string;
          }) => {
            if (c.type === 'tool_use') {
              toolUseId = c.id;
            } else if (c.type === 'tool_result') {
              toolResultId = c.tool_use_id;
            }
          },
        );
      });

      // They must match exactly
      expect(toolUseId).toBeDefined();
      expect(toolResultId).toBeDefined();
      expect(toolResultId).toBe(toolUseId);
    });
  });
});
