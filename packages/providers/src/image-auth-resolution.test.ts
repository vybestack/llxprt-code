/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createImageApiKeyResolver,
  ImageCredentialError,
  resolveCodexImageCredential,
  type ImageApiKeyResolverDeps,
} from './image-auth-resolution.js';
import { createCodexImageBackendResolver } from './openai/codexImageBackendResolver.js';
import type { ImageBackendAuth } from './imageBackendAuth.js';

const directories: string[] = [];

async function keyPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'llxprt-image-auth-'));
  directories.push(directory);
  return join(directory, 'key');
}

const resolveKey = createImageApiKeyResolver({
  getKeyStorage: () => ({
    getKey: async (name) =>
      new Map([['image', 'image-secret']]).get(name) ?? null,
  }),
});

describe('image credential resolution', () => {
  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });
  it('looks up the selected named key', async () => {
    expect(await resolveKey({ type: 'named-key', keyName: 'image' })).toBe(
      'image-secret',
    );
  });

  it('reports the missing key name with a typed error', async () => {
    const result = resolveKey({ type: 'named-key', keyName: 'missing-image' });
    await expect(result).rejects.toBeInstanceOf(ImageCredentialError);
    await expect(result).rejects.toMatchObject({
      code: 'named_key_missing',
      reference: 'missing-image',
    });
  });

  it.each([
    ['secret', 'secret'],
    ['secret\n', 'secret'],
    ['secret\r\n', 'secret'],
    [' secret \n\n', ' secret \n'],
  ])(
    'removes at most one trailing newline from keyfile %j',
    async (content, expected) => {
      const path = await keyPath();
      await writeFile(path, content);
      expect(await resolveKey({ type: 'keyfile', path })).toBe(expected);
    },
  );

  it('reports unreadable keyfiles without exposing their contents', async () => {
    const path = await keyPath();
    const result = resolveKey({ type: 'keyfile', path });
    await expect(result).rejects.toBeInstanceOf(ImageCredentialError);
    await expect(result).rejects.toMatchObject({
      code: 'keyfile_unreadable',
      reference: path,
    });
  });

  it('passes literal credentials through without trimming', async () => {
    expect(await resolveKey({ type: 'api-key', apiKey: ' literal\n' })).toBe(
      ' literal\n',
    );
  });

  it('returns no credential for none', async () => {
    expect(await resolveKey({ type: 'none' })).toBeUndefined();
  });

  it('uses the existing Codex token source and keeps identity paired', async () => {
    const source: NonNullable<ImageApiKeyResolverDeps['oauthManager']> = {
      getOAuthToken: async () => ({
        access_token: 'codex-token',
        account_id: 'account',
        expiry: 9999999999,
        token_type: 'Bearer',
      }),
    };
    const resolve = createImageApiKeyResolver({ oauthManager: source });
    expect(await resolve({ type: 'oauth', provider: 'codex' })).toBe(
      'codex-token',
    );
    expect(await resolveCodexImageCredential(source)).toStrictEqual({
      accessToken: 'codex-token',
      accountId: 'account',
    });
  });

  it('preserves failures from the Codex token source', async () => {
    const failure = new ImageCredentialError(
      'oauth_unavailable',
      'Refresh failed',
    );
    const resolve = createImageApiKeyResolver({
      oauthManager: {
        getOAuthToken: async () => {
          throw failure;
        },
      },
    });
    await expect(resolve({ type: 'oauth', provider: 'codex' })).rejects.toBe(
      failure,
    );
  });

  it('reports missing OAuth machinery with a typed error', async () => {
    await expect(
      resolveKey({ type: 'oauth', provider: 'codex' }),
    ).rejects.toBeInstanceOf(ImageCredentialError);
  });

  it.each<ImageBackendAuth>([
    { type: 'none' },
    { type: 'api-key', apiKey: 'image-secret' },
    { type: 'named-key', keyName: 'image' },
    { type: 'keyfile', path: '' },
  ])(
    'sends only profile credentials without chat auth or OAuth: %j',
    async (auth) => {
      const path = await keyPath();
      await writeFile(path, 'image-secret\n');
      const profileAuth = auth.type === 'keyfile' ? { ...auth, path } : auth;
      const headers: Headers[] = [];
      const fetchImpl: typeof fetch = async (
        _input: string | URL | Request,
        init?: RequestInit,
      ) => {
        headers.push(new Headers(init?.headers));
        return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
      };
      const backend = createCodexImageBackendResolver({
        oauthManager: undefined,
        getActiveProvider: () => {
          throw new Error('Conversational credentials must not be consulted');
        },
        getActiveImageProfile: () => ({
          version: 1,
          type: 'image',
          backend: 'openai-images',
          model: 'image-model',
          baseUrl:
            auth.type === 'none'
              ? 'http://localhost:8321/v1'
              : 'https://images.example/v1',
          auth: profileAuth,
        }),
        getImageApiKey: resolveKey,
        fetchImpl,
      })();
      if (backend === null) throw new Error('Expected image backend');
      await backend.generate({ prompt: 'cat' }, new AbortController().signal);
      const inputPath = `${await keyPath()}.png`;
      await writeFile(
        inputPath,
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
      );
      await backend.edit(
        { prompt: 'dog', inputPaths: [inputPath] },
        new AbortController().signal,
      );
      const expected = auth.type === 'none' ? null : 'Bearer image-secret';
      expect(
        headers.map((header) => header.get('authorization')),
      ).toStrictEqual([expected, expected]);
    },
  );

  it('rejects an absent resolved credential before sending a request', async () => {
    const backend = createCodexImageBackendResolver({
      oauthManager: undefined,
      getActiveProvider: () => undefined,
      getActiveImageProfile: () => ({
        version: 1,
        type: 'image',
        backend: 'openai-images',
        model: 'image-model',
        baseUrl: 'https://images.example/v1',
        auth: { type: 'named-key', keyName: 'image' },
      }),
      getImageApiKey: async () => undefined,
      fetchImpl: async () => {
        throw new Error('Unauthenticated request escaped');
      },
    })();
    if (backend === null) throw new Error('Expected image backend');
    await expect(
      backend.generate({ prompt: 'cat' }, new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Image profile credential is missing.',
    });
  });

  it('resolves named credentials again for each operation and never falls back after removal', async () => {
    const keys = new Map([['image', 'first']]);
    const headers: Headers[] = [];
    const fetchImpl: typeof fetch = async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      headers.push(new Headers(init?.headers));
      return Response.json({ data: [{ b64_json: 'aGVsbG8=' }] });
    };
    const backend = createCodexImageBackendResolver({
      oauthManager: undefined,
      getActiveProvider: () => {
        throw new Error('No chat fallback');
      },
      getActiveImageProfile: () => ({
        version: 1,
        type: 'image',
        backend: 'openai-images',
        model: 'image-model',
        baseUrl: 'https://images.example/v1',
        auth: { type: 'named-key', keyName: 'image' },
      }),
      getImageApiKey: createImageApiKeyResolver({
        getKeyStorage: () => ({
          getKey: async (name) => keys.get(name) ?? null,
        }),
      }),
      fetchImpl,
    })();
    if (backend === null) throw new Error('Expected image backend');
    await backend.generate({ prompt: 'cat' }, new AbortController().signal);
    keys.set('image', 'second');
    const inputPath = `${await keyPath()}.png`;
    await writeFile(
      inputPath,
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
    );
    await backend.edit(
      { prompt: 'dog', inputPaths: [inputPath] },
      new AbortController().signal,
    );
    keys.delete('image');
    await expect(
      backend.generate({ prompt: 'bird' }, new AbortController().signal),
    ).rejects.toBeInstanceOf(ImageCredentialError);
    expect(headers.map((header) => header.get('authorization'))).toStrictEqual([
      'Bearer first',
      'Bearer second',
    ]);
  });
});
