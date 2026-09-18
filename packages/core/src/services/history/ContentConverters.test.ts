import { ContentConverters } from './ContentConverters';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
  ThinkingBlock,
  TextBlock,
} from './IContent';
import type { GeminiContent } from '../../llm-types/geminiContent.js';
import { describe, it, expect } from 'bun:test';

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

function findThinkingBlock(content: IContent): ThinkingBlock {
  const block = content.blocks.find(
    (contentBlock): contentBlock is ThinkingBlock =>
      contentBlock.type === 'thinking',
  );
  if (block === undefined) {
    throw new Error('Expected content to contain a thinking block');
  }
  return block;
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

describe('ContentConverters - neutral type I/O (#2397)', () => {
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

  it('toIContents round-trips Gemini-shaped stored history through neutral types', () => {
    const stored: GeminiContent[] = [
      {
        role: 'user',
        parts: [{ text: 'hi' }],
      },
      {
        role: 'model',
        parts: [{ text: 'hello back' }],
      },
    ];

    const roundTripped: IContent[] = ContentConverters.toIContents(stored);
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

  it('preserves llxprtSourceField when parsing a Gemini-shaped thinking part', () => {
    const gemini: GeminiContent = {
      role: 'model',
      parts: [
        {
          text: 'reasoning here',
          thought: true,
          thoughtSignature: 'sig-abc',
          llxprtSourceField: 'thinking',
        },
      ],
    };

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
describe('issue #1723 – thinking visibility compatibility', () => {
  it('keeps ordinary thought parts visible when no hidden metadata is present', () => {
    const geminiContent: TestContent = {
      role: 'model',
      parts: [
        {
          text: 'Ordinary public thought',
          thought: true,
        },
      ],
    };

    const iContent = ContentConverters.toIContent(
      geminiContent,
      undefined,
      undefined,
      'turn-test',
    );

    const thinkingBlock = findThinkingBlock(iContent);

    expect(thinkingBlock.isHidden).toBeUndefined();
  });

  it('preserves explicit hidden thought metadata', () => {
    const geminiContent: TestContent = {
      role: 'model',
      parts: [
        {
          text: 'Context-only thought',
          thought: true,
          llxprtThoughtIsHidden: true,
        },
      ],
    };

    const iContent = ContentConverters.toIContent(
      geminiContent,
      undefined,
      undefined,
      'turn-test',
    );

    const thinkingBlock = findThinkingBlock(iContent);

    expect(thinkingBlock.isHidden).toBe(true);
  });

  it('preserves absent isHidden metadata when parsing a Gemini-shaped part without it', () => {
    const gemini: GeminiContent = {
      role: 'model',
      parts: [
        {
          text: 'Visible by default for legacy API compatibility',
          thought: true,
          llxprtSourceField: 'thought',
          llxprtThoughtBlockId: 'stream-visible',
          llxprtThoughtBlockStatus: 'complete',
        },
      ],
    };

    const restored = ContentConverters.toIContent(
      gemini,
      undefined,
      undefined,
      'turn-visible',
    );
    const thinkingBlock = findThinkingBlock(restored);

    expect(thinkingBlock.isHidden).toBeUndefined();
    expect(thinkingBlock.streamId).toBe('stream-visible');
    expect(thinkingBlock.streamStatus).toBe('complete');
  });

  it('preserves explicit visible metadata when parsing a Gemini-shaped part', () => {
    const gemini: GeminiContent = {
      role: 'model',
      parts: [
        {
          text: 'Explicitly visible thought',
          thought: true,
          llxprtSourceField: 'thought',
          llxprtThoughtIsHidden: false,
        },
      ],
    };

    const restored = ContentConverters.toIContent(
      gemini,
      undefined,
      undefined,
      'turn-visible-explicit',
    );
    const thinkingBlock = findThinkingBlock(restored);

    expect(thinkingBlock.isHidden).toBe(false);
  });

  it('preserves explicit hidden metadata when parsing a Gemini-shaped part', () => {
    const gemini: GeminiContent = {
      role: 'model',
      parts: [
        {
          text: 'Context-only thought',
          thought: true,
          llxprtSourceField: 'thought',
          llxprtThoughtIsHidden: true,
        },
      ],
    };

    const restored = ContentConverters.toIContent(
      gemini,
      undefined,
      undefined,
      'turn-hidden',
    );
    const thinkingBlock = findThinkingBlock(restored);

    expect(thinkingBlock.isHidden).toBe(true);
  });
});

describe('issue #2410 – toIContent zero-block guard', () => {
  it('produces zero blocks when input has no parts (not a fabricated turn)', () => {
    const emptyContent: TestContent = {
      role: 'user',
      parts: [],
    };

    const result = ContentConverters.toIContent(
      emptyContent,
      undefined,
      undefined,
      'turn-empty',
    );

    // The converter does not fabricate content — it produces zero blocks
    // so downstream history services can detect and drop the empty turn.
    expect(result.blocks).toHaveLength(0);
    expect(result.speaker).toBe('human');
  });

  it('produces zero blocks when input parts is undefined', () => {
    const noPartsContent: TestContent = {
      role: 'model',
      parts: undefined as unknown as TestContent['parts'],
    };

    const result = ContentConverters.toIContent(
      noPartsContent,
      undefined,
      undefined,
      'turn-noparts',
    );

    expect(result.blocks).toHaveLength(0);
    expect(result.speaker).toBe('ai');
  });
});

describe('issue #2410 – exact text/tool-response payload and ID preservation', () => {
  it('preserves exact text content and block order in a mixed parts array', () => {
    const content: TestContent = {
      role: 'model',
      parts: [{ text: 'First sentence. ' }, { text: 'Second sentence.' }],
    };

    const result = ContentConverters.toIContent(
      content,
      undefined,
      undefined,
      'turn-text-exact',
    );

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]).toStrictEqual({
      type: 'text',
      text: 'First sentence. ',
    });
    expect(result.blocks[1]).toStrictEqual({
      type: 'text',
      text: 'Second sentence.',
    });
  });

  it('preserves exact functionResponse payload (name, response, id) as ToolResponseBlock', () => {
    const content: TestContent = {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'read_file',
            id: 'call-abc-123',
            response: { content: 'file contents here' },
          },
        },
      ],
    };

    const result = ContentConverters.toIContent(
      content,
      undefined,
      undefined,
      'turn-fr-exact',
    );

    expect(result.blocks).toHaveLength(1);
    const tr = result.blocks[0] as ToolResponseBlock;
    expect(tr.type).toBe('tool_response');
    expect(tr.toolName).toBe('read_file');
    expect(tr.result).toStrictEqual({ content: 'file contents here' });
    // The raw provider ID must be canonicalized, not passed through verbatim.
    expect(tr.callId).not.toBe('call-abc-123');
    expect(tr.callId).toMatch(CANONICAL_ID_PATTERN);
  });

  it('preserves interleaved text + functionCall + text in exact order', () => {
    const content: TestContent = {
      role: 'model',
      parts: [
        { text: 'Let me search for that. ' },
        {
          functionCall: {
            name: 'search',
            args: { query: 'test' },
            id: 'fc-1',
          },
        },
        { text: ' Done.' },
      ],
    };

    const result = ContentConverters.toIContent(
      content,
      undefined,
      undefined,
      'turn-interleaved',
    );

    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[0]).toStrictEqual({
      type: 'text',
      text: 'Let me search for that. ',
    });
    expect(result.blocks[1].type).toBe('tool_call');
    expect(result.blocks[2]).toStrictEqual({
      type: 'text',
      text: ' Done.',
    });
  });
});

describe('issue #2349 – Google-style {thought:true, text, thoughtSignature} parsing', () => {
  it('preserves thinking semantics/signature when parsing a Gemini-shaped part', () => {
    const gemini: GeminiContent = {
      role: 'model',
      parts: [
        {
          thought: true,
          text: 'my reasoning',
          thoughtSignature: 'sig-rt',
        },
      ],
    };

    const back: IContent = ContentConverters.toIContent(
      gemini,
      undefined,
      undefined,
      'turn-thought-rt',
    );

    const block = back.blocks[0] as ThinkingBlock;
    expect(block.type).toBe('thinking');
    expect(block.thought).toBe('my reasoning');
    expect(block.signature).toBe('sig-rt');
  });

  it('preserves mixed thinking + text parts when parsing a Gemini-shaped content', () => {
    const gemini: GeminiContent = {
      role: 'model',
      parts: [
        {
          thought: true,
          text: 'internal reasoning',
          thoughtSignature: 'sig-mix',
        },
        { text: 'visible answer' },
      ],
    };

    const back = ContentConverters.toIContent(
      gemini,
      undefined,
      undefined,
      'turn-mix-rt',
    );

    const thinking = back.blocks.find(
      (b): b is ThinkingBlock => b.type === 'thinking',
    );
    const text = back.blocks.find((b): b is TextBlock => b.type === 'text');
    expect(thinking).toBeDefined();
    expect(thinking?.thought).toBe('internal reasoning');
    expect(thinking?.signature).toBe('sig-mix');
    expect(text).toBeDefined();
    expect(text?.text).toBe('visible answer');
  });
});
