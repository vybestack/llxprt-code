/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { PrepareNativeRequestFormat } from './native-provider-format.js';
import type {
  HistoryPrepareCuratedRequest,
  HistoryStorePort,
} from './historyStorePort.js';
import { oldProviderRequest } from './old-provider-request.js';

export function prepareJournalProviderRequest(
  store: Pick<HistoryStorePort, 'streamRows' | 'waitForCommit'> & {
    settledSnapshot(settle: () => Promise<void>): Promise<VersionSnapshot>;
    prepareRequestFormat: PrepareNativeRequestFormat;
  },
  hasPinnedMediaOwner: () => boolean,
): (request: HistoryPrepareCuratedRequest) => Promise<ProviderRequestSnapshot> {
  return async (request) => {
    await store.waitForCommit();
    const override = request.historyOverride;
    if (override !== undefined) {
      return isNativeProviderHistory(override)
        ? override.prepareProviderSnapshot(request.tail, request.options)
        : oldProviderRequest(store, request);
    }
    return JournalProviderRequestSnapshot.create(
      await store.settledSnapshot(() => Promise.resolve()),
      request.tail,
      request.options,
      undefined,
      undefined,
      (snapshot, registration) =>
        store.prepareRequestFormat(snapshot, registration),
      hasPinnedMediaOwner(),
    );
  };
}
import type { NativeSemanticPurgeCandidate } from './semantic-purge-native.js';
import type { IContent } from './IContent.js';
import type { ProviderCuratedStreamOptions } from './provider-curated-stream.js';
import type { ProviderRequestSnapshot } from './provider-request-snapshot.js';
import { JournalProviderRequestSnapshot } from './journal-provider-request.js';
import type {
  SemanticMediaPurgeBoundary,
  SemanticMediaPurgeBoundaryIdentity,
} from './semantic-media-purge.js';
import type { JournalRequestProjection } from './journal-request-projection.js';
import { historyMutationFailure } from './historyMutationEffects.js';

export type ProviderSnapshotOpener = (
  tail: readonly IContent[],
  options: ProviderCuratedStreamOptions,
) => Promise<ProviderRequestSnapshot>;
export interface NativeProviderHistory extends AsyncIterable<IContent> {
  readonly prepareProviderSnapshot: ProviderSnapshotOpener;
}
export function isNativeProviderHistory(
  value: Iterable<IContent> | AsyncIterable<IContent>,
): value is NativeProviderHistory {
  return (
    'prepareProviderSnapshot' in value &&
    typeof value.prepareProviderSnapshot === 'function'
  );
}

export function nativePurgeProviderRequest(
  candidate: NativeSemanticPurgeCandidate | undefined,
  explicit: boolean,
  boundary: SemanticMediaPurgeBoundary | undefined,
  boundaryId: SemanticMediaPurgeBoundaryIdentity | undefined,
): ProviderSnapshotOpener | undefined {
  const snapshot = candidate?.snapshot.requestSnapshot;
  if (candidate === undefined || snapshot === undefined) return undefined;
  return async (tail, options) => {
    options.signal?.throwIfAborted();
    const release = snapshot.hold();
    let projection: JournalRequestProjection;
    try {
      const changedLabel = (
        await snapshot.entryAt(candidate.location.contentIndex)
      ).label;
      const firstOrdinal =
        candidate.removed && candidate.location.contentIndex === 0 ? 1 : 0;
      const firstLabel =
        snapshot.rows === Number(candidate.removed)
          ? undefined
          : (await snapshot.entryAt(firstOrdinal)).label;
      const boundaryLabel =
        boundary === undefined
          ? undefined
          : (await snapshot.entryAt(boundary.contentIndex)).label;
      projection = {
        ...(explicit
          ? {}
          : {
              label: changedLabel,
              removedBlock: candidate.removesBlock
                ? candidate.location.blockIndex
                : undefined,
              removedRow: candidate.removed,
              readChangedRow: () =>
                candidate.readRow(candidate.location.contentIndex),
            }),
        header: (row, label) => {
          const metadata = { ...row.metadata };
          if (explicit) {
            if (
              label === boundaryLabel &&
              boundary !== undefined &&
              boundaryId !== undefined
            )
              metadata.semanticMediaPurgeBoundary = {
                blockIndex: boundary.blockIndex,
                boundaryId,
              };
          } else {
            if (label >= changedLabel && row.speaker === 'ai')
              delete metadata.responsesStored;
            if (label === firstLabel)
              metadata.semanticMediaPurgeFrontier = candidate.frontier;
          }
          return { ...row, metadata };
        },
      };
    } catch (error) {
      try {
        await release();
      } catch (cleanup) {
        throw historyMutationFailure(error, [cleanup]);
      }
      throw error;
    }
    return JournalProviderRequestSnapshot.create(
      snapshot,
      tail,
      options,
      projection,
      release,
    );
  };
}
