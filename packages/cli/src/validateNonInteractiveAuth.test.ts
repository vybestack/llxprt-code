/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { type Config, OutputFormat } from '@vybestack/llxprt-code-core';

/**
 * Minimal structural contract the validator observes on its Config.
 * validateNonInteractiveAuth is a GATE ONLY — it delegates the unconfigured
 * exit to guardUnconfiguredProvider (report + cleanup + exit 52), applies
 * compression settings, and wires the serverToolsProvider. The auth-env-var
 * branch (hasAuthEnvVars) was removed because it was unreachable:
 * isProviderConfigured returning false already exits before the env-var check
 * runs.
 */
type NonInteractiveConfig = Pick<
  Config,
  | 'getProvider'
  | 'getProviderManager'
  | 'getEphemeralSetting'
  | 'setEphemeralSetting'
  | 'getOutputFormat'
  | 'isInteractive'
>;

import { validateNonInteractiveAuth } from './validateNonInteractiveAuth.js';
import type { LoadedSettings } from './config/settings.js';

describe('validateNonInteractiveAuth (gate-only)', () => {
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
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnvVars = new Map();
    for (const envVar of authEnvVars) {
      originalEnvVars.set(envVar, process.env[envVar]);
      delete process.env[envVar];
    }
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });
  });

  afterEach(() => {
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
    hasActive = false,
  ): NonInteractiveConfig {
    return {
      getProvider: () => provider,
      getProviderManager: () => ({
        hasActiveProvider: () => hasActive,
        getServerToolsProvider: () => null,
      }),
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: () => {},
      getOutputFormat: () => OutputFormat.TEXT,
      isInteractive: () => false,
    };
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

  // ─── Gate: provider-only check ──────────────────────────────────────────

  it('exits with FATAL_CONFIG_ERROR (52) when no provider is configured', async () => {
    const nonInteractiveConfig = makeConfig();
    const promise = validateNonInteractiveAuth(undefined, nonInteractiveConfig);
    await expect(promise).rejects.toThrow('process.exit(52) called');
    expect(processExitSpy).toHaveBeenCalledWith(52);
  });

  it('runs cleanup before exiting 52 when no provider is configured', async () => {
    const cleanupSpy = vi.fn().mockResolvedValue(undefined);
    const nonInteractiveConfig: NonInteractiveConfig = {
      getProvider: () => undefined,
      getProviderManager: () => ({
        hasActiveProvider: () => false,
        getServerToolsProvider: () => null,
      }),
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: () => {},
      getOutputFormat: () => OutputFormat.TEXT,
      isInteractive: () => false,
    };
    const promise = validateNonInteractiveAuth(
      undefined,
      nonInteractiveConfig,
      undefined,
      cleanupSpy,
    );
    await expect(promise).rejects.toThrow('process.exit(52) called');
    expect(processExitSpy).toHaveBeenCalledWith(52);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('still exits 52 when cleanup throws', async () => {
    const cleanupSpy = vi.fn().mockRejectedValue(new Error('cleanup failed'));
    const nonInteractiveConfig: NonInteractiveConfig = {
      getProvider: () => undefined,
      getProviderManager: () => ({
        hasActiveProvider: () => false,
        getServerToolsProvider: () => null,
      }),
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: () => {},
      getOutputFormat: () => OutputFormat.TEXT,
      isInteractive: () => false,
    };
    const promise = validateNonInteractiveAuth(
      undefined,
      nonInteractiveConfig,
      undefined,
      cleanupSpy,
    );
    await expect(promise).rejects.toThrow('process.exit(52) called');
    expect(processExitSpy).toHaveBeenCalledWith(52);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('passes the gate when provider is active', async () => {
    const nonInteractiveConfig = makeConfig('gemini', true);
    const result = await validateNonInteractiveAuth(
      undefined,
      nonInteractiveConfig,
    );
    expect(result).toBe(nonInteractiveConfig);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('passes the gate when OPENAI provider is active', async () => {
    const nonInteractiveConfig = makeConfig('openai', true);
    const result = await validateNonInteractiveAuth(
      undefined,
      nonInteractiveConfig,
    );
    expect(result).toBe(nonInteractiveConfig);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('passes the gate when ANTHROPIC provider is active', async () => {
    const nonInteractiveConfig = makeConfig('anthropic', true);
    const result = await validateNonInteractiveAuth(
      undefined,
      nonInteractiveConfig,
    );
    expect(result).toBe(nonInteractiveConfig);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('passes the gate when useExternalAuth is true with provider active', async () => {
    const nonInteractiveConfig = makeConfig('openai', true);
    const result = await validateNonInteractiveAuth(true, nonInteractiveConfig);
    expect(result).toBe(nonInteractiveConfig);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  // ─── Compression settings ───────────────────────────────────────────────

  it('applies compression settings from settings.merged when present', async () => {
    const setEphemeralSpy = vi.fn();
    const nonInteractiveConfig: NonInteractiveConfig = {
      getProvider: () => 'gemini',
      getProviderManager: () => ({
        hasActiveProvider: () => true,
        getServerToolsProvider: () => null,
      }),
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: setEphemeralSpy,
      getOutputFormat: () => OutputFormat.TEXT,
      isInteractive: () => false,
    };
    const settings = makeSettings({
      'context-limit': 100000,
      'compression-threshold': 0.5,
    });

    await validateNonInteractiveAuth(undefined, nonInteractiveConfig, settings);

    expect(setEphemeralSpy).toHaveBeenCalledWith('compression-threshold', 0.5);
    expect(setEphemeralSpy).toHaveBeenCalledWith('context-limit', 100000);
  });

  it('does not apply compression settings when settings is undefined', async () => {
    const setEphemeralSpy = vi.fn();
    const nonInteractiveConfig: NonInteractiveConfig = {
      getProvider: () => 'gemini',
      getProviderManager: () => ({
        hasActiveProvider: () => true,
        getServerToolsProvider: () => null,
      }),
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: setEphemeralSpy,
      getOutputFormat: () => OutputFormat.TEXT,
      isInteractive: () => false,
    };

    await validateNonInteractiveAuth(undefined, nonInteractiveConfig);

    expect(setEphemeralSpy).not.toHaveBeenCalled();
  });

  // ─── serverToolsProvider wiring ─────────────────────────────────────────

  it('wires serverToolsProvider.setConfig when a gemini provider manager is present', async () => {
    const setConfigSpy = vi.fn();
    const providerManager = {
      hasActiveProvider: () => true,
      getServerToolsProvider: () => ({
        name: 'gemini',
        setConfig: setConfigSpy,
      }),
    };
    const nonInteractiveConfig: NonInteractiveConfig = {
      getProvider: () => 'gemini',
      getProviderManager: () => providerManager,
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: () => {},
      getOutputFormat: () => OutputFormat.TEXT,
      isInteractive: () => false,
    };

    await validateNonInteractiveAuth(undefined, nonInteractiveConfig);

    expect(setConfigSpy).toHaveBeenCalledWith(nonInteractiveConfig);
  });

  it('exits with FATAL_CONFIG_ERROR (52) when provider manager is undefined', async () => {
    const nonInteractiveConfig: NonInteractiveConfig = {
      getProvider: () => 'gemini',
      getProviderManager: () => undefined,
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: () => {},
      getOutputFormat: () => OutputFormat.TEXT,
      isInteractive: () => false,
    };

    // Without a manager, isProviderConfigured returns false → exit 52.
    await expect(
      validateNonInteractiveAuth(undefined, nonInteractiveConfig),
    ).rejects.toThrow('process.exit(52) called');
  });

  // ─── Return value ───────────────────────────────────────────────────────

  it('returns the same config instance it was given', async () => {
    const nonInteractiveConfig = makeConfig('gemini', true);
    const result = await validateNonInteractiveAuth(
      undefined,
      nonInteractiveConfig,
    );
    expect(result).toBe(nonInteractiveConfig);
  });
});
