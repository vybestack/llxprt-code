/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderContentEnvelope } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * Where the protected pending region of a composed request begins (issue
 * #4000). Retirement and overflow classification both use this one boundary so
 * they can never disagree about which media the request itself must keep.
 *
 * The region is proven when the contents tail carries exactly the declared
 * pending items. When a hook or normalization rewrote the tail, each declared
 * item is located by the stable identity it carries (metadata id, turn id,
 * prompt id, media identity) and never by equal text found in history. If no
 * declared item can be identified, only the newest content is protected.
 */

const MAX_COMPARE_DEPTH = 64;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural equality for serializable block data. Depth is bounded so a
 * cyclic payload can never be proven equal: unproven means fail closed.
 */
function sameValue(left: unknown, right: unknown, depth = 0): boolean {
  if (left === right) return true;
  if (depth > MAX_COMPARE_DEPTH) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index], depth + 1))
    );
  }
  if (isPlainRecord(left) && isPlainRecord(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every((key) =>
      sameValue(left[key], right[key], depth + 1),
    );
  }
  return false;
}

function samePendingContent(actual: IContent, declared: IContent): boolean {
  return (
    actual === declared ||
    (actual.speaker === declared.speaker &&
      sameValue(actual.blocks, declared.blocks))
  );
}

/** True when the contents tail carries exactly the declared pending region. */
export function isPendingRegionProven(
  contents: readonly IContent[],
  pending: readonly IContent[] | undefined,
): boolean {
  if (pending === undefined) return false;
  const splitAt = contents.length - pending.length;
  return (
    splitAt >= 0 &&
    contents
      .slice(splitAt)
      .every((content, index) => samePendingContent(content, pending[index]))
  );
}

const PROVENANCE_KEYS = ['id', 'turnId', 'promptId'] as const;

