/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryService } from './HistoryService.js';
import { SyntheticToolResponseHandler } from '../../providers/openai/syntheticToolResponses.js';
import type { ToolCallBlock, ToolResponseBlock } from './IContent.js';
import type { IMessage } from '../../providers/IMessage.js';

describe.skip('Orphaned Tool Calls - HistoryService (OBSOLETE - atomic implementation prevents orphans)', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  describe('findUnmatchedToolCalls', () => {
    it('should identify orphaned tool calls', () => {
      // Add user message
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Create a file' }],
      });

      // Add AI response with tool call
      const toolCallId = historyService.generateHistoryId(
        'turn-test',
        0,
        'openai',
        'call_write_test',
        'write_file',
      );
      historyService.add({
        speaker: 'ai',
        blocks: [
          { type: 'text', text: "I'll create that file." },
          {
            type: 'tool_call',
            id: toolCallId,
            name: 'write_file',
            parameters: { path: '/tmp/test.txt', content: 'Hello' },
          } as ToolCallBlock,
        ],
      });

      // NO tool response added (simulating cancellation)

      // Should find one unmatched tool call
      const unmatched = historyService.findUnmatchedToolCalls();
      expect(unmatched).toHaveLength(1);
      expect(unmatched[0].id).toBe(toolCallId);
      expect(unmatched[0].name).toBe('write_file');
    });

    it('should handle mixed matched and unmatched tool calls', () => {
      // Add AI response with multiple tool calls
      const matchedId = historyService.generateHistoryId(
        'turn-test',
        0,
        'openai',
        'call_matched',
        'tool1',
      );
      const orphanId1 = historyService.generateHistoryId(
        'turn-test',
        1,
        'openai',
        'call_orphan1',
        'tool2',
      );
      const orphanId2 = historyService.generateHistoryId(
        'turn-test',
        2,
        'openai',
        'call_orphan2',
        'tool3',
      );

      historyService.add({
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Executing multiple tools' },
          {
            type: 'tool_call',
            id: matchedId,
            name: 'tool1',
            parameters: {},
          } as ToolCallBlock,
          {
            type: 'tool_call',
            id: orphanId1,
            name: 'tool2',
            parameters: {},
          } as ToolCallBlock,
          {
            type: 'tool_call',
            id: orphanId2,
            name: 'tool3',
            parameters: {},
          } as ToolCallBlock,
        ],
      });

      // Add response only for the first tool
      historyService.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: matchedId,
            toolName: 'tool1',
            result: { success: true },
          },
        ],
      });

      // Should find two unmatched tool calls
      const unmatched = historyService.findUnmatchedToolCalls();
      expect(unmatched).toHaveLength(2);
      expect(unmatched.map((u) => u.id)).toContain(orphanId1);
      expect(unmatched.map((u) => u.id)).toContain(orphanId2);
      expect(unmatched.map((u) => u.id)).not.toContain(matchedId);
    });
  });

  describe('getCurated with orphaned tools', () => {
    it('should return history with orphaned tool calls (currently broken)', () => {
      // Setup history with orphaned tool call
      const toolCallId = historyService.generateHistoryId(
        'turn-test',
        0,
        'openai',
        'call_orphaned',
        'orphaned_tool',
      );

      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Do something' }],
      });

      historyService.add({
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'Doing it' },
          {
            type: 'tool_call',
            id: toolCallId,
            name: 'some_tool',
            parameters: {},
          } as ToolCallBlock,
        ],
      });

      // No tool response (orphaned)

      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Next message' }],
      });

      // getCurated() does NOT add synthetic responses
      const curated = historyService.getCurated();

      // Find the AI message with tool call
      const aiMessage = curated.find(
        (c) =>
          c.speaker === 'ai' && c.blocks.some((b) => b.type === 'tool_call'),
      );
      expect(aiMessage).toBeDefined();

      // getCurated should NOT have synthetic responses
      const toolResponses = curated.filter((c) => c.speaker === 'tool');
      expect(toolResponses).toHaveLength(0);

      // But getCuratedForProvider SHOULD add synthetic response
      const curatedForProvider = historyService.getCuratedForProvider();
      const toolResponsesForProvider = curatedForProvider.filter(
        (c) => c.speaker === 'tool',
      );

      expect(toolResponsesForProvider).toHaveLength(1);
      expect(toolResponsesForProvider[0].blocks[0].type).toBe('tool_response');
      expect(
        (toolResponsesForProvider[0].blocks[0] as ToolResponseBlock).callId,
      ).toBe(toolCallId);
      expect(
        (toolResponsesForProvider[0].blocks[0] as ToolResponseBlock).error,
      ).toContain('cancelled');
    });
  });

  describe('validateAndFix', () => {
    it('should add synthetic responses for orphaned tool calls', () => {
      const toolCallId = historyService.generateHistoryId(
        'turn-test',
        0,
        'anthropic',
        'call_orphaned',
        'orphaned_tool',
      );

      // Add history with orphaned tool call
      historyService.add({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: toolCallId,
            name: 'orphaned_tool',
            parameters: {},
          } as ToolCallBlock,
        ],
      });

      // Before fix: orphaned tool exists
      expect(historyService.findUnmatchedToolCalls()).toHaveLength(1);

      // Apply fix
      historyService.validateAndFix();

      // After fix: should have synthetic response
      expect(historyService.findUnmatchedToolCalls()).toHaveLength(0);

      const allHistory = historyService.getAll();
      const toolResponse = allHistory.find((c) => c.speaker === 'tool');

      expect(toolResponse).toBeDefined();
      expect(toolResponse?.blocks[0].type).toBe('tool_response');
      expect((toolResponse?.blocks[0] as ToolResponseBlock).callId).toBe(
        toolCallId,
      );
      expect((toolResponse?.blocks[0] as ToolResponseBlock).error).toContain(
        'interrupted',
      );
    });
  });
});

