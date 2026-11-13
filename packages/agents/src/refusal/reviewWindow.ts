import { isDeepStrictEqual } from 'node:util';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { REVIEW_INPUT_FRACTION } from './reviewBudget.js';

export class ReviewWindowTooLarge extends Error {
  constructor() {
    super('The review window exceeds the reviewer input budget.');
  }
}
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

export type ReviewEntryKind =
  | 'summary'
  | 'tool_result'
  | 'assistant_text'
  | 'user'
  | 'other';

export type ReviewEntryRole = IContent['speaker'];

/** One reviewable piece of the history window: a single content block. */
export interface ReviewEntry {
  /** Stable for the same history: chronology marker plus block position. */
  readonly id: string;
  readonly role: ReviewEntryRole;
  readonly kind: ReviewEntryKind;
  readonly editable: boolean;
  readonly text: string;
}

/** Which field of which block an editable entry's text lives in. */
type EditableField = 'text' | 'result' | 'output';

interface EntryLocation {
  /** The committed history, or the user turn that is waiting to be committed. */
  readonly source: 'history' | 'pending';
  readonly contentIndex: number;
  readonly blockIndex: number;
  readonly field: EditableField;
}

export interface ReviewWindow {
  readonly entries: readonly ReviewEntry[];
  /** The newest human message that is not a compression summary. */
  readonly goal: string | undefined;
  /** The exact history the window was cut from, for the commit-time check. */
  readonly snapshot: readonly IContent[];
  readonly locations: ReadonlyMap<string, EntryLocation>;
  readonly sourceOrdinals?: readonly number[];
  readonly pendingSourceOrdinals?: ReadonlyMap<number, number>;
  readonly pendingSnapshot?: readonly IContent[];
  readonly isCurrent?: () => boolean;
}

/** One block of the pending user turn whose text a rewrite replaces. */
export interface PendingEdit {
  readonly contentIndex: number;
  readonly blockIndex: number;
  readonly field: EditableField;
  readonly newText: string;
}

export interface ReviewRewrite {
  readonly id: string;
  readonly newText: string;
}

/**
 * Tool calls, media descriptions and unreadable results are context only; keep
 * them short. Human messages are never clipped: the reviewer classifies the
 * work from them, and the review budget check stops a window that does not fit.
 */
