/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import process from 'node:process';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { renderHook } from '../../../../__tests__/render.js';
import { SessionEndReason } from '@vybestack/llxprt-code-core';
import { useExitHandling } from './useExitHandling.js';
import type { HookSkillState } from '../../../cliUiRuntime.js';
import type { HistoryItem } from '../../../types.js';

void vi.mock('../../../utils/terminalProtocolCleanup.js', () => ({
  restoreTerminalProtocolsSync: vi.fn(),
}));

interface ExitHarness {
  handleSlashCommand: ReturnType<typeof vi.fn>;
  config: HookSkillState;
  events: string[];
}

const createHarness = (): ExitHarness => {
  const events: string[] = [];
  return {
    handleSlashCommand: vi.fn(),
    events,
    config: {
      endHookSession: async (reason) => {
        events.push(`hook:${reason}`);
      },
      getEnableHooks: () => true,
      getDisabledHooks: () => [],
      setDisabledHooks: () => {},
      isSkillsSupportEnabled: () => false,
      getEnableHooksUI: () => false,
      isAdminSkillsEnabled: () => false,
    },
  };
};

describe('useExitHandling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('requires a second key press within timeout before dispatching /quit', () => {
    const harness = createHarness();

    const { result } = renderHook(() =>
      useExitHandling({
        handleSlashCommand: harness.handleSlashCommand,
        config: harness.config,
      }),
    );

    act(() => {
      result.current.handleExit(
        result.current.ctrlCPressedOnce,
        result.current.setCtrlCPressedOnce,
        result.current.ctrlCTimerRef,
      );
    });

    expect(result.current.ctrlCPressedOnce).toBe(true);
    expect(harness.handleSlashCommand).not.toHaveBeenCalled();

    act(() => {
      result.current.handleExit(
        result.current.ctrlCPressedOnce,
        result.current.setCtrlCPressedOnce,
        result.current.ctrlCTimerRef,
      );
    });

    expect(harness.handleSlashCommand).toHaveBeenCalledWith('/quit');
  });

  it('resets pressed-once state after 1000ms timeout', () => {
    const harness = createHarness();

    const { result } = renderHook(() =>
      useExitHandling({
        handleSlashCommand: harness.handleSlashCommand,
        config: harness.config,
      }),
    );

    act(() => {
      result.current.handleExit(
        result.current.ctrlDPressedOnce,
        result.current.setCtrlDPressedOnce,
        result.current.ctrlDTimerRef,
      );
    });

    expect(result.current.ctrlDPressedOnce).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.ctrlDPressedOnce).toBe(false);
  });

  it('stores quitting messages for downstream quit effect', () => {
    const harness = createHarness();

    const { result } = renderHook(() =>
      useExitHandling({
        handleSlashCommand: harness.handleSlashCommand,
        config: harness.config,
      }),
    );

    const messages: HistoryItem[] = [{ id: 1, type: 'info', text: 'bye' }];

    act(() => {
      result.current.setQuittingMessages(messages);
    });

    expect(result.current.quittingMessages).toBe(messages);
  });

  it('clears active timers during unmount cleanup', () => {
    const harness = createHarness();

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const { result, unmount } = renderHook(() =>
      useExitHandling({
        handleSlashCommand: harness.handleSlashCommand,
        config: harness.config,
      }),
    );

    act(() => {
      result.current.handleExit(
        result.current.ctrlCPressedOnce,
        result.current.setCtrlCPressedOnce,
        result.current.ctrlCTimerRef,
      );
      result.current.handleExit(
        result.current.ctrlDPressedOnce,
        result.current.setCtrlDPressedOnce,
        result.current.ctrlDTimerRef,
      );
    });

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('invokes session end hook then restores terminal protocols before exiting', async () => {
    const harness = createHarness();

    const { restoreTerminalProtocolsSync } = await import(
      '../../../utils/terminalProtocolCleanup.js'
    );

    const processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(vi.fn<typeof process.exit>());

    const { result } = renderHook(() =>
      useExitHandling({
        handleSlashCommand: harness.handleSlashCommand,
        config: harness.config,
      }),
    );

    act(() => {
      result.current.setQuittingMessages([
        { id: 1, type: 'info', text: 'bye' },
      ]);
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.events).toStrictEqual([`hook:${SessionEndReason.Exit}`]);
    expect(restoreTerminalProtocolsSync).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });
  it('waits for recording owner cleanup before process exit', async () => {
    const harness = createHarness();
    let finishCleanup: () => void = () => undefined;
    const cleanupPending = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    let cleanupStarted = false;
    const processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(vi.fn<typeof process.exit>());

    const { result } = renderHook(() =>
      useExitHandling({
        handleSlashCommand: harness.handleSlashCommand,
        config: harness.config,
        onBeforeExit: async () => {
          cleanupStarted = true;
          await cleanupPending;
        },
      }),
    );

    act(() => {
      result.current.setQuittingMessages([
        { id: 1, type: 'info', text: 'bye' },
      ]);
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(cleanupStarted).toBe(true);
    expect(processExitSpy).not.toHaveBeenCalled();

    await act(async () => {
      finishCleanup();
      await cleanupPending;
      await Promise.resolve();
    });
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });
  it.each([
    { hookFails: false, cleanupFails: false, exitCode: 0 },
    { hookFails: true, cleanupFails: false, exitCode: 0 },
    { hookFails: false, cleanupFails: true, exitCode: 1 },
  ])(
    'orders hook, cleanup, terminal restoration and exit for %j',
    async ({ hookFails, cleanupFails, exitCode }) => {
      const harness = createHarness();
      const terminalCleanup = await import(
        '../../../utils/terminalProtocolCleanup.js'
      );
      vi.spyOn(
        terminalCleanup,
        'restoreTerminalProtocolsSync',
      ).mockImplementation(() => {
        harness.events.push('terminal');
      });
      const exit = vi.fn<typeof process.exit>();
      vi.spyOn(process, 'exit').mockImplementation((code) => {
        harness.events.push(`exit:${code}`);
        return exit(code);
      });
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const { result } = renderHook(() =>
        useExitHandling({
          handleSlashCommand: harness.handleSlashCommand,
          config: {
            ...harness.config,
            endHookSession: async (reason) => {
              harness.events.push(`hook:${reason}`);
              if (hookFails) throw new Error('hook execution failure');
            },
          },
          onBeforeExit: async () => {
            harness.events.push('cleanup');
            if (cleanupFails) throw new Error('recording cleanup failure');
          },
        }),
      );
      act(() => {
        result.current.setQuittingMessages([
          { id: 1, type: 'info', text: 'bye' },
        ]);
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
        for (let index = 0; index < 8; index++) await Promise.resolve();
      });
      expect(harness.events).toStrictEqual([
        `hook:${SessionEndReason.Exit}`,
        'cleanup',
        'terminal',
        `exit:${exitCode}`,
      ]);
    },
  );
});
