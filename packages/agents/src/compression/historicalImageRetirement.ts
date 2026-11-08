/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  buildProviderContent,
  type ProviderContentEnvelope,
} from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type {
  ContentBlock,
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { invalidateResponsesStatefulChainForRetainedRewrite } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RequestMediaByteOverflowError } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { PendingMediaBudgetError } from './pendingMediaBudgetError.js';
import { envelopeProtectedStart } from './pendingBoundary.js';

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

  return renderRetirement(history, retired);
}

/**
 * Request view of `history` with the given image slots replaced by their
 * retirement notes, or `history` itself when nothing retires. A stored
 * Responses parent no longer describes the rewritten prefix, so the view must
 * not offer it as a continuation point; only the view's own copies lose the
 * marker and canonical entries keep it.
 */
function renderRetirement(
  history: IContent[],
  retired: ReadonlyMap<string, ImageSlot>,
): IContent[] {
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
  const firstRetired = Math.min(
    ...[...retired.values()].map((slot) => slot.contentIndex),
  );
  return invalidateResponsesStatefulChainForRetainedRewrite(view, firstRetired);
}

/**
 * Last-resort request view for media pressure that normal retirement did not
 * relieve: every image in `contents` before `protectedStart` is replaced by
 * its retirement note. Non-image and URL media stay, and the protected region
 * is never touched. Returns `contents` itself when no image retires.
 */
export function retireEveryHistoricalImage(
  contents: IContent[],
  protectedStart: number,
): IContent[] {
  const retired = new Map<string, ImageSlot>();
  contents.slice(0, protectedStart).forEach((content, contentIndex) => {
    content.blocks.forEach((block, blockIndex) => {
      const bytes = countedBytes(block);
      if (bytes !== undefined && block.type === 'media' && isImage(block)) {
        retired.set(`${contentIndex}:${blockIndex}`, {
          contentIndex,
          blockIndex,
          bytes,
          block,
        });
      }
    });
  });
  return renderRetirement(contents, retired);
}

/** True when any content carries media the resolver would count. */
export function hasCountedMedia(contents: readonly IContent[]): boolean {
  return contents.some((content) =>
    content.blocks.some((block) => countedBytes(block) !== undefined),
  );
}

/**
 * Request view of an already composed envelope with the oldest historical
 * images retired. The envelope's pending contents are the authority. The tail
 * of the contents is trusted as that region only when it carries exactly the
 * declared speakers and blocks (the provider pipeline clones content, so
 * identity alone cannot be required). Otherwise the boundary is unproven and
 * {@link envelopeProtectedStart} protects the newest content; media pressure
 * from older history must never end the turn (issue #4000). The envelope's
 * own array is returned when nothing retires so a projection prepared for it
 * stays valid.
 */
export function retireEnvelopeImages(
  envelope: ProviderContentEnvelope,
  budgetBytes: number,
): IContent[] {
  const splitAt = envelopeProtectedStart(envelope);
  const history = envelope.contents.slice(0, splitAt);
  const tail = envelope.contents.slice(splitAt);
  const retired = retireHistoricalImages(history, tail, budgetBytes);
  if (retired === history) return envelope.contents;
  // The history prefix dropped its own stale Responses parents; a parent in
  // the protected tail still continues the server-side chain that holds the
  // original pixels, so the complete rejoined view is checked from the first
  // rewritten entry. Only the view's copies lose markers.
  const firstRewritten = retired.findIndex(
    (content, index) => content.blocks !== history[index].blocks,
  );
  return invalidateResponsesStatefulChainForRetainedRewrite(
    [...retired, ...tail],
    firstRewritten,
  );
}

function sameBlock(left: ContentBlock, right: ContentBlock): boolean {
  if (left === right) return true;
  if (left.type !== right.type) return false;
  return (
    left.type !== 'text' || (right.type === 'text' && left.text === right.text)
  );
}

/**
 * Index of the first entry whose blocks differ between two compositions of the
 * same request, or 0 when they cannot be aligned. Retirement only swaps
 * blocks inside entries, so both compositions normalize identically and the
 * first difference is exactly where the request view starts to diverge from
 * what a stored Responses parent holds server-side.
 */
function firstRewrittenIndex(
  original: readonly IContent[],
  rewritten: readonly IContent[],
): number {
  if (original.length !== rewritten.length) return 0;
  const index = rewritten.findIndex(
    (content, position) =>
      content.blocks.length !== original[position].blocks.length ||
      content.blocks.some(
        (block, blockIndex) =>
          !sameBlock(block, original[position].blocks[blockIndex]),
      ),
  );
  return Math.max(0, index);
}

/**
 * The composed request view with Responses parents invalidated from the first
 * entry retirement rewrote. A stored parent before every retired image keeps
 * the server-side chain valid, because everything after it, retirement notes
 * included, is sent as new input. Only the view's copies lose markers.
 */
export function invalidateParentsFromFirstRetirement(
  original: readonly IContent[],
  retired: IContent[],
): IContent[] {
  return invalidateResponsesStatefulChainForRetainedRewrite(
    retired,
    firstRewrittenIndex(original, retired),
  );
}

/**
 * The provider-ready request for `curated` history and the pending region
 * with historical images retired (all of them, or oldest first to the budget).
 * Parent markers are invalidated over the fully rejoined request, pending tail
 * included, and only the request view's copies lose them. The unretired
 * composition is built only when retirement changed something.
 */
export function composeRetiredRequest(
  input: {
    readonly curated: IContent[];
    readonly pending: IContent[];
    readonly retireAll: boolean;
    readonly budgetBytes: number;
  },
  logger: DebugLogger,
): IContent[] {
  const { curated, pending } = input;
  const history = input.retireAll
    ? retireEveryHistoricalImage(curated, curated.length)
    : retireHistoricalImages(curated, pending, input.budgetBytes);
  const composed = buildProviderContent(history, pending, logger);
  return history === curated
    ? composed
    : invalidateParentsFromFirstRetirement(
        buildProviderContent(curated, pending, logger),
        composed,
      );
}

/** Encoded bytes of every media block the request resolver would count. */
function totalCountedBytes(contents: readonly IContent[]): number {
  return contents.reduce(
    (total, content) =>
      content.blocks.reduce(
        (sum, block) => sum + (countedBytes(block) ?? 0),
        total,
      ),
    0,
  );
}

/**
 * Compression only helps with byte pressure when something other than the
 * request being sent can shrink: any body overflow, or a media overflow while
 * earlier media remains after retirement and the pending media alone fits the
 * budget the request was rejected under. Pending media is never rewritten, so
 * when it alone exceeds that budget no history change can fix the request.
 */
export function compressionCanRelieve(
  error: unknown,
  contents: readonly IContent[],
  pendingCount: number,
): boolean {
  if (!(error instanceof RequestMediaByteOverflowError)) {
    return true;
  }
  const splitAt = Math.max(0, contents.length - pendingCount);
  if (
    error.budgetBytes > 0 &&
    totalCountedBytes(contents.slice(splitAt)) > error.budgetBytes
  ) {
    return false;
  }
  return hasCountedMedia(contents.slice(0, splitAt));
}

/**
 * Names a pending-only media overflow, judged against the budget the request
 * was rejected under; any other error passes through.
 */
export function explainPendingOverflow(
  error: unknown,
  pending: readonly IContent[],
): unknown {
  if (!(error instanceof RequestMediaByteOverflowError)) {
    return error;
  }
  const pendingBytes = totalCountedBytes(pending);
  return error.budgetBytes > 0 && pendingBytes > error.budgetBytes
    ? new PendingMediaBudgetError(error, pendingBytes)
    : error;
}
