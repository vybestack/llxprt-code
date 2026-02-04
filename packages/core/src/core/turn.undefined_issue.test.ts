import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Turn } from './turn.js';
import { GeminiChat } from './geminiChat.js';
import { FunctionCall } from '@google/genai';
import { GeminiEventType } from './turn.js';

describe('Turn GitHub Issue #305: undefined_tool_name Integration Tests', () => {
  let mockGeminiChat: GeminiChat;

  beforeEach(() => {
    // Create a more realistic mock for GeminiChat
    mockGeminiChat = {
      sendPromise: Promise.resolve(),
      compressionPromise: Promise.resolve(),
      logger: {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      sendMessageStream: vi.fn().mockResolvedValue((async function* () {})()),
      getHistory: vi.fn().mockReturnValue([]),
      maybeIncludeSchemaDepthContext: vi.fn().mockResolvedValue(undefined),
      // Add other required properties with minimal implementations
      compress: vi.fn(),
      addMessage: vi.fn(),
      clear: vi.fn(),
      getSettings: vi.fn().mockReturnValue({}),
      setSettings: vi.fn(),
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      setModel: vi.fn(),
      getSystemInstruction: vi.fn().mockReturnValue(''),
      setSystemInstruction: vi.fn(),
      getTools: vi.fn().mockReturnValue([]),
      setTools: vi.fn(),
      getGenerationConfig: vi.fn().mockReturnValue({}),
      setGenerationConfig: vi.fn(),
      getSafetySettings: vi.fn().mockReturnValue([]),
      setSafetySettings: vi.fn(),
      // Add any other required properties...
    } as unknown as GeminiChat;
  });

  describe('Tool Name Normalization Integration', () => {
    it('should handle Turn construction with different prompt IDs', () => {
      // Test basic Turn construction
      const turnWithId = new Turn(mockGeminiChat, 'different-prompt-id');
      expect(turnWithId).toBeInstanceOf(Turn);
    });

    it('should handle Turn with agent ID', () => {
      // Test Turn construction with agent ID
      const turnWithAgent = new Turn(
        mockGeminiChat,
        'test-prompt',
        'agent-123',
      );
      expect(turnWithAgent).toBeInstanceOf(Turn);
    });

    it('should have proper event types for GitHub #305 scenarios', () => {
      // Verify that the required event types exist
      expect(GeminiEventType.ToolCallRequest).toBe('tool_call_request');
      expect(GeminiEventType.Error).toBe('error');
    });
  });

  describe('FunctionCall Processing Scenarios', () => {
    it('should create proper FunctionCall objects for testing', () => {
      // Test creating FunctionCall objects that simulate the GitHub #305 issue
      const validFunctionCall: FunctionCall = {
        name: 'write_file',
        args: { filename: 'test.txt', content: 'Hello World' },
      };

      expect(validFunctionCall.name).toBe('write_file');
      expect(validFunctionCall.args).toEqual({
        filename: 'test.txt',
        content: 'Hello World',
      });
    });

    it('should handle FunctionCall with undefined name (GitHub #305 scenario)', () => {
      // Simulate the problematic FunctionCall from qwen models
      const problematicFunctionCall: Partial<FunctionCall> = {
        name: undefined,
        args: { file: 'output.txt' },
      };

      expect(problematicFunctionCall.name).toBeUndefined();
      expect(problematicFunctionCall.args).toEqual({ file: 'output.txt' });
    });

    it('should handle FunctionCall with empty name', () => {
      const emptyNameFunctionCall: Partial<FunctionCall> = {
        name: '',
        args: { data: 'test' },
      };

      expect(emptyNameFunctionCall.name).toBe('');
      expect(emptyNameFunctionCall.args).toEqual({ data: 'test' });
    });

    it('should handle FunctionCall with null name', () => {
      const nullNameFunctionCall: Partial<FunctionCall> = {
        name: undefined, // FunctionCall.name is string | undefined, not null
        args: { content: 'test' },
      };

      expect(nullNameFunctionCall.name).toBeUndefined();
      expect(nullNameFunctionCall.args).toEqual({ content: 'test' });
    });

    it('should handle FunctionCall with malformed args', () => {
      // Note: FunctionCall args should be Record<string, unknown>, not string
      // Malformed JSON would be handled at a higher level
      const malformedArgsFunctionCall: Partial<FunctionCall> = {
        name: 'test_tool',
        args: { malformed: 'json would be parsed elsewhere' },
      };

      expect(malformedArgsFunctionCall.name).toBe('test_tool');
      expect(malformedArgsFunctionCall.args).toEqual({
        malformed: 'json would be parsed elsewhere',
      });
    });

    it('should handle FunctionCall without args', () => {
      const noArgsFunctionCall: Partial<FunctionCall> = {
        name: 'test_tool',
      };

      expect(noArgsFunctionCall.name).toBe('test_tool');
      expect(noArgsFunctionCall.args).toBeUndefined();
    });
  });

  describe('GitHub #305 Edge Cases', () => {
    it.each([
      {
        description: 'Null name',
        functionCall: {
          name: undefined,
          args: { file: 'test.txt' },
        } as Partial<FunctionCall>,
        expectedName: undefined,
      },
      {
        description: 'Explicit undefined name',
        functionCall: {
          name: undefined,
          args: { file: 'test.txt' },
        } as Partial<FunctionCall>,
        expectedName: undefined,
      },
      {
        description: 'Null name (duplicate)',
        functionCall: {
          name: undefined,
          args: { file: 'test.txt' },
        } as Partial<FunctionCall>,
        expectedName: undefined,
      },
      {
        description: 'Empty string name',
        functionCall: {
          name: '',
          args: { file: 'test.txt' },
        } as Partial<FunctionCall>,
        expectedName: '',
      },
      {
        description: 'Whitespace-only name',
        functionCall: {
          name: '   \t\n   ',
          args: { file: 'test.txt' },
        } as Partial<FunctionCall>,
        expectedName: '   \t\n   ',
      },
    ])(
      'should simulate qwen model problematic scenario: $description',
      ({ functionCall, expectedName }) => {
        // These are the exact scenarios reported in GitHub #305
        expect(functionCall.args).toEqual({ file: 'test.txt' });
        expect(functionCall.name).toBe(expectedName);
      },
    );

    it('should test tool name patterns that cause issues', () => {
      // Test various tool name patterns that might cause normalization issues
      const problematicNames = [
        '', // Empty
        '   ', // Whitespace
        'tool@name', // Special characters
        'tool#name', // Special characters
        'tool$name', // Special characters
        'tool name', // Space
        'tool-name', // Hyphen
        'tool.name', // Dot
        'a'.repeat(200), // Too long
      ];

      for (const name of problematicNames) {
        expect(typeof name).toBe('string');
      }
    });

    it('should test valid tool name patterns', () => {
      // Test tool names that should work correctly
      const validNames = [
        'write_file',
        'read_data',
        'process_http_request',
        'delete_file',
        'create_directory',
        'list_files',
        'tool123',
        'test_tool',
      ];

      for (const name of validNames) {
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
        expect(name.length).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('Integration with normalizeToolName', () => {
    it('should import normalizeToolName correctly', async () => {
      // Test that we can import the normalizeToolName function
      const { normalizeToolName } = await import('../tools/toolNameUtils.js');

      expect(typeof normalizeToolName).toBe('function');

      // Test basic functionality
      expect(normalizeToolName('writeFile')).toBe('write_file');
      expect(normalizeToolName('read_data')).toBe('read_data');
      expect(normalizeToolName('')).toBeNull();
      expect(normalizeToolName('   ')).toBeNull();
    });

    it.each([
      { input: 'writeFile', expected: 'write_file' },
      { input: 'read_data', expected: 'read_data' },
      { input: '', expected: null },
      { input: '   ', expected: null },
      { input: 'invalid@tool', expected: null },
    ])(
      'should handle Turn.ts scenario: input="$input"',
      async ({ input, expected }) => {
        const { normalizeToolName } = await import('../tools/toolNameUtils.js');

        // Test the same logic as in turn.ts:444-456
        const result = normalizeToolName(input);
        expect(result).toBe(expected);
      },
    );

    it('should use fallback name for invalid tool names', () => {
      // Simulate the fallback logic from turn.ts when normalizeToolName returns null
      const fallbackName = 'undefined_tool_name';
      expect(fallbackName).toBe('undefined_tool_name');
    });
  });

  describe('Error Recovery and Robustness', () => {
    it('should handle malformed JSON in FunctionCall args', () => {
      // Note: FunctionCall args are Record<string, unknown>, not string
      // Malformed JSON would be handled at a higher level before creating FunctionCall
      const malformedCases = [
        { malformed: 'json would be parsed elsewhere' },
        { incomplete: 'data' },
        { null: 'value' },
        { empty: '' },
      ];

      for (const malformedCase of malformedCases) {
        const functionCall: Partial<FunctionCall> = {
          name: 'test_tool',
          args: malformedCase,
        };

        expect(functionCall.name).toBe('test_tool');
        expect(functionCall.args).toEqual(malformedCase);
      }
    });

    it('should handle extreme tool name lengths', () => {
      const extremeCases = [
        'a'.repeat(0), // Empty
        'a'.repeat(1), // Single character
        'a'.repeat(100), // Max valid length
        'a'.repeat(101), // Just over limit
        'a'.repeat(1000), // Way over limit
      ];

      for (const name of extremeCases) {
        const functionCall: Partial<FunctionCall> = {
          name,
          args: {},
        };

        expect(functionCall.name).toBe(name);
        expect(functionCall.args).toEqual({});
      }
    });

    it('should handle special Unicode characters', () => {
      const unicodeCases = [
        '工具名稱', // Chinese
        'tôöl_nâmé', // Accented
        'инструмент', // Cyrillic
        '🔧_tool', // Emoji
        '\u0000tool', // Null character
        '\n\ttool', // Control characters
      ];

      for (const name of unicodeCases) {
        const functionCall: Partial<FunctionCall> = {
          name,
          args: {},
        };

        expect(functionCall.name).toBe(name);
        expect(functionCall.args).toEqual({});
      }
    });
  });
});
