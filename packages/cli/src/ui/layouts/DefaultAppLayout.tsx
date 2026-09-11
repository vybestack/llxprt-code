/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, type DOMElement, Static } from 'ink';

import type { LoadedSettings } from '../../config/settings.js';
import type { UpdateObject } from '../utils/updateCheck.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import type { UIActions } from '../contexts/UIActionsContext.js';
import { useTerminalStore } from '../stores/terminal/TerminalContext.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';
import type { TerminalState } from '../stores/terminal/terminalStore.js';
import { StreamingContext } from '../contexts/StreamingContext.js';
import { OverflowProvider } from '../contexts/OverflowContext.js';
import { ShowMoreLines } from '../components/ShowMoreLines.js';
import { ScrollableList } from '../components/shared/ScrollableList.js';
import { SCROLL_TO_ITEM_END } from '../components/shared/VirtualizedList.js';
import {
  type ScrollableMainContentItem,
  renderScrollableMainContentItem,
  keyExtractorScrollableMainContentItem,
  estimateScrollableMainContentItemHeight,
  useHasActiveDialog,
  useLayoutSettings,
  useScrollableContent,
  type MainControlsProps,
  MainControls,
  QuittingDisplay,
} from './DefaultAppLayoutHelpers.js';
import type { SlashCommandRuntime, UiRuntime } from '../cliUiRuntime.js';

interface DefaultAppLayoutProps {
  uiRuntime: UiRuntime;
  slashCommandRuntime: SlashCommandRuntime;
  settings: LoadedSettings;
  startupWarnings: string[];
  version: string;
  nightly: boolean;
  mainControlsRef: React.RefObject<DOMElement | null>;
  contextFileNames: string[];
  updateInfo: UpdateObject | null;
}

/**
 * Terminal-plane values the layout root consumes. Each field is a separate
 * primitive selector so unrelated store writes (e.g. focus flips during
 * streaming) do not rerender the layout.
 */
function useTerminalLayoutState() {
  const { store } = useTerminalStore();
  const terminalWidth = useStoreSelector(
    store,
    (s: TerminalState) => s.terminalWidth,
  );
  const terminalHeight = useStoreSelector(
    store,
    (s: TerminalState) => s.terminalHeight,
  );
  const mainAreaWidth = useStoreSelector(
    store,
    (s: TerminalState) => s.mainAreaWidth,
  );
  const inputWidth = useStoreSelector(
    store,
    (s: TerminalState) => s.inputWidth,
  );
  const isNarrow = useStoreSelector(store, (s: TerminalState) => s.isNarrow);
  const constrainHeight = useStoreSelector(
    store,
    (s: TerminalState) => s.constrainHeight,
  );
  const availableTerminalHeight = useStoreSelector(
    store,
    (s: TerminalState) => s.availableTerminalHeight,
  );
  const showErrorDetails = useStoreSelector(
    store,
    (s: TerminalState) => s.showErrorDetails,
  );
  const showToolDescriptions = useStoreSelector(
    store,
    (s: TerminalState) => s.showToolDescriptions,
  );
  const isInputActive = useStoreSelector(
    store,
    (s: TerminalState) => s.isInputActive,
  );
  return {
    terminalWidth,
    terminalHeight,
    mainAreaWidth,
    inputWidth,
    isNarrow,
    constrainHeight,
    availableTerminalHeight,
    showErrorDetails,
    showToolDescriptions,
    isInputActive,
  };
}

function useDerivedState(
  uiState: ReturnType<typeof useUIState>,
  uiRuntime: UiRuntime,
  slashCommandRuntime: SlashCommandRuntime,
  settings: LoadedSettings,
  terminal: ReturnType<typeof useTerminalLayoutState>,
  version: string,
  nightly: boolean,
) {
  const layoutSettings = useLayoutSettings(
    uiRuntime,
    settings,
    terminal.availableTerminalHeight,
    terminal.terminalHeight,
    terminal.constrainHeight,
    terminal.availableTerminalHeight,
    terminal.isNarrow,
  );

  const dialogsVisible = useHasActiveDialog();

  const { listItems, staticItems, pendingItems } = useScrollableContent(
    slashCommandRuntime,
    settings,
    version,
    nightly,
    terminal.terminalWidth,
    terminal.mainAreaWidth,
    layoutSettings.staticAreaMaxItemHeight,
    terminal.constrainHeight,
    layoutSettings.effectiveAvailableHeight,
    layoutSettings.showTodoPanelSetting,
    uiState,
    uiState.slashCommands,
    uiState.activeShellPtyId,
    uiState.embeddedShellFocused,
  );

  return {
    layoutSettings,
    dialogsVisible,
    listItems,
    staticItems,
    pendingItems,
  };
}

