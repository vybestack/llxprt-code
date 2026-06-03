/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import React from 'react';
import { Box, Text } from 'ink';
import type {
  Config,
  MessageBus,
  IdeContext,
  ThoughtSummary,
} from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { StreamingState } from '../types.js';
import type { HistoryItem, ConsoleMessageItem } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { UpdateObject } from '../utils/updateCheck.js';
import type { UIState } from '../contexts/UIStateContext.js';
import type { UIActions } from '../contexts/UIActionsContext.js';
import { OverflowProvider } from '../contexts/OverflowContext.js';
import { Colors } from '../colors.js';
import { getCliRuntimeContext } from '../../runtime/runtimeSettings.js';
import { themeManager } from '../themes/theme-manager.js';
import type { SlashCommand } from '../commands/types.js';

import { AppHeader } from '../components/AppHeader.js';
import { HistoryItemDisplay } from '../components/HistoryItemDisplay.js';
import { ShowMoreLines } from '../components/ShowMoreLines.js';
import { Notifications } from '../components/Notifications.js';
import { TodoPanel } from '../components/TodoPanel.js';
import { Footer } from '../components/Footer.js';
import { DialogManager } from '../components/DialogManager.js';
import { BucketAuthConfirmation } from '../components/BucketAuthConfirmation.js';
import { Composer } from '../components/Composer.js';
import { LoadingIndicator } from '../components/LoadingIndicator.js';
import { AutoAcceptIndicator } from '../components/AutoAcceptIndicator.js';
import { ShellModeIndicator } from '../components/ShellModeIndicator.js';
import { ContextSummaryDisplay } from '../components/ContextSummaryDisplay.js';
import { DetailedMessagesDisplay } from '../components/DetailedMessagesDisplay.js';

export interface ScrollableMainContentItem {
  key: string;
  estimatedHeight: number;
  element: React.ReactElement;
}

export function renderScrollableMainContentItem({
  item,
}: {
  item: ScrollableMainContentItem;
  index: number;
}): React.ReactElement {
  return item.element;
}

export function keyExtractorScrollableMainContentItem(
  item: ScrollableMainContentItem,
): string {
  return item.key;
}

export function estimateScrollableMainContentItemHeight(
  _index: number,
): number {
  return 100;
}

/* eslint-disable complexity -- Phase 5: legacy UI boundary retained while larger decomposition continues. */
export function hasActiveDialog(uiState: UIState): boolean {
  return (
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    uiState.showWorkspaceMigrationDialog ||
    uiState.shouldShowIdePrompt ||
    uiState.showIdeRestartPrompt ||
    uiState.isFolderTrustDialogOpen ||
    uiState.isWelcomeDialogOpen ||
    uiState.isPermissionsDialogOpen ||
    Boolean(uiState.confirmationRequest) ||
    uiState.isThemeDialogOpen ||
    uiState.isSettingsDialogOpen ||
    uiState.isAuthDialogOpen ||
    uiState.isOAuthCodeDialogOpen ||
    uiState.isEditorDialogOpen ||
    uiState.isProviderDialogOpen ||
    uiState.isLoadProfileDialogOpen ||
    uiState.isCreateProfileDialogOpen ||
    uiState.isProfileListDialogOpen ||
    uiState.isProfileDetailDialogOpen ||
    uiState.isProfileEditorDialogOpen ||
    uiState.isToolsDialogOpen ||
    uiState.isLoggingDialogOpen ||
    uiState.isSubagentDialogOpen ||
    uiState.isModelsDialogOpen ||
    uiState.isSessionBrowserDialogOpen ||
    uiState.showPrivacyNotice
  );
}

export interface LayoutSettings {
  showTodoPanelSetting: boolean;
  hideContextSummary: boolean;
  hideFooter: boolean;
  showMemoryUsage: boolean;
  disableLoadingPhrases: boolean;
  currentThemeName: string;
  isNarrow: boolean;
  useAlternateBuffer: boolean;
  debugConsoleMaxHeight: number;
  staticAreaMaxItemHeight: number;
  effectiveAvailableHeight: number;
}

