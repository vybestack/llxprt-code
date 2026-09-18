/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Buffer } from 'node:buffer';

/**
 * Shared display-retention boundary for tool results (issue #3428).
 *
 * One module owns the per-result display cap so the history ledger's total
 * scrollback budget (issue #2852) and the future scrollback system (issue
 * #854) compose with the same per-result bound instead of three different
 * ones. The bound is display-only: the model's copy lives in the core
 * `HistoryService` and the complete text is written to the session
 * transcript, so nothing is lost.
 */

/**
 * Stated per-result display retention cap: 64 KiB (32 KiB head + 32 KiB tail
 * plus the truncation marker). Large enough for a full terminal screen of
 * context around a result, small enough that hundreds of retained results
 * stay in the tens-of-MiB range instead of scaling with output volume.
 */
export const TOOL_RESULT_RETENTION_CAP_BYTES = 64 * 1024;

/**
 * Marker inserted when a result body is capped for display. The bound is
 * display-only: the model's copy lives in the core `HistoryService` and the
 * complete text is written to the session transcript, so nothing is lost
 * (issue #2852, #3428).
 */
export const RETENTION_TRUNCATION_MARKER =
  '\n[... middle omitted from display; full text is in the session transcript ...]\n';

const MARKER_BYTES = Buffer.byteLength(RETENTION_TRUNCATION_MARKER, 'utf8');

/** Head or tail of `text` within `maxBytes`, never splitting a code point. */
export function takeUtf8(
  text: string,
  maxBytes: number,
  fromEnd: boolean,
): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) {
    return text;
  }
  if (!fromEnd) {
    let end = maxBytes;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    return bytes.subarray(0, end).toString('utf8');
  }
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return bytes.subarray(start).toString('utf8');
}

/** Head and tail of `text` fitting `maxBytes`, joined by the display marker. */
export function previewText(text: string, maxBytes: number): string {
  const headBytes = Math.ceil(maxBytes / 2);
  const tailBytes = Math.floor(maxBytes / 2);
  return `${takeUtf8(text, headBytes, false)}${RETENTION_TRUNCATION_MARKER}${takeUtf8(text, tailBytes, true)}`;
}

/** `text` if it fits `maxBytes`, otherwise a marker-joined head/tail preview. */
export function boundUtf8Text(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }
  const budget = maxBytes - MARKER_BYTES;
  return budget > 0 ? previewText(text, budget) : '';
}

export interface RetentionBoundedDisplay {
  readonly text: string;
  readonly wasCapped: boolean;
  readonly originalLength: number;
}

/**
 * Bounds a tool-result display string to
 * {@link TOOL_RESULT_RETENTION_CAP_BYTES}: a UTF-8-safe head plus tail joined
 * by the truncation marker when the body is larger, and the body itself
 * otherwise. The original length reports the full UTF-8 size so the UI can
 * tell the reader how much is hidden.
 */
export function boundResultDisplayForRetention(
  text: string,
): RetentionBoundedDisplay {
  const originalLength = Buffer.byteLength(text, 'utf8');
  if (originalLength <= TOOL_RESULT_RETENTION_CAP_BYTES) {
    return { text, wasCapped: false, originalLength };
  }
  return {
    text: previewText(text, TOOL_RESULT_RETENTION_CAP_BYTES - MARKER_BYTES),
    wasCapped: true,
    originalLength,
  };
}

const MAX_DISPLAY_DEPTH = 12;
const CIRCULAR_MARKER = '[Circular]';
const DEPTH_OMISSION_MESSAGE =
  '... deeper levels omitted from display; full result is in the session transcript ...';
const SIZE_OMISSION_LINE =
  '\n[... display truncated at the retention cap; full result is in the session transcript ...]';
const SIZE_OMISSION_LINE_BYTES = Buffer.byteLength(SIZE_OMISSION_LINE, 'utf8');
const STRING_OMISSION_MESSAGE =
  '... string truncated for display; full result is in the session transcript ...';
const STRING_OMISSION_INLINE = `"${STRING_OMISSION_MESSAGE}"`;

/**
 * Accumulates output only while it fits under the retention cap (minus room
 * reserved for the truncation line) counted in UTF-8 bytes. Once the reserve
 * is reached, further pushes are refused and the caller unwinds; the
 * assembler appends the truncation line, so the final text never exceeds the
 * cap. Byte accounting (not UTF-16 code units) keeps non-ASCII results within
 * the stated byte cap; each push encodes only its own chunk.
 */
class BoundedEmitter {
  private readonly parts: string[] = [];
  private stopped = false;
  private omitted = false;
  private bytes = 0;

  constructor(private readonly limit: number) {}

  get isStopped(): boolean {
    return this.stopped;
  }

  /** Records that some content was omitted from the emitted display. */
  markOmitted(): void {
    this.omitted = true;
  }

  get isOmitted(): boolean {
    return this.omitted;
  }

  stop(): void {
    this.stopped = true;
  }

  raw(text: string): boolean {
    if (this.stopped) {
      return false;
    }
    const chunkBytes = Buffer.byteLength(text, 'utf8');
    if (this.bytes + chunkBytes > this.limit) {
      this.stopped = true;
      return false;
    }
    this.parts.push(text);
    this.bytes += chunkBytes;
    return true;
  }

