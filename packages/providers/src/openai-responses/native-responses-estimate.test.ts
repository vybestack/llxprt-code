import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { journalSendFixture } from '../__tests__/support/journal-send-fixture.js';
import {
  buildHistoryCallOptions,
  rowsSelection,
  WIRE_ROUTES,
} from '../__tests__/support/wireBodyCapture.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import { droppedToolImageRows } from '../__tests__/support/dropped-tool-image-rows.js';
const tokenizerScratchRoots = createTestScratchOwner();

async function estimate(
  selection: ProviderRequestSelection,
  model: string,
): Promise<Awaited<ReturnType<typeof estimatePromptEnvelope>>> {
  const route = WIRE_ROUTES.find((entry) => entry.id === 'openai-responses');
  if (route === undefined) throw new Error('Missing Responses route');
  const provider = new OpenAIResponsesProvider('test');
  const projection = await provider.projectPromptEnvelope(
    buildHistoryCallOptions(
      { ...route, model },
      {
        id: 'native-estimate',
        description: 'native estimate',
        rows: [],
        systemInstruction: 'system 雪',
        ephemerals: { 'responses-stateful': false },
      },
      'rows',
      new SettingsService(),
      selection,
    ),
  );
  try {
    return await estimatePromptEnvelope(
      'openai-responses',
      projection,
      createRuntimeTokenizerFactory(tokenizerScratchRoots),
    );
  } finally {
    await projection.releaseIfUnsent?.();
  }
}

describe('native Responses estimates', () => {
  it.each(
    ['gpt-5.2', 'gpt-5.6'].flatMap((model) =>
      [
        { name: 'adjacent rows', text: 'hello' },
        {
          name: 'special spellings',
          text: '<|endoftext|> 雪 \ud800 <|endofprompt|>',
        },
        { name: 'large piece', text: 'a'.repeat(300_000) },
      ].map((entry) => ({ model, ...entry })),
    ),
  )(
    'preserves whole prompt-key token boundaries without files for $model/$name',
    async ({ model, text }) => {
      const rows: readonly IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text }] },
        { speaker: 'human', blocks: [{ type: 'text', text: 'world' }] },
        {
          speaker: 'ai',
          blocks: [
            { type: 'tool_call', id: 'call_x', name: 'lookup', parameters: {} },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_x',
              toolName: 'lookup',
              result: { value: '雪' },
            },
          ],
        },
      ];
      const fixture = await journalSendFixture(rows, [], {
        directory: 'tmp/responses-native/fixtures',
      });
      try {
        const expected = await estimate(
          rowsSelection(await normalizedRows(rows)),
          model,
        );
        let actual: Awaited<ReturnType<typeof estimate>> | undefined;
        const created = await operationFileCreates(async () => {
          actual = await estimate(fixture.selection, model);
        }, true);
        expect(actual).toStrictEqual(expected);
        expect(created).toStrictEqual({ files: [], directories: [] });
      } finally {
        await fixture.close();
      }
    },
  );

  it.each(['after', 'before'] satisfies ReadonlyArray<'after' | 'before'>)(
    'counts a dropped image reference placed %s its tool response in the stored estimate',
    async (placement) => {
      const rows = droppedToolImageRows(placement);
      const expected = await estimate(
        rowsSelection(await normalizedRows(rows)),
        'gpt-5.2',
      );
      const bare = await estimate(
        rowsSelection(
          await normalizedRows(droppedToolImageRows(placement, false)),
        ),
        'gpt-5.2',
      );
      // The reference text the wire carries costs tokens of its own.
      expect(
        expected.estimatedPromptTokens - bare.estimatedPromptTokens,
      ).toBeGreaterThan(16);
      const fixture = await journalSendFixture(rows, [], {
        directory: 'tmp/responses-native/fixtures',
      });
      try {
        expect(await estimate(fixture.selection, 'gpt-5.2')).toStrictEqual(
          expected,
        );
      } finally {
        await fixture.close();
      }
    },
  );
});
