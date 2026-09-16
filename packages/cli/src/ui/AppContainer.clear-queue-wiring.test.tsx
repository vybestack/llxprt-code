/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { act, memo, useEffect } from 'react';
import { Config } from '@vybestack/llxprt-code-core';
import {
  renderWithProviders,
  renderHook,
  createMockSettings,
  waitFor,
} from '../test-utils/render.js';
import { createMockCommandContext } from '../test-utils/mockCommandContext.js';
import { buildAppCommands, useAppStores } from './AppContainerRuntime.js';
import {
  AppCommandsProvider,
  useAppCommands,
  type AppCommands,
} from './contexts/AppCommandsContext.js';
import { Composer } from './components/Composer.js';
import { useTextBuffer } from './components/shared/text-buffer.js';
import { useQueuedSubmissions } from './hooks/agentStream/useQueuedSubmissions.js';
import { createTurnStore } from './stores/turn/turnStore.js';
import { TurnProvider } from './stores/turn/TurnContext.js';
import { createTerminalStore } from './stores/terminal/terminalStore.js';
import { StreamingState } from './types.js';

const noop = (): void => {};
const asyncNoop = async (): Promise<void> => {};

function dialogCommands(): Parameters<typeof buildAppCommands>[0] {
  return {
    onWorkspaceMigrationDialogOpen: noop,
    handleFolderTrustSelect: asyncNoop,
    welcomeActions: {
      startSetup: noop,
      resetAndReopen: noop,
      selectProvider: noop,
      selectModel: noop,
      selectAuthMethod: noop,
      onAuthComplete: noop,
      onAuthError: noop,
      skipSetup: noop,
      goBack: noop,
      saveProfile: asyncNoop,
      dismiss: noop,
    },
    triggerWelcomeAuth: asyncNoop,
    handleThemeSelect: noop,
    handleThemeHighlight: noop,
    handleAuthSelect: asyncNoop,
    handleEditorSelect: noop,
    handleProviderSelect: asyncNoop,
    handleProfileSelect: asyncNoop,
    viewProfileDetail: asyncNoop,
    closeProfileDetailDialog: asyncNoop,
    loadProfileFromDetail: asyncNoop,
    deleteProfileFromDetail: asyncNoop,
    deleteProfileFromList: asyncNoop,
    setProfileAsDefault: asyncNoop,
    openProfileEditor: asyncNoop,
    closeProfileEditor: asyncNoop,
    saveProfileFromEditor: asyncNoop,
    handleToolsSelect: noop,
  };
}

function createHarness(initialQueueCommandsAvailable = true) {
  let queueCommandsAvailable = initialQueueCommandsAvailable;
  const turn = createTurnStore({ streamingState: StreamingState.Responding });
  const terminal = createTerminalStore();
  const settings = createMockSettings({});
  const config = new Config({
    sessionId: 'clear-queue-2536',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test-model',
  });
  const submitted: string[] = [];
  const observedCommands: AppCommands[] = [];
  const CommandConsumer = memo(() => {
    observedCommands.push(useAppCommands());
    return null;
  });
  CommandConsumer.displayName = 'CommandConsumer';
  let queue: ReturnType<typeof useQueuedSubmissions> | undefined;
  let revision = 0;
  function Harness() {
    const currentRevision = revision++;
    queue = useQueuedSubmissions();
    const buffer = useTextBuffer({
      initialText: '',
      viewport: { width: 80, height: 24 },
      isValidPath: () => false,
    });
    const currentQueue = queue;
    useEffect(() => {
      turn.commands.setQueuedSubmissions(currentQueue.queuedSubmissions);
    }, [currentQueue.queuedSubmissions]);
    const commands = buildAppCommands(
      dialogCommands(),
      {
        buffer,
        commandContext: createMockCommandContext(),
        inputHistoryStore: { inputHistory: [] },
        handleUserInputSubmit: (text) => {
          submitted.push(`${currentRevision}:${text}`);
        },
        handleSteer: () => false,
        vimHandleInput: () => false,
        sendAllQueuedSubmissions: noop,
        steerAllQueuedSubmissions: noop,
        clearQueuedSubmissions: currentQueue.clearSubmissions,
        handleIdePromptComplete: noop,
        handleOAuthCodeDialogClose: noop,
        handleOAuthCodeSubmit: asyncNoop,
        handleSettingsRestart: noop,
      },
      { handleClearScreen: noop },
      terminal,
    );
    return (
      <TurnProvider store={turn}>
        <AppCommandsProvider
          value={{
            ...commands,
            sendAllQueuedSubmissions: queueCommandsAvailable ? noop : undefined,
            steerAllQueuedSubmissions: queueCommandsAvailable
              ? noop
              : undefined,
          }}
        >
          <CommandConsumer />
          <Composer config={config} settings={settings} />
        </AppCommandsProvider>
      </TurnProvider>
    );
  }
  return {
    turn,
    submitted,
    observedCommands,
    getRevision: () => revision - 1,
    setQueueCommandsAvailable: (available: boolean) => {
      queueCommandsAvailable = available;
    },
    render: () => renderWithProviders(<Harness />, { settings }),
    getQueue: () => {
      if (queue === undefined) throw new Error('Harness must be mounted');
      return queue;
    },
  };
}

