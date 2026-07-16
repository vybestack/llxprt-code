/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  isProviderConfigured,
  reportUnconfiguredProviderError,
  guardUnconfiguredProvider,
  UNCONFIGURED_PROVIDER_MESSAGE,
} from './unconfiguredProviderGuard.js';

function makeConfig(provider: string | undefined, hasActive: boolean): Config {
  return {
    getProvider: () => provider,
    getProviderManager: () => ({
      hasActiveProvider: () => hasActive,
    }),
  } as unknown as Config;
}

describe('isProviderConfigured (pure guard)', () => {
  it('returns true when manager has an active provider', () => {
    expect(isProviderConfigured(makeConfig(undefined, true))).toBe(true);
  });

  it('returns false when manager has no active provider (regardless of config string)', () => {
    expect(isProviderConfigured(makeConfig(undefined, false))).toBe(false);
  });

  it('returns false when provider is empty string and no active provider', () => {
    expect(isProviderConfigured(makeConfig('', false))).toBe(false);
  });

  it('returns true when manager has active provider even if config string is empty', () => {
    expect(isProviderConfigured(makeConfig('', true))).toBe(true);
  });

  it('returns true when manager has active provider even if config string differs', () => {
    expect(isProviderConfigured(makeConfig('openai', true))).toBe(true);
  });

  it('returns false when manager is undefined', () => {
    const config = {
      getProvider: () => 'openai',
      getProviderManager: () => undefined,
    } as unknown as Config;
    expect(isProviderConfigured(config)).toBe(false);
  });

  it('ignores config.getProvider string entirely — manager is the single source of truth', () => {
    // A non-empty config provider string with no active manager is NOT configured.
    const configNoManager = {
      getProvider: () => 'gemini',
      getProviderManager: () => undefined,
    } as unknown as Config;
    expect(isProviderConfigured(configNoManager)).toBe(false);

    // A non-empty config provider string with an inactive manager is NOT configured.
    expect(isProviderConfigured(makeConfig('gemini', false))).toBe(false);
  });

  it('has no side effects — does not call process.exit or throw', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('should not be called');
    });
    const result = isProviderConfigured(makeConfig(undefined, false));
    expect(result).toBe(false);
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

describe('UNCONFIGURED_PROVIDER_MESSAGE', () => {
  it('mentions actionable options for non-interactive use', () => {
    expect(UNCONFIGURED_PROVIDER_MESSAGE).toContain('--provider');
    expect(UNCONFIGURED_PROVIDER_MESSAGE).toContain('--profile-load');
    expect(UNCONFIGURED_PROVIDER_MESSAGE).toContain('LLXPRT_DEFAULT_PROVIDER');
    expect(UNCONFIGURED_PROVIDER_MESSAGE).toContain('/setup');
    expect(UNCONFIGURED_PROVIDER_MESSAGE).toContain('hosted provider');
    expect(UNCONFIGURED_PROVIDER_MESSAGE).toContain('local model');
    expect(UNCONFIGURED_PROVIDER_MESSAGE).toContain('custom');
    expect(UNCONFIGURED_PROVIDER_MESSAGE).toContain('profile');
  });
});

describe('reportUnconfiguredProviderError: output-format-aware reporting', () => {
  let stderrChunks: string[];

  beforeEach(() => {
    stderrChunks = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(
      (chunk: string | Uint8Array) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeConfigWithFormat(
    format: string,
  ): Pick<Config, 'getOutputFormat'> {
    return { getOutputFormat: () => format as Config['outputFormat'] };
  }

  it('writes plain text to stderr for TEXT format', () => {
    reportUnconfiguredProviderError(makeConfigWithFormat('text'));

    const output = stderrChunks.join('');
    expect(output).toContain('No provider is configured');
    expect(output.trim().startsWith('{')).toBe(false);
  });

  it('writes valid JSON to stderr for JSON format', () => {
    reportUnconfiguredProviderError(makeConfigWithFormat('json'));

    const output = stderrChunks.join('').trim();
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('error');
    expect(parsed.error.message).toContain('No provider is configured');
  });

  it('writes valid stream-JSON to stderr for STREAM_JSON format', () => {
    reportUnconfiguredProviderError(makeConfigWithFormat('stream-json'));

    const output = stderrChunks.join('').trim();
    const lines = output.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('error');
    expect(parsed.message).toContain('No provider is configured');
  });
});

describe('reportUnconfiguredProviderError: single emission', () => {
  it('does NOT double-emit via debugLogger after writing to stderr (TEXT)', () => {
    const stderrCalls: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(
      (chunk: string | Uint8Array) => {
        stderrCalls.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      },
    );
    const debugErrorSpy = vi
      .spyOn(debugLogger, 'error')
      .mockImplementation(() => {});

    reportUnconfiguredProviderError({
      getOutputFormat: () => 'text' as Config['outputFormat'],
    });

    // Exactly one stderr write with the message.
    const combined = stderrCalls.join('');
    const occurrences = (combined.match(/No provider is configured/g) ?? [])
      .length;
    expect(occurrences).toBe(1);
    // debugLogger.error must NOT be called after the stderr write.
    expect(debugErrorSpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('does NOT double-emit via debugLogger after writing to stderr (JSON)', () => {
    const stderrCalls: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(
      (chunk: string | Uint8Array) => {
        stderrCalls.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      },
    );
    const debugErrorSpy = vi
      .spyOn(debugLogger, 'error')
      .mockImplementation(() => {});

    reportUnconfiguredProviderError({
      getOutputFormat: () => 'json' as Config['outputFormat'],
    });

    const combined = stderrCalls.join('');
    const occurrences = (combined.match(/No provider is configured/g) ?? [])
      .length;
    expect(occurrences).toBe(1);
    expect(debugErrorSpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});

describe('guardUnconfiguredProvider: void return and exit behavior', () => {
  let stderrSpy: MockInstance;
  let exitSpy: MockInstance;

  beforeEach(() => {
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit should not be called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a Promise<void> and settles before mocks restore', async () => {
    const config = {
      getProviderManager: () => ({
        hasActiveProvider: () => false,
      }),
      isInteractive: () => false,
      getOutputFormat: () => 'text' as Config['outputFormat'],
    } as unknown as Config;

    // Re-stub process.exit for this test so the guard's awaited cleanup +
    // finally can run through to the exit call without terminating the
    // process. The promise must be fully settled before mocks restore.
    exitSpy.mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });

    const result = guardUnconfiguredProvider(config, () => Promise.resolve());
    expect(result).toBeInstanceOf(Promise);
    // Await settlement so the real guard's runCleanup + finally complete
    // before the afterEach restores the real process.exit.
    await expect(result).rejects.toThrow('process.exit(52) called');
    expect(exitSpy).toHaveBeenCalledWith(52);
  });

  it('resolves void when provider IS configured', async () => {
    const config = {
      getProviderManager: () => ({
        hasActiveProvider: () => true,
      }),
      isInteractive: () => false,
    } as unknown as Config;

    const result = await guardUnconfiguredProvider(config, () =>
      Promise.resolve(),
    );
    expect(result).toBeUndefined();
  });

  it('resolves void in interactive mode even when unconfigured', async () => {
    const config = {
      getProviderManager: () => ({
        hasActiveProvider: () => false,
      }),
      isInteractive: () => true,
    } as unknown as Config;

    const result = await guardUnconfiguredProvider(config, () =>
      Promise.resolve(),
    );
    expect(result).toBeUndefined();
  });

  it('exits with code 52 when unconfigured and non-interactive', async () => {
    const config = {
      getProviderManager: () => ({
        hasActiveProvider: () => false,
      }),
      isInteractive: () => false,
      getOutputFormat: () => 'text' as Config['outputFormat'],
    } as unknown as Config;

    exitSpy.mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });

    await expect(
      guardUnconfiguredProvider(config, () => Promise.resolve()),
    ).rejects.toThrow('process.exit(52) called');
    expect(exitSpy).toHaveBeenCalledWith(52);
  });

  it('still exits 52 even when cleanup throws', async () => {
    const config = {
      getProviderManager: () => ({
        hasActiveProvider: () => false,
      }),
      isInteractive: () => false,
      getOutputFormat: () => 'text' as Config['outputFormat'],
    } as unknown as Config;

    exitSpy.mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });

    await expect(
      guardUnconfiguredProvider(config, () =>
        Promise.reject(new Error('cleanup failed')),
      ),
    ).rejects.toThrow('process.exit(52) called');
    expect(exitSpy).toHaveBeenCalledWith(52);
  });

  it('runs cleanup before exiting', async () => {
    const config = {
      getProviderManager: () => ({
        hasActiveProvider: () => false,
      }),
      isInteractive: () => false,
      getOutputFormat: () => 'text' as Config['outputFormat'],
    } as unknown as Config;

    const cleanupFn = vi.fn().mockResolvedValue(undefined);
    exitSpy.mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });

    await expect(guardUnconfiguredProvider(config, cleanupFn)).rejects.toThrow(
      'process.exit(52) called',
    );
    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  it('logs cleanup failure via debugLogger (not stderr) and still exits 52', async () => {
    const config = {
      getProviderManager: () => ({
        hasActiveProvider: () => false,
      }),
      isInteractive: () => false,
      getOutputFormat: () => 'text' as Config['outputFormat'],
    } as unknown as Config;

    const stderrCalls: string[] = [];
    stderrSpy.mockImplementation((chunk: string | Uint8Array) => {
      stderrCalls.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    });
    const debugErrorSpy = vi
      .spyOn(debugLogger, 'error')
      .mockImplementation(() => {});
    exitSpy.mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });

    await expect(
      guardUnconfiguredProvider(config, () =>
        Promise.reject(new Error('cleanup failed')),
      ),
    ).rejects.toThrow('process.exit(52) called');
    expect(exitSpy).toHaveBeenCalledWith(52);

    // Cleanup failure is reported once via debugLogger (debug-only, does not
    // corrupt JSON/stream-JSON structured output).
    expect(debugErrorSpy).toHaveBeenCalledTimes(1);
    // The stderr output must still contain exactly one occurrence of the
    // unconfigured-provider message (not duplicated by cleanup logging).
    const combined = stderrCalls.join('');
    const occurrences = (combined.match(/No provider is configured/g) ?? [])
      .length;
    expect(occurrences).toBe(1);
  });
});
