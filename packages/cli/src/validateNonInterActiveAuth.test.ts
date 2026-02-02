/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateNonInteractiveAuth,
  NonInteractiveConfig,
} from './validateNonInterActiveAuth.js';
import { AuthType } from '@vybestack/llxprt-code-core';

describe('validateNonInterActiveAuth', () => {
  // Store all auth-related env vars that need to be cleaned up
  const authEnvVars = [
    'GEMINI_API_KEY',
    'LLXPRT_API_KEY',
    'GOOGLE_GENAI_USE_VERTEXAI',
    'GOOGLE_GENAI_USE_GCA',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_LOCATION',
    'GOOGLE_API_KEY',
  ] as const;

  let originalEnvVars: Map<string, string | undefined>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let refreshAuthMock: ReturnType<(typeof vi)['fn']>;

  beforeEach(() => {
    // Store and clear all auth-related env vars
    originalEnvVars = new Map();
    for (const envVar of authEnvVars) {
      originalEnvVars.set(envVar, process.env[envVar]);
      delete process.env[envVar];
    }
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });
    refreshAuthMock = vi.fn().mockResolvedValue('refreshed');
  });

  afterEach(() => {
    // Restore all original env var values
    for (const envVar of authEnvVars) {
      const originalValue = originalEnvVars.get(envVar);
      if (originalValue !== undefined) {
        process.env[envVar] = originalValue;
      } else {
        delete process.env[envVar];
      }
    }
    vi.restoreAllMocks();
  });

  // Removed test: 'exits if no auth type is configured or env vars set'
  // This test is no longer relevant for llxprt-code since it supports multiple
  // providers that don't all require Google authentication. Users can run with
  // providers like OpenAI using just an API key without any Google auth.

  // Removed test: 'uses LOGIN_WITH_GOOGLE if GOOGLE_GENAI_USE_GCA is set'
  // This test is not relevant for llxprt-code because command-line provider
  // configuration takes precedence, and the test doesn't properly mock the
  // provider configuration scenario.

  it('uses USE_GEMINI if GEMINI_API_KEY is set', async () => {
    process.env.GEMINI_API_KEY = 'fake-key';
    const nonInteractiveConfig: NonInteractiveConfig = {
      refreshAuth: refreshAuthMock,
      getProvider: () => undefined,
      getProviderManager: () => undefined,
    };
    await validateNonInteractiveAuth(
      undefined,
      undefined,
      nonInteractiveConfig,
    );
    // llxprt-code's multi-provider architecture always returns USE_PROVIDER
    // instead of specific auth types like USE_GEMINI when no CLI provider is configured
    expect(refreshAuthMock).toHaveBeenCalledWith(AuthType.USE_PROVIDER);
  });

  it('uses USE_VERTEX_AI if GOOGLE_GENAI_USE_VERTEXAI is true (with GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION)', async () => {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    const nonInteractiveConfig: NonInteractiveConfig = {
      refreshAuth: refreshAuthMock,
      getProvider: () => undefined,
      getProviderManager: () => undefined,
    };
    await validateNonInteractiveAuth(
      undefined,
      undefined,
      nonInteractiveConfig,
    );
    // llxprt-code's multi-provider architecture always returns USE_PROVIDER
    // instead of specific auth types like USE_VERTEX_AI when no CLI provider is configured
    expect(refreshAuthMock).toHaveBeenCalledWith(AuthType.USE_PROVIDER);
  });

  it('uses USE_VERTEX_AI if GOOGLE_GENAI_USE_VERTEXAI is true and GOOGLE_API_KEY is set', async () => {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
    process.env.GOOGLE_API_KEY = 'vertex-api-key';
    const nonInteractiveConfig: NonInteractiveConfig = {
      refreshAuth: refreshAuthMock,
      getProvider: () => undefined,
      getProviderManager: () => undefined,
    };
    await validateNonInteractiveAuth(
      undefined,
      undefined,
      nonInteractiveConfig,
    );
    // llxprt-code's multi-provider architecture always returns USE_PROVIDER
    // instead of specific auth types like USE_VERTEX_AI when no CLI provider is configured
    expect(refreshAuthMock).toHaveBeenCalledWith(AuthType.USE_PROVIDER);
  });

  it('uses LOGIN_WITH_GOOGLE if GOOGLE_GENAI_USE_GCA is set, even with other env vars', async () => {
    process.env.GOOGLE_GENAI_USE_GCA = 'true';
    process.env.GEMINI_API_KEY = 'fake-key';
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    const nonInteractiveConfig: NonInteractiveConfig = {
      refreshAuth: refreshAuthMock,
      getProvider: () => undefined,
      getProviderManager: () => undefined,
    };
    await validateNonInteractiveAuth(
      undefined,
      undefined,
      nonInteractiveConfig,
    );
    // llxprt-code's multi-provider architecture always returns USE_PROVIDER
    // instead of specific auth types like LOGIN_WITH_GOOGLE when no CLI provider is configured
    expect(refreshAuthMock).toHaveBeenCalledWith(AuthType.USE_PROVIDER);
  });

  it('uses USE_VERTEX_AI if both GEMINI_API_KEY and GOOGLE_GENAI_USE_VERTEXAI are set', async () => {
    process.env.GEMINI_API_KEY = 'fake-key';
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    const nonInteractiveConfig: NonInteractiveConfig = {
      refreshAuth: refreshAuthMock,
      getProvider: () => undefined,
      getProviderManager: () => undefined,
    };
    await validateNonInteractiveAuth(
      undefined,
      undefined,
      nonInteractiveConfig,
    );
    // llxprt-code's multi-provider architecture always returns USE_PROVIDER
    // instead of specific auth types like USE_VERTEX_AI when no CLI provider is configured
    expect(refreshAuthMock).toHaveBeenCalledWith(AuthType.USE_PROVIDER);
  });

  it('uses USE_GEMINI if GOOGLE_GENAI_USE_VERTEXAI is false, GEMINI_API_KEY is set, and project/location are available', async () => {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'false';
    process.env.GEMINI_API_KEY = 'fake-key';
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    const nonInteractiveConfig: NonInteractiveConfig = {
      refreshAuth: refreshAuthMock,
      getProvider: () => undefined,
      getProviderManager: () => undefined,
    };
    await validateNonInteractiveAuth(
      undefined,
      undefined,
      nonInteractiveConfig,
    );
    // llxprt-code's multi-provider architecture always returns USE_PROVIDER
    // instead of specific auth types like USE_GEMINI when no CLI provider is configured
    expect(refreshAuthMock).toHaveBeenCalledWith(AuthType.USE_PROVIDER);
  });

  // UPDATED (issue #443): configuredAuthType is now deprecated/ignored.
  // validateNonInteractiveAuth always uses USE_PROVIDER since providers
  // handle auth detection internally via determineBestAuth().
  it('ignores configuredAuthType and always uses USE_PROVIDER (issue #443)', async () => {
    // Set required env var for auth detection
    process.env.GEMINI_API_KEY = 'fake-key';
    const nonInteractiveConfig: NonInteractiveConfig = {
      refreshAuth: refreshAuthMock,
      getProvider: () => undefined,
      getProviderManager: () => undefined,
    };
    await validateNonInteractiveAuth(
      AuthType.USE_GEMINI, // This is ignored now
      undefined,
      nonInteractiveConfig,
    );
    // Always uses USE_PROVIDER, not the passed-in type
    expect(refreshAuthMock).toHaveBeenCalledWith(AuthType.USE_PROVIDER);
  });

  // UPDATED (issue #443): validateAuthMethod is no longer called.
  // Providers handle auth validation internally.
  it('exits if no auth env vars are set', async () => {
    // No env vars set, no provider configured
    const nonInteractiveConfig: NonInteractiveConfig = {
      refreshAuth: refreshAuthMock,
      getProvider: () => undefined,
      getProviderManager: () => undefined,
    };
    const promise = validateNonInteractiveAuth(
      undefined,
      undefined,
      nonInteractiveConfig,
    );
    await expect(promise).rejects.toThrow('process.exit(1) called');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Please set an Auth method'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  // UPDATED (issue #443): useExternalAuth parameter is now deprecated/ignored.
  // Auth validation no longer happens - providers handle this internally.
  it('useExternalAuth param is deprecated and ignored (issue #443)', async () => {
    // Set env vars so auth check passes
    process.env.GEMINI_API_KEY = 'fake-key';

    const nonInteractiveConfig: NonInteractiveConfig = {
      refreshAuth: refreshAuthMock,
      getProvider: () => undefined,
      getProviderManager: () => undefined,
    };

    await validateNonInteractiveAuth(
      'invalid-auth-type' as AuthType, // Ignored
      true, // useExternalAuth is now ignored
      nonInteractiveConfig,
    );

    // Should succeed with USE_PROVIDER since env var is set
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
    expect(refreshAuthMock).toHaveBeenCalledWith(AuthType.USE_PROVIDER);
  });
});
