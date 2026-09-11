/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, type DOMElement, Static } from 'ink';

import type { LoadedSettings } from '../../config/settings.js';
import type { UpdateObject } from '../utils/updateCheck.js';
import { useTerminalStore } from '../stores/terminal/TerminalContext.js';
import { useTurnStore } from '../stores/turn/TurnContext.js';
import { useSettingsProfileStore } from '../stores/settings/SettingsContext.js';
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
  /** Root ink node; owned by the layout measurement hook. */
  rootUiRef: React.RefObject<DOMElement | null>;
  /** Pending-history wrapper node; owned by the layout measurement hook. */
  pendingHistoryItemRef: React.RefObject<DOMElement | null>;
  contextFileNames: string[];
  updateInfo: UpdateObject | null;
}

/** Terminal-plane values the layout root consumes. Each field is a separate
 * primitive selector so unrelated store writes (e.g. focus flips during
 * streaming) do not rerender the layout. */
function useTerminalLayoutState() {
  return { ...useTerminalDimensions(), ...useTerminalUiFlags() };
}

/** Geometry selectors: widths, heights and the narrow/constrained flags. */
function useTerminalDimensions() {
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
  return {
    terminalWidth,
    terminalHeight,
    mainAreaWidth,
    inputWidth,
    isNarrow,
    constrainHeight,
    availableTerminalHeight,
  };
}

/** Mode/visibility selectors: dialogs, shell focus and panel collapse. */
function useTerminalUiFlags() {
  const { store } = useTerminalStore();
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
  const shellModeActive = useStoreSelector(
    store,
    (s: TerminalState) => s.shellModeActive,
  );
  const showEscapePrompt = useStoreSelector(
    store,
    (s: TerminalState) => s.showEscapePrompt,
  );
  const activeShellPtyId = useStoreSelector(
    store,
    (s: TerminalState) => s.activeShellPtyId,
  );
  const embeddedShellFocused = useStoreSelector(
    store,
    (s: TerminalState) => s.embeddedShellFocused,
  );
  const isTodoPanelCollapsed = useStoreSelector(
    store,
    (s: TerminalState) => s.isTodoPanelCollapsed,
  );
  const isQueuedMessagesPanelCollapsed = useStoreSelector(
    store,
    (s: TerminalState) => s.isQueuedMessagesPanelCollapsed,
  );
  return {
    showErrorDetails,
    showToolDescriptions,
    isInputActive,
    shellModeActive,
    showEscapePrompt,
    activeShellPtyId,
    embeddedShellFocused,
    isTodoPanelCollapsed,
    isQueuedMessagesPanelCollapsed,
  };
}

/** Committed/streamed turn data the layout renders. */
function useTurnLayoutState() {
  const { store } = useTurnStore();
  const history = useStoreSelector(store, (s) => s.history);
  const pendingHistoryItems = useStoreSelector(
    store,
    (s) => s.pendingHistoryItems,
  );
  const streamingState = useStoreSelector(store, (s) => s.streamingState);
  const thought = useStoreSelector(store, (s) => s.thought);
  const staticKey = useStoreSelector(store, (s) => s.staticKey);
  const quittingMessages = useStoreSelector(store, (s) => s.quittingMessages);
  const ctrlCPressedOnce = useStoreSelector(store, (s) => s.ctrlCPressedOnce);
  const ctrlDPressedOnce = useStoreSelector(store, (s) => s.ctrlDPressedOnce);
  const queuedSubmissions = useStoreSelector(store, (s) => s.queuedSubmissions);
  const currentLoadingPhrase = useStoreSelector(
    store,
    (s) => s.currentLoadingPhrase,
  );
  const elapsedTime = useStoreSelector(store, (s) => s.elapsedTime);
  return {
    history,
    pendingHistoryItems,
    streamingState,
    thought,
    staticKey,
    quittingMessages,
    ctrlCPressedOnce,
    ctrlDPressedOnce,
    queuedSubmissions,
    currentLoadingPhrase,
    elapsedTime,
  };
}

