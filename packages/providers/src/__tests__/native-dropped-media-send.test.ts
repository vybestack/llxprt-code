/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import type {
  IContent,
  MediaDroppedBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { droppedMediaModelText } from '@vybestack/llxprt-code-core/services/history/droppedMediaText.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { sendThroughRoute, WIRE_ROUTES } from './support/wireBodyCapture.js';

const SHOT_PATH = resolve('/workspace/screens/dropped-shot.png');
const IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const READ_AT = '2026-11-19T10:00:00.000Z';
const DROPPED_AT = '2026-11-19T11:00:00.000Z';

const fileDropped: MediaDroppedBlock = {
  type: 'media_dropped',
  origin: { kind: 'file', path: SHOT_PATH, readAt: READ_AT },
  mimeType: 'image/png',
  byteLength: 70 * 1024,
  contentId: `sha256:${'a'.repeat(64)}`,
  droppedAt: DROPPED_AT,
};

const pastedDropped: MediaDroppedBlock = {
  type: 'media_dropped',
  origin: { kind: 'pasted', readAt: READ_AT },
  mimeType: 'image/jpeg',
  byteLength: 3 * 1024,
  contentId: `sha256:${'b'.repeat(64)}`,
  droppedAt: DROPPED_AT,
};

const rows: readonly IContent[] = [
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
  { speaker: 'ai', blocks: [{ type: 'text', text: 'It shows a dialog.' }] },
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'and this one?' }, pastedDropped],
  },
];

/** The reference text as it appears inside a JSON string on the wire. */
function onWire(block: MediaDroppedBlock): string {
  return JSON.stringify(droppedMediaModelText(block)).slice(1, -1);
}

function lacksImageParts(body: string): void {
  expect(body).not.toContain(IMAGE_BASE64);
  expect(body).not.toContain('base64');
  expect(body).not.toContain('data:image');
  expect(body).not.toContain('"image_url"');
  expect(body).not.toContain('"input_image"');
  expect(body).not.toContain('"type":"image"');
  expect(body).not.toContain('[Images from tool response]');
}

describe('dropped images on the native journal send', () => {
  for (const route of WIRE_ROUTES) {
    it(`${route.id} sends each dropped image as its reference text in place`, async () => {
      const shape = {
        id: `dropped-media-${route.id}`,
        description: 'dropped images in a tool response and a user message',
        rows,
        ephemerals: {},
      };
      const fixture = await journalSendFixture(rows);
      try {
        const native = await sendThroughRoute(
          route,
          shape,
          'rows',
          undefined,
          fixture.selection,
        );
        const oracle = await sendThroughRoute(route, shape, 'rows');
        const body = new TextDecoder().decode(native.bytes);

        expect(native.contentLength).toBe(String(native.bytes.byteLength));
        expect(
          Buffer.from(native.bytes).equals(Buffer.from(oracle.bytes)),
        ).toBe(true);
        expect(body).toContain(onWire(fileDropped));
        expect(body).toContain(`read ${SHOT_PATH} again to see it`);
        expect(body).toContain(onWire(pastedDropped));
        lacksImageParts(body);

        const toolText = body.indexOf(onWire(fileDropped));
        const toolOutput = body.indexOf('Read image file');
        const nextTurn = body.indexOf('It shows a dialog.');
        expect(toolOutput).toBeGreaterThanOrEqual(0);
        expect(toolText).toBeGreaterThan(toolOutput);
        expect(toolText).toBeLessThan(nextTurn);
        const pastedText = body.indexOf(onWire(pastedDropped));
        expect(pastedText).toBeGreaterThan(body.indexOf('and this one?'));
      } finally {
        await fixture.close();
      }
    });
  }
});
