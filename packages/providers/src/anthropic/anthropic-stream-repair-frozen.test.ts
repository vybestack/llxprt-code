/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { recordedMessages as emittedCandidate } from './message-table/__tests__/support/recorded-wire-oracle.js';
import { describe, expect, it } from 'bun:test';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { isCuratedContent } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import {
  caseOf,
  formatById,
  SEEDS_PER_FORMAT,
} from '../__tests__/support/frozenWire/frozenCases.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import { type WireSettings } from './message-table/__tests__/support/wireBuilderHarness.js';
import { wireSettingsOf } from './message-table/__tests__/support/lengthModel/frozenInputs.js';
import {
  analyze,
  lcg,
} from './message-table/__tests__/support/lengthModel/lengthChecks.js';
import { withAnthropicStreamRepair } from './anthropic-stream-repair.js';

function checkpoint(matched: number): void {
  if (matched % 100 === 0)
    process.stdout.write(`Native byte cases matched ${matched}\n`);
}

async function nativeOutput(
  session: JournalSession,
  rows: readonly IContent[],
  settings: RowFormatSettings,
  wire: WireSettings,
): Promise<{
  readonly wire: string;
  readonly bytes: number;
  readonly messages: number;
}> {
  await session.store.commit([
    {
      kind: 'replace',
      rows: rows.map((row) => encodeContentRow(row, { owner: 0 })),
    },
    { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
  ]);
  const pin = await session.store.snapshot();
  const query = await IndexedJournalRequestSnapshot.create(pin);
  try {
    return await withAnthropicStreamRepair(
      query,
      settings,
      wire,
      async (engine) => {
        let actual = '';
        for await (const chunk of engine.serialize()) actual += chunk;
        return { wire: actual, ...(await engine.measure()) };
      },
    );
  } finally {
    await query.close();
    await pin.close();
  }
}

describe('actual native Anthropic cache-off wire parity', () => {
  const directory = useTempDir('anthropic-stream-frozen-');
  let matched = 0;
  let thinking = 0;
  let repaired = 0;
  let chained = 0;
  let lastKept = 0;
  for (let first = 0; first < SEEDS_PER_FORMAT; first += 500) {
    it(`compares all normalized frozen source histories ${first}..${first + 499} without oracle overlays`, async () => {
      const session = await JournalSession.create(
        `${directory()}/repair.llxj`,
        { journal: testJournalSeams({}, 1, false).dependencies },
      );
      try {
        for (let seed = first; seed < first + 500; seed++) {
          const frozen = await caseOf(formatById('anthropic-cache-off'), seed);
          const rows = await normalizedRows(
            frozen.rows.filter(isCuratedContent),
          );
          const wire = wireSettingsOf(
            frozen.settings.model,
            frozen.settings.ephemerals,
          );
          const settings: RowFormatSettings = {
            formatId: 'anthropic',
            formatRev: 1,
            model: frozen.settings.model,
            endpoint: 'https://api.anthropic.com',
            isOAuth: false,
            toolNameTransform: 'none',
            supportsUrlImages: true,
            reasoningEnabled: wire.reasoningEnabled,
            reasoningFieldName: 'reasoning_content',
            mediaPdfEnabled: true,
            unsupportedMedia: 'notice',
            outputLimits: null,
            anthropic: { cache: 'off', imageBudget: wire.imageBudget ?? null },
          };
          const expected = await emittedCandidate(rows, wire, {});
          const phaseZero = analyze(rows, wire, {}, lcg(seed));
          expect({ seed, wire: expected }).toStrictEqual({
            seed,
            wire: phaseZero.reference.json,
          });
          expect({
            seed,
            ...(await nativeOutput(session, frozen.rows, settings, wire)),
          }).toStrictEqual({
            seed,
            wire: expected,
            bytes: Buffer.byteLength(expected),
            messages: phaseZero.predictedMessages,
          });
          matched++;
          thinking += Number(wire.reasoningEnabled);
          repaired += Number(phaseZero.repaired);
          chained += Number(phaseZero.chained);
          lastKept += Number(phaseZero.lastKept);
          checkpoint(matched);
        }
        expect(matched).toBe(first + 500);
      } finally {
        await session.close();
      }
    });
  }
  it('covers the entire unchanged source corpus in the independently normalized domain', () => {
    expect(matched).toBe(SEEDS_PER_FORMAT);
    expect(thinking).toBeGreaterThan(100);
    expect(repaired).toBeGreaterThan(100);
    expect(chained).toBeGreaterThan(100);
    expect(lastKept).toBeGreaterThan(100);
    process.stdout.write(
      `Actual native Anthropic parity ${JSON.stringify({ matched, thinking, repaired, chained, lastKept, domain: 'independently normalized frozen source histories, not original raw frozen bodies', pid: process.pid })}\n`,
    );
  });
});
