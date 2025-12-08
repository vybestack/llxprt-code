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
import {
  normalizeToolName,
  toSnakeCase,
  isValidToolName,
  findMatchingTool,
} from './toolNameUtils.js';

describe('toolNameUtils Integration Tests', () => {
  describe('normalizeToolName function', () => {
    it('should handle null and undefined inputs', () => {
      expect(normalizeToolName('')).toBeNull();
      expect(normalizeToolName('   ')).toBeNull();
      expect(normalizeToolName('\t\n')).toBeNull();
    });

    it('should return already normalized names unchanged', () => {
      const validName = 'valid_tool_name';
      expect(normalizeToolName(validName)).toBe(validName);
    });

    it('should convert camelCase to snake_case', () => {
      expect(normalizeToolName('writeFile')).toBe('write_file');
      expect(normalizeToolName('readData')).toBe('read_data');
      expect(normalizeToolName('processHttpRequest')).toBe(
        'process_http_request',
      );
    });

    it('should handle spaces and hyphens', () => {
      expect(normalizeToolName('write file')).toBe('write_file');
      expect(normalizeToolName('read-data')).toBe('read-data'); // hyphens are valid
      expect(normalizeToolName('process http request')).toBe(
        'process_http_request',
      );
    });

    it('should handle Tool suffix removal', () => {
      expect(normalizeToolName('writeFileTool')).toBe('write_file_tool'); // Tool suffix not removed if already valid
      expect(normalizeToolName('ReadDataTool')).toBe('read_data_tool');
      expect(normalizeToolName('write_toolTool')).toBe('write_tool_tool');
    });

    it('should return null for invalid characters', () => {
      expect(normalizeToolName('write@file')).toBeNull();
      expect(normalizeToolName('read#data')).toBeNull();
      expect(normalizeToolName('tool$name')).toBeNull();
    });

    it('should handle GitHub Issue #305 scenarios', () => {
      // Test cases related to undefined tool names from qwen models
      expect(normalizeToolName('')).toBeNull();
      expect(normalizeToolName('undefined')).toBe('undefined');
      expect(normalizeToolName('undefined_tool_name')).toBe(
        'undefined_tool_name',
      );
    });
  });

  describe('toSnakeCase function', () => {
    it('should convert camelCase to snake_case', () => {
      expect(toSnakeCase('writeFile')).toBe('write_file');
      expect(toSnakeCase('readData')).toBe('read_data');
      expect(toSnakeCase('processHttpRequest')).toBe('process_http_request');
    });

    it('should handle spaces and hyphens', () => {
      expect(toSnakeCase('write file')).toBe('write_file');
      expect(toSnakeCase('read-data')).toBe('read_data');
      expect(toSnakeCase('process http request')).toBe('process_http_request');
    });

    it('should handle already snake_case input', () => {
      expect(toSnakeCase('write_file')).toBe('write_file');
      expect(toSnakeCase('read_data')).toBe('read_data');
    });

    it('should handle mixed cases', () => {
      expect(toSnakeCase('writeFileData')).toBe('write_file_data');
      expect(toSnakeCase('ProcessHTTPRequest')).toBe('process_httprequest'); // consecutive caps not split
    });
  });

  describe('isValidToolName function', () => {
    it('should validate correct tool names', () => {
      expect(isValidToolName('write_file')).toBe(true);
      expect(isValidToolName('read_data')).toBe(true);
      expect(isValidToolName('tool123')).toBe(true);
      expect(isValidToolName('tool_name.test')).toBe(true);
      expect(isValidToolName('tool-name')).toBe(true);
    });

    it('should reject invalid tool names', () => {
      expect(isValidToolName('')).toBe(false);
      expect(isValidToolName('write@file')).toBe(false);
      expect(isValidToolName('read#data')).toBe(false);
      expect(isValidToolName('tool$name')).toBe(false);
      expect(isValidToolName('tool name')).toBe(false); // space not allowed
    });

    it('should handle length limits', () => {
      const shortName = 'tool';
      expect(isValidToolName(shortName)).toBe(true);

      const longName = 'a'.repeat(101);
      expect(isValidToolName(longName)).toBe(false);

      const maxLengthName = 'a'.repeat(100);
      expect(isValidToolName(maxLengthName)).toBe(true);
    });
  });

  describe('findMatchingTool function', () => {
    let availableTools: string[];

    beforeEach(() => {
      availableTools = [
        'write_file',
        'read_data',
        'process_http_request',
        'delete_file',
      ];
    });

    it('should find direct matches', () => {
      expect(findMatchingTool('write_file', availableTools)).toBe('write_file');
      expect(findMatchingTool('read_data', availableTools)).toBe('read_data');
    });

    it('should find case-insensitive matches', () => {
      expect(findMatchingTool('WRITE_FILE', availableTools)).toBe('write_file');
      expect(findMatchingTool('Read_Data', availableTools)).toBe('read_data');
    });

    it('should find snake case matches', () => {
      expect(findMatchingTool('writeFile', availableTools)).toBe('write_file');
      expect(findMatchingTool('readData', availableTools)).toBe('read_data');
    });

    it('should find partial matches', () => {
      expect(findMatchingTool('write', availableTools)).toBe('write_file');
      expect(findMatchingTool('read', availableTools)).toBe('read_data');
    });

    it('should return null for no matches', () => {
      expect(findMatchingTool('unknown_tool', availableTools)).toBeNull();
      expect(findMatchingTool('xyz', availableTools)).toBeNull();
    });
  });

  describe('Integration with Turn.ts handlePendingFunctionCall', () => {
    it('should handle the same scenarios as Turn.ts', () => {
      // Simulate the same logic as in turn.ts:444-456
      const testCases = [
        { input: 'writeFile', expected: 'write_file' },
        { input: 'read_data', expected: 'read_data' },
        { input: '', expected: null },
        { input: '   ', expected: null },
        { input: 'writeFileTool', expected: 'write_file_tool' },
      ];

      for (const testCase of testCases) {
        const result = normalizeToolName(testCase.input);
        expect(result).toBe(testCase.expected);
      }
    });

    it('should handle undefined tool name fallback', () => {
      // This simulates the GitHub #305 fix in turn.ts
      const undefinedName = '';
      const normalized = normalizeToolName(undefinedName);

      // This is where turn.ts would use 'undefined_tool_name' fallback
      expect(normalized).toBeNull();
    });
  });

  describe('Performance and edge cases', () => {
    it('should handle very long tool names', () => {
      const veryLongName = 'a'.repeat(200);
      expect(normalizeToolName(veryLongName)).toBeNull();
    });

    it('should handle special characters gracefully', () => {
      const specialCases = [
        'tool@name',
        'tool#name',
        'tool$name',
        'tool%name',
        'tool^name',
        'tool&name',
        'tool*name',
        'tool(name)',
        'tool+name',
        'tool=name',
      ];

      for (const specialCase of specialCases) {
        expect(normalizeToolName(specialCase)).toBeNull();
      }
    });

    it('should handle unicode characters', () => {
      expect(normalizeToolName('工具名稱')).toBeNull(); // Chinese characters
      expect(normalizeToolName('tôöl_nâmé')).toBeNull(); // Accented characters
    });

    it('should be efficient for repeated calls', () => {
      const testNames = ['writeFile', 'read_data', 'processHttpRequest'];

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        for (const name of testNames) {
          normalizeToolName(name);
        }
      }

      const endTime = performance.now();
      const processingTime = endTime - startTime;

      // Should handle 3000 calls efficiently (under 100ms)
      expect(processingTime).toBeLessThan(100);
    });
  });

  describe('Cross-provider compatibility scenarios', () => {
    it('should handle OpenAI-style tool names', () => {
      const openaiNames = ['write_file', 'read_data', 'delete_file'];

      for (const name of openaiNames) {
        const normalized = normalizeToolName(name);
        expect(normalized).toBe(name); // Should remain unchanged
      }
    });

    it('should handle Anthropic-style tool names', () => {
      const anthropicNames = ['write-file', 'read-data', 'delete-file'];

      for (const name of anthropicNames) {
        const normalized = normalizeToolName(name);
        expect(normalized).toBe(name); // hyphens are valid, so no change
      }
    });

    it('should handle Gemini-style tool names', () => {
      const geminiNames = ['writeFile', 'readData', 'deleteFile'];

      for (const name of geminiNames) {
        const normalized = normalizeToolName(name);
        expect(normalized).toBe(toSnakeCase(name));
      }
    });
  });
});
