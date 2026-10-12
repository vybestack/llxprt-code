import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the non-interactive unconfigured-provider gate (#2481).
 *
 * Verifies that when no provider is configured (and no explicit provider was
 * selected via CLI/profile/env), the non-interactive flow exits with
 * FATAL_CONFIG_ERROR (52) BEFORE any Agent/fromConfig/request is attempted —
 * even when bare API key environment variables are present.
 *
 * "request/fromConfig infrastructure sentinels are okay around real startup
 * logic" — fromConfig is mocked only to assert it is NOT called.
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  OutputFormat,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  DebugLogger,
  PLACEHOLDER_MODEL,
} from '@vybestack/llxprt-code-core';
import {
  ProviderManager,
  type IProvider,
} from '@vybestack/llxprt-code-providers';
import { runNonInteractive } from './nonInteractiveCli.js';
import type { LoadedSettings } from './config/settings.js';
import { __setWriteToStderrForTesting } from './session/errorReporting.js';

const realAtCommandProcessorModule = {
  ...(await import('./ui/hooks/atCommandProcessor.js')),
};

const original = { ...(await import('@vybestack/llxprt-code-agents')) };
const fromConfigSentinel = vi.fn(original.fromConfig);
void vi.mock('@vybestack/llxprt-code-agents', () => ({
  ...original,
  fromConfig: fromConfigSentinel,
}));

const actualOriginal = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...actualOriginal,
  shutdownTelemetry: vi.fn(),
  isTelemetrySdkInitialized: vi.fn().mockReturnValue(true),
}));

void vi.mock('./utils/cleanup.js', () => ({
  runExitCleanup: vi.fn().mockResolvedValue(undefined),
  cleanupCheckpoints: vi.fn().mockResolvedValue(undefined),
  registerSyncCleanup: vi.fn(),
}));

void vi.mock('./ui/hooks/atCommandProcessor.js', () =>
  automock(realAtCommandProcessorModule),
);
void vi.mock('./services/CommandService.js', () => ({
  CommandService: {
    create: vi.fn().mockResolvedValue({ getCommands: () => [] }),
  },
}));

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
  'LLXPRT_DEFAULT_PROVIDER',
] as const;

const ownedConfigs: Array<{
  config: Config;
  directory: string;
  owner: SessionSettingsOwner;
}> = [];

