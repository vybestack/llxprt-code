/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SemanticMediaPurgeCacheWriteEvidence } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AnthropicMessageBlock } from '../AnthropicMessageNormalizer.js';
import { getEmptyMessagePlaceholder } from '../AnthropicMessageValidator.js';
import { modelSupportsPrefill } from '../AnthropicModelData.js';
import { sanitizeBlockForCacheControl } from '../AnthropicRequestBuilder.js';
import {
  attachAnchorCacheControl,
  attachMediaPurgeCacheControl,
  attachTailCacheControl,
} from './cache-controls.js';
import {
  newMessage,
  type MessageTable,
  type TableMessage,
} from './message-table.js';

type Ttl = '5m' | '1h';
type Logger = { debug: (fn: () => string) => void };

const CONTINUE_TEXT = 'Continue the conversation';

function textMessage(role: TableMessage['role'], text: string): TableMessage {
  return { ...newMessage(role), text };
}

/**
 * Whether a block of a merged message goes first: the tool results of a user
 * message, the thinking blocks of an assistant message.
 */
export function leadsMergedMessage(
  block: AnthropicMessageBlock,
  role: TableMessage['role'],
): boolean {
  return role === 'user'
    ? block.type === 'tool_result'
    : block.type === 'thinking' || block.type === 'redacted_thinking';
}

interface BlockList {
  head: number;
  tail: number;
}

function appendToList(table: MessageTable, list: BlockList, id: number): void {
  const entry = table.blocks.read(id);
  table.blocks.replace(id, { ...entry, prev: list.tail, next: -1 });
  if (list.tail === -1) list.head = id;
  else {
    const last = table.blocks.read(list.tail);
    table.blocks.replace(list.tail, { ...last, next: id });
  }
  list.tail = id;
}

function joinLists(
  table: MessageTable,
  lead: BlockList,
  rest: BlockList,
): BlockList {
  if (lead.head === -1) return rest;
  if (rest.head === -1) return lead;
  const last = table.blocks.read(lead.tail);
  table.blocks.replace(lead.tail, { ...last, next: rest.head });
  const first = table.blocks.read(rest.head);
  table.blocks.replace(rest.head, { ...first, prev: lead.tail });
  return { head: lead.head, tail: rest.tail };
}

/**
 * Puts the blocks of every merged message in the order the array route's merge
 * gives them (the leading kind first, each kind in its own order), by
 * relinking the block records. It holds one record at a time.
 */
export function orderMergedMessages(table: MessageTable): void {
  for (const id of table.ids()) {
    const message = table.messages.read(id);
    if (message.ordered !== true) continue;
    const lead: BlockList = { head: -1, tail: -1 };
    const rest: BlockList = { head: -1, tail: -1 };
    let blockId = message.head;
    while (blockId !== -1) {
      const entry = table.blocks.read(blockId);
      appendToList(
        table,
        leadsMergedMessage(entry.block, message.role) ? lead : rest,
        blockId,
      );
      blockId = entry.next;
    }
    const joined = joinLists(table, lead, rest);
    message.head = joined.head;
    message.tail = joined.tail;
    delete message.ordered;
    table.messages.replace(id, message);
  }
}

/** The message holds only this text; its blocks, if any, are dropped. */
function replaceWithText(
  table: MessageTable,
  id: number,
  message: TableMessage,
  text: string,
): void {
  message.text = text;
  message.head = -1;
  message.tail = -1;
  table.messages.replace(id, message);
}

function addTrailingUser(
  table: MessageTable,
  reasoningEnabled: boolean,
  modelId: string | undefined,
  logger: Logger,
): void {
  if (
    table.messages.read(table.tail).role !== 'assistant' ||
    !(reasoningEnabled || !modelSupportsPrefill(modelId))
  )
    return;
  const reason = reasoningEnabled
    ? 'thinking enabled'
    : 'model does not support prefill';
  logger.debug(
    () =>
      `Last message is assistant with ${reason}, adding placeholder user message to avoid prefill error`,
  );
  table.insertAfter(table.tail, textMessage('user', CONTINUE_TEXT));
}

