/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { processKimiMedia } from './kimiMediaProcessing.js';
import { createBoundedCache } from './kimiFileUpload.js';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

type FileCreateBody = { file: unknown; purpose: string };

function createMockClient(
  fileCreateImpl?: (
    body: FileCreateBody,
  ) => Promise<{ id: string; bytes: number }>,
) {
  const defaultImpl = async (_body: FileCreateBody) => ({
    id: `file-${Math.random().toString(36).slice(2, 10)}`,
    bytes: 1024,
  });
  const filesCreate = vi.fn(fileCreateImpl ?? defaultImpl);
  return {
    client: {
      apiKey: 'test-key',
      baseURL: 'https://api.kimi.com/coding/v1',
      files: { create: filesCreate },
    } as unknown as Parameters<typeof processKimiMedia>[0],
    filesCreate,
  };
}

function makePdfBlock(data: string, filename = 'doc.pdf'): MediaBlock {
  return {
    type: 'media',
    mimeType: 'application/pdf',
    data,
    encoding: 'base64',
    filename,
  };
}

function makeImageBlock(data: string): MediaBlock {
  return {
    type: 'media',
    mimeType: 'image/png',
    data,
    encoding: 'base64',
  };
}

function makeVideoBlock(data: string, filename = 'clip.mp4'): MediaBlock {
  return {
    type: 'media',
    mimeType: 'video/mp4',
    data,
    encoding: 'base64',
    filename,
  };
}

async function createPurposeSpecificFile(
  body: FileCreateBody,
): Promise<{ id: string; bytes: number }> {
  return {
    id: body.purpose === 'video' ? 'video-only' : 'unexpected-pdf',
    bytes: 10,
  };
}

function failFirstMediaUploadThenSucceed() {
  let callCount = 0;
  return async (): Promise<{ id: string; bytes: number }> => {
    callCount++;
    if (callCount === 1) {
      throw new Error('first fails');
    }
    return { id: 'file-good', bytes: 10 };
  };
}

function createSequentialFileUploader(ids: readonly string[]) {
  let index = 0;
  return async (): Promise<{ id: string; bytes: number }> => ({
    id: ids[index++] ?? 'file-x',
    bytes: 1,
  });
}

