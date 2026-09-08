/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {
  IContent,
  ChronologyMarker,
  ChronologyReplacedSpan,
} from './IContent.js';

export interface ChronologyState {
  readonly nextSeq: number;
  readonly currentUserTurn: number;
  readonly nextStep: number;
}

/**
 * Stamps and reconciles {@link ChronologyMarker}s onto {@link IContent}.
 *
 * OWNERSHIP TRANSFER: {@link stamp} and {@link inherit} attach the marker
 * IN PLACE and return the same object reference. This is deliberate. Callers
 * hand ownership of the content to history at the insertion boundary, and
 * `HistoryService` has a long-standing contract that the object you add is the
 * object it stores — `removeLastIfMatches` compares by reference, and density
 * replacement callers assert that the exact replacement object lands in the
 * history array. Returning a copy would silently break that contract.
 *
 * Only the additive `metadata.chronology` field is written; no existing field
 * is read-modified-written and no block is touched. This mirrors the
 * established in-place metadata pattern used by the provider stream parsers
 * (for example `content.metadata ??= {}` in `OpenAIStreamProcessorState`).
 *
 * When a marker already exists it is preserved verbatim and only the stamper's
 * internal counters are reconciled, so a subsequent fresh stamp never collides.
 */
export class ChronologyStamper {
  private nextSeq = 1;
  private currentUserTurn = 0;
  private nextStep = 1;

  constructor(private readonly now: () => number = Date.now) {}

  snapshot(): ChronologyState {
    return {
      nextSeq: this.nextSeq,
      currentUserTurn: this.currentUserTurn,
      nextStep: this.nextStep,
    };
  }

  restore(state: ChronologyState): void {
    this.nextSeq = state.nextSeq;
    this.currentUserTurn = state.currentUserTurn;
    this.nextStep = state.nextStep;
  }

  /**
   * Attach a chronology marker to `content` and return it.
   *
   * - Fresh stamp (no existing marker): a new marker is minted and written to
   *   `content.metadata.chronology`.
   * - Existing marker: left untouched; only the stamper's counters are
   *   reconciled (preserve + reconcile).
   *
   * The returned reference is always the reference that was passed in.
   */
  stamp(content: IContent): IContent {
    const existing = content.metadata?.chronology;
    if (existing) {
      this.reconcile(existing);
      return content;
    }

    if (content.speaker === 'human') {
      this.currentUserTurn += 1;
      this.nextStep = 1;
    }

    const marker: ChronologyMarker = {
      seq: this.nextSeq,
      userTurn: this.currentUserTurn,
      step: this.nextStep,
      recordedAt: this.now(),
    };
    this.nextSeq += 1;
    this.nextStep += 1;

    return this.assign(content, marker);
  }

  /**
   * Attach the given marker verbatim to `content` and return it. Used for
   * replacements that occupy the same logical position as another item, so the
   * replacement keeps the replaced item's place in the chronology. The
   * stamper's counters are reconciled exactly as for an existing marker in
   * {@link stamp}.
   *
   * The returned reference is always the reference that was passed in.
   */
  inherit(content: IContent, marker: ChronologyMarker): IContent {
    this.reconcile(marker);
    return this.assign(content, marker);
  }

  /** Write the marker into the content's metadata in place. */
  private assign(content: IContent, marker: ChronologyMarker): IContent {
    const target = content;
    target.metadata ??= {};
    target.metadata.chronology = marker;
    return target;
  }

  /**
   * Reconcile internal counters so a future fresh stamp never collides with a
   * preserved/inherited marker.
   *
   * The step counter is scoped to a single user turn, so each of the three
   * turn relationships needs distinct handling:
   *  - the marker advances the turn: the step counter belongs to the new turn
   *    and must restart from that marker rather than carrying the previous
   *    turn's high-water mark forward;
   *  - the marker is in the current turn: take the high-water mark;
   *  - the marker is from an older turn (restored or merged history): it says
   *    nothing about the current turn, so the step counter is left alone.
   */
  private reconcile(marker: ChronologyMarker): void {
    this.nextSeq = Math.max(this.nextSeq, marker.seq + 1);

    if (marker.userTurn > this.currentUserTurn) {
      this.currentUserTurn = marker.userTurn;
      this.nextStep = marker.step + 1;
      return;
    }

    if (marker.userTurn === this.currentUserTurn) {
      this.nextStep = Math.max(this.nextStep, marker.step + 1);
    }
  }
}

/**
 * Collect the set of chronology `seq` values present in a history array.
 * Entries without a marker are ignored.
 */
function collectSeqs(history: readonly IContent[]): Set<number> {
  const seqs = new Set<number>();
  for (const item of history) {
    const seq = item.metadata?.chronology?.seq;
    if (typeof seq === 'number') {
      seqs.add(seq);
    }
  }
  return seqs;
}

function transferSemanticMediaPurgeFrontier(
  previousHistory: readonly IContent[],
  newHistory: readonly IContent[],
): IContent[] {
  const frontier = previousHistory.find(
    (content) => content.metadata?.semanticMediaPurgeFrontier !== undefined,
  )?.metadata?.semanticMediaPurgeFrontier;
  if (
    frontier === undefined ||
    newHistory.length === 0 ||
    newHistory.some(
      (content) => content.metadata?.semanticMediaPurgeFrontier !== undefined,
    )
  ) {
    return [...newHistory];
  }
  const first = newHistory[0];
  return [
    {
      ...first,
      metadata: {
        ...first.metadata,
        semanticMediaPurgeFrontier: frontier,
      },
    },
    ...newHistory.slice(1),
  ];
}

