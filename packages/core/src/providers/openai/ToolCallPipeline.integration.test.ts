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

/**
 * ToolCallPipeline Integration Tests - Adapted for new architecture
 *
 * This test file preserves the valuable test scenarios from the original
 * integration test but adapts them to the new simplified pipeline architecture.
 *
 * Key changes from original:
 * - Removed tool execution testing (now handled by Core layer)
 * - Focus on pipeline collection and normalization
 * - Test real processToolParameters behavior (not mocked)
 * - Verify pipeline output format matches Core layer expectations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolCallPipeline } from './ToolCallPipeline.js';

describe('ToolCallPipeline Integration Tests (New Architecture)', () => {
  let pipeline: ToolCallPipeline;

  beforeEach(() => {
    pipeline = new ToolCallPipeline();
  });

  describe('Streaming tool call simulation', () => {
    it('should handle fragmented JSON arguments correctly (Problem 1 fix)', async () => {
      // Simulate streaming fragments (like Qwen model produces)
      // Fragment 1: tool name
      pipeline.addFragment(0, { name: 'test_tool' });

      // Fragment 2-5: JSON arguments split across multiple chunks
      pipeline.addFragment(0, { args: '{"param1": ' });
      pipeline.addFragment(0, { args: '"value1", ' });
      pipeline.addFragment(0, { args: '"param2": ' });
      pipeline.addFragment(0, { args: '"value2"}' });

      // Process the pipeline
      const result = await pipeline.process();

      // Verify the tool was normalized successfully
      expect(result.normalized).toHaveLength(1);
      expect(result.failed).toHaveLength(0);

      const normalizedCall = result.normalized[0];
      expect(normalizedCall.name).toBe('test_tool');
      expect(normalizedCall.args).toEqual({
        param1: 'value1',
        param2: 'value2',
      });
      expect(normalizedCall.originalArgs).toBe(
        '{"param1": "value1", "param2": "value2"}',
      );
    });

    it('should handle processToolParameters returning string (Problem 2 fix)', async () => {
      // Add fragments with invalid JSON that will be wrapped as string
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: 'invalid json' });

      const result = await pipeline.process();

      // Should still normalize successfully, with args wrapped as { value: string }
      expect(result.normalized).toHaveLength(1);
      expect(result.failed).toHaveLength(0);

      const normalizedCall = result.normalized[0];
      expect(normalizedCall.name).toBe('test_tool');
      expect(normalizedCall.args).toEqual({ value: 'invalid json' });
      expect(normalizedCall.originalArgs).toBe('invalid json');
    });

    it('should handle multiple concurrent tool calls', async () => {
      // Tool call 1: fragmented args
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '{"param": ' });
      pipeline.addFragment(0, { args: '"value"}' });

      // Tool call 2: simple args
      pipeline.addFragment(1, { name: 'another_tool' });
      pipeline.addFragment(1, { args: '{}' });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(2);
      expect(result.failed).toHaveLength(0);

      const call1 = result.normalized.find((c) => c.index === 0);
      const call2 = result.normalized.find((c) => c.index === 1);

      expect(call1?.name).toBe('test_tool');
      expect(call1?.args).toEqual({ param: 'value' });

      expect(call2?.name).toBe('another_tool');
      expect(call2?.args).toEqual({});
    });

    it('should handle malformed arguments gracefully', async () => {
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: 'malformed' });

      const result = await pipeline.process();

      // Should still normalize with args wrapped as { value: string }
      expect(result.normalized).toHaveLength(1);
      expect(result.failed).toHaveLength(0);

      const normalizedCall = result.normalized[0];
      expect(normalizedCall.args).toEqual({ value: 'malformed' });
    });

    it('should handle tools with empty names', async () => {
      pipeline.addFragment(0, { name: '' });
      pipeline.addFragment(0, { args: '{}' });

      const result = await pipeline.process();

      // Empty names should be filtered out
      expect(result.normalized).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });

    it('should handle tools without arguments', async () => {
      pipeline.addFragment(0, { name: 'test_tool' });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      expect(result.failed).toHaveLength(0);

      const normalizedCall = result.normalized[0];
      expect(normalizedCall.name).toBe('test_tool');
      expect(normalizedCall.args).toEqual({});
      expect(normalizedCall.originalArgs).toBe('');
    });
  });

  describe('Pipeline reset behavior', () => {
    it('should reset collector after processing', async () => {
      // First batch
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '{}' });

      await pipeline.process();

      // Check stats are reset
      const stats = pipeline.getStats();
      expect(stats.collector.totalCalls).toBe(0);

      // Second batch should work independently
      pipeline.addFragment(1, { name: 'test_tool' });
      pipeline.addFragment(1, { args: '{}' });

      const result2 = await pipeline.process();
      expect(result2.normalized).toHaveLength(1);
    });

    it('should handle empty processing', async () => {
      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(result.stats.collected).toBe(0);
    });
  });

  describe('Qwen-specific scenarios', () => {
    it('should handle Qwen double-escaped JSON fragments', async () => {
      // Simulate fragmented double-escaped content that processToolParameters should fix
      // This represents the case where Qwen model outputs a JSON string that gets double-escaped
      // Original: {"param":"value"} becomes: "{\"param\":\"value\"}"
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '"{\\"param\\":\\"value\\"}"' }); // Double-escaped JSON

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      expect(result.failed).toHaveLength(0);

      const normalizedCall = result.normalized[0];
      expect(normalizedCall.name).toBe('test_tool');
      // processToolParameters should handle the double-escaping
      expect(normalizedCall.originalArgs).toBe('"{\\"param\\":\\"value\\"}"');
      // The processed args should be the parsed object with double-escaping fixed
      expect(normalizedCall.args).toEqual({ param: 'value' });
    });

    it('should handle Qwen fallback to string when JSON is malformed', async () => {
      // When processToolParameters can't fix the JSON, it returns a string
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: 'completely malformed {{{' });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      expect(result.failed).toHaveLength(0);

      const normalizedCall = result.normalized[0];
      expect(normalizedCall.args).toEqual({
        value: 'completely malformed {{{',
      });
    });

    it('should handle tool name normalization', async () => {
      pipeline.addFragment(0, { name: 'TEST_TOOL' });
      pipeline.addFragment(0, { args: '{}' });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      expect(result.normalized[0].name).toBe('test_tool'); // Should be lowercase
    });

    it('should handle tool name with whitespace', async () => {
      pipeline.addFragment(0, { name: '  test_tool  ' });
      pipeline.addFragment(0, { args: '{}' });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      expect(result.normalized[0].name).toBe('test_tool'); // Should be trimmed
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle null arguments', async () => {
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '' });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      expect(result.normalized[0].args).toEqual({});
    });

    it('should handle undefined arguments', async () => {
      pipeline.addFragment(0, { name: 'test_tool' });
      // Don't add args fragment

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      expect(result.normalized[0].args).toEqual({});
    });

    it('should provide accurate statistics', async () => {
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '{}' });
      pipeline.addFragment(1, { name: 'another_tool' });
      pipeline.addFragment(1, { args: 'invalid' });

      const result = await pipeline.process();

      expect(result.stats.collected).toBe(2);
      expect(result.stats.normalized).toBe(2);
      expect(result.stats.failed).toBe(0);
    });
  });

  describe('Normalization edge cases', () => {
    it('should handle complex nested JSON', async () => {
      const complexJson = {
        nested: {
          array: [1, 2, 3],
          object: { key: 'value' },
        },
        simple: 'string',
      };

      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: JSON.stringify(complexJson) });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      expect(result.normalized[0].args).toEqual(complexJson);
    });

    it('should handle special characters in arguments', async () => {
      // This test verifies comprehensive internationalization support for tool parameters
      // Including multiple languages, scripts, emojis, and special characters
      //
      // Why this is important:
      // - Users may interact with AI in their native language worldwide
      // - Models may generate tool calls with diverse character sets
      // - System must properly handle UTF-8 encoding and Unicode characters
      // - Ensures no data corruption during pipeline processing across all languages
      // - Validates support for right-to-left languages and complex scripts
      //
      // Test case includes comprehensive character coverage:
      // - English: "Hello"
      // - Chinese (Simplified): "世界" (world)
      // - Japanese: "こんにちは" (hello)
      // - Korean: "안녕하세요" (hello)
      // - Arabic: "مرحبا" (hello) - tests right-to-left script
      // - Hebrew: "שלום" (hello) - tests right-to-left script
      // - Russian: "Привет" (hello) - tests Cyrillic script
      // - Hindi: "नमस्ते" (hello) - tests Devanagari script
      // - Emoji: "🌍🚀💻" (Earth, rocket, computer)
      // - Mathematical symbols: "∑∏∫"
      // - Currency symbols: "$€¥£"
      const internationalText = `Hello 世界 こんにちは 안녕하세요 مرحبا שלום Привет नमस्ते 🌍🚀💻 ∑∏∫ $€¥£`;
      const specialChars = `{"message": "${internationalText}", "greeting": "Bonjour le monde! 🌟"}`;

      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: specialChars });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      // Verify that all international characters are preserved exactly as input
      // This tests comprehensive UTF-8 encoding/decoding through the entire pipeline
      expect(result.normalized[0].args).toEqual({
        message: internationalText,
        greeting: 'Bonjour le monde! 🌟',
      });
    });
  });
});
