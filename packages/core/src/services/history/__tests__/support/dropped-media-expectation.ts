/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import type {
  ContentBlock,
  IContent,
  MediaDroppedBlock,
  MediaOrigin,
  MediaReferenceBlock,
} from '../../IContent.js';

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function sourceIdentity(source: ContentBlock): {
  readonly contentId: string;
  readonly byteLength: number;
  readonly mimeType: string;
} {
  if (source.type !== 'media')
    throw new Error(`Expected an image, found ${source.type}`);
  if (source.encoding === 'reference')
    return {
      contentId: source.contentId,
      byteLength: source.byteLength,
      mimeType: source.mimeType,
    };
  if (source.encoding !== 'base64')
    throw new Error('Expected stored image bytes');
  const bytes = Buffer.from(source.data, 'base64');
  return {
    contentId: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    byteLength: bytes.byteLength,
    mimeType: source.mimeType,
  };
}

/**
 * The reference a dropped `source` image must become. The identity comes from
 * the source bytes; origin and drop time are read from `actual` (the drop
 * time is the wall clock at the drop) and checked for shape.
 */
export function expectedDroppedImage(
  source: ContentBlock,
  actual: ContentBlock | undefined,
): MediaDroppedBlock {
  if (actual?.type !== 'media_dropped')
    throw new Error(`Expected a dropped image, found ${actual?.type}`);
  if (!ISO_TIME.test(actual.droppedAt))
    throw new Error(`Dropped image time is not ISO: ${actual.droppedAt}`);
  return droppedImageOf(source, actual.origin, actual.droppedAt);
}

/** The reference `source` becomes when dropped with `origin` at `droppedAt`. */
export function droppedImageOf(
  source: ContentBlock,
  origin: MediaOrigin,
  droppedAt: string,
): MediaDroppedBlock {
  const identity = sourceIdentity(source);
  return {
    type: 'media_dropped',
    origin,
    mimeType: identity.mimeType,
    byteLength: identity.byteLength,
    contentId: identity.contentId,
    droppedAt,
  };
}

/**
 * Where admission says an image came from, restated independently of the
 * production rule: a recorded origin, an absolute filename, the tool response
 * it rides with, the model, or a paste.
 */
export function admittedOrigin(
  row: IContent,
  source: ContentBlock,
  readAt: string,
): MediaOrigin {
  if (source.type !== 'media') throw new Error('Expected an image');
  if (source.origin !== undefined) return source.origin;
  if (source.filename?.startsWith('/') === true)
    return { kind: 'file', path: source.filename, readAt };
  const response = row.blocks.find((block) => block.type === 'tool_response');
  if (response?.type === 'tool_response')
    return {
      kind: 'tool',
      toolName: response.toolName,
      callId: response.callId,
      readAt,
    };
  return row.speaker === 'ai'
    ? { kind: 'model-output', readAt }
    : { kind: 'pasted', readAt };
}

/** `source` with block `blockIndex` replaced by the reference in `actual`. */
export function expectedDroppedRow(
  source: IContent,
  actual: IContent | undefined,
  blockIndex: number,
): IContent['blocks'] {
  return source.blocks.map((block, index) =>
    index === blockIndex
      ? expectedDroppedImage(block, actual?.blocks[index])
      : block,
  );
}

/** `reference` as admission stamps a file read: with its absolute path. */
export function readFromFile(
  reference: MediaReferenceBlock,
  path: string,
): MediaReferenceBlock {
  return {
    ...reference,
    origin: { kind: 'file', path, readAt: '2026-11-19T00:00:00.000Z' },
  };
}
