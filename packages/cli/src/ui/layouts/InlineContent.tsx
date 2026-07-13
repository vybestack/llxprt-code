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

function StatusBarLeftPrompt(props: InlineContentProps) {
  // Exit confirmations take precedence over clearing feedback and context status.
  const transientPrompt = [
    { active: props.ctrlCPressedOnce, text: 'Press Ctrl+C again to exit.' },
    { active: props.ctrlDPressedOnce, text: 'Press Ctrl+D again to exit.' },
  ].find((entry) => entry.active);
  if (transientPrompt) {
    return <Text color={Colors.AccentYellow}>{transientPrompt.text}</Text>;
  }
  if (props.showEscapePrompt) {
    return <Text color={Colors.Gray}>Press Esc again to clear.</Text>;
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

export function StatusBarLeft(props: InlineContentProps) {
  const showSystemMdIndicator = Boolean(process.env.GEMINI_SYSTEM_MD);
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
