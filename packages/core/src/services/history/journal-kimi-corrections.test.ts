/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { getToolIdStrategy } from '@vybestack/llxprt-code-tools';
import { DebugLogger } from '../../debug/index.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { JournalSession } from './journalSession.js';
import { buildProviderContent } from './historyProviderPipeline.js';
import {
  call,
  response,
  unitCase,
} from './__tests__/support/normalization-cases.js';
import { encodeContentRow } from './journalRowCodec.js';
import { isCuratedContent } from './historyCuration.js';
import type { IContent } from './IContent.js';

async function reference(
  rows: readonly IContent[],
  ids: readonly string[],
): Promise<readonly string[]> {
  const units = buildProviderContent(
    rows.filter(isCuratedContent),
    [],
    new DebugLogger('kimi-last-reference'),
  );
  const mapper = getToolIdStrategy('kimi').createMapper(units);
  return ids.map((id) => mapper.resolveToolCallId(call(id, '__probe__')));
}

async function mappings(
  snapshot: VersionSnapshot,
  ids: readonly string[],
): Promise<ReadonlyArray<string | undefined>> {
  const result: Array<string | undefined> = [];
  for (const id of ids) result.push(await snapshot.kimiMappedId(id));
  return result;
}

async function exceptions(snapshot: VersionSnapshot): Promise<number> {
  let count = 0;
  for await (const fact of snapshot.kimiExceptions()) {
    expect(fact.callCount).toBeGreaterThan(0);
    count++;
  }
  return count;
}

describe('native Kimi emitted mapping corrections', () => {
  const directory = useTempDir('kimi-corrections-');
  const options = { journal: testJournalSeams().dependencies };

  it('replaces both earlier call mappings with the last eligible name and ordinal while old pins stay stable', async () => {
    const session = await JournalSession.create(
      `${directory()}/last.llxj`,
      options,
    );
    const before: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('x', 'first')] },
      { speaker: 'ai', blocks: [call('x', 'second')] },
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'unnamed retained in a curated row' },
          call('x', ''),
        ],
      },
    ];
    try {
      await session.append(before);
      await session.store.commit([{ kind: 'kimi' }]);
      const old = await session.store.snapshot();
      try {
        expect(await old.kimiMappedId('x')).toBe('functions.second:1');
        expect(await exceptions(old)).toBe(1);
        await session.append([
          { speaker: 'human', blocks: [call('x', 'much_longer')] },
        ]);
        const current = await session.store.snapshot();
        try {
          expect(await current.kimiMappedId('x')).toBe(
            'functions.much_longer:2',
          );
          expect(await old.kimiMappedId('x')).toBe('functions.second:1');
          expect(await current.kimiIdFact('x')).toMatchObject({
            callCount: 4,
            eligibleCount: 3,
            aiCalls: 3,
            writtenUses: 4,
            unmappedUses: 0,
          });
          expect(await current.kimiDigitCorrection()).toBe(-2);
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

  it('keeps an ordinary unique history exception-free and crosses ordinal digit boundaries', async () => {
    const session = await JournalSession.create(
      `${directory()}/digits.llxj`,
      options,
    );
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      await session.append(
        Array.from(
          { length: 101 },
          (_, index): IContent => ({
            speaker: 'ai',
            blocks: [call(`id-${index}`)],
          }),
        ),
      );
      const clean = await session.store.snapshot();
      try {
        expect(await exceptions(clean)).toBe(0);
        expect(await clean.kimiDigitCorrection()).toBe(0);
        for (const index of [9, 10, 99, 100])
          expect(await clean.kimiMappedId(`id-${index}`)).toBe(
            `functions.inspect:${index}`,
          );
      } finally {
        await clean.close();
      }
      await session.append([
        { speaker: 'ai', blocks: [call('id-9', 'changed')] },
      ]);
      const duplicate = await session.store.snapshot();
      try {
        expect(await exceptions(duplicate)).toBe(1);
        expect(await duplicate.kimiMappedId('id-9')).toBe(
          'functions.changed:101',
        );
        expect(await duplicate.kimiDigitCorrection()).toBe(1);
      } finally {
        await duplicate.close();
      }
    } finally {
      await session.close();
    }
  });

  it('matches the independent array mapper on reconstruction, default names, raw prefix collisions and frozen-source families', async () => {
    const session = await JournalSession.create(
      `${directory()}/oracle.llxj`,
      options,
    );
    const ids = ['x', 'call_x', 'hist_tool_x', 'toolu_x', 'call_'];
    const cases: ReadonlyArray<readonly IContent[]> = [
      [{ speaker: 'tool', blocks: [{ ...response('x'), toolName: '' }] }],
      [
        {
          speaker: 'tool',
          blocks: [{ ...response('x'), toolName: '' }, response('x')],
        },
        { speaker: 'ai', blocks: [call('x', '')] },
      ],
      [
        {
          speaker: 'ai',
          blocks: [
            call('call_'),
            call(''),
            call('call_x'),
            call('hist_tool_x'),
            call('toolu_x'),
          ],
        },
      ],
      ...Array.from({ length: 120 }, (_, seed) => {
        const input = unitCase(seed);
        return [...input.rows, ...input.tail];
      }),
    ];
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      for (const rows of cases) {
        await session.store.commit([
          {
            kind: 'replace',
            rows: rows.map((row) => encodeContentRow(row, { owner: 0 })),
          },
        ]);
        const expected = await reference(rows, ids);
        const snapshot = await session.store.snapshot();
        try {
          const actual = await mappings(snapshot, ids);
          expect(actual).toStrictEqual(
            expected.map((value) =>
              value.startsWith('functions.__probe__:') ? undefined : value,
            ),
          );
        } finally {
          await snapshot.close();
        }
      }
    } finally {
      await session.close();
    }
  });

  it('counts a human eligible mapping but excludes its dropped output when the stream has AI calls', async () => {
    const session = await JournalSession.create(
      `${directory()}/human.llxj`,
      options,
    );
    try {
      await session.append([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'q' }, call('human')],
        },
        { speaker: 'tool', blocks: [response('human')] },
      ]);
      await session.store.commit([{ kind: 'kimi' }]);
      const before = await session.store.snapshot();
      try {
        expect(await before.kimiIdFact('human')).toMatchObject({
          eligibleCount: 1,
          aiCalls: 0,
          writtenUses: 1,
        });
        await session.append([{ speaker: 'ai', blocks: [call('other')] }]);
        const after = await session.store.snapshot();
        try {
          expect(await after.kimiIdFact('human')).toMatchObject({
            eligibleCount: 1,
            aiCalls: 0,
            writtenUses: 0,
          });
          expect(await after.kimiDigitCorrection()).toBe(-2);
        } finally {
          await after.close();
        }
      } finally {
        await before.close();
      }
    } finally {
      await session.close();
    }
  });
});
