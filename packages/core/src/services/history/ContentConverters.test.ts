import { ContentConverters } from './ContentConverters';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
  ThinkingBlock,
} from './IContent';
import type { Content } from '@google/genai';
import { describe, it, expect } from 'vitest';

const CANONICAL_ID_PATTERN = /^hist_tool_[a-zA-Z0-9_-]+$/;

function expectCanonical(id: string): void {
  expect(id).toMatch(CANONICAL_ID_PATTERN);
}

describe('ContentConverters - Tool ID Normalization', () => {
  describe('toIContent - Converting TO History Format', () => {
    it('should canonicalize tool call IDs', () => {
      const geminiContent: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'glob',
              args: { pattern: '**/*.ts' },
              id: '692a5fddc',
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(
        geminiContent,
        undefined,
        undefined,
        'turn-test',
      );
      const toolCall = iContent.blocks[0] as ToolCallBlock;

      expectCanonical(toolCall.id);
    });

    it('should canonicalize tool response IDs', () => {
      const toolResponseContent: Content = {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'glob',
              response: { output: 'glob output exceeded token limit...' },
              id: '692a5fddc',
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(
        toolResponseContent,
        undefined,
        undefined,
        'turn-test',
      );
      const toolResponse = iContent.blocks[0] as ToolResponseBlock;

      expectCanonical(toolResponse.callId);
    });

    it('should maintain tool call/response pairing with matching raw IDs', () => {
      const geminiContent: Content = {
        role: 'user',
        parts: [
          {
            functionCall: {
              name: 'run_shell_command',
              args: { command: 'echo hi' },
              id: 'call_3or3EL9f1eJ6fimZIHmJRVG2',
            },
          },
          {
            functionResponse: {
              name: 'run_shell_command',
              response: { output: 'cancelled' },
              id: 'call3or3EL9f1eJ6fimZIHmJRVG2',
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(
        geminiContent,
        undefined,
        undefined,
        'turn-test',
      );
      const toolCall = iContent.blocks.find((b) => b.type === 'tool_call') as
        | ToolCallBlock
        | undefined;
      const toolResponse = iContent.blocks.find(
        (b) => b.type === 'tool_response',
      ) as ToolResponseBlock | undefined;

      expect(toolCall).toBeDefined();
      expect(toolResponse).toBeDefined();
      expect(toolResponse?.callId).toBe(toolCall?.id);
    });

    it('should canonicalize ids consistently when callback provides turn-based ids', () => {
      const geminiContent: Content = {
        role: 'user',
        parts: [
          {
            functionCall: {
              name: 'read_file',
              args: { path: '/tmp/a.txt' },
            },
          },
        ],
      };

      const generatedId = 'hist_tool_test_generated';
      const iContent = ContentConverters.toIContent(
        geminiContent,
        () => generatedId,
        undefined,
        'turn-test',
      );
      const toolCall = iContent.blocks[0] as ToolCallBlock;

      expect(toolCall.id).toBe(generatedId);
    });

    it('should use callback for tool responses when IDs are missing', () => {
      const toolResponseContent: Content = {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'test_tool',
              response: { result: 'success' },
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
        'turn-test',
      );
      const toolResponse = iContent.blocks[0] as ToolResponseBlock;

      expect(toolResponse.callId).toBe('hist_tool_from_position_match');
    });

    it('should generate canonical IDs when IDs are missing', () => {
      const geminiContent: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'test',
              args: {},
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(
        geminiContent,
        undefined,
        undefined,
        'turn-test',
      );
      const toolCall = iContent.blocks[0] as ToolCallBlock;

      expectCanonical(toolCall.id);
    });

    it('should preserve thinking signature when converting from Gemini content', () => {
      const geminiContent: Content = {
        role: 'model',
        parts: [
          {
            text: 'Thought text',
            thought: true,
            thoughtSignature: 'thought-sig',
          },
        ],
      };

      const iContent = ContentConverters.toIContent(
        geminiContent,
        undefined,
        undefined,
        'turn-test',
      );

      const thinkingBlock = iContent.blocks.find(
        (block) => block.type === 'thinking',
      ) as ThinkingBlock | undefined;

      expect(thinkingBlock).toBeDefined();
      expect(thinkingBlock?.thought).toBe('Thought text');
      expect(thinkingBlock?.signature).toBe('thought-sig');
      expect(thinkingBlock?.sourceField).toBe('thought');
    });

    it('should preserve explicit Anthropic thinking sourceField metadata', () => {
      const geminiContent: Content = {
        role: 'model',
        parts: [
          {
            text: 'Anthropic thought',
            thought: true,
            thoughtSignature: 'anthropic-sig',
            llxprtSourceField: 'thinking',
          } as Content['parts'][number] & { llxprtSourceField: string },
        ],
      };

      const iContent = ContentConverters.toIContent(
        geminiContent,
        undefined,
        undefined,
        'turn-test',
      );

      const thinkingBlock = iContent.blocks.find(
        (block) => block.type === 'thinking',
      ) as ThinkingBlock | undefined;

      expect(thinkingBlock).toBeDefined();
      expect(thinkingBlock?.signature).toBe('anthropic-sig');
      expect(thinkingBlock?.sourceField).toBe('thinking');
    });
  });

  describe('Real-world Provider Switching Scenario', () => {
    it('should keep canonical IDs for tool call/response pairs', () => {
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
              id: '692a5fddc',
            },
          },
        ],
      };

      const assistantIContent = ContentConverters.toIContent(
        assistantMessage,
        undefined,
        undefined,
        'turn-test',
      );
      const toolCallBlock = assistantIContent.blocks.find(
        (b) => b.type === 'tool_call',
      ) as ToolCallBlock;

      expectCanonical(toolCallBlock.id);

      const toolResponse: Content = {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'glob',
              response: {
                output: 'glob output exceeded token limit and was truncated...',
              },
              id: '692a5fddc',
            },
          },
        ],
      };

      const toolIContent = ContentConverters.toIContent(
        toolResponse,
        undefined,
        undefined,
        'turn-test',
      );
      const toolResponseBlock = toolIContent.blocks[0] as ToolResponseBlock;

      expect(toolResponseBlock.callId).toBe(toolCallBlock.id);
    });

    it('should canonicalize multiple tool calls with various provider IDs', () => {
      const multiToolMessage: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'tool1',
              args: {},
              id: '123abc',
            },
          },
          {
            functionCall: {
              name: 'tool2',
              args: {},
              id: 'call_def456',
            },
          },
          {
            functionCall: {
              name: 'tool3',
              args: {},
              id: 'toolu_789xyz',
            },
          },
        ],
      };

      const iContent = ContentConverters.toIContent(
        multiToolMessage,
        undefined,
        undefined,
        'turn-test',
      );
      const toolCalls = iContent.blocks.filter(
        (b) => b.type === 'tool_call',
      ) as ToolCallBlock[];

      expect(toolCalls).toHaveLength(3);
      toolCalls.forEach((tc) => {
        expectCanonical(tc.id);
      });
    });
  });
});

