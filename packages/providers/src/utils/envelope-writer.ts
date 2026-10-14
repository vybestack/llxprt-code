/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { jsonValueChunks } from './boundedJsonBody.js';

/** Where envelope bytes go. `WireBodySpool` is one. */
export interface EnvelopeSink {
  append(data: string | Uint8Array): void;
}

/**
 * Marks an envelope member whose JSON the caller writes itself, one piece at a
 * time (the `messages` or `input` array), instead of handing over a value.
 * `write` must append exactly one valid JSON value; it may be asynchronous
 * when the pieces come from a row reader.
 */
export class StreamedSegment {
  constructor(readonly write: (sink: EnvelopeSink) => void | Promise<void>) {}
}

function appendJson(sink: EnvelopeSink, chunks: Iterable<Uint8Array>): void {
  for (const chunk of chunks) sink.append(chunk);
}

/**
 * Writes a request envelope as `JSON.stringify` would: keys in insertion
 * order, members that are `undefined`, functions or symbols skipped. A
 * {@link StreamedSegment} member is written by its own callback, so a large
 * array never has to exist as a value.
 */
export async function writeEnvelope(
  sink: EnvelopeSink,
  envelope: Readonly<Record<string, unknown>>,
): Promise<void> {
  sink.append('{');
  let wroteMember = false;
  for (const key of Object.keys(envelope)) {
    const member = envelope[key];
    if (member instanceof StreamedSegment) {
      writeKey(sink, key, wroteMember);
      await member.write(sink);
    } else {
      const chunks = jsonValueChunks(member, { key });
      if (chunks === undefined) continue;
      writeKey(sink, key, wroteMember);
      appendJson(sink, chunks);
    }
    wroteMember = true;
  }
  sink.append('}');
}

function writeKey(sink: EnvelopeSink, key: string, afterMember: boolean): void {
  if (afterMember) sink.append(',');
  const encoded = jsonValueChunks(key);
  if (encoded === undefined) throw new Error('Envelope key is not a string');
  appendJson(sink, encoded);
  sink.append(':');
}
