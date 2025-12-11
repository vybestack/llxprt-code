import type {
  ScrollBoxRenderable,
  TextareaRenderable,
} from '@vybestack/opentui-core';
import type { JSX } from 'react';
import { useRenderer } from '@vybestack/opentui-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CompletedToolCall,
  WaitingToolCall,
  ToolCallConfirmationDetails,
} from '@vybestack/llxprt-code-core';
import { useCompletionManager } from './features/completion';
import { usePromptHistory } from './features/chat';
import { useThemeManager } from './features/theme';
import type { ThemeDefinition } from './features/theme';
import type { SessionConfig } from './features/config';
import { useChatStore } from './hooks/useChatStore';
import { useInputManager } from './hooks/useInputManager';
import { useScrollManagement } from './hooks/useScrollManagement';
import { useStreamingLifecycle } from './hooks/useStreamingLifecycle';
import { useSelectionClipboard } from './hooks/useSelectionClipboard';
import { useAppCommands } from './hooks/useAppCommands';
import { useSuggestionSetup } from './hooks/useSuggestionSetup';
import { useSessionManager } from './hooks/useSessionManager';
import { usePersistentHistory } from './hooks/usePersistentHistory';
import { useToolApproval } from './hooks/useToolApproval';
import {
  useToolScheduler,
  type TrackedToolCall,
  type ScheduleFn,
} from './hooks/useToolScheduler';
import { continueStreamingAfterTools } from './hooks/useStreamingResponder';
import {
  useEnterSubmit,
  useFocusAndMount,
  useSuggestionKeybindings,
  useLineIdGenerator,
  useHistoryNavigation,
} from './hooks/useKeyboardHandlers';
import {
  ChatLayout,
  type PendingApprovalState,
  type ToolApprovalOutcome,
} from './ui/components/ChatLayout';
import { buildStatusLabel } from './ui/components/StatusBar';
import { CommandComponents } from './ui/components/CommandComponents';
import { Dialog, useDialog, Command, useCommand } from './uicontext';
import { useApprovalKeyboard } from './hooks/useApprovalKeyboard';
import { getLogger } from './lib/logger';

const logger = getLogger('nui:app');

/** Generate question text from confirmation details */
function getQuestionForConfirmation(
  details: ToolCallConfirmationDetails,
): string {
  switch (details.type) {
    case 'edit':
      return `Allow editing ${details.fileName}?`;
    case 'exec':
      return 'Allow executing this command?';
    case 'mcp':
      return `Allow MCP tool: ${details.serverName}/${details.toolName}?`;
    case 'info':
      return 'Confirm this action?';
  }
}

/** Generate preview text from confirmation details */
function getPreviewForConfirmation(
  details: ToolCallConfirmationDetails,
): string {
  switch (details.type) {
    case 'edit':
      return details.fileDiff;
    case 'exec':
      return details.command;
    case 'mcp':
      return `Server: ${details.serverName}\nTool: ${details.toolDisplayName}`;
    case 'info':
      return details.prompt;
  }
}

const HEADER_TEXT = "LLxprt Code - I'm here to help";

