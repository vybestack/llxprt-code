/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, type DOMElement, Text } from 'ink';
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
import { useFlickerDetector } from '../hooks/useFlickerDetector.js';
import { useAlternateBuffer } from '../hooks/useAlternateBuffer.js';

// Components
import { ConfigInitDisplay } from '../components/ConfigInitDisplay.js';
import { MainContent } from '../components/MainContent.js';
import { HistoryItemDisplay } from '../components/HistoryItemDisplay.js';
import { ShowMoreLines } from '../components/ShowMoreLines.js';
import { UpdateNotification } from '../components/UpdateNotification.js';
import { TodoPanel } from '../components/TodoPanel.js';
import { Footer } from '../components/Footer.js';
import { DialogManager } from '../components/DialogManager.js';
import { Composer } from '../components/Composer.js';
import { LoadingIndicator } from '../components/LoadingIndicator.js';
import { AutoAcceptIndicator } from '../components/AutoAcceptIndicator.js';
import { ShellModeIndicator } from '../components/ShellModeIndicator.js';
import { ContextSummaryDisplay } from '../components/ContextSummaryDisplay.js';
import { DetailedMessagesDisplay } from '../components/DetailedMessagesDisplay.js';

interface DefaultAppLayoutProps {
  config: Config;
  settings: LoadedSettings;
  startupWarnings: string[];
  mainControlsRef: React.RefObject<DOMElement | null>;
  availableTerminalHeight: number;
  contextFileNames: string[];
  updateInfo: UpdateObject | null;
}

export const DefaultAppLayout = ({
  config,
  settings,
  startupWarnings,
  mainControlsRef,
  availableTerminalHeight,
  contextFileNames,
  updateInfo,
}: DefaultAppLayoutProps) => {
  const uiState = useUIState();
  const isAlternateBuffer = useAlternateBuffer();
  // Note: uiActions is not used directly in layout but DialogManager and Composer use it
  void useUIActions();

  const {
    terminalWidth,
    terminalHeight,
    mainAreaWidth,
    inputWidth,
    history,
    streamingState,
    quittingMessages,
    constrainHeight,
    showErrorDetails,
    showToolDescriptions,
    consoleMessages,
    slashCommands,
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
    initError,
    availableTerminalHeight: uiAvailableTerminalHeight,
  } = uiState;

  // Use the UI state's availableTerminalHeight if constrainHeight is true
  // Otherwise, fall back to the prop (which is the same calculation)
  const effectiveAvailableHeight = constrainHeight
    ? uiAvailableTerminalHeight
    : availableTerminalHeight;

  const showTodoPanelSetting = settings.merged.showTodoPanel ?? true;
  const hideContextSummary = settings.merged.ui?.hideContextSummary ?? false;
  const { isNarrow } = uiState;

  const staticExtraHeight = 3;
  const debugConsoleMaxHeight = Math.floor(Math.max(terminalHeight * 0.2, 5));

  useFlickerDetector(uiState.rootUiRef, terminalHeight, constrainHeight);

  // If in alternate buffer mode, need to leave room to draw the scrollbar on
  // the right side of the terminal.
  const width = isAlternateBuffer ? terminalWidth : mainAreaWidth;

  // Check if any dialog is visible
  const dialogsVisible =
    uiState.showWorkspaceMigrationDialog ||
    uiState.shouldShowIdePrompt ||
    uiState.showIdeRestartPrompt ||
    uiState.isFolderTrustDialogOpen ||
    uiState.isPermissionsDialogOpen ||
    uiState.shellConfirmationRequest ||
    uiState.confirmationRequest ||
    uiState.isThemeDialogOpen ||
    uiState.isSettingsDialogOpen ||
    uiState.isAuthenticating ||
    uiState.isAuthDialogOpen ||
    uiState.isOAuthCodeDialogOpen ||
    uiState.isEditorDialogOpen ||
    uiState.isProviderDialogOpen ||
    uiState.isProviderModelDialogOpen ||
    uiState.isLoadProfileDialogOpen ||
    uiState.isToolsDialogOpen ||
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

  const mcpServers = config.getMcpServers();
  const hasMcpServers = mcpServers && Object.keys(mcpServers).length > 0;

  return (
    <StreamingContext.Provider value={streamingState}>
      <Box
        flexDirection="column"
        width={width}
        height={isAlternateBuffer ? terminalHeight - 1 : undefined}
        ref={uiState.rootUiRef}
      >
        {hasMcpServers && <ConfigInitDisplay />}
        <MainContent config={config} />

        <Box flexDirection="column" ref={mainControlsRef}>
          {updateInfo && <UpdateNotification message={updateInfo.message} />}
          {startupWarnings.length > 0 && (
            <Box
              borderStyle="round"
              borderColor={Colors.AccentYellow}
              paddingX={1}
              marginY={1}
              flexDirection="column"
            >
              {startupWarnings.map((warning, index) => (
                <Text key={index} color={Colors.AccentYellow}>
                  {warning}
                </Text>
              ))}
            </Box>
          )}

          {showTodoPanelSetting && <TodoPanel width={inputWidth} />}

          {dialogsVisible ? (
            <DialogManager
              config={config}
              settings={settings}
              availableTerminalHeight={
                constrainHeight ? terminalHeight - staticExtraHeight : undefined
              }
              mainAreaWidth={mainAreaWidth}
              inputWidth={inputWidth}
              debugConsoleMaxHeight={debugConsoleMaxHeight}
              constrainHeight={constrainHeight}
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
              {!isInputActive && (
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
                      // Render ContextSummaryDisplay here when input is NOT active (idle/streaming).
                      // When input IS active, Composer renders it to ensure it stays above the input.
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
              )}
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
                <Composer config={config} settings={settings} />
              )}
            </>
          )}

          {initError && streamingState !== StreamingState.Responding && (
            <Box
              borderStyle="round"
              borderColor={Colors.AccentRed}
              paddingX={1}
              marginBottom={1}
            >
              {(() => {
                const matchingHistoryError = history.find(
                  (item) =>
                    item.type === 'error' && item.text?.includes(initError),
                );
                if (matchingHistoryError?.text) {
                  return (
                    <Text color={Colors.AccentRed}>
                      {matchingHistoryError.text}
                    </Text>
                  );
                }
                return (
                  <>
                    <Text color={Colors.AccentRed}>
                      Initialization Error: {initError}
                    </Text>
                    <Text color={Colors.AccentRed}>
                      {' '}
                      Please check API key and configuration.
                    </Text>
                  </>
                );
              })()}
            </Box>
          )}

          {!isInputActive && !settings.merged.ui?.hideFooter && <Footer />}
        </Box>
      </Box>
    </StreamingContext.Provider>
  );
};
