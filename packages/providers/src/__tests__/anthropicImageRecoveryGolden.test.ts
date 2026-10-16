/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 E6: the bytes of an Anthropic image-dimension recovery. The first
 * request is rejected with the many-image dimension 400; the retry must carry
 * the same bytes (and Content-Length behaviour) today's code sends. A second
 * script rejects the retry with a 429 under the outer retry orchestrator, so
 * the third request shows what a later outer attempt sends.
 *
 * Regenerate intentionally with WIRE_BODY_GOLDEN_UPDATE=1 (see
 * support/chatSendFixtures.ts).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import {
  ANTHROPIC_SEND_FIXTURES,
  readFixture,
  writeFixture,
} from './support/chatSendFixtures.js';
import {
  imageDimensionResponse,
  rateLimitedResponse,
  recoveryRequestDumps,
  sendWithScript,
  type RecoverySend,
} from './support/imageRecoveryCapture.js';
import { RECOVERY_HISTORIES } from './support/imageRecoveryHistories.js';
import {
  describeTextDifference,
  textRecord,
  type TextRecord,
} from './support/chatSendFixtures.js';
import {
  describeDifference,
  isUpdateRequested,
} from './support/wireBodyFixtures.js';
import {
  WIRE_ROUTES,
  type RowSource,
  type WireBodyRecord,
} from './support/wireBodyCapture.js';

const ROUTES = WIRE_ROUTES.filter((route) => route.id.startsWith('anthropic-'));
const SOURCES: readonly RowSource[] = ['stream', 'rows'];
const update = isUpdateRequested(process.env);

interface RecoveryRecord {
  readonly requests: readonly WireBodyRecord[];
  readonly threw: boolean;
}

const recorded = new Map<string, Record<string, RecoveryRecord>>();
const recordedDumps = new Map<string, Record<string, TextRecord[]>>();

function dumpFixtureName(routeId: string): string {
  return `image-recovery-dump-${routeId}`;
}

function fixtureName(routeId: string): string {
  return `image-recovery-${routeId}`;
}

function recordOfSend(send: RecoverySend): RecoveryRecord {
  return { requests: send.requests, threw: send.error !== undefined };
}

function differences(
  expected: RecoveryRecord,
  actual: RecoveryRecord,
): string | undefined {
  const problems: string[] = [];
  if (expected.threw !== actual.threw) {
    problems.push(`threw was ${expected.threw} and is now ${actual.threw}`);
  }
  if (expected.requests.length !== actual.requests.length) {
    problems.push(
      `${expected.requests.length} requests expected, ${actual.requests.length} sent`,
    );
  }
  const shared = Math.min(expected.requests.length, actual.requests.length);
  for (let at = 0; at < shared; at++) {
    const difference = describeDifference(
      expected.requests[at],
      actual.requests[at],
    );
    if (difference !== undefined) problems.push(`request ${at}: ${difference}`);
  }
  return problems.length === 0 ? undefined : problems.join('\n');
}

function check(
  routeId: string,
  key: string,
  actual: RecoveryRecord,
): string | undefined {
  if (update) {
    const cases = recorded.get(routeId) ?? {};
    cases[key] = actual;
    recorded.set(routeId, cases);
    return undefined;
  }
  const expected = readFixture<RecoveryRecord>(
    fixtureName(routeId),
    ANTHROPIC_SEND_FIXTURES,
  )[key];
  expect(expected).toBeDefined();
  return differences(expected, actual);
}

function checkDumps(
  routeId: string,
  key: string,
  texts: readonly string[],
): string | undefined {
  const actual = texts.map(textRecord);
  if (update) {
    const cases = recordedDumps.get(routeId) ?? {};
    cases[key] = actual;
    recordedDumps.set(routeId, cases);
    return undefined;
  }
  const expected = readFixture<TextRecord[]>(
    dumpFixtureName(routeId),
    ANTHROPIC_SEND_FIXTURES,
  )[key];
  expect(expected).toBeDefined();
  if (expected.length !== actual.length) {
    return `${expected.length} dump files expected, ${actual.length} written`;
  }
  return expected
    .map((record, at) => describeTextDifference(record, actual[at]))
    .find((difference) => difference !== undefined);
}

/** The one history whose images are all within limits: nothing to replace. */
const UNRECOVERABLE_HISTORY = 'only-small-images';

const OK = (route: { respond: () => Response }) => () => route.respond();

describe('Anthropic image recovery golden retry bytes', () => {
  afterAll(() => {
    if (!update) return;
    for (const [routeId, cases] of recorded)
      writeFixture(fixtureName(routeId), cases, ANTHROPIC_SEND_FIXTURES);
    for (const [routeId, cases] of recordedDumps)
      writeFixture(dumpFixtureName(routeId), cases, ANTHROPIC_SEND_FIXTURES);
  });

  for (const route of ROUTES) {
    describe(`route ${route.id}`, () => {
      for (const history of RECOVERY_HISTORIES) {
        const recovers = history.id !== UNRECOVERABLE_HISTORY;
        for (const source of SOURCES) {
          it(`${history.id} via ${source}: rejected request, then the retry`, async () => {
            const send = await sendWithScript(route, history, source, [
              imageDimensionResponse,
              OK(route),
            ]);
            expect(
              check(
                route.id,
                `retry/${history.id}/${source}`,
                recordOfSend(send),
              ),
            ).toBeUndefined();
            expect(send.error === undefined).toBe(recovers);
            expect(send.requests).toHaveLength(recovers ? 2 : 1);
            const retried =
              send.requests.length > 1 &&
              send.requests[1].sha256 !== send.requests[0].sha256;
            expect(retried).toBe(recovers);
          });
        }
        it(`${history.id} projected first: rejected request, then the retry`, async () => {
          const send = await sendWithScript(
            route,
            history,
            'rows',
            [imageDimensionResponse, OK(route)],
            undefined,
            true,
          );
          expect(
            check(route.id, `projected/${history.id}/rows`, recordOfSend(send)),
          ).toBeUndefined();
        });
        it(`${history.id}: dumps the rejected request and the retry`, async () => {
          const texts = await recoveryRequestDumps(route, history, [
            imageDimensionResponse,
            OK(route),
          ]);
          expect(checkDumps(route.id, history.id, texts)).toBeUndefined();
        });
        it(`${history.id}: a later outer attempt after the retry fails resends the retry bytes`, async () => {
          const send = await sendWithScript(
            route,
            history,
            'rows',
            [imageDimensionResponse, rateLimitedResponse, OK(route)],
            3,
          );
          // The first two requests are today's bytes. The third is not stored:
          // today's code sends it with an empty `messages` array (the lease on
          // the kept body splices it when the first attempt finishes), so its
          // contract is to equal the retry that already went out.
          const sent = recordOfSend(send);
          expect(
            check(route.id, `outer/${history.id}/rows`, {
              ...sent,
              requests: sent.requests.slice(0, 2),
            }),
          ).toBeUndefined();
          expect(send.requests).toHaveLength(recovers ? 3 : 1);
          expect(send.requests[2]).toStrictEqual(send.requests[1]);
        });
      }
    });
  }
});