/** Removes empty text blocks of one message and returns how many went. */
function stripEmptyBlocks(
  table: MessageTable,
  id: number,
  message: TableMessage,
): number {
  if (message.text !== undefined) {
    if (message.text.trim() !== '') return 0;
    replaceWithText(
      table,
      id,
      message,
      getEmptyMessagePlaceholder(message.role),
    );
    return 1;
  }
  if (message.head === -1) {
    replaceWithText(
      table,
      id,
      message,
      getEmptyMessagePlaceholder(message.role),
    );
    return 1;
  }
  let removed = 0;
  for (const entry of table.entries(message)) {
    if (entry.block.type === 'text' && entry.block.text.trim() === '') {
      table.unlinkBlock(message, entry.id);
      removed++;
    }
  }
  if (removed === 0) return 0;
  if (message.head === -1)
    replaceWithText(
      table,
      id,
      message,
      getEmptyMessagePlaceholder(message.role),
    );
  else table.messages.replace(id, message);
  return removed;
}

/**
 * Empty or whitespace-only text blocks leave the messages (strict endpoints
 * reject them), and a message left with nothing holds its role's placeholder.
 */
function stripEmptyTextBlocks(table: MessageTable, logger: Logger): void {
  let stripped = 0;
  for (const id of table.ids())
    stripped += stripEmptyBlocks(table, id, table.messages.read(id));
  if (stripped > 0)
    logger.debug(
      () =>
        `[AnthropicProvider] Stripped ${stripped} empty text block(s) from request messages`,
    );
}

export interface FinishPassOptions {
  readonly reasoningEnabled: boolean;
  readonly currentModel?: string;
  readonly logger: Logger;
}

/**
 * The array stages that follow the merge in `ensureValidMessageSequence`, then
 * `stripEmptyTextBlocks`, as table edits: the merged messages' block order, a
 * user message first, a message at all, a user message after a trailing
 * assistant message, and placeholders for empty messages. The array route's
 * `sanitizeEmptyMessages` (placeholders for empty messages but the last) is
 * subsumed by `stripEmptyTextBlocks`, which gives every empty message its
 * placeholder, so the table has the one pass.
 */
export function finishWireTable(
  table: MessageTable,
  options: FinishPassOptions,
): void {
  const { logger } = options;
  orderMergedMessages(table);
  if (table.head !== -1 && table.messages.read(table.head).role !== 'user') {
    logger.debug(
      () => 'First message is not from user, adding placeholder user message',
    );
    table.prepend(textMessage('user', CONTINUE_TEXT));
  }
  if (table.head === -1) table.prepend(textMessage('user', 'Hello'));
  addTrailingUser(
    table,
    options.reasoningEnabled,
    options.currentModel,
    logger,
  );
  stripEmptyTextBlocks(table, logger);
}

/**
 * Puts the system instruction at the top of the context as a user message
 * that nothing merges into. With `ttl` the message carries a breakpoint.
 */
export function placeContextPrefix(
  table: MessageTable,
  prefix: { readonly text: string; readonly ttl?: Ttl },
): void {
  const message = newMessage('user');
  if (prefix.ttl === undefined) message.text = prefix.text;
  else
    table.addBlock(
      message,
      sanitizeBlockForCacheControl(
        { type: 'text', text: prefix.text },
        prefix.ttl,
      ),
    );
  table.prepend(message);
}

export interface RequestCacheOptions {
  readonly ttl: Ttl;
  /** Whether the semantic media purge mode asks for a boundary breakpoint. */
  readonly mediaPurgeBoundary: boolean;
}

export interface WireRequestOptions extends FinishPassOptions {
  /** The formatted system instruction for `context-prefix` placement. */
  readonly contextPrefix?: string;
  /** Present when prompt caching is on. */
  readonly caching?: RequestCacheOptions;
}

/**
 * Everything that happens to the messages after the table passes, in the
 * order of `prepareAnthropicRequest`: the finishing passes, the context
 * prefix, then the cache controls (last message, anchor, media purge). Returns
 * the media purge evidence.
 */
export function finishWireRequest(
  table: MessageTable,
  options: WireRequestOptions,
): SemanticMediaPurgeCacheWriteEvidence | undefined {
  finishWireTable(table, options);
  const { caching, contextPrefix, logger } = options;
  if (contextPrefix !== undefined && contextPrefix !== '') {
    placeContextPrefix(table, { text: contextPrefix, ttl: caching?.ttl });
    if (caching !== undefined)
      logger.debug(
        () => 'Added cache_control to context-prefixed system instruction',
      );
  }
  if (caching === undefined) return undefined;
  attachTailCacheControl(table, caching.ttl, logger);
  attachAnchorCacheControl(table, caching.ttl, logger);
  if (!caching.mediaPurgeBoundary) return undefined;
  return attachMediaPurgeCacheControl(table, caching.ttl, logger);
}
