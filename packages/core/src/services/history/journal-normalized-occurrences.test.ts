/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  normalizeToAnthropicToolId,
  normalizeToOpenAIToolId,
} from '@vybestack/llxprt-code-tools';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { ID_NS, OCCURRENCE_KIND } from '../../journal/idKeys.js';
import type { UnitPosition } from '../../journal/idEntryCodecs.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { JournalSession } from './journalSession.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import type { IContent } from './IContent.js';
import { encodeContentRow } from './journalRowCodec.js';
import { assertPersistedOccurrences } from './__tests__/support/persisted-occurrence-oracle.js';

async function positions(
  snapshot: VersionSnapshot,
  family: 1 | 2,
  kind: 0 | 1,
  id: string,
): Promise<readonly UnitPosition[]> {
  const count = await snapshot.facts.normalizedCount(family, kind, id);
  const result: UnitPosition[] = [];
  for (let k = 1; k <= count; k++) {
    const at = await snapshot.facts.normalizedPosition(family, kind, id, k);
    if (at === undefined) throw new Error('Missing counted occurrence');
    result.push(at);
  }
  return result;
}

describe('native emitted normalized occurrences', () => {
  const directory = useTempDir('normalized-occurrences-');

  it('counts empty collisions, reconstructed duplicates and cross-speaker orphan targets in emitted order', async () => {
    const session = await JournalSession.create(`${directory()}/facts.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call(''), call('call_')] },
      {
        speaker: 'tool',
        blocks: [response('hist_tool_X'), response('hist_tool_X')],
      },
      { speaker: 'human', blocks: [call('toolu_X')] },
      { speaker: 'ai', blocks: [call('toolu_X')] },
    ];
    try {
      await session.append(rows);
      const snapshot = await session.store.snapshot();
      try {
        expect(await positions(snapshot, 1, 0, 'call_')).toStrictEqual([
          { label: 1048576n, part: 0, unit: 0 },
          { label: 1048576n, part: 0, unit: 0 },
        ]);
        expect(await positions(snapshot, 1, 1, 'call_')).toStrictEqual([
          { label: 1048576n, part: 0, unit: 1 },
        ]);
        for (const family of [ID_NS.openai, ID_NS.anthropic]) {
          const id =
            family === ID_NS.openai
              ? normalizeToOpenAIToolId('hist_tool_X')
              : normalizeToAnthropicToolId('hist_tool_X');
          expect(
            await positions(snapshot, family, OCCURRENCE_KIND.call, id),
          ).toStrictEqual([
            { label: 2097152n, part: 0, unit: 0 },
            { label: 2097152n, part: 0, unit: 0 },
            { label: 4194304n, part: 0, unit: 0 },
          ]);
          expect(
            await positions(snapshot, family, OCCURRENCE_KIND.response, id),
          ).toStrictEqual([
            { label: 2097152n, part: 0, unit: 1 },
            { label: 3145728n, part: 0, unit: 1 },
          ]);
          expect(
            await snapshot.facts.firstAfter(family, 1, id, {
              label: 2097152n,
              part: 0,
              unit: 1,
            }),
          ).toStrictEqual({ label: 3145728n, part: 0, unit: 1 });
        }
        expect((await snapshot.facts.fact('hist_tool_X'))?.best).toStrictEqual({
          label: 2097152n,
          part: 0,
          block: 0,
        });
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });

  it('updates earlier targets without changing an older pin and rebuilds the exact lists after removal', async () => {
    const session = await JournalSession.create(
      `${directory()}/mutations.llxj`,
      {
        journal: testJournalSeams().dependencies,
      },
    );
    try {
      await session.append([{ speaker: 'human', blocks: [call('a')] }]);
      const old = await session.store.snapshot();
      try {
        await session.append([{ speaker: 'ai', blocks: [call('a')] }]);
        const current = await session.store.snapshot();
        try {
          expect(await positions(old, 1, 1, 'call_a')).toStrictEqual([]);
          expect(await positions(current, 1, 1, 'call_a')).toStrictEqual([
            { label: 1048576n, part: 0, unit: 1 },
          ]);
          expect(await positions(current, 1, 0, 'call_a')).toStrictEqual([
            { label: 2097152n, part: 0, unit: 0 },
          ]);
        } finally {
          await current.close();
        }
        await session.store.commit([
          { kind: 'density', replacements: [], removed: [1048576n] },
        ]);
        const rebuilt = await session.store.snapshot();
        try {
          expect(await positions(rebuilt, 1, 0, 'call_a')).toStrictEqual([
            { label: 2097152n, part: 0, unit: 0 },
          ]);
          expect(await positions(rebuilt, 1, 1, 'call_a')).toStrictEqual([
            { label: 2097152n, part: 0, unit: 1 },
          ]);
          expect(await positions(rebuilt, 2, 1, 'toolu_a')).toStrictEqual([
            { label: 2097152n, part: 0, unit: 1 },
          ]);
        } finally {
          await rebuilt.close();
        }
      } finally {
        await old.close();
      }
    } finally {
      await session.close();
    }
  });

  it('inserts a colliding normalized id before a long occurrence suffix across bounded fact batches', async () => {
    const session = await JournalSession.create(`${directory()}/suffix.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      function* rows(): Generator<ReturnType<typeof encodeContentRow>> {
        for (let index = 0; index < 400; index++) {
          yield encodeContentRow(
            { speaker: 'ai', blocks: [call('toolu_X')] },
            { owner: 0 },
          );
        }
      }
      await session.store.commit([{ kind: 'replace', rows: rows() }]);
      const old = await session.store.snapshot();
      try {
        await session.store.commit([
          {
            kind: 'insert',
            afterLabel: 0n,
            draft: encodeContentRow(
              { speaker: 'ai', blocks: [call('hist_tool_X')] },
              { owner: 0 },
            ),
          },
        ]);
        const current = await session.store.snapshot();
        try {
          const calls = await positions(current, 1, 0, 'call_X');
          expect(calls.length).toBe(401);
          expect(calls.slice(0, 2)).toStrictEqual([
            { label: 524288n, part: 0, unit: 0 },
            { label: 1048576n, part: 0, unit: 0 },
          ]);
          expect(calls[400]).toStrictEqual({
            label: 419430400n,
            part: 0,
            unit: 0,
          });
          expect((await positions(old, 1, 0, 'call_X')).length).toBe(400);
        } finally {
          await current.close();
        }
        await assertPersistedOccurrences(session);
      } finally {
        await old.close();
      }
    } finally {
      await session.close();
    }
  });

  it('keeps normalized occurrences sorted when a later AI call creates an earlier cross-speaker response', async () => {
    const session = await JournalSession.create(`${directory()}/earlier.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([
        { speaker: 'human', blocks: [call('hist_tool_X')] },
        { speaker: 'ai', blocks: [call('toolu_X')] },
      ]);
      await session.append([{ speaker: 'ai', blocks: [call('hist_tool_X')] }]);
      const before = await session.store.snapshot();
      try {
        expect(await positions(before, 2, 1, 'toolu_X')).toStrictEqual([
          { label: 1048576n, part: 0, unit: 1 },
          { label: 2097152n, part: 0, unit: 1 },
        ]);
        await session.append([
          { speaker: 'tool', blocks: [response('hist_tool_X', false)] },
        ]);
        await session.append([
          {
            speaker: 'tool',
            blocks: [
              response('hist_tool_X'),
              {
                type: 'media',
                mimeType: 'image/png',
                data: 'YWJj',
                encoding: 'base64',
              },
            ],
          },
        ]);
        const after = await session.store.snapshot();
        try {
          expect(await positions(after, 2, 1, 'toolu_X')).toStrictEqual(
            await positions(before, 2, 1, 'toolu_X'),
          );
          expect((await after.facts.fact('hist_tool_X'))?.best?.label).toBe(
            5242880n,
          );
          expect(
            (await before.facts.fact('hist_tool_X'))?.best,
          ).toBeUndefined();
        } finally {
          await after.close();
        }
        await assertPersistedOccurrences(session);
      } finally {
        await before.close();
      }
    } finally {
      await session.close();
    }
  });
});
