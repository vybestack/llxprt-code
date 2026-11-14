/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { bindProviderFiles } from '@vybestack/llxprt-code-core/runtime/bindProviderFiles.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { bindProviderAliasIdentity } from '../composition/aliasProviderFactory.js';
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import {
  buildHistoryCallOptions,
  rowsSelection,
  WIRE_ROUTES,
  type WireRoute,
} from './support/wireBodyCapture.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

const rows: IContent[] = [
  {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'Describe these attachments' },
      {
        type: 'media',
        mimeType: 'image/png',
        data: 'aW1hZ2U=',
        encoding: 'base64',
      },
      {
        type: 'media',
        mimeType: 'application/pdf',
        data: 'JVBERi0=',
        encoding: 'base64',
        filename: 'report.pdf',
      },
      {
        type: 'media',
        mimeType: 'video/mp4',
        data: 'VklERU8=',
        encoding: 'base64',
        filename: 'clip.mp4',
      },
    ],
  },
];

function kimiRoute(): WireRoute {
  const route = WIRE_ROUTES.find((entry) => entry.id === 'openai-chat-kimi');
  if (route === undefined) throw new Error('Missing Kimi route');
  return route;
}

describe('native Kimi provider-file uploads', () => {
  it('sends native Kimi image and uploaded file references with old-route bytes and no scratch', async () => {
    const route = kimiRoute();
    const bodies: string[] = [];
    const uploads: string[] = [];
    const lengths: string[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith('/files')) {
          const form = await request.formData();
          const file = form.get('file');
          if (!(file instanceof File))
            throw new Error('Expected uploaded file');
          uploads.push(
            `${form.get('purpose')}:${file.name}:${await file.text()}`,
          );
          return Response.json({
            id: file.name === 'clip.mp4' ? 'video-file' : 'pdf-file',
            bytes: file.size,
          });
        }
        bodies.push(await request.text());
        lengths.push(request.headers.get('content-length') ?? '');
        return route.respond();
      },
    });
    const baseURL = `http://127.0.0.1:${server.port}/v1`;
    const fixture = await journalSendFixture(rows, [], {
      directory: 'tmp/scratch-removal2/kimi-fixture',
    });
    async function send(selection: ProviderRequestSelection): Promise<void> {
      const provider = new OpenAIProvider('test-key', baseURL, {
        providerSpecific: {
          mediaSupport: {
            inlineImages: true,
            fileUpload: true,
            videoSupport: true,
          },
        },
      });
      bindProviderAliasIdentity(provider, 'kimi');
      Object.defineProperty(provider, 'getMediaTransportCapabilities', {
        value: () => declaredMediaTransportCapabilities('kimi'),
      });
      const bound = bindProviderFiles(
        provider,
        undefined,
        new ProviderFileLifecycle({ maxFiles: 10, maxBytes: 1024 }),
        '/workspace/kimi-native',
      );
      const options = buildHistoryCallOptions(
        { ...route, baseURL },
        {
          id: 'native-upload',
          description: 'Kimi media',
          rows: [],
          ephemerals: {
            'kimi.experimental-video': true,
            'provider-files': 'workspace',
          },
        },
        'rows',
        new SettingsService(),
        selection,
      );
      if (options.invocation === undefined)
        throw new Error('Missing invocation');
      const invocation = {
        ...options.invocation,
        providerDefaults: {
          ...options.invocation.providerDefaults,
          providerSpecific: {
            mediaSupport: {
              inlineImages: true,
              fileUpload: true,
              videoSupport: true,
            },
          },
        },
      };
      for await (const chunk of bound.generateChatCompletion({
        ...options,
        invocation,
      }))
        void chunk;
    }
    try {
      await send(rowsSelection(rows));
      expect(uploads).toStrictEqual([
        'file-extract:report.pdf:%PDF-',
        'video:clip.mp4:VIDEO',
      ]);
      const created = await operationFileCreates(
        () => send(fixture.selection),
        true,
      );
      expect(created).toStrictEqual({ files: [], directories: [] });
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);
      expect(bodies[1]).toContain('data:image/png;base64,aW1hZ2U=');
      expect(bodies[1]).toContain(
        '[Uploaded PDF: report.pdf (file id: pdf-file)]',
      );
      expect(bodies[1]).toContain('ms://video-file');
      expect(lengths).toStrictEqual(
        bodies.map((body) => String(Buffer.byteLength(body))),
      );
    } finally {
      await fixture.close();
      await server.stop(true);
    }
  });
});
