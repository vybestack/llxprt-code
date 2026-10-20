/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from './journalSession.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import {
  oldUnits,
  digest,
  collectUnits,
} from './__tests__/support/normalization-oracle.js';
import {
  call,
  response,
  type UnitCase,
} from './__tests__/support/normalization-cases.js';
import {
  streamJournalOrphanUnits,
  strippedSelf,
} from './journal-orphan-units.js';
import type { IContent } from './IContent.js';

const inputs: readonly UnitCase[] = [
  {
    id: 'cross-speaker',
    rows: [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q' }, call('a')] },
      { speaker: 'ai', blocks: [call('a')] },
    ],
    tail: [],
  },
  {
    id: 'duplicate-orphans',
    rows: [
      { speaker: 'ai', blocks: [call('a'), call('a', 'second'), call('b')] },
    ],
    tail: [],
  },
  {
    id: 'empty-id',
    rows: [{ speaker: 'ai', blocks: [call(''), call('a')] }],
    tail: [],
  },
  {
    id: 'split-call',
    rows: [
      { speaker: 'tool', blocks: [call('a'), { type: 'text', text: 'rest' }] },
    ],
    tail: [],
  },
  {
    id: 'uncurated',
    rows: [
      { speaker: 'ai', blocks: [] },
      { speaker: 'human', blocks: [] },
    ],
    tail: [],
  },
];

describe('indexed orphan-only unit stream', () => {
  const directory = useTempDir('journal-orphan-units-');
  for (const input of inputs) {
    it(`matches the old stream for ${input.id}`, async () => {
      const expected = await oldUnits(input);
      const session = await JournalSession.create(`${directory()}/units.llxj`, {
        journal: testJournalSeams().dependencies,
      });
      try {
        await session.append(input.rows);
        const snapshot = await session.store.snapshot();
        try {
          const units = await collectUnits(streamJournalOrphanUnits(snapshot));
          expect({ hash: digest(units), count: units.length }).toStrictEqual({
            hash: expected.outputHash,
            count: expected.count,
          });
        } finally {
          await snapshot.close();
        }
      } finally {
        await session.close();
      }
    });
  }

  it('reads source facts from the same pinned version after a later response arrives', async () => {
    const session = await JournalSession.create(`${directory()}/pinned.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([{ speaker: 'ai', blocks: [call('a')] }]);
      const snapshot = await session.store.snapshot();
      try {
        await session.append([{ speaker: 'tool', blocks: [response('a')] }]);
        expect((await snapshot.facts.fact('a'))?.firstResponse).toBeUndefined();
        const units: IContent[] = [];
        for await (const unit of streamJournalOrphanUnits(snapshot))
          units.push(unit);
        expect(units[1]?.blocks).toStrictEqual([
          {
            type: 'tool_response',
            callId: 'a',
            toolName: 'inspect',
            result: null,
            error: 'Tool call interrupted or cancelled',
            isComplete: true,
          },
        ]);
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });

  it('implements stripped self for human and tool response/media rows without mutating input', () => {
    const human: IContent = {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'keep' },
        response('a'),
        {
          type: 'media',
          mimeType: 'image/png',
          data: 'YWJj',
          encoding: 'base64',
        },
      ],
      metadata: { model: 'original' },
    };
    const before = structuredClone(human);
    expect(strippedSelf(human)).toStrictEqual({
      ...human,
      blocks: [human.blocks[0]],
    });
    expect(strippedSelf({ ...human, speaker: 'tool' })).toBeUndefined();
    expect(human).toStrictEqual(before);
  });

  it('rejects real responses rather than silently using an unimplemented rule or the old normalizer', async () => {
    const session = await JournalSession.create(
      `${directory()}/unsupported.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.append([{ speaker: 'tool', blocks: [response('a')] }]);
      const snapshot = await session.store.snapshot();
      try {
        const reader = streamJournalOrphanUnits(snapshot);
        await expect(reader.next()).rejects.toThrow(
          'Real response units are not implemented',
        );
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });
});
