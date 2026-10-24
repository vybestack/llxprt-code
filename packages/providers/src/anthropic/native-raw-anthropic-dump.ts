/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import type { AnthropicConversationConversionOptions } from './AnthropicMessageNormalizer.js';
import { rawAnthropicDumpSettings } from './caller-owned-anthropic-dump.js';
import {
  rawAnthropicFactIndex,
  RawAnthropicQuery,
} from './raw-anthropic-index.js';
import { AnthropicRepairIndex } from './anthropic-repair-index.js';
import { AnthropicRepairSource } from './anthropic-repair-source.js';
import { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import { StreamJsonValue } from '../utils/streamJsonValue.js';
import { rawAnthropicWireBytes } from './raw-anthropic-chain-results.js';

export function nativeRawAnthropicDump(
  source: HistoryDumpSource,
  options: AnthropicConversationConversionOptions,
): StreamJsonValue {
  return new StreamJsonValue(async function* () {
    if (source.withRawFacts === undefined)
      throw new Error(
        'Anthropic dump requires caller-owned rows or a pinned raw journal source',
      );
    const settings = rawAnthropicDumpSettings(options);
    const registration = rawAnthropicFactIndex(settings);
    const prepared = await source.withRawFacts(
      registration,
      async (snapshot) => {
        const retained = snapshot.retain();
        try {
          const facts = await retained.nativeFacts(registration.scope);
          const query = new RawAnthropicQuery(retained, facts);
          const index = await AnthropicRepairIndex.read(facts);
          const engine = await AnthropicStreamRepair.fromSource(
            new AnthropicRepairSource(query, settings, index, undefined, false),
            index,
            {
              strip: options.stripFromContext,
              includeInContext: options.includeInContext,
            },
          );
          return { engine, close: () => retained.close() };
        } catch (error) {
          await retained.close();
          throw error;
        }
      },
    );
    try {
      yield* rawAnthropicWireBytes(prepared.engine.wirePieces());
    } finally {
      await prepared.close();
    }
  });
}
