/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DEFAULT_HTTP_JSON_ENVELOPE_BYTES } from '../utils/boundedJsonBody.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { providerStreamError } from './support/provider-stream-error.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  recordOf,
  sendThroughRoute,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';

function* rows(prefix: string): Generator<IContent> {
  yield { speaker: 'human', blocks: [{ type: 'text', text: prefix }] };
  yield {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'answer' }],
    metadata: { id: 'resp_dead', responsesStored: true },
  };
  yield { speaker: 'human', blocks: [{ type: 'text', text: 'next question' }] };
}

describe('native Responses parent recovery envelope planning', () => {
  for (const route of WIRE_ROUTES.filter(
    (entry) => entry.endpoint === '/responses',
  )) {
    it(`${route.id}: refuses an oversized full-history rebuild without sending a second request`, async () => {
      const shape = {
        id: 'parent-over-limit',
        description: 'small delta, oversized rebuilt history',
        rows: [],
        ephemerals: { 'responses-stateful': true },
      };
      const expected = recordOf(
        await sendThroughRoute(
          route,
          { ...shape, rows: [...rows('short prefix')] },
          'rows',
        ),
      );
      const sink = await localWireHashSink({
        ...route,
        respond: () =>
          Response.json(
            {
              error: {
                message: "Previous response with id 'resp_dead' not found.",
              },
            },
            { status: 400 },
          ),
      });
      const fixture = await journalSendFixture(
        rows('x'.repeat(DEFAULT_HTTP_JSON_ENVELOPE_BYTES)),
      );
      let error: unknown;
      try {
        const provider = route.createProvider();
        const options = buildHistoryCallOptions(
          sink.route,
          shape,
          'rows',
          new SettingsService(),
          fixture.selection,
        );
        error = await providerStreamError(
          provider.generateChatCompletion(options),
        );
        expect(error).toBeInstanceOf(RangeError);
        if (!(error instanceof RangeError)) throw error;
        expect(error.message).toMatch(
          new RegExp(
            `^JSON request envelope exceeds ${DEFAULT_HTTP_JSON_ENVELOPE_BYTES} bytes \\(\\d+ bytes\\)$`,
          ),
        );
        expect(sink.entries()).toBe(1);
        expect(sink.requests).toHaveLength(1);
        expect(sink.requests[0]).toStrictEqual({
          bytes: expected.length,
          sha256: expected.sha256,
          contentLength: String(expected.length),
        });
      } finally {
        await sink.close();
        await fixture.close();
      }
      expect(() => fixture.selection.openReader()).toThrow('closed');
    }, 170000);
  }
});
