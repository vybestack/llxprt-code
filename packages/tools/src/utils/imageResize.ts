/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import sharp, { type Metadata, type Sharp } from 'sharp';

export interface ImageResizePolicy {
  readonly maxLongEdge?: number;
  readonly maxShortEdge?: number;
  readonly maxPixels?: number;
}

export class ImageResizeError extends Error {
  constructor(displayName: string, reason: string) {
    super(`Unable to resize image ${displayName}: ${reason}`);
    this.name = 'ImageResizeError';
  }
}

interface ImageDimensions {
  readonly width: number;
  readonly height: number;
  readonly frames: number;
}

const MIME_FORMATS: ReadonlyMap<string, string> = new Map([
  ['image/jpeg', 'jpeg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
]);

function getDimensions(metadata: Metadata): ImageDimensions {
  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height)
  ) {
    throw new Error('image metadata is missing width or height');
  }
  const frames = metadata.pages ?? 1;
  const swapsAxes =
    metadata.orientation !== undefined && metadata.orientation >= 5;
  return swapsAxes
    ? { width: height, height: width, frames }
    : { width, height, frames };
}

function getScale(
  dimensions: ImageDimensions,
  policy: ImageResizePolicy,
): number {
  const longEdge = Math.max(dimensions.width, dimensions.height);
  const shortEdge = Math.min(dimensions.width, dimensions.height);
  const scales = [
    1,
    policy.maxLongEdge === undefined ? 1 : policy.maxLongEdge / longEdge,
    policy.maxShortEdge === undefined ? 1 : policy.maxShortEdge / shortEdge,
    policy.maxPixels === undefined
      ? 1
      : Math.sqrt(
          policy.maxPixels /
            (dimensions.width * dimensions.height * dimensions.frames),
        ),
  ];
  return Math.min(...scales);
}

const MIME_ENCODERS: ReadonlyMap<string, (pipeline: Sharp) => Sharp> = new Map([
  ['image/jpeg', (pipeline) => pipeline.jpeg()],
  ['image/png', (pipeline) => pipeline.png()],
  ['image/gif', (pipeline) => pipeline.gif()],
  ['image/webp', (pipeline) => pipeline.webp()],
]);

function encodeSourceFormat(pipeline: Sharp, mimeType: string): Sharp {
  const encode = MIME_ENCODERS.get(mimeType);
  if (encode === undefined) {
    throw new Error(`resizing does not support ${mimeType} output`);
  }
  return encode(pipeline);
}

function isWithinLimit(value: number, limit: number | undefined): boolean {
  return limit === undefined || value <= limit;
}

function satisfiesPolicy(
  dimensions: ImageDimensions,
  policy: ImageResizePolicy,
): boolean {
  const longEdge = Math.max(dimensions.width, dimensions.height);
  const shortEdge = Math.min(dimensions.width, dimensions.height);
  const pixels = dimensions.width * dimensions.height * dimensions.frames;
  return (
    isWithinLimit(longEdge, policy.maxLongEdge) &&
    isWithinLimit(shortEdge, policy.maxShortEdge) &&
    isWithinLimit(pixels, policy.maxPixels)
  );
}

function hasLimits(
  policy: ImageResizePolicy | undefined,
): policy is ImageResizePolicy {
  return (
    policy !== undefined &&
    (policy.maxLongEdge !== undefined ||
      policy.maxShortEdge !== undefined ||
      policy.maxPixels !== undefined)
  );
}

function readPositiveInteger(
  settings: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = settings[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Invalid image resize settings: ${key} must be a positive integer`,
    );
  }
  return value;
}

export function resolveImageResizePolicy(
  settings: Readonly<Record<string, unknown>>,
  skipImageResize = false,
): ImageResizePolicy | undefined {
  if (skipImageResize) {
    return undefined;
  }
  const enabled = settings['image-resize.enabled'];
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new Error(
      'Invalid image resize settings: image-resize.enabled must be a boolean',
    );
  }
  if (enabled === false) {
    return undefined;
  }
  const policy: ImageResizePolicy = {
    maxLongEdge: readPositiveInteger(settings, 'image-resize.maxLongEdge'),
    maxShortEdge: readPositiveInteger(settings, 'image-resize.maxShortEdge'),
    maxPixels: readPositiveInteger(settings, 'image-resize.maxPixels'),
  };
  if (!hasLimits(policy)) {
    if (enabled === true) {
      throw new Error(
        'Invalid image resize settings: enabled resizing requires at least one limit',
      );
    }
    return undefined;
  }
  return policy;
}

export async function resizeImageIfNeeded(
  content: Buffer,
  mimeType: string,
  displayName: string,
  policy?: ImageResizePolicy,
): Promise<Buffer> {
  if (!hasLimits(policy)) {
    return content;
  }

  try {
    const metadata = await sharp(content, {
      animated: true,
      failOn: 'warning',
    }).metadata();
    const sourceFormat = MIME_FORMATS.get(mimeType);
    if (sourceFormat === undefined) {
      throw new Error(`resizing does not support ${mimeType} source`);
    }
    if (metadata.format !== sourceFormat) {
      throw new Error(
        `declared ${mimeType} does not match decoded ${metadata.format} container`,
      );
    }
    const dimensions = getDimensions(metadata);
    const scale = getScale(dimensions, policy);
    if (scale >= 1) {
      return content;
    }

    const targetWidth = Math.max(1, Math.floor(dimensions.width * scale));
    const targetHeight = Math.max(1, Math.floor(dimensions.height * scale));
    const pipeline = sharp(content, { animated: true, failOn: 'warning' })
      .rotate()
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: 'inside',
        withoutEnlargement: true,
      });
    const resized = await encodeSourceFormat(pipeline, mimeType).toBuffer();
    const resizedMetadata = await sharp(resized, { animated: true }).metadata();
    const resizedDimensions = getDimensions(resizedMetadata);

    if (resizedMetadata.format !== sourceFormat) {
      throw new Error(`output container changed from ${mimeType}`);
    }
    if (!satisfiesPolicy(resizedDimensions, policy)) {
      throw new Error('output dimensions exceed the configured limits');
    }
    if ((metadata.pages ?? 1) !== (resizedMetadata.pages ?? 1)) {
      throw new Error('output animation frame count changed');
    }
    return resized;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ImageResizeError(displayName, reason);
  }
}