describe('processKimiMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns contents unchanged when no PDF blocks are present', async () => {
    const { client, filesCreate } = createMockClient();
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hello' }, makeImageBlock('imgdata')],
      },
    ];

    const result = await processKimiMedia(client, contents);

    expect(filesCreate).not.toHaveBeenCalled();
    expect(result.fileReferenceText).toBe('');
    expect(result.contents).toBe(contents);
  });

  it('handles empty contents array without error', async () => {
    const { client, filesCreate } = createMockClient();
    const result = await processKimiMedia(client, []);

    expect(filesCreate).not.toHaveBeenCalled();
    expect(result.fileReferenceText).toBe('');
    expect(result.contents).toStrictEqual([]);
  });

  it('handles content entries with empty blocks arrays', async () => {
    const { client, filesCreate } = createMockClient();
    const contents: IContent[] = [{ speaker: 'human', blocks: [] }];
    const result = await processKimiMedia(client, contents);

    expect(filesCreate).not.toHaveBeenCalled();
    expect(result.fileReferenceText).toBe('');
  });

  it('uploads PDFs from user messages and replaces them with text references', async () => {
    const { client, filesCreate } = createMockClient(async () => ({
      id: 'file-uploaded',
      bytes: 100,
    }));
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Summarize this' },
          makePdfBlock('PDFCONTENT', 'report.pdf'),
        ],
      },
    ];

    const result = await processKimiMedia(client, contents);

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(result.fileReferenceText).toContain('file-uploaded');

    // The original contents should not be mutated
    expect(contents[0].blocks[1].type).toBe('media');

    // The transformed contents should have the PDF replaced with text
    const transformedBlock = result.contents[0].blocks[1];
    expect(transformedBlock.type).toBe('text');
    expect((transformedBlock as { text: string }).text).toContain(
      'file-uploaded',
    );
    expect((transformedBlock as { text: string }).text).toContain('report.pdf');
  });

  it('uploads PDFs from tool response messages', async () => {
    const { client, filesCreate } = createMockClient(async () => ({
      id: 'file-tool',
      bytes: 200,
    }));
    const contents: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_1',
            toolName: 'read_pdf',
            result: 'done',
          },
          makePdfBlock('TOOLPDF'),
        ],
      },
    ];

    const result = await processKimiMedia(client, contents);

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(result.fileReferenceText).toContain('file-tool');
    expect(result.contents[0].blocks[1].type).toBe('text');
  });

  it('de-duplicates repeated uploads across calls via shared cache', async () => {
    const { client, filesCreate } = createMockClient(async () => ({
      id: 'file-once',
      bytes: 50,
    }));
    const cache = createBoundedCache<string>(10);
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [makePdfBlock('SAMEPDF', 'doc.pdf')],
      },
    ];

    const first = await processKimiMedia(client, contents, cache);
    const second = await processKimiMedia(client, contents, cache);

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(first.fileReferenceText).toContain('file-once');
    expect(second.fileReferenceText).toContain('file-once');
    expect(second.contents[0].blocks[0].type).toBe('text');
  });

  it('uploads enabled videos and replaces them with Moonshot references', async () => {
    const { client, filesCreate } = createMockClient(async () => ({
      id: 'video-file',
      bytes: 100,
    }));
    const contents: IContent[] = [
      { speaker: 'human', blocks: [makeVideoBlock('VIDEO')] },
    ];

    const result = await processKimiMedia(client, contents, undefined, {
      allowVideo: true,
    });

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(filesCreate.mock.calls[0][0].purpose).toBe('video');
    expect(result.fileReferenceText).toBe('');
    expect(result.contents[0].blocks[0]).toMatchObject({
      type: 'media',
      mimeType: 'video/mp4',
      encoding: 'url',
      data: 'ms://video-file',
    });
  });

  it('does not upload PDFs when only video upload is enabled', async () => {
    const { client, filesCreate } = createMockClient(createPurposeSpecificFile);
    const pdf = makePdfBlock('PDFDATA', 'disabled.pdf');
    const video = makeVideoBlock('VIDEODATA', 'enabled.mp4');
    const contents: IContent[] = [{ speaker: 'human', blocks: [pdf, video] }];

    const result = await processKimiMedia(client, contents, undefined, {
      allowFileUpload: false,
      allowVideo: true,
    });

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(filesCreate.mock.calls[0][0].purpose).toBe('video');
    expect(result.contents[0].blocks[0]).toBe(pdf);
    expect(result.contents[0].blocks[1]).toStrictEqual({
      ...video,
      data: 'ms://video-only',
      encoding: 'url',
    });
  });

  it('leaves video unchanged when video upload is disabled', async () => {
    const { client, filesCreate } = createMockClient();
    const contents: IContent[] = [
      { speaker: 'human', blocks: [makeVideoBlock('VIDEO')] },
    ];

    const result = await processKimiMedia(client, contents);

    expect(filesCreate).not.toHaveBeenCalled();
    expect(result.contents).toBe(contents);
  });

  it('falls back to original contents when all uploads fail', async () => {
    const { client, filesCreate } = createMockClient(async () => {
      throw new Error('upload failed');
    });
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [makePdfBlock('FAILDATA')],
      },
    ];

    const result = await processKimiMedia(client, contents);

    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(result.fileReferenceText).toBe('');
    expect(result.contents).toBe(contents);
  });

  it('partially succeeds: uploaded blocks replaced, failed blocks preserved', async () => {
    const { client, filesCreate } = createMockClient(
      failFirstMediaUploadThenSucceed(),
    );
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [makePdfBlock('FAILS'), makePdfBlock('WORKS', 'ok.pdf')],
      },
    ];

    const result = await processKimiMedia(client, contents);

    expect(filesCreate).toHaveBeenCalledTimes(2);
    expect(result.fileReferenceText).toContain('file-good');

    // First block (failed) should remain a media block
    expect(result.contents[0].blocks[0].type).toBe('media');
    // Second block (succeeded) should be replaced with text
    expect(result.contents[0].blocks[1].type).toBe('text');
  });

  it('does not upload image blocks', async () => {
    const { client, filesCreate } = createMockClient();
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [makeImageBlock('imgdata'), makePdfBlock('pdfdata')],
      },
    ];

    const result = await processKimiMedia(client, contents);

    expect(filesCreate).toHaveBeenCalledTimes(1);
    // Image block should remain unchanged
    expect(result.contents[0].blocks[0].type).toBe('media');
    // PDF block should be replaced
    expect(result.contents[0].blocks[1].type).toBe('text');
  });

  it('does not upload URL-encoded PDF blocks', async () => {
    const { client, filesCreate } = createMockClient();
    const urlPdf: MediaBlock = {
      type: 'media',
      mimeType: 'application/pdf',
      data: 'https://example.com/doc.pdf',
      encoding: 'url',
    };
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [urlPdf],
      },
    ];

    const result = await processKimiMedia(client, contents);

    expect(filesCreate).not.toHaveBeenCalled();
    expect(result.fileReferenceText).toBe('');
    expect(result.contents).toBe(contents);
  });

  it('handles multiple PDFs across multiple content entries', async () => {
    const ids = ['file-a', 'file-b'];
    const { client, filesCreate } = createMockClient(
      createSequentialFileUploader(ids),
    );
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [makePdfBlock('PDF_A', 'a.pdf')],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 'read',
            result: 'ok',
          },
          makePdfBlock('PDF_B', 'b.pdf'),
        ],
      },
    ];

    const result = await processKimiMedia(client, contents);

    expect(filesCreate).toHaveBeenCalledTimes(2);
    expect(result.fileReferenceText).toContain('file-a');
    expect(result.fileReferenceText).toContain('file-b');
    expect(result.contents[0].blocks[0].type).toBe('text');
    expect(result.contents[1].blocks[1].type).toBe('text');
  });
});