export const DefaultAppLayout = ({
  uiRuntime,
  slashCommandRuntime,
  settings,
  startupWarnings,
  version,
  nightly,
  mainControlsRef,
  contextFileNames,
  updateInfo,
}: DefaultAppLayoutProps) => {
  const uiState = useUIState();
  const uiActions = useUIActions();
  const terminal = useTerminalLayoutState();
  const [, setSuggestionsVisible] = React.useState(false);

  const {
    layoutSettings,
    dialogsVisible,
    listItems,
    staticItems,
    pendingItems,
  } = useDerivedState(
    uiState,
    uiRuntime,
    slashCommandRuntime,
    settings,
    terminal,
    version,
    nightly,
  );

  const mainControlsSharedProps = buildMainControlsProps(
    uiState,
    terminal,
    layoutSettings,
    slashCommandRuntime,
    settings,
    startupWarnings,
    updateInfo,
    contextFileNames,
    nightly,
    uiActions,
    setSuggestionsVisible,
    dialogsVisible,
  );

  if (uiState.quittingMessages) {
    return (
      <QuittingDisplay
        constrainHeight={terminal.constrainHeight}
        effectiveAvailableHeight={layoutSettings.effectiveAvailableHeight}
        terminalWidth={terminal.terminalWidth}
        quittingMessages={uiState.quittingMessages}
        config={slashCommandRuntime}
        slashCommands={uiState.slashCommands}
        showTodoPanelSetting={layoutSettings.showTodoPanelSetting}
      />
    );
  }

  return renderLayout(
    uiState,
    terminal,
    layoutSettings,
    dialogsVisible,
    listItems,
    staticItems,
    pendingItems,
    mainControlsRef,
    mainControlsSharedProps,
  );
};

function renderLayout(
  uiState: ReturnType<typeof useUIState>,
  terminal: ReturnType<typeof useTerminalLayoutState>,
  layoutSettings: ReturnType<typeof useLayoutSettings>,
  dialogsVisible: boolean,
  listItems: ScrollableMainContentItem[],
  staticItems: React.ReactElement[],
  pendingItems: React.ReactElement[],
  mainControlsRef: React.RefObject<DOMElement | null>,
  mainControlsSharedProps: MainControlsProps,
) {
  if (layoutSettings.useAlternateBuffer) {
    return (
      <StreamingContext.Provider value={uiState.streamingState}>
        <AlternateBufferLayout
          terminalWidth={terminal.terminalWidth}
          terminalHeight={terminal.terminalHeight}
          rootUiRef={uiState.rootUiRef}
          dialogsVisible={dialogsVisible}
          listItems={listItems}
          mainControlsRef={mainControlsRef}
          mainControlsSharedProps={mainControlsSharedProps}
        />
      </StreamingContext.Provider>
    );
  }

  return (
    <StreamingContext.Provider value={uiState.streamingState}>
      <StandardBufferLayout
        rootUiRef={uiState.rootUiRef}
        staticKey={uiState.staticKey}
        staticItems={staticItems}
        pendingHistoryItemRef={uiState.pendingHistoryItemRef}
        pendingItems={pendingItems}
        constrainHeight={terminal.constrainHeight}
        mainControlsRef={mainControlsRef}
        mainControlsSharedProps={mainControlsSharedProps}
      />
    </StreamingContext.Provider>
  );
}

