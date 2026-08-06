/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { debugLogger } from '@vybestack/llxprt-code-core';

import {
  loadProviderAliasEntries,
  type ProviderAliasConfig,
} from './providerAliases.js';

async function loadWithTempConfig(
  tmpDir: string,
  filename: string,
  config: Record<string, unknown>,
) {
  const { Storage } = await import('@vybestack/llxprt-code-settings');
  const fakeLlxprtDir = path.join(tmpDir, '.llxprt');
  const fakeProvidersDir = path.join(fakeLlxprtDir, 'providers');
  fs.mkdirSync(fakeProvidersDir, { recursive: true });

  const configPath = path.join(fakeProvidersDir, filename);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  vi.spyOn(Storage, 'getGlobalDataDir').mockReturnValue(fakeLlxprtDir);

  try {
    return loadProviderAliasEntries();
  } finally {
    vi.mocked(Storage.getGlobalDataDir).mockRestore();
  }
}

function baseConfig(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    name: 'testalias',
    baseProvider: 'openai',
    'base-url': 'https://example.com/v1',
    ...overrides,
  };
}

describe('providerAliases mediaSupport sanitization', () => {
  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alias-media-'));
    warnSpy = vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a well-formed mediaSupport block', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'good.config', {
      ...baseConfig({
        mediaSupport: {
          inlineImages: true,
          fileUpload: true,
          videoSupport: false,
        },
      }),
    });

    const entry = entries.find((e) => e.alias === 'testalias');
    expect(entry?.config.mediaSupport).toStrictEqual({
      inlineImages: true,
      fileUpload: true,
      videoSupport: false,
    });
  });

  it('strips non-boolean fields from mediaSupport', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'mixed.config', {
      ...baseConfig({
        mediaSupport: {
          inlineImages: true,
          fileUpload: 'yes',
          videoSupport: false,
          extraField: 42,
        },
      }),
    });

    const entry = entries.find((e) => e.alias === 'testalias');
    expect(entry?.config.mediaSupport).toStrictEqual({
      inlineImages: true,
      videoSupport: false,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('non-boolean mediaSupport.fileUpload'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown mediaSupport.extraField'),
    );
  });

  it('removes mediaSupport when it is not an object', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'bad.config', {
      ...baseConfig({
        mediaSupport: 'not-an-object',
      }),
    });

    const entry = entries.find((e) => e.alias === 'testalias');
    expect(entry?.config.mediaSupport).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('non-object mediaSupport'),
    );
  });

  it('removes mediaSupport when all fields are invalid', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'empty.config', {
      ...baseConfig({
        mediaSupport: {
          inlineImages: 'true',
          fileUpload: null,
          videoSupport: undefined,
        },
      }),
    });

    const entry = entries.find((e) => e.alias === 'testalias');
    expect(entry?.config.mediaSupport).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('non-boolean mediaSupport.inlineImages'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('non-boolean mediaSupport.fileUpload'),
    );
  });

  it('defaults mediaSupport to undefined when not present', async () => {
    const entries = await loadWithTempConfig(
      tmpDir,
      'none.config',
      baseConfig({}),
    );

    const entry = entries.find((e) => e.alias === 'testalias');
    expect(entry?.config.mediaSupport).toBeUndefined();
  });

  it('accepts partial mediaSupport with only some fields', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'partial.config', {
      ...baseConfig({
        mediaSupport: {
          fileUpload: true,
        },
      }),
    });

    const entry = entries.find((e) => e.alias === 'testalias');
    expect(entry?.config.mediaSupport).toStrictEqual({ fileUpload: true });
  });

  it('rejects array as mediaSupport', async () => {
    const entries = await loadWithTempConfig(tmpDir, 'array.config', {
      ...baseConfig({
        mediaSupport: [true, false],
      }),
    });

    const entry = entries.find((e) => e.alias === 'testalias');
    expect(entry?.config.mediaSupport).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('non-object mediaSupport'),
    );
  });
});

describe('ProviderAliasConfig type surface', () => {
  it('exposes mediaSupport on the interface', () => {
    const config: ProviderAliasConfig = {
      baseProvider: 'openai',
      mediaSupport: {
        inlineImages: true,
        fileUpload: false,
        videoSupport: false,
      },
    };
    expect(config.mediaSupport?.inlineImages).toBe(true);
  });
});
