/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 E5: the request dump file the Anthropic route writes when
 * `dumpcontext` is on or the request fails. Every history of the wire-body
 * corpus is sent through the real provider with prompt caching at 1h and off,
 * and the dump file text (timestamp aside) is compared with the text today's
 * code writes.
 *
 * Regenerate intentionally with WIRE_BODY_GOLDEN_UPDATE=1 (see
 * support/chatSendFixtures.ts).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import {
  captureRequestDump,
  rejectedResponse,
} from './support/chatSendCapture.js';
import {
  ANTHROPIC_SEND_FIXTURES,
  describeTextDifference,
  readFixture,
  textRecord,
  writeFixture,
  type TextRecord,
} from './support/chatSendFixtures.js';
import { createCorpus } from './support/wireBodyCorpus.js';
import { isUpdateRequested } from './support/wireBodyFixtures.js';
import { WIRE_ROUTES, type RowSource } from './support/wireBodyCapture.js';

const ROUTES = WIRE_ROUTES.filter((route) => route.id.startsWith('anthropic-'));
const SOURCES: readonly RowSource[] = ['stream', 'rows'];
/** Histories also sent with a failing response in `error` mode. */
const ERROR_MODE_CASES = [
  'tool-calls-with-results',
  'media-inline-image',
  'unicode-edges',
  'cache-media-purge-boundary',
];

const corpus = await createCorpus();
const update = isUpdateRequested(process.env);
const recorded = new Map<string, Record<string, TextRecord>>();

function fixtureName(routeId: string): string {
  return `dump-${routeId}`;
}

/** Records the dump when updating, otherwise returns how it differs. */
function check(routeId: string, key: string, text: string): string | undefined {
  const actual = textRecord(text);
  if (update) {
    const cases = recorded.get(routeId) ?? {};
    cases[key] = actual;
    recorded.set(routeId, cases);
    return undefined;
  }
  const expected = readFixture<TextRecord>(
    fixtureName(routeId),
    ANTHROPIC_SEND_FIXTURES,
  )[key];
  expect(expected).toBeDefined();
  return describeTextDifference(expected, actual);
}

describe('Anthropic request dump golden files', () => {
  afterAll(async () => {
    await corpus.dispose();
    if (!update) return;
    for (const [routeId, cases] of recorded)
      writeFixture(fixtureName(routeId), cases, ANTHROPIC_SEND_FIXTURES);
  });

  for (const route of ROUTES) {
    describe(`route ${route.id}`, () => {
      for (const history of corpus.histories) {
        for (const source of SOURCES) {
          it(`${history.id} via ${source} dumps the golden request file in on mode`, async () => {
            const text = await captureRequestDump(
              route,
              history,
              source,
              corpus.binding,
              'on',
            );
            expect(
              check(route.id, `on/${history.id}/${source}`, text),
            ).toBeUndefined();
          });
        }
        it(`${history.id} projected first dumps the same request file in on mode`, async () => {
          const text = await captureRequestDump(
            route,
            history,
            'rows',
            corpus.binding,
            'on',
            route.respond,
            true,
          );
          expect(
            check(route.id, `projected/${history.id}/rows`, text),
          ).toBeUndefined();
        });
        if (ERROR_MODE_CASES.includes(history.id)) {
          it(`${history.id} dumps the golden request file when the request fails in error mode`, async () => {
            const text = await captureRequestDump(
              route,
              history,
              'rows',
              corpus.binding,
              'error',
              rejectedResponse,
            );
            expect(
              check(route.id, `error/${history.id}/rows`, text),
            ).toBeUndefined();
          });
          it(`${history.id} projected first dumps the golden request file when the request fails`, async () => {
            const text = await captureRequestDump(
              route,
              history,
              'stream',
              corpus.binding,
              'error',
              rejectedResponse,
              true,
            );
            expect(
              check(route.id, `projected-error/${history.id}/stream`, text),
            ).toBeUndefined();
          });
        }
      }
    });
  }
});
