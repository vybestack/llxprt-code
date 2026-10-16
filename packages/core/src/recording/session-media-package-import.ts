/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import { pathExists } from './session-media-package-validation.js';

export interface ImportPublication {
  readonly destinationChatsDirectory: string;
  readonly recordingPath: string;
  /** Streams the portable recording into the staging file at outputPath. */
  readonly writeRecording: (outputPath: string) => Promise<void>;
  readonly persistedStates: ReadonlyArray<{
    readonly fileName: string;
    readonly write: (outputPath: string) => Promise<void>;
  }>;
}

export interface PublishedImportedSession {
  rollback(): Promise<readonly unknown[]>;
}

export interface ImportReservation {
  readonly contentId: string;
  readonly ownerId: string;
}

async function rollbackImportedFiles(
  published: readonly string[],
  destinationChatsDirectory: string,
  removeDestinationDirectory: boolean,
): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  for (let index = published.length - 1; index >= 0; index -= 1) {
    try {
      await rm(published[index], { force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  if (removeDestinationDirectory) {
    try {
      await rmdir(destinationChatsDirectory);
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

export async function publishImportedSession(
  input: ImportPublication,
): Promise<PublishedImportedSession> {
  const destinationExisted = await pathExists(input.destinationChatsDirectory);
  const stagingDirectory = join(
    input.destinationChatsDirectory,
    `.session-import-${randomUUID()}`,
  );
  const published: string[] = [];
  try {
    await mkdir(input.destinationChatsDirectory, {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(stagingDirectory, { mode: 0o700 });
    const stagedRecording = join(stagingDirectory, 'recording.jsonl');
    await input.writeRecording(stagedRecording);
    for (const state of input.persistedStates) {
      await state.write(join(stagingDirectory, state.fileName));
    }
    await rename(stagedRecording, input.recordingPath);
    published.push(input.recordingPath);
    for (const state of input.persistedStates) {
      const destination = join(input.destinationChatsDirectory, state.fileName);
      await rename(join(stagingDirectory, state.fileName), destination);
      published.push(destination);
    }
  } catch (error) {
    // The staging directory lives inside the destination, so it must go
    // before the destination directory can be removed.
    const rollbackFailures: unknown[] = [];
    try {
      await rm(stagingDirectory, { recursive: true, force: true });
    } catch (cleanupError) {
      rollbackFailures.push(cleanupError);
    }
    rollbackFailures.push(
      ...(await rollbackImportedFiles(
        published,
        input.destinationChatsDirectory,
        !destinationExisted,
      )),
    );
    if (rollbackFailures.length > 0) {
      throw new AggregateError(
        [error, ...rollbackFailures],
        'Session import publication and rollback failed',
      );
    }
    throw error;
  }

  try {
    await rm(stagingDirectory, { recursive: true, force: true });
  } catch (error) {
    const rollbackFailures = await rollbackImportedFiles(
      published,
      input.destinationChatsDirectory,
      !destinationExisted,
    );
    throw new AggregateError(
      [error, ...rollbackFailures],
      'Session import staging cleanup failed',
    );
  }

  return {
    rollback: () =>
      rollbackImportedFiles(
        published,
        input.destinationChatsDirectory,
        !destinationExisted,
      ),
  };
}

export function assertImportReservationsReleased(
  failures: readonly unknown[],
): void {
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Session import owner release failed');
  }
}

export async function releaseImportReservations(
  mediaStore: LocalMediaStore,
  reservations: ImportReservation[],
): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  for (let index = reservations.length - 1; index >= 0; index -= 1) {
    const reservation = reservations[index];
    try {
      await mediaStore.release(reservation.contentId, reservation.ownerId);
      reservations.splice(index, 1);
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

export async function rollbackImport(
  error: unknown,
  published: PublishedImportedSession | undefined,
  stagedMedia: Awaited<ReturnType<LocalMediaStore['stageObjectFiles']>>,
  mediaStore: LocalMediaStore,
  reservations: ImportReservation[],
): Promise<never> {
  const failures: unknown[] = [
    ...(await releaseImportReservations(mediaStore, reservations)),
  ];
  if (published !== undefined) {
    try {
      failures.push(...(await published.rollback()));
    } catch (rollbackError) {
      failures.push(rollbackError);
    }
  }
  try {
    await stagedMedia.rollback();
  } catch (rollbackError) {
    failures.push(rollbackError);
  }
  if (failures.length > 0) {
    throw new AggregateError(
      [error, ...failures],
      'Session import and rollback both failed',
    );
  }
  throw error;
}
