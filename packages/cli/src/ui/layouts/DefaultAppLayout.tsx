/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, type DOMElement, Static, Text } from 'ink';
import type { Config } from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { StreamingState } from '../types.js';
import { LoadedSettings } from '../../config/settings.js';
import { UpdateObject } from '../utils/updateCheck.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import { StreamingContext } from '../contexts/StreamingContext.js';
import { OverflowProvider } from '../contexts/OverflowContext.js';
import { Colors } from '../colors.js';

// Components
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
import { ScrollableList } from '../components/shared/ScrollableList.js';
import { SCROLL_TO_ITEM_END } from '../components/shared/VirtualizedList.js';

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

type ScrollableMainContentItem = {
  key: string;
  estimatedHeight: number;
  element: React.ReactElement;
};

function renderScrollableMainContentItem({
  item,
}: {
  item: ScrollableMainContentItem;
  index: number;
}): React.ReactElement {
  return item.element;
}

function keyExtractorScrollableMainContentItem(
  item: ScrollableMainContentItem,
): string {
  return item.key;
}

function estimateScrollableMainContentItemHeight(_index: number): number {
  return 100;
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
    terminalWidth,
    terminalHeight,
    mainAreaWidth,
    inputWidth,
    history,
    pendingHistoryItems,
    streamingState,
    quittingMessages,
    constrainHeight,
    showErrorDetails,
    showToolDescriptions,
    isTodoPanelCollapsed,
    consoleMessages,
    slashCommands,
    staticKey,
    isInputActive,
    ctrlCPressedOnce,
    ctrlDPressedOnce,
    showEscapePrompt,
    ideContextState,
    llxprtMdFileCount,
    elapsedTime,
    currentLoadingPhrase,
    showAutoAcceptIndicator,
    shellModeActive,
    thought,
    branchName,
    debugMessage,
    errorCount,
    historyTokenCount,
    vimModeEnabled,
    vimMode,
    tokenMetrics,
    currentModel,
    availableTerminalHeight: uiAvailableTerminalHeight,
    activeShellPtyId,
    embeddedShellFocused,
  } = uiState;

  // Use the UI state's availableTerminalHeight if constrainHeight is true
  // Otherwise, fall back to the prop (which is the same calculation)
  const effectiveAvailableHeight = constrainHeight
    ? uiAvailableTerminalHeight
    : availableTerminalHeight;

  const showTodoPanelSetting = settings.merged.ui?.showTodoPanel ?? true;
  const hideContextSummary = settings.merged.ui?.hideContextSummary ?? false;
  const { isNarrow } = uiState;

  const useAlternateBuffer =
    settings.merged.ui?.useAlternateBuffer === true &&
    !config.getScreenReader();

  const debugConsoleMaxHeight = Math.floor(Math.max(terminalHeight * 0.2, 5));
  const staticAreaMaxItemHeight = Math.max(terminalHeight * 4, 100);

  // Check if any dialog is visible
  const dialogsVisible =
    uiState.showWorkspaceMigrationDialog ||
    uiState.shouldShowIdePrompt ||
    uiState.showIdeRestartPrompt ||
    uiState.isFolderTrustDialogOpen ||
    uiState.isWelcomeDialogOpen ||
    uiState.isPermissionsDialogOpen ||
    uiState.shellConfirmationRequest ||
    uiState.confirmationRequest ||
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
    uiState.showPrivacyNotice;

  if (quittingMessages) {
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

  if (useAlternateBuffer) {
    const headerElement = (
      <AppHeader
        config={config}
        settings={settings}
        version={version}
        nightly={nightly}
        terminalWidth={terminalWidth}
      />
    );

    const pendingElement = (
      <OverflowProvider>
        <Box ref={uiState.pendingHistoryItemRef} flexDirection="column">
          {pendingHistoryItems.map((item, i) => (
            <HistoryItemDisplay
              key={i}
              availableTerminalHeight={
                constrainHeight ? effectiveAvailableHeight : undefined
              }
              terminalWidth={mainAreaWidth}
              item={{ ...item, id: 0 }}
              isPending={true}
              config={config}
              isFocused={!uiState.isEditorDialogOpen}
              slashCommands={slashCommands}
              showTodoPanel={showTodoPanelSetting}
              activeShellPtyId={activeShellPtyId}
              embeddedShellFocused={embeddedShellFocused}
            />
          ))}
          <ShowMoreLines constrainHeight={constrainHeight} />
        </Box>
      </OverflowProvider>
    );

    const listItems: ScrollableMainContentItem[] = [
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
            terminalWidth={mainAreaWidth}
            availableTerminalHeight={staticAreaMaxItemHeight}
            item={h}
            isPending={false}
            config={config}
            slashCommands={slashCommands}
            showTodoPanel={showTodoPanelSetting}
            activeShellPtyId={activeShellPtyId}
            embeddedShellFocused={embeddedShellFocused}
          />
        ),
      })),
      {
        key: 'pending',
        estimatedHeight: 100,
        element: pendingElement,
      },
    ];

    return (
      <StreamingContext.Provider value={streamingState}>
        <Box
          flexDirection="column"
          width={terminalWidth}
          height={terminalHeight}
          flexShrink={0}
          flexGrow={0}
          overflow="hidden"
          ref={uiState.rootUiRef}
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
            <Notifications
              startupWarnings={startupWarnings}
              updateInfo={updateInfo}
              history={history}
            />

            {showTodoPanelSetting && (
              <TodoPanel width={inputWidth} collapsed={isTodoPanelCollapsed} />
            )}

            <BucketAuthConfirmation
              config={config}
              isFocused={!dialogsVisible}
            />

            {dialogsVisible ? (
              <DialogManager
                config={config}
                settings={settings}
                addItem={uiActions.addItem}
                terminalWidth={terminalWidth}
              />
            ) : (
              <>
                <LoadingIndicator
                  thought={
                    streamingState === StreamingState.WaitingForConfirmation ||
                    config.getAccessibility()?.disableLoadingPhrases ||
                    config.getScreenReader()
                      ? undefined
                      : thought
                  }
                  currentLoadingPhrase={
                    config.getAccessibility()?.disableLoadingPhrases ||
                    config.getScreenReader()
                      ? undefined
                      : currentLoadingPhrase
                  }
                  elapsedTime={elapsedTime}
                />
                <Box
                  marginTop={1}
                  display="flex"
                  justifyContent={
                    hideContextSummary ? 'flex-start' : 'space-between'
                  }
                  width="100%"
                >
                  <Box>
                    {process.env.GEMINI_SYSTEM_MD && (
                      <Text color={Colors.AccentRed}>
                        |&#x2310;&#x25A0;_&#x25A0;|{' '}
                      </Text>
                    )}
                    {ctrlCPressedOnce ? (
                      <Text color={Colors.AccentYellow}>
                        Press Ctrl+C again to exit.
                      </Text>
                    ) : ctrlDPressedOnce ? (
                      <Text color={Colors.AccentYellow}>
                        Press Ctrl+D again to exit.
                      </Text>
                    ) : showEscapePrompt ? (
                      <Text color={Colors.Gray}>Press Esc again to clear.</Text>
                    ) : !hideContextSummary ? (
                      <ContextSummaryDisplay
                        ideContext={ideContextState}
                        llxprtMdFileCount={llxprtMdFileCount}
                        contextFileNames={contextFileNames}
                        mcpServers={config.getMcpServers()}
                        blockedMcpServers={config.getBlockedMcpServers()}
                        showToolDescriptions={showToolDescriptions}
                      />
                    ) : null}
                  </Box>
                  <Box
                    paddingTop={isNarrow ? 1 : 0}
                    marginLeft={hideContextSummary ? 1 : 2}
                  >
                    {showAutoAcceptIndicator !== ApprovalMode.DEFAULT &&
                      !shellModeActive && (
                        <AutoAcceptIndicator
                          approvalMode={showAutoAcceptIndicator}
                        />
                      )}
                    {shellModeActive && <ShellModeIndicator />}
                  </Box>
                </Box>
                {showErrorDetails && (
                  <OverflowProvider>
                    <Box flexDirection="column">
                      <DetailedMessagesDisplay
                        messages={consoleMessages}
                        maxHeight={
                          constrainHeight ? debugConsoleMaxHeight : undefined
                        }
                        width={inputWidth}
                      />
                      <ShowMoreLines constrainHeight={constrainHeight} />
                    </Box>
                  </OverflowProvider>
                )}
                {isInputActive && (
                  <Composer
                    config={config}
                    settings={settings}
                    onSuggestionsVisibilityChange={setSuggestionsVisible}
                  />
                )}
              </>
            )}

            {!settings.merged.ui?.hideFooter && (
              <Footer
                model={currentModel}
                targetDir={config.getTargetDir()}
                debugMode={config.getDebugMode()}
                branchName={branchName}
                debugMessage={debugMessage}
                errorCount={errorCount}
                showErrorDetails={showErrorDetails}
                showMemoryUsage={
                  config.getDebugMode() ||
                  settings.merged.ui?.showMemoryUsage ||
                  false
                }
                historyTokenCount={historyTokenCount}
                nightly={nightly}
                vimMode={vimModeEnabled ? vimMode : undefined}
                contextLimit={
                  config.getEphemeralSetting('context-limit') as
                    | number
                    | undefined
                }
                isTrustedFolder={config.isTrustedFolder()}
                tokensPerMinute={tokenMetrics.tokensPerMinute}
                throttleWaitTimeMs={tokenMetrics.throttleWaitTimeMs}
                sessionTokenTotal={tokenMetrics.sessionTokenTotal}
                hideCWD={settings.merged.hideCWD}
                hideSandboxStatus={settings.merged.hideSandboxStatus}
                hideModelInfo={settings.merged.hideModelInfo}
              />
            )}
          </Box>
        </Box>
      </StreamingContext.Provider>
    );
  }

  return (
    <StreamingContext.Provider value={streamingState}>
      <Box flexDirection="column" width="90%" ref={uiState.rootUiRef}>
        <Static
          key={staticKey}
          items={[
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
                terminalWidth={mainAreaWidth}
                availableTerminalHeight={staticAreaMaxItemHeight}
                key={h.id}
                item={h}
                isPending={false}
                config={config}
                slashCommands={slashCommands}
                showTodoPanel={showTodoPanelSetting}
                activeShellPtyId={activeShellPtyId}
                embeddedShellFocused={embeddedShellFocused}
              />
            )),
          ]}
        >
          {(item) => item}
        </Static>
        <OverflowProvider>
          <Box ref={uiState.pendingHistoryItemRef} flexDirection="column">
            {pendingHistoryItems.map((item, i) => (
              <HistoryItemDisplay
                key={i}
                availableTerminalHeight={
                  constrainHeight ? effectiveAvailableHeight : undefined
                }
                terminalWidth={mainAreaWidth}
                item={{ ...item, id: 0 }}
                isPending={true}
                config={config}
                isFocused={!uiState.isEditorDialogOpen}
                slashCommands={slashCommands}
                showTodoPanel={showTodoPanelSetting}
                activeShellPtyId={activeShellPtyId}
                embeddedShellFocused={embeddedShellFocused}
              />
            ))}
            <ShowMoreLines constrainHeight={constrainHeight} />
          </Box>
        </OverflowProvider>

        <Box flexDirection="column" ref={mainControlsRef}>
          <Notifications
            startupWarnings={startupWarnings}
            updateInfo={updateInfo}
            history={history}
          />

          {showTodoPanelSetting && (
            <TodoPanel width={inputWidth} collapsed={isTodoPanelCollapsed} />
          )}

          {/* OAuth bucket auth confirmation - manages its own state via message bus */}
          <BucketAuthConfirmation config={config} isFocused={!dialogsVisible} />

          {dialogsVisible ? (
            <DialogManager
              config={config}
              settings={settings}
              addItem={uiActions.addItem}
              terminalWidth={terminalWidth}
            />
          ) : (
            <>
              <LoadingIndicator
                thought={
                  streamingState === StreamingState.WaitingForConfirmation ||
                  config.getAccessibility()?.disableLoadingPhrases ||
                  config.getScreenReader()
                    ? undefined
                    : thought
                }
                currentLoadingPhrase={
                  config.getAccessibility()?.disableLoadingPhrases ||
                  config.getScreenReader()
                    ? undefined
                    : currentLoadingPhrase
                }
                elapsedTime={elapsedTime}
              />
              <Box
                marginTop={1}
                display="flex"
                justifyContent={
                  hideContextSummary ? 'flex-start' : 'space-between'
                }
                width="100%"
              >
                <Box>
                  {process.env.GEMINI_SYSTEM_MD && (
                    <Text color={Colors.AccentRed}>
                      |&#x2310;&#x25A0;_&#x25A0;|{' '}
                    </Text>
                  )}
                  {ctrlCPressedOnce ? (
                    <Text color={Colors.AccentYellow}>
                      Press Ctrl+C again to exit.
                    </Text>
                  ) : ctrlDPressedOnce ? (
                    <Text color={Colors.AccentYellow}>
                      Press Ctrl+D again to exit.
                    </Text>
                  ) : showEscapePrompt ? (
                    <Text color={Colors.Gray}>Press Esc again to clear.</Text>
                  ) : !hideContextSummary ? (
                    <ContextSummaryDisplay
                      ideContext={ideContextState}
                      llxprtMdFileCount={llxprtMdFileCount}
                      contextFileNames={contextFileNames}
                      mcpServers={config.getMcpServers()}
                      blockedMcpServers={config.getBlockedMcpServers()}
                      showToolDescriptions={showToolDescriptions}
                    />
                  ) : null}
                </Box>
                <Box
                  paddingTop={isNarrow ? 1 : 0}
                  marginLeft={hideContextSummary ? 1 : 2}
                >
                  {showAutoAcceptIndicator !== ApprovalMode.DEFAULT &&
                    !shellModeActive && (
                      <AutoAcceptIndicator
                        approvalMode={showAutoAcceptIndicator}
                      />
                    )}
                  {shellModeActive && <ShellModeIndicator />}
                </Box>
              </Box>
              {showErrorDetails && (
                <OverflowProvider>
                  <Box flexDirection="column">
                    <DetailedMessagesDisplay
                      messages={consoleMessages}
                      maxHeight={
                        constrainHeight ? debugConsoleMaxHeight : undefined
                      }
                      width={inputWidth}
                    />
                    <ShowMoreLines constrainHeight={constrainHeight} />
                  </Box>
                </OverflowProvider>
              )}
              {isInputActive && (
                <Composer
                  config={config}
                  settings={settings}
                  onSuggestionsVisibilityChange={setSuggestionsVisible}
                />
              )}
            </>
          )}

          {!settings.merged.ui?.hideFooter && (
            <Footer
              model={currentModel}
              targetDir={config.getTargetDir()}
              debugMode={config.getDebugMode()}
              branchName={branchName}
              debugMessage={debugMessage}
              errorCount={errorCount}
              showErrorDetails={showErrorDetails}
              showMemoryUsage={
                config.getDebugMode() ||
                settings.merged.ui?.showMemoryUsage ||
                false
              }
              historyTokenCount={historyTokenCount}
              nightly={nightly}
              vimMode={vimModeEnabled ? vimMode : undefined}
              contextLimit={
                config.getEphemeralSetting('context-limit') as
                  | number
                  | undefined
              }
              isTrustedFolder={config.isTrustedFolder()}
              tokensPerMinute={tokenMetrics.tokensPerMinute}
              throttleWaitTimeMs={tokenMetrics.throttleWaitTimeMs}
              sessionTokenTotal={tokenMetrics.sessionTokenTotal}
              hideCWD={settings.merged.hideCWD}
              hideSandboxStatus={settings.merged.hideSandboxStatus}
              hideModelInfo={settings.merged.hideModelInfo}
            />
          )}
        </Box>
      </Box>
    </StreamingContext.Provider>
  );
};
