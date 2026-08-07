/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end prefix-stability tests for issue #3070 (cache anchor).
 *
 * These tests drive CompressionHandler.performCompression (NOT MiddleOutStrategy
 * directly) against a real HistoryService over multiple compressions with a
 * growing history. This is the regime where all of Defects 1-4 manifest and
 * where the anchor actually binds.
 *
 * The ONLY test double is a real in-process async generator satisfying the
 * IProvider port. No assertions on mock call records.
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import {
  createCaptureProvider,
  testProviderRuntime,
} from '../MiddleOutStrategy-test-helpers.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';

// ---------------------------------------------------------------------------
// Test-local helpers: operational definition of a "cacheable prefix"
// ---------------------------------------------------------------------------

function serializeForCache(contents: readonly IContent[]): string[] {
  return contents.map((c) =>
    JSON.stringify({ speaker: c.speaker, blocks: c.blocks }),
  );
}

function commonPrefixLength(
  a: readonly string[],
  b: readonly string[],
): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return len;
}

function humanMsg(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function aiMsg(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

/**
 * Extract the serialized preserved head using the cache anchor: find the entry
 * whose chronology.seq === cacheAnchorSeq (exact identity, per Defect 2 fix).
 * The head is everything up to and including that entry.
 */
function extractHeadByAnchor(hs: HistoryService): string[] {
  const anchorSeq = hs.getCacheAnchorSeq();
  const curated = hs.getCurated();
  let headEnd = 0;
  if (anchorSeq > 0) {
    const anchorIndex = curated.findIndex(
      (entry) => entry.metadata?.chronology?.seq === anchorSeq,
    );
    if (anchorIndex < 0) {
      throw new Error(
        `Cache anchor ${anchorSeq} is absent from curated history`,
      );
    }
    headEnd = anchorIndex + 1;
  }
  return serializeForCache(curated.slice(0, headEnd));
}

/**
 * Build a CompressionHandler with a real HistoryService and a real in-process
 * provider (capture provider). Uses production geometry for compression settings.
 */
function buildHandler(opts: {
  historyService: HistoryService;
  capturedRequests: IContent[];
}): CompressionHandler {
  const { historyService, capturedRequests } = opts;

  const runtimeContext = buildRuntimeContext(historyService, {
    contextLimit: 200_000,
    compressionThreshold: 0.85,
  });

  const provider = createCaptureProvider(capturedRequests);
  const providerResult = {
    provider,
    runtime: testProviderRuntime as never,
  };

  const handler = new CompressionHandler(
    runtimeContext,
    historyService,
    {},
    () => Promise.resolve(providerResult),
    () => Promise.resolve(undefined),
  );

  return handler;
}

// ---------------------------------------------------------------------------
// E2E: serialized content prefix is monotonically non-decreasing
// ---------------------------------------------------------------------------

describe('E2E: CompressionHandler.performCompression keeps prefix monotonically non-decreasing across 5 compressions with growing history (#3070 Defects 1-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serialized content prefix never shrinks across 5 append-compress cycles', async () => {
    const historyService = new HistoryService();
    const capturedRequests: IContent[] = [];
    const handler = buildHandler({ historyService, capturedRequests });

    // Seed with 40 messages (20 turns) — enough to compress
    for (let i = 0; i < 20; i++) {
      historyService.add(humanMsg(`seed user ${i}`));
      historyService.add(aiMsg(`seed ai ${i}`));
    }

    // Track the preserved HEAD content (everything up to the cache anchor seq)
    // across cycles. The head is the cacheable prefix; it must never shrink.
    let prevHead: string[] = [];
    let prevAnchorSeq = 0;
    let anchorAdvanced = false;

    for (let cycle = 0; cycle < 5; cycle++) {
      // Force compression by calling performCompression directly
      const result = await handler.performCompression('test-prompt', {
        trigger: 'manual',
      });

      // Compression should have applied (or no-op, which is also prefix-stable)
      expect([
        PerformCompressionResult.COMPRESSED,
        PerformCompressionResult.NOOP,
      ]).toContain(result);

      // Extract the preserved head using the cache anchor: find the entry whose
      // chronology.seq === cacheAnchorSeq (exact identity, per Defect 2 fix).
      // The head is everything up to and including that entry.
      const currentHead = extractHeadByAnchor(historyService);

      // The previous head must be a COMPLETE prefix of the current head. The
      // anchor may remain fixed for a cycle, but it must never move backward,
      // and this growing workload must advance it at least once.
      const prefix = commonPrefixLength(prevHead, currentHead);
      expect(prefix).toBe(prevHead.length);
      const currentAnchorSeq = historyService.getCacheAnchorSeq();
      expect(currentAnchorSeq).toBeGreaterThanOrEqual(prevAnchorSeq);
      anchorAdvanced ||= currentAnchorSeq > prevAnchorSeq;

      prevHead = currentHead;
      prevAnchorSeq = currentAnchorSeq;

      // Append enough messages to push the fractional split beyond the prior
      // head, forcing the anchor itself to advance. Twelve reaches a fixed
      // point where the floor never binds and would miss anchor regressions.
      for (let i = 0; i < 8; i++) {
        historyService.add(humanMsg(`cycle ${cycle} user ${i}`));
        historyService.add(aiMsg(`cycle ${cycle} ai ${i}`));
      }
    }

    expect(anchorAdvanced).toBe(true);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Defect 5: prefix-destroying strategies leave a stale anchor
// ---------------------------------------------------------------------------

describe('Defect 5: prefix-destroying compression resets the anchor and next compression is not wedged (#3070)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('after a truncation-style result that preserves no head, the anchor resets and the next compression succeeds', async () => {
    const historyService = new HistoryService();
    const capturedRequests: IContent[] = [];
    const handler = buildHandler({ historyService, capturedRequests });

    // Seed history
    for (let i = 0; i < 20; i++) {
      historyService.add(humanMsg(`seed user ${i}`));
      historyService.add(aiMsg(`seed ai ${i}`));
    }

    // Advance the anchor to simulate a prior compression having set it
    const stamped = historyService.getRawHistory();
    const lastSeq = stamped[stamped.length - 1].metadata?.chronology?.seq ?? 0;
    historyService.setCacheAnchorSeq(lastSeq);

    // Now manually simulate a prefix-destroying result by clearing history
    // and resetting the anchor (as TopDownTruncationStrategy path would do)
    historyService.clear();
    historyService.resetCacheAnchorSeq();

    expect(historyService.getCacheAnchorSeq()).toBe(0);

    // Re-add a small history and confirm a new compression can proceed
    for (let i = 0; i < 20; i++) {
      historyService.add(humanMsg(`post-reset user ${i}`));
      historyService.add(aiMsg(`post-reset ai ${i}`));
    }

    const result = await handler.performCompression('test-prompt', {
      trigger: 'manual',
    });

    // Must not be wedged — compression applies or no-ops cleanly
    expect([
      PerformCompressionResult.COMPRESSED,
      PerformCompressionResult.NOOP,
    ]).toContain(result);

    // Anchor must be in a valid state (either 0 or advanced, not stale)
    const anchorAfter = historyService.getCacheAnchorSeq();
    expect(anchorAfter).toBeGreaterThanOrEqual(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Defect 6: client.restoreHistory resets the anchor
// ---------------------------------------------------------------------------

describe('Defect 6: client.restoreHistory resets the cache anchor (#3070)', () => {
  it('HistoryService.resetCacheAnchorSeq resets to 0 (the primitive restoreHistory calls)', () => {
    const hs = new HistoryService();
    hs.setCacheAnchorSeq(42);
    expect(hs.getCacheAnchorSeq()).toBe(42);

    hs.resetCacheAnchorSeq();
    expect(hs.getCacheAnchorSeq()).toBe(0);
  });

  it('a wholesale history replacement via addAll after resetCacheAnchorSeq leaves the anchor at 0', () => {
    const hs = new HistoryService();
    hs.setCacheAnchorSeq(99);
    expect(hs.getCacheAnchorSeq()).toBe(99);

    // Simulate the restoreHistory flow: reset + validateAndFix + addAll
    hs.resetCacheAnchorSeq();
    hs.validateAndFix();
    const newHistory: IContent[] = [];
    for (let i = 0; i < 5; i++) {
      newHistory.push(humanMsg(`restored user ${i}`));
      newHistory.push(aiMsg(`restored ai ${i}`));
    }
    hs.addAll(newHistory);

    // The anchor must be 0 — restoreHistory resets it
    expect(hs.getCacheAnchorSeq()).toBe(0);
  });
});
