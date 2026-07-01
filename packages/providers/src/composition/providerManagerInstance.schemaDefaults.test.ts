/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression coverage for issue #2033 Phase 2 relocation.
 *
 * Before the relocation, `providerManagerInstance` read provider settings from
 * the CLI's merged-settings view (`LoadedSettings.merged`), which layered the
 * SETTINGS_SCHEMA defaults on top of the raw user file. After the relocation
 * the composition self-loads the RAW user settings file directly. These tests
 * pin the behavior-preserving requirement that, when a settings field is absent
 * from the user file, the OpenAI provider still receives the schema default
 * (enableTextToolCallParsing=false, textToolCallModels=[],
 * providerToolFormatOverrides={}, openaiResponsesEnabled=false) rather than
 * `undefined`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.unmock('./providerAliases.js');

// Self-load reads run through strip-json-comments; keep them passthrough.
vi.mock('strip-json-comments', () => ({
  default: (content: string) => content,
}));

function mockProviderModules(openaiCtor: unknown): void {
  vi.doMock('../ProviderManager.js', () => {
    class MockProviderManager {
      setConfig(): void {}
      setActiveProvider(): void {}
      registerProvider(): void {}
    }
    return { ProviderManager: MockProviderManager };
  });
  vi.doMock('../gemini/GeminiProvider.js', () => {
    class MockGeminiProvider {
      setConfig(): void {}
    }
    return { GeminiProvider: MockGeminiProvider };
  });
  vi.doMock('../openai/OpenAIProvider.js', () => ({
    OpenAIProvider: openaiCtor,
  }));
  vi.doMock('../openai-responses/OpenAIResponsesProvider.js', () => ({
    OpenAIResponsesProvider: class {},
  }));
  vi.doMock('../openai-vercel/index.js', () => ({
    OpenAIVercelProvider: class {},
  }));
  vi.doMock('../anthropic/AnthropicProvider.js', () => ({
    AnthropicProvider: class {},
  }));
  vi.doMock('./oauth-provider-registration.js', () => ({
    ensureOAuthProviderRegistered: vi.fn(),
    registerStandardOAuthProviders: vi.fn(),
    isOAuthProviderRegistered: vi.fn(),
    resetRegisteredProviders: vi.fn(),
  }));
}

describe('providerManagerInstance schema-default behavior (issue #2033)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('supplies SETTINGS_SCHEMA defaults to OpenAIProvider when the user settings file is absent', async () => {
    const openaiCtor = vi.fn(() => ({}));
    mockProviderModules(openaiCtor);

    const { MockFileSystem } = await import('./IFileSystem.js');
    const { createProviderManager, resetProviderManager, setFileSystem } =
      await import('./providerManagerInstance.js');

    // Empty mock file system => no user settings file on disk.
    setFileSystem(new MockFileSystem());
    resetProviderManager();

    const activeContext: Record<string, unknown> = { scope: 'test' };
    createProviderManager(activeContext, {
      config: undefined,
      allowBrowserEnvironment: false,
    });

    expect(openaiCtor).toHaveBeenCalled();
    const ctorArgs = openaiCtor.mock.calls[0] as unknown[];
    // new OpenAIProvider(apiKey, baseUrl, providerConfig, oauthManager)
    const providerConfig = ctorArgs[2] as Record<string, unknown>;

    expect(providerConfig.enableTextToolCallParsing).toBe(false);
    expect(providerConfig.textToolCallModels).toStrictEqual([]);
    expect(providerConfig.providerToolFormatOverrides).toStrictEqual({});
    expect(providerConfig.openaiResponsesEnabled).toBe(false);
  });

  it('honors explicit user-file values over the schema defaults', async () => {
    const openaiCtor = vi.fn(() => ({}));
    mockProviderModules(openaiCtor);

    const { MockFileSystem } = await import('./IFileSystem.js');
    const { createProviderManager, resetProviderManager, setFileSystem } =
      await import('./providerManagerInstance.js');
    const { Storage } = await import('@vybestack/llxprt-code-settings');

    const fs = new MockFileSystem();
    fs.setMockFile(
      Storage.getGlobalSettingsPath(),
      JSON.stringify({
        enableTextToolCallParsing: true,
        textToolCallModels: ['some-model'],
        providerToolFormatOverrides: { openai: 'hermes' },
        openaiResponsesEnabled: true,
      }),
    );
    setFileSystem(fs);
    resetProviderManager();

    const activeContext: Record<string, unknown> = { scope: 'test' };
    createProviderManager(activeContext, {
      config: undefined,
      allowBrowserEnvironment: false,
    });

    expect(openaiCtor).toHaveBeenCalled();
    const ctorArgs = openaiCtor.mock.calls[0] as unknown[];
    const providerConfig = ctorArgs[2] as Record<string, unknown>;

    expect(providerConfig.enableTextToolCallParsing).toBe(true);
    expect(providerConfig.textToolCallModels).toStrictEqual(['some-model']);
    expect(providerConfig.providerToolFormatOverrides).toStrictEqual({
      openai: 'hermes',
    });
    expect(providerConfig.openaiResponsesEnabled).toBe(true);
  });
});
