/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, type DOMElement } from 'ink';
import type { HistoryItem, HistoryItemWithoutId } from '../types.js';
import type { SlashCommandRuntime } from '../cliUiRuntime.js';
import type { LoadedSettings } from '../../config/settings.js';
import { OverflowProvider } from '../contexts/OverflowContext.js';
import type { SlashCommand } from '../commands/types.js';
import { useDialogStore } from '../stores/dialog/DialogContext.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';
import type { DialogState } from '../stores/dialog/dialogStore.js';

import { AppHeader } from '../components/AppHeader.js';
import { HistoryItemDisplay } from '../components/HistoryItemDisplay.js';
import { ShowMoreLines } from '../components/ShowMoreLines.js';
import { Footer } from '../components/Footer.js';

export type { ScrollableMainContentItem } from './scrollableMainContent.js';
export {
  renderScrollableMainContentItem,
  keyExtractorScrollableMainContentItem,
  estimateScrollableMainContentItemHeight,
} from './scrollableMainContent.js';
import type { ScrollableMainContentItem } from './scrollableMainContent.js';

/**
 * True when any dialog currently owns the input surface. All dialog kinds
 * live in the DialogStore, so this is purely a store read.
 */
function hasOpenDialog(state: DialogState): boolean {
  return (
    state.requests.length > 0 ||
    state.confirmationRequest !== null ||
    state.confirmUpdateLlxprtExtensionRequests.length > 0
  );
}

export function useHasActiveDialog(): boolean {
  const store = useDialogStore();
  return useStoreSelector(store.store, hasOpenDialog);
}

function useHistoryItemDisplayProps(
  config: SlashCommandRuntime,
  mainAreaWidth: number,
  showTodoPanelSetting: boolean,
  slashCommands: readonly SlashCommand[] | undefined,
  activeShellPtyId: number | null,
  embeddedShellFocused: boolean,
) {
  return {
    terminalWidth: mainAreaWidth,
    config,
    slashCommands,
    showTodoPanel: showTodoPanelSetting,
    activeShellPtyId,
    embeddedShellFocused,
  };
}

export function useListItems(
  headerElement: React.ReactElement,
  pendingElement: React.ReactElement,
  history: HistoryItem[],
  config: SlashCommandRuntime,
  mainAreaWidth: number,
  staticAreaMaxItemHeight: number,
  slashCommands: readonly SlashCommand[] | undefined,
  showTodoPanelSetting: boolean,
  activeShellPtyId: number | null,
  embeddedShellFocused: boolean,
): ScrollableMainContentItem[] {
  const base = useHistoryItemDisplayProps(
    config,
    mainAreaWidth,
    showTodoPanelSetting,
    slashCommands,
    activeShellPtyId,
    embeddedShellFocused,
  );

  return React.useMemo(
    () => [
      {
        key: 'header',
        estimatedHeight: 100,
        element: <Box flexDirection="column">{headerElement}</Box>,
      },
      ...history.map((h) => ({
        key: `history-${h.id}`,
        estimatedHeight: 100,
        element: (
          <HistoryItemDisplay
            {...base}
            availableTerminalHeight={staticAreaMaxItemHeight}
            item={h}
            isPending={false}
          />
        ),
      })),
      {
        key: 'pending',
        estimatedHeight: 100,
        element: pendingElement,
      },
    ],
    [headerElement, history, base, staticAreaMaxItemHeight, pendingElement],
  );
}

export function useStaticItems(
  config: SlashCommandRuntime,
  settings: LoadedSettings,
  version: string,
  nightly: boolean,
  terminalWidth: number,
  history: HistoryItem[],
  mainAreaWidth: number,
  staticAreaMaxItemHeight: number,
  slashCommands: readonly SlashCommand[] | undefined,
  showTodoPanelSetting: boolean,
  activeShellPtyId: number | null,
  embeddedShellFocused: boolean,
): React.ReactElement[] {
  const base = useHistoryItemDisplayProps(
    config,
    mainAreaWidth,
    showTodoPanelSetting,
    slashCommands,
    activeShellPtyId,
    embeddedShellFocused,
  );

  return React.useMemo(() => {
    if (process.env.LLXPRT_CODE_SUPPRESS_STATIC_HEADER === 'true') {
      return history.map((h) => (
        <HistoryItemDisplay
          {...base}
          key={h.id}
          availableTerminalHeight={staticAreaMaxItemHeight}
          item={h}
          isPending={false}
        />
      ));
    }

    return [
      <AppHeader
        key="header"
        config={config}
        settings={settings}
        version={version}
        nightly={nightly}
        terminalWidth={terminalWidth}
      />,
      ...history.map((h) => (
        <HistoryItemDisplay
          {...base}
          key={h.id}
          availableTerminalHeight={staticAreaMaxItemHeight}
          item={h}
          isPending={false}
        />
      )),
    ];
  }, [
    config,
    settings,
    version,
    nightly,
    terminalWidth,
    history,
    base,
    staticAreaMaxItemHeight,
  ]);
}

