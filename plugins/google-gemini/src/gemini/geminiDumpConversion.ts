/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gemini-owned dump conversion: builds the Gemini wire body used by the
 * context-dump tooling. Owned inside the Gemini provider implementation tree
 * so the neutral request-conversion dispatcher stays provider-id-only.
 */

import type { ToolOutputSettingsProvider } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  convertHistoryToGeminiFormat,
  convertGeminiRow,
} from './GeminiMessageConverter.js';
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export function isGeminiCompatibleProvider(providerName: string): boolean {
  const provider = providerName.toLowerCase().trim();
  return provider === 'gemini' || provider.startsWith('gemini-');
}

export function buildGeminiDumpContents(
  history: IContent[],
  model?: string,
  config?: ToolOutputSettingsProvider,
): unknown[] {
  return convertHistoryToGeminiFormat(history, model, config);
}

export async function* buildGeminiDumpContentsStream(
  source: HistoryDumpSource,
  model?: string,
  config?: ToolOutputSettingsProvider,
): AsyncIterable<unknown> {
  for await (const row of source.rows())
    yield* convertGeminiRow(row, model, config);
}
