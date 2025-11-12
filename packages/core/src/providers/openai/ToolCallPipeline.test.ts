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

describe('ToolCallPipeline', () => {
  let pipeline: ToolCallPipeline;

  beforeEach(() => {
    vi.clearAllMocks();
    pipeline = new ToolCallPipeline(['test_tool', 'another_tool']);
  });

  describe('Core functionality', () => {
    it('should execute registered tools successfully', async () => {
      const mockTool = vi.fn().mockResolvedValue('success');
      pipeline.registerTool('test_tool', mockTool);

      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '{"param": "value"}' });

      const result = await pipeline.process();

      expect(result.executed).toHaveLength(1);
      expect(result.executed[0].success).toBe(true);
      expect(result.executed[0].result).toBe('success');
      expect(result.failed).toHaveLength(0);
    });

    it('should reject unregistered tools', async () => {
      pipeline.addFragment(0, { name: 'unknown_tool' });
      pipeline.addFragment(0, { args: '{}' });

      const result = await pipeline.process();

      expect(result.executed).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].isValid).toBe(false);
    });

    it('should handle multiple tool calls', async () => {
      const mockTool1 = vi.fn().mockResolvedValue('result1');
      const mockTool2 = vi.fn().mockResolvedValue('result2');

      pipeline.registerTools({
        test_tool: mockTool1,
        another_tool: mockTool2,
      });

      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '{}' });
      pipeline.addFragment(1, { name: 'another_tool' });
      pipeline.addFragment(1, { args: '{}' });

      const result = await pipeline.process();

      expect(result.executed).toHaveLength(2);
      expect(result.executed.every((r) => r.success)).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle tool execution failures', async () => {
      const failingTool = vi.fn().mockRejectedValue(new Error('Tool failed'));
      pipeline.registerTool('test_tool', failingTool);

      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '{}' });

      const result = await pipeline.process();

      expect(result.executed).toHaveLength(1);
      expect(result.executed[0].success).toBe(false);
      expect(result.executed[0].error).toBe('Tool failed');
    });

    it('should handle invalid JSON arguments gracefully', async () => {
      // When processToolParameters returns a string (fallback for invalid JSON),
      // it should be wrapped as { value: string } and the tool should still execute
      const mockTool = vi.fn().mockResolvedValue('success');
      pipeline.registerTool('test_tool', mockTool);

      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: 'invalid json' });

      const result = await pipeline.process();

      expect(result.executed).toHaveLength(1);
      expect(result.executed[0].success).toBe(true);
      // Tool should receive the wrapped arguments
      expect(mockTool).toHaveBeenCalledWith({ value: 'invalid json' });
      expect(result.failed).toHaveLength(0);
    });

    it('should handle tools without arguments', async () => {
      const mockTool = vi.fn().mockResolvedValue('no args result');
      pipeline.registerTool('test_tool', mockTool);

      pipeline.addFragment(0, { name: 'test_tool' });

      const result = await pipeline.process();

      expect(result.executed).toHaveLength(1);
      expect(result.executed[0].success).toBe(true);
    });
  });

  describe('Fragment management', () => {
    it('should ignore incomplete fragments', async () => {
      pipeline.addFragment(0, { args: '{"param": "value"}' }); // missing name

      const result = await pipeline.process();

      expect(result.executed).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });

    it('should reset after processing', async () => {
      pipeline.registerTool('test_tool', vi.fn().mockResolvedValue('success'));
      pipeline.addFragment(0, { name: 'test_tool' });

      await pipeline.process();

      const stats = pipeline.getStats();
      expect(stats.collector.totalCalls).toBe(0);
    });
  });

  describe('Tool registration', () => {
    it('should allow dynamic tool registration', async () => {
      const newTool = vi.fn().mockResolvedValue('new result');
      pipeline.registerTool('new_tool', newTool);

      pipeline.addFragment(0, { name: 'new_tool' });

      const result = await pipeline.process();

      expect(result.executed).toHaveLength(1);
      expect(result.executed[0].success).toBe(true);
    });

    it('should check tool registration status', () => {
      pipeline.registerTool('existing_tool', vi.fn());

      expect(pipeline.isToolRegistered('existing_tool')).toBe(true);
      expect(pipeline.isToolRegistered('missing_tool')).toBe(false);
    });
  });

  describe('Tool name normalization', () => {
    it('should normalize tool names to lowercase', () => {
      const normalizedName = pipeline.normalizeToolName('TestTool', '{}');
      expect(normalizedName).toBe('testtool');
    });

    it('should handle empty tool names', () => {
      const normalizedName = pipeline.normalizeToolName('', '');
      expect(normalizedName).toBe('');
    });
  });

  describe('Pipeline state', () => {
    it('should handle empty processing', async () => {
      const result = await pipeline.process();

      expect(result.executed).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(result.normalized).toHaveLength(0);
    });

    it('should reset pipeline state', () => {
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.reset();

      const stats = pipeline.getStats();
      expect(stats.collector.totalCalls).toBe(0);
    });
  });
});
