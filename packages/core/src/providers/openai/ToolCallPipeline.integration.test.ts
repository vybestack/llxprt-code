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

// Mock processToolParameters to simulate different scenarios
vi.mock('../../tools/doubleEscapeUtils.js', () => ({
  processToolParameters: vi.fn(),
}));

import { processToolParameters } from '../../tools/doubleEscapeUtils.js';

describe('ToolCallPipeline Integration Tests', () => {
  let pipeline: ToolCallPipeline;

  beforeEach(() => {
    vi.clearAllMocks();
    pipeline = new ToolCallPipeline(['test_tool', 'another_tool']);
  });

  describe('Streaming tool call simulation', () => {
    it('should handle fragmented JSON arguments correctly (Problem 1 fix)', async () => {
      // Mock processToolParameters to return parsed object
      const mockParsedArgs = { param1: 'value1', param2: 'value2' };
      vi.mocked(processToolParameters).mockReturnValue(mockParsedArgs);

      // Register a mock tool
      const mockTool = vi.fn().mockResolvedValue('success');
      pipeline.registerTool('test_tool', mockTool);

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

      // Verify the tool was executed successfully
      expect(result.executed).toHaveLength(1);
      expect(result.executed[0].success).toBe(true);
      expect(result.executed[0].result).toBe('success');

      // Verify processToolParameters was called with the accumulated args
      expect(processToolParameters).toHaveBeenCalledWith(
        '{"param1": "value1", "param2": "value2"}',
        'unknown_tool',
        'unknown',
      );

      // Verify the tool received the correct arguments
      expect(mockTool).toHaveBeenCalledWith(mockParsedArgs);
    });

    it('should handle processToolParameters returning string (Problem 2 fix)', async () => {
      // This simulates the case where processToolParameters returns a string
      // instead of an object (e.g., when JSON parsing fails)
      const stringResult = 'fallback string result';
      vi.mocked(processToolParameters).mockReturnValue(stringResult);

      const mockTool = vi.fn().mockResolvedValue('tool executed');
      pipeline.registerTool('test_tool', mockTool);

      // Add fragments
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: 'invalid json' });

      const result = await pipeline.process();

      // Should still execute successfully, with args wrapped as { value: string }
      expect(result.executed).toHaveLength(1);
      expect(result.executed[0].success).toBe(true);

      // Verify the tool received the wrapped arguments
      expect(mockTool).toHaveBeenCalledWith({ value: stringResult });
    });

    it('should handle multiple concurrent tool calls', async () => {
      vi.mocked(processToolParameters).mockReturnValue({});

      const mockTool1 = vi.fn().mockResolvedValue('result1');
      const mockTool2 = vi.fn().mockResolvedValue('result2');

      pipeline.registerTools({
        test_tool: mockTool1,
        another_tool: mockTool2,
      });

      // Tool call 1: fragmented args
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '{"param": ' });
      pipeline.addFragment(0, { args: '"value"}' });

      // Tool call 2: simple args
      pipeline.addFragment(1, { name: 'another_tool' });
      pipeline.addFragment(1, { args: '{}' });

      const result = await pipeline.process();

      expect(result.executed).toHaveLength(2);
      expect(result.executed.every((r) => r.success)).toBe(true);

      expect(mockTool1).toHaveBeenCalledWith({});
      expect(mockTool2).toHaveBeenCalledWith({});
    });

    it('should handle malformed arguments gracefully', async () => {
      // Simulate processToolParameters returning malformed data
      vi.mocked(processToolParameters).mockReturnValue(null);

      const mockTool = vi.fn().mockResolvedValue('executed');
      pipeline.registerTool('test_tool', mockTool);

      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: 'malformed' });

      const result = await pipeline.process();

      // Should still execute with empty args
      expect(result.executed).toHaveLength(1);
      expect(mockTool).toHaveBeenCalledWith({});
    });

    it('should reject invalid tool names', async () => {
      vi.mocked(processToolParameters).mockReturnValue({});

      pipeline.addFragment(0, { name: 'invalid_tool' });
      pipeline.addFragment(0, { args: '{}' });

      const result = await pipeline.process();

      expect(result.executed).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].validationErrors).toContain(
        "Tool name 'invalid_tool' is not in allowed list",
      );
    });

    it('should handle tool execution failures', async () => {
      vi.mocked(processToolParameters).mockReturnValue({});

      const failingTool = vi.fn().mockRejectedValue(new Error('Tool crashed'));
      pipeline.registerTool('test_tool', failingTool);

      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '{}' });

      const result = await pipeline.process();

      expect(result.executed).toHaveLength(1);
      expect(result.executed[0].success).toBe(false);
      expect(result.executed[0].error).toBe('Tool crashed');
    });
  });

  describe('Pipeline reset behavior', () => {
    it('should reset collector after processing', async () => {
      vi.mocked(processToolParameters).mockReturnValue({});

      const mockTool = vi.fn().mockResolvedValue('success');
      pipeline.registerTool('test_tool', mockTool);

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
      expect(result2.executed).toHaveLength(1);
    });
  });

  describe('Qwen-specific scenarios', () => {
    it('should handle Qwen double-escaped JSON fragments', async () => {
      // Simulate Qwen's double-escaped JSON that processToolParameters should fix
      const correctedJson = { param: 'value' };

      vi.mocked(processToolParameters).mockReturnValue(correctedJson);

      const mockTool = vi.fn().mockResolvedValue('qwen success');
      pipeline.registerTool('test_tool', mockTool);

      // Simulate fragmented double-escaped content
      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: '{"param": ' });
      pipeline.addFragment(0, { args: '\\"value\\"}' }); // Fragmented escaping

      const result = await pipeline.process();

      expect(result.executed).toHaveLength(1);
      expect(mockTool).toHaveBeenCalledWith(correctedJson);
    });

    it('should handle Qwen fallback to string when JSON is malformed', async () => {
      // When processToolParameters can't fix the JSON, it returns a string
      const fallbackString = 'unparseable content';
      vi.mocked(processToolParameters).mockReturnValue(fallbackString);

      const mockTool = vi.fn().mockResolvedValue('fallback executed');
      pipeline.registerTool('test_tool', mockTool);

      pipeline.addFragment(0, { name: 'test_tool' });
      pipeline.addFragment(0, { args: 'completely malformed {{{' });

      const result = await pipeline.process();

      expect(result.executed).toHaveLength(1);
      expect(mockTool).toHaveBeenCalledWith({ value: fallbackString });
    });
  });
});
