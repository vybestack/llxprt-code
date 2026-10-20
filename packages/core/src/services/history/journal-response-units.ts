/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import { strippedSelf } from './journal-orphan-units.js';
import {
  responseParts,
  responsePartContent,
  UnsupportedJournalNormalizationError,
} from './journal-response-parts.js';
import {
  assertResponsePartSupported,
  responseAdjacent,
} from './journal-response-slots.js';

export async function* streamJournalResponseUnits(
  snapshot: VersionSnapshot,
  tail: readonly IContent[] = [],
): AsyncGenerator<IContent> {
  if (tail.length !== 0)
    throw new UnsupportedJournalNormalizationError(
      'Tail normalization is not implemented',
    );
  const release = snapshot.hold();
  const parts = responseParts(snapshot);
  try {
    let current = await parts.next();
    while (current.done !== true) {
      const part = current.value;
      await assertResponsePartSupported(snapshot, part);
      const next = await parts.next();
      const self = strippedSelf(
        sanitizeProviderContentForSerialization(
          await responsePartContent(snapshot, part),
        ),
      );
      if (self !== undefined) yield self;
      const adjacent = await responseAdjacent(
        snapshot,
        part,
        next.done === true ? undefined : next.value,
      );
      if (adjacent !== undefined)
        yield sanitizeProviderContentForSerialization(adjacent);
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
