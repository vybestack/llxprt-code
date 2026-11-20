/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { isMediaDroppedBlock, type MediaDroppedBlock } from './IContent.js';
import {
  describeDroppedMedia,
  droppedMediaModelText,
} from './droppedMediaText.js';
import { MEDIA_DROPPED_FILE } from './__tests__/support/journalRowShapes.js';

const READ_AT = '2026-11-19T18:00:00.000Z';

function dropped(origin: MediaDroppedBlock['origin']): MediaDroppedBlock {
  return { ...MEDIA_DROPPED_FILE, origin };
}

describe('dropped media text', () => {
  it('names the absolute path, the type and the size of a file image', () => {
    expect(describeDroppedMedia(MEDIA_DROPPED_FILE)).toBe(
      '[image dropped: /work/screens/login.png, image/png, 120 KB]',
    );
    expect(droppedMediaModelText(MEDIA_DROPPED_FILE)).toContain(
      'read /work/screens/login.png again',
    );
  });

  it('says pasted image, image from a tool or from the model without a path', () => {
    expect(
      describeDroppedMedia(dropped({ kind: 'pasted', readAt: READ_AT })),
    ).toBe('[image dropped: pasted image, image/png, 120 KB]');
    expect(
      describeDroppedMedia(
        dropped({
          kind: 'tool',
          toolName: 'screenshot',
          callId: 'call-1',
          readAt: READ_AT,
        }),
      ),
    ).toBe(
      '[image dropped: image from screenshot (call-1), image/png, 120 KB]',
    );
    const model = dropped({ kind: 'model-output', readAt: READ_AT });
    expect(describeDroppedMedia(model)).toBe(
      '[image dropped: image from the model, image/png, 120 KB]',
    );
    expect(droppedMediaModelText(model)).not.toContain('read ');
  });
});

describe('isMediaDroppedBlock', () => {
  it('accepts a complete reference', () => {
    expect(isMediaDroppedBlock(MEDIA_DROPPED_FILE)).toBe(true);
  });

  it.each([
    ['no origin', { ...MEDIA_DROPPED_FILE, origin: undefined }],
    [
      'a file origin without a path',
      dropped({ kind: 'file', path: '', readAt: READ_AT }),
    ],
    ['a bad content id', { ...MEDIA_DROPPED_FILE, contentId: 'sha256:xyz' }],
    ['a zero size', { ...MEDIA_DROPPED_FILE, byteLength: 0 }],
    ['an unparseable drop time', { ...MEDIA_DROPPED_FILE, droppedAt: 'later' }],
    ['a media type', { ...MEDIA_DROPPED_FILE, type: 'media' }],
  ])('rejects %s', (_name, value) => {
    expect(isMediaDroppedBlock(value)).toBe(false);
  });
});
