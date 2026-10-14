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
import {
  applyKimiRowMedia,
  uploadKimiRowMedia,
} from './kimiMediaProcessing.js';
import {
  createBoundedCache,
  type KimiUploadOptions,
} from './kimiFileUpload.js';
import { KeyedRowIndex } from '../utils/keyed-row-index.js';
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
    } as unknown as Parameters<typeof uploadKimiRowMedia>[0],
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

type KimiClient = Parameters<typeof uploadKimiRowMedia>[0];

interface ProcessedRows {
  /** The rows after the replacement pass, in order. */
  contents: IContent[];
  /** How many blocks were uploaded and recorded. */
  uploaded: number;
}

/**
 * The two passes the chat send runs, over an array only because the test has
 * one: each row is uploaded in order, then each row is read back with its
 * uploads applied. Nothing but one row is passed to either function.
 */
async function processKimiMedia(
  client: KimiClient,
  contents: IContent[],
  cache?: ReturnType<typeof createBoundedCache<string>>,
  options: KimiUploadOptions = {},
): Promise<ProcessedRows> {
  const uploads = KeyedRowIndex.create('kimi-media-test');
  try {
    let uploaded = 0;
    for (const [ordinal, row] of contents.entries()) {
      uploaded += await uploadKimiRowMedia(
        client,
        row,
        ordinal,
        uploads,
        cache,
        options,
      );
    }
    return {
      contents: contents.map((row, ordinal) =>
        applyKimiRowMedia(row, ordinal, uploads),
      ),
      uploaded,
    };
  } finally {
    uploads.close();
  }
}

