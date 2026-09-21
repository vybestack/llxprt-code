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
 * @plan PLAN-20260917-ISSUE854.P04
 * @requirement G1
 *
 * RED suite for bounded resume viewport projection (implementation-plan.md
 * §5 P04b): resident-after-resume is the LAST PAGE of the physical timeline
 * plus scalars (floor/tail offsets, seq watermarks) — never all
 * context-range items. The tests pin a store-level seeding API
 * (`resumeFromJournal`) that the green session adds to ScrollbackPagerStore:
 * open the cursor, seed resident = last page under the store's own
 * pageRows budget, record floor/tail offsets and seq watermarks, and leave
 * older context rows unmaterialized until pageBack pulls them on demand.
 *
 * Equivalence references: `replaySession` (ReplayEngine) over the same
 * journal, and an eager full-parse of the fixture lines (the convention the
 * P02c suite uses). Both references read the same envelopes the pager
 * reads, so text/seq equality is exact — fixture rows are compared verbatim,
 * no label normalization.
 *
 * Every test below currently fails on the missing store API only; the
 * `as ResumableScrollbackPagerStore` cast is the single intentional seam
 * marking the contract the green session implements.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core';
import { replaySession } from '@vybestack/llxprt-code-core';
import {
  createScrollbackPagerStore,
  type ScrollbackPagerStore,
  type ScrollbackViewportReporter,
} from './scrollbackPager.js';

const TS = '2026-01-01T00:00:00.000Z';
const PROJECT_HASH = 'p04b-resume-hash';

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
  add(line: string): Promise<number>;
  addSessionStart(): Promise<number>;
  addUser(seq: number): Promise<number>;
  addAi(seq: number): Promise<number>;
  addRewind(seq: number, itemsRemoved: number, cutSeq: number): Promise<number>;
}

function chronology(seq: number) {
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

function envelope(seq: number, type: string, payload: unknown): string {
  return JSON.stringify({ v: 1, seq, ts: TS, type, payload });
}

async function useResumeJournalFixture(): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scrollback-resume-'));
  const filePath = path.join(dir, 'session-under-resume.jsonl');
  let offset = 0;
  const fixture: Fixture = {
    filePath,
    async add(line: string): Promise<number> {
      const at = offset;
      await fs.appendFile(filePath, `${line}\n`, 'utf8');
      offset += Buffer.byteLength(line, 'utf8') + 1;
      return at;
    },
    async addSessionStart(): Promise<number> {
      return fixture.add(
        envelope(0, 'session_start', {
          sessionId: 'resume-fixture-session',
          projectHash: PROJECT_HASH,
          provider: 'fixture',
          model: 'fixture-model',
          workspaceDirs: [dir],
          startTime: TS,
        }),
      );
    },
    async addUser(seq: number): Promise<number> {
      const pad = 'x'.repeat(ROW_PAD_CHARS);
      return fixture.add(
        envelope(seq, 'content', {
          content: contentOf('human', `r-${seq}${pad}`, seq),
        }),
      );
    },
    async addAi(seq: number): Promise<number> {
      const pad = 'x'.repeat(ROW_PAD_CHARS);
      return fixture.add(
        envelope(seq, 'content', {
          content: contentOf('ai', `r-${seq}${pad}`, seq),
        }),
      );
    },
    async addRewind(
      seq: number,
      itemsRemoved: number,
      cutSeq: number,
    ): Promise<number> {
      return fixture.add(envelope(seq, 'rewind', { itemsRemoved, cutSeq }));
    },
  };
  return fixture;
}

