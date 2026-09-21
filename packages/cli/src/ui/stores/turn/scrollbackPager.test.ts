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
 * @plan PLAN-20260917-ISSUE854.P02c
 * @requirement G1,G2
 *
 * Behavioral tests for the ScrollbackPager store (issue-854-design.md §3):
 * generation-guarded async paging over a real JournalCursor on real temp
 * files, residency (visible ∪ live-pending always resident; margin heights;
 * byte floor on the off-screen margin only), merge-by-identity between the
 * live tail and paged rows, and the visibility floor (clear boundary / file
 * start). No Ink rendering — the viewport is an injected fake reporter;
 * the component wiring is P02d.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core';
import {
  createScrollbackPagerStore,
  type ScrollbackPagerStore,
  type ScrollbackViewportReporter,
} from './scrollbackPager.js';
import {
  pendingRowIdentity,
  rowIdentity,
  rowIdentityKey,
} from '../../utils/rowIdentity.js';
import type { HistoryItem } from '../../types.js';

const TS = '2026-01-01T00:00:00.000Z';

/**
 * Uniform row size: text is padded so every resident row's serialized size
 * lands in the same ~185-200 byte band, keeping byte-floor arithmetic
 * deterministic without depending on the exact estimator.
 */
const ROW_PAD_CHARS = 60;

class FakeViewport implements ScrollbackViewportReporter {
  visibleKeys: readonly string[] = [];
  viewportLines = 2;

  rowHeightLines(): number {
    return 1;
  }
}

interface Fixture {
  filePath: string;
  add(line: string): Promise<number>;
  addUser(seq: number, padChars?: number): Promise<number>;
  addCompressed(seq: number): Promise<number>;
  addRewind(seq: number): Promise<number>;
}

function chronology(seq: number) {
  return { seq, userTurn: 1, step: 1, recordedAt: 0 };
}

function userText(text: string, seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { chronology: chronology(seq) },
  };
}

function envelope(seq: number, type: string, payload: unknown): string {
  return JSON.stringify({ v: 1, seq, ts: TS, type, payload });
}

async function useJournalFixture(): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrollback-pager-'));
  const filePath = path.join(dir, 'session-under-test.jsonl');
  let offset = 0;
  const fixture: Fixture = {
    filePath,
    async add(line: string): Promise<number> {
      const at = offset;
      await fs.appendFile(filePath, `${line}\n`, 'utf8');
      offset += Buffer.byteLength(line, 'utf8') + 1;
      return at;
    },
    async addUser(seq: number, padChars: number = ROW_PAD_CHARS) {
      const pad = 'x'.repeat(padChars);
      return fixture.add(
        envelope(seq, 'content', { content: userText(`r-${seq}${pad}`, seq) }),
      );
    },
    async addCompressed(seq: number) {
      return fixture.add(
        envelope(seq, 'compressed', {
          summary: {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'summary' }],
          },
          itemsCompressed: 3,
        }),
      );
    },
    async addRewind(seq: number) {
      return fixture.add(
        envelope(seq, 'rewind', { itemsRemoved: 3, cutSeq: 2 }),
      );
    },
  };
  return fixture;
}

