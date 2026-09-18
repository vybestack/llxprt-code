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
 * Behavioral tests for the offset index: page reads return exactly the
 * appended payloads, and reopening after a truncated index (simulated crash)
 * rebuilds only the un-indexed suffix without rewriting existing entries.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { useTempChatsDir } from '../__testhelpers__/scrollbackTestHelpers.js';
import { ScrollbackIndex } from './scrollbackIndex.js';
import { ScrollbackJournal } from './ScrollbackJournal.js';
import type { HistoryItem } from '../../ui/types.js';

function infoItem(id: number, text: string): HistoryItem {
  return { id, type: 'info', text };
}

interface JournalPaths {
  readonly journalPath: string;
  readonly indexPath: string;
}

function journalPaths(chatsDir: string, base: string): JournalPaths {
  return {
    journalPath: path.join(chatsDir, `sb-${base}.jsonl`),
    indexPath: path.join(chatsDir, `sb-${base}.idx.jsonl`),
  };
}

function writeIndexedItems(
  chatsDir: string,
  base: string,
  items: readonly HistoryItem[],
): void {
  const journal = ScrollbackJournal.open({
    chatsDir,
    sessionFileBase: base,
    enabled: true,
  });
  for (const item of items) {
    journal.append(item);
  }
  journal.close();
}

describe('scrollbackIndex', () => {
  const tempDir = useTempChatsDir();

  it('pageRead returns payloads identical to what was appended', () => {
    const chatsDir = tempDir.chatsDir();
    const items = [
      infoItem(1, 'one'),
      infoItem(2, 'two'),
      infoItem(3, 'three'),
      infoItem(4, 'four'),
    ];
    writeIndexedItems(chatsDir, 'p1', items);
    const { journalPath, indexPath } = journalPaths(chatsDir, 'p1');
    const index = ScrollbackIndex.open(journalPath, indexPath);
    const page = index.pageRead(2, 3);
    expect(page.map((pageEntry) => pageEntry.entry.uiSeq)).toStrictEqual([
      2, 3,
    ]);
    const pageTexts = page.map((pageEntry) => {
      if (pageEntry.record.rec !== 'item') {
        throw new Error('expected item record');
      }
      return pageEntry.record.payload.text;
    });
    expect(pageTexts).toStrictEqual(['two', 'three']);
    expect(index.getRangeMeta()).toStrictEqual({
      count: 4,
      firstUiSeq: 1,
      lastUiSeq: 4,
    });
    index.close();
  });

  it('rebuilds only the un-indexed suffix when the index is short', () => {
    const chatsDir = tempDir.chatsDir();
    const items = [
      infoItem(1, 'a'),
      infoItem(2, 'b'),
      infoItem(3, 'c'),
      infoItem(4, 'd'),
    ];
    writeIndexedItems(chatsDir, 'p2', items);
    const { journalPath, indexPath } = journalPaths(chatsDir, 'p2');

    const fullIndexLines = fs.readFileSync(indexPath, 'utf-8').split('\n');
    const keptLines = fullIndexLines.slice(0, 2 + 1); // keep first 2 entries + trailing blank
    fs.writeFileSync(indexPath, keptLines.join('\n'));
    const keptBefore = fs.readFileSync(indexPath, 'utf-8');

    const index = ScrollbackIndex.open(journalPath, indexPath);
    expect(index.size).toBe(4);
    expect(index.lastUiSeq).toBe(4);

    // Existing entries were not rewritten: the file still starts with the
    // exact bytes it had before the rebuild appended to.
    const after = fs.readFileSync(indexPath, 'utf-8');
    expect(after.startsWith(keptBefore)).toBe(true);

    const rebuilt = index.pageRead(3, 4);
    const rebuiltTexts = rebuilt.map((pageEntry) => {
      if (pageEntry.record.rec !== 'item') {
        throw new Error('expected item record');
      }
      return pageEntry.record.payload.text;
    });
    expect(rebuiltTexts).toStrictEqual(['c', 'd']);
    index.close();
  });

  it('seeds an empty timeline when no journal exists yet', () => {
    const chatsDir = tempDir.chatsDir();
    const { journalPath, indexPath } = journalPaths(chatsDir, 'p3');
    const index = ScrollbackIndex.open(journalPath, indexPath);
    expect(index.size).toBe(0);
    expect(index.lastUiSeq).toBe(0);
    expect(index.pageRead(1, 10)).toStrictEqual([]);
    index.close();
  });

  it('drops torn trailing index entries that point past the journal', () => {
    const chatsDir = tempDir.chatsDir();
    writeIndexedItems(chatsDir, 'p4', [infoItem(1, 'only')]);
    const { journalPath, indexPath } = journalPaths(chatsDir, 'p4');
    const journalSize = fs.statSync(journalPath).size;
    fs.writeFileSync(
      indexPath,
      `${JSON.stringify({
        uiSeq: 1,
        byteOffset: journalSize + 500,
        byteLen: 10,
        kind: 'info',
      })}\n`,
    );
    const index = ScrollbackIndex.open(journalPath, indexPath);
    // The torn entry is dropped, then the real journal line is recovered by
    // the suffix scan — never a phantom entry from the torn bytes.
    expect(index.size).toBe(1);
    expect(index.lastUiSeq).toBe(1);
    const recovered = index.pageRead(1, 1);
    expect(recovered[0]?.record.rec).toBe('item');
    index.close();
  });

  it('indexes item records with their kind and chronology seq', () => {
    const chatsDir = tempDir.chatsDir();
    const journal = ScrollbackJournal.open({
      chatsDir,
      sessionFileBase: 'p5',
      enabled: true,
    });
    journal.append(infoItem(1, 'stamped'), { chronologySeq: 42 });
    journal.close();
    const { journalPath, indexPath } = journalPaths(chatsDir, 'p5');
    const index = ScrollbackIndex.open(journalPath, indexPath);
    const page = index.pageRead(1, 1);
    expect(page[0]?.entry.kind).toBe('info');
    expect(page[0]?.entry.chronologySeq).toBe(42);
    const record = page[0]?.record;
    if (record === undefined) {
      throw new Error('expected a page record');
    }
    if (record.rec !== 'item') {
      throw new Error('expected an item record');
    }
    expect(record.kind).toBe('info');
    index.close();
  });
});
