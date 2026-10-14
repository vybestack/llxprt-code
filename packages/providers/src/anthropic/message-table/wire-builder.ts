/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { ImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';
import {
  convertBlockToAnthropicPart,
  convertContentToMessages,
  type AnthropicConversationConversionOptions,
  type AnthropicMessage,
} from '../AnthropicMessageNormalizer.js';
import { markAnchor } from './cache-controls.js';
import type {
  BlockFlags,
  MessageTable,
  TableMessage,
} from './message-table.js';
import { projectRow, type RowProjection } from './project-row.js';
import { filterOrphans, mergeRoles, repairAdjacency } from './validation.js';

/** Rewrites the stream of rows (for example to resolve stored media). */
export type MediaStage = (
  rows: AsyncIterable<IContent>,
) => AsyncIterable<IContent>;

/** The rows `start..end` (positions in the selection) that merge into one assistant message. */
export interface ChainRange {
  readonly start: number;
  readonly end: number;
}

export interface ChainResultsRequest {
  readonly table: MessageTable;
  readonly range: ChainRange;
  /** The open user message of tool results the chain's results join, or -1. */
  readonly pending: number;
  /** Row `index` of the selection projected, media as stored; `undefined` when dropped. */
  readonly projectedAt: (index: number) => IContent | undefined;
  /**
   * Row `index` as the conversion pass sees it: media resolved, then
   * projected. It runs the media stage on that row again, so ask only for a
   * row whose media matters.
   */
  readonly resolvedAt: (index: number) => Promise<IContent | undefined>;
  readonly options: AnthropicConversationConversionOptions;
}

/** Puts the tool results that rows of a chain carry into the table. */
export type ChainResultsAppender = (
  request: ChainResultsRequest,
) => Promise<void>;

export interface WireBuildOptions
  extends AnthropicConversationConversionOptions {
  /** Replaces oversized base64 images, as the proactive sanitizer does. */
  readonly imageBudget?: ImageDimensionBudget;
  /**
   * Resolves media on the conversion pass. It must yield one row per row it is
   * given, and it runs once per build (it registers media leases).
   */
  readonly mediaStage?: MediaStage;
  readonly signal?: AbortSignal;
  /** Defaults to {@link appendWireChainResults}. */
  readonly chainResults?: ChainResultsAppender;
}

interface BuildContext {
  readonly table: MessageTable;
  readonly rows: ProviderRequestRows;
  readonly options: WireBuildOptions;
  /** Decides which rows survive; no image budget, which never drops a row. */
  readonly indexProjection: RowProjection;
  readonly rowProjection: RowProjection;
}

interface ConversionState {
  /** The open user message of tool results, which is the table's last message, or -1. */
  pending: number;
  leading: boolean;
  skipThrough: number;
  /**
   * An anchored tool row marked the message its results flush into. The
   * converter keeps this across rows: the mark lands on the message flushed
   * next, on its last block that can hold a breakpoint.
   */
  anchorPending: boolean;
}

function isModelBoundThinking(block: ContentBlock): boolean {
  return block.type === 'thinking' && block.sourceField === 'thinking';
}

function startsThinkingChain(row: IContent, enabled: boolean): boolean {
  return (
    enabled &&
    row.speaker === 'ai' &&
    row.blocks.length > 0 &&
    row.blocks.every(isModelBoundThinking)
  );
}

function priority(block: ContentBlock): number {
  if (isModelBoundThinking(block)) return 0;
  if (block.type === 'text' || block.type === 'code') return 1;
  if (block.type === 'tool_call') return 3;
  return 2;
}

function createContext(
  table: MessageTable,
  rows: ProviderRequestRows,
  options: WireBuildOptions,
): BuildContext {
  const indexProjection: RowProjection = {
    currentModel: options.currentModel,
    currentBaseURL: options.currentBaseURL,
    logger: options.logger,
  };
  return {
    table,
    rows,
    options,
    indexProjection,
    rowProjection: { ...indexProjection, imageBudget: options.imageBudget },
  };
}

/** Row `index` of the selection, projected but with its media unresolved. */
function projectedAt(
  context: BuildContext,
  index: number,
): IContent | undefined {
  return projectRow(
    context.rows.readAt(index, context.options.signal),
    context.indexProjection,
  );
}

async function* singleRow(row: IContent): AsyncGenerator<IContent> {
  yield row;
}

async function resolvedRow(
  stage: MediaStage,
  row: IContent,
): Promise<IContent> {
  for await (const resolved of stage(singleRow(row))) return resolved;
  throw new Error('The media stage yielded no row for a row it was given');
}

/**
 * Row `index` as the conversion pass sees it: media resolved, then projected.
 * Only the rare chain whose rows carry tool results needs this; the stream of
 * the conversion pass resolves every other row.
 */
async function resolvedAt(
  context: BuildContext,
  index: number,
): Promise<IContent | undefined> {
  const raw = context.rows.readAt(index, context.options.signal);
  const stage = context.options.mediaStage;
  const resolved = stage === undefined ? raw : await resolvedRow(stage, raw);
  return projectRow(resolved, context.rowProjection);
}

/**
 * The last row of the run of AI rows that merges into the thinking-only row
 * `first` at `start`, or `start` when it does not begin a run. Rows the
 * projection drops do not interrupt a run.
 */
function chainEnd(
  context: BuildContext,
  start: number,
  first: IContent,
): number {
  if (!startsThinkingChain(first, context.options.reasoningEnabled))
    return start;
  let end = start;
  for (let index = start + 1; index < context.rows.count; index++) {
    const row = projectedAt(context, index);
    if (row?.speaker === 'ai') end = index;
    else if (row !== undefined) break;
  }
  return end;
}

function needsLastThinkingGroup(options: WireBuildOptions): boolean {
  return (
    options.includeInContext !== false &&
    options.stripFromContext === 'allButLast'
  );
}

/**
 * Pass 1: the position of the first row of the last group (a row, or a run
 * of AI rows merged into one) that holds a thinking block, or -1.
 */
async function lastThinkingGroup(context: BuildContext): Promise<number> {
  let last = -1;
  let skipThrough = -1;
  let index = -1;
  const reader = context.rows.openReader(context.options.signal);
  for await (const raw of reader) {
    index++;
    const row =
      index <= skipThrough
        ? undefined
        : projectRow(raw, context.indexProjection);
    if (row?.speaker === 'ai') {
      skipThrough = chainEnd(context, index, row);
      if (row.blocks.some((block) => block.type === 'thinking')) last = index;
    }
  }
  return last;
}

/** Tool rows before the first other row are dropped, as the array route does. */
function admitsRow(state: ConversionState, row: IContent): boolean {
  if (state.leading && row.speaker === 'tool') return false;
  state.leading = false;
  return true;
}

function redactsGroup(
  options: WireBuildOptions,
  start: number,
  lastThinking: number,
): boolean {
  return (
    options.includeInContext === false ||
    options.stripFromContext === 'all' ||
    (options.stripFromContext === 'allButLast' && start !== lastThinking)
  );
}

/**
 * The cache tags of a tool result. Its anchor is decided when the run of tool
 * rows it belongs to is flushed (see `flushAnchor`), not by the converter's
 * view of this one row.
 */
function resultFlags(table: MessageTable, block: object): BlockFlags {
  const flags = table.readBlockTags(block);
  delete flags.anchored;
  return flags;
}

function appendResult(
  table: MessageTable,
  message: AnthropicMessage,
  pending: number,
): number {
  if (typeof message.content === 'string')
    throw new Error('Tool-result message must have blocks');
  const id =
    pending === -1
      ? table.append({ role: message.role, content: [] })
      : pending;
  const record = table.messages.read(id);
  for (const block of message.content)
    table.addBlock(record, block, resultFlags(table, block));
  table.messages.replace(id, record);
  return id;
}

/**
 * The tool results the converter holds back flush as one message when the next
 * human or AI row arrives (or the rows end). If an anchored tool row asked for
 * it, that message gets the anchor. `flushed` says whether there was a message.
 */
function flushAnchor(
  table: MessageTable,
  state: ConversionState,
  flushed: boolean,
): void {
  if (state.anchorPending && flushed) markAnchor(table, table.tail);
  state.anchorPending = false;
}

/** A human row whose only payload is tool responses has no message of its own. */
function onlyToolResponses(row: IContent): boolean {
  return (
    row.blocks.some((block) => block.type === 'tool_response') &&
    row.blocks.every(
      (block) =>
        block.type === 'tool_response' ||
        block.type === 'text' ||
        block.type === 'code',
    )
  );
}

/**
 * Converts one row with the array route's own conversion and appends what it
 * makes. Tool results join the open message of the run of tool rows, which
 * the next human or AI row closes.
 */
function appendRow(
  table: MessageTable,
  row: IContent,
  redact: boolean,
  options: AnthropicConversationConversionOptions,
  state: ConversionState,
): void {
  const messages = convertContentToMessages(
    [row],
    new Set(redact ? [0] : []),
    options,
  );
  const hasResults = row.blocks.some((block) => block.type === 'tool_response');
  const anchored = row.metadata?.cacheAnchor === true;
  let open = state.pending;
  if (hasResults) open = appendResult(table, messages[0], open);
  if (row.speaker === 'tool') {
    state.pending = open;
    if (anchored) state.anchorPending = true;
    return;
  }
  flushAnchor(table, state, open !== -1);
  for (const message of messages.slice(hasResults ? 1 : 0))
    table.append(message);
  if (row.speaker === 'human' && anchored && onlyToolResponses(row))
    state.anchorPending = true;
  state.pending = -1;
}

function chainHasResponses(request: ChainResultsRequest): boolean {
  const { start, end } = request.range;
  for (let index = start; index <= end; index++)
    if (
      request
        .projectedAt(index)
        ?.blocks.some((block) => block.type === 'tool_response') === true
    )
      return true;
  return false;
}

/**
 * The tool results that rows of a chain carry. The array route merges the
 * chain into one row first, so every result gets the text and the media of
 * all the chain's rows; a row of those blocks converts the same way. Only a
 * chain that carries results has its rows resolved again.
 */
export const appendWireChainResults: ChainResultsAppender = async (request) => {
  if (!chainHasResponses(request)) return;
  const text: ContentBlock[] = [];
  const media: ContentBlock[] = [];
  const responses: ContentBlock[] = [];
  const { start, end } = request.range;
  for (let index = start; index <= end; index++) {
    const row = await request.resolvedAt(index);
    for (const block of row?.blocks ?? []) {
      if (block.type === 'text' || block.type === 'code') text.push(block);
      else if (block.type === 'media') media.push(block);
      else if (block.type === 'tool_response') responses.push(block);
    }
  }
  const [results] = convertContentToMessages(
    [{ speaker: 'tool', blocks: [...text, ...media, ...responses] }],
    new Set(),
    request.options,
  );
  appendResult(request.table, results, request.pending);
};

function appendChainRow(
  table: MessageTable,
  record: TableMessage,
  row: IContent,
  category: number,
  position: { index: number; redact: boolean },
  options: AnthropicConversationConversionOptions,
): void {
  for (const block of row.blocks) {
    if (priority(block) !== category) continue;
    const part = convertBlockToAnthropicPart(
      block,
      position.index,
      position.redact,
      options,
    );
    if (part !== null) table.addBlock(record, part);
  }
}

/**
 * A row of a chain as the array route sees it. Media only matters to an AI
 * row through the image budget (an oversized image becomes a text block), and
 * the budget needs the resolved bytes, so only a row that holds media is
 * resolved again; any other row is the same before and after resolution.
 */
async function chainRowAt(
  context: BuildContext,
  index: number,
): Promise<IContent | undefined> {
  const raw = context.rows.readAt(index, context.options.signal);
  if (raw.blocks.some((block) => block.type === 'media'))
    return resolvedAt(context, index);
  return projectRow(raw, context.rowProjection);
}

/**
 * One assistant message for a run of AI rows: the thinking blocks of every
 * row, then their text, then the other blocks, then the tool calls, each in
 * row order. Each row is read again for each of the four, one at a time.
 */
async function appendChain(
  context: BuildContext,
  range: ChainRange,
  redact: boolean,
): Promise<void> {
  // The merged row keeps the metadata of the last row of the run.
  const anchored =
    projectedAt(context, range.end)?.metadata?.cacheAnchor === true;
  const { table } = context;
  const id = table.append({ role: 'assistant', content: [] });
  const record = table.messages.read(id);
  for (let category = 0; category < 4; category++) {
    for (let index = range.start; index <= range.end; index++) {
      const row = await chainRowAt(context, index);
      if (row !== undefined)
        appendChainRow(
          table,
          record,
          row,
          category,
          { index, redact },
          context.options,
        );
    }
  }
  if (record.head === -1) record.text = '';
  table.messages.replace(id, record);
  if (anchored) markAnchor(table, id);
}

async function appendGroup(
  context: BuildContext,
  state: ConversionState,
  index: number,
  row: IContent,
  lastThinking: number,
): Promise<void> {
  const redact = redactsGroup(context.options, index, lastThinking);
  const end = chainEnd(context, index, row);
  if (end === index) {
    appendRow(context.table, row, redact, context.options, state);
    return;
  }
  const range = { start: index, end };
  const appendResults = context.options.chainResults ?? appendWireChainResults;
  const lastBefore = context.table.tail;
  await appendResults({
    table: context.table,
    range,
    pending: state.pending,
    projectedAt: (position) => projectedAt(context, position),
    resolvedAt: (position) => resolvedAt(context, position),
    options: context.options,
  });
  flushAnchor(
    context.table,
    state,
    state.pending !== -1 || context.table.tail !== lastBefore,
  );
  await appendChain(context, range, redact);
  state.pending = -1;
  state.skipThrough = end;
}

/**
 * Builds the Anthropic wire messages of `rows` into `table`, the same
 * messages `convertToAnthropicMessages` makes before its validators run.
 *
 * Pass 1 (only for the `allButLast` strip policy) finds the last group that
 * holds thinking. Pass 2 reads the rows in order through the media stage,
 * projects each (`projectRow`: image budget, cross-model strip), drops leading
 * tool rows and appends the row's messages; a thinking-only AI row that begins
 * a run of AI rows reads the run back with `readAt` and appends one message.
 * Memory holds one row, or one chain row, at a time.
 */
export async function buildWireTable(
  table: MessageTable,
  rows: ProviderRequestRows,
  options: WireBuildOptions,
): Promise<void> {
  const context = createContext(table, rows, options);
  const lastThinking = needsLastThinkingGroup(options)
    ? await lastThinkingGroup(context)
    : -1;
  const state: ConversionState = {
    pending: -1,
    leading: true,
    skipThrough: -1,
    anchorPending: false,
  };
  const reader = rows.openReader(options.signal);
  const stream = options.mediaStage?.(reader) ?? reader;
  let index = -1;
  for await (const resolved of stream) {
    index++;
    const row =
      index <= state.skipThrough
        ? undefined
        : projectRow(resolved, context.rowProjection);
    if (row !== undefined && admitsRow(state, row))
      await appendGroup(context, state, index, row, lastThinking);
  }
  if (index + 1 !== rows.count)
    throw new Error('The media stage changed the number of rows');
  flushAnchor(table, state, state.pending !== -1);
}

/**
 * The validators of `convertToAnthropicMessages` as table passes, in its
 * order: `validateToolResults` (filterOrphans), `enforceToolResultAdjacency`
 * (repairAdjacency) and the merge of `ensureValidMessageSequence`
 * (mergeRoles). The tool id index is not valid after the last one.
 */
export function validateWireTable(table: MessageTable): void {
  filterOrphans(table);
  repairAdjacency(table);
  mergeRoles(table);
}

/** {@link buildWireTable} followed by {@link validateWireTable}. */
export async function buildValidatedWireTable(
  table: MessageTable,
  rows: ProviderRequestRows,
  options: WireBuildOptions,
): Promise<void> {
  await buildWireTable(table, rows, options);
  validateWireTable(table);
}
