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

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';

import {
  createScrollbackPagerStore,
  type ScrollbackPagerStore,
  type ScrollbackViewportReporter,
} from './scrollbackPager.js';

/**
 * Uniform row size, matching the P02c fixture: text is padded so rows have
 * realistic serialized bulk without influencing any assertion here.
 */
const ROW_PAD_CHARS = 60;

/**
 * P04b assumed API contract (green session implements it in
 * scrollbackPager.ts). `resumeFromJournal()` uses the store's own filePath,
 * pageRows budget, and settings; it returns the resume scalars.
 */
interface ScrollbackResumeSummary {
  /** Display rows seeded into the resident window (journal-backed only). */
  readonly seededRows: number;
  /**
   * Backward head after seeding: the start offset of the newest clear
   * (rewind) boundary line, or the file data start (0) when no boundary
   * exists.
   */
  readonly floorOffset: number;
  /**
   * Forward head after seeding: the byte offset just past the last complete
   * line — the journal data end. A crash-torn tail beyond it is excluded.
   */
  readonly tailOffset: number;
  /** Lowest seq among resident rows; null when nothing was seeded. */
  readonly headSeq: number | null;
  /** Highest seq observed while seeding; null when nothing was seeded. */
  readonly tailSeq: number | null;
  /** True when the floor is a clear boundary rather than the file start. */
  readonly atClearBoundary: boolean;
}

type ResumableScrollbackPagerStore = ScrollbackPagerStore & {
  resumeFromJournal(): Promise<ScrollbackResumeSummary>;
};

class FakeViewport implements ScrollbackViewportReporter {
  visibleKeys: readonly string[] = [];
  viewportLines = 2;

  rowHeightLines(): number {
    return 1;
  }
}

interface Fixture {
  filePath: string;
  addSessionStart(): Promise<number>;
  addUser(seq: number): Promise<number>;
  addAi(seq: number): Promise<number>;
  popRows(itemsRemoved: number): Promise<void>;
}

function chronology(
  seq: number,
): NonNullable<NonNullable<IContent['metadata']>['chronology']> {
  return { seq, userTurn: 1, step: 1, recordedAt: 0 };
}

function contentOf(
  speaker: IContent['speaker'],
  text: string,
  seq: number,
): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata: { chronology: chronology(seq) },
  };
}

async function useResumeJournalFixture(): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrollback-resume-'));
  const filePath = path.join(dir, 'session-under-resume.llxj');
  const created = await JournalSession.create(filePath);
  await created.close();
  async function append(
    speaker: IContent['speaker'],
    seq: number,
  ): Promise<number> {
    const session = await JournalSession.open(filePath);
    try {
      await session.append([
        contentOf(speaker, 'r-' + seq + 'x'.repeat(ROW_PAD_CHARS), seq),
      ]);
      for await (const entry of session.store.rows(
        (session.store.published?.rows ?? 1) - 1,
      ))
        return entry.recordOffset;
      throw new Error('Missing appended native row');
    } finally {
      await session.close();
    }
  }
  return {
    filePath,
    async addSessionStart(): Promise<number> {
      const session = await JournalSession.open(filePath);
      try {
        const ack = await session.store.commit([
          {
            kind: 'setState',
            key: 'session:id',
            value: new TextEncoder().encode(
              JSON.stringify('resume-fixture-session'),
            ),
          },
        ]);
        return ack.durableEnd;
      } finally {
        await session.close();
      }
    },
    addUser: (seq) => append('human', seq),
    addAi: (seq) => append('ai', seq),
    async popRows(itemsRemoved: number): Promise<void> {
      const session = await JournalSession.open(filePath);
      try {
        const remaining = (session.store.published?.rows ?? 0) - itemsRemoved;
        if (remaining === 0) await session.store.commit([{ kind: 'clear' }]);
        else {
          for await (const cut of session.store.rows(remaining)) {
            await session.store.commit([
              {
                kind: 'pop',
                cutLabel: cut.label,
                expectedRemoved: itemsRemoved,
              },
            ]);
            break;
          }
        }
      } finally {
        await session.close();
      }
    },
  };
}

interface RowLabel {
  readonly seq: number;
  readonly text: string;
}

async function nativeReference(filePath: string): Promise<RowLabel[]> {
  const session = await JournalSession.open(filePath);
  try {
    const labels: RowLabel[] = [];
    for await (const { content } of session.rows()) {
      labels.push({
        seq: content.metadata?.chronology?.seq ?? Number.NaN,
        text: content.blocks
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n'),
      });
    }
    return labels;
  } finally {
    await session.close();
  }
}

