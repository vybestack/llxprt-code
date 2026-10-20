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

const cases: readonly UnitCase[] = [
  {
    id: 'reconstruct-before-later-real-call',
    rows: [
      {
        speaker: 'tool',
        blocks: [response('x')],
        metadata: { model: 'retained' },
      },
      { speaker: 'ai', blocks: [call('x', 'later')] },
    ],
    tail: [],
  },
  {
    id: 'reconstruct-from-tool-name-and-keep-duplicate-block-order',
    rows: [
      {
        speaker: 'tool',
        blocks: [
          response('b'),
          { ...response('a'), toolName: '' },
          { ...response('b'), toolName: 'second' },
        ],
        metadata: { model: 'duplicate' },
      },
      {
        speaker: 'tool',
        blocks: [{ ...response('b'), result: 'better', isComplete: true }],
      },
    ],
    tail: [],
  },
  {
    id: 'earliest-human-response-attaches-to-later-reconstructed-unit',
    rows: [
      {
        speaker: 'human',
        blocks: [response('a'), { type: 'text', text: 'retained' }],
      },
      { speaker: 'tool', blocks: [response('a')], metadata: { model: 'tool' } },
    ],
    tail: [],
  },
  {
    id: 'empty-id-reconstructs-only-once-across-speakers',
    rows: [
      { speaker: 'human', blocks: [response('')] },
      { speaker: 'tool', blocks: [response(''), response('')] },
      { speaker: 'tool', blocks: [response('')] },
      { speaker: 'ai', blocks: [call('')] },
    ],
    tail: [],
  },
  {
    id: 'earlier-human-empty-call-prevents-reconstruction',
    rows: [
      { speaker: 'human', blocks: [call('')] },
      { speaker: 'tool', blocks: [response('')] },
    ],
    tail: [],
  },
  {
    id: 'next-reconstruction-displaces-retained-metadata',
    rows: [
      { speaker: 'ai', blocks: [call('a')] },
      {
        speaker: 'tool',
        blocks: [response('a'), response('b')],
        metadata: { model: 'must-reorder' },
      },
    ],
    tail: [],
  },
  {
    id: 'reconstructed-media-first-response-target-and-split-coordinates',
    rows: [
      {
        speaker: 'tool',
        blocks: [
          response('a'),
          call('b'),
          response('b'),
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'YWJj',
            encoding: 'base64',
          },
        ],
        metadata: { model: 'split' },
      },
    ],
    tail: [],
  },
];

describe('indexed reconstructed call units', () => {
  const directory = useTempDir('journal-reconstruction-');
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
});