const CONTEXT_TEXT_LIMIT = 4000;

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…[truncated]`;
}

function seqOf(entry: IContent): number | undefined {
  return entry.metadata?.chronology?.seq;
}

function isSummary(entry: IContent): boolean {
  return entry.metadata?.isSummary === true;
}

/** A model response that a provider actually produced (not compression filler). */
function isProviderResponse(entry: IContent): boolean {
  return (
    entry.speaker === 'ai' &&
    !isSummary(entry) &&
    entry.metadata?.synthetic !== true
  );
}

function lastIndexWhere(
  history: readonly IContent[],
  test: (entry: IContent) => boolean,
): number {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (test(history[index])) return index;
  }
  return -1;
}

/**
 * Indexes of the history that make up the window: the last successful
 * provider response and everything after it, plus the newest compression
 * summary when it was written after that response (a summary sits at the head
 * of the array but carries a newer chronology marker than the tail it
 * precedes). The response itself is part of the window because the refused
 * request resends it as input, so its own wording can be what the classifier
 * objected to.
 */
function windowIndexes(history: readonly IContent[]): number[] {
  const boundary = lastIndexWhere(history, isProviderResponse);
  const after = history
    .map((_, index) => index)
    .filter((i) => i >= Math.max(boundary, 0));
  const summaryIndex = lastIndexWhere(history, isSummary);
  if (summaryIndex < 0 || summaryIndex > boundary) return after;
  const boundarySeq = boundary < 0 ? undefined : seqOf(history[boundary]);
  const summarySeq = seqOf(history[summaryIndex]);
  const written =
    boundarySeq === undefined ||
    summarySeq === undefined ||
    summarySeq > boundarySeq;
  return written ? [summaryIndex, ...after] : after;
}

function entryId(content: IContent, contentIndex: number, block: number) {
  const seq = seqOf(content);
  return seq === undefined ? `i${contentIndex}.${block}` : `c${seq}.${block}`;
}

function toolResultText(
  result: unknown,
): { text: string; field: EditableField } | undefined {
  if (typeof result === 'string') return { text: result, field: 'result' };
  if (typeof result === 'object' && result !== null && 'output' in result) {
    const output = (result as { output: unknown }).output;
    if (typeof output === 'string') return { text: output, field: 'output' };
  }
  return undefined;
}

function describeContext(block: ContentBlock): string {
  switch (block.type) {
    case 'tool_call':
      return `tool_call ${block.name} ${JSON.stringify(block.parameters)}`;
    case 'media':
      return `[media ${block.mimeType}${block.filename ? ` ${block.filename}` : ''}]`;
    case 'thinking':
      return '[thinking block omitted]';
    case 'code':
      return block.code;
    case 'tool_response':
      return JSON.stringify(block.result ?? null);
    default:
      return block.text;
  }
}

interface BlockEntry {
  readonly kind: ReviewEntryKind;
  readonly editable: boolean;
  readonly text: string;
  readonly field?: EditableField;
}

function textBlockEntry(content: IContent, text: string): BlockEntry {
  if (isSummary(content) && content.speaker === 'human') {
    return { kind: 'summary', editable: true, text, field: 'text' };
  }
  if (content.speaker === 'human') {
    return { kind: 'user', editable: false, text };
  }
  if (content.speaker === 'ai') {
    return { kind: 'assistant_text', editable: true, text, field: 'text' };
  }
  return { kind: 'other', editable: false, text };
}

function blockEntry(content: IContent, block: ContentBlock): BlockEntry {
  if (block.type === 'text') return textBlockEntry(content, block.text);
  if (block.type === 'tool_response') {
    const readable = toolResultText(block.result);
    if (readable !== undefined) {
      return { kind: 'tool_result', editable: true, ...readable };
    }
    return {
      kind: 'tool_result',
      editable: false,
      text: describeContext(block),
    };
  }
  return { kind: 'other', editable: false, text: describeContext(block) };
}

function humanText(entry: IContent): string {
  return entry.blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n');
}

function latestGoal(history: readonly IContent[]): string | undefined {
  const index = lastIndexWhere(
    history,
    (entry) =>
      entry.speaker === 'human' &&
      !isSummary(entry) &&
      humanText(entry).trim() !== '',
  );
  return index < 0 ? undefined : humanText(history[index]);
}

interface WindowPart {
  readonly contents: readonly IContent[];
  /** Positions in `contents` that belong to the window, oldest first. */
  readonly indexes: readonly number[];
  readonly source: EntryLocation['source'];
}

function windowEntries(
  part: WindowPart,
  idOf: (content: IContent, contentIndex: number, block: number) => string,
): { entries: ReviewEntry[]; locations: Map<string, EntryLocation> } {
  const entries: ReviewEntry[] = [];
  const locations = new Map<string, EntryLocation>();
  for (const contentIndex of part.indexes) {
    const content = part.contents[contentIndex];
    for (const [blockIndex, block] of content.blocks.entries()) {
      const found = blockEntry(content, block);
      const id = idOf(content, contentIndex, blockIndex);
      entries.push({
        id,
        role: content.speaker,
        kind: found.kind,
        editable: found.editable,
        text:
          found.editable || found.kind === 'user'
            ? found.text
            : clip(found.text, CONTEXT_TEXT_LIMIT),
      });
      if (found.editable && found.field !== undefined) {
        locations.set(id, {
          source: part.source,
          contentIndex,
          blockIndex,
          field: found.field,
        });
      }
    }
  }
  return { entries, locations };
}

/**
 * Cuts the history down to what a reviewer should read after a refusal, and
 * marks which of it may be edited: compression-summary text, tool-result text
 * and the assistant's own visible text. Everything else (human messages, tool
 * calls, media, thinking, ordering) is context only.
 *
 * The user turn that was refused is not in the history yet (it is committed
 * with the model's answer), so it is read separately: its human text is the
 * newest goal and context only, its tool results are editable like any other.
 */
export function buildReviewWindow(
  history: readonly IContent[],
  pending: readonly IContent[] = [],
): ReviewWindow {
  const committed = windowEntries(
    {
      contents: history,
      indexes: windowIndexes(history),
      source: 'history',
    },
    entryId,
  );
  const waiting = windowEntries(
    {
      contents: pending,
      indexes: pending.map((_, index) => index),
      source: 'pending',
    },
    (_content, contentIndex, block) => `p${contentIndex}.${block}`,
  );
  return {
    entries: [...committed.entries, ...waiting.entries],
    goal: latestGoal(pending) ?? latestGoal(history),
    snapshot: [...history],
    locations: new Map([...committed.locations, ...waiting.locations]),
  };
}

function withEditedBlock(
  block: ContentBlock,
  field: EditableField,
  newText: string,
): ContentBlock {
  if (block.type === 'text') return { ...block, text: newText };
  if (block.type !== 'tool_response') return block;
  if (field === 'output' && typeof block.result === 'object') {
    return { ...block, result: { ...block.result, output: newText } };
  }
  return { ...block, result: newText };
}

interface BlockEdit {
  readonly contentIndex: number;
  readonly blockIndex: number;
  readonly field: EditableField;
  readonly newText: string;
}

function applyBlockEdits(
  contents: readonly IContent[],
  edits: readonly BlockEdit[],
): IContent[] {
  return contents.map((content, contentIndex) => {
    const forContent = edits.filter((e) => e.contentIndex === contentIndex);
    if (forContent.length === 0) return content;
    const blocks = content.blocks.map((block, blockIndex) => {
      const edit = forContent.find((e) => e.blockIndex === blockIndex);
      return edit === undefined
        ? block
        : withEditedBlock(block, edit.field, edit.newText);
    });
    return { ...content, blocks };
  });
}

function editsAt(
  window: ReviewWindow,
  rewrites: readonly ReviewRewrite[],
  source: EntryLocation['source'],
): BlockEdit[] {
  return rewrites.flatMap((rewrite) => {
    const at = window.locations.get(rewrite.id);
    return at === undefined || at.source !== source
      ? []
      : [
          {
            contentIndex: at.contentIndex,
            blockIndex: at.blockIndex,
            field: at.field,
            newText: rewrite.newText,
          },
        ];
  });
}

/**
 * The window's snapshot with the given edits applied. Only the targeted block
 * text changes: other blocks, call ids and names, metadata and chronology
 * markers are carried over, and untouched entries keep their identity. Edits
 * to the pending user turn are not part of the history; see
 * {@link pendingEditsOf}.
 */
export function applyReviewRewrites(
  window: ReviewWindow,
  rewrites: readonly ReviewRewrite[],
): IContent[] {
  return applyBlockEdits(window.snapshot, editsAt(window, rewrites, 'history'));
}

/** The rewrites that land on the pending user turn rather than the history. */
export function pendingEditsOf(
  window: ReviewWindow,
  rewrites: readonly ReviewRewrite[],
): PendingEdit[] {
  return editsAt(window, rewrites, 'pending');
}

/** The pending user turn's contents with the given edits applied. */
export function applyPendingEdits(
  contents: readonly IContent[],
  edits: readonly PendingEdit[],
): IContent[] {
  return applyBlockEdits(contents, edits);
}

/** Reads the reviewable suffix from a pinned journal without retaining older rows. */
export async function openReviewWindow(
  history: HistoryService,
  pending: readonly IContent[],
  contextLimit: number,
): Promise<ReviewWindow> {
  await history.waitForCommit();
  const isCurrent = history.historyMutationGuard();
  const snapshot = await history.openDumpSnapshot();
  try {
    const rows = snapshot.callerOwnedRows;
    if (rows === undefined)
      throw new Error('Review requires indexed journal rows');
    const budget = reviewRetentionBudget(contextLimit);
    for (const row of pending) budget.retain(row);
    const { selected, boundary, summary, goal } = await readReviewSuffix(
      rows,
      budget,
    );
    selected.reverse();
    if (
      summary !== undefined &&
      !selected.some((entry) => entry.ordinal === summary.ordinal)
    ) {
      const boundarySeq = boundary === undefined ? undefined : seqOf(boundary);
      const summarySeq = seqOf(summary.row);
      if (
        boundarySeq === undefined ||
        summarySeq === undefined ||
        summarySeq > boundarySeq
      ) {
        budget.retain(summary.row);
        selected.unshift(summary);
      }
    }
    const pendingSourceOrdinals = new Map<number, number>();
    const committed = selected.filter(({ row, ordinal }) => {
      const index = pending.findIndex(
        (waiting) =>
          waiting.metadata?.turnId !== undefined &&
          waiting.metadata.turnId === row.metadata?.turnId &&
          waiting.speaker === row.speaker &&
          isDeepStrictEqual(waiting.blocks, row.blocks),
      );
      if (index < 0) return true;
      pendingSourceOrdinals.set(index, ordinal);
      return false;
    });
    const window = buildReviewWindow(
      committed.map((entry) => entry.row),
      pending,
    );
    return {
      ...window,
      goal: window.goal ?? goal,
      sourceOrdinals: committed.map((entry) => entry.ordinal),
      pendingSourceOrdinals,
      pendingSnapshot: pending,
      isCurrent,
    };
  } finally {
    await snapshot.close();
  }
}

interface ReviewSuffix {
  readonly selected: Array<{ ordinal: number; row: IContent }>;
  readonly boundary: IContent | undefined;
  readonly summary: { ordinal: number; row: IContent } | undefined;
  readonly goal: string | undefined;
}

function reviewRetentionBudget(contextLimit: number): {
  retain(row: IContent): void;
} {
  const limit = Math.floor(contextLimit * REVIEW_INPUT_FRACTION);
  let tokens = 0;
  let bytes = 0;
  return {
    retain(row) {
      const serialized = JSON.stringify(row);
      bytes += Buffer.byteLength(serialized);
      for (const block of row.blocks) {
        const entry = blockEntry(row, block);
        tokens += estimateTokens(
          entry.editable || entry.kind === 'user'
            ? entry.text
            : clip(entry.text, CONTEXT_TEXT_LIMIT),
        );
        tokens += 1;
      }
      if (tokens > limit || bytes > limit * 64)
        throw new ReviewWindowTooLarge();
    },
  };
}

async function readReviewSuffix(
  rows: ProviderRequestRows,
  budget: ReturnType<typeof reviewRetentionBudget>,
): Promise<ReviewSuffix> {
  const selected: Array<{ ordinal: number; row: IContent }> = [];
  let boundary: IContent | undefined;
  let summary: { ordinal: number; row: IContent } | undefined;
  let goal: string | undefined;
  for (let ordinal = rows.count - 1; ordinal >= 0; ordinal--) {
    const row = await rows.readAt(ordinal);
    if (boundary === undefined) {
      budget.retain(row);
      selected.push({ ordinal, row });
      if (isProviderResponse(row)) boundary = row;
    }
    if (summary === undefined && isSummary(row)) summary = { ordinal, row };
    goal ??= latestGoal([row]);
  }
  return { selected, boundary, summary, goal };
}
