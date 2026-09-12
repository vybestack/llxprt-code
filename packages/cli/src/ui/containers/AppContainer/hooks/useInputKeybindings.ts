/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useKeybindings } from './useKeybindings.js';
import type { UiRuntime } from '../../../cliUiRuntime.js';
import type { TerminalStore } from '../../../stores/terminal/terminalStore.js';
import type { SettingsProfileStore } from '../../../stores/settings/settingsStore.js';
import type { TurnStore } from '../../../stores/turn/turnStore.js';
import { useStoreSelector } from '../../../stores/useStoreSelector.js';

interface InputKeybindingsParams {
  uiRuntime: UiRuntime;
  terminalStore: TerminalStore;
  settingsStore: SettingsProfileStore;
  turnStore: TurnStore;
  buffer: { text: string };
  requestCtrlCExit: Parameters<
    typeof useKeybindings
  >[0]['exit']['requestCtrlCExit'];
  requestCtrlDExit: Parameters<
    typeof useKeybindings
  >[0]['exit']['requestCtrlDExit'];
  cancelOngoingRequest: Parameters<
    typeof useKeybindings
  >[0]['exit']['cancelOngoingRequest'];
  handleSlashCommand: Parameters<
    typeof useKeybindings
  >[0]['display']['handleSlashCommand'];
}

/**
 * Terminal-backed display state for the keybinding layer. Values arrive via
 * narrow primitive selectors; setters come straight from the store commands.
 */
function useTerminalDisplayState(terminalStore: TerminalStore) {
  const constrainHeight = useStoreSelector(
    terminalStore.store,
    (s) => s.constrainHeight,
  );
  const showErrorDetails = useStoreSelector(
    terminalStore.store,
    (s) => s.showErrorDetails,
  );
  const showToolDescriptions = useStoreSelector(
    terminalStore.store,
    (s) => s.showToolDescriptions,
  );
  const copyModeEnabled = useStoreSelector(
    terminalStore.store,
    (s) => s.copyModeEnabled,
  );
  const useAlternateBuffer = useStoreSelector(
    terminalStore.store,
    (s) => s.useAlternateBuffer,
  );
  const renderMarkdown = useStoreSelector(
    terminalStore.store,
    (s) => s.renderMarkdown,
  );
  const isTodoPanelCollapsed = useStoreSelector(
    terminalStore.store,
    (s) => s.isTodoPanelCollapsed,
  );
  const isQueuedMessagesPanelCollapsed = useStoreSelector(
    terminalStore.store,
    (s) => s.isQueuedMessagesPanelCollapsed,
  );
  const activeShellPtyId = useStoreSelector(
    terminalStore.store,
    (s) => s.activeShellPtyId,
  );
  return {
    constrainHeight,
    showErrorDetails,
    showToolDescriptions,
    copyModeEnabled,
    useAlternateBuffer,
    renderMarkdown,
    isTodoPanelCollapsed,
    isQueuedMessagesPanelCollapsed,
    activeShellPtyId,
  };
}

export function useInputKeybindings(p: InputKeybindingsParams) {
  const { uiRuntime, terminalStore, settingsStore, turnStore, buffer } = p;
  const {
    requestCtrlCExit,
    requestCtrlDExit,
    cancelOngoingRequest,
    handleSlashCommand,
  } = p;
  const { addItem, refreshStatic } = turnStore.commands;
  const { commands } = terminalStore;
  const display = useTerminalDisplayState(terminalStore);
  const ctrlCPressedOnce = useStoreSelector(
    turnStore.store,
    (s) => s.ctrlCPressedOnce,
  );
  const ideContextState = useStoreSelector(
    settingsStore.store,
    (s) => s.ideContextState,
  );
  const { setEmbeddedShellFocused } = commands;
  useKeybindings({
    exit: {
      requestCtrlCExit,
      requestCtrlDExit,
      ctrlCPressedOnce,
      cancelOngoingRequest,
      bufferTextLength: buffer.text.length,
    },
    display: {
      showErrorDetails: display.showErrorDetails,
      setShowErrorDetails: commands.setShowErrorDetails,
      showToolDescriptions: display.showToolDescriptions,
      setShowToolDescriptions: commands.setShowToolDescriptions,
      renderMarkdown: display.renderMarkdown,
      setRenderMarkdown: commands.setRenderMarkdown,
      isTodoPanelCollapsed: display.isTodoPanelCollapsed,
      setIsTodoPanelCollapsed: commands.setIsTodoPanelCollapsed,
      isQueuedMessagesPanelCollapsed: display.isQueuedMessagesPanelCollapsed,
      setIsQueuedMessagesPanelCollapsed:
        commands.setIsQueuedMessagesPanelCollapsed,
      constrainHeight: display.constrainHeight,
      setConstrainHeight: commands.setConstrainHeight,
      refreshStatic,
      addItem,
      handleSlashCommand,
    },
    shell: {
      activeShellPtyId: display.activeShellPtyId,
      setEmbeddedShellFocused,
      getEnableInteractiveShell: () =>
        uiRuntime.shell.getEnableInteractiveShell(),
    },
    copyMode: {
      copyModeEnabled: display.copyModeEnabled,
      setCopyModeEnabled: commands.setCopyModeEnabled,
      useAlternateBuffer: display.useAlternateBuffer,
    },
    ideContext: {
      getIdeMode: () => uiRuntime.ide.getIdeMode(),
      ideContextState,
    },
    mcp: {
      getMcpServers: () => uiRuntime.mcp.getMcpServers(),
    },
  });
}
