/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type { RowEntry } from '@vybestack/llxprt-code-core/journal/rowEntry.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { AnthropicProvider } from '../anthropic/AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from './providerTestConfig.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { anthropicViewFixture } from './support/anthropic-view-fixture.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';

function* rows(count: number): Generator<IContent> {
  yield { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] };
  yield {
    speaker: 'ai',
    blocks: [
      { type: 'tool_call', id: 'call_held', name: 'lookup', parameters: {} },
    ],
  };
  for (let at = 0; at < count; at++)
    yield {
      speaker: at % 2 === 0 ? 'human' : 'ai',
      blocks: [{ type: 'text', text: `unaffected row ${at} 雪` }],
    };
}
function observeReads(): {
  readonly units: () => number;
  readonly descriptors: () => number;
  restore(): void;
} {
  const readAt = IndexedJournalRequestSnapshot.prototype.readAt;
  const entries = VersionSnapshot.prototype.entries;
  let units = 0;
  let descriptors = 0;
  const unitObservation = spyOn(
    IndexedJournalRequestSnapshot.prototype,
    'readAt',
  ).mockImplementation(function (
    this: IndexedJournalRequestSnapshot,
    index: number,
    signal?: AbortSignal,
  ): Promise<IContent> {
    units++;
    return readAt.call(this, index, signal);
  });
  const descriptorObservation = spyOn(
    VersionSnapshot.prototype,
    'entries',
  ).mockImplementation(async function* (
    this: VersionSnapshot,
    from = 0,
  ): AsyncGenerator<RowEntry> {
    for await (const entry of entries.call(this, from)) {
      descriptors++;
      yield entry;
    }
  });
  return {
    units: () => units,
    descriptors: () => descriptors,
    restore() {
      unitObservation.mockRestore();
      descriptorObservation.mockRestore();
    },
  };
}

describe('native Anthropic pending request preparation work', () => {
  it('prepares a single-row purge without reading its 4096-row prefix', async () => {
    const route = WIRE_ROUTES.find((item) => item.id === 'anthropic-cache-off');
    if (route === undefined) throw new Error('Missing Anthropic route');
    const prefix = Array.from(
      { length: 4096 },
      (_, at): IContent => ({
        speaker: at % 2 === 0 ? 'human' : 'ai',
        blocks: [{ type: 'text', text: `unaffected prefix ${at}` }],
      }),
    );
    const user: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'purged' }],
    };
    const fixture = await anthropicViewFixture(
      [
        ...prefix,
        user,
        { speaker: 'ai', blocks: [{ type: 'text', text: 'retained answer' }] },
      ],
      [user],
      { at: 4096 },
    );
    const provider = new AnthropicProvider(
      'test-api-key',
      undefined,
      TEST_PROVIDER_CONFIG,
    );
    const options = buildHistoryCallOptions(
      route,
      {
        id: 'bounded-purge',
        description: 'single-row purge preparation',
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
      const observed = observeReads();
      try {
        const created = await operationFileCreates(async () => {
          const projection = await provider.projectPromptEnvelope(options);
          expect(projection.unsupportedMedia).toStrictEqual([]);
          await projection.releaseIfUnsent?.();
        }, true);
        expect(created).toStrictEqual({ files: [], directories: [] });
        expect(observed.units()).toBeLessThan(64);
        expect(observed.descriptors()).toBe(0);
      } finally {
        observed.restore();
      }
    } finally {
      await fixture.close();
    }
  });

  it.each([128, 4096])(
    'prepares an affected early holder without reading the %s-row prefix',
    async (count) => {
      const route = WIRE_ROUTES.find(
        (item) => item.id === 'anthropic-cache-off',
      );
      if (route === undefined) throw new Error('Missing Anthropic route');
      const fixture = await journalSendFixture(
        rows(count),
        [
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: 'call_held',
                toolName: 'lookup',
                result: 'new result 🐈',
              },
            ],
          },
        ],
        {
          directory: `${import.meta.dir}/../../../../tmp/anthropic-tail/work-fixtures`,
        },
      );
      const provider = new AnthropicProvider(
        'test-api-key',
        undefined,
        TEST_PROVIDER_CONFIG,
      );
      const options = buildHistoryCallOptions(
        route,
        {
          id: 'bounded-tail',
          description: 'bounded pending preparation',
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
        const observed = observeReads();
        try {
          const created = await operationFileCreates(async () => {
            const projection = await provider.projectPromptEnvelope(options);
            expect(projection.unsupportedMedia).toStrictEqual([]);
            await projection.releaseIfUnsent?.();
          }, true);
          expect(created).toStrictEqual({ files: [], directories: [] });
          expect(observed.units()).toBeLessThan(64);
          expect(observed.descriptors()).toBe(0);
        } finally {
          observed.restore();
        }
      } finally {
        await fixture.close();
      }
    },
  );
});
