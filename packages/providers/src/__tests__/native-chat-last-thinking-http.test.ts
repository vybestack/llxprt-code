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
import { createCorpus } from './support/wireBodyCorpus.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  recordOf,
  sendThroughRoute,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';
import { PINNED_CLOCK } from './support/wireBodyFixtures.js';

const corpus = await createCorpus();
const route = WIRE_ROUTES.find((item) => item.id === 'openai-chat-plain');
if (route === undefined) throw new Error('Missing plain Chat route');

describe('stored last-thinking actual HTTP corpus', () => {
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(async () => {
    setSystemTime();
    await corpus.dispose();
  });
  for (const { input, include, strip } of corpus.histories.flatMap((input) =>
    [false, true].flatMap((include) =>
      ['none', 'all', 'allButLast'].map((strip) => ({ input, include, strip })),
    ),
  )) {
    it(`${input.id} include=${include} strip=${strip} matches independent old bytes with no request files`, async () => {
      const selectedRoute = route;
      const selectedInput = {
        ...input,
        ephemerals: {
          ...input.ephemerals,
          'reasoning.includeInContext': include,
          'reasoning.stripFromContext': strip,
        },
      };
      const media =
        input.usesMediaReferences === true ? corpus.binding : undefined;
      const expected = recordOf(
        await sendThroughRoute(
          selectedRoute,
          { ...selectedInput, rows: await normalizedRows(input.rows) },
          'rows',
          media,
        ),
      );
      const fixture = await journalSendFixture(input.rows, [], {
        mediaStore:
          input.usesMediaReferences === true ? corpus.store : undefined,
      });
      const sink = await localWireHashSink(selectedRoute);
      try {
        const created = selectedRoute.createProvider();
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
          selectedInput,
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
      } finally {
        await sink.close();
        await fixture.close();
      }
    });
  }
});
