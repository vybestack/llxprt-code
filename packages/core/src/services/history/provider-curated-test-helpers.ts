/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
export function providerFixtureRow(index: number, bytes = 2048): IContent {
  const base = suffixRow(index, bytes);
  const id = `tool-${Math.floor(index / 8)}`;
  const metadata = { ...base.metadata, cacheAnchor: index % 8 === 2 };
  switch (index % 8) {
    case 0:
      return { ...base, metadata };
    case 1:
      return { ...base, speaker: 'ai', blocks: [] };
    case 2:
      return {
        speaker: 'ai',
        metadata,
        blocks: [
          { type: 'tool_call', id, name: 'inspect', parameters: { index } },
        ],
      };
    case 3:
      return {
        ...base,
        speaker: 'ai',
        blocks: [{ type: 'thinking', thought: 'reason', signature: 'signed' }],
      };
    case 4:
    case 6:
      return {
        speaker: 'tool',
        metadata,
        blocks: [
          {
            type: 'tool_response',
            callId: id,
            toolName: 'inspect',
            result: { index, value: 'r'.repeat(bytes) },
            isComplete: index % 8 === 6,
          },
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: 'aGVsbG8=',
            caption: `image-${index}`,
          },
        ],
      };
    case 5:
      return {
        speaker: 'tool',
        metadata,
        blocks: [
          {
            type: 'tool_call',
            id: `split-${Math.floor(index / 8)}`,
            name: 'split',
            parameters: {},
          },
          {
            type: 'tool_response',
            callId: `split-${Math.floor(index / 8)}`,
            toolName: 'split',
            result: null,
            error: 'failed',
          },
        ],
      };
    default:
      return {
        speaker: 'tool',
        metadata,
        blocks: [
          {
            type: 'tool_response',
            callId: `orphan-${Math.floor(index / 8)}`,
            toolName: 'lost',
            result: index,
          },
        ],
      };
  }
}

export function providerFarFixtureRow(index: number, bytes = 2048): IContent {
  const row = providerFixtureRow(index, bytes);
  if (index !== 0) return row;
  return {
    ...row,
    speaker: 'ai',
    blocks: [
      ...row.blocks,
      {
        type: 'tool_call',
        id: 'far-call',
        name: 'inspect',
        parameters: { far: true },
      },
    ],
  };
}

export function providerPendingFixture(): IContent[] {
  return [
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'far-call',
          toolName: 'inspect',
          result: { far: 'answered after all history segments' },
          isComplete: true,
        },
      ],
      metadata: { cacheAnchor: true },
    },
    { speaker: 'human', blocks: [{ type: 'text', text: 'pending' }] },
  ];
}
