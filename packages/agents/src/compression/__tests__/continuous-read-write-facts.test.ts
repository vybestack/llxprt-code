/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import type { DensityFilePolicy } from '@vybestack/llxprt-code-core/journal/density-file-facts.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import {
  readWritePolicy,
  readWriteFacts,
  toolRow,
  resultRow,
} from './support/read-write-facts.js';

async function stale(
  session: JournalSession,
  revision: string,
  ordinal = 0,
  id = 'r',
): Promise<boolean> {
  const snapshot = await session.store.snapshot();
  try {
    return await (await readWriteFacts(snapshot, revision)).stale(ordinal, id);
  } finally {
    await snapshot.close();
  }
}
async function checkSurvivors(
  snapshot: VersionSnapshot,
  revision: string,
): Promise<void> {
  const facts = await readWriteFacts(snapshot, revision);
  expect(await facts.stale(0, 'r')).toBe(true);
  expect(await facts.stale(3, 'after')).toBe(false);
  expect(await facts.remaining(4, 0)).toBe(1);
}
async function checkClone(
  session: JournalSession,
  revision: string,
): Promise<void> {
  const clone = await session.cloneUnlinked();
  try {
    await clone.append([toolRow('next', 'replace', 'a')]);
    expect(await stale(clone, revision, 3, 'after')).toBe(true);
  } finally {
    await clone.close();
  }
}
describe('native read/write versioned facts', () => {
  const directory = useTempDir('native-read-write-facts-');
  it('updates only appended rows, preserves old pins, and rebuilds after rewrite/pop/clone/clear/compaction and reopen', async () => {
    const path = join(directory(), 'facts.llxj');
    let measured = 0;
    const policy = readWritePolicy(() => {
      measured++;
    });
    const session = await JournalSession.create(path);
    try {
      await session.append([toolRow('r', 'read_file', 'a'), resultRow('r')]);
      await session.store.commit([{ kind: 'densityFiles', policy }]);
      expect(measured).toBe(2);
      const old = await session.store.snapshot();
      try {
        await session.append([
          toolRow('w', 'write_file', 'a'),
          toolRow('after', 'read_file', 'a'),
          resultRow('after'),
        ]);
        expect(measured).toBe(5);
        expect(await stale(session, policy.revision)).toBe(true);
        expect(
          await (await readWriteFacts(old, policy.revision)).stale(0, 'r'),
        ).toBe(false);
        const current = await session.store.snapshot();
        try {
          await checkSurvivors(current, policy.revision);
          await checkClone(session, policy.revision);
          expect(await stale(session, policy.revision, 3, 'after')).toBe(false);
          await session.store.commit([
            {
              kind: 'purge',
              rows: [
                {
                  label: (await current.entryAt(2)).label,
                  draft: encodeContentRow(toolRow('w', 'write_file', 'b'), {
                    owner: 0,
                  }),
                },
              ],
            },
          ]);
          expect(await stale(session, policy.revision)).toBe(false);
          expect(
            await (
              await readWriteFacts(current, policy.revision)
            ).stale(0, 'r'),
          ).toBe(true);
          await session.store.commit([
            {
              kind: 'pop',
              cutLabel: (await current.entryAt(2)).label,
              expectedRemoved: 3,
            },
          ]);
          expect(await stale(session, policy.revision)).toBe(false);
          await session.append([
            toolRow('new', 'write_file', 'a'),
            toolRow('after', 'read_file', 'a'),
            resultRow('after'),
          ]);
          expect(await stale(session, policy.revision)).toBe(true);
        } finally {
          await current.close();
        }
      } finally {
        await old.close();
      }
      await session.store.compact();
      const snapshot = await session.store.snapshot();
      try {
        await checkSurvivors(snapshot, policy.revision);
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path);
    try {
      const bytes = (await stat(path)).size;
      const calls = measured;
      const commits = reopened.store.published?.commitSeq;
      for (let index = 0; index < 40; index++)
        await reopened.store.commit([{ kind: 'densityFiles', policy }]);
      expect(measured - calls).toBe(0);
      expect((await stat(path)).size - bytes).toBe(0);
      expect(reopened.store.published?.commitSeq).toBe(commits);
      await reopened.store.commit([{ kind: 'clear' }]);
      expect(await stale(reopened, policy.revision)).toBe(false);
      await reopened.append([toolRow('r', 'read_file', 'a')]);
      expect(await stale(reopened, policy.revision)).toBe(false);
    } finally {
      await reopened.close();
    }
  });
  it('preserves a producer error at row 65, policy generation and same-writer continuation', async () => {
    const session = await JournalSession.create(
      join(directory(), 'fault.llxj'),
    );
    const good = readWritePolicy();
    const failure = new Error('read/write producer failed at 65');
    try {
      await session.append(
        Array.from({ length: 65 }, (_, index) =>
          toolRow(`r-${index}`, 'read_file', 'a'),
        ),
      );
      await session.store.commit([{ kind: 'densityFiles', policy: good }]);
      let row = 0;
      const bad: DensityFilePolicy = {
        ...good,
        revision: 'different-policy',
        async *combined(snapshot, entry) {
          if (++row === 65) throw failure;
          if (good.combined === undefined) throw new Error('Missing producer');
          yield* good.combined(snapshot, entry);
        },
      };
      await expect(
        session.store.commit([{ kind: 'densityFiles', policy: bad }]),
      ).rejects.toBe(failure);
      expect(await stale(session, good.revision, 64, 'r-64')).toBe(false);
      const snapshot = await session.store.snapshot();
      try {
        await expect(snapshot.densityFiles(bad.revision)).rejects.toThrow(
          'requires a fill',
        );
      } finally {
        await snapshot.close();
      }
      await session.append([toolRow('w', 'write_file', 'a')]);
      expect(await stale(session, good.revision, 64, 'r-64')).toBe(true);
      await session.store.commit([
        {
          kind: 'densityFiles',
          policy: { ...good, revision: 'new-generation' },
        },
      ]);
      expect(await stale(session, 'new-generation', 64, 'r-64')).toBe(true);
      const fresh = await session.store.snapshot();
      try {
        await expect(fresh.densityFiles(good.revision)).rejects.toThrow(
          'requires a fill',
        );
      } finally {
        await fresh.close();
      }
    } finally {
      await session.close();
    }
  });
  it('poisons the writer after a physical flush failure without replacing the prior published facts', async () => {
    const seams = testJournalSeams({ failFlushAt: 2 });
    const session = await JournalSession.create(
      join(directory(), 'physical-fault.llxj'),
      { journal: seams.dependencies },
    );
    const policy = readWritePolicy();
    try {
      await session.append([toolRow('r', 'read_file', 'a'), resultRow('r')]);
      await session.store.commit([{ kind: 'densityFiles', policy }]);
      const published = session.store.published;
      const saved = await session.store.snapshot();
      try {
        await expect(
          session.append([toolRow('w', 'write_file', 'a')]),
        ).rejects.toThrow('injected flush failure');
        expect(session.store.published).toBe(published);
        expect(
          await (await readWriteFacts(saved, policy.revision)).stale(0, 'r'),
        ).toBe(false);
        expect(saved.rows).toBe(2);
        await expect(
          session.append([toolRow('next', 'read_file', 'b')]),
        ).rejects.toThrow('failed earlier');
      } finally {
        await saved.close();
      }
    } finally {
      await session.close();
    }
  });
});
