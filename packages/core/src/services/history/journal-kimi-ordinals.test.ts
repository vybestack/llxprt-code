/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { getToolIdStrategy } from '@vybestack/llxprt-code-tools';
import { DebugLogger } from '../../debug/index.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { OffsetAudit } from '../../journal/__tests__/support/offsetAudit.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { JournalSession } from './journalSession.js';
import { recordingAcceptsEdits } from './recording-primary-edits.js';
import { buildProviderContent } from './historyProviderPipeline.js';
import {
  call,
  response,
  unitCase,
} from './__tests__/support/normalization-cases.js';
import { encodeContentRow } from './journalRowCodec.js';
import type { IContent } from './IContent.js';

async function referenceCount(rows: readonly IContent[]): Promise<number> {
  const units = buildProviderContent(
    [...rows],
    [],
    new DebugLogger('kimi-eligible-reference'),
  );
  const mapper = getToolIdStrategy('kimi').createMapper(units);
  const prefix = 'functions.__ordinal_probe__:';
  const probe = mapper.resolveToolCallId(call('', '__ordinal_probe__'));
  if (!probe.startsWith(prefix))
    throw new Error('Unexpected Kimi counter probe');
  return Number(probe.slice(prefix.length));
}

async function inspect(
  session: JournalSession,
  visit: (snapshot: VersionSnapshot) => Promise<void>,
): Promise<void> {
  const snapshot = await session.store.snapshot();
  try {
    await visit(snapshot);
  } finally {
    await snapshot.close();
  }
}

async function assertRanks(session: JournalSession): Promise<void> {
  await inspect(session, async (snapshot) => {
    expect(await snapshot.kimiEligibleCount()).toBe(101);
    for (const index of [0, 9, 10, 99, 100])
      expect(await snapshot.kimiOrdinal(BigInt(index + 1) * 1048576n, 0)).toBe(
        index,
      );
  });
  const read = await session.store.openRead();
  try {
    if (read.version === undefined)
      throw new Error('Missing copied Kimi version');
    await new OffsetAudit(read.access).walkVersion(read.version);
  } finally {
    await read.close();
  }
}

