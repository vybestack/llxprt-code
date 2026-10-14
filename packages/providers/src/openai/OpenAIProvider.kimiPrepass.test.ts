/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step D5: the Kimi file pre-pass reads the call's rows one at a
 * time and records its uploads in a request-scoped disk index; the chat body
 * is then written through a media stage that reads that index per row.
 *
 * Residency is judged with a weak-reference census over every row object the
 * row selection hands out. A pre-pass that collects the history keeps them
 * all alive while it uploads and after it returns, which the control below
 * does on purpose; the real pre-pass must stay under the same bound.
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { readdirSync } from 'node:fs';
import type OpenAI from 'openai';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { uploadKimiRowMedia } from '../kimi/kimiMediaProcessing.js';
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import { KeyedRowIndex } from '../utils/keyed-row-index.js';
import { collectContents } from '../utils/collectContents.js';
import { providerRowsOf } from '../utils/providerRows.js';
import { resolveRequestMedia } from '../utils/request-media-resolution.js';
import type { RowsMediaInput } from '../openai-responses/responses-row-media.js';
import { prepareKimiProviderFiles } from './kimi-provider-file-preparation.js';
import {
  bodyText,
  createKimiProvider,
  inputUrl,
  originalFetch,
  send,
} from './__tests__/support/kimi-cache-transport-fixtures.js';

const MEDIA_INPUT: RowsMediaInput = { requestId: 'kimi-prepass' };
const WORKSPACE = '/workspace/kimi-prepass';
const ROW_COUNT = 120;
/** Rows allowed alive at once: the row in hand plus generator frames. */
const LIVE_ROW_BOUND = 6;

interface Census {
  readonly refs: Array<WeakRef<IContent>>;
}

function liveRows(census: Census): number {
  Bun.gc(true);
  return census.refs.filter((ref) => ref.deref() !== undefined).length;
}

function pdfRow(index: number): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: `row ${index}` },
      {
        type: 'media',
        mimeType: 'application/pdf',
        encoding: 'base64',
        data: `${index}:${'QUJD'.repeat(12 * 1024)}`,
        filename: `doc-${index}.pdf`,
      },
    ],
  };
}

/** Rows made on demand and watched; nothing holds them but their reader. */
function watchedSelection(
  count: number,
  census: Census,
): ProviderRequestSelection {
  const read = (index: number): IContent => {
    const row = pdfRow(index);
    census.refs.push(new WeakRef(row));
    return row;
  };
  return Object.freeze({
    count,
    readAt: (index: number) => read(index),
    openReader: (signal?: AbortSignal) =>
      (async function* (): AsyncGenerator<IContent, void> {
        for (let index = 0; index < count; index++) {
          signal?.throwIfAborted();
          yield read(index);
        }
      })(),
    close: () => undefined,
  });
}

function prepassOptions(
  selection: ProviderRequestSelection,
): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  settings.set('provider-files', 'workspace');
  return {
    ...createProviderCallOptions({
      providerName: 'kimi',
      contents: [],
      settings,
      invocation: createRuntimeInvocationContext({
        runtimeId: 'kimi-prepass',
        providerName: 'kimi',
        ephemeralsSnapshot: { ...settings.getAllGlobalSettings() },
        providerDefaults: {
          providerSpecific: {
            mediaSupport: {
              fileUpload: true,
              videoSupport: false,
              inlineImages: true,
            },
          },
        },
      }),
      configOverrides: { getTargetDir: () => WORKSPACE },
    }),
    contents: [],
    requestRows: selection,
    contentCount: selection.count,
  } as NormalizedGenerateChatOptions;
}

interface Measured {
  /** Most rows alive at any upload. */
  readonly peakDuringUploads: number;
  /** Rows alive once the pre-pass returned and its result is still held. */
  readonly aliveAfter: number;
  readonly uploads: number;
  readonly result: unknown;
}

function watchingClient(census: Census, peak: { value: number }): OpenAI {
  let next = 0;
  const create = vi.fn(async () => {
    peak.value = Math.max(peak.value, liveRows(census));
    next += 1;
    return { id: `file-${next}`, bytes: 1024 };
  });
  return {
    apiKey: 'test-key',
    baseURL: 'https://api.kimi.com/coding/v1',
    files: { create },
  } as unknown as OpenAI;
}

async function measure(
  run: (
    options: NormalizedGenerateChatOptions,
    client: OpenAI,
    mediaRequest: Awaited<ReturnType<typeof resolveRequestMedia>>,
  ) => Promise<unknown>,
): Promise<Measured> {
  const census: Census = { refs: [] };
  const peak = { value: 0 };
  const client = watchingClient(census, peak);
  const options = prepassOptions(watchedSelection(ROW_COUNT, census));
  const mediaRequest = await resolveRequestMedia(MEDIA_INPUT, [], undefined);
  try {
    const result = await run(options, client, mediaRequest);
    const aliveAfter = liveRows(census);
    return {
      peakDuringUploads: peak.value,
      aliveAfter,
      uploads: (client.files.create as ReturnType<typeof vi.fn>).mock.calls
        .length,
      result,
    };
  } finally {
    await mediaRequest.release();
  }
}

