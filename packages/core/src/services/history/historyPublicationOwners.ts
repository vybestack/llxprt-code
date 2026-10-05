/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryJournalOp } from './historyJournalStore.js';
import type { IContent } from './IContent.js';
import type { SessionRecordLine } from '../../recording/types.js';
import {
  fieldOf,
  isSpeakerContent,
  isDensityReplacementRecord,
} from './historyJournalGuards.js';

export function recordPublicationOwners(
  line: SessionRecordLine | null,
): Iterable<IContent> {
  return {
    *[Symbol.iterator](): Generator<IContent, void, unknown> {
      if (line === null) return;
      if (
        line.type === 'content' ||
        line.type === 'synthetic_insert' ||
        line.type === 'compressed'
      ) {
        const row = fieldOf(
          line.payload,
          line.type === 'compressed' ? 'summary' : 'content',
        );
        if (!isSpeakerContent(row))
          throw new Error('Invalid publication envelope row');
        yield row;
      } else if (line.type === 'density_mutation') {
        const replacements = fieldOf(line.payload, 'replacements');
        if (!Array.isArray(replacements))
          throw new Error('Invalid publication replacements');
        for (const entry of replacements) {
          if (!isDensityReplacementRecord(entry))
            throw new Error('Invalid publication replacement');
          yield entry.replacement;
        }
      }
    },
  };
}

export function journalPublicationOwners(
  op: HistoryJournalOp,
): Iterable<IContent> {
  return {
    *[Symbol.iterator](): Generator<IContent, void, unknown> {
      if (op.kind === 'content') yield op.content;
      else if (op.kind === 'compressed') yield op.summary;
      else if (op.kind === 'syntheticInsert') yield op.payload.content;
      else if (op.kind === 'density') {
        for (const item of op.payload.replacements) yield item.replacement;
      }
    },
  };
}
