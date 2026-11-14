/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { DensityConfig } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { NativeDensityPolicy } from '@vybestack/llxprt-code-core/services/history/nativeDensityPolicy.js';
import {
  DENSITY_RECENCY_REVISION,
  DENSITY_PRUNED_POINTER,
} from '@vybestack/llxprt-code-core/services/history/densityRecencyFacts.js';

import { nativeFileDedupe } from './native-file-dedupe.js';
import { nativeReadWrite } from './native-read-write.js';

export function nativeRecencyPolicy(
  config: DensityConfig,
): NativeDensityPolicy {
  const readWrite = config.readWritePruning
    ? nativeReadWrite(config)
    : undefined;
  return {
    readWrite: readWrite?.readWrite,
    files:
      readWrite?.files ??
      (config.fileDedupe ? nativeFileDedupe(config.workspaceRoot) : undefined),
    factRevision: DENSITY_RECENCY_REVISION,
    retention: config.recencyPruning
      ? Math.max(1, config.recencyRetention)
      : Number.POSITIVE_INFINITY,
    async replace(row, selected) {
      if (row.speaker !== 'tool') return undefined;
      const blocks = [...row.blocks];
      let changed = false;
      for (let block = 0; block < blocks.length; block++) {
        const value = blocks[block];
        if (
          value.type !== 'tool_response' ||
          value.result === DENSITY_PRUNED_POINTER
        )
          continue;
        if (await selected(block, value.toolName)) {
          blocks[block] = { ...value, result: DENSITY_PRUNED_POINTER };
          changed = true;
        }
      }
      return changed ? { ...row, blocks } : undefined;
    },
  };
}
