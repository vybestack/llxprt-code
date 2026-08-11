/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tolerant streaming reader for telemetry-owned token-usage JSONL (D1, AC-3).
 *
 * The perf operation record carries only `operation_id` (derived from the
 * initial prompt-id prefix). Token-usage rows each carry their own `prompt_id`
 * (one per send, including continuations). This reader streams the token-usage
 * JSONL directory one file at a time and structurally accepts turn rows
 * (`prompt_id` + `actual_prompt_tokens` [+ optional `output_tokens`]) so the
 * report can join N continuation rows to the SINGLE perf operation at read time
 * — without copying any child id onto the perf record and WITHOUT importing
 * packages/agents (the canonical schema lives there; this reader defines its
 * own tolerant structural acceptance so the telemetry layer never depends on
 * the agents layer).
 *
 * Tolerance (external fs/JSONL input):
 *   - Non-turn lifecycle rows (compression / provider_switch / model_switch /
 *     session_resume / context_truncation, or any structured object lacking
 *     the turn fields) are ignored and counted, never fatal.
 *   - Malformed / truncated final lines are counted, never fatal.
 *   - A missing directory is an empty dataset (fail open).
 *
 * Genuine filesystem errors (permission denied, …) propagate; those are not
 * line-content problems. No whole-directory buffering: each file is streamed
 * line-by-line and entries are yielded incrementally.
 */

import { promises as fsp } from 'node:fs';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

// ===========================================================================
// Types
// ===========================================================================

/**
 * A structurally-accepted token-usage turn row — the read-time join input.
 *
 * `promptId` is the initial prompt id or a continuation
 * (`${initial}#continuation#${n}`). `actualPromptTokens` is the per-send
 * prompt/context token count; `outputTokens` is optional (omitted, never
 * zero-filled, when the provider did not report it).
 */
export interface TokenUsageTurnRow {
  readonly promptId: string;
  readonly actualPromptTokens: number;
  readonly outputTokens?: number;
}

/**
 * Per-line streaming classification of a token-usage JSONL line.
 *
 * `turn` carries the accepted row; `lifecycle` is a structured non-turn row
 * (ignored); `malformed` is a complete non-JSON / non-object line;
 * `truncated` is a final unterminated non-JSON line (SIGKILL mid-append);
 * `blank` is a whitespace-only line.
 */
export type TokenUsageStreamEntry =
  | { readonly kind: 'turn'; readonly row: TokenUsageTurnRow }
  | { readonly kind: 'lifecycle' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'truncated' }
  | { readonly kind: 'blank' };

/** A streaming entry annotated with its source file name. */
export interface TokenUsageConsumerEntry {
  readonly entry: TokenUsageStreamEntry;
  readonly sourceFile: string;
}

/** Aggregate self-health counters across the token-usage directory. */
export interface TokenUsageReaderCounts {
  /** Accepted turn rows (join input). */
  readonly turns: number;
  /** Structured non-turn rows, ignored (lifecycle records). */
  readonly lifecycle: number;
  /** Complete lines that failed to parse or were non-objects. */
  readonly malformed: number;
  /** Final unterminated non-JSON lines. */
  readonly truncated: number;
  /** Blank / whitespace-only lines. */
  readonly blank: number;
  /** Number of `*.jsonl` files read. */
  readonly files: number;
}

export interface TokenUsageReaderResult {
  readonly rows: readonly TokenUsageTurnRow[];
  readonly counts: TokenUsageReaderCounts;
}

// ===========================================================================
// Helpers
// ===========================================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function hasErrnoCode(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

/**
 * Structurally classifies a parsed JSON value from a token-usage JSONL line.
 *
 * A turn row is any plain object with a non-empty string `prompt_id` and a
 * finite, non-negative numeric `actual_prompt_tokens`. An optional
 * `output_tokens` is accepted only when it is a finite non-negative number;
 * any other shape (missing, negative, NaN, a string) is treated as "not
 * reported" (undefined) so the report never zero-fills an unreported cost.
 *
 * Any plain object that is NOT a turn row is `lifecycle` (ignored). Never
 * throws.
 */
export function classifyTokenUsageLine(value: unknown): TokenUsageStreamEntry {
  if (!isPlainObject(value)) {
    return { kind: 'malformed' };
  }
  const promptId = value['prompt_id'];
  const actualPromptTokens = value['actual_prompt_tokens'];
  if (
    typeof promptId === 'string' &&
    promptId.length > 0 &&
    isFiniteNonNegNumber(actualPromptTokens)
  ) {
    const rawOutput = value['output_tokens'];
    return {
      kind: 'turn',
      row: {
        promptId,
        actualPromptTokens,
        outputTokens: isFiniteNonNegNumber(rawOutput) ? rawOutput : undefined,
      },
    };
  }
  return { kind: 'lifecycle' };
}

