/**
 * Test for Issue #981: Pipeline mode tool_call_id preservation
 *
 * This test verifies that pipeline mode preserves OpenAI tool_call IDs
 * from streaming deltas, which is critical for tool response matching.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolCallPipeline } from './ToolCallPipeline.js';
import { ToolCallCollector } from './ToolCallCollector.js';
import { ToolCallNormalizer } from './ToolCallNormalizer.js';

describe('Issue #981: Pipeline mode tool_call_id preservation', () => {
  let pipeline: ToolCallPipeline;
  let collector: ToolCallCollector;
  let normalizer: ToolCallNormalizer;

  beforeEach(() => {
    pipeline = new ToolCallPipeline();
    collector = new ToolCallCollector();
    normalizer = new ToolCallNormalizer();
  });

  describe('ToolCallFragment should include ID field', () => {
    it('should support fragment with tool_call_id', () => {
      // This test verifies that ToolCallFragment now supports the 'id' field

      // Simulate a streaming chunk with tool_call_id
      // This is what OpenAI API returns:
      // { delta: { tool_calls: [{ id: "call_abc123", index: 0, function: {...} }] } }

      const fragment = {
        index: 0,
        id: 'call_abc123',
        name: 'test_tool',
        timestamp: Date.now(),
      };

      // This should now work with the 'id' field added to ToolCallFragment
      collector.addFragment(0, fragment);
      const candidates = collector.getCompleteCalls();
      expect(candidates).toHaveLength(1);
      expect(candidates[0].id).toBe('call_abc123');
    });
  });

  describe('NormalizedToolCall should include ID field', () => {
    it('should preserve tool_call_id through normalization', () => {
      // This test verifies that NormalizedToolCall now supports the 'id' field

      const validatedCall = {
        index: 0,
        name: 'test_tool',
        args: '{}',
        isValid: true,
        validationErrors: [],
        id: 'call_abc123', // This should be preserved
      };

      const normalized = normalizer.normalize(validatedCall);
      expect(normalized?.id).toBe('call_abc123');
    });
  });

  describe('Pipeline should preserve tool_call IDs', () => {
    it('should preserve tool_call_id from fragments to normalized output', async () => {
      // Simulate the real-world scenario from OpenAI streaming API

      // Fragment 1: tool name and ID (first chunk)
      pipeline.addFragment(0, {
        index: 0,
        id: 'call_abc123', // OpenAI provides this ID
        name: 'test_tool',
      });

      // Fragment 2-4: JSON arguments split across chunks (like Qwen models do)
      pipeline.addFragment(0, {
        index: 0,
        args: '{"param1": ',
      });
      pipeline.addFragment(0, {
        index: 0,
        args: '"value1", ',
      });
      pipeline.addFragment(0, {
        index: 0,
        args: '"param2": "value2"}',
      });

      // Process through the pipeline
      const pipelineResult = await pipeline.process();

      // The normalized call should preserve the original tool_call_id
      expect(pipelineResult.normalized).toHaveLength(1);
      expect(pipelineResult.normalized[0].id).toBe('call_abc123');
      expect(pipelineResult.normalized[0].name).toBe('test_tool');
      expect(pipelineResult.normalized[0].args).toEqual({
        param1: 'value1',
        param2: 'value2',
      });
    });

    it('should preserve different IDs for multiple tool calls', async () => {
      // Simulate two concurrent tool calls with different IDs

      // Tool call 0
      pipeline.addFragment(0, {
        index: 0,
        id: 'call_abc123',
        name: 'tool_one',
      });
      pipeline.addFragment(0, {
        index: 0,
        args: '{}',
      });

      // Tool call 1
      pipeline.addFragment(1, {
        index: 1,
        id: 'call_def456',
        name: 'tool_two',
      });
      pipeline.addFragment(1, {
        index: 1,
        args: '{}',
      });

      const pipelineResult = await pipeline.process();

      // Both tool calls should preserve their unique IDs
      expect(pipelineResult.normalized).toHaveLength(2);

      const call0 = pipelineResult.normalized.find((c) => c.index === 0);
      const call1 = pipelineResult.normalized.find((c) => c.index === 1);

      expect(call0?.id).toBe('call_abc123');
      expect(call1?.id).toBe('call_def456');
    });
  });

  describe('Qwen/OpenAI-specific scenarios', () => {
    it('should handle Qwen-style tool_call IDs', async () => {
      // Qwen models use standard OpenAI-style tool_call IDs

      pipeline.addFragment(0, {
        index: 0,
        id: 'call_qwen_example_123',
        name: 'search_file_content',
        args: '{"query": "test"}',
      });

      const pipelineResult = await pipeline.process();

      expect(pipelineResult.normalized).toHaveLength(1);
      expect(pipelineResult.normalized[0].id).toBe('call_qwen_example_123');
    });

    it('should handle tool_call IDs with various formats', async () => {
      // OpenAI IDs can vary in format
      const testIds = [
        'call_abc123',
        'call_123abc',
        'call_JaK3s7',
        'call_9f8d7c6b5a4',
      ];

      for (const testId of testIds) {
        pipeline.addFragment(0, {
          index: 0,
          id: testId,
          name: 'test_tool',
          args: '{}',
        });

        const pipelineResult = await pipeline.process();

        expect(pipelineResult.normalized).toHaveLength(1);
        expect(pipelineResult.normalized[0].id).toBe(testId);
      }
    });
  });

  describe('Backward compatibility', () => {
    it('should handle fragments without IDs gracefully', async () => {
      // Old code or certain providers might not provide IDs
      // The fix should be backward compatible

      pipeline.addFragment(0, {
        index: 0,
        // No 'id' field
        name: 'test_tool',
        args: '{}',
      });

      const pipelineResult = await pipeline.process();

      // Should still normalize successfully, just without an ID
      expect(pipelineResult.normalized).toHaveLength(1);
      expect(pipelineResult.normalized[0].name).toBe('test_tool');
      // ID should be undefined when no ID was provided
      expect(pipelineResult.normalized[0].id).toBeUndefined();
    });
  });

  describe('Full flow simulation', () => {
    it('should simulate the complete pipeline flow with tool_call_id preservation', async () => {
      // This simulates the actual flow in OpenAIProvider.generatePipelineChatCompletionImpl

      // 1. OpenAI API returns streaming chunks with tool_call IDs
      const deltaChunk1 = {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_real_id_123',
              function: { name: 'run_shell_command', arguments: '' },
            },
          ],
        },
      };

      const deltaChunk2 = {
        delta: {
          tool_calls: [
            {
              index: 0,
              function: { arguments: '{"command": "echo hello"}' },
            },
          ],
        },
      };

      // 2. Provider adds fragments to pipeline with ID preservation
      if (deltaChunk1.delta.tool_calls) {
        for (const deltaToolCall of deltaChunk1.delta.tool_calls) {
          pipeline.addFragment(deltaToolCall.index, {
            id: deltaToolCall.id, // Preserve the tool_call_id from OpenAI API
            name: deltaToolCall.function?.name,
            args: deltaToolCall.function?.arguments,
          });
        }
      }

      if (deltaChunk2.delta.tool_calls) {
        for (const deltaToolCall of deltaChunk2.delta.tool_calls) {
          pipeline.addFragment(deltaToolCall.index, {
            id: deltaToolCall.id, // Preserve the tool_call_id (same ID across fragments)
            name: deltaToolCall.function?.name,
            args: deltaToolCall.function?.arguments,
          });
        }
      }

      // 3. Pipeline processes and normalizes
      const pipelineResult = await pipeline.process();

      // 4. Verify the tool_call_id is preserved
      expect(pipelineResult.normalized).toHaveLength(1);
      expect(pipelineResult.normalized[0].id).toBe('call_real_id_123');
      expect(pipelineResult.normalized[0].name).toBe('run_shell_command');
      expect(pipelineResult.normalized[0].args).toEqual({
        command: 'echo hello',
      });
    });
  });
});
