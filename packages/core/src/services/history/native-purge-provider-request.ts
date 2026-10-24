/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { decodeStoredRow } from './journalRowCodec.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { LocalMediaStore } from '../../storage/local-media-store.js';
import type {
  PrepareNativeRequestFormat,
  PrepareNativeRequestKimi,
} from './native-provider-format.js';
import type {
  HistoryPrepareCuratedRequest,
  HistoryStorePort,
} from './historyStorePort.js';
import { callerOwnedProviderRequest } from './caller-owned-provider-request.js';

export function prepareJournalProviderRequest(
  store: Pick<HistoryStorePort, 'streamRows' | 'waitForCommit'> & {
    prepareTokenUsageFacts(): Promise<void>;
    settledSnapshot(settle: () => Promise<void>): Promise<VersionSnapshot>;
    nativePreparation: {
      readonly format: PrepareNativeRequestFormat;
      readonly kimi: PrepareNativeRequestKimi;
    };
  },
  pinnedMediaStore: () => LocalMediaStore | undefined,
): (request: HistoryPrepareCuratedRequest) => Promise<ProviderRequestSnapshot> {
  return async (request) => {
    await store.waitForCommit();
    const override = request.historyOverride;
    if (Array.isArray(override))
      return callerOwnedProviderRequest(
        override,
        request.tail,
        request.options,
      );
    if (override !== undefined) {
      if (!isNativeProviderHistory(override))
        throw new Error(
          'Non-array history overrides require a provider snapshot opener',
        );
      return override.prepareProviderSnapshot(request.tail, request.options);
    }
    await store.prepareTokenUsageFacts();
    return JournalProviderRequestSnapshot.create(
      await store.settledSnapshot(() => Promise.resolve()),
      request.tail,
      request.options,
      undefined,
      undefined,
      (snapshot, registration) =>
        store.nativePreparation.format(snapshot, registration),
      pinnedMediaStore(),
      (snapshot) => store.nativePreparation.kimi(snapshot),
      { logger: request.logger, isCompressing: request.isCompressing },
    );
  };
}
import type { NativeSemanticPurgeCandidate } from './semantic-purge-native.js';
import type { IContent } from './IContent.js';
import type { ProviderCuratedStreamOptions } from './provider-request-options.js';
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

async function readProjectedRow(
  snapshot: VersionSnapshot,
  candidate: NativeSemanticPurgeCandidate,
): Promise<IContent> {
  const entry = await snapshot.entryAt(candidate.location.contentIndex);
  return candidate.projectRequestRow(
    decodeStoredRow(await snapshot.readRow(entry)),
  );
}

function holdPurgeRequest(
  snapshot: VersionSnapshot,
  candidate: NativeSemanticPurgeCandidate,
): () => Promise<void> {
  const releasePin = snapshot.hold();
  const releaseFormats = candidate.snapshot.holdRequestFormats?.();
  return async () => {
    try {
      await releaseFormats?.();
    } finally {
      await releasePin();
    }
  };
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
    const release = holdPurgeRequest(snapshot, candidate);
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
              readChangedRow: () => readProjectedRow(snapshot, candidate),
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
      candidate.snapshot.prepareRequestFormat,
      candidate.snapshot.mediaStore,
      candidate.snapshot.prepareRequestKimi,
    );
  };
}