function realPrepass(
  options: NormalizedGenerateChatOptions,
  client: OpenAI,
  mediaRequest: Awaited<ReturnType<typeof resolveRequestMedia>>,
): ReturnType<typeof prepareKimiProviderFiles> {
  return prepareKimiProviderFiles(
    options,
    client,
    new DebugLogger('test:kimi-prepass'),
    mediaRequest,
    'kimi',
    declaredMediaTransportCapabilities('kimi'),
    undefined,
    new ProviderFileLifecycle({ maxFiles: 1000, maxBytes: 1024 * 1024 * 1024 }),
    WORKSPACE,
    MEDIA_INPUT,
  );
}

/**
 * The shape the pre-pass had before D5: the history is collected into an
 * array, uploaded from it, and the array is handed back as the rows to write.
 */
async function collectingPrepass(
  options: NormalizedGenerateChatOptions,
  client: OpenAI,
): Promise<IContent[]> {
  const rows = await providerRowsOf(options);
  const held = await collectContents(rows.openReader());
  const uploads = KeyedRowIndex.create('kimi-prepass-trap');
  try {
    for (const [ordinal, row] of held.entries()) {
      await uploadKimiRowMedia(client, row, ordinal, uploads, undefined, {
        allowFileUpload: true,
      });
    }
  } finally {
    uploads.close();
  }
  return held;
}

function kimiScratchDirectories(): string[] {
  return readdirSync(getScratchRoot()).filter((name) =>
    name.startsWith('kimi-media-'),
  );
}

describe('Kimi file pre-pass residency', () => {
  it('uploads every row while holding only the row in hand', async () => {
    const measured = await measure(realPrepass);

    expect(measured.uploads).toBe(ROW_COUNT);
    expect(measured.peakDuringUploads).toBeLessThanOrEqual(LIVE_ROW_BOUND);
    expect(measured.aliveAfter).toBeLessThanOrEqual(LIVE_ROW_BOUND);
    expect(measured.result).toBeDefined();
  });

  it('writes the rows through the media stage one at a time', async () => {
    const census: Census = { refs: [] };
    const peak = { value: 0 };
    const client = watchingClient(census, peak);
    const selection = watchedSelection(ROW_COUNT, census);
    const mediaRequest = await resolveRequestMedia(MEDIA_INPUT, [], undefined);
    try {
      const prepared = await realPrepass(
        prepassOptions(selection),
        client,
        mediaRequest,
      );
      if (prepared?.mediaStage === undefined) {
        throw new Error('expected a media stage');
      }
      let converted = 0;
      let peakWhileConverting = 0;
      for await (const row of prepared.mediaStage(selection.openReader())) {
        peakWhileConverting = Math.max(peakWhileConverting, liveRows(census));
        expect(row.blocks[1]).toStrictEqual({
          type: 'text',
          text: `[Uploaded PDF: doc-${converted}.pdf (file id: file-${converted + 1})]`,
        });
        converted += 1;
      }

      expect(converted).toBe(ROW_COUNT);
      expect(peakWhileConverting).toBeLessThanOrEqual(LIVE_ROW_BOUND);
    } finally {
      await mediaRequest.release();
    }
  });

  it('control: a pre-pass that collects the history breaks the bound', async () => {
    const measured = await measure((options, client) =>
      collectingPrepass(options, client),
    );

    expect(measured.uploads).toBe(ROW_COUNT);
    expect(measured.peakDuringUploads).toBeGreaterThan(LIVE_ROW_BOUND);
    expect(measured.aliveAfter).toBeGreaterThan(LIVE_ROW_BOUND);
    expect(measured.result).toBeDefined();
  });
});

describe('Kimi file pre-pass request scope', () => {
  it('removes its upload index when the media request ends', async () => {
    const before = kimiScratchDirectories();
    const census: Census = { refs: [] };
    const client = watchingClient(census, { value: 0 });
    const mediaRequest = await resolveRequestMedia(MEDIA_INPUT, [], undefined);

    await realPrepass(
      prepassOptions(watchedSelection(3, census)),
      client,
      mediaRequest,
    );
    expect(kimiScratchDirectories()).toHaveLength(before.length + 1);

    await mediaRequest.release();
    expect(kimiScratchDirectories()).toStrictEqual(before);
  });

  it('removes its upload index when an upload fails', async () => {
    const before = kimiScratchDirectories();
    const census: Census = { refs: [] };
    const client = {
      apiKey: 'test-key',
      baseURL: 'https://api.kimi.com/coding/v1',
      files: {
        create: vi.fn(async () => {
          throw new Error('upload refused');
        }),
      },
    } as unknown as OpenAI;
    const mediaRequest = await resolveRequestMedia(MEDIA_INPUT, [], undefined);

    await expect(
      realPrepass(
        prepassOptions(watchedSelection(3, census)),
        client,
        mediaRequest,
      ),
    ).rejects.toThrow('Kimi file upload failed for doc-0.pdf');
    await mediaRequest.release();

    expect(kimiScratchDirectories()).toStrictEqual(before);
  });
});