async function disposeOwnedConfigs(): Promise<void> {
  for (const { config, directory, owner } of ownedConfigs.splice(0)) {
    await owner.dispose();
    await config.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
}

function makeUnconfiguredConfig(outputFormat?: OutputFormat): {
  config: Config;
  runtimeSettings: { store: SettingsService; owner: SessionSettingsOwner };
} {
  const directory = mkdtempSync(join(tmpdir(), 'llxprt-unconfigured-'));
  const config = new Config({
    sessionId: 'test-session',
    targetDir: directory,
    cwd: directory,
    model: PLACEHOLDER_MODEL,
    debugMode: false,
    interactive: false,
    outputFormat,
  });
  const store = new SettingsService();
  const owner = new SessionSettingsOwner(store);
  ownedConfigs.push({ config, directory, owner });
  return { config, runtimeSettings: { store, owner } };
}

function configureProvider(
  config: Config,
  name: string,
  runtimeSettings: { store: SettingsService; owner: SessionSettingsOwner },
): ProviderManager {
  const manager = new ProviderManager({
    config,
    settingsService: runtimeSettings.store,
  });
  const provider: IProvider = {
    name,
    getDefaultModel: () => PLACEHOLDER_MODEL,
    getModels: async () => [],
    async *generateChatCompletion() {
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ready' }] };
    },
  };
  manager.registerProvider(provider);
  manager.setActiveProvider(name);
  runtimeSettings.owner.initializeProviderSelection(name, PLACEHOLDER_MODEL);
  configureProviderRuntimeFactories(config, manager);
  return manager;
}

function makeSettings(): LoadedSettings {
  return {
    system: { path: '', settings: {} },
    systemDefaults: { path: '', settings: {} },
    user: { path: '', settings: {} },
    workspace: { path: '', settings: {} },
    errors: [],
    setValue: vi.fn(),
    merged: {
      security: { auth: { enforcedType: undefined } },
      useExternalAuth: false,
    },
    isTrusted: true,
    migratedInMemorScopes: new Set(),
    forScope: vi.fn(),
    computeMergedSettings: vi.fn(),
  } as unknown as LoadedSettings;
}

describe('runNonInteractive: unconfigured provider gate (#2481)', () => {
  afterEach(disposeOwnedConfigs);
  let originalEnv: Map<string, string | undefined>;
  let fromConfigMock: Mock<typeof original.fromConfig>;
  let capturedStderr: string[];

  beforeEach(async () => {
    originalEnv = new Map();
    for (const envVar of authEnvVars) {
      originalEnv.set(envVar, process.env[envVar]);
      delete process.env[envVar];
    }

    capturedStderr = [];
    __setWriteToStderrForTesting((chunk: string | Uint8Array) => {
      capturedStderr.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    });
    // reportUnconfiguredProviderError writes to process.stderr.write
    // directly (not through the errorReporting injectable seam).
    vi.spyOn(process.stderr, 'write').mockImplementation(
      (chunk: string | Uint8Array) => {
        capturedStderr.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      },
    );

    (shutdownTelemetry as Mock<typeof shutdownTelemetry>).mockResolvedValue(
      undefined,
    );
    (
      isTelemetrySdkInitialized as Mock<typeof isTelemetrySdkInitialized>
    ).mockReturnValue(true);
    vi.spyOn(DebugLogger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });

    fromConfigMock = fromConfigSentinel;
    fromConfigMock.mockReset();
    fromConfigMock.mockImplementation(original.fromConfig);

    const { handleAtCommand } = await import(
      './ui/hooks/atCommandProcessor.js'
    );
    (handleAtCommand as Mock<typeof handleAtCommand>).mockImplementation(
      async ({ query }) => ({
        processedQuery: [{ type: 'text', text: query }],
      }),
    );
  });

  afterEach(() => {
    __setWriteToStderrForTesting(null);
    for (const envVar of authEnvVars) {
      const originalValue = originalEnv.get(envVar);
      if (originalValue !== undefined) {
        process.env[envVar] = originalValue;
      } else {
        delete process.env[envVar];
      }
    }
    vi.restoreAllMocks();
  });

  it('does NOT call fromConfig when unconfigured — exits before Agent construction', async () => {
    const { config, runtimeSettings } = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
        runtimeSettings,
        config,
        settings: makeSettings(),
        input: 'hello',
        prompt_id: 'test-unconfigured',
      }),
    ).rejects.toThrow('process.exit(52) called');

    expect(fromConfigMock).not.toHaveBeenCalled();
  });

  it('exits with code 52 (FATAL_CONFIG_ERROR) even when bare GEMINI_API_KEY is set', async () => {
    process.env.GEMINI_API_KEY = 'bare-key';
    const { config, runtimeSettings } = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
        runtimeSettings,
        config,
        settings: makeSettings(),
        input: 'hello',
        prompt_id: 'test-bare-key',
      }),
    ).rejects.toThrow('process.exit(52) called');

    expect(fromConfigMock).not.toHaveBeenCalled();
  });

  it('exits with code 52 even when bare OPENAI_API_KEY is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-bare';
    const { config, runtimeSettings } = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
        runtimeSettings,
        config,
        settings: makeSettings(),
        input: 'hello',
        prompt_id: 'test-openai-bare',
      }),
    ).rejects.toThrow('process.exit(52) called');

    expect(fromConfigMock).not.toHaveBeenCalled();
  });

  it('exits with code 52 even when bare ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-bare';
    const { config, runtimeSettings } = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
        runtimeSettings,
        config,
        settings: makeSettings(),
        input: 'hello',
        prompt_id: 'test-anthropic-bare',
      }),
    ).rejects.toThrow('process.exit(52) called');

    expect(fromConfigMock).not.toHaveBeenCalled();
  });

  it('provides actionable guidance mentioning --provider, --profile-load, and LLXPRT_DEFAULT_PROVIDER', async () => {
    const { config, runtimeSettings } = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
        runtimeSettings,
        config,
        settings: makeSettings(),
        input: 'hello',
        prompt_id: 'test-guidance',
      }),
    ).rejects.toThrow('process.exit(52) called');

    // The actionable guidance must mention headless configuration options.
    const combined = capturedStderr.join('\n');
    expect(combined).toContain('--provider');
    expect(combined).toContain('--profile-load');
    expect(combined).toContain('LLXPRT_DEFAULT_PROVIDER');
  });

  it('runs centralized cleanup before exiting 52 (cleanup ordering)', async () => {
    const { runExitCleanup } = await import('./utils/cleanup.js');
    const cleanupMock = runExitCleanup as Mock<typeof runExitCleanup>;
    cleanupMock.mockClear();
    const exitOrder: string[] = [];
    cleanupMock.mockImplementation(async () => {
      exitOrder.push('cleanup');
    });
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      exitOrder.push(`exit(${code})`);
      throw new Error(`process.exit(${code}) called`);
    });

    const { config, runtimeSettings } = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
        runtimeSettings,
        config,
        settings: makeSettings(),
        input: 'hello',
        prompt_id: 'test-cleanup-ordering',
      }),
    ).rejects.toThrow('process.exit(52) called');

    // Centralized cleanup must complete BEFORE process.exit fires.
    expect(cleanupMock).toHaveBeenCalledTimes(1);
    expect(exitOrder).toStrictEqual(['cleanup', 'exit(52)']);
  });

  it('still exits 52 when cleanup throws (cleanup failure does not prevent exit)', async () => {
    const { runExitCleanup } = await import('./utils/cleanup.js');
    const cleanupMock = runExitCleanup as Mock<typeof runExitCleanup>;
    cleanupMock.mockClear();
    cleanupMock.mockRejectedValue(new Error('cleanup exploded'));

    const { config, runtimeSettings } = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
        runtimeSettings,
        config,
        settings: makeSettings(),
        input: 'hello',
        prompt_id: 'test-cleanup-throws',
      }),
    ).rejects.toThrow('process.exit(52) called');

    expect(cleanupMock).toHaveBeenCalledTimes(1);
  });

  it('passes through when a provider IS explicitly configured', async () => {
    const { config, runtimeSettings } = makeUnconfiguredConfig();
    const providerManager = configureProvider(
      config,
      'openai',
      runtimeSettings,
    );

    await runNonInteractive({
      runtimeSettings,
      config,
      settings: makeSettings(),
      input: 'hello',
      providerManager,
      prompt_id: 'test-configured',
    });

    expect(fromConfigMock).toHaveBeenCalledTimes(1);
  });

  it('passes through when LLXPRT_DEFAULT_PROVIDER selects a provider', async () => {
    process.env.LLXPRT_DEFAULT_PROVIDER = 'anthropic';
    const { config, runtimeSettings } = makeUnconfiguredConfig();
    const providerManager = configureProvider(
      config,
      'anthropic',
      runtimeSettings,
    );

    await runNonInteractive({
      runtimeSettings,
      config,
      settings: makeSettings(),
      input: 'hello',
      providerManager,
      prompt_id: 'test-env-provider',
    });

    expect(fromConfigMock).toHaveBeenCalledTimes(1);
  });
});

