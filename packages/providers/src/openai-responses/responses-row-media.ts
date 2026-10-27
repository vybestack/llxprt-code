/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  isMediaReferenceBlock,
  type IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { NativeProviderFormat } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import {
  assertRequestMediaBudget,
  DEFAULT_REQUEST_MEDIA_BUDGET_BYTES,
  RequestMediaResolutionError,
  type RequestMediaReservations,
  type ResolvedMediaRequest,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { resolveRequestMedia } from '../utils/request-media-resolution.js';

/** The captured media input of one request: id, aggregate budget and resolver. */
export type RowsMediaInput = Omit<
  Parameters<typeof resolveRequestMedia>[0],
  'reservations'
>;

function hasReference(row: IContent): boolean {
  return row.blocks.some(
    (block) => block.type === 'media' && block.encoding === 'reference',
  );
}
export class ResponsesMediaBudget {
  private used = 0;

  constructor(private readonly budget = DEFAULT_REQUEST_MEDIA_BUDGET_BYTES) {}

  include(row: IContent): void {
    const turnId = row.metadata?.turnId ?? row.metadata?.id ?? 'unknown-turn';
    for (const block of row.blocks) {
      const candidate: unknown = block;
      if (
        block.type === 'media' &&
        block.encoding === 'reference' &&
        !isMediaReferenceBlock(candidate)
      )
        throw new RequestMediaResolutionError(
          block.contentId,
          turnId,
          'metadata validation',
        );
    }
    assertRequestMediaBudget([row], turnId, this.budget - this.used);
    this.used += rowMediaBytes(row);
  }
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
 * resolution. The rows share one set of store reservations, so a content id
 * costs one store round trip however many rows reference it and all
 * reservations are released together. Each resolved row's lease is released
 * when its consumer advances. Shared reservations stay on `owner` until the
 * request finishes; resolution failures release their own partial resources
 * before they propagate.
 */
export async function* resolveRowsMedia(
  rows: AsyncIterable<IContent>,
  media: RowsMediaInput,
  owner: ResolvedMediaRequest,
  signal: AbortSignal | undefined,
  native?: NativeProviderFormat,
): AsyncGenerator<IContent, void> {
  const budget =
    media.aggregateBudgetBytes ?? DEFAULT_REQUEST_MEDIA_BUDGET_BYTES;
  let used = 0;
  let reservations: RequestMediaReservations | undefined;
  for await (const row of rows) {
    const lease = native?.mediaLease;
    const bytes = rowMediaBytes(row);
    const remaining = budget - used;
    used += bytes;
    if (
      lease === undefined &&
      reservations === undefined &&
      hasReference(row)
    ) {
      reservations = media.resolver?.openReservations(media.requestId);
      if (reservations !== undefined) {
        const opened = reservations;
        owner.registerCleanup(() => opened.release());
      }
    }
    if (bytes === 0) yield row;
    else
      yield* resolveRow(
        row,
        { ...media, reservations, lease },
        remaining,
        signal,
      );
  }
}

async function* resolveRow(
  row: IContent,
  media: Parameters<typeof resolveRequestMedia>[0],
  remaining: number,
  signal: AbortSignal | undefined,
): AsyncGenerator<IContent, void> {
  if (!hasReference(row)) {
    assertRequestMediaBudget(
      [row],
      row.metadata?.turnId ?? row.metadata?.id ?? 'unknown-turn',
      remaining,
    );
    yield row;
    return;
  }
  const resolved = await resolveRequestMedia(
    { ...media, aggregateBudgetBytes: remaining },
    [row],
    signal,
  );
  try {
    yield resolved.withContents((contents) => contents[0]);
  } finally {
    await resolved.release();
  }
}
