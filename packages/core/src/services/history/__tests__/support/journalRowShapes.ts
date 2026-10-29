/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent, MediaReferenceBlock } from '../../IContent.js';

const CONTENT_ID = `sha256:${'a'.repeat(64)}`;

/** A reference to local media as recording keeps it: identity and metrics, never the bytes. */
export const MEDIA_REFERENCE: MediaReferenceBlock = {
  type: 'media',
  encoding: 'reference',
  mimeType: 'image/png',
  contentId: CONTENT_ID,
  originalContentId: CONTENT_ID,
  selectedContentId: CONTENT_ID,
  originalObject: {
    contentId: CONTENT_ID,
    mimeType: 'image/png',
    byteLength: 3,
    normalizedBase64Length: 4,
  },
  selectedObject: {
    contentId: CONTENT_ID,
    mimeType: 'image/png',
    byteLength: 3,
    normalizedBase64Length: 4,
  },
  transformation: {
    policyId: 'identity',
    policyVersion: 1,
    parameters: { quality: 90, nested: [1, 'two', null] },
  },
  byteLength: 3,
  normalizedBase64Length: 4,
  semanticMetadata: { source: 'clipboard' },
  caption: 'a caption',
};

export const CHRONOLOGY = { seq: 7, userTurn: 2, step: 3, recordedAt: 1.9e12 };

/** Every shape of `IContent` the history carries, one entry for each kind of block and field. */
export const ROW_SHAPES: ReadonlyArray<readonly [string, IContent]> = [
  [
    'plain user text',
    { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
  ],
  [
    'text with unicode and a block-level providerMetadata',
    {
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: 'héllo \u{1F600} \u2028 "quoted" \\ back',
          providerMetadata: { gemini: { safetyRating: 'low' } },
        },
      ],
    },
  ],
  [
    'tool call with nested parameters',
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'call-1',
          name: 'search',
          parameters: { q: 'x', deep: { list: [1, 2, { a: null }] } },
          description: 'looks things up',
          providerMetadata: { gemini: { toolCallId: 'abc' } },
        },
      ],
    },
  ],
  [
    'tool call with parameters left out',
    {
      speaker: 'ai',
      blocks: [{ type: 'tool_call', id: 'c', name: 'noargs', parameters: {} }],
    },
  ],
  [
    'tool response with error and completion flag',
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-1',
          toolName: 'search',
          result: { out: ['a', 'b'] },
          error: 'boom',
          isComplete: true,
          providerMetadata: { openai: { toolResultId: 'xyz' } },
        },
      ],
    },
  ],
  [
    'inline base64 media with provider files',
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'application/pdf',
          data: 'JVBERi0=',
          filename: 'a.pdf',
          dimensions: { width: 2, height: 3 },
          providerFileIds: { gemini: 'files/1' },
        },
      ],
    },
  ],
  [
    'url media',
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          encoding: 'url',
          mimeType: 'image/jpeg',
          data: 'https://example.invalid/a.jpg',
        },
      ],
    },
  ],
  ['media reference', { speaker: 'human', blocks: [MEDIA_REFERENCE] }],
  [
    'thinking block with every field',
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'reasoning',
          isHidden: true,
          sourceField: 'thinking',
          signature: 'sig-abc',
          streamId: 's1',
          streamStatus: 'complete',
          encryptedContent: 'ZW5j',
          providerMetadata: { anthropic: { thinkingSignature: 'sig' } },
        },
      ],
    },
  ],
  [
    'code block',
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'code',
          code: 'print(1)',
          language: 'python',
          providerMetadata: { gemini: { executable: true } },
        },
      ],
    },
  ],
  ['no blocks', { speaker: 'ai', blocks: [] }],
  [
    'mixed blocks in order',
    {
      speaker: 'ai',
      blocks: [
        { type: 'thinking', thought: 't' },
        { type: 'text', text: 'a' },
        { type: 'tool_call', id: 'x', name: 'n', parameters: { k: 1 } },
        { type: 'text', text: 'b' },
        { type: 'tool_call', id: 'y', name: 'm', parameters: {} },
      ],
    },
  ],
  [
    'full metadata with chronology and usage',
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'answer' }],
      metadata: {
        timestamp: 1_900_000_000_001,
        model: 'm-1',
        providerBaseURL: 'https://api.example.invalid/v1/',
        usage: {
          promptTokens: 1,
          completionTokens: 2,
          totalTokens: 3,
          cachedTokens: 4,
          reasoningTokens: 5,
          toolTokens: 6,
          cache_read_input_tokens: 7,
        },
        id: 'resp_1',
        responsesStored: true,
        provider: 'openai',
        isSummary: true,
        providerMetadata: { any: { thing: [1, 2] } },
        synthetic: true,
        reason: 'orphaned_tool_call',
        turnId: 'turn-1',
        promptId: 'prompt-1',
        finishReason: 'stop',
        rawStopReason: 'end_turn',
        incompleteReason: 'max_output_tokens',
        chronology: CHRONOLOGY,
        chronologyReplaced: { fromSeq: 1, toSeq: 6, itemCount: 6 },
        cacheAnchor: true,
        semanticMediaPurgeFrontier: {
          contentIndex: 1,
          blockIndex: 2,
          contentId: 'c',
          mediaId: 'm',
        },
      },
    },
  ],
  [
    'chronology seq 0',
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'first' }],
      metadata: { chronology: { seq: 0, userTurn: 0, step: 0, recordedAt: 0 } },
    },
  ],
  [
    'empty metadata object',
    { speaker: 'human', blocks: [{ type: 'text', text: 'x' }], metadata: {} },
  ],
];
