/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  exportJournalSessionMediaPackage,
  type JournalPackageExportOptions,
} from './session-media-package-export-journal.js';

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  type MediaReferenceBlock,
  type MediaStoredObject,
} from '../services/history/IContent.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import { collectMediaReferences } from '../storage/media-reference-lifecycle.js';
import { stageRecordedMedia } from '../storage/recorded-media-transfer.js';

import { retiredJournalMessage } from '../journal/journalRefusal.js';
import { verifyPackageBlobs } from './session-media-package-blobs.js';
import {
  assertImportReservationsReleased,
  publishImportedSession,
  releaseImportReservations,
  rollbackImport,
  type ImportPublication,
  type ImportReservation,
  type PublishedImportedSession,
} from './session-media-package-import.js';
import {
  validateJournalRecording,
  writeImportedJournal,
} from './session-media-package-journal.js';
import {
  createReferenceVerifier,
  importedStateFileName,
  pinPersistedStates,
  writeRewrittenPersistedState,
  type PinnedPersistedState,
} from './session-media-package-state.js';
import {
  MANIFEST_FILE,
  MAX_MANIFEST_BYTES,
  MAX_OBJECT_AGGREGATE_BYTES,
  MAX_OBJECT_BYTES,
  RECORDING_FILE,
  boundedAggregate,
  parseManifest,
  readBoundedFile,
  requiredObjects,
  uniqueReferences,
  verifyManifestObjectSet,
  type MediaPackageManifest,
  type PinnedPackageFile,
  type VerifiedPackageBlob,
} from './session-media-package-validation.js';
import { SESSION_FILE_EXTENSION } from './sessionFileExtension.js';

export interface ImportedSessionMediaPackage {
  readonly recordingPath: string;
  readonly sessionId: string;
  readonly contentIds: readonly string[];
}

export async function exportSessionMediaPackage(
  recordingPath: string,
  projectHash: string,
  mediaStore: LocalMediaStore,
  packageDirectory: string,
  options: JournalPackageExportOptions = {},
): Promise<void> {
  await exportJournalSessionMediaPackage(
    recordingPath,
    projectHash,
    mediaStore,
    packageDirectory,
    options,
  );
  return;
}

export interface ValidatedSessionMediaPackage {
  readonly packageDirectory: string;
  readonly manifest: MediaPackageManifest;
  readonly references: readonly MediaReferenceBlock[];
  readonly objects: readonly MediaStoredObject[];
  readonly blobs: readonly VerifiedPackageBlob[];
  /** The recording as pinned at validation; import streams from this path. */
  readonly recording: PinnedPackageFile;
  readonly persistedStates: readonly PinnedPersistedState[];
}

async function readPackageManifest(
  packageDirectory: string,
): Promise<MediaPackageManifest> {
  return parseManifest(
    (
      await readBoundedFile(
        join(packageDirectory, MANIFEST_FILE),
        MAX_MANIFEST_BYTES,
        'Session media package manifest',
      )
    ).toString('utf8'),
  );
}

export async function validateSessionMediaPackage(
  packageDirectory: string,
): Promise<ValidatedSessionMediaPackage> {
  return validatePackageContents(
    packageDirectory,
    await readPackageManifest(packageDirectory),
  );
}

async function validatePackageContents(
  packageDirectory: string,
  manifest: MediaPackageManifest,
): Promise<ValidatedSessionMediaPackage> {
  assertPackageBackend(manifest, packageDirectory);
  const references = uniqueReferences(manifest.references);
  const objects = requiredObjects(references);
  verifyManifestObjectSet(objects, manifest.objects);
  boundedAggregate(
    objects.map((object) => {
      if (object.byteLength > MAX_OBJECT_BYTES) {
        throw new Error('Session media package object exceeds byte limit');
      }
      return object.byteLength;
    }),
    MAX_OBJECT_AGGREGATE_BYTES,
    'Session media package objects',
  );
  const verifyRecording = createReferenceVerifier('recording', references);
  const recording = await validateJournalRecording(
    join(packageDirectory, manifest.recording),
    (contents) => verifyRecording(collectMediaReferences(contents)),
  );
  const persistedStates = await pinPersistedStates(
    packageDirectory,
    manifest.persistedStates,
    createReferenceVerifier('persisted history', references),
  );
  const blobs = await verifyPackageBlobs(packageDirectory, objects);
  return {
    packageDirectory,
    manifest,
    references,
    objects,
    blobs,
    recording,
    persistedStates,
  };
}

function importPublication(
  validated: ValidatedSessionMediaPackage,
  destinationChatsDirectory: string,
  recordingPath: string,
  projectHash: string,
  sessionId: string,
): ImportPublication {
  return {
    destinationChatsDirectory,
    recordingPath,
    writeRecording: (outputPath) =>
      writeImportedJournal(
        validated.recording,
        outputPath,
        projectHash,
        sessionId,
      ),
    persistedStates: validated.persistedStates.map((state, index) => ({
      fileName: importedStateFileName(sessionId, index),
      write: (outputPath: string) =>
        writeRewrittenPersistedState(state, outputPath, projectHash, sessionId),
    })),
  };
}

type StagedObjectFiles = Awaited<
  ReturnType<LocalMediaStore['stageObjectFiles']>
