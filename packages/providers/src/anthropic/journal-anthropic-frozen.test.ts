/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { recordedMessages as emittedCandidate } from './__tests__/wire-reference/support/recorded-wire-oracle.js';
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { isCuratedContent } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import {
  caseOf,
  formatById,
  SEEDS_PER_FORMAT,
} from '../__tests__/support/frozenWire/frozenCases.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';

import { wireSettingsOf } from './__tests__/wire-reference/support/lengthModel/frozenInputs.js';
import {
  analyze,
  lcg,
} from './__tests__/wire-reference/support/lengthModel/lengthChecks.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import {
  anthropicLengthRegistration,
  planStoredAnthropicRequest,
} from './journal-anthropic-length.js';

async function checkSeed(
  path: string,
  seed: number,
): Promise<{
  thinking: boolean;
  repaired: boolean;
  chained: boolean;
  lastKept: boolean;
}> {
  const frozen = await caseOf(formatById('anthropic-cache-off'), seed);
  const rows = await normalizedRows(frozen.rows.filter(isCuratedContent));
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
  const session = await JournalSession.create(path, {
    journal: testJournalSeams({}, 1, false).dependencies,
  });
  try {
    await session.store.commit([
      {
        kind: 'replace',
        rows: frozen.rows.map((row) => encodeContentRow(row, { owner: 0 })),
      },
      { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
    ]);
    await session.registerRowFormat(anthropicLengthRegistration(settings));
    const pin = await session.store.snapshot();
    try {
      const request = {
        model: settings.model,
        max_tokens: 123,
        system: 'system 雪',
        stream: true,
      };
      const actual = await planStoredAnthropicRequest(
        pin,
        settings,
        wire,
        request,
      );
      expect({
        seed,
        bytes: actual.messagesBytes,
        messages: actual.messages,
        contentLength: actual.contentLength,
      }).toStrictEqual({
        seed,
        bytes: Buffer.byteLength(expected),
        messages: phaseZero.predictedMessages,
        contentLength: Buffer.byteLength(
          JSON.stringify({ ...request, messages: JSON.parse(expected) }),
        ),
      });
    } finally {
      await pin.close();
    }
  } finally {
    await session.close();
  }
  return {
    thinking: wire.reasoningEnabled,
    repaired: phaseZero.repaired,
    chained: phaseZero.chained,
    lastKept: phaseZero.lastKept,
  };
}
describe('actual stored Anthropic native cache-off transfers', () => {
  const directory = useTempDir('stored-anthropic-frozen-');
  let matched = 0;
  let thinking = 0;
  let repaired = 0;
  let chained = 0;
  let lastKept = 0;
  for (let first = 0; first < SEEDS_PER_FORMAT; first += 500) {
    it(`compares stored lengths against independent normalized bytes for histories ${first}..${first + 499}`, async () => {
      for (let seed = first; seed < first + 500; seed++) {
        const result = await checkSeed(`${directory()}/${seed}.llxj`, seed);
        matched++;
        thinking += Number(result.thinking);
        repaired += Number(result.repaired);
        chained += Number(result.chained);
        lastKept += Number(result.lastKept);
        if (matched % 100 === 0)
          process.stdout.write(`Stored native matched ${matched}\n`);
      }
      expect(matched).toBe(first + 500);
    });
  }
  it('covers the unchanged full normalized frozen corpus', () => {
    expect(matched).toBe(SEEDS_PER_FORMAT);
    expect(thinking).toBeGreaterThan(100);
    expect(repaired).toBeGreaterThan(100);
    expect(chained).toBeGreaterThan(100);
    expect(lastKept).toBeGreaterThan(100);
    process.stdout.write(
      `Stored Anthropic parity ${JSON.stringify({ matched, thinking, repaired, chained, lastKept, domain: 'normalized source histories, not raw original frozen bodies', pid: process.pid })}\n`,
    );
  });
});
