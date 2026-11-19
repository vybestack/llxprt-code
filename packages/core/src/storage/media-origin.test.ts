/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ContentBlock,
  IContent,
  InlineMediaBlock,
  MediaOrigin,
} from '../services/history/IContent.js';
import {
  isMediaOrigin,
  isMediaReferenceBlock,
} from '../services/history/IContent.js';
import { LocalMediaStore } from './local-media-store.js';
import { MediaAdmissionService } from './media-admission-service.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';

function image(extra: Partial<InlineMediaBlock> = {}): InlineMediaBlock {
  return {
    type: 'media',
    mimeType: 'image/png',
    encoding: 'base64',
    data: PNG_BASE64,
    ...extra,
  };
}

describe('media origin at admission', () => {
  let directory = '';
  let admission: MediaAdmissionService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'media-origin-'));
    admission = new MediaAdmissionService(
      new LocalMediaStore({
        rootDirectory: join(directory, 'media'),
        quotaBytes: 1024 * 1024,
      }),
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function admittedOrigin(
    speaker: IContent['speaker'],
    blocks: ContentBlock[],
  ): Promise<unknown> {
    const admitted = await admission.admitContent(
      { speaker, blocks, metadata: { turnId: 'turn-origin' } },
      { turnId: 'turn-origin', source: 'test' },
    );
    const media = admitted.blocks.find((block) => block.type === 'media');
    expect(isMediaReferenceBlock(media)).toBe(true);
    expect(media).not.toHaveProperty('data');
    return media === undefined ? undefined : media.origin;
  }

  it('records the absolute file path an image was read from', async () => {
    const path = join(directory, 'shots', 'x.png');
    const origin = await admittedOrigin('human', [image({ filename: path })]);
    expect(origin).toMatchObject({ kind: 'file', path });
    expect(isMediaOrigin(origin)).toBe(true);
  });

  it('records the tool name and call id for a tool result image', async () => {
    const origin = await admittedOrigin('tool', [
      {
        type: 'tool_response',
        callId: 'call-7',
        toolName: 'screenshot',
        result: 'ok',
      },
      image(),
    ]);
    expect(origin).toMatchObject({
      kind: 'tool',
      toolName: 'screenshot',
      callId: 'call-7',
    });
  });

  it('records a user image without a path as pasted', async () => {
    const origin = await admittedOrigin('human', [image()]);
    expect(origin).toMatchObject({ kind: 'pasted' });
    expect(isMediaOrigin(origin)).toBe(true);
  });

  it('records a model image as model output', async () => {
    const origin = await admittedOrigin('ai', [image()]);
    expect(origin).toMatchObject({ kind: 'model-output' });
  });

  it('keeps a caller supplied origin unchanged', async () => {
    const supplied: MediaOrigin = {
      kind: 'file',
      path: '/workspace/a.png',
      readAt: '2026-11-19T18:00:00.000Z',
    };
    const origin = await admittedOrigin('human', [
      image({ origin: supplied, filename: 'a.png' }),
    ]);
    expect(origin).toStrictEqual(supplied);
  });

  it('rejects malformed origins on a reference', () => {
    expect(isMediaOrigin({ kind: 'file', readAt: '2026-11-19' })).toBe(false);
    expect(isMediaOrigin({ kind: 'tool', toolName: 't', readAt: 'x' })).toBe(
      false,
    );
    expect(isMediaOrigin({ kind: 'other', readAt: '2026-11-19' })).toBe(false);
  });
});
