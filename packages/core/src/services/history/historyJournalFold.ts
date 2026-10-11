/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  isRecord,
  fieldOf,
  isSpeakerContent,
  isValidSequence,
  isSpeakerContentArray,
  isDensityReplacementRecord,
} from './historyJournalGuards.js';
import {
  parseChronologyBinding,
  type ChronologyBinding,
} from '../../recording/chronologyBinding.js';
import { invalidateResponsesStatefulChain, type IContent } from './IContent.js';
import {
  arrayRowStore,
  contentTxId,
  ReplaceTransactionFold,
  requireRowCount,
  requireTxId,
} from '../../recording/replaceTransaction.js';
import type { HistoryJournalOp } from './historyJournalStore.js';

/**
 * Kind-neutral fold event: ops (pending) and parsed journal envelopes
 * (durable) normalize to this shape so a single fold implementation serves
 * both layers.
 */
export type FoldEvent =
  | {
      readonly kind: 'chronologyBind';
      readonly binding: ChronologyBinding;
      readonly content?: IContent;
    }
  | {
      readonly kind: 'content';
      readonly content: IContent;
      readonly tx?: string;
    }
  | { readonly kind: 'replaceBegin'; readonly txId: string }
  | {
      readonly kind: 'replaceCommit';
      readonly txId: string;
      readonly rowCount: number;
    }
  | {
      readonly kind: 'replaceAbort';
      readonly txId: string;
      readonly rowCount: number;
    }
  | {
      readonly kind: 'rewind';
      readonly itemsRemoved: number;
      readonly cutSeq?: number;
    }
  | {
      readonly kind: 'compressed';
      readonly summary: IContent;
      readonly itemsCompressed: number;
    }
  | { readonly kind: 'compressionDetail' }
  | {
      readonly kind: 'syntheticInsert';
      readonly content: IContent;
      readonly chronologySeq: number;
      readonly afterSeq: number;
    }
  | {
      readonly kind: 'density';
      readonly removedSeqs: readonly number[];
      readonly replacements: ReadonlyArray<{
        readonly replacedSeq: number;
        readonly replacement: IContent;
      }>;
    }
  | { readonly kind: 'semanticPurge'; readonly history: readonly IContent[] };

/** Recording versions this store folds, mirroring the resolver. */
const SUPPORTED_RECORDING_VERSIONS = new Set([1, 2]);

function chronSeqOf(content: IContent): number | null {
  const seq = content.metadata?.chronology?.seq;
  return typeof seq === 'number' ? seq : null;
}

// ---------------------------------------------------------------------------
// Mutation planning: the diff from the previous projection to the next one,
// expressed in journal ops. Pure functions — the core stamps chronology and
// derives membership spans before calling these.
// ---------------------------------------------------------------------------

/**
 * Plan a validated density pass as one `density_mutation` op, addressed by
 * chronology marker. Returns null when any affected row is unmarked — the
 * journal cannot address it, so the caller falls back to the wholesale
 * rewrite plan.
 */

// ---------------------------------------------------------------------------
// Op ↔ envelope ↔ fold-event mapping
// ---------------------------------------------------------------------------

export function opToEvent(op: HistoryJournalOp): FoldEvent {
  switch (op.kind) {
    case 'content':
      return { kind: 'content', content: op.content, tx: op.tx };
    case 'replaceBegin':
    case 'replaceCommit':
    case 'replaceAbort':
      return op;
    case 'rewind':
      return {
        kind: 'rewind',
        itemsRemoved: op.itemsRemoved,
        cutSeq: op.cutSeq,
      };
    case 'compressed':
      return {
        kind: 'compressed',
        summary: op.summary,
        itemsCompressed: op.itemsCompressed,
      };
    case 'compressionDetail':
      return { kind: 'compressionDetail' };
    case 'syntheticInsert':
      return {
        kind: 'syntheticInsert',
        content: op.payload.content,
        chronologySeq: op.payload.chronologySeq,
        afterSeq: op.payload.afterSeq,
      };
    case 'density':
      return {
        kind: 'density',
        removedSeqs: op.payload.removedSeqs,
        replacements: op.payload.replacements,
      };
    default: {
      // Exhaustiveness guard: a new op kind must map onto a fold event.
      const exhaustive: never = op;
      void exhaustive;
      throw new Error('unreachable: unmapped history journal op');
    }
  }
}

/**
 * Map a parsed journal envelope onto a fold event; null for session
 * bookkeeping, metadata events, and any payload that fails its engine-parity
 * validation (those records are skipped, matching the resolver).
 */
function chronologyBindingEvent(payload: unknown): FoldEvent | null {
  const binding = parseChronologyBinding(payload);
  const content = fieldOf(payload, 'content');
  if (binding === null || (content !== undefined && !isSpeakerContent(content)))
    return null;
  return { kind: 'chronologyBind', binding, content };
}

