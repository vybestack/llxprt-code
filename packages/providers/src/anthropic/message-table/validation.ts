/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DumpScratch } from '../../utils/dumpScratch.js';
import type { AnthropicMessageBlock } from '../AnthropicMessageNormalizer.js';
import {
  newMessage,
  type MessageTable,
  type TableMessage,
} from './message-table.js';
import type { ResultLocation, ToolIdIndex } from './tool-id-index.js';

/** Drops tool_results whose tool_use is nowhere, then the messages left empty. */
export function filterOrphans(table: MessageTable): void {
  const toolIds = table.toolIds();
  let orphaned = false;
  for (const id of table.ids()) {
    const message = table.messages.read(id);
    if (message.role !== 'user') continue;
    let changed = false;
    for (const entry of table.entries(message)) {
      if (
        entry.block.type === 'tool_result' &&
        !toolIds.hasUse(entry.block.tool_use_id)
      ) {
        table.unlinkBlock(message, entry.id);
        toolIds.removeResult(entry.block.tool_use_id, id, entry.id);
        orphaned = changed = true;
      }
    }
    if (changed) table.messages.replace(id, message);
  }
  if (orphaned)
    for (const id of table.ids()) {
      const message = table.messages.read(id);
      if (
        message.role === 'user' &&
        message.text === undefined &&
        message.head === -1
      )
        table.removeMessage(id);
    }
}

function interrupted(id: string): AnthropicMessageBlock {
  return {
    type: 'tool_result',
    tool_use_id: id,
    content: '[tool execution interrupted]',
    is_error: true,
  };
}

interface Removal {
  message: number;
  block: number;
  toolUseId: string;
}

/**
 * The first result for `wanted` in a message after `nextId`, as it stood when
 * the pass began: message ids ascend in list order there, and messages with an
 * id from `insertedFrom` on were inserted by this pass behind the walk.
 */
function laterResult(
  table: MessageTable,
  locations: readonly ResultLocation[],
  nextId: number,
  insertedFrom: number,
  wanted: string,
): ResultLocation | undefined {
  const later = locations.filter(
    (location) => location.message > nextId && location.message < insertedFrom,
  );
  if (later.length === 0) return undefined;
  const first = Math.min(...later.map((location) => location.message));
  const inFirst = later.filter((location) => location.message === first);
  if (inFirst.length === 1) return inFirst[0];
  // Duplicated ids inside one message: the one earliest in its block list.
  for (const entry of table.entries(table.messages.read(first)))
    if (
      entry.block.type === 'tool_result' &&
      entry.block.tool_use_id === wanted
    )
      return { message: first, block: entry.id };
  throw new Error('Tool id index lists a result the message does not hold');
}

function removeCollected(
  table: MessageTable,
  toolIds: ToolIdIndex,
  removals: DumpScratch<Removal>,
): void {
  for (let index = 0; index < removals.length; index++) {
    const removal = removals.read(index);
    // Two calls with one id collect the same result; it leaves its message once.
    if (
      !toolIds.removeResult(removal.toolUseId, removal.message, removal.block)
    )
      continue;
    const message = table.messages.read(removal.message);
    table.unlinkBlock(message, removal.block);
    table.messages.replace(removal.message, message);
    if (message.head === -1 && message.text === undefined)
      table.removeMessage(removal.message);
  }
}

/**
 * Adds to `into.collected` the result for the call `wanted` when the next
 * message does not hold it: the one from a later message (noted in
 * `into.removals`), else an interrupted one.
 */
function collectResult(
  table: MessageTable,
  toolIds: ToolIdIndex,
  insertedFrom: number,
  nextId: number,
  wanted: string,
  into: { collected: TableMessage; removals: DumpScratch<Removal> },
): void {
  const locations = toolIds.results(wanted);
  if (locations.some((location) => location.message === nextId)) return;
  const found = laterResult(table, locations, nextId, insertedFrom, wanted);
  if (found === undefined) {
    table.addBlock(into.collected, interrupted(wanted));
    return;
  }
  into.removals.append({
    message: found.message,
    block: found.block,
    toolUseId: wanted,
  });
  table.addBlock(into.collected, table.blocks.read(found.block).block);
}

/**
 * Collects, for each tool_use of `message` that the next message does not
 * answer, the result from a later message (else an interrupted one), and puts
 * them first in the next message.
 */
function repairAdjacent(
  table: MessageTable,
  toolIds: ToolIdIndex,
  insertedFrom: number,
  message: TableMessage,
  nextId: number,
): void {
  const collected = newMessage('user');
  const removals = new DumpScratch<Removal>();
  try {
    for (const entry of table.entries(message))
      if (entry.block.type === 'tool_use')
        collectResult(table, toolIds, insertedFrom, nextId, entry.block.id, {
          collected,
          removals,
        });
    removeCollected(table, toolIds, removals);
    if (collected.head === -1) return;
    const next = table.messages.read(nextId);
    table.blockify(next);
    for (const entry of table.entries(collected))
      if (entry.block.type === 'tool_result')
        toolIds.addResult(entry.block.tool_use_id, nextId, entry.id);
    table.concatBlocks(collected, next);
    table.messages.replace(nextId, {
      ...next,
      head: collected.head,
      tail: collected.tail,
    });
  } finally {
    removals.close();
  }
}

/** Inserts a user message of interrupted results for calls nothing answers. */
function repairMissing(
  table: MessageTable,
  toolIds: ToolIdIndex,
  id: number,
  message: TableMessage,
): void {
  const missing = newMessage('user');
  for (const entry of table.entries(message))
    if (entry.block.type === 'tool_use' && !toolIds.hasResult(entry.block.id))
      table.addBlock(missing, interrupted(entry.block.id));
  if (missing.head === -1) return;
  const inserted = table.insertAfter(id, missing);
  for (const entry of table.entries(missing))
    if (entry.block.type === 'tool_result')
      toolIds.addResult(entry.block.tool_use_id, inserted, entry.id);
}

/** Every assistant tool_use gets a result in the user message that follows. */
export function repairAdjacency(table: MessageTable): void {
  const toolIds = table.toolIds();
  const insertedFrom = table.messages.length;
  for (const id of table.ids()) {
    const message = table.messages.read(id);
    if (message.role !== 'assistant') continue;
    if (
      message.next !== -1 &&
      table.messages.read(message.next).role === 'user'
    )
      repairAdjacent(table, toolIds, insertedFrom, message, message.next);
    else repairMissing(table, toolIds, id, message);
  }
}

/**
 * Joins runs of one role into a single message. The ids index does not follow
 * the moved blocks, so it must not be used after this.
 */
export function mergeRoles(table: MessageTable): void {
  for (const id of table.ids()) {
    let message = table.messages.read(id);
    while (message.next !== -1) {
      const nextId = message.next;
      const next = table.messages.read(nextId);
      if (message.role !== next.role) break;
      table.blockify(message);
      table.blockify(next);
      table.concatBlocks(message, next);
      message.next = next.next;
      message.ordered = true;
      table.messages.replace(id, message);
      if (next.next !== -1) {
        const after = table.messages.read(next.next);
        table.messages.replace(next.next, { ...after, prev: id });
      }
      if (table.tail === nextId) table.tail = id;
      message = table.messages.read(id);
    }
  }
}
