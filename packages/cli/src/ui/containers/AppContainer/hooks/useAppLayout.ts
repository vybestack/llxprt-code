/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo } from 'react';
import { useLogger } from '../../../hooks/useLogger.js';
import { useGitBranchInfo } from '../../../hooks/useGitBranchInfo.js';
import { useHookDisplayState } from '../../../hooks/useHookDisplayState.js';
import { getAllLlxprtMdFilenames } from '@vybestack/llxprt-code-core';
import { useKeybindings } from './useKeybindings.js';
import { useLayoutMeasurement } from './useLayoutMeasurement.js';
import { useFlickerDetector } from '../../../hooks/useFlickerDetector.js';
import { useSelectionDebugLogger } from './useSelectionDebugLogger.js';
import { useClearScreenAction } from './useClearScreenAction.js';
import { useInputHistoryBootstrap } from './useInputHistoryBootstrap.js';
import { useInitialPromptSubmit } from './useInitialPromptSubmit.js';
import { usePowerShellPlaceholder } from './usePowerShellPlaceholder.js';
import { calculateMainAreaWidth } from '../../../utils/ui-sizing.js';
import type { AppBootstrapResult } from './useAppBootstrap.js';
import type { AppDialogsResult } from './useAppDialogs.js';
import type { AppInputResult } from './useAppInput.js';
import type { DialogStore } from '../../../stores/dialog/dialogStore.js';
import type { TerminalStore } from '../../../stores/terminal/terminalStore.js';
import type { TurnStore } from '../../../stores/turn/turnStore.js';
import { useStoreSelector } from '../../../stores/useStoreSelector.js';
import type { UiRuntime } from '../../../cliUiRuntime.js';

export interface AppLayoutParams {
  // From bootstrap
  uiRuntime: UiRuntime;
  settings: AppBootstrapResult['settings'];
  runtimeMessageBus: AppBootstrapResult['runtimeMessageBus'];
  consoleMessages: AppBootstrapResult['consoleMessages'];
  clearConsoleMessagesState: AppBootstrapResult['clearConsoleMessagesState'];
  /**
   * Turn store; the command context gets addItem and the clear-screen action
   * gets clearItems straight from the store commands (stable references).
   */
  turnStore: TurnStore;

  // From dialogs
  refreshStatic: AppDialogsResult['refreshStatic'];
  renderMarkdown: AppDialogsResult['renderMarkdown'];
  setRenderMarkdown: AppDialogsResult['setRenderMarkdown'];
  isTodoPanelCollapsed: AppDialogsResult['isTodoPanelCollapsed'];
  setIsTodoPanelCollapsed: AppDialogsResult['setIsTodoPanelCollapsed'];
  isQueuedMessagesPanelCollapsed: AppDialogsResult['isQueuedMessagesPanelCollapsed'];
  setIsQueuedMessagesPanelCollapsed: AppDialogsResult['setIsQueuedMessagesPanelCollapsed'];
  ideContextState: AppDialogsResult['ideContextState'];
  setDebugMessage: AppDialogsResult['setDebugMessage'];
  /** Typed DialogStore; dialog-open state is read through narrow selectors. */
  store: DialogStore;
  /** Terminal store; layout reads dimensions/prefs and writes derived sizes. */
  terminalStore: TerminalStore;
  embeddedShellFocused: AppDialogsResult['embeddedShellFocused'];
  setEmbeddedShellFocused: AppDialogsResult['setEmbeddedShellFocused'];
  startupGuardsInitialized: AppDialogsResult['startupGuardsInitialized'];

  // From input
  streamingState: AppInputResult['streamingState'];
  pendingHistoryItems: AppInputResult['pendingHistoryItems'];
  cancelOngoingRequest: AppInputResult['cancelOngoingRequest'];
  activeShellPtyId: AppInputResult['activeShellPtyId'];
  ctrlCPressedOnce: AppInputResult['ctrlCPressedOnce'];
  requestCtrlCExit: AppInputResult['requestCtrlCExit'];
  requestCtrlDExit: AppInputResult['requestCtrlDExit'];
  handleSlashCommand: AppInputResult['handleSlashCommand'];
  inputHistoryStore: AppInputResult['inputHistoryStore'];
  handleUserInputSubmit: AppInputResult['handleUserInputSubmit'];
  handleSteer: AppInputResult['handleSteer'];
  interactiveRuntimeReady: AppInputResult['interactiveRuntimeReady'];
  vimModeEnabled: AppInputResult['vimModeEnabled'];
  buffer: AppInputResult['buffer'];
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
  return {
    constrainHeight,
    showErrorDetails,
    showToolDescriptions,
    copyModeEnabled,
    useAlternateBuffer,
  };
}

