/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { parseImageDimensionsFromBase64 } from '@vybestack/llxprt-code-tools/utils/imageDimensions.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import type {
  ContentBlock,
  IContent,
  InlineMediaBlock,
  MediaBlock,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import { isMediaReferenceBlock } from '../services/history/IContent.js';
import { MediaStoreError, type LocalMediaStore } from './local-media-store.js';
import { MIME_TYPE_PATTERN } from './local-media-store-validation.js';
import { verifyHistoryMedia } from './media-reference-lifecycle.js';

const MAX_DATA_URI_PREFIX_LENGTH = 256;
const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface MediaAdmissionContext {
  readonly turnId: string;
  readonly source: string;
  readonly preserveLegacyMimeParameters?: boolean;
  readonly reservationOwnerScope?: string;
}

export interface MediaAdmissionRelease {
  readonly contents: readonly IContent[];
  readonly context: MediaAdmissionContext;
  readonly mode: 'content' | 'contents';
}

interface AdmissionReservation {
  readonly contentId: string;
  readonly ownerId: string;
}

export class MediaAdmissionError extends Error {
  readonly turnId: string;
  readonly source: string;
  readonly mediaIndex: number;
  readonly contentId: string | undefined;
  readonly historyContentId: string | undefined;

  constructor(
    context: MediaAdmissionContext,
    mediaIndex: number,
    contentId: string | undefined,
    historyContentId: string | undefined,
    cause: unknown,
  ) {
    super(
      `Media admission failed [turn=${context.turnId}] [source=${context.source}] ` +
        `[media[${mediaIndex}]] [historyContentId=${historyContentId ?? 'unavailable'}] ` +
        `[contentId=${contentId ?? 'unavailable'}]`,
      { cause },
    );
    this.name = 'MediaAdmissionError';
    this.turnId = context.turnId;
    this.source = context.source;
    this.mediaIndex = mediaIndex;
    this.contentId = contentId;
    this.historyContentId = historyContentId;
  }
}
function base64PaddingLength(value: string): number {
  if (value.endsWith('==')) return 2;
  if (value.endsWith('=')) return 1;
  return 0;
}

interface NormalizedBase64Source {
  readonly payload: string;
  readonly decodedByteLength: number;
  readonly contentId: string;
}

function normalizeBase64Source(data: string): NormalizedBase64Source {
  let payload = data;
  if (data.toLowerCase().startsWith('data:')) {
    const comma = data.slice(0, MAX_DATA_URI_PREFIX_LENGTH).indexOf(',');
    if (comma < 0) throw new Error('Image data URI has no payload separator');
    const header = data.slice(0, comma);
    if (!header.toLowerCase().endsWith(';base64')) {
      throw new Error('Image data URI is not base64 encoded');
    }
    payload = data.slice(comma + 1);
  }
  const canonical = payload.replace(/\s+/g, '');
  if (
    canonical.length === 0 ||
    canonical.length % 4 !== 0 ||
    !CANONICAL_BASE64_PATTERN.test(canonical)
  ) {
    throw new Error('Base64 image data is malformed or non-canonical');
  }
  const padding = base64PaddingLength(canonical);
  const decodedByteLength = (canonical.length / 4) * 3 - padding;
  if (!Number.isSafeInteger(decodedByteLength) || decodedByteLength <= 0) {
    throw new Error('Base64 image data decoded length is invalid');
  }
  const contentId = `sha256:${createHash('sha256')
    .update(canonical, 'base64')
    .digest('hex')}`;
  return { payload: canonical, decodedByteLength, contentId };
}

function decodeCanonicalBase64(source: NormalizedBase64Source): Uint8Array {
  const bytes = Buffer.from(source.payload, 'base64');
  if (
    bytes.byteLength !== source.decodedByteLength ||
    bytes.toString('base64') !== source.payload
  ) {
    throw new Error('Base64 image data is malformed or non-canonical');
  }
  return new Uint8Array(bytes);
}

function sourceObject(
  source: NormalizedBase64Source,
  mimeType: string,
): {
  readonly contentId: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly normalizedBase64Length: number;
} {
  return {
    contentId: source.contentId,
    mimeType,
    byteLength: source.decodedByteLength,
    normalizedBase64Length: source.payload.length,
  };
}

function modelVisibleMetadata(
  block: MediaBlock,
): Pick<
  MediaBlock,
  'caption' | 'filename' | 'providerMetadata' | 'providerFiles'
> {
  return {
    ...(block.caption === undefined ? {} : { caption: block.caption }),
    ...(block.filename === undefined ? {} : { filename: block.filename }),
    ...(block.providerMetadata === undefined
      ? {}
      : { providerMetadata: block.providerMetadata }),
    ...(block.providerFiles === undefined
      ? {}
      : { providerFiles: block.providerFiles }),
  };
}

