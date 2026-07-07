import { ContentConverters } from './ContentConverters';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
  ThinkingBlock,
} from './IContent';
import type { GeminiContent } from '../../llm-types/geminiContent.js';
import { describe, it, expect } from 'vitest';

/**
 * Structural shape matching Google's Content for test fixtures.
 * The bridge (ContentConverters.ts) accepts structurally-compatible objects;
 * tests build them with this local type to keep fixtures decoupled from the
 * SDK.
 */
interface TestContent {
  role: string;
  parts: Array<Record<string, unknown>>;
}

const CANONICAL_ID_PATTERN = /^hist_tool_[a-zA-Z0-9_-]+$/;

function expectCanonical(id: string): void {
  expect(id).toMatch(CANONICAL_ID_PATTERN);
}

describe('ContentConverters - Tool ID Normalization', () => {
  describe('toIContent - Converting TO History Format', () => {
    it('should canonicalize tool call IDs', () => {
      const geminiContent: TestContent = {
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

      expect(toolCall.id).not.toBe('692a5fddc');
      expectCanonical(toolCall.id);
    });

    it('should canonicalize tool response IDs', () => {
      const toolResponseContent: TestContent = {
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

      expect(toolResponse.callId).not.toBe('692a5fddc');
      expectCanonical(toolResponse.callId);
    });

    it('should maintain tool call/response pairing with matching raw IDs', () => {
      const geminiContent: TestContent = {
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
      const toolCall = iContent.blocks.find((b) => b.type === 'tool_call');
      const toolResponse = iContent.blocks.find(
        (b) => b.type === 'tool_response',
      );

      expect(toolCall).toBeDefined();
      expect(toolResponse).toBeDefined();
      expect(toolResponse?.callId).toBe(toolCall?.id);
    });

    it('should canonicalize ids consistently when callback provides turn-based ids', () => {
      const geminiContent: TestContent = {
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
      const toolResponseContent: TestContent = {
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
      const geminiContent: TestContent = {
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

      expect(toolCall.id).toBeTruthy();
      expectCanonical(toolCall.id);
    });

    it('should preserve thinking signature when converting from Gemini content', () => {
      const geminiContent: TestContent = {
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
      );

      expect(thinkingBlock).toBeDefined();
      expect(thinkingBlock?.thought).toBe('Thought text');
      expect(thinkingBlock?.signature).toBe('thought-sig');
      expect(thinkingBlock?.sourceField).toBe('thought');
    });

    it('should preserve explicit Anthropic thinking sourceField metadata', () => {
      const geminiContent: TestContent = {
        role: 'model',
        parts: [
          {
            text: 'Anthropic thought',
            thought: true,
            thoughtSignature: 'anthropic-sig',
            llxprtSourceField: 'thinking',
          } as TestContent['parts'][number] & { llxprtSourceField: string },
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
      );

      expect(thinkingBlock).toBeDefined();
      expect(thinkingBlock?.signature).toBe('anthropic-sig');
      expect(thinkingBlock?.sourceField).toBe('thinking');
    });
  });

  describe('Real-world Provider Switching Scenario', () => {
    it('should keep canonical IDs for tool call/response pairs', () => {
      const assistantMessage: TestContent = {
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

      const toolResponse: TestContent = {
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
      const multiToolMessage: TestContent = {
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

describe('ContentConverters - neutral type I/O (#2397)', () => {
  it('toGeminiContent returns a value assignable to the neutral GeminiContent type', () => {
    const iContent: IContent = {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'hello' },
        {
          type: 'tool_call',
          id: 'hist_tool_1_1',
          name: 'search',
          parameters: { q: 'cats' },
        },
      ],
    };

    const result = ContentConverters.toGeminiContent(iContent);

    // Compile-time proof: the return value is structurally assignable to
    // the neutral GeminiContent type (not @google/genai).
    const neutral: GeminiContent = result;
    expect(neutral).toMatchObject({
      role: 'model',
      parts: [
        { text: 'hello' },
        {
          functionCall: {
            name: 'search',
            args: { q: 'cats' },
            id: 'hist_tool_1_1',
          },
        },
      ],
    });
  });

  it('toIContent accepts a neutral GeminiContent input', () => {
    const geminiInput: GeminiContent = {
      role: 'model',
      parts: [
        { text: 'response text' },
        {
          functionCall: { name: 'run_tool', args: {}, id: 'call_1' },
        },
      ],
    };

    // Compile-time proof: neutral GeminiContent is accepted as input.
    const result = ContentConverters.toIContent(
      geminiInput,
      undefined,
      undefined,
      'turn-neutral',
    );

    expect(result.speaker).toBe('ai');
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].type).toBe('text');
    expect(result.blocks[1]).toMatchObject({
      type: 'tool_call',
      id: expect.stringMatching(CANONICAL_ID_PATTERN),
      name: 'run_tool',
      parameters: {},
    });
  });

  it('toGeminiContents / toIContents round-trip through neutral types', () => {
    const original: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hi' }],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'hello back' }],
      },
    ];

    const geminiContents: GeminiContent[] =
      ContentConverters.toGeminiContents(original);
    expect(geminiContents).toHaveLength(2);

    const roundTripped: IContent[] =
      ContentConverters.toIContents(geminiContents);
    expect(roundTripped).toHaveLength(2);
    expect(roundTripped[0].speaker).toBe('human');
    expect(roundTripped[0].blocks[0]).toStrictEqual({
      type: 'text',
      text: 'hi',
    });
    expect(roundTripped[1].speaker).toBe('ai');
    expect(roundTripped[1].blocks[0]).toStrictEqual({
      type: 'text',
      text: 'hello back',
    });
  });

  it('preserves llxprtSourceField through a Gemini round-trip via neutral types', () => {
    const thinking: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'reasoning here',
          sourceField: 'thinking',
          signature: 'sig-abc',
        } as ThinkingBlock,
      ],
    };

    const gemini: GeminiContent = ContentConverters.toGeminiContent(thinking);
    const back: IContent = ContentConverters.toIContent(
      gemini,
      undefined,
      undefined,
      'turn-rt',
    );

    const block = back.blocks[0] as ThinkingBlock;
    expect(block.type).toBe('thinking');
    expect(block.sourceField).toBe('thinking');
    expect(block.signature).toBe('sig-abc');
    expect(block.thought).toBe('reasoning here');
  });
});
