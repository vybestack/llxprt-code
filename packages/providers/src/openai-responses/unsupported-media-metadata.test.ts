/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { callerOwnedRawProviderSource } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import {
  journalSendFixture,
  type JournalSendFixture,
} from '../__tests__/support/journal-send-fixture.js';
import { acquireRequestRows } from '../utils/requestRowsLease.js';
import { promptKeyWorkspaces } from './__tests__/support/projection-workspace-fixture.js';
import {
  projectSourcePrompt,
  sourcePromptText as promptText,
} from './__tests__/support/source-prompt-text.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';

describe('native Responses media fixtures', () => {
  const fixtures: JournalSendFixture[] = [];
  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) await fixture.close();
  });

  async function oneReadContents(rows: readonly IContent[]): Promise<{
    readonly contents: ReturnType<typeof callerOwnedRawProviderSource>;
    readonly reads: () => number;
  }> {
    let reads = 0;
    const fixture = await journalSendFixture({
      *[Symbol.iterator](): Generator<IContent> {
        if (reads !== 0) throw new Error('Source opened twice');
        for (const row of rows) {
          reads++;
          yield row;
        }
      },
    });
    fixtures.push(fixture);
    return {
      reads: () => reads,
      contents: {
        openProviderRequest: async () => ({
          native: fixture.selection.native,
          count: fixture.selection.count,
          readAt: (index: number, signal?: AbortSignal) =>
            fixture.selection.readAt(index, signal),
          openReader: (signal?: AbortSignal) =>
            fixture.selection.openReader(signal),
          close: () => {},
        }),
        [Symbol.asyncIterator]: () => fixture.selection.openReader(),
      },
    };
  }

  function options(
    provider: OpenAIResponsesProvider,
    contents: AsyncIterable<IContent>,
    pdfEnabled = true,
    baseURL = 'https://api.openai.com/v1',
  ): ReturnType<typeof createProviderCallOptions> {
    return createProviderCallOptions({
      providerName: provider.name,
      contents,
      systemInstruction: 'Classify the supplied media.',
      resolved: { model: 'gpt-4o', baseURL },
      ephemerals: { 'media.pdf.enabled': pdfEnabled },
    });
  }

  function mediaRows(audioData = 'AAAA'): IContent[] {
    return [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Unsupported audio in this sentence is text.' },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'url',
            data: 'https://example.com/image.png',
          },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
          },
          {
            type: 'media',
            mimeType: 'application/pdf',
            encoding: 'url',
            data: 'https://example.com/report.pdf',
            filename: 'remote.pdf',
          },
          {
            type: 'media',
            mimeType: 'application/pdf',
            encoding: 'base64',
            data: 'JVBERi0=',
            filename: 'inline.pdf',
          },
          {
            type: 'media',
            mimeType: 'audio/wav',
            encoding: 'url',
            data: 'https://example.com/audio.wav',
          },
          {
            type: 'media',
            mimeType: 'audio/wav',
            encoding: 'base64',
            data: audioData,
          },
          {
            type: 'media',
            mimeType: 'video/mp4',
            encoding: 'base64',
            data: 'AAAA',
          },
          {
            type: 'media',
            mimeType: 'application/octet-stream',
            encoding: 'base64',
            data: 'AAAA',
          },
        ],
      },
    ];
  }

  describe('ordinary Responses media projection metadata', () => {
    it.each([true, false])(
      'reports actual URL and inline categories with PDF enabled=%s without a media plugin',
      async (pdfEnabled) => {
        const provider = new OpenAIResponsesProvider('token-test');
        const rows = mediaRows();
        const source = await oneReadContents(rows);
        const unbranded = await projectSourcePrompt(
          provider,
          options(provider, source.contents, pdfEnabled),
        );
        const eager = await projectSourcePrompt(
          provider,
          options(provider, callerOwnedRawProviderSource(rows), pdfEnabled),
        );
        try {
          const categories = [
            ...(pdfEnabled ? [] : ['pdf', 'pdf']),
            'audio',
            'audio',
            'video',
            'unknown',
          ];
          expect(
            unbranded.unsupportedMedia.map((entry) => entry.mediaType),
          ).toStrictEqual(categories);
          for (const entry of unbranded.unsupportedMedia) {
            expect(entry).toMatchObject({
              kind: 'unsupported',
              reason: expect.stringContaining('text placeholder'),
            });
          }
          expect(unbranded.unsupportedMedia).toStrictEqual(
            eager.unsupportedMedia,
          );
          const unbrandedText = await promptText(unbranded);
          expect(unbrandedText).toBe(await promptText(eager));
          expect(source.reads()).toBe(rows.length);
          expect(unbrandedText).not.toContain('https://example.com/audio.wav');
          expect(unbrandedText).toContain('https://example.com/image.png');
        } finally {
          await unbranded.releaseIfUnsent?.();
          await eager.releaseIfUnsent?.();
        }
      },
    );
  });

  describe('ordinary Responses media projection counts', () => {
    it('excludes unsupported audio payload sizes from counts without losing either audio category', async () => {
      const provider = new OpenAIResponsesProvider('token-test');
      const small = await projectSourcePrompt(
        provider,
        options(provider, (await oneReadContents(mediaRows())).contents),
      );
      const large = await projectSourcePrompt(
        provider,
        options(
          provider,
          (await oneReadContents(mediaRows('A'.repeat(100_000)))).contents,
        ),
      );
      try {
        expect(
          small.unsupportedMedia.map((entry) => entry.mediaType),
        ).toStrictEqual(['audio', 'audio', 'video', 'unknown']);
        expect(large.unsupportedMedia).toStrictEqual(small.unsupportedMedia);
        expect(await promptText(large)).toBe(await promptText(small));
      } finally {
        await small.releaseIfUnsent?.();
        await large.releaseIfUnsent?.();
      }
    });

    it('does not infer unsupported categories from text, supported images or enabled PDFs', async () => {
      const provider = new OpenAIResponsesProvider('token-test');
      const rows: IContent[] = mediaRows().map((row) => ({
        ...row,
        blocks: row.blocks.slice(0, 5),
      }));
      const projection = await projectSourcePrompt(
        provider,
        options(provider, (await oneReadContents(rows)).contents),
      );
      try {
        expect(projection.unsupportedMedia).toStrictEqual([]);
        expect(await promptText(projection)).toContain(
          'Unsupported audio in this sentence is text.',
        );
      } finally {
        await projection.releaseIfUnsent?.();
      }
    });
  });

  describe('ordinary Responses media projection transport', () => {
    it('transports the projected substitutions with one source read and releases its prepared owner', async () => {
      const workspacesBefore = promptKeyWorkspaces().length;
      const bodies: string[] = [];
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: async (request): Promise<Response> => {
          bodies.push(await request.text());
          return new Response(
            'data: {"type":"response.completed","response":{"id":"media_response","status":"completed"}}\n\ndata: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          );
        },
      });
      const provider = new OpenAIResponsesProvider(
        'token-test',
        `http://127.0.0.1:${server.port}/v1`,
      );
      const rows = mediaRows();
      const source = await oneReadContents(rows);
      const scope = acquireRequestRows(
        options(
          provider,
          source.contents,
          false,
          `http://127.0.0.1:${server.port}/v1`,
        ),
      );
      const call = scope.options;
      const projection = await projectSourcePrompt(provider, call);
      try {
        expect(promptKeyWorkspaces().length - workspacesBefore).toBe(0);
        expect(
          projection.unsupportedMedia.map((entry) => entry.mediaType),
        ).toStrictEqual(['pdf', 'pdf', 'audio', 'audio', 'video', 'unknown']);
        for await (const _chunk of provider.generateChatCompletion({
          ...call,
          promptEnvelopeTransportToken: projection.transportToken,
        })) {
          /* drain */
        }
        expect(bodies).toHaveLength(1);
        const body = bodies[0];
        expect(body).toContain('"type":"input_image"');
        expect(body).toContain('native PDF input is disabled');
        expect(body).toContain('Unsupported audio: audio/wav');
        expect(body).not.toContain('"type":"input_file"');
        expect(body).not.toContain('https://example.com/audio.wav');
        expect(source.reads()).toBe(rows.length);
        expect(promptKeyWorkspaces().length - workspacesBefore).toBe(0);
      } finally {
        await projection.releaseIfUnsent?.();
        await scope.close();
        await server.stop(true);
      }
    });
  });
});