/** Settings/profile projections the layout and footer render. */
function useSettingsLayoutState() {
  const { store } = useSettingsProfileStore();
  const slashCommands = useStoreSelector(store, (s) => s.slashCommands);
  const ideContextState = useStoreSelector(store, (s) => s.ideContextState);
  const llxprtMdFileCount = useStoreSelector(store, (s) => s.llxprtMdFileCount);
  const coreMemoryFileCount = useStoreSelector(
    store,
    (s) => s.coreMemoryFileCount,
  );
  const consoleMessages = useStoreSelector(store, (s) => s.consoleMessages);
  const showAutoAcceptIndicator = useStoreSelector(
    store,
    (s) => s.showAutoAcceptIndicator,
  );
  const branchName = useStoreSelector(store, (s) => s.branchName);
  const branchIsDirty = useStoreSelector(store, (s) => s.branchIsDirty);
  const debugMessage = useStoreSelector(store, (s) => s.debugMessage);
  const errorCount = useStoreSelector(store, (s) => s.errorCount);
  const currentModel = useStoreSelector(store, (s) => s.currentModel);
  const currentModelLabel = useStoreSelector(store, (s) => s.currentModelLabel);
  const contextLimit = useStoreSelector(store, (s) => s.contextLimit);
  const tokenMetrics = useStoreSelector(store, (s) => s.tokenMetrics);
  const historyTokenCount = useStoreSelector(store, (s) => s.historyTokenCount);
  return {
    slashCommands,
    ideContextState,
    llxprtMdFileCount,
    coreMemoryFileCount,
    consoleMessages,
    showAutoAcceptIndicator,
    branchName,
    branchIsDirty,
    debugMessage,
    errorCount,
    currentModel,
    currentModelLabel,
    contextLimit,
    tokenMetrics,
    historyTokenCount,
  };
}

function useDerivedState(
  uiRuntime: UiRuntime,
  slashCommandRuntime: SlashCommandRuntime,
  settings: LoadedSettings,
  terminal: ReturnType<typeof useTerminalLayoutState>,
  turn: ReturnType<typeof useTurnLayoutState>,
  settingsData: ReturnType<typeof useSettingsLayoutState>,
  pendingHistoryItemRef: React.RefObject<DOMElement | null>,
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
    turn.history,
    turn.pendingHistoryItems,
    pendingHistoryItemRef,
    settingsData.slashCommands,
    terminal.activeShellPtyId,
    terminal.embeddedShellFocused,
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
  rootUiRef,
  pendingHistoryItemRef,
  contextFileNames,
  updateInfo,
}: DefaultAppLayoutProps) => {
  const terminal = useTerminalLayoutState();
  const turn = useTurnLayoutState();
  const settingsData = useSettingsLayoutState();
  const [, setSuggestionsVisible] = React.useState(false);

  const {
    layoutSettings,
    dialogsVisible,
    listItems,
    staticItems,
    pendingItems,
  } = useDerivedState(
    uiRuntime,
    slashCommandRuntime,
    settings,
    terminal,
    turn,
    settingsData,
    pendingHistoryItemRef,
    version,
    nightly,
  );

  const mainControlsSharedProps = buildMainControlsProps({
    terminal,
    turn,
    settingsData,
    layoutSettings,
    slashCommandRuntime,
    settings,
    startupWarnings,
    updateInfo,
    contextFileNames,
    nightly,
    setSuggestionsVisible,
    dialogsVisible,
  });

  if (turn.quittingMessages) {
    return (
      <QuittingDisplay
        constrainHeight={terminal.constrainHeight}
        effectiveAvailableHeight={layoutSettings.effectiveAvailableHeight}
        terminalWidth={terminal.terminalWidth}
        quittingMessages={turn.quittingMessages}
        config={slashCommandRuntime}
        slashCommands={settingsData.slashCommands}
        showTodoPanelSetting={layoutSettings.showTodoPanelSetting}
      />
    );
  }

  return renderLayout({
    turn,
    terminal,
    layoutSettings,
    dialogsVisible,
    listItems,
    staticItems,
    pendingItems,
    rootUiRef,
    pendingHistoryItemRef,
    mainControlsRef,
    mainControlsSharedProps,
  });
};

interface RenderLayoutArgs {
  turn: ReturnType<typeof useTurnLayoutState>;
  terminal: ReturnType<typeof useTerminalLayoutState>;
  layoutSettings: ReturnType<typeof useLayoutSettings>;
  dialogsVisible: boolean;
  listItems: ScrollableMainContentItem[];
  staticItems: React.ReactElement[];
  pendingItems: React.ReactElement[];
  rootUiRef: React.RefObject<DOMElement | null>;
  pendingHistoryItemRef: React.RefObject<DOMElement | null>;
  mainControlsRef: React.RefObject<DOMElement | null>;
  mainControlsSharedProps: MainControlsProps;
}

