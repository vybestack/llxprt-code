/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type MediaReferenceBlock,
  type MediaStoredObject,
} from '../services/history/IContent.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import { MediaAdmissionService } from '../storage/media-admission-service.js';
import {
  collectMediaReferences,
  verifyHistoryMedia,
} from '../storage/media-reference-lifecycle.js';
import { replaySessionRows } from './ReplayEngine.js';
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
import { ReservationLedger } from './session-media-package-ledger.js';
import { streamPortableRecording } from './session-media-package-recording.js';
import {
  MediaReferenceIndex,
  createReferenceVerifier,
  exportPersistedStates,
  importedStateFileName,
  pinPersistedStates,
  writeRewrittenPersistedState,
  type PinnedPersistedState,
} from './session-media-package-state.js';
import {
  prepareSessionMediaPackageStaging,
  publishStagedSessionMediaPackage,
  stageSessionMediaPackageBlobs,
  writeSessionMediaPackageManifest,
} from './session-media-package-writer.js';

export interface ImportedSessionMediaPackage {
  readonly recordingPath: string;
  readonly sessionId: string;
  readonly contentIds: readonly string[];
}

/**
 * Replays the staged recording row by row. Each row is admitted, verified
 * against the media store, and released before the next row is resolved.
 */
async function verifyStagedReplay(
  stagedRecording: string,
  projectHash: string,
  mediaStore: LocalMediaStore,
  admission: MediaAdmissionService,
  index: MediaReferenceIndex,
): Promise<void> {
  const context = {
    turnId: 'session-package-replay',
    source: 'session-package-export',
    preserveLegacyMimeParameters: true,
  };
  const replay = await replaySessionRows(
    stagedRecording,
    projectHash,
    async (row) => {
      const [admitted] = await admission.admitContents([row], context);
      try {
        await verifyHistoryMedia([admitted], mediaStore, 'session-replay');
      } catch (error) {
        await admission.releaseContents([admitted], context);
        throw error;
      }
      await admission.releaseContents([admitted], context);
      index.add([admitted]);
    },
  );
  if (!replay.ok) {
    throw new Error(`Cannot export session media: ${replay.error}`);
  }
}

async function writeSessionMediaPackage(
  recordingPath: string,
  projectHash: string,
  mediaStore: LocalMediaStore,
  temporaryDirectory: string,
  admission: MediaAdmissionService,
  ledger: ReservationLedger,
): Promise<void> {
  const index = new MediaReferenceIndex();
  const onContents = (contents: Parameters<MediaReferenceIndex['add']>[0]) =>
    index.add(contents);
  await prepareSessionMediaPackageStaging(temporaryDirectory);
  const stagedRecording = join(temporaryDirectory, RECORDING_FILE);
  const recording = await streamPortableRecording({
    source: recordingPath,
    label: 'Session recording',
    outputPath: stagedRecording,
    exportAdmission: { service: admission, ledger },
    onContents,
  });
  const persistedStateFiles = await exportPersistedStates({
    recordingPath,
    stateDirectory: join(temporaryDirectory, 'state'),
    sessionId: recording.sessionId,
    projectHash,
    admission,
    ledger,
    onContents,
  });
  await verifyStagedReplay(
    stagedRecording,
    projectHash,
    mediaStore,
    admission,
    index,
  );
  const references = index.references();
  const objects = requiredObjects(references);
  await stageSessionMediaPackageBlobs(temporaryDirectory, mediaStore, objects);
  await writeSessionMediaPackageManifest({
    temporaryDirectory,
    persistedStateFiles,
    references,
    objects,
  });
}

async function cleanupFailedExport(
  temporaryDirectory: string,
  failures: readonly unknown[],
  message: string,
): Promise<never> {
  const collected = [...failures];
  try {
    await rm(temporaryDirectory, { recursive: true, force: true });
  } catch (cleanupError) {
    collected.push(cleanupError);
  }
  if (collected.length === 1) throw collected[0];
  throw new AggregateError(collected, message);
}

