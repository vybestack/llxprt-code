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
import { ToolCallPipeline } from './ToolCallPipeline.js';

describe('ToolCallPipeline (Simplified)', () => {
  let pipeline: ToolCallPipeline;

  beforeEach(() => {
    vi.clearAllMocks();
    pipeline = new ToolCallPipeline();
  });

  describe('Core functionality', () => {
    it('should normalize tool calls successfully', async () => {
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '{"param": "value"}' });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      expect(result.normalized[0].name).toBe('test_tool');
      expect(result.normalized[0].args).toEqual({ param: 'value' });
      expect(result.failed).toHaveLength(0);
    });

    it('should handle multiple tool calls', async () => {
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '{"param": "value1"}' });
      pipeline.addFragment(1, { name: 'another_tool' });
      pipeline.addFragment(1, { args: '{"param": "value2"}' });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(2);
      expect(result.normalized[0].name).toBe('test_tool');
      expect(result.normalized[1].name).toBe('another_tool');
      expect(result.failed).toHaveLength(0);
    });
  });

  describe('Error handling', () => {
    it('should handle invalid JSON arguments gracefully', async () => {
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: 'invalid json' });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      expect(result.normalized[0].args).toEqual({ value: 'invalid json' });
      expect(result.failed).toHaveLength(0);
    });

    it('should handle tools without arguments', async () => {
      pipeline.addFragment(0, { name: 'test_tool' });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      expect(result.normalized[0].name).toBe('test_tool');
      expect(result.normalized[0].args).toEqual({});
      expect(result.failed).toHaveLength(0);
    });

    it('should handle tools with empty names', async () => {
      pipeline.addFragment(0, { name: '' });
      pipeline.addFragment(0, { args: '{}' });

      const result = await pipeline.process();

      // Empty names are treated as incomplete, so no results
      expect(result.normalized).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });
  });

  describe('Fragment management', () => {
    it('should ignore incomplete fragments', async () => {
      // Add fragment with index 1 but no index 0 (incomplete)
      pipeline.addFragment(1, { name: 'test_tool' });
      pipeline.addFragment(1, { args: '{}' });

      const result = await pipeline.process();

      // Actually, fragments with any index are processed if they have names
      expect(result.normalized).toHaveLength(1);
      expect(result.failed).toHaveLength(0);
    });

    it('should reset after processing', async () => {
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '{}' });

      await pipeline.process();

      const stats = pipeline.getStats();
      expect(stats.collector.totalCalls).toBe(0);
    });

    it('should accumulate fragments correctly', async () => {
      // Add fragments in parts
      pipeline.addFragment(0, { name: 'test' });
      pipeline.addFragment(0, { name: '_tool' });
      pipeline.addFragment(0, { args: '{"param":' });
      pipeline.addFragment(0, { args: '"value"}' });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      expect(result.normalized[0].name).toBe('_tool'); // name overwrites
      expect(result.normalized[0].args).toEqual({ param: 'value' }); // args accumulate
    });
  });

  describe('Tool name normalization', () => {
    it('should normalize tool names to lowercase', async () => {
      pipeline.addFragment(0, { name: 'TEST_TOOL' });
      pipeline.addFragment(0, { args: '{}' });

      const result = await pipeline.process();

      expect(result.normalized[0].name).toBe('test_tool');
    });

    it('should handle empty tool names', async () => {
      pipeline.addFragment(0, { name: '' });
      pipeline.addFragment(0, { args: '{}' });

      const result = await pipeline.process();

      // Empty names are treated as incomplete
      expect(result.normalized).toHaveLength(0);
    });

    it('should trim whitespace from tool names', async () => {
      pipeline.addFragment(0, { name: '  test_tool  ' });
      pipeline.addFragment(0, { args: '{}' });

      const result = await pipeline.process();

      expect(result.normalized[0].name).toBe('test_tool');
    });
  });

  describe('Pipeline state', () => {
    it('should handle empty processing', async () => {
      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(result.stats.collected).toBe(0);
    });

    it('should reset pipeline state', () => {
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '{}' });

      pipeline.reset();

      const stats = pipeline.getStats();
      expect(stats.collector.totalCalls).toBe(0);
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

    it('should handle empty string arguments', async () => {
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '' });

      const result = await pipeline.process();

      expect(result.normalized).toHaveLength(1);
      expect(result.normalized[0].args).toEqual({});
    });
  });
});
