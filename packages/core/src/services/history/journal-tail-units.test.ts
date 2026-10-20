/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from './journalSession.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { oldUnits, digest } from './__tests__/support/normalization-oracle.js';
import {
  call,
  response,
  type UnitCase,
} from './__tests__/support/normalization-cases.js';
import { streamJournalResponseUnitRecords } from './journal-response-units.js';
import type { IContent } from './IContent.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';

const shared = response('alias');
const cases: readonly UnitCase[] = [
  {
    id: 'tail-response-resolves-journal-orphan',
    rows: [{ speaker: 'ai', blocks: [call('a')] }],
    tail: [
      { speaker: 'tool', blocks: [response('a')], metadata: { model: 'tail' } },
    ],
  },
  {
    id: 'tail-best-wins-at-first-journal-call',
    rows: [
      { speaker: 'ai', blocks: [call('a')] },
      { speaker: 'tool', blocks: [response('a', false)] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'gap' }] },
    ],
    tail: [
      { speaker: 'tool', blocks: [{ ...response('a'), result: 'winner' }] },
    ],
  },
  {
    id: 'tail-tie-keeps-journal-best-and-is-not-pending',
    rows: [
      { speaker: 'ai', blocks: [call('a')] },
      {
        speaker: 'tool',
        blocks: [response('a')],
        metadata: { model: 'journal' },
      },
    ],
    tail: [
      { speaker: 'tool', blocks: [{ ...response('a'), result: 'later' }] },
    ],
  },
  {
    id: 'tail-orphan-at-ai-attaches-to-first-human-call',
    rows: [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q' }, call('a')] },
    ],
    tail: [{ speaker: 'ai', blocks: [call('a')] }],
  },
  {
    id: 'tail-reconstructs-raw-normalized-collisions-and-empty',
    rows: [{ speaker: 'human', blocks: [{ type: 'text', text: 'q' }] }],
    tail: [
      {
        speaker: 'tool',
        blocks: [
          response('call_x'),
          response('toolu_x'),
          response('hist_tool_x'),
          response(''),
          response(''),
        ],
      },
    ],
  },
  {
    id: 'journal-reconstruction-keeps-target-with-tail-duplicate',
    rows: [{ speaker: 'tool', blocks: [response('a', false)] }],
    tail: [
      { speaker: 'tool', blocks: [response('a')] },
      { speaker: 'ai', blocks: [call('a')] },
    ],
  },
  {
    id: 'tail-media-first-source-remains-after-tail-best',
    rows: [
      { speaker: 'ai', blocks: [call('a')] },
      {
        speaker: 'tool',
        blocks: [
          response('a', false),
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'YWJj',
            encoding: 'base64',
          },
        ],
      },
    ],
    tail: [
      {
        speaker: 'human',
        blocks: [
          { ...response('a'), result: 'best' },
          { type: 'text', text: 'keep' },
        ],
      },
    ],
  },
  {
    id: 'empty-tail-ai-is-not-curated-away',
    rows: [],
    tail: [{ speaker: 'ai', blocks: [] }],
  },
  {
    id: 'tail-shared-block-retains-source-metadata',
    rows: [{ speaker: 'ai', blocks: [call('alias')] }],
    tail: [
      { speaker: 'tool', blocks: [shared], metadata: { model: 'first' } },
      { speaker: 'tool', blocks: [shared], metadata: { model: 'second' } },
    ],
  },
];

async function collectRecords(
  snapshot: VersionSnapshot,
  tail: readonly IContent[],
): Promise<{ readonly units: IContent[]; readonly pending: boolean[] }> {
  const units: IContent[] = [];
  const pending: boolean[] = [];
  for await (const unit of streamJournalResponseUnitRecords(snapshot, tail)) {
    units.push(unit.content);
    pending.push(unit.pending);
  }
  return { units, pending };
}

describe('journal tail virtual facts and pending origins', () => {
  const directory = useTempDir('journal-tail-');
  for (const input of cases) {
    it(`matches old output and pending membership for ${input.id}`, async () => {
      const expected = await oldUnits(input);
      const session = await JournalSession.create(
        `${directory()}/${input.id}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        await session.append(input.rows);
        const snapshot = await session.store.snapshot();
        try {
          const { units, pending } = await collectRecords(snapshot, input.tail);
          const first = pending.indexOf(true);
          expect({
            hash: digest(units),
            count: units.length,
            pending,
            firstOutputIndex: first < 0 ? undefined : first,
          }).toStrictEqual({
            hash: expected.outputHash,
            count: expected.count,
            pending: [...expected.pending],
            firstOutputIndex: expected.firstOutputIndex,
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
