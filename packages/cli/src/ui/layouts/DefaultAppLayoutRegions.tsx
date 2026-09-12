/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useHookDisplayState } from '../hooks/useHookDisplayState.js';
import { HookStatusDisplay } from '../components/HookStatusDisplay.js';
import type { MessageBus } from '@vybestack/llxprt-code-core';
import { getCliRuntimeContext } from '@vybestack/llxprt-code-providers/runtime.js';
import { useTerminalStore } from '../stores/terminal/TerminalContext.js';
import { useTurnStore } from '../stores/turn/TurnContext.js';
import { useSettingsProfileStore } from '../stores/settings/SettingsContext.js';
import { useStoreSelector } from '../stores/useStoreSelector.js';
import { useVimMode } from '../contexts/VimModeContext.js';
import { themeManager } from '../themes/theme-manager.js';
import { Notifications } from '../components/Notifications.js';
import { TodoPanel } from '../components/TodoPanel.js';
import { QueuedMessagesPanel } from '../components/QueuedMessagesPanel.js';
import { BucketAuthConfirmation } from '../components/BucketAuthConfirmation.js';
import { DialogManager } from '../components/DialogManager.js';
import { InlineContent } from './InlineContent.js';
import {
  FooterSection,
  useHasActiveDialog,
} from './DefaultAppLayoutHelpers.js';
import type { DefaultAppLayoutProps } from './DefaultAppLayout.js';

function useComposerFields() {
  const terminal = useTerminalStore();
  const turn = useTurnStore();
  const settings = useSettingsProfileStore();
  return {
    streamingState: useStoreSelector(turn.store, (s) => s.streamingState),
    thought: useStoreSelector(turn.store, (s) => s.thought),
    currentLoadingPhrase: useStoreSelector(
      turn.store,
      (s) => s.currentLoadingPhrase,
    ),
    elapsedTime: useStoreSelector(turn.store, (s) => s.elapsedTime),
    ctrlCPressedOnce: useStoreSelector(turn.store, (s) => s.ctrlCPressedOnce),
    ctrlDPressedOnce: useStoreSelector(turn.store, (s) => s.ctrlDPressedOnce),
    showEscapePrompt: useStoreSelector(
      terminal.store,
      (s) => s.showEscapePrompt,
    ),
    isNarrow: useStoreSelector(terminal.store, (s) => s.isNarrow),
    showToolDescriptions: useStoreSelector(
      terminal.store,
      (s) => s.showToolDescriptions,
    ),
    shellModeActive: useStoreSelector(terminal.store, (s) => s.shellModeActive),
    showErrorDetails: useStoreSelector(
      terminal.store,
      (s) => s.showErrorDetails,
    ),
    constrainHeight: useStoreSelector(terminal.store, (s) => s.constrainHeight),
    inputWidth: useStoreSelector(terminal.store, (s) => s.inputWidth),
    isInputActive: useStoreSelector(terminal.store, (s) => s.isInputActive),
    debugConsoleMaxHeight: useStoreSelector(terminal.store, (s) =>
      Math.floor(Math.max(s.terminalHeight * 0.2, 5)),
    ),
    ideContextState: useStoreSelector(settings.store, (s) => s.ideContextState),
    llxprtMdFileCount: useStoreSelector(
      settings.store,
      (s) => s.llxprtMdFileCount,
    ),
    coreMemoryFileCount: useStoreSelector(
      settings.store,
      (s) => s.coreMemoryFileCount,
    ),
    consoleMessages: useStoreSelector(settings.store, (s) => s.consoleMessages),
    showAutoAcceptIndicator: useStoreSelector(
      settings.store,
      (s) => s.showAutoAcceptIndicator,
    ),
  };
}

/** Input and its inline status own their subscriptions, independently of history. */
export function ComposerRegion(props: DefaultAppLayoutProps): React.ReactNode {
  const dialogsVisible = useHasActiveDialog();
  return dialogsVisible ? null : <ComposerContent {...props} />;
}

