/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DEFAULT_HTTP_JSON_ENVELOPE_BYTES } from '../utils/boundedJsonBody.js';
import { REQUEST_SIZE_SINK_KEY } from '../logging/requestSizeReport.js';
import { nativeJournalSendFixture } from './support/journal-send-fixture.js';
import { providerStreamError } from './support/provider-stream-error.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';

const sentence = 'A short sentence with bounded words. ';

const routes = WIRE_ROUTES.filter((route) =>
  [
    'openai-chat-plain',
    'openai-responses-via-openai',
    'openai-responses',
    'anthropic-cache-off',
  ].includes(route.id),
);

describe('native envelope refusal before transport', () => {
  for (const route of routes) {
    it(`${route.id}: refuses an oversized declared envelope without sending bytes and releases its source`, async () => {
      const fixture = await nativeJournalSendFixture(
        (function* (): Generator<IContent> {
          yield {
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: sentence.repeat(
                  Math.ceil(
                    (DEFAULT_HTTP_JSON_ENVELOPE_BYTES + 1) / sentence.length,
                  ),
                ),
              },
            ],
          };
        })(),
      );
      let receivedBytes = 0;
      const sink = await localWireHashSink(route, async (bytes) => {
        receivedBytes = bytes;
      });
      let error: unknown;
      const reportedSizes: number[] = [];
      const transportEvents: unknown[] = [];
      try {
        const provider = route.createProvider();
        const options = buildHistoryCallOptions(
          sink.route,
          {
            id: 'native-limit',
            description: 'production envelope limit',
            rows: [],
          },
          'rows',
          new SettingsService(),
          fixture.selection,
        );
        const sendingOptions = {
          ...options,
          onStreamLiveness: (event: unknown): void => {
            transportEvents.push(event);
          },
          metadata: {
            ...options.metadata,
            [REQUEST_SIZE_SINK_KEY]: (bytes: number): void => {
              reportedSizes.push(bytes);
            },
          },
        };
        const projection =
          await provider.projectPromptEnvelope?.(sendingOptions);
        try {
          error = await providerStreamError(
            provider.generateChatCompletion({
              ...sendingOptions,
              ...(projection === undefined
                ? {}
                : { promptEnvelopeTransportToken: projection.transportToken }),
            }),
          );
        } finally {
          await projection?.releaseIfUnsent?.();
        }
      } catch (caught) {
        error = caught;
      } finally {
        await sink.close();
        await fixture.close();
      }
      expect(error).toBeInstanceOf(RangeError);
      if (!(error instanceof RangeError)) throw error;
      expect(error.message).toMatch(
        new RegExp(
          `^JSON request envelope exceeds ${DEFAULT_HTTP_JSON_ENVELOPE_BYTES} bytes \\(\\d+ bytes\\)$`,
        ),
      );
      expect(sink.entries()).toBe(0);
      expect(sink.requests).toHaveLength(0);
      expect(receivedBytes).toBe(0);
      expect(reportedSizes).toStrictEqual([]);
      expect(transportEvents).toStrictEqual([]);
      expect(() => fixture.selection.openReader()).toThrow('closed');
    }, 170000);
  }
});
