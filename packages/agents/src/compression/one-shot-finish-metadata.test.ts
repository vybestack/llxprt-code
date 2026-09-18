/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { EmptySummaryError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { OneShotStrategy } from './OneShotStrategy.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  buildContext,
  createFakeProvider,
  generateHistory,
} from './__tests__/MiddleOutStrategy-test-helpers.js';

describe('One-shot finish diagnostics', () => {
  it('retains the normalized and native reasons when thinking exhausts the output budget', async () => {
    const provider = {
      ...createFakeProvider('thinking-only'),
      async *generateChatCompletion(): AsyncGenerator<IContent> {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'thinking', thought: 'Analyze the conversation.' }],
        };
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: { finishReason: 'max_tokens', rawStopReason: 'incomplete' },
        };
      },
    };
    const context = buildContext({
      history: generateHistory(20),
      resolveProvider: () => ({
        provider,
        runtime: createProviderRuntimeContext({
          settingsService: new SettingsService(),
        }),
      }),
    });

    const result = new OneShotStrategy().compress(context);

    await expect(result).rejects.toBeInstanceOf(EmptySummaryError);
    await expect(result).rejects.toMatchObject({
      finishReason: 'max_tokens',
      rawStopReason: 'incomplete',
      thinkingBlockCount: 1,
    });
  });
});
