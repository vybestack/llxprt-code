/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { normalizeToAnthropicToolId } from '@vybestack/llxprt-code-tools';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { DebugLogger } from '../../debug/index.js';
import {
  UNIT_CASE_COUNT,
  unitCase,
} from './__tests__/support/normalization-cases.js';
import { JournalSession } from './journalSession.js';
import { encodeContentRow } from './journalRowCodec.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { prepareProviderContentSnapshot } from './provider-curated-stream.js';
import { isCuratedContent } from './historyCuration.js';
import type { IContent } from './IContent.js';
import type { AnthropicToolOccurrenceFacts } from './journal-anthropic-facts.js';

interface Occurrence {
  readonly unit: number;
  readonly block: number;
  readonly rawId: string;
  readonly id: string;
  readonly kind: 'use' | 'result';
}
type ExpectedFacts = Omit<AnthropicToolOccurrenceFacts, 'source' | 'best'>;

function occurrences(rows: readonly IContent[]): readonly Occurrence[] {
  return rows.flatMap((row, unit) =>
    row.blocks.flatMap((block, index): Occurrence[] => {
      if (block.type === 'tool_call' && row.speaker === 'ai')
        return [
          {
            unit,
            block: index,
            rawId: block.id,
            id: normalizeToAnthropicToolId(block.id),
            kind: 'use',
          },
        ];
      if (block.type === 'tool_response')
        return [
          {
            unit,
            block: index,
            rawId: block.callId,
            id: normalizeToAnthropicToolId(block.callId),
            kind: 'result',
          },
        ];
      return [];
    }),
  );
}

function expectedAt(
  reference: readonly Occurrence[],
  index: number,
): readonly ExpectedFacts[] {
  return reference
    .filter(({ unit }) => unit === index)
    .map((at) => {
      const uses = reference.filter(
        (other) => other.id === at.id && other.kind === 'use',
      );
      const results = reference.filter(
        (other) => other.id === at.id && other.kind === 'result',
      );
      return {
        block: at.block,
        rawId: at.rawId,
        id: at.id,
        kind: at.kind,
        uses: uses.length,
        results: results.length,
        usesBefore: uses.filter(({ unit }) => unit < index).length,
        resultsBefore: results.filter(({ unit }) => unit < index).length,
        nextResult: results.find(({ unit }) => unit > index)?.unit,
        orphan: at.kind === 'result' && uses.length === 0,
      };
    });
}

async function expectedRows(seed: number): Promise<readonly IContent[]> {
  const input = unitCase(seed);
  async function* curated(): AsyncGenerator<IContent> {
    for (const row of input.rows) if (isCuratedContent(row)) yield row;
  }
  const old = await prepareProviderContentSnapshot(
    curated(),
    input.tail,
    new DebugLogger('anthropic-native-facts-oracle'),
  );
  try {
    const rows: IContent[] = [];
    for await (const row of old.openReader()) rows.push(row);
    return rows;
  } finally {
    old.close();
  }
}

async function verifyCase(
  session: JournalSession,
  seed: number,
): Promise<void> {
  const input = unitCase(seed);
  const rows = await expectedRows(seed);
  const reference = occurrences(rows);
  await session.store.commit([
    {
      kind: 'replace',
      rows: input.rows.map((row) => encodeContentRow(row, { owner: 0 })),
    },
  ]);
  const pin = await session.store.snapshot();
  const query = await IndexedJournalRequestSnapshot.create(pin, input.tail);
  try {
    expect({ seed, count: query.count }).toStrictEqual({
      seed,
      count: rows.length,
    });
    for (let index = 0; index < rows.length; index++) {
      const actual: readonly ExpectedFacts[] = (
        await query.anthropicToolFactsAt(index)
      ).map(({ source: _source, best: _best, ...facts }) => facts);
      expect({ seed, index, facts: actual }).toStrictEqual({
        seed,
        index,
        facts: expectedAt(reference, index),
      });
    }
  } finally {
    await query.close();
    await pin.close();
  }
}

describe('native Anthropic occurrence facts against independently normalized units', () => {
  const directory = useTempDir('anthropic-facts-differential-');
  let matched = 0;
  for (let first = 0; first < UNIT_CASE_COUNT; first += 500)
    it(`matches normalization source seeds ${first}..${first + 499} including pending overlays`, async () => {
      const session = await JournalSession.create(`${directory()}/facts.llxj`, {
        journal: testJournalSeams().dependencies,
      });
      try {
        for (let seed = first; seed < first + 500; seed++) {
          await verifyCase(session, seed);
          matched++;
        }
        expect(matched).toBe(first + 500);
      } finally {
        await session.close();
      }
    });
  it('visits all 5000 unchanged normalization source cases', () => {
    expect(matched).toBe(UNIT_CASE_COUNT);
    process.stdout.write(
      `Anthropic native occurrence differential ${JSON.stringify({ matched, corpus: 'normalization unit cases, not frozen Anthropic wire bodies', pid: process.pid })}\n`,
    );
  });
});
