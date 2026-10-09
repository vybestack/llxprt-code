/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import {
  recoverPendingBoundary,
  resolvePendingBoundaryFromHook,
  snapshotContents,
} from '../boundaryRecovery.js';
import {
  histUser,
  histAi,
  pendingUser,
  roundTrip,
} from './boundary-snapshot-test-helpers.js';
describe('recoverPendingBoundary case 1', () => {
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
});
describe('recoverPendingBoundary case 2', () => {
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
});
describe('recoverPendingBoundary case 3', () => {
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
});
describe('recoverPendingBoundary case 4', () => {
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
});
describe('recoverPendingBoundary case 5', () => {
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
});
describe('recoverPendingBoundary case 6', () => {
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
});
describe('recoverPendingBoundary case 7', () => {
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
});
describe('recoverPendingBoundary case 8', () => {
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
});
describe('recoverPendingBoundary case 9', () => {
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
});
describe('recoverPendingBoundary case 10', () => {
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
});
describe('recoverPendingBoundary case 11', () => {
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
});
describe('recoverPendingBoundary case 12', () => {
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
});
describe('recoverPendingBoundary case 13', () => {
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
});
describe('recoverPendingBoundary case 14', () => {
  it('returns undefined (replaced-all) for an empty modified array (wholesale deletion)', () => {
    const history = [histUser('hello')];
    const pending = [pendingUser('q')];
    const original = [...history, ...pending];
    const modified: IContent[] = [];

    const result = recoverPendingBoundary(original, pending.length, modified);

    expect(result.pendingContents).toBeUndefined();
    expect(result.classification).toBe('replaced-all');
  });
});
describe('recoverPendingBoundary case 15', () => {
  it('recovers empty pending (P=0) as []', () => {
    const history = [histUser('hello'), histAi('hi')];
    const result = recoverPendingBoundary(history, 0, [...history]);
    expect(result.classification).toBe('unchanged');
    expect(result.pendingContents).toStrictEqual([]);
  });
});
describe('recoverPendingBoundary case 16', () => {
  it('handles empty history (H=0): prefix trivially preserved', () => {
    const pending = [pendingUser('only pending')];
    const r = recoverPendingBoundary(pending, pending.length, [...pending]);
    expect(r.classification).toBe('unchanged');
    expect(r.pendingContents).toHaveLength(1);
  });
});
describe('recoverPendingBoundary case 17', () => {
  it('handles empty history with appended content as appended', () => {
    const pending = [pendingUser('only pending')];
    const r = recoverPendingBoundary(pending, pending.length, [
      ...pending,
      histAi('more'),
    ]);
    expect(r.classification).toBe('appended');
    expect(r.pendingContents).toHaveLength(2);
  });
});
describe('recoverPendingBoundary case 18', () => {
  it('handles empty history with modified pending as modified-pending', () => {
    const pending = [pendingUser('only pending')];
    const r = recoverPendingBoundary(pending, pending.length, [
      pendingUser('changed pending'),
    ]);
    expect(r.classification).toBe('modified-pending');
    expect(r.pendingContents).toHaveLength(1);
  });
});
describe('recoverPendingBoundary case 19', () => {
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
});
describe('recoverPendingBoundary case 20', () => {
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
});
describe('recoverPendingBoundary case 21', () => {
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
});
describe('recoverPendingBoundary case 22', () => {
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
});
describe('recoverPendingBoundary case 23', () => {
  it('K2: returns complex/undefined when originalPendingCount > snapshot.length', () => {
    const original = [histUser('a'), histAi('b'), pendingUser('q')];
    const r = recoverPendingBoundary(original, 5, [...original]);
    expect(r.classification).toBe('complex');
    expect(r.pendingContents).toBeUndefined();
  });
});
describe('recoverPendingBoundary case 24', () => {
  it('K2: returns complex/undefined for a negative originalPendingCount', () => {
    const original = [histUser('a'), histAi('b'), pendingUser('q')];
    const r = recoverPendingBoundary(original, -1, [...original]);
    expect(r.classification).toBe('complex');
    expect(r.pendingContents).toBeUndefined();
  });
});
describe('recoverPendingBoundary case 25', () => {
  it('K2: returns complex/undefined for a non-integer originalPendingCount', () => {
    const original = [histUser('a'), histAi('b'), pendingUser('q')];
    const r = recoverPendingBoundary(original, 1.5, [...original]);
    expect(r.classification).toBe('complex');
    expect(r.pendingContents).toBeUndefined();
  });
});
const noopLog = (_msg: string): void => {};
const hook = (extra?: object): BeforeModelHookOutput =>
  new BeforeModelHookOutput(extra ?? {});
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
describe('resolvePendingBoundaryFromHook case 26', () => {
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
});
describe('resolvePendingBoundaryFromHook case 27', () => {
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
});
describe('resolvePendingBoundaryFromHook case 28', () => {
  it('falls back to differential when metadata is absent and contents are modified', () => {
    const original = [hp(), hr(), qp()];
    expect(
      resolve(original, [...original, histAi('extra')], [qp()], hook()),
    ).toHaveLength(2);
  });
});
describe('resolvePendingBoundaryFromHook case 29', () => {
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
});
describe('resolvePendingBoundaryFromHook case 30', () => {
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
});
describe('resolvePendingBoundaryFromHook case 31', () => {
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
});
describe('resolvePendingBoundaryFromHook case 32', () => {
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
});
describe('resolvePendingBoundaryFromHook case 33', () => {
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
});
describe('resolvePendingBoundaryFromHook case 34', () => {
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
});
describe('resolvePendingBoundaryFromHook case 35', () => {
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
});
describe('resolvePendingBoundaryFromHook case 36', () => {
  it('does NOT take the unmodified fast path when a hook mutates a history-side item in place (snapshot-aware fast path)', () => {
    const original = [hp(), hr(), qp()];
    const snapshot = snapshotContents(original);
    (original[0].blocks[0] as { text: string }).text = 'rewritten history';
    expect(
      resolve(original, original, [qp()], hook(), snapshot),
    ).toBeUndefined();
  });
});
describe('resolvePendingBoundaryFromHook case 37', () => {
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
});
describe('resolvePendingBoundaryFromHook case 38', () => {
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
});
describe('resolvePendingBoundaryFromHook case 39', () => {
  it('falls back to reference equality when no snapshot is provided (backward compatible)', () => {
    const original = [hp(), hr(), qp()];
    const pending = [qp()];
    expect(resolve(original, original, pending, hook())).toBe(pending);
  });
});
describe('resolvePendingBoundaryFromHook case 40', () => {
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
});
describe('resolvePendingBoundaryFromHook case 41', () => {
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
});
describe('resolvePendingBoundaryFromHook case 42', () => {
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