export function usePendingItems(
  pendingHistoryItems: HistoryItemWithoutId[],
  pendingHistoryItemRef: React.RefObject<DOMElement | null>,
  config: SlashCommandRuntime,
  mainAreaWidth: number,
  constrainHeight: boolean,
  effectiveAvailableHeight: number,
  slashCommands: readonly SlashCommand[] | undefined,
  showTodoPanelSetting: boolean,
  activeShellPtyId: number | null,
  embeddedShellFocused: boolean,
): React.ReactElement[] {
  const base = useHistoryItemDisplayProps(
    config,
    mainAreaWidth,
    showTodoPanelSetting,
    slashCommands,
    activeShellPtyId,
    embeddedShellFocused,
  );
  const dialogStore = useDialogStore();
  const editorDialogOpen = useStoreSelector(
    dialogStore.store,
    (state: DialogState) => state.requests.some((r) => r.kind === 'editor'),
  );

  return React.useMemo(
    () =>
      pendingHistoryItems.map((item, i) => (
        <HistoryItemDisplay
          key={i}
          {...base}
          availableTerminalHeight={
            constrainHeight ? effectiveAvailableHeight : undefined
          }
          item={{ ...item, id: 0 }}
          isPending={true}
          isFocused={!editorDialogOpen}
        />
      )),
    [
      pendingHistoryItems,
      base,
      constrainHeight,
      effectiveAvailableHeight,
      editorDialogOpen,
    ],
  );
}

export function usePendingElement(
  pendingHistoryItems: HistoryItemWithoutId[],
  pendingHistoryItemRef: React.RefObject<DOMElement | null>,
  config: SlashCommandRuntime,
  mainAreaWidth: number,
  constrainHeight: boolean,
  effectiveAvailableHeight: number,
  slashCommands: readonly SlashCommand[] | undefined,
  showTodoPanelSetting: boolean,
  activeShellPtyId: number | null,
  embeddedShellFocused: boolean,
): React.ReactElement {
  const pendingItems = usePendingItems(
    pendingHistoryItems,
    pendingHistoryItemRef,
    config,
    mainAreaWidth,
    constrainHeight,
    effectiveAvailableHeight,
    slashCommands,
    showTodoPanelSetting,
    activeShellPtyId,
    embeddedShellFocused,
  );

  return React.useMemo(
    () => (
      <OverflowProvider>
        <Box ref={pendingHistoryItemRef} flexDirection="column">
          {pendingItems}
          <ShowMoreLines constrainHeight={constrainHeight} />
        </Box>
      </OverflowProvider>
    ),
    [pendingHistoryItemRef, pendingItems, constrainHeight],
  );
}

/**
 * Center column of the scrollable layout: app header, pending overlay and
 * the virtualized list built from them.
 */
function useScrollableCenterItems(
  config: SlashCommandRuntime,
  settings: LoadedSettings,
  version: string,
  nightly: boolean,
  terminalWidth: number,
  mainAreaWidth: number,
  staticAreaMaxItemHeight: number,
  constrainHeight: boolean,
  effectiveAvailableHeight: number,
  showTodoPanelSetting: boolean,
  history: HistoryItem[],
  pendingHistoryItems: HistoryItemWithoutId[],
  pendingHistoryItemRef: React.RefObject<DOMElement | null>,
  slashCommands: readonly SlashCommand[] | undefined,
  activeShellPtyId: number | null,
  embeddedShellFocused: boolean,
) {
  const headerElement = React.useMemo(
    () => (
      <AppHeader
        config={config}
        settings={settings}
        version={version}
        nightly={nightly}
        terminalWidth={terminalWidth}
      />
    ),
    [config, settings, version, nightly, terminalWidth],
  );

  const pendingElement = usePendingElement(
    pendingHistoryItems,
    pendingHistoryItemRef,
    config,
    mainAreaWidth,
    constrainHeight,
    effectiveAvailableHeight,
    slashCommands,
    showTodoPanelSetting,
    activeShellPtyId,
    embeddedShellFocused,
  );

  return useListItems(
    headerElement,
    pendingElement,
    history,
    config,
    mainAreaWidth,
    staticAreaMaxItemHeight,
    slashCommands,
    showTodoPanelSetting,
    activeShellPtyId,
    embeddedShellFocused,
  );
}

