/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../config/settings.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import { InputPrompt } from './InputPrompt.js';

/**
 * Determines the placeholder text based on editor mode.
 */
function getComposerPlaceholder(
  vimModeEnabled: boolean,
  shellModeActive: boolean,
  placeholder?: string,
): string {
  if (vimModeEnabled) {
    return "  Press 'i' for INSERT mode and 'Esc' for NORMAL mode.";
  }
  if (shellModeActive) {
    return '  Type your shell command';
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty placeholder should use default prompt
  return placeholder || '  Type your message or @path/to/file';
}

interface ComposerProps {
  config: Config;
  settings: LoadedSettings;
  onSuggestionsVisibilityChange?: (visible: boolean) => void;
}

/**
 * The Composer component handles user input in the CLI.
 * It wraps the InputPrompt component and connects it to the UIState and UIActions contexts.
 */
export const Composer = ({
  config,
  settings: _settings,
  onSuggestionsVisibilityChange,
}: ComposerProps) => {
  // settings is passed for future use but currently not used
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
    placeholder,
    inputHistory,
    streamingState,
    queueErrorMessage,
    embeddedShellFocused,
  } = uiState;

  return (
    <InputPrompt
      buffer={buffer}
      inputWidth={inputWidth}
      suggestionsWidth={suggestionsWidth}
      onSubmit={uiActions.handleUserInputSubmit}
      userMessages={inputHistory}
      onClearScreen={uiActions.handleClearScreen}
      config={config}
      slashCommands={slashCommands ?? []}
      commandContext={commandContext}
      shellModeActive={shellModeActive}
      setShellModeActive={uiActions.setShellModeActive}
      onEscapePromptChange={uiActions.handleEscapePromptChange}
      onSuggestionsVisibilityChange={onSuggestionsVisibilityChange}
      focus={isFocused}
      vimHandleInput={uiActions.vimHandleInput}
      placeholder={getComposerPlaceholder(
        vimModeEnabled,
        shellModeActive,
        placeholder,
      )}
      approvalMode={showAutoAcceptIndicator}
      vimModeEnabled={vimModeEnabled}
      setQueueErrorMessage={uiActions.setQueueErrorMessage}
      streamingState={streamingState}
      queueErrorMessage={queueErrorMessage}
      isEmbeddedShellFocused={embeddedShellFocused}
    />
  );
};
