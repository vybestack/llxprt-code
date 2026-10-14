/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { jsonValueChunks } from '../../utils/boundedJsonBody.js';
import type { EnvelopeSink } from '../../utils/envelope-writer.js';
import type {
  MessageTable,
  StoredMessageBlock,
  TableMessage,
} from './message-table.js';

function appendValue(sink: EnvelopeSink, value: unknown): void {
  const chunks = jsonValueChunks(value);
  if (chunks === undefined) {
    throw new Error('Message table holds a value that has no JSON form');
  }
  for (const chunk of chunks) sink.append(chunk);
}

/**
 * The wire block of a record. The side lists belong to the dump's chain
 * results; the wire builder never produces them, so a block that carries one
 * came from the wrong builder and is not written.
 */
function wireBlock(block: StoredMessageBlock): StoredMessageBlock {
  if (block.dumpPrefixHead !== undefined || block.dumpMediaHead !== undefined) {
    throw new Error('A dump block was found in the wire message table');
  }
  return block;
}

function writeContent(
  table: MessageTable,
  message: TableMessage,
  sink: EnvelopeSink,
): void {
  if (message.text !== undefined) {
    appendValue(sink, message.text);
    return;
  }
  sink.append('[');
  let first = true;
  for (const entry of table.entries(message)) {
    if (!first) sink.append(',');
    first = false;
    appendValue(sink, wireBlock(entry.block));
  }
  sink.append(']');
}

/**
 * Writes the table's messages as the JSON array `JSON.stringify` makes of the
 * array route's messages, one message record at a time. Messages are written
 * in list order (the finishing passes have already ordered the blocks of
 * merged messages) and carry only `role` and `content`; the cache flags live
 * outside the block records and never reach the wire.
 */
export function writeTableMessages(
  table: MessageTable,
  sink: EnvelopeSink,
): void {
  sink.append('[');
  let first = true;
  for (const id of table.ids()) {
    if (!first) sink.append(',');
    first = false;
    const message = table.messages.read(id);
    sink.append('{"role":');
    appendValue(sink, message.role);
    sink.append(',"content":');
    writeContent(table, message, sink);
    sink.append('}');
  }
  sink.append(']');
}
