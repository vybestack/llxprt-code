/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260616-ISSUE2068
 * Behavioral tests: BaseProvider normalization must never pass a malformed
 * invocation stub through to providers. A stub like { signal } or
 * { ephemerals: {} } lacks the RuntimeInvocationContext methods
 * (getModelBehavior, getCliSetting, ...) and crashes providers with
 * "options.invocation.getModelBehavior is not a function".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';

const PROVIDER_NAME = 'invocation-safety';

class InvocationSafetyProvider extends BaseProvider {
  lastNormalizedOptions: NormalizedGenerateChatOptions | undefined;

  constructor() {
    super({ name: PROVIDER_NAME });
  }

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'invocation-safety-model';
  }

  protected supportsOAuth(): boolean {
    return false;
  }

  protected generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.lastNormalizedOptions = options;
    return (async function* () {})();
  }
}

function wireProviderWithAuth(provider: InvocationSafetyProvider): void {
  (
    provider as unknown as {
      authResolver: {
        resolveAuthentication: (input: unknown) => Promise<string>;
        setSettingsService: (settings: SettingsService | undefined) => void;
      };
    }
  ).authResolver = {
    resolveAuthentication: vi.fn().mockResolvedValue('token'),
    setSettingsService: vi.fn(),
  };
}

function createSettings(provider: InvocationSafetyProvider): SettingsService {
  const settings = new SettingsService();
  settings.set('model', `${PROVIDER_NAME}-model`);
  settings.setProviderSetting(PROVIDER_NAME, 'model', `${PROVIDER_NAME}-model`);
  const config = createRuntimeConfigStub(settings);
  setActiveProviderRuntimeContext({
    settingsService: settings,
    config,
  });
  (provider as unknown as { defaultConfig?: unknown }).defaultConfig = config;
  return settings;
}

describe('BaseProvider normalization invocation safety', () => {
  const prompt: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'hi' }],
  };

  beforeEach(() => {
    clearActiveProviderRuntimeContext();
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('replaces a malformed invocation stub carrying only signal with a real RuntimeInvocationContext', async () => {
    const provider = new InvocationSafetyProvider();
    wireProviderWithAuth(provider);
    const settings = createSettings(provider);

    const abortController = new AbortController();
    const malformedInvocation = {
      signal: abortController.signal,
    } as unknown as RuntimeInvocationContext;

    const options = {
      contents: [prompt],
      settings,
      invocation: malformedInvocation,
    } as GenerateChatOptions;

    await provider.generateChatCompletion(options).next();

    const normalized = provider.lastNormalizedOptions;
    expect(normalized).toBeDefined();
    expect(normalized!.invocation).not.toBe(malformedInvocation);
    expect(typeof normalized!.invocation.getModelBehavior).toBe('function');
  });

  it('preserves AbortSignal from a malformed stub on the normalized invocation', async () => {
    const provider = new InvocationSafetyProvider();
    wireProviderWithAuth(provider);
    const settings = createSettings(provider);

    const abortController = new AbortController();
    const malformedInvocation = {
      signal: abortController.signal,
    } as unknown as RuntimeInvocationContext;

    const options = {
      contents: [prompt],
      settings,
      invocation: malformedInvocation,
    } as GenerateChatOptions;

    await provider.generateChatCompletion(options).next();

    const normalized = provider.lastNormalizedOptions;
    expect(normalized).toBeDefined();
    expect(normalized!.invocation.signal).toBe(abortController.signal);
  });

  it('uses settings-derived model behavior when replacing a malformed stub', async () => {
    const provider = new InvocationSafetyProvider();
    wireProviderWithAuth(provider);
    const settings = createSettings(provider);
    settings.set('reasoning.enabled', true);

    const malformedInvocation = {
      ephemerals: {},
    } as unknown as RuntimeInvocationContext;

    const options = {
      contents: [prompt],
      settings,
      invocation: malformedInvocation,
    } as GenerateChatOptions;

    await provider.generateChatCompletion(options).next();

    const normalized = provider.lastNormalizedOptions;
    expect(normalized).toBeDefined();
    expect(
      normalized!.invocation.getModelBehavior<boolean>('reasoning.enabled'),
    ).toBe(true);
  });

  it('reuses a valid RuntimeInvocationContext unchanged', async () => {
    const { createProviderCallOptions } = await import(
      '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js'
    );

    const provider = new InvocationSafetyProvider();
    wireProviderWithAuth(provider);
    const settings = createSettings(provider);

    const validOptions = createProviderCallOptions({
      providerName: PROVIDER_NAME,
      settings,
    });

    const options = {
      ...validOptions,
      contents: [prompt],
    } as GenerateChatOptions;

    await provider.generateChatCompletion(options).next();

    const normalized = provider.lastNormalizedOptions;
    expect(normalized).toBeDefined();
    expect(normalized!.invocation).toBe(validOptions.invocation);
  });
});