function provenance(
  content: IContent,
  key: (typeof PROVENANCE_KEYS)[number],
): string | undefined {
  const value = content.metadata?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Identity of the attachments a content carries: the content id of a stored
 * reference, or the payload of an inline block. Payload strings are compared
 * as they are so large images are never copied into keys.
 */
function mediaIdentities(content: IContent): string[] {
  return content.blocks.flatMap((block) => {
    if (block.type !== 'media') return [];
    return block.encoding === 'reference' ? [block.contentId] : [block.data];
  });
}

/**
 * A declared pending item with its attachment occurrences computed once: each
 * identity maps to how many times the item carries it, because a user can
 * paste the same image twice.
 */
interface DeclaredItem {
  readonly content: IContent;
  readonly identities: ReadonlyMap<string, number>;
}

export function declaredItem(content: IContent): DeclaredItem {
  const identities = new Map<string, number>();
  for (const identity of mediaIdentities(content)) {
    identities.set(identity, (identities.get(identity) ?? 0) + 1);
  }
  return { content, identities };
}

function sharesMedia(
  actual: IContent,
  identities: ReadonlyMap<string, number>,
): boolean {
  return mediaIdentities(actual).some((identity) => identities.has(identity));
}

/**
 * True when `actual` is the declared pending item or a rewrite of it. A hook
 * may change the text, so equal text proves nothing; the shared provenance or
 * attachment identity does. Conflicting provenance disproves identity even
 * when the same attachment appears again, as when the user pastes an image
 * they sent earlier.
 */
export function isRewriteOf(actual: IContent, declared: DeclaredItem): boolean {
  if (actual === declared.content) return true;
  if (actual.speaker !== declared.content.speaker) return false;
  let sharesProvenance = false;
  for (const key of PROVENANCE_KEYS) {
    const mine = provenance(actual, key);
    const theirs = provenance(declared.content, key);
    if (mine === undefined || theirs === undefined) continue;
    if (mine !== theirs) return false;
    sharesProvenance = true;
  }
  if (!sharesProvenance) return sharesMedia(actual, declared.identities);
  // A shared turn does not vouch for a different attachment set.
  return (
    declared.identities.size === 0 ||
    mediaIdentities(actual).length === 0 ||
    sharesMedia(actual, declared.identities)
  );
}

/**
 * True when `actual` carries the declared item's provenance: it agrees on at
 * least one of metadata id, turn id and prompt id, and contradicts none. Text
 * and attachments play no part, so this never claims content the item merely
 * resembles.
 */
export function carriesProvenanceOf(
  actual: IContent,
  declared: IContent,
): boolean {
  if (actual.speaker !== declared.speaker) return false;
  let agrees = false;
  for (const key of PROVENANCE_KEYS) {
    const mine = provenance(actual, key);
    const theirs = provenance(declared, key);
    if (mine === undefined || theirs === undefined) continue;
    if (mine !== theirs) return false;
    agrees = true;
  }
  return agrees;
}

/**
 * Moves the start of the item's region back over the contiguous run of
 * contents that carry its provenance. The attachment search can stop too late:
 * a hook that duplicated an image into a later fragment satisfies the count on
 * its own, and the earlier fragment of the same turn would be left outside.
 * The run ends at the first content without the provenance.
 */
function extendOverSameProvenance(
  contents: readonly IContent[],
  item: DeclaredItem,
  start: number,
): number {
  let earliest = start;
  while (
    earliest > 0 &&
    carriesProvenanceOf(contents[earliest - 1], item.content)
  ) {
    earliest -= 1;
  }
  return earliest;
}

/**
 * True when `candidate` is a fragment of `item` that matters to the search.
 * The first fragment found is any rewrite of the item; each later one must
 * also carry an attachment occurrence of the item not yet placed, so an
 * earlier copy of an image whose occurrences are all placed cannot drag
 * history into the region.
 */
function isRelevantFragment(
  candidate: IContent,
  item: DeclaredItem,
  unplaced: ReadonlyMap<string, number>,
  foundAny: boolean,
): boolean {
  if (!isRewriteOf(candidate, item)) return false;
  return !foundAny || mediaIdentities(candidate).some((id) => unplaced.has(id));
}

/** Marks one occurrence of `identity` placed; surplus copies are ignored. */
function placeOccurrence(
  unplaced: Map<string, number>,
  identity: string,
): void {
  const remaining = unplaced.get(identity);
  if (remaining === undefined) return;
  if (remaining <= 1) unplaced.delete(identity);
  else unplaced.set(identity, remaining - 1);
}

/**
 * Index of the earliest fragment of `item` at or before `searchFrom`. A hook
 * may split one declared item into several contents, so the newest match is
 * not enough: the search continues backwards until every attachment occurrence
 * of the item is placed, then over any contiguous fragments of the same
 * provenance.
 */
function earliestFragment(
  contents: readonly IContent[],
  item: DeclaredItem,
  searchFrom: number,
): number | undefined {
  const unplaced = new Map(item.identities);
  let earliest: number | undefined;
  for (
    let index = searchFrom;
    index >= 0 && (earliest === undefined || unplaced.size > 0);
    index -= 1
  ) {
    const candidate = contents[index];
    if (isRelevantFragment(candidate, item, unplaced, earliest !== undefined)) {
      earliest = index;
      mediaIdentities(candidate).forEach((id) => placeOccurrence(unplaced, id));
    }
  }
  return earliest === undefined
    ? undefined
    : extendOverSameProvenance(contents, item, earliest);
}

/**
 * Index where the region retirement must never touch begins. A proven tail is
 * exactly the declared pending region. Otherwise the declared items are
 * identified from the newest content backwards, in order, and the region
 * starts at the earliest fragment of the earliest item found; everything
 * after it is kept, including items a hook appended. Items that cannot be
 * identified are not guessed at, and when none can be, only the newest
 * content is protected.
 */
export function protectedRegionStart(
  contents: readonly IContent[],
  pending: readonly IContent[] | undefined,
): number {
  const newest = Math.max(0, contents.length - 1);
  if (pending === undefined) return newest;
  if (isPendingRegionProven(contents, pending)) {
    return contents.length - pending.length;
  }
  const items = pending.map(declaredItem);
  let start = newest;
  let searchFrom = contents.length - 1;
  for (let item = items.length - 1; item >= 0; item -= 1) {
    const earliest = earliestFragment(contents, items[item], searchFrom);
    if (earliest === undefined) continue;
    start = Math.min(start, earliest);
    searchFrom = earliest - 1;
  }
  return start;
}

/**
 * {@link protectedRegionStart} for an envelope. The declared compression
 * boundary decides when there is one. Without it the user's original items
 * (`protectedContents`) still identify their own fragments, so a hook that
 * restructured the request cannot turn the user's fresh attachments into
 * retirable history. The identity search only protects media; it never makes
 * compression available.
 */
export function envelopeProtectedStart(
  envelope: Pick<
    ProviderContentEnvelope,
    'contents' | 'pendingContents' | 'protectedContents'
  >,
): number {
  return protectedRegionStart(
    envelope.contents,
    envelope.pendingContents ?? envelope.protectedContents,
  );
}