function ComposerContent(props: DefaultAppLayoutProps) {
  const fields = useComposerFields();
  const [, setSuggestionsVisible] = React.useState(false);
  return (
    <InlineContent
      {...fields}
      config={props.slashCommandRuntime}
      settings={props.settings}
      contextFileNames={props.contextFileNames}
      hideContextSummary={props.settings.merged.ui.hideContextSummary ?? false}
      disableLoadingPhrases={
        props.uiRuntime.app.getAccessibility().disableLoadingPhrases === true ||
        props.uiRuntime.app.getScreenReader()
      }
      onSuggestionsVisibilityChange={setSuggestionsVisible}
    />
  );
}

/** The dialog layer reads visibility; DialogManager selects the active request. */
export function DialogRegion(props: DefaultAppLayoutProps): React.ReactNode {
  const dialogsVisible = useHasActiveDialog();
  const runtime = getCliRuntimeContext() as { messageBus?: MessageBus };
  return (
    <>
      <BucketAuthConfirmation
        messageBus={runtime.messageBus}
        isFocused={!dialogsVisible}
      />
      {dialogsVisible ? (
        <DialogManager
          config={props.slashCommandRuntime}
          settings={props.settings}
        />
      ) : null}
    </>
  );
}

/** Status readouts do not subscribe to turn clocks or dialog visibility. */
export function FooterRegion(props: DefaultAppLayoutProps): React.ReactNode {
  const { store } = useSettingsProfileStore();
  const terminal = useTerminalStore();
  const { vimEnabled, vimMode } = useVimMode();
  const activeHooks = useHookDisplayState(props.runtimeMessageBus);
  const fields = {
    isTrustedFolder: useStoreSelector(store, (s) => s.isTrustedFolder),
    currentModel: useStoreSelector(store, (s) => s.currentModel),
    currentModelLabel: useStoreSelector(store, (s) => s.currentModelLabel),
    contextLimit: useStoreSelector(store, (s) => s.contextLimit),
    branchName: useStoreSelector(store, (s) => s.branchName),
    branchIsDirty: useStoreSelector(store, (s) => s.branchIsDirty),
    debugMessage: useStoreSelector(store, (s) => s.debugMessage),
    errorCount: useStoreSelector(store, (s) => s.errorCount),
    historyTokenCount: useStoreSelector(store, (s) => s.historyTokenCount),
    tokenMetrics: useStoreSelector(store, (s) => s.tokenMetrics),
    showErrorDetails: useStoreSelector(
      terminal.store,
      (s) => s.showErrorDetails,
    ),
  };
  return (
    <>
      {activeHooks.length > 0 && (
        <HookStatusDisplay activeHooks={activeHooks} />
      )}
      <FooterSection
        {...fields}
        config={props.slashCommandRuntime}
        settings={props.settings}
        hideFooter={props.settings.merged.ui.hideFooter ?? false}
        showMemoryUsage={
          props.uiRuntime.app.getDebugMode() ||
          (props.settings.merged.ui.showMemoryUsage ?? false)
        }
        currentThemeName={themeManager.getActiveTheme().name}
        nightly={props.nightly}
        vimModeEnabled={vimEnabled}
        vimMode={vimMode}
      />
    </>
  );
}

/** Notifications and queue panels share only the data they display. */
export function PanelsRegion(props: DefaultAppLayoutProps): React.ReactNode {
  const terminal = useTerminalStore();
  const turn = useTurnStore();
  const history = useStoreSelector(turn.store, (s) => s.history);
  const queued = useStoreSelector(turn.store, (s) => s.queuedSubmissions);
  const width = useStoreSelector(terminal.store, (s) => s.inputWidth);
  const todoCollapsed = useStoreSelector(
    terminal.store,
    (s) => s.isTodoPanelCollapsed,
  );
  const queueCollapsed = useStoreSelector(
    terminal.store,
    (s) => s.isQueuedMessagesPanelCollapsed,
  );
  return (
    <>
      <Notifications
        startupWarnings={props.startupWarnings}
        updateInfo={props.updateInfo}
        history={history}
      />
      {(props.settings.merged.ui.showTodoPanel ?? true) ? (
        <TodoPanel width={width} collapsed={todoCollapsed} />
      ) : null}
      {queued.length > 0 ? (
        <QueuedMessagesPanel
          width={width}
          collapsed={queueCollapsed}
          messages={queued}
        />
      ) : null}
    </>
  );
}
