/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { AnthropicProvider } from '../anthropic/AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from './providerTestConfig.js';
import { anthropicViewFixture } from './support/anthropic-view-fixture.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';

function* history(): Generator<IContent> {
  yield { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] };
  yield {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'hist_tool_distant',
        name: 'lookup',
        parameters: {},
      },
    ],
  };
  for (let at = 2; at < 4096; at++)
    yield {
      speaker: at % 2 === 0 ? 'human' : 'ai',
      blocks: [{ type: 'text', text: `unaffected ${at}` }],
    };
}

function observeUnits(): { units(): number; restore(): void } {
  const readAt = IndexedJournalRequestSnapshot.prototype.readAt;
  const openReader = IndexedJournalRequestSnapshot.prototype.openReader;
  let units = 0;
  const indexed = spyOn(
    IndexedJournalRequestSnapshot.prototype,
    'readAt',
  ).mockImplementation(function (
    this: IndexedJournalRequestSnapshot,
    at: number,
    signal?: AbortSignal,
  ): Promise<IContent> {
    units++;
    return readAt.call(this, at, signal);
  });
  const sequential = spyOn(
    IndexedJournalRequestSnapshot.prototype,
    'openReader',
  ).mockImplementation(async function* (
    this: IndexedJournalRequestSnapshot,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent> {
    for await (const row of openReader.call(this, signal)) {
      units++;
      yield row;
    }
  });
  return {
    units: () => units,
    restore() {
      indexed.mockRestore();
      sequential.mockRestore();
    },
  };
}

describe('native Anthropic affected-span preparation work', () => {
  it('reads only the affected holder and boundaries in a 4096-row history', async () => {
    const route = WIRE_ROUTES.find((item) => item.id === 'anthropic-cache-off');
    if (route === undefined) throw new Error('Missing Anthropic route');
    const fixture = await anthropicViewFixture(history(), [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'toolu_distant',
            toolName: 'lookup',
            result: 'pending result 雪',
          },
        ],
      },
    ]);
    const provider = new AnthropicProvider(
      'test-api-key',
      undefined,
      TEST_PROVIDER_CONFIG,
    );
    const options = buildHistoryCallOptions(
      route,
      {
        id: 'span-work',
        description: 'indexed distant holder',
        rows: [],
        systemInstruction: 'system',
      },
      'rows',
      new SettingsService(),
      fixture.selection,
    );
    try {
      const warm = await provider.projectPromptEnvelope(options);
      await warm.releaseIfUnsent?.();
      const observed = observeUnits();
      try {
        const projection = await provider.projectPromptEnvelope(options);
        await projection.releaseIfUnsent?.();
        expect(observed.units()).toBeLessThan(64);
      } finally {
        observed.restore();
      }
    } finally {
      await fixture.close();
    }
  });
});