export function useLayoutSettings(
  config: Config,
  settings: LoadedSettings,
  availableTerminalHeight: number,
  terminalHeight: number,
  constrainHeight: boolean,
  uiAvailableTerminalHeight: number,
  isNarrow: boolean,
): LayoutSettings {
  const showTodoPanelSetting = settings.merged.ui.showTodoPanel ?? true;
  const hideContextSummary = settings.merged.ui.hideContextSummary ?? false;
  const hideFooter = settings.merged.ui.hideFooter ?? false;
  const showMemoryUsage =
    config.getDebugMode() || (settings.merged.ui.showMemoryUsage ?? false);
  const disableLoadingPhrases =
    config.getAccessibility().disableLoadingPhrases === true ||
    config.getScreenReader();
  const currentThemeName = themeManager.getActiveTheme().name;
  const useAlternateBuffer =
    settings.merged.ui.useAlternateBuffer === true && !config.getScreenReader();
  const debugConsoleMaxHeight = Math.floor(Math.max(terminalHeight * 0.2, 5));
  const staticAreaMaxItemHeight = Math.max(terminalHeight * 4, 100);
  const effectiveAvailableHeight = constrainHeight
    ? uiAvailableTerminalHeight
    : availableTerminalHeight;

  return {
    showTodoPanelSetting,
    hideContextSummary,
    hideFooter,
    showMemoryUsage,
    disableLoadingPhrases,
    currentThemeName,
    isNarrow,
    useAlternateBuffer,
    debugConsoleMaxHeight,
    staticAreaMaxItemHeight,
    effectiveAvailableHeight,
  };
}

function useHistoryItemDisplayProps(
  config: Config,
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
  config: Config,
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
  config: Config,
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

  return React.useMemo(
    () => [
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
    ],
    [
      config,
      settings,
      version,
      nightly,
      terminalWidth,
      history,
      base,
      staticAreaMaxItemHeight,
    ],
  );
}

export function usePendingItems(
  uiState: UIState,
  config: Config,
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

  return React.useMemo(
    () =>
      uiState.pendingHistoryItems.map((item, i) => (
        <HistoryItemDisplay
          key={i}
          {...base}
          availableTerminalHeight={
            constrainHeight ? effectiveAvailableHeight : undefined
          }
          item={{ ...item, id: 0 }}
          isPending={true}
          isFocused={!uiState.isEditorDialogOpen}
        />
      )),
    [
      uiState.pendingHistoryItems,
      base,
      constrainHeight,
      effectiveAvailableHeight,
      uiState.isEditorDialogOpen,
    ],
  );
}

export function usePendingElement(
  uiState: UIState,
  config: Config,
  mainAreaWidth: number,
  constrainHeight: boolean,
  effectiveAvailableHeight: number,
  slashCommands: readonly SlashCommand[] | undefined,
  showTodoPanelSetting: boolean,
  activeShellPtyId: number | null,
  embeddedShellFocused: boolean,
): React.ReactElement {
  const pendingItems = usePendingItems(
    uiState,
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
        <Box ref={uiState.pendingHistoryItemRef} flexDirection="column">
          {pendingItems}
          <ShowMoreLines constrainHeight={constrainHeight} />
        </Box>
      </OverflowProvider>
    ),
    [uiState.pendingHistoryItemRef, pendingItems, constrainHeight],
  );
}