describe('ContentConverters - History ID Conversion for Gemini', () => {
  describe('converting IContent to Gemini Content', () => {
    it('should strip history IDs when converting to Gemini format', () => {
      const iContent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_123_1',
            name: 'search',
            parameters: { query: 'test' },
          },
        ],
      };

      const geminiContent = ContentConverters.toGeminiContent(iContent);

      expect(geminiContent.role).toBe('model');
      expect(geminiContent.parts[0].functionCall?.id).toBe('hist_tool_123_1');
    });

    it('should preserve thinking signatures on Gemini parts', () => {
      const iContent: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'Plan the next step',
            sourceField: 'thinking',
            signature: 'sig123',
          } as ThinkingBlock,
        ],
      };

      const geminiContent = ContentConverters.toGeminiContent(iContent);

      expect(geminiContent.parts).toHaveLength(1);
      expect(geminiContent.parts[0].thought).toBe(true);
      expect(geminiContent.parts[0].text).toBe('Plan the next step');
      expect(geminiContent.parts[0].thoughtSignature).toBe('sig123');
      expect(
        (geminiContent.parts[0] as { llxprtSourceField?: string })
          .llxprtSourceField,
      ).toBe('thinking');
    });

    it('should handle multiple tool calls preserving order', () => {
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

      const geminiContent = ContentConverters.toGeminiContent(iContent);

      expect(geminiContent.parts).toHaveLength(3);
      expect(geminiContent.parts[0].functionCall?.name).toBe('first_tool');
      expect(geminiContent.parts[1].functionCall?.name).toBe('second_tool');
      expect(geminiContent.parts[2].functionCall?.name).toBe('third_tool');
    });
  });
});
