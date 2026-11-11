/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import {
  RequestMediaResolutionError,
  RequestMediaResolver,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { shouldRetryError } from '../retryDelayPolicy.js';
import { nativeJournalSendFixture } from './support/journal-send-fixture.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
  type WireRoute,
} from './support/wireBodyCapture.js';

async function failedMediaUpload(
  route: WireRoute,
  streaming: boolean,
  damage: 'missing' | 'corrupt' | 'read',
): Promise<void> {
  const directory = await mkdtemp(
    join(import.meta.dir, '../../../../tmp/native-media-body-error-'),
  );
  const store = new LocalMediaStore({
    rootDirectory: directory,
    quotaBytes: 1024,
  });
  const image = await store.admit({
    bytes: new Uint8Array([1, 2, 3, 4]),
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  const rows = [
    {
      speaker: 'human',
      metadata: { turnId: 'turn-media-body-error' },
      blocks: [{ type: 'text', text: 'inspect' }, image],
    },
  ] satisfies Parameters<typeof nativeJournalSendFixture>[0];
  const fixture = await nativeJournalSendFixture(rows, { mediaStore: store });
  const resolver = new RequestMediaResolver(store);
  const provider = bindProviderMedia(
    route.createProvider(),
    resolver,
    image.normalizedBase64Length,
  );
  const reading = spyOn(store, 'readReserved');
  let attempts = 0;
  let bodyError: unknown;
  const options = buildHistoryCallOptions(
    route,
    {
      id: 'native-media-body-error',
      description: 'local media read failure during upload',
      rows,
      ephemerals: {
        streaming: streaming ? 'enabled' : 'disabled',
        retries: 3,
        retrywait: 1,
      },
    },
    'rows',
    new SettingsService(),
    fixture.selection,
  );
  const fetchUpload = async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    attempts += 1;
    if (attempts !== 1) throw new Error('Local media upload was retried');
    const path = join(
      directory,
      'objects',
      'sha256',
      image.contentId.slice('sha256:'.length),
    );
    if (damage === 'missing') await unlink(path);
    else if (damage === 'corrupt') await writeFile(path, new Uint8Array([255]));
    else
      reading.mockRejectedValue(new Error('fetch failed reading local media'));
    if (!(init?.body instanceof ReadableStream))
      throw new Error('Expected native streaming request body');
    try {
      await new Response(init.body).arrayBuffer();
    } catch (error) {
      bodyError = error;
      throw new TypeError('fetch failed', { cause: error });
    }
    throw new Error('Damaged media upload completed');
  };
  try {
    const invocation = options.invocation;
    if (invocation === undefined) throw new Error('Missing test invocation');
    const send = async (): Promise<void> => {
      for await (const chunk of provider.generateChatCompletion({
        ...options,
        invocation: { ...invocation, fetch: fetchUpload },
      }))
        void chunk;
    };
    const error = await send().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(RequestMediaResolutionError);
    expect(error).toBe(bodyError);
    expect(error).toMatchObject({
      contentId: image.contentId,
      turnId: 'turn-media-body-error',
    });
    expect(attempts).toBe(1);
    expect(shouldRetryError(error)).toBe(false);
    expect(resolver.accounting().activeRequestCount).toBe(0);
    expect(resolver.accounting().reservedContentCount).toBe(0);
    expect(resolver.accounting().materializedNormalizedBytes).toBe(0);
  } finally {
    reading.mockRestore();
    await fixture.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

describe('native request media body failures', () => {
  for (const id of [
    'anthropic-cache-off',
    'openai-chat-plain',
    'openai-responses',
  ]) {
    const route = WIRE_ROUTES.find((entry) => entry.id === id);
    if (route === undefined) throw new Error(`Missing route ${id}`);
    for (const streaming of [false, true]) {
      it.each(['missing', 'corrupt', 'read'] satisfies Array<
        'missing' | 'corrupt' | 'read'
      >)(
        `${id} preserves the typed %s media error without retrying, streaming=${streaming}`,
        async (damage) => {
          await expect(
            failedMediaUpload(route, streaming, damage),
          ).resolves.toBeUndefined();
        },
      );
    }
  }
});
