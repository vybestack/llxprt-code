/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { AnthropicConversationConversionOptions } from './AnthropicMessageNormalizer.js';
import { callerOwnedAnthropicEngine } from './caller-owned-anthropic.js';
import { StreamJsonValue } from '../utils/streamJsonValue.js';
import { rawAnthropicWireBytes } from './raw-anthropic-chain-results.js';

export function rawAnthropicDumpSettings(
  options: AnthropicConversationConversionOptions,
): RowFormatSettings {
  return {
    formatId: 'anthropic',
    formatRev: 1,
    model: options.currentModel ?? '',
    endpoint: options.currentBaseURL ?? '',
    isOAuth: false,
    toolNameTransform: 'none',
    supportsUrlImages: options.supportsUrlImages ?? true,
    reasoningEnabled: options.reasoningEnabled,
    reasoningFieldName: 'reasoning_content',
    mediaPdfEnabled: true,
    unsupportedMedia: 'notice',
    outputLimits: options.config ?? null,
    anthropic: { cache: 'off', imageBudget: null },
  };
}

export function callerOwnedAnthropicDump(
  rows: ProviderRequestRows,
  options: AnthropicConversationConversionOptions,
): StreamJsonValue {
  const settings = rawAnthropicDumpSettings(options);
  return new StreamJsonValue(async function* () {
    const engine = await callerOwnedAnthropicEngine(
      rows,
      settings,
      {
        strip: options.stripFromContext,
        includeInContext: options.includeInContext,
      },
      true,
    );
    yield* rawAnthropicWireBytes(engine.wirePieces());
  });
}
