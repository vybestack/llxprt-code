/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  assertRowIndex,
  type ProviderRequestRows,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { callerOwnedRawProviderSource } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import { HistoryReaderScope } from '@vybestack/llxprt-code-core/services/history/historyReaderScope.js';
import { isSpeakerContent } from '@vybestack/llxprt-code-core/services/history/historyJournalGuards.js';
import type { BoundaryChangeClassification } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type { HookSnapshotRows } from '@vybestack/llxprt-code-core/hooks/hookOutputSnapshot.js';
import { parseHookLLMRequestBoundaryResult } from '@vybestack/llxprt-code-core/hooks/hookTranslator.js';
import { contentProjectionKey } from './boundary-projection-key.js';

export interface BoundarySnapshotOptions {
  readonly before: ProviderRequestRows;
  readonly after: HookSnapshotRows;
  readonly rawPending: ProviderRequestRows;
  readonly boundary?: unknown;
  readonly root?: string;
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
  close(): void | Promise<void>;
}

type Decision = Pick<
  BoundarySnapshotResult,
  'classification' | 'pendingSelection'
>;

async function replacementRows(
  rows: HookSnapshotRows,
  signal?: AbortSignal,
): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const row of rows.openReader(signal)) {
    signal?.throwIfAborted();
    if (!isSpeakerContent(row)) throw new Error('Invalid hook content row');
    result.push(row);
  }
  if (result.length !== rows.count)
    throw new Error('Boundary source count mismatch');
  return result;
}

function ownedRows(
  rows: ProviderRequestRows,
  scope: HistoryReaderScope,
  signal?: AbortSignal,
  start = 0,
): ProviderRequestRows {
  return {
    callerOwned: true,
    count: rows.count - start,
    openReader: (readSignal) =>
      scope.open(
        (async function* () {
          for (let index = start; index < rows.count; index++) {
            scope.requireOpen();
            signal?.throwIfAborted();
            readSignal?.throwIfAborted();
            yield await rows.readAt(index, readSignal);
          }
        })(),
      ),
    readAt(index, readSignal) {
      scope.requireOpen();
      signal?.throwIfAborted();
      readSignal?.throwIfAborted();
      assertRowIndex(index, rows.count - start);
      return rows.readAt(start + index, readSignal);
    },
  };
}

function metadataDecision(
  after: readonly IContent[],
  selection: (start: number) => ProviderRequestRows,
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
    boundary.pendingMessageCount ?? Math.max(0, after.length - start);
  if (start + count === after.length)
    return {
      classification: 'hook-metadata',
      pendingSelection: selection(start),
    };
  if (boundary.onInvalidBoundary === 'throw')
    throw new Error(
      `BeforeModel hook supplied an invalid llm_request_boundary (pendingMessageStartIndex=${start}, pendingMessageCount=${boundary.pendingMessageCount ?? 'omitted'}, contentsLength=${after.length}); the pending region must be a suffix of the modified contents.`,
    );
  return { classification: 'invalid-boundary', pendingSelection: undefined };
}

async function compareBefore(
  options: BoundarySnapshotOptions,
  after: readonly IContent[],
  pending: readonly IContent[],
): Promise<{
  unchanged: boolean;
  rawMatches: boolean;
  prefix: boolean;
  prepended: boolean;
  atPrefix: boolean;
  atEnd: boolean;
  straddles: boolean;
  overlap: boolean;
}> {
  const keys = after.map(contentProjectionKey);
  const members = new Set(keys);
  const raw = pending.map(contentProjectionKey);
  const pendingKeys = new Set(raw);
  const H = options.before.count - pending.length;
  const flags = {
    unchanged: options.before.count === after.length,
    rawMatches: H >= 0,
    prefix: after.length >= H,
    prepended: H > 0 && after.length > options.before.count,
    atPrefix: pending.length > 0 && after.length >= H + pending.length,
    atEnd: pending.length > 0 && after.length >= pending.length,
    straddles: false,
    overlap: false,
  };
  let index = 0;
  for await (const row of options.before.openReader(options.signal)) {
    options.signal?.throwIfAborted();
    const key = contentProjectionKey(row);
    flags.unchanged &&= key === keys[index];
    flags.prepended &&=
      key === keys[after.length - options.before.count + index];
    flags.overlap ||= members.has(key);
    if (index < H) {
      flags.prefix &&= key === keys[index];
      flags.straddles ||= pendingKeys.has(key);
    } else {
      flags.rawMatches &&= key === raw[index - H];
      flags.atPrefix &&= key === keys[index];
      flags.atEnd &&= key === keys[after.length - options.before.count + index];
    }
    index++;
  }
  if (index !== options.before.count)
    throw new Error('Boundary source count mismatch');
  return flags;
}

function differentialDecision(
  beforeCount: number,
  afterCount: number,
  pendingCount: number,
  flags: Awaited<ReturnType<typeof compareBefore>>,
  selection: (start: number) => ProviderRequestRows,
): Decision {
  const none = (
    classification: BoundarySnapshotResult['classification'],
  ): Decision => ({ classification, pendingSelection: undefined });
  if (!flags.rawMatches) return none('provider-pending-mismatch');
  if (flags.straddles) return none('complex');
  if (flags.prefix) {
    let classification: BoundaryChangeClassification = 'replaced-pending';
    if (afterCount === beforeCount)
      classification =
        pendingCount === 0 || flags.atPrefix ? 'unchanged' : 'modified-pending';
    else if (afterCount > beforeCount) {
      if (flags.atPrefix) classification = 'appended';
      else if (flags.atEnd) classification = 'inserted-at-boundary';
    }
    return {
      classification,
      pendingSelection: selection(beforeCount - pendingCount),
    };
  }
  if (flags.prepended) return none('prepended');
  if (pendingCount > 0 && afterCount >= pendingCount && flags.atEnd)
    return none('modified-history');
  return none(flags.overlap ? 'complex' : 'replaced-all');
}

export async function resolvePendingBoundarySnapshot(
  options: BoundarySnapshotOptions,
): Promise<BoundarySnapshotResult> {
  options.signal?.throwIfAborted();
  const after = await replacementRows(options.after, options.signal);
  const pending = await replacementRows(options.rawPending, options.signal);
  const source = await callerOwnedRawProviderSource(after).openProviderRequest(
    options.signal,
  );
  const raw = await callerOwnedRawProviderSource(pending).openProviderRequest(
    options.signal,
  );
  const scope = new HistoryReaderScope('Boundary snapshot closed');
  const selection = (start = 0): ProviderRequestRows =>
    ownedRows(source, scope, options.signal, start);
  const flags = await compareBefore(options, after, pending);
  const decision = flags.unchanged
    ? ({
        classification: 'unchanged',
        pendingSelection: ownedRows(raw, scope, options.signal),
      } satisfies Decision)
    : (metadataDecision(after, selection, options.boundary) ??
      differentialDecision(
        options.before.count,
        after.length,
        pending.length,
        flags,
        selection,
      ));
  return {
    ...decision,
    contents: selection(),
    close: () => scope.close(),
  };
}