describe('AppContainer queue command wiring', () => {
  it('publishes queue command availability changes to command consumers', () => {
    const harness = createHarness(false);
    const { unmount } = harness.render();
    try {
      expect(
        harness.observedCommands.at(-1)?.sendAllQueuedSubmissions,
      ).toBeUndefined();
      expect(
        harness.observedCommands.at(-1)?.steerAllQueuedSubmissions,
      ).toBeUndefined();
      const initialRenders = harness.observedCommands.length;
      act(() => {
        harness.setQueueCommandsAvailable(true);
        harness.getQueue().enqueueSubmission({ query: 'enable commands' });
      });
      expect(harness.observedCommands.length).toBeGreaterThan(initialRenders);
      expect(
        typeof harness.observedCommands.at(-1)?.sendAllQueuedSubmissions,
      ).toBe('function');
      expect(
        typeof harness.observedCommands.at(-1)?.steerAllQueuedSubmissions,
      ).toBe('function');
      const enabledRenders = harness.observedCommands.length;
      act(() => {
        harness.setQueueCommandsAvailable(false);
        harness.getQueue().enqueueSubmission({ query: 'disable commands' });
      });
      expect(harness.observedCommands.length).toBeGreaterThan(enabledRenders);
      expect(
        harness.observedCommands.at(-1)?.sendAllQueuedSubmissions,
      ).toBeUndefined();
      expect(
        harness.observedCommands.at(-1)?.steerAllQueuedSubmissions,
      ).toBeUndefined();
    } finally {
      unmount();
    }
  });

  it('keeps commands stable while dispatching to the current input handler', () => {
    const harness = createHarness();
    const { unmount } = harness.render();
    try {
      const commands = harness.observedCommands.at(0);
      if (commands === undefined) throw new Error('Commands were not mounted');
      const renders = harness.observedCommands.length;
      const initialRevision = harness.getRevision();
      act(() => {
        harness.getQueue().enqueueSubmission({ query: 'force input update' });
      });
      expect(harness.getRevision()).toBeGreaterThan(initialRevision);
      expect(harness.observedCommands).toHaveLength(renders);
      commands.handleUserInputSubmit('current handler');
      expect(harness.submitted).toStrictEqual([
        `${harness.getRevision()}:current handler`,
      ]);
    } finally {
      unmount();
    }
  });
  it('clears the real queue with Backspace on empty input and leaves nothing to drain', async () => {
    const harness = createHarness();
    const { stdin, unmount } = harness.render();
    try {
      act(() => {
        harness.getQueue().enqueueSubmission({ query: 'queued one' });
        harness.getQueue().enqueueSubmission({ query: 'queued two' });
      });
      expect(harness.turn.store.getState().queuedSubmissions).toHaveLength(2);
      await new Promise((resolve) => setTimeout(resolve, 30));
      stdin.write('\x7f');
      await waitFor(() =>
        expect(harness.turn.store.getState().queuedSubmissions).toHaveLength(0),
      );
      expect(harness.getQueue().queuedSubmissionsRef.current).toHaveLength(0);
      act(() => {
        harness.turn.commands.setStreamingState(StreamingState.Idle);
        expect(harness.getQueue().dequeueSubmission()).toBeUndefined();
      });
      stdin.write('\r');
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(harness.submitted).toStrictEqual([]);
    } finally {
      unmount();
    }
  });
});

describe('app store initialization', () => {
  it('exposes the configured model on the first render and retains the stores', () => {
    const renderedModels: string[] = [];
    const runtime = { getModel: () => 'configured-model' };
    const { result, rerender, unmount } = renderHook(() => {
      const stores = useAppStores(runtime);
      renderedModels.push(stores.settingsStore.store.getState().currentModel);
      return stores;
    });
    expect(renderedModels[0]).toBe('configured-model');
    const initial = result.current.settingsStore;
    rerender();
    expect(result.current.settingsStore).toBe(initial);
    unmount();
  });
});
