/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryJournalOp } from './historyStorePort.js';
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

/**
 * The replacement rows of a density op. A class method reads `this`, so the
 * iterable keeps nothing but the replacements; a generator literal closing
 * over the op would leave the op's scope (and with it the last row admitted)
 * reachable from the engine for many collections after the admission.
 */
class DensityReplacementRows implements Iterable<IContent> {
  constructor(
    private readonly replacements: ReadonlyArray<{
      readonly replacement: IContent;
    }>,
  ) {}

  *[Symbol.iterator](): Generator<IContent, void, unknown> {
    for (const item of this.replacements) yield item.replacement;
  }
}

export function journalPublicationOwners(
  op: HistoryJournalOp,
): Iterable<IContent> {
  if (op.kind === 'content') return [op.content];
  if (op.kind === 'compressed') return [op.summary];
  if (op.kind === 'syntheticInsert') return [op.payload.content];
  if (op.kind === 'density')
    return new DensityReplacementRows(op.payload.replacements);
  return [];
}
