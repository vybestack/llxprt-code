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
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import {
  createScrollbackPagerStore,
  type ScrollbackPagerStore,
  type ScrollbackViewportReporter,
} from './scrollbackPager.js';
import { JournalArrivalRecorder } from '@vybestack/llxprt-code-core/journal/arrival-recorder.js';

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
  add(content: IContent): Promise<number>;
  addUser(seq: number, padChars?: number): Promise<number>;
  addCompressed(seq: number): Promise<void>;
  addRewind(seq: number): Promise<void>;
  stageUser(seq: number): Promise<() => Promise<void>>;
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

async function createJournalFixture(): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrollback-pager-'));
  const filePath = path.join(dir, 'session-under-test.llxj');
  await (await JournalSession.create(filePath)).close();
  const fixture: Fixture = {
    filePath,
    async add(content: IContent): Promise<number> {
      const session = await JournalSession.open(filePath);
      try {
        await session.append([content]);
        for await (const entry of session.store.rows(
          (session.store.published?.rows ?? 1) - 1,
        ))
          return entry.recordOffset;
        throw new Error('Missing appended native row');
      } finally {
        await session.close();
      }
    },
    async addUser(seq: number, padChars: number = ROW_PAD_CHARS) {
      return fixture.add(userText(`r-${seq}${'x'.repeat(padChars)}`, seq));
    },
    async addCompressed(seq: number): Promise<void> {
      const session = await JournalSession.open(filePath);
      try {
        const version = session.store.published;
        if (version === undefined)
          throw new Error('Missing compression prefix');
        await session.store.commit([
          {
            kind: 'compress',
            retainFromLabel: version.nextLabel,
            expectedReplaced: version.rows,
            summary: encodeContentRow(
              {
                speaker: 'ai',
                blocks: [{ type: 'text', text: 'summary' }],
                metadata: { isSummary: true, chronology: chronology(seq) },
              },
              { owner: 0 },
            ),
          },
        ]);
      } finally {
        await session.close();
      }
    },
    async addRewind(_seq: number): Promise<void> {
      const session = await JournalSession.open(filePath);
      try {
        for await (const entry of session.store.rows(1)) {
          await session.store.commit([
            { kind: 'pop', cutLabel: entry.label, expectedRemoved: 3 },
          ]);
          return;
        }
        throw new Error('Missing native rewind cut');
      } finally {
        await session.close();
      }
    },
    async stageUser(seq: number): Promise<() => Promise<void>> {
      const before = (await fs.stat(filePath)).size;
      const staged = `${filePath}.staged`;
      await fs.copyFile(filePath, staged);
      const writer = await JournalSession.open(staged);
      try {
        await writer.append([
          userText(`r-${seq}${'x'.repeat(ROW_PAD_CHARS)}`, seq),
        ]);
      } finally {
        await writer.close();
      }
      const bytes = await fs.readFile(staged);
      await fs.rm(staged);
      await fs.appendFile(filePath, bytes.subarray(before, bytes.length - 1));
      return async (): Promise<void> => {
        await fs.appendFile(filePath, bytes.subarray(bytes.length - 1));
      };
    },
  };
  return fixture;
}

let fixture: Fixture;
let viewport: FakeViewport;
let stores: ScrollbackPagerStore[];

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

async function setupPagerFixture(): Promise<void> {
  fixture = await createJournalFixture();
  viewport = new FakeViewport();
  stores = [];
  vi.useRealTimers();
}

async function cleanupPagerFixture(): Promise<void> {
  vi.useRealTimers();
  for (const store of stores.splice(0)) {
    await store.close().catch(() => undefined);
  }
  await fs.rm(path.dirname(fixture.filePath), {
    recursive: true,
    force: true,
  });
}

describe('ScrollbackPagerStore @plan:PLAN-20260917-ISSUE854.P02c @requirement:G1,G2', () => {
  beforeEach(() => setupPagerFixture());
  afterEach(() => cleanupPagerFixture());

  it('publishes committed rows and immediate purges without a polling reader', async () => {
    await fixture.addUser(1);
    const store = makeStore({
      settings: { marginViewports: 0, byteFloorBytes: 0, purgeDebounceMs: 0 },
    });
    await store.resumeFromJournal();
    const frames: string[][] = [];
    const unsubscribe = store.subscribe(() => frames.push(rowTexts(store)));
    await fixture.addUser(2);
    await waitFor(() => expect(frames.at(-1)).toContain('r-2'));
    expect(frames.at(-1)).toStrictEqual(['r-1', 'r-2']);
    store.pageOut('older');
    expect(frames.at(-1)).toStrictEqual([]);
    unsubscribe();
    const publishedFrames = frames.length;
    await store.pageBack();
    expect(frames).toHaveLength(publishedFrames);
    expect(rowTexts(store)).toStrictEqual(['r-1', 'r-2']);
  });

  it('rejects non-native journal paths before opening the pager', () => {
    expect(() =>
      createScrollbackPagerStore({
        filePath: `${fixture.filePath}.jsonl`,
        viewport,
        pageRows: 4,
        settings: {
          marginViewports: 0,
          byteFloorBytes: Infinity,
          purgeDebounceMs: 0,
        },
      }),
    ).toThrow('Scrollback requires a .llxj session journal');
  });

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
});

