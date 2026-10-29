/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { JournalSession } from '../services/history/journalSession.js';
import {
  decodeStoredRow,
  encodeContentRow,
} from '../services/history/journalRowCodec.js';
import type { IContent } from '../services/history/IContent.js';
import type { DensityFilePolicy } from './density-file-facts.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

function row(key: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text: key }] };
}
function policy(
  revision: string,
  observe: () => void = () => {},
): DensityFilePolicy {
  return {
    revision,
    async *occurrences(snapshot, entry) {
      observe();
      const content = decodeStoredRow(await snapshot.readRow(entry));
      for (const [block, value] of content.blocks.entries()) {
        if (value.type === 'text') yield { key: value.text, block, start: 0 };
      }
    },
  };
}
async function latest(
  snapshot: VersionSnapshot,
  revision: string,
  key = 'a',
): Promise<readonly number[] | undefined> {
  return (await snapshot.densityFiles(revision)).latest(key);
}
async function current(
  session: JournalSession,
  revision: string,
  key = 'a',
): Promise<readonly number[] | undefined> {
  const snapshot = await session.store.snapshot();
  try {
    return await latest(snapshot, revision, key);
  } finally {
    await snapshot.close();
  }
}

async function checkCloneAppend(session: JournalSession): Promise<void> {
  const clone = await session.cloneUnlinked();
  try {
    await clone.append([row('a')]);
    expect(await current(clone, 'files:1')).toStrictEqual([2, 0, 0, 2]);
  } finally {
    await clone.close();
  }
}

