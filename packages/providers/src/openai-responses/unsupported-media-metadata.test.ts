/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { replayableContents } from '../utils/collectContents.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';

function oneReadContents(rows: readonly IContent[]): {
  readonly contents: AsyncIterable<IContent>;
  readonly reads: () => number;
} {
  let reads = 0;
  return {
    reads: () => reads,
    contents: {
      async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void> {
        if (reads !== 0) throw new Error('Unbranded source opened twice');
        for (const row of rows) {
          reads += 1;
          yield row;
        }
      },
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

function promptText(projection: PromptEnvelopeProjection): string {
  const finalized = projection.finalizedProjection;
  if (
    typeof finalized !== 'object' ||
    finalized === null ||
    !('promptText' in finalized) ||
    typeof finalized.promptText !== 'string'
  ) {
    throw new Error('Expected ordinary finalized prompt text');
  }
  return finalized.promptText;
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
      const source = oneReadContents(rows);
      const unbranded = await provider.projectPromptEnvelope(
        options(provider, source.contents, pdfEnabled),
      );
      const eager = await provider.projectPromptEnvelope(
        options(provider, replayableContents(rows), pdfEnabled),
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
        expect(unbranded.finalizedProjection).toStrictEqual(
          eager.finalizedProjection,
        );
        expect(source.reads()).toBe(rows.length);
        expect(promptText(unbranded)).not.toContain(
          'https://example.com/audio.wav',
        );
        expect(promptText(unbranded)).toContain(
          'https://example.com/image.png',
        );
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
    const small = await provider.projectPromptEnvelope(
      options(provider, oneReadContents(mediaRows()).contents),
    );
    const large = await provider.projectPromptEnvelope(
      options(
        provider,
        oneReadContents(mediaRows('A'.repeat(100_000))).contents,
      ),
    );
    try {
      expect(
        small.unsupportedMedia.map((entry) => entry.mediaType),
      ).toStrictEqual(['audio', 'audio', 'video', 'unknown']);
      expect(large.unsupportedMedia).toStrictEqual(small.unsupportedMedia);
      expect(await large.legacyEstimate()).toBe(await small.legacyEstimate());
      expect(large.finalizedProjection).toStrictEqual(
        small.finalizedProjection,
      );
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
    const projection = await provider.projectPromptEnvelope(
      options(provider, oneReadContents(rows).contents),
    );
    try {
      expect(projection.unsupportedMedia).toStrictEqual([]);
      expect(promptText(projection)).toContain(
        'Unsupported audio in this sentence is text.',
      );
    } finally {
      await projection.releaseIfUnsent?.();
    }
  });
});

describe('ordinary Responses media projection transport', () => {
  it('transports the projected substitutions with one source read and releases its prepared owner', async () => {
    const leasesBefore = activeRequestBodyCount();
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
    const source = oneReadContents(rows);
    const call = options(
      provider,
      source.contents,
      false,
      `http://127.0.0.1:${server.port}/v1`,
    );
    const projection = await provider.projectPromptEnvelope(call);
    try {
      expect(activeRequestBodyCount() - leasesBefore).toBe(1);
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
      expect(activeRequestBodyCount() - leasesBefore).toBe(0);
    } finally {
      await projection.releaseIfUnsent?.();
      await server.stop(true);
    }
  });
});
