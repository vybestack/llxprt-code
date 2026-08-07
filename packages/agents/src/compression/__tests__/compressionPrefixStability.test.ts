/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Prefix-stability tests for issue #3070.
 *
 * Defect A: the compression trigger collapsed to zero on small context windows
 * because the completion budget defaulted to a flat 65,536 regardless of the
 * window size, and a `Math.max(0, ...)` clamp silently converted the
 * contradiction into every-send compression.
 *
 * Defect B: the preserved-head split boundary was a fraction of the CURRENT
 * history length, so it shrank after each compression, destroying the
 * cacheable prefix for every provider. The fix is a monotonic cache anchor
 * derived from `metadata.chronology.seq`.
 *
 * The ONLY test double is a real in-process async generator satisfying the
 * IProvider port. Every assertion is on observable output (returned
 * newHistory, pure-function return/throw). Metadata is excluded from the
 * cache-prefix proxy because chronology is never serialized to a provider.
 */

import { describe, it, expect } from '../../testApi.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  CompressionContext,
  StrategyCompressionResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { MiddleOutStrategy } from '../MiddleOutStrategy.js';
import {
  buildContext,
  humanMsg,
  aiTextMsg,
  aiToolCallMsg,
  toolResponseMsg,
} from '../MiddleOutStrategy-test-helpers.js';
import {
  getCompletionBudget,
  DEFAULT_COMPLETION_BUDGET,
  DEFAULT_COMPLETION_FRACTION,
  InvalidContextBudgetError,
} from '../compressionBudgeting.js';
import { resolveHeadAnchorSeq } from '../cacheAnchor.js';

// ---------------------------------------------------------------------------
// Test-local helpers: operational definition of a "cacheable prefix"
// ---------------------------------------------------------------------------

/**
 * Serialize content the way an implicit-cache provider matches on it:
 * speaker + blocks only. Chronology metadata is deliberately excluded because
 * it is never sent to a provider.
 */
function serializeForCache(contents: readonly IContent[]): string[] {
  return contents.map((c) =>
    JSON.stringify({ speaker: c.speaker, blocks: c.blocks }),
  );
}

/** Count of equal leading serialised entries between two arrays. */
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

/**
 * Index of the end of the preserved head, using the strategy-reported
 * preserved-head length rather than searching for a summary entry. Searching
 * for the FIRST isSummary entry is wrong from the second compression onward
 * because the previous compression's summary sits inside the preserved head
 * and still carries isSummary metadata (#3070 test defect).
 */
function findHeadEnd(
  history: readonly IContent[],
  topPreserved: number,
): number {
  return Math.min(topPreserved, history.length);
}

// ---------------------------------------------------------------------------
// Context builder: real chronology + cache anchor
// ---------------------------------------------------------------------------

/** Production geometry: preserveThreshold=0.4, topPreserveThreshold=0.2. */
const PRODUCTION_PRESERVE = 0.4;
const PRODUCTION_TOP_PRESERVE = 0.2;

/** Stamp chronology onto plain messages via a real HistoryService. */
function stampHistory(messages: IContent[]): IContent[] {
  const hs = new HistoryService();
  for (const msg of messages) {
    hs.add(msg);
  }
  return [...hs.getRawHistory()];
}

/** Build a CompressionContext from already-stamped history + anchor. */
function buildCtx(
  stampedHistory: IContent[],
  anchor: number,
): CompressionContext {
  return {
    ...buildContext({
      history: stampedHistory,
      preserveThreshold: PRODUCTION_PRESERVE,
      topPreserveThreshold: PRODUCTION_TOP_PRESERVE,
    }),
    cacheAnchorSeq: anchor,
  };
}

/**
 * Re-stamp a strategy-produced newHistory through a fresh HistoryService,
 * preserving existing chronology markers on head/bottom entries and minting
 * new ones for the synthetic summary/continuation entries, then append
 * additional messages.
 */
