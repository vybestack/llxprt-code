/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  submitOAuthCode,
  type OAuthSubmissionDependencies,
} from './oauth-submission.js';

describe('submitOAuthCode', () => {
  function createMockProvider(name: string) {
    return {
      name,
      submitAuthCode: vi.fn(),
      initiateAuth: vi.fn(),
      getToken: vi.fn(),
      refreshToken: vi.fn(),
    };
  }

  function createMockOAuthManager(
    providers: Map<string, ReturnType<typeof createMockProvider>>,
  ) {
    return {
      getProvider: vi.fn((name: string) => providers.get(name)),
    };
  }

  it('should submit auth code to Gemini provider', () => {
    const geminiProvider = createMockProvider('gemini');
    const providers = new Map([['gemini', geminiProvider]]);
    const oauthManager = createMockOAuthManager(providers);

    const deps: OAuthSubmissionDependencies = {
      getOAuthManager: () => oauthManager,
      getActiveProvider: () => 'gemini',
    };

    const result = submitOAuthCode(deps, 'test-code-123');

    expect(result).toBe(true);
    expect(geminiProvider.submitAuthCode).toHaveBeenCalledWith('test-code-123');
  });

  it('should submit auth code to Qwen provider', () => {
    const qwenProvider = createMockProvider('qwen');
    const providers = new Map([['qwen', qwenProvider]]);
    const oauthManager = createMockOAuthManager(providers);

    const deps: OAuthSubmissionDependencies = {
      getOAuthManager: () => oauthManager,
      getActiveProvider: () => 'qwen',
    };

    const result = submitOAuthCode(deps, 'test-code-456');

    expect(result).toBe(true);
    expect(qwenProvider.submitAuthCode).toHaveBeenCalledWith('test-code-456');
  });

  it('should submit auth code to Anthropic provider', () => {
    const anthropicProvider = createMockProvider('anthropic');
    const providers = new Map([['anthropic', anthropicProvider]]);
    const oauthManager = createMockOAuthManager(providers);

    const deps: OAuthSubmissionDependencies = {
      getOAuthManager: () => oauthManager,
      getActiveProvider: () => 'anthropic',
    };

    const result = submitOAuthCode(deps, 'test-code-789');

    expect(result).toBe(true);
    expect(anthropicProvider.submitAuthCode).toHaveBeenCalledWith(
      'test-code-789',
    );
  });

  it('should return false when OAuth manager is not available', () => {
    const deps: OAuthSubmissionDependencies = {
      getOAuthManager: () => null,
      getActiveProvider: () => 'gemini',
    };

    const result = submitOAuthCode(deps, 'test-code');

    expect(result).toBe(false);
  });

  it('should return false when active provider is not set', () => {
    const geminiProvider = createMockProvider('gemini');
    const providers = new Map([['gemini', geminiProvider]]);
    const oauthManager = createMockOAuthManager(providers);

    const deps: OAuthSubmissionDependencies = {
      getOAuthManager: () => oauthManager,
      getActiveProvider: () => undefined,
    };

    const result = submitOAuthCode(deps, 'test-code');

    expect(result).toBe(false);
    expect(geminiProvider.submitAuthCode).not.toHaveBeenCalled();
  });

  it('should return false when provider does not exist in manager', () => {
    const providers = new Map<string, ReturnType<typeof createMockProvider>>();
    const oauthManager = createMockOAuthManager(providers);

    const deps: OAuthSubmissionDependencies = {
      getOAuthManager: () => oauthManager,
      getActiveProvider: () => 'nonexistent',
    };

    const result = submitOAuthCode(deps, 'test-code');

    expect(result).toBe(false);
  });

  it('should return false when provider lacks submitAuthCode method', () => {
    const providerWithoutSubmit = {
      name: 'limited',
      initiateAuth: vi.fn(),
      getToken: vi.fn(),
      refreshToken: vi.fn(),
    };
    const oauthManager = {
      getProvider: vi.fn(() => providerWithoutSubmit),
    };

    const deps: OAuthSubmissionDependencies = {
      getOAuthManager: () => oauthManager,
      getActiveProvider: () => 'limited',
    };

    const result = submitOAuthCode(deps, 'test-code');

    expect(result).toBe(false);
  });
});