function AppInner(): JSX.Element {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const scheduleRef = useRef<ScheduleFn | null>(null);
  // Ref to access abortRef from useStreamingLifecycle (set after hook is called)
  const abortRefContainer = useRef<{ current: AbortController | null }>({
    current: null,
  });
  // Guard against concurrent continuation calls
  const continuationInProgressRef = useRef(false);
  const [sessionConfig, setSessionConfig] = useState<SessionConfig>({
    provider: 'openai',
  });
  const { themes, theme, setThemeBySlug } = useThemeManager();
  const renderer = useRenderer();

  const { session, sessionOptions, createSession } = useSessionManager();

  // Generate stable session ID for history (once per app instance)
  const historySessionIdRef = useRef(`nui-${Date.now()}`);

  // Initialize persistent history immediately using cwd, so history is available before profile load
  const { service: persistentHistory } = usePersistentHistory({
    workingDir: sessionOptions?.workingDir ?? process.cwd(),
    sessionId: historySessionIdRef.current,
  });

  const dialog = useDialog();
  const { trigger: triggerCommand } = useCommand();
  const {
    suggestions,
    selectedIndex,
    refresh: refreshCompletion,
    clear: clearCompletion,
    moveSelection,
    applySelection,
  } = useCompletionManager(textareaRef);
  const { record: recordHistory, handleHistoryKey } = usePromptHistory(
    textareaRef,
    { persistentHistory },
  );
  const makeLineId = useLineIdGenerator();
  const {
    entries,
    appendMessage,
    appendToMessage,
    appendToolCall,
    updateToolCall,
    clearEntries,
    promptCount,
    setPromptCount,
    responderWordCount,
    setResponderWordCount,
    streamState,
    setStreamState,
  } = useChatStore(makeLineId);

  // Create a ref for queueApprovalFromScheduler to break circular dependency
  const queueApprovalFromSchedulerRef = useRef<
    (
      callId: string,
      toolName: string,
      confirmationDetails: ToolCallConfirmationDetails,
    ) => void
  >(() => {
    /* placeholder - will be assigned later */
  });

  // Tool scheduler callbacks using refs to avoid circular dependencies
  const onToolsComplete = useCallback(
    async (completedTools: CompletedToolCall[]) => {
      logger.debug(
        'onToolsComplete called',
        'toolCount:',
        completedTools.length,
      );

      if (!session || completedTools.length === 0) {
        logger.debug(
          'onToolsComplete: no session or empty tools, setting idle',
        );
        setStreamState('idle');
        return;
      }

      // Guard against concurrent continuations - this can happen if multiple tool batches complete
      if (continuationInProgressRef.current) {
        logger.debug(
          'onToolsComplete: skipping, continuation already in progress',
        );
        return;
      }

      const signal = abortRefContainer.current.current?.signal;
      const scheduleFn = scheduleRef.current;

      logger.debug(
        'onToolsComplete: checking signal',
        'hasSignal:',
        !!signal,
        'aborted:',
        signal?.aborted,
        'hasScheduler:',
        !!scheduleFn,
      );

      if (signal && !signal.aborted && scheduleFn) {
        continuationInProgressRef.current = true;
        try {
          logger.debug('onToolsComplete: starting continueStreamingAfterTools');
          const hasMoreTools = await continueStreamingAfterTools(
            session,
            completedTools,
            signal,
            appendMessage,
            appendToMessage,
            appendToolCall,
            updateToolCall,
            setResponderWordCount,
            scheduleFn,
            setStreamState,
          );
          logger.debug(
            'onToolsComplete: continueStreamingAfterTools finished',
            'hasMoreTools:',
            hasMoreTools,
          );
        } finally {
          continuationInProgressRef.current = false;
        }
      } else {
        logger.debug(
          'onToolsComplete: signal aborted or no scheduler, setting idle',
        );
        setStreamState('idle');
      }
    },
    [
      session,
      appendMessage,
      appendToMessage,
      appendToolCall,
      updateToolCall,
      setResponderWordCount,
      setStreamState,
    ],
  );

  const onToolCallsUpdate = useCallback(
    (tools: TrackedToolCall[]) => {
      for (const tool of tools) {
        // Queue approval for tools awaiting approval
        if (tool.status === 'awaiting_approval') {
          const waitingTool = tool as WaitingToolCall;
          queueApprovalFromSchedulerRef.current(
            tool.request.callId,
            tool.request.name,
            waitingTool.confirmationDetails,
          );
        }
        // Update UI state for tool status changes
        switch (tool.status) {
          case 'validating':
          case 'scheduled':
          case 'executing':
            updateToolCall(tool.request.callId, { status: 'executing' });
            break;
          case 'success': {
            const completed = tool as CompletedToolCall;
            const update: { status: 'complete'; output?: string } = {
              status: 'complete',
            };
            if (completed.response.resultDisplay != null) {
              update.output =
                typeof completed.response.resultDisplay === 'string'
                  ? completed.response.resultDisplay
                  : JSON.stringify(completed.response.resultDisplay);
            }
            updateToolCall(tool.request.callId, update);
            break;
          }
          case 'error': {
            const errorTool = tool as CompletedToolCall;
            const errorUpdate: { status: 'error'; errorMessage?: string } = {
              status: 'error',
            };
            if (errorTool.response.error?.message !== undefined) {
              errorUpdate.errorMessage = errorTool.response.error.message;
            }
            updateToolCall(tool.request.callId, errorUpdate);
            break;
          }
          case 'cancelled':
            updateToolCall(tool.request.callId, { status: 'cancelled' });
            break;
          case 'awaiting_approval': {
            const waitingToolForUpdate = tool as WaitingToolCall;
            const details = waitingToolForUpdate.confirmationDetails;
            updateToolCall(tool.request.callId, {
              status: 'confirming',
              confirmation: {
                confirmationType: details.type,
                question: getQuestionForConfirmation(details),
                preview: getPreviewForConfirmation(details),
                canAllowAlways: true,
                coreDetails: details,
              },
            });
            break;
          }
        }
      }
    },
    [updateToolCall],
  );

  const { schedule, cancelAll, respondToConfirmation } = useToolScheduler(
    session?.config ?? null,
    onToolsComplete,
    onToolCallsUpdate,
  );

  // Now set up useToolApproval with the respondToConfirmation from useToolScheduler
  const {
    pendingApproval,
    queueApprovalFromScheduler,
    handleDecision,
    clearApproval,
  } = useToolApproval(respondToConfirmation);

  // Keep the ref in sync with the actual function
  useEffect(() => {
    queueApprovalFromSchedulerRef.current = queueApprovalFromScheduler;
  }, [queueApprovalFromScheduler]);

  // Ref to track current pendingApproval to avoid stale closures in keyboard handlers
  const pendingApprovalRef = useRef(pendingApproval);
  useEffect(() => {
    pendingApprovalRef.current = pendingApproval;
  }, [pendingApproval]);

  // Keep scheduleRef in sync
  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  const { mountedRef, abortRef, cancelStreaming, startStreamingResponder } =
    useStreamingLifecycle(
      appendMessage,
      appendToMessage,
      appendToolCall,
      updateToolCall,
      setResponderWordCount,
      setStreamState,
      schedule,
    );

  // Sync abortRef to the container so onToolsComplete can access it
  useEffect(() => {
    abortRefContainer.current = abortRef;
  }, [abortRef]);

  useFocusAndMount(textareaRef, mountedRef);

  const focusInput = useCallback(() => {
    textareaRef.current?.focus();
  }, []);
  const handleThemeSelect = useCallback(
    (t: ThemeDefinition) => {
      setThemeBySlug(t.slug);
    },
    [setThemeBySlug],
  );

  const {
    fetchModelItems,
    fetchProviderItems,
    applyTheme,
    handleConfigCommand,
  } = useAppCommands({
    sessionConfig,
    setSessionConfig,
    themes,
    setThemeBySlug,
    appendMessage,
    createSession,
  });

  useSuggestionSetup(themes);

  const { autoFollow, setAutoFollow, handleContentChange, handleMouseScroll } =
    useScrollManagement(scrollRef);

  useEffect(() => {
    handleContentChange();
  }, [handleContentChange, entries.length]);

  const handleCommand = useCallback(
    async (command: string) => {
      const configResult = await handleConfigCommand(command);
      if (configResult.handled) return true;
      if (command.startsWith('/theme')) {
        const parts = command.trim().split(/\s+/);
        if (parts.length === 1) return triggerCommand('/theme');
        applyTheme(parts.slice(1).join(' '));
        return true;
      }
      if (command === '/clear') {
        // Reset the model's conversation history if session exists
        if (session) {
          try {
            await session.getClient().resetChat();
          } catch (error) {
            logger.error('Failed to reset chat:', error);
          }
        }
        // Clear the UI entries and reset counts
        clearEntries();
        // Clear the terminal screen
        console.clear();
        return true;
      }
      return triggerCommand(command);
    },
    [applyTheme, handleConfigCommand, triggerCommand, session, clearEntries],
  );

  const {
    inputLineCount,
    enforceInputLineBounds,
    handleSubmit,
    handleTabComplete,
  } = useInputManager(
    textareaRef,
    appendMessage,
    setPromptCount,
    setAutoFollow,
    (prompt) => {
      if (!session) {
        appendMessage(
          'system',
          'No active session. Load a profile first with /profile load <name>',
        );
        return Promise.resolve();
      }
      // Reset continuation guard when starting a new prompt
      continuationInProgressRef.current = false;
      // Note: AbortController is created by useStreamingResponder internally
      return startStreamingResponder(prompt, session);
    },
    refreshCompletion,
    clearCompletion,
    applySelection,
    handleCommand,
    recordHistory,
  );

  const statusLabel = useMemo(
    () => buildStatusLabel(streamState, autoFollow),
    [autoFollow, streamState],
  );
  const handleMouseUp = useSelectionClipboard(renderer);
  const handleSubmitWrapped = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const handleCancelAll = useCallback(() => {
    logger.debug('handleCancelAll called');
    cancelStreaming();
    cancelAll();
    // cancelStreaming already aborts abortRef and sets idle
  }, [cancelStreaming, cancelAll]);

  // Approval keyboard handling - select option or cancel
  // Uses ref to avoid stale closure issues with pendingApproval
  const handleApprovalSelectKeyboard = useCallback(
    (outcome: ToolApprovalOutcome) => {
      const current = pendingApprovalRef.current;
      logger.debug(
        'handleApprovalSelectKeyboard called',
        'outcome:',
        outcome,
        'callId:',
        current?.callId,
      );
      if (current) {
        handleDecision(current.callId, outcome);
        // If user cancelled, also cancel all tools and streaming to break the loop
        if (outcome === 'cancel') {
          handleCancelAll();
        }
      }
    },
    [handleDecision, handleCancelAll],
  );

  // Callback for ChatLayout inline approval UI
  const handleApprovalSelectFromUI = useCallback(
    (callId: string, outcome: ToolApprovalOutcome) => {
      handleDecision(callId, outcome);
      // If user cancelled, also cancel all tools and streaming to break the loop
      if (outcome === 'cancel') {
        handleCancelAll();
      }
    },
    [handleDecision, handleCancelAll],
  );

  const handleApprovalCancel = useCallback(() => {
    logger.debug('handleApprovalCancel called');
    clearApproval();
    // Also cancel all tools and streaming when Esc is pressed during approval
    handleCancelAll();
  }, [clearApproval, handleCancelAll]);

  // Wire up keyboard navigation for inline approval
  // This must be called before useEnterSubmit to intercept keys when approval is active
  const { selectedIndex: approvalSelectedIndex } = useApprovalKeyboard({
    isActive: pendingApproval !== null,
    canAllowAlways: true, // We allow "always" for all tools currently
    onSelect: handleApprovalSelectKeyboard,
    onCancel: handleApprovalCancel,
  });

  // Disable normal enter submit when approval is active
  useEnterSubmit(
    () => void handleSubmit(),
    dialog.isOpen || pendingApproval !== null,
  );
  useSuggestionKeybindings(
    dialog.isOpen || pendingApproval !== null ? 0 : suggestions.length,
    moveSelection,
    handleTabComplete,
    handleCancelAll,
    () => {
      textareaRef.current?.clear();
      enforceInputLineBounds();
      return Promise.resolve();
    },
    () => streamState === 'busy',
    () => (textareaRef.current?.plainText ?? '').trim() === '',
  );
  useHistoryNavigation(
    dialog.isOpen || pendingApproval !== null,
    suggestions.length,
    handleHistoryKey,
  );

  // Build inline approval state for ChatLayout
  const pendingApprovalState: PendingApprovalState | undefined = pendingApproval
    ? { callId: pendingApproval.callId, selectedIndex: approvalSelectedIndex }
    : undefined;

  return (
    <>
      <CommandComponents
        fetchModelItems={fetchModelItems}
        fetchProviderItems={fetchProviderItems}
        sessionConfig={sessionConfig}
        setSessionConfig={setSessionConfig}
        appendMessage={appendMessage}
        themes={themes}
        currentTheme={theme}
        onThemeSelect={handleThemeSelect}
        focusInput={focusInput}
      />
      <ChatLayout
        headerText={HEADER_TEXT}
        entries={entries}
        scrollRef={scrollRef}
        autoFollow={autoFollow}
        textareaRef={textareaRef}
        inputLineCount={inputLineCount}
        enforceInputLineBounds={enforceInputLineBounds}
        handleSubmit={handleSubmitWrapped}
        statusLabel={statusLabel}
        promptCount={promptCount}
        responderWordCount={responderWordCount}
        streamState={streamState}
        onScroll={handleMouseScroll}
        onMouseUp={handleMouseUp}
        suggestions={suggestions}
        selectedSuggestion={selectedIndex}
        theme={theme}
        inputDisabled={pendingApproval !== null}
        {...(pendingApprovalState
          ? { pendingApproval: pendingApprovalState }
          : {})}
        {...(pendingApprovalState
          ? { onApprovalSelect: handleApprovalSelectFromUI }
          : {})}
      />
    </>
  );
}

function AppWithCommand(): JSX.Element {
  const dialog = useDialog();
  return (
    <Command dialogContext={dialog}>
      <AppInner />
    </Command>
  );
}

export function App(): JSX.Element {
  return (
    <Dialog>
      <AppWithCommand />
    </Dialog>
  );
}
