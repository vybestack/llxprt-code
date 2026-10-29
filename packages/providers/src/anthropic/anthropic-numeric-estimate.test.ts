/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { estimatorCorpus } from '../__tests__/support/estimatorCorpus.js';
import { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import { NativeAnthropicEstimateProjection } from './native-anthropic-estimate.js';
import { getO200kBaseEncoder } from '../tokenizers/o200kBaseCounter.js';
import type { AnthropicCachePlan } from './anthropic-cache-facts.js';

const settings: RowFormatSettings = {
  formatId: 'anthropic',
  formatRev: 1,
  model: 'claude-sonnet-4-5',
  endpoint: 'https://api.anthropic.com',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: true,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
  anthropic: { cache: 'off', imageBudget: null },
};
const punctuation: IContent[] = [
  'hello   ',
  '....!?',
  '雪\\"\n',
  '<|endoftext|>',
  '',
  "we're at ",
  'a'.repeat(20000),
].flatMap((text) => [
  { speaker: 'human', blocks: [{ type: 'text', text }] } satisfies IContent,
  { speaker: 'ai', blocks: [{ type: 'text', text }] } satisfies IContent,
]);
async function assertParity(
  engine: AnthropicStreamRepair,
  encoder: Awaited<ReturnType<typeof getO200kBaseEncoder>>,
  ttl: '5m' | '1h' | undefined,
): Promise<number> {
  const cache: AnthropicCachePlan | undefined =
    ttl === undefined
      ? undefined
      : {
          ttl,
          bytes: 0,
          targets: [
            { run: 0, block: 0, string: false },
            { run: 1, block: 0, string: true },
          ],
        };
  const envelope = {
    system: 'Test 雪',
    messages: [],
    tools: [{ name: 'tool', input_schema: { type: 'object' } }],
  };
  const projection = new NativeAnthropicEstimateProjection(
    engine,
    envelope,
    undefined,
    undefined,
    cache,
  );
  const oracle = new NativeAnthropicEstimateProjection(
    { serialize: engine.serialize.bind(engine) },
    envelope,
    undefined,
    undefined,
    cache,
  );
  const request = {
    activeProvider: 'anthropic',
    canonicalModel: settings.model,
    protocol: 'anthropic-messages',
    wireMethod: 'messages/v1',
    finalizedProjection: projection,
    projectionRevision: 4,
    legacyEstimate: async () => 0,
  } satisfies import('@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js').RuntimePromptEstimateRequest;
  const expected = await oracle.measure(request, encoder);
  const reads = spyOn(IndexedJournalRequestSnapshot.prototype, 'readAt');
  try {
    const measured = await projection.measure(request, encoder);
    expect(measured).toStrictEqual(expected);
    expect(reads.mock.calls.length).toBe(0);
    return measured.baseTokens;
  } finally {
    reads.mockRestore();
    await projection.dispose();
    await oracle.dispose();
  }
}
async function assertCacheParities(
  engine: AnthropicStreamRepair,
  encoder: Awaited<ReturnType<typeof getO200kBaseEncoder>>,
): Promise<number> {
  const ttls: ReadonlyArray<'5m' | '1h' | undefined> = [undefined, '5m', '1h'];
  let tokens = 0;
  for (const ttl of ttls) tokens += await assertParity(engine, encoder, ttl);
  return tokens;
}

describe('persisted Anthropic estimate composition', () => {
  const directory = useTempDir('anthropic-numeric-estimate-');
  for (const entry of [
    ...estimatorCorpus(),
    ...punctuation.map((row, index) => ({ id: `edge-${index}`, rows: [row] })),
    { id: 'punctuation', rows: punctuation },
  ]) {
    it(`matches joined tokenization and all content signals without decoding ${entry.id}`, async () => {
      expect.hasAssertions();
      const session = await JournalSession.create(
        `${directory()}/${entry.id}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      await session.append(entry.rows);
      await session.store.commit([
        { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
      ]);
      const snapshot = await session.store.snapshot();
      const query = await IndexedJournalRequestSnapshot.create(snapshot);
      try {
        const encoder = await getO200kBaseEncoder();
        const strips: ReadonlyArray<'none' | 'all' | 'allButLast'> = [
          'none',
          'all',
          'allButLast',
        ];
        for (const strip of strips) {
          const engine = await AnthropicStreamRepair.create(query, settings, {
            strip,
          });
          expect(await assertCacheParities(engine, encoder)).toBeGreaterThan(0);
        }
      } finally {
        await query.close();
        await snapshot.close();
        await session.close();
      }
    }, 180000);
  }
});
