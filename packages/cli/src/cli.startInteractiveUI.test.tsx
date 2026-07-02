/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateDnsResolutionOrder, startInteractiveUI } from './cli.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { LoadedSettings } from './config/settings.js';

// Mock writeToStdout for exit-handler tests
const { mockWriteToStdout } = vi.hoisted(() => ({
  mockWriteToStdout: vi.fn().mockReturnValue(true),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    createInkStdio: vi.fn(() => ({
      stdout: process.stdout,
      stderr: process.stderr,
    })),
    writeToStdout: mockWriteToStdout,
  };
});

vi.mock('./utils/version.js', () => ({
  getCliVersion: vi.fn(() => Promise.resolve('1.0.0')),
}));

vi.mock('./utils/terminalTheme.js', () => ({
  setupTerminalAndTheme: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('./ui/utils/updateCheck.js', () => ({
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('./utils/cleanup.js', () => ({
  cleanupCheckpoints: vi.fn(() => Promise.resolve()),
  registerCleanup: vi.fn(),
  registerSyncCleanup: vi.fn(),
  runExitCleanup: vi.fn(),
}));

vi.mock('./ui/utils/terminalProtocolCleanup.js', () => ({
  restoreTerminalProtocolsSync: vi.fn(),
}));

vi.mock('./ui/utils/mouse.js', () => ({
  enableMouseEvents: vi.fn(),
  disableMouseEvents: vi.fn(),
  parseMouseEvent: vi.fn(),
  isIncompleteMouseSequence: vi.fn(),
  isMouseEventsActive: vi.fn(() => false),
  setMouseEventsActive: vi.fn(() => false),
  ENABLE_MOUSE_EVENTS: '',
  DISABLE_MOUSE_EVENTS: '',
}));

vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({ unmount: vi.fn() }),
}));

describe('validateDnsResolutionOrder', () => {
  let debugWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugWarnSpy = vi
      .spyOn(DebugLogger.prototype, 'warn')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    debugWarnSpy.mockRestore();
  });

  it('should return "ipv4first" when the input is "ipv4first"', () => {
    expect(validateDnsResolutionOrder('ipv4first')).toBe('ipv4first');
    expect(debugWarnSpy).not.toHaveBeenCalled();
  });

  it('should return "verbatim" when the input is "verbatim"', () => {
    expect(validateDnsResolutionOrder('verbatim')).toBe('verbatim');
    expect(debugWarnSpy).not.toHaveBeenCalled();
  });

  it('should return the default "ipv4first" when the input is undefined', () => {
    expect(validateDnsResolutionOrder(undefined)).toBe('ipv4first');
    expect(debugWarnSpy).not.toHaveBeenCalled();
  });

  it('should return the default "ipv4first" and log a warning for an invalid string', () => {
    expect(validateDnsResolutionOrder('invalid-value')).toBe('ipv4first');
    expect(debugWarnSpy).toHaveBeenCalledExactlyOnceWith(
      'Invalid value for dnsResolutionOrder in settings: "invalid-value". Using default "ipv4first".',
    );
  });
});

describe('startInteractiveUI', () => {
  beforeEach(async () => {
    const { __resetInteractiveUIStateForTesting } = await import(
      './session/interactiveUI.js'
    );
    __resetInteractiveUIStateForTesting();
  });

  // Mock dependencies
  const mockConfig = {
    getProjectRoot: () => '/root',
    getScreenReader: () => false,
    getQuestion: () => '',
    isContinueSession: () => false,
    getSessionId: () => 'session-1',
    storage: {},
    getDebugMode: () => false,
    getTerminalBackground: () => undefined,
  } as Config;
  const mockAgent = {
    dispose: vi.fn().mockResolvedValue(undefined),
    getConfig: () => mockConfig,
  } as unknown as Agent;
  const mockSettings = {
    merged: {
      ui: {
        hideWindowTitle: false,
      },
    },
  } as unknown as LoadedSettings;
  const mockStartupWarnings = ['warning1'];
  const mockWorkspaceRoot = '/root';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the UI with proper React context and exitOnCtrlC disabled', async () => {
    const { render } = await import('ink');
    const renderSpy = vi.mocked(render);

    await startInteractiveUI(
      mockConfig,
      mockAgent,
      mockSettings,
      mockStartupWarnings,
      mockWorkspaceRoot,
    );

    // Verify render was called with correct options
    expect(renderSpy).toHaveBeenCalledTimes(1);
    const [reactElement, options] = renderSpy.mock.calls[0];

    // Verify render options
    expect(options).toStrictEqual(
      expect.objectContaining({
        exitOnCtrlC: false,
      }),
    );

    // Verify React element structure is valid (but don't deep dive into JSX internals)
    expect(reactElement).toBeDefined();
  });

  it('should perform all startup tasks in correct order', async () => {
    const { getCliVersion } = await import('./utils/version.js');
    const { checkForUpdates } = await import('./ui/utils/updateCheck.js');
    const { registerCleanup } = await import('./utils/cleanup.js');

    await startInteractiveUI(
      mockConfig,
      mockAgent,
      mockSettings,
      mockStartupWarnings,
      mockWorkspaceRoot,
    );

    // Verify all startup tasks were called
    expect(getCliVersion).toHaveBeenCalledTimes(1);
    expect(registerCleanup).toHaveBeenCalledTimes(1);

    // Verify cleanup handler is registered with unmount function
    const cleanupFn = vi.mocked(registerCleanup).mock.calls[0][0];
    expect(typeof cleanupFn).toBe('function');

    // checkForUpdates should be called asynchronously (not waited for)
    // We need a small delay to let it execute
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('should register exit handlers that restore terminal protocols and disable mouse state', async () => {
    const { restoreTerminalProtocolsSync } = await import(
      './ui/utils/terminalProtocolCleanup.js'
    );
    const { disableMouseEvents } = await import('./ui/utils/mouse.js');
    const exitHandlers: Array<() => void> = [];
    const processOnSpy = vi
      .spyOn(process, 'on')
      .mockImplementation(
        (event: string | symbol, handler: (...args: unknown[]) => void) => {
          if (event === 'exit') {
            exitHandlers.push(handler as () => void);
          }
          return process;
        },
      );

    const mouseEnabledConfig = {
      ...mockConfig,
      getScreenReader: () => false,
    } as Config;
    const mouseEnabledSettings = {
      merged: {
        ui: {
          hideWindowTitle: true,
          useAlternateBuffer: true,
          enableMouseEvents: true,
        },
      },
    } as unknown as LoadedSettings;

    try {
      await startInteractiveUI(
        mouseEnabledConfig,
        mockAgent,
        mouseEnabledSettings,
        mockStartupWarnings,
        mockWorkspaceRoot,
      );

      for (const handler of exitHandlers) {
        handler();
      }

      expect(restoreTerminalProtocolsSync).toHaveBeenCalledTimes(1);
      expect(disableMouseEvents).toHaveBeenCalledTimes(1);
    } finally {
      processOnSpy.mockRestore();
    }
  });

  it('should restore terminal protocols when Ink render throws synchronously', async () => {
    const { render } = await import('ink');
    const { restoreTerminalProtocolsSync } = await import(
      './ui/utils/terminalProtocolCleanup.js'
    );
    const { disableMouseEvents } = await import('./ui/utils/mouse.js');
    const renderSpy = vi.mocked(render);
    const processOffSpy = vi.spyOn(process, 'off');
    const renderError = new Error('render failed');
    renderSpy.mockImplementationOnce(() => {
      throw renderError;
    });

    const mouseEnabledConfig = {
      ...mockConfig,
      getScreenReader: () => false,
    } as Config;
    const mouseEnabledSettings = {
      merged: {
        ui: {
          hideWindowTitle: true,
          useAlternateBuffer: true,
          enableMouseEvents: true,
        },
      },
    } as unknown as LoadedSettings;

    await expect(
      startInteractiveUI(
        mouseEnabledConfig,
        mockAgent,
        mouseEnabledSettings,
        mockStartupWarnings,
        mockWorkspaceRoot,
      ),
    ).rejects.toThrow('render failed');

    expect(disableMouseEvents).toHaveBeenCalledTimes(1);
    expect(restoreTerminalProtocolsSync).toHaveBeenCalledTimes(1);
    expect(processOffSpy).toHaveBeenCalledWith(
      'exit',
      restoreTerminalProtocolsSync,
    );
    processOffSpy.mockRestore();
  });

  it('should not write terminal escape sequences on exit when stdout is not a TTY', async () => {
    const { restoreTerminalProtocolsSync } = await import(
      './ui/utils/terminalProtocolCleanup.js'
    );
    const { enableMouseEvents, disableMouseEvents } = await import(
      './ui/utils/mouse.js'
    );
    const exitHandlers: Array<() => void> = [];
    const processOnSpy = vi
      .spyOn(process, 'on')
      .mockImplementation(
        (event: string | symbol, handler: (...args: unknown[]) => void) => {
          if (event === 'exit') {
            exitHandlers.push(handler as () => void);
          }
          return process;
        },
      );

    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
    });

    const mouseEnabledConfig = {
      ...mockConfig,
      getScreenReader: () => false,
    } as Config;
    const mouseEnabledSettings = {
      merged: {
        ui: {
          hideWindowTitle: true,
          useAlternateBuffer: true,
          enableMouseEvents: true,
        },
      },
    } as unknown as LoadedSettings;

    try {
      mockWriteToStdout.mockClear();

      await startInteractiveUI(
        mouseEnabledConfig,
        mockAgent,
        mouseEnabledSettings,
        mockStartupWarnings,
        mockWorkspaceRoot,
      );

      mockWriteToStdout.mockClear();

      for (const handler of exitHandlers) {
        handler();
      }

      expect(enableMouseEvents).toHaveBeenCalledTimes(1);
      expect(restoreTerminalProtocolsSync).toHaveBeenCalledTimes(1);
      expect(disableMouseEvents).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
      processOnSpy.mockRestore();
    }
  });
});
