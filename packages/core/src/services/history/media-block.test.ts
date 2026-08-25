/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from 'bun:test';
import {
  ContentValidation,
  isInlineMediaBlock,
  isMediaReferenceBlock,
  requireInlineMediaBlock,
  type IContent,
  type MediaBlock,
  type MediaReferenceBlock,
  type ProviderFileReferenceMetadata,
} from './IContent.js';

const ORIGINAL_CONTENT_ID =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SELECTED_CONTENT_ID =
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function referenceBlock(): MediaReferenceBlock {
  return {
    type: 'media',
    encoding: 'reference',
    mimeType: 'image/png',
    contentId: SELECTED_CONTENT_ID,
    originalContentId: ORIGINAL_CONTENT_ID,
    selectedContentId: SELECTED_CONTENT_ID,
    originalObject: {
      contentId: ORIGINAL_CONTENT_ID,
      mimeType: 'image/png',
      byteLength: 6,
      normalizedBase64Length: 8,
      dimensions: { width: 40, height: 20 },
    },
    selectedObject: {
      contentId: SELECTED_CONTENT_ID,
      mimeType: 'image/png',
      byteLength: 5,
      normalizedBase64Length: 8,
      dimensions: { width: 20, height: 10 },
    },
    transformation: {
      policyId: 'image-resize',
      policyVersion: 1,
      parameters: { maxLongEdge: 20 },
    },
    byteLength: 5,
    normalizedBase64Length: 8,
    dimensions: { width: 20, height: 10 },
    semanticMetadata: { purpose: 'screenshot' },
    providerFileIds: { anthropic: 'file_123' },
    caption: 'terminal screenshot',
    filename: 'terminal.png',
  };
}

function contentWith(block: MediaBlock): IContent {
  return { speaker: 'ai', blocks: [block] };
}

function parseContent(serialized: string): IContent {
  return JSON.parse(serialized);
}

