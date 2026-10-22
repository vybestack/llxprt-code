/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  rowFormatKey,
  type RowFormatRegistration,
} from '../../journal/rowFormat.js';
import type { VersionEdit } from '../../journal/groupEdits.js';
import type { Version } from '../../journal/version.js';
import type { JournalStore } from '../../journal/journalStore.js';
import type { LocalMediaStore } from '../../storage/local-media-store.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import type { PinnedMediaLease } from '../../storage/history-media-release-gate.js';

export type PrepareNativeRequestFormat = (
  snapshot: VersionSnapshot,
  registration: RowFormatRegistration,
) => Promise<VersionSnapshot>;

export interface NativeProviderFormat {
  readonly mediaLease?: PinnedMediaLease;
  readonly indexed: IndexedJournalRequestSnapshot;
  withFormat<T>(
    registration: RowFormatRegistration,
    consume: (snapshot: VersionSnapshot) => T | Promise<T>,
  ): Promise<T>;
}

export function hasNativeRequestFormat(
  snapshot: VersionSnapshot,
  registration: RowFormatRegistration,
): boolean {
  const version = snapshot.version;
  if (version === undefined) return false;
  const key = rowFormatKey(registration.settings);
  const slot = version.slots.formatSlots.findIndex(
    (format) => format.formatKeyHash === key,
  );
  if (slot < 0) return false;
  return (
    version.rows === 0 ||
    (version.aggregate.stamp[slot].gen ===
      version.slots.formatSlots[slot].gen &&
      version.aggregate.missingBase[slot] === 0)
  );
}

export function nativeRequestFormatPreparation(host: {
  exclusive<T>(run: () => Promise<T>): Promise<T>;
  current(): Version | undefined;
  commit(edits: () => Promise<VersionEdit[]>): Promise<unknown>;
  snapshot(): Promise<VersionSnapshot>;
}): PrepareNativeRequestFormat {
  return (snapshot, registration) =>
    host.exclusive(async () => {
      if (snapshot.version?.commitSeq !== host.current()?.commitSeq)
        throw new Error(
          'History changed before the native request format fill',
        );
      const mappingSlot = registration.mistralSlot;
      if (
        mappingSlot !== undefined &&
        !(await snapshot.hasMistralSlot(mappingSlot))
      )
        await host.commit(() =>
          Promise.resolve([{ kind: 'mistral', slot: mappingSlot }]),
        );
      await host.commit(() =>
        Promise.resolve([{ kind: 'format', registration }]),
      );
      return host.snapshot();
    });
}

export function nativeRequestResources(store: JournalStore): {
  readonly prepareRequestFormat: PrepareNativeRequestFormat;
  readonly mediaStore: LocalMediaStore | undefined;
} {
  return {
    prepareRequestFormat: (snapshot, registration) =>
      store.prepareSnapshotFormat(snapshot, registration),
    mediaStore: store.mediaPins.mediaStore,
  };
}
