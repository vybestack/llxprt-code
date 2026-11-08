/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

function sharesMedia(actual: IContent, declared: IContent): boolean {
  const declaredMedia = new Set(mediaIdentities(declared));
  return mediaIdentities(actual).some((identity) =>
    declaredMedia.has(identity),
  );
}

/**
 * True when `actual` is the declared pending item or a rewrite of it. A hook
 * may change the text, so equal text proves nothing; the shared provenance or
 * attachment identity does. Conflicting provenance disproves identity even
 * when the same attachment appears again, as when the user pastes an image
 * they sent earlier.
 */
function isRewriteOf(actual: IContent, declared: IContent): boolean {
  if (actual === declared) return true;
  if (actual.speaker !== declared.speaker) return false;
  let sharesProvenance = false;
  for (const key of PROVENANCE_KEYS) {
    const mine = provenance(actual, key);
    const theirs = provenance(declared, key);
    if (mine === undefined || theirs === undefined) continue;
    if (mine !== theirs) return false;
    sharesProvenance = true;
  }
  if (!sharesProvenance) return sharesMedia(actual, declared);
  // A shared turn does not vouch for a different attachment set.
  const actualHasMedia = mediaIdentities(actual).length > 0;
  const declaredHasMedia = mediaIdentities(declared).length > 0;
  return !actualHasMedia || !declaredHasMedia || sharesMedia(actual, declared);
}

/**
 * Index where the region retirement must never touch begins. A proven tail is
 * exactly the declared pending region. Otherwise the declared items are
 * identified from the newest content backwards, in order, and the region
 * starts at the earliest one found; everything after it is kept, including
 * items a hook appended. Items that cannot be identified are not guessed at,
 * and when none can be, only the newest content is protected.
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
  let start = newest;
  let searchFrom = contents.length - 1;
  for (let item = pending.length - 1; item >= 0; item -= 1) {
    for (let index = searchFrom; index >= 0; index -= 1) {
      if (isRewriteOf(contents[index], pending[item])) {
        start = Math.min(start, index);
        searchFrom = index - 1;
        break;
      }
    }
  }
  return start;
}
