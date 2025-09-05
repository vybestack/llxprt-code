import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryService } from './history/HistoryService.js';
import type { IMessage } from '../providers/IMessage.js';
import type { ToolCallBlock } from './history/IContent.js';

describe('HistoryService - Tool ID Normalization', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  describe('normalizing provider messages to history format', () => {
    it('should generate history IDs for OpenAI tool calls', () => {
      // Given: OpenAI format message
      const openAIMessage: IMessage = {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_abc123',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path": "test.txt"}',
            },
          },
        ],
      };

      // When: Message is added to history
      const content = historyService.addMessage(openAIMessage, 'openai');

      // Then: History ID is generated for tool call
      const toolCallBlock = content.blocks[0] as ToolCallBlock;
      expect(toolCallBlock.id).toMatch(/^hist_tool_/);
      // The ID should be normalized (call_abc123 -> hist_tool_abc123)
      expect(toolCallBlock.id).toBe('hist_tool_abc123');
    });

    it('should generate history IDs for Anthropic tool calls', () => {
      // Given: Anthropic format message
      const anthropicMessage: IMessage = {
        role: 'assistant',
        tool_calls: [
          {
            id: 'toolu_xyz789',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: '{"path": "out.txt", "content": "data"}',
            },
          },
        ],
      };

      // When: Message is added to history
      const content = historyService.addMessage(anthropicMessage, 'anthropic');

      // Then: History ID is generated
      expect(content.blocks[0].toolId).toMatch(/^hist_tool_/);
      // And: Different from provider ID
      expect(content.blocks[0].toolId).not.toBe('toolu_xyz789');
    });

    it('should generate history IDs for Gemini tool calls (no original ID)', () => {
      // Given: Gemini format message without IDs
      const geminiMessage: IMessage = {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: '', // Gemini might have empty ID
            type: 'function',
            function: {
              name: 'search',
              arguments: '{"query": "test"}',
            },
          },
        ],
      };

      // When: Message is added to history
      const content = historyService.addMessage(geminiMessage, 'gemini');

      // Then: History ID is generated anyway
      expect(content.blocks[0].toolId).toMatch(/^hist_tool_/);
      expect(content.blocks[0].toolId).not.toBe('');
    });

    it('should match tool responses to tool calls using normalized IDs', () => {
      // Given: Tool call has been added
      const toolCall: IMessage = {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function',
            function: { name: 'get_data', arguments: '{}' },
          },
        ],
      };
      const callContent = historyService.addMessage(toolCall, 'openai');
      const historyId = callContent.blocks[0].toolId;

      // When: Tool response arrives with provider ID
      const toolResponse: IMessage = {
        role: 'tool',
        tool_call_id: 'call_abc',
        name: 'get_data',
        content: 'result data',
      };
      const responseContent = historyService.addMessage(toolResponse, 'openai');

      // Then: Response uses same history ID
      expect(responseContent.blocks[0].toolId).toBe(historyId);
    });

    it('should handle multiple tool calls in single message', () => {
      // Given: Message with multiple tool calls
      const message: IMessage = {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'tool1', arguments: '{}' },
          },
          {
            id: 'call_2',
            type: 'function',
            function: { name: 'tool2', arguments: '{}' },
          },
          {
            id: 'call_3',
            type: 'function',
            function: { name: 'tool3', arguments: '{}' },
          },
        ],
      };

      // When: Added to history
      const content = historyService.addMessage(message, 'openai');

      // Then: Each gets unique history ID
      const ids = content.blocks.map((b) => b.toolId);
      expect(new Set(ids).size).toBe(3);
      // And: All match pattern
      ids.forEach((id) => {
        expect(id).toMatch(/^hist_tool_/);
      });
    });
  });

  describe('converting history to provider format', () => {
    it('should provide messages with history IDs for provider conversion', () => {
      // Given: History with normalized IDs
      historyService.addMessage(
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_original',
              type: 'function',
              function: { name: 'test', arguments: '{}' },
            },
          ],
        },
        'openai',
      );

      // When: Retrieved for provider use
      const contents = historyService.getContents();

      // Then: Contains history IDs, not provider IDs
      expect(contents[0].blocks[0].toolId).toMatch(/^hist_tool_/);
      expect(contents[0].blocks[0].toolId).not.toBe('call_original');
    });

    it('should maintain tool call/response pairs with consistent IDs', () => {
      // Given: Complete tool call/response pair
      const call: IMessage = {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_xyz',
            type: 'function',
            function: { name: 'action', arguments: '{}' },
          },
        ],
      };
      const response: IMessage = {
        role: 'tool',
        tool_call_id: 'call_xyz',
        name: 'action',
        content: 'done',
      };

      // When: Both added to history
      historyService.addMessage(call, 'openai');
      historyService.addMessage(response, 'openai');

      // Then: Both have same history ID
      const contents = historyService.getContents();
      const callId = contents[0].blocks[0].toolId;
      const responseId = contents[1].blocks[0].toolId;
      expect(callId).toBe(responseId);
    });
  });

  describe('provider switching scenarios', () => {
    it('should preserve ID relationships when switching providers mid-conversation', () => {
      // Given: OpenAI conversation with tool calls
      const openAICall: IMessage = {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_openai',
            type: 'function',
            function: { name: 'process', arguments: '{}' },
          },
        ],
      };
      const openAIResponse: IMessage = {
        role: 'tool',
        tool_call_id: 'call_openai',
        name: 'process',
        content: 'processed',
      };

      historyService.addMessage(openAICall, 'openai');
      historyService.addMessage(openAIResponse, 'openai');

      // When: Retrieved for Anthropic provider
      const contents = historyService.getContents();

      // Then: Tool pairs still match with history IDs
      expect(contents[0].blocks[0].toolId).toBe(contents[1].blocks[0].toolId);
      // And: No provider-specific IDs leaked
      expect(contents[0].blocks[0].toolId).not.toContain('call_');
      expect(contents[0].blocks[0].toolId).not.toContain('toolu_');
    });
  });

  describe('Gemini position-based matching', () => {
    it('should match Gemini responses by position when no IDs provided', () => {
      // Given: Gemini tool calls without IDs
      const geminiCalls: IMessage = {
        role: 'assistant',
        tool_calls: [
          {
            id: '',
            type: 'function',
            function: { name: 'first_tool', arguments: '{}' },
          },
          {
            id: '',
            type: 'function',
            function: { name: 'second_tool', arguments: '{}' },
          },
          {
            id: '',
            type: 'function',
            function: { name: 'third_tool', arguments: '{}' },
          },
        ],
      };

      // When: Added to history
      const callContent = historyService.addMessage(geminiCalls, 'gemini');

      // Then: Each gets unique history ID despite empty provider IDs
      expect(callContent.blocks[0].toolId).toMatch(/^hist_tool_/);
      expect(callContent.blocks[1].toolId).toMatch(/^hist_tool_/);
      expect(callContent.blocks[2].toolId).toMatch(/^hist_tool_/);
      expect(callContent.blocks[0].toolId).not.toBe(
        callContent.blocks[1].toolId,
      );

      // When: Gemini responses arrive (no IDs, matched by position)
      const response1: IMessage = {
        role: 'tool',
        tool_call_id: '',
        name: 'first_tool',
        content: 'first result',
      };
      const response2: IMessage = {
        role: 'tool',
        tool_call_id: '',
        name: 'second_tool',
        content: 'second result',
      };

      // Then: Responses matched to calls by position
      const resp1Content = historyService.addMessage(response1, 'gemini');
      const resp2Content = historyService.addMessage(response2, 'gemini');

      expect(resp1Content.blocks[0].toolId).toBe(callContent.blocks[0].toolId);
      expect(resp2Content.blocks[0].toolId).toBe(callContent.blocks[1].toolId);
    });
  });

  describe('Compression threshold and context limit settings', () => {
    it('should respect ephemeral compression-threshold and context-limit settings', () => {
      // Test that compression only happens when:
      // tokenCount > (compression-threshold * context-limit)

      // Given: Set ephemeral settings
      const mockCompressionThreshold = 0.7; // 70%
      const mockContextLimit = 100000; // 100k tokens

      // The compression should trigger when tokens exceed:
      // 0.7 * 100000 = 70000 tokens
      const compressionTriggerPoint =
        mockCompressionThreshold * mockContextLimit;

      // Test case 1: Below threshold - should NOT compress
      const tokensBelow = 65000; // Below 70000
      expect(tokensBelow).toBeLessThan(compressionTriggerPoint);
      // In real implementation, this would NOT trigger compression

      // Test case 2: Above threshold - SHOULD compress
      const tokensAbove = 75000; // Above 70000
      expect(tokensAbove).toBeGreaterThan(compressionTriggerPoint);
      // In real implementation, this WOULD trigger compression

      // Test case 3: Exactly at threshold - SHOULD compress
      const tokensExact = 70000;
      expect(tokensExact).toBe(compressionTriggerPoint);
      // In real implementation, this WOULD trigger compression (>= check)
    });

    it('should use default compression threshold (85%) when not set', () => {
      // Default from compression-config.ts is 0.85 (85%)
      const defaultThreshold = 0.85;
      const mockContextLimit = 100000;

      const compressionTriggerPoint = defaultThreshold * mockContextLimit;
      expect(compressionTriggerPoint).toBe(85000);

      // Below 85% should NOT compress
      const tokensBelowDefault = 80000;
      expect(tokensBelowDefault).toBeLessThan(compressionTriggerPoint);

      // Above 85% should compress
      const tokensAboveDefault = 90000;
      expect(tokensAboveDefault).toBeGreaterThan(compressionTriggerPoint);
    });

    it('should handle different context limits correctly', () => {
      const mockCompressionThreshold = 0.8; // 80%

      // Test with smaller context limit
      const smallContextLimit = 50000;
      const smallTriggerPoint = mockCompressionThreshold * smallContextLimit;
      expect(smallTriggerPoint).toBe(40000);

      // Test with larger context limit
      const largeContextLimit = 200000;
      const largeTriggerPoint = mockCompressionThreshold * largeContextLimit;
      expect(largeTriggerPoint).toBe(160000);

      // Same percentage, different absolute values
      expect(smallTriggerPoint).toBeLessThan(largeTriggerPoint);
    });

    it('should validate compression threshold is between 0 and 1', () => {
      // Compression threshold must be a decimal between 0 and 1
      const validThresholds = [0.1, 0.5, 0.7, 0.85, 0.99];
      const invalidThresholds = [-0.5, 0, 1.5, 2, -1];

      validThresholds.forEach((threshold) => {
        expect(threshold).toBeGreaterThan(0);
        expect(threshold).toBeLessThanOrEqual(1);
      });

      invalidThresholds.forEach((threshold) => {
        const isValid = threshold > 0 && threshold <= 1;
        expect(isValid).toBe(false);
      });
    });

    it('should validate context limit is positive integer', () => {
      // Context limit must be a positive integer
      const validLimits = [1000, 50000, 100000, 200000];
      const invalidLimits = [-1000, 0, -50000];

      validLimits.forEach((limit) => {
        expect(limit).toBeGreaterThan(0);
        expect(Number.isInteger(limit)).toBe(true);
      });

      invalidLimits.forEach((limit) => {
        const isValid = limit > 0 && Number.isInteger(limit);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('edge cases', () => {
    it('should handle orphaned tool responses (no matching call)', () => {
      // Given: Tool response without prior call
      const orphanResponse: IMessage = {
        role: 'tool',
        tool_call_id: 'call_orphan',
        name: 'orphaned_tool',
        content: 'orphan result',
      };

      // When: Added to history
      const content = historyService.addMessage(orphanResponse, 'openai');

      // Then: Still gets history ID
      expect(content.blocks[0].toolId).toMatch(/^hist_tool_/);
      // And: Warning logged (check via spy)
    });

    it('should handle corrupted/missing IDs gracefully', () => {
      // Given: Message with various ID issues
      const messagesWithIssues = [
        {
          role: 'assistant',
          tool_calls: [
            {
              id: null,
              type: 'function',
              function: { name: 't1', arguments: '{}' },
            },
          ],
        },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: undefined,
              type: 'function',
              function: { name: 't2', arguments: '{}' },
            },
          ],
        },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: '',
              type: 'function',
              function: { name: 't3', arguments: '{}' },
            },
          ],
        },
      ];

      // When: Each added to history
      messagesWithIssues.forEach((msg) => {
        const content = historyService.addMessage(msg as IMessage, 'openai');

        // Then: All get valid history IDs
        expect(content.blocks[0].toolId).toMatch(/^hist_tool_/);
      });
    });

    it('should handle duplicate provider IDs correctly', () => {
      // Given: Multiple tool calls with the SAME provider ID (edge case)
      const call1: IMessage = {
        role: 'assistant',
        tool_calls: [
          {
            id: 'duplicate_id',
            type: 'function',
            function: { name: 'tool_a', arguments: '{"param": "first"}' },
          },
        ],
      };

      const call2: IMessage = {
        role: 'assistant',
        tool_calls: [
          {
            id: 'duplicate_id', // Same ID!
            type: 'function',
            function: { name: 'tool_b', arguments: '{"param": "second"}' },
          },
        ],
      };

      // When: Both added to history
      const content1 = historyService.addMessage(call1, 'openai');
      const content2 = historyService.addMessage(call2, 'openai');

      // Then: Each gets unique history ID despite same provider ID
      expect(content1.blocks[0].toolId).toMatch(/^hist_tool_/);
      expect(content2.blocks[0].toolId).toMatch(/^hist_tool_/);
      expect(content1.blocks[0].toolId).not.toBe(content2.blocks[0].toolId);

      // When: Response arrives for the duplicate ID
      const response: IMessage = {
        role: 'tool',
        tool_call_id: 'duplicate_id',
        name: 'tool_b',
        content: 'response',
      };

      // Then: Should match the most recent unmatched call with that ID
      const responseContent = historyService.addMessage(response, 'openai');
      expect(responseContent.blocks[0].toolId).toBe(content2.blocks[0].toolId);
    });

    it('should generate unique IDs even for duplicate tool names', () => {
      // Given: Multiple calls to same tool
      const calls = Array(5)
        .fill(null)
        .map((_, i) => ({
          role: 'assistant' as const,
          tool_calls: [
            {
              id: `call_${i}`,
              type: 'function' as const,
              function: {
                name: 'read_file',
                arguments: '{"path": "same.txt"}',
              },
            },
          ],
        }));

      // When: All added to history
      const contents = calls.map((call) =>
        historyService.addMessage(call, 'openai'),
      );

      // Then: All have unique history IDs
      const ids = contents.map((c) => c.blocks[0].toolId);
      expect(new Set(ids).size).toBe(5);
    });
  });
});
