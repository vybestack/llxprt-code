/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { StreamJsonString } from '../utils/streamJsonString.js';
import type {
  AnthropicDumpTable,
  StoredMessageBlock,
} from './anthropicDumpTable.js';
async function* prefixedText(
  table: AnthropicDumpTable,
  block: StoredMessageBlock,
): AsyncIterable<string> {
  let leading = true;
  let hasPrefix = false;
  if (block.dumpPrefixHead !== undefined) {
    for (const entry of table.entries({
      role: 'user',
      head: block.dumpPrefixHead,
      tail: -1,
      next: -1,
    })) {
      const original = entry.block.type === 'text' ? entry.block.text : '';
      const text = leading ? original.trimStart() : original;
      if (text === '') continue;
      leading = false;
      hasPrefix = true;
      yield text;
    }
  }
  if (hasPrefix) yield '\n';
  if (block.type !== 'tool_result' || typeof block.content !== 'string')
    throw new Error('Invalid dump tool result text');
  if (!hasPrefix && block.content === '') yield '[empty tool result]';
  else yield block.content;
}
async function* mediaContent(
  table: AnthropicDumpTable,
  block: StoredMessageBlock,
): AsyncIterable<unknown> {
  yield {
    type: 'text',
    text: new StreamJsonString(() => prefixedText(table, block)),
  };
  if (block.dumpMediaHead !== undefined)
    for (const entry of table.entries({
      role: 'user',
      head: block.dumpMediaHead,
      tail: -1,
      next: -1,
    }))
      yield entry.block;
}
export function dumpBlockValue(
  table: AnthropicDumpTable,
  block: StoredMessageBlock,
): unknown {
  if (block.dumpPrefixHead === undefined) return block;
  const { dumpPrefixHead: _prefix, dumpMediaHead: media, ...wire } = block;
  return {
    ...wire,
    content:
      media === -1
        ? new StreamJsonString(() => prefixedText(table, block))
        : mediaContent(table, block),
  };
}
