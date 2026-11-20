/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  MediaDroppedBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

const SHOT_PATH = '/workspace/screens/dropped-estimate.png';

export const DROPPED_TOOL_IMAGE: MediaDroppedBlock = {
  type: 'media_dropped',
  origin: {
    kind: 'file',
    path: SHOT_PATH,
    readAt: '2026-11-19T10:00:00.000Z',
  },
  mimeType: 'image/png',
  byteLength: 70 * 1024,
  contentId: `sha256:${'c'.repeat(64)}`,
  droppedAt: '2026-11-19T11:00:00.000Z',
};

/**
 * A read_file call whose image was dropped. The reference rides with the
 * tool response either after it (as admitted) or before it (a relocated
 * image), and `withDropped: false` is the same history without the image.
 */
export function droppedToolImageRows(
  placement: 'after' | 'before',
  withDropped = true,
): IContent[] {
  const response = {
    type: 'tool_response',
    callId: 'call_read',
    toolName: 'read_file',
    result: 'Read image file',
  } satisfies IContent['blocks'][number];
  const dropped = withDropped ? [DROPPED_TOOL_IMAGE] : [];
  return [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'look at the screenshot' }],
    },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'call_read',
          name: 'read_file',
          parameters: { absolute_path: SHOT_PATH },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks:
        placement === 'after' ? [response, ...dropped] : [...dropped, response],
    },
    { speaker: 'ai', blocks: [{ type: 'text', text: 'It shows a dialog.' }] },
  ];
}
