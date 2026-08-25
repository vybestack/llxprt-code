/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  type IContent,
  type MediaReferenceBlock,
  type MediaStoredObject,
} from '../services/history/IContent.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import { MediaAdmissionService } from '../storage/media-admission-service.js';
import { collectMediaReferences } from '../storage/media-reference-lifecycle.js';
import { replaySession } from './ReplayEngine.js';

import {
  MANIFEST_FILE,
  MAX_HISTORY_CONTENTS,
  MAX_MANIFEST_BYTES,
  MAX_OBJECT_AGGREGATE_BYTES,
  MAX_OBJECT_BYTES,
  MAX_PERSISTED_STATES,
  MAX_PERSISTED_STATE_AGGREGATE_BYTES,
  MAX_PERSISTED_STATE_BYTES,
  MAX_RECORDING_BYTES,
  PERSISTED_SESSION_PREFIX,
  SUPPORTED_PERSISTED_SESSION_VERSION,
  boundedAggregate,
  boundedFileSize,
  isContent,
  isRecord,
  parseManifest,
  readBoundedFile,
  requiredObjects,
  requirePortableMediaContent,
  requireRecordingLine,
  uniqueReferences,
  verifyManifestObjectSet,
  type MediaPackageManifest,
  type PortablePersistedState,
  type PortableRecording,
  type VerifiedPackageBlob,
} from './session-media-package-validation.js';
import { verifyPackageBlobs } from './session-media-package-blobs.js';
import {
  assertImportReservationsReleased,
  publishImportedSession,
  releaseImportReservations,
  rollbackImport,
  type ImportReservation,
  type PublishedImportedSession,
} from './session-media-package-import.js';
import {
  capturePersistedStates,
  rewrittenPersistedStates,
  verifyHistoryReferences,
  type CapturedPersistedState,
} from './session-media-package-state.js';
import {
  publishStagedSessionMediaPackage,
  stageSessionMediaPackage,
} from './session-media-package-writer.js';

export interface ImportedSessionMediaPackage {
  readonly recordingPath: string;
  readonly sessionId: string;
  readonly contentIds: readonly string[];
}

interface ExportReservation {
  readonly contents: readonly IContent[];
  readonly context: {
    readonly turnId: string;
    readonly source: string;
  };
  readonly mode: 'content' | 'contents';
}

interface PortableLineContext {
  readonly admission: MediaAdmissionService | undefined;
  readonly reservations: ExportReservation[] | undefined;
  readonly histories: IContent[][];
  readonly destinationProjectHash: string | undefined;
  readonly destinationSessionId: string | undefined;
}

type PortableLineResult =
  | {
      readonly kind: 'session-start';
      readonly payload: Record<string, unknown>;
      readonly sessionId: string;
    }
  | {
      readonly kind: 'event';
      readonly payload: Record<string, unknown>;
    };

