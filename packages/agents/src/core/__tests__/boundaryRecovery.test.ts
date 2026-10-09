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

import { describe, it, expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  boundaryCases,
  compareBoundaryCase,
  histUser,
  histAi,
  pendingUser,
  legacyOutcome,
} from './boundary-snapshot-test-helpers.js';
import {
  recoverPendingBoundary,
  resolvePendingFromHookBoundary,
  resolvePendingBoundaryFromHook,
  snapshotContents,
  snapshotMatches,
} from '../boundaryRecovery.js';
import { applyRequestModifications } from '../streamRequestHelpers.js';
import { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';

// ---------------------------------------------------------------------------
// recoverPendingBoundary
// ---------------------------------------------------------------------------

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

  it('returns hook-supplied contents verbatim when llm_request is present', () => {
    const replacement: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'replaced one' }] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'replaced two' }] },
    ];
    const rc: IContent[] = [histUser('hello'), pendingUser('q')];
    const hook = new BeforeModelHookOutput({
      hookSpecificOutput: {
        hookEventName: 'BeforeModel',
        llm_request: {
          model: 'm',
          contents: replacement,
        },
      },
    });
    const result = applyRequestModifications(hook, rc, 'm');
    expect(result).not.toBe(rc);
    // F1 (v2): hook contents pass through by reference — no conversion
    // round-trip that could strip tool calls or ids.
    expect(result).toBe(replacement);
    const first = result[0];
    expect(first.speaker).toBe('human');
    expect(first.blocks).toStrictEqual([
      { type: 'text', text: 'replaced one' },
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

describe('disk snapshot boundary recovery versus the eager oracle', () => {
  for (const test of boundaryCases())
    it(`${test.name}`, async () => {
      expect(await compareBoundaryCase(test)).toStrictEqual(
        legacyOutcome(test),
      );
    });
});
