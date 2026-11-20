/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecencyFactPolicy } from '../../journal/recencyFacts.js';
import { ROW_BLOCK_TYPE } from '../../journal/rowRecord.js';
import { decodeStoredBlock } from './journalRowCodec.js';

export const DENSITY_RERUN_HINT_SUFFIX = '— re-run to view';
export const DENSITY_PRUNED_POINTER = `[Result pruned ${DENSITY_RERUN_HINT_SUFFIX}]`;
export const DENSITY_RECENCY_REVISION = 'raw-tool-response-excluding-pruned:1';

export const densityRecencyFactPolicy: RecencyFactPolicy = {
  revision: DENSITY_RECENCY_REVISION,
  bucket(bytes) {
    const block = decodeStoredBlock(bytes, ROW_BLOCK_TYPE.tool_response);
    if (block.type !== 'tool_response')
      throw new Error('Expected tool response');
    return block.result === DENSITY_PRUNED_POINTER ? undefined : block.toolName;
  },
};