describe('ScrollbackPagerStore @plan:PLAN-20260917-ISSUE854.P02c @requirement:G1,G2 (group 2)', () => {
  beforeEach(() => setupPagerFixture());
  afterEach(() => cleanupPagerFixture());

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
});

describe('ScrollbackPagerStore @plan:PLAN-20260917-ISSUE854.P02c @requirement:G1,G2 (group 3)', () => {
  beforeEach(() => setupPagerFixture());
  afterEach(() => cleanupPagerFixture());

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
});

describe('ScrollbackPagerStore @plan:PLAN-20260917-ISSUE854.P02c @requirement:G1,G2 (group 4)', () => {
  beforeEach(() => setupPagerFixture());
  afterEach(() => cleanupPagerFixture());

  it('refreshes a partial row under its journal identity and seals it without duplicates', async () => {
    const session = await JournalSession.open(fixture.filePath);
    const recorder = new JournalArrivalRecorder(session.store);
    const store = makeStore();
    try {
      const row = await recorder.beginRow(
        encodeContentRow({ speaker: 'ai', blocks: [] }, { owner: 0 }),
        { id: 'a', submissionId: 's' },
      );
      const block = await recorder.beginNamedBlock(row, 0);
      await recorder.appendText(block, 'text', 'prefix');
      await recorder.flush();
      await store.resumeFromJournal();
      const key = `transcript:${row.transcriptId}:text`;
      expect(rowTexts(store)).toStrictEqual(['prefix']);
      await recorder.appendText(block, 'text', ' suffix');
      await recorder.flush();
      await store.pageForward();
      expect(rowTexts(store)).toStrictEqual(['prefix suffix']);
      expect(store.getState().rows[0]?.key).toBe(key);
      await recorder.endBlock(block);
      await recorder.sealRow(row);
      await store.pageForward();
      expect(store.getState().rows).toHaveLength(1);
      expect(store.getState().rows[0]?.key).toBe(key);
      expect(rowTexts(store)).toStrictEqual(['prefix suffix']);
    } finally {
      await recorder.close();
      await session.close();
    }
  });

  it('cannot publish a row through a pending-to-committed overlay API', async () => {
    const store = makeStore();
    expect('commitPendingRow' in store).toBe(false);
    expect('setLiveTail' in store).toBe(false);
    await store.pageBack();
    expect(store.getState().rows).toHaveLength(0);
  });
});

