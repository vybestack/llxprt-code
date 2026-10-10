/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * DetachedHistoryPublication.publish chooses what to record from the shape of
 * the replacement: nothing for a value-identical rebuild, one rewind for a
 * strict prefix, compressionDetail + compressed for a one-summary replacement
 * of an all-marked journal, and a full rewind plus content otherwise. In every
 * case replaying the recording with the replay engine must reproduce exactly
 * the history that was published.
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdmissionFailureRecorder } from './chronology-rollback-test-helpers.js';
import { replaySession } from '../../recording/ReplayEngine.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import { DetachedHistoryPublication } from './detachedHistoryPublication.js';
import { detachedRow } from './detached-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

const PROJECT = 'publication-shapes';

interface Outcome {
  readonly recordedTypes: string[];
  readonly rewinds: Array<Record<string, unknown>>;
  readonly replayed: IContent[];
  readonly failure?: unknown;
}

/** Journals and scratch directory of the publish under test; released by the caller. */
interface Scratch {
  readonly root: string;
  readonly journals: DetachedHistoryJournal[];
}

function detached(
  scratch: Scratch,
  rows: readonly IContent[],
): DetachedHistoryJournal {
  const journal = new DetachedHistoryJournal();
  scratch.journals.push(journal);
  for (const row of rows) journal.append(structuredClone(row));
  return journal;
}

function marked(count: number, from = 0): IContent[] {
  return Array.from({ length: count }, (_, i) => detachedRow(from + i, 16));
}

function unmarked(text: string, speaker: IContent['speaker']): IContent {
  // Replay materializes absent metadata as {}, so rows carry it explicitly.
  return { speaker, blocks: [{ type: 'text', text }], metadata: {} };
}

function lines(path: string): Array<{ type: string; payload: unknown }> {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
}

/**
 * Seeds the recording with `previous`, publishes `next` over it, then replays
 * the file. `failAfter` makes the recorder reject the Nth admission of the
 * publish step.
 */
