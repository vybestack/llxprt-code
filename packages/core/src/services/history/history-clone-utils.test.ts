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
import { DebugLogger } from '../../debug/index.js';
import type { IContent, MediaBlock, MediaReferenceBlock } from './IContent.js';
import { sanitizeProviderHistoryForSerialization } from './historyCloneUtils.js';
import { buildProviderContent } from './historyProviderPipeline.js';
import { HistoryService } from './HistoryService.js';

const ORIGINAL_CONTENT_ID =
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const SELECTED_CONTENT_ID =
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
const logger = new DebugLogger('llxprt:history:media-clone-test');

function cloneSingleMedia(block: MediaBlock): MediaBlock {
  const cloned = sanitizeProviderHistoryForSerialization([
    { speaker: 'human', blocks: [block] },
  ]);
  const clonedBlock = cloned[0].blocks[0];
  if (clonedBlock.type !== 'media') {
    throw new Error('Expected cloned media block');
  }
  return clonedBlock;
}

describe('media-aware history cloning', () => {
  it('clones inline media metadata without JSON-round-tripping the media block', () => {
    const observedAt = new Date('2026-08-22T00:00:00.000Z');
    const providerMetadata = {
      openai: { fileId: 'file_original', observedAt },
    };
    const source: MediaBlock = {
      type: 'media',
      encoding: 'base64',
      mimeType: 'image/png',
      data: 'aGVsbG8=',
      caption: 'before',
      filename: 'before.png',
      providerMetadata,
    };

    const cloned = cloneSingleMedia(source);
    cloned.caption = 'after';
    cloned.filename = 'after.png';
    const clonedOpenAi = cloned.providerMetadata?.['openai'];
    if (typeof clonedOpenAi !== 'object' || clonedOpenAi === null) {
      throw new Error('Expected cloned provider metadata');
    }
    Reflect.set(clonedOpenAi, 'fileId', 'file_clone');
    const clonedObservedAt = Reflect.get(clonedOpenAi, 'observedAt');

    expect(source.caption).toBe('before');
    expect(source.filename).toBe('before.png');
    expect(providerMetadata.openai.fileId).toBe('file_original');
    expect(clonedObservedAt).toBeInstanceOf(Date);
    expect(clonedObservedAt).not.toBe(observedAt);
    expect(cloned.data).toBe(source.data);
  });

  it('isolates mutable reference metadata while sharing immutable reference metadata', () => {
    const dimensions = Object.freeze({ width: 1280, height: 720 });
    const semanticMetadata = Object.freeze({ purpose: 'screenshot' });
    const providerFileIds = Object.freeze({ anthropic: 'file_original' });
    const providerMetadata = { openai: { detail: 'high' } };
    const source: MediaReferenceBlock = {
      type: 'media',
      encoding: 'reference',
      mimeType: 'image/png',
      contentId: SELECTED_CONTENT_ID,
      originalContentId: ORIGINAL_CONTENT_ID,
      selectedContentId: SELECTED_CONTENT_ID,
      originalObject: Object.freeze({
        contentId: ORIGINAL_CONTENT_ID,
        mimeType: 'image/png',
        byteLength: 6,
        normalizedBase64Length: 8,
        dimensions,
      }),
      selectedObject: Object.freeze({
        contentId: SELECTED_CONTENT_ID,
        mimeType: 'image/png',
        byteLength: 6,
        normalizedBase64Length: 8,
        dimensions,
      }),
      transformation: Object.freeze({
        policyId: 'identity',
        policyVersion: 1,
        parameters: Object.freeze({}),
      }),
      byteLength: 6,
      normalizedBase64Length: 8,
      dimensions,
      semanticMetadata,
      providerFileIds,
      caption: 'before',
      filename: 'before.png',
      providerMetadata,
    };
    const sourceContent: IContent = { speaker: 'human', blocks: [source] };

    const clonedContents = buildProviderContent([sourceContent], [], logger);
    const cloned = clonedContents[0].blocks[0];
    if (cloned.type !== 'media' || cloned.encoding !== 'reference') {
      throw new Error('Expected cloned media reference');
    }
    cloned.caption = 'after';
    cloned.filename = 'after.png';
    const clonedOpenAi = cloned.providerMetadata?.['openai'];
    if (typeof clonedOpenAi !== 'object' || clonedOpenAi === null) {
      throw new Error('Expected cloned provider metadata');
    }
    Reflect.set(clonedOpenAi, 'detail', 'low');
    clonedContents[0]?.blocks.push({ type: 'text', text: 'clone only' });

    expect(source.caption).toBe('before');
    expect(source.filename).toBe('before.png');
    expect(providerMetadata.openai.detail).toBe('high');
    expect(sourceContent.blocks).toHaveLength(1);
    expect(cloned).not.toBe(source);
    expect(cloned.dimensions).toBe(dimensions);
    expect(cloned.semanticMetadata).toBe(semanticMetadata);
    expect(cloned.providerFileIds).toBe(providerFileIds);
  });

  it('preserves optional tool_call description and providerMetadata while sanitizing circular values', () => {
    interface CircularValue {
      label: string;
      self?: CircularValue;
    }
    const parameters: CircularValue = { label: 'call' };
    parameters.self = parameters;
    const result: CircularValue = { label: 'response' };
    result.self = result;
    const callMetadata = { detail: 'high', nested: { flag: true } };
    const responseMetadata = { raw: new Date('2026-08-22T00:00:00.000Z') };
    const source: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_1',
            name: 'inspect',
            description: 'Inspect the target',
            providerMetadata: callMetadata,
            parameters,
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_1',
            toolName: 'inspect',
            providerMetadata: responseMetadata,
            result,
            error: 'partial failure',
            isComplete: false,
          },
        ],
      },
    ];

    const cloned = sanitizeProviderHistoryForSerialization(source);
    const clonedCall = cloned[0].blocks[0];
    const clonedResponse = cloned[1].blocks[0];
    if (
      clonedCall.type !== 'tool_call' ||
      clonedResponse.type !== 'tool_response'
    ) {
      throw new Error('Expected cloned tool call and response blocks');
    }

    expect(clonedCall).toMatchObject({
      type: 'tool_call',
      id: 'call_1',
      name: 'inspect',
      description: 'Inspect the target',
      parameters: { label: 'call', self: { _circular: true } },
    });
    expect(clonedResponse).toMatchObject({
      type: 'tool_response',
      callId: 'call_1',
      toolName: 'inspect',
      result: { label: 'response', self: { _circular: true } },
      error: 'partial failure',
      isComplete: false,
    });
    expect(clonedCall.providerMetadata).toEqual({
      detail: 'high',
      nested: { flag: true },
    });
    expect(clonedResponse.providerMetadata?.['raw']).toBeInstanceOf(Date);
    if (clonedCall.providerMetadata === undefined) {
      throw new Error('Expected cloned tool call provider metadata');
    }
    Reflect.set(clonedCall.providerMetadata, 'detail', 'low');
    expect(callMetadata.detail).toBe('high');
  });

  it('keeps circular sanitization for tool calls and tool responses', () => {
    interface CircularValue {
      label: string;
      self?: CircularValue;
    }
    const parameters: CircularValue = { label: 'call' };
    parameters.self = parameters;
    const result: CircularValue = { label: 'response' };
    result.self = result;
    const source: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_1',
            name: 'inspect',
            parameters,
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_1',
            toolName: 'inspect',
            result,
          },
        ],
      },
    ];

    const cloned = buildProviderContent(source, [], logger);
    const clonedCall = cloned[0].blocks[0];
    const clonedResponse = cloned[1].blocks[0];
    if (
      clonedCall.type !== 'tool_call' ||
      clonedResponse.type !== 'tool_response'
    ) {
      throw new Error('Expected tool call and response blocks');
    }

    expect(clonedCall.parameters).toStrictEqual({
      label: 'call',
      self: { _circular: true },
    });
    expect(clonedResponse.result).toStrictEqual({
      label: 'response',
      self: { _circular: true },
    });
    expect(parameters.self).toBe(parameters);
    expect(result.self).toBe(result);
  });

  it('clones HistoryService media without serializing immutable payloads', () => {
    const observedAt = new Date('2026-08-22T00:00:00.000Z');
    const history = new HistoryService();
    history.add({
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'aGVsbG8=',
          providerMetadata: { observedAt },
        },
      ],
    });

    const cloned = history.clone();
    const clonedBlock = cloned[0].blocks[0];
    if (clonedBlock.type !== 'media') {
      throw new Error('Expected cloned media block');
    }

    expect(clonedBlock.data).toBe('aGVsbG8=');
    expect(clonedBlock.providerMetadata?.['observedAt']).toBeInstanceOf(Date);
    expect(clonedBlock.providerMetadata?.['observedAt']).not.toBe(observedAt);
  });
});