describe.skip('SyntheticToolResponseHandler (OBSOLETE - atomic implementation prevents orphans)', () => {
  describe('identifyMissingToolResponses', () => {
    it('should identify tool calls without responses in IMessage format', () => {
      const messages: IMessage[] = [
        {
          role: 'user',
          content: 'Do something',
        },
        {
          role: 'assistant',
          content: 'Sure',
          tool_calls: [
            {
              id: 'hist_tool_123',
              type: 'function',
              function: {
                name: 'some_tool',
                arguments: '{}',
              },
            },
            {
              id: 'hist_tool_456',
              type: 'function',
              function: {
                name: 'another_tool',
                arguments: '{}',
              },
            },
          ],
        },
        // Only one tool response
        {
          role: 'tool',
          content: 'Result',
          tool_call_id: 'hist_tool_123',
        },
        // hist_tool_456 has no response - it's orphaned
      ];

      const missing =
        SyntheticToolResponseHandler.identifyMissingToolResponses(messages);
      expect(missing).toHaveLength(1);
      expect(missing[0]).toBe('hist_tool_456');
    });
  });

  describe('patchMessageHistory', () => {
    it('should add synthetic responses for orphaned tool calls', () => {
      const messages: IMessage[] = [
        {
          role: 'assistant',
          content: 'Calling tools',
          tool_calls: [
            {
              id: 'hist_tool_orphan',
              type: 'function',
              function: {
                name: 'orphaned_tool',
                arguments: '{}',
              },
            },
          ],
        },
        // No tool response - orphaned
        {
          role: 'user',
          content: 'Next message',
        },
      ];

      const patched =
        SyntheticToolResponseHandler.patchMessageHistory(messages);

      // Should have added a synthetic response
      const toolResponses = patched.filter((m) => m.role === 'tool');
      expect(toolResponses).toHaveLength(1);
      expect(toolResponses[0].tool_call_id).toBe('hist_tool_orphan');
      expect(toolResponses[0].content).toContain('cancelled');
    });
  });
});
