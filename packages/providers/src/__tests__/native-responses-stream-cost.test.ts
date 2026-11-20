/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';

function* rows(count: number): Generator<IContent> {
  for (let index = 0; index < count; index++)
    yield {
      speaker: index % 2 === 0 ? 'human' : 'ai',
      blocks: [{ type: 'text', text: `${index}: snow 雪 " \\ \n` }],
    };
}

describe('native Responses sequential serialization work', () => {
  it.each([40, 400])(
    'sends %s native rows without repeating indexed unit selection per row',
    async (count) => {
      const fixture = await journalSendFixture(rows(count), [], {
        seedBatchRows: count,
      });
      const route = WIRE_ROUTES.find(
        (item) => item.id === 'openai-responses-via-openai',
      );
      if (route === undefined) throw new Error('Missing Responses route');
      const sink = await localWireHashSink(route);
      const indexed = fixture.selection.native?.indexed;
      if (indexed === undefined) throw new Error('Missing native source');
      const original = indexed.planAt;
      let plans = 0;
      try {
        const options = buildHistoryCallOptions(
          sink.route,
          { id: 'sequential-responses', description: 'indexed rows', rows: [] },
          'rows',
          new SettingsService(),
          fixture.selection,
        );
        const provider = route.createProvider();
        for await (const chunk of provider.generateChatCompletion(options))
          void chunk;
        indexed.planAt = function (...args) {
          plans++;
          return original.call(this, ...args);
        };
        for await (const chunk of provider.generateChatCompletion(options))
          void chunk;
        expect(sink.requests).toHaveLength(2);
        expect(sink.requests[1].bytes).toBe(sink.requests[0].bytes);
        expect(sink.requests[1].sha256).toBe(sink.requests[0].sha256);
        expect(sink.requests[1].contentLength).toBe(
          String(sink.requests[1].bytes),
        );
        expect(plans).toBe(0);
      } finally {
        indexed.planAt = original;
        await sink.close();
        await fixture.close();
      }
    },
  );
});
