/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CompressionAuditProvenance,
  CompressionStrategyName,
} from '@vybestack/llxprt-code-core/core/compression/types.js';

/**
 * Who wrote the summary an applied compression produced (#4101): the
 * summarizing strategies report the provider and model that answered the
 * request; strategies that only drop or rewrite rows have no author.
 */
export function summarizerProvenance(
  strategy: 'middle-out' | 'one-shot',
  provider: string,
  model: string | null,
): CompressionAuditProvenance {
  return {
    summaryAuthorModel: model,
    summaryAuthorProvider: provider,
    compressionStrategy: strategy,
  };
}

export function unauthoredProvenance(
  strategy: CompressionStrategyName,
): CompressionAuditProvenance {
  return {
    summaryAuthorModel: null,
    summaryAuthorProvider: null,
    compressionStrategy: strategy,
  };
}
