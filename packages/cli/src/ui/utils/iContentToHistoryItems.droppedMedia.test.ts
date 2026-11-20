/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent, MediaDroppedBlock } from '@vybestack/llxprt-code-core';
import { iContentToHistoryItems } from './iContentToHistoryItems.js';
import { assertHasType } from '../../__tests__/assertions.js';

const SHOT_PATH = '/workspace/screens/dropped-shot.png';
const READ_AT = '2026-11-19T10:00:00.000Z';

function dropped(origin: MediaDroppedBlock['origin']): MediaDroppedBlock {
  return {
    type: 'media_dropped',
    origin,
    mimeType: 'image/png',
    byteLength: 70 * 1024,
    contentId: `sha256:${'a'.repeat(64)}`,
    droppedAt: '2026-11-19T11:00:00.000Z',
  };
}

describe('transcript lines for dropped images', () => {
  it('shows each dropped image as a line in its user or tool item', () => {
    const rows: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'and this one?' },
          dropped({ kind: 'pasted', readAt: READ_AT }),
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_read',
            name: 'read_file',
            parameters: {},
          },
          {
            type: 'tool_call',
            id: 'call_shot',
            name: 'screenshot',
            parameters: {},
          },
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
          dropped({ kind: 'file', path: SHOT_PATH, readAt: READ_AT }),
          {
            type: 'tool_response',
            callId: 'call_shot',
            toolName: 'screenshot',
            result: 'Captured',
          },
          dropped({
            kind: 'tool',
            toolName: 'screenshot',
            callId: 'call_shot',
            readAt: READ_AT,
          }),
        ],
      },
    ];

    const [user, group] = iContentToHistoryItems(rows, 'allowed');

    assertHasType(user, 'user');
    expect(user.text).toBe(
      'and this one?\n[image dropped: pasted image, image/png, 70 KB]',
    );
    assertHasType(group, 'tool_group');
    expect(group.tools.map((tool) => tool.resultDisplay)).toStrictEqual([
      `Read image file\n[image dropped: ${SHOT_PATH}, image/png, 70 KB]`,
      'Captured\n[image dropped: image from screenshot (call_shot), image/png, 70 KB]',
    ]);
  });

  it('shows a user turn that held only a dropped image', () => {
    const [user] = iContentToHistoryItems(
      [
        {
          speaker: 'human',
          blocks: [dropped({ kind: 'file', path: SHOT_PATH, readAt: READ_AT })],
        },
      ],
      'allowed',
    );
    assertHasType(user, 'user');
    expect(user.text).toBe(`[image dropped: ${SHOT_PATH}, image/png, 70 KB]`);
  });
});
