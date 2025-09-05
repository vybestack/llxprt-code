/**
 * Test to reproduce duplicate tool call IDs during compression
 */

import { describe, it, expect } from 'vitest';
import { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import {
  ToolCallBlock,
  ToolResponseBlock,
} from '../services/history/IContent.js';

describe('Compression and duplicate tool call IDs', () => {
  it('should not create duplicate tool IDs when rebuilding history after compression', () => {
    const historyService = new HistoryService();

    // Add initial conversation with a tool call
    historyService.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Find some files' }],
    });

    // AI makes a tool call - this generates a normalized ID
    const toolCallId = 'hist_tool_c3ecb6205';
    historyService.add({
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: toolCallId,
          name: 'glob',
          parameters: { pattern: '*.ts' },
        },
      ],
    });

    // Tool responds
    historyService.add({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: toolCallId,
          toolName: 'glob',
          result: { files: ['test.ts'] },
        },
      ],
    });

    // AI responds
    historyService.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Found test.ts' }],
    });

    // Now simulate what happens during compression
    // Step 1: Get curated history as IContent
    const curatedIContent = historyService.getCurated();

    // Step 2: Convert to Content[] (Gemini format) - this is what getHistory(true) does
    const curatedContent = ContentConverters.toGeminiContents(curatedIContent);

    // Step 3: Simulate compression - split history
    // Check what we have before slicing
    expect(curatedContent.length).toBe(4); // user, ai with tool call, tool response, ai response
    // In real compression, we need to keep tool calls with their responses
    // So let's keep from the AI message with tool call onwards
    const historyToKeep = curatedContent.slice(1); // Keep AI tool call, tool response, AI response

    // Verify historyToKeep contains all the tool-related messages
    expect(historyToKeep.length).toBe(3);
    expect(historyToKeep[0].role).toBe('model'); // AI with tool call
    expect(historyToKeep[1].role).toBe('user'); // Tool response (user role in Gemini)
    expect(historyToKeep[2].role).toBe('model'); // AI final response

    // Step 4: Create new history service (what startChat does)
    const newHistoryService = new HistoryService();

    // Step 5: Add compressed summary
    newHistoryService.add({
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'Previous context: User asked to find files' },
      ],
    });

    // Step 6: Add the kept history - THIS IS WHERE DUPLICATION MIGHT OCCUR
    for (const content of historyToKeep) {
      const idGen = newHistoryService.getIdGeneratorCallback();
      newHistoryService.add(
        ContentConverters.toIContent(content, idGen),
        'gemini-2.5-flash',
      );
    }

    // Check that tool call IDs are not duplicated
    const allHistory = newHistoryService.getAll();
    const toolCallIds: string[] = [];
    const toolResponseIds: string[] = [];

    for (const content of allHistory) {
      for (const block of content.blocks) {
        if (block.type === 'tool_call') {
          toolCallIds.push((block as ToolCallBlock).id);
        } else if (block.type === 'tool_response') {
          toolResponseIds.push((block as ToolResponseBlock).callId);
        }
      }
    }

    // Debug output
    console.log('Tool call IDs found:', toolCallIds);
    console.log('Tool response IDs found:', toolResponseIds);
    console.log('History to keep:', historyToKeep);
    console.log('All history after rebuild:', allHistory);

    // Check for duplicates
    const uniqueToolCallIds = new Set(toolCallIds);
    const uniqueToolResponseIds = new Set(toolResponseIds);

    expect(toolCallIds.length).toBe(uniqueToolCallIds.size);
    expect(toolResponseIds.length).toBe(uniqueToolResponseIds.size);

    // The tool call should only appear once
    expect(toolCallIds.filter((id: string) => id === toolCallId).length).toBe(
      1,
    );
    expect(
      toolResponseIds.filter((id: string) => id === toolCallId).length,
    ).toBe(1);
  });

  it('should handle multiple compressions without duplicating IDs', () => {
    const historyService = new HistoryService();

    // Add some history with tool calls
    historyService.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Do something' }],
    });

    const toolId1 = 'hist_tool_abc123';
    historyService.add({
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: toolId1,
          name: 'test_tool',
          parameters: {},
        },
      ],
    });

    historyService.add({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: toolId1,
          toolName: 'test_tool',
          result: { data: 'response1' },
        },
      ],
    });

    // Simulate first compression
    let curated = historyService.getCurated();
    let contents = ContentConverters.toGeminiContents(curated);

    // Clear and rebuild
    historyService.clear();
    historyService.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Compressed context' }],
    });

    // Re-add last part of history
    const kept = contents.slice(-2);
    for (const c of kept) {
      historyService.add(ContentConverters.toIContent(c), 'model');
    }

    // Add more history
    const toolId2 = 'hist_tool_def456';
    historyService.add({
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: toolId2,
          name: 'another_tool',
          parameters: {},
        },
      ],
    });

    historyService.add({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: toolId2,
          toolName: 'another_tool',
          result: { data: 'response2' },
        },
      ],
    });

    // Simulate second compression
    curated = historyService.getCurated();
    contents = ContentConverters.toGeminiContents(curated);

    // Clear and rebuild again
    historyService.clear();
    historyService.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Double compressed context' }],
    });

    // Re-add kept history
    const kept2 = contents.slice(-2);
    for (const c of kept2) {
      historyService.add(ContentConverters.toIContent(c), 'model');
    }

    // Verify no duplicate IDs
    const finalHistory = historyService.getAll();
    const allToolIds: string[] = [];

    for (const content of finalHistory) {
      for (const block of content.blocks) {
        if (block.type === 'tool_call') {
          allToolIds.push((block as ToolCallBlock).id);
        }
      }
    }

    const uniqueIds = new Set(allToolIds);
    expect(allToolIds.length).toBe(uniqueIds.size);
  });
});