function restampAndAppend(
  newHistory: IContent[],
  extra: IContent[],
): IContent[] {
  const hs = new HistoryService();
  for (const entry of newHistory) {
    hs.add(entry);
  }
  for (const msg of extra) {
    hs.add(msg);
  }
  return [...hs.getRawHistory()];
}

function assertApplied(result: StrategyCompressionResult): {
  newHistory: IContent[];
  topPreserved: number;
} {
  if (result.kind !== 'applied') {
    throw new Error(
      `Expected compression to apply but got kind=${result.kind}`,
    );
  }
  return {
    newHistory: result.newHistory,
    topPreserved: result.metadata.topPreserved,
  };
}

// ---------------------------------------------------------------------------
// A3: trigger arithmetic (budget fraction + fail-fast)
// ---------------------------------------------------------------------------

describe('A3: completion-budget trigger arithmetic (#3070 Defect A)', () => {
  const THRESHOLD = 0.85;

  function triggerFor(contextLimit: number, budget: number): number {
    return THRESHOLD * (contextLimit - budget);
  }

  it('with an explicit 65536 budget: 200k → 114294.4, 100k → 29294.4 (ratio > 3.5)', () => {
    const budget = getCompletionBudget(
      { maxOutputTokens: 65_536 } as never,
      'm',
      undefined,
      undefined,
      200_000,
    );
    const trigger200k = triggerFor(200_000, budget);
    const trigger100k = triggerFor(100_000, budget);

    expect(budget).toBe(65_536);
    expect(trigger200k).toBeCloseTo(114_294.4, 1);
    expect(trigger100k).toBeCloseTo(29_294.4, 1);
    expect(trigger200k / trigger100k).toBeGreaterThan(3.5);
  });

  it('throws InvalidContextBudgetError when an explicit budget >= context-limit', () => {
    expect(() =>
      getCompletionBudget(
        { maxOutputTokens: 200_000 } as never,
        'm',
        undefined,
        undefined,
        200_000,
      ),
    ).toThrow(InvalidContextBudgetError);
  });

  it('throws when a live maxOutputTokens setting >= context-limit', () => {
    const settingsService = {
      get: (key: string) => (key === 'maxOutputTokens' ? 50_000 : undefined),
    };
    expect(() =>
      getCompletionBudget({}, 'm', undefined, settingsService, 50_000),
    ).toThrow(InvalidContextBudgetError);
  });

  it('default budget on a 32768 window produces a POSITIVE trigger (every-send loop is gone)', () => {
    const budget = getCompletionBudget({}, 'm', undefined, undefined, 32_768);
    const trigger = triggerFor(32_768, budget);

    // min(65536, floor(32768 * 0.5)) = 16384
    expect(budget).toBe(16_384);
    expect(trigger).toBeCloseTo(13_926.4, 1);
    expect(trigger).toBeGreaterThan(0);
  });

  it('default budget is identical to the flat 65536 for every window >= 131072', () => {
    for (const limit of [131_072, 200_000, 1_000_000]) {
      const budget = getCompletionBudget({}, 'm', undefined, undefined, limit);
      expect(budget).toBe(DEFAULT_COMPLETION_BUDGET);
    }
  });

  it('DEFAULT_COMPLETION_FRACTION is 0.5', () => {
    expect(DEFAULT_COMPLETION_FRACTION).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// A4: HistoryService cache-anchor contract
// ---------------------------------------------------------------------------

describe('A4: HistoryService cache-anchor contract (#3070 Defect B)', () => {
  it('a fresh service reports 0', () => {
    const hs = new HistoryService();
    expect(hs.getCacheAnchorSeq()).toBe(0);
  });

  it('setCacheAnchorSeq tracks exact identity, including a numerically lower seq', () => {
    const hs = new HistoryService();
    hs.setCacheAnchorSeq(10);
    expect(hs.getCacheAnchorSeq()).toBe(10);
    hs.setCacheAnchorSeq(5);
    expect(hs.getCacheAnchorSeq()).toBe(5);
  });

  it('setCacheAnchorSeq rejects non-positive and non-integer identities', () => {
    const hs = new HistoryService();
    expect(() => hs.setCacheAnchorSeq(0)).toThrow();
    expect(() => hs.setCacheAnchorSeq(1.5)).toThrow();
  });

  it('clear() preserves the anchor (compression rebuild survives)', () => {
    const hs = new HistoryService();
    hs.add(humanMsg('msg'));
    hs.setCacheAnchorSeq(3);
    hs.clear();
    expect(hs.getCacheAnchorSeq()).toBe(3);
  });

  it('resetCacheAnchorSeq resets to 0 (session-reset path)', () => {
    const hs = new HistoryService();
    hs.setCacheAnchorSeq(7);
    hs.resetCacheAnchorSeq();
    expect(hs.getCacheAnchorSeq()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A1 + A2: head never shrinks across successive compressions
// ---------------------------------------------------------------------------

describe('A1: preserved head never shrinks across successive compressions (#3070 Defect B)', () => {
  it('40 messages → head preserved after second compression with anchor', async () => {
    const strategy = new MiddleOutStrategy();

    // 40 plain human/ai messages (no tool calls → boundary adjustment is no-op)
    const baseHistory: IContent[] = [];
    for (let i = 0; i < 20; i++) {
      baseHistory.push(humanMsg(`user ${i}`));
      baseHistory.push(aiTextMsg(`ai ${i}`));
    }

    // First compression, no anchor yet
    const stamped1 = stampHistory(baseHistory);
    const ctx1 = buildCtx(stamped1, 0);
    const applied1 = assertApplied(await strategy.compress(ctx1));
    const newHistory1 = applied1.newHistory;

    const head1End = findHeadEnd(newHistory1, applied1.topPreserved);
    const head1 = newHistory1.slice(0, head1End);
    const serializedHead1 = serializeForCache(head1);

    // Anchor = seq of the last preserved head entry, via the production path
    const anchorSeq = resolveHeadAnchorSeq(newHistory1, applied1.topPreserved);
    expect(typeof anchorSeq).toBe('number');

    // Append 6 more messages and re-stamp
    const extra: IContent[] = [];
    for (let i = 0; i < 3; i++) {
      extra.push(humanMsg(`new user ${i}`));
      extra.push(aiTextMsg(`new ai ${i}`));
    }
    const history2 = restampAndAppend(newHistory1, extra);

    // Second compression WITH the anchor
    const ctx2 = buildCtx(history2, anchorSeq as number);
    const applied2 = assertApplied(await strategy.compress(ctx2));
    const newHistory2 = applied2.newHistory;

    const head2End = findHeadEnd(newHistory2, applied2.topPreserved);
    const head2 = newHistory2.slice(0, head2End);
    const serializedHead2 = serializeForCache(head2);

    // The first head must be a COMPLETE CONTENT prefix of the second head
    const prefix = commonPrefixLength(serializedHead1, serializedHead2);
    expect(prefix).toBe(serializedHead1.length);
  });
});

describe('A2: serialized head content never decreases across 5 append-compress cycles (#3070 Defect B)', () => {
  it('5 cycles of append-12-then-compress keep the head content monotonically non-decreasing', async () => {
    const strategy = new MiddleOutStrategy();

    // Start with enough messages to compress
    const baseHistory: IContent[] = [];
    for (let i = 0; i < 20; i++) {
      baseHistory.push(humanMsg(`user ${i}`));
      baseHistory.push(aiTextMsg(`ai ${i}`));
    }

    let currentHistory = stampHistory(baseHistory);
    let anchor = 0;
    let prevSerializedHead: string[] = [];

    for (let cycle = 0; cycle < 5; cycle++) {
      const ctx = buildCtx(currentHistory, anchor);
      const applied = assertApplied(await strategy.compress(ctx));
      const newHistory = applied.newHistory;

      const headEnd = findHeadEnd(newHistory, applied.topPreserved);
      const head = newHistory.slice(0, headEnd);
      const serializedHead = serializeForCache(head);

      // Content prefix must be monotonically non-decreasing
      const prefix = commonPrefixLength(prevSerializedHead, serializedHead);
      expect(prefix).toBe(prevSerializedHead.length);
      prevSerializedHead = serializedHead;

      // Advance anchor via the production path (resolveHeadAnchorSeq)
      const newAnchor = resolveHeadAnchorSeq(newHistory, applied.topPreserved);
      if (typeof newAnchor === 'number') {
        anchor = newAnchor;
      }

      // Append 12 more and re-stamp
      const extra: IContent[] = [];
      for (let i = 0; i < 6; i++) {
        extra.push(humanMsg(`cycle${cycle} user ${i}`));
        extra.push(aiTextMsg(`cycle${cycle} ai ${i}`));
      }
      currentHistory = restampAndAppend(newHistory, extra);
    }
  });
});

// ---------------------------------------------------------------------------
// A5: invariants hold under the anchor — UNMATCHED tool call
// ---------------------------------------------------------------------------

describe('A5: anchor invariants (#3070 Defect B)', () => {
  it('anchor floor HOLDS when an UNMATCHED tool_call sits at the boundary — no silent drop below floor', async () => {
    const strategy = new MiddleOutStrategy();

    // Build history where an UNMATCHED tool_call sits at/near the anchor floor.
    // The anchor floor is set to the entry just before the unmatched tool_call,
    // so adjustForToolCallBoundary would try to move the split backward below
    // the floor. The fix must search FORWARD for a valid split at or above the
    // floor, or return a clean structural no-op.
    const history: IContent[] = [
      humanMsg('h0'),
      aiTextMsg('a1'),
      aiTextMsg('a2'),
      aiTextMsg('a3'),
      aiTextMsg('a4'),
      aiTextMsg('a5'),
      aiTextMsg('a6'),
      aiTextMsg('a7'),
      // Unmatched tool_call at index 8 — no matching tool_response follows
      aiToolCallMsg({ id: 'tc-orphan', name: 'interrupted_tool' }),
      humanMsg('h9'),
      aiTextMsg('a10'),
      humanMsg('h11'),
      aiTextMsg('a12'),
      humanMsg('h13'),
      aiTextMsg('a14'),
      humanMsg('h15'),
      aiTextMsg('a16'),
      humanMsg('h17'),
      aiTextMsg('a18'),
      humanMsg('h19'),
      aiTextMsg('a20'),
    ];

    const stamped = stampHistory(history);
    // Anchor to the seq of index 7 (a7), so the floor is index 8
    const anchorSeq = stamped[7].metadata?.chronology?.seq ?? 0;

    const ctx = buildCtx(stamped, anchorSeq);
    const result = await strategy.compress(ctx);

    // Either the anchor floor held (applied with topPreserved >= 8) or a clean
    // structural no-op was returned. The floor must NEVER be silently violated.
    if (result.kind === 'applied') {
      const topPreserved = result.metadata.topPreserved;
      // The floor was 8 (anchorIndex 7 + 1). topPreserved must be >= 8.
      expect(topPreserved).toBeGreaterThanOrEqual(8);
    } else {
      // Clean structural no-op is acceptable
      expect(result.kind).toBe('noop');
    }
  });
  it('keeps a matched tool call and response on the same side of the anchor floor', async () => {
    const strategy = new MiddleOutStrategy();
    const history: IContent[] = [
      humanMsg('h0'),
      aiTextMsg('a1'),
      aiTextMsg('a2'),
      aiTextMsg('a3'),
      aiTextMsg('a4'),
      aiTextMsg('a5'),
      aiTextMsg('a6'),
      aiTextMsg('a7'),
      aiToolCallMsg({ id: 'tc-matched', name: 'matched_tool' }),
      toolResponseMsg('tc-matched', 'matched_tool', 'result'),
      humanMsg('h10'),
      aiTextMsg('a11'),
      humanMsg('h12'),
      aiTextMsg('a13'),
      humanMsg('h14'),
      aiTextMsg('a15'),
      humanMsg('h16'),
      aiTextMsg('a17'),
      humanMsg('h18'),
      aiTextMsg('a19'),
      humanMsg('h20'),
      aiTextMsg('a21'),
    ];
    const stamped = stampHistory(history);
    const anchorSeq = stamped[7].metadata?.chronology?.seq ?? 0;

    const result = await strategy.compress(buildCtx(stamped, anchorSeq));
    if (result.kind !== 'applied') {
      throw new Error('Expected matched tool boundary compression to apply');
    }

    const preserved = result.newHistory.slice(0, result.metadata.topPreserved);
    const callIndex = preserved.findIndex((entry) =>
      entry.blocks.some(
        (block) => block.type === 'tool_call' && block.id === 'tc-matched',
      ),
    );
    const responseIndex = preserved.findIndex((entry) =>
      entry.blocks.some(
        (block) =>
          block.type === 'tool_response' && block.callId === 'tc-matched',
      ),
    );
    expect(callIndex === -1).toBe(responseIndex === -1);
    if (callIndex >= 0) {
      expect(responseIndex).toBeGreaterThan(callIndex);
    }
  });

  it('anchor that would push past the bottom split yields a clean structural no-op with unmodified history', async () => {
    const strategy = new MiddleOutStrategy();

    const history: IContent[] = [];
    for (let i = 0; i < 10; i++) {
      history.push(humanMsg(`user ${i}`));
      history.push(aiTextMsg(`ai ${i}`));
    }

    // Stamp to get seqs, then set the anchor to the last entry's seq
    const stamped = stampHistory(history);
    const anchorSeq =
      stamped[stamped.length - 1].metadata?.chronology?.seq ?? 0;

    const ctx = buildCtx(stamped, anchorSeq);
    const result = await strategy.compress(ctx);

    // An anchor at the very end pushes topSplit past bottomSplit → structural no-op
    expect(result.kind).toBe('noop');
  });
});

// ---------------------------------------------------------------------------
// A6: resolveHeadAnchorSeq — the seq handed to the anchor after a compression
// ---------------------------------------------------------------------------

describe('A6: resolveHeadAnchorSeq (#3070 Defect B)', () => {
  it('returns the seq of the last preserved head entry by topPreserved index', () => {
    const stamped = stampHistory([
      humanMsg('h0'),
      aiTextMsg('a1'),
      humanMsg('h2'),
    ]);
    const summary: IContent = {
      ...aiTextMsg('<state_snapshot>summary</state_snapshot>'),
      metadata: { isSummary: true },
    };
    const compressed = [stamped[0], stamped[1], summary, stamped[2]];

    // topPreserved = 2 → last head entry is index 1
    expect(resolveHeadAnchorSeq(compressed, 2)).toBe(
      stamped[1].metadata?.chronology?.seq,
    );
  });

  it('returns undefined when topPreserved is 0 (prefix destroyed)', () => {
    const stamped = stampHistory([humanMsg('h0'), aiTextMsg('a1')]);

    expect(resolveHeadAnchorSeq(stamped, 0)).toBeUndefined();
  });

  it('throws when topPreserved exceeds history length', () => {
    const stamped = stampHistory([humanMsg('h0'), aiTextMsg('a1')]);

    expect(() => resolveHeadAnchorSeq(stamped, 10)).toThrow(
      'topPreserved 10 exceeds history length 2',
    );
  });

  it('the resolved seq is accepted by setCacheAnchorSeq and pins the head', () => {
    const hs = new HistoryService();
    const stamped = stampHistory([
      humanMsg('h0'),
      aiTextMsg('a1'),
      humanMsg('h2'),
    ]);
    const summary: IContent = {
      ...aiTextMsg('<state_snapshot>summary</state_snapshot>'),
      metadata: { isSummary: true },
    };
    const seq = resolveHeadAnchorSeq(
      [stamped[0], stamped[1], summary, stamped[2]],
      2,
    );
    expect(seq).toBeDefined();
    if (seq === undefined) {
      throw new Error('Expected a cache-anchor chronology seq');
    }

    hs.setCacheAnchorSeq(seq);

    expect(hs.getCacheAnchorSeq()).toBe(seq);
  });
});