>;

async function stageDurableMedia(
  mediaStore: LocalMediaStore,
  references: ValidatedSessionMediaPackage['references'],
  stagedMedia: StagedObjectFiles,
): ReturnType<typeof stageRecordedMedia> {
  try {
    return await stageRecordedMedia(mediaStore, references);
  } catch (error) {
    await stagedMedia.rollback();
    throw error;
  }
}

async function reserveImportReferences(
  mediaStore: LocalMediaStore,
  references: ValidatedSessionMediaPackage['references'],
  importedSessionId: string,
  reservations: ImportReservation[],
): Promise<void> {
  for (const [index, reference] of references.entries()) {
    const ownerId = `session-package-import:${importedSessionId}:${index}`;
    await mediaStore.reserve(reference, ownerId);
    reservations.push({ contentId: reference.contentId, ownerId });
  }
}

interface ImportRollbackState {
  readonly durableMedia: Awaited<ReturnType<typeof stageRecordedMedia>>;
  readonly published: PublishedImportedSession | undefined;
  readonly stagedMedia: StagedObjectFiles;
  readonly mediaStore: LocalMediaStore;
  readonly reservations: ImportReservation[];
}

async function rollbackWithDurableMedia(
  error: unknown,
  state: ImportRollbackState,
): Promise<never> {
  const { durableMedia, published, stagedMedia, mediaStore, reservations } =
    state;
  try {
    await durableMedia.rollback();
  } catch (cleanupError) {
    return rollbackImport(
      new AggregateError(
        [error, cleanupError],
        'Imported media cleanup failed',
      ),
      published,
      stagedMedia,
      mediaStore,
      reservations,
    );
  }
  return rollbackImport(
    error,
    published,
    stagedMedia,
    mediaStore,
    reservations,
  );
}

function assertPackageBackend(
  manifest: MediaPackageManifest,
  directory: string,
): void {
  if (manifest.recording === RECORDING_FILE) {
    throw new Error(retiredJournalMessage(join(directory, manifest.recording)));
  }
}

async function selectedPackage(
  packageSource: string | ValidatedSessionMediaPackage,
): Promise<ValidatedSessionMediaPackage> {
  const manifest =
    typeof packageSource === 'string'
      ? await readPackageManifest(packageSource)
      : packageSource.manifest;
  assertPackageBackend(
    manifest,
    typeof packageSource === 'string'
      ? packageSource
      : packageSource.packageDirectory,
  );
  return typeof packageSource === 'string'
    ? validatePackageContents(packageSource, manifest)
    : packageSource;
}

export function importSessionMediaPackage(
  packageSource: string | ValidatedSessionMediaPackage,
  destinationChatsDirectory: string,
  projectHash: string,
  mediaStore: LocalMediaStore,
): Promise<ImportedSessionMediaPackage>;
export function importSessionMediaPackage<T>(
  packageSource: string | ValidatedSessionMediaPackage,
  destinationChatsDirectory: string,
  projectHash: string,
  mediaStore: LocalMediaStore,
  activate: (imported: ImportedSessionMediaPackage) => Promise<T>,
): Promise<T>;
export async function importSessionMediaPackage<T>(
  packageSource: string | ValidatedSessionMediaPackage,
  destinationChatsDirectory: string,
  projectHash: string,
  mediaStore: LocalMediaStore,
  activate?: (imported: ImportedSessionMediaPackage) => Promise<T>,
): Promise<T | ImportedSessionMediaPackage> {
  const validated = await selectedPackage(packageSource);
  await mediaStore.preflightObjects(validated.objects);
  const importedSessionId = randomUUID();
  const recordingPath = join(
    destinationChatsDirectory,
    `session-imported-${importedSessionId}${SESSION_FILE_EXTENSION}`,
  );
  const imported: ImportedSessionMediaPackage = {
    recordingPath,
    sessionId: importedSessionId,
    contentIds: validated.objects.map((object) => object.contentId),
  };
  const stagedMedia = await mediaStore.stageObjectFiles(validated.blobs);
  const durableMedia = await stageDurableMedia(
    mediaStore,
    validated.references,
    stagedMedia,
  );
  const reservations: ImportReservation[] = [];
  let published: PublishedImportedSession | undefined;
  const rollbackAll = (error: unknown): Promise<never> =>
    rollbackWithDurableMedia(error, {
      durableMedia,
      published,
      stagedMedia,
      mediaStore,
      reservations,
    });
  try {
    await reserveImportReferences(
      mediaStore,
      validated.references,
      importedSessionId,
      reservations,
    );
    published = await publishImportedSession(
      importPublication(
        validated,
        destinationChatsDirectory,
        recordingPath,
        projectHash,
        importedSessionId,
      ),
    );
    const releaseFailures = await releaseImportReservations(
      mediaStore,
      reservations,
    );
    assertImportReservationsReleased(releaseFailures);
  } catch (error) {
    return rollbackAll(error);
  }
  let result: T | ImportedSessionMediaPackage;
  try {
    result = activate === undefined ? imported : await activate(imported);
  } catch (error) {
    return rollbackAll(error);
  }
  stagedMedia.commit();
  durableMedia.commit();
  await durableMedia.finalize();
  return result;
}
