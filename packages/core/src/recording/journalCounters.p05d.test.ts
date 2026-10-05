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
 * P05d RED tests — peak decoded-row counters (issue #854, criterion 5).
 *
 * These tests define the instrumentation contract the green phase must
 * satisfy: the journal read path (replay, cursor, resolver) reports every
 * envelope decode and every content-row materialization/release through an
 * injectable counters object, and the resulting peak is what the bounded
 * resume assertions rely on.
 *
 * Expected state: RED. The counters options do not exist yet, so the
 * counters never fire; every aliveness assertion in this file is written to
 * fail under exactly that condition. The negative control documents the
 * other direction: once plumbed, the counter MUST catch whole-context
 * buffering (replaySession holds the entire history array until
 * finalizeReplay), proving the metric can detect the buffering regime.
 *
 * @plan PLAN-20260917-ISSUE854.P05d
 * @requirement G5
 */

import { describe, expect, it } from 'bun:test';
import { JournalCursor } from './journalCursor.js';
import { JournalResolver } from './journalResolver.js';
import { replaySession } from './ReplayEngine.js';
import {
  createRowCounters,
  LARGE_N,
  makeTempChatsDir,
  PAGE_BOUND,
  PROJECT_HASH,
  SMALL_N,
  withCounters,
  writeRawJournal,
} from './p05dTestKit.js';

describe('P05d peak decoded-row counters @issue:854', () => {
  it('counter factory computes peak from decode/release pairs (kit self-check)', () => {
    const kit = createRowCounters();
    kit.counters.recordDecoded();
    kit.counters.rowDecoded();
    kit.counters.rowDecoded();
    expect(kit.snapshot()).toStrictEqual({
      recordsDecoded: 1,
      rowsDecoded: 2,
      peakDecodedRows: 2,
    });
    kit.counters.rowReleased();
    expect(kit.snapshot().peakDecodedRows).toBe(2);
    kit.counters.rowReleased();
    expect(kit.snapshot().peakDecodedRows).toBe(2);
  });

  it('NEGATIVE CONTROL: replaySession with counters reports peak ~= N on a large no-compression journal', async () => {
    const chatsDir = await makeTempChatsDir();
    const session = await writeRawJournal(chatsDir, { rows: LARGE_N });
    const kit = createRowCounters();

    const replay = await replaySession(
      session.filePath,
      PROJECT_HASH,
      withCounters({}, kit.counters),
    );

    expect(replay.ok).toBe(true);
    const stats = kit.snapshot();
    // Aliveness: the counters must have observed the path at all.
    expect(stats.recordsDecoded).toBeGreaterThanOrEqual(1);
    // Every row decoded, none released before finalize: full materialization.
    expect(stats.rowsDecoded).toBe(LARGE_N);
    // The sensitivity clause: whole-context buffering must be visible.
    expect(stats.peakDecodedRows).toBeGreaterThanOrEqual(LARGE_N / 2);
  }, 30_000);

  it('JournalCursor with counters observes decodes with page-bounded peak', async () => {
    const chatsDir = await makeTempChatsDir();
    const session = await writeRawJournal(chatsDir, { rows: SMALL_N });
    const kit = createRowCounters();

    const cursor = await JournalCursor.open(
      session.filePath,
      withCounters({}, kit.counters),
    );
    try {
      const page = await cursor.pageBack(PAGE_BOUND);
      const entryCount = page.entries.length;
      expect(entryCount).toBe(SMALL_N);
    } finally {
      await cursor.close();
    }

    const stats = kit.snapshot();
    expect(stats.recordsDecoded).toBeGreaterThanOrEqual(1);
    expect(stats.rowsDecoded).toBe(SMALL_N);
    expect(stats.peakDecodedRows).toBeLessThanOrEqual(PAGE_BOUND);
  });

  it('JournalResolver with counters streams the whole journal with bounded peak', async () => {
    const chatsDir = await makeTempChatsDir();
    const session = await writeRawJournal(chatsDir, { rows: LARGE_N });
    const kit = createRowCounters();

    const resolver = await JournalResolver.open(
      session.filePath,
      withCounters({}, kit.counters),
    );
    let resolvedRows = 0;
    let lastSeq = -1;
    for await (const entry of resolver.resolve()) {
      resolvedRows += 1;
      lastSeq = entry.seq;
    }

    expect(resolvedRows).toBe(LARGE_N);
    // Raw journal rows carry seq 2..N+1 (seq 1 is the session_start).
    expect(lastSeq).toBe(LARGE_N + 1);
    const stats = kit.snapshot();
    expect(stats.recordsDecoded).toBeGreaterThanOrEqual(1);
    expect(stats.rowsDecoded).toBe(LARGE_N);
    expect(stats.peakDecodedRows).toBeLessThanOrEqual(PAGE_BOUND);
  }, 30_000);
});
