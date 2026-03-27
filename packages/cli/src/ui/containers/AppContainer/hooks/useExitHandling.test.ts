/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import process from 'node:process';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { SessionEndReason } from '@vybestack/llxprt-code-core';
import { useExitHandling } from './useExitHandling.js';

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');

  return {
    ...actual,
    triggerSessionEndHook: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../../utils/terminalProtocolCleanup.js', () => ({
  restoreTerminalProtocolsSync: vi.fn(),
}));

interface ExitHarness {
  handleSlashCommand: ReturnType<typeof vi.fn>;
  config: Record<string, unknown>;
}

const createHarness = (): ExitHarness => ({
  handleSlashCommand: vi.fn(),
  config: { id: 'config' },
});

describe('useExitHandling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requires a second key press within timeout before dispatching /quit', () => {
    const harness = createHarness();

    const { result } = renderHook(() =>
      useExitHandling({
        handleSlashCommand: harness.handleSlashCommand,
        config: harness.config as never,
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
        config: harness.config as never,
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
        config: harness.config as never,
      }),
    );

    const messages = [{ type: 'info', text: 'bye' }] as never;

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
        config: harness.config as never,
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

    const { triggerSessionEndHook } = await import(
      '@vybestack/llxprt-code-core'
    );
    const { restoreTerminalProtocolsSync } = await import(
      '../../../utils/terminalProtocolCleanup.js'
    );

    const processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    const { result } = renderHook(() =>
      useExitHandling({
        handleSlashCommand: harness.handleSlashCommand,
        config: harness.config as never,
      }),
    );

    act(() => {
      result.current.setQuittingMessages([
        { type: 'info', text: 'bye' },
      ] as never);
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(triggerSessionEndHook).toHaveBeenCalledWith(
      harness.config,
      SessionEndReason.Exit,
    );
    expect(restoreTerminalProtocolsSync).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });
});
