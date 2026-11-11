/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  TextBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { invalidateResponsesStatefulChainForRetainedRewrite } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { RequestMediaByteOverflowError } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { PendingMediaBudgetError } from './pendingMediaBudgetError.js';
import {
  countedBytes,
  retirementNote,
  IMAGE_RETIREMENT_TARGET_RATIO,
} from './historicalImageRetirement.js';
import {
  carriesProvenanceOf,
  declaredItem,
  isRewriteOf,
} from './pendingBoundary.js';

interface PendingFact {
  readonly label: bigint;
  readonly matches: readonly boolean[];
  readonly occurrences: ReadonlyMap<string, number>;
}

async function previousHeader(
  source: ProviderRequestSelection,
  label: bigint,
  signal?: AbortSignal,
): Promise<{ readonly label: bigint; readonly header: IContent } | undefined> {
  if (source.native !== undefined)
    return source.native.indexed.headerBefore(label, signal);
  const index = Number(label) - 1;
  return index < 0
    ? undefined
    : { label: BigInt(index), header: await source.readAt(index, signal) };
}

function earliestPendingFact(
  facts: readonly PendingFact[],
  itemIndex: number,
  identities: ReadonlyMap<string, number>,
  searchBefore: bigint | undefined,
  signal?: AbortSignal,
): bigint | undefined {
  const unplaced = new Map(identities);
  let earliest: bigint | undefined;
  for (
    let index = facts.length - 1;
    index >= 0 && (earliest === undefined || unplaced.size > 0);
    index--
  ) {
    signal?.throwIfAborted();
    const fact = facts[index];
    const before = searchBefore === undefined || fact.label < searchBefore;
    const relevant =
      earliest === undefined ||
      [...fact.occurrences.keys()].some((id) => unplaced.has(id));
    if (!before || !fact.matches[itemIndex] || !relevant) continue;
    earliest = fact.label;
    for (const [identity, count] of fact.occurrences) {
      const remaining = unplaced.get(identity);
      if (remaining === undefined) continue;
      if (count >= remaining) unplaced.delete(identity);
      else unplaced.set(identity, remaining - count);
    }
  }
  return earliest;
}

async function protectedBoundary(
  source: ProviderRequestSelection,
  pending: readonly IContent[],
  facts: readonly PendingFact[],
  newest: bigint,
  signal?: AbortSignal,
): Promise<bigint> {
  let protectedLabel = newest;
  let searchBefore: bigint | undefined;
  const items = pending.map(declaredItem);
  for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex--) {
    const item = items[itemIndex];
    let earliest = earliestPendingFact(
      facts,
      itemIndex,
      item.identities,
      searchBefore,
      signal,
    );
    if (earliest === undefined) continue;
    for (;;) {
      const previous = await previousHeader(source, earliest, signal);
      if (
        previous === undefined ||
        !carriesProvenanceOf(previous.header, item.content)
      )
        break;
      earliest = previous.label;
    }
    if (earliest < protectedLabel) protectedLabel = earliest;
    searchBefore = earliest;
  }
  return protectedLabel;
}

interface ImageFact {
  readonly label: bigint;
  readonly index: number;
  readonly bytes: number;
  readonly note: TextBlock;
}
interface MediaRowFact {
  readonly label: bigint;
  readonly bytes: number;
  readonly images: readonly ImageFact[];
}
type Replacements = Map<bigint, Map<number, TextBlock>>;
type MediaSlots = ReadonlyArray<{
  readonly index: number;
  readonly block: IContent['blocks'][number];
}>;

function inspectMedia(label: bigint, media: MediaSlots): MediaRowFact {
  const images: ImageFact[] = [];
  let bytes = 0;
  for (const { index, block } of media) {
    const size = countedBytes(block);
    if (size === undefined || block.type !== 'media') continue;
    bytes += size;
    if (block.mimeType.toLowerCase().startsWith('image/'))
      images.push({
        label,
        index,
        bytes: size,
        note: {
          type: 'text',
          text: retirementNote({
            contentIndex: 0,
            blockIndex: index,
            bytes: size,
            block,
          }),
        },
      });
  }
  return { label, bytes, images };
}

async function collectMediaFacts(
  source: ProviderRequestSelection,
  protectedContents: readonly IContent[],
  signal?: AbortSignal,
): Promise<{
  readonly rows: readonly MediaRowFact[];
  readonly protectedLabel: bigint;
}> {
  const native = source.native;
  const declared = protectedContents.map(declaredItem);
  const identities = new Map<string, string>();
  for (const item of declared)
    for (const identity of item.identities.keys())
      identities.set(identity, identity);
  const pendingFacts: PendingFact[] = [];
  const rows: MediaRowFact[] = [];
  const newest =
    native === undefined
      ? BigInt(source.count - 1)
      : (await native.indexed.unitEntryAt(source.count - 1)).entry.label;
  const inspect = (
    label: bigint,
    header: IContent,
    media: MediaSlots,
  ): void => {
    const content = { ...header, blocks: media.map(({ block }) => block) };
    const occurrences = new Map<string, number>();
    for (const { block } of media) {
      if (block.type !== 'media') continue;
      const identity =
        block.encoding === 'reference' ? block.contentId : block.data;
      const pendingIdentity = identities.get(identity);
      if (pendingIdentity !== undefined)
        occurrences.set(
          pendingIdentity,
          (occurrences.get(pendingIdentity) ?? 0) + 1,
        );
    }
    pendingFacts.push({
      label,
      matches: declared.map((item) => isRewriteOf(content, item)),
      occurrences,
    });
    rows.push(inspectMedia(label, media));
  };
  if (native !== undefined) {
    for await (const row of native.indexed.openMediaRows(signal))
      inspect(row.label, row.header, row.media);
  } else {
    let index = 0;
    for await (const row of source.openReader(signal)) {
      signal?.throwIfAborted();
      inspect(
        BigInt(index++),
        { ...row, blocks: [] },
        row.blocks.flatMap((block, index) =>
          block.type === 'media' ? [{ index, block }] : [],
        ),
      );
    }
  }
  return {
    rows,
    protectedLabel: await protectedBoundary(
      source,
      protectedContents,
      pendingFacts,
      newest,
      signal,
    ),
  };
}

