import { collectRowsForAssertions } from '../../test-utils/collect-rows-for-assertions.js';
import { curatedHistoryForTest } from '../../test-utils/curated-history-fixture.js';
import { observeHistorySynchronouslyForTest } from '../../test-utils/synchronous-history-test-observation.js';
/**
 * Test that compression locking prevents race conditions
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { createBlockedTokenizerFactory } from './compression-locking-test-helpers.js';
import { HistoryService } from './HistoryService.js';
import { CompressionOperationQueue } from './historyCompressionQueue.js';

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
async function legacyTest0() {
  // Add initial content
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'Initial message' }],
  });
  // Start compression
  legacySuite0_historyService.startCompression();
  // Try to add content during compression
  // These should queue, not be added immediately
  const toolCallId = 'hist_tool_test123';
  // Add tool call (this should queue)
  legacySuite0_historyService.add({
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
  const allHistory = observeHistorySynchronouslyForTest(
    legacySuite0_historyService,
  );
  expect(allHistory.length).toBe(1); // Only initial message
  // End compression
  legacySuite0_historyService.endCompression();
  // Wait for queued operations to complete
  await legacySuite0_historyService.waitForPendingOperations();
  // Now it should be in history
  await collectRowsForAssertions(
    legacySuite0_historyService.streamRawHistory(),
    (allHistory) => {
      expect(allHistory.length).toBe(2);
      expect(allHistory[1].speaker).toBe('ai');
      expect(allHistory[1].blocks[0].type).toBe('tool_call');
    },
  );
}
function legacyTest1() {
  // Issue #2852: an earlier attempt threw from add() and discarded the queue
  // once it passed a bound. add() is on the streaming path, so that lost
  // conversation content and could break a turn.
  legacySuite0_historyService.startCompression();
  const queued = 5000;
  for (let index = 0; index < queued; index += 1) {
    legacySuite0_historyService.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: `queued-${index}` }],
    });
  }
  expect(
    observeHistorySynchronouslyForTest(legacySuite0_historyService),
  ).toHaveLength(0);
  legacySuite0_historyService.endCompression();
  const all = observeHistorySynchronouslyForTest(legacySuite0_historyService);
  expect({
    count: all.length,
    first: all[0].blocks[0],
    last: all[all.length - 1].blocks[0],
  }).toStrictEqual({
    count: queued,
    first: { type: 'text', text: 'queued-0' },
    last: { type: 'text', text: `queued-${queued - 1}` },
  });
}
function legacyTest2() {
  // The queue's bound is the duration of the lock, so the lock must always be
  // released. This mirrors CompressionHandler.performCompression's finally.
  legacySuite0_historyService.startCompression();
  try {
    throw new Error('compression failed');
  } catch {
    legacySuite0_historyService.endCompression();
  }
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'applied immediately' }],
  });
  expect(
    observeHistorySynchronouslyForTest(legacySuite0_historyService),
  ).toHaveLength(1);
}
async function legacyTest3() {
  // Add content with tool calls
  const toolCallId = 'hist_tool_abc123';
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'Do something' }],
  });
  legacySuite0_historyService.add({
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
  legacySuite0_historyService.startCompression();
  legacySuite0_historyService.rebuildWith(() => {
    // Clear history (as compression would)
    legacySuite0_historyService.clear();
    // Add compressed summary
    legacySuite0_historyService.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Compressed context' }],
    });
    // Re-add the tool call (simulating historyToKeep)
    legacySuite0_historyService.add({
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
  legacySuite0_historyService.add({
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
  legacySuite0_historyService.endCompression();
  // Wait for all operations
  await legacySuite0_historyService.waitForPendingOperations();
  // Check that we don't have duplicates
  await collectRowsForAssertions(
    legacySuite0_historyService.streamRawHistory(),
    async (rows) => {
      const allHistory = rows;
      const toolCalls = allHistory.flatMap((h) =>
        h.blocks.filter((b) => b.type === 'tool_call'),
      );
      // Should have only one tool call with this ID
      const callsWithId = toolCalls.filter((tc) => tc.id === toolCallId);
      expect(callsWithId.length).toBe(1);
    },
  );
}
async function legacyTest4() {
  // Add some history
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'Message 1' }],
  });
  legacySuite0_historyService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'Response 1' }],
  });
  // Start compression
  legacySuite0_historyService.startCompression();
  // getCurated should still work but log that compression is in progress
  const curated = curatedHistoryForTest(legacySuite0_historyService);
  expect(curated.length).toBe(2);
  // End compression
  legacySuite0_historyService.endCompression();
}
async function legacyTest5() {
  // Simulate multiple rapid compressions
  const compressionPromises: Array<Promise<void>> = [];
  for (let i = 0; i < 3; i++) {
    compressionPromises.push(
      (async () => {
        // Wait for pending operations
        await legacySuite0_historyService.waitForPendingOperations();
        // Start compression
        legacySuite0_historyService.startCompression();
        // Simulate compression work
        await new Promise((resolve) => setTimeout(resolve, 10));
        // Add compressed content
        legacySuite0_historyService.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: `Compression ${i}` }],
        });
        // End compression
        legacySuite0_historyService.endCompression();
      })(),
    );
  }
  // Wait for all compressions
  await Promise.all(compressionPromises);
  await legacySuite0_historyService.waitForPendingOperations();
  // Check that all compressions completed
  await collectRowsForAssertions(
    legacySuite0_historyService.streamRawHistory(),
    async (rows) => {
      const allHistory = rows;
      const compressionMessages = allHistory.filter((h) =>
        h.blocks.some(
          (b) =>
            b.type === 'text' &&
            'text' in b &&
            b.text.startsWith('Compression'),
        ),
      );
      expect(compressionMessages.length).toBe(3);
    },
  );
}
function legacyTest6() {
  legacySuite0_historyService.startCompression();
  legacySuite0_historyService.endCompression();
  expect(legacySuite1_observed).toContain('compressionLockReleased');
  expect(legacySuite1_observed).not.toContain('compressionEnded');
}
function legacyTest7() {
  legacySuite0_historyService.startCompression();
  legacySuite0_historyService.endCompression(undefined, 3);
  expect(legacySuite1_observed).toContain('compressionLockReleased');
  expect(legacySuite1_observed).not.toContain('compressionEnded');
}
function legacyTest8() {
  legacySuite0_historyService.startCompression();
  legacySuite0_historyService.endCompression(
    { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
    3,
  );
  expect(legacySuite1_observed).toContain('compressionLockReleased');
  expect(legacySuite1_observed).toContain('compressionEnded');
}
function legacyTest9() {
  // Streaming content (queued with no rebuild clear behind it) was never
  // recorded during the window, so its flush must land AFTER the lock is
  // released. Rebuild-phase content is covered separately below (#3264).
  legacySuite0_historyService.startCompression();
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'queued during compression' }],
  });
  legacySuite0_historyService.endCompression(
    { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
    3,
  );
  expect(legacySuite1_observed).toStrictEqual([
    'compressionLockReleased',
    'compressionEnded',
    'contentAdded',
  ]);
}
function legacyTest10() {
  legacySuite0_historyService.endCompression();
  expect(legacySuite1_observed).toContain('compressionLockReleased');
}
let legacySuite1_observed: string[];
function legacyTest12() {
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'original question' }],
  });
  const retained = curatedHistoryForTest(legacySuite0_historyService);
  legacySuite0_historyService.startCompression();
  legacySuite0_historyService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'mid-stream content' }],
  });
  legacySuite0_historyService.rebuildWith(() => {
    legacySuite0_historyService.clear();
    for (const content of retained) {
      legacySuite0_historyService.add(content);
    }
  });
  legacySuite0_historyService.endCompression(
    { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
    1,
  );
  const texts = observeHistorySynchronouslyForTest(
    legacySuite0_historyService,
  ).map((entry) => {
    const block = entry.blocks[0];
    return describeBlock(block);
  });
  expect(texts).toStrictEqual(['original question', 'mid-stream content']);
}
function legacyTest13() {
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'original question' }],
  });
  const retained = curatedHistoryForTest(legacySuite0_historyService);
  const observed: string[] = [];
  legacySuite0_historyService.on('contentAdded', (content) => {
    const block = content.blocks[0];
    observed.push(`contentAdded:${blockLabel(block)}`);
  });
  legacySuite0_historyService.on('compressionLockReleased', () => {
    observed.push('compressionLockReleased');
  });
  legacySuite0_historyService.on('compressionEnded', () => {
    observed.push('compressionEnded');
  });
  legacySuite0_historyService.startCompression();
  legacySuite0_historyService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'mid-stream content' }],
  });
  legacySuite0_historyService.rebuildWith(() => {
    legacySuite0_historyService.clear();
    for (const content of retained) {
      legacySuite0_historyService.add(content);
    }
  });
  legacySuite0_historyService.endCompression(
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
}
function legacyTest14() {
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'original question' }],
  });
  const retained = curatedHistoryForTest(legacySuite0_historyService);
  legacySuite0_historyService.startCompression();
  legacySuite0_historyService.add({
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
  legacySuite0_historyService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'follow-up stream chunk' }],
  });
  legacySuite0_historyService.rebuildWith(() => {
    legacySuite0_historyService.clear();
    for (const content of retained) {
      legacySuite0_historyService.add(content);
    }
  });
  legacySuite0_historyService.endCompression(
    { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
    1,
  );
  const all = observeHistorySynchronouslyForTest(legacySuite0_historyService);
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
}
function legacyTest15() {
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'original question' }],
  });
  const retained = curatedHistoryForTest(legacySuite0_historyService);
  const observed: string[] = [];
  legacySuite0_historyService.on('contentAdded', (content) => {
    const block = content.blocks[0];
    observed.push(`contentAdded:${blockLabel(block)}`);
  });
  legacySuite0_historyService.on('compressionLockReleased', () => {
    observed.push('compressionLockReleased');
  });
  legacySuite0_historyService.on('compressionEnded', () => {
    observed.push('compressionEnded');
  });
  legacySuite0_historyService.startCompression();
  legacySuite0_historyService.rebuildWith(() => {
    legacySuite0_historyService.clear();
    for (const content of retained) {
      legacySuite0_historyService.add(content);
    }
  });
  legacySuite0_historyService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'late streaming content' }],
  });
  legacySuite0_historyService.endCompression(
    { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
    1,
  );
  expect(observed).toStrictEqual([
    'contentAdded:original question',
    'compressionLockReleased',
    'compressionEnded',
    'contentAdded:late streaming content',
  ]);
  const texts = observeHistorySynchronouslyForTest(
    legacySuite0_historyService,
  ).map((entry) => {
    const block = entry.blocks[0];
    return describeBlock(block);
  });
  expect(texts).toStrictEqual(['original question', 'late streaming content']);
}
function legacyTest16() {
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'original question' }],
  });
  const retained = curatedHistoryForTest(legacySuite0_historyService);
  const observed: string[] = [];
  legacySuite0_historyService.on('contentAdded', (content) => {
    const block = content.blocks[0];
    observed.push(`contentAdded:${blockLabel(block)}`);
  });
  legacySuite0_historyService.on('compressionLockReleased', () => {
    observed.push('compressionLockReleased');
  });
  legacySuite0_historyService.on('compressionEnded', () => {
    observed.push('compressionEnded');
  });
  legacySuite0_historyService.startCompression();
  expect(() =>
    legacySuite0_historyService.rebuildWith(() => {
      legacySuite0_historyService.clear();
      for (const content of retained) {
        legacySuite0_historyService.add(content);
      }
      throw new Error('rebuild failed');
    }),
  ).toThrow('rebuild failed');
  legacySuite0_historyService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'late streaming content' }],
  });
  legacySuite0_historyService.endCompression(
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
  const texts = observeHistorySynchronouslyForTest(
    legacySuite0_historyService,
  ).map((entry) => {
    const block = entry.blocks[0];
    return describeBlock(block);
  });
  expect(texts).toStrictEqual(['original question', 'late streaming content']);
}
async function legacyTest18() {
  // A blocked replaceAll holds the mutation FIFO across the whole
  // compression window, so every queued closure defers into it. The
  // release events must route through that same FIFO: the rebuild
  // contentAdded fires first (staying inside the suppression window), then
  // the events, then the streaming contentAdded (#3264).
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'original question' }],
  });
  const retained = curatedHistoryForTest(legacySuite0_historyService);
  const observed: string[] = [];
  legacySuite0_historyService.on('contentAdded', (content) => {
    const block = content.blocks[0];
    observed.push(`contentAdded:${blockLabel(block)}`);
  });
  legacySuite0_historyService.on('compressionLockReleased', () => {
    observed.push('compressionLockReleased');
  });
  legacySuite0_historyService.on('compressionEnded', () => {
    observed.push('compressionEnded');
  });
  const blocked = createBlockedTokenizerFactory();
  legacySuite0_historyService.setTokenizerFactory(blocked.factory);
  const estimationStarted = blocked.blockNext();
  const replacing = legacySuite0_historyService.replaceAll([
    { speaker: 'human', blocks: [{ type: 'text', text: 'replacement' }] },
  ]);
  await estimationStarted;
  legacySuite0_historyService.startCompression();
  legacySuite0_historyService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'mid-stream content' }],
  });
  legacySuite0_historyService.rebuildWith(() => {
    legacySuite0_historyService.clear();
    for (const content of retained) {
      legacySuite0_historyService.add(content);
    }
  });
  legacySuite0_historyService.endCompression(
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
  await collectRowsForAssertions(
    legacySuite0_historyService.streamRawHistory(),
    (rows) => {
      expect(
        rows.map((entry) => {
          const block = entry.blocks[0];
          return describeBlock(block);
        }),
      ).toStrictEqual(['original question', 'mid-stream content']);
    },
  );
}
function legacyTest20() {
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'original question' }],
  });
  const retained = curatedHistoryForTest(legacySuite0_historyService);
  legacySuite0_historyService.on('compressionLockReleased', () => {
    throw new Error('listener failure');
  });
  legacySuite0_historyService.startCompression();
  legacySuite0_historyService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'mid-stream content' }],
  });
  legacySuite0_historyService.rebuildWith(() => {
    legacySuite0_historyService.clear();
    for (const content of retained) {
      legacySuite0_historyService.add(content);
    }
  });
  expect(() =>
    legacySuite0_historyService.endCompression(
      { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
      1,
    ),
  ).toThrow('listener failure');
  // The streaming slice is applied even though the release event threw: the
  // queue must never drop operations the pre-change code preserved.
  const texts = observeHistorySynchronouslyForTest(
    legacySuite0_historyService,
  ).map((entry) => {
    const block = entry.blocks[0];
    return describeBlock(block);
  });
  expect(texts).toStrictEqual(['original question', 'mid-stream content']);
}
function legacyTest21() {
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'original question' }],
  });
  const retained = curatedHistoryForTest(legacySuite0_historyService);
  let tokensUpdatedCalls = 0;
  let compressionLockReleasedObserved = false;
  legacySuite0_historyService.on('tokensUpdated', () => {
    tokensUpdatedCalls += 1;
    if (tokensUpdatedCalls === 1) {
      // The FIRST call is the rebuild clear's emit (clearInternal): a listener
      // throwing inside it must not abort the flush before the lock release or
      // the streaming phase (never-drop guarantee, AC-6). Subsequent calls
      // (async token accounting) count harmlessly.
      throw new Error('rebuild listener failure');
    }
  });
  legacySuite0_historyService.on('compressionLockReleased', () => {
    compressionLockReleasedObserved = true;
  });
  legacySuite0_historyService.startCompression();
  legacySuite0_historyService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'mid-stream content' }],
  });
  legacySuite0_historyService.rebuildWith(() => {
    legacySuite0_historyService.clear();
    for (const content of retained) {
      legacySuite0_historyService.add(content);
    }
  });
  expect(() =>
    legacySuite0_historyService.endCompression(
      { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
      1,
    ),
  ).toThrow('rebuild listener failure');
  // A failing rebuild op must not prevent the release events from firing or the
  // streaming slice from being applied: both are still attempted (#3264).
  expect(compressionLockReleasedObserved).toBe(true);
  const texts = observeHistorySynchronouslyForTest(
    legacySuite0_historyService,
  ).map((entry) => {
    const block = entry.blocks[0];
    return describeBlock(block);
  });
  expect(texts).toStrictEqual(['original question', 'mid-stream content']);
}
function legacyTest22() {
  legacySuite0_historyService.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'original question' }],
  });
  const retained = curatedHistoryForTest(legacySuite0_historyService);
  legacySuite0_historyService.on('compressionLockReleased', () => {
    // `throw undefined` is a legal JS throw; a sentinel keyed on `undefined`
    // cannot distinguish it from "no throw", so it must be rethrown truthfully.
    const nothing = undefined;
    throw nothing;
  });
  legacySuite0_historyService.startCompression();
  legacySuite0_historyService.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'mid-stream content' }],
  });
  legacySuite0_historyService.rebuildWith(() => {
    legacySuite0_historyService.clear();
    for (const content of retained) {
      legacySuite0_historyService.add(content);
    }
  });
  // The thrown value is `undefined`, so this is asserted via a capture
  // rather than toThrow(), which cannot match a non-Error thrown value.
  let caught = false;
  try {
    legacySuite0_historyService.endCompression(
      { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
      1,
    );
  } catch {
    caught = true;
  }
  expect(caught).toBe(true);
  // The streaming slice is still applied despite the throwing release listener, and
  // the undefined throw is truthfully rethrown rather than swallowed.
  const texts = observeHistorySynchronouslyForTest(
    legacySuite0_historyService,
  ).map((entry) => {
    const block = entry.blocks[0];
    return describeBlock(block);
  });
  expect(texts).toStrictEqual(['original question', 'mid-stream content']);
}
let legacySuite0_historyService: HistoryService;
function legacyTest25() {
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
}
const legacyHook0 = () => {
  legacySuite0_historyService = new HistoryService();
};
const legacyHook1 = () => {
  legacySuite1_observed = [];
  legacySuite0_historyService.on('contentAdded', () => {
    legacySuite1_observed.push('contentAdded');
  });
  legacySuite0_historyService.on('compressionLockReleased', () => {
    legacySuite1_observed.push('compressionLockReleased');
  });
  legacySuite0_historyService.on('compressionEnded', () => {
    legacySuite1_observed.push('compressionEnded');
  });
};
describe('Compression locking / should queue adds during compression', () => {
  beforeEach(legacyHook0);
  it('should queue adds during compression', async () => {
    await expect(legacyTest0()).resolves.toBeUndefined();
  });
});
describe('Compression locking / never drops or rejects additions queued during a long compression', () => {
  beforeEach(legacyHook0);
  it('never drops or rejects additions queued during a long compression', () => {
    expect(legacyTest1).not.toThrow();
  });
});
describe('Compression locking / releases the compression lock even when the compression body throws', () => {
  beforeEach(legacyHook0);
  it('releases the compression lock even when the compression body throws', () => {
    expect(legacyTest2).not.toThrow();
  });
});
describe('Compression locking / should prevent duplicate IDs during compression rebuild', () => {
  beforeEach(legacyHook0);
  it('should prevent duplicate IDs during compression rebuild', async () => {
    await expect(legacyTest3()).resolves.toBeUndefined();
  });
});
describe('Compression locking / should handle getCurated during compression', () => {
  beforeEach(legacyHook0);
  it('should handle getCurated during compression', async () => {
    await expect(legacyTest4()).resolves.toBeUndefined();
  });
});
describe('Compression locking / should serialize multiple compressions', () => {
  beforeEach(legacyHook0);
  it('should serialize multiple compressions', async () => {
    await expect(legacyTest5()).resolves.toBeUndefined();
  });
});
describe('Compression locking > compressionLockReleased event / releases the lock on an argless endCompression without compressionEnded', () => {
  beforeEach(legacyHook0);
  beforeEach(legacyHook1);
  it('releases the lock on an argless endCompression without compressionEnded', () => {
    expect(legacyTest6).not.toThrow();
  });
});
describe('Compression locking > compressionLockReleased event / releases the lock on a failed-shaped endCompression without compressionEnded', () => {
  beforeEach(legacyHook0);
  beforeEach(legacyHook1);
  it('releases the lock on a failed-shaped endCompression without compressionEnded', () => {
    expect(legacyTest7).not.toThrow();
  });
});
describe('Compression locking > compressionLockReleased event / releases the lock and emits compressionEnded when a summary is provided', () => {
  beforeEach(legacyHook0);
  beforeEach(legacyHook1);
  it('releases the lock and emits compressionEnded when a summary is provided', () => {
    expect(legacyTest8).not.toThrow();
  });
});
describe('Compression locking > compressionLockReleased event / flushes streaming contentAdded after compressionLockReleased so recording captures it', () => {
  beforeEach(legacyHook0);
  beforeEach(legacyHook1);
  it('flushes streaming contentAdded after compressionLockReleased so recording captures it', () => {
    expect(legacyTest9).not.toThrow();
  });
});
describe('Compression locking > compressionLockReleased event / emits compressionLockReleased without a preceding startCompression', () => {
  beforeEach(legacyHook0);
  beforeEach(legacyHook1);
  it('emits compressionLockReleased without a preceding startCompression', () => {
    expect(legacyTest10).not.toThrow();
  });
});
describe('Compression locking > mid-compression content vs the rebuild clear (#3264) / preserves content queued before the rebuild clear, landing it after the rebuild', () => {
  beforeEach(legacyHook0);
  it('preserves content queued before the rebuild clear, landing it after the rebuild', () => {
    expect(legacyTest12).not.toThrow();
  });
});
describe('Compression locking > mid-compression content vs the rebuild clear (#3264) / flushes rebuild contentAdded before compressionLockReleased and streaming contentAdded after', () => {
  beforeEach(legacyHook0);
  it('flushes rebuild contentAdded before compressionLockReleased and streaming contentAdded after', () => {
    expect(legacyTest13).not.toThrow();
  });
});
describe('Compression locking > mid-compression content vs the rebuild clear (#3264) / keeps every queued streaming entry when several arrive before the rebuild clear', () => {
  beforeEach(legacyHook0);
  it('keeps every queued streaming entry when several arrive before the rebuild clear', () => {
    expect(legacyTest14).not.toThrow();
  });
});
describe('Compression locking > mid-compression content vs the rebuild clear (#3264) / flushes a late streaming add after the release events when an explicit rebuild runs first (#3338)', () => {
  beforeEach(legacyHook0);
  it('flushes a late streaming add after the release events when an explicit rebuild runs first (#3338)', () => {
    expect(legacyTest15).not.toThrow();
  });
});
describe('Compression locking > mid-compression content vs the rebuild clear (#3264) / flushes queued rebuild work in the rebuild phase when the callback throws after queueing it', () => {
  beforeEach(legacyHook0);
  it('flushes queued rebuild work in the rebuild phase when the callback throws after queueing it', () => {
    expect(legacyTest16).not.toThrow();
  });
});
describe('Compression locking > deferred asynchronous mutation ordering / keeps rebuild contentAdded inside the lock-release events when a replaceAll is in flight', () => {
  beforeEach(legacyHook0);
  it('keeps rebuild contentAdded inside the lock-release events when a replaceAll is in flight', async () => {
    await expect(legacyTest18()).resolves.toBeUndefined();
  });
});
describe('Compression locking > listener throw during flush / still applies the streaming phase and rethrows when a compressionLockReleased listener throws', () => {
  beforeEach(legacyHook0);
  it('still applies the streaming phase and rethrows when a compressionLockReleased listener throws', () => {
    expect(legacyTest20).not.toThrow();
  });
});
describe('Compression locking > listener throw during flush / still emits compressionLockReleased, preserves streaming content, and rethrows when a rebuild operation throws', () => {
  beforeEach(legacyHook0);
  it('still emits compressionLockReleased, preserves streaming content, and rethrows when a rebuild operation throws', () => {
    expect(legacyTest21).not.toThrow();
  });
});
describe('Compression locking > listener throw during flush / propagates a thrown undefined listener failure instead of swallowing it', () => {
  beforeEach(legacyHook0);
  it('propagates a thrown undefined listener failure instead of swallowing it', () => {
    expect(legacyTest22).not.toThrow();
  });
});
describe('CompressionOperationQueue high-water latch / re-arms the one-shot high-water diagnostic after clear() (#2852)', () => {
  it('re-arms the one-shot high-water diagnostic after clear() (#2852)', () => {
    expect(legacyTest25).not.toThrow();
  });
});
