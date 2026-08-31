/**
 * Test that compression locking prevents race conditions
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';
import { HistoryService } from './HistoryService.js';
import { CompressionOperationQueue } from './historyCompressionQueue.js';

function createBlockedTokenizerFactory(): {
  factory: RuntimeTokenizerFactory;
  blockNext: () => Promise<void>;
  release: () => void;
} {
  let blocking = false;
  let startedResolve: (() => void) | undefined;
  let releaseResolve: (() => void) | undefined;
  let releasePromise = Promise.resolve();

  return {
    factory: {
      getTokenizer: () => ({
        countTokens: async (content: unknown) => {
          if (blocking) {
            blocking = false;
            startedResolve?.();
            await releasePromise;
          }
          return typeof content === 'string' ? content.length : 1;
        },
      }),
      estimatePrompt: async () => ({
        count: 0,
        method: 'exact' as const,
        family: 'test',
        estimatorVersion: '0',
        assetRevision: '0',
        projectionRevision: 0,
      }),
    },
    blockNext: () => {
      blocking = true;
      releasePromise = new Promise<void>((resolve) => {
        releaseResolve = resolve;
      });
      return new Promise<void>((resolve) => {
        startedResolve = resolve;
      });
    },
    release: () => releaseResolve?.(),
  };
}

/**
 * Render helpers for block assertions. Hoisted so the text/non-text choice
 * lives here rather than being repeated inside every test body (#3129).
 */
function describeBlock(block: {
  readonly type: string;
  readonly text?: string;
}): string {
  return block.type === 'text' ? (block.text ?? '') : `<${block.type}>`;
}

function blockLabel(block: {
  readonly type: string;
  readonly text?: string;
}): string {
  return block.type === 'text' ? (block.text ?? '') : block.type;
}