function retirementReplacements(
  rows: readonly MediaRowFact[],
  protectedLabel: bigint,
  budgetBytes: number,
  retireAll: boolean,
): Replacements {
  const replacements: Replacements = new Map();
  const candidates: ImageFact[] = [];
  let next = 0;
  let total = 0;
  const target = Math.floor(budgetBytes * IMAGE_RETIREMENT_TARGET_RATIO);
  const retire = (image: ImageFact): void => {
    let blocks = replacements.get(image.label);
    if (blocks === undefined) {
      blocks = new Map();
      replacements.set(image.label, blocks);
    }
    blocks.set(image.index, image.note);
    total -= image.bytes;
  };
  const reduce = (before: bigint): void => {
    while (total > target && next < candidates.length) {
      const image = candidates[next];
      if (image.label >= before || image.label >= protectedLabel) return;
      next++;
      retire(image);
    }
  };
  for (const row of rows) {
    total += row.bytes;
    candidates.push(...row.images);
    if (retireAll) {
      while (
        next < candidates.length &&
        candidates[next].label < protectedLabel
      )
        retire(candidates[next++]);
    } else if (total > budgetBytes) reduce(row.label);
  }
  if (!retireAll && total > budgetBytes) reduce(protectedLabel);
  return replacements;
}

async function projectRetirement(
  source: ProviderRequestSelection,
  replacements: Replacements,
): Promise<ProviderRequestSelection> {
  const first = replacements.keys().next().value;
  if (first === undefined) return source;
  const header = (row: IContent, label: bigint): IContent =>
    label < first
      ? row
      : invalidateResponsesStatefulChainForRetainedRewrite([row], 0)[0];
  if (source.native !== undefined) {
    const projected = await source.native.project({
      blockReplacements: replacements,
      header,
    });
    return {
      count: projected.count,
      native: projected.native,
      index: projected.index,
      readAt: (index, signal) => projected.readAt(index, signal),
      openReader: (signal) => projected.openReader(signal),
      async close() {
        try {
          await projected.close();
        } finally {
          await source.close();
        }
      },
    };
  }
  const rewrite = (row: IContent, index: number): IContent => {
    const blocks = replacements.get(BigInt(index));
    return header(
      blocks === undefined
        ? row
        : {
            ...row,
            blocks: row.blocks.map(
              (block, index) => blocks.get(index) ?? block,
            ),
          },
      BigInt(index),
    );
  };
  return {
    callerOwned: true,
    count: source.count,
    async *openReader(signal) {
      let index = 0;
      for await (const row of source.openReader(signal))
        yield rewrite(row, index++);
    },
    readAt: async (index, signal) =>
      rewrite(await source.readAt(index, signal), index),
    close: () => source.close(),
  };
}

/** Keeps only image positions, sizes and notes. Pixel payloads never enter the overlay. */
export async function retireSourceImages(
  source: ProviderRequestSelection,
  protectedContents: readonly IContent[],
  budgetBytes: number,
  retireAll = false,
  signal?: AbortSignal,
): Promise<ProviderRequestSelection> {
  if (
    !Number.isSafeInteger(budgetBytes) ||
    budgetBytes <= 0 ||
    source.count === 0
  )
    return source;
  const { rows, protectedLabel } = await collectMediaFacts(
    source,
    protectedContents,
    signal,
  );
  return projectRetirement(
    source,
    retirementReplacements(rows, protectedLabel, budgetBytes, retireAll),
  );
}

/** Uses the same protected boundary as retirement, against the rejecting budget. */
export async function assertSourcePendingMediaBudget(
  source: ProviderRequestSelection,
  protectedContents: readonly IContent[],
  error: unknown,
  signal?: AbortSignal,
): Promise<void> {
  if (
    !(error instanceof RequestMediaByteOverflowError) ||
    error.budgetBytes <= 0 ||
    source.count === 0
  )
    return;
  const { rows, protectedLabel } = await collectMediaFacts(
    source,
    protectedContents,
    signal,
  );
  const pendingBytes = rows.reduce(
    (sum, row) => sum + (row.label >= protectedLabel ? row.bytes : 0),
    0,
  );
  if (pendingBytes > error.budgetBytes)
    throw new PendingMediaBudgetError(error, pendingBytes);
}
