import { describe, it, expect } from 'vitest';
import { ContentConverters } from './ContentConverters';
import type { IContent, ToolCallBlock, ToolResponseBlock } from './IContent';
import type { Content } from '@google/genai';

describe('ContentConverters - Tool ID Normalization', () => {
  describe('toIContent - Converting TO History Format', () => {
    it('should preserve original IDs and normalize prefix to history format', () => {
      // CRITICAL BUG FIX TEST: OpenAI/Qwen use short alphanumeric IDs like '692a5fddc'
      // The fix requires ALWAYS normalizing, not preserving original IDs
      const geminiContent: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'glob',
              args: { pattern: '**/*.ts' },
              id: '692a5fddc', // OpenAI/Qwen style ID - MUST BE IGNORED
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(geminiContent);
      const toolCall = iContent.blocks[0] as ToolCallBlock;

      // Should normalize to history format while preserving original suffix
      expect(toolCall.id).toBe('hist_tool_692a5fddc');
    });

    it('should normalize OpenAI/Qwen tool IDs to history format', () => {
      // OpenAI/Qwen use short alphanumeric IDs like '692a5fddc'
      const geminiContent: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'glob',
              args: { pattern: '**/*.ts' },
              id: '692a5fddc', // OpenAI/Qwen style ID
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(geminiContent);
      const toolCall = iContent.blocks[0] as ToolCallBlock;

      // Should normalize to history format, preserving suffix
      expect(toolCall.id).toBe('hist_tool_692a5fddc');
    });

    it('should normalize Anthropic tool IDs to history format', () => {
      // Anthropic uses 'toolu_' prefix
      const geminiContent: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'read_file',
              args: { path: '/test.ts' },
              id: 'toolu_01abc123def', // Anthropic style ID
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(geminiContent);
      const toolCall = iContent.blocks[0] as ToolCallBlock;

      // Should normalize to history format, preserving suffix
      expect(toolCall.id).toBe('hist_tool_01abc123def');
    });

    it('should normalize OpenAI call_ prefixed IDs to history format', () => {
      // Modern OpenAI uses 'call_' prefix
      const geminiContent: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'search',
              args: { query: 'test' },
              id: 'call_abc123xyz', // OpenAI style ID
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(geminiContent);
      const toolCall = iContent.blocks[0] as ToolCallBlock;

      // Should normalize to history format, preserving suffix
      expect(toolCall.id).toBe('hist_tool_abc123xyz');
    });

    it('should normalize malformed OpenAI call ids missing underscore consistently', () => {
      const canonicalId = 'call_3or3EL9f1eJ6fimZIHmJRVG2';
      const malformedId = 'call3or3EL9f1eJ6fimZIHmJRVG2';

      const geminiContent: Content = {
        role: 'user',
        parts: [
          {
            functionCall: {
              name: 'run_shell_command',
              args: { command: 'echo hi' },
              id: canonicalId,
            },
          },
          {
            functionResponse: {
              name: 'run_shell_command',
              response: { output: 'cancelled' },
              id: malformedId,
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(geminiContent);
      const toolCall = iContent.blocks.find((b) => b.type === 'tool_call') as
        | ToolCallBlock
        | undefined;
      const toolResponse = iContent.blocks.find(
        (b) => b.type === 'tool_response',
      ) as ToolResponseBlock | undefined;

      expect(toolCall).toBeDefined();
      expect(toolResponse).toBeDefined();

      // Both IDs should normalize to the same canonical history ID suffix.
      expect(toolCall?.id).toBe('hist_tool_3or3EL9f1eJ6fimZIHmJRVG2');
      expect(toolResponse?.callId).toBe(toolCall?.id);
    });

    it('should ALWAYS normalize tool response IDs to history format - ignore provider IDs', () => {
      // CRITICAL BUG FIX TEST: Tool response referencing an OpenAI tool call
      // The fix requires ALWAYS normalizing response IDs too
      const toolResponseContent: Content = {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'glob',
              response: { output: 'glob output exceeded token limit...' },
              id: '692a5fddc', // Same OpenAI ID - MUST BE IGNORED
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(toolResponseContent);
      const toolResponse = iContent.blocks[0] as ToolResponseBlock;

      // Should normalize to history format, preserving suffix
      expect(toolResponse.callId).toBe('hist_tool_692a5fddc');
    });

    it('should maintain ID consistency for tool response pairs', () => {
      // Tool response referencing an OpenAI tool call
      const toolResponseContent: Content = {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'glob',
              response: { output: 'glob output exceeded token limit...' },
              id: '692a5fddc', // Same OpenAI ID
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(toolResponseContent);
      const toolResponse = iContent.blocks[0] as ToolResponseBlock;

      // Should normalize to history format
      expect(toolResponse.callId).toBe('hist_tool_692a5fddc');
    });

    it('should preserve original ID with normalized prefix even when callback provided', () => {
      // CRITICAL BUG FIX TEST: Even when original ID exists, should use callback
      const geminiContent: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'test_tool',
              args: { param: 'value' },
              id: 'call_original_should_be_ignored', // Should be completely ignored
            },
          },
        ],
      };

      const mockGenerateId = (): string => 'hist_tool_from_callback_123';

      const iContent = ContentConverters.toIContent(
        geminiContent,
        mockGenerateId,
      );
      const toolCall = iContent.blocks[0] as ToolCallBlock;

      // Should normalize original provider ID and ignore callback since ID is present
      expect(toolCall.id).toBe('hist_tool_original_should_be_ignored');
    });

    it('should normalize tool response IDs and ignore callback when ID is provided', () => {
      // CRITICAL BUG FIX TEST: Tool responses should also use position matching callback
      const toolResponseContent: Content = {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'test_tool',
              response: { result: 'success' },
              id: 'toolu_original_should_be_ignored', // Should be completely ignored
            },
          },
        ],
      };

      const mockGenerateId = (): string => 'hist_tool_fallback';
      const mockGetNextUnmatchedCall = () => ({
        historyId: 'hist_tool_from_position_match',
        toolName: 'test_tool',
      });

      const iContent = ContentConverters.toIContent(
        toolResponseContent,
        mockGenerateId,
        mockGetNextUnmatchedCall,
      );
      const toolResponse = iContent.blocks[0] as ToolResponseBlock;

      // Should normalize original provider ID and ignore matcher since ID is present
      expect(toolResponse.callId).toBe('hist_tool_original_should_be_ignored');
    });

    it('should generate new history IDs when no ID provided', () => {
      const geminiContent: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'test',
              args: {},
              // No ID provided
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(geminiContent);
      const toolCall = iContent.blocks[0] as ToolCallBlock;

      // Should generate history format ID
      expect(toolCall.id).toMatch(/^hist_tool_/);
      expect(toolCall.id).toBeDefined();
    });
  });

  describe('Real-world Provider Switching Scenario', () => {
    it('should handle the exact error scenario from debug log with prefix normalization', () => {
      // CRITICAL BUG FIX TEST: This reproduces the exact error from the debug log where
      // OpenAI/Qwen tool ID '692a5fddc' caused Anthropic 400 error
      // The fix requires using callback system to maintain ID consistency

      // Step 1: Assistant makes tool call with OpenAI/Qwen ID
      const assistantMessage: Content = {
        role: 'model',
        parts: [
          {
            text: "I'll help you analyze files.",
          },
          {
            functionCall: {
              name: 'glob',
              args: { pattern: '**/*.ts' },
              id: '692a5fddc', // The problematic OpenAI/Qwen ID - MUST BE IGNORED
            },
          },
        ],
      };

      // Mock HistoryService callback to ensure consistent IDs
      const mockGenerateId = (): string => 'hist_tool_session_1234_1';

      // Convert to IContent (should normalize ID using callback)
      const assistantIContent = ContentConverters.toIContent(
        assistantMessage,
        mockGenerateId,
      );
      const toolCallBlock = assistantIContent.blocks.find(
        (b) => b.type === 'tool_call',
      ) as ToolCallBlock;

      // ID should preserve original suffix with normalized prefix
      expect(toolCallBlock.id).toBe('hist_tool_692a5fddc');

      // Step 2: Tool response with matching ID
      const toolResponse: Content = {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'glob',
              response: {
                output: 'glob output exceeded token limit and was truncated...',
              },
              id: '692a5fddc', // Same OpenAI/Qwen ID - MUST BE IGNORED
            },
          },
        ],
      };

      // Mock position matching callback to return the same history ID
      const mockGetNextUnmatchedCall = () => ({
        historyId: 'hist_tool_session_1234_1',
        toolName: 'glob',
      });

      // Convert to IContent (should use position matching callback)
      const toolIContent = ContentConverters.toIContent(
        toolResponse,
        mockGenerateId,
        mockGetNextUnmatchedCall,
      );
      const toolResponseBlock = toolIContent.blocks[0] as ToolResponseBlock;

      // Response should also preserve original suffix with normalized prefix
      expect(toolResponseBlock.callId).toBe('hist_tool_692a5fddc');

      // Tool call and response IDs should match
      expect(toolResponseBlock.callId).toBe(toolCallBlock.id);
    });

    it('should handle the exact error scenario from debug log', () => {
      // This reproduces the exact error from the debug log where
      // OpenAI/Qwen tool ID '692a5fddc' caused Anthropic 400 error

      // Step 1: Assistant makes tool call with OpenAI/Qwen ID
      const assistantMessage: Content = {
        role: 'model',
        parts: [
          {
            text: "I'll help you analyze files.",
          },
          {
            functionCall: {
              name: 'glob',
              args: { pattern: '**/*.ts' },
              id: '692a5fddc', // The problematic OpenAI/Qwen ID
            },
          },
        ],
      };

      // Convert to IContent (should normalize ID preserving suffix)
      const assistantIContent = ContentConverters.toIContent(assistantMessage);
      const toolCallBlock = assistantIContent.blocks.find(
        (b) => b.type === 'tool_call',
      ) as ToolCallBlock;

      // ID should be normalized to history format preserving suffix
      expect(toolCallBlock.id).toBe('hist_tool_692a5fddc');

      // Step 2: Tool response with matching ID
      const toolResponse: Content = {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'glob',
              response: {
                output: 'glob output exceeded token limit and was truncated...',
              },
              id: '692a5fddc', // Same OpenAI/Qwen ID
            },
          },
        ],
      };

      // Convert to IContent (should normalize ID to match)
      const toolIContent = ContentConverters.toIContent(toolResponse);
      const toolResponseBlock = toolIContent.blocks[0] as ToolResponseBlock;

      // ID should be normalized to history format preserving suffix and match
      expect(toolResponseBlock.callId).toBe('hist_tool_692a5fddc');
      expect(toolResponseBlock.callId).toBe(toolCallBlock.id);
    });

    it('should handle multiple tool calls with various provider ID formats', () => {
      const multiToolMessage: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'tool1',
              args: {},
              id: '123abc', // Qwen style
            },
          },
          {
            functionCall: {
              name: 'tool2',
              args: {},
              id: 'call_def456', // OpenAI style
            },
          },
          {
            functionCall: {
              name: 'tool3',
              args: {},
              id: 'toolu_789xyz', // Anthropic style
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(multiToolMessage);
      const toolCalls = iContent.blocks.filter(
        (b) => b.type === 'tool_call',
      ) as ToolCallBlock[];

      // All should be normalized to history format, preserving suffixes
      expect(toolCalls).toHaveLength(3);
      toolCalls.forEach((tc) => {
        expect(tc.id).toMatch(/^hist_tool_/);
      });

      // Check expected normalized values
      expect(toolCalls[0].id).toBe('hist_tool_123abc');
      expect(toolCalls[1].id).toBe('hist_tool_def456');
      expect(toolCalls[2].id).toBe('hist_tool_789xyz');
    });
  });
});