describe('Compression locking', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
  });

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

    historyService.rebuildWith(() => {
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
    const compressionMessages = allHistory.filter((h) =>
      h.blocks.some(
        (b) =>
          b.type === 'text' && 'text' in b && b.text.startsWith('Compression'),
      ),
    );

    expect(compressionMessages.length).toBe(3);
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

    it('flushes streaming contentAdded after compressionLockReleased so recording captures it', () => {
      // Streaming content (queued with no rebuild clear behind it) was never
      // recorded during the window, so its flush must land AFTER the lock is
      // released. Rebuild-phase content is covered separately below (#3264).
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
        'compressionLockReleased',
        'compressionEnded',
        'contentAdded',
      ]);
    });

    it('emits compressionLockReleased without a preceding startCompression', () => {
      historyService.endCompression();

      expect(observed).toContain('compressionLockReleased');
    });
  });

  describe('mid-compression content vs the rebuild clear (#3264)', () => {
    it('preserves content queued before the rebuild clear, landing it after the rebuild', () => {
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'original question' }],
      });
      const retained = historyService.getCurated();

      historyService.startCompression();
      historyService.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'mid-stream content' }],
      });
      historyService.rebuildWith(() => {
        historyService.clear();
        for (const content of retained) {
          historyService.add(content);
        }
      });
      historyService.endCompression(
        { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
        1,
      );

      const texts = historyService.getAll().map((entry) => {
        const block = entry.blocks[0];
        return describeBlock(block);
      });
      expect(texts).toStrictEqual(['original question', 'mid-stream content']);
    });

    it('flushes rebuild contentAdded before compressionLockReleased and streaming contentAdded after', () => {
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'original question' }],
      });
      const retained = historyService.getCurated();

      const observed: string[] = [];
      historyService.on('contentAdded', (content) => {
        const block = content.blocks[0];
        observed.push(`contentAdded:${blockLabel(block)}`);
      });
      historyService.on('compressionLockReleased', () => {
        observed.push('compressionLockReleased');
      });
      historyService.on('compressionEnded', () => {
        observed.push('compressionEnded');
      });

      historyService.startCompression();
      historyService.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'mid-stream content' }],
      });
      historyService.rebuildWith(() => {
        historyService.clear();
        for (const content of retained) {
          historyService.add(content);
        }
      });
      historyService.endCompression(
        { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
        1,
      );

      expect(observed).toStrictEqual([
        // Rebuild entries stay inside the recording suppression window: their
        // contentAdded fires before the lock is released (#3263, #3132).
        'contentAdded:original question',
        'compressionLockReleased',
        'compressionEnded',
        // Streaming entries were never recorded during the window, so they
        // flush after the release and the events (#3264).
        'contentAdded:mid-stream content',
      ]);
    });

    it('keeps every queued streaming entry when several arrive before the rebuild clear', () => {
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'original question' }],
      });
      const retained = historyService.getCurated();

      historyService.startCompression();
      historyService.add({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_mid',
            toolName: 'probe_tool',
            result: { ok: true },
          },
        ],
      });
      historyService.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'follow-up stream chunk' }],
      });
      historyService.rebuildWith(() => {
        historyService.clear();
        for (const content of retained) {
          historyService.add(content);
        }
      });
      historyService.endCompression(
        { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
        1,
      );

      const all = historyService.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'original question',
      });
      expect(all[1].blocks[0]).toStrictEqual({
        type: 'tool_response',
        callId: 'call_mid',
        toolName: 'probe_tool',
        result: { ok: true },
      });
      expect(all[2].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'follow-up stream chunk',
      });
    });

    it('flushes a late streaming add after the release events when an explicit rebuild runs first (#3338)', () => {
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'original question' }],
      });
      const retained = historyService.getCurated();

      const observed: string[] = [];
      historyService.on('contentAdded', (content) => {
        const block = content.blocks[0];
        observed.push(`contentAdded:${blockLabel(block)}`);
      });
      historyService.on('compressionLockReleased', () => {
        observed.push('compressionLockReleased');
      });
      historyService.on('compressionEnded', () => {
        observed.push('compressionEnded');
      });

      historyService.startCompression();
      historyService.rebuildWith(() => {
        historyService.clear();
        for (const content of retained) {
          historyService.add(content);
        }
      });
      historyService.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'late streaming content' }],
      });
      historyService.endCompression(
        { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
        1,
      );

      expect(observed).toStrictEqual([
        'contentAdded:original question',
        'compressionLockReleased',
        'compressionEnded',
        'contentAdded:late streaming content',
      ]);

      const texts = historyService.getAll().map((entry) => {
        const block = entry.blocks[0];
        return describeBlock(block);
      });
      expect(texts).toStrictEqual([
        'original question',
        'late streaming content',
      ]);
    });

    it('flushes queued rebuild work in the rebuild phase when the callback throws after queueing it', () => {
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'original question' }],
      });
      const retained = historyService.getCurated();

      const observed: string[] = [];
      historyService.on('contentAdded', (content) => {
        const block = content.blocks[0];
        observed.push(`contentAdded:${blockLabel(block)}`);
      });
      historyService.on('compressionLockReleased', () => {
        observed.push('compressionLockReleased');
      });
      historyService.on('compressionEnded', () => {
        observed.push('compressionEnded');
      });

      historyService.startCompression();
      expect(() =>
        historyService.rebuildWith(() => {
          historyService.clear();
          for (const content of retained) {
            historyService.add(content);
          }
          throw new Error('rebuild failed');
        }),
      ).toThrow('rebuild failed');
      historyService.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'late streaming content' }],
      });
      historyService.endCompression(
        { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
        1,
      );

      // The work queued before the throw is real rebuild work: it flushes
      // inside the suppression window, then the events, then the late add.
      expect(observed).toStrictEqual([
        'contentAdded:original question',
        'compressionLockReleased',
        'compressionEnded',
        'contentAdded:late streaming content',
      ]);
      const texts = historyService.getAll().map((entry) => {
        const block = entry.blocks[0];
        return describeBlock(block);
      });
      expect(texts).toStrictEqual([
        'original question',
        'late streaming content',
      ]);
    });
  });

  describe('deferred asynchronous mutation ordering', () => {
    it('keeps rebuild contentAdded inside the lock-release events when a replaceAll is in flight', async () => {
      // A blocked replaceAll holds the mutation FIFO across the whole
      // compression window, so every queued closure defers into it. The
      // release events must route through that same FIFO: the rebuild
      // contentAdded fires first (staying inside the suppression window), then
      // the events, then the streaming contentAdded (#3264).
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'original question' }],
      });
      const retained = historyService.getCurated();

      const observed: string[] = [];
      historyService.on('contentAdded', (content) => {
        const block = content.blocks[0];
        observed.push(`contentAdded:${blockLabel(block)}`);
      });
      historyService.on('compressionLockReleased', () => {
        observed.push('compressionLockReleased');
      });
      historyService.on('compressionEnded', () => {
        observed.push('compressionEnded');
      });

      const blocked = createBlockedTokenizerFactory();
      historyService.setTokenizerFactory(blocked.factory);
      const estimationStarted = blocked.blockNext();
      const replacing = historyService.replaceAll([
        { speaker: 'human', blocks: [{ type: 'text', text: 'replacement' }] },
      ]);
      await estimationStarted;

      historyService.startCompression();
      historyService.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'mid-stream content' }],
      });
      historyService.rebuildWith(() => {
        historyService.clear();
        for (const content of retained) {
          historyService.add(content);
        }
      });
      historyService.endCompression(
        { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
        1,
      );

      blocked.release();
      await replacing;

      expect(observed).toStrictEqual([
        // Rebuild content stays inside the suppression window: it must fire
        // before the lock-release events, then streaming content after them.
        'contentAdded:original question',
        'compressionLockReleased',
        'compressionEnded',
        'contentAdded:mid-stream content',
      ]);
      expect(
        historyService.getAll().map((entry) => {
          const block = entry.blocks[0];
          return describeBlock(block);
        }),
      ).toStrictEqual(['original question', 'mid-stream content']);
    });
  });

  describe('listener throw during flush', () => {
    it('still applies the streaming phase and rethrows when a compressionLockReleased listener throws', () => {
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'original question' }],
      });
      const retained = historyService.getCurated();

      historyService.on('compressionLockReleased', () => {
        throw new Error('listener failure');
      });

      historyService.startCompression();
      historyService.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'mid-stream content' }],
      });
      historyService.rebuildWith(() => {
        historyService.clear();
        for (const content of retained) {
          historyService.add(content);
        }
      });

      expect(() =>
        historyService.endCompression(
          { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
          1,
        ),
      ).toThrow('listener failure');

      // The streaming slice is applied even though the release event threw: the
      // queue must never drop operations the pre-change code preserved.
      const texts = historyService.getAll().map((entry) => {
        const block = entry.blocks[0];
        return describeBlock(block);
      });
      expect(texts).toStrictEqual(['original question', 'mid-stream content']);
    });

    it('still emits compressionLockReleased, preserves streaming content, and rethrows when a rebuild operation throws', () => {
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'original question' }],
      });
      const retained = historyService.getCurated();

      let tokensUpdatedCalls = 0;
      let compressionLockReleasedObserved = false;
      historyService.on('tokensUpdated', () => {
        tokensUpdatedCalls += 1;
        if (tokensUpdatedCalls === 1) {
          // The FIRST call is the rebuild clear's emit (clearInternal): a listener
          // throwing inside it must not abort the flush before the lock release or
          // the streaming phase (never-drop guarantee, AC-6). Subsequent calls
          // (async token accounting) count harmlessly.
          throw new Error('rebuild listener failure');
        }
      });
      historyService.on('compressionLockReleased', () => {
        compressionLockReleasedObserved = true;
      });

      historyService.startCompression();
      historyService.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'mid-stream content' }],
      });
      historyService.rebuildWith(() => {
        historyService.clear();
        for (const content of retained) {
          historyService.add(content);
        }
      });

      expect(() =>
        historyService.endCompression(
          { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
          1,
        ),
      ).toThrow('rebuild listener failure');

      // A failing rebuild op must not prevent the release events from firing or the
      // streaming slice from being applied: both are still attempted (#3264).
      expect(compressionLockReleasedObserved).toBe(true);
      const texts = historyService.getAll().map((entry) => {
        const block = entry.blocks[0];
        return describeBlock(block);
      });
      expect(texts).toStrictEqual(['original question', 'mid-stream content']);
    });

    it('propagates a thrown undefined listener failure instead of swallowing it', () => {
      historyService.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'original question' }],
      });
      const retained = historyService.getCurated();

      historyService.on('compressionLockReleased', () => {
        // `throw undefined` is a legal JS throw; a sentinel keyed on `undefined`
        // cannot distinguish it from "no throw", so it must be rethrown truthfully.
        const nothing = undefined;
        throw nothing;
      });

      historyService.startCompression();
      historyService.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'mid-stream content' }],
      });
      historyService.rebuildWith(() => {
        historyService.clear();
        for (const content of retained) {
          historyService.add(content);
        }
      });

      // The thrown value is `undefined`, so this is asserted via a capture
      // rather than toThrow(), which cannot match a non-Error thrown value.
      let caught = false;
      try {
        historyService.endCompression(
          { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
          1,
        );
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);

      // The streaming slice is still applied despite the throwing release listener, and
      // the undefined throw is truthfully rethrown rather than swallowed.
      const texts = historyService.getAll().map((entry) => {
        const block = entry.blocks[0];
        return describeBlock(block);
      });
      expect(texts).toStrictEqual(['original question', 'mid-stream content']);
    });
  });
});

describe('CompressionOperationQueue high-water latch', () => {
  it('re-arms the one-shot high-water diagnostic after clear() (#2852)', () => {
    const reports: number[] = [];
    const queue = new CompressionOperationQueue(
      (pendingCount) => reports.push(pendingCount),
      2,
    );

    queue.enqueue(() => {}, 'streaming');
    queue.enqueue(() => {}, 'streaming');
    // Crossing the threshold fires the diagnostic exactly once for this cycle.
    expect(reports).toStrictEqual([2]);

    queue.clear();
    queue.enqueue(() => {}, 'streaming');
    queue.enqueue(() => {}, 'streaming');
    // clear() must restore initial state (dispose path), so a later cycle
    // crossing the threshold is diagnosable again instead of staying latched.
    expect(reports).toStrictEqual([2, 2]);
  });
});
