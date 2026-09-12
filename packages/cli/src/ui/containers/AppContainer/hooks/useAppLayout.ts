/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo } from 'react';
import { useGitBranchInfo } from '../../../hooks/useGitBranchInfo.js';
import { getAllLlxprtMdFilenames } from '@vybestack/llxprt-code-core';
import { useLayoutMeasurement } from './useLayoutMeasurement.js';
import { useFlickerDetector } from '../../../hooks/useFlickerDetector.js';
import { useSelectionDebugLogger } from './useSelectionDebugLogger.js';
import { useClearScreenAction } from './useClearScreenAction.js';
import { usePowerShellPlaceholder } from './usePowerShellPlaceholder.js';
import { calculateMainAreaWidth } from '../../../utils/ui-sizing.js';
import type { AppBootstrapResult } from './useAppBootstrap.js';
import { useVimMode } from '../../../contexts/VimModeContext.js';
import type { DialogStore } from '../../../stores/dialog/dialogStore.js';
import type { TerminalStore } from '../../../stores/terminal/terminalStore.js';
import type { SettingsProfileStore } from '../../../stores/settings/settingsStore.js';
import type { TurnStore } from '../../../stores/turn/turnStore.js';
import { useStoreSelector } from '../../../stores/useStoreSelector.js';
import type { UiRuntime } from '../../../cliUiRuntime.js';

export interface AppLayoutParams {
  // From bootstrap
  uiRuntime: UiRuntime;
  settings: AppBootstrapResult['settings'];
  clearConsoleMessagesState: AppBootstrapResult['clearConsoleMessagesState'];
  /**
   * Turn store; the command context gets addItem and the clear-screen action
   * gets clearItems/refreshStatic straight from the store commands (stable
   * references).
   */
  turnStore: TurnStore;

  // From dialogs
  /** Typed DialogStore; dialog-open state is read through narrow selectors. */
  store: DialogStore;
  /** Terminal store; layout reads dimensions/prefs and writes derived sizes. */
  terminalStore: TerminalStore;
  /** Settings/profile store; layout mirrors context readouts into it. */
  settingsStore: SettingsProfileStore;
}

function useLayoutClearScreen(p: AppLayoutParams) {
  const { clearConsoleMessagesState } = p;
  const { clearItems, refreshStatic } = p.turnStore.commands;
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
  return { handleClearScreen };
}

function useLayoutMeasure(p: AppLayoutParams) {
  const consoleMessages = useStoreSelector(
    p.settingsStore.store,
    (s) => s.rawConsoleMessages,
  );
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
  const { uiRuntime, settings, settingsStore, terminalStore } = p;
  const { vimEnabled } = useVimMode();
  const terminalWidth = useStoreSelector(
    terminalStore.store,
    (s) => s.terminalWidth,
  );
  const terminalHeight = useStoreSelector(
    terminalStore.store,
    (s) => s.terminalHeight,
  );
  const consoleMessages = useStoreSelector(
    settingsStore.store,
    (s) => s.rawConsoleMessages,
  );
  const debugMode = uiRuntime.app.getDebugMode();
  const filteredConsoleMessages = useMemo(() => {
    if (debugMode) return consoleMessages;
    return consoleMessages.filter((msg) => msg.type !== 'debug');
  }, [consoleMessages, debugMode]);
  // Store mirrors: the footer renders these from the settings store.
  useEffect(() => {
    settingsStore.commands.setConsoleMessages(filteredConsoleMessages);
  }, [settingsStore, filteredConsoleMessages]);
  const { branchName, isDirty } = useGitBranchInfo(
    uiRuntime.session.getTargetDir(),
  );
  useEffect(() => {
    settingsStore.commands.setBranchInfo(branchName, isDirty);
  }, [settingsStore, branchName, isDirty]);
  const contextFileNames = useMemo(() => {
    const fromSettings = settings.merged.ui.contextFileName;
    if (fromSettings != null && fromSettings !== '')
      return Array.isArray(fromSettings) ? fromSettings : [fromSettings];
    return getAllLlxprtMdFilenames();
  }, [settings.merged.ui.contextFileName]);
  const mainAreaWidth = calculateMainAreaWidth(terminalWidth, settings);
  useEffect(() => {
    terminalStore.commands.setMainAreaWidth(mainAreaWidth);
  }, [terminalStore, mainAreaWidth]);
  const placeholder = usePowerShellPlaceholder({ vimModeEnabled: vimEnabled });
  useEffect(() => {
    terminalStore.commands.setPlaceholder(placeholder);
  }, [terminalStore, placeholder]);
  useEffect(() => {
    uiRuntime.shell.setPtyTerminalSize(mainAreaWidth, terminalHeight);
  }, [uiRuntime, mainAreaWidth, terminalHeight]);
  return { contextFileNames };
}

function useLayoutMeasurementAndFlow(p: AppLayoutParams) {
  const measure = useLayoutMeasure(p);
  const context = useLayoutContext(p);
  return { ...measure, ...context };
}

export function useAppLayout(params: AppLayoutParams) {
  const kb = useLayoutClearScreen(params);
  const measure = useLayoutMeasurementAndFlow(params);
  return { ...kb, ...measure };
}

export type AppLayoutResult = ReturnType<typeof useAppLayout>;
