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

import { describe, it, expect, vi, beforeEach, afterEach, mock } from 'bun:test';
import type { Config } from '@vybestack/llxprt-code-core';
import {
  guardUnconfiguredProvider,
  UNCONFIGURED_PROVIDER_MESSAGE,
} from './unconfiguredProviderGuard.js';
import { buildImageModeFlags } from './config/imageModeDispatch.js';

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
  mock.module('./cliProviderInit.js', () => ({
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
  mock.module('./cliTerminalSession.js', () => ({
    constructAgentWithSpinner: async () => {
      callOrder.push('agent-construction');
      return {};
    },
    prepareTerminalSession: async () => {},
  }));
  mock.module('./cliSessionBootstrap.js', () => ({
    bootstrapRuntimeAndConfig: async () => ({
      config,
      runtimeSettingsService: {},
    }),
    setupSessionRecording: async () => undefined,
  }));
  mock.module('./session/nonInteractiveSession.js', () => ({
    dispatchInteractiveOrNonInteractive: async () => {
      callOrder.push('dispatch');
    },
  }));
  mock.module('./cliSandbox.js', () => ({ maybeHopIntoSandbox: async () => {} }));
  mock.module('./config/cliArgParser.js', () => ({
    parseArguments: async () => ({ prompt: 'hello' }),
  }));
  mock.module('./config/settings.js', () => ({
    loadSettings: () => {
      callOrder.push('loadSettings');
      return { merged: { ui: { unicode: 'auto' } }, errors: [] };
    },
  }));
  mock.module('./cliBootstrap.js', () => ({
    configureEarlyDebugLogging: () => {},
    createMemoizedStdinReader: () => async () => '',
    ensureStdinOrPromptProvided: async () => {},
    handleVersionAndHelpFlags: async () => {},
    maybeRelaunchForMemory: async () => {},
    redirectConsoleForAcp: () => {},
    rejectPromptInteractiveWithPipedStdin: async () => {},
    throwIfSettingsErrors: () => {},
    validateDnsResolutionOrder: () => {},
    registerDynamicToolSettings: () => {},
    ParsedCliArgs: {} as never,
  }));
  mock.module('./utils/cleanup.js', () => ({
    cleanupCheckpoints: async () => {},
    runExitCleanup: async () => {},
    registerSyncCleanup: () => {},
  }));
  mock.module('./utils/sessionCleanup.js', () => ({
    cleanupExpiredSessions: async () => {},
  }));
  mock.module('./zed-integration/zedIntegration.js', () => ({
    runZedIntegration: async () => {},
  }));
  mock.module('./config/pathMigration.js', () => ({
    runStartupMigration: () => ({ migrated: false }),
    reportStartupResult: () => ({ messages: [], needsLegacyFallback: false }),
  }));
  mock.module('./session/errorReporting.js', () => ({
    formatNonInteractiveError: () => '',
  }));
  mock.module('./session/outputListeners.js', () => ({
    initializeOutputListenersAndFlush: () => {},
  }));
  mock.module('./session/signalHandlers.js', () => ({
    installNonInteractiveSigintHandler: () => {},
    setupUnhandledRejectionHandler: () => {},
    __resetUnhandledRejectionStateForTesting: () => {},
  }));
  mock.module('./session/interactiveUI.js', () => ({
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
  });

  async function runMainWithConfig(config: Config): Promise<void> {
    // Capture the real guard function BEFORE mocking. Bun's mock.module
    // patches the module namespace in-place, so any reference obtained after
    // mocking would point to the mock and recurse. We snapshot the function
    // reference itself (not the namespace) before registration.
    const realGuard = guardUnconfiguredProvider;
    mock.module('./unconfiguredProviderGuard.js', () => ({
      guardUnconfiguredProvider: async (
        cfg: Config,
        runCleanup: () => Promise<void>,
      ) => {
        callOrder.push('guard');
        return realGuard(cfg, runCleanup);
      },
      UNCONFIGURED_PROVIDER_MESSAGE,
    }));
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
  });

  async function runMainConfigured(config: Config): Promise<void> {
    mock.module('@vybestack/llxprt-code-providers/auth.js', () => ({
      createTokenStore: () => {
        callOrder.push('createTokenStore');
        return {};
      },
    }));
    mock.module('./utils/sandbox-bashrc.js', () => ({
      applySandboxBashrc: () => {
        callOrder.push('applySandboxBashrc');
      },
    }));
    mock.module('./unconfiguredProviderGuard.js', () => ({
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

describe('main() image mode: bypasses the conversational stdin guard (#2128)', () => {
  const callOrder: string[] = [];

  beforeEach(() => {
    callOrder.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // Restore a TTY-like stdin so other suites are unaffected.
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  async function runMainImageMode(config: Config): Promise<void> {
    // Simulate non-TTY stdin (piped / /dev/null) so the stdin guard WOULD
    // fire if not bypassed.
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });

    mock.module('@vybestack/llxprt-code-providers/auth.js', () => ({
      createTokenStore: () => ({}),
    }));
    mock.module('./utils/sandbox-bashrc.js', () => ({
      applySandboxBashrc: () => {},
    }));
    mock.module('./unconfiguredProviderGuard.js', () => ({
      guardUnconfiguredProvider: async () => {},
      UNCONFIGURED_PROVIDER_MESSAGE: '',
    }));
    mock.module('./cliProviderInit.js', () => ({
      activateConfiguredProvider: async () => ({
        authFailed: false,
        token: undefined,
        intent: undefined,
      }),
      configureProvidersAndServices: async () => ({}),
      connectIdeClientIfEnabled: async () => {},
      ensureAcpProviderActivated: () => {},
    }));
    mock.module('./cliTerminalSession.js', () => ({
      constructAgentWithSpinner: async () => ({}),
      prepareTerminalSession: async () => {},
    }));
    mock.module('./cliSessionBootstrap.js', () => ({
      bootstrapRuntimeAndConfig: async () => ({
        config,
        runtimeSettingsService: {},
      }),
      setupSessionRecording: async () => undefined,
    }));
    mock.module('./session/nonInteractiveSession.js', () => ({
      dispatchInteractiveOrNonInteractive: async () => {},
    }));
    mock.module('./cliSandbox.js', () => ({
      maybeHopIntoSandbox: async () => {},
    }));
    // parseArguments returns image-mode flags with NO conversational prompt.
    mock.module('./config/cliArgParser.js', () => ({
      parseArguments: async () => ({
        imageOutput: 'out.png',
        imagePrompt: 'draw a cat',
        experimentalAcp: false,
      }),
    }));
    mock.module('./config/settings.js', () => ({
      loadSettings: () => ({
        merged: { ui: { unicode: 'auto' } },
        errors: [],
      }),
    }));
    mock.module('./cliBootstrap.js', () => ({
      configureEarlyDebugLogging: () => {},
      createMemoizedStdinReader: () => async () => '',
      // Track whether the guard is invoked.
      ensureStdinOrPromptProvided: async () => {
        callOrder.push('stdin-guard');
      },
      handleVersionAndHelpFlags: async () => {},
      maybeRelaunchForMemory: async () => {},
      redirectConsoleForAcp: () => {},
      rejectPromptInteractiveWithPipedStdin: async () => {},
      throwIfSettingsErrors: () => {},
      validateDnsResolutionOrder: () => {},
      registerDynamicToolSettings: () => {},
      ParsedCliArgs: {} as never,
    }));
    mock.module('./utils/cleanup.js', () => ({
      cleanupCheckpoints: async () => {},
      runExitCleanup: async () => {},
      registerSyncCleanup: () => {},
    }));
    mock.module('./utils/sessionCleanup.js', () => ({
      cleanupExpiredSessions: async () => {},
    }));
    mock.module('./zed-integration/zedIntegration.js', () => ({
      runZedIntegration: async () => {},
    }));
    mock.module('./config/pathMigration.js', () => ({
      runStartupMigration: () => ({ migrated: false }),
      reportStartupResult: () => ({
        messages: [],
        needsLegacyFallback: false,
      }),
    }));
    mock.module('./session/errorReporting.js', () => ({
      formatNonInteractiveError: () => '',
    }));
    mock.module('./session/outputListeners.js', () => ({
      initializeOutputListenersAndFlush: () => {},
    }));
    mock.module('./session/signalHandlers.js', () => ({
      installNonInteractiveSigintHandler: () => {},
      setupUnhandledRejectionHandler: () => {},
      __resetUnhandledRejectionStateForTesting: () => {},
    }));
    mock.module('./session/interactiveUI.js', () => ({
      startInteractiveUI: async () => {},
    }));
    // Track whether image-mode dispatch is reached. The REAL
    // buildImageModeFlags is preserved so the stdin-guard bypass decision is
    // exercised against the real flag-detection logic, not a stub.
    mock.module('./config/imageModeDispatch.js', () => ({
      buildImageModeFlags,
      runDirectImageModeAndExit: async () => {
        callOrder.push('image-dispatch');
        return 0;
      },
    }));

    const { main } = await import('./cli.js');
    await main();
  }

  it('image mode dispatches when stdin is not a TTY and no conversational prompt is present', async () => {
    // process.exit(0) is called by image mode after a successful dispatch.
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    await expect(runMainImageMode(makeConfig(true, false))).rejects.toThrow(
      'process.exit(0)',
    );
    // The stdin guard must NOT have been called (bypassed for image mode).
    expect(callOrder).not.toContain('stdin-guard');
    // The image dispatch MUST have been reached.
    expect(callOrder).toContain('image-dispatch');
  });
});
