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
  captureRequestDump,
  rejectedResponse,
} from './support/chatSendCapture.js';
import {
  ANTHROPIC_SEND_FIXTURES,
  CHAT_SEND_FIXTURES,
  describeTextDifference,
  readFixture,
  textRecord,
  type TextRecord,
} from './support/chatSendFixtures.js';
import { createCorpus } from './support/wireBodyCorpus.js';
import { WIRE_ROUTES } from './support/wireBodyCapture.js';
import {
  eagerProviderOracle,
  withJournalProviderSelection,
} from './support/journal-provider-fixture.js';
import { PINNED_CLOCK } from './support/wireBodyFixtures.js';

const corpus = await createCorpus();
const routes = WIRE_ROUTES.filter((route) => route.endpoint !== '/responses');
const errorCases = [
  'tool-calls-with-results',
  'media-inline-image',
  'unicode-edges',
  'cache-media-purge-boundary',
];

describe('native selected provider request dumps', () => {
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(async () => {
    setSystemTime();
    await corpus.dispose();
  });

  for (const route of routes) {
    describe(`route ${route.id}`, () => {
      for (const input of corpus.histories) {
        for (const projected of [false, true]) {
          it(`${input.id} projected=${projected} dumps the independently curated request`, async () => {
            const expected = await captureRequestDump(
              route,
              eagerProviderOracle(input),
              'rows',
              corpus.binding,
              'on',
              route.respond,
              projected,
            );
            const actual = await withJournalProviderSelection(
              input,
              (selection) =>
                captureRequestDump(
                  route,
                  input,
                  'rows',
                  corpus.binding,
                  'on',
                  route.respond,
                  projected,
                  selection,
                ),
            );
            expect(actual).toBe(expected);
          });
        }
        if (errorCases.includes(input.id)) {
          it(`${input.id} writes the same error-mode dump from committed native rows`, async () => {
            const expected = await captureRequestDump(
              route,
              eagerProviderOracle(input),
              'rows',
              corpus.binding,
              'error',
              rejectedResponse,
            );
            const actual = await withJournalProviderSelection(
              input,
              (selection) =>
                captureRequestDump(
                  route,
                  input,
                  'rows',
                  corpus.binding,
                  'error',
                  rejectedResponse,
                  false,
                  selection,
                ),
            );
            expect(actual).toBe(expected);
          });
        }
      }

      for (const id of ['text-only', 'media-inline-image', 'unicode-edges']) {
        it(`${id} matches the untouched dump oracle rather than the wire body`, async () => {
          const input = corpus.histories.find((history) => history.id === id);
          if (input === undefined) throw new Error('Missing frozen history');
          const directory =
            route.providerName === 'anthropic'
              ? ANTHROPIC_SEND_FIXTURES
              : CHAT_SEND_FIXTURES;
          const expected = readFixture<TextRecord>(
            `dump-${route.id}`,
            directory,
          )[`on/${id}/rows`];
          const actual = await withJournalProviderSelection(
            input,
            (selection) =>
              captureRequestDump(
                route,
                input,
                'rows',
                corpus.binding,
                'on',
                route.respond,
                false,
                selection,
              ),
          );
          expect(
            describeTextDifference(expected, textRecord(actual)),
          ).toBeUndefined();
        });
      }
    });
  }

  it('rejects changed dump settings against an untouched frozen dump', async () => {
    const route = routes[0];
    const input = {
      ...corpus.histories[0],
      systemInstruction: 'changed dump settings',
    };
    const expected = readFixture<TextRecord>(`dump-${route.id}`)[
      'on/text-only/rows'
    ];
    const actual = await withJournalProviderSelection(input, (selection) =>
      captureRequestDump(
        route,
        input,
        'rows',
        corpus.binding,
        'on',
        route.respond,
        false,
        selection,
      ),
    );
    expect(describeTextDifference(expected, textRecord(actual))).toContain(
      'bytes differ',
    );
  });
});
