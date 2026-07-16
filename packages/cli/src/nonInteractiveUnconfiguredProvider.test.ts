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

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';
import {
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  DebugLogger,
  PLACEHOLDER_MODEL,
} from '@vybestack/llxprt-code-core';
import { runNonInteractive } from './nonInteractiveCli.js';
import type { LoadedSettings } from './config/settings.js';
import { __setWriteToStderrForTesting } from './session/errorReporting.js';

vi.mock('@vybestack/llxprt-code-agents', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-agents')>();
  return {
    ...original,
    fromConfig: vi.fn(),
  };
});

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...original,
    shutdownTelemetry: vi.fn(),
    isTelemetrySdkInitialized: vi.fn().mockReturnValue(true),
  };
});

vi.mock('./utils/cleanup.js', () => ({
  runExitCleanup: vi.fn().mockResolvedValue(undefined),
  cleanupCheckpoints: vi.fn().mockResolvedValue(undefined),
  registerSyncCleanup: vi.fn(),
}));

vi.mock('./ui/hooks/atCommandProcessor.js');
vi.mock('./services/CommandService.js', () => ({
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

function makeUnconfiguredConfig(): Config {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    getMaxSessionTurns: vi.fn().mockReturnValue(10),
    getIdeMode: vi.fn().mockReturnValue(false),
    getContentGeneratorConfig: vi.fn().mockReturnValue({}),
    getDebugMode: vi.fn().mockReturnValue(false),
    getProvider: vi.fn().mockReturnValue(undefined),
    getModel: vi.fn().mockReturnValue(PLACEHOLDER_MODEL),
    getProviderManager: vi.fn().mockReturnValue({
      getActiveProviderName: () => '',
      hasActiveProvider: () => false,
      getServerToolsProvider: () => null,
    }),
    getOutputFormat: vi.fn().mockReturnValue('text'),
    getFolderTrust: vi.fn().mockReturnValue(false),
    isTrustedFolder: vi.fn().mockReturnValue(false),
    getProjectRoot: vi.fn().mockReturnValue('/tmp/test-project'),
    getSessionId: vi.fn().mockReturnValue('test-session'),
    getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    setEphemeralSetting: vi.fn(),
    getSettingsService: vi.fn().mockReturnValue({ get: vi.fn(), set: vi.fn() }),
    isInteractive: vi.fn().mockReturnValue(false),
    storage: {
      getDir: vi.fn().mockReturnValue('/tmp/.llxprt'),
    },
  } as unknown as Config;
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
  let originalEnv: Map<string, string | undefined>;
  let fromConfigMock: Mock;
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

    vi.mocked(shutdownTelemetry).mockResolvedValue(undefined);
    vi.mocked(isTelemetrySdkInitialized).mockReturnValue(true);
    vi.spyOn(DebugLogger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });

    const { fromConfig } = await import('@vybestack/llxprt-code-agents');
    fromConfigMock = vi.mocked(fromConfig);
    fromConfigMock.mockReset();
    fromConfigMock.mockResolvedValue({
      async *stream() {
        yield { type: 'done', reason: 'stop' };
      },
      dispose: vi.fn().mockResolvedValue(undefined),
      getMessageBus: () => ({}) as never,
      hooks: {
        triggerSessionStart: () => Promise.resolve({}),
        triggerSessionEnd: () => Promise.resolve(),
      },
    } as never);

    const { handleAtCommand } = await import(
      './ui/hooks/atCommandProcessor.js'
    );
    vi.mocked(handleAtCommand).mockImplementation(async ({ query }) => ({
      processedQuery: [{ type: 'text', text: query }],
    }));
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
    const config = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
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
    const config = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
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
    const config = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
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
    const config = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
        config,
        settings: makeSettings(),
        input: 'hello',
        prompt_id: 'test-anthropic-bare',
      }),
    ).rejects.toThrow('process.exit(52) called');

    expect(fromConfigMock).not.toHaveBeenCalled();
  });

  it('provides actionable guidance mentioning --provider, --profile-load, and LLXPRT_DEFAULT_PROVIDER', async () => {
    const config = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
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
    const cleanupMock = vi.mocked(runExitCleanup);
    cleanupMock.mockClear();
    const exitOrder: string[] = [];
    cleanupMock.mockImplementation(async () => {
      exitOrder.push('cleanup');
    });
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      exitOrder.push(`exit(${code})`);
      throw new Error(`process.exit(${code}) called`);
    });

    const config = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
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
    const cleanupMock = vi.mocked(runExitCleanup);
    cleanupMock.mockClear();
    cleanupMock.mockRejectedValue(new Error('cleanup exploded'));

    const config = makeUnconfiguredConfig();

    await expect(
      runNonInteractive({
        config,
        settings: makeSettings(),
        input: 'hello',
        prompt_id: 'test-cleanup-throws',
      }),
    ).rejects.toThrow('process.exit(52) called');

    expect(cleanupMock).toHaveBeenCalledTimes(1);
  });

  it('passes through when a provider IS explicitly configured', async () => {
    const config = makeUnconfiguredConfig();
    vi.mocked(config.getProvider).mockReturnValue('openai');
    vi.mocked(config.getProviderManager).mockReturnValue({
      getActiveProviderName: () => 'openai',
      hasActiveProvider: () => true,
      getServerToolsProvider: () => null,
    } as never);

    await runNonInteractive({
      config,
      settings: makeSettings(),
      input: 'hello',
      prompt_id: 'test-configured',
    });

    expect(fromConfigMock).toHaveBeenCalledTimes(1);
  });

  it('passes through when LLXPRT_DEFAULT_PROVIDER selects a provider', async () => {
    process.env.LLXPRT_DEFAULT_PROVIDER = 'anthropic';
    const config = makeUnconfiguredConfig();
    vi.mocked(config.getProvider).mockReturnValue('anthropic');
    vi.mocked(config.getProviderManager).mockReturnValue({
      getActiveProviderName: () => 'anthropic',
      hasActiveProvider: () => true,
      getServerToolsProvider: () => null,
    } as never);

    await runNonInteractive({
      config,
      settings: makeSettings(),
      input: 'hello',
      prompt_id: 'test-env-provider',
    });

    expect(fromConfigMock).toHaveBeenCalledTimes(1);
  });
});

describe('runNonInteractive: unconfigured error output format contracts (#2481)', () => {
  let originalEnv: Map<string, string | undefined>;
  let fromConfigMock: Mock;
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

    vi.mocked(shutdownTelemetry).mockResolvedValue(undefined);
    vi.mocked(isTelemetrySdkInitialized).mockReturnValue(true);
    vi.spyOn(DebugLogger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });

    const { fromConfig } = await import('@vybestack/llxprt-code-agents');
    fromConfigMock = vi.mocked(fromConfig);
    fromConfigMock.mockReset();

    const { handleAtCommand } = await import(
      './ui/hooks/atCommandProcessor.js'
    );
    vi.mocked(handleAtCommand).mockImplementation(async ({ query }) => ({
      processedQuery: [{ type: 'text', text: query }],
    }));
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
    const config = makeUnconfiguredConfig();
    vi.mocked(config.getOutputFormat).mockReturnValue('json' as never);

    await expect(
      runNonInteractive({
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
    const config = makeUnconfiguredConfig();
    vi.mocked(config.getOutputFormat).mockReturnValue('stream-json' as never);

    await expect(
      runNonInteractive({
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
    const config = makeUnconfiguredConfig();
    vi.mocked(config.getOutputFormat).mockReturnValue('text' as never);

    await expect(
      runNonInteractive({
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
