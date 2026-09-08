/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  isInlineMediaBlock,
  isMediaReferenceBlock,
  type IContent,
  type MediaBlock,
  type MediaReferenceBlock,
} from '../services/history/IContent.js';
import type { LocalMediaStore } from './local-media-store.js';

export class MediaReferenceValidationError extends Error {
  readonly contentId: string | undefined;
  readonly turnId: string;
  readonly source: string;
  readonly mediaIndex: number;

  constructor(
    contentId: string | undefined,
    turnId: string,
    source: string,
    mediaIndex: number,
    cause: unknown,
  ) {
    super(
      `Media reference validation failed [turn=${turnId}] [source=${source}] ` +
        `[media[${mediaIndex}]] [contentId=${contentId ?? 'unavailable'}]`,
      { cause },
    );
    this.name = 'MediaReferenceValidationError';
    this.contentId = contentId;
    this.turnId = turnId;
    this.source = source;
    this.mediaIndex = mediaIndex;
  }
}

function referenceIdentity(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('contentId' in value)) {
    return undefined;
  }
  return typeof value.contentId === 'string' ? value.contentId : undefined;
}

function validatedReference(
  block: MediaBlock,
  turnId: string,
  mediaIndex: number,
): MediaReferenceBlock | undefined {
  if (block.encoding !== 'reference') {
    return undefined;
  }
  if (!isMediaReferenceBlock(block)) {
    throw new MediaReferenceValidationError(
      referenceIdentity(block),
      turnId,
      'reference-collection',
      mediaIndex,
      new Error('Malformed media reference'),
    );
  }
  return block;
}

function collectContentReferences(
  content: IContent,
): readonly MediaReferenceBlock[] {
  const references: MediaReferenceBlock[] = [];
  let mediaIndex = 0;
  for (const block of content.blocks) {
    if (block.type === 'media') {
      const reference = validatedReference(
        block,
        content.metadata?.turnId ?? 'unknown',
        mediaIndex,
      );
      if (reference !== undefined) references.push(reference);
      mediaIndex++;
    }
  }
  return references;
}

export function collectMediaReferences(
  history: readonly IContent[],
): readonly MediaReferenceBlock[] {
  return history.flatMap(collectContentReferences);
}

async function verifyMediaBlock(
  block: MediaBlock,
  mediaStore: LocalMediaStore | undefined,
  turnId: string,
  source: string,
  mediaIndex: number,
): Promise<void> {
  if (block.encoding !== 'reference') {
    if (!isInlineMediaBlock(block)) {
      throw new MediaReferenceValidationError(
        undefined,
        turnId,
        source,
        mediaIndex,
        new Error('Malformed legacy inline media'),
      );
    }
    return;
  }
  if (!isMediaReferenceBlock(block)) {
    throw new MediaReferenceValidationError(
      referenceIdentity(block),
      turnId,
      source,
      mediaIndex,
      new Error('Malformed media reference'),
    );
  }
  if (mediaStore === undefined) {
    throw new MediaReferenceValidationError(
      block.contentId,
      turnId,
      source,
      mediaIndex,
      new Error('No local media store is available'),
    );
  }
  try {
    await mediaStore.readVerified(block);
  } catch (error) {
    throw new MediaReferenceValidationError(
      block.contentId,
      turnId,
      source,
      mediaIndex,
      error,
    );
  }
}

export async function verifyHistoryMedia(
  history: readonly IContent[],
  mediaStore: LocalMediaStore | undefined,
  source = 'history',
): Promise<void> {
  for (const content of history) {
    let mediaIndex = 0;
    for (const block of content.blocks) {
      if (block.type === 'media') {
        await verifyMediaBlock(
          block,
          mediaStore,
          content.metadata?.turnId ?? 'unknown',
          source,
          mediaIndex,
        );
        mediaIndex++;
      }
    }
  }
}
