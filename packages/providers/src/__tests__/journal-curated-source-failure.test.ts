/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withCoreSuffixFixture } from '@vybestack/llxprt-code-core/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import { closeInOrder } from './support/close-in-order.js';

async function drainFailure(source: AsyncIterable<unknown>): Promise<unknown> {
  try {
    for await (const chunk of source) void chunk;
    return undefined;
  } catch (error) {
    return error;
  }
}

const routes = [
  'openai-chat-plain',
  'openai-responses-via-openai',
  'openai-responses',
  'anthropic-cache-off',
];

describe('committed curated producer faults at the actual provider caller', () => {
  for (const route of WIRE_ROUTES.filter((candidate) =>
    routes.includes(candidate.id),
  )) {
    it(`${route.id}: propagates producer identity without an API response or transport entry`, async () => {
      await withCoreSuffixFixture(2, async (history, owners) => {
        const snapshot = await history.prepareCuratedForProviderSnapshot([], {
          ownership: owners,
        });
        const primary = new Error('committed row producer failed');
        let closed = false;
        const selection: ProviderRequestSelection = {
          count: snapshot.count,
          readAt: (index, signal) => snapshot.readAt(index, signal),
          openReader: (signal) =>
            (async function* (): AsyncGenerator<IContent, void, unknown> {
              try {
                for await (const row of snapshot.openReader(signal)) {
                  yield row;
                  throw primary;
                }
              } finally {
                closed = true;
              }
            })(),
          close: () => undefined,
        };
        const sink = await localWireHashSink(route);
        let failure: { readonly error: unknown } | undefined;
        try {
          const options = buildHistoryCallOptions(
            sink.route,
            {
              id: 'producer-failure',
              description: 'committed source failure',
              rows: [],
            },
            'rows',
            new SettingsService(),
            selection,
          );
          expect(
            await drainFailure(
              route.createProvider().generateChatCompletion(options),
            ),
          ).toBe(primary);
          expect(closed).toBe(true);
          expect(owners.snapshot().liveRows).toBe(0);
          expect(sink.entries()).toBe(0);
          expect(sink.requests).toHaveLength(0);
          expect((await snapshot.openReader().next()).done).toBe(false);
        } catch (error) {
          failure = { error };
          throw error;
        } finally {
          await closeInOrder(failure, snapshot, sink);
        }
        expect(owners.snapshot().liveRows).toBe(0);
      });
    });
  }
});
