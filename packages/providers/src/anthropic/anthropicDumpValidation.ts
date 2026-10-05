/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AnthropicMessageBlock } from './AnthropicMessageNormalizer.js';
import type { AnthropicDumpTable } from './anthropicDumpTable.js';
import { type DumpMessage } from './anthropicDumpTable.js';
import { DumpScratch } from '../utils/dumpScratch.js';

function hasId(
  table: AnthropicDumpTable,
  id: string,
  kind: 'tool_use' | 'tool_result',
): boolean {
  for (const messageId of table.ids()) {
    const message = table.messages.read(messageId);
    if (message.role !== (kind === 'tool_use' ? 'assistant' : 'user')) continue;
    for (const entry of table.entries(message)) {
      if (
        entry.block.type === 'tool_use' &&
        kind === 'tool_use' &&
        entry.block.id === id
      )
        return true;
      if (
        entry.block.type === 'tool_result' &&
        kind === 'tool_result' &&
        entry.block.tool_use_id === id
      )
        return true;
    }
  }
  return false;
}

export function filterDumpOrphans(table: AnthropicDumpTable): void {
  let orphaned = false;
  for (const id of table.ids()) {
    const message = table.messages.read(id);
    if (message.role !== 'user') continue;
    for (const entry of table.entries(message)) {
      if (
        entry.block.type === 'tool_result' &&
        !hasId(table, entry.block.tool_use_id, 'tool_use')
      ) {
        table.unlinkBlock(message, entry.id);
        orphaned = true;
      }
    }
    table.messages.replace(id, message);
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
function findResult(
  table: AnthropicDumpTable,
  message: DumpMessage,
  wanted: string,
): { id: number; block: AnthropicMessageBlock } | undefined {
  if (message.role !== 'user') return undefined;
  for (const entry of table.entries(message)) {
    if (
      entry.block.type === 'tool_result' &&
      entry.block.tool_use_id === wanted
    )
      return entry;
  }
  return undefined;
}

interface Removal {
  message: number;
  block: number;
}
function collectLater(
  table: AnthropicDumpTable,
  next: number,
  wanted: string,
  removals: DumpScratch<Removal>,
): AnthropicMessageBlock {
  let id = table.messages.read(next).next;
  while (id !== -1) {
    const message = table.messages.read(id);
    const entry = findResult(table, message, wanted);
    if (entry !== undefined) {
      removals.append({ message: id, block: entry.id });
      return entry.block;
    }
    id = message.next;
  }
  return interrupted(wanted);
}

function removeCollected(
  table: AnthropicDumpTable,
  removals: DumpScratch<Removal>,
): void {
  for (let index = 0; index < removals.length; index++) {
    const removal = removals.read(index);
    const message = table.messages.read(removal.message);
    table.unlinkBlock(message, removal.block);
    table.messages.replace(removal.message, message);
    if (message.head === -1 && message.text === undefined)
      table.removeMessage(removal.message);
  }
}

function hasResultInMessage(
  table: AnthropicDumpTable,
  message: DumpMessage,
  id: string,
): boolean {
  for (const entry of table.entries(message))
    if (entry.block.type === 'tool_result' && entry.block.tool_use_id === id)
      return true;
  return false;
}

function repairAdjacent(
  table: AnthropicDumpTable,
  message: DumpMessage,
  nextId: number,
): void {
  const next = table.messages.read(nextId);
  const collected: DumpMessage = { role: 'user', head: -1, tail: -1, next: -1 };
  const removals = new DumpScratch<Removal>();
  try {
    for (const entry of table.entries(message)) {
      if (
        entry.block.type === 'tool_use' &&
        !hasResultInMessage(table, next, entry.block.id)
      )
        table.addBlock(
          collected,
          collectLater(table, nextId, entry.block.id, removals),
        );
    }
    removeCollected(table, removals);
    if (collected.head === -1) return;
    table.blockify(next);
    if (next.head !== -1) {
      const last = table.blocks.read(collected.tail);
      table.blocks.replace(collected.tail, { ...last, next: next.head });
    } else next.tail = collected.tail;
    next.head = collected.head;
    table.messages.replace(nextId, {
      ...next,
      next: table.messages.read(nextId).next,
    });
  } finally {
    removals.close();
  }
}

function repairMissing(
  table: AnthropicDumpTable,
  id: number,
  message: DumpMessage,
): void {
  const missing: DumpMessage = { role: 'user', head: -1, tail: -1, next: -1 };
  for (const entry of table.entries(message))
    if (
      entry.block.type === 'tool_use' &&
      !hasId(table, entry.block.id, 'tool_result')
    )
      table.addBlock(missing, interrupted(entry.block.id));
  if (missing.head === -1) return;
  const inserted = table.insertAfter(id, { role: 'user', content: [] });
  table.messages.replace(inserted, {
    ...missing,
    next: table.messages.read(inserted).next,
  });
}

export function repairDumpAdjacency(table: AnthropicDumpTable): void {
  for (const id of table.ids()) {
    const message = table.messages.read(id);
    if (message.role !== 'assistant') continue;
    if (
      message.next !== -1 &&
      table.messages.read(message.next).role === 'user'
    )
      repairAdjacent(table, message, message.next);
    else repairMissing(table, id, message);
  }
}

export function mergeDumpRoles(table: AnthropicDumpTable): void {
  for (const id of table.ids()) {
    let message = table.messages.read(id);
    while (message.next !== -1) {
      const nextId = message.next;
      const next = table.messages.read(nextId);
      if (message.role !== next.role) break;
      table.blockify(message);
      table.blockify(next);
      if (message.tail !== -1) {
        const last = table.blocks.read(message.tail);
        table.blocks.replace(message.tail, { ...last, next: next.head });
      } else message.head = next.head;
      if (next.tail !== -1) message.tail = next.tail;
      message.next = next.next;
      message.ordered = true;
      table.messages.replace(id, message);
      if (table.tail === nextId) table.tail = id;
      message = table.messages.read(id);
    }
  }
}
