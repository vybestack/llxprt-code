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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ToolCallNormalizer,
  NormalizedToolCall,
} from './ToolCallNormalizer.js';

// Mock processToolParameters to simulate different return values
vi.mock('../../tools/doubleEscapeUtils.js', () => ({
  processToolParameters: vi.fn(),
}));

import { processToolParameters } from '../../tools/doubleEscapeUtils.js';

describe('ToolCallNormalizer', () => {
  let normalizer: ToolCallNormalizer;

  beforeEach(() => {
    vi.clearAllMocks();
    normalizer = new ToolCallNormalizer();
  });

  describe('Parameter processing (Problem 2)', () => {
    it('should handle processToolParameters returning object correctly', () => {
      const mockProcessed = { param1: 'value1', param2: 42 };
      vi.mocked(processToolParameters).mockReturnValue(mockProcessed);

      const result = normalizer.normalize({
        index: 0,
        name: 'test_tool',
        args: '{"param1": "value1"}',
        isValid: true,
        validationErrors: [],
      });

      expect(result).not.toBeNull();
      expect(result?.args).toEqual(mockProcessed);
      expect(processToolParameters).toHaveBeenCalledWith(
        '{"param1": "value1"}',
        'unknown_tool',
        'unknown',
      );
    });

    it('should handle processToolParameters returning string correctly (Problem 2)', () => {
      // This is the key test case for Problem 2
      // When processToolParameters returns a string (not an object),
      // it should be wrapped in { value: string } instead of being treated as failure
      const mockProcessed = 'some string result from processToolParameters';
      vi.mocked(processToolParameters).mockReturnValue(mockProcessed);

      const result = normalizer.normalize({
        index: 0,
        name: 'test_tool',
        args: 'invalid json that gets returned as string',
        isValid: true,
        validationErrors: [],
      });

      expect(result).not.toBeNull();
      expect(result?.args).toEqual({ value: mockProcessed });
      expect(processToolParameters).toHaveBeenCalledWith(
        'invalid json that gets returned as string',
        'unknown_tool',
        'unknown',
      );
    });

    it('should handle processToolParameters returning null/undefined', () => {
      vi.mocked(processToolParameters).mockReturnValue(null);

      const result = normalizer.normalize({
        index: 0,
        name: 'test_tool',
        args: 'some args',
        isValid: true,
        validationErrors: [],
      });

      expect(result).not.toBeNull();
      expect(result?.args).toEqual({});
    });

    it('should handle empty args correctly', () => {
      vi.mocked(processToolParameters).mockReturnValue({});

      const result = normalizer.normalize({
        index: 0,
        name: 'test_tool',
        args: '',
        isValid: true,
        validationErrors: [],
      });

      expect(result).not.toBeNull();
      expect(result?.args).toEqual({});
    });

    it('should handle undefined args correctly', () => {
      vi.mocked(processToolParameters).mockReturnValue({});

      const result = normalizer.normalize({
        index: 0,
        name: 'test_tool',
        args: undefined,
        isValid: true,
        validationErrors: [],
      });

      expect(result).not.toBeNull();
      expect(result?.args).toEqual({});
    });

    it('should normalize tool names to lowercase', () => {
      vi.mocked(processToolParameters).mockReturnValue({});

      const result = normalizer.normalize({
        index: 0,
        name: 'TestTool',
        args: '{}',
        isValid: true,
        validationErrors: [],
      });

      expect(result).not.toBeNull();
      expect(result?.name).toBe('testtool');
    });

    it('should reject invalid tool calls', () => {
      const result = normalizer.normalize({
        index: 0,
        name: 'test_tool',
        args: '{}',
        isValid: false,
        validationErrors: ['Invalid tool'],
      });

      expect(result).toBeNull();
    });
  });

  describe('Batch processing', () => {
    it('should filter out null results in batch processing', () => {
      vi.mocked(processToolParameters).mockReturnValue({});

      const validCall = {
        index: 0,
        name: 'valid_tool',
        args: '{}',
        isValid: true,
        validationErrors: [],
      };

      const invalidCall = {
        index: 1,
        name: 'invalid_tool',
        args: '{}',
        isValid: false,
        validationErrors: ['Invalid'],
      };

      const results = normalizer.normalizeBatch([validCall, invalidCall]);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('valid_tool');
    });
  });

  describe('Validation', () => {
    it('should validate normalized calls correctly', () => {
      const validCall: NormalizedToolCall = {
        index: 0,
        name: 'test_tool',
        args: { param: 'value' },
      };

      const invalidCall1: NormalizedToolCall = {
        index: 1,
        name: '',
        args: { param: 'value' },
      };

      const invalidCall2: NormalizedToolCall = {
        index: 2,
        name: 'test_tool',
        args: 'not an object' as unknown as Record<string, unknown>,
      };

      expect(normalizer.validateNormalized(validCall)).toBe(true);
      expect(normalizer.validateNormalized(invalidCall1)).toBe(false);
      expect(normalizer.validateNormalized(invalidCall2)).toBe(false);
    });
  });
});
