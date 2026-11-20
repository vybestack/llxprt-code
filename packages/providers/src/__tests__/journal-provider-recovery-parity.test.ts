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
  CHAT_ROUTES,
  captureContinuation,
  type ContinuationRecords,
} from './support/chatSendCapture.js';
import { createCorpus } from './support/wireBodyCorpus.js';
import { WIRE_ROUTES, type WireBodyRecord } from './support/wireBodyCapture.js';
import {
  ANTHROPIC_SEND_FIXTURES,
  readFixture,
  textRecord,
  describeTextDifference,
  type TextRecord,
} from './support/chatSendFixtures.js';
import {
  imageDimensionResponse,
  rateLimitedResponse,
  recoveryRequestDumps,
  sendWithScript,
} from './support/imageRecoveryCapture.js';
import { RECOVERY_HISTORIES } from './support/imageRecoveryHistories.js';
import {
  eagerProviderOracle,
  withJournalProviderSelection,
} from './support/journal-provider-fixture.js';
import { PINNED_CLOCK } from './support/wireBodyFixtures.js';

const corpus = await createCorpus();
interface RecoveryRecord {
  readonly requests: readonly WireBodyRecord[];
  readonly threw: boolean;
}

describe('native selected continuation and image recovery', () => {
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(async () => {
    setSystemTime();
    await corpus.dispose();
  });

  for (const route of CHAT_ROUTES) {
    describe(`continuation ${route.id}`, () => {
      for (const input of corpus.histories) {
        it(`${input.id} keeps the native selection alive through both requests`, async () => {
          const expected = await captureContinuation(
            route,
            eagerProviderOracle(input),
            'rows',
            corpus.binding,
          );
          const actual = await withJournalProviderSelection(
            input,
            (selection) =>
              captureContinuation(
                route,
                input,
                'rows',
                corpus.binding,
                selection,
              ),
          );
          expect(actual).toStrictEqual(expected);
        });
      }
      it('matches both untouched frozen continuation bodies', async () => {
        const input = corpus.histories[0];
        const expected = readFixture<ContinuationRecords>(
          `continuation-${route.id}`,
        )[`${input.id}/rows`];
        const actual = await withJournalProviderSelection(input, (selection) =>
          captureContinuation(route, input, 'rows', corpus.binding, selection),
        );
        expect(actual).toStrictEqual(expected);
      });
    });
  }

  for (const route of WIRE_ROUTES.filter(
    (candidate) => candidate.providerName === 'anthropic',
  )) {
    describe(`recovery ${route.id}`, () => {
      for (const input of RECOVERY_HISTORIES) {
        for (const projected of [false, true]) {
          it(`${input.id} projected=${projected} matches frozen image recovery bytes`, async () => {
            const expected = readFixture<RecoveryRecord>(
              `image-recovery-${route.id}`,
              ANTHROPIC_SEND_FIXTURES,
            )[`${projected ? 'projected' : 'retry'}/${input.id}/rows`];
            const send = await withJournalProviderSelection(
              input,
              (selection) =>
                sendWithScript(
                  route,
                  input,
                  'rows',
                  [imageDimensionResponse, route.respond],
                  undefined,
                  projected,
                  selection,
                ),
            );
            expect({
              requests: send.requests,
              threw: send.error !== undefined,
            }).toStrictEqual(expected);
          });
        }
        it(`${input.id} dumps each rejected/recovered request using the frozen dump oracle`, async () => {
          const expected = readFixture<TextRecord[]>(
            `image-recovery-dump-${route.id}`,
            ANTHROPIC_SEND_FIXTURES,
          )[input.id];
          const actual = await withJournalProviderSelection(
            input,
            (selection) =>
              recoveryRequestDumps(
                route,
                input,
                [imageDimensionResponse, route.respond],
                selection,
              ),
          );
          expect(actual).toHaveLength(expected.length);
          for (const [index, text] of actual.entries())
            expect(
              describeTextDifference(expected[index], textRecord(text)),
            ).toBeUndefined();
        });
        if (input.id !== 'only-small-images') {
          it(`${input.id} preserves recovered media on a later outer attempt`, async () => {
            const expected = readFixture<RecoveryRecord>(
              `image-recovery-${route.id}`,
              ANTHROPIC_SEND_FIXTURES,
            )[`outer/${input.id}/rows`];
            const send = await withJournalProviderSelection(
              input,
              (selection) =>
                sendWithScript(
                  route,
                  input,
                  'rows',
                  [imageDimensionResponse, rateLimitedResponse, route.respond],
                  3,
                  false,
                  selection,
                ),
            );
            expect(send.error).toBeUndefined();
            expect(send.requests).toHaveLength(3);
            expect(send.requests.slice(0, 2)).toStrictEqual([
              ...expected.requests,
            ]);
            expect(send.requests[2]).toStrictEqual(send.requests[1]);
          });
        }
      }
    });
  }
});
