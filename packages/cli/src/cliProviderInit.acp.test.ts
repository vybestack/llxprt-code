/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for ensureAcpProviderActivated (#2378 review remediation).
 *
 * These tests assert the OBSERVABLE CONTRACT: in ACP/Zed mode, provider
 * activation is best-effort — it must never throw or produce an unhandled
 * rejection, but failures (both synchronous and asynchronous) must be made
 * observable via the debug logger so they are not silently swallowed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';

// Capture debugLogger calls without mocking the module under test.
//
// ensureAcpProviderActivated logs via the `debugLogger` singleton, which is
// OWNED by @vybestack/llxprt-code-telemetry (cliProviderInit.ts imports it from
// there after the owner-import migration — #2378). Mock the telemetry package
// so the spy intercepts the SAME singleton the production code writes to; a
// stale mock on the core re-export would observe a different object and never
// see the warn call.
const debugLoggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-telemetry', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-telemetry')>();
  return {
    ...actual,
    debugLogger: {
      ...actual.debugLogger,
      warn: debugLoggerMock.warn,
      error: debugLoggerMock.error,
    },
  };
});

import { ensureAcpProviderActivated } from './cliProviderInit.js';

interface FakeProviderManager {
  hasActiveProvider: () => boolean;
  setActiveProvider: (provider: string) => unknown;
}

function makeConfig(
  provider: string | undefined,
  providerManager: FakeProviderManager | undefined,
): Config {
  return {
    getProvider: () => provider,
    getProviderManager: () => providerManager,
  } as unknown as Config;
}

function makeProviderManager(
  hasActive: boolean,
  activateImpl: () => unknown,
): FakeProviderManager {
  return {
    hasActiveProvider: () => hasActive,
    setActiveProvider: () => activateImpl(),
  };
}

describe('ensureAcpProviderActivated', () => {
  beforeEach(() => {
    debugLoggerMock.warn.mockClear();
    debugLoggerMock.error.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a no-op when no provider is configured', () => {
    const pm = makeProviderManager(false, () => undefined);
    const config = makeConfig(undefined, pm);

    ensureAcpProviderActivated(config);

    expect(pm.hasActiveProvider()).toBe(false);
  });

  it('is a no-op when provider manager is absent', () => {
    const config = makeConfig('gemini', undefined);

    expect(() => ensureAcpProviderActivated(config)).not.toThrow();
  });

  it('is a no-op when a provider is already active', () => {
    let activationCalled = false;
    const pm = makeProviderManager(true, () => {
      activationCalled = true;
    });
    const config = makeConfig('gemini', pm);

    ensureAcpProviderActivated(config);

    expect(activationCalled).toBe(false);
  });

  it('activates the provider synchronously when none is active', () => {
    let activated = false;
    const pm = makeProviderManager(false, () => {
      activated = true;
    });
    const config = makeConfig('anthropic', pm);

    ensureAcpProviderActivated(config);

    expect(activated).toBe(true);
  });

  it('logs a warning and does not throw when synchronous activation throws', () => {
    const syncError = new Error('sync activation failed');
    const pm = makeProviderManager(false, () => {
      throw syncError;
    });
    const config = makeConfig('anthropic', pm);

    expect(() => ensureAcpProviderActivated(config)).not.toThrow();
    expect(debugLoggerMock.warn).toHaveBeenCalledTimes(1);
    const loggedArg = debugLoggerMock.warn.mock.calls[0][0];
    const loggedMessage =
      typeof loggedArg === 'function' ? String(loggedArg()) : String(loggedArg);
    expect(loggedMessage).toContain('sync activation failed');
  });

  it('does not produce an unhandled rejection when async activation rejects', async () => {
    const asyncError = new Error('async activation rejected');
    const pm = makeProviderManager(false, async () => {
      throw asyncError;
    });
    const config = makeConfig('anthropic', pm);

    // Must not throw synchronously...
    expect(() => ensureAcpProviderActivated(config)).not.toThrow();

    // ...and must not leave an unhandled rejection. Drain microtasks so any
    // attached .catch handlers run before we assert.
    await new Promise((resolve) => setImmediate(resolve));

    expect(debugLoggerMock.warn).toHaveBeenCalledTimes(1);
    const loggedArg = debugLoggerMock.warn.mock.calls[0][0];
    const loggedMessage =
      typeof loggedArg === 'function' ? String(loggedArg()) : String(loggedArg);
    expect(loggedMessage).toContain('async activation rejected');
  });

  it('does not produce an unhandled rejection when async activation succeeds', async () => {
    const pm = makeProviderManager(false, async () => undefined);
    const config = makeConfig('anthropic', pm);

    ensureAcpProviderActivated(config);

    // Drain microtasks; if the promise is not handled this would cause an
    // unhandledRejection event (vitest fails on those by default).
    await new Promise((resolve) => setImmediate(resolve));

    expect(debugLoggerMock.warn).not.toHaveBeenCalled();
  });
});
