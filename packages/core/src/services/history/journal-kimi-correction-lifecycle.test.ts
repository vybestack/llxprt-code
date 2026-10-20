/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  testJournalSeams,
  type Failures,
} from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { OffsetAudit } from '../../journal/__tests__/support/offsetAudit.js';
import { JournalSession } from './journalSession.js';
import { encodeContentRow } from './journalRowCodec.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import type { IContent } from './IContent.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';

async function holderLabels(snapshot: VersionSnapshot): Promise<bigint[]> {
  const labels: bigint[] = [];
  for await (const holder of snapshot.kimiHolders('x'))
    labels.push(holder.position.label);
  return labels;
}

async function auditCopy(session: JournalSession): Promise<void> {
  const read = await session.store.openRead();
  try {
    if (read.version === undefined) throw new Error('No copied version');
    await new OffsetAudit(read.access).walkVersion(read.version);
  } finally {
    await read.close();
  }
}

async function assertState(
  session: JournalSession,
  id: string,
  mapped: string | undefined,
  exceptions: number,
): Promise<void> {
  const snapshot = await session.store.snapshot();
  try {
    expect(await snapshot.kimiMappedId(id)).toBe(mapped);
    let count = 0;
    for await (const fact of snapshot.kimiExceptions()) {
      expect(fact.callCount).toBeGreaterThan(0);
      count++;
    }
    expect(count).toBe(exceptions);
  } finally {
    await snapshot.close();
  }
}

describe('native Kimi correction lifecycle', () => {
  const directory = useTempDir('kimi-correction-lifecycle-');
  const options = { journal: testJournalSeams().dependencies };

  it('updates the persisted unmapped counter when a later named call maps earlier unnamed uses', async () => {
    const session = await JournalSession.create(
      `${directory()}/unmapped.llxj`,
      options,
    );
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      await session.append([
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'keep' },
            call('x', ''),
            call('x', ''),
          ],
        },
      ]);
      const old = await session.store.snapshot();
      try {
        expect(await old.kimiUnmappedCount()).toBe(3);
        expect(await old.kimiIdFact('x')).toMatchObject({
          aiCalls: 2,
          writtenUses: 2,
          unmappedUses: 3,
        });
        await session.append([{ speaker: 'ai', blocks: [call('x', 'named')] }]);
        const current = await session.store.snapshot();
        try {
          expect(await current.kimiUnmappedCount()).toBe(0);
          expect(await current.kimiIdFact('x')).toMatchObject({
            aiCalls: 3,
            writtenUses: 4,
            unmappedUses: 0,
          });
          expect(await holderLabels(current)).toStrictEqual([
            1048576n,
            1048576n,
            2097152n,
            1048576n,
          ]);
          expect(await old.kimiUnmappedCount()).toBe(3);
        } finally {
          await current.close();
        }
      } finally {
        await old.close();
      }
    } finally {
      await session.close();
    }
  });

  it('rebuilds mappings from surviving order after density, compression, insertion, pop, clear and replacement', async () => {
    const session = await JournalSession.create(
      `${directory()}/mutations.llxj`,
      options,
    );
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('x', 'first')] },
      { speaker: 'ai', blocks: [call('y')] },
      { speaker: 'ai', blocks: [call('x', 'last')] },
    ];
    try {
      await session.append(rows);
      await session.store.commit([{ kind: 'kimi' }]);
      await assertState(session, 'x', 'functions.last:2', 1);
      await session.store.commit([
        { kind: 'density', replacements: [], removed: [1048576n] },
      ]);
      await assertState(session, 'x', 'functions.last:1', 0);
      await session.store.commit([
        {
          kind: 'insert',
          afterLabel: 0n,
          draft: encodeContentRow(rows[0], { owner: 0 }),
        },
      ]);
      await assertState(session, 'x', 'functions.last:2', 1);
      await session.store.commit([
        { kind: 'pop', cutLabel: 3145728n, expectedRemoved: 1 },
      ]);
      await assertState(session, 'x', 'functions.first:0', 0);
      await session.store.commit([
        {
          kind: 'replace',
          rows: rows.map((row) => encodeContentRow(row, { owner: 0 })),
        },
      ]);
      const before = await session.store.snapshot();
      let cut = 0n;
      try {
        cut = (await before.entryAt(2)).label;
      } finally {
        await before.close();
      }
      await session.store.commit([
        {
          kind: 'compress',
          retainFromLabel: cut,
          expectedReplaced: 2,
          summary: encodeContentRow(
            { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
            { owner: 0 },
          ),
        },
      ]);
      await assertState(session, 'x', 'functions.last:0', 0);
      await session.store.commit([{ kind: 'clear' }]);
      const empty = await session.store.snapshot();
      try {
        await expect(empty.kimiMappedId('x')).rejects.toThrow('need a fill');
      } finally {
        await empty.close();
      }
      await session.store.commit([{ kind: 'kimi' }]);
      await assertState(session, 'x', undefined, 0);
    } finally {
      await session.close();
    }
  });

  it('retains active facts through owner changes, reopen, fork and compact with a live original pin', async () => {
    const path = `${directory()}/copy.llxj`;
    const session = await JournalSession.create(path, options);
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      await session.append([
        {
          speaker: 'tool',
          blocks: [response('x'), { ...response('x'), toolName: 'longer' }],
        },
      ]);
      await session.store.commit([
        { kind: 'owner', changes: [{ label: 1048576n, owner: 7 }] },
      ]);
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path, options);
    try {
      const original = await reopened.store.snapshot();
      try {
        const clone = await reopened.cloneUnlinked({
          unlinkedDirectory: directory(),
        });
        try {
          expect(await clone.store.compact()).toBe('swapped');
          await assertState(clone, 'x', 'functions.longer:1', 1);
          expect(await original.kimiMappedId('x')).toBe('functions.longer:1');
          await auditCopy(clone);
        } finally {
          await clone.close();
        }
      } finally {
        await original.close();
      }
      expect(await reopened.store.compact()).toBe('swapped');
      await assertState(reopened, 'x', 'functions.longer:1', 1);
      await expect(original.kimiMappedId('x')).rejects.toThrow(
        'pin was released',
      );
    } finally {
      await reopened.close();
    }
  });

  it('does not publish duplicate corrections on failed append and poisons later writes', async () => {
    const failures: Failures = {};
    const seams = testJournalSeams(failures);
    const session = await JournalSession.create(`${directory()}/failure.llxj`, {
      journal: seams.dependencies,
    });
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      const before = await session.append([
        { speaker: 'ai', blocks: [call('x', 'first')] },
      ]);
      failures.failWriteAt = seams.events.filter(
        (event) => event.type === 'write',
      ).length;
      await expect(
        session.append([{ speaker: 'ai', blocks: [call('x', 'later')] }]),
      ).rejects.toThrow('injected write failure');
      expect(session.store.published?.commitSeq).toBe(before.commitSeq);
      await assertState(session, 'x', 'functions.first:0', 0);
      await expect(
        session.append([{ speaker: 'ai', blocks: [call('y')] }]),
      ).rejects.toThrow('accepts no more writes');
    } finally {
      await session.close();
    }
  });
});
