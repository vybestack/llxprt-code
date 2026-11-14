/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaStoredObject } from '../services/history/IContent.js';
import {
  MediaObjectCorruptError,
  MediaObjectHashMismatchError,
} from './local-media-store-types.js';
import { validateStoredObjectMetadata } from './local-media-store-validation.js';

/** Verifies one object without retaining its payload for the subsequent send. */
export async function verifyMediaObject(
  rootDirectory: string,
  reference: MediaStoredObject,
  signal?: AbortSignal,
): Promise<void> {
  const operation = 'verify request media';
  validateStoredObjectMetadata(reference, operation);
  signal?.throwIfAborted();
  const handle = await open(
    join(rootDirectory, 'objects', 'sha256', reference.contentId.slice(7)),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== reference.byteLength)
      throw new MediaObjectCorruptError(operation, reference.contentId);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let length = 0;
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > reference.byteLength)
        throw new MediaObjectCorruptError(operation, reference.contentId);
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (length !== reference.byteLength)
      throw new MediaObjectCorruptError(operation, reference.contentId);
    if (`sha256:${hash.digest('hex')}` !== reference.contentId)
      throw new MediaObjectHashMismatchError(operation, reference.contentId);
    signal?.throwIfAborted();
  } finally {
    await handle.close();
  }
}