function buildMainControlsProps(
  uiState: ReturnType<typeof useUIState>,
  terminal: ReturnType<typeof useTerminalLayoutState>,
  layoutSettings: ReturnType<typeof useLayoutSettings>,
  slashCommandRuntime: SlashCommandRuntime,
  settings: LoadedSettings,
  startupWarnings: string[],
  updateInfo: UpdateObject | null,
  contextFileNames: string[],
  nightly: boolean,
  uiActions: UIActions,
  onSuggestionsVisibilityChange: (visible: boolean) => void,
  dialogsVisible: boolean,
): MainControlsProps {
  return {
    config: slashCommandRuntime,
    settings,
    startupWarnings,
    updateInfo,
    history: uiState.history,
    inputWidth: terminal.inputWidth,
    isTodoPanelCollapsed: uiState.isTodoPanelCollapsed,
    isQueuedMessagesPanelCollapsed: uiState.isQueuedMessagesPanelCollapsed,
    queuedSubmissions: uiState.queuedSubmissions,
    showTodoPanelSetting: layoutSettings.showTodoPanelSetting,
    dialogsVisible,
    hideContextSummary: layoutSettings.hideContextSummary,
    hideFooter: layoutSettings.hideFooter,
    showMemoryUsage: layoutSettings.showMemoryUsage,
    currentThemeName: layoutSettings.currentThemeName,
    nightly,
    constrainHeight: terminal.constrainHeight,
    debugConsoleMaxHeight: layoutSettings.debugConsoleMaxHeight,
    effectiveAvailableHeight: layoutSettings.effectiveAvailableHeight,
    disableLoadingPhrases: layoutSettings.disableLoadingPhrases,
    streamingState: uiState.streamingState,
    thought: uiState.thought,
    currentLoadingPhrase: uiState.currentLoadingPhrase,
    elapsedTime: uiState.elapsedTime,
    isNarrow: layoutSettings.isNarrow,
    ctrlCPressedOnce: uiState.ctrlCPressedOnce,
    ctrlDPressedOnce: uiState.ctrlDPressedOnce,
    showEscapePrompt: uiState.showEscapePrompt,
    ideContextState: uiState.ideContextState,
    llxprtMdFileCount: uiState.llxprtMdFileCount,
    coreMemoryFileCount: uiState.coreMemoryFileCount,
    contextFileNames,
    showToolDescriptions: terminal.showToolDescriptions,
    showAutoAcceptIndicator: uiState.showAutoAcceptIndicator,
    shellModeActive: uiState.shellModeActive,
    showErrorDetails: terminal.showErrorDetails,
    consoleMessages: uiState.consoleMessages,
    isInputActive: terminal.isInputActive,
    vimModeEnabled: uiState.vimModeEnabled,
    vimMode: uiState.vimMode,
    currentModel: uiState.currentModel,
    currentModelLabel: uiState.currentModelLabel,
    contextLimit: uiState.contextLimit,
    branchName: uiState.branchName,
    branchIsDirty: uiState.branchIsDirty,
    debugMessage: uiState.debugMessage,
    errorCount: uiState.errorCount,
    historyTokenCount: uiState.historyTokenCount,
    tokenMetrics: uiState.tokenMetrics,
    uiActions,
    onSuggestionsVisibilityChange,
  };
}

function AlternateBufferLayout({
  terminalWidth,
  terminalHeight,
  rootUiRef,
  dialogsVisible,
  listItems,
  mainControlsRef,
  mainControlsSharedProps,
}: {
  terminalWidth: number;
  terminalHeight: number;
  rootUiRef: React.RefObject<DOMElement | null>;
  dialogsVisible: boolean;
  listItems: ScrollableMainContentItem[];
  mainControlsRef: React.RefObject<DOMElement | null>;
  mainControlsSharedProps: MainControlsProps;
}) {
  return (
    <Box
      flexDirection="column"
      width={terminalWidth}
      height={terminalHeight}
      flexShrink={0}
      flexGrow={0}
      overflow="hidden"
      ref={rootUiRef}
    >
      <ScrollableList
        hasFocus={!dialogsVisible}
        data={listItems}
        renderItem={renderScrollableMainContentItem}
        keyExtractor={keyExtractorScrollableMainContentItem}
        estimatedItemHeight={estimateScrollableMainContentItemHeight}
        initialScrollIndex={SCROLL_TO_ITEM_END}
        initialScrollOffsetInIndex={SCROLL_TO_ITEM_END}
      />

      <Box
        flexDirection="column"
        ref={mainControlsRef}
        flexShrink={0}
        flexGrow={0}
      >
        <MainControls {...mainControlsSharedProps} />
      </Box>
    </Box>
  );
}

function StandardBufferLayout({
  rootUiRef,
  staticKey,
  staticItems,
  pendingHistoryItemRef,
  pendingItems,
  constrainHeight,
  mainControlsRef,
  mainControlsSharedProps,
}: {
  rootUiRef: React.RefObject<DOMElement | null>;
  staticKey: number;
  staticItems: React.ReactElement[];
  pendingHistoryItemRef: React.RefObject<DOMElement | null>;
  pendingItems: React.ReactElement[];
  constrainHeight: boolean;
  mainControlsRef: React.RefObject<DOMElement | null>;
  mainControlsSharedProps: MainControlsProps;
}) {
  return (
    <Box flexDirection="column" width="90%" ref={rootUiRef}>
      {staticItems.length > 0 ? (
        <Static key={staticKey} items={staticItems}>
          {(item) => item}
        </Static>
      ) : null}
      <OverflowProvider>
        <Box ref={pendingHistoryItemRef} flexDirection="column">
          {pendingItems}
          <ShowMoreLines constrainHeight={constrainHeight} />
        </Box>
      </OverflowProvider>

      <Box flexDirection="column" ref={mainControlsRef}>
        <MainControls {...mainControlsSharedProps} />
      </Box>
    </Box>
  );
}
