/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { recordedMessages as emittedCandidate } from './message-table/__tests__/support/recorded-wire-oracle.js';
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { isCuratedContent } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import {
  caseOf,
  formatById,
  SEEDS_PER_FORMAT,
} from '../__tests__/support/frozenWire/frozenCases.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';

import { wireSettingsOf } from './message-table/__tests__/support/lengthModel/frozenInputs.js';
import {
  analyze,
  lcg,
} from './message-table/__tests__/support/lengthModel/lengthChecks.js';
import type { AtomFact } from './message-table/__tests__/support/lengthModel/unitFacts.js';
import {
  anthropicUnitFacts,
  anthropicUnitTransfer,
  finalizeAnthropicTransfer,
  type AnthropicAtom,
} from './anthropic-unit-transfer.js';

function atomOf(atom: AtomFact): AnthropicAtom {
  const role = atom.role === 'U' ? 'user' : 'assistant';
  if (atom.str !== undefined)
    return {
      role,
      form: 'string',
      bytes: atom.str.bytes,
      blank: atom.str.blank,
      anchored: atom.str.anchored,
    };
  return {
    role,
    form: 'array',
    blocks: (atom.blocks ?? []).map((block) => ({
      kind: block.kind,
      bytes: block.bytes,
      blank: block.blank,
      id: block.id,
      anchored: block.anchored,
    })),
  };
}
const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

describe('Anthropic numeric transfers on all frozen cache-off source histories', () => {
  let matched = 0;
  let repaired = 0;
  let chained = 0;
  let lastKept = 0;
  for (let first = 0; first < SEEDS_PER_FORMAT; first += 500)
    it(`compares normalized seeds ${first}..${first + 499} with the old emitter and independent phase-zero model`, async () => {
      for (let seed = first; seed < first + 500; seed++) {
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
        const analysis = analyze(rows, wire, {}, lcg(seed));
        const facts = rows.flatMap((row) => {
          const fact = anthropicUnitFacts(row, settings);
          return fact === undefined ? [] : [fact];
        });
        expect(facts.length).toBe(analysis.reference.overlay.length);
        let summary = identitySlotSummary('anthropic');
        for (const [at, unit] of facts.entries()) {
          const overlay = analysis.reference.overlay[at];
          const transfer = anthropicUnitTransfer(unit, BigInt(at + 1), {
            drop: overlay.drop,
            vanish: overlay.vanish,
            after: new Map(
              [...overlay.after].map(([index, atom]) => [index, atomOf(atom)]),
            ),
          });
          const selected =
            transfer.variants[analysis.reference.asm.redacted[at] ? 1 : 0];
          summary = composeSlotSummaries(summary, {
            ...transfer,
            variants: [selected, selected],
          });
        }
        if (summary.kind !== 'anthropic') throw new Error('Missing transfer');
        const actual = finalizeAnthropicTransfer(summary.variants[0], settings);
        const written = await emittedCandidate(rows, wire, {});
        expect({
          seed,
          bytes: actual.bytes,
          messages: actual.messages,
        }).toStrictEqual({
          seed,
          bytes: Buffer.byteLength(written),
          messages: analysis.predictedMessages,
        });
        expect(actual.bytes).toBe(analysis.predicted);
        expect(hash(written)).toBe(hash(analysis.reference.json));
        matched++;
        repaired += Number(analysis.repaired);
        chained += Number(analysis.chained);
        lastKept += Number(analysis.lastKept);
      }
      expect(matched).toBe(first + 500);
    });
  it('accounts for all source inputs including repaired, chained and last-kept cases without exclusions', () => {
    expect(matched).toBe(SEEDS_PER_FORMAT);
    expect(repaired).toBeGreaterThan(100);
    expect(chained).toBeGreaterThan(100);
    expect(lastKept).toBeGreaterThan(100);
    process.stdout.write(
      `Anthropic numeric transfers ${JSON.stringify({ matched, repaired, chained, lastKept, globalOverlay: 'phase-zero reference, NOT native facts', pid: process.pid })}\n`,
    );
  });
});
