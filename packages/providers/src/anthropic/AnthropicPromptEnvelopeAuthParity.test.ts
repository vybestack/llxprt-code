/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: the OAuth flavor used to PREPARE the finalized Anthropic
 * envelope must match the credential transport actually sends (issue #2817).
 *
 * `isOAuth` is not cosmetic — it selects an entirely different `system` field
 * (buildOAuthSystemContext vs buildNonOAuthSystemContext) and drives
 * tool-name prefixing. Because the agent send seam does not populate
 * `resolved.authToken`, projection sees an empty token on every production
 * call and must resolve the real credential the same way
 * `buildProviderClient` does instead of inferring a flavor from provider
 * configuration.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import type { OAuthManager } from '@vybestack/llxprt-code-auth';

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'core-prompt'),
}));

void vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    readonly messages = {
      create: vi.fn(async () => ({})),
    };
  },
}));

/**
 * Mirrors the production shape that triggers the defect: an OAuth manager is
 * registered (so `oauthProvider === 'claudecode'`) but the credential that
 * actually resolves is a plain API key.
 */
class ApiKeyWithOAuthManagerProvider extends AnthropicProvider {
  constructor(private readonly token: string) {
    super(
      undefined,
      'https://api.anthropic.com',
      { getEphemeralSettings: () => ({}) },
      {} as OAuthManager,
    );
  }

  protected override async getAuthToken(): Promise<string> {
    return this.token;
  }

  protected override async getAuthTokenForPrompt(): Promise<string> {
    return this.token;
  }
}

/** The agent send seam builds options WITHOUT a `resolved` block. */
function buildSendSeamShapedOptions(provider: AnthropicProvider) {
  const options = createProviderCallOptions({
    providerName: provider.name,
    contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] }],
  }) as Record<string, unknown>;
  delete options['resolved'];
  return options as Parameters<AnthropicProvider['projectPromptEnvelope']>[0];
}

function readPrepared(provider: AnthropicProvider, transportToken: object) {
  return (
    provider as unknown as {
      preparedPromptEnvelopes: WeakMap<object, { isOAuth: boolean }>;
    }
  ).preparedPromptEnvelopes.get(transportToken);
}

describe('AnthropicProvider prompt-envelope OAuth parity (issue #2817)', () => {
  beforeEach(() => {
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'anthropic-auth-parity-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('prepares a non-OAuth envelope when the resolved credential is an API key', async () => {
    const provider = new ApiKeyWithOAuthManagerProvider('sk-ant-api03-example');

    const projection = await provider.projectPromptEnvelope(
      buildSendSeamShapedOptions(provider),
    );

    expect(readPrepared(provider, projection.transportToken)?.isOAuth).toBe(
      false,
    );
  });

  it('prepares an OAuth envelope when the resolved credential is an OAuth token', async () => {
    const provider = new ApiKeyWithOAuthManagerProvider('sk-ant-oat-example');

    const projection = await provider.projectPromptEnvelope(
      buildSendSeamShapedOptions(provider),
    );

    expect(readPrepared(provider, projection.transportToken)?.isOAuth).toBe(
      true,
    );
  });
});
