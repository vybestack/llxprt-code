/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package-private streaming JSONL reader internals (issue #3167, P04).
 *
 * This module is NOT listed in {@link ../../../../package.json} (only
 * `./perf/perfRecords.js` is exported for the perf reader), so
 * {@link streamPerfFromReadable} is unreachable by package consumers. The
 * public {@link ./perfRecords.js} reaches it to implement `streamPerfRecords`,
 * and same-package behavior tests import it directly to prove incremental
 * yield against a controlled readable.
 *
 * It depends on the public classifier `classifyPerfLine` from
 * {@link ./perfRecords.js}. To keep the static dependency graph
 * one-directional (perfRecordsStream -> perfRecords) and avoid an import
 * cycle, `perfRecords.ts` loads this module with a dynamic import rather than a
 * static one.
 */

import { StringDecoder } from 'node:string_decoder';

import { classifyPerfLine, type PerfStreamEntry } from './perfRecords.js';

function toBuffer(chunk: Buffer | string): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

/**
 * Classifies a complete or final text line into a {@link PerfStreamEntry}.
 *
 * Contract (issue #3167): `truncated` is reserved for a final nonblank line
 * that is NOT valid JSON (realistic cause: a SIGKILL mid-append). A final line
 * that parses as JSON keeps its content classification — a syntactically valid
 * future-version or unversioned value without a trailing newline is still
 * `future_version` or `unversioned`, and a current-version record that parses
 * but misses required fields is still `malformed`. Only a JSON.parse failure on
 * the final line is `truncated`. A complete (newline-terminated) non-JSON line
 * is `malformed`. Blank/whitespace-only lines are `blank`. Never throws.
 */
function classifyTextLineToStreamEntry(
  text: string,
  isFinal: boolean,
): PerfStreamEntry {
  if (text.trim() === '') {
    return { kind: 'blank' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // Only a JSON-parse failure on the final unterminated line is truncated.
    return isFinal ? { kind: 'truncated' } : { kind: 'malformed' };
  }
  const classification = classifyPerfLine(value);
  switch (classification.kind) {
    case 'ok':
      return { kind: 'ok', record: classification.record };
    case 'future_version':
      return {
        kind: 'future_version',
        schemaVersion: classification.schemaVersion,
      };
    case 'unversioned':
      return { kind: 'unversioned' };
    case 'malformed':
      return { kind: 'malformed' };
    default: {
      const _exhaustive: never = classification;
      return _exhaustive;
    }
  }
}

/**
 * Streams perf JSONL entries from any readable stream, yielding classification
 * outcomes incrementally WITHOUT accumulating the entire stream.
 *
 * This is the package-private seam: tests inject a controlled readable to
 * prove the iterator yields before the entire stream is consumed. The public
 * `streamPerfRecords` (in {@link ./perfRecords.js}) wraps this to process a
 * 24/7 file that never closes.
 *
 * Genuine I/O failures propagate as a rejection; those are not line-content
 * problems.
 */
export async function* streamPerfFromReadable(
  readable: NodeJS.ReadableStream,
): AsyncGenerator<PerfStreamEntry> {
  const decoder = new StringDecoder('utf8');
  let leftover = '';

  for await (const chunk of readable) {
    const data = leftover + decoder.write(toBuffer(chunk));
    const parts = data.split('\n');
    leftover = parts.pop() ?? '';
    for (const line of parts) {
      yield classifyTextLineToStreamEntry(line, false);
    }
  }
  leftover += decoder.end();

  if (leftover !== '') {
    yield classifyTextLineToStreamEntry(leftover, true);
  }
}