function copyModelVisibleMetadata(
  block: InlineMediaBlock,
  reference: MediaReferenceBlock,
): MediaReferenceBlock {
  return Object.freeze({ ...reference, ...modelVisibleMetadata(block) });
}

function ownerIdFor(
  context: MediaAdmissionContext,
  mediaIndex: number,
  contentId: string,
): string {
  return historyOwnerIdFor(contentId, context.reservationOwnerScope);
}

/** Content-derived durable reservation owner. Live history adopts and releases
 * under this exact identity so the one reservation survives admission, ownership,
 * release, and rollback. */
export function historyOwnerIdFor(
  contentId: string,
  scope = 'history',
): string {
  return `history:${createHash('sha256')
    .update(scope)
    .update('\u0000')
    .update(contentId)
    .digest('hex')}`;
}

export class MediaAdmissionService {
  constructor(private readonly store: LocalMediaStore) {}

  async admitContent(
    content: IContent,
    context: MediaAdmissionContext,
  ): Promise<IContent> {
    const reservations: AdmissionReservation[] = [];
    try {
      return await this.admitContentWithinTransaction(
        content,
        context,
        reservations,
      );
    } catch (error) {
      return this.rollbackReservations(reservations, error);
    }
  }

  async admitContents(
    contents: readonly IContent[],
    context: MediaAdmissionContext,
  ): Promise<IContent[]> {
    const reservations: AdmissionReservation[] = [];
    const admitted: IContent[] = [];
    try {
      for (const [index, content] of contents.entries()) {
        admitted.push(
          await this.admitContentWithinTransaction(
            content,
            {
              ...context,
              turnId: content.metadata?.turnId ?? `${context.turnId}:${index}`,
            },
            reservations,
          ),
        );
      }
      return admitted;
    } catch (error) {
      return this.rollbackReservations(reservations, error);
    }
  }

  async releaseContents(
    contents: readonly IContent[],
    context: MediaAdmissionContext,
  ): Promise<void> {
    return this.releaseAdmissions([{ contents, context, mode: 'contents' }]);
  }

