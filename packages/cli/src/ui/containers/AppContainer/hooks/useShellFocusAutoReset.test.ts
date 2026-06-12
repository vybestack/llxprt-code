/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { useShellFocusAutoReset } from './useShellFocusAutoReset.js';
import { ToolCallStatus } from '../../../types.js';
import { SHELL_COMMAND_NAME } from '../../../constants.js';
import type { HistoryItemWithoutId } from '../../../types.js';

const isActivePtyMock = vi.hoisted(() => vi.fn());
const getLastActivePtyIdMock = vi.hoisted(() => vi.fn());

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');

  return {
    ...actual,
    ShellExecutionService: {
      ...actual.ShellExecutionService,
      isActivePty: isActivePtyMock,
      getLastActivePtyId: getLastActivePtyIdMock,
    },
    DebugLogger: class {
      log(): void {}
    },
  };
});

describe('useShellFocusAutoReset', () => {
  let setEmbeddedShellFocused: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setEmbeddedShellFocused = vi.fn();
    isActivePtyMock.mockReturnValue(false);
    getLastActivePtyIdMock.mockReturnValue(null);
  });

  const shellToolExecuting = (
    name = SHELL_COMMAND_NAME,
    ptyId?: number,
  ): HistoryItemWithoutId => ({
    type: 'tool_group',
    tools: [
      {
        callId: 'call-1',
        name,
        description: 'test shell',
        resultDisplay: undefined,
        status: ToolCallStatus.Executing,
        confirmationDetails: undefined,
        ...(ptyId !== undefined ? { ptyId } : {}),
      },
    ],
  });

  const shellToolCompleted = (
    name = SHELL_COMMAND_NAME,
    ptyId?: number,
  ): HistoryItemWithoutId => ({
    type: 'tool_group',
    tools: [
      {
        callId: 'call-1',
        name,
        description: 'test shell',
        resultDisplay: undefined,
        status: ToolCallStatus.Success,
        confirmationDetails: undefined,
        ...(ptyId !== undefined ? { ptyId } : {}),
      },
    ],
  });

  it('should not reset when a shell tool is executing', () => {
    renderHook(() =>
      useShellFocusAutoReset({
        pendingHistoryItems: [shellToolExecuting()],
        embeddedShellFocused: true,
        setEmbeddedShellFocused,
      }),
    );

    expect(setEmbeddedShellFocused).not.toHaveBeenCalled();
  });

  it('should not reset when embedded shell is not focused', () => {
    renderHook(() =>
      useShellFocusAutoReset({
        pendingHistoryItems: [shellToolCompleted()],
        embeddedShellFocused: false,
        setEmbeddedShellFocused,
      }),
    );

    expect(setEmbeddedShellFocused).not.toHaveBeenCalled();
  });

  it('should report anyShellExecuting true when a shell is executing', () => {
    const { result } = renderHook(() =>
      useShellFocusAutoReset({
        pendingHistoryItems: [shellToolExecuting()],
        embeddedShellFocused: true,
        setEmbeddedShellFocused,
      }),
    );

    expect(result.current.anyShellExecuting).toBe(true);
  });

  it('should report anyShellExecuting false when no shell is executing', () => {
    const { result } = renderHook(() =>
      useShellFocusAutoReset({
        pendingHistoryItems: [shellToolCompleted()],
        embeddedShellFocused: false,
        setEmbeddedShellFocused,
      }),
    );

    expect(result.current.anyShellExecuting).toBe(false);
  });

  it('should reset when no shell executing, focused, and no live PTY', () => {
    getLastActivePtyIdMock.mockReturnValue(null);

    renderHook(() =>
      useShellFocusAutoReset({
        pendingHistoryItems: [shellToolCompleted()],
        embeddedShellFocused: true,
        setEmbeddedShellFocused,
      }),
    );

    expect(setEmbeddedShellFocused).toHaveBeenCalledWith(false);
  });

  it('should not reset when no shell executing, focused, but a live PTY exists', () => {
    getLastActivePtyIdMock.mockReturnValue(42);
    isActivePtyMock.mockReturnValue(true);

    renderHook(() =>
      useShellFocusAutoReset({
        pendingHistoryItems: [shellToolCompleted()],
        embeddedShellFocused: true,
        setEmbeddedShellFocused,
      }),
    );

    expect(setEmbeddedShellFocused).not.toHaveBeenCalled();
  });

  it('should reset when no shell executing, focused, and last active PTY is no longer alive', () => {
    getLastActivePtyIdMock.mockReturnValue(42);
    isActivePtyMock.mockReturnValue(false);

    renderHook(() =>
      useShellFocusAutoReset({
        pendingHistoryItems: [shellToolCompleted()],
        embeddedShellFocused: true,
        setEmbeddedShellFocused,
      }),
    );

    expect(setEmbeddedShellFocused).toHaveBeenCalledWith(false);
  });
});