describe('ScrollbackPagerStore @plan:PLAN-20260917-ISSUE854.P02c @requirement:G1,G2 (group 5)', () => {
  beforeEach(() => setupPagerFixture());
  afterEach(() => cleanupPagerFixture());

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

  it('keeps the end of the complete file unchanged when pageBack sees a torn tail', async () => {
    for (let seq = 1; seq <= 12; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore();
    await store.pageBack();
    const initialState = store.getState();
    expect(initialState.rows.map((row) => row.seq)).toStrictEqual([
      9, 10, 11, 12,
    ]);
    expect(initialState.atFileEnd).toBe(true);

    await fixture.stageUser(13);
    await store.pageBack();
    const tornState = store.getState();
    expect(tornState.rows.map((row) => row.seq)).toStrictEqual([
      5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(tornState.atFileEnd).toBe(true);
  });

  it('detects a completed torn-tail append on pageBack and reads it forward', async () => {
    for (let seq = 1; seq <= 12; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore();
    await store.pageBack();
    const complete = await fixture.stageUser(13);
    await store.pageBack();

    await complete();
    await store.pageBack();
    expect(store.getState().rows.map((row) => row.seq)).toStrictEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(store.getState().atFileEnd).toBe(false);

    await store.pageForward();
    const state = store.getState();
    expect(state.rows.map((row) => row.seq)).toStrictEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    expect(new Set(state.rows.map((row) => row.key)).size).toBe(13);
    expect(state.atFileEnd).toBe(true);
  });
});

describe('ScrollbackPagerStore @plan:PLAN-20260917-ISSUE854.P02c @requirement:G1,G2 (group 5 continued)', () => {
  beforeEach(() => setupPagerFixture());
  afterEach(() => cleanupPagerFixture());

  it('retains the rewound suffix in transcript order with context markers', async () => {
    for (let seq = 1; seq <= 4; seq += 1) {
      await fixture.addUser(seq);
    }
    await fixture.addRewind(5);
    for (let seq = 6; seq <= 9; seq += 1) {
      await fixture.addUser(seq);
    }
    const store = makeStore({ pageRows: 2 });

    for (let page = 0; page < 5; page++) await store.pageBack();

    const state = store.getState();
    expect(state.atVisibilityFloor).toBe(true);
    const texts = rowTexts(store);
    expect(texts).toStrictEqual([
      'r-1',
      'r-2',
      'r-3',
      'r-4',
      '[context changed: 2]',
      'r-6',
      'r-7',
      'r-8',
      'r-9',
    ]);
    expect(state.rows.map((row) => row.contextState)).toStrictEqual([
      'in-context',
      'purged',
      'purged',
      'purged',
      'purged',
      'in-context',
      'in-context',
      'in-context',
      'in-context',
    ]);
    await store.pageBack();
    expect(store.getState().rows).toHaveLength(state.rows.length);
  });
});

describe('ScrollbackPagerStore @plan:PLAN-20260917-ISSUE854.P02c @requirement:G1,G2 (group 6)', () => {
  beforeEach(() => setupPagerFixture());
  afterEach(() => cleanupPagerFixture());

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
    expect(store.getState().rows).toHaveLength(8);
    expect(store.getState().atVisibilityFloor).toBe(false);
    await store.pageBack();

    const state = store.getState();
    expect(state.atVisibilityFloor).toBe(true);
    const texts = rowTexts(store);
    for (let seq = 1; seq <= 4; seq += 1) {
      expect(texts).toContain(`r-${seq}`);
    }
    expect(texts).toStrictEqual([
      'r-1',
      'r-2',
      'r-3',
      'r-4',
      '[compressed] summary',
      'r-6',
      'r-7',
      'r-8',
      'r-9',
    ]);
    expect(state.rows.map((row) => row.contextState)).toStrictEqual([
      ...Array(4).fill('purged'),
      ...Array(5).fill('in-context'),
    ]);
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
});

describe('ScrollbackPagerStore @plan:PLAN-20260917-ISSUE854.P02c @requirement:G1,G2 (group 7)', () => {
  beforeEach(() => setupPagerFixture());
  afterEach(() => cleanupPagerFixture());

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

  it('keeps identical journal payloads distinct by persisted identity without fallback rows', async () => {
    await fixture.add(userText('same payload', 1));
    await fixture.add(userText('same payload', 2));
    const store = makeStore();
    await store.pageBack();
    const rows = store.getState().rows;
    expect(rowTexts(store)).toStrictEqual(['same payload', 'same payload']);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
    expect(rows.every((row) => row.identity.kind === 'journal')).toBe(true);
    expect('setLiveTail' in store).toBe(false);
  });
});

describe('ScrollbackPagerStore @plan:PLAN-20260917-ISSUE854.P02c @requirement:G1,G2 (group 8)', () => {
  beforeEach(() => setupPagerFixture());
  afterEach(() => cleanupPagerFixture());

  it('evicts an offscreen response instead of pinning a live copy and can page it back', async () => {
    vi.useFakeTimers();
    for (let seq = 1; seq <= 12; seq++) await fixture.addUser(seq);
    await fixture.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'disk-response' }],
      metadata: { chronology: chronology(13) },
    });
    const store = makeStore({
      settings: { marginViewports: 0, byteFloorBytes: 1, purgeDebounceMs: 0 },
    });
    await store.pageBack();
    await store.pageBack();
    viewport.visibleKeys = visibleKeysOfSeqs(store, [9, 10]);
    store.reportViewport();
    store.pageOut('newer');
    vi.advanceTimersByTime(0);
    store.pageOut('older');
    vi.advanceTimersByTime(0);
    expect(rowTexts(store)).not.toContain('disk-response');
    expect(store.metrics().residentRows).toBe(2);
    await store.pageForward();
    expect(rowTexts(store)).toContain('disk-response');
  });
});
