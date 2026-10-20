/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import type { IContent } from './IContent.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import { strippedSelf } from './journal-orphan-units.js';
import { countDecodedRow } from './journalRowCounters.js';
import {
  responsePartContent,
  UnsupportedJournalNormalizationError,
  type ResponsePart,
} from './journal-response-parts.js';
import { responseAdjacent } from './journal-response-slots.js';
import { completedResponseParts } from './journal-reconstruction.js';

async function* chargedUnit(
  row: IContent | undefined,
  counters: JournalReadCounters | undefined,
): AsyncGenerator<IContent> {
  if (row === undefined) return;
  const release = countDecodedRow(row, counters);
  try {
    yield row;
  } finally {
    release();
  }
}

async function* selfUnit(
  snapshot: VersionSnapshot,
  part: ResponsePart,
  counters: JournalReadCounters | undefined,
): AsyncGenerator<IContent> {
  yield* chargedUnit(
    strippedSelf(
      sanitizeProviderContentForSerialization(
        await responsePartContent(snapshot, part),
      ),
    ),
    counters,
  );
}

export async function* streamJournalResponseUnits(
  snapshot: VersionSnapshot,
  tail: readonly IContent[] = [],
  counters?: JournalReadCounters,
): AsyncGenerator<IContent> {
  if (tail.length !== 0)
    throw new UnsupportedJournalNormalizationError(
      'Tail normalization is not implemented',
    );
  const release = snapshot.hold();
  const parts = completedResponseParts(snapshot);
  try {
    let current = await parts.next();
    while (current.done !== true) {
      const part = current.value;
      const next = await parts.next();
      yield* selfUnit(snapshot, part, counters);
      yield* chargedUnit(
        await responseAdjacent(
          snapshot,
          part,
          next.done === true ? undefined : next.value,
        ),
        counters,
      );
      current = next;
    }
  } finally {
    try {
      await parts.return(undefined);
    } finally {
      await release();
    }
  }
}