export function useScrollableContent(
  config: SlashCommandRuntime,
  settings: LoadedSettings,
  version: string,
  nightly: boolean,
  terminalWidth: number,
  mainAreaWidth: number,
  staticAreaMaxItemHeight: number,
  constrainHeight: boolean,
  effectiveAvailableHeight: number,
  showTodoPanelSetting: boolean,
  history: HistoryItem[],
  pendingHistoryItems: HistoryItemWithoutId[],
  pendingHistoryItemRef: React.RefObject<DOMElement | null>,
  slashCommands: readonly SlashCommand[] | undefined,
  activeShellPtyId: number | null,
  embeddedShellFocused: boolean,
) {
  const listItems = useScrollableCenterItems(
    config,
    settings,
    version,
    nightly,
    terminalWidth,
    mainAreaWidth,
    staticAreaMaxItemHeight,
    constrainHeight,
    effectiveAvailableHeight,
    showTodoPanelSetting,
    history,
    pendingHistoryItems,
    pendingHistoryItemRef,
    slashCommands,
    activeShellPtyId,
    embeddedShellFocused,
  );

  const staticItems = useStaticItems(
    config,
    settings,
    version,
    nightly,
    terminalWidth,
    history,
    mainAreaWidth,
    staticAreaMaxItemHeight,
    slashCommands,
    showTodoPanelSetting,
    activeShellPtyId,
    embeddedShellFocused,
  );

  const pendingItems = usePendingItems(
    pendingHistoryItems,
    pendingHistoryItemRef,
    config,
    mainAreaWidth,
    constrainHeight,
    effectiveAvailableHeight,
    slashCommands,
    showTodoPanelSetting,
    activeShellPtyId,
    embeddedShellFocused,
  );

  return { listItems, staticItems, pendingItems };
}

export interface FooterProps {
  isTrustedFolder: boolean;
  config: SlashCommandRuntime;
  settings: LoadedSettings;
  hideFooter: boolean;
  showMemoryUsage: boolean;
  currentThemeName: string;
  nightly: boolean;
  vimModeEnabled: boolean;
  vimMode: string | undefined;
  currentModel: string;
  currentModelLabel?: string;
  contextLimit: number | undefined;
  branchName: string | undefined;
  branchIsDirty: boolean;
  debugMessage: string;
  errorCount: number;
  showErrorDetails: boolean;
  historyTokenCount: number;
  tokenMetrics: {
    tokensPerMinute: number;
    throttleWaitTimeMs: number;
    sessionTokenTotal: number;
  };
}

export function FooterSection(props: FooterProps) {
  const {
    config,
    settings,
    hideFooter,
    showMemoryUsage,
    currentThemeName,
    nightly,
    vimModeEnabled,
    vimMode,
    currentModel,
    currentModelLabel,
    contextLimit,
    branchName,
    branchIsDirty,
    debugMessage,
    errorCount,
    showErrorDetails,
    historyTokenCount,
    tokenMetrics,
  } = props;

  if (hideFooter) {
    return null;
  }

  return (
    <Footer
      model={currentModelLabel ?? currentModel}
      targetDir={config.getTargetDir()}
      debugMode={config.getDebugMode()}
      branchName={branchName}
      branchIsDirty={branchIsDirty}
      debugMessage={debugMessage}
      errorCount={errorCount}
      showErrorDetails={showErrorDetails}
      showMemoryUsage={showMemoryUsage}
      historyTokenCount={historyTokenCount}
      nightly={nightly}
      vimMode={vimModeEnabled ? vimMode : undefined}
      contextLimit={contextLimit}
      isTrustedFolder={props.isTrustedFolder}
      tokensPerMinute={tokenMetrics.tokensPerMinute}
      throttleWaitTimeMs={tokenMetrics.throttleWaitTimeMs}
      sessionTokenTotal={tokenMetrics.sessionTokenTotal}
      hideCWD={settings.merged.hideCWD}
      hideSandboxStatus={settings.merged.hideSandboxStatus}
      hideModelInfo={settings.merged.hideModelInfo}
      themeName={currentThemeName}
    />
  );
}

export interface QuittingDisplayProps {
  constrainHeight: boolean;
  effectiveAvailableHeight: number;
  terminalWidth: number;
  quittingMessages: HistoryItem[];
  config: SlashCommandRuntime;
  slashCommands: readonly SlashCommand[] | undefined;
  showTodoPanelSetting: boolean;
}

export function QuittingDisplay(props: QuittingDisplayProps) {
  const {
    constrainHeight,
    effectiveAvailableHeight,
    terminalWidth,
    quittingMessages,
    config,
    slashCommands,
    showTodoPanelSetting,
  } = props;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {quittingMessages.map((item) => (
        <HistoryItemDisplay
          key={item.id}
          availableTerminalHeight={
            constrainHeight ? effectiveAvailableHeight : undefined
          }
          terminalWidth={terminalWidth}
          item={item}
          isPending={false}
          config={config}
          slashCommands={slashCommands}
          showTodoPanel={showTodoPanelSetting}
        />
      ))}
    </Box>
  );
}