async function publishAndReplay(
  previous: readonly IContent[],
  next: readonly IContent[],
  failAfter?: number,
): Promise<Outcome> {
  const scratch: Scratch = {
    root: mkdtempSync(join(tmpdir(), 'publication-shapes-')),
    journals: [],
  };
  const root = scratch.root;
  const recorder = new AdmissionFailureRecorder({
    sessionId: 'shapes',
    projectHash: PROJECT,
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  const owners = new RowOwnership();
  const store = new HistoryJournalStore(recorder, {
    ...createRowCounters().counters,
    ownership: owners,
  });
  try {
    for (const content of previous)
      store.apply({ kind: 'content', content: structuredClone(content) });
    await store.waitForDurable();
    await recorder.flush();
    const path = recorder.getFilePath();
    if (path === null) throw new Error('Seeding did not create a recording');
    const seeded = lines(path).length;

    const publication = new DetachedHistoryPublication(store, owners);
    let failure: unknown;
    if (failAfter !== undefined) recorder.failAdmissionAfter(failAfter);
    const previousJournal = detached(scratch, previous);
    const nextJournal = detached(scratch, next);
    try {
      await publication.publish(previousJournal, nextJournal);
    } catch (error) {
      failure = error;
      // The mutation owner compensates only when something was admitted.
      if (publication.admittedCount > 0)
        await publication.compensate(previousJournal, nextJournal);
    }
    publication.close();
    await store.waitForDurable();
    await recorder.flush();

    const published = lines(path).slice(seeded);
    const replay = await replaySession(path, PROJECT);
    if (!replay.ok) throw new Error(`Replay failed: ${replay.error}`);
    return {
      recordedTypes: published.map((line) => line.type),
      rewinds: published
        .filter((line) => line.type === 'rewind')
        .map((line) => line.payload as Record<string, unknown>),
      replayed: replay.history,
      ...(failure === undefined ? {} : { failure }),
    };
  } finally {
    store.dispose();
    await recorder.dispose();
    for (const journal of scratch.journals) journal.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function expectReplayEquals(outcome: Outcome, expected: readonly IContent[]) {
  expect(outcome.replayed).toHaveLength(expected.length);
  expected.forEach((row, index) =>
    expect(outcome.replayed[index]).toStrictEqual(row),
  );
}

describe('DetachedHistoryPublication.publish shape detection', () => {
  it('records nothing for a value-identical rebuild', async () => {
    const rows = marked(4);
    const outcome = await publishAndReplay(rows, rows);
    expect(outcome.recordedTypes).toStrictEqual([]);
    expectReplayEquals(outcome, rows);
  });

  it('records one rewind for a strict deep-equal prefix', async () => {
    const rows = marked(5);
    const kept = rows.slice(0, 3);
    const outcome = await publishAndReplay(rows, kept);
    expect(outcome.recordedTypes).toStrictEqual(['rewind']);
    expect(outcome.rewinds[0]).toMatchObject({ itemsRemoved: 2, cutSeq: 4 });
    expectReplayEquals(outcome, kept);
  });

  it('records compressionDetail and compressed for a one-summary replacement of an all-marked journal', async () => {
    const rows = marked(4);
    const summary = unmarked('<state_snapshot>kept</state_snapshot>', 'human');
    const outcome = await publishAndReplay(rows, [summary]);
    expect(outcome.recordedTypes).toStrictEqual([
      'compression_detail',
      'compressed',
    ]);
    expectReplayEquals(outcome, [summary]);
  });

  it('records a full rewind plus content for anything else', async () => {
    const rows = marked(3);
    const replacement = [
      unmarked('a different first row', 'human'),
      ...rows.slice(1),
    ];
    const outcome = await publishAndReplay(rows, replacement);
    expect(outcome.recordedTypes).toStrictEqual([
      'rewind',
      'content',
      'content',
      'content',
    ]);
    expect(outcome.rewinds[0]).toMatchObject({ itemsRemoved: 3 });
    expectReplayEquals(outcome, replacement);
  });
});

describe('DetachedHistoryPublication.publish edge cases', () => {
  it('treats equal length with one differing row as a full replacement, not a prefix', async () => {
    const rows = marked(4);
    const replacement = rows.map((row, index) =>
      index === 2 ? unmarked('changed row', 'ai') : row,
    );
    const outcome = await publishAndReplay(rows, replacement);
    expect(outcome.recordedTypes[0]).toBe('rewind');
    expect(outcome.rewinds[0]).toMatchObject({ itemsRemoved: 4 });
    expect(outcome.recordedTypes.filter((t) => t === 'content')).toHaveLength(
      4,
    );
    expectReplayEquals(outcome, replacement);
  });

  it('replays an empty replacement as an empty history', async () => {
    const outcome = await publishAndReplay(marked(3), []);
    expect(outcome.recordedTypes).toStrictEqual(['rewind']);
    expectReplayEquals(outcome, []);
  });

  it('treats a prefix that differs only in chronology metadata as a full replacement', async () => {
    const rows = marked(4);
    const kept = rows.slice(0, 2).map((row, index) =>
      index === 1
        ? {
            ...row,
            metadata: {
              ...row.metadata,
              chronology: { ...row.metadata?.chronology, seq: 99 },
            },
          }
        : row,
    ) as IContent[];
    const outcome = await publishAndReplay(rows, kept);
    expect(outcome.recordedTypes).toStrictEqual([
      'rewind',
      'content',
      'content',
    ]);
    expect(outcome.rewinds[0]).toMatchObject({ itemsRemoved: 4 });
    expectReplayEquals(outcome, kept);
  });

  it('keeps media rows in a strict prefix through a single rewind', async () => {
    const media: IContent = {
      ...detachedRow(1, 16),
      blocks: [
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'aGVsbG8=',
          caption: 'kept picture',
        },
      ],
    };
    const rows = [detachedRow(0, 16), media, detachedRow(2, 16)];
    const kept = rows.slice(0, 2);
    const outcome = await publishAndReplay(rows, kept);
    expect(outcome.recordedTypes).toStrictEqual(['rewind']);
    expectReplayEquals(outcome, kept);
  });

  it('records a one-summary replacement as a full replacement when not every row is marked', async () => {
    const rows = [...marked(2), unmarked('no chronology marker', 'ai')];
    const summary = unmarked('<state_snapshot>kept</state_snapshot>', 'human');
    const outcome = await publishAndReplay(rows, [summary]);
    expect(outcome.recordedTypes).toStrictEqual(['rewind', 'content']);
    expect(outcome.rewinds[0]).toMatchObject({ itemsRemoved: 3 });
    expectReplayEquals(outcome, [summary]);
  });
});

describe('DetachedHistoryPublication.publish failure', () => {
  const failure = 'injected journal admission failure';
  const replacement = [
    unmarked('x', 'human'),
    unmarked('y', 'ai'),
    unmarked('z', 'human'),
  ];

  it('writes nothing when the first admission of a full replacement fails', async () => {
    const rows = marked(3);
    const outcome = await publishAndReplay(rows, replacement, 0);
    expect((outcome.failure as Error).message).toContain(failure);
    expect(outcome.recordedTypes).toStrictEqual([]);
    expectReplayEquals(outcome, rows);
  });

  it('restores the previous history when a full replacement fails midway', async () => {
    const rows = marked(3);
    const outcome = await publishAndReplay(rows, replacement, 2);
    expect((outcome.failure as Error).message).toContain(failure);
    expect(outcome.recordedTypes.length).toBeGreaterThan(2);
    expectReplayEquals(outcome, rows);
  });

  it('restores the previous history when the compressed event fails after its detail', async () => {
    const rows = marked(4);
    const summary = unmarked('<state_snapshot>kept</state_snapshot>', 'human');
    const outcome = await publishAndReplay(rows, [summary], 1);
    expect((outcome.failure as Error).message).toContain(failure);
    expectReplayEquals(outcome, rows);
  });

  it('writes nothing when the single rewind of a prefix fails', async () => {
    const rows = marked(4);
    const outcome = await publishAndReplay(rows, rows.slice(0, 2), 0);
    expect((outcome.failure as Error).message).toContain(failure);
    expect(outcome.recordedTypes).toStrictEqual([]);
    expectReplayEquals(outcome, rows);
  });
});
