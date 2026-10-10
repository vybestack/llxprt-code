/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  MediaReferenceBlock,
  MediaStoredObject,
} from '../services/history/IContent.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import {
  MANIFEST_FILE,
  PACKAGE_VERSION,
  RECORDING_FILE,
  SUPPORTED_PERSISTED_SESSION_VERSION,
  packageBlobPath,
  pathExists,
  type MediaPackageManifest,
} from './session-media-package-validation.js';

export interface SessionMediaPackageManifestInput {
  readonly temporaryDirectory: string;
  readonly persistedStateFiles: readonly string[];
  readonly references: readonly MediaReferenceBlock[];
  readonly objects: readonly MediaStoredObject[];
}

export async function prepareSessionMediaPackageStaging(
  temporaryDirectory: string,
): Promise<void> {
  await mkdir(join(temporaryDirectory, 'blobs', 'sha256'), {
    recursive: true,
    mode: 0o700,
  });
}

export async function stageSessionMediaPackageBlobs(
  temporaryDirectory: string,
  mediaStore: LocalMediaStore,
  objects: readonly MediaStoredObject[],
): Promise<void> {
  for (const object of objects) {
    const bytes = await mediaStore.readObjectVerified(object);
    await writeFile(
      packageBlobPath(temporaryDirectory, object.contentId),
      bytes,
      {
        mode: 0o600,
        flag: 'wx',
      },
    );
  }
}

export async function writeSessionMediaPackageManifest(
  input: SessionMediaPackageManifestInput,
): Promise<void> {
  const manifest: MediaPackageManifest = {
    version: PACKAGE_VERSION,
    recording: RECORDING_FILE,
    persistedStates: input.persistedStateFiles.map((file) => ({
      file,
      version: SUPPORTED_PERSISTED_SESSION_VERSION,
    })),
    references: input.references,
    objects: input.objects,
  };
  await writeFile(
    join(input.temporaryDirectory, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600, flag: 'wx' },
  );
}

export async function publishStagedSessionMediaPackage(
  temporaryDirectory: string,
  packageDirectory: string,
): Promise<void> {
  await mkdir(dirname(packageDirectory), { recursive: true });
  const claimPath = `${packageDirectory}.publish`;
  const claim = await open(claimPath, 'wx', 0o600);
  let failure: unknown;
  try {
    await claim.close();
    if (await pathExists(packageDirectory)) {
      throw new Error(`Session media package destination already exists`);
    }
    await rename(temporaryDirectory, packageDirectory);
  } catch (error) {
    failure = error;
  }
  try {
    await rm(claimPath, { force: true });
  } catch (cleanupError) {
    failure =
      failure === undefined
        ? cleanupError
        : new AggregateError(
            [failure, cleanupError],
            'Session media package publication and claim cleanup failed',
          );
  }
  if (failure !== undefined) throw failure;
}
