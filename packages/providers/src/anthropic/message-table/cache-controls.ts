/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SemanticMediaPurgeCacheWriteEvidence } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  sanitizeBlockForCacheControl,
  selectLastCacheableBlockIndex,
} from '../AnthropicRequestBuilder.js';
import type {
  MessageTable,
  StoredMessageBlock,
  TableMessage,
} from './message-table.js';

type Ttl = '5m' | '1h';
type Logger = { debug: (fn: () => string) => void };

/** A spot in the table: a message and one of its blocks (-1: its string content). */
interface Location {
  readonly message: number;
  readonly block: number;
}

function cacheable(block: StoredMessageBlock): boolean {
  return selectLastCacheableBlockIndex([block]) === 0;
}

/** The last block at or before record `from` that can hold a breakpoint, or -1. */
function lastCacheableBlock(table: MessageTable, from: number): number {
  let id = from;
  while (id !== -1) {
    const entry = table.blocks.read(id);
    if (cacheable(entry.block)) return id;
    id = entry.prev;
  }
  return -1;
}

function addBreakpoint(table: MessageTable, id: number, ttl: Ttl): void {
  const entry = table.blocks.read(id);
  table.blocks.replace(id, {
    ...entry,
    block: sanitizeBlockForCacheControl(entry.block, ttl),
  });
}

/**
 * Turns string content into a one-block list that holds a breakpoint. The
 * array route leaves the message's tags behind on content that is no longer a
 * string, where nothing reads them, so they go with the string.
 */
function addBreakpointToText(
  table: MessageTable,
  id: number,
  message: TableMessage,
  ttl: Ttl,
): void {
  if (message.text === undefined)
    throw new Error('A message with blocks has no string content');
  const block = sanitizeBlockForCacheControl(
    { type: 'text', text: message.text },
    ttl,
  );
  delete message.text;
  delete message.anchorText;
  delete message.purgeText;
  table.addBlock(message, block);
  table.messages.replace(id, message);
}

function addBreakpointAt(table: MessageTable, at: Location, ttl: Ttl): void {
  if (at.block === -1)
    addBreakpointToText(
      table,
      at.message,
      table.messages.read(at.message),
      ttl,
    );
  else addBreakpoint(table, at.block, ttl);
}

/** Marks the last block of message `id` that can hold a breakpoint as the cache anchor. */
export function markAnchor(table: MessageTable, id: number): void {
  const message = table.messages.read(id);
  if (message.text !== undefined) {
    if (message.text.trim().length === 0) return;
    message.anchorText = true;
    table.messages.replace(id, message);
    return;
  }
  const blockId = lastCacheableBlock(table, message.tail);
  if (blockId === -1) return;
  table.blocks.replace(blockId, {
    ...table.blocks.read(blockId),
    anchored: true,
  });
}

/**
 * A breakpoint on the last message's last block that can hold one. The table
 * has been finished, so a string tail is never blank.
 */
export function attachTailCacheControl(
  table: MessageTable,
  ttl: Ttl,
  logger: Logger,
): void {
  if (table.tail === -1) return;
  const message = table.messages.read(table.tail);
  if (message.text !== undefined) {
    addBreakpointToText(table, table.tail, message, ttl);
    logger.debug(
      () => 'Added cache_control to last message (converted string to array)',
    );
    return;
  }
  const blockId = lastCacheableBlock(table, message.tail);
  if (blockId === -1) return;
  addBreakpoint(table, blockId, ttl);
  logger.debug(
    () =>
      `Added cache_control to last message's last ${table.blocks.read(blockId).block.type} block`,
  );
}

/** The first anchored spot in message order, or undefined. */
function firstAnchor(table: MessageTable): Location | undefined {
  for (const id of table.ids()) {
    const message = table.messages.read(id);
    if (message.text !== undefined) {
      if (message.anchorText === true && message.text.trim() !== '')
        return { message: id, block: -1 };
      continue;
    }
    for (const entry of table.entries(message))
      if (entry.anchored === true) return { message: id, block: entry.id };
  }
  return undefined;
}

