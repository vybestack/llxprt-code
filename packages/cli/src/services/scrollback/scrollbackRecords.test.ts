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
 * @requirement REQ-854-002
 * Round-trip validation of scrollback journal record shapes.
 */

import { describe, expect, it } from 'bun:test';
import {
  SCROLLBACK_RECORD_VERSION,
  isScrollbackIndexEntry,
  isScrollbackRecord,
  parseScrollbackIndexEntry,
  parseScrollbackRecord,
  recordChronologySeq,
  type ScrollbackItemRecord,
} from './scrollbackRecords.js';

describe('scrollbackRecords', () => {
  it('round-trips an item record through JSON and the validator', () => {
    const record: ScrollbackItemRecord = {
      v: SCROLLBACK_RECORD_VERSION,
      rec: 'item',
      uiSeq: 41,
      itemId: 7,
      ts: '2026-09-17T00:00:00.000Z',
      kind: 'gemini',
      chronologySeq: 37,
      seqSpan: [36, 38],
      payload: { id: 7, type: 'gemini', text: 'hello' },
    };
    const parsed = parseScrollbackRecord(JSON.stringify(record));
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(record);
    expect(isScrollbackRecord(record)).toBe(true);
  });

  it('rejects lines that are not scrollback records', () => {
    expect(parseScrollbackRecord('')).toBeNull();
    expect(parseScrollbackRecord('not json')).toBeNull();
    expect(parseScrollbackRecord('{"v":1,"rec":"item"}')).toBeNull();
    expect(parseScrollbackRecord('{"v":2,"rec":"clear","uiSeq":1,"ts":"x"}')).toBeNull();
    expect(
      parseScrollbackRecord(
        '{"v":1,"rec":"item","uiSeq":1,"itemId":1,"ts":"x","kind":"info","payload":null}',
      ),
    ).toBeNull();
  });

  it('round-trips index entries and rejects malformed ones', () => {
    const entry = {
      uiSeq: 3,
      byteOffset: 128,
      byteLen: 64,
      kind: 'item',
      chronologySeq: 9,
    };
    expect(parseScrollbackIndexEntry(JSON.stringify(entry))).toEqual(entry);
    expect(parseScrollbackIndexEntry('')).toBeNull();
    expect(parseScrollbackIndexEntry('[1,2,3]')).toBeNull();
    expect(
      parseScrollbackIndexEntry('{"uiSeq":3,"byteOffset":-1,"byteLen":8,"kind":"item"}'),
    ).toBeNull();
    expect(isScrollbackIndexEntry(entry)).toBe(true);
  });

  it('reports chronology correlation only for item and rev records', () => {
    const parsed = parseScrollbackRecord(
      JSON.stringify({
        v: SCROLLBACK_RECORD_VERSION,
        rec: 'item',
        uiSeq: 1,
        itemId: 1,
        ts: 't',
        kind: 'info',
        payload: { id: 1, type: 'info', text: 'x' },
      }),
    );
    expect(parsed).not.toBeNull();
    if (parsed !== null && parsed.rec === 'item') {
      expect(recordChronologySeq(parsed)).toBeUndefined();
    }
    const stamped = parseScrollbackRecord(
      JSON.stringify({
        v: SCROLLBACK_RECORD_VERSION,
        rec: 'rev',
        uiSeq: 2,
        itemId: 1,
        ts: 't',
        chronologySeq: 5,
        payload: { id: 1, type: 'info', text: 'y' },
      }),
    );
    expect(stamped).not.toBeNull();
    if (stamped !== null) {
      expect(recordChronologySeq(stamped)).toBe(5);
    }
  });
});
