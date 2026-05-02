/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo } from 'react';
import { useLogger } from '../../../hooks/useLogger.js';
import { useGitBranchName } from '../../../hooks/useGitBranchName.js';
import { useHookDisplayState } from '../../../hooks/useHookDisplayState.js';
import { getAllLlxprtMdFilenames } from '@vybestack/llxprt-code-core';
import { useKeybindings } from './useKeybindings.js';
import { useLayoutMeasurement } from './useLayoutMeasurement.js';
import { useFlickerDetector } from '../../../hooks/useFlickerDetector.js';
import { useTodoContinuationFlow } from './useTodoContinuationFlow.js';
import { useSelectionDebugLogger } from './useSelectionDebugLogger.js';
import { useClearScreenAction } from './useClearScreenAction.js';
import { useConfirmationSelection } from './useConfirmationSelection.js';
import { useInputHistoryBootstrap } from './useInputHistoryBootstrap.js';
import { useInitialPromptSubmit } from './useInitialPromptSubmit.js';
import { usePowerShellPlaceholder } from './usePowerShellPlaceholder.js';
import { calculateMainAreaWidth } from '../../../utils/ui-sizing.js';
import type { HistoryItem } from '../../../types.js';
import type { AppBootstrapResult } from './useAppBootstrap.js';
import type { AppDialogsResult } from './useAppDialogs.js';
import type { AppInputResult } from './useAppInput.js';

export interface AppLayoutParams {
  // From bootstrap
  config: AppBootstrapResult['config'];
  settings: AppBootstrapResult['settings'];
  todoContinuationRef: AppBootstrapResult['todoContinuationRef'];
  hadToolCallsRef: AppBootstrapResult['hadToolCallsRef'];
  runtimeMessageBus: AppBootstrapResult['runtimeMessageBus'];
  consoleMessages: AppBootstrapResult['consoleMessages'];
  clearConsoleMessagesState: AppBootstrapResult['clearConsoleMessagesState'];
  addItem: (item: Omit<HistoryItem, 'id'>, baseTimestamp?: number) => number;
  clearItems: AppBootstrapResult['clearItems'];
  history: AppBootstrapResult['history'];

  // From dialogs
  constrainHeight: AppDialogsResult['constrainHeight'];
  setConstrainHeight: AppDialogsResult['setConstrainHeight'];
  refreshStatic: AppDialogsResult['refreshStatic'];
  showErrorDetails: AppDialogsResult['showErrorDetails'];
  setShowErrorDetails: AppDialogsResult['setShowErrorDetails'];
  showToolDescriptions: AppDialogsResult['showToolDescriptions'];
  setShowToolDescriptions: AppDialogsResult['setShowToolDescriptions'];
  renderMarkdown: AppDialogsResult['renderMarkdown'];
  setRenderMarkdown: AppDialogsResult['setRenderMarkdown'];
  isTodoPanelCollapsed: AppDialogsResult['isTodoPanelCollapsed'];
  setIsTodoPanelCollapsed: AppDialogsResult['setIsTodoPanelCollapsed'];
  setFooterHeight: AppDialogsResult['setFooterHeight'];
  footerHeight: AppDialogsResult['footerHeight'];
  copyModeEnabled: AppDialogsResult['copyModeEnabled'];
  setCopyModeEnabled: AppDialogsResult['setCopyModeEnabled'];
  useAlternateBuffer: AppDialogsResult['useAlternateBuffer'];
  ideContextState: AppDialogsResult['ideContextState'];
  setDebugMessage: AppDialogsResult['setDebugMessage'];
  isAuthDialogOpen: AppDialogsResult['isAuthDialogOpen'];
  isThemeDialogOpen: AppDialogsResult['isThemeDialogOpen'];
  isEditorDialogOpen: AppDialogsResult['isEditorDialogOpen'];
  isProviderDialogOpen: AppDialogsResult['isProviderDialogOpen'];
  isToolsDialogOpen: AppDialogsResult['isToolsDialogOpen'];
  isCreateProfileDialogOpen: AppDialogsResult['isCreateProfileDialogOpen'];
  showPrivacyNotice: AppDialogsResult['showPrivacyNotice'];
  isWelcomeDialogOpen: AppDialogsResult['isWelcomeDialogOpen'];
  embeddedShellFocused: AppDialogsResult['embeddedShellFocused'];
  setEmbeddedShellFocused: AppDialogsResult['setEmbeddedShellFocused'];

  // From input
  streamingState: AppInputResult['streamingState'];
  pendingHistoryItems: AppInputResult['pendingHistoryItems'];
  confirmationRequest: AppInputResult['confirmationRequest'];
  cancelOngoingRequest: AppInputResult['cancelOngoingRequest'];
  activeShellPtyId: AppInputResult['activeShellPtyId'];
  ctrlCPressedOnce: AppInputResult['ctrlCPressedOnce'];
  requestCtrlCExit: AppInputResult['requestCtrlCExit'];
  requestCtrlDExit: AppInputResult['requestCtrlDExit'];
  handleSlashCommand: AppInputResult['handleSlashCommand'];
  inputHistoryStore: AppInputResult['inputHistoryStore'];
  submitQuery: AppInputResult['submitQuery'];
  vimModeEnabled: AppInputResult['vimModeEnabled'];
  terminalHeight: AppInputResult['terminalHeight'];
  terminalWidth: AppInputResult['terminalWidth'];
  buffer: AppInputResult['buffer'];
}

