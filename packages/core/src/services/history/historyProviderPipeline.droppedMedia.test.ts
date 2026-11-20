/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '../../debug/index.js';
import type { IContent, MediaDroppedBlock } from './IContent.js';
import { buildProviderContent } from './historyProviderPipeline.js';

const logger = new DebugLogger('provider-pipeline-dropped-media');
const dropped: MediaDroppedBlock = {
  type: 'media_dropped',
  origin: {
    kind: 'file',
    path: '/workspace/shot.png',
    readAt: '2026-11-19T10:00:00.000Z',
  },
  mimeType: 'image/png',
  byteLength: 4096,
  contentId: `sha256:${'d'.repeat(64)}`,
  droppedAt: '2026-11-19T11:00:00.000Z',
};
const call: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'tool_call', id: 'call_x', name: 'read', parameters: {} }],
};
const response = {
  type: 'tool_response',
  callId: 'call_x',
  toolName: 'read',
  result: 'result',
} satisfies IContent['blocks'][number];

describe('provider normalization of dropped images', () => {
  it('keeps a dropped image with its tool response when the response is relocated', () => {
    const rows: IContent[] = [
      call,
      { speaker: 'tool', blocks: [dropped, response] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] },
    ];

    const normalized = buildProviderContent(structuredClone(rows), [], logger);

    expect(normalized[1].speaker).toBe('tool');
    expect(normalized[1].blocks).toStrictEqual([response, dropped]);
  });

  it('moves a dropped image out of a human row with the response it rides with', () => {
    const rows: IContent[] = [
      call,
      {
        speaker: 'human',
        blocks: [dropped, response, { type: 'text', text: 'survivor' }],
      },
    ];

    const normalized = buildProviderContent(structuredClone(rows), [], logger);

    expect(normalized.map((row) => row.blocks)).toStrictEqual([
      call.blocks,
      [response, dropped],
      [{ type: 'text', text: 'survivor' }],
    ]);
  });
});
