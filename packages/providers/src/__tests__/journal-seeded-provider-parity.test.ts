/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import {
  FROZEN_FORMATS,
  formatById,
  rawHistoryOf,
  settingsOf,
  type FrozenFormat,
} from './support/frozenWire/frozenCases.js';
import {
  describeCaseDifference,
  fixtureCaseOf,
  readFrozenFixture,
} from './support/frozenWire/frozenFixture.js';
import {
  recordBody,
  type CaseOutcome,
} from './support/frozenWire/frozenSend.js';
import {
  eagerProviderOracle,
  withJournalProviderSelection,
} from './support/journal-provider-fixture.js';
import {
  recordOf,
  sendThroughRoute,
  type WireRoute,
} from './support/wireBodyCapture.js';
import type { HistoryCase } from './support/wireBodyHistories.js';
import { PINNED_CLOCK } from './support/wireBodyFixtures.js';

function seededRequest(
  format: FrozenFormat,
  seed: number,
): { input: HistoryCase; route: WireRoute } {
  const settings = settingsOf(format, seed);
  return {
    input: {
      id: `seed-${seed}`,
      description: 'native frozen normalized corpus sample',
      rows: rawHistoryOf(format, seed),
      ephemerals: settings.ephemerals,
      ...(settings.systemInstruction === null
        ? {}
        : { systemInstruction: settings.systemInstruction }),
    },
    route: {
      ...format.route,
      model: settings.model,
      providerSettings: {
        ...format.route.providerSettings,
        ...settings.providerSettings,
      },
    },
  };
}

async function outcome(
  format: FrozenFormat,
  seed: number,
  source: 'history' | 'provider-only' | 'eager',
): Promise<CaseOutcome> {
  const { input, route } = seededRequest(format, seed);
  try {
    const request =
      source === 'eager'
        ? await sendThroughRoute(route, eagerProviderOracle(input), 'rows')
        : await withJournalProviderSelection(
            input,
            (selection) =>
              sendThroughRoute(route, input, 'rows', undefined, selection),
            source,
          );
    recordOf(request);
    return recordBody(request.bytes, format.historyMember);
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}

describe('native HistoryService seeded frozen provider sample', () => {
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(() => setSystemTime());

  for (const format of FROZEN_FORMATS.filter((entry) => !entry.purgeCorpus)) {
    const fixture = readFrozenFixture(format.id);
    const seeds = Array.from({ length: 32 }, (_, seed) => seed)
      .filter((seed) => settingsOf(format, seed).form === 'normalized')
      .slice(0, 4);
    describe(`format ${format.id}`, () => {
      for (const seed of seeds) {
        it(`seed ${seed} preserves the frozen provider-only normalization boundary from native rows`, async () => {
          const expected = fixture.cases[seed];
          expect(fixture.settings[expected[1]]).toStrictEqual(
            settingsOf(format, seed),
          );
          const actual = fixtureCaseOf(
            seed,
            expected[1],
            await outcome(format, seed, 'provider-only'),
          );
          expect(describeCaseDifference(expected, actual)).toBeUndefined();
        });
        it(`seed ${seed} matches independent old history curation and builder bytes`, async () => {
          expect(await outcome(format, seed, 'history')).toStrictEqual(
            await outcome(format, seed, 'eager'),
          );
        });
      }
    });
  }

  it('rejects a provider-only frozen expectation after history curation excludes invalid AI rows', async () => {
    const format = formatById('openai-chat-plain');
    const expected = readFrozenFixture(format.id).cases[3];
    const actual = fixtureCaseOf(
      3,
      expected[1],
      await outcome(format, 3, 'history'),
    );
    expect(describeCaseDifference(expected, actual)).toContain('expected');
  });
});