interface RowLabel {
  readonly seq: number;
  readonly text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Label of a content envelope payload, or null when it is not content. */
function contentLabel(payload: unknown): RowLabel | null {
  if (!isRecord(payload)) return null;
  const content = payload['content'];
  if (!isRecord(content)) return null;
  const speaker = content['speaker'];
  if (speaker !== 'human' && speaker !== 'ai' && speaker !== 'tool') {
    return null;
  }
  if (!Array.isArray(content['blocks'])) return null;
  const metadata = content['metadata'];
  const chronologyMeta =
    isRecord(metadata) && isRecord(metadata['chronology'])
      ? metadata['chronology']
      : null;
  const seq =
    chronologyMeta !== null && typeof chronologyMeta['seq'] === 'number'
      ? chronologyMeta['seq']
      : Number.NaN;
  const texts: string[] = [];
  for (const block of content['blocks']) {
    if (
      isRecord(block) &&
      block['type'] === 'text' &&
      typeof block['text'] === 'string'
    ) {
      texts.push(block['text']);
    }
  }
  return { seq, text: texts.join('\n') };
}

/**
 * Eager full-parse reference: every content row in file order. A
 * crash-torn tail line does not parse and is skipped, matching what the
 * cursor's line-end limit hides from the pager.
 */
function parseEnvelopeLine(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function eagerReference(filePath: string): Promise<RowLabel[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const labels: RowLabel[] = [];
  for (const line of raw.split('\n')) {
    const parsed = line.trim() === '' ? null : parseEnvelopeLine(line);
    if (parsed !== null && parsed['type'] === 'content') {
      const label = contentLabel(parsed['payload']);
      if (label !== null) labels.push(label);
    }
  }
  return labels;
}

/** ReplayEngine reference: conversation rows exactly as resume replays them. */
async function replayReference(filePath: string): Promise<RowLabel[]> {
  const result = await replaySession(filePath, PROJECT_HASH);
  if (!result.ok) {
    throw new Error(`fixture replay failed: ${result.error}`);
  }
  const labels: RowLabel[] = [];
  for (const content of result.history) {
    const texts: string[] = [];
    for (const block of content.blocks) {
      if (block.type === 'text') texts.push(block.text);
    }
    labels.push({
      seq: content.metadata?.chronology?.seq ?? Number.NaN,
      text: texts.join('\n'),
    });
  }
  return labels;
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
    }) as ResumableScrollbackPagerStore;
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

  it('resume equivalence vs ReplayEngine: pageBack-to-floor walk reproduces the replayed conversation', async () => {
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
      await replayReference(fixture.filePath),
    );
  });

  it('resume equivalence vs eager full parse: multi-page walk over a 30-row journal matches line-for-line', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 30; seq += 1) {
      await fixture.addUser(seq);
    }
    const { store } = await makeResumedStore({ pageRows: 7 });
    await walkToFloor(store);
    expect(store.getState().atVisibilityFloor).toBe(true);

    const walked = journalRowLabels(store);
    expect(walked).toStrictEqual(await eagerReference(fixture.filePath));
    expect(walked).toStrictEqual(await replayReference(fixture.filePath));
    expect(walked.map((row) => row.seq)).toStrictEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });

  it('resume equivalence honors the clear boundary: the resumed walk equals the post-rewind replay tail', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 4; seq += 1) {
      await fixture.addUser(seq);
    }
    await fixture.addRewind(5, 2, 3);
    for (let seq = 6; seq <= 9; seq += 1) {
      await fixture.addUser(seq);
    }
    const { store } = await makeResumedStore({ pageRows: 4 });
    await walkToFloor(store);

    const walked = journalRowLabels(store);
    expect(walked.map((row) => row.seq)).toStrictEqual([6, 7, 8, 9]);

    // The engine cuts at the rewind's cutSeq (3) and keeps pre-boundary
    // rows 1-2 in model history; the pager's visibility floor drops
    // everything older than the boundary, so the shared equivalence domain
    // is seq >= 6 — the first fixture row recorded after the boundary.
    const postBoundary = (await replayReference(fixture.filePath)).filter(
      (row) => row.seq >= 6,
    );
    expect(walked).toStrictEqual(postBoundary);
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

  it('floor offset after resume is the newest clear boundary', async () => {
    await fixture.addSessionStart();
    for (let seq = 1; seq <= 4; seq += 1) {
      await fixture.addUser(seq);
    }
    const rewindOffset = await fixture.addRewind(5, 2, 3);
    for (let seq = 6; seq <= 9; seq += 1) {
      await fixture.addUser(seq);
    }

    const { store, summary } = await makeResumedStore({ pageRows: 4 });
    expect(summary.floorOffset).toBe(rewindOffset);
    expect(summary.atClearBoundary).toBe(true);
    expect(store.getState().atVisibilityFloor).toBe(true);
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

  it('resume on a zero-byte journal seeds nothing and floors at byte 0', async () => {
    await fs.writeFile(fixture.filePath, '', 'utf8');

    const { store, summary } = await makeResumedStore({ pageRows: 4 });
    expect(summary.seededRows).toBe(0);
    expect(summary.headSeq).toBeNull();
    expect(summary.tailSeq).toBeNull();
    expect(summary.floorOffset).toBe(0);
    expect(summary.tailOffset).toBe(0);
    const state = store.getState();
    expect(state.rows).toHaveLength(0);
    expect(state.atVisibilityFloor).toBe(true);
    expect(state.atFileEnd).toBe(true);
  });
});
