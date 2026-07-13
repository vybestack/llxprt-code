/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import type { IdeContext, ThoughtSummary } from '@vybestack/llxprt-code-core';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { StreamingState } from '../types.js';
import type { ConsoleMessageItem } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { SlashCommandRuntime } from '../cliUiRuntime.js';
import { OverflowProvider } from '../contexts/OverflowContext.js';
import { Colors } from '../colors.js';
import { ShowMoreLines } from '../components/ShowMoreLines.js';
import { LoadingIndicator } from '../components/LoadingIndicator.js';
import { AutoAcceptIndicator } from '../components/AutoAcceptIndicator.js';
import { ShellModeIndicator } from '../components/ShellModeIndicator.js';
import { ContextSummaryDisplay } from '../components/ContextSummaryDisplay.js';
import { DetailedMessagesDisplay } from '../components/DetailedMessagesDisplay.js';
import { Composer } from '../components/Composer.js';

const CTRL_C_EXIT_PROMPT = 'Press Ctrl+C again to exit.';
const CTRL_D_EXIT_PROMPT = 'Press Ctrl+D again to exit.';
const ESCAPE_CLEAR_PROMPT = 'Press Esc again to clear.';
const SYSTEM_MD_ENVIRONMENT_VARIABLE = 'GEMINI_SYSTEM_MD';

function isSystemMdEnabled(): boolean {
  return Boolean(process.env[SYSTEM_MD_ENVIRONMENT_VARIABLE]);
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
  config: SlashCommandRuntime;
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
  const shouldHideThought =
    props.streamingState === StreamingState.WaitingForConfirmation ||
    props.disableLoadingPhrases;

  return (
    <>
      <LoadingIndicator
        thought={shouldHideThought ? undefined : props.thought}
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

function StatusBarLeftPrompt(props: InlineContentProps) {
  // Exit confirmations take precedence over clearing feedback and context status.
  if (props.ctrlCPressedOnce) {
    return <Text color={Colors.AccentYellow}>{CTRL_C_EXIT_PROMPT}</Text>;
  }
  if (props.ctrlDPressedOnce) {
    return <Text color={Colors.AccentYellow}>{CTRL_D_EXIT_PROMPT}</Text>;
  }
  if (props.showEscapePrompt) {
    return <Text color={Colors.Gray}>{ESCAPE_CLEAR_PROMPT}</Text>;
  }
  if (!props.hideContextSummary) {
    return (
      <ContextSummaryDisplay
        ideContext={props.ideContextState}
        llxprtMdFileCount={props.llxprtMdFileCount}
        coreMemoryFileCount={props.coreMemoryFileCount}
        contextFileNames={props.contextFileNames}
        mcpServers={props.config.getMcpServers()}
        blockedMcpServers={props.config.getBlockedMcpServers()}
        showToolDescriptions={props.showToolDescriptions}
      />
    );
  }
  return null;
}

function StatusBarLeft(props: InlineContentProps) {
  const showSystemMdIndicator = isSystemMdEnabled();
  const showPrompt =
    props.ctrlCPressedOnce ||
    props.ctrlDPressedOnce ||
    props.showEscapePrompt ||
    !props.hideContextSummary;
  if (!showSystemMdIndicator && !showPrompt) {
    return null;
  }

  return (
    <Box>
      {showSystemMdIndicator && (
        <Text color={Colors.AccentRed}>|&#x2310;&#x25A0;_&#x25A0;| </Text>
      )}
      <StatusBarLeftPrompt {...props} />
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