describe('MediaBlock', () => {
  it('accepts existing inline base64 and URL object literals', () => {
    const base64: MediaBlock = {
      type: 'media',
      encoding: 'base64',
      mimeType: 'image/png',
      data: 'aGVsbG8=',
    };
    const url: MediaBlock = {
      type: 'media',
      encoding: 'url',
      mimeType: 'image/png',
      data: 'https://example.com/image.png',
    };

    expect([
      isInlineMediaBlock(base64),
      isInlineMediaBlock(url),
      ContentValidation.hasContent(contentWith(base64)),
      ContentValidation.hasContent(contentWith(url)),
    ]).toStrictEqual([true, true, true, true]);
  });

  it('preserves legacy inline media with MIME parameters', () => {
    const legacy: MediaBlock = {
      type: 'media',
      encoding: 'base64',
      mimeType: 'image/png; charset=utf-8',
      data: 'aGVsbG8=',
    };

    expect(isInlineMediaBlock(legacy)).toBe(true);
    expect(ContentValidation.hasContent(contentWith(legacy))).toBe(true);
  });

  it('rejects malformed optional metadata on inline media', () => {
    const malformedDimensions = parseContent(
      JSON.stringify({
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: 'aGVsbG8=',
            dimensions: { width: 1.5, height: 10 },
          },
        ],
      }),
    );
    const malformedTransformation = parseContent(
      JSON.stringify({
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: 'aGVsbG8=',
            transformation: {
              policyId: 'legacy',
              policyVersion: 'one',
              parameters: {},
            },
          },
        ],
      }),
    );

    expect([
      ContentValidation.hasContent(malformedDimensions),
      ContentValidation.hasContent(malformedTransformation),
    ]).toEqual([false, false]);
  });

  it('recognizes a complete content reference without inline data or a source path', () => {
    const block = referenceBlock();

    expect(isMediaReferenceBlock(block)).toBe(true);
    expect(ContentValidation.hasContent(contentWith(block))).toBe(true);
    expect('data' in block).toBe(false);
    expect('sourcePath' in block).toBe(false);
    expect(JSON.stringify(block)).not.toContain('/Users/');
  });

  it('rejects an empty reference restored from malformed history', () => {
    const malformed = parseContent(
      JSON.stringify({
        speaker: 'ai',
        blocks: [
          {
            type: 'media',
            encoding: 'reference',
            mimeType: '',
            contentId: '',
            originalContentId: '',
            selectedContentId: '',
            byteLength: 0,
            normalizedBase64Length: 0,
            semanticMetadata: {},
          },
        ],
      }),
    );

    expect(ContentValidation.hasContent(malformed)).toBe(false);
    expect(isMediaReferenceBlock(malformed.blocks[0])).toBe(false);
  });

  it('rejects references whose encoded length cannot represent the exact raw byte length', () => {
    const malformed = parseContent(
      JSON.stringify({
        ...contentWith(referenceBlock()),
        blocks: [{ ...referenceBlock(), normalizedBase64Length: 7 }],
      }),
    );

    expect(ContentValidation.hasContent(malformed)).toBe(false);
  });

  it('rejects references containing inline data or an absolute source path', () => {
    const withData = parseContent(
      JSON.stringify({
        ...contentWith(referenceBlock()),
        blocks: [{ ...referenceBlock(), data: 'aGVsbG8=' }],
      }),
    );
    const withSourcePath = parseContent(
      JSON.stringify({
        ...contentWith(referenceBlock()),
        blocks: [{ ...referenceBlock(), sourcePath: '/tmp/terminal.png' }],
      }),
    );

    expect([
      ContentValidation.hasContent(withData),
      ContentValidation.hasContent(withSourcePath),
    ]).toStrictEqual([false, false]);
  });

  it('rejects incomplete dimensions and malformed provider file IDs', () => {
    const incompleteDimensions = parseContent(
      JSON.stringify({
        ...contentWith(referenceBlock()),
        blocks: [{ ...referenceBlock(), dimensions: { width: 20 } }],
      }),
    );
    const emptyProviderFileId = parseContent(
      JSON.stringify({
        ...contentWith(referenceBlock()),
        blocks: [{ ...referenceBlock(), providerFileIds: { anthropic: '' } }],
      }),
    );

    expect([
      ContentValidation.hasContent(incompleteDimensions),
      ContentValidation.hasContent(emptyProviderFileId),
    ]).toStrictEqual([false, false]);
  });

  it('validates persisted provider Files lifecycle metadata on media references', () => {
    const providerFile = {
      provider: 'kimi',
      baseURL: 'https://api.moonshot.ai/v1',
      credentialHash: 'credential-a',
      fileId: 'file-stable',
      byteLength: 5,
      scope: 'session',
      scopeId: 'session-a',
      createdAt: 1_000,
      expiresAt: 61_000,
      deletion: 'delete',
      zeroDataRetention: 'incompatible-while-retained',
      deletionState: 'active',
    } satisfies ProviderFileReferenceMetadata;
    const valid = parseContent(
      JSON.stringify({
        ...contentWith(referenceBlock()),
        blocks: [{ ...referenceBlock(), providerFiles: [providerFile] }],
      }),
    );
    const invalidIdentity = parseContent(
      JSON.stringify({
        ...contentWith(referenceBlock()),
        blocks: [
          {
            ...referenceBlock(),
            providerFiles: [{ ...providerFile, credentialHash: '' }],
          },
        ],
      }),
    );

    expect(ContentValidation.hasContent(valid)).toBe(true);
    expect(ContentValidation.hasContent(invalidIdentity)).toBe(false);
  });

  it('rejects top-level dimensions that disagree with the selected object', () => {
    const mismatched = {
      ...referenceBlock(),
      dimensions: { width: 10, height: 20 },
    };
    const omitted = { ...referenceBlock() };
    delete omitted.dimensions;

    expect([
      isMediaReferenceBlock(mismatched),
      isMediaReferenceBlock(omitted),
    ]).toStrictEqual([false, false]);
  });

  it('rejects conflicting metadata for identical original and selected objects', () => {
    const selected = referenceBlock().selectedObject;
    const malformed = {
      ...referenceBlock(),
      originalContentId: selected.contentId,
      originalObject: {
        ...selected,
        mimeType: 'image/webp',
      },
      transformation: {
        policyId: 'identity',
        policyVersion: 1,
        parameters: {},
      },
    };

    expect(isMediaReferenceBlock(malformed)).toBe(false);
  });

  it('rejects semantic metadata outside the immutable recording shape', () => {
    const withUndefined = {
      ...referenceBlock(),
      semanticMetadata: { nested: { unsupported: undefined } },
    };
    const withClassInstance = {
      ...referenceBlock(),
      semanticMetadata: { observedAt: new Date('2026-08-22T00:00:00.000Z') },
    };

    expect([
      isMediaReferenceBlock(withUndefined),
      isMediaReferenceBlock(withClassInstance),
    ]).toStrictEqual([false, false]);
  });

  it('rejects semantic metadata beyond the validation depth bound', () => {
    let semanticMetadata: Record<string, unknown> = { leaf: 'value' };
    for (let depth = 0; depth < 10_000; depth += 1) {
      semanticMetadata = { nested: semanticMetadata };
    }
    const deeplyNested = { ...referenceBlock(), semanticMetadata };

    expect(isMediaReferenceBlock(deeplyNested)).toBe(false);
  });

  it('fails fast when an unresolved reference reaches inline conversion', () => {
    const block = referenceBlock();

    expect(() => requireInlineMediaBlock(block)).toThrow(
      `Unresolved media reference ${SELECTED_CONTENT_ID}`,
    );
  });

  it('fails fast on malformed reference shapes at inline conversion', () => {
    const malformed = parseContent(
      JSON.stringify({
        speaker: 'human',
        blocks: [{ ...referenceBlock(), contentId: '' }],
      }),
    );
    const block = malformed.blocks[0];
    if (block.type !== 'media') {
      throw new Error('Expected malformed media block');
    }

    expect(() => requireInlineMediaBlock(block)).toThrow(
      'Malformed media reference',
    );
  });
});
