/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryJournalOp } from './historyJournalStore.js';
import type { SessionEventType } from '../../recording/types.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';

/** Keep caller objects in the pending overlay; normalize only durable values. */
export function opToEnvelope(op: HistoryJournalOp): {
  readonly type: SessionEventType;
  readonly payload: unknown;
} {
  switch (op.kind) {
    case 'content':
      return {
        type: 'content',
        payload: {
          content: sanitizeProviderContentForSerialization(op.content),
        },
      };
    case 'rewind':
      return op.cutSeq === undefined
        ? { type: 'rewind', payload: { itemsRemoved: op.itemsRemoved } }
        : {
            type: 'rewind',
            payload: { itemsRemoved: op.itemsRemoved, cutSeq: op.cutSeq },
          };
    case 'compressed':
      return {
        type: 'compressed',
        payload: {
          summary: sanitizeProviderContentForSerialization(op.summary),
          itemsCompressed: op.itemsCompressed,
        },
      };
    case 'compressionDetail':
      return { type: 'compression_detail', payload: op.payload };
    case 'syntheticInsert':
      return {
        type: 'synthetic_insert',
        payload: {
          ...op.payload,
          content: sanitizeProviderContentForSerialization(op.payload.content),
        },
      };
    case 'density':
      return {
        type: 'density_mutation',
        payload: {
          ...op.payload,
          replacements: op.payload.replacements.map((entry) => ({
            replacedSeq: entry.replacedSeq,
            replacement: sanitizeProviderContentForSerialization(
              entry.replacement,
            ),
          })),
        },
      };
    default: {
      const exhaustive: never = op;
      void exhaustive;
      throw new Error('unreachable: unmapped history journal op');
    }
  }
}
