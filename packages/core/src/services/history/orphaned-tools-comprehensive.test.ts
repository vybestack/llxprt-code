/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryService } from './HistoryService.js';
import type { ToolCallBlock, ToolResponseBlock } from './IContent.js';

describe('Orphaned Tool Calls - Comprehensive Tests', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  describe('getCurated WITHOUT orphans', () => {
    it('should NOT add synthetic responses when tool responses exist', () => {
      const toolCallId = historyService.generateHistoryId(
        'turn-test',
        0,
        'openai',
        'raw-tool-id',
        'test_tool',
      );

      // Add user message
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Please do something' }],
      });

      // Add AI message with tool call
      historyService.add({
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'I will use a tool' },
          {
            type: 'tool_call',
            id: toolCallId,
            name: 'test_tool',
            parameters: { foo: 'bar' },
          } as ToolCallBlock,
        ],
      });

      // Add PROPER tool response
      historyService.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: toolCallId,
            toolName: 'test_tool',
            result: { success: true },
          },
        ],
      });

      // Add next user message
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Thanks' }],
      });

      const curated = historyService.getCurated();

      // Should have exactly ONE tool response (the real one, no synthetics)
      const toolResponses = curated.filter((c) => c.speaker === 'tool');
      expect(toolResponses).toHaveLength(1);

      // It should be the real response, not synthetic
      const response = toolResponses[0].blocks[0] as ToolResponseBlock;
      expect(response.callId).toBe(toolCallId);
      expect(response.result).toEqual({ success: true });
      expect(response.error).toBeUndefined();

      // No synthetic metadata
      expect(toolResponses[0].metadata?.synthetic).toBeUndefined();
    });

    it('should handle multiple tool calls with all responses present', () => {
      const toolCallIds = [
        historyService.generateHistoryId(
          'turn-test',
          0,
          'openai',
          'raw-0',
          'tool',
        ),
        historyService.generateHistoryId(
          'turn-test',
          1,
          'openai',
          'raw-1',
          'tool',
        ),
        historyService.generateHistoryId(
          'turn-test',
          2,
          'openai',
          'raw-2',
          'tool',
        ),
      ];

      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Do multiple things' }],
      });

      // Add AI message with multiple tool calls
      historyService.add({
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Using multiple tools' },
          ...toolCallIds.map((id) => ({
            type: 'tool_call' as const,
            id,
            name: 'tool',
            parameters: {},
          })),
        ],
      });

      // Add responses for ALL tool calls
      for (const id of toolCallIds) {
        historyService.add({
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: id,
              toolName: 'tool',
              result: { data: `Result for ${id}` },
            },
          ],
        });
      }

      const curated = historyService.getCurated();

      const toolResponses = curated.filter((c) => c.speaker === 'tool');
      expect(toolResponses).toHaveLength(3);

      // All should be real responses, no synthetics
      for (const resp of toolResponses) {
        expect(resp.metadata?.synthetic).toBeUndefined();
      }
    });
  });

  describe.skip('getCuratedForProvider WITH orphans (OBSOLETE - atomic implementation prevents orphans)', () => {
    it('should add synthetic response for truly orphaned tool call', () => {
      const toolCallId = historyService.generateHistoryId(
        'turn-test',
        0,
        'openai',
        'raw-orphaned',
        'orphaned_tool',
      );

      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Do something' }],
      });

      historyService.add({
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Using tool' },
          {
            type: 'tool_call',
            id: toolCallId,
            name: 'orphaned_tool',
            parameters: {},
          } as ToolCallBlock,
        ],
      });

      // NO tool response - this is orphaned

      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Why did you stop?' }],
      });

      const curated = historyService.getCuratedForProvider();

      // Should have synthetic response added
      const toolResponses = curated.filter((c) => c.speaker === 'tool');
      expect(toolResponses).toHaveLength(1);

      const syntheticResp = toolResponses[0].blocks[0] as ToolResponseBlock;
      expect(syntheticResp.callId).toBe(toolCallId);
      expect(syntheticResp.error).toContain('cancelled or failed');
      expect(syntheticResp.result).toBeNull();

      // Should have synthetic metadata
      expect(toolResponses[0].metadata?.synthetic).toBe(true);
      expect(toolResponses[0].metadata?.reason).toBe('orphaned_tool_call');
    });

    it('should handle mixed orphaned and completed tool calls', () => {
      const completedId = historyService.generateHistoryId(
        'turn-test',
        0,
        'openai',
        'raw-completed',
        'tool1',
      );
      const orphanedId1 = historyService.generateHistoryId(
        'turn-test',
        1,
        'openai',
        'raw-orphaned-1',
        'tool2',
      );
      const orphanedId2 = historyService.generateHistoryId(
        'turn-test',
        2,
        'openai',
        'raw-orphaned-2',
        'tool3',
      );

      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Do things' }],
      });

      historyService.add({
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Using tools' },
          {
            type: 'tool_call',
            id: completedId,
            name: 'tool1',
            parameters: {},
          } as ToolCallBlock,
          {
            type: 'tool_call',
            id: orphanedId1,
            name: 'tool2',
            parameters: {},
          } as ToolCallBlock,
          {
            type: 'tool_call',
            id: orphanedId2,
            name: 'tool3',
            parameters: {},
          } as ToolCallBlock,
        ],
      });

      // Only add response for the first tool
      historyService.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: completedId,
            toolName: 'tool1',
            result: { success: true },
          },
        ],
      });

      // orphanedId1 and orphanedId2 have no responses

      const curated = historyService.getCuratedForProvider();
      const toolResponses = curated.filter((c) => c.speaker === 'tool');

      // Should have 2 tool response entries:
      // 1 real response + 1 synthetic entry with 2 responses
      expect(toolResponses.length).toBeGreaterThanOrEqual(2);

      // Check we have both real and synthetic
      const hasRealResponse = toolResponses.some((r) =>
        r.blocks.some((b) => (b as ToolResponseBlock).callId === completedId),
      );
      const hasSynthetic1 = toolResponses.some((r) =>
        r.blocks.some((b) => (b as ToolResponseBlock).callId === orphanedId1),
      );
      const hasSynthetic2 = toolResponses.some((r) =>
        r.blocks.some((b) => (b as ToolResponseBlock).callId === orphanedId2),
      );

      expect(hasRealResponse).toBe(true);
      expect(hasSynthetic1).toBe(true);
      expect(hasSynthetic2).toBe(true);
    });
  });

  describe('getCuratedForProvider should not create circular references', () => {
    it('should return serializable history without circular references', () => {
      const toolCallId = historyService.generateHistoryId(
        'turn-test',
        0,
        'openai',
        'raw-serializable',
        'test',
      );

      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Test' }],
      });

      historyService.add({
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Testing' },
          {
            type: 'tool_call',
            id: toolCallId,
            name: 'test',
            parameters: { nested: { data: 'value' } },
          } as ToolCallBlock,
        ],
      });

      // No response - orphaned

      const curated = historyService.getCuratedForProvider();

      // Should be able to JSON.stringify without circular reference error
      let stringified: string;
      expect(() => {
        stringified = JSON.stringify(curated);
      }).not.toThrow();

      // Should be able to parse it back
      expect(() => {
        JSON.parse(stringified!);
      }).not.toThrow();
    });

    it('should not modify original history when patching', () => {
      const toolCallId = historyService.generateHistoryId(
        'turn-test',
        0,
        'openai',
        'raw-patching',
        'test',
      );

      historyService.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: toolCallId,
            name: 'test',
            parameters: {},
          } as ToolCallBlock,
        ],
      });

      const originalLength = historyService.getAll().length;

      // Call getCuratedForProvider multiple times
      const curated1 = historyService.getCuratedForProvider();
      const curated2 = historyService.getCuratedForProvider();
      const curated3 = historyService.getCuratedForProvider();

      // Original history should not change
      expect(historyService.getAll()).toHaveLength(originalLength);

      // Each curated should be independent
      expect(curated1).not.toBe(curated2);
      expect(curated2).not.toBe(curated3);

      // Should be able to stringify all
      expect(() => JSON.stringify(curated1)).not.toThrow();
      expect(() => JSON.stringify(curated2)).not.toThrow();
      expect(() => JSON.stringify(curated3)).not.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty history', () => {
      const curated = historyService.getCurated();
      expect(curated).toEqual([]);
      expect(() => JSON.stringify(curated)).not.toThrow();
    });

    it.skip('should handle history with only tool calls (no responses) - OBSOLETE', () => {
      historyService.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'test',
            name: 'tool',
            parameters: {},
          } as ToolCallBlock,
        ],
      });

      const curated = historyService.getCuratedForProvider();

      // Should have AI message and synthetic response
      expect(curated).toHaveLength(2);
      expect(curated[0].speaker).toBe('ai');
      expect(curated[1].speaker).toBe('tool');
      expect(curated[1].metadata?.synthetic).toBe(true);
    });

    it.skip('should not add duplicate synthetic responses on repeated calls - OBSOLETE', () => {
      const toolCallId = historyService.generateHistoryId(
        'turn-test',
        0,
        'openai',
        'raw-duplicate',
        'test',
      );

      historyService.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: toolCallId,
            name: 'test',
            parameters: {},
          } as ToolCallBlock,
        ],
      });

      const curated1 = historyService.getCuratedForProvider();
      const curated2 = historyService.getCuratedForProvider();

      // Both should have same length
      expect(curated1).toHaveLength(2);
      expect(curated2).toHaveLength(2);

      // Original history should still be just 1
      expect(historyService.getAll()).toHaveLength(1);
    });
  });
});
