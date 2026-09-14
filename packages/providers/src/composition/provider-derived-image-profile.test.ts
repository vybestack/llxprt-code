/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage, parseImageProfile } from '@vybestack/llxprt-code-settings';
import {
  buildProviderDerivedImageProfile,
  ImageProviderAliasError,
} from './provider-derived-image-profile.js';
import { getImageModelsForAlias } from './providerAliases.js';
import { resolveImageProfileBackendConfig } from '../openai/codexImageBackendResolver.js';

describe('provider-derived image profiles', () => {
  let directory: string;
  let storage: ReturnType<typeof spyOn<typeof Storage, 'getGlobalDataDir'>>;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'llxprt-image-alias-'));
    mkdirSync(join(directory, 'providers'));
    storage = spyOn(Storage, 'getGlobalDataDir').mockReturnValue(directory);
  });
  afterEach(() => {
    storage.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  });
  function alias(name: string, fields: Record<string, unknown>): void {
    writeFileSync(
      join(directory, 'providers', `${name}.config`),
      JSON.stringify({
        name,
        baseProvider: 'openai',
        defaultModel: 'fallback-model',
        ...fields,
      }),
    );
  }
  function roundTrip(
    name: string,
  ): ReturnType<typeof buildProviderDerivedImageProfile> {
    const profile = buildProviderDerivedImageProfile(name);
    expect(
      parseImageProfile(name, JSON.parse(JSON.stringify(profile))),
    ).toEqual(profile);
    return profile;
  }
  it('uses Codex OAuth and its first image model without a URL override', () => {
    const profile = roundTrip('codex');
    expect(profile).toEqual({
      version: 1,
      type: 'image',
      backend: 'codex',
      model: 'gpt-image-2',
      auth: { type: 'oauth', provider: 'codex' },
    });
    expect(resolveImageProfileBackendConfig(profile).baseUrl).toBe(
      'https://chatgpt.com/backend-api/codex',
    );
  });
  it('uses local alias defaults without authentication', () => {
    expect(roundTrip('LM Studio')).toMatchObject({
      backend: 'openai-images',
      baseUrl: 'http://127.0.0.1:1234/v1/',
      auth: { type: 'none' },
      model: 'gemma-3b-it',
    });
  });
  it('uses no authentication for loopback even without requires-auth', () => {
    alias('loopback', {
      'base-url': 'http://[::1]:8080/v1',
      imageModels: ['first', 'second'],
    });
    expect(roundTrip('loopback')).toMatchObject({
      auth: { type: 'none' },
      model: 'first',
    });
  });
  it('uses no authentication when a remote alias disables it', () => {
    alias('public-image', {
      'base-url': 'https://images.example/v1',
      'requires-auth': false,
    });
    expect(roundTrip('public-image')).toMatchObject({
      auth: { type: 'none' },
      model: 'fallback-model',
    });
  });
  it('uses the alias name as the remote key reference', () => {
    alias('remote-image', {
      'base-url': 'https://images.example/v1',
      imageModels: ['image-model'],
    });
    expect(roundTrip('remote-image')).toMatchObject({
      backend: 'openai-images',
      baseUrl: 'https://images.example/v1',
      auth: { type: 'named-key', keyName: 'remote-image' },
      model: 'image-model',
    });
  });
  it('reports the unknown alias and available aliases in a typed error', () => {
    expect(() => buildProviderDerivedImageProfile('missing-image')).toThrow(
      ImageProviderAliasError,
    );
    expect(() => buildProviderDerivedImageProfile('missing-image')).toThrow(
      /missing-image.*Available aliases:.*codex/,
    );
  });
  it('keeps a URL mandatory for OpenAI-compatible profiles', () => {
    expect(() =>
      parseImageProfile('incomplete', {
        version: 1,
        type: 'image',
        backend: 'openai-images',
        model: 'image',
        auth: { type: 'none' },
      }),
    ).toThrow();
  });
  for (const imageModels of [null, 'not-an-array', [3], ['']]) {
    it(`ignores malformed imageModels ${JSON.stringify(imageModels)}`, () => {
      alias('invalid-models', {
        'base-url': 'http://localhost:8080/v1',
        imageModels,
      });
      expect(getImageModelsForAlias('invalid-models')).toEqual([]);
      expect(roundTrip('invalid-models').model).toBe('fallback-model');
    });
  }
});
