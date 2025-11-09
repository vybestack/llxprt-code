import { describe, it, expect } from 'vitest';
import {
  enhanceToolNameExtraction,
  validateToolName,
  processFinalToolName,
  safeExtractToolName,
} from './toolNameUtils.js';

describe('toolNameUtils', () => {
  describe('enhanceToolNameExtraction', () => {
    it('should return valid existing name', () => {
      const result = enhanceToolNameExtraction(
        'search_files',
        undefined,
        false,
      );
      expect(result).toEqual({
        name: 'search_files',
        isFallback: false,
      });
    });

    it('should use new name when current is empty', () => {
      const result = enhanceToolNameExtraction('', 'write_file', false);
      expect(result).toEqual({
        name: 'write_file',
        isFallback: false,
      });
    });

    it('should return fallback when both are empty and stream is complete', () => {
      const result = enhanceToolNameExtraction('', undefined, true);
      expect(result).toEqual({
        name: 'missing_tool_name_check_stream_chunks',
        isFallback: true,
      });
    });

    it('should return empty when both are empty and streaming continues', () => {
      const result = enhanceToolNameExtraction('', undefined, false);
      expect(result).toEqual({
        name: '',
        isFallback: false,
      });
    });
  });

  describe('validateToolName', () => {
    const availableTools = ['read_file', 'write_file', 'search_files'];

    it('should validate exact match', () => {
      const result = validateToolName('read_file', availableTools);
      expect(result).toEqual({
        isValid: true,
        correctedName: 'read_file',
      });
    });

    it('should apply case-insensitive correction', () => {
      const result = validateToolName('READ_FILE', availableTools);
      expect(result).toEqual({
        isValid: true,
        correctedName: 'read_file',
        reason: 'Case-insensitive match applied',
      });
    });

    it('should apply partial match for truncated names', () => {
      const result = validateToolName('read_f', availableTools);
      expect(result).toEqual({
        isValid: true,
        correctedName: 'read_file',
        reason: 'Partial match applied',
      });
    });

    it('should reject invalid tool name', () => {
      const result = validateToolName('invalid_tool', availableTools);
      expect(result).toEqual({
        isValid: false,
        reason: `Tool name 'invalid_tool' not found in available tools: [read_file, write_file, search_files]`,
      });
    });

    it('should reject empty tool name', () => {
      const result = validateToolName('', availableTools);
      expect(result).toEqual({
        isValid: false,
        reason: 'Tool name is empty or missing',
      });
    });
  });

  describe('processFinalToolName', () => {
    const availableTools = ['read_file', 'write_file'];

    it('should return validated name', () => {
      const result = processFinalToolName('read_file', availableTools);
      expect(result).toBe('read_file');
    });

    it('should return corrected name', () => {
      const result = processFinalToolName('READ_FILE', availableTools);
      expect(result).toBe('read_file');
    });

    it('should return descriptive fallback for invalid name', () => {
      const result = processFinalToolName('invalid_tool', availableTools);
      expect(result).toBe('tool_name_not_found_invalid_tool');
    });

    it('should return descriptive fallback for empty name', () => {
      const result = processFinalToolName('', availableTools);
      expect(result).toBe('missing_tool_name');
    });

    it('should sanitize special characters in fallback name', () => {
      const result = processFinalToolName('invalid-tool name', availableTools);
      expect(result).toBe('tool_name_not_found_invalid_tool_name');
    });
  });

  describe('safeExtractToolName', () => {
    const availableTools = ['test_tool'];

    it('should extract name from standard OpenAI format', () => {
      const delta = {
        function: {
          name: 'test_tool',
          arguments: '{}',
        },
      };

      const result = safeExtractToolName(delta, 0, availableTools);
      expect(result).toEqual({
        name: 'test_tool',
        hasName: true,
        isComplete: false,
        warnings: [],
      });
    });

    it('should extract name from alternative format', () => {
      const delta = {
        name: 'test_tool',
      };

      const result = safeExtractToolName(delta, 0, availableTools);
      expect(result).toEqual({
        name: 'test_tool',
        hasName: true,
        isComplete: false,
        warnings: [],
      });
    });

    it('should handle missing name with warnings', () => {
      const delta = {
        function: {
          arguments: '{}',
        },
      };

      const result = safeExtractToolName(delta, 0, availableTools);
      expect(result.name).toBe('');
      expect(result.hasName).toBe(false);
      expect(result.isComplete).toBe(false);
      expect(result.warnings).toEqual([]);
    });

    it('should handle invalid tool name', () => {
      const delta = {
        function: {
          name: 'invalid_tool',
          arguments: '{}',
        },
      };

      const result = safeExtractToolName(delta, 0, availableTools);
      expect(result).toEqual({
        name: 'tool_name_not_found_invalid_tool',
        hasName: true,
        isComplete: false,
        warnings: [
          "Tool name 'invalid_tool' not found in available tools: [test_tool]",
        ],
      });
    });

    it('should handle finish signals', () => {
      const delta = {
        function: {
          name: 'test_tool',
          arguments: '{}',
        },
        finish_reason: 'tool_calls',
      };

      const result = safeExtractToolName(delta, 0, availableTools);
      expect(result.isComplete).toBe(true);
    });

    it('should detect completion when index is provided', () => {
      const delta = {
        function: {
          name: 'test_tool',
          arguments: '{}',
        },
        index: 0,
      };

      const result = safeExtractToolName(delta, 0, availableTools);
      expect(result.isComplete).toBe(true);
    });
  });
});