function useLayoutKeybindings(p: AppLayoutParams) {
  const {
    uiRuntime,
    refreshStatic,
    renderMarkdown,
    setRenderMarkdown,
    isTodoPanelCollapsed,
    setIsTodoPanelCollapsed,
    isQueuedMessagesPanelCollapsed,
    setIsQueuedMessagesPanelCollapsed,
    ideContextState,
    activeShellPtyId,
    setEmbeddedShellFocused,
    ctrlCPressedOnce,
    cancelOngoingRequest,
    requestCtrlCExit,
    requestCtrlDExit,
    handleSlashCommand,
    buffer,
  } = p;
  const { addItem } = p.turnStore.commands;
  const { commands } = p.terminalStore;
  const display = useTerminalDisplayState(p.terminalStore);
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
      renderMarkdown,
      setRenderMarkdown,
      isTodoPanelCollapsed,
      setIsTodoPanelCollapsed,
      isQueuedMessagesPanelCollapsed,
      setIsQueuedMessagesPanelCollapsed,
      constrainHeight: display.constrainHeight,
      setConstrainHeight: commands.setConstrainHeight,
      refreshStatic,
      addItem,
      handleSlashCommand,
    },
    shell: {
      activeShellPtyId,
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

function useLayoutKeybindingsAndHistory(p: AppLayoutParams) {
  const {
    uiRuntime,
    clearConsoleMessagesState,
    refreshStatic,
    inputHistoryStore,
  } = p;
  const { clearItems } = p.turnStore.commands;
  useLayoutKeybindings(p);
  const logger = useLogger(uiRuntime.storage);
  useInputHistoryBootstrap({ inputHistoryStore, logger });
  const useAlternateBuffer = useStoreSelector(
    p.terminalStore.store,
    (s) => s.useAlternateBuffer,
  );
  const handleClearScreen = useClearScreenAction({
    clearItems,
    clearConsoleMessagesState,
    useAlternateBuffer,
    refreshStatic,
  });
  return { logger, handleClearScreen };
}

function useLayoutMeasure(p: AppLayoutParams) {
  const { consoleMessages } = p;
  const { commands } = p.terminalStore;
  const terminalHeight = useStoreSelector(
    p.terminalStore.store,
    (s) => s.terminalHeight,
  );
  const footerHeight = useStoreSelector(
    p.terminalStore.store,
    (s) => s.footerHeight,
  );
  const constrainHeight = useStoreSelector(
    p.terminalStore.store,
    (s) => s.constrainHeight,
  );
  const copyModeEnabled = useStoreSelector(
    p.terminalStore.store,
    (s) => s.copyModeEnabled,
  );
  const showErrorDetails = useStoreSelector(
    p.terminalStore.store,
    (s) => s.showErrorDetails,
  );
  useSelectionDebugLogger({ store: p.store });
  const { mainControlsRef, pendingHistoryItemRef, rootUiRef } =
    useLayoutMeasurement({
      enabled: true,
      copyShortcutEnabled: copyModeEnabled,
      setFooterHeight: commands.setFooterHeight,
      terminalHeight,
      consoleMessages,
      showErrorDetails,
    });
  const staticExtraHeight = 3;
  const availableTerminalHeight = useMemo(
    () => terminalHeight - footerHeight - staticExtraHeight,
    [terminalHeight, footerHeight],
  );
  useEffect(() => {
    commands.setAvailableTerminalHeight(availableTerminalHeight);
  }, [commands, availableTerminalHeight]);
  useFlickerDetector(rootUiRef, terminalHeight, constrainHeight);
  return {
    mainControlsRef,
    pendingHistoryItemRef,
    rootUiRef,
  };
}

function useLayoutContext(p: AppLayoutParams) {
  const {
    uiRuntime,
    settings,
    runtimeMessageBus,
    consoleMessages,
    store,
    handleUserInputSubmit,
    handleSteer,
    interactiveRuntimeReady,
    vimModeEnabled,
    startupGuardsInitialized,
  } = p;
  const terminalWidth = useStoreSelector(
    p.terminalStore.store,
    (s) => s.terminalWidth,
  );
  const terminalHeight = useStoreSelector(
    p.terminalStore.store,
    (s) => s.terminalHeight,
  );
  const debugMode = uiRuntime.app.getDebugMode();
  const filteredConsoleMessages = useMemo(() => {
    if (debugMode) return consoleMessages;
    return consoleMessages.filter((msg) => msg.type !== 'debug');
  }, [consoleMessages, debugMode]);
  const { branchName, isDirty } = useGitBranchInfo(
    uiRuntime.session.getTargetDir(),
  );
  const branchIsDirty = isDirty;
  const contextFileNames = useMemo(() => {
    const fromSettings = settings.merged.ui.contextFileName;
    if (fromSettings != null && fromSettings !== '')
      return Array.isArray(fromSettings) ? fromSettings : [fromSettings];
    return getAllLlxprtMdFilenames();
  }, [settings.merged.ui.contextFileName]);
  const initialPrompt = useMemo(() => uiRuntime.app.getQuestion(), [uiRuntime]);
  useInitialPromptSubmit({
    initialPrompt,
    submitPrompt: handleUserInputSubmit,
    agentClientPresent: Boolean(uiRuntime.agentClientSource.getAgentClient()),
    interactiveRuntimeReady,
    store,
    startupGuardsInitialized,
  });
  const mainAreaWidth = calculateMainAreaWidth(terminalWidth, settings);
  useEffect(() => {
    p.terminalStore.commands.setMainAreaWidth(mainAreaWidth);
  }, [p.terminalStore, mainAreaWidth]);
  const placeholder = usePowerShellPlaceholder({ vimModeEnabled });
  useEffect(() => {
    uiRuntime.shell.setPtyTerminalSize(mainAreaWidth, terminalHeight);
  }, [uiRuntime, mainAreaWidth, terminalHeight]);
  const activeHooks = useHookDisplayState(runtimeMessageBus);
  return {
    filteredConsoleMessages,
    branchName,
    branchIsDirty,
    contextFileNames,
    initialPrompt,
    placeholder,
    activeHooks,
    handleSteer,
  };
}

function useLayoutMeasurementAndFlow(p: AppLayoutParams) {
  const measure = useLayoutMeasure(p);
  const context = useLayoutContext(p);
  return { ...measure, ...context };
}

export function useAppLayout(params: AppLayoutParams) {
  const kb = useLayoutKeybindingsAndHistory(params);
  const measure = useLayoutMeasurementAndFlow(params);
  return { ...kb, ...measure };
}

export type AppLayoutResult = ReturnType<typeof useAppLayout>;