function sentHistory(): IContent[] {
  const pdf = (name: string, data: string): IContent['blocks'][number] => ({
    type: 'media',
    mimeType: 'application/pdf',
    encoding: 'base64',
    data,
    filename: name,
  });
  return [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'first' }, pdf('a.pdf', 'QUJDQQ==')],
    },
    { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] },
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'second' },
        {
          type: 'media',
          mimeType: 'video/mp4',
          encoding: 'base64',
          data: 'VklERU8=',
          filename: 'clip.mp4',
        },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'iVBORw0KGgo=',
        },
        pdf('b.pdf', 'QUJDQg=='),
      ],
    },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'call_1',
          name: 'read_pdf',
          parameters: { path: '/tool.pdf' },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call_1',
          toolName: 'read_pdf',
          result: 'done',
        },
        pdf('tool.pdf', 'QUJDVA=='),
      ],
    },
    { speaker: 'human', blocks: [{ type: 'text', text: 'last' }] },
  ];
}

/** The history as the body sees it once the four uploads are in place. */
function uploadedHistory(): IContent[] {
  const rows = structuredClone(sentHistory());
  const text = (name: string, id: string): IContent['blocks'][number] => ({
    type: 'text',
    text: `[Uploaded PDF: ${name} (file id: ${id})]`,
  });
  rows[0].blocks[1] = text('a.pdf', 'file-1');
  rows[2].blocks[1] = {
    type: 'media',
    mimeType: 'video/mp4',
    encoding: 'url',
    data: 'ms://file-2',
    filename: 'clip.mp4',
  };
  rows[2].blocks[3] = text('b.pdf', 'file-3');
  rows[4].blocks[1] = text('tool.pdf', 'file-4');
  return rows;
}

interface Wire {
  readonly filenames: string[];
  readonly chatBodies: string[];
}

function installWire(): Wire {
  const wire: Wire = { filenames: [], chatBodies: [] };
  let fileCount = 0;
  globalThis.fetch = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init: Parameters<typeof fetch>[1],
    ) => {
      const url = inputUrl(input);
      if (url.includes('/files')) {
        fileCount += 1;
        const form = init?.body;
        if (form instanceof FormData) {
          const file = form.get('file');
          wire.filenames.push(file instanceof File ? file.name : 'unknown');
        }
        return Response.json({
          id: `file-${fileCount}`,
          object: 'file',
          bytes: 3,
          created_at: 1,
          filename: 'upload',
          purpose: 'file-extract',
          status: 'processed',
        });
      }
      if (!url.endsWith('/chat/completions')) {
        return new Response('unexpected request', { status: 500 });
      }
      wire.chatBodies.push(
        await bodyText(
          init?.body ?? (input instanceof Request ? input.body : null),
        ),
      );
      return Response.json({
        id: 'chat-prepass',
        object: 'chat.completion',
        created: 1,
        model: 'kimi-k3',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return wire;
}

describe('Kimi file pre-pass through a chat send', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('puts the same bytes on the wire as a history that already holds the uploads', async () => {
    const wire = installWire();
    const settings = new SettingsService();
    settings.set('provider-files', 'workspace');
    settings.set('kimi.experimental-video', true);
    await send(
      createKimiProvider(),
      settings,
      sentHistory(),
      'kimi-prepass-send',
    );

    const plain = new SettingsService();
    plain.set('kimi.experimental-video', true);
    await send(
      createKimiProvider(),
      plain,
      uploadedHistory(),
      'kimi-prepass-send',
    );

    expect(wire.filenames).toStrictEqual([
      'a.pdf',
      'clip.mp4',
      'b.pdf',
      'tool.pdf',
    ]);
    expect(wire.chatBodies).toHaveLength(2);
    expect(wire.chatBodies[0]).toContain(
      '[Uploaded PDF: a.pdf (file id: file-1)]',
    );
    expect(wire.chatBodies[0]).toContain('ms://file-2');
    expect(wire.chatBodies[0]).toBe(wire.chatBodies[1]);
    expect(kimiScratchDirectories()).toStrictEqual([]);
  });
});
