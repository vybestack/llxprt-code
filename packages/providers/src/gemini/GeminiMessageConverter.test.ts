/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { convertHistoryToGeminiFormat } from './GeminiMessageConverter.js';

describe('GeminiMessageConverter', () => {
  it('should normalize Gemini 3 tool-response media through shared media conversion', () => {
    const contents: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-1',
            toolName: 'screenshot',
            result: { output: 'done' },
          },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: 'data:image/png;base64,iVBORw0KGgo=',
          },
          {
            type: 'media',
            mimeType: 'image/jpeg',
            encoding: 'url',
            data: 'https://example.com/photo.jpg',
          },
        ],
      },
    ];

    const converted = convertHistoryToGeminiFormat(
      contents,
      'gemini-3-flash-preview',
    );

    const parts = converted[0].parts[0].functionResponse?.parts;
    expect(parts).toStrictEqual([
      { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } },
      {
        fileData: {
          mimeType: 'image/jpeg',
          fileUri: 'https://example.com/photo.jpg',
        },
      },
    ]);
  });

  it('should normalize Gemini 2 tool-response media through shared media conversion', () => {
    const contents: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-1',
            toolName: 'screenshot',
            result: { output: 'done' },
          },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: 'data:image/png;base64,iVBORw0KGgo=',
          },
          {
            type: 'media',
            mimeType: 'image/jpeg',
            encoding: 'url',
            data: 'https://example.com/photo.jpg',
          },
        ],
      },
    ];

    const converted = convertHistoryToGeminiFormat(
      contents,
      'gemini-2.5-flash',
    );

    expect(converted[0].parts.slice(1)).toStrictEqual([
      { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } },
      {
        fileData: {
          mimeType: 'image/jpeg',
          fileUri: 'https://example.com/photo.jpg',
        },
      },
    ]);
  });
  it('rejects unresolved media references at the public neutral conversion boundary', () => {
    const contentId =
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const reference: MediaReferenceBlock = {
      type: 'media',
      mimeType: 'image/png',
      encoding: 'reference',
      contentId,
      originalContentId: contentId,
      selectedContentId: contentId,
      originalObject: {
        contentId,
        mimeType: 'image/png',
        byteLength: 3,
        normalizedBase64Length: 4,
      },
      selectedObject: {
        contentId,
        mimeType: 'image/png',
        byteLength: 3,
        normalizedBase64Length: 4,
      },
      transformation: {
        policyId: 'identity',
        policyVersion: 1,
        parameters: {},
      },
      byteLength: 3,
      normalizedBase64Length: 4,
      semanticMetadata: {},
    };

    expect(() =>
      convertHistoryToGeminiFormat(
        [{ speaker: 'human', blocks: [reference] }],
        'gemini-2.5-flash',
      ),
    ).toThrow(`Unresolved media reference ${contentId}`);
  });
});
