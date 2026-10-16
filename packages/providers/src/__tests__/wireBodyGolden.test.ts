/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A1: golden request bytes for every provider send route.
 *
 * Each history in the corpus is sent through the real provider (OpenAI chat
 * plain/Kimi/Mistral, the `openai` provider's Responses route, the
 * `openai-responses` provider, Anthropic with and without prompt caching)
 * against a fake HTTP transport. The exact body bytes and the Content-Length
 * behaviour are compared with the fixtures in `fixtures/wire-bodies/`.
 *
 * Later #854 steps must keep these bytes identical; the only difference they
 * may introduce on purpose is the Content-Length header, and then the
 * fixtures are regenerated in the same commit:
 *
 *   WIRE_BODY_GOLDEN_UPDATE=1 bun test src/__tests__/wireBodyGolden.test.ts
 *
 * (from packages/providers; refused when CI is set; never part of CI).
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import {
  GoldenRecorder,
  ROW_SOURCES,
  captureRecord,
  createCorpus,
} from './support/wireBodyCorpus.js';
import { WIRE_ROUTES } from './support/wireBodyCapture.js';
import {
  PINNED_CLOCK,
  describeDifference,
  isUpdateRequested,
} from './support/wireBodyFixtures.js';
import type { WireBodyRecord } from './support/wireBodyCapture.js';

const corpus = await createCorpus();
const recorder = new GoldenRecorder(isUpdateRequested(process.env));

describe('wire body golden corpus', () => {
  beforeAll(() => {
    setSystemTime(new Date(PINNED_CLOCK));
  });

  afterAll(async () => {
    setSystemTime();
    await corpus.dispose();
  });

  describe('golden wire bodies', () => {
    for (const route of WIRE_ROUTES) {
      describe(`route ${route.id}`, () => {
        for (const history of corpus.histories) {
          for (const source of ROW_SOURCES) {
            it(`${history.id} via ${source} sends the golden bytes`, async () => {
              const actual = await captureRecord(
                route,
                history,
                source,
                corpus.binding,
              );
              expect(
                recorder.check(route.id, history.id, source, actual),
              ).toBeUndefined();
            });
          }
        }
      });
    }

    it('has a fixture and manifest entry for every route and case, and no stale ones', () => {
      expect(
        recorder.verifyCorpus(corpus.histories, WIRE_ROUTES),
      ).toStrictEqual([]);
    });

    afterAll(() => {
      recorder.flushIfUpdating();
    });
  });

  describe('golden corpus controls', () => {
    const base: WireBodyRecord = {
      sha256: 'a'.repeat(64),
      length: 5,
      body: 'hello',
      contentLength: 'present',
    };

    it('reports no difference for identical records', () => {
      expect(describeDifference(base, { ...base })).toBeUndefined();
    });

    it('trap: reports a changed byte with its position', () => {
      const changed: WireBodyRecord = {
        ...base,
        sha256: 'b'.repeat(64),
        body: 'hellp',
      };
      expect(describeDifference(base, changed)).toContain(
        'first difference at char 4',
      );
    });

    it('trap: reports a changed length', () => {
      expect(describeDifference(base, { ...base, length: 6 })).toContain(
        'bytes differ',
      );
    });

    it('trap: reports a Content-Length behaviour change', () => {
      expect(
        describeDifference(base, { ...base, contentLength: 'absent' }),
      ).toContain('content-length was present and is now absent');
    });

    it('is deterministic: the same send twice yields the same record', async () => {
      const route = WIRE_ROUTES[0];
      const history = corpus.histories[0];
      const first = await captureRecord(
        route,
        history,
        'stream',
        corpus.binding,
      );
      const second = await captureRecord(
        route,
        history,
        'stream',
        corpus.binding,
      );
      expect(second).toStrictEqual(first);
    });

    it('trap: a changed history changes the record through the real send path', async () => {
      const route = WIRE_ROUTES[0];
      const history = corpus.histories[0];
      const first = await captureRecord(
        route,
        history,
        'stream',
        corpus.binding,
      );
      const perturbed = await captureRecord(
        route,
        { ...history, rows: [...history.rows, history.rows[0]] },
        'stream',
        corpus.binding,
      );
      expect(describeDifference(first, perturbed)).toContain('bytes differ');
    });
  });
});
