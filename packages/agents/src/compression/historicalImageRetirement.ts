/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderContentEnvelope } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type {
  ContentBlock,
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { invalidateResponsesStatefulChainForRetainedRewrite } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RequestMediaByteOverflowError } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { PendingMediaBudgetError } from './pendingMediaBudgetError.js';

/**
 * Fraction of the request media budget a retirement batch retires down to.
 * Retiring to a lower mark than the trigger means the next small image does
 * not change the request prefix again.
 */
export const IMAGE_RETIREMENT_TARGET_RATIO = 0.75;

const MAX_FILENAME_LENGTH = 255;

interface ImageSlot {
  readonly contentIndex: number;
  readonly blockIndex: number;
  readonly bytes: number;
  readonly block: MediaBlock;
}

/**
 * Encoded size of a media block as the request-media resolver counts it, or
 * undefined for URL media and for blocks whose size cannot be trusted. Those
 * are neither counted nor retired so the resolver still reports them.
 */
function countedBytes(block: ContentBlock): number | undefined {
  if (block.type !== 'media' || block.encoding === 'url') {
    return undefined;
  }
  const length =
    block.encoding === 'reference' ? block.normalizedBase64Length : block.data;
  const bytes = typeof length === 'string' ? length.length : length;
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : undefined;
}

function isImage(block: MediaBlock): boolean {
  return block.mimeType.toLowerCase().startsWith('image/');
}

function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function isReadableFilename(filename: string | undefined): filename is string {
  return (
    filename !== undefined &&
    filename.trim().length > 0 &&
    filename.length <= MAX_FILENAME_LENGTH &&
    !hasControlCharacter(filename)
  );
}

/**
 * Honest replacement for retired pixels. It never describes what the image
 * showed and never offers a handle the tools cannot resolve: a re-read is
 * only suggested when the block carries a usable file name.
 */
function retirementNote(slot: ImageSlot): string {
  const { block } = slot;
  const filename = isReadableFilename(block.filename)
    ? block.filename
    : undefined;
  const subject =
    filename === undefined
      ? `Earlier image (${block.mimeType}, ${slot.bytes} encoded bytes)`
      : `Earlier image ${JSON.stringify(filename)} (${block.mimeType}, ${slot.bytes} encoded bytes)`;
  const recovery =
    filename === undefined
      ? 'The pixels cannot be re-read by name; ask the user to provide the image again if they are needed.'
      : `If you need the pixels again and the file is still in the workspace, read ${JSON.stringify(filename)} again.`;
  return `[${subject} was omitted from this request to stay within the image size budget. Your earlier observations in this conversation remain. ${recovery}]`;
}

/**
 * Request-view retirement of the oldest historical images (issue #3984).
 *
 * The result is a view for one provider request; canonical history, media
 * ownership and stored originals are never touched. The retired set is a pure
 * function of the history order, so it is recomputed identically on every
 * request and after a resume. It replays image admission in order: whenever
 * the running encoded total crosses `budgetBytes`, the oldest images retire
 * until the total is at {@link IMAGE_RETIREMENT_TARGET_RATIO} of the budget.
 * The content that caused a crossing and the explicit `pending` region are
 * never retired, and neither is non-image or URL media.
 *
 * Retiring rewrites earlier request text, which costs a provider prompt-cache
 * prefix at most once per batch rather than once per request.
 *
 * Returns `history` itself when nothing retires. A zero budget disables
 * retirement so the resolver's explicit rejection policy still applies.
 */
