/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import React from 'react';
import { Box, type DOMElement, Static } from 'ink';
import type { Config } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../config/settings.js';
import type { UpdateObject } from '../utils/updateCheck.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import type { UIActions } from '../contexts/UIActionsContext.js';
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
  hasActiveDialog,
  useLayoutSettings,
  useScrollableContent,
  type MainControlsProps,
  MainControls,
  QuittingDisplay,
} from './DefaultAppLayoutHelpers.js';

interface DefaultAppLayoutProps {
  config: Config;
  settings: LoadedSettings;
  startupWarnings: string[];
  version: string;
  nightly: boolean;
  mainControlsRef: React.RefObject<DOMElement | null>;
  availableTerminalHeight: number;
  contextFileNames: string[];
  updateInfo: UpdateObject | null;
}

function useDerivedState(
  uiState: ReturnType<typeof useUIState>,
  config: Config,
  settings: LoadedSettings,
  availableTerminalHeight: number,
  version: string,
  nightly: boolean,
) {
  const layoutSettings = useLayoutSettings(
    config,
    settings,
    availableTerminalHeight,
    uiState.terminalHeight,
    uiState.constrainHeight,
    uiState.availableTerminalHeight,
    uiState.isNarrow,
  );

  const dialogsVisible = hasActiveDialog(uiState);

  const { listItems, staticItems, pendingItems } = useScrollableContent(
    config,
    settings,
    version,
    nightly,
    uiState.terminalWidth,
    uiState.mainAreaWidth,
    layoutSettings.staticAreaMaxItemHeight,
    uiState.constrainHeight,
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
  config,
  settings,
  startupWarnings,
  version,
  nightly,
  mainControlsRef,
  availableTerminalHeight,
  contextFileNames,
  updateInfo,
}: DefaultAppLayoutProps) => {
  const uiState = useUIState();
  const uiActions = useUIActions();
  const [, setSuggestionsVisible] = React.useState(false);

  const {
    layoutSettings,
    dialogsVisible,
    listItems,
    staticItems,
    pendingItems,
  } = useDerivedState(
    uiState,
    config,
    settings,
    availableTerminalHeight,
    version,
    nightly,
  );

  const mainControlsSharedProps = buildMainControlsProps(
    uiState,
    layoutSettings,
    startupWarnings,
    updateInfo,
    contextFileNames,
    nightly,
    uiActions,
    setSuggestionsVisible,
  );

  if (uiState.quittingMessages) {
    return (
      <QuittingDisplay
        constrainHeight={uiState.constrainHeight}
        effectiveAvailableHeight={layoutSettings.effectiveAvailableHeight}
        terminalWidth={uiState.terminalWidth}
        quittingMessages={uiState.quittingMessages}
        config={config}
        slashCommands={uiState.slashCommands}
        showTodoPanelSetting={layoutSettings.showTodoPanelSetting}
      />
    );
  }

  return renderLayout(
    uiState,
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
          terminalWidth={uiState.terminalWidth}
          terminalHeight={uiState.terminalHeight}
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
        constrainHeight={uiState.constrainHeight}
        mainControlsRef={mainControlsRef}
        mainControlsSharedProps={mainControlsSharedProps}
      />
    </StreamingContext.Provider>
  );
}

function buildMainControlsProps(
  uiState: ReturnType<typeof useUIState>,
  layoutSettings: ReturnType<typeof useLayoutSettings>,
  startupWarnings: string[],
  updateInfo: UpdateObject | null,
  contextFileNames: string[],
  nightly: boolean,
  uiActions: UIActions,
  onSuggestionsVisibilityChange: (visible: boolean) => void,
): MainControlsProps {
  return {
    config: uiState.config,
    settings: uiState.settings,
    startupWarnings,
    updateInfo,
    history: uiState.history,
    inputWidth: uiState.inputWidth,
    isTodoPanelCollapsed: uiState.isTodoPanelCollapsed,
    showTodoPanelSetting: layoutSettings.showTodoPanelSetting,
    dialogsVisible: hasActiveDialog(uiState),
    hideContextSummary: layoutSettings.hideContextSummary,
    hideFooter: layoutSettings.hideFooter,
    showMemoryUsage: layoutSettings.showMemoryUsage,
    currentThemeName: layoutSettings.currentThemeName,
    nightly,
    constrainHeight: uiState.constrainHeight,
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
    showToolDescriptions: uiState.showToolDescriptions,
    showAutoAcceptIndicator: uiState.showAutoAcceptIndicator,
    shellModeActive: uiState.shellModeActive,
    showErrorDetails: uiState.showErrorDetails,
    consoleMessages: uiState.consoleMessages,
    isInputActive: uiState.isInputActive,
    vimModeEnabled: uiState.vimModeEnabled,
    vimMode: uiState.vimMode,
    currentModel: uiState.currentModel,
    contextLimit: uiState.contextLimit,
    branchName: uiState.branchName,
    debugMessage: uiState.debugMessage,
    errorCount: uiState.errorCount,
    historyTokenCount: uiState.historyTokenCount,
    tokenMetrics: uiState.tokenMetrics,
    uiActions,
    terminalWidth: uiState.terminalWidth,
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
      <Static key={staticKey} items={staticItems}>
        {(item) => item}
      </Static>
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