function useLayoutKeybindingsAndHistory(p: AppLayoutParams) {
  const {
    config,
    clearItems,
    clearConsoleMessagesState,
    constrainHeight,
    setConstrainHeight,
    refreshStatic,
    showErrorDetails,
    setShowErrorDetails,
    showToolDescriptions,
    setShowToolDescriptions,
    renderMarkdown,
    setRenderMarkdown,
    isTodoPanelCollapsed,
    setIsTodoPanelCollapsed,
    copyModeEnabled,
    setCopyModeEnabled,
    useAlternateBuffer,
    ideContextState,
    activeShellPtyId,
    setEmbeddedShellFocused,
    ctrlCPressedOnce,
    cancelOngoingRequest,
    requestCtrlCExit,
    requestCtrlDExit,
    handleSlashCommand,
    addItem,
    inputHistoryStore,
    buffer,
  } = p;
  useKeybindings({
    exit: {
      requestCtrlCExit,
      requestCtrlDExit,
      ctrlCPressedOnce,
      cancelOngoingRequest,
      bufferTextLength: buffer.text.length,
    },
    display: {
      showErrorDetails,
      setShowErrorDetails,
      showToolDescriptions,
      setShowToolDescriptions,
      renderMarkdown,
      setRenderMarkdown,
      isTodoPanelCollapsed,
      setIsTodoPanelCollapsed,
      constrainHeight,
      setConstrainHeight,
      refreshStatic,
      addItem,
      handleSlashCommand,
    },
    shell: {
      activeShellPtyId,
      setEmbeddedShellFocused,
      getEnableInteractiveShell: () => config.getEnableInteractiveShell(),
    },
    copyMode: {
      copyModeEnabled,
      setCopyModeEnabled,
      useAlternateBuffer,
    },
    ideContext: { getIdeMode: () => config.getIdeMode(), ideContextState },
    mcp: {
      getMcpServers: () => config.getMcpServers() as Record<string, unknown>,
    },
  });
  const logger = useLogger(config.storage);
  useInputHistoryBootstrap({ inputHistoryStore, logger });
  const handleClearScreen = useClearScreenAction({
    clearItems,
    clearConsoleMessagesState,
    useAlternateBuffer,
    refreshStatic,
  });
  return { logger, handleClearScreen };
}

function useLayoutMeasure(p: AppLayoutParams) {
  const {
    config,
    todoContinuationRef,
    hadToolCallsRef,
    consoleMessages,
    constrainHeight,
    setFooterHeight,
    footerHeight,
    streamingState,
    history,
    pendingHistoryItems,
    confirmationRequest,
    setDebugMessage,
    terminalHeight,
  } = p;
  useSelectionDebugLogger({ confirmationRequest });
  const handleConfirmationSelect = useConfirmationSelection({
    confirmationRequest,
  });
  const { mainControlsRef, pendingHistoryItemRef, rootUiRef } =
    useLayoutMeasurement({
      enabled: true,
      copyShortcutEnabled: p.copyModeEnabled,
      setFooterHeight,
      terminalHeight,
      consoleMessages,
      showErrorDetails: p.showErrorDetails,
    });
  const staticExtraHeight = 3;
  const availableTerminalHeight = useMemo(
    () => terminalHeight - footerHeight - staticExtraHeight,
    [terminalHeight, footerHeight],
  );
  useFlickerDetector(rootUiRef, terminalHeight, constrainHeight);
  useTodoContinuationFlow({
    config,
    streamingState,
    history,
    pendingHistoryItems,
    setDebugMessage,
    todoContinuationRef,
    hadToolCallsRef,
  });
  return {
    mainControlsRef,
    pendingHistoryItemRef,
    rootUiRef,
    availableTerminalHeight,
    handleConfirmationSelect,
  };
}

function useLayoutContext(p: AppLayoutParams) {
  const {
    config,
    settings,
    runtimeMessageBus,
    consoleMessages,
    isAuthDialogOpen,
    isThemeDialogOpen,
    isEditorDialogOpen,
    isProviderDialogOpen,
    isToolsDialogOpen,
    isCreateProfileDialogOpen,
    showPrivacyNotice,
    isWelcomeDialogOpen,
    terminalHeight,
    terminalWidth,
    submitQuery,
    vimModeEnabled,
  } = p;
  const debugMode = config.getDebugMode();
  const filteredConsoleMessages = useMemo(() => {
    if (debugMode) return consoleMessages;
    return consoleMessages.filter((msg) => msg.type !== 'debug');
  }, [consoleMessages, debugMode]);
  const branchName = useGitBranchName(config.getTargetDir());
  const contextFileNames = useMemo(() => {
    const fromSettings = settings.merged.ui.contextFileName;
    if (fromSettings != null && fromSettings !== '')
      return Array.isArray(fromSettings) ? fromSettings : [fromSettings];
    return getAllLlxprtMdFilenames();
  }, [settings.merged.ui.contextFileName]);
  const initialPrompt = useMemo(() => config.getQuestion(), [config]);
  useInitialPromptSubmit({
    initialPrompt,
    submitQuery,
    geminiClientPresent: Boolean(config.getGeminiClient()),
    blockedByDialogs: {
      isAuthDialogOpen,
      isThemeDialogOpen,
      isEditorDialogOpen,
      isProviderDialogOpen,
      isToolsDialogOpen,
      isCreateProfileDialogOpen,
      showPrivacyNotice,
      isWelcomeDialogOpen,
    },
  });
  const mainAreaWidth = calculateMainAreaWidth(terminalWidth, settings);
  const placeholder = usePowerShellPlaceholder({ vimModeEnabled });
  useEffect(() => {
    config.setPtyTerminalSize(mainAreaWidth, terminalHeight);
  }, [config, mainAreaWidth, terminalHeight]);
  const activeHooks = useHookDisplayState(runtimeMessageBus);
  return {
    filteredConsoleMessages,
    branchName,
    contextFileNames,
    initialPrompt,
    mainAreaWidth,
    placeholder,
    activeHooks,
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