/** A breakpoint at the preserved-head anchor, unless that block already has one. */
export function attachAnchorCacheControl(
  table: MessageTable,
  ttl: Ttl,
  logger: Logger,
): void {
  const anchor = firstAnchor(table);
  if (anchor === undefined) return;
  if (
    anchor.block !== -1 &&
    'cache_control' in table.blocks.read(anchor.block).block
  )
    return;
  addBreakpointAt(table, anchor, ttl);
  if (anchor.block === -1)
    logger.debug(
      () => 'Added anchor cache_control (converted string content to array)',
    );
}

/** What one pass over the table finds out for the media purge boundary. */
interface PurgeFacts {
  /** Boundary tags found; counting stops mattering past one. */
  tags: number;
  tagged: Location | undefined;
  oldestImage: Location | undefined;
  breakpoints: number;
}

function scanPurgeFacts(table: MessageTable): PurgeFacts {
  const facts: PurgeFacts = {
    tags: 0,
    tagged: undefined,
    oldestImage: undefined,
    breakpoints: 0,
  };
  for (const id of table.ids()) {
    const message = table.messages.read(id);
    if (message.text !== undefined) {
      if (message.purgeText === true) {
        facts.tags++;
        facts.tagged = { message: id, block: -1 };
      }
      continue;
    }
    for (const entry of table.entries(message)) {
      if ('cache_control' in entry.block) facts.breakpoints++;
      if (entry.purge === true) {
        facts.tags++;
        facts.tagged = { message: id, block: entry.id };
      }
      if (facts.oldestImage === undefined && entry.block.type === 'image')
        facts.oldestImage = { message: id, block: entry.id };
    }
  }
  return facts;
}

/** The last spot that can hold a breakpoint in front of `image`. */
function previousCacheable(
  table: MessageTable,
  image: Location,
): Location | undefined {
  const inMessage = lastCacheableBlock(
    table,
    table.blocks.read(image.block).prev,
  );
  if (inMessage !== -1) return { message: image.message, block: inMessage };
  let id = table.messages.read(image.message).prev;
  while (id !== -1) {
    const message = table.messages.read(id);
    if (message.text !== undefined) {
      if (message.text.trim().length > 0) return { message: id, block: -1 };
    } else {
      const block = lastCacheableBlock(table, message.tail);
      if (block !== -1) return { message: id, block };
    }
    id = message.prev;
  }
  return undefined;
}

function sameSpot(left: Location, right: Location): boolean {
  return left.message === right.message && left.block === right.block;
}

const MAX_MESSAGE_BREAKPOINTS = 3;

/**
 * A breakpoint at the one tagged boundary when it is exactly the block before
 * the oldest image and a breakpoint slot is free.
 */
export function attachMediaPurgeCacheControl(
  table: MessageTable,
  ttl: Ttl,
  logger: Logger,
): SemanticMediaPurgeCacheWriteEvidence | undefined {
  const facts = scanPurgeFacts(table);
  const { tagged, oldestImage } = facts;
  if (facts.tags !== 1 || tagged === undefined || oldestImage === undefined)
    return undefined;
  const boundaryId = table.purgeBoundaryId;
  if (boundaryId === undefined)
    throw new Error('A tagged media purge boundary has no identity');
  const expected = previousCacheable(table, oldestImage);
  if (expected === undefined || !sameSpot(tagged, expected)) {
    logger.debug(
      () =>
        'Skipped media purge cache_control: tagged boundary did not match the exact pre-image prefix',
    );
    return undefined;
  }
  if (
    tagged.block !== -1 &&
    'cache_control' in table.blocks.read(tagged.block).block
  )
    return { boundaryId, preparation: 'reused' };
  if (facts.breakpoints >= MAX_MESSAGE_BREAKPOINTS) {
    logger.debug(
      () =>
        'Skipped media purge cache_control: all message breakpoint slots are in use',
    );
    return undefined;
  }
  addBreakpointAt(table, tagged, ttl);
  logger.debug(() => 'Added media purge cache_control at the exact boundary');
  return { boundaryId, preparation: 'added' };
}
