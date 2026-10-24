/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import { open, rm, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import { createFileHandleSink } from '../journal/positionalFile.js';
import { SessionLockManager } from './SessionLockManager.js';
import { requireJournalRecorder } from '../services/history/recorderBackend.js';
import type { SessionRecordingPort } from './recordingPort.js';
import { readJournalFileFacts } from './journalSessionListing.js';
import { validateJournalRecording } from './session-media-package-journal.js';
import {
  HASH_CHUNK_BYTES,
  JOURNAL_RECORDING_FILE,
  requiredObjects,
} from './session-media-package-validation.js';
import { MediaReferenceIndex } from './session-media-package-state.js';
import { hydrateRecordedMedia } from '../storage/recorded-media-transfer.js';
import {
  prepareSessionMediaPackageStaging,
  publishStagedSessionMediaPackage,
  stageSessionMediaPackageBlobs,
  writeSessionMediaPackageManifest,
} from './session-media-package-writer.js';

export interface JournalPackageExportOptions {
  readonly recording?: SessionRecordingPort;
  readonly signal?: AbortSignal;
}

interface ExportSource {
  readonly size: number;
  readonly sessionId: string;
  readonly close: () => Promise<void>;
}

async function exportSource(
  path: string,
  options: JournalPackageExportOptions,
): Promise<ExportSource> {
  if (options.recording !== undefined) {
    const recording = requireJournalRecorder(options.recording);
    if (recording.getFilePath() !== path || !recording.isActive())
      throw new Error('Export source does not match the active recording');
    const lock = recording.getOwnedLockHandle();
    if (lock === null || !(await lock.ownsLock()))
      throw new Error('Export source recording does not own its session lock');
    await recording.flush();
    const session = await recording.session();
    await session.store.idle();
    const read = await session.store.openRead();
    if (read.version === undefined) {
      await read.close();
      throw new Error('Export source has no committed session');
    }
    return {
      size: read.version.durableEnd,
      sessionId: recording.getSessionId(),
      close: async () => {
        await read.close();
      },
    };
  }
  const facts = await readJournalFileFacts(path);
  if (facts === undefined)
    throw new Error('Export source has no committed session');
  const lock = await SessionLockManager.acquire(
    dirname(path),
    facts.facts.sessionId,
  );
  try {
    const handle = await open(path, 'r');
    try {
      return {
        size: (await handle.stat()).size,
        sessionId: facts.facts.sessionId,
        close: () => lock.release(),
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    try {
      await lock.release();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Export source open and lock release failed',
      );
    }
    throw error;
  }
}
async function copySourceBytes(
  input: FileHandle,
  output: FileHandle,
  size: number,
  signal?: AbortSignal,
): Promise<void> {
  const sink = createFileHandleSink(output, 0);
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  let offset = 0;
  while (offset < size) {
    signal?.throwIfAborted();
    const { bytesRead } = await input.read(
      buffer,
      0,
      Math.min(buffer.length, size - offset),
      offset,
    );
    if (bytesRead === 0) throw new Error('Export source was truncated');
    await sink(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
}

async function copyPrefix(
  source: string,
  destination: string,
  size: number,
  signal?: AbortSignal,
): Promise<void> {
  const input = await open(source, 'r');
  try {
    const output = await open(destination, 'wx', 0o600);
    try {
      await copySourceBytes(input, output, size, signal);
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}

async function writeNativePackage(
  path: string,
  projectHash: string,
  mediaStore: LocalMediaStore,
  directory: string,
  options: JournalPackageExportOptions,
): Promise<void> {
  options.signal?.throwIfAborted();
  const source = await exportSource(path, options);
  let failure: unknown;
  try {
    await prepareSessionMediaPackageStaging(directory);
    const recording = join(directory, JOURNAL_RECORDING_FILE);
    await copyPrefix(path, recording, source.size, options.signal);
    const index = new MediaReferenceIndex();
    await validateJournalRecording(recording, (contents) => {
      options.signal?.throwIfAborted();
      index.add(contents);
    });
    const facts = await readJournalFileFacts(recording);
    if (
      facts?.facts.start.projectHash !== projectHash ||
      facts.facts.sessionId !== source.sessionId
    )
      throw new Error('Export source session/project does not match');
    const references = index.references();
    await hydrateRecordedMedia(mediaStore, references);
    const objects = requiredObjects(references);
    await stageSessionMediaPackageBlobs(directory, mediaStore, objects);
    options.signal?.throwIfAborted();
    await writeSessionMediaPackageManifest({
      temporaryDirectory: directory,
      recordingFile: JOURNAL_RECORDING_FILE,
      persistedStateFiles: [],
      references,
      objects,
    });
  } catch (error) {
    failure = error;
  }
  try {
    await source.close();
  } catch (cleanup) {
    failure =
      failure === undefined
        ? cleanup
        : new AggregateError(
            [failure, cleanup],
            'Export and source release failed',
          );
  }
  if (failure !== undefined) throw failure;
}

export async function exportJournalSessionMediaPackage(
  path: string,
  projectHash: string,
  mediaStore: LocalMediaStore,
  destination: string,
  options: JournalPackageExportOptions,
): Promise<void> {
  const directory = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeNativePackage(path, projectHash, mediaStore, directory, options);
    options.signal?.throwIfAborted();
    await publishStagedSessionMediaPackage(directory, destination);
  } catch (error) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Native package export and cleanup failed',
      );
    }
    throw error;
  }
}
