/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import { journalPathOf } from './__tests__/support/journalPathOf.js';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { openJournalReadOnly } from '../../journal/journalReader.js';
import { MUTATION } from '../../journal/recordKinds.js';
import {
  testJournalSeams,
  type Failures,
} from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { IContent } from './IContent.js';
import { JournalDetachedPublication } from './journalDetachedPublication.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

function row(speaker: 'human' | 'ai', text: string, seq: number): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

const OLD = [row('human', 'old one', 1), row('ai', 'old two', 2)];
const NEW = [
  row('human', 'new one', 3),
  row('ai', 'new two', 4),
  row('human', 'new three', 5),
];

function texts(contents: readonly IContent[]): string[] {
  return contents.map((content) =>
    content.blocks.map((b) => (b.type === 'text' ? b.text : '')).join(''),
  );
}

async function trailerOf(file: string) {
  const reader = await openJournalReadOnly(file);
  try {
    return reader.trailer;
  } finally {
    await reader.close();
  }
}

/** Waits until the seams have seen `count` writes, so a gated write is the one in flight. */
async function writesReached(
  seams: ReturnType<typeof testJournalSeams>,
  count: number,
): Promise<void> {
  for (let spin = 0; spin < 1000; spin++) {
    if (seams.events.filter((e) => e.type === 'write').length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`The writer never reached write ${count}`);
}

describe('journal history store publication and compensation', () => {
  const directory = useTempDir('journal-history-publication-');
  const open: JournalHistoryStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.dispose();
  });

  async function created(
    name: string,
    failures: Failures = {},
  ): Promise<{
    store: JournalHistoryStore;
    seams: ReturnType<typeof testJournalSeams>;
  }> {
    const seams = testJournalSeams(failures);
    const session = await JournalSession.create(path.join(directory(), name), {
      journal: seams.dependencies,
    });
    const store = new JournalHistoryStore(session);
    open.push(store);
    return { store, seams };
  }

  async function withOld(name: string, failures: Failures = {}) {
    const made = await created(name, failures);
    for (const content of OLD) made.store.apply({ kind: 'content', content });
    await made.store.waitForDurable();
    return made;
  }

  /** The number of writes the scenario "old rows, then one replacement" makes, to find the replacement's trailer write. */
  async function writesOfReplacement(): Promise<number> {
    const { store, seams } = await withOld('probe.llxj');
    await store.replaceFrom(NEW, NEW.length);
    return seams.events.filter((e) => e.type === 'write').length;
  }

  it('a mutation mark is current until a group is accepted, and a publication scope closes once', async () => {
    const { store } = await created('mark.llxj');
    const mark = store.mutationMark();
    expect(store.isCurrentMutationMark(mark)).toBe(true);
    const scope = store.openPublication();
    scope.close(true);
    scope.close(false);
    expect(store.isCurrentMutationMark(mark)).toBe(true);

    store.apply({ kind: 'content', content: OLD[0] });

    expect(store.isCurrentMutationMark(mark)).toBe(false);
    expect(store.isCurrentMutationMark(store.mutationMark())).toBe(true);
    expect(Array.from(store.capturePublicationOwners())).toStrictEqual([]);
  });

  it('writes a streamed replacement of any size as one group that resolves at its ack', async () => {
    const { store } = await withOld('stream.llxj');
    const before = store.lastAck?.commitSeq ?? 0;
    async function* produced(): AsyncGenerator<IContent> {
      for (let seq = 0; seq < 300; seq++)
        yield row(seq % 2 === 0 ? 'human' : 'ai', `r${seq}`, 10 + seq);
    }

    const ack = await store.replaceFrom(produced(), 300);

    expect(ack.commitSeq).toBe(before + 1);
    expect(store.getLength()).toBe(300);
    const rows = await store.materialize();
    expect(texts(rows).slice(0, 2)).toStrictEqual(['r0', 'r1']);
    expect(rows).toHaveLength(300);
    expect((await trailerOf(journalPathOf(store)))?.mutation).toBe(
      MUTATION.replace,
    );
  });

  it('does not report a replacement durable while the ack of its trailer is held (defect 1)', async () => {
    const total = await writesOfReplacement();
    const { store, seams } = await withOld('held.llxj', {
      gateWriteAt: total - 1,
    });
    const publication = new JournalDetachedPublication(store);
    const publishing = publication.publish(OLD, NEW);
    try {
      await writesReached(seams, total);

      expect(publication.durable).toBe(false);
      expect(publication.lastAck).toBeUndefined();
      expect((await trailerOf(journalPathOf(store)))?.commitSeq).toBe(2);
    } finally {
      // A failed expectation must not leave the write gated, or the store never closes.
      seams.release();
    }

    await publishing;
    expect(publication.durable).toBe(true);
    expect(publication.lastAck?.commitSeq).toBe(3);

    await publication.compensate();
    expect(publication.durable).toBe(false);
    const after = await trailerOf(journalPathOf(store));
    expect(after?.mutation).toBe(MUTATION.restore);
    expect(after?.rootAggregate.rows).toBe(2);
    expect(texts(await store.materialize())).toStrictEqual([
      'old one',
      'old two',
    ]);
  });

  it('opens to the previous version or the full replacement after a cut at every byte offset of the group (defect 1)', async () => {
    const { store } = await withOld('cut.llxj');
    const file = journalPathOf(store);
    const before = new Uint8Array(await fsp.readFile(file));
    await store.replaceFrom(NEW, NEW.length);
    const after = new Uint8Array(await fsp.readFile(file));
    expect(after.length - before.length).toBeGreaterThan(1000);
    const copy = path.join(directory(), 'copy.llxj');
    const seen = new Set<string>();

    for (let cut = before.length; cut <= after.length; cut++) {
      await fsp.writeFile(copy, after.subarray(0, cut));
      const trailer = await trailerOf(copy);
      const shown = `${trailer?.commitSeq}:${trailer?.rootAggregate.rows}`;
      seen.add(shown);
      expect(shown).toBe(cut === after.length ? '3:3' : '2:2');
    }

    expect([...seen].sort()).toStrictEqual(['2:2', '3:3']);
  }, 170_000);

  it('compensate writes nothing when no group was acked since the mark', async () => {
    const { store } = await withOld('nothing.llxj');
    const mark = store.captureCompensation();
    const before = store.lastAck?.commitSeq;

    await store.compensate(mark, undefined);

    expect(store.lastAck?.commitSeq).toBe(before);
    expect(texts(await store.materialize())).toStrictEqual([
      'old one',
      'old two',
    ]);
  });

  it('compensate after a failed group restores the version and lets the store be used again', async () => {
    const { store } = await withOld('failed.llxj');
    const mark = store.captureCompensation();
    const failure = new Error('candidate could not be read');
    const broken: Iterable<IContent> = {
      [Symbol.iterator]: () => {
        throw failure;
      },
    };

    await expect(store.replaceFrom(broken, 3)).rejects.toBe(failure);
    expect(() => store.apply({ kind: 'content', content: NEW[0] })).toThrow(
      failure,
    );
    await store.compensate(mark, failure);

    expect(store.getLength()).toBe(2);
    store.apply({ kind: 'content', content: NEW[0] });
    await store.waitForDurable();
    expect(texts(await store.materialize())).toStrictEqual([
      'old one',
      'old two',
      'new one',
    ]);
  });

  it('compensate keeps a failure the caller does not hold, and resolves the one it holds', async () => {
    const { store } = await withOld('unheld.llxj');
    const mark = store.captureCompensation();
    store.apply({
      kind: 'syntheticInsert',
      payload: { content: row('ai', 'x', 9), chronologySeq: 9, afterSeq: 5 },
    });
    const queued = await store.waitForDurable().then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(queued).toBeInstanceOf(Error);

    await expect(
      store.compensate(mark, new Error('some other failure')),
    ).rejects.toBe(queued);
    await expect(store.waitForDurable()).rejects.toBe(queued);
    expect(() => store.apply({ kind: 'content', content: NEW[0] })).toThrow(
      /anchor/,
    );
    await expect(store.compensate(mark, undefined)).rejects.toBe(queued);

    await store.compensate(mark, queued);

    expect(store.getLength()).toBe(2);
    store.apply({ kind: 'content', content: NEW[0] });
    await store.waitForDurable();
    expect(texts(await store.materialize())).toStrictEqual([
      'old one',
      'old two',
      'new one',
    ]);
  });

  it('a publication whose group failed compensates that failure and leaves the store usable', async () => {
    const { store } = await withOld('publication-failed.llxj');
    const publication = new JournalDetachedPublication(store);
    const failure = new Error('candidate could not be read');
    const broken = Object.assign([NEW[0], NEW[1], NEW[2]], {
      [Symbol.iterator]: (): Iterator<IContent> => {
        throw failure;
      },
    });

    await expect(publication.publish(OLD, broken)).rejects.toBe(failure);
    await publication.compensate();

    expect(store.getLength()).toBe(2);
    store.apply({ kind: 'content', content: NEW[0] });
    await store.waitForDurable();
    expect(texts(await store.materialize())).toHaveLength(3);
  });

  it('refuses a mark that another store captured', async () => {
    const first = await created('first.llxj');
    const second = await created('second.llxj');

    await expect(
      second.store.compensate(first.store.captureCompensation(), undefined),
    ).rejects.toThrow('not captured by this store');
  });

  it('does not start a replacement when the signal is already aborted', async () => {
    const { store } = await withOld('aborted.llxj');
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(
      store.replaceFrom(NEW, NEW.length, controller.signal),
    ).rejects.toThrow('cancelled');
    expect(store.getLength()).toBe(2);
    expect((await trailerOf(journalPathOf(store)))?.commitSeq).toBe(2);
  });

  describe('detached publication shapes', () => {
    it('writes nothing for rows that did not change', async () => {
      const { store } = await withOld('unchanged.llxj');
      const publication = new JournalDetachedPublication(store);

      await publication.publish(OLD, [...OLD]);

      expect(publication.admittedCount).toBe(0);
      expect((await trailerOf(journalPathOf(store)))?.commitSeq).toBe(2);
    });

    it('cuts a dropped tail with one rewind and an emptied history with one rewind', async () => {
      const { store } = await withOld('cut-shape.llxj');
      const publication = new JournalDetachedPublication(store);

      await publication.publish(OLD, OLD.slice(0, 1));
      expect((await trailerOf(journalPathOf(store)))?.mutation).toBe(
        MUTATION.pop,
      );
      await publication.publish(OLD.slice(0, 1), []);

      expect(publication.admittedCount).toBe(2);
      expect(await store.materialize()).toStrictEqual([]);
      await publication.compensate();
      expect(texts(await store.materialize())).toStrictEqual([
        'old one',
        'old two',
      ]);
    });

    it('appends only the rows past the previous length when asked to append', async () => {
      const { store } = await withOld('append-shape.llxj');
      const publication = new JournalDetachedPublication(store);

      await publication.publish(OLD, [...OLD, ...NEW], undefined, true);

      expect(publication.admittedCount).toBe(3);
      expect(texts(await store.materialize())).toStrictEqual([
        'old one',
        'old two',
        'new one',
        'new two',
        'new three',
      ]);
      await publication.compensate();
      expect(texts(await store.materialize())).toStrictEqual([
        'old one',
        'old two',
      ]);
    });
  });
});
