/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { FrameBody } from '../../journal/frame.js';
import type { DraftBlock } from '../../journal/rowDraft.js';
import { ROW_BLOCK_TYPE } from '../../journal/rowRecord.js';
import type { TextBlock } from './IContent.js';

const encoder = new TextEncoder();
function* escapedText(text: string): Generator<Uint8Array> {
  for (let at = 0; at < text.length; ) {
    let end = Math.min(at + 8192, text.length);
    const last = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
      end--;
    yield encoder.encode(JSON.stringify(text.slice(at, end)).slice(1, -1));
    at = end;
  }
}

export function promptTextSource(block: TextBlock): DraftBlock {
  const text = block.text;
  const fields = Object.entries(block)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({
      key: JSON.stringify(key),
      value: key === 'text' ? undefined : JSON.stringify(value),
    }));
  function* chunks(): Generator<Uint8Array> {
    yield encoder.encode('{');
    for (const [index, field] of fields.entries()) {
      yield encoder.encode(`${index === 0 ? '' : ','}${field.key}:`);
      if (field.value !== undefined) yield encoder.encode(field.value);
      else {
        yield encoder.encode('"');
        yield* escapedText(text);
        yield encoder.encode('"');
      }
    }
    yield encoder.encode('}');
  }
  let length = 0;
  for (const bytes of chunks()) length += bytes.length;
  const source: FrameBody = { length, chunks: { [Symbol.iterator]: chunks } };
  return { type: ROW_BLOCK_TYPE.text, bytes: new Uint8Array(), source };
}
