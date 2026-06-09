/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../../../test-utils/render.js';
import { useInitialPromptSubmit } from './useInitialPromptSubmit.js';

const blockedByDialogsClosed = {
  isAuthDialogOpen: false,
  isThemeDialogOpen: false,
  isEditorDialogOpen: false,
  isProviderDialogOpen: false,
  isToolsDialogOpen: false,
  isCreateProfileDialogOpen: false,
  showPrivacyNotice: false,
  isWelcomeDialogOpen: false,
  isFolderTrustDialogOpen: false,
};

describe('useInitialPromptSubmit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('submits initial prompt when all conditions are met and startup guards are initialized', async () => {
    const submitQuery = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit({
        initialPrompt: 'hello',
        submitQuery,
        agentClientPresent: true,
        blockedByDialogs: blockedByDialogsClosed,
        startupGuardsInitialized: true,
      }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).toHaveBeenCalledWith('hello');
  });

  it('does not submit when startup guards are not yet initialized', async () => {
    const submitQuery = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit({
        initialPrompt: 'hello',
        submitQuery,
        agentClientPresent: true,
        blockedByDialogs: blockedByDialogsClosed,
        startupGuardsInitialized: false,
      }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).not.toHaveBeenCalled();
  });

  it('submits once startup guards become initialized after being initially false', async () => {
    const submitQuery = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ startupGuardsInitialized }: { startupGuardsInitialized: boolean }) =>
        useInitialPromptSubmit({
          initialPrompt: 'hello',
          submitQuery,
          agentClientPresent: true,
          blockedByDialogs: blockedByDialogsClosed,
          startupGuardsInitialized,
        }),
      { initialProps: { startupGuardsInitialized: false } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).not.toHaveBeenCalled();

    rerender({ startupGuardsInitialized: true });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).toHaveBeenCalledWith('hello');
    expect(submitQuery).toHaveBeenCalledTimes(1);
  });

  it('does not submit when a blocking dialog is open even with startup guards initialized', async () => {
    const submitQuery = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit({
        initialPrompt: 'hello',
        submitQuery,
        agentClientPresent: true,
        blockedByDialogs: {
          ...blockedByDialogsClosed,
          isWelcomeDialogOpen: true,
        },
        startupGuardsInitialized: true,
      }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).not.toHaveBeenCalled();
  });

  it('does not re-submit after startup guards transition when prompt was already submitted', async () => {
    const submitQuery = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ startupGuardsInitialized }: { startupGuardsInitialized: boolean }) =>
        useInitialPromptSubmit({
          initialPrompt: 'hello',
          submitQuery,
          agentClientPresent: true,
          blockedByDialogs: blockedByDialogsClosed,
          startupGuardsInitialized,
        }),
      { initialProps: { startupGuardsInitialized: true } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).toHaveBeenCalledTimes(1);

    rerender({ startupGuardsInitialized: true });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).toHaveBeenCalledTimes(1);
  });

  it('retries submission after submit failure when a blockedByDialogs dependency changes', async () => {
    const submitQuery = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    const { rerender } = renderHook(
      ({ isFolderTrustDialogOpen }: { isFolderTrustDialogOpen: boolean }) =>
        useInitialPromptSubmit({
          initialPrompt: 'hello',
          submitQuery,
          agentClientPresent: true,
          blockedByDialogs: {
            ...blockedByDialogsClosed,
            isFolderTrustDialogOpen,
          },
          startupGuardsInitialized: true,
        }),
      { initialProps: { isFolderTrustDialogOpen: false } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).toHaveBeenCalledTimes(1);

    rerender({ isFolderTrustDialogOpen: true });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    rerender({ isFolderTrustDialogOpen: false });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).toHaveBeenCalledTimes(2);
    expect(submitQuery).toHaveBeenLastCalledWith('hello');
  });

  it('does not submit when gemini client is absent even with startup guards initialized', async () => {
    const submitQuery = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit({
        initialPrompt: 'hello',
        submitQuery,
        agentClientPresent: false,
        blockedByDialogs: blockedByDialogsClosed,
        startupGuardsInitialized: true,
      }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).not.toHaveBeenCalled();
  });

  it('does not submit when initial prompt is empty even with startup guards initialized', async () => {
    const submitQuery = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit({
        initialPrompt: undefined,
        submitQuery,
        agentClientPresent: true,
        blockedByDialogs: blockedByDialogsClosed,
        startupGuardsInitialized: true,
      }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).not.toHaveBeenCalled();
  });

  it('does not submit when folder trust dialog is open even with startup guards initialized', async () => {
    const submitQuery = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit({
        initialPrompt: 'hello',
        submitQuery,
        agentClientPresent: true,
        blockedByDialogs: {
          ...blockedByDialogsClosed,
          isFolderTrustDialogOpen: true,
        },
        startupGuardsInitialized: true,
      }),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).not.toHaveBeenCalled();
  });

  it('submits after folder trust dialog closes following startup guard initialization', async () => {
    const submitQuery = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({
        isFolderTrustDialogOpen,
        startupGuardsInitialized,
      }: {
        isFolderTrustDialogOpen: boolean;
        startupGuardsInitialized: boolean;
      }) =>
        useInitialPromptSubmit({
          initialPrompt: 'hello',
          submitQuery,
          agentClientPresent: true,
          blockedByDialogs: {
            ...blockedByDialogsClosed,
            isFolderTrustDialogOpen,
          },
          startupGuardsInitialized,
        }),
      {
        initialProps: {
          isFolderTrustDialogOpen: true,
          startupGuardsInitialized: true,
        },
      },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).not.toHaveBeenCalled();

    rerender({
      isFolderTrustDialogOpen: false,
      startupGuardsInitialized: true,
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).toHaveBeenCalledWith('hello');
    expect(submitQuery).toHaveBeenCalledTimes(1);
  });

  it('waits for startup guards even when folder trust resolves first', async () => {
    const submitQuery = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({
        isFolderTrustDialogOpen,
        startupGuardsInitialized,
      }: {
        isFolderTrustDialogOpen: boolean;
        startupGuardsInitialized: boolean;
      }) =>
        useInitialPromptSubmit({
          initialPrompt: 'hello',
          submitQuery,
          agentClientPresent: true,
          blockedByDialogs: {
            ...blockedByDialogsClosed,
            isFolderTrustDialogOpen,
          },
          startupGuardsInitialized,
        }),
      {
        initialProps: {
          isFolderTrustDialogOpen: true,
          startupGuardsInitialized: false,
        },
      },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).not.toHaveBeenCalled();

    rerender({
      isFolderTrustDialogOpen: false,
      startupGuardsInitialized: false,
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).not.toHaveBeenCalled();

    rerender({
      isFolderTrustDialogOpen: false,
      startupGuardsInitialized: true,
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitQuery).toHaveBeenCalledWith('hello');
    expect(submitQuery).toHaveBeenCalledTimes(1);
  });
});