  async releaseAdmissions(
    admissions: readonly MediaAdmissionRelease[],
  ): Promise<void> {
    const reservations: AdmissionReservation[] = [];
    for (const admission of admissions) {
      for (const reservation of this.contentReservations(
        admission.contents,
        admission.context,
        admission.mode === 'contents',
      )) {
        this.recordReservation(reservations, reservation);
      }
    }
    const failures: unknown[] = [];
    for (const reservation of reservations) {
      try {
        await this.store.release(reservation.contentId, reservation.ownerId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Media reservation release failed');
    }
  }

  private contentReservations(
    contents: readonly IContent[],
    context: MediaAdmissionContext,
    deriveContentTurnIds = true,
  ): readonly AdmissionReservation[] {
    const reservations: AdmissionReservation[] = [];
    for (const [contentIndex, content] of contents.entries()) {
      const contentContext = deriveContentTurnIds
        ? {
            ...context,
            turnId:
              content.metadata?.turnId ?? `${context.turnId}:${contentIndex}`,
          }
        : context;
      let mediaIndex = 0;
      for (const block of content.blocks) {
        if (block.type !== 'media') continue;
        if (block.encoding === 'reference' && isMediaReferenceBlock(block)) {
          this.recordReservation(reservations, {
            contentId: block.contentId,
            ownerId: ownerIdFor(contentContext, mediaIndex, block.contentId),
          });
        }
        mediaIndex += 1;
      }
    }
    return reservations;
  }

  private async admitContentWithinTransaction(
    content: IContent,
    context: MediaAdmissionContext,
    reservations: AdmissionReservation[],
  ): Promise<IContent> {
    let mediaIndex = 0;
    let contentChanged = false;
    const blocks: ContentBlock[] = [];
    for (const block of content.blocks) {
      if (block.type === 'media') {
        const admitted = await this.admitMediaBlock(
          block,
          content,
          context,
          mediaIndex++,
          reservations,
        );
        blocks.push(admitted.block);
        contentChanged ||= admitted.changed;
      } else {
        blocks.push(block);
      }
    }
    return contentChanged ? { ...content, blocks } : content;
  }

  private async rollbackReservations(
    reservations: readonly AdmissionReservation[],
    admissionError: unknown,
  ): Promise<never> {
    const rollbackErrors: unknown[] = [];
    for (let index = reservations.length - 1; index >= 0; index -= 1) {
      const reservation = reservations[index];
      try {
        await this.store.release(reservation.contentId, reservation.ownerId);
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [admissionError, ...rollbackErrors],
        'Media admission and reservation rollback failed',
      );
    }
    throw admissionError;
  }

  async addToHistory(
    history: HistoryService,
    content: IContent,
    context: MediaAdmissionContext,
    model?: string,
  ): Promise<void> {
    const admitted = await this.admitContent(content, context);
    history.add(admitted, model);
  }

  async verifyHistory(history: readonly IContent[]): Promise<void> {
    await verifyHistoryMedia(history, this.store, 'history-restore');
  }

  private recordReservation(
    reservations: AdmissionReservation[],
    reservation: AdmissionReservation,
  ): void {
    const alreadyRecorded = reservations.some(
      (existing) =>
        existing.contentId === reservation.contentId &&
        existing.ownerId === reservation.ownerId,
    );
    if (!alreadyRecorded) reservations.push(reservation);
  }

  private async admitMediaBlock(
    block: MediaBlock,
    content: IContent,
    context: MediaAdmissionContext,
    mediaIndex: number,
    reservations: AdmissionReservation[],
  ): Promise<{ readonly block: MediaBlock; readonly changed: boolean }> {
    if (block.encoding === 'reference') {
      try {
        if (!isMediaReferenceBlock(block)) {
          throw new Error('Malformed media reference');
        }
        const ownerId = ownerIdFor(context, mediaIndex, block.contentId);
        await this.store.reserveAndReadVerified(block, ownerId);
        this.recordReservation(reservations, {
          contentId: block.contentId,
          ownerId,
        });
      } catch (error) {
        throw new MediaAdmissionError(
          context,
          mediaIndex,
          block.contentId,
          content.metadata?.id,
          error,
        );
      }
      return { block, changed: false };
    }
    if (
      block.encoding !== 'base64' ||
      !block.mimeType.toLowerCase().startsWith('image/') ||
      (context.preserveLegacyMimeParameters === true &&
        !MIME_TYPE_PATTERN.test(block.mimeType))
    ) {
      return { block, changed: false };
    }
    return {
      block: await this.admitImage(block, context, mediaIndex, reservations),
      changed: true,
    };
  }

  private async admitIdentity(
    block: InlineMediaBlock,
    source: NormalizedBase64Source,
  ): Promise<MediaReferenceBlock> {
    await this.store.preflightKnown(source.contentId, source.decodedByteLength);
    const dimensions =
      block.dimensions ?? parseImageDimensionsFromBase64(source.payload);
    return this.store.admitKnown(
      {
        contentId: source.contentId,
        knownByteLength: source.decodedByteLength,
        mimeType: block.mimeType,
        ...(dimensions === undefined ? {} : { dimensions }),
        semanticMetadata: block.semanticMetadata ?? {},
        ...(block.providerFileIds === undefined
          ? {}
          : { providerFileIds: block.providerFileIds }),
      },
      async () => decodeCanonicalBase64(source),
    );
  }

  private async admitDerived(
    block: InlineMediaBlock,
    source: NormalizedBase64Source,
  ): Promise<MediaReferenceBlock> {
    if (
      block.originalData === undefined ||
      block.transformation === undefined
    ) {
      throw new Error(
        'Derived image is missing original data or policy identity',
      );
    }
    const originalSource = normalizeBase64Source(block.originalData);
    const originalMimeType = block.originalMimeType ?? block.mimeType;
    await this.store.preflightObjects([
      sourceObject(source, block.mimeType),
      sourceObject(originalSource, originalMimeType),
    ]);
    const dimensions =
      block.dimensions ?? parseImageDimensionsFromBase64(source.payload);
    const originalDimensions =
      block.originalDimensions ??
      parseImageDimensionsFromBase64(originalSource.payload);
    return this.store.admit({
      bytes: decodeCanonicalBase64(source),
      mimeType: block.mimeType,
      ...(dimensions === undefined ? {} : { dimensions }),
      original: {
        bytes: decodeCanonicalBase64(originalSource),
        mimeType: originalMimeType,
        ...(originalDimensions === undefined
          ? {}
          : { dimensions: originalDimensions }),
      },
      transformation: block.transformation,
      semanticMetadata: block.semanticMetadata ?? {},
      ...(block.providerFileIds === undefined
        ? {}
        : { providerFileIds: block.providerFileIds }),
    });
  }

  private async admitImage(
    block: InlineMediaBlock,
    context: MediaAdmissionContext,
    mediaIndex: number,
    reservations: AdmissionReservation[],
  ): Promise<MediaReferenceBlock> {
    let contentId: string | undefined;
    try {
      const source = normalizeBase64Source(block.data);
      contentId = source.contentId;
      const reference =
        block.originalData === undefined
          ? await this.admitIdentity(block, source)
          : await this.admitDerived(block, source);
      const presented = copyModelVisibleMetadata(block, reference);
      const ownerId = ownerIdFor(context, mediaIndex, presented.contentId);
      await this.store.reserve(presented, ownerId);
      this.recordReservation(reservations, {
        contentId: presented.contentId,
        ownerId,
      });
      return presented;
    } catch (error) {
      const knownContentId =
        error instanceof MediaStoreError
          ? (error.contentId ?? contentId)
          : contentId;
      throw new MediaAdmissionError(
        context,
        mediaIndex,
        knownContentId,
        undefined,
        error,
      );
    }
  }
}
