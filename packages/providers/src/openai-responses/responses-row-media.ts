/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  assertRequestMediaBudget,
  DEFAULT_REQUEST_MEDIA_BUDGET_BYTES,
  type ResolvedMediaRequest,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { resolveRequestMedia } from '../utils/request-media-resolution.js';

/** The captured media input of one request: id, aggregate budget and resolver. */
export type RowsMediaInput = Parameters<typeof resolveRequestMedia>[0];

function hasReference(row: IContent): boolean {
  return row.blocks.some(
    (block) => block.type === 'media' && block.encoding === 'reference',
  );
}

/** Normalized base64 characters the row contributes to the request budget. */
function rowMediaBytes(row: IContent): number {
  let total = 0;
  for (const block of row.blocks) {
    if (block.type !== 'media' || block.encoding === 'url') continue;
    total +=
      block.encoding === 'reference'
        ? block.normalizedBase64Length
        : block.data.length;
  }
  return total;
}

/**
 * Resolves stored media references one row at a time while the source rows
 * stream by, so no history-sized array ever exists. The aggregate request
 * budget is enforced across rows by shrinking the budget handed to each row's
 * resolution. Every resolved row's lease is registered on `owner` and is held
 * until the call that owns `owner` finishes; resolution failures release their
 * own partial reservations before they propagate.
 */
export async function* resolveRowsMedia(
  rows: AsyncIterable<IContent>,
  media: RowsMediaInput,
  owner: ResolvedMediaRequest,
  signal: AbortSignal | undefined,
): AsyncGenerator<IContent, void> {
  const budget =
    media.aggregateBudgetBytes ?? DEFAULT_REQUEST_MEDIA_BUDGET_BYTES;
  let used = 0;
  for await (const row of rows) {
    const bytes = rowMediaBytes(row);
    const remaining = budget - used;
    used += bytes;
    yield bytes === 0
      ? row
      : await resolveRow(row, media, remaining, owner, signal);
  }
}

async function resolveRow(
  row: IContent,
  media: RowsMediaInput,
  remaining: number,
  owner: ResolvedMediaRequest,
  signal: AbortSignal | undefined,
): Promise<IContent> {
  if (!hasReference(row)) {
    assertRequestMediaBudget(
      [row],
      row.metadata?.turnId ?? row.metadata?.id ?? 'unknown-turn',
      remaining,
    );
    return row;
  }
  const resolved = await resolveRequestMedia(
    { ...media, aggregateBudgetBytes: remaining },
    [row],
    signal,
  );
  owner.registerCleanup(() => resolved.release());
  return resolved.withContents((contents) => contents[0]);
}
