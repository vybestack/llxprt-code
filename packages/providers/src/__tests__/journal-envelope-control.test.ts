/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { providerStreamError } from './support/provider-stream-error.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  recordOf,
  sendThroughRoute,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';
import type { HistoryCase } from './support/wireBodyHistories.js';

const shape: HistoryCase = {
  id: 'native-within-limit-control',
  description: 'tiny native transport control',
  rows: [
    { speaker: 'human', blocks: [{ type: 'text', text: '雪😀"\\\n\u0000' }] },
  ],
};

describe('native envelope transport control', () => {
  for (const route of WIRE_ROUTES.filter((entry) =>
    [
      'openai-chat-plain',
      'openai-responses-via-openai',
      'openai-responses',
      'anthropic-cache-off',
    ].includes(entry.id),
  )) {
    it(`${route.id}: accepts a tiny committed source through the same HTTP gateway`, async () => {
      const expected = recordOf(await sendThroughRoute(route, shape, 'rows'));
      const fixture = await journalSendFixture(shape.rows);
      const sink = await localWireHashSink(route);
      try {
        const options = buildHistoryCallOptions(
          sink.route,
          shape,
          'rows',
          new SettingsService(),
          fixture.selection,
        );
        const error = await providerStreamError(
          route.createProvider().generateChatCompletion(options),
        );
        expect(error).toBeUndefined();
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
    });
  }
});
