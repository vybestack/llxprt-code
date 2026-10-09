/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { replayableContents } from '../utils/collectContents.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  normalizeChatCompletionOptions,
  type NormalizerContext,
} from './optionsNormalizer.js';
import type { ProviderToolset } from '../IProvider.js';

const context: NormalizerContext = {
  providerName: 'openai-responses',
  statelessRuntimeMetadata: { session: 'isolated' },
  optionsNormalizer: null,
};
const tools: ProviderToolset = [
  {
    name: 'inspect',
    description: 'Inspect a nested value',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        value: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      },
      required: ['value'],
      additionalProperties: false,
    },
  },
];

describe('flat tool normalization and runtime metadata integration', () => {
  it('preserves the complete neutral schema and explicit empty tool selection', () => {
    const selected = normalizeChatCompletionOptions(
      { contents: replayableContents([]), tools },
      undefined,
      context,
    );
    expect(selected.tools?.[0]?.parametersJsonSchema).toStrictEqual({
      type: 'object',
      properties: {
        value: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      },
      required: ['value'],
      additionalProperties: false,
    });
    expect(
      normalizeChatCompletionOptions(
        { contents: replayableContents([]), tools: [] },
        tools,
        context,
      ).tools,
    ).toStrictEqual([]);
    expect(
      normalizeChatCompletionOptions(
        { contents: replayableContents([]) },
        undefined,
        context,
      ).tools,
    ).toBeUndefined();
    expect(
      normalizeChatCompletionOptions(
        { contents: replayableContents([]) },
        tools,
        context,
      ).tools,
    ).toHaveLength(1);
  });

  it('carries runtime hook-disabled tool metadata without an injected runtime', () => {
    const settingsService = new SettingsService();
    const options = {
      contents: replayableContents([]),
      tools: [],
      runtime: {
        settingsService,
        metadata: { conversationLogEmptyTools: true, routing: 'runtime' },
      },
      metadata: { routing: 'explicit' },
    };
    const normalized = normalizeChatCompletionOptions(options, tools, context);
    expect(normalized.metadata).toStrictEqual({
      session: 'isolated',
      conversationLogEmptyTools: true,
      routing: 'explicit',
    });
    expect(normalized.tools).toStrictEqual([]);
    expect(options.metadata).toStrictEqual({ routing: 'explicit' });
    expect(options.runtime.metadata).toStrictEqual({
      conversationLogEmptyTools: true,
      routing: 'runtime',
    });
  });
});
