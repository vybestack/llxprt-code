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
 * Behavioral tests for the scrollback journal writer against the real
 * filesystem: sidecar creation, monotonic uiSeq, revision last-wins,
 * control records, and resume seeding.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { useTempChatsDir } from '../__testhelpers__/scrollbackTestHelpers.js';
import { ScrollbackJournal } from './ScrollbackJournal.js';
import {
  parseScrollbackRecord,
  type ScrollbackItemRecord,
  type ScrollbackRecord,
} from './scrollbackRecords.js';
import type { HistoryItem } from '../../ui/types.js';

function infoItem(id: number, text: string): HistoryItem {
  return { id, type: 'info', text };
}

type ScrollbackRecordKind = ScrollbackRecord['rec'];

function requireRec<K extends ScrollbackRecordKind>(
  record: ScrollbackRecord | undefined,
  rec: K,
): Extract<ScrollbackRecord, { rec: K }> {
  if (record === undefined || record.rec !== rec) {
    throw new Error(`expected a ${rec} record`);
  }
  return record as Extract<ScrollbackRecord, { rec: K }>;
}

function readJournalRecords(
  chatsDir: string,
  base: string,
): ScrollbackRecord[] {
  const raw = fs.readFileSync(path.join(chatsDir, `sb-${base}.jsonl`), 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const record = parseScrollbackRecord(line);
      if (record === null) {
        throw new Error(`unparseable journal line: ${line}`);
      }
      return record;
    });
}

describe('ScrollbackJournal', () => {
  const tempDir = useTempChatsDir();

  it('creates sb-<base>.jsonl and sb-<base>.idx.jsonl next to the session file', () => {
    const chatsDir = tempDir.chatsDir();
    fs.writeFileSync(path.join(chatsDir, 'session-t1-abc.jsonl'), '');
    const journal = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 't1-abc',
      enabled: true,
    });
    journal.append(infoItem(1, 'first'));
    journal.close();
    const files = fs.readdirSync(chatsDir);
    expect(files).toContain('sb-t1-abc.jsonl');
    expect(files).toContain('sb-t1-abc.idx.jsonl');
  });

  it('assigns strictly monotonic uiSeq and persists payloads byte-equivalent to appends', () => {
    const chatsDir = tempDir.chatsDir();
    const journal = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 't2',
      enabled: true,
    });
    const items = [
      infoItem(1, 'alpha'),
      infoItem(2, 'beta'),
      infoItem(3, 'gamma'),
    ];
    const seqs = items.map((item) => journal.append(item));
    journal.close();
    expect(seqs).toStrictEqual([1, 2, 3]);
    const records = readJournalRecords(chatsDir, 't2');
    const itemRecords = records.filter(
      (record): record is ScrollbackItemRecord => record.rec === 'item',
    );
    expect(itemRecords.map((record) => record.payload.text)).toStrictEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(itemRecords.map((record) => record.uiSeq)).toStrictEqual([1, 2, 3]);
    expect(new Set(itemRecords.map((record) => record.ts)).size).toBe(1);
  });

  it('carries chronology stamps onto item records when provided', () => {
    const chatsDir = tempDir.chatsDir();
    const journal = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 't3',
      enabled: true,
    });
    journal.append(infoItem(1, 'stamped'), { chronologySeq: 12 });
    journal.append(infoItem(2, 'span'), { seqSpan: [11, 12] });
    journal.close();
    const records = readJournalRecords(chatsDir, 't3');
    const itemRecords = records.filter(
      (record): record is ScrollbackItemRecord => record.rec === 'item',
    );
    expect(itemRecords[0]?.chronologySeq).toBe(12);
    expect(itemRecords[0]?.seqSpan).toBeUndefined();
    expect(itemRecords[1]?.chronologySeq).toBeUndefined();
    expect(itemRecords[1]?.seqSpan).toStrictEqual([11, 12]);
  });

  it('journals revisions that supersede the original payload per itemId', () => {
    const chatsDir = tempDir.chatsDir();
    const journal = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 't4',
      enabled: true,
    });
    const uiSeq = journal.append(infoItem(9, 'streaming'));
    journal.appendRevision(9, infoItem(9, 'final text'));
    journal.close();
    expect(uiSeq).toBe(1);
    const records = readJournalRecords(chatsDir, 't4');
    const revRecord = records.find((record) => record.rec === 'rev');
    const rev = requireRec(revRecord, 'rev');
    expect(rev.itemId).toBe(9);
    expect(rev.payload.text).toBe('final text');
  });

  it('journals boundary, clear, and rewind control records', () => {
    const chatsDir = tempDir.chatsDir();
    const journal = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 't5',
      enabled: true,
    });
    journal.append(infoItem(1, 'before'));
    journal.appendBoundary({
      summaryText: 'compressed 4 messages',
      replacedFromSeq: 1,
      replacedToSeq: 4,
      itemCount: 4,
    });
    journal.appendRewind(1);
    journal.appendClear();
    journal.close();
    const records = readJournalRecords(chatsDir, 't5');
    expect(records.map((record) => record.rec)).toStrictEqual([
      'item',
      'boundary',
      'rewind',
      'clear',
    ]);
    const boundary = requireRec(records[1], 'boundary');
    expect(boundary.summaryText).toBe('compressed 4 messages');
    expect(boundary.replacedFromSeq).toBe(1);
    expect(boundary.replacedToSeq).toBe(4);
    expect(boundary.itemCount).toBe(4);
    const rewind = requireRec(records[2], 'rewind');
    expect(rewind.truncateAfterUiSeq).toBe(1);
  });

  it('resumes uiSeq from the index tail so sequences stay monotonic across reopen', () => {
    const chatsDir = tempDir.chatsDir();
    const first = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 't6',
      enabled: true,
    });
    first.append(infoItem(1, 'one'));
    first.append(infoItem(2, 'two'));
    first.close();
    const second = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 't6',
      enabled: true,
    });
    const resumed = second.append(infoItem(3, 'three'));
    second.close();
    expect(resumed).toBe(3);
  });

  it('writes nothing when disabled', () => {
    const chatsDir = tempDir.chatsDir();
    const journal = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 't7',
      enabled: false,
    });
    expect(journal.isActive()).toBe(false);
    expect(journal.append(infoItem(1, 'ignored'))).toBeNull();
    journal.appendRevision(1, infoItem(1, 'ignored'));
    journal.appendBoundary({
      summaryText: 'x',
      replacedFromSeq: 1,
      replacedToSeq: 2,
      itemCount: 2,
    });
    journal.appendClear();
    journal.appendRewind(0);
    journal.close();
    expect(fs.readdirSync(chatsDir)).toStrictEqual([]);
  });
});