/**
 * Annotate summary entries in `newHistory` with the span of chronology seqs
 * destroyed by the compression that produced it.
 *
 * Computes the set of `seq` values present in `previousHistory` but absent
 * from `newHistory` (the items destroyed by the strategy). When any were
 * destroyed, attaches `metadata.chronologyReplaced` to every
 * `metadata.isSummary === true` entry in `newHistory` that does NOT already
 * carry a `chronologyReplaced` field.
 *
 * Designed to run BEFORE the new history is written back through
 * HistoryService, so the stamper attaches `chronology` afterwards — keeping
 * the span separate from the marker (compression builds its summary entry
 * before that entry has ever entered HistoryService, so it has no marker yet).
 *
 * Neither input array nor its items are mutated. A shallow copy of the array
 * is returned with copies made only for the summary entries that receive a
 * `chronologyReplaced` annotation; all other entries are returned by
 * reference unchanged.
 */
export function annotateCompressionSpan(
  previousHistory: readonly IContent[],
  newHistory: readonly IContent[],
): IContent[] {
  const previousSeqs = collectSeqs(previousHistory);
  const newSeqs = collectSeqs(newHistory);

  const destroyed = new Set<number>();
  for (const seq of previousSeqs) {
    if (!newSeqs.has(seq)) {
      destroyed.add(seq);
    }
  }

  if (destroyed.size === 0) {
    return transferSemanticMediaPurgeFrontier(previousHistory, newHistory);
  }

  // Iterative min/max: spreading a Set into Math.min/Math.max puts every
  // element on the call stack, which a large compressed history could overflow.
  let minSeq = Number.POSITIVE_INFINITY;
  let maxSeq = Number.NEGATIVE_INFINITY;
  for (const seq of destroyed) {
    if (seq < minSeq) {
      minSeq = seq;
    }
    if (seq > maxSeq) {
      maxSeq = seq;
    }
  }
  const span: ChronologyReplacedSpan = {
    fromSeq: minSeq,
    toSeq: maxSeq,
    itemCount: destroyed.size,
  };

  const hasSummary = newHistory.some(
    (item) => item.metadata?.isSummary === true,
  );
  if (!hasSummary) {
    return transferSemanticMediaPurgeFrontier(previousHistory, newHistory);
  }

  const annotated = newHistory.map((item) => {
    if (
      item.metadata?.isSummary === true &&
      item.metadata.chronologyReplaced === undefined
    ) {
      return {
        ...item,
        metadata: {
          ...item.metadata,
          chronologyReplaced: span,
        },
      };
    }
    return item;
  });
  return transferSemanticMediaPurgeFrontier(previousHistory, annotated);
}

/**
 * A single compact, JSON-safe projection of a history item's chronology and
 * structural descriptors. No message text, tool parameters, or tool results
 * appear in a trace entry, so the trace itself is safe to share.
 */
export interface ChronologyTraceEntry {
  readonly seq: number;
  readonly userTurn: number;
  readonly step: number;
  readonly recordedAt: number;
  readonly speaker: IContent['speaker'];
  readonly blockTypes: readonly string[];
  readonly toolCallIds: readonly string[];
  readonly toolResponseIds: readonly string[];
  readonly isSummary: boolean;
  readonly replaced?: ChronologyReplacedSpan;
}

/**
 * The chronology identity of the turn a request is being sent for.
 *
 * @issue #3130
 */
export interface CurrentTurnMarker {
  readonly turnId: string | null;
  readonly userTurn: number;
  readonly step: number;
  readonly seq: number;
}

/**
 * Find the newest history item carrying a chronology marker and project its
 * join keys. Returns `null` when no item is marked yet, so callers record an
 * explicit "unknown" rather than inventing a turn or defaulting to zero.
 *
 * @issue #3130
 */
export function findCurrentTurnMarker(
  history: readonly IContent[],
): CurrentTurnMarker | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const marker = history[i].metadata?.chronology;
    if (marker !== undefined) {
      return {
        turnId: history[i].metadata?.turnId ?? null,
        userTurn: marker.userTurn,
        step: marker.step,
        seq: marker.seq,
      };
    }
  }
  return null;
}

/**
 * Build an ordered chronology trace, one entry per history item that carries
 * a chronology marker. Items without a marker are skipped without throwing.
 *
 * The trace contains marker fields, the speaker, structural block descriptors,
 * and the `replaced` span (from `metadata.chronologyReplaced`) when present.
 * It NEVER contains message text, tool parameters, or tool results.
 */
export function buildChronologyTrace(
  history: readonly IContent[],
): ChronologyTraceEntry[] {
  const entries: ChronologyTraceEntry[] = [];
  for (const item of history) {
    const marker = item.metadata?.chronology;
    if (marker === undefined) {
      continue;
    }
    const blockTypes: string[] = [];
    const toolCallIds: string[] = [];
    const toolResponseIds: string[] = [];
    for (const block of item.blocks) {
      blockTypes.push(block.type);
      if (block.type === 'tool_call') {
        toolCallIds.push(block.id);
      } else if (block.type === 'tool_response') {
        toolResponseIds.push(block.callId);
      }
    }
    const entry: ChronologyTraceEntry = {
      seq: marker.seq,
      userTurn: marker.userTurn,
      step: marker.step,
      recordedAt: marker.recordedAt,
      speaker: item.speaker,
      blockTypes,
      toolCallIds,
      toolResponseIds,
      isSummary: item.metadata?.isSummary === true,
      ...(item.metadata?.chronologyReplaced !== undefined
        ? { replaced: item.metadata.chronologyReplaced }
        : {}),
    };
    entries.push(entry);
  }
  return entries;
}