/**
 * Classifies a complete or final text line into a {@link TokenUsageStreamEntry}.
 *
 * `truncated` is reserved for a final nonblank line that is NOT valid JSON
 * (realistic cause: SIGKILL mid-append). A complete (newline-terminated)
 * non-JSON line is `malformed`. Blank/whitespace-only lines are `blank`.
 * Never throws.
 */
function classifyTextLine(
  text: string,
  isFinal: boolean,
): TokenUsageStreamEntry {
  if (text.trim() === '') {
    return { kind: 'blank' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return isFinal ? { kind: 'truncated' } : { kind: 'malformed' };
  }
  return classifyTokenUsageLine(value);
}

function toBuffer(chunk: Buffer | string): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

// ===========================================================================
// Package-private streaming seam (deep-imported by behavior tests; NOT in the
// public barrel). Mirrors perfRecordsStream so an incremental-yield proof can
// interleave pushes and pulls against a controlled readable.
// ===========================================================================

/**
 * Streams token-usage entries from any readable stream, yielding
 * classification outcomes incrementally WITHOUT accumulating the entire stream.
 *
 * Genuine I/O failures propagate as a rejection; those are not line-content
 * problems.
 */
export async function* streamTokenUsageFromReadable(
  readable: NodeJS.ReadableStream,
): AsyncGenerator<TokenUsageStreamEntry> {
  const decoder = new StringDecoder('utf8');
  let leftover = '';

  for await (const chunk of readable) {
    const data = leftover + decoder.write(toBuffer(chunk));
    const parts = data.split('\n');
    leftover = parts.pop() ?? '';
    for (const line of parts) {
      yield classifyTextLine(line, false);
    }
  }
  leftover += decoder.end();

  if (leftover !== '') {
    yield classifyTextLine(leftover, true);
  }
}

// ===========================================================================
// File-level streaming reader
// ===========================================================================

/**
 * Streams token-usage entries from a single JSONL file path, yielding
 * classification outcomes incrementally WITHOUT reading the whole file.
 *
 * Genuine I/O failures (missing file, permission denied) propagate.
 */
export async function* streamTokenUsageRecords(
  filePath: string,
): AsyncGenerator<TokenUsageStreamEntry> {
  yield* streamTokenUsageFromReadable(createReadStream(filePath));
}

// ===========================================================================
// Directory-level reader (sorted, one file at a time, no directory buffering)
// ===========================================================================

interface TokenUsageFileInfo {
  readonly name: string;
  readonly path: string;
}

/**
 * Lists sorted `*.jsonl` files in a directory one at a time. A missing
 * directory (ENOENT) yields nothing — an empty dataset. Other errors
 * propagate.
 */
async function* listTokenUsageFiles(
  dir: string,
): AsyncGenerator<TokenUsageFileInfo> {
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch (err) {
    if (hasErrnoCode(err, 'ENOENT')) return;
    throw err;
  }
  const sorted = names.filter((n) => n.endsWith('.jsonl')).sort();
  for (const name of sorted) {
    yield { name, path: join(dir, name) };
  }
}

/**
 * Streams token-usage entries from all `*.jsonl` files in a directory, one
 * file at a time. Each entry carries its source file name. Files are visited
 * in sorted order for deterministic reading; each file is streamed line-by-line
 * (no whole-directory buffering).
 *
 * A missing directory yields nothing (empty dataset). Other genuine filesystem
 * errors propagate.
 */
export async function* streamTokenUsageDirectory(
  dir: string,
): AsyncGenerator<TokenUsageConsumerEntry> {
  for await (const file of listTokenUsageFiles(dir)) {
    for await (const entry of streamTokenUsageRecords(file.path)) {
      yield { entry, sourceFile: file.name };
    }
  }
}

/**
 * Accumulating directory consumer: streams all `*.jsonl` token-usage files and
 * collects every accepted turn row with aggregate self-health counts. The
 * returned rows are the read-time join input for {@link buildReport}.
 *
 * Missing directory = empty result. Other genuine filesystem errors propagate.
 */
export async function consumeTokenUsageDirectory(
  dir: string,
): Promise<TokenUsageReaderResult> {
  const rows: TokenUsageTurnRow[] = [];
  let turns = 0;
  let lifecycle = 0;
  let malformed = 0;
  let truncated = 0;
  let blank = 0;
  let files = 0;

  for await (const file of listTokenUsageFiles(dir)) {
    files += 1;
    for await (const entry of streamTokenUsageRecords(file.path)) {
      switch (entry.kind) {
        case 'turn':
          rows.push(entry.row);
          turns += 1;
          break;
        case 'lifecycle':
          lifecycle += 1;
          break;
        case 'malformed':
          malformed += 1;
          break;
        case 'truncated':
          truncated += 1;
          break;
        case 'blank':
          blank += 1;
          break;
        default: {
          const _exhaustive: never = entry;
          return _exhaustive;
        }
      }
    }
  }

  return {
    rows,
    counts: { turns, lifecycle, malformed, truncated, blank, files },
  };
}