export function retireHistoricalImages(
  history: IContent[],
  pending: readonly IContent[],
  budgetBytes: number,
): IContent[] {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0) {
    return history;
  }
  const target = Math.floor(budgetBytes * IMAGE_RETIREMENT_TARGET_RATIO);
  const candidates: ImageSlot[] = [];
  const retired = new Map<string, ImageSlot>();
  let next = 0;
  let total = 0;

  const retireOldest = (eligibleBefore: number): void => {
    while (total > target && next < candidates.length) {
      const slot = candidates[next];
      if (slot.contentIndex >= eligibleBefore) return;
      retired.set(`${slot.contentIndex}:${slot.blockIndex}`, slot);
      total -= slot.bytes;
      next += 1;
    }
  };

  history.forEach((content, contentIndex) => {
    content.blocks.forEach((block, blockIndex) => {
      const bytes = countedBytes(block);
      if (bytes === undefined || block.type !== 'media') return;
      total += bytes;
      if (isImage(block)) {
        candidates.push({ contentIndex, blockIndex, bytes, block });
      }
    });
    if (total > budgetBytes) retireOldest(contentIndex);
  });
  for (const content of pending) {
    for (const block of content.blocks) {
      total += countedBytes(block) ?? 0;
    }
  }
  if (total > budgetBytes) retireOldest(history.length);

  if (retired.size === 0) return history;
  const view = history.map((content, contentIndex) => {
    const blocks = content.blocks.map((block, blockIndex): ContentBlock => {
      const slot = retired.get(`${contentIndex}:${blockIndex}`);
      return slot === undefined
        ? block
        : { type: 'text', text: retirementNote(slot) };
    });
    return blocks.some((block, index) => block !== content.blocks[index])
      ? { ...content, blocks }
      : content;
  });
  // A stored Responses parent no longer describes the rewritten prefix, so the
  // view must not offer it as a continuation point. Only the view's own copies
  // lose the marker; canonical entries keep it.
  const firstRetired = Math.min(
    ...[...retired.values()].map((slot) => slot.contentIndex),
  );
  return invalidateResponsesStatefulChainForRetainedRewrite(view, firstRetired);
}

/** True when any content carries media the resolver would count. */
export function hasCountedMedia(contents: readonly IContent[]): boolean {
  return contents.some((content) =>
    content.blocks.some((block) => countedBytes(block) !== undefined),
  );
}

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

/**
 * Request view of an already composed envelope with the oldest historical
 * images retired. The envelope's pending contents are the authority. The tail
 * of the contents is trusted as that region only when it carries exactly the
 * declared speakers and blocks (the provider pipeline clones content, so
 * identity alone cannot be required). Anything else, such as appended hook
 * items the envelope does not name, rewritten pending blocks, or a payload
 * that cannot be compared, is unproven: nothing retires and nothing is
 * guessed. The envelope's own array is returned when nothing retires so a
 * projection prepared for it stays valid.
 */
export function retireEnvelopeImages(
  envelope: ProviderContentEnvelope,
  budgetBytes: number,
): IContent[] {
  const pending = envelope.pendingContents;
  if (pending === undefined) {
    return envelope.contents;
  }
  const splitAt = envelope.contents.length - pending.length;
  if (splitAt < 0) {
    return envelope.contents;
  }
  const tail = envelope.contents.slice(splitAt);
  if (
    !tail.every((content, index) => samePendingContent(content, pending[index]))
  ) {
    return envelope.contents;
  }
  const history = envelope.contents.slice(0, splitAt);
  const retired = retireHistoricalImages(history, tail, budgetBytes);
  return retired === history ? envelope.contents : [...retired, ...tail];
}

/**
 * Compression only helps with byte pressure when something other than the
 * request being sent can shrink: any body overflow, or a media overflow while
 * earlier media remains after retirement.
 */
export function compressionCanRelieve(
  error: unknown,
  contents: readonly IContent[],
  pendingCount: number,
): boolean {
  if (!(error instanceof RequestMediaByteOverflowError)) {
    return true;
  }
  return hasCountedMedia(
    contents.slice(0, Math.max(0, contents.length - pendingCount)),
  );
}

/** Names a pending-only media overflow; any other error passes through. */
export function explainPendingOverflow(
  error: unknown,
  budgetBytes: number,
): unknown {
  return error instanceof RequestMediaByteOverflowError && budgetBytes > 0
    ? new PendingMediaBudgetError(error)
    : error;
}
