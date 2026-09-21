/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2616 PR A — getHigherPriorityAuth receives its settings reader
 * explicitly instead of consulting the deleted ambient runtime settings
 * service. The authOnly global flows through the explicit reader; when no
 * reader is supplied the authOnly check is skipped exactly as today's
 * catch branch did.
 */

import { describe, expect, it } from 'bun:test';
import { getHigherPriorityAuth } from './provider-usage-info.js';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';

interface ExplicitSettingsReader {
  get(key: string): unknown;
}

function buildOAuthSettings(
  overrides: Partial<Pick<IOAuthSettingsProvider, 'getProviderApiKey'>> = {},
): IOAuthSettingsProvider {
  return {
    isOAuthEnabled: () => false,
    getProviderApiKey: () => undefined,
    getProviderKeyfile: () => undefined,
    getProviderBaseUrl: () => undefined,
    getOAuthEnabledProviders: () => ({}),
    setOAuthEnabled: () => undefined,
    ...overrides,
  };
}

describe('getHigherPriorityAuth explicit settings reader', () => {
  it('skips the authOnly short-circuit when the reader reports authOnly disabled', async () => {
    const oauthSettings = buildOAuthSettings({
      getProviderApiKey: () => 'stored-key',
    });
    const reader: ExplicitSettingsReader = {
      get: (key) => (key === 'authOnly' ? false : undefined),
    };

    const result = await getHigherPriorityAuth(
      'test-provider',
      oauthSettings,
      reader,
    );

    expect(result).toBe('API Key');
  });

  it('returns null when the explicit reader reports authOnly enabled, even with a stored key', async () => {
    const oauthSettings = buildOAuthSettings({
      getProviderApiKey: () => 'stored-key',
    });
    const reader: ExplicitSettingsReader = {
      get: (key) => (key === 'authOnly' ? true : undefined),
    };

    const result = await getHigherPriorityAuth(
      'test-provider',
      oauthSettings,
      reader,
    );

    expect(result).toBeNull();
  });

  it('skips the authOnly check when no reader is supplied', async () => {
    const oauthSettings = buildOAuthSettings({
      getProviderApiKey: () => 'stored-key',
    });

    const result = await getHigherPriorityAuth(
      'test-provider',
      oauthSettings,
      undefined,
    );

    expect(result).toBe('API Key');
  });

  it('reports the environment variable credential independent of the reader', async () => {
    const oauthSettings = buildOAuthSettings();
    const reader: ExplicitSettingsReader = {
      get: () => undefined,
    };
    // getHigherPriorityAuth derives the env var verbatim from the provider
    // name (`${providerName.toUpperCase()}_API_KEY`), so hyphens survive.
    const envKey = 'TEST-PROVIDER-HIGHER-PRIORITY_API_KEY';
    process.env[envKey] = 'env-key';

    try {
      const result = await getHigherPriorityAuth(
        'test-provider-higher-priority',
        oauthSettings,
        reader,
      );
      expect(result).toBe('Environment Variable');
    } finally {
      delete process.env[envKey];
    }
  });
});
