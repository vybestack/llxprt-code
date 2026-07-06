/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';

/**
 * Minimal structural contract the validator observes on its Config.
 * #2374 round-3 Fix 2: validateNonInteractiveAuth is now a GATE ONLY — it no
 * longer calls executeProviderActivation. These tests assert gate behavior
 * (has-provider/has-env-var check, compression settings, serverToolsProvider
 * wiring), NOT auth execution (which moved to fromConfig's activation intent).
 */
type NonInteractiveConfig = Pick<
  Config,
  | 'getProvider'
  | 'getProviderManager'
  | 'getEphemeralSetting'
  | 'setEphemeralSetting'
  | 'getOutputFormat'
>;

import { validateNonInteractiveAuth } from './validateNonInteractiveAuth.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from './config/settings.js';

describe('validateNonInteractiveAuth (gate-only, #2374 round-3 Fix 2)', () => {
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
  let debugErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Store and clear all auth-related env vars
    originalEnvVars = new Map();
    for (const envVar of authEnvVars) {
      originalEnvVars.set(envVar, process.env[envVar]);
      delete process.env[envVar];
    }
    debugErrorSpy = vi
      .spyOn(DebugLogger.prototype, 'error')
      .mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });
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

  function makeConfig(
    provider: string | undefined = undefined,
  ): NonInteractiveConfig {
    return {
      getProvider: () => provider,
      getProviderManager: () => undefined,
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: () => {},
      getOutputFormat: () => 'text' as unknown,
    } as unknown as NonInteractiveConfig;
  }

  function makeSettings(
    overrides: Record<string, unknown> = {},
  ): LoadedSettings {
    return {
      merged: {
        useExternalAuth: false,
        ...overrides,
      },
      errors: [],
    } as unknown as LoadedSettings;
  }

  // ─── Gate: has-auth checks ──────────────────────────────────────────────

  it('exits with FATAL_AUTHENTICATION_ERROR when no auth env vars or provider are configured', async () => {
    const nonInteractiveConfig = makeConfig();
    const promise = validateNonInteractiveAuth(undefined, nonInteractiveConfig);
    await expect(promise).rejects.toThrow('process.exit(41) called');
    expect(debugErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Please set an Auth method'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(41);
  });

  it('passes the gate when GEMINI_API_KEY is set (resolves without exit)', async () => {
    process.env.GEMINI_API_KEY = 'fake-key';
    const nonInteractiveConfig = makeConfig();
    const result = await validateNonInteractiveAuth(
      undefined,
      nonInteractiveConfig,
    );
    expect(result).toBe(nonInteractiveConfig);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('passes the gate when OPENAI_API_KEY is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const nonInteractiveConfig = makeConfig();
    const result = await validateNonInteractiveAuth(
      undefined,
      nonInteractiveConfig,
    );
    expect(result).toBe(nonInteractiveConfig);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('passes the gate when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const nonInteractiveConfig = makeConfig();
    const result = await validateNonInteractiveAuth(
      undefined,
      nonInteractiveConfig,
    );
    expect(result).toBe(nonInteractiveConfig);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('passes the gate when GOOGLE_GENAI_USE_VERTEXAI is true with project and location', async () => {
    process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    const nonInteractiveConfig = makeConfig();
    const result = await validateNonInteractiveAuth(
      undefined,
      nonInteractiveConfig,
    );
    expect(result).toBe(nonInteractiveConfig);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('passes the gate when GOOGLE_GENAI_USE_GCA is set', async () => {
    process.env.GOOGLE_GENAI_USE_GCA = 'true';
    const nonInteractiveConfig = makeConfig();
    const result = await validateNonInteractiveAuth(
      undefined,
      nonInteractiveConfig,
    );
    expect(result).toBe(nonInteractiveConfig);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('passes the gate when useExternalAuth is true (regardless of env vars)', async () => {
    // useExternalAuth does NOT affect the gate — the gate checks env/provider.
    // But with useExternalAuth, auth is skipped downstream. The gate still needs
    // at least one auth signal to pass.
    process.env.LLXPRT_API_KEY = 'fake-key';
    const nonInteractiveConfig = makeConfig();
    const result = await validateNonInteractiveAuth(true, nonInteractiveConfig);
    expect(result).toBe(nonInteractiveConfig);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  // ─── Compression settings ───────────────────────────────────────────────

  it('applies compression settings from settings.merged when present', async () => {
    process.env.GEMINI_API_KEY = 'fake-key';
    const setEphemeralSpy = vi.fn();
    const nonInteractiveConfig = {
      getProvider: () => undefined,
      getProviderManager: () => undefined,
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: setEphemeralSpy,
      getOutputFormat: () => 'text' as unknown,
    } as unknown as NonInteractiveConfig;
    const settings = makeSettings({
      'context-limit': 100000,
      'compression-threshold': 0.5,
    });

    await validateNonInteractiveAuth(undefined, nonInteractiveConfig, settings);

    // Observable: both ephemeral settings were written from the merged settings.
    expect(setEphemeralSpy).toHaveBeenCalledWith('compression-threshold', 0.5);
    expect(setEphemeralSpy).toHaveBeenCalledWith('context-limit', 100000);
  });

  it('does not apply compression settings when settings is undefined', async () => {
    process.env.GEMINI_API_KEY = 'fake-key';
    const setEphemeralSpy = vi.fn();
    const nonInteractiveConfig = {
      getProvider: () => undefined,
      getProviderManager: () => undefined,
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: setEphemeralSpy,
      getOutputFormat: () => 'text' as unknown,
    } as unknown as NonInteractiveConfig;

    await validateNonInteractiveAuth(undefined, nonInteractiveConfig);

    // Observable: no compression settings written.
    expect(setEphemeralSpy).not.toHaveBeenCalled();
  });

  // ─── serverToolsProvider wiring ─────────────────────────────────────────

  it('wires serverToolsProvider.setConfig when a gemini provider manager is present', async () => {
    process.env.GEMINI_API_KEY = 'fake-key';
    const setConfigSpy = vi.fn();
    const providerManager = {
      hasActiveProvider: () => true,
      getServerToolsProvider: () => ({
        name: 'gemini',
        setConfig: setConfigSpy,
      }),
    };
    const nonInteractiveConfig = {
      getProvider: () => 'gemini',
      getProviderManager: () => providerManager,
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: () => {},
      getOutputFormat: () => 'text' as unknown,
    } as unknown as NonInteractiveConfig;

    await validateNonInteractiveAuth(undefined, nonInteractiveConfig);

    expect(setConfigSpy).toHaveBeenCalledWith(nonInteractiveConfig);
  });

  it('does not wire serverToolsProvider when manager is undefined', async () => {
    process.env.GEMINI_API_KEY = 'fake-key';
    const nonInteractiveConfig = makeConfig();
    // Observable: resolves without error when no provider manager is present.
    const result = await validateNonInteractiveAuth(
      undefined,
      nonInteractiveConfig,
    );
    expect(result).toBe(nonInteractiveConfig);
  });

  // ─── Return value ───────────────────────────────────────────────────────

  it('returns the same config instance it was given', async () => {
    process.env.GEMINI_API_KEY = 'fake-key';
    const nonInteractiveConfig = makeConfig();
    const result = await validateNonInteractiveAuth(
      undefined,
      nonInteractiveConfig,
    );
    expect(result).toBe(nonInteractiveConfig);
  });
});