export function useScrollableContent(
  config: Config,
  settings: LoadedSettings,
  version: string,
  nightly: boolean,
  terminalWidth: number,
  mainAreaWidth: number,
  staticAreaMaxItemHeight: number,
  constrainHeight: boolean,
  effectiveAvailableHeight: number,
  showTodoPanelSetting: boolean,
  uiState: UIState,
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
    uiState,
    config,
    mainAreaWidth,
    constrainHeight,
    effectiveAvailableHeight,
    slashCommands,
    showTodoPanelSetting,
    activeShellPtyId,
    embeddedShellFocused,
  );

  const listItems = useListItems(
    headerElement,
    pendingElement,
    uiState.history,
    config,
    mainAreaWidth,
    staticAreaMaxItemHeight,
    slashCommands,
    showTodoPanelSetting,
    activeShellPtyId,
    embeddedShellFocused,
  );

  const staticItems = useStaticItems(
    config,
    settings,
    version,
    nightly,
    terminalWidth,
    uiState.history,
    mainAreaWidth,
    staticAreaMaxItemHeight,
    slashCommands,
    showTodoPanelSetting,
    activeShellPtyId,
    embeddedShellFocused,
  );

  const pendingItems = usePendingItems(
    uiState,
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
  config: Config;
  settings: LoadedSettings;
  hideFooter: boolean;
  showMemoryUsage: boolean;
  currentThemeName: string;
  nightly: boolean;
  vimModeEnabled: boolean;
  vimMode: string | undefined;
  currentModel: string;
  contextLimit: number | undefined;
  branchName: string | undefined;
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
    contextLimit,
    branchName,
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
      model={currentModel}
      targetDir={config.getTargetDir()}
      debugMode={config.getDebugMode()}
      branchName={branchName}
      debugMessage={debugMessage}
      errorCount={errorCount}
      showErrorDetails={showErrorDetails}
      showMemoryUsage={showMemoryUsage}
      historyTokenCount={historyTokenCount}
      nightly={nightly}
      vimMode={vimModeEnabled ? vimMode : undefined}
      contextLimit={contextLimit}
      isTrustedFolder={config.isTrustedFolder()}
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

export interface MainControlsProps {
  config: Config;
  settings: LoadedSettings;
  startupWarnings: string[];
  updateInfo: UpdateObject | null;
  history: HistoryItem[];
  inputWidth: number;
  isTodoPanelCollapsed: boolean;
  showTodoPanelSetting: boolean;
  dialogsVisible: boolean;
  hideContextSummary: boolean;
  hideFooter: boolean;
  showMemoryUsage: boolean;
  currentThemeName: string;
  nightly: boolean;
  constrainHeight: boolean;
  debugConsoleMaxHeight: number;
  effectiveAvailableHeight: number;
  disableLoadingPhrases: boolean;
  streamingState: StreamingState;
  thought: ThoughtSummary | null;
  currentLoadingPhrase: string | undefined;
  elapsedTime: number;
  isNarrow: boolean;
  ctrlCPressedOnce: boolean;
  ctrlDPressedOnce: boolean;
  showEscapePrompt: boolean;
  ideContextState: IdeContext | undefined;
  llxprtMdFileCount: number;
  coreMemoryFileCount: number;
  contextFileNames: string[];
  showToolDescriptions: boolean;
  showAutoAcceptIndicator: ApprovalMode;
  shellModeActive: boolean;
  showErrorDetails: boolean;
  consoleMessages: ConsoleMessageItem[];
  isInputActive: boolean;
  vimModeEnabled: boolean;
  vimMode: string | undefined;
  currentModel: string;
  contextLimit: number | undefined;
  branchName: string | undefined;
  debugMessage: string;
  errorCount: number;
  historyTokenCount: number;
  tokenMetrics: {
    tokensPerMinute: number;
    throttleWaitTimeMs: number;
    sessionTokenTotal: number;
  };
  uiActions: UIActions;
  terminalWidth: number;
  onSuggestionsVisibilityChange: (visible: boolean) => void;
}

export function MainControls(props: MainControlsProps) {
  const { dialogsVisible, hideFooter } = props;

  return (
    <>
      <NotificationsSection {...props} />
      <TodoPanelSection
        showTodoPanelSetting={props.showTodoPanelSetting}
        inputWidth={props.inputWidth}
        isTodoPanelCollapsed={props.isTodoPanelCollapsed}
      />
      <BucketAuthSection dialogsVisible={dialogsVisible} />
      {dialogsVisible ? (
        <DialogManager
          config={props.config}
          settings={props.settings}
          addItem={props.uiActions.addItem}
          terminalWidth={props.terminalWidth}
        />
      ) : (
        <InlineContent {...props} />
      )}
      <FooterSection
        config={props.config}
        settings={props.settings}
        hideFooter={hideFooter}
        showMemoryUsage={props.showMemoryUsage}
        currentThemeName={props.currentThemeName}
        nightly={props.nightly}
        vimModeEnabled={props.vimModeEnabled}
        vimMode={props.vimMode}
        currentModel={props.currentModel}
        contextLimit={props.contextLimit}
        branchName={props.branchName}
        debugMessage={props.debugMessage}
        errorCount={props.errorCount}
        showErrorDetails={props.showErrorDetails}
        historyTokenCount={props.historyTokenCount}
        tokenMetrics={props.tokenMetrics}
      />
    </>
  );
}

function NotificationsSection(props: MainControlsProps) {
  return (
    <Notifications
      startupWarnings={props.startupWarnings}
      updateInfo={props.updateInfo}
      history={props.history}
    />
  );
}

function TodoPanelSection({
  showTodoPanelSetting,
  inputWidth,
  isTodoPanelCollapsed,
}: {
  showTodoPanelSetting: boolean;
  inputWidth: number;
  isTodoPanelCollapsed: boolean;
}) {
  if (!showTodoPanelSetting) {
    return null;
  }
  return <TodoPanel width={inputWidth} collapsed={isTodoPanelCollapsed} />;
}

function BucketAuthSection({ dialogsVisible }: { dialogsVisible: boolean }) {
  return (
    <BucketAuthConfirmation
      messageBus={
        (getCliRuntimeContext() as { messageBus?: MessageBus }).messageBus
      }
      isFocused={!dialogsVisible}
    />
  );
}

export interface InlineContentProps {
  streamingState: StreamingState;
  disableLoadingPhrases: boolean;
  thought: ThoughtSummary | null;
  currentLoadingPhrase: string | undefined;
  elapsedTime: number;
  hideContextSummary: boolean;
  isNarrow: boolean;
  ctrlCPressedOnce: boolean;
  ctrlDPressedOnce: boolean;
  showEscapePrompt: boolean;
  ideContextState: IdeContext | undefined;
  llxprtMdFileCount: number;
  coreMemoryFileCount: number;
  contextFileNames: string[];
  config: Config;
  showToolDescriptions: boolean;
  showAutoAcceptIndicator: ApprovalMode;
  shellModeActive: boolean;
  showErrorDetails: boolean;
  consoleMessages: ConsoleMessageItem[];
  constrainHeight: boolean;
  debugConsoleMaxHeight: number;
  inputWidth: number;
  isInputActive: boolean;
  settings: LoadedSettings;
  onSuggestionsVisibilityChange: (visible: boolean) => void;
}

export function InlineContent(props: InlineContentProps) {
  return (
    <>
      <LoadingIndicator
        thought={
          props.streamingState === StreamingState.WaitingForConfirmation ||
          props.disableLoadingPhrases
            ? undefined
            : props.thought
        }
        currentLoadingPhrase={
          props.disableLoadingPhrases ? undefined : props.currentLoadingPhrase
        }
        elapsedTime={props.elapsedTime}
      />
      <StatusBar {...props} />
      <ErrorConsoleSection {...props} />
      <ComposerSection {...props} />
    </>
  );
}

function StatusBar(props: InlineContentProps) {
  return (
    <Box
      marginTop={1}
      display="flex"
      justifyContent={props.hideContextSummary ? 'flex-start' : 'space-between'}
      width="100%"
    >
      <StatusBarLeft {...props} />
      <StatusBarRight {...props} />
    </Box>
  );
}

function StatusBarLeft(props: InlineContentProps) {
  return (
    <Box>
      {process.env.GEMINI_SYSTEM_MD && (
        <Text color={Colors.AccentRed}>|&#x2310;&#x25A0;_&#x25A0;| </Text>
      )}
      {/* eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice. */}
      {props.ctrlCPressedOnce ? (
        <Text color={Colors.AccentYellow}>Press Ctrl+C again to exit.</Text>
      ) : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      props.ctrlDPressedOnce ? (
        <Text color={Colors.AccentYellow}>Press Ctrl+D again to exit.</Text>
      ) : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      props.showEscapePrompt ? (
        <Text color={Colors.Gray}>Press Esc again to clear.</Text>
      ) : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      !props.hideContextSummary ? (
        <ContextSummaryDisplay
          ideContext={props.ideContextState}
          llxprtMdFileCount={props.llxprtMdFileCount}
          coreMemoryFileCount={props.coreMemoryFileCount}
          contextFileNames={props.contextFileNames}
          mcpServers={props.config.getMcpServers()}
          blockedMcpServers={props.config.getBlockedMcpServers()}
          showToolDescriptions={props.showToolDescriptions}
        />
      ) : null}
    </Box>
  );
}

function StatusBarRight(props: InlineContentProps) {
  return (
    <Box
      paddingTop={props.isNarrow ? 1 : 0}
      marginLeft={props.hideContextSummary ? 1 : 2}
    >
      {props.showAutoAcceptIndicator !== ApprovalMode.DEFAULT &&
        !props.shellModeActive && (
          <AutoAcceptIndicator approvalMode={props.showAutoAcceptIndicator} />
        )}
      {props.shellModeActive && <ShellModeIndicator />}
    </Box>
  );
}

function ErrorConsoleSection(props: InlineContentProps) {
  if (!props.showErrorDetails) {
    return null;
  }
  return (
    <OverflowProvider>
      <Box flexDirection="column">
        <DetailedMessagesDisplay
          messages={props.consoleMessages}
          maxHeight={
            props.constrainHeight ? props.debugConsoleMaxHeight : undefined
          }
          width={props.inputWidth}
        />
        <ShowMoreLines constrainHeight={props.constrainHeight} />
      </Box>
    </OverflowProvider>
  );
}

function ComposerSection(props: InlineContentProps) {
  if (!props.isInputActive) {
    return null;
  }
  return (
    <Composer
      config={props.config}
      settings={props.settings}
      onSuggestionsVisibilityChange={props.onSuggestionsVisibilityChange}
    />
  );
}

export interface QuittingDisplayProps {
  constrainHeight: boolean;
  effectiveAvailableHeight: number;
  terminalWidth: number;
  quittingMessages: HistoryItem[];
  config: Config;
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
