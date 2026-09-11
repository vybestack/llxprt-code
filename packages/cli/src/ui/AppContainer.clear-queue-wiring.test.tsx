/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { act, useEffect } from 'react';
import { Config } from '@vybestack/llxprt-code-core';
import {
  renderWithProviders,
  createMockSettings,
  waitFor,
} from '../test-utils/render.js';
import { createMockCommandContext } from '../test-utils/mockCommandContext.js';
import { buildAppCommands } from './AppContainerRuntime.js';
import { AppCommandsProvider } from './contexts/AppCommandsContext.js';
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

function createHarness() {
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
  let queue: ReturnType<typeof useQueuedSubmissions> | undefined;
  function Harness() {
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
          submitted.push(text);
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
        <AppCommandsProvider value={commands}>
          <Composer config={config} settings={settings} />
        </AppCommandsProvider>
      </TurnProvider>
    );
  }
  return {
    turn,
    submitted,
    render: () => renderWithProviders(<Harness />, { settings }),
    getQueue: () => {
      if (queue === undefined) throw new Error('Harness must be mounted');
      return queue;
    },
  };
}

describe('AppContainer queue command wiring', () => {
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
