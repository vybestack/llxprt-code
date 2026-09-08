/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { sanitizePromptCacheKey } from '../openai-responses/sanitizePromptCacheKey.js';

export interface KimiCacheAffinityContext {
  readonly providerName: string;
  readonly runtimeId: string;
  readonly cacheAffinityKey: boolean;
}

export function applyKimiCacheAffinity(
  request: Record<string, unknown>,
  context: KimiCacheAffinityContext,
): void {
  if (
    context.providerName !== 'kimi' ||
    !context.cacheAffinityKey ||
    request['prompt_cache_key'] !== undefined
  ) {
    return;
  }
  const runtimeId = context.runtimeId.trim();
  if (runtimeId === '') return;
  request['prompt_cache_key'] = sanitizePromptCacheKey(runtimeId);
}