export async function exportSessionMediaPackage(
  recordingPath: string,
  projectHash: string,
  mediaStore: LocalMediaStore,
  packageDirectory: string,
): Promise<void> {
  const admission = new MediaAdmissionService(mediaStore);
  const temporaryDirectory = `${packageDirectory}.${randomUUID()}.tmp`;
  const ledger = new ReservationLedger(
    `${temporaryDirectory}.reservations`,
    admission,
  );
  try {
    await writeSessionMediaPackage(
      recordingPath,
      projectHash,
      mediaStore,
      temporaryDirectory,
      admission,
      ledger,
    );
  } catch (error) {
    try {
      await ledger.releaseAll();
    } catch (releaseError) {
      await cleanupFailedExport(
        temporaryDirectory,
        [error, releaseError],
        'Session package export, owner release, and cleanup failed',
      );
    }
    await cleanupFailedExport(
      temporaryDirectory,
      [error],
      'Session package export and cleanup failed',
    );
  }
  try {
    await ledger.releaseAll();
  } catch (releaseError) {
    await cleanupFailedExport(
      temporaryDirectory,
      [releaseError],
      'Session package owner release and cleanup failed',
    );
  }
  try {
    await publishStagedSessionMediaPackage(
      temporaryDirectory,
      packageDirectory,
    );
  } catch (publishError) {
    await cleanupFailedExport(
      temporaryDirectory,
      [publishError],
      'Session package publication and cleanup failed',
    );
  }
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

export async function validateSessionMediaPackage(
  packageDirectory: string,
): Promise<ValidatedSessionMediaPackage> {
  const manifest = parseManifest(
    (
      await readBoundedFile(
        join(packageDirectory, MANIFEST_FILE),
        MAX_MANIFEST_BYTES,
        'Session media package manifest',
      )
    ).toString('utf8'),
  );
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
  const recording = await streamPortableRecording({
    source: join(packageDirectory, manifest.recording),
    label: 'Session media package recording',
    destinationProjectHash: 'package-validation-project',
    destinationSessionId: 'package-validation-session',
    onContents: (contents) => verifyRecording(collectMediaReferences(contents)),
  });
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
    recording: recording.pinned,
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
    writeRecording: async (outputPath) => {
      await streamPortableRecording({
        source: validated.recording,
        label: 'Session media package recording',
        outputPath,
        destinationProjectHash: projectHash,
        destinationSessionId: sessionId,
        onContents: () => undefined,
      });
    },
    persistedStates: validated.persistedStates.map((state, index) => ({
      fileName: importedStateFileName(sessionId, index),
      write: (outputPath: string) =>
        writeRewrittenPersistedState(state, outputPath, projectHash, sessionId),
    })),
  };
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
  const validated =
    typeof packageSource === 'string'
      ? await validateSessionMediaPackage(packageSource)
      : packageSource;
  await mediaStore.preflightObjects(validated.objects);
  const importedSessionId = randomUUID();
  const recordingPath = join(
    destinationChatsDirectory,
    `session-imported-${importedSessionId}.jsonl`,
  );
  const imported: ImportedSessionMediaPackage = {
    recordingPath,
    sessionId: importedSessionId,
    contentIds: validated.objects.map((object) => object.contentId),
  };
  const stagedMedia = await mediaStore.stageObjectFiles(validated.blobs);
  const reservations: ImportReservation[] = [];
  let published: PublishedImportedSession | undefined;
  try {
    for (const [index, reference] of validated.references.entries()) {
      const ownerId = `session-package-import:${importedSessionId}:${index}`;
      await mediaStore.reserve(reference, ownerId);
      reservations.push({ contentId: reference.contentId, ownerId });
    }
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
    return rollbackImport(
      error,
      published,
      stagedMedia,
      mediaStore,
      reservations,
    );
  }
  let result: T | ImportedSessionMediaPackage;
  try {
    result = activate === undefined ? imported : await activate(imported);
  } catch (error) {
    return rollbackImport(
      error,
      published,
      stagedMedia,
      mediaStore,
      reservations,
    );
  }
  stagedMedia.commit();
  return result;
}
