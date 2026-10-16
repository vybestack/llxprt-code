/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { jsonValueChunks } from '../../utils/boundedJsonBody.js';
import type { EnvelopeSink } from '../../utils/envelope-writer.js';
import type { PromptKeySink } from '../../runtime/prompt-key-tee-writer.js';
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

/**
 * The message content on the wire, and, when `estimate` is given, the same
 * content in estimator form (and dump form when a dump was asked for) with the
 * same punctuation.
 */
function writeContent(
  table: MessageTable,
  message: TableMessage,
  sink: EnvelopeSink,
  estimate: PromptKeySink | undefined,
): void {
  if (message.text !== undefined) {
    appendValue(sink, message.text);
    estimate?.value(message.text);
    return;
  }
  sink.append('[');
  estimate?.append('[');
  let first = true;
  for (const entry of table.entries(message)) {
    if (!first) {
      sink.append(',');
      estimate?.append(',');
    }
    first = false;
    const block = wireBlock(entry.block);
    appendValue(sink, block);
    estimate?.value(block);
  }
  sink.append(']');
  estimate?.append(']');
}

/**
 * Writes the table's messages as the JSON array `JSON.stringify` makes of the
 * array route's messages, one message record at a time. Messages are written
 * in list order (the finishing passes have already ordered the blocks of
 * merged messages) and carry only `role` and `content`; the cache flags live
 * outside the block records and never reach the wire. `estimate` receives the
 * same array in the prompt-file forms, in the same walk.
 */
export function writeTableMessages(
  table: MessageTable,
  sink: EnvelopeSink,
  estimate?: PromptKeySink,
): void {
  sink.append('[');
  estimate?.append('[');
  let first = true;
  for (const id of table.ids()) {
    if (!first) {
      sink.append(',');
      estimate?.append(',');
    }
    first = false;
    const message = table.messages.read(id);
    sink.append('{"role":');
    estimate?.append('{"role":');
    appendValue(sink, message.role);
    estimate?.value(message.role);
    sink.append(',"content":');
    estimate?.append(',"content":');
    writeContent(table, message, sink, estimate);
    sink.append('}');
    estimate?.append('}');
  }
  sink.append(']');
  estimate?.append(']');
}
