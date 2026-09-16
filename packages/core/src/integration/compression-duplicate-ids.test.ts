/**
 * Test to reproduce duplicate tool call IDs during compression
 *
 * The outbound wire encoder (ContentConverters.toGeminiContents) was removed
 * with the obsolete provider-request direction (#2628). The wire fixtures
 * below are produced by a local encoder that mirrors the subset of the
 * Gemini provider tree's outbound wire shape these fixtures use: role
 * 'user'/'model', text parts, functionCall parts carrying the history id,
 * and functionResponse parts carrying the callId. The preserved parse
 * direction (ContentConverters.toIContent/toIContents) accepts any
 * structurally compatible Content shape, so the compression round-trip under
 * test is unchanged.
 */

import { describe, it, expect } from 'bun:test';
import { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import type { IContent } from '../services/history/IContent.js';

/** Wire shapes mirroring the provider encoder's Content/Part output. */
interface WireToolCallPart {
  functionCall: { id?: string; name?: string; args?: Record<string, unknown> };
}

interface WireToolResponsePart {
  functionResponse: {
    id?: string;
    name?: string;
    response?: Record<string, unknown>;
  };
}

interface WireTextPart {
  text: string;
}

type WirePart = WireTextPart | WireToolCallPart | WireToolResponsePart;

interface WireContent {
  role: string;
  parts: WirePart[];
}

/**
 * Tool parameters are `unknown` on IContent; the wire shape requires a JSON
 * object (the same invariant the deleted encoder asserted). Guarded
 * narrowing with an empty-object fallback for non-object values.
 */
function argsAsRecord(parameters: unknown): Record<string, unknown> {
  if (typeof parameters === 'object' && parameters !== null) {
    return parameters as Record<string, unknown>;
  }
  return {};
}

/** Encode one IContent into the provider wire shape (mirrors the deleted outbound encoder). */
function encodeContentForProvider(content: IContent): WireContent | null {
  const parts: WirePart[] = [];
  for (const block of content.blocks) {
    if (block.type === 'text') {
      parts.push({ text: block.text });
    } else if (block.type === 'tool_call') {
      parts.push({
        functionCall: {
          id: block.id,
          name: block.name,
          args: argsAsRecord(block.parameters),
        },
      });
    } else if (block.type === 'tool_response') {
      parts.push({
        functionResponse: {
          id: block.callId,
          name: block.toolName,
          response: { status: 'success', result: block.result },
        },
      });
    }
  }
  if (parts.length === 0) {
    return null;
  }
  return {
    role: content.speaker === 'ai' ? 'model' : 'user',
    parts,
  };
}

/** Encode curated history into the provider wire shape. */
function encodeForProvider(contents: IContent[]): WireContent[] {
  const encoded: WireContent[] = [];
  for (const content of contents) {
    const wire = encodeContentForProvider(content);
    if (wire !== null) {
      encoded.push(wire);
    }
  }
  return encoded;
}

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

    // Step 2: Encode to the provider wire Content[] format, mirroring what
    // the Gemini provider's outbound converter produces for request history.
    const curatedContent = encodeForProvider(curatedIContent);

    // Step 3: Simulate compression - split history
    // Check what we have before slicing
    expect(curatedContent.length).toBe(4); // user, ai with tool call, tool response, ai response
    // In real compression, we need to keep tool calls with their responses
    // So let's keep from the AI message with tool call onwards
    const historyToKeep = curatedContent.slice(1); // Keep AI tool call, tool response, AI response

    // Verify historyToKeep contains all the tool-related messages
    expect(historyToKeep.length).toBe(3);
    expect(historyToKeep[0].role).toBe('model'); // AI with tool call
    expect(historyToKeep[1].role).toBe('user'); // Tool response (user role in wire format)
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
        collectBlockId(block, toolCallIds, toolResponseIds);
      }
    }

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
    let contents = encodeForProvider(curated);

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
    contents = encodeForProvider(curated);

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
        collectToolCallId(block, allToolIds);
      }
    }

    const uniqueIds = new Set(allToolIds);
    expect(allToolIds.length).toBe(uniqueIds.size);
  });
});

function collectBlockId(
  block: { type: string; id?: string; callId?: string },
  toolCallIds: string[],
  toolResponseIds: string[],
): void {
  if (block.type === 'tool_call' && block.id !== undefined) {
    toolCallIds.push(block.id);
  } else if (block.type === 'tool_response' && block.callId !== undefined) {
    toolResponseIds.push(block.callId);
  }
}

function collectToolCallId(
  block: { type: string; id?: string },
  ids: string[],
): void {
  if (block.type === 'tool_call' && block.id !== undefined) {
    ids.push(block.id);
  }
}
