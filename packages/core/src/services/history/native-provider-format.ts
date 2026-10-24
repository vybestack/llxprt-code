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

export function requestFormatSlot(
  snapshot: VersionSnapshot,
  settings: RowFormatRegistration['settings'],
): number {
  const key = rowFormatKey(settings);
  const slot =
    snapshot.version?.slots.formatSlots.findIndex(
      (format) => format.summaryKind !== null && format.formatKeyHash === key,
    ) ?? -1;
  if (slot < 0) throw new Error('Request format is not registered in this pin');
  return slot;
}

export type PrepareNativeRequestFormat = (
  snapshot: VersionSnapshot,
  registration: RowFormatRegistration,
) => Promise<VersionSnapshot>;

export type PrepareNativeRequestKimi = (
  snapshot: VersionSnapshot,
) => Promise<VersionSnapshot>;

export interface NativeProviderFormat {
  readonly mediaLease?: PinnedMediaLease;
  readonly indexed: IndexedJournalRequestSnapshot;
  withFormat<T>(
    registration: RowFormatRegistration,
    consume: (snapshot: VersionSnapshot) => T | Promise<T>,
  ): Promise<T>;
  /** Runs `consume` on a pin whose Kimi id facts are filled, filling them first if they are not. */
  withKimi<T>(
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

interface NativeRequestHost {
  exclusive<T>(run: () => Promise<T>): Promise<T>;
  current(): Version | undefined;
  commit(edits: () => Promise<VersionEdit[]>): Promise<unknown>;
  snapshot(): Promise<VersionSnapshot>;
  readonly preparePinnedFormat: PrepareNativeRequestFormat;
  readonly preparePinnedKimi: PrepareNativeRequestKimi;
}

function nativeRequestFormatPreparation(
  host: NativeRequestHost,
): PrepareNativeRequestFormat {
  return (snapshot, registration) =>
    host.exclusive(async () => {
      if (snapshot.version !== host.current())
        return host.preparePinnedFormat(snapshot, registration);
      const nativeFacts = registration.nativeFacts;
      if (nativeFacts !== undefined)
        await host.commit(() =>
          Promise.resolve([{ kind: 'factIndex', registration: nativeFacts }]),
        );
      await host.commit(() =>
        Promise.resolve([{ kind: 'format', registration }]),
      );
      return host.snapshot();
    });
}

function nativeRequestKimiPreparation(
  host: NativeRequestHost,
): PrepareNativeRequestKimi {
  return (snapshot) =>
    host.exclusive(async () => {
      if (snapshot.version !== host.current())
        return host.preparePinnedKimi(snapshot);
      await host.commit(() => Promise.resolve([{ kind: 'kimi' }]));
      return host.snapshot();
    });
}

export function nativeRequestPreparations(host: NativeRequestHost): {
  readonly format: PrepareNativeRequestFormat;
  readonly kimi: PrepareNativeRequestKimi;
} {
  return {
    format: nativeRequestFormatPreparation(host),
    kimi: nativeRequestKimiPreparation(host),
  };
}

export function nativeRequestResources(store: JournalStore): {
  readonly prepareRequestFormat: PrepareNativeRequestFormat;
  readonly prepareRequestKimi: PrepareNativeRequestKimi;
  readonly mediaStore: LocalMediaStore | undefined;
} {
  return {
    prepareRequestFormat: (snapshot, registration) =>
      store.prepareSnapshotFormat(snapshot, registration),
    prepareRequestKimi: (snapshot) => store.prepareSnapshotKimi(snapshot),
    mediaStore: store.mediaPins.mediaStore,
  };
}
