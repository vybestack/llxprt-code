/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, type Hash } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { MediaStoredObject } from '../services/history/IContent.js';
import {
  HASH_CHUNK_BYTES,
  MAX_OBJECT_BYTES,
  boundedFileSize,
  packageBlobPath,
  type VerifiedPackageBlob,
} from './session-media-package-validation.js';
function appendVerifiedChunk(
  hash: Hash,
  buffer: Buffer,
  bytesRead: number,
  bytesReadTotal: number,
  expectedByteLength: number,
): number {
  const nextTotal = bytesReadTotal + bytesRead;
  if (nextTotal > expectedByteLength) {
    throw new Error('Session media package blob grew during verification');
  }
  hash.update(buffer.subarray(0, bytesRead));
  return nextTotal;
}

async function verifyPackageBlob(
  sourcePath: string,
  object: MediaStoredObject,
): Promise<void> {
  const handle = await open(sourcePath, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  let bytesReadTotal = 0;
  let reading = true;
  let failure: unknown;
  try {
    while (reading) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.byteLength,
        null,
      );
      reading = bytesRead !== 0;
      if (reading) {
        bytesReadTotal = appendVerifiedChunk(
          hash,
          buffer,
          bytesRead,
          bytesReadTotal,
          object.byteLength,
        );
      }
    }
    const contentId = `sha256:${hash.digest('hex')}`;
    if (
      contentId !== object.contentId ||
      bytesReadTotal !== object.byteLength
    ) {
      throw new Error(
        `Session media package blob is corrupt [contentId=${object.contentId}]`,
      );
    }
  } catch (error) {
    failure = error;
  }
  try {
    await handle.close();
  } catch (closeError) {
    failure =
      failure === undefined
        ? closeError
        : new AggregateError(
            [failure, closeError],
            'Session media package blob verification and file close failed',
          );
  }
  if (failure !== undefined) throw failure;
}

export async function verifyPackageBlobs(
  packageDirectory: string,
  objects: readonly MediaStoredObject[],
): Promise<readonly VerifiedPackageBlob[]> {
  const verified: VerifiedPackageBlob[] = [];
  for (const object of objects) {
    const sourcePath = packageBlobPath(packageDirectory, object.contentId);
    let fileSize: number;
    try {
      fileSize = await boundedFileSize(
        sourcePath,
        MAX_OBJECT_BYTES,
        'Session media package blob',
      );
    } catch (error) {
      throw new Error(
        `Session media package blob is missing or exceeds limits [contentId=${object.contentId}]`,
        { cause: error },
      );
    }
    if (fileSize !== object.byteLength) {
      throw new Error(
        `Session media package blob size differs from declared metadata [contentId=${object.contentId}]`,
      );
    }
    await verifyPackageBlob(sourcePath, object);
    verified.push({ object, sourcePath });
  }
  return verified;
}
