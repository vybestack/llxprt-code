/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { createCorpus, GoldenRecorder } from './support/wireBodyCorpus.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  recordOf,
  sendThroughRoute,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';
import { PINNED_CLOCK, readRouteFixture } from './support/wireBodyFixtures.js';

const corpus = await createCorpus();
const route = WIRE_ROUTES.find((item) => item.id === 'openai-chat-plain');
if (route === undefined) throw new Error('Missing plain Chat route');
const golden = readRouteFixture(route.id);
const recorder = new GoldenRecorder(false);

describe('native plain Chat frozen HTTP bodies', () => {
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(async () => {
    setSystemTime();
    await corpus.dispose();
  });
  for (const input of corpus.histories) {
    it(`${input.id} checks raw frozen bytes and native curated parity without request files`, async () => {
      const media =
        input.usesMediaReferences === true ? corpus.binding : undefined;
      const raw = recordOf(
        await sendThroughRoute(route, input, 'stream', media),
      );
      const registered = golden.cases[input.id];
      if (registered === undefined)
        throw new Error(`Missing frozen case ${input.id}`);
      const frozen = registered.stream;
      expect(raw.length).toBe(frozen.length);
      expect(raw.sha256).toBe(frozen.sha256);
      const expected = recordOf(
        await sendThroughRoute(
          route,
          { ...input, rows: await normalizedRows(input.rows) },
          'rows',
          media,
        ),
      );
      const fixture = await journalSendFixture(input.rows);
      const sink = await localWireHashSink(route);
      try {
        const created = route.createProvider();
        const provider =
          input.usesMediaReferences === true
            ? bindProviderMedia(
                created,
                corpus.binding.resolver,
                corpus.binding.budgetBytes,
              )
            : created;
        const options = buildHistoryCallOptions(
          sink.route,
          input,
          'rows',
          new SettingsService(),
          fixture.selection,
        );
        const receipt = await operationFileCreates(async () => {
          for await (const chunk of provider.generateChatCompletion(options))
            void chunk;
        }, true);
        expect(receipt).toStrictEqual({ files: [], directories: [] });
        expect(sink.requests).toHaveLength(1);
        const actual = sink.requests[0];
        expect(actual.contentLength).toBe(String(actual.bytes));
        expect(actual.bytes).toBe(expected.length);
        expect(actual.sha256).toBe(expected.sha256);
        expect(
          recorder.verifyCorpus(corpus.histories, WIRE_ROUTES),
        ).toStrictEqual([]);
      } finally {
        await sink.close();
        await fixture.close();
      }
    });
  }
});
