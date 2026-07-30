/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: OpenAI Chat projection must resolve the credential the same
 * way transport does (issue #2817).
 *
 * `normalizeOptionsForProjection` deliberately does NOT resolve authentication
 * — projection stays a pure read, so `resolved.authToken` is empty whenever the
 * agent send seam did not already populate it. Media-capable endpoints (Kimi
 * file upload / video) need a client during projection, and `getClient` rejects
 * an empty token. Projection must therefore apply the same prompt-credential
 * precedence Anthropic's projection uses, otherwise a send that transport can
 * perform fails during estimation.
 *
 * @requirement:REQ-PE-001 (issue #2817 acceptance A4)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIProvider } from '../OpenAIProvider.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { IProviderConfig } from '../../types/IProviderConfig.js';

vi.mock('openai', () => {
  class FakeOpenAI {
    readonly chat = {
      completions: { create: vi.fn(async () => ({})) },
    };
  }
  return { default: FakeOpenAI };
});

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'core-prompt'),
}));

/** File upload support forces projection to acquire a client. */
const MEDIA_CAPABLE_CONFIG: IProviderConfig = {
  providerSpecific: {
    mediaSupport: { fileUpload: true },
  },
} as IProviderConfig;

/**
 * A provider whose ambient prompt credential is available (as it is in
 * production once OAuth or an API key is configured) while the per-call
 * options carry no resolved token.
 */
class AmbientCredentialProvider extends OpenAIProvider {
  constructor() {
    super(undefined, 'https://api.moonshot.cn/v1', MEDIA_CAPABLE_CONFIG);
  }

  override getCurrentModel(): string {
    return 'kimi-k2';
  }

  protected override getModel(): string {
    return 'kimi-k2';
  }

  protected override async getAuthToken(): Promise<string> {
    return 'ambient-token';
  }

  protected override async getAuthTokenForPrompt(): Promise<string> {
    return 'ambient-token';
  }
}

function buildSendSeamShapedOptions(providerName: string) {
  // The agent send seam supplies contents/settings/runtime but never a
  // resolved auth token.
  return createProviderCallOptions({
    providerName,
    settings: new SettingsService(),
    contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] }],
    resolved: {
      model: 'kimi-k2',
      telemetry: { providerName },
    },
  });
}

describe('OpenAI Chat projection credential parity (issue #2817)', () => {
  beforeEach(() => {
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'openai-chat-projection-auth-parity-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('projects a media-capable endpoint using the ambient prompt credential', async () => {
    const provider = new AmbientCredentialProvider();

    const projection = await provider.projectPromptEnvelope(
      buildSendSeamShapedOptions(provider.name),
    );

    expect(projection.protocol).toBe('openai-chat');
    expect(await projection.countProjectedTokens()).toBeGreaterThan(0);
    expect(projection.transportToken).toBeDefined();
  });
});
