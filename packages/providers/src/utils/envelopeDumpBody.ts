/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createReadStream } from 'node:fs';
import { sanitizeDiagnosticData } from './mediaDiagnostics.js';
import { StreamedDumpBody } from './dumpSDKContext.js';

/** Bytes read from a dump-form file per chunk. */
const DUMP_READ_BYTES = 64 * 1024;

// The sanitizer returns non-object values as they are, so this survives it and
// marks the place where the messages file's bytes go.
const MESSAGES_FILE = Symbol('messages dump file');

const encoder = new TextEncoder();

async function* fileBytes(path: string): AsyncGenerator<Uint8Array> {
  for await (const chunk of createReadStream(path, {
    highWaterMark: DUMP_READ_BYTES,
  })) {
    yield chunk as Buffer;
  }
}

function omitted(value: unknown): boolean {
  return (
    value === undefined ||
    typeof value === 'function' ||
    (typeof value === 'symbol' && value !== MESSAGES_FILE)
  );
}

/**
 * The body a dump file records, as compact JSON: the members of a Messages or
 * Chat Completions request envelope in their wire order, sanitized for
 * diagnostics (media summarized, sensitive keys left out), with `messages`
 * taken from the dump-form file written while the body was spooled. The other members are small (tools and
 * request parameters, never the history) and are sanitized as values. It is
 * what `JSON.stringify(sanitizeDiagnosticData(body))` yields for the same body.
 */
async function* envelopeDumpBodyBytes(
  envelope: Readonly<Record<string, unknown>>,
  messagesFile: string,
): AsyncGenerator<Uint8Array> {
  const sanitized = sanitizeDiagnosticData({
    ...envelope,
    messages: MESSAGES_FILE,
  }) as Record<string | symbol, unknown>;
  yield encoder.encode('{');
  let separator = '';
  for (const [key, value] of Object.entries(sanitized)) {
    if (omitted(value)) continue;
    yield encoder.encode(`${separator}${JSON.stringify(key)}:`);
    separator = ',';
    if (value === MESSAGES_FILE) yield* fileBytes(messagesFile);
    else yield encoder.encode(JSON.stringify(value));
  }
  yield encoder.encode('}');
}

/**
 * A dump body over the request envelope and the dump-form file of its
 * messages. It is read when a dump is written, so a request that never dumps
 * pays nothing, and the messages are never held in memory.
 */
export function envelopeDumpBody(
  envelope: Readonly<Record<string, unknown>>,
  messagesFile: string,
): StreamedDumpBody {
  return new StreamedDumpBody(() =>
    envelopeDumpBodyBytes(envelope, messagesFile),
  );
}
