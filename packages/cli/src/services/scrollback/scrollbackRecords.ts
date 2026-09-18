/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-001
 * Record shapes for the UI scrollback journal (`sb-<base>.jsonl`) and its
 * offset index (`sb-<base>.idx.jsonl`). One JSON object per line; records are
 * append-only and never rewritten. Kept free of zod to match the plain
 * structural validators used elsewhere (see historyEventTypes.ts payload
 * conventions).
 */

import type { HistoryItem } from '../../ui/types.js';

/** Wire version of the scrollback journal format. */
export const SCROLLBACK_RECORD_VERSION = 1;

/** A UI item committed to the turn store. */
export interface ScrollbackItemRecord {
  v: typeof SCROLLBACK_RECORD_VERSION;
  rec: 'item';
  uiSeq: number;
  itemId: number;
  ts: string;
  /** HistoryItem.type wire string ('user', 'gemini', 'info', ...). */
  kind: string;
  chronologySeq?: number;
  seqSpan?: readonly [number, number];
  payload: HistoryItem;
}

/** A committed revision of an already-journaled item (last-wins on read). */
export interface ScrollbackRevisionRecord {
  v: typeof SCROLLBACK_RECORD_VERSION;
  rec: 'rev';
  uiSeq: number;
  itemId: number;
  ts: string;
  chronologySeq?: number;
  payload: HistoryItem;
}

/** A compression boundary row. */
export interface ScrollbackBoundaryRecord {
  v: typeof SCROLLBACK_RECORD_VERSION;
  rec: 'boundary';
  uiSeq: number;
  ts: string;
  summaryText: string;
  replacedFromSeq: number;
  replacedToSeq: number;
  itemCount: number;
}

/** A /chat clear marker. */
export interface ScrollbackClearRecord {
  v: typeof SCROLLBACK_RECORD_VERSION;
  rec: 'clear';
  uiSeq: number;
  ts: string;
}

/** A rewind truncate marker. */
export interface ScrollbackRewindRecord {
  v: typeof SCROLLBACK_RECORD_VERSION;
  rec: 'rewind';
  uiSeq: number;
  ts: string;
  truncateAfterUiSeq: number;
}

export type ScrollbackRecord =
  | ScrollbackItemRecord
  | ScrollbackRevisionRecord
  | ScrollbackBoundaryRecord
  | ScrollbackClearRecord
  | ScrollbackRewindRecord;

/** One line of the offset index, describing one journal record. */
export interface ScrollbackIndexEntry {
  uiSeq: number;
  byteOffset: number;
  byteLen: number;
  kind: string;
  chronologySeq?: number;
}

/** Narrows unknown parsed JSON to a plain string-keyed record, or null. */
function asFieldMap(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSeqSpan(value: unknown): value is readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }
  return isFiniteInt(value[0]) && isFiniteInt(value[1]);
}

const RECORD_KINDS: readonly string[] = [
  'item',
  'rev',
  'boundary',
  'clear',
  'rewind',
];

/**
 * Structural validator narrowing an unknown value to a {@link ScrollbackRecord}.
 * Returns false for any line that does not carry the version, record kind,
 * monotonic sequence, and timestamp fields every record shares.
 *
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-002
 */
export function isScrollbackRecord(value: unknown): value is ScrollbackRecord {
  const fields = asFieldMap(value);
  if (fields === null) {
    return false;
  }
  const kind = fields['rec'];
  if (
    typeof kind !== 'string' ||
    !RECORD_KINDS.includes(kind) ||
    fields['v'] !== SCROLLBACK_RECORD_VERSION ||
    !isFiniteInt(fields['uiSeq']) ||
    typeof fields['ts'] !== 'string'
  ) {
    return false;
  }
  if (kind === 'item') {
    return (
      isFiniteInt(fields['itemId']) &&
      typeof fields['kind'] === 'string' &&
      (fields['chronologySeq'] === undefined ||
        isFiniteInt(fields['chronologySeq'])) &&
      (fields['seqSpan'] === undefined || isSeqSpan(fields['seqSpan'])) &&
      typeof fields['payload'] === 'object' &&
      fields['payload'] !== null
    );
  }
  if (kind === 'rev') {
    return (
      isFiniteInt(fields['itemId']) &&
      (fields['chronologySeq'] === undefined ||
        isFiniteInt(fields['chronologySeq'])) &&
      typeof fields['payload'] === 'object' &&
      fields['payload'] !== null
    );
  }
  if (kind === 'boundary') {
    return (
      typeof fields['summaryText'] === 'string' &&
      isFiniteInt(fields['replacedFromSeq']) &&
      isFiniteInt(fields['replacedToSeq']) &&
      isFiniteInt(fields['itemCount'])
    );
  }
  if (kind === 'clear') {
    return true;
  }
  return isFiniteInt(fields['truncateAfterUiSeq']);
}

/**
 * Parses one journal line; returns null for blank or unparseable lines so a
 * torn tail write never throws during reopen.
 *
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-002
 */
export function parseScrollbackRecord(line: string): ScrollbackRecord | null {
  if (line.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  return isScrollbackRecord(parsed) ? parsed : null;
}

/**
 * Structural validator for one index line.
 *
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-002
 */
export function isScrollbackIndexEntry(
  value: unknown,
): value is ScrollbackIndexEntry {
  const fields = asFieldMap(value);
  if (fields === null) {
    return false;
  }
  return (
    isFiniteInt(fields['uiSeq']) &&
    isFiniteInt(fields['byteOffset']) &&
    fields['byteOffset'] >= 0 &&
    isFiniteInt(fields['byteLen']) &&
    fields['byteLen'] > 0 &&
    typeof fields['kind'] === 'string' &&
    (fields['chronologySeq'] === undefined ||
      isFiniteInt(fields['chronologySeq']))
  );
}

/**
 * Parses one index line; returns null for blank or unparseable lines.
 *
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-002
 */
export function parseScrollbackIndexEntry(
  line: string,
): ScrollbackIndexEntry | null {
  if (line.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  return isScrollbackIndexEntry(parsed) ? parsed : null;
}

/**
 * Extracts the chronology correlation carried by a record, if any.
 *
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-003
 */
export function recordChronologySeq(
  record: ScrollbackRecord,
): number | undefined {
  if (record.rec === 'item' || record.rec === 'rev') {
    return record.chronologySeq;
  }
  return undefined;
}
