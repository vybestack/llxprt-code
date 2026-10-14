/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DumpScratch } from '../../utils/dumpScratch.js';
import type {
  AnthropicMessage,
  AnthropicMessageBlock,
} from '../AnthropicMessageNormalizer.js';
import { ToolIdIndex } from './tool-id-index.js';

/**
 * One message of the table. `head`/`tail` bound its block list; `prev`/`next`
 * link it into the message list. All of them are record ids (-1 for none).
 */
export interface TableMessage {
  role: 'user' | 'assistant';
  text?: string;
  head: number;
  tail: number;
  next: number;
  prev: number;
  ordered?: boolean;
}

/**
 * A block, plus the heads of two side lists of blocks that a tool_result can
 * carry: the text that precedes its content and its media. The side lists are
 * block lists of their own, so a long result is streamed instead of held.
 */
export type StoredMessageBlock = AnthropicMessageBlock & {
  dumpPrefixHead?: number;
  dumpMediaHead?: number;
};

export interface TableBlock {
  block: StoredMessageBlock;
  next: number;
  prev: number;
}

export interface TableEntry extends TableBlock {
  id: number;
}

/** A message that is not in the table (yet): a block list under construction. */
export function newMessage(role: TableMessage['role']): TableMessage {
  return { role, head: -1, tail: -1, next: -1, prev: -1 };
}

/**
 * Messages and their blocks as two disk-backed record stores, each a doubly
 * linked list, so memory holds the record being worked on and nothing else.
 *
 * Every edit is O(1) record reads and writes: `unlinkBlock` and
 * `removeMessage` follow `prev`/`next` instead of searching for a
 * predecessor, and `toolIds()` answers "where is the tool_use / tool_result of
 * this id" with one keyed read.
 *
 * Record ids come from appending and are never reused. When `toolIds()` is
 * first called the message ids ascend in list order (true for a table built
 * with `append`); the passes in `validation.ts` rely on that.
 */
export class MessageTable {
  readonly messages: DumpScratch<TableMessage>;
  readonly blocks: DumpScratch<TableBlock>;
  head = -1;
  tail = -1;
  private toolIdIndex: ToolIdIndex | undefined;

  constructor() {
    this.messages = new DumpScratch<TableMessage>();
    try {
      this.blocks = new DumpScratch<TableBlock>();
    } catch (error) {
      this.messages.close();
      throw error;
    }
  }

  /** Adds a message at the end of the list and returns its id. */
  append(message: AnthropicMessage): number {
    if (this.toolIdIndex !== undefined)
      throw new Error('Cannot append to a message table whose ids are indexed');
    const record = newMessage(message.role);
    record.prev = this.tail;
    if (typeof message.content === 'string') record.text = message.content;
    else for (const block of message.content) this.addBlock(record, block);
    const id = this.messages.append(record);
    if (this.tail !== -1) {
      const previous = this.messages.read(this.tail);
      this.messages.replace(this.tail, { ...previous, next: id });
    } else this.head = id;
    this.tail = id;
    return id;
  }

  /** Adds a block at the end of `message`'s list; the caller stores `message`. */
  addBlock(message: TableMessage, block: StoredMessageBlock): number {
    const id = this.blocks.append({ block, next: -1, prev: message.tail });
    if (message.tail !== -1) {
      const previous = this.blocks.read(message.tail);
      this.blocks.replace(message.tail, { ...previous, next: id });
    } else message.head = id;
    message.tail = id;
    return id;
  }

  /** Turns a string content into a one-block list. */
  blockify(message: TableMessage): void {
    if (message.text !== undefined) {
      this.addBlock(message, { type: 'text', text: message.text });
      delete message.text;
    }
  }

  /**
   * Moves the blocks of `source` to the end of `target`'s list. Both records
   * change in memory only; the caller stores `target` and drops `source`.
   */
  concatBlocks(target: TableMessage, source: TableMessage): void {
    if (source.head === -1) return;
    if (target.tail === -1) target.head = source.head;
    else {
      const last = this.blocks.read(target.tail);
      this.blocks.replace(target.tail, { ...last, next: source.head });
      const first = this.blocks.read(source.head);
      this.blocks.replace(source.head, { ...first, prev: target.tail });
    }
    target.tail = source.tail;
  }

  /** The blocks of a list from `head` on, in order. */
  *chain(head: number): Generator<TableEntry> {
    let id = head;
    while (id !== -1) {
      const entry = this.blocks.read(id);
      yield { id, ...entry };
      id = entry.next;
    }
  }

  entries(message: TableMessage): Generator<TableEntry> {
    return this.chain(message.head);
  }

  *ids(): Generator<number> {
    let id = this.head;
    while (id !== -1) {
      yield id;
      id = this.messages.read(id).next;
    }
  }

  /** Takes block `id` out of `message`'s list; the caller stores `message`. */
  unlinkBlock(message: TableMessage, id: number): void {
    const entry = this.blocks.read(id);
    if (entry.prev === -1) message.head = entry.next;
    else {
      const before = this.blocks.read(entry.prev);
      this.blocks.replace(entry.prev, { ...before, next: entry.next });
    }
    if (entry.next === -1) message.tail = entry.prev;
    else {
      const after = this.blocks.read(entry.next);
      this.blocks.replace(entry.next, { ...after, prev: entry.prev });
    }
  }

  /**
   * Takes message `id` out of the list. The record keeps its own links, so an
   * iteration standing on it continues with the message that followed it.
   */
  removeMessage(id: number): void {
    const removed = this.messages.read(id);
    if (removed.prev === -1) this.head = removed.next;
    else {
      const before = this.messages.read(removed.prev);
      this.messages.replace(removed.prev, { ...before, next: removed.next });
    }
    if (removed.next === -1) this.tail = removed.prev;
    else {
      const after = this.messages.read(removed.next);
      this.messages.replace(removed.next, { ...after, prev: removed.prev });
    }
  }

  /**
   * Links a prepared message (its block list already built) after `before`
   * and returns its id.
   */
  insertAfter(before: number, message: TableMessage): number {
    const anchor = this.messages.read(before);
    const id = this.messages.append({
      ...message,
      prev: before,
      next: anchor.next,
    });
    this.messages.replace(before, { ...anchor, next: id });
    if (anchor.next === -1) this.tail = id;
    else {
      const after = this.messages.read(anchor.next);
      this.messages.replace(anchor.next, { ...after, prev: id });
    }
    return id;
  }

  /**
   * The tool_use / tool_result id index. The first call reads the table once
   * to fill it; after that the passes that edit the table keep it current.
   */
  toolIds(): ToolIdIndex {
    this.toolIdIndex ??= this.indexToolIds();
    return this.toolIdIndex;
  }

  private indexToolIds(): ToolIdIndex {
    const index = ToolIdIndex.create();
    try {
      for (const id of this.ids()) this.indexMessage(index, id);
      return index;
    } catch (error) {
      index.close();
      throw error;
    }
  }

  private indexMessage(index: ToolIdIndex, id: number): void {
    const message = this.messages.read(id);
    for (const entry of this.entries(message)) {
      const block = entry.block;
      if (message.role === 'assistant' && block.type === 'tool_use')
        index.addUse(block.id, id);
      else if (message.role === 'user' && block.type === 'tool_result')
        index.addResult(block.tool_use_id, id, entry.id);
    }
  }

  close(): void {
    try {
      this.messages.close();
    } finally {
      try {
        this.blocks.close();
      } finally {
        this.toolIdIndex?.close();
      }
    }
  }
}
