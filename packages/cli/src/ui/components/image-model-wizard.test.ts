/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { getModelRegistry } from '@vybestack/llxprt-code-core';
import { listImageModelChoices } from './imageModelWizard.js';

let directory: string;
let data: ReturnType<typeof spyOn<typeof Storage, 'getGlobalDataDir'>>;
let cache: ReturnType<typeof spyOn<typeof Storage, 'getGlobalCacheDir'>>;
describe('provider image model lists', () => {
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'llxprt-image-list-'));
    mkdirSync(join(directory, 'providers'));
    data = spyOn(Storage, 'getGlobalDataDir').mockReturnValue(directory);
    cache = spyOn(Storage, 'getGlobalCacheDir').mockReturnValue(directory);
    writeFileSync(
      join(directory, 'models.json'),
      JSON.stringify({
        openai: {
          id: 'openai',
          name: 'OpenAI',
          env: [],
          models: {
            painter: {
              id: 'painter',
              name: 'Painter',
              modalities: { input: ['text'], output: ['image'] },
              limit: { context: 4096, output: 1024 },
              release_date: '2026-09-14',
              open_weights: false,
            },
            chat: {
              id: 'chat',
              name: 'Chat',
              modalities: { input: ['image'], output: ['text'] },
              limit: { context: 4096, output: 1024 },
              release_date: '2026-09-14',
              open_weights: false,
            },
          },
        },
      }),
    );
  });
  afterEach(() => {
    getModelRegistry().dispose();
    data.mockRestore();
    cache.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  });

  it('uses the Codex static list instead of registry models', async () => {
    expect(await listImageModelChoices('codex')).toStrictEqual([
      'gpt-image-2',
      'gpt-image-1',
    ]);
  });
  it('lists every local endpoint model without capability filtering', async () => {
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json({ data: [{ id: 'text-model' }, { id: 'flux' }] });
    };
    expect(
      await listImageModelChoices('LM Studio', { fetchImpl }),
    ).toStrictEqual(['text-model', 'flux']);
    expect(requests).toStrictEqual(['http://127.0.0.1:1234/v1/models']);
  });
  it('uses models.dev image output capabilities for remote providers', async () => {
    expect(await listImageModelChoices('openai')).toStrictEqual(['painter']);
  });
  it('returns an empty list when a registered remote alias has no known image models', async () => {
    writeFileSync(
      join(directory, 'providers', 'unknown-models.config'),
      JSON.stringify({
        name: 'unknown-models',
        baseProvider: 'openai',
        'base-url': 'https://example.com/v1',
        defaultModel: 'chat',
      }),
    );
    expect(await listImageModelChoices('unknown-models')).toStrictEqual([]);
  });
  it('preserves typed local endpoint failures without a manual entry', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(null, { status: 503 });
    await expect(
      listImageModelChoices('LM Studio', { fetchImpl }),
    ).rejects.toMatchObject({ name: 'ImageBackendError' });
  });
  it('reports an unknown alias with its available aliases', async () => {
    await expect(listImageModelChoices('missing-alias')).rejects.toMatchObject({
      name: 'ImageProviderAliasError',
      aliasName: 'missing-alias',
    });
  });
});