function parseRecordingLine(serialized: string, lineNumber: number) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Invalid recording JSON at line ${lineNumber}`, {
      cause: error,
    });
  }
  return requireRecordingLine(parsed, lineNumber);
}

async function preparePortableContent(
  content: IContent,
  context: PortableLineContext,
  lineNumber: number,
): Promise<IContent> {
  if (context.destinationProjectHash !== undefined) {
    return requirePortableMediaContent(content);
  }
  if (context.admission === undefined) {
    throw new Error('Media store is required when exporting a session package');
  }
  const admissionContext = {
    turnId: `session-package-line-${lineNumber}`,
    source: 'session-package-export',
  };
  const admitted = await context.admission.admitContent(
    content,
    admissionContext,
  );
  context.reservations?.push({
    contents: [admitted],
    context: admissionContext,
    mode: 'content',
  });
  return admitted;
}

async function processPortableLine(
  line: Record<string, unknown>,
  lineNumber: number,
  context: PortableLineContext,
): Promise<PortableLineResult> {
  const payload = line['payload'];
  if (!isRecord(payload))
    throw new Error(`Invalid recording line ${lineNumber}`);
  if (line['type'] === 'session_start') {
    const sessionId = payload['sessionId'];
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('Invalid recording session identifier');
    }
    const nextPayload: Record<string, unknown> = {
      ...payload,
      sessionId: context.destinationSessionId ?? sessionId,
      projectHash: context.destinationProjectHash ?? payload['projectHash'],
      workspaceDirs: [],
    };
    delete nextPayload['cwd'];
    return { kind: 'session-start', payload: nextPayload, sessionId };
  }
  if (line['type'] === 'content' || line['type'] === 'compressed') {
    const key = line['type'] === 'content' ? 'content' : 'summary';
    const content = payload[key];
    if (!isContent(content)) {
      throw new Error(
        `Invalid ${String(line['type'])} recording at line ${lineNumber}`,
      );
    }
    const admitted = await preparePortableContent(content, context, lineNumber);
    context.histories.push([admitted]);
    return { kind: 'event', payload: { ...payload, [key]: admitted } };
  }
  if (line['type'] === 'semantic_media_purge') {
    const history = payload['history'];
    if (!Array.isArray(history) || !history.every(isContent)) {
      throw new Error(`Invalid semantic purge recording at line ${lineNumber}`);
    }
    let admitted: IContent[];
    if (context.destinationProjectHash === undefined) {
      if (context.admission === undefined) {
        throw new Error(
          'Media store is required when exporting a session package',
        );
      }
      const admissionContext = {
        turnId: `session-package-line-${lineNumber}`,
        source: 'session-package-export',
      };
      admitted = await context.admission.admitContents(
        history,
        admissionContext,
      );
      context.reservations?.push({
        contents: admitted,
        context: admissionContext,
        mode: 'contents',
      });
    } else {
      admitted = history.map(requirePortableMediaContent);
    }
    context.histories.push(admitted);
    return { kind: 'event', payload: { ...payload, history: admitted } };
  }
  return { kind: 'event', payload };
}

async function portableRecording(
  recordingBytes: Uint8Array,
  mediaStore: LocalMediaStore | undefined,
  destinationProjectHash?: string,
  destinationSessionId?: string,
  admission?: MediaAdmissionService,
  reservations?: ExportReservation[],
): Promise<PortableRecording> {
  const rawLines = Buffer.from(recordingBytes)
    .toString('utf8')
    .trim()
    .split('\n');
  if (rawLines.length === 0 || rawLines[0] === '') {
    throw new Error('Invalid empty session recording');
  }
  const histories: IContent[][] = [];
  const context: PortableLineContext = {
    admission:
      mediaStore === undefined
        ? undefined
        : (admission ?? new MediaAdmissionService(mediaStore)),
    reservations,
    histories,
    destinationProjectHash,
    destinationSessionId,
  };
  const portableLines: string[] = [];
  let sourceSessionId: string | undefined;
  for (let index = 0; index < rawLines.length; index += 1) {
    const line = parseRecordingLine(rawLines[index], index + 1);
    const result = await processPortableLine(line, index + 1, context);
    if (result.kind === 'session-start') sourceSessionId = result.sessionId;
    portableLines.push(JSON.stringify({ ...line, payload: result.payload }));
  }
  if (sourceSessionId === undefined) {
    throw new Error('Recording does not contain session_start');
  }
  return {
    bytes: Buffer.from(`${portableLines.join('\n')}\n`, 'utf8'),
    sessionId: destinationSessionId ?? sourceSessionId,
    histories,
  };
}

async function readPersistedState(
  recordingPath: string,
  entry: string,
  sessionId: string,
  projectHash: string,
  stateIndex: number,
  admission: MediaAdmissionService,
  reservations: ExportReservation[],
): Promise<PortablePersistedState | undefined> {
  if (!entry.startsWith(PERSISTED_SESSION_PREFIX) || !entry.endsWith('.json')) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(
    (
      await readBoundedFile(
        join(dirname(recordingPath), entry),
        MAX_PERSISTED_STATE_BYTES,
        'Persisted session state',
      )
    ).toString('utf8'),
  );
  if (!isRecord(parsed)) throw new Error(`Invalid persisted session ${entry}`);
  if (
    parsed['sessionId'] !== sessionId ||
    parsed['projectHash'] !== projectHash
  ) {
    return undefined;
  }
  if (parsed['version'] !== SUPPORTED_PERSISTED_SESSION_VERSION) {
    throw new Error(
      `Unsupported persisted session version ${String(parsed['version'])}`,
    );
  }
  const history = parsed['history'];
  if (
    !Array.isArray(history) ||
    !history.every(isContent) ||
    history.length > MAX_HISTORY_CONTENTS
  ) {
    throw new Error(`Invalid persisted session history ${entry}`);
  }
  const admissionContext = {
    turnId: `session-package-persisted-${stateIndex}`,
    source: 'session-package-export',
  };
  const admitted = await admission.admitContents(history, admissionContext);
  reservations.push({
    contents: admitted,
    context: admissionContext,
    mode: 'contents',
  });
  return {
    file: `state/persisted-${stateIndex}.json`,
    history: admitted,
    serialized: JSON.stringify({ ...parsed, history: admitted }),
  };
}

async function readPersistedStates(
  recordingPath: string,
  sessionId: string,
  projectHash: string,
  admission: MediaAdmissionService,
  reservations: ExportReservation[],
): Promise<readonly PortablePersistedState[]> {
  const entries = (await readdir(dirname(recordingPath)))
    .filter(
      (entry) =>
        entry.startsWith(PERSISTED_SESSION_PREFIX) && entry.endsWith('.json'),
    )
    .sort();
  if (entries.length > MAX_PERSISTED_STATES) {
    throw new Error('Export persisted state count exceeds limit');
  }
  const sizes: number[] = [];
  for (const entry of entries) {
    sizes.push(
      await boundedFileSize(
        join(dirname(recordingPath), entry),
        MAX_PERSISTED_STATE_BYTES,
        'Persisted session state',
      ),
    );
  }
  boundedAggregate(
    sizes,
    MAX_PERSISTED_STATE_AGGREGATE_BYTES,
    'Persisted session states',
  );
  const states: PortablePersistedState[] = [];
  for (const entry of entries) {
    const state = await readPersistedState(
      recordingPath,
      entry,
      sessionId,
      projectHash,
      states.length,
      admission,
      reservations,
    );
    if (state !== undefined) states.push(state);
  }
  return states;
}

async function replayPortableRecording(
  recordingPath: string,
  recordingBytes: Uint8Array,
  projectHash: string,
  mediaStore: LocalMediaStore,
): Promise<readonly IContent[]> {
  const replayPath = `${recordingPath}.${randomUUID()}.portable.tmp`;
  let history: readonly IContent[] | undefined;
  let failure: unknown;
  try {
    await writeFile(replayPath, recordingBytes, { mode: 0o600, flag: 'wx' });
    const replay = await replaySession(replayPath, projectHash, { mediaStore });
    if (!replay.ok) {
      throw new Error(`Cannot export session media: ${replay.error}`);
    }
    history = replay.history;
  } catch (error) {
    failure = error;
  }
  try {
    await rm(replayPath, { force: true });
  } catch (cleanupError) {
    failure =
      failure === undefined
        ? cleanupError
        : new AggregateError(
            [failure, cleanupError],
            'Portable session replay and cleanup failed',
          );
  }
  if (failure !== undefined) throw failure;
  if (history === undefined) throw new Error('Portable session replay failed');
  return history;
}

async function writeSessionMediaPackage(
  recordingPath: string,
  projectHash: string,
  mediaStore: LocalMediaStore,
  temporaryDirectory: string,
  admission: MediaAdmissionService,
  reservations: ExportReservation[],
): Promise<void> {
  const sourceBytes = await readBoundedFile(
    recordingPath,
    MAX_RECORDING_BYTES,
    'Session recording',
  );
  const recording = await portableRecording(
    sourceBytes,
    mediaStore,
    undefined,
    undefined,
    admission,
    reservations,
  );
  const persistedStates = await readPersistedStates(
    recordingPath,
    recording.sessionId,
    projectHash,
    admission,
    reservations,
  );
  const replayHistory = await replayPortableRecording(
    recordingPath,
    recording.bytes,
    projectHash,
    mediaStore,
  );
  const references = uniqueReferences(
    collectMediaReferences([
      ...recording.histories.flat(),
      ...persistedStates.flatMap((state) => state.history),
      ...replayHistory,
    ]),
  );
  const objects = requiredObjects(references);
  await stageSessionMediaPackage({
    temporaryDirectory,
    mediaStore,
    recording,
    persistedStates,
    references,
    objects,
  });
}

async function releaseExportReservations(
  admission: MediaAdmissionService,
  reservations: readonly ExportReservation[],
): Promise<void> {
  await admission.releaseAdmissions(reservations);
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
  const reservations: ExportReservation[] = [];
  const temporaryDirectory = `${packageDirectory}.${randomUUID()}.tmp`;
  try {
    await writeSessionMediaPackage(
      recordingPath,
      projectHash,
      mediaStore,
      temporaryDirectory,
      admission,
      reservations,
    );
  } catch (error) {
    try {
      await releaseExportReservations(admission, reservations);
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
    await releaseExportReservations(admission, reservations);
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
  readonly recordingBytes: Uint8Array;
  readonly persistedStates: readonly CapturedPersistedState[];
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
  const recordingBytes = new Uint8Array(
    await readBoundedFile(
      join(packageDirectory, manifest.recording),
      MAX_RECORDING_BYTES,
      'Session media package recording',
    ),
  );
  const persistedStates = await capturePersistedStates(
    packageDirectory,
    manifest.persistedStates,
  );
  const portable = await portableRecording(
    recordingBytes,
    undefined,
    'package-validation-project',
    'package-validation-session',
  );
  if (portable.histories.length > MAX_HISTORY_CONTENTS) {
    throw new Error('Session media package history count exceeds limit');
  }
  verifyHistoryReferences(
    'recording',
    uniqueReferences(collectMediaReferences(portable.histories.flat())),
    references,
  );
  verifyHistoryReferences(
    'persisted history',
    uniqueReferences(
      collectMediaReferences(persistedStates.flatMap((state) => state.history)),
    ),
    references,
  );
  const blobs = await verifyPackageBlobs(packageDirectory, objects);
  return {
    packageDirectory,
    manifest,
    references,
    objects,
    blobs,
    recordingBytes,
    persistedStates,
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
  const portable = await portableRecording(
    validated.recordingBytes,
    undefined,
    projectHash,
    importedSessionId,
  );
  const persistedStates = rewrittenPersistedStates(
    validated.persistedStates,
    projectHash,
    importedSessionId,
  );
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
    published = await publishImportedSession({
      destinationChatsDirectory,
      recordingPath,
      recordingBytes: portable.bytes,
      persistedStates,
    });
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
