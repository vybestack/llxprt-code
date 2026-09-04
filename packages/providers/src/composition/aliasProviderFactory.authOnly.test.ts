/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Alias providers built while authOnly is on must not authenticate from
 * ambient environment credentials.
 *
 * `resolveAliasEnvApiKey` already refuses to bind the key an alias names in
 * its own `apiKeyEnv`, but every concrete provider hardcodes its own
 * `envKeyNames` (OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY,
 * GOOGLE_API_KEY). AuthPrecedenceResolver skips that environment fallback only
 * while the settings service it resolves against reports authOnly, whereas the
 * factories decide authOnly from ephemeral config and merged user settings
 * (resolveAuthOnlyFlag). When those two sources disagree, the alias was
 * constructed under authOnly yet still authenticated from the environment.
 * The factories therefore have to fail closed at construction time.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  createAnthropicAliasProvider,
  createGeminiAliasProvider,
  createOpenAIAliasProvider,
  createOpenAIResponsesAliasProvider,
  createOpenAIVercelAliasProvider,
} from './aliasProviderFactory.js';
import type { OAuthManager } from '../auth/index.js';
import type { ProviderAliasEntry } from './providerAliases.js';

/**
 * The responses factory takes the concrete OAuthManager. These tests only need
 * it to report no OAuth credential, so the precedence chain falls through to
 * the environment fallback under test; a stub of the two methods that chain
 * calls stands in for the full manager.
 */
const NULL_OAUTH_MANAGER = {
  getToken: async () => null,
  isAuthenticated: async () => false,
} as unknown as OAuthManager;

const ALIAS_BASE_URL = 'https://alias.invalid/v1';

/**
 * The environment variables the concrete providers read on their own. The
 * aliases below deliberately declare no `apiKeyEnv`, so nothing but these
 * hardcoded provider-level names can supply a credential.
 */
const ENV_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
] as const;

type AliasBaseProvider =
  | 'openai'
  | 'openai-responses'
  | 'openai-vercel'
  | 'anthropic'
  | 'gemini';

/** The authentication surface every alias provider inherits from BaseProvider. */
interface AliasAuthProbe {
  setRuntimeSettingsService(settingsService: SettingsService): void;
  isAuthenticated(): Promise<boolean>;
  getAuthMethodName(): Promise<string | null>;
}

function aliasEntry(baseProvider: AliasBaseProvider): ProviderAliasEntry {
  return {
    alias: `${baseProvider}-authonly-alias`,
    config: { baseProvider, 'base-url': ALIAS_BASE_URL },
    filePath: `/virtual/${baseProvider}-authonly-alias.config`,
    source: 'builtin',
  };
}

/**
 * Builds an alias provider through the real factory the composition root uses
 * for that base provider, with no key of its own so only the provider's
 * hardcoded environment names can authenticate it.
 */
function buildAliasProvider(
  baseProvider: AliasBaseProvider,
  authOnlyEnabled: boolean,
): AliasAuthProbe {
  const entry = aliasEntry(baseProvider);
  const provider = ((): AliasAuthProbe | null => {
    switch (baseProvider) {
      case 'openai':
        return createOpenAIAliasProvider(
          entry,
          undefined,
          undefined,
          {},
          authOnlyEnabled,
        );
      case 'openai-responses':
        return createOpenAIResponsesAliasProvider(
          entry,
          undefined,
          undefined,
          {},
          NULL_OAUTH_MANAGER,
          authOnlyEnabled,
        );
      case 'openai-vercel':
        return createOpenAIVercelAliasProvider(
          entry,
          undefined,
          undefined,
          {},
          authOnlyEnabled,
        );
      case 'anthropic':
        return createAnthropicAliasProvider(entry, undefined, authOnlyEnabled);
      case 'gemini':
        return createGeminiAliasProvider(entry, undefined, authOnlyEnabled);
      default:
        return null;
    }
  })();

  if (!provider) {
    throw new Error(`${baseProvider} alias provider was not created`);
  }
  return provider;
}

/**
 * Resolves the alias against a settings service, which is what the runtime
 * consults. An empty service reports no authOnly, reproducing the divergence
 * from the ephemeral setting the factories were built with.
 */
