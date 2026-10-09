/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent, ProviderFileReferenceMetadata } from './IContent.js';
import {
  batchRow,
  type BatchOwnerCensus,
} from './addbatch-stream-test-helpers.js';
import {
  probeTransformRow,
  type TransformProbes,
} from './transform-value-test-helpers.js';

export const TRANSFORM_CONTENT_ID = `sha256:${'a'.repeat(64)}`;
export const TRANSFORM_FILE: ProviderFileReferenceMetadata = {
  provider: 'kimi',
  baseURL: 'https://api.moonshot.ai/v1',
  credentialHash: 'transform-credential',
  fileId: 'remove-this-file',
  byteLength: 5,
  scope: 'session',
  scopeId: 'transform-session',
  createdAt: 1_000,
  expiresAt: 61_000,
  deletion: 'delete',
  zeroDataRetention: 'incompatible-while-retained',
  deletionState: 'active',
};

export function transformFixtureRow(
  index: number,
  bound = true,
  bytes = 2048,
): IContent {
  const original = batchRow(index, bytes);
  const object = {
    contentId: TRANSFORM_CONTENT_ID,
    mimeType: 'application/pdf',
    byteLength: 5,
    normalizedBase64Length: 8,
  };
  return {
    ...original,
    blocks: [
      ...original.blocks.filter((block) => block.type !== 'media'),
      {
        type: 'media',
        encoding: 'reference',
        ...object,
        originalContentId: TRANSFORM_CONTENT_ID,
        selectedContentId: TRANSFORM_CONTENT_ID,
        originalObject: object,
        selectedObject: object,
        transformation: {
          policyId: 'identity',
          policyVersion: 1,
          parameters: {},
        },
        semanticMetadata: { caption: `media-${index}` },
        providerFiles: bound
          ? [
              TRANSFORM_FILE,
              {
                ...TRANSFORM_FILE,
                provider: 'other',
                fileId: 'keep-this-file',
              },
            ]
          : [
              {
                ...TRANSFORM_FILE,
                provider: 'other',
                fileId: 'keep-this-file',
              },
            ],
      },
    ],
  };
}

export async function* transformFixtureRows(
  size: number,
  bound = true,
  bytes = 2048,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++)
    yield transformFixtureRow(index, bound, bytes);
}

export async function* probedTransformInput(
  size: number,
  makeRow: (index: number) => IContent,
  owners: BatchOwnerCensus,
  probes: TransformProbes,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) {
    const row = makeRow(index);
    const marker = row.metadata?.chronology;
    if (marker === undefined) throw new Error('Missing input marker');
    owners.registerInput([row]);
    probeTransformRow(row, probes);
    owners.retain(row);
    owners.retain(marker);
    try {
      yield row;
    } finally {
      owners.release(marker);
      owners.release(row);
    }
  }
}
