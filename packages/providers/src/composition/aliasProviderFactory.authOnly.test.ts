/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral regression tests for authOnly gating of alias-provider API-key
 * resolution (@issue #3546). When authOnly is enabled, an alias's apiKeyEnv
 * environment variable must NOT become the provider API key; explicitly
 * resolved upstream keys must still flow through. Mirrors the gating
 * createAnthropicAliasProvider already applies.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { OAuthManager } from '../auth/oauth-manager.js';

import {
  createOpenAIAliasProvider,
  createOpenAIResponsesAliasProvider,
  createOpenAIVercelAliasProvider,
} from './aliasProviderFactory.js';
import type { ProviderAliasEntry } from './providerAliases.js';
import type { IProviderConfig } from '../types/IProviderConfig.js';

const ENV_KEY_NAME = 'LLXPRT_ALIAS_AUTHONLY_TEST_KEY';
const ENV_KEY_VALUE = 'sk-env-alias-key';
const EXPLICIT_UPSTREAM_KEY = 'sk-explicit-upstream';

const NULL_OAUTH_MANAGER: OAuthManager = {
  getToken: async () => null,
  isAuthenticated: async () => false,
} as unknown as OAuthManager;

const EMPTY_PROVIDER_CONFIG: IProviderConfig = {};

function makeAuthOnlyProbeEntry(baseProvider: string): ProviderAliasEntry {
  return {
    alias: `authonly-probe-${baseProvider}`,
    config: {
      baseProvider,
      'base-url': 'https://alias-factory-authonly.test/v1',
      apiKeyEnv: ENV_KEY_NAME,
    },
    filePath: `authonly-probe-${baseProvider}.config`,
    source: 'builtin',
  };
}

type AliasProviderWithBaseConfig = {
  baseProviderConfig?: { apiKey?: string };
};

/**
 * Reads the API key the factory handed to the real provider constructor.
 * Every alias provider stores its constructor key on baseProviderConfig,
 * which is the value request-time auth would send.
 */
function storedApiKey(provider: object | null): string | undefined {
  const withBaseConfig = provider as unknown as AliasProviderWithBaseConfig;
  return withBaseConfig.baseProviderConfig?.apiKey;
}

type AliasProviderFactoryFn = (
  entry: ProviderAliasEntry,
  openaiApiKey: string | undefined,
  authOnlyEnabled: boolean,
) => object | null;

const ALIAS_FACTORIES: ReadonlyArray<{
  readonly label: string;
  readonly create: AliasProviderFactoryFn;
}> = [
  {
    label: 'openai',
    create: (entry, openaiApiKey, authOnlyEnabled) =>
      createOpenAIAliasProvider(
        entry,
        openaiApiKey,
        undefined,
        EMPTY_PROVIDER_CONFIG,
        authOnlyEnabled,
      ),
  },
  {
    label: 'openai-responses',
    create: (entry, openaiApiKey, authOnlyEnabled) =>
      createOpenAIResponsesAliasProvider(
        entry,
        openaiApiKey,
        undefined,
        EMPTY_PROVIDER_CONFIG,
        NULL_OAUTH_MANAGER,
        authOnlyEnabled,
      ),
  },
  {
    label: 'openai-vercel',
    create: (entry, openaiApiKey, authOnlyEnabled) =>
      createOpenAIVercelAliasProvider(
        entry,
        openaiApiKey,
        undefined,
        EMPTY_PROVIDER_CONFIG,
        authOnlyEnabled,
      ),
  },
];

for (const { label, create } of ALIAS_FACTORIES) {
  describe(`authOnly API-key gating for ${label} alias providers (@issue:3546)`, () => {
    beforeEach(() => {
      process.env[ENV_KEY_NAME] = ENV_KEY_VALUE;
    });

    afterEach(() => {
      delete process.env[ENV_KEY_NAME];
    });

    it('does not use the apiKeyEnv environment key when authOnly is enabled', () => {
      const provider = create(makeAuthOnlyProbeEntry(label), undefined, true);

      expect(provider).not.toBeNull();
      expect(storedApiKey(provider)).toBeUndefined();
    });

    it('still receives an explicitly resolved upstream key when authOnly is enabled', () => {
      const provider = create(
        makeAuthOnlyProbeEntry(label),
        EXPLICIT_UPSTREAM_KEY,
        true,
      );

      expect(provider).not.toBeNull();
      expect(storedApiKey(provider)).toBe(EXPLICIT_UPSTREAM_KEY);
    });

    it('uses the apiKeyEnv environment key when authOnly is not enabled', () => {
      const provider = create(makeAuthOnlyProbeEntry(label), undefined, false);

      expect(provider).not.toBeNull();
      expect(storedApiKey(provider)).toBe(ENV_KEY_VALUE);
    });
  });
}
