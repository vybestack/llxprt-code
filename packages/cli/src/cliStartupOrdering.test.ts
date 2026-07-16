/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the production guard helper used by the CLI main
 * boundary (#2481). The CLI main calls `guardUnconfiguredProvider` after
 * `configureProvidersAndServices`/list-extension handling and the ACP/Zed
 * integration check, but before `activateConfiguredProvider`. If that call
 * were removed or moved after Agent construction, a non-interactive run with
 * no provider would proceed to activation/construction instead of exiting
 * with code 52.
 *
 * These tests exercise the REAL guard helper (not a copy) to verify the
 * observable contract: exit 52 on unconfigured non-interactive, fall-through
 * on configured or interactive. The orchestration test below exercises the
 * REAL main() entrypoint to prove the guard fires BEFORE provider activation
 * and Agent construction, while the ACP/Zed path reaches
 * ensureAcpProviderActivated without passing the guard.
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

// ── Real main() orchestration test (#2481) ─────────────────────────────────
//
// Exercises the REAL main() entrypoint to prove the production
// guardUnconfiguredProvider call stops the startup sequence BEFORE
// activateConfiguredProvider and Agent construction. The guard is NOT
// re-implemented here — main() calls the real helper from
// ./unconfiguredProviderGuard.js. Only the heavy startup dependencies
// (bootstrap, provider init, agent construction, session dispatch) are mocked
// so the ordering between the guard and activation is observable.

describe('main() orchestration: guard stops before activation (#2481)', () => {
  const callOrder: string[] = [];

  beforeEach(() => {
    callOrder.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function runMainWithConfig(config: Config): Promise<void> {
    vi.resetModules();

    // Mock heavy startup modules to no-ops, recording call order at the
    // key boundaries (guard, activation, agent construction).
    vi.doMock('./unconfiguredProviderGuard.js', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('./unconfiguredProviderGuard.js')>();
      return {
        ...actual,
        // Wrap the REAL guard so we can observe it was reached, then let it
        // run. The real guard calls process.exit (mocked to throw) on the
        // unconfigured path.
        guardUnconfiguredProvider: async (
          cfg: Config,
          runCleanup: () => Promise<void>,
        ) => {
          callOrder.push('guard');
          return actual.guardUnconfiguredProvider(cfg, runCleanup);
        },
      };
    });

    vi.doMock('./cliProviderInit.js', () => ({
      activateConfiguredProvider: async () => {
        callOrder.push('activation');
        return { authFailed: false, token: undefined, intent: undefined };
      },
      configureProvidersAndServices: async () => ({}),
      connectIdeClientIfEnabled: async () => {},
      ensureAcpProviderActivated: () => {
        callOrder.push('acp-activated');
      },
    }));

    vi.doMock('./cliTerminalSession.js', () => ({
      constructAgentWithSpinner: async () => {
        callOrder.push('agent-construction');
        return {};
      },
      prepareTerminalSession: async () => {},
    }));

    vi.doMock('./cliSessionBootstrap.js', () => ({
      bootstrapRuntimeAndConfig: async () => ({
        config,
        runtimeSettingsService: {},
      }),
      setupSessionRecording: async () => undefined,
    }));

    vi.doMock('./session/nonInteractiveSession.js', () => ({
      dispatchInteractiveOrNonInteractive: async () => {
        callOrder.push('dispatch');
      },
    }));

    vi.doMock('./cliSandbox.js', () => ({
      maybeHopIntoSandbox: async () => {},
    }));

    vi.doMock('./config/cliArgParser.js', () => ({
      parseArguments: async () => ({ prompt: 'hello' }),
    }));

    vi.doMock('./config/settings.js', () => ({
      loadSettings: () => ({ merged: {}, errors: [] }),
    }));

    vi.doMock('./cliBootstrap.js', () => ({
      configureEarlyDebugLogging: () => {},
      createMemoizedStdinReader: () => async () => '',
      ensureStdinOrPromptProvided: async () => {},
      handleVersionAndHelpFlags: async () => {},
      maybeRelaunchForMemory: async () => {},
      redirectConsoleForAcp: () => {},
      rejectPromptInteractiveWithPipedStdin: async () => {},
      throwIfSettingsErrors: () => {},
      ParsedCliArgs: {} as never,
    }));

    vi.doMock('./utils/cleanup.js', () => ({
      cleanupCheckpoints: async () => {},
      runExitCleanup: async () => {},
      registerSyncCleanup: () => {},
    }));

    vi.doMock('./utils/sessionCleanup.js', () => ({
      cleanupExpiredSessions: async () => {},
    }));

    vi.doMock('./zed-integration/zedIntegration.js', () => ({
      runZedIntegration: async () => {},
    }));

    vi.doMock('./config/pathMigration.js', () => ({
      runStartupMigration: () => ({ migrated: false }),
      reportStartupResult: () => ({ messages: [], needsLegacyFallback: false }),
    }));

    vi.doMock('./session/errorReporting.js', () => ({
      formatNonInteractiveError: () => '',
    }));
    vi.doMock('./session/outputListeners.js', () => ({
      initializeOutputListenersAndFlush: () => {},
    }));
    vi.doMock('./session/signalHandlers.js', () => ({
      installNonInteractiveSigintHandler: () => {},
      setupUnhandledRejectionHandler: () => {},
      __resetUnhandledRejectionStateForTesting: () => {},
    }));
    vi.doMock('./session/interactiveUI.js', () => ({
      startInteractiveUI: async () => {},
    }));

    const { main } = await import('./cli.js');
    await main();
  }

  it('non-interactive + unconfigured: guard fires and activation is never reached', async () => {
    const config = {
      getProviderManager: () => ({ hasActiveProvider: () => false }),
      isInteractive: () => false,
      getOutputFormat: () => 'text',
      getListExtensions: () => false,
      getExperimentalZedIntegration: () => false,
    } as unknown as Config;

    // Mock process.exit to throw so the guard's exit is observable without
    // terminating the test process.
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runMainWithConfig(config)).rejects.toThrow('process.exit(52)');

    expect(callOrder).toContain('guard');
    expect(callOrder).not.toContain('activation');
    expect(callOrder).not.toContain('agent-construction');
  });

  it('configured: guard falls through and activation + dispatch proceed', async () => {
    const config = {
      getProviderManager: () => ({ hasActiveProvider: () => true }),
      isInteractive: () => false,
      getOutputFormat: () => 'text',
      getListExtensions: () => false,
      getExperimentalZedIntegration: () => false,
    } as unknown as Config;

    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('unexpected process.exit');
    });

    await runMainWithConfig(config);

    // Guard was reached (fell through) and activation + dispatch ran after it.
    expect(callOrder).toContain('guard');
    expect(callOrder).toContain('activation');
    expect(callOrder).toContain('dispatch');

    // Ordering: guard must come before activation.
    expect(callOrder.indexOf('guard')).toBeLessThan(
      callOrder.indexOf('activation'),
    );
  });

  it('ACP/Zed: ensureAcpProviderActivated is reached without passing the general guard', async () => {
    const config = {
      getProviderManager: () => ({ hasActiveProvider: () => false }),
      isInteractive: () => false,
      getOutputFormat: () => 'text',
      getListExtensions: () => false,
      getExperimentalZedIntegration: () => true,
    } as unknown as Config;

    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('unexpected process.exit');
    });

    await runMainWithConfig(config);

    // ensureAcpProviderActivated was reached.
    expect(callOrder).toContain('acp-activated');
    // The general unconfigured-provider guard was NOT reached — ACP
    // bypasses it so ACP-specific provider activation can run.
    expect(callOrder).not.toContain('guard');
    // Ordinary provider activation and Agent construction are also
    // skipped — ACP runs its own runtime.
    expect(callOrder).not.toContain('activation');
    expect(callOrder).not.toContain('agent-construction');
  });
});
