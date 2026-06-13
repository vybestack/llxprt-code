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

type HookParams = Parameters<typeof useInitialPromptSubmit>[0];

const createParams = (overrides: Partial<HookParams> = {}): HookParams => ({
  initialPrompt: 'hello',
  submitPrompt: vi.fn().mockResolvedValue(undefined),
  agentClientPresent: true,
  interactiveRuntimeReady: true,
  blockedByDialogs: blockedByDialogsClosed,
  startupGuardsInitialized: true,
  ...overrides,
});

describe('useInitialPromptSubmit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('submits initial prompt when all conditions are met and startup guards are initialized', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: 'hello',
          submitPrompt,
        }),
      ),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledWith('hello');
  });

  it('does not submit when startup guards are not yet initialized', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: 'hello',
          submitPrompt,
          startupGuardsInitialized: false,
        }),
      ),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();
  });

  it('does not submit until the interactive runtime is ready for tool and subagent scheduling', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ interactiveRuntimeReady }: { interactiveRuntimeReady: boolean }) =>
        useInitialPromptSubmit(
          createParams({
            initialPrompt: 'delegate to a subagent',
            submitPrompt,
            interactiveRuntimeReady,
          }),
        ),
      { initialProps: { interactiveRuntimeReady: false } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();

    rerender({ interactiveRuntimeReady: true });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledWith('delegate to a subagent');
    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('submits slash initial prompts before interactive runtime readiness', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: '  /help',
          submitPrompt,
          interactiveRuntimeReady: false,
        }),
      ),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledWith('  /help');
    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('submits once startup guards become initialized after being initially false', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ startupGuardsInitialized }: { startupGuardsInitialized: boolean }) =>
        useInitialPromptSubmit(
          createParams({
            initialPrompt: 'hello',
            submitPrompt,
            startupGuardsInitialized,
          }),
        ),
      { initialProps: { startupGuardsInitialized: false } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();

    rerender({ startupGuardsInitialized: true });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledWith('hello');
    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('passes the raw initial prompt to the user input submit handler', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: '  hello from prompt-interactive  ',
          submitPrompt,
        }),
      ),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledWith(
      '  hello from prompt-interactive  ',
    );
    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate readiness gates handled by the user input submit handler', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: 'hello',
          submitPrompt,
        }),
      ),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledWith('hello');
    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('does not submit when a blocking dialog is open even with startup guards initialized', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: 'hello',
          submitPrompt,
          blockedByDialogs: {
            ...blockedByDialogsClosed,
            isWelcomeDialogOpen: true,
          },
        }),
      ),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();
  });

  it('does not re-submit after startup guards transition when prompt was already submitted', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ startupGuardsInitialized }: { startupGuardsInitialized: boolean }) =>
        useInitialPromptSubmit(
          createParams({
            initialPrompt: 'hello',
            submitPrompt,
            startupGuardsInitialized,
          }),
        ),
      { initialProps: { startupGuardsInitialized: true } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledTimes(1);

    rerender({ startupGuardsInitialized: true });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('retries submission after submit failure when a blockedByDialogs dependency changes', async () => {
    const submitPrompt = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    const { rerender } = renderHook(
      ({ isFolderTrustDialogOpen }: { isFolderTrustDialogOpen: boolean }) =>
        useInitialPromptSubmit(
          createParams({
            initialPrompt: 'hello',
            submitPrompt,
            blockedByDialogs: {
              ...blockedByDialogsClosed,
              isFolderTrustDialogOpen,
            },
          }),
        ),
      { initialProps: { isFolderTrustDialogOpen: false } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledTimes(1);

    rerender({ isFolderTrustDialogOpen: true });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    rerender({ isFolderTrustDialogOpen: false });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledTimes(2);
    expect(submitPrompt).toHaveBeenLastCalledWith('hello');
  });

  it('retries submission after submit handler throws synchronously', async () => {
    const submitPrompt = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('sync fail');
      })
      .mockResolvedValueOnce(undefined);

    const { rerender } = renderHook(
      ({ interactiveRuntimeReady }: { interactiveRuntimeReady: boolean }) =>
        useInitialPromptSubmit(
          createParams({
            initialPrompt: 'hello',
            submitPrompt,
            interactiveRuntimeReady,
          }),
        ),
      { initialProps: { interactiveRuntimeReady: true } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledTimes(1);

    rerender({ interactiveRuntimeReady: false });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    rerender({ interactiveRuntimeReady: true });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledTimes(2);
    expect(submitPrompt).toHaveBeenLastCalledWith('hello');
  });

  it('does not submit when gemini client is absent even with startup guards initialized', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: 'hello',
          submitPrompt,
          agentClientPresent: false,
        }),
      ),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();
  });

  it('does not submit when initial prompt is empty even with startup guards initialized', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: undefined,
          submitPrompt,
        }),
      ),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();
  });

  it('does not submit when folder trust dialog is open even with startup guards initialized', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: 'hello',
          submitPrompt,
          blockedByDialogs: {
            ...blockedByDialogsClosed,
            isFolderTrustDialogOpen: true,
          },
        }),
      ),
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();
  });

  it('submits after folder trust dialog closes following startup guard initialization', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({
        isFolderTrustDialogOpen,
        startupGuardsInitialized,
      }: {
        isFolderTrustDialogOpen: boolean;
        startupGuardsInitialized: boolean;
      }) =>
        useInitialPromptSubmit(
          createParams({
            initialPrompt: 'hello',
            submitPrompt,
            blockedByDialogs: {
              ...blockedByDialogsClosed,
              isFolderTrustDialogOpen,
            },
            startupGuardsInitialized,
          }),
        ),
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

    expect(submitPrompt).not.toHaveBeenCalled();

    rerender({
      isFolderTrustDialogOpen: false,
      startupGuardsInitialized: true,
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledWith('hello');
    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('waits for startup guards even when folder trust resolves first', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({
        isFolderTrustDialogOpen,
        startupGuardsInitialized,
      }: {
        isFolderTrustDialogOpen: boolean;
        startupGuardsInitialized: boolean;
      }) =>
        useInitialPromptSubmit(
          createParams({
            initialPrompt: 'hello',
            submitPrompt,
            blockedByDialogs: {
              ...blockedByDialogsClosed,
              isFolderTrustDialogOpen,
            },
            startupGuardsInitialized,
          }),
        ),
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

    expect(submitPrompt).not.toHaveBeenCalled();

    rerender({
      isFolderTrustDialogOpen: false,
      startupGuardsInitialized: false,
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();

    rerender({
      isFolderTrustDialogOpen: false,
      startupGuardsInitialized: true,
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledWith('hello');
    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });
});