function syntheticInsertEvent(payload: unknown): FoldEvent | null {
  const content = fieldOf(payload, 'content');
  const chronologySeq = fieldOf(payload, 'chronologySeq');
  const afterSeq = fieldOf(payload, 'afterSeq');
  if (
    !isSpeakerContent(content) ||
    !isValidSequence(chronologySeq) ||
    !isValidSequence(afterSeq)
  ) {
    return null;
  }
  return { kind: 'syntheticInsert', content, chronologySeq, afterSeq };
}

function replaceEvent(type: string, payload: unknown): FoldEvent {
  const txId = requireTxId(payload);
  if (type === 'replace_begin') return { kind: 'replaceBegin', txId };
  const rowCount = requireRowCount(payload);
  return type === 'replace_commit'
    ? { kind: 'replaceCommit', txId, rowCount }
    : { kind: 'replaceAbort', txId, rowCount };
}

function envelopeToEvent(type: string, payload: unknown): FoldEvent | null {
  switch (type) {
    case 'chronology_bind':
      return chronologyBindingEvent(payload);
    case 'content': {
      const content = fieldOf(payload, 'content');
      const tx = contentTxId(payload);
      return isSpeakerContent(content)
        ? { kind: 'content', content, tx }
        : null;
    }
    case 'replace_begin':
    case 'replace_commit':
    case 'replace_abort':
      return replaceEvent(type, payload);
    case 'rewind': {
      const itemsRemoved = fieldOf(payload, 'itemsRemoved');
      if (typeof itemsRemoved !== 'number' || itemsRemoved < 0) return null;
      const cutSeq = fieldOf(payload, 'cutSeq');
      return {
        kind: 'rewind',
        itemsRemoved,
        cutSeq: cutSeq === undefined ? undefined : (cutSeq as number),
      };
    }
    case 'compressed': {
      const summary = fieldOf(payload, 'summary');
      const itemsCompressed = fieldOf(payload, 'itemsCompressed');
      if (!isSpeakerContent(summary) || itemsCompressed === undefined) {
        return null;
      }
      return {
        kind: 'compressed',
        summary,
        itemsCompressed: itemsCompressed as number,
      };
    }
    case 'compression_detail':
      return { kind: 'compressionDetail' };
    case 'synthetic_insert':
      return syntheticInsertEvent(payload);
    case 'density_mutation': {
      const removedSeqs = fieldOf(payload, 'removedSeqs');
      const replacements = fieldOf(payload, 'replacements');
      if (
        !Array.isArray(removedSeqs) ||
        !removedSeqs.every(isValidSequence) ||
        !Array.isArray(replacements) ||
        !replacements.every(isDensityReplacementRecord)
      ) {
        return null;
      }
      return {
        kind: 'density',
        removedSeqs,
        replacements,
      };
    }
    case 'semantic_media_purge': {
      const history = fieldOf(payload, 'history');
      if (!isSpeakerContentArray(history)) return null;
      return { kind: 'semanticPurge', history };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The fold (mirrors JournalResolver's rules; divergences noted)
// ---------------------------------------------------------------------------

/**
 * Fold events oldest-first into the surviving content rows. Local mutable
 * state only — the result array is the caller's transient materialization.
 */
export function foldEvents(
  events: ReadonlyArray<FoldEvent | null>,
  initial: readonly IContent[] = [],
  tx: ReplaceTransactionFold = new ReplaceTransactionFold(),
  finish = true,
): IContent[] {
  const rows: IContent[] = [...initial];
  for (const event of events) {
    if (event === null) continue;
    applyFoldEvent(rows, event, tx);
  }
  if (finish) tx.abandon(arrayRowStore(rows));
  return rows;
}

/** Rewind: cut at the marked seq when resolvable, else drop the tail count. */
function rewindRows(
  rows: IContent[],
  itemsRemoved: number,
  cutSeq?: number,
): void {
  if (cutSeq !== undefined) {
    const cut = rows.findIndex((row) => chronSeqOf(row) === cutSeq);
    if (cut !== -1) {
      rows.length = cut;
      return;
    }
  }
  rows.length = Math.max(0, rows.length - itemsRemoved);
}

/** Insert an unjournalled-mutation entry after its marked anchor row. */
function insertAfterAnchor(
  rows: IContent[],
  content: IContent,
  afterSeq: number,
): void {
  const anchor = rows.findIndex((row) => chronSeqOf(row) === afterSeq);
  if (anchor !== -1) {
    rows.splice(anchor + 1, 0, content);
  }
}

/** Resolve one row against a density pass: replacement, removal, or kept. */
function resolveDensityRow(
  row: IContent,
  removed: ReadonlySet<number>,
  replacementBySeq: ReadonlyMap<number, IContent>,
): IContent | null {
  const chron = chronSeqOf(row);
  if (chron === null) return row;
  const replacement = replacementBySeq.get(chron);
  if (replacement !== undefined) return replacement;
  return removed.has(chron) ? null : row;
}

/**
 * Apply a density event row-wise: replacement wins over removal, matching the
 * live density projection. Divergence from the resolver: a density mutation
 * that touches rows inside a semantic_media_purge survivor is skipped there
 * (coarse purge units) and applied row-wise here, where the purge is already
 * flattened.
 */
function applyDensityEvent(
  rows: IContent[],
  event: Extract<FoldEvent, { readonly kind: 'density' }>,
): void {
  const removed = new Set<number>(event.removedSeqs);
  const replacementBySeq = new Map<number, IContent>();
  for (const entry of event.replacements) {
    replacementBySeq.set(entry.replacedSeq, entry.replacement);
  }
  const surviving: IContent[] = [];
  for (const row of rows) {
    const resolved = resolveDensityRow(row, removed, replacementBySeq);
    if (resolved !== null) surviving.push(resolved);
  }
  rows.length = 0;
  for (const row of surviving) {
    rows.push(row);
  }
}

/** Apply one fold event to the transient rows. */
export function applyFoldEvent(
  rows: IContent[],
  event: FoldEvent,
  tx: ReplaceTransactionFold,
): void {
  const store = arrayRowStore(rows);
  switch (event.kind) {
    case 'replaceBegin':
      tx.begin(event.txId, store);
      return;
    case 'replaceCommit':
      tx.commit(event.txId, event.rowCount, store);
      return;
    case 'replaceAbort':
      tx.abort(event.txId, store);
      return;
    case 'content':
      if (event.tx === undefined) tx.abandon(store);
      else tx.accept(event.tx);
      break;
    default:
      tx.abandon(store);
  }
  applyRowEvent(rows, event);
}

function applyRowEvent(
  rows: IContent[],
  event: Exclude<
    FoldEvent,
    { readonly kind: 'replaceBegin' | 'replaceCommit' | 'replaceAbort' }
  >,
): void {
  if (event.kind === 'chronologyBind') {
    if (event.binding.rowIndex >= rows.length) return;
    const row = event.content ?? rows[event.binding.rowIndex];
    const restored =
      event.binding.invalidateResponses === true
        ? invalidateResponsesStatefulChain([row])[0]
        : row;
    rows[event.binding.rowIndex] = {
      ...restored,
      metadata: { ...restored.metadata, chronology: event.binding.chronology },
    };
    return;
  }

  switch (event.kind) {
    case 'content':
      rows.push(event.content);
      break;
    case 'rewind':
      rewindRows(rows, event.itemsRemoved, event.cutSeq);
      break;
    case 'compressed':
      rows.length = 0;
      rows.push(event.summary);
      break;
    case 'compressionDetail':
      // Membership-pinning record; a no-op for the row fold (parity).
      break;
    case 'syntheticInsert':
      insertAfterAnchor(rows, event.content, event.afterSeq);
      break;
    case 'density':
      applyDensityEvent(rows, event);
      break;
    case 'semanticPurge':
      rows.length = 0;
      rows.push(...event.history);
      break;
    default: {
      // Exhaustiveness guard: a new fold event must state its fold rule.
      const exhaustive: never = event;
      void exhaustive;
      throw new Error('unreachable: unmapped history fold event');
    }
  }
}

/**
 * Parse one decoded journal line into a fold event; null for blank lines,
 * unparseable crash-torn tails, session bookkeeping, and payloads that fail
 * their engine-parity validation (all skipped, matching the resolver).
 */
function parseFoldLine(raw: string, isFirstLine: boolean): FoldEvent | null {
  if (raw.length === 0) return null;
  const body = isFirstLine && raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  if (body.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Unparseable mid-file line or crash-torn tail: skipped (parity).
    return null;
  }
  if (!isRecord(parsed)) return null;
  const version = parsed['v'];
  if (
    typeof version !== 'number' ||
    !SUPPORTED_RECORDING_VERSIONS.has(version)
  ) {
    throw new Error(
      `Unsupported recording version ${String(version)} in history journal`,
    );
  }
  const type = parsed['type'];
  if (typeof type !== 'string') return null;
  return envelopeToEvent(type, parsed['payload']);
}

/** Split a decoded journal byte range into fold events, one per line. */
export function parseFoldEvents(text: string): Array<FoldEvent | null> {
  const lines = text.split('\n');
  const events: Array<FoldEvent | null> = [];
  for (let index = 0; index < lines.length; index += 1) {
    events.push(parseFoldLine(lines[index], index === 0));
  }
  return events;
}
