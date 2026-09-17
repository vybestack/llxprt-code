/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth/index.js';
import { GeminiProvider } from './gemini/GeminiProvider.js';
import { llxprtRuntimePlugin } from './index.js';

interface PluginManifest {
  name?: string;
  version?: string;
  llxprt?: { runtimePlugin?: boolean };
}

const packageJson = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../package.json', import.meta.url)),
    'utf8',
  ),
) as PluginManifest;

describe('@vybestack/llxprt-plugin-google-gemini manifest', () => {
  it('declares the runtime plugin marker the host discovery scans for', () => {
    expect(packageJson.llxprt).toStrictEqual({ runtimePlugin: true });
  });

  it('exports a manifest v1 whose id is the package name', () => {
    expect(llxprtRuntimePlugin.apiVersion).toBe(1);
    expect(packageJson.name).toBe(llxprtRuntimePlugin.id);
    expect(llxprtRuntimePlugin.providers.length).toBeGreaterThanOrEqual(1);
  });

  it('contributes the gemini provider backed by the extracted GeminiProvider', () => {
    const [contribution] = llxprtRuntimePlugin.providers;
    expect(contribution?.providerId).toBe('gemini');
    expect(typeof contribution?.createProvider).toBe('function');

    const provider = contribution?.createProvider(
      {
        alias: 'gemini',
        config: {
          name: 'gemini',
          baseProvider: 'gemini',
          'base-url': 'https://generativelanguage.googleapis.com',
        },
        filePath: 'plugin-builtin:gemini',
        source: 'plugin',
      },
      {
        openaiApiKey: undefined,
        openaiBaseUrl: undefined,
        openaiProviderConfig: {},
          oauthManager: undefined as unknown as OAuthManager,
        config: undefined,
        authOnlyEnabled: false,
      },
    );
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.name).toBe('gemini');
  });

  it('contributes the built-in gemini alias config byte-for-byte from the former base alias', () => {
    const [contribution] = llxprtRuntimePlugin.providers;
    expect(contribution?.builtinAliases).toStrictEqual([
      {
        alias: 'gemini',
        config: {
          name: 'gemini',
          modelsDevProviderId: 'google',
          description: 'Google Gemini API',
          baseProvider: 'gemini',
          'base-url': 'https://generativelanguage.googleapis.com',
          defaultModel: 'gemini-2.5-pro',
          apiKeyEnv: 'GEMINI_API_KEY',
        },
      },
    ]);
  });

  it('binds the alias api key from apiKeyEnv through the host helper', () => {
    process.env.GEMINI_API_KEY = 'sk-plugin-alias-key';
    try {
      const [contribution] = llxprtRuntimePlugin.providers;
      const provider = contribution?.createProvider(
        {
          alias: 'gemini',
          config: {
            name: 'gemini',
            baseProvider: 'gemini',
            apiKeyEnv: 'GEMINI_API_KEY',
          },
          filePath: 'plugin-builtin:gemini',
          source: 'plugin',
        },
        {
          openaiApiKey: undefined,
          openaiBaseUrl: undefined,
          openaiProviderConfig: {},
        // The gemini factory never reads the OAuth manager, so undefined stands
        // in for it; the context type requires a value, hence the cast.
        oauthManager: undefined as unknown as OAuthManager,
          config: undefined,
          authOnlyEnabled: false,
        },
      );
      expect(provider).toBeInstanceOf(GeminiProvider);
    } finally {
      delete process.env.GEMINI_API_KEY;
    }
  });
});
