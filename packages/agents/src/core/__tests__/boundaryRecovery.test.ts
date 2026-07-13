/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for differential pending-boundary recovery and hook
 * boundary-metadata resolution (issue #2306). These assert observable
 * behavior — returned classifications and recovered pending arrays — and never
 * assert on mock call counts/arguments.
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  recoverPendingBoundary,
  resolvePendingFromHookBoundary,
  resolvePendingBoundaryFromHook,
  snapshotContents,
  snapshotMatches,
} from '../boundaryRecovery.js';
import { applyRequestModifications } from '../streamRequestHelpers.js';
import { ContentConverters } from '@vybestack/llxprt-code-core/services/history/ContentConverters.js';
import { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';

// ---------------------------------------------------------------------------
// IContent builders
// ---------------------------------------------------------------------------

function histUser(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { id: `hist-${text}`, timestamp: 1 },
  };
}

function histAi(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { id: `hist-ai-${text}`, timestamp: 2 },
  };
}

function pendingUser(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { id: `pending-${text}`, timestamp: 3 },
  };
}

/**
 * Simulate the hook translator text-only round-trip: convert to Gemini
 * Content (text-only, fresh IDs dropped) and back to IContent.
 */
function roundTrip(contents: IContent[]): IContent[] {
  return ContentConverters.toIContents(
    ContentConverters.toGeminiContents(contents),
  );
}

// ---------------------------------------------------------------------------
// recoverPendingBoundary
// ---------------------------------------------------------------------------

