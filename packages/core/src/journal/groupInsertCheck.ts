/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  plannedFromDraft,
  type FactDeps,
  type GroupFacts,
} from './groupFacts.js';
import { EMPTY_ID_FACT, type IdFact } from './idFactCodec.js';
import type { IdFactQueries } from './idFactQueries.js';
import {
  entersNormalizedList,
  isKimiException,
  normalizedIdOf,
  updateFact,
  type IdOccurrence,
} from './idFactUpdate.js';
import { ID_NS, OCCURRENCE_KIND } from './idKeys.js';
import type { RowDraft } from './rowDraft.js';
import { ROW_FLAG } from './rowRecord.js';
import { hasActiveSlot } from './version.js';
import type { SlotTable } from './slotTable.js';

const FAMILIES = [ID_NS.openai, ID_NS.anthropic] as const;

/**
 * Is adding this occurrence in the middle of the history the same as adding it
 * in position order? Facts are first-occurrence and ordinal rules, so they
 * agree when the id has no occurrence of the kind yet and a response has its
 * call at or before it (design 4.6). The lists of the normalized ids are
 * kept in position order too, and two raw ids can share one, so the new
 * position must also come after the last entry of each list it joins.
 */
async function addsInOrder(
  queries: IdFactQueries,
  deps: FactDeps,
  label: bigint,
  occurrence: IdOccurrence,
  before: IdFact | undefined,
): Promise<boolean> {
  if (occurrence.reconstructed) return false;
  if (occurrence.kind === OCCURRENCE_KIND.call) {
    if ((before?.callCount ?? 0) !== 0) return false;
  } else {
    if ((before?.respCount ?? 0) !== 0) return false;
    if (before?.firstCall === undefined || before.firstCall.label > label) {
      return false;
    }
  }
  for (const family of FAMILIES) {
    if (
      deps.idDeps.occurrenceSpace !== 'normalized' ||
      !entersNormalizedList(occurrence, family)
    )
      continue;
    const normalized = normalizedIdOf(
      deps.idDeps.normalizers,
      family,
      occurrence.rawId,
    );
    const behind = await queries.lastAtOrAfter(
      family,
      occurrence.kind,
      normalized,
      occurrence.unit.position,
    );
    if (behind) return false;
  }
  return true;
}

/** Would this occurrence make its id a Kimi exception id, which the list orders by arrival? */
function startsException(
  occurrence: IdOccurrence,
  before: IdFact | undefined,
  after: IdFact,
): boolean {
  const was = before !== undefined && isKimiException(occurrence.rawId, before);
  return !was && isKimiException(occurrence.rawId, after);
}

/**
 * The occurrences of a synthetic row when its facts can be added to the
 * trie as they are, or undefined when they must be rebuilt: a format slot is
 * active (mapped ids depend on every earlier id), the row is a usable
 * parent (the parent lists are in label order), or an occurrence fails the
 * order test above. The batch is not touched, so a rebuild can follow.
 */
export async function monotoneInsertOccurrences(
  facts: GroupFacts,
  deps: FactDeps,
  slots: SlotTable,
  label: bigint,
  draft: RowDraft,
): Promise<readonly IdOccurrence[] | undefined> {
  if (hasActiveSlot(slots)) return undefined;
  if ((draft.flags & ROW_FLAG.responseParent) !== 0) return undefined;
  const queries = facts.ids.queries;
  const occurrences = await deps.planOccurrences(
    plannedFromDraft(label, draft),
    queries,
  );
  const simulated = new Map<string, IdFact>();
  for (const occurrence of occurrences) {
    const before =
      simulated.get(occurrence.rawId) ?? (await queries.fact(occurrence.rawId));
    if (!(await addsInOrder(queries, deps, label, occurrence, before))) {
      return undefined;
    }
    const after = updateFact(before ?? EMPTY_ID_FACT, occurrence);
    if (startsException(occurrence, before, after)) return undefined;
    simulated.set(occurrence.rawId, after);
  }
  return occurrences;
}
