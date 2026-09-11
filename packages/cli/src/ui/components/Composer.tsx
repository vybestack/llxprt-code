/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LoadedSettings } from '../../config/settings.js';
import { useAppCommands } from '../contexts/AppCommandsContext.js';
import { useVimMode } from '../contexts/VimModeContext.js';
import { useTerminalStore } from '../stores/terminal/TerminalContext.js';
import { useSettingsProfileStore } from '../stores/settings/SettingsContext.js';
import { useTurnStore } from '../stores/turn/TurnContext.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';
import { InputPrompt } from './InputPrompt.js';
import { firstNonEmptyString } from '../../utils/coalesce.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';

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
  return firstNonEmptyString(
    placeholder,
    '  Type your message or @path/to/file',
  );
}

interface ComposerProps {
  config: CliUiRuntime;
  settings: LoadedSettings;
  onSuggestionsVisibilityChange?: (visible: boolean) => void;
}

/**
 * Narrow store reads for the Composer. One hook so the component body stays
 * small; each selector still subscribes independently.
 */
function useComposerSelectors() {
  const { store: terminalStore } = useTerminalStore();
  const settingsStore = useSettingsProfileStore();
  const turnStore = useTurnStore();

  return {
    inputWidth: useStoreSelector(terminalStore, (s) => s.inputWidth),
    suggestionsWidth: useStoreSelector(
      terminalStore,
      (s) => s.suggestionsWidth,
    ),
    isFocused: useStoreSelector(terminalStore, (s) => s.isFocused),
    shellModeActive: useStoreSelector(terminalStore, (s) => s.shellModeActive),
    queueErrorMessage: useStoreSelector(
      terminalStore,
      (s) => s.queueErrorMessage,
    ),
    embeddedShellFocused: useStoreSelector(
      terminalStore,
      (s) => s.embeddedShellFocused,
    ),
    placeholder: useStoreSelector(terminalStore, (s) => s.placeholder),
    slashCommands: useStoreSelector(
      settingsStore.store,
      (s) => s.slashCommands,
    ),
    showAutoAcceptIndicator: useStoreSelector(
      settingsStore.store,
      (s) => s.showAutoAcceptIndicator,
    ),
    streamingState: useStoreSelector(turnStore.store, (s) => s.streamingState),
    queuedSubmissions: useStoreSelector(
      turnStore.store,
      (s) => s.queuedSubmissions,
    ),
  };
}

/**
 * The Composer component handles user input in the CLI. Commands come from
 * the AppCommands context; data comes from narrow store selectors.
 */
export const Composer = ({
  config,
  settings: _settings,
  onSuggestionsVisibilityChange,
}: ComposerProps) => {
  const commands = useAppCommands();
  const { vimEnabled } = useVimMode();
  const {
    inputWidth,
    suggestionsWidth,
    isFocused,
    shellModeActive,
    queueErrorMessage,
    embeddedShellFocused,
    placeholder,
    slashCommands,
    showAutoAcceptIndicator,
    streamingState,
    queuedSubmissions,
  } = useComposerSelectors();

  return (
    <InputPrompt
      buffer={commands.buffer}
      inputWidth={inputWidth}
      suggestionsWidth={suggestionsWidth}
      onSubmit={commands.handleUserInputSubmit}
      onSteer={commands.handleSteer}
      userMessages={commands.inputHistory}
      onClearScreen={commands.handleClearScreen}
      config={config}
      slashCommands={slashCommands ?? []}
      commandContext={commands.commandContext}
      shellModeActive={shellModeActive}
      setShellModeActive={commands.setShellModeActive}
      onEscapePromptChange={commands.handleEscapePromptChange}
      onSuggestionsVisibilityChange={onSuggestionsVisibilityChange}
      focus={isFocused}
      vimHandleInput={commands.vimHandleInput}
      placeholder={getComposerPlaceholder(
        vimEnabled,
        shellModeActive,
        placeholder,
      )}
      approvalMode={showAutoAcceptIndicator}
      vimModeEnabled={vimEnabled}
      setQueueErrorMessage={commands.setQueueErrorMessage}
      streamingState={streamingState}
      queueErrorMessage={queueErrorMessage}
      isEmbeddedShellFocused={embeddedShellFocused}
      queuedSubmissionCount={queuedSubmissions.length}
      sendAllQueuedSubmissions={commands.sendAllQueuedSubmissions}
      steerAllQueuedSubmissions={commands.steerAllQueuedSubmissions}
      clearQueuedSubmissions={commands.clearQueuedSubmissions}
    />
  );
};
