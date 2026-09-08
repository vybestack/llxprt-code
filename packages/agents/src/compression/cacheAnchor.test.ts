/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the cache-anchor marker stamped by
 * `applyCompressionWithAnchor` (#3070 "caching during compression").
 *
 * The marker (`metadata.cacheAnchor`) is carried on content so it travels with
 * the history through atomic replacement. These tests prove:
 *  - exactly one preserved-head entry carries the marker after compression;
 *  - the marker survives the real `historyService.replaceAll()` publication;
 *  - stale markers from a previous compression are cleared;
 *  - when the prefix is destroyed (`topPreserved <= 0`) no entry is marked.
 *
 * Uses a real HistoryService so the replacement and chronology-stamping path is
 * exercised as production runs it.
 */

import { describe, it, expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { annotateCompressionSpan } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import { applyCompressionWithAnchor } from './cacheAnchor.js';

function human(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function ai(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function summary(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { isSummary: true, synthetic: true },
  };
}

function entryTexts(historyService: HistoryService): string[] {
  return historyService.getAll().map((entry) => {
    const block = entry.blocks[0];
    return block.type === 'text' ? block.text : `<${block.type}>`;
  });
}

function apply(
  historyService: HistoryService,
  newHistory: IContent[],
  topPreserved: number,
): Promise<void> {
  return applyCompressionWithAnchor(
    historyService,
    newHistory,
    topPreserved,
    'test-model',
    annotateCompressionSpan,
  );
}

describe('applyCompressionWithAnchor — cacheAnchor marker (#3070)', () => {
  it('marks exactly the last preserved-head entry and the marker survives replacement', async () => {
    const historyService = new HistoryService();
    // Seed an initial history so getRawHistory() is non-empty for annotate.
    for (const c of [human('old1'), ai('old2'), human('old3'), ai('old4')]) {
      historyService.add(c, 'test-model');
    }

    // Compressed result: 2 preserved head entries, a summary, 1 tail entry.
    // Production strategies reuse preserved entries from the stamped history.
    const stamped = historyService.getAll();
    const newHistory = [
      stamped[0],
      stamped[1],
      summary('<state_snapshot>compressed middle</state_snapshot>'),
      stamped[3],
    ];
    const topPreserved = 2;

    await apply(historyService, newHistory, topPreserved);

    const rebuilt = historyService.getAll();
    expect(rebuilt).toHaveLength(newHistory.length);

    // Exactly ONE entry carries the marker.
    const marked = rebuilt.filter((c) => c.metadata?.cacheAnchor === true);
    expect(marked).toHaveLength(1);

    // The marker is on the last preserved-head entry (index topPreserved - 1)
    // after atomic replacement.
    expect(rebuilt[topPreserved - 1].metadata?.cacheAnchor).toBe(true);
    // Atomic replacement stamps entries through the normal chronology path.
    expect(rebuilt[topPreserved - 1].metadata?.chronology?.seq).toBeDefined();
  });

  it('anchors the preserved-head tool content after a complete tool round-trip', async () => {
    const historyService = new HistoryService();
    const toolCallId = 'compression-tool-call';
    const roundTrip: IContent[] = [
      human('Read the file'),
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: toolCallId,
            name: 'read_file',
            parameters: { path: 'file.txt' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: toolCallId,
            toolName: 'read_file',
            result: 'contents',
            isComplete: true,
          },
        ],
      },
      ai('The file was read'),
    ];
    for (const content of roundTrip) {
      historyService.add(content, 'test-model');
    }
    const stamped = historyService.getAll();

    await apply(
      historyService,
      [
        stamped[0],
        stamped[1],
        stamped[2],
        summary('compressed remainder'),
        human('tail'),
      ],
      3,
    );

    const rebuilt = historyService.getAll();
    const anchored = rebuilt.filter(
      (content) => content.metadata?.cacheAnchor === true,
    );
    expect(anchored).toHaveLength(1);
    expect(anchored[0].speaker).toBe('tool');
    expect(anchored[0].blocks[0].type).toBe('tool_response');
  });

  it('clears stale markers so exactly one entry carries the marker after a second compression', async () => {
    const historyService = new HistoryService();
    for (const c of [human('seed1'), ai('seed2')]) {
      historyService.add(c, 'test-model');
    }

    // First compression: head of 2 entries reused from the stamped history.
    const stamped = historyService.getAll();
    await apply(
      historyService,
      [stamped[0], stamped[1], summary('first summary'), human('tail-a')],
      2,
    );
    const afterFirst = historyService.getAll();
    expect(
      afterFirst.filter((c) => c.metadata?.cacheAnchor === true),
    ).toHaveLength(1);

    // Second compression with the previous head reused (byte-identical) plus a
    // longer tail. The marker must move to the new boundary and the old one
    // must be cleared — never two markers at once.
    const reusedHead = afterFirst.slice(0, 2);
    await apply(
      historyService,
      [...reusedHead, summary('second summary'), human('tail-b'), ai('tail-c')],
      2,
    );
    const afterSecond = historyService.getAll();
    expect(
      afterSecond.filter((c) => c.metadata?.cacheAnchor === true),
    ).toHaveLength(1);
    expect(afterSecond[1].metadata?.cacheAnchor).toBe(true);
  });

  it('marks no entry when the prefix is destroyed (topPreserved <= 0)', async () => {
    const historyService = new HistoryService();
    for (const c of [human('seed1'), ai('seed2'), human('seed3')]) {
      historyService.add(c, 'test-model');
    }

    // A truncation strategy that preserves no head.
    await apply(
      historyService,
      [summary('full replacement'), human('only tail')],
      0,
    );

    const rebuilt = historyService.getAll();
    expect(
      rebuilt.filter((c) => c.metadata?.cacheAnchor === true),
    ).toHaveLength(0);
    // The anchor seq is reset (not advanced) when the prefix is destroyed.
    expect(historyService.getCacheAnchorSeq()).toBe(0);
  });

  it('advances the cache anchor seq to the last preserved-head entry', async () => {
    const historyService = new HistoryService();
    // Seed real history so the preserved-head entries carry chronology
    // markers, exactly as production does (the head is reused verbatim from
    // the existing history, not freshly minted).
    for (const c of [human('seed1'), ai('seed2'), human('seed3')]) {
      historyService.add(c, 'test-model');
    }
    const stamped = historyService.getAll();

    await apply(
      historyService,
      [stamped[0], stamped[1], summary('summary'), human('tail')],
      2,
    );

    const rebuilt = historyService.getAll();
    // stamped[1] was reused as the last preserved head; its seq carries over.
    const expectedSeq = stamped[1].metadata?.chronology?.seq;
    expect(expectedSeq).toBeDefined();
    expect(rebuilt[1].metadata?.chronology?.seq).toBe(expectedSeq);
    expect(historyService.getCacheAnchorSeq()).toBe(expectedSeq);
  });

  it('publishes compression as one atomic history mutation', async () => {
    const historyService = new HistoryService();
    historyService.add(human('original'), 'test-model');
    await historyService.waitForTokenUpdates();
    const original = historyService.getAll();
    let tokenUpdateCount = 0;
    historyService.on('tokensUpdated', () => {
      tokenUpdateCount += 1;
    });

    await apply(historyService, [original[0], summary('replacement')], 1);

    expect(historyService.getAll()).toHaveLength(2);
    expect(tokenUpdateCount).toBe(1);
  });
});

describe('applyCompressionWithAnchor under an active compression lock (#3338)', () => {
  it('flushes rebuild content before the lock release and keeps ordinary streaming adds on both sides streaming after it', async () => {
    const historyService = new HistoryService();
    for (const c of [
      human('original-1'),
      ai('original-2'),
      human('original-3'),
    ]) {
      historyService.add(c, 'test-model');
    }
    const stamped = historyService.getAll();
    const newHistory = [
      stamped[0],
      stamped[1],
      summary('compressed'),
      stamped[2],
    ];
    const topPreserved = 2;

    const observed: string[] = [];
    historyService.on('contentAdded', (content) => {
      const block = content.blocks[0];
      observed.push(
        `contentAdded:${block.type === 'text' ? block.text : block.type}`,
      );
    });
    let textsAtRelease: string[] | undefined;
    historyService.on('compressionLockReleased', () => {
      observed.push('compressionLockReleased');
      // Snapshot AT the release, not after endCompression: this is what
      // actually witnesses that the rebuild was committed first.
      textsAtRelease = entryTexts(historyService);
    });
    historyService.on('compressionEnded', () => {
      observed.push('compressionEnded');
    });

    historyService.startCompression();
    // An ordinary streaming add queued before the helper must not be treated as
    // rebuild work: it lands in the streaming phase after the release events.
    historyService.add(human('pre-helper-stream'));
    await apply(historyService, newHistory, topPreserved);
    // A late ordinary streaming add queued after the helper must also stay in the
    // streaming phase; it cannot be inferred from position relative to the rebuild.
    historyService.add(ai('post-helper-stream'));
    historyService.endCompression(summary('done'), stamped.length);

    // The rebuild is published as one atomic replacement (#3199), so it emits
    // no per-entry contentAdded events; the sibling #3070 case asserts that
    // atomicity directly. What #3338 guarantees is the ordering, which is
    // unchanged: the rebuild is committed before the lock release, and both
    // ordinary streaming adds fire after it in FIFO order.
    expect(observed).toStrictEqual([
      'compressionLockReleased',
      'compressionEnded',
      'contentAdded:pre-helper-stream',
      'contentAdded:post-helper-stream',
    ]);

    // Observed at the moment of release rather than inferred from the order of
    // the awaits above: the rebuild is already published, and neither queued
    // streaming add has landed yet. Without this the ordering guarantee was
    // only established by the test's own choreography.
    expect(textsAtRelease).toStrictEqual([
      'original-1',
      'original-2',
      'compressed',
      'original-3',
    ]);

    expect(entryTexts(historyService)).toStrictEqual([
      'original-1',
      'original-2',
      'compressed',
      'original-3',
      'pre-helper-stream',
      'post-helper-stream',
    ]);
  });
});
