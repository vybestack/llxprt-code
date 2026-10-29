/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 D4: the continuation request. A streaming reply that holds tool
 * calls and no text makes the chat route send the same conversation again with
 * the model's tool calls acknowledged. Every history of the wire-body corpus
 * is sent on the plain, Kimi and Mistral routes with such a reply; the bytes of
 * the first request and of the continuation request, and their Content-Length
 * headers, are compared with the fixtures captured from the code before the
 * continuation became a second spool.
 *
 * Regenerate intentionally with WIRE_BODY_GOLDEN_UPDATE=1 (see
 * support/chatSendFixtures.ts).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { CHAT_ROUTES, captureContinuation } from './support/chatSendCapture.js';
import { readFixture, writeFixture } from './support/chatSendFixtures.js';
import { createCorpus } from './support/wireBodyCorpus.js';
import {
  describeDifference,
  isUpdateRequested,
} from './support/wireBodyFixtures.js';
import type { RowSource, WireBodyRecord } from './support/wireBodyCapture.js';

const SOURCES: readonly RowSource[] = ['stream', 'rows'];

interface ContinuationCase {
  readonly first: WireBodyRecord;
  readonly continuation: WireBodyRecord;
}

const corpus = await createCorpus();
const update = isUpdateRequested(process.env);
const recorded = new Map<string, Record<string, ContinuationCase>>();

function fixtureName(routeId: string): string {
  return `continuation-${routeId}`;
}

interface ContinuationVerdict {
  readonly first: string | undefined;
  readonly continuation: string | undefined;
}

/** Records the case when updating, otherwise compares it with its fixture. */
function judge(
  routeId: string,
  key: string,
  actual: ContinuationCase,
): ContinuationVerdict {
  if (update) {
    const cases = recorded.get(routeId) ?? {};
    cases[key] = actual;
    recorded.set(routeId, cases);
    return { first: undefined, continuation: undefined };
  }
  const expected = readFixture<ContinuationCase>(fixtureName(routeId))[key];
  expect(expected).toBeDefined();
  return {
    first: describeDifference(expected.first, actual.first),
    continuation: describeDifference(
      expected.continuation,
      actual.continuation,
    ),
  };
}

describe('chat continuation request golden bytes', () => {
  afterAll(async () => {
    await corpus.dispose();
    if (!update) return;
    for (const [routeId, cases] of recorded)
      writeFixture(fixtureName(routeId), cases);
  });

  for (const route of CHAT_ROUTES) {
    describe(`route ${route.id}`, () => {
      for (const history of corpus.histories) {
        for (const source of SOURCES) {
          it(`${history.id} via ${source} sends the golden continuation`, async () => {
            const actual = await captureContinuation(
              route,
              history,
              source,
              corpus.binding,
            );
            const verdict = judge(route.id, `${history.id}/${source}`, actual);
            expect(verdict.first).toBeUndefined();
            expect(verdict.continuation).toBeUndefined();
          });
        }
      }
    });
  }
});
