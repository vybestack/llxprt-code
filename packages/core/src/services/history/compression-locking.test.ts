/**
 * Test that compression locking prevents race conditions
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

describe('Compression locking', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

  function compressionMessageCount(allHistory: IContent[]): number {
    return allHistory.filter((h) =>
      h.blocks.some(
        (b) =>
          b.type === 'text' && 'text' in b && b.text.startsWith('Compression'),
      ),
    ).length;
  }

  it('should queue adds during compression', async () => {
    // Add initial content
    historyService.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Initial message' }],
    });

    // Start compression
    historyService.startCompression();

    // Try to add content during compression
    // These should queue, not be added immediately
    const toolCallId = 'hist_tool_test123';

    // Add tool call (this should queue)
    historyService.add({
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: toolCallId,
          name: 'test_tool',
          parameters: {},
        },
      ],
    });

    // Should still only have initial message (add is queued)
    let allHistory = historyService.getAll();
    expect(allHistory.length).toBe(1); // Only initial message

    // End compression
    historyService.endCompression();

    // Wait for queued operations to complete
    await historyService.waitForPendingOperations();

    // Now it should be in history
    allHistory = historyService.getAll();
    expect(allHistory.length).toBe(2);
    expect(allHistory[1].speaker).toBe('ai');
    expect(allHistory[1].blocks[0].type).toBe('tool_call');
  });

  it('never drops or rejects additions queued during a long compression', () => {
    // Issue #2852: an earlier attempt threw from add() and discarded the queue
    // once it passed a bound. add() is on the streaming path, so that lost
    // conversation content and could break a turn.
    historyService.startCompression();

    const queued = 5_000;
    for (let index = 0; index < queued; index += 1) {
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: `queued-${index}` }],
      });
    }
    expect(historyService.getAll()).toHaveLength(0);

    historyService.endCompression();

    const all = historyService.getAll();
    expect({
      count: all.length,
      first: all[0].blocks[0],
      last: all[all.length - 1].blocks[0],
    }).toStrictEqual({
      count: queued,
      first: { type: 'text', text: 'queued-0' },
      last: { type: 'text', text: `queued-${queued - 1}` },
    });
  });

  it('releases the compression lock even when the compression body throws', () => {
    // The queue's bound is the duration of the lock, so the lock must always be
    // released. This mirrors CompressionHandler.performCompression's finally.
    historyService.startCompression();
    try {
      throw new Error('compression failed');
    } catch {
      historyService.endCompression();
    }

    historyService.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'applied immediately' }],
    });
    expect(historyService.getAll()).toHaveLength(1);
  });

  it('should prevent duplicate IDs during compression rebuild', async () => {
    // Add content with tool calls
    const toolCallId = 'hist_tool_abc123';

    historyService.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Do something' }],
    });

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

    // Start compression
    historyService.startCompression();

    // Clear history (as compression would)
    historyService.clear();

    // Add compressed summary
    historyService.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Compressed context' }],
    });

    // Re-add the tool call (simulating historyToKeep)
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

    // While compression is still active, try to add tool response
    // This should queue, not execute immediately
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

    // End compression
    historyService.endCompression();

    // Wait for all operations
    await historyService.waitForPendingOperations();

    // Check that we don't have duplicates
    const allHistory = historyService.getAll();
    const toolCalls = allHistory.flatMap((h) =>
      h.blocks.filter((b) => b.type === 'tool_call'),
    );

    // Should have only one tool call with this ID
    const callsWithId = toolCalls.filter((tc) => tc.id === toolCallId);
    expect(callsWithId.length).toBe(1);
  });

  it('should handle getCurated during compression', async () => {
    // Add some history
    historyService.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Message 1' }],
    });

    historyService.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Response 1' }],
    });

    // Start compression
    historyService.startCompression();

    // getCurated should still work but log that compression is in progress
    const curated = historyService.getCurated();
    expect(curated.length).toBe(2);

    // End compression
    historyService.endCompression();
  });

  it('should serialize multiple compressions', async () => {
    // Simulate multiple rapid compressions
    const compressionPromises: Array<Promise<void>> = [];

    for (let i = 0; i < 3; i++) {
      compressionPromises.push(
        (async () => {
          // Wait for pending operations
          await historyService.waitForPendingOperations();

          // Start compression
          historyService.startCompression();

          // Simulate compression work
          await new Promise((resolve) => setTimeout(resolve, 10));

          // Add compressed content
          historyService.add({
            speaker: 'human',
            blocks: [{ type: 'text', text: `Compression ${i}` }],
          });

          // End compression
          historyService.endCompression();
        })(),
      );
    }

    // Wait for all compressions
    await Promise.all(compressionPromises);
    await historyService.waitForPendingOperations();

    // Check that all compressions completed
    const allHistory = historyService.getAll();
    expect(compressionMessageCount(allHistory)).toBe(3);
  });

  describe('compressionLockReleased event', () => {
    let observed: string[];

    beforeEach(() => {
      observed = [];
      historyService.on('contentAdded', () => {
        observed.push('contentAdded');
      });
      historyService.on('compressionLockReleased', () => {
        observed.push('compressionLockReleased');
      });
      historyService.on('compressionEnded', () => {
        observed.push('compressionEnded');
      });
    });

    it('releases the lock on an argless endCompression without compressionEnded', () => {
      historyService.startCompression();

      historyService.endCompression();

      expect(observed).toContain('compressionLockReleased');
      expect(observed).not.toContain('compressionEnded');
    });

    it('releases the lock on a failed-shaped endCompression without compressionEnded', () => {
      historyService.startCompression();

      historyService.endCompression(undefined, 3);

      expect(observed).toContain('compressionLockReleased');
      expect(observed).not.toContain('compressionEnded');
    });

    it('releases the lock and emits compressionEnded when a summary is provided', () => {
      historyService.startCompression();

      historyService.endCompression(
        { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
        3,
      );

      expect(observed).toContain('compressionLockReleased');
      expect(observed).toContain('compressionEnded');
    });

    it('flushes queued contentAdded before compressionLockReleased then compressionEnded', () => {
      historyService.startCompression();
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'queued during compression' }],
      });

      historyService.endCompression(
        { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
        3,
      );

      expect(observed).toStrictEqual([
        'contentAdded',
        'compressionLockReleased',
        'compressionEnded',
      ]);
    });

    it('emits compressionLockReleased without a preceding startCompression', () => {
      historyService.endCompression();

      expect(observed).toContain('compressionLockReleased');
    });
  });
});
