/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the production guard helper (#2481) and capability
 * consumption ordering (#1954 AC4/AC5). Exercises the REAL guard helper and
 * main() entrypoint to verify observable contracts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';
import {
  guardUnconfiguredProvider,
  UNCONFIGURED_PROVIDER_MESSAGE,
} from './unconfiguredProviderGuard.js';

function makeConfig(hasActive: boolean, interactive: boolean): Config {
  return {
    getProviderManager: () => ({ hasActiveProvider: () => hasActive }),
    isInteractive: () => interactive,
    getOutputFormat: () => 'text',
    getListExtensions: () => false,
    getExperimentalZedIntegration: () => false,
  } as unknown as Config;
}

function setupCommonMainMocks(callOrder: string[], config: Config): void {
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
  vi.doMock('./cliSandbox.js', () => ({ maybeHopIntoSandbox: async () => {} }));
  vi.doMock('./config/cliArgParser.js', () => ({
    parseArguments: async () => ({ prompt: 'hello' }),
  }));
  vi.doMock('./config/settings.js', () => ({
    loadSettings: () => {
      callOrder.push('loadSettings');
      return { merged: { ui: { unicode: 'auto' } }, errors: [] };
    },
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

  afterEach(() => vi.restoreAllMocks());

  it('returns void when a provider is configured', async () => {
    const result = await guardUnconfiguredProvider(
      makeConfig(true, false),
      cleanupFn,
    );
    expect(result).toBeUndefined();
    expect(process.exit).not.toHaveBeenCalled();
    expect(cleanupFn).not.toHaveBeenCalled();
  });

  it('returns void in interactive mode even when unconfigured', async () => {
    const result = await guardUnconfiguredProvider(
      makeConfig(false, true),
      cleanupFn,
    );
    expect(result).toBeUndefined();
    expect(process.exit).not.toHaveBeenCalled();
    expect(cleanupFn).not.toHaveBeenCalled();
  });

  it('exits with code 52 when unconfigured and non-interactive', async () => {
    await expect(
      guardUnconfiguredProvider(makeConfig(false, false), cleanupFn),
    ).rejects.toThrow('process.exit(52) called');
    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  it('reports UNCONFIGURED_PROVIDER_MESSAGE to stderr before exit', async () => {
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(
      (chunk: string | Uint8Array) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      },
    );
    await expect(
      guardUnconfiguredProvider(makeConfig(false, false), cleanupFn),
    ).rejects.toThrow('process.exit(52) called');
    expect(stderrChunks.join('')).toContain(UNCONFIGURED_PROVIDER_MESSAGE);
  });

  it('still exits 52 when cleanup rejects', async () => {
    const failingCleanup = vi
      .fn()
      .mockRejectedValue(new Error('cleanup failed'));
    await expect(
      guardUnconfiguredProvider(makeConfig(false, false), failingCleanup),
    ).rejects.toThrow('process.exit(52) called');
    expect(failingCleanup).toHaveBeenCalledTimes(1);
  });
});

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
    vi.doMock('./unconfiguredProviderGuard.js', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('./unconfiguredProviderGuard.js')>();
      return {
        ...actual,
        guardUnconfiguredProvider: async (
          cfg: Config,
          runCleanup: () => Promise<void>,
        ) => {
          callOrder.push('guard');
          return actual.guardUnconfiguredProvider(cfg, runCleanup);
        },
      };
    });
    setupCommonMainMocks(callOrder, config);
    const { main } = await import('./cli.js');
    await main();
  }

  it('non-interactive + unconfigured: guard fires and activation is never reached', async () => {
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(runMainWithConfig(makeConfig(false, false))).rejects.toThrow(
      'process.exit(52)',
    );
    expect(callOrder).toContain('guard');
    expect(callOrder).not.toContain('activation');
    expect(callOrder).not.toContain('agent-construction');
  });

  it('configured: guard falls through and activation + dispatch proceed', async () => {
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('unexpected process.exit');
    });
    await runMainWithConfig(makeConfig(true, false));
    expect(callOrder).toContain('guard');
    expect(callOrder).toContain('activation');
    expect(callOrder).toContain('dispatch');
    expect(callOrder.indexOf('guard')).toBeLessThan(
      callOrder.indexOf('activation'),
    );
  });

  it('ACP/Zed: ensureAcpProviderActivated is reached without passing the general guard', async () => {
    const config = {
      ...makeConfig(false, false),
      getExperimentalZedIntegration: () => true,
    } as unknown as Config;
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('unexpected process.exit');
    });
    await runMainWithConfig(config);
    expect(callOrder).toContain('acp-activated');
    expect(callOrder).not.toContain('guard');
    expect(callOrder).not.toContain('activation');
    expect(callOrder).not.toContain('agent-construction');
  });
});

describe('main() orchestration: capability consumption precedes settings/sandbox.bashrc (#1954 AC4)', () => {
  const callOrder: string[] = [];

  beforeEach(() => {
    callOrder.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function runMainConfigured(config: Config): Promise<void> {
    vi.resetModules();
    vi.doMock('@vybestack/llxprt-code-providers/auth.js', () => ({
      createTokenStore: () => {
        callOrder.push('createTokenStore');
        return {};
      },
    }));
    vi.doMock('./utils/sandbox-bashrc.js', () => ({
      applySandboxBashrc: () => {
        callOrder.push('applySandboxBashrc');
      },
    }));
    vi.doMock('./unconfiguredProviderGuard.js', () => ({
      guardUnconfiguredProvider: async () => {},
      UNCONFIGURED_PROVIDER_MESSAGE: '',
    }));
    setupCommonMainMocks(callOrder, config);
    const { main } = await import('./cli.js');
    await main();
  }

  it('with a credential socket: consumes the descriptor before loadSettings and applies sandbox.bashrc after consumption', async () => {
    process.env.LLXPRT_CREDENTIAL_SOCKET = '/tmp/test-ac4-socket.sock';
    try {
      await runMainConfigured(makeConfig(true, false));
      expect(callOrder).toContain('createTokenStore');
      expect(callOrder).toContain('applySandboxBashrc');
      expect(callOrder).toContain('loadSettings');
      expect(callOrder.indexOf('createTokenStore')).toBeLessThan(
        callOrder.indexOf('applySandboxBashrc'),
      );
      expect(callOrder.indexOf('createTokenStore')).toBeLessThan(
        callOrder.indexOf('loadSettings'),
      );
      expect(callOrder.indexOf('applySandboxBashrc')).toBeLessThan(
        callOrder.indexOf('loadSettings'),
      );
    } finally {
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    }
  });

  it('without a credential socket: does NOT consume the descriptor (direct mode), does NOT apply sandbox.bashrc (F3), and still reaches loadSettings', async () => {
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    await runMainConfigured(makeConfig(true, false));
    expect(callOrder).not.toContain('createTokenStore');
    expect(callOrder).not.toContain('applySandboxBashrc');
    expect(callOrder).toContain('loadSettings');
  });

  it('fd-only ordering: invokes createTokenStore but never applySandboxBashrc (#1954 AC4)', async () => {
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    process.env.LLXPRT_CAPABILITY_FD = '3';
    try {
      await runMainConfigured(makeConfig(true, false));
      expect(callOrder).toContain('createTokenStore');
      expect(callOrder).not.toContain('applySandboxBashrc');
    } finally {
      delete process.env.LLXPRT_CAPABILITY_FD;
    }
  });
});