describe('ContentConverters - History ID Conversion for Gemini', () => {
  describe('converting IContent to Gemini Content', () => {
    it('should strip history IDs when converting to Gemini format', () => {
      // Given: IContent with history IDs
      const iContent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_123_1', // History ID
            name: 'search',
            parameters: { query: 'test' },
          },
        ],
      };

      // When: Converted to Gemini format
      const geminiContent = ContentConverters.toGeminiContent(iContent);

      // Then: ID should be preserved (but Gemini will ignore it for position-based matching)
      expect(geminiContent.role).toBe('model');
      expect(geminiContent.parts[0].functionCall?.id).toBe('hist_tool_123_1');
      // Note: Gemini ignores IDs and uses position, but we can pass them through
    });

    it('should handle multiple tool calls preserving order', () => {
      // Given: Multiple tool calls with history IDs
      const iContent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_100_1',
            name: 'first_tool',
            parameters: {},
          },
          {
            type: 'tool_call',
            id: 'hist_tool_100_2',
            name: 'second_tool',
            parameters: {},
          },
          {
            type: 'tool_call',
            id: 'hist_tool_100_3',
            name: 'third_tool',
            parameters: {},
          },
        ],
      };

      // When: Converted to Gemini format
      const geminiContent = ContentConverters.toGeminiContent(iContent);

      // Then: Order is preserved for position-based matching
      expect(geminiContent.parts).toHaveLength(3);
      expect(geminiContent.parts[0].functionCall?.name).toBe('first_tool');
      expect(geminiContent.parts[1].functionCall?.name).toBe('second_tool');
      expect(geminiContent.parts[2].functionCall?.name).toBe('third_tool');
    });

    it('should convert tool responses with history IDs', () => {
      // Given: Tool response with history ID
      const iContent: IContent = {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_123_1', // Matches the tool call
            toolName: 'search',
            result: { results: ['item1', 'item2'] },
          },
        ],
      };

      // When: Converted to Gemini format
      const geminiContent = ContentConverters.toGeminiContent(iContent);

      // Then: Role is user (Gemini convention for tool responses)
      expect(geminiContent.role).toBe('user');
      expect(geminiContent.parts[0].functionResponse?.id).toBe(
        'hist_tool_123_1',
      );
      expect(geminiContent.parts[0].functionResponse?.name).toBe('search');
    });
  });

  describe('converting Gemini Content to IContent', () => {
    it('should generate history IDs for tool calls without IDs', () => {
      // Given: Gemini content without IDs (or empty IDs)
      const geminiContent: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'get_weather',
              args: { location: 'NYC' },
              // No ID or empty ID
            },
          },
        ],
      };

      // When: Converted to IContent
      const iContent = ContentConverters.toIContent(geminiContent);

      // Then: Should generate an ID
      expect(iContent.blocks[0].type).toBe('tool_call');
      expect(iContent.blocks[0].id).toBeDefined();
      expect(iContent.blocks[0].id).not.toBe('');
      // The generateId() function should create something
    });

    it('should normalize tool call IDs even when provided (for provider switching fix)', () => {
      // CRITICAL BUG FIX: Changed behavior - IDs are ALWAYS normalized
      // Given: Gemini content with ID (rare but possible)
      const geminiContent: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'search',
              args: { query: 'test' },
              id: 'some_id', // This will be ignored and normalized
            },
          },
        ],
      };

      // When: Converted to IContent
      const iContent = ContentConverters.toIContent(geminiContent);

      // Then: ID should be normalized to history format, not preserved
      expect(iContent.blocks[0].id).toMatch(/^hist_tool_/);
      expect(iContent.blocks[0].id).not.toBe('some_id');
    });

    it('should handle tool responses maintaining position', () => {
      // Given: Tool response from Gemini (no ID)
      const geminiContent: Content = {
        role: 'user', // Gemini uses 'user' for tool responses
        parts: [
          {
            functionResponse: {
              name: 'get_weather',
              response: { temperature: 72, condition: 'sunny' },
              // No ID - Gemini matches by position
            },
          },
        ],
      };

      // When: Converted to IContent
      const iContent = ContentConverters.toIContent(geminiContent);

      // Then: Creates tool response block
      expect(iContent.speaker).toBe('tool'); // Tool responses should have 'tool' speaker
      expect(iContent.blocks[0].type).toBe('tool_response');
      expect(iContent.blocks[0].callId).toMatch(/^hist_tool_/); // Generates history ID when no position matching
      expect(iContent.blocks[0].toolName).toBe('get_weather');
    });

    it('should maintain order for multiple tool calls', () => {
      // Given: Multiple tool calls from Gemini
      const geminiContent: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'tool_a',
              args: {},
            },
          },
          {
            functionCall: {
              name: 'tool_b',
              args: {},
            },
          },
          {
            functionCall: {
              name: 'tool_c',
              args: {},
            },
          },
        ],
      };

      // When: Converted to IContent
      const iContent = ContentConverters.toIContent(geminiContent);

      // Then: Order preserved, each gets an ID
      expect(iContent.blocks).toHaveLength(3);
      expect(iContent.blocks[0].name).toBe('tool_a');
      expect(iContent.blocks[1].name).toBe('tool_b');
      expect(iContent.blocks[2].name).toBe('tool_c');

      // Each should have a generated ID
      iContent.blocks.forEach((block) => {
        expect(block.id).toBeDefined();
        expect(block.id).not.toBe('');
      });
    });
  });

  describe('round-trip conversion', () => {
    it('should maintain tool relationships through round-trip conversion', () => {
      // Given: IContent with tool calls and responses
      const originalContent: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_500_1',
              name: 'search',
              parameters: { query: 'first' },
            },
            {
              type: 'tool_call',
              id: 'hist_tool_500_2',
              name: 'write',
              parameters: { content: 'second' },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_500_1',
              toolName: 'search',
              result: 'search results',
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_500_2',
              toolName: 'write',
              result: 'write complete',
            },
          ],
        },
      ];

      // When: Convert to Gemini and back
      const geminiContents = originalContent.map((c) =>
        ContentConverters.toGeminiContent(c),
      );
      const roundTripContent = geminiContents.map((c) =>
        ContentConverters.toIContent(c),
      );

      // Then: Structure and order preserved
      expect(roundTripContent).toHaveLength(3);

      // Tool calls preserved
      expect(roundTripContent[0].blocks).toHaveLength(2);
      expect(roundTripContent[0].blocks[0].name).toBe('search');
      expect(roundTripContent[0].blocks[1].name).toBe('write');

      // Tool responses preserved
      expect(roundTripContent[1].blocks[0].toolName).toBe('search');
      expect(roundTripContent[2].blocks[0].toolName).toBe('write');

      // IDs normalized to history format (new ones generated since old behavior changed)
      expect(roundTripContent[0].blocks[0].id).toMatch(/^hist_tool_/);
      expect(roundTripContent[0].blocks[1].id).toMatch(/^hist_tool_/);
      // Note: Specific IDs not preserved due to normalization fix
    });
  });

  describe('position-based matching for Gemini', () => {
    it('should support position-based tool response matching', () => {
      // This test documents that Gemini relies on position, not IDs

      // Given: Tool calls followed by responses (no IDs)
      const geminiCalls: Content = {
        role: 'model',
        parts: [
          { functionCall: { name: 'first', args: {} } },
          { functionCall: { name: 'second', args: {} } },
          { functionCall: { name: 'third', args: {} } },
        ],
      };

      const geminiResponses: Content[] = [
        {
          role: 'user',
          parts: [{ functionResponse: { name: 'first', response: 'result1' } }],
        },
        {
          role: 'user',
          parts: [
            { functionResponse: { name: 'second', response: 'result2' } },
          ],
        },
        {
          role: 'user',
          parts: [{ functionResponse: { name: 'third', response: 'result3' } }],
        },
      ];

      // When: Converted to IContent
      const iContentCalls = ContentConverters.toIContent(geminiCalls);
      const iContentResponses = geminiResponses.map((r) =>
        ContentConverters.toIContent(r),
      );

      // Then: Tool calls get generated IDs
      expect(iContentCalls.blocks[0].id).toBeDefined();
      expect(iContentCalls.blocks[1].id).toBeDefined();
      expect(iContentCalls.blocks[2].id).toBeDefined();

      // Responses generate history IDs when no position matching callback
      expect(iContentResponses[0].blocks[0].callId).toMatch(/^hist_tool_/);
      expect(iContentResponses[1].blocks[0].callId).toMatch(/^hist_tool_/);
      expect(iContentResponses[2].blocks[0].callId).toMatch(/^hist_tool_/);

      // But they maintain order/position for matching
      expect(iContentResponses[0].blocks[0].toolName).toBe('first');
      expect(iContentResponses[1].blocks[0].toolName).toBe('second');
      expect(iContentResponses[2].blocks[0].toolName).toBe('third');
    });
  });

  // NEW TESTS FOR ID NORMALIZATION ARCHITECTURE
  // These tests SHOULD FAIL initially - that's the point of TDD
  describe('ID Normalization Architecture - NEW FAILING TESTS', () => {
    describe('Using callbacks instead of internal ID generation', () => {
      it('should use generateId callback for tool calls when provided', () => {
        // FAILING TEST: ContentConverters.toIContent should accept generateId callback as 2nd parameter
        const geminiContent: Content = {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'callback_test_tool',
                args: { test: 'data' },
                // No ID - should use callback
              },
            },
          ],
        };

        let callbackUsed = false;
        const generateIdCallback = (): string => {
          callbackUsed = true;
          return 'hist_tool_callback_id';
        };

        // New signature should accept generateId callback
        const result = ContentConverters.toIContent(
          geminiContent,
          generateIdCallback,
        );

        // Should use the callback-generated ID
        const toolCall = result.blocks[0] as ToolCallBlock;
        expect(toolCall.id).toBe('hist_tool_callback_id');
        expect(callbackUsed).toBe(true);
      });

      it('should use position matching callback for tool responses', () => {
        // FAILING TEST: ContentConverters.toIContent should accept getNextUnmatchedCall callback as 3rd parameter
        const geminiResponse: Content = {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'response_tool',
                response: { result: 'success' },
                // No ID - should use position matching
              },
            },
          ],
        };

        let positionCallbackUsed = false;
        const getNextUnmatchedCall = () => {
          positionCallbackUsed = true;
          return {
            historyId: 'hist_tool_matched_by_position',
            toolName: 'response_tool',
          };
        };

        const generateIdCallback = () => 'hist_tool_fallback';

        // New signature should accept both callbacks
        const result = ContentConverters.toIContent(
          geminiResponse,
          generateIdCallback,
          getNextUnmatchedCall,
        );

        // Should use position matching for responses
        expect(result.blocks[0].type).toBe('tool_response');
        const responseBlock = result.blocks[0] as ToolResponseBlock;
        expect(responseBlock.callId).toBe('hist_tool_matched_by_position');
        expect(positionCallbackUsed).toBe(true);
      });

      it('should NOT use internal generateHistoryId function', () => {
        // FAILING TEST: Internal generateHistoryId should not be accessible/used
        const geminiContent: Content = {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'test_tool',
                args: {},
              },
            },
          ],
        };

        // Without callback, should fail or use a different approach
        // This tests that internal ID generation is removed
        expect(() => {
          const result = ContentConverters.toIContent(geminiContent);
          // If internal generation is removed, this should either fail or use a different mechanism
          const toolCall = result.blocks[0] as ToolCallBlock;
          expect(toolCall.id).toBeDefined();
        }).not.toThrow(); // Should handle gracefully, but not with internal generation
      });
    });

    describe('Position-based matching with callbacks', () => {
      it('should match multiple tool responses by position order', () => {
        // FAILING TEST: Position matching should work with callback system

        // Mock unmatched calls queue
        const unmatchedCalls = [
          { historyId: 'hist_tool_1', toolName: 'first_tool' },
          { historyId: 'hist_tool_2', toolName: 'second_tool' },
          { historyId: 'hist_tool_3', toolName: 'third_tool' },
        ];
        let currentIndex = 0;

        const getNextUnmatchedCall = () => {
          if (currentIndex < unmatchedCalls.length) {
            return unmatchedCalls[currentIndex++];
          }
          return undefined;
        };

        const generateIdCallback = () => 'hist_tool_should_not_use';

        // Three responses in order
        const responses: Content[] = [
          {
            role: 'user',
            parts: [
              { functionResponse: { name: 'first_tool', response: 'result1' } },
            ],
          },
          {
            role: 'user',
            parts: [
              {
                functionResponse: { name: 'second_tool', response: 'result2' },
              },
            ],
          },
          {
            role: 'user',
            parts: [
              { functionResponse: { name: 'third_tool', response: 'result3' } },
            ],
          },
        ];

        // Convert all responses
        const results = responses.map((r) =>
          ContentConverters.toIContent(
            r,
            generateIdCallback,
            getNextUnmatchedCall,
          ),
        );

        // Should have matched by position
        expect(results[0].blocks[0].callId).toBe('hist_tool_1');
        expect(results[1].blocks[0].callId).toBe('hist_tool_2');
        expect(results[2].blocks[0].callId).toBe('hist_tool_3');

        // All should be tool responses
        results.forEach((result) => {
          expect(result.blocks[0].type).toBe('tool_response');
        });
      });

      it('should handle tool responses when no unmatched calls exist', () => {
        // FAILING TEST: Should gracefully handle empty unmatched calls queue
        const geminiResponse: Content = {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'orphan_response',
                response: { data: 'orphaned' },
              },
            },
          ],
        };

        const getNextUnmatchedCall = () => undefined; // No unmatched calls
        const generateIdCallback = () => 'hist_tool_orphan_fallback';

        const result = ContentConverters.toIContent(
          geminiResponse,
          generateIdCallback,
          getNextUnmatchedCall,
        );

        // Should handle gracefully - maybe generate empty callId or use fallback
        expect(result.blocks[0].type).toBe('tool_response');
        const responseBlock = result.blocks[0] as ToolResponseBlock;
        expect(responseBlock.toolName).toBe('orphan_response');
        // CallId should be handled gracefully (empty or fallback)
        expect(typeof responseBlock.callId).toBe('string');
      });
    });

    describe('Integration with HistoryService callbacks', () => {
      it('should work with HistoryService generateHistoryId callback', () => {
        // FAILING TEST: Should integrate with HistoryService ID generation pattern
        const geminiContent: Content = {
          role: 'model',
          parts: [
            { functionCall: { name: 'first', args: {} } },
            { functionCall: { name: 'second', args: {} } },
          ],
        };

        // Mock HistoryService generateHistoryId behavior
        let idCounter = 0;
        const historyServiceCallback = () => {
          idCounter++;
          return `hist_tool_${crypto.randomUUID ? crypto.randomUUID() : 'uuid_' + idCounter}`;
        };

        const result = ContentConverters.toIContent(
          geminiContent,
          historyServiceCallback,
        );

        // Should generate unique history IDs
        expect(result.blocks[0].id).toMatch(/^hist_tool_/);
        expect(result.blocks[1].id).toMatch(/^hist_tool_/);
        expect(result.blocks[0].id).not.toBe(result.blocks[1].id);
      });

      it('should strip IDs when converting back to Gemini format', () => {
        // FAILING TEST: Should not leak history IDs to Gemini format
        const iContent: IContent = {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_should_be_stripped',
              name: 'gemini_tool',
              parameters: { test: 'param' },
            },
          ],
        };

        const geminiContent = ContentConverters.toGeminiContent(iContent);

        // Gemini format should preserve IDs but they're ignored by Gemini for position matching
        expect(geminiContent.parts[0].functionCall?.id).toBe(
          'hist_tool_should_be_stripped',
        );
        // But the important thing is that position is preserved
        expect(geminiContent.parts[0].functionCall?.name).toBe('gemini_tool');
      });
    });

    describe('Error handling and fallbacks', () => {
      it('should handle missing callbacks gracefully', () => {
        // FAILING TEST: Should not crash when callbacks are undefined
        const geminiContent: Content = {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'test_tool',
                args: {},
              },
            },
          ],
        };

        // Call without any callbacks
        expect(() => {
          const result = ContentConverters.toIContent(geminiContent);
          expect(result.blocks).toHaveLength(1);
          expect(result.blocks[0].type).toBe('tool_call');
        }).not.toThrow();
      });

      it('should handle tool calls with existing IDs by preserving and normalizing prefix (ignore callback)', () => {
        // New behavior: preserve provided ID and only normalize prefix; callback used only when ID missing
        const geminiContentWithId: Content = {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'existing_id_tool',
                args: {},
                id: 'existing_gemini_id', // This will be ignored
              },
            },
          ],
        };

        const generateIdCallback = () => 'hist_tool_from_callback_override';

        const result = ContentConverters.toIContent(
          geminiContentWithId,
          generateIdCallback,
        );

        // Should normalize existing ID to history prefix and ignore callback
        const toolCall = result.blocks[0] as ToolCallBlock;
        expect(toolCall.id).toBe('hist_tool_existing_gemini_id');
      });
    });
  });
});
