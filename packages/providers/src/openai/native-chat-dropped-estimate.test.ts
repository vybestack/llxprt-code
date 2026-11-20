/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { journalSendFixture } from '../__tests__/support/journal-send-fixture.js';
import {
  buildHistoryCallOptions,
  rowsSelection,
  WIRE_ROUTES,
} from '../__tests__/support/wireBodyCapture.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import { droppedToolImageRows } from '../__tests__/support/dropped-tool-image-rows.js';

const tokenizerScratchRoots = createTestScratchOwner();

async function estimate(selection: ProviderRequestSelection): Promise<number> {
  const route = WIRE_ROUTES.find((entry) => entry.id === 'openai-chat-plain');
  if (route === undefined) throw new Error('Missing Chat route');
  const projection = await new OpenAIProvider('test').projectPromptEnvelope(
    buildHistoryCallOptions(
      route,
      {
        id: 'native-chat-dropped-estimate',
        description: 'dropped image estimate',
        rows: [],
        systemInstruction: 'system 雪',
        ephemerals: {},
      },
      'rows',
      new SettingsService(),
      selection,
    ),
  );
  try {
    return (
      await estimatePromptEnvelope(
        'openai',
        projection,
        createRuntimeTokenizerFactory(tokenizerScratchRoots),
      )
    ).estimatedPromptTokens;
  } finally {
    await projection.releaseIfUnsent?.();
  }
}

describe('stored native Chat estimates of dropped images', () => {
  it.each(['after', 'before'] satisfies ReadonlyArray<'after' | 'before'>)(
    'counts a dropped image reference placed %s its tool response',
    async (placement) => {
      const rows = droppedToolImageRows(placement);
      const expected = await estimate(
        rowsSelection(await normalizedRows(rows)),
      );
      const bare = await estimate(
        rowsSelection(
          await normalizedRows(droppedToolImageRows(placement, false)),
        ),
      );
      // The reference text the wire carries costs tokens of its own.
      expect(expected - bare).toBeGreaterThan(16);
      const fixture = await journalSendFixture(rows);
      try {
        // Chat stores per-unit repeat-delta counts; they track the whole
        // body count within the bound the other Chat estimate tests use.
        expect(
          Math.abs((await estimate(fixture.selection)) - expected),
        ).toBeLessThanOrEqual(16);
      } finally {
        await fixture.close();
      }
    },
  );
});