describe('runNonInteractive: unconfigured error output format contracts (#2481)', () => {
  afterEach(disposeOwnedConfigs);
  let originalEnv: Map<string, string | undefined>;
  let fromConfigMock: Mock<typeof original.fromConfig>;
  let capturedStderr: string[];

  beforeEach(async () => {
    originalEnv = new Map();
    for (const envVar of authEnvVars) {
      originalEnv.set(envVar, process.env[envVar]);
      delete process.env[envVar];
    }

    capturedStderr = [];
    __setWriteToStderrForTesting((chunk: string | Uint8Array) => {
      capturedStderr.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    });
    // reportUnconfiguredProviderError writes to process.stderr.write
    // directly (not through the errorReporting injectable seam).
    vi.spyOn(process.stderr, 'write').mockImplementation(
      (chunk: string | Uint8Array) => {
        capturedStderr.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      },
    );

    (shutdownTelemetry as Mock<typeof shutdownTelemetry>).mockResolvedValue(
      undefined,
    );
    (
      isTelemetrySdkInitialized as Mock<typeof isTelemetrySdkInitialized>
    ).mockReturnValue(true);
    vi.spyOn(DebugLogger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });

    fromConfigMock = fromConfigSentinel;
    fromConfigMock.mockReset();

    const { handleAtCommand } = await import(
      './ui/hooks/atCommandProcessor.js'
    );
    (handleAtCommand as Mock<typeof handleAtCommand>).mockImplementation(
      async ({ query }) => ({
        processedQuery: [{ type: 'text', text: query }],
      }),
    );
  });

  afterEach(() => {
    __setWriteToStderrForTesting(null);
    for (const envVar of authEnvVars) {
      const originalValue = originalEnv.get(envVar);
      if (originalValue !== undefined) {
        process.env[envVar] = originalValue;
      } else {
        delete process.env[envVar];
      }
    }
    vi.restoreAllMocks();
  });

  it('reports error as JSON when output format is JSON', async () => {
    const { config, runtimeSettings } = makeUnconfiguredConfig(
      OutputFormat.JSON,
    );

    await expect(
      runNonInteractive({
        runtimeSettings,
        config,
        settings: makeSettings(),
        input: 'hello',
        prompt_id: 'test-json',
      }),
    ).rejects.toThrow('process.exit(52) called');

    const stderrOutput = capturedStderr.join('');
    // JSON output must be valid JSON containing the error message.
    const parsed = JSON.parse(stderrOutput.trim());
    expect(parsed).toHaveProperty('error');
    expect(JSON.stringify(parsed)).toContain('No provider is configured');
  });

  it('reports error as stream-JSON when output format is STREAM_JSON', async () => {
    const { config, runtimeSettings } = makeUnconfiguredConfig(
      OutputFormat.STREAM_JSON,
    );

    await expect(
      runNonInteractive({
        runtimeSettings,
        config,
        settings: makeSettings(),
        input: 'hello',
        prompt_id: 'test-stream-json',
      }),
    ).rejects.toThrow('process.exit(52) called');

    const stderrOutput = capturedStderr.join('');
    // Each stream-JSON line must be valid JSON.
    const lines = stderrOutput.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('error');
    expect(JSON.stringify(parsed)).toContain('No provider is configured');
  });

  it('reports error as text when output format is TEXT', async () => {
    const { config, runtimeSettings } = makeUnconfiguredConfig(
      OutputFormat.TEXT,
    );

    await expect(
      runNonInteractive({
        runtimeSettings,
        config,
        settings: makeSettings(),
        input: 'hello',
        prompt_id: 'test-text',
      }),
    ).rejects.toThrow('process.exit(52) called');

    const stderrOutput = capturedStderr.join('');
    expect(stderrOutput).toContain('No provider is configured');
    // Plain text must NOT be valid JSON (no curly braces at the start).
    expect(stderrOutput.trim().startsWith('{')).toBe(false);
  });
});