describe('native Kimi emitted eligible ordinals', () => {
  const directory = useTempDir('kimi-ordinals-');
  const options = { journal: testJournalSeams().dependencies };

  it('admits bookkeeping fills without weakening owner-sensitive edits', () => {
    expect(recordingAcceptsEdits([{ kind: 'kimi' }], 1, 'owner', false)).toBe(
      true,
    );
    expect(
      recordingAcceptsEdits(
        [{ kind: 'owner', changes: [{ label: 1n, owner: 2 }] }],
        1,
        'owner',
        false,
      ),
    ).toBe(false);
  });

  it('counts every speaker, reconstructed default names and duplicate blocks but excludes empty and unnamed calls', async () => {
    const rows: readonly IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q' }, call('x')] },
      { speaker: 'tool', blocks: [response('x')] },
      {
        speaker: 'ai',
        blocks: [call('y'), call('y', 'renamed'), call('y', ''), call('')],
      },
      { speaker: 'tool', blocks: [response('y')] },
      {
        speaker: 'tool',
        blocks: [
          { ...response('hist_tool_X'), toolName: '' },
          response('hist_tool_X'),
        ],
      },
      { speaker: 'ai', blocks: [call('toolu_X')] },
    ];
    const session = await JournalSession.create(
      `${directory()}/emitted.llxj`,
      options,
    );
    try {
      await session.append(rows);
      await session.store.commit([{ kind: 'kimi' }]);
      await inspect(session, async (snapshot) => {
        expect(await snapshot.kimiEligibleCount()).toBe(
          await referenceCount(rows),
        );
        expect(snapshot.version?.aggregate.callBlocks).toBe(6);
        const counts: number[] = [];
        for await (const entry of snapshot.entries())
          counts.push(entry.callBlocks);
        expect(counts).toStrictEqual([1, 0, 2, 0, 2, 1]);
        expect(await snapshot.kimiOrdinal(3145728n, 1)).toBe(2);
        expect(await snapshot.kimiOrdinal(5242880n, 0)).toBe(3);
        await expect(snapshot.kimiOrdinal(3145728n, 2)).rejects.toThrow(
          RangeError,
        );
        await expect(snapshot.kimiOrdinal(1n, 0)).rejects.toThrow(RangeError);
      });
    } finally {
      await session.close();
    }
  });

  it('keeps an inactive pin explicit and preserves filled counts across append and pop past activation', async () => {
    const session = await JournalSession.create(
      `${directory()}/lifecycle.llxj`,
      options,
    );
    try {
      await session.append([{ speaker: 'ai', blocks: [call('a')] }]);
      await inspect(session, async (old) => {
        await expect(old.kimiEligibleCount()).rejects.toThrow('Kimi emitted');
        await session.store.commit([{ kind: 'kimi' }]);
        await session.append([
          { speaker: 'tool', blocks: [{ ...response('b'), toolName: '' }] },
        ]);
        await inspect(session, async (filled) => {
          expect(await filled.kimiEligibleCount()).toBe(2);
          await session.store.commit([
            { kind: 'pop', cutLabel: 2097152n, expectedRemoved: 1 },
          ]);
          await inspect(session, async (popped) => {
            expect(await popped.kimiEligibleCount()).toBe(1);
          });
          await session.store.commit([
            { kind: 'pop', cutLabel: 1048576n, expectedRemoved: 1 },
          ]);
          await session.append([{ speaker: 'human', blocks: [call('c')] }]);
          await inspect(session, async (current) => {
            expect(await current.kimiEligibleCount()).toBe(1);
            expect(await current.kimiOrdinal(3145728n, 0)).toBe(0);
            expect(await filled.kimiEligibleCount()).toBe(2);
          });
        });
      });
    } finally {
      await session.close();
    }
  });

  it('matches independent array normalization on 120 frozen-source cases after replacement and first-row removal', async () => {
    const session = await JournalSession.create(
      `${directory()}/differential.llxj`,
      options,
    );
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      for (let seed = 0; seed < 120; seed++) {
        const input = unitCase(seed);
        const rows = [...input.rows, ...input.tail];
        await session.store.commit([
          {
            kind: 'replace',
            rows: rows.map((row) => encodeContentRow(row, { owner: 0 })),
          },
        ]);
        await inspect(session, async (before) => {
          expect(await before.kimiEligibleCount()).toBe(
            await referenceCount(rows),
          );
          const first = await before.entryAt(0);
          await session.store.commit([
            { kind: 'density', replacements: [], removed: [first.label] },
          ]);
          await inspect(session, async (after) => {
            expect(await after.kimiEligibleCount()).toBe(
              await referenceCount(rows.slice(1)),
            );
          });
        });
      }
    } finally {
      await session.close();
    }
  });

  it('ranks eligible calls across 9/10 and 99/100 after reopen, owner changes, fork and compaction', async () => {
    const path = `${directory()}/ranks.llxj`;
    const session = await JournalSession.create(path, options);
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      for (let index = 0; index < 101; index++)
        await session.append([
          {
            speaker: index % 2 === 0 ? 'ai' : 'human',
            blocks: [call(`id-${index}`)],
          },
        ]);
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path, options);
    try {
      await reopened.store.commit([
        { kind: 'owner', changes: [{ label: 1048576n, owner: 2 }] },
      ]);
      await inspect(reopened, async (old) => {
        const clone = await reopened.cloneUnlinked({
          unlinkedDirectory: directory(),
        });
        try {
          expect(await clone.store.compact()).toBe('swapped');
          await expect(reopened.store.compact()).rejects.toThrow('live pin');
          await assertRanks(reopened);
          await assertRanks(clone);
          expect(await old.kimiOrdinal(104857600n, 0)).toBe(99);
        } finally {
          await clone.close();
        }
      });
      expect(await reopened.store.compact()).toBe('swapped');
      const compacted = await reopened.store.snapshot();
      try {
        expect(await compacted.kimiOrdinal(105906176n, 0)).toBe(100);
      } finally {
        await compacted.close();
      }
      await expect(compacted.kimiEligibleCount()).rejects.toThrow(
        'pin was released',
      );
    } finally {
      await reopened.close();
    }
  });
});