describe('native density file facts', () => {
  const directory = useTempDir('density-file-facts-');
  it('maintains only appended keys and preserves old pins through rewrite, pop, clone, compaction and ready reopen', async () => {
    const path = join(directory(), 'files.llxj');
    const session = await JournalSession.create(path);
    let measured = 0;
    const registration = policy('files:1', () => {
      measured++;
    });
    try {
      await session.append([row('a'), row('b'), row('a')]);
      await session.store.commit([
        { kind: 'densityFiles', policy: registration },
      ]);
      expect(measured).toBe(3);
      expect(await current(session, 'files:1')).toStrictEqual([2, 0, 0, 2]);
      const saved = await session.store.snapshot();
      try {
        await session.append([row('a')]);
        expect(measured).toBe(4);
        expect(await current(session, 'files:1')).toStrictEqual([3, 0, 0, 3]);
        const last = await session.store.snapshot();
        try {
          const entry = await last.entryAt(3);
          await session.store.commit([
            {
              kind: 'purge',
              rows: [
                {
                  label: entry.label,
                  draft: encodeContentRow(row('c'), { owner: 0 }),
                },
              ],
            },
            { kind: 'densityFiles', policy: registration },
          ]);
          expect(await current(session, 'files:1')).toStrictEqual([2, 0, 0, 2]);
          expect(await current(session, 'files:1', 'c')).toStrictEqual([
            3, 0, 0, 1,
          ]);
          await session.store.commit([
            {
              kind: 'pop',
              cutLabel: (await saved.entryAt(2)).label,
              expectedRemoved: 2,
            },
          ]);
          expect(await current(session, 'files:1')).toStrictEqual([0, 0, 0, 1]);
          expect(await current(session, 'files:1', 'c')).toBeUndefined();
          expect(await latest(saved, 'files:1')).toStrictEqual([2, 0, 0, 2]);
          await checkCloneAppend(session);
        } finally {
          await last.close();
        }
      } finally {
        await saved.close();
      }
      await session.store.compact();
      expect(await current(session, 'files:1')).toStrictEqual([0, 0, 0, 1]);
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path);
    try {
      const bytes = (await stat(path)).size;
      const calls = measured;
      await reopened.store.commit([
        { kind: 'densityFiles', policy: registration },
      ]);
      expect((await stat(path)).size - bytes).toBe(0);
      expect(measured - calls).toBe(0);
      await reopened.store.commit([{ kind: 'clear' }]);
      expect(await current(reopened, 'files:1')).toBeUndefined();
      await reopened.append([row('a')]);
      expect(await current(reopened, 'files:1')).toStrictEqual([0, 0, 0, 1]);
    } finally {
      await reopened.close();
    }
  }, 180_000);

  it('preserves producer error identity at row 65 and the prior policy before same-writer continuation', async () => {
    const session = await JournalSession.create(
      join(directory(), 'failure.llxj'),
    );
    const failure = new Error('file fact producer stopped at 65');
    const good = policy('good:1');
    try {
      await session.append(Array.from({ length: 65 }, () => row('a')));
      await session.store.commit([{ kind: 'densityFiles', policy: good }]);
      const saved = await session.store.snapshot();
      try {
        const bad: DensityFilePolicy = {
          revision: 'bad:1',
          async *occurrences(snapshot, entry) {
            if ((await snapshot.rowsBelow(entry.label)) === 64) throw failure;
            yield* good.occurrences(snapshot, entry);
          },
        };
        await expect(
          session.store.commit([{ kind: 'densityFiles', policy: bad }]),
        ).rejects.toBe(failure);
        expect(await current(session, 'good:1')).toStrictEqual([64, 0, 0, 65]);
        const snapshot = await session.store.snapshot();
        try {
          await expect(snapshot.densityFiles('bad:1')).rejects.toThrow(
            'requires a fill',
          );
        } finally {
          await snapshot.close();
        }
        await session.append([row('a')]);
        expect(await current(session, 'good:1')).toStrictEqual([65, 0, 0, 66]);
        expect(await latest(saved, 'good:1')).toStrictEqual([64, 0, 0, 65]);
      } finally {
        await saved.close();
      }
    } finally {
      await session.close();
    }
  }, 180_000);
  it('changes semantic generations, preserves abort identity and refills after an unregistered reopened append', async () => {
    const path = join(directory(), 'revision.llxj');
    const session = await JournalSession.create(path);
    const first = policy('revision:1');
    const changed: DensityFilePolicy = {
      revision: 'revision:2',
      async *occurrences(snapshot, entry) {
        for await (const item of first.occurrences(snapshot, entry))
          yield { ...item, key: `normalized:${item.key}` };
      },
    };
    try {
      await session.append([row('a'), row('a')]);
      await session.store.commit([{ kind: 'densityFiles', policy: first }]);
      const old = await session.store.snapshot();
      try {
        await session.store.commit([{ kind: 'densityFiles', policy: changed }]);
        await expect(
          current(session, 'revision:2', 'a'),
        ).resolves.toBeUndefined();
        expect(
          await current(session, 'revision:2', 'normalized:a'),
        ).toStrictEqual([1, 0, 0, 2]);
        expect(await latest(old, 'revision:1')).toStrictEqual([1, 0, 0, 2]);
        const abort = new DOMException('cancel file policy', 'AbortError');
        const controller = new AbortController();
        controller.abort(abort);
        const cancelled: DensityFilePolicy = {
          revision: 'cancelled:1',
          async *occurrences(snapshot, entry) {
            controller.signal.throwIfAborted();
            yield* first.occurrences(snapshot, entry);
          },
        };
        await expect(
          session.store.commit([{ kind: 'densityFiles', policy: cancelled }]),
        ).rejects.toBe(abort);
        await session.append([row('a')]);
        expect(
          await current(session, 'revision:2', 'normalized:a'),
        ).toStrictEqual([2, 0, 0, 3]);
      } finally {
        await old.close();
      }
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path);
    try {
      await reopened.append([row('a')]);
      const missing = await reopened.store.snapshot();
      try {
        await expect(missing.densityFiles('revision:2')).rejects.toThrow(
          'requires a fill',
        );
      } finally {
        await missing.close();
      }
      await reopened.store.commit([{ kind: 'densityFiles', policy: changed }]);
      expect(
        await current(reopened, 'revision:2', 'normalized:a'),
      ).toStrictEqual([3, 0, 0, 4]);
    } finally {
      await reopened.close();
    }
  });
});
