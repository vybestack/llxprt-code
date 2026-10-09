/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { BoundaryChangeClassification } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type { HookSnapshotRows } from '@vybestack/llxprt-code-core/hooks/hookOutputSnapshot.js';
import { parseHookLLMRequestBoundaryResult } from '@vybestack/llxprt-code-core/hooks/hookTranslator.js';
import { BoundarySnapshotDisk } from './boundary-snapshot-disk.js';

export interface BoundarySnapshotOptions {
  readonly before: ProviderRequestRows;
  readonly after: HookSnapshotRows;
  readonly rawPending: ProviderRequestRows;
  readonly boundary?: unknown;
  readonly root: string;
  readonly signal?: AbortSignal;
}

export interface BoundarySnapshotResult {
  readonly classification:
    | BoundaryChangeClassification
    | 'hook-metadata'
    | 'invalid-boundary'
    | 'provider-pending-mismatch';
  readonly contents: ProviderRequestRows;
  readonly pendingSelection: ProviderRequestRows | undefined;
  close(): void;
}

type Decision = Pick<
  BoundarySnapshotResult,
  'classification' | 'pendingSelection'
>;

function metadataDecision(
  disk: BoundarySnapshotDisk,
  value: unknown,
): Decision | undefined {
  const parsed = parseHookLLMRequestBoundaryResult(value);
  if (parsed.status === 'absent') return undefined;
  if (parsed.status === 'malformed') {
    if (parsed.onInvalidBoundary === 'throw')
      throw new Error(
        'BeforeModel hook supplied malformed llm_request_boundary metadata (structurally invalid); the boundary cannot be honored.',
      );
    return { classification: 'invalid-boundary', pendingSelection: undefined };
  }
  const boundary = parsed.boundary;
  const start = boundary.pendingMessageStartIndex;
  const count =
    boundary.pendingMessageCount ?? Math.max(0, disk.count('after') - start);
  if (start + count === disk.count('after'))
    return {
      classification: 'hook-metadata',
      pendingSelection: disk.selection('after', start),
    };
  if (boundary.onInvalidBoundary === 'throw')
    throw new Error(
      `BeforeModel hook supplied an invalid llm_request_boundary (pendingMessageStartIndex=${start}, pendingMessageCount=${boundary.pendingMessageCount ?? 'omitted'}, contentsLength=${disk.count('after')}); the pending region must be a suffix of the modified contents.`,
    );
  return { classification: 'invalid-boundary', pendingSelection: undefined };
}

function classifyPrefix(
  disk: BoundarySnapshotDisk,
  H: number,
  P: number,
): Decision {
  const beforeCount = disk.count('before');
  const afterCount = disk.count('after');
  const enough = P > 0 && afterCount >= H + P;
  const atPrefix = enough && disk.rangeMatches('before', H, 'after', H, P);
  const atEnd =
    enough && disk.rangeMatches('before', H, 'after', afterCount - P, P);
  let classification: BoundaryChangeClassification = 'replaced-pending';
  if (afterCount === beforeCount)
    classification = P === 0 || atPrefix ? 'unchanged' : 'modified-pending';
  else if (afterCount > beforeCount) {
    if (atPrefix) classification = 'appended';
    else if (atEnd) classification = 'inserted-at-boundary';
  }
  return { classification, pendingSelection: disk.selection('after', H) };
}

function differentialDecision(disk: BoundarySnapshotDisk): Decision {
  const beforeCount = disk.count('before');
  const afterCount = disk.count('after');
  const P = disk.count('raw');
  const H = beforeCount - P;
  if (H < 0 || !disk.rangeMatches('before', H, 'raw', 0, P))
    return {
      classification: 'provider-pending-mismatch',
      pendingSelection: undefined,
    };
  if (disk.straddles(H))
    return { classification: 'complex', pendingSelection: undefined };
  if (afterCount >= H && disk.rangeMatches('before', 0, 'after', 0, H))
    return classifyPrefix(disk, H, P);
  if (
    H > 0 &&
    afterCount > beforeCount &&
    disk.rangeMatches(
      'before',
      0,
      'after',
      afterCount - beforeCount,
      beforeCount,
    )
  )
    return { classification: 'prepended', pendingSelection: undefined };
  if (
    P > 0 &&
    afterCount >= P &&
    disk.rangeMatches('before', H, 'after', afterCount - P, P)
  )
    return { classification: 'modified-history', pendingSelection: undefined };
  for (let index = 0; index < beforeCount; index++)
    if (disk.contains('after', disk.key('before', index)))
      return { classification: 'complex', pendingSelection: undefined };
  return { classification: 'replaced-all', pendingSelection: undefined };
}

function resolve(disk: BoundarySnapshotDisk, boundary: unknown): Decision {
  if (
    disk.count('before') === disk.count('after') &&
    disk.rangeMatches('before', 0, 'after', 0, disk.count('before'))
  )
    return {
      classification: 'unchanged',
      pendingSelection: disk.selection('raw'),
    };
  return metadataDecision(disk, boundary) ?? differentialDecision(disk);
}

/** Inputs are borrowed; the returned selections own independent disk copies until close. */
export async function resolvePendingBoundarySnapshot(
  options: BoundarySnapshotOptions,
): Promise<BoundarySnapshotResult> {
  const disk = new BoundarySnapshotDisk(options.root, options.signal);
  try {
    await disk.capture('before', options.before);
    await disk.capture('raw', options.rawPending);
    await disk.capture('after', options.after);
    const decision = resolve(disk, options.boundary);
    return {
      ...decision,
      contents: disk.selection('after'),
      close: () => disk.close(),
    };
  } catch (error) {
    disk.close();
    throw error;
  }
}
