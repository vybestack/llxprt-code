/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { JournalSession } from './journalSession.js';
import { JournalTailSource } from './journal-tail-source.js';
import { journalEntryPlans } from './journal-entry-plans.js';
import { readTokenUsagePlan } from './token-usage-facts.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { IContent } from './IContent.js';

async function readPlans(
  source: JournalTailSource,
  entry: RowEntry,
): Promise<IContent[]> {
  const values: IContent[] = [];
  for await (const plan of journalEntryPlans(source, entry))
    values.push(await readTokenUsagePlan(plan));
  return values;
}

async function withSource(
  row: IContent,
  action: (source: JournalTailSource, entry: RowEntry) => Promise<void>,
): Promise<void> {
  const session = await JournalSession.createUnlinked();
  try {
    await session.append([
      row,
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'unrelated successor' }],
      },
    ]);
    const snapshot = await session.store.snapshot();
    try {
      await action(
        await JournalTailSource.create(snapshot, []),
        await snapshot.entryAt(0),
      );
    } finally {
      await snapshot.close();
    }
  } finally {
    await session.close();
  }
}

describe('entry-local request plan reads', () => {
  it('does not decode a successor when the source has no call or response blocks', async () => {
    await withSource(
      { speaker: 'human', blocks: [{ type: 'text', text: 'local value' }] },
      async (source, entry) => {
        const reads = spyOn(source, 'readIds');
        try {
          const values = await readPlans(source, entry);
          expect(values).toHaveLength(1);
          expect(values[0].speaker).toBe('human');
          expect(values[0].blocks).toStrictEqual([
            { type: 'text', text: 'local value' },
          ]);
          expect(
            reads.mock.calls.filter(([row]) => row.label !== entry.label),
          ).toHaveLength(0);
        } finally {
          reads.mockRestore();
        }
      },
    );
  });

  it('reconstructs a response-only row without reading the following row', async () => {
    await withSource(
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'lost',
            toolName: 'inspect',
            result: 'value',
          },
        ],
      },
      async (source, entry) => {
        const reads = spyOn(source, 'readIds');
        try {
          const values = await readPlans(source, entry);
          expect(values.map((row) => row.speaker)).toStrictEqual([
            'ai',
            'tool',
          ]);
          expect(values.flatMap((row) => row.blocks)).toStrictEqual([
            {
              type: 'tool_call',
              id: 'lost',
              name: 'inspect',
              parameters: { reconstructed: true },
              description: 'Reconstructed tool call after compression',
            },
            {
              type: 'tool_response',
              callId: 'lost',
              toolName: 'inspect',
              result: 'value',
            },
          ]);
          expect(
            reads.mock.calls.filter(([row]) => row.label !== entry.label),
          ).toHaveLength(0);
        } finally {
          reads.mockRestore();
        }
      },
    );
  });
});
