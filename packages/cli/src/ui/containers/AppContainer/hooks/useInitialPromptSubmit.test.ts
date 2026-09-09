/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { runAllTimersAsync } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../../../test-utils/render.js';
import { useInitialPromptSubmit } from './useInitialPromptSubmit.js';
import { createDialogStore } from '../../../stores/dialog/dialogStore.js';

type HookParams = Parameters<typeof useInitialPromptSubmit>[0];

const createParams = (overrides: Partial<HookParams> = {}): HookParams => ({
  initialPrompt: 'hello',
  submitPrompt: vi.fn().mockResolvedValue(undefined),
  agentClientPresent: true,
  interactiveRuntimeReady: true,
  store: createDialogStore(),
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
      await runAllTimersAsync();
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
      await runAllTimersAsync();
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
      await runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();

    rerender({ interactiveRuntimeReady: true });

    await act(async () => {
      await runAllTimersAsync();
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
      await runAllTimersAsync();
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
      await runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();

    rerender({ startupGuardsInitialized: true });

    await act(async () => {
      await runAllTimersAsync();
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
      await runAllTimersAsync();
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
      await runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledWith('hello');
    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('does not submit when a blocking dialog is open even with startup guards initialized', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);
    const store = createDialogStore();
    store.commands.openDialog({ kind: 'welcome', payload: {} });

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: 'hello',
          submitPrompt,
          store,
        }),
      ),
    );

    await act(async () => {
      await runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();
  });

  it('does not submit while a blocking dialog is open in the DialogStore', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);
    const store = createDialogStore();
    store.commands.openDialog({ kind: 'auth', payload: {} });

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: 'hello',
          submitPrompt,
          store,
        }),
      ),
    );

    await act(async () => {
      await runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();

    act(() => {
      store.commands.closeDialog('auth');
    });

    await act(async () => {
      await runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledWith('hello');
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
      await runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledTimes(1);

    rerender({ startupGuardsInitialized: true });

    await act(async () => {
      await runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('retries submission after submit failure when a blocking dialog dependency changes', async () => {
    const submitPrompt = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);
    const store = createDialogStore();

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: 'hello',
          submitPrompt,
          store,
        }),
      ),
    );

    await act(async () => {
      await runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledTimes(1);

    act(() => {
      store.commands.openDialog({ kind: 'folderTrust', payload: {} });
    });

    await act(async () => {
      await runAllTimersAsync();
    });

    act(() => {
      store.commands.closeDialog('folderTrust');
    });

    await act(async () => {
      await runAllTimersAsync();
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
      await runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledTimes(1);

    rerender({ interactiveRuntimeReady: false });

    await act(async () => {
      await runAllTimersAsync();
    });

    rerender({ interactiveRuntimeReady: true });

    await act(async () => {
      await runAllTimersAsync();
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
      await runAllTimersAsync();
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
      await runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();
  });

  it('does not submit when folder trust dialog is open even with startup guards initialized', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);
    const store = createDialogStore();
    store.commands.openDialog({ kind: 'folderTrust', payload: {} });

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: 'hello',
          submitPrompt,
          store,
        }),
      ),
    );

    await act(async () => {
      await runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();
  });

  it('submits after folder trust dialog closes following startup guard initialization', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);
    const store = createDialogStore();
    store.commands.openDialog({ kind: 'folderTrust', payload: {} });

    renderHook(() =>
      useInitialPromptSubmit(
        createParams({
          initialPrompt: 'hello',
          submitPrompt,
          store,
          startupGuardsInitialized: true,
        }),
      ),
    );

    await act(async () => {
      await runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();

    act(() => {
      store.commands.closeDialog('folderTrust');
    });

    await act(async () => {
      await runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledWith('hello');
    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });

  it('waits for startup guards even when folder trust resolves first', async () => {
    const submitPrompt = vi.fn().mockResolvedValue(undefined);
    const store = createDialogStore();
    store.commands.openDialog({ kind: 'folderTrust', payload: {} });

    const { rerender } = renderHook(
      ({ startupGuardsInitialized }: { startupGuardsInitialized: boolean }) =>
        useInitialPromptSubmit(
          createParams({
            initialPrompt: 'hello',
            submitPrompt,
            store,
            startupGuardsInitialized,
          }),
        ),
      { initialProps: { startupGuardsInitialized: false } },
    );

    await act(async () => {
      await runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();

    act(() => {
      store.commands.closeDialog('folderTrust');
    });

    rerender({ startupGuardsInitialized: false });

    await act(async () => {
      await runAllTimersAsync();
    });

    expect(submitPrompt).not.toHaveBeenCalled();

    rerender({ startupGuardsInitialized: true });

    await act(async () => {
      await runAllTimersAsync();
    });

    expect(submitPrompt).toHaveBeenCalledWith('hello');
    expect(submitPrompt).toHaveBeenCalledTimes(1);
  });
});
