/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { projectRecordedContentIds } from '../recording/janitor/mediaReclamation.js';
import type { StagedMediaObjectAdmission } from './local-media-store-types.js';
import type { rename } from 'node:fs/promises';
import {
  isMediaReferenceBlock,
  type MediaReferenceBlock,
  type MediaStoredObject,
} from '../services/history/IContent.js';
import {
  MediaObjectMissingError,
  type LocalMediaStore,
} from './local-media-store.js';

function recordedObjects(value: unknown): readonly MediaStoredObject[] {
  if (isMediaReferenceBlock(value)) {
    return [value.originalObject, value.selectedObject];
  }
  if (Array.isArray(value)) return value.flatMap(recordedObjects);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(recordedObjects);
  }
  return [];
}

async function copyObjects(
  source: LocalMediaStore,
  value: unknown,
): Promise<ReadonlyArray<{ object: MediaStoredObject; bytes: Uint8Array }>> {
  const objects = new Map(
    recordedObjects(value).map((object) => [object.contentId, object]),
  );
  return Promise.all(
    [...objects.values()].map(async (object) => ({
      object,
      bytes: await source.readObjectVerified(object),
    })),
  );
}

export async function publishRecordedMedia<T>(
  store: LocalMediaStore | undefined,
  records: unknown,
  publish: () => Promise<T>,
): Promise<T> {
  if (store?.recordingArchive === undefined) return publish();
  const admissions = await copyObjects(store, records);
  if (admissions.length === 0) return publish();
  return store.recordingArchive.admitObjectsTransaction(admissions, publish);
}

export async function hydrateRecordedMedia(
  store: LocalMediaStore | undefined,
  history: unknown,
): Promise<void> {
  if (store?.recordingArchive === undefined) return;
  const objects = new Map(
    recordedObjects(history).map((object) => [object.contentId, object]),
  );
  const admissions = [];
  for (const object of objects.values()) {
    try {
      await store.readObjectVerified(object);
    } catch (error) {
      if (!(error instanceof MediaObjectMissingError)) throw error;
      admissions.push({
        object,
        bytes: await store.recordingArchive.readObjectVerified(object),
      });
    }
  }
  await store.admitObjects(admissions);
}

export function publishRecordedFile(
  store: LocalMediaStore | undefined,
  state: { readonly admittedHistory: unknown; readonly tempPath: string },
  destination: string,
  renameFile: typeof rename,
): Promise<void> {
  return publishRecordedMedia(store, state.admittedHistory, () =>
    renameFile(state.tempPath, destination),
  );
}

export async function stageRecordedMedia(
  store: LocalMediaStore | undefined,
  records: unknown,
): Promise<StagedMediaObjectAdmission & { finalize(): Promise<void> }> {
  const archive = store?.recordingArchive;
  if (store === undefined || archive === undefined)
    return {
      createdContentIds: [],
      commit: () => {},
      rollback: async () => {},
      finalize: async () => {},
    };
  const references = recordedReferences(records);
  const ownerId = `durable-publication-${randomUUID()}`;
  const staged = await archive.stageObjects(await copyObjects(store, records), {
    references,
    ownerId,
  });
  const release = async (): Promise<void> => {
    const results = await Promise.allSettled(
      references.map((reference) =>
        archive.release(reference.contentId, ownerId),
      ),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Durable media release failed');
  };
  return {
    createdContentIds: staged.createdContentIds,
    commit: () => staged.commit(),
    finalize: release,
    rollback: async () => {
      await release();
      await staged.rollback(() =>
        projectRecordedContentIds(dirname(archive.rootDirectory)),
      );
    },
  };
}

function recordedReferences(value: unknown): readonly MediaReferenceBlock[] {
  if (isMediaReferenceBlock(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(recordedReferences);
  if (typeof value === 'object' && value !== null)
    return Object.values(value).flatMap(recordedReferences);
  return [];
}

export function containsRecordedMedia(records: unknown): boolean {
  return recordedObjects(records).length > 0;
}
