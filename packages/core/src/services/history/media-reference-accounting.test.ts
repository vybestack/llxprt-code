/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '../../debug/index.js';
import type { RuntimeTokenizer } from '../../runtime/contracts/RuntimeTokenizer.js';
import { estimateBlockBytes } from './contentSize.js';
import {
  estimateContentTokens,
  type TokenizerProvider,
} from './historyTokenEstimation.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';

const CONTENT_ID =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function referenceBlock(
  normalizedBase64Length: number,
  dimensions: { readonly width: number; readonly height: number } = {
    width: 1024,
    height: 1024,
  },
): MediaReferenceBlock {
  const byteLength = Math.floor((normalizedBase64Length * 3) / 4);
  const object = {
    contentId: CONTENT_ID,
    mimeType: 'image/png',
    byteLength,
    normalizedBase64Length,
    dimensions,
  };
  return {
    type: 'media',
    encoding: 'reference',
    mimeType: 'image/png',
    contentId: CONTENT_ID,
    originalContentId: CONTENT_ID,
    selectedContentId: CONTENT_ID,
    originalObject: object,
    selectedObject: object,
    transformation: {
      policyId: 'identity',
      policyVersion: 1,
      parameters: {},
    },
    byteLength,
    normalizedBase64Length,
    dimensions,
    semanticMetadata: { detail: 'high' },
  };
}

function tokenizerProvider(provider: string): TokenizerProvider {
  const tokenizer: RuntimeTokenizer = {
    fallbackPolicy: 'deny',
    countTokens: () => Promise.resolve(0),
  };
  return {
    activeProvider: provider,
    getTokenizerForModel: () => tokenizer,
  };
}

describe('media reference metadata accounting', () => {
  it('uses normalized encoded length without materialized media bytes', () => {
    const smaller = estimateBlockBytes(referenceBlock(4_000));
    const larger = estimateBlockBytes(referenceBlock(12_000));

    expect(larger - smaller).toBe(8_000);
  });

  it('preserves inline base64 payload accounting', () => {
    const smaller = estimateBlockBytes({
      type: 'media',
      encoding: 'base64',
      mimeType: 'image/png',
      data: 'A'.repeat(4_000),
    });
    const larger = estimateBlockBytes({
      type: 'media',
      encoding: 'base64',
      mimeType: 'image/png',
      data: 'A'.repeat(12_000),
    });

    expect(larger - smaller).toBe(8_000);
  });

  it('preserves URL payload accounting', () => {
    const short = estimateBlockBytes({
      type: 'media',
      encoding: 'url',
      mimeType: 'image/png',
      data: 'https://example.test/a',
    });
    const long = estimateBlockBytes({
      type: 'media',
      encoding: 'url',
      mimeType: 'image/png',
      data: `https://example.test/${'a'.repeat(1_000)}`,
    });

    expect(long).toBeGreaterThan(short);
  });

  it('accounts persisted provider Files lifecycle metadata', () => {
    const reference = referenceBlock(4_000);
    const withProviderFile: MediaReferenceBlock = {
      ...reference,
      providerFiles: [
        {
          provider: 'kimi',
          baseURL: 'https://api.moonshot.ai/v1',
          credentialHash: 'credential-a',
          fileId: 'file-stable',
          byteLength: 3_000,
          scope: 'session',
          scopeId: 'session-a',
          createdAt: 1_000,
          expiresAt: 61_000,
          deletion: 'delete',
          zeroDataRetention: 'incompatible-while-retained',
          deletionState: 'active',
        },
      ],
    };

    expect(estimateBlockBytes(withProviderFile)).toBeGreaterThan(
      estimateBlockBytes(reference),
    );
  });

  it('accounts retained stored-object and transformation metadata', () => {
    const reference = referenceBlock(4_000);
    const richer: MediaReferenceBlock = {
      ...reference,
      originalObject: {
        ...reference.originalObject,
        mimeType: `image/${'x'.repeat(200)}`,
      },
      transformation: {
        ...reference.transformation,
        parameters: { migrationLabel: 'x'.repeat(400) },
      },
    };

    expect(estimateBlockBytes(richer)).toBeGreaterThan(
      estimateBlockBytes(reference) + 500,
    );
  });

  it('uses stored dimensions for image token estimation without media reads', async () => {
    const content: IContent = {
      speaker: 'human',
      blocks: [referenceBlock(1_400_000, { width: 1024, height: 1024 })],
    };

    const tokens = await estimateContentTokens(
      content,
      'gpt-4o',
      tokenizerProvider('openai'),
      new DebugLogger('llxprt:history:reference-accounting-test'),
    );

    expect(tokens).toBe(765);
  });
});
