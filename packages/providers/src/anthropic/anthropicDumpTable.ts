/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DumpScratch } from '../utils/dumpScratch.js';
import type {
  AnthropicMessage,
  AnthropicMessageBlock,
} from './AnthropicMessageNormalizer.js';

export interface DumpMessage {
  role: 'user' | 'assistant';
  text?: string;
  head: number;
  tail: number;
  next: number;
  ordered?: boolean;
}
export type StoredMessageBlock = AnthropicMessageBlock & {
  dumpPrefixHead?: number;
  dumpMediaHead?: number;
};
export interface DumpBlock {
  block: StoredMessageBlock;
  next: number;
}

export class AnthropicDumpTable {
  readonly messages: DumpScratch<DumpMessage>;
  readonly blocks: DumpScratch<DumpBlock>;

  constructor() {
    this.messages = new DumpScratch<DumpMessage>();
    try {
      this.blocks = new DumpScratch<DumpBlock>();
    } catch (error) {
      this.messages.close();
      throw error;
    }
  }
  head = -1;
  tail = -1;

  append(message: AnthropicMessage): number {
    const record: DumpMessage = {
      role: message.role,
      head: -1,
      tail: -1,
      next: -1,
    };
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

  addBlock(message: DumpMessage, block: AnthropicMessageBlock): void {
    const id = this.blocks.append({ block, next: -1 });
    if (message.tail !== -1) {
      const previous = this.blocks.read(message.tail);
      this.blocks.replace(message.tail, { ...previous, next: id });
    } else message.head = id;
    message.tail = id;
  }

  blockify(message: DumpMessage): void {
    if (message.text !== undefined) {
      this.addBlock(message, { type: 'text', text: message.text });
      delete message.text;
    }
  }

  *entries(
    message: DumpMessage,
  ): Generator<{ id: number; block: StoredMessageBlock; next: number }> {
    let id = message.head;
    while (id !== -1) {
      const entry = this.blocks.read(id);
      yield { id, ...entry };
      id = entry.next;
    }
  }

  *ids(): Generator<number> {
    let id = this.head;
    while (id !== -1) {
      yield id;
      id = this.messages.read(id).next;
    }
  }

  unlinkBlock(message: DumpMessage, id: number): void {
    let previous = -1;
    for (const entry of this.entries(message)) {
      if (entry.id === id) {
        if (previous === -1) message.head = entry.next;
        else {
          const before = this.blocks.read(previous);
          this.blocks.replace(previous, { ...before, next: entry.next });
        }
        if (message.tail === id) message.tail = previous;
        return;
      }
      previous = entry.id;
    }
  }

  removeMessage(id: number): void {
    const removed = this.messages.read(id);
    if (this.head === id) this.head = removed.next;
    else
      for (const before of this.ids()) {
        const entry = this.messages.read(before);
        if (entry.next === id) {
          this.messages.replace(before, { ...entry, next: removed.next });
          break;
        }
      }
    if (this.tail === id) {
      this.tail = -1;
      for (const remaining of this.ids()) this.tail = remaining;
    }
  }

  insertAfter(before: number, message: AnthropicMessage): number {
    const record = this.messages.read(before);
    const oldTail = this.tail;
    const id = this.append(message);
    if (oldTail !== before) {
      const tail = this.messages.read(oldTail);
      this.messages.replace(oldTail, { ...tail, next: -1 });
      this.tail = oldTail;
      const inserted = this.messages.read(id);
      this.messages.replace(id, { ...inserted, next: record.next });
    }
    this.messages.replace(before, { ...record, next: id });
    return id;
  }

  close(): void {
    try {
      this.messages.close();
    } finally {
      this.blocks.close();
    }
  }
}
