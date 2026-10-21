/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { JournalSession } from './journalSession.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import type { IContent } from './IContent.js';

const call = (id: string): IContent => ({
  speaker: 'ai',
  blocks: [{ type: 'tool_call', id, name: 'read', parameters: {} }],
});
const result = (id: string, value: string, isComplete = true): IContent => ({
  speaker: 'tool',
  blocks: [
    {
      type: 'tool_response',
      callId: id,
      toolName: 'read',
      result: value,
      isComplete,
    },
  ],
});

describe('held native Anthropic repair inputs', () => {
  const directory = useTempDir('anthropic-repair-inputs-');

  it('joins normalized occurrences with the selected raw best source without using an emitter', async () => {
    const session = await JournalSession.create(`${directory()}/facts.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([
        call('hist_tool_X'),
        result('hist_tool_X', 'short', false),
        result('hist_tool_X', 'better result'),
      ]);
      const pin = await session.store.snapshot();
      const query = await IndexedJournalRequestSnapshot.create(pin);
      try {
        const use = await query.anthropicToolFactsAt(0);
        const response = await query.anthropicToolFactsAt(1);
        expect(
          use.map(
            ({
              rawId,
              id,
              kind,
              uses,
              results,
              usesBefore,
              resultsBefore,
              nextResult,
            }) => ({
              rawId,
              id,
              kind,
              uses,
              results,
              usesBefore,
              resultsBefore,
              nextResult,
            }),
          ),
        ).toStrictEqual([
          {
            rawId: 'hist_tool_X',
            id: 'toolu_X',
            kind: 'use',
            uses: 1,
            results: 1,
            usesBefore: 0,
            resultsBefore: 0,
            nextResult: 1,
          },
        ]);
        expect(
          response.map(
            ({ rawId, id, kind, usesBefore, resultsBefore, nextResult }) => ({
              rawId,
              id,
              kind,
              usesBefore,
              resultsBefore,
              nextResult,
            }),
          ),
        ).toStrictEqual([
          {
            rawId: 'hist_tool_X',
            id: 'toolu_X',
            kind: 'result',
            usesBefore: 1,
            resultsBefore: 0,
            nextResult: undefined,
          },
        ]);
        const best = use[0].best;
        expect(best).toStrictEqual({
          label: 3145728n,
          part: 0,
          block: 0,
        });
        if (best === undefined) throw new Error('Missing best response source');
        expect(response[0].source).toStrictEqual(best);
        expect(response[0].orphan).toBe(false);
      } finally {
        await query.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  it('keeps duplicate converted-ID prefixes separate from raw best selection and pins append changes', async () => {
    const session = await JournalSession.create(`${directory()}/pins.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([call('hist_tool_X'), call('toolu_X')]);
      const old = await session.store.snapshot();
      const query = await IndexedJournalRequestSnapshot.create(old);
      try {
        const before = await query.anthropicToolFactsAt(0);
        await session.append([result('toolu_X', 'ONE')]);
        const pin = await session.store.snapshot();
        const current = await IndexedJournalRequestSnapshot.create(pin);
        try {
          expect(await query.anthropicToolFactsAt(0)).toStrictEqual(before);
          const first = await current.anthropicToolFactsAt(0);
          const second = await current.anthropicToolFactsAt(2);
          expect(first[0].uses).toBe(2);
          expect(first[0].results).toBe(2);
          expect(first[0].nextResult).toBe(1);
          expect(first[0].best).toBeUndefined();
          expect(second[0].usesBefore).toBe(1);
          expect(second[0].resultsBefore).toBe(1);
          expect(second[0].nextResult).toBe(3);
          expect(second[0].best).toStrictEqual({
            label: 3145728n,
            part: 0,
            block: 0,
          });
        } finally {
          await current.close();
          await pin.close();
        }
      } finally {
        await query.close();
        await old.close();
      }
    } finally {
      await session.close();
    }
  });

  it('counts duplicate uses in one unit without advancing the successor per call', async () => {
    const session = await JournalSession.create(
      `${directory()}/duplicates.llxj`,
      {
        journal: testJournalSeams().dependencies,
      },
    );
    try {
      await session.append([
        {
          speaker: 'ai',
          blocks: [...call('hist_tool_X').blocks, ...call('toolu_X').blocks],
        },
        result('hist_tool_X', 'ONE'),
        result('toolu_X', 'TWO'),
      ]);
      const pin = await session.store.snapshot();
      const query = await IndexedJournalRequestSnapshot.create(pin);
      try {
        const uses = await query.anthropicToolFactsAt(0);
        expect(
          uses.map(({ block, id, usesBefore, nextResult }) => ({
            block,
            id,
            usesBefore,
            nextResult,
          })),
        ).toStrictEqual([
          { block: 0, id: 'toolu_X', usesBefore: 0, nextResult: 1 },
          { block: 1, id: 'toolu_X', usesBefore: 0, nextResult: 1 },
        ]);
        expect(
          uses.map(({ uses, results }) => ({ uses, results })),
        ).toStrictEqual([
          { uses: 2, results: 2 },
          { uses: 2, results: 2 },
        ]);
      } finally {
        await query.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  it('does not treat a non-AI call as an Anthropic use when deciding orphan status', async () => {
    const session = await JournalSession.create(`${directory()}/orphan.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.append([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'q' }, ...call('X').blocks],
        },
        result('X', 'result'),
      ]);
      const pin = await session.store.snapshot();
      const query = await IndexedJournalRequestSnapshot.create(pin);
      try {
        expect(await query.anthropicToolFactsAt(0)).toStrictEqual([]);
        const facts = await query.anthropicToolFactsAt(1);
        expect(
          facts.map(({ kind, uses, results, orphan }) => ({
            kind,
            uses,
            results,
            orphan,
          })),
        ).toStrictEqual([
          { kind: 'result', uses: 0, results: 1, orphan: true },
        ]);
        await query.close();
        await expect(query.anthropicToolFactsAt(1)).rejects.toThrow(/closed/);
      } finally {
        await query.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  for (const count of [40, 4000])
    it(`reads only selected-unit payloads and occurrence paths at ${count} rows`, async () => {
      const counter = { reads: 0 };
      const session = await JournalSession.create(
        `${directory()}/reads-${count}.llxj`,
        {
          journal: testJournalSeams({ readCounter: counter }, 1, false)
            .dependencies,
        },
      );
      try {
        await session.append([
          ...Array.from(
            { length: count },
            (_, index): IContent => ({
              speaker: 'human',
              blocks: [{ type: 'text', text: `q${index}` }],
            }),
          ),
          call('hist_tool_X'),
          result('hist_tool_X', 'ONE'),
        ]);
        const pin = await session.store.snapshot();
        const query = await IndexedJournalRequestSnapshot.create(pin);
        try {
          counter.reads = 0;
          const facts = await query.anthropicToolFactsAt(count);
          expect(facts[0].nextResult).toBe(count + 1);
          expect(facts[0].usesBefore).toBe(0);
          expect(counter.reads).toBeLessThan(150);
          process.stdout.write(
            `Anthropic native occurrence reads ${JSON.stringify({ count, reads: counter.reads, pid: process.pid })}\n`,
          );
        } finally {
          await query.close();
          await pin.close();
        }
      } finally {
        await session.close();
      }
    });
});
