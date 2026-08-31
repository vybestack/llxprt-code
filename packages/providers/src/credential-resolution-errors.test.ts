/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { CredentialResolutionError } from '@vybestack/llxprt-code-auth';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { AnthropicProvider } from './anthropic/AnthropicProvider.js';
import { resetFactorySingletons } from './auth/proxy/credential-store-factory.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IProvider } from './IProvider.js';
import { OpenAIProvider } from './openai/OpenAIProvider.js';
import { OpenAIVercelProvider } from './openai-vercel/OpenAIVercelProvider.js';

const PROFILE = 'issue3451-provider-profile';
const RUNTIME_ID = 'session#typescriptexpert#provider-surface';
const UNUSED_PROXY_SOCKET = '/tmp/issue3451-provider-surface-unused.sock';
const FORBIDDEN_SECRET = 'issue3451-provider-secret';

interface ProviderCase {
  readonly providerName: string;
  readonly createProvider: () => IProvider;
  readonly baseURL: string;
}

function createSettings(providerName: string): SettingsService {
  const settings = new SettingsService();
  settings.set('activeProvider', providerName);
  settings.setCurrentProfileName(PROFILE);
  settings.setProviderSetting(providerName, 'streaming', 'disabled');
  return settings;
}

function createOptions(providerName: string, settings: SettingsService) {
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: RUNTIME_ID,
    metadata: { source: 'credential-resolution-errors.test.ts' },
  });
  setActiveProviderRuntimeContext(runtime);
  return createProviderCallOptions({
    providerName,
    settings,
    runtime,
    contents: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'test request' }],
      },
    ],
  });
}

async function captureProviderFailure(
  provider: IProvider,
  settings: SettingsService,
): Promise<CredentialResolutionError> {
  const options = createOptions(provider.name, settings);
  try {
    await provider.generateChatCompletion(options).next();
  } catch (error) {
    if (error instanceof CredentialResolutionError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected provider credential resolution to fail');
}

async function captureError(
  iterator: AsyncIterableIterator<IContent>,
): Promise<Error> {
  try {
    await iterator.next();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected provider call to fail');
}

describe('Provider credential-resolution error surface', () => {
  const originalSocket = process.env.LLXPRT_CREDENTIAL_SOCKET;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.LLXPRT_CREDENTIAL_SOCKET = UNUSED_PROXY_SOCKET;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    resetFactorySingletons();
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    resetFactorySingletons();
    if (originalSocket === undefined) {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    } else {
      process.env.LLXPRT_CREDENTIAL_SOCKET = originalSocket;
    }
    if (originalOpenAIKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
    if (originalAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
  });

  const providerCases: readonly ProviderCase[] = [
    {
      providerName: 'openai',
      createProvider: () =>
        new OpenAIProvider(undefined, 'https://api.openai.com/v1'),
      baseURL: 'https://api.openai.com/v1',
    },
    {
      providerName: 'anthropic',
      createProvider: () => new AnthropicProvider(undefined),
      baseURL: 'https://api.anthropic.com',
    },
    {
      providerName: 'openaivercel',
      createProvider: () =>
        new OpenAIVercelProvider(undefined, 'https://api.openai.com/v1'),
      baseURL: 'https://api.openai.com/v1',
    },
  ];

  for (const providerCase of providerCases) {
    it(`${providerCase.providerName} throws CredentialResolutionError with safe resolver diagnostics`, async () => {
      const settings = createSettings(providerCase.providerName);
      settings.setProviderSetting(
        providerCase.providerName,
        'base-url',
        providerCase.baseURL,
      );
      settings.set('issue3451-secret-marker', FORBIDDEN_SECRET);
      const provider = providerCase.createProvider();

      const error = await captureProviderFailure(provider, settings);

      expect(error.kind).toBe('no-credential-configured');
      expect(error.message).toContain(`provider=${providerCase.providerName}`);
      expect(error.message).toContain(`profile=${PROFILE}`);
      expect(error.message).toContain(`runtimeId=${RUNTIME_ID}`);
      expect(error.message).toContain('proxyContacted=false');
      expect(error.message).not.toContain('ProviderCacheError(');
      expect(error.message).not.toContain(FORBIDDEN_SECRET);
      expect(JSON.stringify(error.diagnostics)).not.toContain(FORBIDDEN_SECRET);
    });
  }

  it('Anthropic third-party base URL keeps its explicit API-key guidance ahead of the typed failure', async () => {
    const baseURL = 'https://api.z.ai/api/anthropic';
    const settings = createSettings('anthropic');
    settings.setProviderSetting('anthropic', 'base-url', baseURL);
    const provider = new AnthropicProvider(undefined, baseURL);
    const options = createOptions('anthropic', settings);

    const error = await captureError(provider.generateChatCompletion(options));

    expect(error).not.toBeInstanceOf(CredentialResolutionError);
    expect(error.message).toContain(
      `No API key resolved for Anthropic-compatible endpoint "${baseURL}"`,
    );
  });
});
