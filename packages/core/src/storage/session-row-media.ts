/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import type { IContent } from '../services/history/IContent.js';
import type { LocalMediaStore } from './local-media-store.js';
import {
  MediaAdmissionService,
  type MediaAdmissionContext,
} from './media-admission-service.js';
import {
  collectMediaReferences,
  verifyHistoryMedia,
} from './media-reference-lifecycle.js';

export async function reservePersistenceMedia(
  history: readonly IContent[],
  ownerId: string,
  store?: LocalMediaStore,
): Promise<readonly string[]> {
  if (store === undefined) return [];
  const references = collectMediaReferences(history);
  const unique = new Map(
    references.map((reference) => [reference.contentId, reference]),
  );
  const reserved: string[] = [];
  try {
    for (const reference of unique.values()) {
      await store.reserve(reference, ownerId);
      reserved.push(reference.contentId);
    }
    return reserved;
  } catch (error) {
    const failures: unknown[] = [];
    for (const contentId of reserved) {
      try {
        await store.release(contentId, ownerId);
      } catch (releaseError) {
        failures.push(releaseError);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        [error, ...failures],
        'Media reservation and rollback failed',
      );
    throw error;
  }
}

export async function releasePersistenceMedia(
  contentIds: readonly string[],
  ownerId: string,
  store?: LocalMediaStore,
): Promise<void> {
  if (store === undefined) return;
  const failures: unknown[] = [];
  for (const contentId of contentIds) {
    try {
      await store.release(contentId, ownerId);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'Failed to release persisted media');
}

async function releaseRowOwnership(
  row: IContent,
  context: MediaAdmissionContext,
  reserved: readonly string[],
  ownerId: string,
  store?: LocalMediaStore,
): Promise<void> {
  const failures: unknown[] = [];
  try {
    await releasePersistenceMedia(reserved, ownerId, store);
  } catch (error) {
    failures.push(error);
  }
  if (store !== undefined) {
    try {
      await new MediaAdmissionService(store).releaseContents([row], context);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      'Session media ownership release failed',
    );
}

export async function writePersistenceRow(
  row: IContent,
  sessionId: string,
  generation: number,
  write: (encoded: string) => Promise<void>,
  store?: LocalMediaStore,
): Promise<void> {
  const context: MediaAdmissionContext = {
    turnId: `persistence-generation-${generation}`,
    source: 'session-persistence-save',
    reservationOwnerScope: `persistence-admission:${sessionId}:${generation}:${randomUUID()}`,
  };
  const ownerId = `persistence:${sessionId}:${generation}:${randomUUID()}`;
  let admitted: IContent | undefined;
  let reserved: readonly string[] = [];
  const failures: unknown[] = [];
  try {
    const detached = structuredClone(row);
    admitted =
      store === undefined
        ? detached
        : await new MediaAdmissionService(store).admitContent(
            detached,
            context,
          );
    await verifyHistoryMedia([admitted], store, 'session-persistence-save');
    reserved = await reservePersistenceMedia([admitted], ownerId, store);
    await write(JSON.stringify(admitted));
  } catch (error: unknown) {
    failures.push(error);
  }
  if (admitted !== undefined) {
    try {
      await releaseRowOwnership(admitted, context, reserved, ownerId, store);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Session row save failed');
}