describe('ScrollbackPagerStore resume seeding @plan:PLAN-20260917-ISSUE854.P04 @requirement:G1', () => {
  let fixture: Fixture;
  let viewport: FakeViewport;
  let stores: ScrollbackPagerStore[];

  beforeEach(async () => {
    fixture = await useResumeJournalFixture();
    viewport = new FakeViewport();
    stores = [];
  });

  afterEach(async () => {
    for (const store of stores.splice(0)) {
      await store.close().catch(() => undefined);
    }
    await fs.rm(path.dirname(fixture.filePath), {
      recursive: true,
      force: true,
    });
  });

  async function makeResumedStore(
    overrides: Partial<Parameters<typeof createScrollbackPagerStore>[0]> = {},
  ): Promise<{
    store: ResumableScrollbackPagerStore;
    summary: ScrollbackResumeSummary;
  }> {
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
    const summary = await store.resumeFromJournal();
    return { store, summary };
  }

  /** Journal-backed resident rows oldest first, as seq+text labels. */
  function journalRowLabels(store: ScrollbackPagerStore): RowLabel[] {
    return store
      .getState()
      .rows.filter((row) => row.offset !== null)
      .map((row) => ({
        seq: row.seq ?? Number.NaN,
        text: row.item.text ?? '',
      }));
  }

  /** Pages back until the visibility floor, with a loop guard. */
  async function walkToFloor(store: ScrollbackPagerStore): Promise<void> {
    for (let i = 0; i < 64; i += 1) {
      if (store.getState().atVisibilityFloor) return;
      await store.pageBack();
    }
  }

  it('seeds exactly the last page resident when the journal exceeds the viewport budget', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 50; seq += 1) {
      await fixture.addUser(seq);
    }
    const { store, summary } = await makeResumedStore({ pageRows: 10 });

    const rows = store.getState().rows;
    expect(summary.seededRows).toBe(10);
    expect(rows).toHaveLength(10);
    expect(rows.map((row) => row.seq)).toStrictEqual([
      41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
    ]);
    expect(store.getState().atFileEnd).toBe(true);
    expect(store.getState().atVisibilityFloor).toBe(false);
    expect(store.getState().error).toBeNull();
    const keys = rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('resume equivalence vs native rows: pageBack-to-floor walk reproduces the replayed conversation', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 12; seq += 1) {
      if (seq === 4 || seq === 9) {
        await fixture.addAi(seq);
      } else {
        await fixture.addUser(seq);
      }
    }
    const { store } = await makeResumedStore({ pageRows: 4 });
    await walkToFloor(store);
    expect(store.getState().atVisibilityFloor).toBe(true);

    expect(journalRowLabels(store)).toStrictEqual(
      await nativeReference(fixture.filePath),
    );
  });

  it('resume equivalence vs native row tree: multi-page walk over a 30-row journal matches row-for-row', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 30; seq += 1) {
      await fixture.addUser(seq);
    }
    const { store } = await makeResumedStore({ pageRows: 7 });
    await walkToFloor(store);
    expect(store.getState().atVisibilityFloor).toBe(true);

    const walked = journalRowLabels(store);
    expect(walked).toStrictEqual(await nativeReference(fixture.filePath));
    expect(walked).toStrictEqual(
      Array.from({ length: 30 }, (_, index) => ({
        seq: index + 1,
        text: `r-${index + 1}${'x'.repeat(ROW_PAD_CHARS)}`,
      })),
    );
    expect(walked.map((row) => row.seq)).toStrictEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });

  it('resume preserves the transcript while marking rewound rows out of context', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 4; seq += 1) {
      await fixture.addUser(seq);
    }
    await fixture.popRows(2);
    for (let seq = 6; seq <= 9; seq += 1) {
      await fixture.addUser(seq);
    }
    const { store } = await makeResumedStore({ pageRows: 4 });
    await walkToFloor(store);

    const walked = journalRowLabels(store);
    expect(walked.map((row) => row.seq)).toStrictEqual([
      1, 2, 3, 4, 0, 6, 7, 8, 9,
    ]);
    expect(store.getState().rows.map((row) => row.contextState)).toStrictEqual([
      'in-context',
      'in-context',
      'purged',
      'purged',
      'purged',
      'in-context',
      'in-context',
      'in-context',
      'in-context',
    ]);
    expect(
      journalRowLabels(store).filter(
        (_, index) =>
          store.getState().rows[index]?.contextState === 'in-context',
      ),
    ).toStrictEqual(await nativeReference(fixture.filePath));
  });

  it('pageBack after resume yields only rows older than the seeded page', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 12; seq += 1) {
      await fixture.addUser(seq);
    }
    const { store } = await makeResumedStore({ pageRows: 4 });

    const before = store.getState().rows;
    expect(before.map((row) => row.seq)).toStrictEqual([9, 10, 11, 12]);
    const beforeKeys = new Set(before.map((row) => row.key));

    await store.pageBack();

    const after = store.getState().rows;
    expect(after.map((row) => row.seq)).toStrictEqual([
      5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    const added = after.filter((row) => !beforeKeys.has(row.key));
    expect(added.map((row) => row.seq)).toStrictEqual([5, 6, 7, 8]);
    const keys = after.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('repeated pageBack after resume reaches the floor and pageForward returns without duplication', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 20; seq += 1) {
      await fixture.addUser(seq);
    }
    const { store } = await makeResumedStore({ pageRows: 4 });

    for (let i = 0; i < 4; i += 1) {
      await store.pageBack();
    }
    expect(store.getState().atVisibilityFloor).toBe(true);
    expect(store.getState().rows.map((row) => row.seq)).toStrictEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );

    await store.pageBack();
    expect(store.getState().rows).toHaveLength(20);
    expect(store.getState().loadingOlder).toBe(false);

    const keysBefore = store.getState().rows.map((row) => row.key);
    await store.pageForward();
    expect(store.getState().rows.map((row) => row.key)).toStrictEqual(
      keysBefore,
    );
    expect(store.getState().atFileEnd).toBe(true);
  });

  it('tail offset after resume equals the journal data end and excludes a torn tail', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 6; seq += 1) {
      await fixture.addUser(seq);
    }
    const completeSize = (await fs.stat(fixture.filePath)).size;
    await fs.appendFile(
      fixture.filePath,
      '{"v":1,"seq":99,"ts":"2026-01-0',
      'utf8',
    );
    const tornSize = (await fs.stat(fixture.filePath)).size;
    expect(tornSize).toBeGreaterThan(completeSize);

    const { store, summary } = await makeResumedStore({ pageRows: 4 });
    expect(summary.tailOffset).toBe(completeSize);
    const seqs = store
      .getState()
      .rows.map((row) => row.seq)
      .filter((seq) => seq !== null);
    expect(seqs[seqs.length - 1]).toBe(6);
  });

  it('a native full clear seeds successors and leaves earlier transcript rows pageable', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 4; seq += 1) {
      await fixture.addUser(seq);
    }
    await fixture.popRows(4);
    for (let seq = 6; seq <= 9; seq += 1) {
      await fixture.addUser(seq);
    }

    const { store, summary } = await makeResumedStore({ pageRows: 4 });
    expect(summary.floorOffset).toBe(0);
    expect(store.getState().rows.map((row) => row.seq)).toStrictEqual([
      6, 7, 8, 9,
    ]);
    expect(summary.atClearBoundary).toBe(false);
    expect(store.getState().atVisibilityFloor).toBe(false);
    await walkToFloor(store);
    expect(store.getState().rows.map((row) => row.seq)).toStrictEqual([
      1, 2, 3, 4, 0, 6, 7, 8, 9,
    ]);
    expect(store.getState().rows.map((row) => row.contextState)).toStrictEqual([
      ...Array(5).fill('purged'),
      ...Array(4).fill('in-context'),
    ]);
    expect(store.getState().atVisibilityFloor).toBe(true);
  });

  it('a suffix rewind leaves the file start as the floor', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 4; seq += 1) {
      await fixture.addUser(seq);
    }
    await fixture.popRows(2);

    const { summary } = await makeResumedStore({ pageRows: 4 });
    expect(summary.floorOffset).toBe(0);
    expect(summary.atClearBoundary).toBe(false);
  });

  it('floor offset after resume on a boundary-free journal is the file start', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 3; seq += 1) {
      await fixture.addUser(seq);
    }

    const { store, summary } = await makeResumedStore({ pageRows: 4 });
    expect(summary.floorOffset).toBe(0);
    expect(summary.atClearBoundary).toBe(false);
    expect(store.getState().atVisibilityFloor).toBe(true);
  });

  it('seq watermarks after resume bracket the resident window', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 10; seq += 1) {
      await fixture.addUser(seq);
    }

    const { store, summary } = await makeResumedStore({ pageRows: 4 });
    expect(summary.seededRows).toBe(4);
    expect(summary.headSeq).toBe(7);
    expect(summary.tailSeq).toBe(10);
    const seqs = store
      .getState()
      .rows.map((row) => row.seq)
      .filter((seq) => seq !== null);
    expect(summary.headSeq).toBe(Math.min(...seqs));
    expect(summary.tailSeq).toBe(Math.max(...seqs));
  });

  it('resume on a header-only journal seeds nothing and floors at the file start', async () => {
    await fixture.addSessionStart();
    const size = (await fs.stat(fixture.filePath)).size;

    const { store, summary } = await makeResumedStore({ pageRows: 4 });
    expect(summary.seededRows).toBe(0);
    expect(summary.headSeq).toBeNull();
    expect(summary.tailSeq).toBeNull();
    expect(summary.floorOffset).toBe(0);
    expect(summary.tailOffset).toBe(size);
    expect(summary.atClearBoundary).toBe(false);
    const state = store.getState();
    expect(state.rows).toHaveLength(0);
    expect(state.atVisibilityFloor).toBe(true);
    expect(state.atFileEnd).toBe(true);
    expect(state.error).toBeNull();
  });

  it('resume on an empty native journal seeds nothing and floors at byte 0', async () => {
    const { store, summary } = await makeResumedStore({ pageRows: 4 });
    expect(summary.seededRows).toBe(0);
    expect(summary.headSeq).toBeNull();
    expect(summary.tailSeq).toBeNull();
    expect(summary.floorOffset).toBe(0);
    expect(summary.tailOffset).toBe((await fs.stat(fixture.filePath)).size);
    const state = store.getState();
    expect(state.rows).toHaveLength(0);
    expect(state.atVisibilityFloor).toBe(true);
    expect(state.atFileEnd).toBe(true);
  });
});
