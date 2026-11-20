/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type {
  IContent,
  MediaDroppedBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { droppedMediaModelText } from '@vybestack/llxprt-code-core/services/history/droppedMediaText.js';
import { convertHistoryToGeminiFormat } from './GeminiMessageConverter.js';

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

describe('Gemini conversion of dropped images', () => {
  for (const model of ['gemini-2.5-pro', 'gemini-3-pro-preview']) {
    it(`${model}: the reference joins the tool result and the user turn, no inline data`, () => {
      const contents = convertHistoryToGeminiFormat(rows, model);
      expect(contents).toHaveLength(2);
      const response = contents[0].parts[0].functionResponse;
      expect(contents[0].parts).toHaveLength(1);
      expect(response?.parts).toBeUndefined();
      expect(response?.response?.['result']).toBe(
        `Read image file\n${droppedMediaModelText(fileDropped)}`,
      );
      expect(contents[1]).toStrictEqual({
        role: 'user',
        parts: [
          { text: 'and this one?' },
          { text: droppedMediaModelText(pastedDropped) },
        ],
      });
      const wire = JSON.stringify(contents);
      expect(wire).toContain(`read ${SHOT_PATH} again`);
      expect(wire).not.toContain('inlineData');
      expect(wire).not.toContain('fileData');
    });
  }
});
