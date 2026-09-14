/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { getModelRegistry } from './registry.js';
import { listImageOutputModels } from './provider-integration.js';
import type { ModelsDevModel, ModelsDevProvider } from './schema.js';

function model(id: string, output: ('text' | 'image')[]): ModelsDevModel {
  return {
    id,
    name: id,
    modalities: { input: ['text', 'image'], output },
    limit: { context: 4096, output: 1024 },
    release_date: '2026-09-14',
    open_weights: false,
  };
}
function provider(id: string): ModelsDevProvider {
  return {
    id,
    name: id,
    env: [],
    models: {
      painter: model('painter', ['image']),
      chat: model('chat', ['text']),
      mixed: model('mixed', ['text', 'image']),
    },
  };
}

describe('image output models', () => {
  let directory: string;
  let cacheDirectory: ReturnType<
    typeof spyOn<typeof Storage, 'getGlobalCacheDir'>
  >;
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'llxprt-image-models-'));
    cacheDirectory = spyOn(Storage, 'getGlobalCacheDir').mockReturnValue(
      directory,
    );
    writeFileSync(
      join(directory, 'models.json'),
      JSON.stringify({
        openai: provider('openai'),
        google: provider('google'),
        'google-vertex': {
          ...provider('google-vertex'),
          models: { vertex: model('vertex', ['image']) },
        },
      }),
    );
    await getModelRegistry().initialize();
  });
  afterAll(() => {
    getModelRegistry().dispose();
    cacheDirectory.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  });
  it('keeps image outputs and excludes text-only models even with image inputs', () => {
    expect(listImageOutputModels('openai')).toEqual(['painter', 'mixed']);
  });
  it('maps aliases to registry providers', () => {
    expect(listImageOutputModels('codex')).toEqual(['painter', 'mixed']);
  });
  it('includes all mapped providers', () => {
    expect(listImageOutputModels('gemini')).toEqual([
      'painter',
      'mixed',
      'vertex',
    ]);
  });
  it('returns no models for an unknown provider', () => {
    expect(listImageOutputModels('not-a-provider')).toEqual([]);
  });
});
