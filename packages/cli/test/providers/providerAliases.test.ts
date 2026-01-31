/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// This integration test needs real config files, not the global mock
vi.unmock('../../src/providers/providerAliases.js');
import {
  getProviderManager,
  resetProviderManager,
  setFileSystem,
} from '../../src/providers/providerManagerInstance.js';
import { NodeFileSystem } from '../../src/providers/IFileSystem.js';

describe('Provider alias integration', () => {
  let tempDir: string;
  let originalOpenAIApiKey: string | undefined;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-alias-test-'));
    const llxprtDir = path.join(tempDir, '.llxprt');
    const providersDir = path.join(llxprtDir, 'providers');

    fs.mkdirSync(providersDir, { recursive: true });

    // Minimal settings file to satisfy provider manager initialization
    fs.writeFileSync(
      path.join(llxprtDir, 'settings.json'),
      JSON.stringify({}),
      'utf-8',
    );

    const aliasConfig = {
      baseProvider: 'openai',
      baseUrl: 'https://myotherprovider.com:123/v1/',
      defaultModel: 'my-test-model',
      description: 'Test alias config',
    };

    fs.writeFileSync(
      path.join(providersDir, 'myotherprovider.config'),
      JSON.stringify(aliasConfig, null, 2),
      'utf-8',
    );

    originalOpenAIApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tempDir;
    process.env.USERPROFILE = tempDir;

    resetProviderManager();
    setFileSystem(new NodeFileSystem());
  });

  afterEach(() => {
    if (originalOpenAIApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIApiKey;
    }
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

    resetProviderManager();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('registers user-defined alias providers from ~/.llxprt/providers', () => {
    const providerManager = getProviderManager();

    expect(providerManager.listProviders()).toContain('myotherprovider');

    const aliasProvider = providerManager.getProviderByName('myotherprovider');
    // Provider is wrapped - check the innermost provider via wrappedProvider chain
    let innerProvider = aliasProvider;
    while (
      innerProvider &&
      'wrappedProvider' in innerProvider &&
      innerProvider.wrappedProvider
    ) {
      innerProvider = innerProvider.wrappedProvider as typeof innerProvider;
    }
    expect(innerProvider?.constructor.name).toBe('OpenAIProvider');
    expect(
      Object.prototype.hasOwnProperty.call(
        innerProvider ?? {},
        'providerConfig',
      ),
    ).toBe(true);
    const providerConfig = (
      innerProvider as unknown as { providerConfig?: { defaultModel?: string } }
    ).providerConfig;
    expect(providerConfig?.defaultModel).toBe('my-test-model');
    expect(aliasProvider?.getDefaultModel()).toBe('my-test-model');
  });

  it('includes packaged provider aliases by default', () => {
    const providerManager = getProviderManager();
    expect(providerManager.listProviders()).toContain('Fireworks');
    expect(providerManager.listProviders()).toContain('OpenRouter');
  });
});