function renderLayout(args: RenderLayoutArgs) {
  const {
    turn,
    terminal,
    layoutSettings,
    dialogsVisible,
    listItems,
    staticItems,
    pendingItems,
    rootUiRef,
    pendingHistoryItemRef,
    mainControlsRef,
    mainControlsSharedProps,
  } = args;
  if (layoutSettings.useAlternateBuffer) {
    return (
      <StreamingContext.Provider value={turn.streamingState}>
        <AlternateBufferLayout
          terminalWidth={terminal.terminalWidth}
          terminalHeight={terminal.terminalHeight}
          rootUiRef={rootUiRef}
          dialogsVisible={dialogsVisible}
          listItems={listItems}
          mainControlsRef={mainControlsRef}
          mainControlsSharedProps={mainControlsSharedProps}
        />
      </StreamingContext.Provider>
    );
  }

  return (
    <StreamingContext.Provider value={turn.streamingState}>
      <StandardBufferLayout
        rootUiRef={rootUiRef}
        staticKey={turn.staticKey}
        staticItems={staticItems}
        pendingHistoryItemRef={pendingHistoryItemRef}
        pendingItems={pendingItems}
        constrainHeight={terminal.constrainHeight}
        mainControlsRef={mainControlsRef}
        mainControlsSharedProps={mainControlsSharedProps}
      />
    </StreamingContext.Provider>
  );
}

interface BuildMainControlsArgs {
  terminal: ReturnType<typeof useTerminalLayoutState>;
  turn: ReturnType<typeof useTurnLayoutState>;
  settingsData: ReturnType<typeof useSettingsLayoutState>;
  layoutSettings: ReturnType<typeof useLayoutSettings>;
  slashCommandRuntime: SlashCommandRuntime;
  settings: LoadedSettings;
  startupWarnings: string[];
  updateInfo: UpdateObject | null;
  contextFileNames: string[];
  nightly: boolean;
  setSuggestionsVisible: (visible: boolean) => void;
  dialogsVisible: boolean;
}

function buildMainControlsProps(
  args: BuildMainControlsArgs,
): MainControlsProps {
  const {
    terminal,
    turn,
    settingsData,
    layoutSettings,
    slashCommandRuntime,
    settings,
    startupWarnings,
    updateInfo,
    contextFileNames,
    nightly,
    setSuggestionsVisible,
    dialogsVisible,
  } = args;
  return {
    config: slashCommandRuntime,
    settings,
    startupWarnings,
    updateInfo,
    history: turn.history,
    inputWidth: terminal.inputWidth,
    isTodoPanelCollapsed: terminal.isTodoPanelCollapsed,
    isQueuedMessagesPanelCollapsed: terminal.isQueuedMessagesPanelCollapsed,
    queuedSubmissions: turn.queuedSubmissions,
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
    streamingState: turn.streamingState,
    thought: turn.thought,
    currentLoadingPhrase: turn.currentLoadingPhrase,
    elapsedTime: turn.elapsedTime,
    isNarrow: layoutSettings.isNarrow,
    ctrlCPressedOnce: turn.ctrlCPressedOnce,
    ctrlDPressedOnce: turn.ctrlDPressedOnce,
    showEscapePrompt: terminal.showEscapePrompt,
    ideContextState: settingsData.ideContextState,
    llxprtMdFileCount: settingsData.llxprtMdFileCount,
    coreMemoryFileCount: settingsData.coreMemoryFileCount,
    contextFileNames,
    showToolDescriptions: terminal.showToolDescriptions,
    showAutoAcceptIndicator: settingsData.showAutoAcceptIndicator,
    shellModeActive: terminal.shellModeActive,
    showErrorDetails: terminal.showErrorDetails,
    consoleMessages: settingsData.consoleMessages,
    isInputActive: terminal.isInputActive,
    debugMessage: settingsData.debugMessage,
    errorCount: settingsData.errorCount,
    currentModel: settingsData.currentModel,
    currentModelLabel: settingsData.currentModelLabel,
    contextLimit: settingsData.contextLimit,
    branchName: settingsData.branchName,
    branchIsDirty: settingsData.branchIsDirty,
    historyTokenCount: settingsData.historyTokenCount,
    tokenMetrics: settingsData.tokenMetrics,
    onSuggestionsVisibilityChange: setSuggestionsVisible,
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
