/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
}

export interface ReviewRewrite {
  readonly id: string;
  readonly newText: string;
}

/** Text of entries that cannot be edited is only context; keep it short. */
const CONTEXT_TEXT_LIMIT = 4000;
const GOAL_LIMIT = 2000;

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
 * Indexes of the history that make up the window: everything after the last
 * successful provider response, plus the newest compression summary when it
 * was written after that response (a summary sits at the head of the array but
 * carries a newer chronology marker than the tail it precedes).
 */
function windowIndexes(history: readonly IContent[]): number[] {
  const boundary = lastIndexWhere(history, isProviderResponse);
  const after = history.map((_, index) => index).filter((i) => i > boundary);
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
  return index < 0 ? undefined : clip(humanText(history[index]), GOAL_LIMIT);
}

/**
 * Cuts the history down to what a reviewer should read after a refusal, and
 * marks which of it may be edited: compression-summary text, tool-result text
 * and the assistant's own visible text. Everything else (human messages, tool
 * calls, media, thinking, ordering) is context only.
 */
export function buildReviewWindow(history: readonly IContent[]): ReviewWindow {
  const entries: ReviewEntry[] = [];
  const locations = new Map<string, EntryLocation>();
  for (const contentIndex of windowIndexes(history)) {
    const content = history[contentIndex];
    for (const [blockIndex, block] of content.blocks.entries()) {
      const found = blockEntry(content, block);
      const id = entryId(content, contentIndex, blockIndex);
      entries.push({
        id,
        role: content.speaker,
        kind: found.kind,
        editable: found.editable,
        text: found.editable
          ? found.text
          : clip(found.text, CONTEXT_TEXT_LIMIT),
      });
      if (found.editable && found.field !== undefined) {
        locations.set(id, { contentIndex, blockIndex, field: found.field });
      }
    }
  }
  return {
    entries,
    goal: latestGoal(history),
    snapshot: [...history],
    locations,
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

/**
 * The window's snapshot with the given edits applied. Only the targeted block
 * text changes: other blocks, call ids and names, metadata and chronology
 * markers are carried over, and untouched entries keep their identity.
 */
export function applyReviewRewrites(
  window: ReviewWindow,
  rewrites: readonly ReviewRewrite[],
): IContent[] {
  const edits = new Map<number, Array<{ at: EntryLocation; text: string }>>();
  for (const rewrite of rewrites) {
    const at = window.locations.get(rewrite.id);
    if (at === undefined) continue;
    const forContent = edits.get(at.contentIndex) ?? [];
    forContent.push({ at, text: rewrite.newText });
    edits.set(at.contentIndex, forContent);
  }
  return window.snapshot.map((content, contentIndex) => {
    const forContent = edits.get(contentIndex);
    if (forContent === undefined) return content;
    const blocks = content.blocks.map((block, blockIndex) => {
      const edit = forContent.find((e) => e.at.blockIndex === blockIndex);
      return edit === undefined
        ? block
        : withEditedBlock(block, edit.at.field, edit.text);
    });
    return { ...content, blocks };
  });
}
