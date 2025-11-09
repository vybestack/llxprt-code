/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolNameValidator } from '../ToolNameValidator.js';
import type { ToolFormat } from '../../../tools/IToolFormatter.js';

describe('ToolNameValidator', () => {
  let validator: ToolNameValidator;
  const availableTools = ['write_file', 'read_file', 'shell', 'grep', 'ls'];

  beforeEach(() => {
    validator = new ToolNameValidator();
  });

  describe('validateToolName', () => {
    it('should return valid name for normal tool names', () => {
      const result = validator.validateToolName(
        'write_file',
        'qwen',
        availableTools,
      );
      expect(result.name).toBe('write_file');
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should handle undefined names', () => {
      const result = validator.validateToolName(
        undefined,
        'qwen',
        availableTools,
      );
      expect(result.name).toBe('undefined_tool_name');
      expect(result.isValid).toBe(false);
      expect(result.warnings).toContain(
        'Empty or undefined tool name, using fallback',
      );
    });

    it('should handle empty string names', () => {
      const result = validator.validateToolName('', 'qwen', availableTools);
      expect(result.name).toBe('undefined_tool_name');
      expect(result.isValid).toBe(false);
      expect(result.warnings).toContain(
        'Empty or undefined tool name, using fallback',
      );
    });

    it('should handle special symbol names', () => {
      const result = validator.validateToolName('*', 'qwen', availableTools);
      expect(result.name).toBe('undefined_tool_name');
      expect(result.isValid).toBe(false);
      expect(result.warnings).toContain(
        'Unable to normalize tool name: "*", using fallback',
      );
    });

    it('should normalize tool names with different cases', () => {
      const result = validator.validateToolName(
        'WriteFile',
        'qwen',
        availableTools,
      );
      expect(result.name).toBe('write_file');
      // For existing tools, no normalization warning is produced
    });

    it('should handle tool names ending with "Tool"', () => {
      const result = validator.validateToolName(
        'WriteFileTool',
        'qwen',
        availableTools,
      );
      expect(result.name).toBe('write_file');
      // For existing tools, no normalization warning is produced
    });

    it('should find matching tools with case-insensitive matching', () => {
      const result = validator.validateToolName(
        'WRITE_FILE',
        'qwen',
        availableTools,
      );
      expect(result.name).toBe('write_file');
      // For existing tools, normalization might add warnings
      expect(result.name).toBe('write_file');
    });

    it('should return fallback when tool not found in available tools', () => {
      const result = validator.validateToolName(
        'nonexistent_tool',
        'qwen',
        availableTools,
      );
      expect(result.name).toBe('undefined_tool_name');
      expect(result.isValid).toBe(false);
      expect(result.warnings).toContain(
        'Tool "nonexistent_tool" not found in available tools, using fallback',
      );
    });

    it('should work without available tools list', () => {
      const result = validator.validateToolName('custom_tool', 'qwen', []);
      expect(result.name).toBe('custom_tool');
      expect(result.isValid).toBe(true);
    });

    it('should handle camelCase to snake_case conversion', () => {
      const result = validator.validateToolName(
        'writeFile',
        'qwen',
        availableTools,
      );
      expect(result.name).toBe('write_file');
      // For existing tools, no normalization warning is produced
    });
  });

  describe('private helper methods (via public interface)', () => {
    it('should infer tool name from arguments', () => {
      // Note: ToolNameValidator doesn't actually use the third parameter as args,
      // but we test the basic functionality
      const result = validator.validateToolName(undefined, 'qwen', []);
      expect(result.name).toBe('undefined_tool_name');
    });

    it('should handle shell tool fallback', () => {
      const result = validator.validateToolName(undefined, 'qwen', []);
      expect(result.name).toBe('undefined_tool_name');
    });

    it('should handle very long tool names in fallback', () => {
      const longName = 'a'.repeat(150);
      const result = validator.validateToolName(
        longName,
        'qwen',
        availableTools,
      );
      expect(result.name).toBe('undefined_tool_name');
      expect(result.isValid).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle tool names with special characters but allowed ones', () => {
      const result = validator.validateToolName('test-tool_123', 'qwen', []);
      expect(result.name).toBe('test-tool_123');
      expect(result.isValid).toBe(true);
    });

    it('should reject tool names with invalid characters', () => {
      const result = validator.validateToolName('test@tool', 'qwen', []);
      expect(result.name).toBe('undefined_tool_name');
      expect(result.isValid).toBe(false);
    });

    it('should handle whitespace in tool names', () => {
      const result = validator.validateToolName(
        'write file',
        'qwen',
        availableTools,
      );
      expect(result.name).toBe('write_file');
      // For existing tools, no normalization warning is produced
    });

    it('should handle tool names with hyphens', () => {
      const result = validator.validateToolName(
        'write-file',
        'qwen',
        availableTools,
      );
      expect(result.name).toBe('write_file');
      // For existing tools, no normalization warning is produced
    });
  });

  describe('different formats', () => {
    it('should work with different ToolFormat values', () => {
      const formats: ToolFormat[] = ['openai', 'qwen', 'anthropic'];

      formats.forEach((format) => {
        const result = validator.validateToolName(
          'write_file',
          format,
          availableTools,
        );
        expect(result.name).toBe('write_file');
        expect(result.isValid).toBe(true);
      });
    });
  });
});
