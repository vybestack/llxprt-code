import { Box, Text } from 'ink';
import type { Config } from '@vybestack/llxprt-code-core';
import { LoadedSettings } from '../../config/settings.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import { InputPrompt } from './InputPrompt.js';
import { Colors } from '../colors.js';
import { ContextSummaryDisplay } from './ContextSummaryDisplay.js';
import { AutoAcceptIndicator } from './AutoAcceptIndicator.js';
import { ShellModeIndicator } from './ShellModeIndicator.js';
import { DetailedMessagesDisplay } from './DetailedMessagesDisplay.js';
import { ShowMoreLines } from './ShowMoreLines.js';
import { Footer } from './Footer.js';
import { OverflowProvider } from '../contexts/OverflowContext.js';
import { MAX_DISPLAYED_QUEUED_MESSAGES } from '../constants/uiConstants.js';
import process from 'node:process';

interface ComposerProps {
  config: Config;
  settings: LoadedSettings;
}

/**
 * The Composer component handles user input in the CLI.
 * It wraps the InputPrompt component and connects it to the UIState and UIActions contexts.
 */
export const Composer = ({ config, settings }: ComposerProps) => {
  const uiState = useUIState();
  const uiActions = useUIActions();

  const {
    buffer,
    inputWidth,
    suggestionsWidth,
    slashCommands,
    commandContext,
    shellModeActive,
    isFocused,
    vimModeEnabled,
    showAutoAcceptIndicator,

    messageQueue,
    ctrlCPressedOnce,
    ctrlDPressedOnce,
    showEscapePrompt,
    ideContextState,
    llxprtMdFileCount,
    showToolDescriptions,
    showErrorDetails,
    consoleMessages,
    constrainHeight,
    isInputActive,
    userMessages,

    isNarrow,
  } = uiState;

  // Mocking contextFileNames for now as it wasn't in the original snippet but used in JSX
  const contextFileNames: string[] = [];
  const debugConsoleMaxHeight = 10; // Default or import?

  const vimEnabled = vimModeEnabled;

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginTop={1}>
        {messageQueue
          .slice(0, MAX_DISPLAYED_QUEUED_MESSAGES)
          .map((message, index) => {
            const preview = message.replace(/\s+/g, ' ');

            return (
              <Box key={index} paddingLeft={2} width="100%">
                <Text dimColor wrap="truncate">
                  {preview}
                </Text>
              </Box>
            );
          })}
        {messageQueue.length > MAX_DISPLAYED_QUEUED_MESSAGES && (
          <Box paddingLeft={2}>
            <Text dimColor>
              ... (+
              {messageQueue.length - MAX_DISPLAYED_QUEUED_MESSAGES} more)
            </Text>
          </Box>
        )}
      </Box>

      <Box
        marginTop={1}
        justifyContent="space-between"
        width="100%"
        flexDirection={isNarrow ? 'column' : 'row'}
        alignItems={isNarrow ? 'flex-start' : 'center'}
      >
        <Box>
          {process.env['GEMINI_SYSTEM_MD'] && (
            <Text color={Colors.AccentRed}>|⌐■_■| </Text>
          )}
          {ctrlCPressedOnce ? (
            <Text color={Colors.AccentYellow}>Press Ctrl+C again to exit.</Text>
          ) : ctrlDPressedOnce ? (
            <Text color={Colors.AccentYellow}>Press Ctrl+D again to exit.</Text>
          ) : showEscapePrompt ? (
            <Text color={Colors.Gray}>Press Esc again to clear.</Text>
          ) : (
            !settings.merged.ui?.hideContextSummary && (
              <ContextSummaryDisplay
                ideContext={ideContextState}
                llxprtMdFileCount={llxprtMdFileCount}
                contextFileNames={contextFileNames}
                mcpServers={config.getMcpServers()}
                blockedMcpServers={config.getBlockedMcpServers()}
                showToolDescriptions={showToolDescriptions}
              />
            )
          )}
        </Box>
        <Box paddingTop={isNarrow ? 1 : 0}>
          {showAutoAcceptIndicator !== 'default' && // ApprovalMode.DEFAULT is 'default'
            !shellModeActive && (
              <AutoAcceptIndicator approvalMode={showAutoAcceptIndicator} />
            )}
          {shellModeActive && <ShellModeIndicator />}
        </Box>
      </Box>

      {showErrorDetails && (
        <OverflowProvider>
          <Box flexDirection="column">
            <DetailedMessagesDisplay
              messages={consoleMessages}
              maxHeight={constrainHeight ? debugConsoleMaxHeight : undefined}
              width={inputWidth}
            />
            <ShowMoreLines constrainHeight={constrainHeight} />
          </Box>
        </OverflowProvider>
      )}

      {isInputActive && (
        <InputPrompt
          buffer={buffer}
          inputWidth={inputWidth}
          suggestionsWidth={suggestionsWidth}
          onSubmit={uiActions.handleUserInputSubmit}
          userMessages={userMessages}
          onClearScreen={uiActions.handleClearScreen}
          config={config}
          slashCommands={slashCommands}
          commandContext={commandContext}
          shellModeActive={shellModeActive}
          setShellModeActive={uiActions.setShellModeActive}
          onEscapePromptChange={uiActions.handleEscapePromptChange}
          focus={isFocused}
          vimHandleInput={uiActions.vimHandleInput}
          placeholder={
            vimEnabled
              ? "  Press 'i' for INSERT mode and 'Esc' for NORMAL mode."
              : '  Type your message or @path/to/file'
          }
          approvalMode={showAutoAcceptIndicator}
          vimModeEnabled={vimModeEnabled}
        />
      )}

      {!settings.merged.ui?.hideFooter && <Footer />}
    </Box>
  );
};
