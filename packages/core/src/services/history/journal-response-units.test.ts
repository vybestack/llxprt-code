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
import { streamJournalResponseUnits } from './journal-response-units.js';
import type { IContent, MediaBlock } from './IContent.js';

const media = (data: string): MediaBlock => ({
  type: 'media',
  mimeType: 'image/png',
  data,
  encoding: 'base64',
});
const cases: readonly UnitCase[] = [
  {
    id: 'retained-metadata',
    rows: [
      { speaker: 'ai', blocks: [call('a')] },
      {
        speaker: 'tool',
        blocks: [response('a'), media('YWJj')],
        metadata: { model: 'source', cacheAnchor: true },
      },
    ],
    tail: [],
  },
  {
    id: 'stable-best-tie',
    rows: [
      { speaker: 'ai', blocks: [call('a')] },
      {
        speaker: 'tool',
        blocks: [{ ...response('a'), result: 'first' }],
        metadata: { model: 'first' },
      },
      {
        speaker: 'tool',
        blocks: [{ ...response('a'), result: 'equal-score-later' }],
      },
    ],
    tail: [],
  },
  {
    id: 'better-duplicate-changes-metadata-not-media',
    rows: [
      { speaker: 'ai', blocks: [call('a')] },
      {
        speaker: 'tool',
        blocks: [response('a', false), media('YWJj')],
        metadata: { model: 'first' },
      },
      {
        speaker: 'tool',
        blocks: [{ ...response('a'), result: 'better' }, media('ZGVm')],
      },
    ],
    tail: [],
  },
  {
    id: 'human-call-tool-result',
    rows: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'question' }, call('a')],
      },
      { speaker: 'tool', blocks: [response('a')] },
    ],
    tail: [],
  },
  {
    id: 'human-result-moves-and-strips',
    rows: [
      { speaker: 'ai', blocks: [call('a')] },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'keep' }, response('a'), media('YWJj')],
      },
    ],
    tail: [],
  },
  {
    id: 'first-response-order-not-call-order',
    rows: [
      { speaker: 'ai', blocks: [call('a'), call('b'), call('a', 'duplicate')] },
      { speaker: 'tool', blocks: [response('b'), media('YWJj')] },
      { speaker: 'tool', blocks: [response('a'), media('ZGVm')] },
    ],
    tail: [],
  },
  {
    id: 'media-goes-to-first-new-target',
    rows: [
      { speaker: 'ai', blocks: [call('a')] },
      { speaker: 'ai', blocks: [call('b')] },
      {
        speaker: 'tool',
        blocks: [response('b'), response('a'), media('YWJj'), media('ZGVm')],
      },
    ],
    tail: [],
  },
  {
    id: 'interleaved-media-is-reordered',
    rows: [
      { speaker: 'ai', blocks: [call('a'), call('b')] },
      {
        speaker: 'tool',
        blocks: [response('a'), media('YWJj'), response('b'), media('ZGVm')],
        metadata: { model: 'not-retained' },
      },
    ],
    tail: [],
  },
  {
    id: 'split-source-actual-block-indices',
    rows: [
      {
        speaker: 'tool',
        blocks: [media('YWJj'), call('a'), response('a')],
        metadata: { model: 'split' },
      },
    ],
    tail: [],
  },
  {
    id: 'raw-prefix-collisions-and-empty',
    rows: [
      {
        speaker: 'ai',
        blocks: [
          call(''),
          call('call_x'),
          call('hist_tool_x'),
          call('toolu_x'),
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          response('toolu_x'),
          response(''),
          response('hist_tool_x'),
          response('call_x'),
        ],
      },
    ],
    tail: [],
  },
  {
    id: 'mixed-real-and-orphan-completion',
    rows: [
      { speaker: 'ai', blocks: [call('a'), call('b')] },
      { speaker: 'tool', blocks: [response('a')] },
    ],
    tail: [],
  },
  {
    id: 'duplicate-orphans-retention',
    rows: [
      { speaker: 'ai', blocks: [call('a'), call('a', 'second'), call('b')] },
    ],
    tail: [],
  },
];

describe('indexed existing-call response units', () => {
  const directory = useTempDir('journal-response-units-');
  for (const input of cases) {
    it(`matches old units for ${input.id}`, async () => {
      const expected = await oldUnits(input);
      const session = await JournalSession.create(
        `${directory()}/${input.id}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        await session.append(input.rows);
        const snapshot = await session.store.snapshot();
        try {
          const units = await collectUnits(
            streamJournalResponseUnits(snapshot),
          );
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

  it('holds the version through asynchronous consumption after the opener closes it', async () => {
    const session = await JournalSession.create(`${directory()}/pin.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    const original: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('a')] },
      { speaker: 'tool', blocks: [response('a')] },
    ];
    try {
      await session.append(original);
      const expected = await oldUnits({ id: 'pin', rows: original, tail: [] });
      const snapshot = await session.store.snapshot();
      const reader = streamJournalResponseUnits(snapshot);
      const first = await reader.next();
      await snapshot.close();
      await session.append([
        {
          speaker: 'tool',
          blocks: [{ ...response('a'), result: 'later-tie' }],
        },
      ]);
      const units = first.done === true ? [] : [first.value];
      for await (const unit of reader) {
        await Promise.resolve();
        units.push(unit);
      }
      expect(digest(units)).toBe(expected.outputHash);
      await expect(snapshot.facts.fact('a')).rejects.toThrow(
        'pin was released',
      );
    } finally {
      await session.close();
    }
  });
});
