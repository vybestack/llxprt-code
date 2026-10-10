import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { type Config, OutputFormat } from '@vybestack/llxprt-code-core';

/**
 * Minimal structural contract the validator observes on its Config.
 * validateNonInteractiveAuth is a GATE ONLY — it delegates the unconfigured
 * exit to guardUnconfiguredProvider (report + cleanup + exit 52), applies
 * compression settings. The auth-env-var
 * branch (hasAuthEnvVars) was removed because it was unreachable:
 * isProviderConfigured returning false already exits before the env-var check
 * runs.
 */
type NonInteractiveConfig = Pick<
  Config,
  'getProvider' | 'getOutputFormat' | 'isInteractive'
>;

import { validateNonInteractiveAuth as validateOwnerAuth } from './validateNonInteractiveAuth.js';
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

  let settingsStore: SettingsService;
  let settingsOwner: SessionSettingsOwner;
  let originalEnvVars: Map<string, string | undefined>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    settingsStore = new SettingsService();
    settingsOwner = new SessionSettingsOwner(settingsStore);
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

  afterEach(async () => {
    await settingsOwner.dispose();
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

  const configuredState = new Map<NonInteractiveConfig, boolean>();

  function makeConfig(
    provider: string | undefined = undefined,
    hasActive = false,
  ): NonInteractiveConfig {
    const config: NonInteractiveConfig = {
      getProvider: () => provider,

      getOutputFormat: () => OutputFormat.TEXT,
      isInteractive: () => false,
    };
    configuredState.set(config, hasActive);
    return config;
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

  const validateNonInteractiveAuth = (
    external: boolean | undefined,
    config: NonInteractiveConfig,
    settings?: LoadedSettings,
    cleanup?: () => Promise<void>,
  ) =>
    validateOwnerAuth(
      external,
      config,
      settings,
      cleanup,
      {
        hasActiveProvider: () => configuredState.get(config) ?? false,
      },
      (key, value) => settingsOwner.writeUserParameter(key, value),
    );

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
    const nonInteractiveConfig: NonInteractiveConfig = {
      getProvider: () => 'gemini',

      getOutputFormat: () => OutputFormat.TEXT,
      isInteractive: () => false,
    };
    const settings = makeSettings({
      'context-limit': 100000,
      'compression-threshold': 0.5,
    });

    configuredState.set(nonInteractiveConfig, true);
    await validateNonInteractiveAuth(undefined, nonInteractiveConfig, settings);

    expect(settingsOwner.readNamedParameter('compression-threshold')).toBe(0.5);
    expect(settingsOwner.readRuntimePolicy().contextLimit).toBe(100000);
  });

  it('does not apply compression settings when settings is undefined', async () => {
    const nonInteractiveConfig: NonInteractiveConfig = {
      getProvider: () => 'gemini',

      getOutputFormat: () => OutputFormat.TEXT,
      isInteractive: () => false,
    };

    configuredState.set(nonInteractiveConfig, true);
    await validateNonInteractiveAuth(undefined, nonInteractiveConfig);

    expect(settingsStore.getAllGlobalSettings()).toStrictEqual({});
  });

  it('exits with FATAL_CONFIG_ERROR (52) when provider manager is undefined', async () => {
    const nonInteractiveConfig: NonInteractiveConfig = {
      getProvider: () => 'gemini',

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
