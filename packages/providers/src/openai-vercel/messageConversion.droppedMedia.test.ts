/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type {
  IContent,
  MediaDroppedBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { droppedMediaModelText } from '@vybestack/llxprt-code-core/services/history/droppedMediaText.js';
import { convertToVercelMessages } from './messageConversion.js';

const SHOT_PATH = '/workspace/screens/dropped-shot.png';
const fileDropped: MediaDroppedBlock = {
  type: 'media_dropped',
  origin: {
    kind: 'file',
    path: SHOT_PATH,
    readAt: '2026-11-19T10:00:00.000Z',
  },
  mimeType: 'image/png',
  byteLength: 70 * 1024,
  contentId: `sha256:${'a'.repeat(64)}`,
  droppedAt: '2026-11-19T11:00:00.000Z',
};
const pastedDropped: MediaDroppedBlock = {
  ...fileDropped,
  origin: { kind: 'pasted', readAt: '2026-11-19T10:00:00.000Z' },
  mimeType: 'image/jpeg',
};

const rows: IContent[] = [
  {
    speaker: 'ai',
    blocks: [
      { type: 'tool_call', id: 'call_read', name: 'read_file', parameters: {} },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_read',
        toolName: 'read_file',
        result: 'Read image file',
      },
      fileDropped,
    ],
  },
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'and this one?' }, pastedDropped],
  },
];

describe('Vercel conversion of dropped images', () => {
  it('puts each reference where the image was and sends no image part', () => {
    const messages = convertToVercelMessages(rows);
    expect(messages[1]).toStrictEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_read',
          toolName: 'read_file',
          output: {
            type: 'text',
            value: `Read image file\n${droppedMediaModelText(fileDropped)}`,
          },
        },
      ],
    });
    expect(messages[2]).toStrictEqual({
      role: 'user',
      content: `and this one?\n${droppedMediaModelText(pastedDropped)}`,
    });
    expect(JSON.stringify(messages)).toContain(`read ${SHOT_PATH} again`);
    expect(JSON.stringify(messages)).not.toContain('"image"');
  });
});
