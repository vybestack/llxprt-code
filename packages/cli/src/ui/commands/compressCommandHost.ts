/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CompressionStatus } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { HistoryItemCompression } from '../types.js';
import { MessageType } from '../types.js';

function finalItem(
  originalTokenCount: number | null,
  newTokenCount: number | null,
  compressionStatus: CompressionStatus,
): HistoryItemCompression {
  return {
    type: MessageType.COMPRESSION,
    compression: {
      isPending: false,
      originalTokenCount,
      newTokenCount,
      compressionStatus,
    },
  };
}

function agentStatus(
  status: 'compressed' | 'skipped' | 'failed' | 'noop',
  original: number | undefined,
  current: number | undefined,
): CompressionStatus {
  if (status === 'failed') return CompressionStatus.COMPRESSION_FAILED;
  if (status === 'noop' || status === 'skipped') return CompressionStatus.NOOP;
  if (original === undefined || current === undefined)
    return CompressionStatus.NOOP;
  if (current < original) return CompressionStatus.COMPRESSED;
  if (current > original)
    return CompressionStatus.COMPRESSION_FAILED_INFLATED_TOKEN_COUNT;
  return CompressionStatus.NOOP;
}

export function bindCompressCommand(
  compress: Agent['compress'] | null,
): (promptId: string) => Promise<HistoryItemCompression> {
  return async (promptId) => {
    if (compress === null) {
      throw new Error('Chat instance not available for compression.');
    }
    const result = await compress({ promptId });
    return finalItem(
      result.originalTokenCount ?? null,
      result.newTokenCount ?? null,
      agentStatus(
        result.status,
        result.originalTokenCount,
        result.newTokenCount,
      ),
    );
  };
}