describe('recoverPendingBoundary', () => {
  it('classifies unchanged when modified equals original (projection)', () => {
    const history = [histUser('hello'), histAi('hi there')];
    const pending = [pendingUser('question')];
    const r = recoverPendingBoundary([...history, ...pending], pending.length, [
      ...history,
      ...pending,
    ]);
    expect(r.classification).toBe('unchanged');
    expect(r.pendingContents).toHaveLength(1);
    expect(r.pendingContents?.[0]).toBe(pending[0]);
  });

  it('recovers the pending suffix even after a text-only round-trip strips metadata/ids', () => {
    const history = [histUser('hello'), histAi('hi there')];
    const pending = [pendingUser('question')];
    const original = [...history, ...pending];
    const r = recoverPendingBoundary(
      original,
      pending.length,
      roundTrip(original),
    );
    expect(r.classification).toBe('unchanged');
    expect(r.pendingContents).toHaveLength(1);
    expect(r.pendingContents?.[0].blocks).toStrictEqual([
      { type: 'text', text: 'question' },
    ]);
  });

  it('projection collision (duplicate identical user messages) does not break boundary recovery', () => {
    const history = [histUser('dup'), histAi('reply'), histUser('dup')];
    const pending = [pendingUser('question')];
    const original = [...history, ...pending];
    const r = recoverPendingBoundary(
      original,
      pending.length,
      roundTrip(original),
    );
    expect(r.classification).toBe('unchanged');
    expect(r.pendingContents).toHaveLength(1);
    expect(r.pendingContents?.[0].blocks).toStrictEqual([
      { type: 'text', text: 'question' },
    ]);
  });

  it('classifies appended when new content is added after the pending region', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const r = recoverPendingBoundary([...history, ...pending], pending.length, [
      ...history,
      ...pending,
      histAi('extra assistant note'),
    ]);
    expect(r.classification).toBe('appended');
    expect(r.pendingContents).toHaveLength(2);
  });

  it('classifies modified-pending when the pending suffix differs but length is equal', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const r = recoverPendingBoundary([...history, ...pending], pending.length, [
      ...history,
      pendingUser('rewritten question'),
    ]);
    expect(r.classification).toBe('modified-pending');
    expect(r.pendingContents).toHaveLength(1);
    expect(r.pendingContents?.[0].blocks).toStrictEqual([
      { type: 'text', text: 'rewritten question' },
    ]);
  });

  it('classifies inserted-at-boundary when extra content appears between history and the still-present original pending', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    // Insert a NEW item between history and the original pending (which is
    // still present at the END).
    const modified = [...history, histAi('injected'), ...pending];

    const result = recoverPendingBoundary(original, pending.length, modified);

    expect(result.classification).toBe('inserted-at-boundary');
    expect(result.pendingContents).toHaveLength(2);
  });

  it('classifies replaced-pending when prefix preserved, length differs, and tail does not start with original pending', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    // Longer modified, but the new tail does NOT start with the original
    // pending projection (the original pending was replaced/restructured).
    const modified = [
      ...history,
      histAi('brand new tail item one'),
      histAi('brand new tail item two'),
    ];

    const result = recoverPendingBoundary(original, pending.length, modified);

    expect(result.classification).toBe('replaced-pending');
    expect(result.pendingContents).toHaveLength(2);
  });

  it('classifies replaced-pending when prefix preserved and tail is shortened (pending deleted)', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    // Shorter: the pending was deleted entirely.
    const modified = [...history];

    const result = recoverPendingBoundary(original, pending.length, modified);

    expect(result.classification).toBe('replaced-pending');
    expect(result.pendingContents).toHaveLength(0);
  });

  it('classifies prepended but returns undefined pending (prepended content lives on the history side — unrecoverable for compression)', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    const modified = [histUser('preamble'), ...original];

    const result = recoverPendingBoundary(original, pending.length, modified);

    // F1: pure-prepend is recognized as 'prepended' but UNRECOVERABLE.
    // Compression recomposes from HistoryService.getCurated() + pendingContents,
    // so a prepended preamble would be silently dropped whenever compression
    // runs. This is analogous to the modified-history case (also undefined).
    expect(result.classification).toBe('prepended');
    expect(result.pendingContents).toBeUndefined();
  });

  it('classifies modified-history and returns undefined pending (history edits must not be silently discarded by compression)', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    // History rewritten, pending suffix preserved by projection.
    const modified = [histUser('rewritten history'), ...pending];

    const result = recoverPendingBoundary(original, pending.length, modified);

    // Issue #2306: modified-history boundary is UNRECOVERABLE. Recomposition
    // rebuilds history from HistoryService, so recovering pending here would
    // let compression silently discard the hook's history modifications.
    expect(result.classification).toBe('modified-history');
    expect(result.pendingContents).toBeUndefined();
  });

  it('classifies modified-history (undefined pending) even when only the first history item changed', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    // First history item rewritten; rest (including pending) preserved.
    const modified = [histUser('changed'), histAi('hi'), ...pending];

    const result = recoverPendingBoundary(original, pending.length, modified);

    expect(result.classification).toBe('modified-history');
    expect(result.pendingContents).toBeUndefined();
  });

  it('returns undefined (replaced-all) when nothing matches and no original items are projection-present', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    const modified = [
      histUser('totally'),
      histAi('different'),
      pendingUser('conversation'),
    ];

    const result = recoverPendingBoundary(original, pending.length, modified);

    expect(result.pendingContents).toBeUndefined();
    expect(result.classification).toBe('replaced-all');
  });

  it('returns undefined (complex) when some original items are still projection-present but unmatchable', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    // 'hello' (a history item) is still present, but not in a recoverable
    // prefix or suffix position.
    const modified = [histUser('hello'), pendingUser('q'), histAi('injected')];

    const result = recoverPendingBoundary(original, pending.length, modified);

    expect(result.pendingContents).toBeUndefined();
    expect(result.classification).toBe('complex');
  });

  it('returns undefined (replaced-all) for an empty modified array (wholesale deletion)', () => {
    const history = [histUser('hello')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    const modified: IContent[] = [];

    const result = recoverPendingBoundary(original, pending.length, modified);

    expect(result.pendingContents).toBeUndefined();
    expect(result.classification).toBe('replaced-all');
  });

  it('recovers empty pending (P=0) as []', () => {
    const history = [histUser('hello'), histAi('hi')];
    const result = recoverPendingBoundary(history, 0, [...history]);
    expect(result.classification).toBe('unchanged');
    expect(result.pendingContents).toStrictEqual([]);
  });

  it('handles empty history (H=0): prefix trivially preserved', () => {
    const pending = [pendingUser('only pending')];
    const r = recoverPendingBoundary(pending, pending.length, [...pending]);
    expect(r.classification).toBe('unchanged');
    expect(r.pendingContents).toHaveLength(1);
  });

  it('handles empty history with appended content as appended', () => {
    const pending = [pendingUser('only pending')];
    const r = recoverPendingBoundary(pending, pending.length, [
      ...pending,
      histAi('more'),
    ]);
    expect(r.classification).toBe('appended');
    expect(r.pendingContents).toHaveLength(2);
  });

  it('handles empty history with modified pending as modified-pending', () => {
    const pending = [pendingUser('only pending')];
    const r = recoverPendingBoundary(pending, pending.length, [
      pendingUser('changed pending'),
    ]);
    expect(r.classification).toBe('modified-pending');
    expect(r.pendingContents).toHaveLength(1);
  });

  it('H=0 with a prepended item before the original pending recovers BOTH items (loss-free, not prepended)', () => {
    const pending = [pendingUser('original pending')];
    const newFirst = pendingUser('inserted first');
    const r = recoverPendingBoundary([...pending], pending.length, [
      newFirst,
      ...pending,
    ]);
    expect(r.classification).toBe('inserted-at-boundary');
    expect(r.pendingContents).toHaveLength(2);
    expect(r.pendingContents?.[0]).toBe(newFirst);
    expect(r.pendingContents?.[1]).toBe(pending[0]);
  });

  // H1: boundary-straddling projection collisions make recovery ambiguous.
  it('H1: returns complex/undefined when a projection key straddles the boundary AND contents were modified', () => {
    const history = [histUser('dup')];
    const pending = [pendingUser('dup'), pendingUser('real')];
    const r = recoverPendingBoundary([...history, ...pending], pending.length, [
      histUser('dup'),
      pendingUser('real'),
    ]);
    expect(r.classification).toBe('complex');
    expect(r.pendingContents).toBeUndefined();
  });

  it('H1: duplicate keys entirely WITHIN history + a genuinely appended item still recovers', () => {
    const history = [histUser('dup'), histAi('reply'), histUser('dup')];
    const pending = [pendingUser('question')];
    const original = [...history, ...pending];
    const r = recoverPendingBoundary(original, pending.length, [
      ...original,
      histAi('extra'),
    ]);
    expect(r.classification).toBe('appended');
    expect(r.pendingContents).toHaveLength(2);
  });

  it('H1: duplicate straddling boundary but contents UNCHANGED still recovers caller pending', () => {
    const history = [histUser('dup')];
    const pending = [pendingUser('dup'), pendingUser('real')];
    const original = [...history, ...pending];
    const r = recoverPendingBoundary(
      original,
      pending.length,
      roundTrip(original),
    );
    expect(r.classification).toBe('unchanged');
    expect(r.pendingContents).toHaveLength(2);
  });

  // K2: bounds-validate originalPendingCount. P > snapshot.length yields a
  // negative H → unsound slice; negative/non-integer P is nonsensical.
  it('K2: returns complex/undefined when originalPendingCount > snapshot.length', () => {
    const original = [histUser('a'), histAi('b'), pendingUser('q')];
    const r = recoverPendingBoundary(original, 5, [...original]);
    expect(r.classification).toBe('complex');
    expect(r.pendingContents).toBeUndefined();
  });

  it('K2: returns complex/undefined for a negative originalPendingCount', () => {
    const original = [histUser('a'), histAi('b'), pendingUser('q')];
    const r = recoverPendingBoundary(original, -1, [...original]);
    expect(r.classification).toBe('complex');
    expect(r.pendingContents).toBeUndefined();
  });

  it('K2: returns complex/undefined for a non-integer originalPendingCount', () => {
    const original = [histUser('a'), histAi('b'), pendingUser('q')];
    const r = recoverPendingBoundary(original, 1.5, [...original]);
    expect(r.classification).toBe('complex');
    expect(r.pendingContents).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('resolvePendingFromHookBoundary', () => {
  it('resolves a valid suffix boundary', () => {
    const r = resolvePendingFromHookBoundary(
      { pendingMessageStartIndex: 2, pendingMessageCount: 1 },
      [histUser('a'), histUser('b'), pendingUser('c')],
    );
    expect(r.invalid).toBe(false);
    expect(r.pendingContents).toHaveLength(1);
    expect(r.pendingContents?.[0].blocks).toStrictEqual([
      { type: 'text', text: 'c' },
    ]);
  });

  it('defaults count to the rest when omitted', () => {
    const r = resolvePendingFromHookBoundary({ pendingMessageStartIndex: 2 }, [
      histUser('a'),
      histUser('b'),
      pendingUser('c'),
      pendingUser('d'),
    ]);
    expect(r.invalid).toBe(false);
    expect(r.pendingContents).toHaveLength(2);
  });

  it('rejects a non-suffix boundary (start+count < length) as invalid', () => {
    const r = resolvePendingFromHookBoundary(
      { pendingMessageStartIndex: 1, pendingMessageCount: 1 },
      [histUser('a'), histUser('b'), pendingUser('c'), pendingUser('d')],
    );
    expect(r.invalid).toBe(true);
    expect(r.pendingContents).toBeUndefined();
  });

  it('rejects an out-of-range start index as invalid', () => {
    const r = resolvePendingFromHookBoundary(
      { pendingMessageStartIndex: 5, pendingMessageCount: 1 },
      [histUser('a'), pendingUser('b')],
    );
    expect(r.invalid).toBe(true);
    expect(r.pendingContents).toBeUndefined();
  });

  it('honors onInvalidBoundary=throw by returning invalid (caller throws)', () => {
    const r = resolvePendingFromHookBoundary(
      {
        pendingMessageStartIndex: 0,
        pendingMessageCount: 5,
        onInvalidBoundary: 'throw',
      },
      [histUser('a'), pendingUser('b')],
    );
    expect(r.invalid).toBe(true);
    expect(r.pendingContents).toBeUndefined();
  });

  it('defaults to skip-compression (invalid, undefined pending)', () => {
    const r = resolvePendingFromHookBoundary(
      { pendingMessageStartIndex: 0, pendingMessageCount: 5 },
      [histUser('a'), pendingUser('b')],
    );
    expect(r.invalid).toBe(true);
    expect(r.pendingContents).toBeUndefined();
  });

  it('accepts a boundary covering the whole array as pending', () => {
    const r = resolvePendingFromHookBoundary({ pendingMessageStartIndex: 0 }, [
      pendingUser('a'),
      pendingUser('b'),
    ]);
    expect(r.invalid).toBe(false);
    expect(r.pendingContents).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// applyRequestModifications (reference-equality preservation)
// ---------------------------------------------------------------------------

describe('applyRequestModifications', () => {
  it('returns the exact same array reference when the hook has no llm_request', () => {
    const rc: IContent[] = [histUser('hello'), pendingUser('q')];
    const hook = new BeforeModelHookOutput({ systemMessage: 'ctx' });
    expect(applyRequestModifications(hook, rc, 'm')).toBe(rc);
  });

  it('returns undefined-injected hook output as the original reference', () => {
    const rc: IContent[] = [histUser('hello')];
    expect(applyRequestModifications(undefined, rc, 'm')).toBe(rc);
  });

  it('returns converted contents reflecting hook messages when llm_request is present', () => {
    const rc: IContent[] = [histUser('hello'), pendingUser('q')];
    const hook = new BeforeModelHookOutput({
      hookSpecificOutput: {
        hookEventName: 'BeforeModel',
        llm_request: {
          model: 'm',
          messages: [
            { role: 'user', content: 'replaced message one' },
            { role: 'user', content: 'replaced message two' },
          ],
        },
      },
    });
    const result = applyRequestModifications(hook, rc, 'm');
    expect(result).not.toBe(rc);
    expect(result).toHaveLength(2);
    expect(result[0].blocks).toStrictEqual([
      { type: 'text', text: 'replaced message one' },
    ]);
  });

  // H2: llm_request with no messages (only model/config) must NOT trigger the
  // text-only translator round-trip (which would destroy tool calls/ids).
  it('H2: returns the SAME array reference when llm_request has no messages', () => {
    const rc: IContent[] = [histUser('hello'), pendingUser('q')];
    const hook = new BeforeModelHookOutput({
      hookSpecificOutput: {
        hookEventName: 'BeforeModel',
        llm_request: { model: 'other-model' },
      },
    });
    expect(applyRequestModifications(hook, rc, 'm')).toBe(rc);
  });

  // F1: a hook supplying llm_request.messages: [] (empty array) must NOT
  // erase the conversation. An empty array converts to an empty IContent[]
  // which would silently replace all contents — treat it as "no
  // modification" and return the ORIGINAL reference so the caller's boundary
  // detection stays authoritative.
  it('F1: returns the original reference when llm_request.messages is an empty array (no erasure)', () => {
    const rc: IContent[] = [histUser('hello'), pendingUser('q')];
    const hook = new BeforeModelHookOutput({
      hookSpecificOutput: {
        hookEventName: 'BeforeModel',
        llm_request: { model: 'm', messages: [] },
      },
    });
    // Reference equality proves "no modification" (no translator round-trip).
    expect(applyRequestModifications(hook, rc, 'm')).toBe(rc);
  });
});

// ---------------------------------------------------------------------------
// resolvePendingBoundaryFromHook (R4 + R5 precedence)
// ---------------------------------------------------------------------------

describe('resolvePendingBoundaryFromHook', () => {
  const noopLog = (_msg: string): void => {};
  const hook = (extra?: object): BeforeModelHookOutput =>
    new BeforeModelHookOutput(extra ?? {});
  // Compact wrapper to keep the describe block under max-lines.
  function resolve(
    orig: IContent[],
    finalC: IContent[],
    pending: IContent[],
    h: BeforeModelHookOutput,
    snap?: ReturnType<typeof snapshotContents>,
  ): IContent[] | undefined {
    return resolvePendingBoundaryFromHook(
      orig,
      finalC,
      pending,
      h,
      noopLog,
      snap,
    );
  }
  const hp = () => histUser('hello');
  const hr = () => histAi('hi');
  const qp = () => pendingUser('q');

  // R5(1): contents reference-equal to original → caller pending returned.
  it('returns caller pending exactly when finalContents is reference-equal to original', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    const hookOutput = new BeforeModelHookOutput({});

    const result = resolvePendingBoundaryFromHook(
      original,
      original, // reference-equal
      pending,
      hookOutput,
      noopLog,
    );

    expect(result).toBe(pending); // exact reference
  });

  // R5(2): valid hook metadata wins over differential when contents modified.
  it('uses valid hook metadata over differential when contents are modified', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    // Modified by APPENDING an item after the original pending. Differential
    // recovery (H = 3 - 1 = 2) would slice [2..] = ['q', 'extra'] (2 items).
    // The hook metadata declares pendingMessageStartIndex: 3, which yields a
    // DIFFERENT slice [3..] = ['extra'] (1 item). Because the two strategies
    // recover DIFFERENT slices, this test genuinely proves metadata wins.
    const modified = [
      histUser('hello'),
      histAi('hi'),
      pendingUser('q'),
      pendingUser('extra'),
    ];
    const hookOutput = new BeforeModelHookOutput({
      hookSpecificOutput: {
        hookEventName: 'BeforeModel',
        llm_request_boundary: {
          pendingMessageStartIndex: 3,
        },
      },
    });

    // Sanity: differential alone would recover 2 items.
    const diffOnly = recoverPendingBoundary(original, pending.length, modified);
    expect(diffOnly.pendingContents).toHaveLength(2);

    const result = resolve(original, modified, pending, hookOutput);

    // Metadata slice (index 3..end) = ['extra'] (1 item) — wins over
    // differential's 2-item slice.
    expect(result).toHaveLength(1);
    expect(result?.[0].blocks).toStrictEqual([{ type: 'text', text: 'extra' }]);
  });

  // R5(3): no metadata + modified → differential result.
  it('falls back to differential when metadata is absent and contents are modified', () => {
    const original = [hp(), hr(), qp()];
    expect(
      resolve(original, [...original, histAi('extra')], [qp()], hook()),
    ).toHaveLength(2);
  });

  // R5(4): hook output with only systemMessage → contents unchanged → caller pending.
  it('preserves caller pending when hook has only systemMessage (no llm_request)', () => {
    const original = [hp(), hr(), qp()];
    const pending = [qp()];
    expect(
      resolve(
        original,
        original,
        pending,
        new BeforeModelHookOutput({ systemMessage: 'ctx' }),
      ),
    ).toBe(pending);
  });

  // R4(a): malformed metadata + onInvalidBoundary 'throw' → error thrown.
  it('throws when boundary metadata is malformed and onInvalidBoundary is throw', () => {
    const original = [hp(), hr(), qp()];
    const modified = [hp(), hr(), pendingUser('rewritten')];
    const hookOutput = new BeforeModelHookOutput({
      hookSpecificOutput: {
        hookEventName: 'BeforeModel',
        llm_request_boundary: {
          pendingMessageStartIndex: -1,
          onInvalidBoundary: 'throw',
        },
      },
    });
    expect(() => resolve(original, modified, [qp()], hookOutput)).toThrow(
      /malformed/,
    );
  });

  // R4(b): malformed metadata → pending undefined, NO differential recovery.
  it('returns undefined (skip-compression) for malformed metadata without throw, even when differential would recover', () => {
    const original = [hp(), hr(), qp()];
    const modified = [...original, histAi('extra')];
    // Confirm differential alone WOULD recover (sanity):
    expect(
      recoverPendingBoundary(original, 1, modified).pendingContents,
    ).toBeDefined();
    const h = new BeforeModelHookOutput({
      hookSpecificOutput: {
        hookEventName: 'BeforeModel',
        llm_request_boundary: { pendingMessageStartIndex: -1 },
      },
    });
    expect(resolve(original, modified, [qp()], h)).toBeUndefined();
  });

  // R4(c): malformed metadata with an invalid onInvalidBoundary enum value
  // defaults to skip-compression (not throw).
  it('returns undefined for malformed metadata with an invalid onInvalidBoundary enum (defaults to skip-compression)', () => {
    const original = [hp(), hr(), qp()];
    const modified = [...original, histAi('extra')];
    const h = new BeforeModelHookOutput({
      hookSpecificOutput: {
        hookEventName: 'BeforeModel',
        llm_request_boundary: {
          pendingMessageStartIndex: -1,
          onInvalidBoundary: 'panic',
        },
      },
    });
    expect(resolve(original, modified, [qp()], h)).toBeUndefined();
  });

  // G2: present-but-falsy llm_request_boundary (null) is malformed, not absent.
  it('returns undefined (no differential recovery) when llm_request_boundary is explicitly null even though differential would recover', () => {
    const original = [hp(), hr(), qp()];
    const modified = [...original, histAi('extra')];
    const h = new BeforeModelHookOutput({
      hookSpecificOutput: {
        hookEventName: 'BeforeModel',
        llm_request_boundary: null,
      },
    });
    expect(resolve(original, modified, [qp()], h)).toBeUndefined();
  });

  // F3: valid suffix metadata on a full replacement where differential would
  // return undefined → metadata provides the exact pending slice.
  it('valid suffix metadata on full replacement returns the exact slice even when differential would return undefined', () => {
    const original = [hp(), hr(), qp()];
    const modified = [
      histUser('completely'),
      histAi('replaced'),
      pendingUser('new-pending-one'),
      pendingUser('new-pending-two'),
    ];
    const h = new BeforeModelHookOutput({
      hookSpecificOutput: {
        hookEventName: 'BeforeModel',
        llm_request_boundary: { pendingMessageStartIndex: 2 },
      },
    });
    const result = resolve(original, modified, [qp()], h);
    expect(result).toHaveLength(2);
    expect(result?.[0].blocks).toStrictEqual([
      { type: 'text', text: 'new-pending-one' },
    ]);
    expect(result?.[1].blocks).toStrictEqual([
      { type: 'text', text: 'new-pending-two' },
    ]);
  });

  // F3: startIndex 0 marks the whole modified array as pending.
  it('metadata with pendingMessageStartIndex 0 marks the whole modified array as pending', () => {
    const original = [hp(), hr(), qp()];
    const modified = [histUser('preamble'), ...original];
    // Sanity: differential alone would return undefined (prepended).
    const diffOnly = recoverPendingBoundary(original, 1, modified);
    expect(diffOnly.classification).toBe('prepended');
    expect(diffOnly.pendingContents).toBeUndefined();
    const h = new BeforeModelHookOutput({
      hookSpecificOutput: {
        hookEventName: 'BeforeModel',
        llm_request_boundary: { pendingMessageStartIndex: 0 },
      },
    });
    const result = resolve(original, modified, [qp()], h);
    expect(result).toHaveLength(modified.length);
    expect(result?.[0].blocks).toStrictEqual([
      { type: 'text', text: 'preamble' },
    ]);
  });

  // G1: in-place hook mutations must NOT take the unmodified fast path.
  it('does NOT take the unmodified fast path when a hook mutates a history-side item in place (snapshot-aware fast path)', () => {
    const original = [hp(), hr(), qp()];
    const snapshot = snapshotContents(original);
    (original[0].blocks[0] as { text: string }).text = 'rewritten history';
    expect(
      resolve(original, original, [qp()], hook(), snapshot),
    ).toBeUndefined();
  });

  // G1: in-place append (push) must be recovered as the appended slice.
  it('recovers an in-place push() as the appended slice (not treated as unmodified)', () => {
    const original = [hp(), hr(), qp()];
    const snapshot = snapshotContents(original);
    const appended = histAi('extra note');
    original.push(appended);
    const result = resolve(original, original, [qp()], hook(), snapshot);
    expect(result).toBeDefined();
    expect(result).toHaveLength(2);
    expect(result?.[1]).toBe(appended);
  });

  // G1: a hook that returns a NEW array with projection-identical content
  // must still be treated as unmodified → caller pending returned exactly.
  it('returns caller pending when a hook returns a NEW array with projection-identical content', () => {
    const original = [hp(), hr(), qp()];
    const pending = [qp()];
    const snapshot = snapshotContents(original);
    const modified: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'hi' }] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'q' }] },
    ];
    expect(resolve(original, modified, pending, hook(), snapshot)).toBe(
      pending,
    );
  });

  // G1: without a snapshot, the reference-equality fast path must remain.
  it('falls back to reference equality when no snapshot is provided (backward compatible)', () => {
    const original = [hp(), hr(), qp()];
    const pending = [qp()];
    expect(resolve(original, original, pending, hook())).toBe(pending);
  });

  // T3: metadata-only mutations are "unmodified" (projection ignores ids/metadata).
  it('returns caller pending when a hook mutates only metadata in place', () => {
    const original = [hp(), hr(), qp()];
    const pending = [qp()];
    const snapshot = snapshotContents(original);
    original[0].metadata = {
      id: 'redacted',
      timestamp: 999,
      providerMetadata: { redacted: true },
    };
    expect(resolve(original, original, pending, hook(), snapshot)).toBe(
      pending,
    );
  });

  // K1: the snapshot is of PROVIDER-READY contents, but P is taken from RAW
  // pendingUserIContents.length. buildProviderContent normalization can
  // split/merge/insert items, so the provider-visible pending tail may NOT
  // have exactly P items. When the snapshot tail doesn't projection-match
  // raw pending, H-based slicing is unsound → unrecoverable.
  it('K1: returns undefined when the snapshot pending tail does NOT projection-match raw pending', () => {
    const snapshot = snapshotContents([
      histUser('history one'),
      histAi('history two'),
      pendingUser('split provider item A'),
    ]);
    const finalContents = [
      histUser('history one'),
      histAi('history two'),
      pendingUser('rewritten pending'),
    ];
    const callerPending = [pendingUser('raw pending item')];
    expect(
      resolve(finalContents, finalContents, callerPending, hook(), snapshot),
    ).toBeUndefined();
  });

  it('K1: recovers normally when the snapshot pending tail matches raw pending (negative control)', () => {
    const original = [hp(), hr(), qp()];
    expect(
      resolve(
        original,
        [...original, histAi('extra')],
        [qp()],
        hook(),
        snapshotContents(original),
      ),
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// G1: snapshot helpers + snapshot-aware differential recovery
// ---------------------------------------------------------------------------

describe('snapshotContents / snapshotMatches', () => {
  it('snapshotMatches returns true for an unchanged array', () => {
    const c = [histUser('a'), pendingUser('b')];
    expect(snapshotMatches(snapshotContents(c), c)).toBe(true);
  });

  it('snapshotMatches returns false when an item text changed in place', () => {
    const c = [histUser('a'), pendingUser('b')];
    const snap = snapshotContents(c);
    (c[0].blocks[0] as { text: string }).text = 'changed';
    expect(snapshotMatches(snap, c)).toBe(false);
  });

  it('snapshotMatches returns false when an item was appended in place', () => {
    const c = [histUser('a'), pendingUser('b')];
    const snap = snapshotContents(c);
    c.push(histAi('c'));
    expect(snapshotMatches(snap, c)).toBe(false);
  });

  it('snapshotMatches returns true for a new array with projection-identical content', () => {
    const snap = snapshotContents([histUser('a'), pendingUser('b')]);
    const identical: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'a' }] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'b' }] },
    ];
    expect(snapshotMatches(snap, identical)).toBe(true);
  });

  it('snapshotMatches returns false when text content differs (projection ignores ids/metadata)', () => {
    const snap = snapshotContents([histUser('a')]);
    expect(
      snapshotMatches(snap, [
        { speaker: 'human', blocks: [{ type: 'text', text: 'different' }] },
      ]),
    ).toBe(false);
  });

  // T3: metadata-only mutations are "unmodified" (projection ignores ids/metadata).
  it('snapshotMatches returns true when only metadata was mutated in place', () => {
    const c = [histUser('a'), pendingUser('b')];
    const snap = snapshotContents(c);
    c[0].metadata = { id: 'mutated-id', timestamp: 999 };
    expect(snapshotMatches(snap, c)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// G1: recoverPendingBoundary with a pre-hook snapshot as the before-state
// ---------------------------------------------------------------------------

describe('recoverPendingBoundary with snapshot before-state', () => {
  it('detects modified-history when an in-place mutation rewrote a history item', () => {
    const original = [histUser('hello'), histAi('hi'), pendingUser('q')];
    const snapshot = snapshotContents(original);
    (original[0].blocks[0] as { text: string }).text = 'rewritten history';
    const result = recoverPendingBoundary(snapshot, 1, original);
    expect(result.classification).toBe('modified-history');
    expect(result.pendingContents).toBeUndefined();
  });

  it('recovers an in-place append using the snapshot as the before-state', () => {
    const original = [histUser('hello'), histAi('hi'), pendingUser('q')];
    const snapshot = snapshotContents(original);
    const appended = histAi('extra');
    original.push(appended);
    const result = recoverPendingBoundary(snapshot, 1, original);
    expect(result.classification).toBe('appended');
    expect(result.pendingContents).toHaveLength(2);
    expect(result.pendingContents?.[1]).toBe(appended);
  });
});

// ---------------------------------------------------------------------------
// describeBoundary wiring into resolvePendingBoundaryFromHook diagnostics
// ---------------------------------------------------------------------------

describe('resolvePendingBoundaryFromHook diagnostics (describeBoundary wiring)', () => {
  // Behavioral: collect log lines and assert the boundary descriptor fields
  // appear in observable log output. Never assert on mock call counts.
  function logCollector(): { logs: string[]; log: (m: string) => void } {
    const logs: string[] = [];
    return { logs, log: (m: string) => logs.push(m) };
  }

  it('emits confidence=authoritative on the caller (unmodified) path', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    const { logs, log } = logCollector();
    const result = resolvePendingBoundaryFromHook(
      original,
      original, // reference-equal -> unmodified
      pending,
      new BeforeModelHookOutput({}),
      log,
    );
    expect(result).toBe(pending);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('source=caller');
    expect(logs[0]).toContain('confidence=authoritative');
    // pendingStartIndex for a 3-item array with 1 pending item = 2.
    expect(logs[0]).toContain('pendingStartIndex=2');
    expect(logs[0]).toContain('pendingCount=1');
  });

  it('emits confidence=recovered on a recovered differential path (append)', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    const modified = [...original, histAi('extra note')];
    const { logs, log } = logCollector();
    const result = resolvePendingBoundaryFromHook(
      original,
      modified,
      pending,
      new BeforeModelHookOutput({}),
      log,
    );
    expect(result).toBeDefined();
    expect(result).toHaveLength(2);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('source=before-model-differential');
    expect(logs[0]).toContain('classification=appended');
    expect(logs[0]).toContain('recovered=true');
    expect(logs[0]).toContain('confidence=recovered');
    // 4-item modified array with 2 recovered pending -> startIndex 2.
    expect(logs[0]).toContain('pendingStartIndex=2');
    expect(logs[0]).toContain('pendingCount=2');
  });

  it('emits confidence=unrecoverable on an unrecoverable differential path', () => {
    const history = [histUser('hello'), histAi('hi')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    // Wholesale replacement: no original items present -> replaced-all.
    const modified = [
      histUser('totally'),
      histAi('different'),
      pendingUser('conversation'),
    ];
    const { logs, log } = logCollector();
    const result = resolvePendingBoundaryFromHook(
      original,
      modified,
      pending,
      new BeforeModelHookOutput({}),
      log,
    );
    expect(result).toBeUndefined();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('source=before-model-differential');
    expect(logs[0]).toContain('recovered=false');
    expect(logs[0]).toContain('confidence=unrecoverable');
    expect(logs[0]).toContain('pendingStartIndex=-1');
    expect(logs[0]).toContain('pendingCount=0');
  });
});
