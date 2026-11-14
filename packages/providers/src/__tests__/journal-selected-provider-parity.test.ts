/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import { createCorpus, GoldenRecorder } from './support/wireBodyCorpus.js';
import {
  WIRE_ROUTES,
  recordOf,
  sendThroughRoute,
  type WireBodyRecord,
  type WireRoute,
} from './support/wireBodyCapture.js';
import {
  PINNED_CLOCK,
  describeDifference,
} from './support/wireBodyFixtures.js';
import { withJournalProviderSelection } from './support/journal-provider-fixture.js';
import type { HistoryCase } from './support/wireBodyHistories.js';

const corpus = await createCorpus();
const logger = new DebugLogger('native-selected-oracle');
const frozen = new GoldenRecorder(false);

function eagerProviderHistory(input: HistoryCase): HistoryCase {
  return {
    ...input,
    rows: buildProviderContent(
      buildCuratedHistory(logger, structuredClone([...input.rows]), false),
      [],
      logger,
    ),
  };
}

async function captureNative(
  route: WireRoute,
  input: HistoryCase,
): Promise<WireBodyRecord> {
  return withJournalProviderSelection(input, async (selection) =>
    recordOf(
      await sendThroughRoute(route, input, 'rows', corpus.binding, selection),
    ),
  );
}

describe('native selected provider request parity', () => {
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(async () => {
    setSystemTime();
    await corpus.dispose();
  });

  for (const route of WIRE_ROUTES) {
    describe(`route ${route.id}`, () => {
      for (const input of corpus.histories) {
        it(`${input.id} matches independent eager curation through the existing builder`, async () => {
          const expected = recordOf(
            await sendThroughRoute(
              route,
              eagerProviderHistory(input),
              'rows',
              corpus.binding,
            ),
          );
          const actual = await captureNative(route, input);
          expect(describeDifference(expected, actual)).toBeUndefined();
        });
      }
      it('text-only selection matches the untouched frozen request oracle', async () => {
        const input = corpus.histories[0];
        expect(
          frozen.check(
            route.id,
            input.id,
            'rows',
            await captureNative(route, input),
          ),
        ).toBeUndefined();
      });
    });
  }

  it('rejects a changed committed row against the frozen request oracle', async () => {
    const input = corpus.histories[0];
    const changed: HistoryCase = {
      ...input,
      rows: [
        ...input.rows,
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'changed native row' }],
        },
      ],
    };
    expect(
      frozen.check(
        WIRE_ROUTES[0].id,
        input.id,
        'rows',
        await captureNative(WIRE_ROUTES[0], changed),
      ),
    ).toContain('bytes differ');
  });

  it('rejects changed settings with the same committed native rows', async () => {
    const input = corpus.histories[0];
    const changed = {
      ...input,
      systemInstruction: 'changed native system instruction',
    };
    expect(
      frozen.check(
        WIRE_ROUTES[0].id,
        input.id,
        'rows',
        await captureNative(WIRE_ROUTES[0], changed),
      ),
    ).toContain('bytes differ');
  });
});