describe('Kimi row media', () => {
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
    expect(result.uploaded).toBe(0);
    expect(result.contents[0]).toBe(contents[0]);
  });

  it('handles empty contents array without error', async () => {
    const { client, filesCreate } = createMockClient();
    const result = await processKimiMedia(client, []);

    expect(filesCreate).not.toHaveBeenCalled();
    expect(result.uploaded).toBe(0);
    expect(result.contents).toStrictEqual([]);
  });

  it('handles content entries with empty blocks arrays', async () => {
    const { client, filesCreate } = createMockClient();
    const contents: IContent[] = [{ speaker: 'human', blocks: [] }];
    const result = await processKimiMedia(client, contents);

    expect(filesCreate).not.toHaveBeenCalled();
    expect(result.uploaded).toBe(0);
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
    expect(result.uploaded).toBe(1);

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
    expect(result.uploaded).toBe(1);
    expect(result.contents[0].blocks[1]).toStrictEqual({
      type: 'text',
      text: '[Uploaded PDF: doc.pdf (file id: file-tool)]',
    });
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
    expect(first.uploaded).toBe(1);
    expect(second.uploaded).toBe(1);
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
    expect(result.uploaded).toBe(1);
    expect(result.contents[0].blocks[0]).toMatchObject({
      type: 'media',
      mimeType: 'video/mp4',
      encoding: 'url',
      data: 'ms://video-file',
    });
  });

  it('does not upload PDFs when only video upload is enabled', async () => {
    const { client, filesCreate } = createMockClient(async (body) => ({
      id: body.purpose === 'video' ? 'video-only' : 'unexpected-pdf',
      bytes: 10,
    }));
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
    expect(result.contents[0]).toBe(contents[0]);
  });

  it('rejects instead of returning inline content when an upload fails', async () => {
    const { client } = createMockClient(async () => {
      throw new Error('upload failed');
    });
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [makePdfBlock('FAILDATA')],
      },
    ];

    await expect(processKimiMedia(client, contents)).rejects.toThrow(
      'Kimi file upload failed for doc.pdf (application/pdf): upload failed',
    );
  });

  it('rejects a mixed upload batch when one selected upload fails', async () => {
    const { client } = createMockClient(async () => {
      throw new Error('first fails');
    });
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [makePdfBlock('FAILS'), makePdfBlock('WORKS', 'ok.pdf')],
      },
    ];

    await expect(processKimiMedia(client, contents)).rejects.toThrow(
      'Kimi file upload failed for doc.pdf (application/pdf): first fails',
    );
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
    expect(result.uploaded).toBe(0);
    expect(result.contents[0]).toBe(contents[0]);
  });

  it('handles multiple PDFs across multiple content entries', async () => {
    const ids = ['file-a', 'file-b'];
    let idx = 0;
    const { client, filesCreate } = createMockClient(async () => ({
      id: ids[idx++] ?? 'file-x',
      bytes: 1,
    }));
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
    expect(result.uploaded).toBe(2);
    expect(JSON.stringify(result.contents)).toContain('file-a');
    expect(JSON.stringify(result.contents)).toContain('file-b');
    expect(result.contents[0].blocks[0].type).toBe('text');
    expect(result.contents[1].blocks[1].type).toBe('text');
  });
  describe('row-at-a-time order', () => {
    function pdfRow(...names: string[]): IContent {
      return {
        speaker: 'human',
        blocks: names.map((name) => makePdfBlock(`DATA_${name}`, name)),
      };
    }

    it('uploads in history order, one block after the other', async () => {
      let inFlight = 0;
      let peakInFlight = 0;
      const { client, filesCreate } = createMockClient(async () => {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
        return { id: `file-${filesCreate.mock.calls.length}`, bytes: 1 };
      });
      const contents = [
        pdfRow('a.pdf'),
        { speaker: 'human', blocks: [{ type: 'text', text: 'no media' }] },
        pdfRow('b1.pdf', 'b2.pdf'),
        pdfRow('c.pdf'),
      ] as IContent[];

      await processKimiMedia(client, contents);

      const names = filesCreate.mock.calls.map(
        ([body]) => (body.file as { name: string }).name,
      );
      expect(names).toStrictEqual(['a.pdf', 'b1.pdf', 'b2.pdf', 'c.pdf']);
      expect(peakInFlight).toBe(1);
    });

    it('inserts cache entries in upload order and evicts as a single pass would', async () => {
      const inserted: string[] = [];
      const base = createBoundedCache<string>(2);
      const cache = {
        ...base,
        set: (key: string, value: string) => {
          inserted.push(value);
          base.set(key, value);
        },
      };
      let next = 0;
      const { client } = createMockClient(async () => ({
        id: `file-${next++}`,
        bytes: 1,
      }));

      await processKimiMedia(
        client,
        [pdfRow('a.pdf'), pdfRow('b.pdf'), pdfRow('c.pdf')],
        cache,
      );

      expect(inserted).toStrictEqual(['file-0', 'file-1', 'file-2']);
      expect(base.size).toBe(2);
    });

    it('uploads equal blocks of different rows once through the shared cache and replaces both', async () => {
      const { client, filesCreate } = createMockClient(async () => ({
        id: 'file-shared',
        bytes: 1,
      }));
      const cache = createBoundedCache<string>(10);
      const contents = [pdfRow('same.pdf'), pdfRow('same.pdf')];

      const result = await processKimiMedia(client, contents, cache);

      expect(filesCreate).toHaveBeenCalledTimes(1);
      expect(result.uploaded).toBe(2);
      expect(result.contents[0].blocks[0].type).toBe('text');
      expect(result.contents[1].blocks[0].type).toBe('text');
    });

    it('replaces each equal block under its own position when nothing is shared', async () => {
      let next = 0;
      const { client, filesCreate } = createMockClient(async () => ({
        id: `file-${next++}`,
        bytes: 1,
      }));
      const contents = [pdfRow('same.pdf'), pdfRow('same.pdf')];

      const result = await processKimiMedia(client, contents);

      expect(filesCreate).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(result.contents[0])).toContain('file-0');
      expect(JSON.stringify(result.contents[1])).toContain('file-1');
    });

    it('does not modify the rows it replaces media in', async () => {
      const { client } = createMockClient(async () => ({
        id: 'file-keep',
        bytes: 1,
      }));
      const contents = [pdfRow('keep.pdf')];
      const before = structuredClone(contents);

      const result = await processKimiMedia(client, contents);

      expect(result.contents[0]).not.toBe(contents[0]);
      expect(contents).toStrictEqual(before);
    });

    it('fails when a recorded upload has an unexpected shape', () => {
      const uploads = KeyedRowIndex.create('kimi-media-test');
      try {
        uploads.set('kimi-media:0:0', { kind: 'unknown' });
        expect(() => applyKimiRowMedia(pdfRow('x.pdf'), 0, uploads)).toThrow(
          'Kimi upload record holds an unexpected value',
        );
      } finally {
        uploads.close();
      }
    });
  });
});