async function resolveAliasAuth(
  provider: AliasAuthProbe,
  settings: SettingsService,
): Promise<{ authenticated: boolean; method: string | null }> {
  provider.setRuntimeSettingsService(settings);
  return {
    authenticated: await provider.isAuthenticated(),
    method: await provider.getAuthMethodName(),
  };
}

describe('alias provider factories under authOnly', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  let runtimeSettings: SettingsService;

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    // The runtime settings service that does not carry the ephemeral authOnly
    // the factories were given.
    runtimeSettings = new SettingsService();
  });

  afterEach(() => {
    process.env = environmentSnapshot;
  });

  describe('refuses ambient environment credentials', () => {
    it('does not authenticate an openai alias from OPENAI_API_KEY', async () => {
      process.env.OPENAI_API_KEY = 'sk-ambient-openai';

      const auth = await resolveAliasAuth(
        buildAliasProvider('openai', true),
        runtimeSettings,
      );

      expect(auth).toStrictEqual({ authenticated: false, method: null });
    });

    it('does not authenticate an openai-responses alias from OPENAI_API_KEY', async () => {
      process.env.OPENAI_API_KEY = 'sk-ambient-openai';

      const auth = await resolveAliasAuth(
        buildAliasProvider('openai-responses', true),
        runtimeSettings,
      );

      expect(auth).toStrictEqual({ authenticated: false, method: null });
    });

    it('does not authenticate an openai-vercel alias from OPENAI_API_KEY', async () => {
      process.env.OPENAI_API_KEY = 'sk-ambient-openai';

      const auth = await resolveAliasAuth(
        buildAliasProvider('openai-vercel', true),
        runtimeSettings,
      );

      expect(auth).toStrictEqual({ authenticated: false, method: null });
    });

    it('does not authenticate an anthropic alias from ANTHROPIC_API_KEY', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ambient-anthropic';

      const auth = await resolveAliasAuth(
        buildAliasProvider('anthropic', true),
        runtimeSettings,
      );

      expect(auth).toStrictEqual({ authenticated: false, method: null });
    });

    it('does not authenticate a gemini alias from GEMINI_API_KEY', async () => {
      process.env.GEMINI_API_KEY = 'sk-ambient-gemini';

      const auth = await resolveAliasAuth(
        buildAliasProvider('gemini', true),
        runtimeSettings,
      );

      expect(auth).toStrictEqual({ authenticated: false, method: null });
    });

    it('does not authenticate a gemini alias from GOOGLE_API_KEY', async () => {
      // The Gemini provider declares two environment names; clearing only the
      // first would leave the second as a way in.
      process.env.GOOGLE_API_KEY = 'sk-ambient-google';

      const auth = await resolveAliasAuth(
        buildAliasProvider('gemini', true),
        runtimeSettings,
      );

      expect(auth).toStrictEqual({ authenticated: false, method: null });
    });

    it('still refuses OPENAI_API_KEY when the runtime settings service reports authOnly too', async () => {
      process.env.OPENAI_API_KEY = 'sk-ambient-openai';
      runtimeSettings.set('authOnly', true);

      const auth = await resolveAliasAuth(
        buildAliasProvider('openai', true),
        runtimeSettings,
      );

      expect(auth).toStrictEqual({ authenticated: false, method: null });
    });
  });

  describe('leaves environment credentials alone when authOnly is off', () => {
    it('authenticates an openai alias from OPENAI_API_KEY', async () => {
      process.env.OPENAI_API_KEY = 'sk-ambient-openai';

      const auth = await resolveAliasAuth(
        buildAliasProvider('openai', false),
        runtimeSettings,
      );

      expect(auth).toStrictEqual({
        authenticated: true,
        method: 'env-openai_api_key',
      });
    });

    it('authenticates an anthropic alias from ANTHROPIC_API_KEY', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ambient-anthropic';

      const auth = await resolveAliasAuth(
        buildAliasProvider('anthropic', false),
        runtimeSettings,
      );

      expect(auth).toStrictEqual({
        authenticated: true,
        method: 'env-anthropic_api_key',
      });
    });

    it('authenticates a gemini alias from GEMINI_API_KEY', async () => {
      process.env.GEMINI_API_KEY = 'sk-ambient-gemini';

      const auth = await resolveAliasAuth(
        buildAliasProvider('gemini', false),
        runtimeSettings,
      );

      expect(auth).toStrictEqual({
        authenticated: true,
        method: 'env-gemini_api_key',
      });
    });
  });
});