describe('ScrollbackPagerStore @plan:PLAN-20260917-ISSUE854.P02c @requirement:G1,G2', () => {
  let fixture: Fixture;
  let viewport: FakeViewport;
  let stores: ScrollbackPagerStore[];

  beforeEach(async () => {
    fixture = await useJournalFixture();
    viewport = new FakeViewport();
    stores = [];
    vi.useRealTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const store of stores.splice(0)) {
      await store.close().catch(() => undefined);
    }
    await fs.rm(path.dirname(fixture.filePath), {
      recursive: true,
      force: true,
    });
  });

  function makeStore(
    overrides: Partial<Parameters<typeof createScrollbackPagerStore>[0]> = {},
  ): ScrollbackPagerStore {
    const store = createScrollbackPagerStore({
      filePath: fixture.filePath,
      viewport,
      pageRows: 4,
      settings: {
        marginViewports: 2,
        byteFloorBytes: Number.POSITIVE_INFINITY,
        purgeDebounceMs: 1500,
      },
      ...overrides,
    });
    stores.push(store);
    return store;
  }

  /**
   * Row labels for membership assertions. Fixture rows pad their text
   * (`r-<seq>` plus x-padding so byte-floor arithmetic is deterministic)
   * and bun's `toContain` on arrays is exact membership (verified via
   * tmp/verify854/p02c/probe.test.ts), so padded journal rows are
   * projected back to their `r-<seq>` label here. Design §3 keeps
   * HistoryItem text verbatim — the projection lives in the assertion
   * helper, never in the rendered row.
   */
  function rowTexts(store: ScrollbackPagerStore): string[] {
    return store.getState().rows.map((row) => {
      const text = row.item.text ?? '';
      const seq = row.seq;
      return seq !== null && text.startsWith(`r-${seq}`) ? `r-${seq}` : text;
    });
  }

  function seqOf(store: ScrollbackPagerStore, seq: number): string | undefined {
    return store.getState().rows.find((row) => row.seq === seq)?.key;
  }

  function visibleKeysOfSeqs(
    store: ScrollbackPagerStore,
    seqs: readonly number[],
  ): string[] {
    const keys: string[] = [];
    for (const seq of seqs) {
      const key = seqOf(store, seq);
      if (key !== undefined) keys.push(key);
    }
    return keys;
  }

  it('boots with the last page of the journal resident (bounded resume projection)', async () => {
    for (let seq = 1; seq <= 10; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore();

    await store.pageBack();

    const state = store.getState();
    expect(state.rows.map((row) => row.seq)).toStrictEqual([7, 8, 9, 10]);
    expect(state.atFileEnd).toBe(true);
    expect(state.loadingOlder).toBe(false);
    expect(state.error).toBeNull();
  });

  it('discards a stale-generation page read after invalidation (no torn interleave)', async () => {
    for (let seq = 1; seq <= 12; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore();

    const stale = store.pageBack();
    await store.invalidate();
    await store.pageBack();
    await stale;

    const state = store.getState();
    expect(state.generation).toBe(1);
    const keys = state.rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(state.rows.map((row) => row.seq)).toStrictEqual([9, 10, 11, 12]);
  });

  it('flips loadingOlder during an in-flight pageBack and clears it after', async () => {
    for (let seq = 1; seq <= 10; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore();

    const pending = store.pageBack();
    expect(store.getState().loadingOlder).toBe(true);
    await pending;
    expect(store.getState().loadingOlder).toBe(false);
  });

  it('does not issue a read once the visibility floor is reached', async () => {
    await fixture.addUser(1);
    const store = makeStore();

    await store.pageBack();
    expect(store.getState().atVisibilityFloor).toBe(true);

    await store.pageBack();
    expect(store.getState().loadingOlder).toBe(false);
    expect(store.getState().rows).toHaveLength(1);
  });

  it('coalesces pageOut purges on a reset debounce and purges beyond-window rows once', async () => {
    vi.useFakeTimers();
    for (let seq = 1; seq <= 12; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore();
    // Three pages: pageRows=4 x 2 calls leaves only r-5..r-12 resident, so
    // r-3 (asserted below, pre-purge) needs a third page to be resident.
    await store.pageBack();
    await store.pageBack();
    await store.pageBack();
    viewport.visibleKeys = visibleKeysOfSeqs(store, [9, 10]);
    store.reportViewport();
    expect(rowTexts(store)).toContain('r-3');

    store.pageOut('older');
    vi.advanceTimersByTime(1000);
    store.pageOut('older');
    vi.advanceTimersByTime(1499);
    expect(rowTexts(store)).toContain('r-3');

    vi.advanceTimersByTime(1);
    const texts = rowTexts(store);
    // §3 margin = 2 viewports = 4 rows below the oldest visible row (r-9),
    // so the window floor sits at r-5 and only r-1..r-4 evict.
    expect(texts).not.toContain('r-3');
    expect(texts).not.toContain('r-4');
    expect(texts).toContain('r-5');
    expect(texts).toContain('r-6');
    expect(texts).toContain('r-10');
  });

  it('purges beyond-window rows sub-context first, far end first, down to the byte floor', async () => {
    vi.useFakeTimers();
    for (let seq = 1; seq <= 24; seq += 1) {
      await fixture.addUser(seq, seq <= 6 ? 140 : ROW_PAD_CHARS);
    }
    const store = makeStore({ pageRows: 8 });
    store.setContextWindow({ firstSeq: 7, lastSeq: 24 });
    await store.pageBack();
    await store.pageBack();
    await store.pageBack();
    viewport.visibleKeys = visibleKeysOfSeqs(store, [17, 18]);
    store.reportViewport();

    store.pageOut('older');
    vi.advanceTimersByTime(1500);

    const texts = rowTexts(store);
    // §3 evicts from the far off-screen end: sub-context r-1..r-6 first,
    // then beyond-window r-7..r-12 (window floor = 17 - 2 viewports = 13).
    // The original expectation of keeping r-7/r-8 while evicting r-10..r-12
    // demanded an interior eviction hole no suffix-eviction can produce.
    for (let seq = 1; seq <= 12; seq += 1) {
      expect(texts).not.toContain(`r-${seq}`);
    }
    expect(texts).toContain('r-13');
    expect(texts).toContain('r-14');
  });

  it('evicts sub-context rows immediately at bottom while keeping visible rows', async () => {
    for (let seq = 1; seq <= 12; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore();
    await store.pageBack();
    await store.pageBack();
    viewport.visibleKeys = visibleKeysOfSeqs(store, [7, 12]);
    store.reportViewport();

    store.setContextWindow({ firstSeq: 8, lastSeq: 12 });

    const texts = rowTexts(store);
    expect(texts).not.toContain('r-5');
    expect(texts).not.toContain('r-6');
    expect(texts).toContain('r-7');
    expect(texts).toContain('r-8');
    expect(texts).toContain('r-12');
  });

  it('keeps an oversized visible row resident across floor and purge enforcement', async () => {
    vi.useFakeTimers();
    for (let seq = 1; seq <= 12; seq += 1) {
      await fixture.addUser(seq, seq === 6 ? 4000 : ROW_PAD_CHARS);
    }
    const store = makeStore({
      settings: {
        marginViewports: 2,
        byteFloorBytes: 1000,
        purgeDebounceMs: 1500,
      },
    });
    await store.pageBack();
    await store.pageBack();
    await store.pageBack();
    viewport.visibleKeys = visibleKeysOfSeqs(store, [6]);
    store.reportViewport();

    store.pageOut('older');
    vi.advanceTimersByTime(1500);

    const texts = rowTexts(store);
    expect(texts).toContain('r-6');
    expect(store.metrics().residentBytes).toBeGreaterThan(4000);
  });

  it('trims the off-screen margin to the byte floor from the far end', async () => {
    for (let seq = 1; seq <= 12; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore({
      settings: {
        marginViewports: 2,
        byteFloorBytes: 750,
        purgeDebounceMs: 1500,
      },
    });
    await store.pageBack();
    viewport.visibleKeys = visibleKeysOfSeqs(store, [10, 12]);
    store.reportViewport();

    const texts = rowTexts(store);
    expect(texts).not.toContain('r-8');
    expect(texts).toContain('r-9');
    expect(texts).toContain('r-10');
    expect(texts).toContain('r-12');
  });

  it('merges a pending live row with its paged row by identity on commit, without duplicates', async () => {
    for (let seq = 1; seq <= 8; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore();
    await store.pageBack();

    const pendingItem: HistoryItem = {
      id: 4242,
      type: 'gemini',
      text: 'streaming-pending',
      rowIdentity: pendingRowIdentity('turn-1:0'),
    };
    store.setLiveTail([pendingItem]);
    expect(rowTexts(store)).toContain('streaming-pending');

    const committedOffset = await fixture.add(
      envelope(9, 'content', {
        content: {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'journal-text' }],
          metadata: { chronology: chronology(9) },
        },
      }),
    );
    await store.pageForward();

    const committedIdentity = rowIdentity(
      { kind: 'journal', offset: committedOffset },
      'text',
    );
    const resolved = store.commitPendingRow('turn-1:0', committedIdentity, {
      ...pendingItem,
      text: 'committed-live-text',
      rowIdentity: committedIdentity,
    });
    expect(resolved).toBe(true);
    await store.pageForward();

    const rows = store.getState().rows;
    const committedRows = rows.filter(
      (row) => row.key === rowIdentityKey(committedIdentity),
    );
    expect(committedRows).toHaveLength(1);
    expect(committedRows[0]?.item.text).toBe('committed-live-text');
    expect(rowTexts(store)).not.toContain('journal-text');
    expect(rows.some((row) => row.identity.kind === 'pending')).toBe(false);
  });

  it('refuses to commit a row that is not pending', async () => {
    const store = makeStore();
    const committed = rowIdentity({ kind: 'journal', offset: 1 }, 'text');
    const other = rowIdentity({ kind: 'journal', offset: 2 }, 'text');
    expect(
      store.commitPendingRow('nope', other, {
        id: 1,
        type: 'user',
        text: 'x',
        rowIdentity: committed,
      }),
    ).toBe(false);
  });

  it('repages file growth forward and merges new rows without duplicates', async () => {
    for (let seq = 1; seq <= 10; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore();
    await store.pageBack();

    await fixture.addUser(11);
    await fixture.addUser(12);
    await store.pageForward();

    const state = store.getState();
    const keys = state.rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(state.rows.map((row) => row.seq)).toStrictEqual([
      7, 8, 9, 10, 11, 12,
    ]);
    expect(state.atFileEnd).toBe(true);

    await store.pageForward();
    expect(store.getState().rows.map((row) => row.seq)).toStrictEqual([
      7, 8, 9, 10, 11, 12,
    ]);
  });

  it('stops pageBack at the clear boundary so cleared history never resurrects', async () => {
    for (let seq = 1; seq <= 4; seq += 1) {
      await fixture.addUser(seq);
    }
    await fixture.addRewind(5);
    for (let seq = 6; seq <= 9; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore({ pageRows: 2 });

    await store.pageBack();
    await store.pageBack();
    await store.pageBack();

    const state = store.getState();
    expect(state.atVisibilityFloor).toBe(true);
    const texts = rowTexts(store);
    for (let seq = 1; seq <= 4; seq += 1) {
      expect(texts).not.toContain(`r-${seq}`);
    }
    for (let seq = 6; seq <= 9; seq += 1) {
      expect(texts).toContain(`r-${seq}`);
    }

    await store.pageBack();
    expect(store.getState().rows).toHaveLength(state.rows.length);
  });

  it('pages through compressed boundaries and stops only at file start', async () => {
    for (let seq = 1; seq <= 4; seq += 1) {
      await fixture.addUser(seq);
    }
    await fixture.addCompressed(5);
    for (let seq = 6; seq <= 9; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore({ pageRows: 2 });

    await store.pageBack();
    await store.pageBack();
    await store.pageBack();
    await store.pageBack();

    const state = store.getState();
    expect(state.atVisibilityFloor).toBe(true);
    const texts = rowTexts(store);
    for (let seq = 1; seq <= 4; seq += 1) {
      expect(texts).toContain(`r-${seq}`);
    }
    expect(texts.some((text) => text.includes('compressed'))).toBe(true);
  });

  it('survives a cursor close during an in-flight read via the generation guard', async () => {
    for (let seq = 1; seq <= 10; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore();

    const inFlight = store.pageBack();
    await store.close();
    await inFlight;

    const state = store.getState();
    expect(state.generation).toBe(1);
    expect(state.loadingOlder).toBe(false);
    expect(state.error).toBeNull();
    expect(state.rows).toHaveLength(0);

    await store.pageBack();
    expect(store.getState().loadingOlder).toBe(false);
  });

  it('keeps the resident set bounded across repeated paging cycles', async () => {
    vi.useFakeTimers();
    for (let seq = 1; seq <= 60; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore({
      settings: {
        marginViewports: 2,
        byteFloorBytes: 400,
        purgeDebounceMs: 1500,
      },
    });

    for (let cycle = 0; cycle < 8; cycle += 1) {
      await store.pageBack();
      store.pageOut('older');
      vi.advanceTimersByTime(1500);
      const state = store.getState();
      expect(state.rows.length).toBeLessThanOrEqual(12);
      const keys = state.rows.map((row) => row.key);
      expect(new Set(keys).size).toBe(keys.length);
    }

    const metrics = store.metrics();
    expect(metrics.residentRows).toBe(store.getState().rows.length);
    expect(metrics.residentRows).toBeLessThanOrEqual(12);
  });

  it('merges legacy fallback rows by identity and keeps them distinct from paged rows', async () => {
    for (let seq = 1; seq <= 10; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore();

    const legacyOne = rowIdentity({ kind: 'legacy', index: 0 }, 'text');
    const legacyTwo = rowIdentity({ kind: 'legacy', index: 1 }, 'text');
    store.setLiveTail([
      { id: 101, type: 'user', text: 'legacy-1', rowIdentity: legacyOne },
      { id: 102, type: 'user', text: 'legacy-2', rowIdentity: legacyTwo },
    ]);
    await store.pageBack();

    store.setLiveTail([
      {
        id: 101,
        type: 'user',
        text: 'legacy-1-updated',
        rowIdentity: legacyOne,
      },
      { id: 102, type: 'user', text: 'legacy-2', rowIdentity: legacyTwo },
    ]);

    const state = store.getState();
    const texts = rowTexts(store);
    expect(texts.filter((text) => text.startsWith('legacy-1'))).toHaveLength(1);
    expect(texts).toContain('legacy-1-updated');
    expect(texts).toContain('legacy-2');
    expect(texts).toContain('r-7');
    const keys = state.rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      state.rows
        .filter((row) => row.offset === null)
        .map((row) => row.item.text),
    ).toStrictEqual(['legacy-1-updated', 'legacy-2']);
  });

  it('keeps pending live rows resident regardless of eviction cycles', async () => {
    vi.useFakeTimers();
    for (let seq = 1; seq <= 12; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore();
    store.setLiveTail([
      {
        id: 900,
        type: 'gemini',
        text: 'live-pending-row',
        rowIdentity: pendingRowIdentity('turn-2:0'),
      },
    ]);
    await store.pageBack();
    await store.pageBack();
    viewport.visibleKeys = visibleKeysOfSeqs(store, [9, 10]);
    store.reportViewport();
    store.pageOut('older');
    vi.advanceTimersByTime(1500);

    expect(rowTexts(store)).toContain('live-pending-row');
  });
});