  room(): number {
    return this.limit - this.bytes;
  }

  text(): string {
    return this.parts.join('');
  }
}

/**
 * Budgeted pretty-printer for tool-result display bodies.
 *
 * Matches `JSON.stringify(value, null, 2)` for anything that fits the
 * retention cap, and degrades with explicit in-band omission markers — a
 * depth cutoff, a total-size cutoff, and in-place string truncation — instead
 * of materializing the full prettified body. Replayed tool responses are
 * plain JSON (parsed from the session transcript), so `toJSON` hooks never
 * fire here; cycles are reported rather than thrown because replay builds
 * maps from live objects too.
 */
export function stringifyForDisplay(value: unknown): string {
  return stringifyForDisplayDetailed(value).text;
}

export interface DetailedDisplaySerialization {
  readonly text: string;
  /** True when any part of the value was omitted to stay in budget. */
  readonly wasCapped: boolean;
}

/**
 * Budgeted pretty-printer reporting whether anything was omitted: the size
 * cutoff, the depth cutoff, and in-place string truncation all count, so a
 * caller can mark the display as capped even when the emitted text itself is
 * short.
 */
export function stringifyForDisplayDetailed(
  value: unknown,
): DetailedDisplaySerialization {
  const emitter = new BoundedEmitter(
    TOOL_RESULT_RETENTION_CAP_BYTES - SIZE_OMISSION_LINE_BYTES,
  );
  writeValue(emitter, value, new Set(), 0);
  const wasCapped = emitter.isStopped || emitter.isOmitted;
  return {
    text: emitter.isStopped
      ? `${emitter.text()}${SIZE_OMISSION_LINE}`
      : emitter.text(),
    wasCapped,
  };
}

function writeValue(
  emitter: BoundedEmitter,
  value: unknown,
  ancestors: Set<object>,
  indentLevel: number,
): void {
  if (emitter.isStopped) {
    return;
  }
  if (typeof value === 'string') {
    writeString(emitter, value);
    return;
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    emitter.raw(JSON.stringify(value));
    return;
  }
  if (typeof value !== 'object') {
    emitter.raw(JSON.stringify(String(value)));
    return;
  }

  if (ancestors.has(value)) {
    emitter.raw(JSON.stringify(CIRCULAR_MARKER));
    return;
  }
  if (indentLevel >= MAX_DISPLAY_DEPTH) {
    emitter.markOmitted();
    emitter.raw(JSON.stringify(DEPTH_OMISSION_MESSAGE));
    return;
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      writeArray(emitter, value, ancestors, indentLevel);
    } else {
      writeObject(
        emitter,
        value as Record<string, unknown>,
        ancestors,
        indentLevel,
      );
    }
  } finally {
    ancestors.delete(value);
  }
}

/** Emits a JSON string literal, truncated in place when it cannot fit. */
function writeString(emitter: BoundedEmitter, value: string): void {
  const encoded = JSON.stringify(value);
  const room = emitter.room();
  if (Buffer.byteLength(encoded, 'utf8') <= room) {
    emitter.raw(encoded);
    return;
  }
  const headRoom = room - STRING_OMISSION_INLINE.length;
  if (headRoom <= 1) {
    emitter.stop();
    return;
  }
  emitter.markOmitted();
  // Truncate against the remaining BYTE budget so a multi-byte string never
  // slips past raw()'s byte accounting, and never split a code point.
  let head = takeUtf8(encoded, headRoom, false);
  // Step back over a possibly severed escape sequence so the truncated
  // literal stays a valid JSON string.
  const lastBackslash = head.lastIndexOf('\\');
  if (lastBackslash >= 0 && head.length - lastBackslash < 6) {
    head = head.slice(0, lastBackslash);
  }
  if (!emitter.raw(`${head}${STRING_OMISSION_MESSAGE}"`)) {
    emitter.stop();
  }
}

function writeArray(
  emitter: BoundedEmitter,
  value: readonly unknown[],
  ancestors: Set<object>,
  indentLevel: number,
): void {
  if (value.length === 0) {
    emitter.raw('[]');
    return;
  }
  const inner = '  '.repeat(indentLevel + 1);
  emitter.raw('[\n');
  for (let index = 0; index < value.length; index += 1) {
    emitter.raw(inner);
    writeValue(emitter, value[index], ancestors, indentLevel + 1);
    if (emitter.isStopped) {
      return;
    }
    emitter.raw(index < value.length - 1 ? ',\n' : '\n');
  }
  emitter.raw(`${'  '.repeat(indentLevel)}]`);
}

function writeObject(
  emitter: BoundedEmitter,
  value: Record<string, unknown>,
  ancestors: Set<object>,
  indentLevel: number,
): void {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    emitter.raw('{}');
    return;
  }
  const inner = '  '.repeat(indentLevel + 1);
  emitter.raw('{\n');
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (!emitter.raw(`${inner}${JSON.stringify(key)}: `)) {
      return;
    }
    writeValue(emitter, value[key], ancestors, indentLevel + 1);
    if (emitter.isStopped) {
      return;
    }
    emitter.raw(index < keys.length - 1 ? ',\n' : '\n');
  }
  emitter.raw(`${'  '.repeat(indentLevel)}}`);
}
