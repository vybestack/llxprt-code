/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the production guard helper used by the CLI main
 * boundary (#2481). The CLI main calls `guardUnconfiguredProvider` between
 * `configureProvidersAndServices`/list-extension handling and
 * `activateConfiguredProvider`. If that call were removed or moved after
 * Agent construction, a non-interactive run with no provider would proceed to
 * activation/construction instead of exiting with code 52.
 *
 * These tests exercise the REAL guard helper (not a copy) to verify the
 * observable contract: exit 52 on unconfigured non-interactive, fall-through
 * on configured or interactive.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';
import {
  guardUnconfiguredProvider,
  UNCONFIGURED_PROVIDER_MESSAGE,
} from './unconfiguredProviderGuard.js';

function makeConfig(hasActive: boolean, interactive: boolean): Config {
  return {
    getProviderManager: () => ({
      hasActiveProvider: () => hasActive,
    }),
    isInteractive: () => interactive,
  } as unknown as Config;
}

describe('guardUnconfiguredProvider: production main-boundary guard (#2481)', () => {
  let cleanupFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cleanupFn = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code}) called`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns void (caller proceeds) when a provider is configured', async () => {
    const config = makeConfig(true, false);
    const result = await guardUnconfiguredProvider(config, cleanupFn);
    expect(result).toBeUndefined();
    expect(process.exit).not.toHaveBeenCalled();
    expect(cleanupFn).not.toHaveBeenCalled();
  });

  it('returns void (caller proceeds) in interactive mode even when unconfigured', async () => {
    const config = makeConfig(false, true);
    const result = await guardUnconfiguredProvider(config, cleanupFn);
    expect(result).toBeUndefined();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('exits with code 52 (FATAL_CONFIG_ERROR) when unconfigured and non-interactive', async () => {
    const config = makeConfig(false, false);
    await expect(guardUnconfiguredProvider(config, cleanupFn)).rejects.toThrow(
      'process.exit(52) called',
    );
    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  it('reports the shared UNCONFIGURED_PROVIDER_MESSAGE to stderr before exit', async () => {
    const config = makeConfig(false, false);
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(
      (chunk: string | Uint8Array) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      },
    );

    await expect(guardUnconfiguredProvider(config, cleanupFn)).rejects.toThrow(
      'process.exit(52) called',
    );

    const combined = stderrChunks.join('');
    expect(combined).toContain(UNCONFIGURED_PROVIDER_MESSAGE);
  });

  it('calls cleanup exactly once and exits 52 on the unconfigured non-interactive path', async () => {
    // Verify the guard owns the single exit path: it calls cleanup once
    // then exits with code 52.
    const config = makeConfig(false, false);
    await expect(guardUnconfiguredProvider(config, cleanupFn)).rejects.toThrow(
      'process.exit(52) called',
    );
    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  it('does NOT call cleanup in interactive mode (caller proceeds)', async () => {
    const config = makeConfig(false, true);
    const result = await guardUnconfiguredProvider(config, cleanupFn);
    expect(result).toBeUndefined();
    expect(process.exit).not.toHaveBeenCalled();
    expect(cleanupFn).not.toHaveBeenCalled();
  });

  it('still exits 52 when cleanup rejects (cleanup failure does not prevent exit)', async () => {
    const config = makeConfig(false, false);
    const failingCleanup = vi
      .fn()
      .mockRejectedValue(new Error('cleanup failed'));
    await expect(
      guardUnconfiguredProvider(config, failingCleanup),
    ).rejects.toThrow('process.exit(52) called');
    expect(failingCleanup).toHaveBeenCalledTimes(1);
  });
});
