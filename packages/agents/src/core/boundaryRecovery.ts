/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Differential pending-boundary recovery, projection snapshots,
 * and hook boundary-metadata resolution (issue #2306).
 *
 * When a BeforeModel hook modifies the request contents, the runtime must
 * determine which trailing messages are the new (unsent) "pending" content
 * versus prior history, because context compression preserves the pending
 * suffix verbatim while recomposing the history prefix from the history
 * service. This module resolves the pending boundary via three strategies,
 * tried in order:
 *
 *   1. Caller / unmodified: when the hook did not modify the contents
 *      (reference-equal, or projection-equal against a pre-hook snapshot),
 *      the caller-supplied pending is authoritative.
 *   2. Hook metadata: when the hook supplies llm_request_boundary metadata
 *      declaring the pending suffix, the metadata is validated structurally
 *      (zod) and positionally (must describe a suffix of the modified
 *      contents). Valid metadata wins over differential analysis; malformed
 *      or invalid metadata honors onInvalidBoundary and never falls back.
 *   3. Differential recovery: when metadata is absent, a normalized
 *      projection comparison of the pre-hook contents vs the hook-modified
 *      contents deterministically recovers the pending region in the common
 *      cases (append, modify-pending, etc.).
 *
 * The metadata contract is intentional: the declared suffix is
 * verbatim-preserved through compression; the prefix before
 * pendingMessageStartIndex is declared history-semantics and is REPLACED by
 * compressed real history when compression runs. Hooks needing history-side
 * rewrites to survive compression must omit the metadata and accept
 * skip-compression.
 */

import type {
  BeforeModelHookOutput,
  HookLLMRequestBoundary,
  HookLLMRequestBoundaryParseResult,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  BoundaryChangeClassification,
  ProviderContentBoundary,
} from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';

/* ---------------------------------------------------------------------------
 * Differential pending-boundary recovery (issue #2306).
 *
 * When a BeforeModel hook modifies contents, the original pending boundary is
 * known (the caller had it). By comparing the original contents against the
 * hook-modified contents via a normalized projection, we can deterministically
 * recover the pending region in the common cases, enabling compression. We
 * NEVER attempt extraction heuristics from final contents alone.
 * ------------------------------------------------------------------------- */

/**
 * Result of differential boundary recovery.
 * pendingContents is undefined when the boundary is unrecoverable.
 */
export interface BoundaryRecoveryResult {
  classification: BoundaryChangeClassification;
  pendingContents: IContent[] | undefined;
}

/**
 * Build a normalized projection key for an IContent that is stable across the
 * hook translator round-trip. The hook translator produces text-only IContents
 * with fresh IDs and no metadata, so we compare by speaker + block shape:
 * text blocks contribute {type:'text', text}; non-text blocks contribute
 * their full shape (volatile id/callId mismatches on non-text blocks correctly
 * yield a mismatch, which is the desired unrecoverable outcome).
 *
 * NON-TEXT BLOCK STRUCTURAL COMPARISON: non-text blocks (tool_call,
 * tool_response, etc.) are compared structurally INCLUDING ids (e.g.,
 * tool_call id / tool_response callId). This is deliberately conservative:
 * hook translator round-trips that regenerate tool-call ids will make the
 * comparison fail and force unrecoverable rather than risk misattribution of
 * a tool call to the wrong response.
 *
 * COLLISION TOLERANCE: this projection deliberately ignores ids/metadata, so
 * duplicate same-speaker/same-text messages can collide (e.g. two identical
 * user messages produce the same key). Collisions WITHIN one side of the
 * boundary (both in history, or both in pending) are tolerated — the
 * recovered slice is always taken from the hook-modified array POSITIONS
 * (modifiedContents.slice(...)), so any collision yields content identical
 * under projection with no data loss. Collisions ACROSS the boundary (one key
 * in the history prefix AND one in the pending suffix) are AMBIGUOUS when the
 * hook modified the contents: a surviving duplicate cannot be reliably
 * attributed to the correct side. In that case recovery is conservatively
 * marked unrecoverable (see hasBoundaryStraddlingDuplicate in
 * recoverPendingBoundary).
 *
 * Exported for snapshot construction (issue #2306 G1): StreamProcessor
 * captures a snapshot of projection keys BEFORE firing the BeforeModel hook so
 * in-place mutations by hooks are detected.
 *
 * ACCEPTED LIMITATION: boundary recovery is based on the provider-visible
 * projection (speaker + block content). Metadata-only changes (e.g. a hook
 * that mutates only an item's metadata/providerMetadata in place) do NOT
 * affect the projection key, so such an item is treated as "unmodified".
 * Consequently the caller pending is used, and if compression runs the
 * metadata mutation is superseded by recomposition (which rebuilds from
 * HistoryService). This is accepted because the projection exists to survive
 * the hook translator round-trip, which itself strips ids/metadata.
 */
export function contentProjectionKey(content: IContent): string {
  const blocks = content.blocks.map((block) => {
    if (block.type === 'text') {
      return { type: 'text' as const, text: block.text };
    }
    return block;
  });
  return JSON.stringify({ speaker: content.speaker, blocks });
}

/**
 * A lightweight snapshot of an IContent[] captured by storing per-item
 * projection keys. This is sufficient for differential recovery because
 * recovery itself operates on projection equality. Capturing only keys (not a
 * deep clone) keeps the hot path cheap when hooks are enabled.
 *
 * G1 (issue #2306): used to detect in-place hook mutations. The snapshot is
 * taken BEFORE firing the BeforeModel hook, so it reflects the true original
 * state even when a hook mutates the live array/elements in place.
 */
export interface ProjectionSnapshot {
  readonly length: number;
  readonly keys: readonly string[];
}

/**
 * Capture a projection snapshot of an IContent[] (length + per-item keys).
 * Cheap: only JSON.stringify per item, no deep clone.
 */
export function snapshotContents(contents: IContent[]): ProjectionSnapshot {
  const keys = contents.map((c) => contentProjectionKey(c));
  return { length: contents.length, keys };
}

/**
 * True when a live IContent[] matches a pre-captured snapshot (same length and
 * every item's projection key matches in order). Used to detect in-place
 * mutations: a hook that mutated elements in place or appended/removed items
 * will NOT match the pre-hook snapshot.
 */
export function snapshotMatches(
  snapshot: ProjectionSnapshot,
  contents: IContent[],
): boolean {
  if (snapshot.length !== contents.length) return false;
  for (let i = 0; i < contents.length; i++) {
    if (snapshot.keys[i] !== contentProjectionKey(contents[i])) {
      return false;
    }
  }
  return true;
}

/**
 * True when a snapshot key range matches a live IContent[] range element-wise.
 * The "before" side is the snapshot (pre-hook); the "after" side is the live
 * (possibly hook-modified) array.
 */
function snapshotRangeMatchesLive(
  snapshot: ProjectionSnapshot,
  snapStart: number,
  live: IContent[],
  liveStart: number,
  count: number,
): boolean {
  for (let i = 0; i < count; i++) {
    if (
      snapshot.keys[snapStart + i] !== contentProjectionKey(live[liveStart + i])
    ) {
      return false;
    }
  }
  return true;
}

/**
 * K1 (issue #2306): validate that the snapshot's pending SUFFIX (the last
 * `callerPending.length` projection keys) exactly matches the projection keys
 * of the raw pending IContents (same count, same keys in order).
 *
 * WHY: the pre-hook snapshot is taken of the PROVIDER-READY contents (output
 * of buildProviderContent), but the boundary count P is taken from RAW
 * pendingUserIContents.length. buildProviderContent normalization
 * (splitToolCallsOutOfToolMessages, ensureToolCallContinuity,
 * ensureToolResponseCompleteness, ensureToolResponseAdjacency) can
 * split/merge/insert items, so the provider-visible pending tail may NOT have
 * exactly P items. When that happens, H = snapshot.length - P points to the
 * wrong boundary and differential recovery could slice wrongly (silently
 * dropping or duplicating content on recomposition). This check ensures
 * differential recovery is ONLY attempted when the snapshot tail is exactly
 * the raw pending projection.
 *
 * P === 0 is trivially a match (skip). Returns true when no snapshot is
 * available (the no-hooks/zero-overhead path falls back to the live original
 * contents, which are exactly the provider-ready contents the caller built —
 * the raw-vs-provider mismatch cannot arise there).
 */
export function pendingTailMatchesSnapshot(
  snapshot: ProjectionSnapshot | undefined,
  callerPending: IContent[],
): boolean {
  if (snapshot === undefined) return true;
  const P = callerPending.length;
  if (P === 0) return true;
  // The snapshot must have at least P items for the suffix to exist.
  if (snapshot.length < P) return false;
  const suffixStart = snapshot.length - P;
  for (let i = 0; i < P; i++) {
    if (
      snapshot.keys[suffixStart + i] !== contentProjectionKey(callerPending[i])
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The before-state for differential recovery. Accepts either a live IContent[]
 * (projected on the fly) or a pre-captured ProjectionSnapshot (the pre-hook
 * state). This lets recovery compare against the TRUE original even when a
 * hook mutated the live array in place (G1).
 */
export type BoundaryBeforeState = IContent[] | ProjectionSnapshot;

/** Normalize a before-state into a ProjectionSnapshot. */
function asSnapshot(before: BoundaryBeforeState): ProjectionSnapshot {
  return Array.isArray(before) ? snapshotContents(before) : before;
}

/**
 * Detect whether any projection key occurs in BOTH the history prefix
 * [0, H) and the pending suffix [H, len) of a snapshot. Such a
 * boundary-straddling duplicate makes differential recovery ambiguous when
 * the hook modified the contents: a surviving duplicate cannot be reliably
 * attributed to the correct side of the boundary (the two intents — delete
 * the history copy vs delete the pending copy — are projection-indistinguishable).
 *
 * Returns false when H === 0 or P === 0 (no straddle possible).
 */
function hasBoundaryStraddlingDuplicate(
  snapshot: ProjectionSnapshot,
  H: number,
): boolean {
  const P = snapshot.length - H;
  if (H === 0 || P === 0) return false;
  const prefixKeys = new Set<string>();
  for (let i = 0; i < H; i++) {
    prefixKeys.add(snapshot.keys[i]);
  }
  for (let i = H; i < snapshot.length; i++) {
    if (prefixKeys.has(snapshot.keys[i])) return true;
  }
  return false;
}

/**
 * Recover the pending region by differential analysis of original vs
 * hook-modified contents. H = history prefix length, P = pending count.
 *
 * The `before` argument accepts a ProjectionSnapshot (pre-hook state, G1) or a
 * live IContent[]. When a hook mutated the live array in place, the caller
 * MUST pass the pre-hook snapshot so recovery compares against the TRUE
 * original rather than the mutated live array.
 *
 * Recovery is confident when the pending region can be located as:
 *  (a) history prefix preserved -> pending = modifiedContents.slice(H)
 *  (b) pure prepend (whole original is a suffix of modified, H > 0) ->
 *      classification 'prepended' but pendingContents UNDEFINED. The prepended
 *      content lives on the HISTORY side of the boundary; compression
 *      recomposes from HistoryService.getCurated() + pendingContents
 *      (providerContentEnforcement.recomposeProviderContents), so the hook's
 *      preamble would be SILENTLY DROPPED whenever compression runs. This is
 *      analogous to the modified-history case which is also unrecoverable.
 *      Hooks that need prepended/history-side content to survive should
 *      accept skip-compression semantics (omit llm_request_boundary metadata
 *      so contents are sent as-is under the limit; a clear error is thrown
 *      when over the limit). The metadata-based pendingMessageStartIndex: 0
 *      is NOT a prepend escape hatch: with startIndex 0 the whole modified
 *      array becomes pendingContents, so compression recomposition yields
 *      compressedHistory + preamble + fullHistoryCopy + pending — duplicating
 *      the original history and INCREASING the payload, defeating compression.
 *      startIndex 0 is only sensible when the hook's modified contents are
 *      fully self-contained and small (e.g. the hook replaced the whole
 *      request with a compact form), since the entire array is re-appended
 *      after the compressed curated history.
 * Otherwise pendingContents is undefined (unrecoverable).
 *
 * H === 0 SEMANTICS: with no history prefix, every modified item is by
 * definition new/unsent. Recomposition = compressed(empty curated) +
 * pendingContents reproduces the hook's modified contents EXACTLY and
 * loss-free, whereas shifting the boundary to the last P items would silently
 * drop the hook's inserted content. So when H === 0 we skip the pure-prepend
 * branch entirely and classify per the suffix comparison (the prefix-preserved
 * branch handles H === 0 because rangeProjectionEqual over zero items is
 * trivially true). Loss-free reproduction beats boundary-shift.
 *
 * MODIFIED-HISTORY IS UNRECOVERABLE (issue #2306): when the history prefix
 * does NOT match but the last-P suffix matches the original pending, we return
 * classification 'modified-history' with pendingContents undefined. Recovering
 * pending there would let compression recompose from HistoryService and
 * silently DISCARD the hook's history modifications.
 */
export function recoverPendingBoundary(
  before: BoundaryBeforeState,
  originalPendingCount: number,
  modifiedContents: IContent[],
): BoundaryRecoveryResult {
  const snapshot = asSnapshot(before);

  // K2: bounds-validate originalPendingCount. A negative, non-integer, or
  // greater-than-snapshot-length pending count would yield a negative or
  // nonsensical H (history prefix length), making any H-based suffix slice
  // point to the wrong boundary. Bail out as unrecoverable rather than slice
  // wrongly (which would silently drop or duplicate content on recomposition).
  if (
    !Number.isInteger(originalPendingCount) ||
    originalPendingCount < 0 ||
    originalPendingCount > snapshot.length
  ) {
    return { classification: 'complex', pendingContents: undefined };
  }

  const H = snapshot.length - originalPendingCount;
  const P = originalPendingCount;

  // H1: boundary-straddling projection collision guard. When the modified
  // contents differ from the snapshot (a real change occurred) AND a
  // projection key appears in BOTH the history prefix and the pending suffix,
  // differential recovery is ambiguous: a surviving duplicate cannot be
  // reliably attributed to the correct side of the boundary. Be conservative.
  // The unchanged case (modified projection-equals snapshot) is allowed to
  // proceed — duplicates on the same side, or even straddling duplicates when
  // nothing changed, are safe because the recovered slice is positionally
  // identical to the original.
  if (
    !snapshotMatches(snapshot, modifiedContents) &&
    hasBoundaryStraddlingDuplicate(snapshot, H)
  ) {
    return { classification: 'complex', pendingContents: undefined };
  }

  // Case (a): history prefix preserved (trivially true when H === 0).
  if (
    modifiedContents.length >= H &&
    snapshotRangeMatchesLive(snapshot, 0, modifiedContents, 0, H)
  ) {
    return classifyPrefixPreserved(snapshot, H, P, modifiedContents);
  }

  // Case (b): pure prepend — the whole original is a suffix of modified.
  // SKIPPED when H === 0 (see doc comment: loss-free reproduction beats
  // boundary-shift; the prefix-preserved branch above already handled it).
  if (
    H > 0 &&
    modifiedContents.length > snapshot.length &&
    snapshotRangeMatchesLive(
      snapshot,
      0,
      modifiedContents,
      modifiedContents.length - snapshot.length,
      snapshot.length,
    )
  ) {
    // F1: UNRECOVERABLE. The prepended content lives on the history side of
    // the boundary; compression recomposes from HistoryService + pendingContents
    // which would silently drop the preamble. Keep the classification for
    // diagnosis but return undefined pending so compression cannot silently
    // discard the hook's prepended content.
    return { classification: 'prepended', pendingContents: undefined };
  }

  // Modified-history: history prefix does NOT match but the last-P suffix
  // matches the original pending. UNRECOVERABLE — keep the classification for
  // logging but return undefined pending so compression cannot silently
  // discard the hook's history modifications.
  if (
    P > 0 &&
    modifiedContents.length >= P &&
    snapshotRangeMatchesLive(
      snapshot,
      H,
      modifiedContents,
      modifiedContents.length - P,
      P,
    )
  ) {
    return { classification: 'modified-history', pendingContents: undefined };
  }

  // Unmatchable: classify as 'complex' if SOME original item is still
  // projection-present somewhere (partial replacement/restructure), else
  // 'replaced-all' (wholesale replacement with no original items present).
  return {
    classification: anyOriginalProjectionPresent(snapshot, modifiedContents)
      ? 'complex'
      : 'replaced-all',
    pendingContents: undefined,
  };
}

/** True when any original (snapshot) item is projection-present anywhere in modified. */
function anyOriginalProjectionPresent(
  snapshot: ProjectionSnapshot,
  modifiedContents: IContent[],
): boolean {
  const modifiedKeys = new Set(
    modifiedContents.map((mod) => contentProjectionKey(mod)),
  );
  for (const key of snapshot.keys) {
    if (modifiedKeys.has(key)) {
      return true;
    }
  }
  return false;
}

/** Classify the prefix-preserved case (history prefix matched). */
function classifyPrefixPreserved(
  snapshot: ProjectionSnapshot,
  H: number,
  P: number,
  modifiedContents: IContent[],
): BoundaryRecoveryResult {
  const pendingContents = modifiedContents.slice(H);
  const sameLength = modifiedContents.length === snapshot.length;
  const longer = modifiedContents.length > snapshot.length;

  // Does the original pending appear as a suffix of modifiedContents?
  const pendingSuffixAtEnd =
    P > 0 &&
    modifiedContents.length >= H + P &&
    snapshotRangeMatchesLive(
      snapshot,
      H,
      modifiedContents,
      modifiedContents.length - P,
      P,
    );
  // Does the original pending appear immediately after the history prefix?
  const pendingImmediatelyAfterPrefix =
    P > 0 &&
    modifiedContents.length >= H + P &&
    snapshotRangeMatchesLive(snapshot, H, modifiedContents, H, P);

  if (sameLength) {
    // P === 0 means there is no pending suffix to differ from, so the boundary
    // is unchanged; otherwise classify by whether the pending suffix matches.
    const unchanged = P === 0 || pendingImmediatelyAfterPrefix;
    return {
      classification: unchanged ? 'unchanged' : 'modified-pending',
      pendingContents,
    };
  }
  if (longer) {
    if (pendingImmediatelyAfterPrefix) {
      // Extra items appear AFTER the original pending (still right after the
      // history prefix).
      return { classification: 'appended', pendingContents };
    }
    if (pendingSuffixAtEnd) {
      // Extra items appear BETWEEN history and the still-present original
      // pending at the END.
      return { classification: 'inserted-at-boundary', pendingContents };
    }
  }
  // Prefix preserved but length differs and the new tail does NOT start with
  // the original pending projection: replaced-pending (includes tail
  // shortened/deleted/restructured cases).
  return { classification: 'replaced-pending', pendingContents };
}

/**
 * Resolve the pending region from explicit hook-supplied boundary metadata
 * (POSITIONAL validation layer — see R6). The boundary has already passed
 * STRUCTURAL validation (zod parse); here we verify that the pending region
 * it describes is a suffix of modifiedContents (recomposition appends pending
 * after curated history, so a non-suffix boundary cannot be honored).
 *
 * METADATA CONTRACT (issue #2306): the suffix from `pendingMessageStartIndex`
 * onward is declared verbatim-preserved (sent to the provider unchanged
 * through compression). The prefix BEFORE that index is declared
 * history-semantics — when compression runs, recomposition
 * (buildProviderContent over HistoryService.getCurated() [compressed] +
 * pendingContents) REPLACES that prefix with compressed real history. Hooks
 * that need history-side rewrites to survive compression must NOT rely on
 * metadata for that; they should omit metadata and accept skip-compression
 * (contents sent as-is under the limit; clear error over the limit).
 *
 * Returns { invalid: true } when the boundary does not fit positionally; the
 * caller honors onInvalidBoundary ('throw' -> caller throws; default
 * 'skip-compression' -> undefined pending).
 */
export function resolvePendingFromHookBoundary(
  boundary: HookLLMRequestBoundary,
  modifiedContents: IContent[],
): { pendingContents: IContent[] | undefined; invalid: boolean } {
  const startIndex = boundary.pendingMessageStartIndex;
  const count =
    boundary.pendingMessageCount ??
    Math.max(0, modifiedContents.length - startIndex);
  // Non-negativity of startIndex and count is guaranteed by the zod schema
  // (hookLLMRequestBoundarySchema) at the structural parse layer, and count
  // falls back to Math.max(0, ...). Therefore startIndex >= 0, count >= 0,
  // and startIndex <= modifiedContents.length are all implied by the single
  // meaningful check: the pending region must be a SUFFIX of modifiedContents.
  const isSuffix = startIndex + count === modifiedContents.length;

  if (isSuffix) {
    return {
      pendingContents: modifiedContents.slice(startIndex),
      invalid: false,
    };
  }
  // Invalid boundary: the caller honors onInvalidBoundary ('throw' -> caller throws).
  return { pendingContents: undefined, invalid: true };
}

/**
 * Build an authoritative boundary descriptor for logging/diagnosis.
 */
export function describeBoundary(
  source: ProviderContentBoundary['source'],
  pendingContents: IContent[] | undefined,
  totalContents: number,
): ProviderContentBoundary {
  if (pendingContents === undefined) {
    return {
      pendingStartIndex: -1,
      pendingContentCount: 0,
      confidence: 'unrecoverable',
      source,
    };
  }
  return {
    pendingStartIndex: totalContents - pendingContents.length,
    pendingContentCount: pendingContents.length,
    confidence: source === 'caller' ? 'authoritative' : 'recovered',
    source,
  };
}

/**
 * Pure pending-boundary resolution combining the three strategies
 * (reference-equality / hook metadata / differential recovery). Extracted from
 * StreamProcessor so it stays unit-testable and StreamProcessor stays under
 * its max-lines limit.
 *
 * Resolution order:
 *   1. Unmodified detection:
 *      a. When `originalSnapshot` is provided (hooks fired), the finalContents
 *         is treated as unmodified ONLY if it matches the pre-hook snapshot
 *         (same length + every projection key matches in order). This catches
 *         in-place mutations by hooks that return the same array reference
 *         (G1, issue #2306). A new array with projection-identical content is
 *         also treated as unmodified.
 *      b. When `originalSnapshot` is NOT provided (hooks disabled — zero
 *         overhead), falls back to reference equality
 *         (finalContents === originalContents).
 *      Unmodified -> caller pending.
 *   2. Hook supplied llm_request_boundary metadata:
 *      a. valid (structurally) -> positional suffix-fit check; use it or honor
 *         onInvalidBoundary when it does not fit.
 *      b. malformed (present but structurally invalid) -> treat as INVALID:
 *         honor onInvalidBoundary ('throw' -> throw; default 'skip-compression'
 *         -> undefined pending). Do NOT fall back to differential analysis,
 *         because the hook explicitly attempted to control the boundary.
 *      c. absent -> fall through to differential recovery (step 3).
 *   3. Differential recovery (only when metadata is absent). Uses the
 *      `originalSnapshot` as the before-state when available (the true pre-hook
 *      state, robust against in-place mutation); otherwise `originalContents`.
 *
 * `log` receives a short diagnostic string for each path.
 *
 * Two validation layers (R4/R6):
 *  - STRUCTURAL (parse level): the metadata object's field types and enum
 *    values are validated by zod in parseHookLLMRequestBoundaryResult.
 *  - POSITIONAL (resolution level, this function): valid indices must describe
 *    a suffix of the modified contents (recomposition appends pending after
 *    curated history).
 */
export function resolvePendingBoundaryFromHook(
  originalContents: IContent[],
  finalContents: IContent[],
  pendingUserIContents: IContent[],
  hookOutput: BeforeModelHookOutput | undefined,
  log: (message: string) => void,
  originalSnapshot?: ProjectionSnapshot,
): IContent[] | undefined {
  // 1. Unmodified detection. When a pre-hook snapshot is available, compare
  //    finalContents against it — this detects in-place mutations by hooks
  //    that return the same array reference (G1). Without a snapshot (hooks
  //    disabled / zero-overhead path), use reference equality.
  const unmodified =
    originalSnapshot !== undefined
      ? snapshotMatches(originalSnapshot, finalContents)
      : finalContents === originalContents;
  if (unmodified) {
    const desc = describeBoundary(
      'caller',
      pendingUserIContents,
      finalContents.length,
    );
    log(
      `[StreamProcessor] Pending boundary source=caller (no content modification) ` +
        `confidence=${desc.confidence} pendingStartIndex=${desc.pendingStartIndex} ` +
        `pendingCount=${desc.pendingContentCount}`,
    );
    return pendingUserIContents;
  }

  // 2. Hook-supplied explicit boundary metadata (discriminated: absent vs
  //    valid vs malformed). Absent falls through to differential recovery.
  const boundaryResult = hookOutput?.getLLMRequestBoundaryResult();
  const hookResolved = resolveHookBoundaryResult(
    boundaryResult,
    finalContents,
    log,
  );
  if (hookResolved.handled) {
    return hookResolved.pendingContents;
  }

  // 3. Differential recovery (metadata absent). Use the pre-hook snapshot as
  //    the before-state when available (robust against in-place mutation);
  //    otherwise the original contents.
  //    K1: when a snapshot is available, first validate that its pending tail
  //    projection-matches the raw caller pending. Provider normalization
  //    (buildProviderContent) can split/merge/insert items, so the
  //    provider-visible pending tail may not have exactly P items; if so, the
  //    H-based slice is unsound and differential recovery is unrecoverable.
  if (!pendingTailMatchesSnapshot(originalSnapshot, pendingUserIContents)) {
    log(
      '[StreamProcessor] Pending boundary source=before-model-differential ' +
        '(skipped: provider normalization changed pending tail cardinality)',
    );
    return undefined;
  }
  const before: BoundaryBeforeState = originalSnapshot ?? originalContents;
  const recovery = recoverPendingBoundary(
    before,
    pendingUserIContents.length,
    finalContents,
  );
  const desc = describeBoundary(
    'before-model-differential',
    recovery.pendingContents,
    finalContents.length,
  );
  log(
    `[StreamProcessor] Pending boundary source=before-model-differential ` +
      `classification=${recovery.classification} ` +
      `recovered=${recovery.pendingContents !== undefined} ` +
      `confidence=${desc.confidence} pendingStartIndex=${desc.pendingStartIndex} ` +
      `pendingCount=${desc.pendingContentCount}`,
  );
  return recovery.pendingContents;
}

interface HookResolution {
  handled: boolean;
  pendingContents: IContent[] | undefined;
}

/**
 * Resolve a hook boundary parse result into a pending decision. Returns
 * { handled: false } when the result is absent (caller falls back to
 * differential analysis). For 'valid' and 'malformed' results, returns
 * { handled: true } with the resolved pending (may throw on 'throw' policy).
 */
function resolveHookBoundaryResult(
  result: HookLLMRequestBoundaryParseResult | undefined,
  finalContents: IContent[],
  log: (message: string) => void,
): HookResolution {
  if (!result || result.status === 'absent') {
    return { handled: false, pendingContents: undefined };
  }
  if (result.status === 'valid') {
    return {
      handled: true,
      ...resolveValidBoundary(result.boundary, finalContents, log),
    };
  }
  // malformed: the hook attempted to control the boundary but the metadata is
  // structurally invalid. Treat as INVALID — honor onInvalidBoundary, do NOT
  // fall back to differential analysis.
  if (result.onInvalidBoundary === 'throw') {
    throw new Error(
      'BeforeModel hook supplied malformed llm_request_boundary metadata ' +
        '(structurally invalid); the boundary cannot be honored.',
    );
  }
  log(
    '[StreamProcessor] Pending boundary source=before-model-hook-metadata (malformed, skip-compression)',
  );
  return { handled: true, pendingContents: undefined };
}

/**
 * Resolve a structurally-valid boundary through positional (suffix-fit) checks.
 *
 * METADATA CONTRACT (issue #2306): see resolvePendingFromHookBoundary. The
 * accepted suffix is verbatim-preserved through compression; the prefix is
 * declared replaceable and is superseded by compressed HistoryService history
 * when compression runs.
 */
function resolveValidBoundary(
  boundary: HookLLMRequestBoundary,
  finalContents: IContent[],
  log: (message: string) => void,
): { pendingContents: IContent[] | undefined } {
  const resolved = resolvePendingFromHookBoundary(boundary, finalContents);
  if (!resolved.invalid) {
    const desc = describeBoundary(
      'before-model-hook-metadata',
      resolved.pendingContents,
      finalContents.length,
    );
    log(
      `[StreamProcessor] Pending boundary source=before-model-hook-metadata ` +
        `(startIndex=${boundary.pendingMessageStartIndex}, ` +
        `pendingCount=${desc.pendingContentCount}, ` +
        `modifiedLength=${finalContents.length}) ` +
        `confidence=${desc.confidence} pendingStartIndex=${desc.pendingStartIndex}`,
    );
    return { pendingContents: resolved.pendingContents };
  }
  if (boundary.onInvalidBoundary === 'throw') {
    throw new Error(
      `BeforeModel hook supplied an invalid llm_request_boundary ` +
        `(pendingMessageStartIndex=${boundary.pendingMessageStartIndex}, ` +
        `pendingMessageCount=${boundary.pendingMessageCount ?? 'omitted'}, ` +
        `contentsLength=${finalContents.length}); the pending region must ` +
        `be a suffix of the modified contents.`,
    );
  }
  log(
    '[StreamProcessor] Pending boundary source=before-model-hook-metadata (invalid, skip-compression)',
  );
  return { pendingContents: undefined };
}
