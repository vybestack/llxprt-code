/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
} from 'react';
import { type DOMElement, measureElement, useStdin, useStdout } from 'ink';
import {
  StreamingState,
  MessageType,
  ToolCallStatus,
  type HistoryItemWithoutId,
  type HistoryItem,
  type IndividualToolCallDisplay,
} from './types.js';
import { type ModelsDialogData } from './commands/types.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { useResponsive } from './hooks/useResponsive.js';
import { useGeminiStream } from './hooks/useGeminiStream.js';
import { useLoadingIndicator } from './hooks/useLoadingIndicator.js';
import { useThemeCommand } from './hooks/useThemeCommand.js';
import { useAuthCommand } from './hooks/useAuthCommand.js';
import { useFolderTrust } from './hooks/useFolderTrust.js';
import { useWelcomeOnboarding } from './hooks/useWelcomeOnboarding.js';
import { useIdeTrustListener } from './hooks/useIdeTrustListener.js';
import { useEditorSettings } from './hooks/useEditorSettings.js';
import { useSlashCommandProcessor } from './hooks/slashCommandProcessor.js';
import { useAutoAcceptIndicator } from './hooks/useAutoAcceptIndicator.js';
import { useConsoleMessages } from './hooks/useConsoleMessages.js';
import { useExtensionAutoUpdate } from './hooks/useExtensionAutoUpdate.js';
import { useExtensionUpdates } from './hooks/useExtensionUpdates.js';
import {
  useTodoContinuation,
  type TodoContinuationHook,
} from './hooks/useTodoContinuation.js';
import {
  isMouseEventsActive,
  setMouseEventsActive,
  disableMouseEvents,
  enableMouseEvents,
} from './utils/mouse.js';
import { loadHierarchicalLlxprtMemory } from '../config/config.js';
import {
  DEFAULT_HISTORY_MAX_BYTES,
  DEFAULT_HISTORY_MAX_ITEMS,
} from '../constants/historyLimits.js';
import { SHELL_COMMAND_NAME, SHELL_NAME } from './constants.js';
import { LoadedSettings, SettingScope } from '../config/settings.js';
import { ConsolePatcher } from './utils/ConsolePatcher.js';
import { registerCleanup } from '../utils/cleanup.js';
import { useHistory } from './hooks/useHistoryManager.js';
import { useInputHistoryStore } from './hooks/useInputHistoryStore.js';
import { useMemoryMonitor } from './hooks/useMemoryMonitor.js';
import {
  useTodoPausePreserver,
  TodoPausePreserver,
} from './hooks/useTodoPausePreserver.js';
import process from 'node:process';
import {
  getErrorMessage,
  type Config,
  getAllLlxprtMdFilenames,
  isEditorAvailable,
  EditorType,
  type IdeContext,
  ideContext,
  // type IdeInfo, // TODO: Fix IDE integration
  getSettingsService,
  DebugLogger,
  uiTelemetryService,
  SessionPersistenceService,
  type PersistedSession,
  type IContent,
  type ToolCallBlock,
  type ToolResponseBlock,
  coreEvents,
  CoreEvent,
  type UserFeedbackPayload,
  ShellExecutionService,
} from '@vybestack/llxprt-code-core';
import { IdeIntegrationNudgeResult } from './IdeIntegrationNudge.js';
import { useLogger } from './hooks/useLogger.js';
import { useSessionStats } from './contexts/SessionContext.js';
import { useGitBranchName } from './hooks/useGitBranchName.js';
import { useFocus } from './hooks/useFocus.js';
import { useBracketedPaste } from './hooks/useBracketedPaste.js';
import { useTextBuffer } from './components/shared/text-buffer.js';
import { SubagentView } from './components/SubagentManagement/types.js';
import { useVimMode } from './contexts/VimModeContext.js';
import { useVim } from './hooks/vim.js';
import { useKeypress, Key } from './hooks/useKeypress.js';
import { keyMatchers, Command } from './keyMatchers.js';
import * as fs from 'fs';
import { type AppState, type AppAction } from './reducers/appReducer.js';
import { UpdateObject } from './utils/updateCheck.js';
import ansiEscapes from 'ansi-escapes';
import { useSettingsCommand } from './hooks/useSettingsCommand.js';
import { setUpdateHandler } from '../utils/handleAutoUpdate.js';
import { appEvents, AppEvent } from '../utils/events.js';
import { useRuntimeApi } from './contexts/RuntimeContext.js';
import { submitOAuthCode } from './oauth-submission.js';
import { useProviderDialog } from './hooks/useProviderDialog.js';
import { useLoadProfileDialog } from './hooks/useLoadProfileDialog.js';
import { useCreateProfileDialog } from './hooks/useCreateProfileDialog.js';
import { useProfileManagement } from './hooks/useProfileManagement.js';
import { useToolsDialog } from './hooks/useToolsDialog.js';
import {
  shouldUpdateTokenMetrics,
  toTokenMetricsSnapshot,
  type TokenMetricsSnapshot,
} from './utils/tokenMetricsTracker.js';
import { useStaticHistoryRefresh } from './hooks/useStaticHistoryRefresh.js';
import { useTodoContext } from './contexts/TodoContext.js';
import { useWorkspaceMigration } from './hooks/useWorkspaceMigration.js';
import { useFlickerDetector } from './hooks/useFlickerDetector.js';
import { useMouseSelection } from './hooks/useMouseSelection.js';
import { isWorkspaceTrusted } from '../config/trustedFolders.js';
import { globalOAuthUI } from '../auth/global-oauth-ui.js';
import { UIStateProvider, type UIState } from './contexts/UIStateContext.js';
import {
  UIActionsProvider,
  type UIActions,
} from './contexts/UIActionsContext.js';
import { DefaultAppLayout } from './layouts/DefaultAppLayout.js';
import {
  disableBracketedPaste,
  enableBracketedPaste,
} from './utils/bracketedPaste.js';
import { enableSupportedProtocol } from './utils/kittyProtocolDetector.js';
import { restoreTerminalProtocolsSync } from './utils/terminalProtocolCleanup.js';
import {
  ENABLE_FOCUS_TRACKING,
  DISABLE_FOCUS_TRACKING,
  SHOW_CURSOR,
} from './utils/terminalSequences.js';
import { calculateMainAreaWidth } from './utils/ui-sizing.js';

const CTRL_EXIT_PROMPT_DURATION_MS = 1000;
const QUEUE_ERROR_DISPLAY_DURATION_MS = 3000;
const debug = new DebugLogger('llxprt:ui:appcontainer');
const selectionLogger = new DebugLogger('llxprt:ui:selection');

interface AppContainerProps {
  config: Config;
  settings: LoadedSettings;
  startupWarnings?: string[];
  version: string;
  appState: AppState;
  appDispatch: React.Dispatch<AppAction>;
  restoredSession?: PersistedSession;
}

function isToolExecuting(pendingHistoryItems: HistoryItemWithoutId[]) {
  return pendingHistoryItems.some((item) => {
    if (item && item.type === 'tool_group') {
      return item.tools.some(
        (tool) => ToolCallStatus.Executing === tool.status,
      );
    }
    return false;
  });
}

// Valid history item types for session restore validation (must be module-level for stable reference)
const VALID_HISTORY_TYPES = new Set([
  'user',
  'gemini',
  'gemini_content',
  'oauth_url',
  'info',
  'error',
  'warning',
  'about',
  'help',
  'stats',
  'model_stats',
  'tool_stats',
  'cache_stats',
  'lb_stats',
  'quit',
  'tool_group',
  'user_shell',
  'compression',
  'extensions_list',
  'tools_list',
  'mcp_status',
  'chat_list',
]);

export const AppContainer = (props: AppContainerProps) => {
  debug.log('AppContainer architecture active (v2)');
  const {
    config,
    settings,
    startupWarnings = [],
    appState,
    appDispatch,
    restoredSession,
  } = props;
  const runtime = useRuntimeApi();
  const isFocused = useFocus();
  const { isNarrow } = useResponsive();
  useBracketedPaste();
  const [updateInfo, setUpdateInfo] = useState<UpdateObject | null>(null);
  const { stdout } = useStdout();
  const { stdin, setRawMode } = useStdin();
  const nightly = props.version.includes('nightly'); // TODO: Use for nightly-specific features
  const historyLimits = useMemo(
    () => ({
      maxItems:
        typeof settings.merged.ui?.historyMaxItems === 'number'
          ? settings.merged.ui.historyMaxItems
          : DEFAULT_HISTORY_MAX_ITEMS,
      maxBytes:
        typeof settings.merged.ui?.historyMaxBytes === 'number'
          ? settings.merged.ui.historyMaxBytes
          : DEFAULT_HISTORY_MAX_BYTES,
    }),
    [settings.merged.ui?.historyMaxItems, settings.merged.ui?.historyMaxBytes],
  );
  const { history, addItem, clearItems, loadHistory } =
    useHistory(historyLimits);
  useMemoryMonitor({ addItem });
  const { todos, updateTodos } = useTodoContext();
  const todoPauseController = useMemo(() => new TodoPausePreserver(), []);
  const todoContinuationRef = useRef<Pick<
    TodoContinuationHook,
    'handleTodoPause' | 'clearPause'
  > | null>(null);
  const registerTodoPause = useCallback(() => {
    todoPauseController.registerTodoPause();
    todoContinuationRef.current?.handleTodoPause('paused by model');
  }, [todoPauseController]);

  const [idePromptAnswered, setIdePromptAnswered] = useState(false);
  const currentIDE = config.getIdeClient()?.getCurrentIde();
  useEffect(() => {
    const ideClient = config.getIdeClient();
    if (ideClient) {
      registerCleanup(() => ideClient.disconnect());
    }
  }, [config]);

  const shouldShowIdePrompt =
    currentIDE &&
    !config.getIdeMode() &&
    !settings.merged.hasSeenIdeIntegrationNudge &&
    !idePromptAnswered;

  useEffect(() => {
    const cleanup = setUpdateHandler(addItem, setUpdateInfo);

    // Attach addItem to OAuth providers for displaying auth URLs
    if (addItem) {
      const oauthManager = runtime.getCliOAuthManager();
      if (oauthManager) {
        const providersMap = (
          oauthManager as unknown as { providers?: Map<string, unknown> }
        ).providers;
        if (providersMap instanceof Map) {
          for (const provider of providersMap.values()) {
            const candidate = provider as {
              setAddItem?: (callback: typeof addItem) => void;
            };
            candidate.setAddItem?.(addItem);
          }
        }
      }
    }

    return cleanup;
  }, [addItem, runtime]);

  // Set global OAuth addItem callback for all OAuth flows
  useEffect(() => {
    (global as Record<string, unknown>).__oauth_add_item = addItem;
    globalOAuthUI.setAddItem(addItem);
    return () => {
      delete (global as Record<string, unknown>).__oauth_add_item;
      globalOAuthUI.clearAddItem();
    };
  }, [addItem]);

  const {
    consoleMessages,
    handleNewMessage,
    clearConsoleMessages: clearConsoleMessagesState,
  } = useConsoleMessages();

  useExtensionAutoUpdate({
    settings,
    onConsoleMessage: handleNewMessage,
  });

  // Handle core event system for surfacing internal errors
  useEffect(() => {
    const handleUserFeedback = (payload: UserFeedbackPayload) => {
      const messageType =
        payload.severity === 'error'
          ? 'error'
          : payload.severity === 'warning'
            ? 'warn'
            : 'info';
      handleNewMessage({
        type: messageType,
        content: payload.message,
        count: 1,
      });
    };

    coreEvents.on(CoreEvent.UserFeedback, handleUserFeedback);
    coreEvents.drainFeedbackBacklog();

    return () => {
      coreEvents.off(CoreEvent.UserFeedback, handleUserFeedback);
    };
  }, [handleNewMessage]);

  useEffect(() => {
    const consolePatcher = new ConsolePatcher({
      onNewMessage: handleNewMessage,
      debugMode: config.getDebugMode(),
    });
    consolePatcher.patch();
    registerCleanup(consolePatcher.cleanup);
  }, [handleNewMessage, config]);

  const { stats: sessionStats, updateHistoryTokenCount } = useSessionStats();
  const historyTokenCleanupRef = useRef<(() => void) | null>(null);
  const lastHistoryServiceRef = useRef<unknown>(null);
  const lastPublishedHistoryTokensRef = useRef<number | null>(null);
  const tokenLogger = useMemo(
    () => new DebugLogger('llxprt:ui:tokentracking'),
    [],
  );

  // Set up history token count listener
  useEffect(() => {
    let intervalCleared = false;

    // Poll continuously to detect when the history service changes (e.g., after compression)
    const checkInterval = setInterval(() => {
      if (intervalCleared) return;

      const geminiClient = config.getGeminiClient();

      // Check if chat is initialized first
      if (geminiClient?.hasChatInitialized?.()) {
        const historyService = geminiClient.getHistoryService?.();

        if (!historyService && lastHistoryServiceRef.current === null) {
          tokenLogger.debug(() => 'No history service available yet');
        }

        // Check if we have a new history service instance (happens after compression)
        if (
          historyService &&
          historyService !== lastHistoryServiceRef.current
        ) {
          tokenLogger.debug(
            () => 'Found new history service, setting up listener',
          );

          // Clean up old listener if it exists
          if (historyTokenCleanupRef.current) {
            historyTokenCleanupRef.current();
            historyTokenCleanupRef.current = null;
          }

          // Store reference to current history service
          lastHistoryServiceRef.current = historyService;

          const handleTokensUpdated = (event: { totalTokens: number }) => {
            tokenLogger.debug(
              () =>
                `Received tokensUpdated event: totalTokens=${event.totalTokens}`,
            );
            if (event.totalTokens !== lastPublishedHistoryTokensRef.current) {
              lastPublishedHistoryTokensRef.current = event.totalTokens;
              updateHistoryTokenCount(event.totalTokens);
            }
          };

          historyService.on('tokensUpdated', handleTokensUpdated);

          // Initialize with current token count
          const currentTokens = historyService.getTotalTokens();
          tokenLogger.debug(() => `Initial token count: ${currentTokens}`);
          lastPublishedHistoryTokensRef.current = currentTokens;
          updateHistoryTokenCount(currentTokens);

          // Store cleanup function for later
          historyTokenCleanupRef.current = () => {
            historyService.off('tokensUpdated', handleTokensUpdated);
          };
        }
      }
    }, 100); // Check every 100ms

    return () => {
      clearInterval(checkInterval);
      intervalCleared = true;
      // Clean up the event listener if it was set up
      if (historyTokenCleanupRef.current) {
        historyTokenCleanupRef.current();
        historyTokenCleanupRef.current = null;
      }
      lastHistoryServiceRef.current = null;
      lastPublishedHistoryTokensRef.current = null;
    };
  }, [config, updateHistoryTokenCount, tokenLogger]);

  // Convert IContent[] to UI HistoryItem[] for display
  const convertToUIHistory = useCallback(
    (history: IContent[]): HistoryItem[] => {
      const items: HistoryItem[] = [];
      let id = 1;

      // First pass: collect all tool responses by callId for lookup
      const toolResponseMap = new Map<string, ToolResponseBlock>();
      for (const content of history) {
        if (content.speaker === 'tool') {
          const responseBlocks = content.blocks.filter(
            (b): b is ToolResponseBlock => b.type === 'tool_response',
          );
          for (const resp of responseBlocks) {
            toolResponseMap.set(resp.callId, resp);
          }
        }
      }

      for (const content of history) {
        // Extract text blocks
        const textBlocks = content.blocks.filter(
          (b): b is { type: 'text'; text: string } => b.type === 'text',
        );
        const text = textBlocks.map((b) => b.text).join('\n');

        // Extract tool call blocks for AI
        const toolCallBlocks = content.blocks.filter(
          (b): b is ToolCallBlock => b.type === 'tool_call',
        );

        if (content.speaker === 'human' && text) {
          items.push({
            id: id++,
            type: 'user',
            text,
          } as HistoryItem);
        } else if (content.speaker === 'ai') {
          // Add text response if present
          if (text) {
            items.push({
              id: id++,
              type: 'gemini',
              text,
              model: content.metadata?.model,
            } as HistoryItem);
          }
          // Add tool calls as proper tool_group items
          if (toolCallBlocks.length > 0) {
            const tools: IndividualToolCallDisplay[] = toolCallBlocks.map(
              (tc) => {
                const response = toolResponseMap.get(tc.id);
                // Format result display from tool response
                let resultDisplay: string | undefined;
                if (response) {
                  if (response.error) {
                    resultDisplay = `Error: ${response.error}`;
                  } else if (response.result !== undefined) {
                    // Convert result to string for display
                    const result = response.result as Record<string, unknown>;
                    if (typeof result === 'string') {
                      resultDisplay = result;
                    } else if (result && typeof result === 'object') {
                      // Handle common result formats
                      if (
                        'output' in result &&
                        typeof result.output === 'string'
                      ) {
                        resultDisplay = result.output;
                      } else {
                        resultDisplay = JSON.stringify(result, null, 2);
                      }
                    }
                  }
                }
                return {
                  callId: tc.id,
                  name: tc.name,
                  description: tc.description || '',
                  resultDisplay,
                  status: response
                    ? ToolCallStatus.Success
                    : ToolCallStatus.Pending,
                  confirmationDetails: undefined,
                };
              },
            );
            items.push({
              id: id++,
              type: 'tool_group',
              agentId: 'primary',
              tools,
            } as HistoryItem);
          }
        }
        // Skip tool speaker entries - already processed via map
      }

      return items;
    },
    [],
  );

  // Session restoration for --continue functionality
  // Split into two parts: UI restoration (immediate) and core history (when available)
  const sessionRestoredRef = useRef(false);
  const coreHistoryRestoredRef = useRef(false);

  /**
   * Validates that an item matches the HistoryItem schema.
   * Uses duck typing for flexibility with minor schema changes.
   */
  const isValidHistoryItem = useCallback(
    (item: unknown): item is HistoryItem => {
      if (typeof item !== 'object' || item === null) {
        return false;
      }

      const obj = item as Record<string, unknown>;

      // Required fields
      if (typeof obj.id !== 'number') return false;
      if (typeof obj.type !== 'string') return false;

      // Check if type is valid (allow unknown types from newer versions)
      if (!VALID_HISTORY_TYPES.has(obj.type)) {
        debug.warn(`Unknown history item type: ${obj.type}`);
        // Allow unknown types to pass - might be from newer version
      }

      // Type-specific validation
      switch (obj.type) {
        case 'user':
        case 'gemini':
        case 'gemini_content':
        case 'info':
        case 'warning':
        case 'error':
        case 'user_shell':
          // Text types should have text (but might be empty)
          return typeof obj.text === 'string' || obj.text === undefined;

        case 'tool_group':
          // Tool groups must have tools array
          if (!Array.isArray(obj.tools)) return false;
          return obj.tools.every(
            (tool) =>
              typeof tool === 'object' &&
              tool !== null &&
              typeof (tool as Record<string, unknown>).callId === 'string' &&
              typeof (tool as Record<string, unknown>).name === 'string',
          );

        default:
          // For other types, just having id and type is enough
          return true;
      }
    },
    [],
  );

  /**
   * Validates all items in a history array.
   * Returns valid items, filters invalid ones.
   */
  const validateUIHistory = useCallback(
    (items: unknown[]): { valid: HistoryItem[]; invalidCount: number } => {
      const valid: HistoryItem[] = [];
      let invalidCount = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (isValidHistoryItem(item)) {
          valid.push(item);
        } else {
          debug.warn(`Invalid history item at index ${i}:`, item);
          invalidCount++;
        }
      }

      return { valid, invalidCount };
    },
    [isValidHistoryItem],
  );

  // Part 1: Restore UI history immediately on mount
  useEffect(() => {
    if (!restoredSession || sessionRestoredRef.current) {
      return;
    }
    sessionRestoredRef.current = true;

    try {
      // Use saved UI history if available (preserves exact display), otherwise convert from core history
      let uiHistoryItems: HistoryItem[];
      let usedFallback = false;
      let invalidCount = 0;

      if (
        restoredSession.uiHistory &&
        Array.isArray(restoredSession.uiHistory)
      ) {
        // Validate UI history items before loading
        const validation = validateUIHistory(restoredSession.uiHistory);
        invalidCount = validation.invalidCount;

        if (invalidCount > 0) {
          debug.warn(`${invalidCount} invalid UI history items found`);

          if (validation.valid.length === 0) {
            // All items invalid - fall back to conversion
            debug.warn('All UI history invalid, falling back to conversion');
            uiHistoryItems = convertToUIHistory(restoredSession.history);
            usedFallback = true;
          } else {
            // Some items valid - use them
            uiHistoryItems = validation.valid;
          }
        } else {
          uiHistoryItems = validation.valid;
        }

        if (!usedFallback) {
          debug.log(`Using saved UI history (${uiHistoryItems.length} items)`);
        }
      } else {
        uiHistoryItems = convertToUIHistory(restoredSession.history);
        usedFallback = true;
        debug.log(
          `Converted core history to UI (${uiHistoryItems.length} items)`,
        );
      }
      loadHistory(uiHistoryItems);

      debug.log(
        `Restored ${restoredSession.history.length} messages (${uiHistoryItems.length} UI items) for display`,
      );

      // Add info message about restoration
      const sessionTime = new Date(
        restoredSession.updatedAt || restoredSession.createdAt,
      ).toLocaleString();
      const source = usedFallback
        ? 'converted from core'
        : 'restored from UI cache';
      addItem(
        {
          type: 'info',
          text: `Session restored (${uiHistoryItems.length} messages ${source} from ${sessionTime})`,
        },
        Date.now(),
      );

      // Warn if some items were corrupted
      if (invalidCount > 0 && !usedFallback) {
        addItem(
          {
            type: 'warning',
            text: `${invalidCount} corrupted message(s) could not be displayed.`,
          },
          Date.now(),
        );
      }
    } catch (err) {
      debug.error('Failed to restore UI history:', err);
      addItem(
        {
          type: 'warning',
          text: 'Failed to restore previous session display.',
        },
        Date.now(),
      );
    }
  }, [
    restoredSession,
    convertToUIHistory,
    loadHistory,
    addItem,
    validateUIHistory,
  ]);

  // Part 2: Restore core history using the new restoreHistory API (for AI context)
  // P0 Fix: Use synchronous API that ensures chat is initialized before returning
  useEffect(() => {
    if (!restoredSession || coreHistoryRestoredRef.current) {
      return;
    }

    coreHistoryRestoredRef.current = true;

    const geminiClient = config.getGeminiClient();
    if (!geminiClient) {
      debug.error('GeminiClient not available for session restore');
      addItem(
        {
          type: 'error',
          text: 'Could not restore AI context - client not initialized.',
        },
        Date.now(),
      );
      return;
    }

    // Use the new restoreHistory API that ensures chat/content generator are ready
    geminiClient
      .restoreHistory(restoredSession.history)
      .then(() => {
        debug.log(
          `Restored ${restoredSession.history.length} items to core history for AI context`,
        );
      })
      .catch((err: unknown) => {
        debug.error('Failed to restore core history:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);

        // Surface specific error details to help diagnose the issue
        let userMessage =
          'Previous session display restored, but AI context could not be loaded. The AI will not remember the previous conversation.';
        if (
          errorMessage.includes('Content generator') ||
          errorMessage.includes('auth')
        ) {
          userMessage += ' (Authentication may be required)';
        } else if (errorMessage.includes('Chat initialization')) {
          userMessage += ' (Chat service unavailable)';
        }

        addItem(
          {
            type: 'warning',
            text: userMessage,
          },
          Date.now(),
        );
      });
  }, [restoredSession, config, addItem]);

  const [_staticNeedsRefresh, setStaticNeedsRefresh] = useState(false);
  const [staticKey, setStaticKey] = useState(0);
  const externalEditorStateRef = useRef<{
    paused: boolean;
    rawModeManaged: boolean;
  } | null>(null);

  const useAlternateBuffer =
    settings.merged.ui?.useAlternateBuffer === true &&
    !config.getScreenReader();

  const restoreTerminalStateAfterEditor = useCallback(() => {
    const editorState = externalEditorStateRef.current;
    if (!stdin) {
      return;
    }

    const readStream = stdin as NodeJS.ReadStream;

    if (editorState?.paused && typeof readStream.resume === 'function') {
      readStream.resume();
    }

    if (editorState?.rawModeManaged && setRawMode) {
      try {
        setRawMode(true);
      } catch (error) {
        console.error('Failed to re-enable raw mode:', error);
      }
    }

    externalEditorStateRef.current = null;
  }, [setRawMode, stdin]);

  const refreshStatic = useCallback(() => {
    if (useAlternateBuffer) {
      restoreTerminalStateAfterEditor();

      enableBracketedPaste();
      enableSupportedProtocol();
      stdout.write(ENABLE_FOCUS_TRACKING);
      stdout.write(SHOW_CURSOR);
      return;
    }

    if (settings.merged.ui?.useAlternateBuffer === false) {
      stdout.write(ansiEscapes.clearTerminal);
    }
    setStaticKey((prev) => prev + 1);

    restoreTerminalStateAfterEditor();

    // Re-send terminal control sequences
    enableBracketedPaste();
    enableSupportedProtocol();
    stdout.write(ENABLE_FOCUS_TRACKING);
    stdout.write(SHOW_CURSOR);
  }, [
    restoreTerminalStateAfterEditor,
    setStaticKey,
    stdout,
    useAlternateBuffer,
    settings,
  ]);

  const handleExternalEditorOpen = useCallback(() => {
    if (!stdin) {
      return;
    }

    const readStream = stdin as NodeJS.ReadStream;

    externalEditorStateRef.current = {
      paused: false,
      rawModeManaged: false,
    };

    if (typeof readStream.pause === 'function') {
      readStream.pause();
      externalEditorStateRef.current.paused = true;
    }

    if (setRawMode) {
      try {
        setRawMode(false);
        externalEditorStateRef.current.rawModeManaged = true;
      } catch (error) {
        console.error('Failed to disable raw mode:', error);
      }
    }

    disableBracketedPaste();
    stdout.write(DISABLE_FOCUS_TRACKING);
    stdout.write(SHOW_CURSOR);
  }, [setRawMode, stdin, stdout]);
  useStaticHistoryRefresh(history, refreshStatic);

  const [llxprtMdFileCount, setLlxprtMdFileCount] = useState<number>(0);
  const [debugMessage, setDebugMessage] = useState<string>('');
  const [themeError, _setThemeError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [editorError, _setEditorError] = useState<string | null>(null);
  const [footerHeight, setFooterHeight] = useState<number>(0);

  // Token metrics state for live updates
  const [tokenMetrics, setTokenMetrics] = useState({
    tokensPerMinute: 0,
    throttleWaitTimeMs: 0,
    sessionTokenTotal: 0,
  });
  const tokenMetricsSnapshotRef = useRef<TokenMetricsSnapshot | null>(null);
  const [_corgiMode, setCorgiMode] = useState(false);
  const [_isTrustedFolderState, _setIsTrustedFolder] = useState(
    isWorkspaceTrusted(settings.merged),
  );
  const [currentModel, setCurrentModel] = useState(config.getModel());
  const [shellModeActive, setShellModeActive] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState<boolean>(false);
  const [showToolDescriptions, setShowToolDescriptions] =
    useState<boolean>(false);
  const [showDebugProfiler, setShowDebugProfiler] = useState(false);
  const [copyModeEnabled, setCopyModeEnabled] = useState(false);
  const [renderMarkdown, setRenderMarkdown] = useState<boolean>(true);
  const [isTodoPanelCollapsed, setIsTodoPanelCollapsed] = useState(false);

  const [ctrlCPressedOnce, setCtrlCPressedOnce] = useState(false);
  const [quittingMessages, setQuittingMessages] = useState<
    HistoryItem[] | null
  >(null);
  const ctrlCTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [ctrlDPressedOnce, setCtrlDPressedOnce] = useState(false);
  const ctrlDTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [constrainHeight, setConstrainHeight] = useState<boolean>(true);
  const [showPrivacyNotice, setShowPrivacyNotice] = useState<boolean>(false);
  const [ideContextState, setIdeContextState] = useState<
    IdeContext | undefined
  >();
  const [showEscapePrompt, setShowEscapePrompt] = useState(false);
  const [showIdeRestartPrompt, setShowIdeRestartPrompt] = useState(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isPermissionsDialogOpen, setIsPermissionsDialogOpen] = useState(false);
  const [embeddedShellFocused, setEmbeddedShellFocused] = useState(false);

  const openPermissionsDialog = useCallback(() => {
    setIsPermissionsDialogOpen(true);
  }, []);

  const closePermissionsDialog = useCallback(() => {
    setIsPermissionsDialogOpen(false);
  }, []);

  const [isLoggingDialogOpen, setIsLoggingDialogOpen] = useState(false);
  const [loggingDialogData, setLoggingDialogData] = useState<{
    entries: unknown[];
  }>({ entries: [] });

  // Subagent dialog state
  const [isSubagentDialogOpen, setIsSubagentDialogOpen] = useState(false);
  const [subagentDialogInitialView, setSubagentDialogInitialView] = useState<
    SubagentView | undefined
  >(undefined);
  const [subagentDialogInitialName, setSubagentDialogInitialName] = useState<
    string | undefined
  >(undefined);

  // Models dialog state
  const [isModelsDialogOpen, setIsModelsDialogOpen] = useState(false);
  const [modelsDialogData, setModelsDialogData] = useState<
    ModelsDialogData | undefined
  >(undefined);

  // Queue error message state (for preventing slash/shell commands from being queued)
  const [queueErrorMessage, setQueueErrorMessage] = useState<string | null>(
    null,
  );

  const openLoggingDialog = useCallback((data?: { entries: unknown[] }) => {
    setLoggingDialogData(data || { entries: [] });
    setIsLoggingDialogOpen(true);
  }, []);

  const closeLoggingDialog = useCallback(() => {
    setIsLoggingDialogOpen(false);
  }, []);

  const openSubagentDialog = useCallback(
    (initialView?: SubagentView, initialName?: string) => {
      setSubagentDialogInitialView(initialView);
      setSubagentDialogInitialName(initialName);
      setIsSubagentDialogOpen(true);
    },
    [],
  );

  const closeSubagentDialog = useCallback(() => {
    setIsSubagentDialogOpen(false);
    setSubagentDialogInitialView(undefined);
    setSubagentDialogInitialName(undefined);
  }, []);

  const openModelsDialog = useCallback((data?: ModelsDialogData) => {
    setModelsDialogData(data);
    setIsModelsDialogOpen(true);
  }, []);

  const closeModelsDialog = useCallback(() => {
    setIsModelsDialogOpen(false);
    setModelsDialogData(undefined);
  }, []);

  const {
    showWorkspaceMigrationDialog,
    workspaceGeminiCLIExtensions,
    onWorkspaceMigrationDialogOpen,
    onWorkspaceMigrationDialogClose,
  } = useWorkspaceMigration(settings);

  const extensions = config.getExtensions();
  const {
    extensionsUpdateState,
    dispatchExtensionStateUpdate,
    confirmUpdateExtensionRequests,
    addConfirmUpdateExtensionRequest,
  } = useExtensionUpdates(extensions, addItem, config.getWorkingDir());

  useEffect(() => {
    const unsubscribe = ideContext.subscribeToIdeContext(setIdeContextState);
    // Set the initial value
    setIdeContextState(ideContext.getIdeContext());
    return unsubscribe;
  }, []);

  // Update currentModel when settings change - get it from the SAME place as diagnostics
  useEffect(() => {
    const updateModel = async () => {
      const settingsService = getSettingsService();

      // Try to get from SettingsService first (same as diagnostics does)
      if (settingsService && settingsService.getDiagnosticsData) {
        try {
          const diagnosticsData = await settingsService.getDiagnosticsData();
          if (diagnosticsData && diagnosticsData.model) {
            setCurrentModel(diagnosticsData.model);
            return;
          }
        } catch (_error) {
          // Fall through to config
        }
      }

      // Otherwise use config (which is what diagnostics falls back to)
      setCurrentModel(config.getModel());
    };

    // Update immediately
    updateModel();

    // Also listen for any changes if SettingsService is available
    const settingsService = getSettingsService();
    if (settingsService) {
      settingsService.on('settings-changed', updateModel);
      return () => {
        settingsService.off('settings-changed', updateModel);
      };
    }

    return undefined;
  }, [config]);

  useEffect(() => {
    const openDebugConsole = () => {
      setShowErrorDetails(true);
      setConstrainHeight(false); // Make sure the user sees the full message.
    };
    appEvents.on(AppEvent.OpenDebugConsole, openDebugConsole);

    const logErrorHandler = (errorMessage: unknown) => {
      handleNewMessage({
        type: 'error',
        content: String(errorMessage),
        count: 1,
      });
    };
    appEvents.on(AppEvent.LogError, logErrorHandler);

    return () => {
      appEvents.off(AppEvent.OpenDebugConsole, openDebugConsole);
      appEvents.off(AppEvent.LogError, logErrorHandler);
    };
  }, [handleNewMessage]);

  const openPrivacyNotice = useCallback(() => {
    setShowPrivacyNotice(true);
  }, []);

  const handleEscapePromptChange = useCallback((showPrompt: boolean) => {
    setShowEscapePrompt(showPrompt);
  }, []);

  const initialPromptSubmitted = useRef(false);

  const errorCount = useMemo(
    () =>
      consoleMessages
        .filter((msg) => msg.type === 'error')
        .reduce((total, msg) => total + msg.count, 0),
    [consoleMessages],
  );

  const {
    isThemeDialogOpen,
    openThemeDialog,
    handleThemeSelect,
    handleThemeHighlight,
  } = useThemeCommand(settings, appState, addItem);

  const { isSettingsDialogOpen, openSettingsDialog, closeSettingsDialog } =
    useSettingsCommand();

  const { isFolderTrustDialogOpen, handleFolderTrustSelect, isRestarting } =
    useFolderTrust(settings, config, addItem);

  // Welcome onboarding - shown after folder trust, before other dialogs
  const {
    showWelcome: isWelcomeDialogOpen,
    state: welcomeState,
    actions: welcomeActions,
    availableProviders: welcomeAvailableProviders,
    availableModels: welcomeAvailableModels,
    triggerAuth: triggerWelcomeAuth,
  } = useWelcomeOnboarding({
    settings,
    isFolderTrustComplete: !isFolderTrustDialogOpen && !isRestarting,
  });

  const { needsRestart: ideNeedsRestart } = useIdeTrustListener(config);
  useEffect(() => {
    if (ideNeedsRestart) {
      // IDE trust changed, force a restart.
      setShowIdeRestartPrompt(true);
    }
  }, [ideNeedsRestart]);

  // Effect to clear queue error message after timeout
  useEffect(() => {
    if (queueErrorMessage) {
      const timer = setTimeout(() => {
        setQueueErrorMessage(null);
      }, QUEUE_ERROR_DISPLAY_DURATION_MS);

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [queueErrorMessage, setQueueErrorMessage]);

  useKeypress(
    (key) => {
      if (key.name === 'r' || key.name === 'R') {
        process.exit(0);
      }
    },
    { isActive: showIdeRestartPrompt },
  );

  const { isAuthDialogOpen, openAuthDialog, handleAuthSelect } = useAuthCommand(
    settings,
    appState,
  );

  // Check for OAuth code needed flag
  useEffect(() => {
    const checkOAuthFlag = setInterval(() => {
      if ((global as Record<string, unknown>).__oauth_needs_code) {
        // Clear the flag
        (global as Record<string, unknown>).__oauth_needs_code = false;
        // Open the OAuth code dialog
        appDispatch({ type: 'OPEN_DIALOG', payload: 'oauthCode' });
      }
    }, 100); // Check every 100ms

    return () => clearInterval(checkOAuthFlag);
  }, [appDispatch]);

  const {
    isEditorDialogOpen,
    openEditorDialog,
    handleEditorSelect,
    exitEditorDialog,
  } = useEditorSettings(settings, appState, addItem);

  const {
    showDialog: isProviderDialogOpen,
    openDialog: openProviderDialog,
    handleSelect: handleProviderSelect,
    closeDialog: exitProviderDialog,
    providers: providerOptions,
    currentProvider: selectedProvider,
  } = useProviderDialog({
    addMessage: (msg) =>
      addItem(
        { type: msg.type as MessageType, text: msg.content },
        msg.timestamp.getTime(),
      ),
    appState,
    config,
  });

  // Watch for model changes from config
  useEffect(() => {
    const checkModelChange = () => {
      const configModel = config.getModel();
      const providerModel = runtime.getActiveModelName();
      const effectiveModel =
        providerModel && providerModel.trim() !== ''
          ? providerModel
          : configModel;

      if (effectiveModel !== currentModel) {
        console.debug(
          `[Model Update] Updating footer from ${currentModel} to ${effectiveModel}`,
        );
        setCurrentModel(effectiveModel);
      }
    };

    // Check immediately
    checkModelChange();

    // Check periodically (every 500ms)
    const interval = setInterval(checkModelChange, 500);

    return () => clearInterval(interval);
  }, [config, currentModel, runtime]); // Include currentModel in dependencies

  const toggleCorgiMode = useCallback(() => {
    setCorgiMode((prev) => !prev);
  }, []);

  const toggleDebugProfiler = useCallback(() => {
    setShowDebugProfiler((prev) => !prev);
  }, []);

  const {
    showDialog: isLoadProfileDialogOpen,
    openDialog: openLoadProfileDialog,
    handleSelect: handleProfileSelect,
    closeDialog: exitLoadProfileDialog,
    profiles,
  } = useLoadProfileDialog({
    addMessage: (msg) =>
      addItem(
        { type: msg.type as MessageType, text: msg.content },
        msg.timestamp.getTime(),
      ),
    appState,
    config,
    settings,
  });

  const {
    showDialog: isCreateProfileDialogOpen,
    openDialog: openCreateProfileDialog,
    closeDialog: exitCreateProfileDialog,
    providers: createProfileProviders,
  } = useCreateProfileDialog({
    appState,
  });

  const {
    showListDialog: isProfileListDialogOpen,
    showDetailDialog: isProfileDetailDialogOpen,
    showEditorDialog: isProfileEditorDialogOpen,
    profiles: profileListItems,
    isLoading: profileDialogLoading,
    selectedProfileName,
    selectedProfile: selectedProfileData,
    defaultProfileName,
    activeProfileName,
    profileError: profileDialogError,
    openListDialog: openProfileListDialog,
    closeListDialog: closeProfileListDialog,
    viewProfileDetail,
    closeDetailDialog: closeProfileDetailDialog,
    loadProfile: loadProfileFromDetail,
    deleteProfile: deleteProfileFromDetail,
    setDefault: setProfileAsDefault,
    openEditor: openProfileEditor,
    closeEditor: closeProfileEditor,
    saveProfile: saveProfileFromEditor,
  } = useProfileManagement({
    addMessage: (msg) =>
      addItem(
        { type: msg.type as MessageType, text: msg.content },
        msg.timestamp.getTime(),
      ),
    appState,
  });

  const {
    showDialog: isToolsDialogOpen,
    openDialog: openToolsDialogRaw,
    closeDialog: exitToolsDialog,
    action: toolsDialogAction,
    availableTools: toolsDialogTools,
    disabledTools: toolsDialogDisabledTools,
    handleSelect: handleToolsSelect,
  } = useToolsDialog({
    addMessage: (msg) =>
      addItem(
        { type: msg.type as MessageType, text: msg.content },
        msg.timestamp.getTime(),
      ),
    appState,
    config,
  });

  const openToolsDialog = useCallback(
    (action: 'enable' | 'disable') => {
      openToolsDialogRaw(action);
    },
    [openToolsDialogRaw],
  );

  const performMemoryRefresh = useCallback(async () => {
    addItem(
      {
        type: MessageType.INFO,
        text: 'Refreshing hierarchical memory (LLXPRT.md or other context files)...',
      },
      Date.now(),
    );
    try {
      const { memoryContent, fileCount } = await loadHierarchicalLlxprtMemory(
        config.getWorkingDir(),
        settings.merged.loadMemoryFromIncludeDirectories
          ? config.getWorkspaceContext().getDirectories()
          : [],
        config.getDebugMode(),
        config.getFileService(),
        settings.merged,
        config.getExtensions(),
        config.getFolderTrust(),
        settings.merged.ui?.memoryImportFormat || 'tree',
        config.getFileFilteringOptions(),
      );

      config.setUserMemory(memoryContent);
      config.setLlxprtMdFileCount(fileCount);
      setLlxprtMdFileCount(fileCount);

      addItem(
        {
          type: MessageType.INFO,
          text: `Memory refreshed successfully. ${memoryContent.length > 0 ? `Loaded ${memoryContent.length} characters from ${fileCount} file(s).` : 'No memory content found.'}`,
        },
        Date.now(),
      );
      if (config.getDebugMode()) {
        console.log(
          `[DEBUG] Refreshed memory content in config: ${memoryContent.substring(0, 200)}...`,
        );
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      addItem(
        {
          type: MessageType.ERROR,
          text: `Error refreshing memory: ${errorMessage}`,
        },
        Date.now(),
      );
      console.error('Error refreshing memory:', error);
    }
  }, [config, addItem, settings.merged]);

  // Poll for token metrics updates
  useEffect(() => {
    const updateTokenMetrics = () => {
      const metrics = runtime.getActiveProviderMetrics();
      const usage = runtime.getSessionTokenUsage();

      if (
        !shouldUpdateTokenMetrics(
          tokenMetricsSnapshotRef.current,
          metrics,
          usage,
        )
      ) {
        return;
      }

      const snapshot = toTokenMetricsSnapshot(metrics, usage);
      tokenMetricsSnapshotRef.current = snapshot;

      setTokenMetrics({
        tokensPerMinute: snapshot.tokensPerMinute,
        throttleWaitTimeMs: snapshot.throttleWaitTimeMs,
        sessionTokenTotal: snapshot.sessionTokenTotal,
      });

      uiTelemetryService.setTokenTrackingMetrics({
        tokensPerMinute: snapshot.tokensPerMinute,
        throttleWaitTimeMs: snapshot.throttleWaitTimeMs,
        sessionTokenUsage: usage,
      });
    };

    // Update immediately
    updateTokenMetrics();

    // Poll every second to show live updates
    const interval = setInterval(updateTokenMetrics, 1000);

    return () => clearInterval(interval);
  }, [runtime]);

  // Terminal and UI setup
  const { rows: terminalHeight, columns: terminalWidth } = useTerminalSize();
  const isInitialMount = useRef(true);

  const widthFraction = 0.9;
  // Calculate inputWidth accounting for:
  // - Prompt: 2 chars ("! " or "> ")
  // - Padding: 2 chars (paddingX={1} on each side in InputPrompt)
  // - Additional margin: 2 chars (for proper wrapping)
  const inputWidth = Math.max(
    20,
    Math.floor(terminalWidth * widthFraction) - 6,
  );
  const suggestionsWidth = Math.max(60, Math.floor(terminalWidth * 0.8));

  // Utility callbacks
  const isValidPath = useCallback((filePath: string): boolean => {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch (_e) {
      return false;
    }
  }, []);

  const getPreferredEditor = useCallback(() => {
    const editorType = settings.merged.ui?.preferredEditor;
    const isValidEditor = isEditorAvailable(editorType);
    if (!isValidEditor) {
      openEditorDialog();
      return;
    }
    return editorType as EditorType;
  }, [settings, openEditorDialog]);

  const onAuthError = useCallback(() => {
    setAuthError('reauth required');
    // Open the auth dialog when authentication errors occur
    appDispatch({ type: 'OPEN_DIALOG', payload: 'auth' });
  }, [setAuthError, appDispatch]);

  const handleAuthTimeout = useCallback(() => {
    setAuthError('Authentication timed out. Please try again.');
    // NEVER automatically open auth dialog - user must use /auth
  }, [setAuthError]);

  const handlePrivacyNoticeExit = useCallback(() => {
    setShowPrivacyNotice(false);
  }, []);

  // Core hooks and processors
  const {
    vimEnabled: vimModeEnabled,
    vimMode,
    toggleVimEnabled,
  } = useVimMode();

  const slashCommandProcessorActions = useMemo(
    () => ({
      openAuthDialog,
      openThemeDialog,
      openEditorDialog,
      openPrivacyNotice,
      openSettingsDialog,
      openLoggingDialog,
      openSubagentDialog,
      openModelsDialog,
      openPermissionsDialog,
      openProviderDialog,
      openLoadProfileDialog,
      openCreateProfileDialog,
      openProfileListDialog,
      viewProfileDetail,
      openProfileEditor,
      quit: setQuittingMessages,
      setDebugMessage,
      toggleCorgiMode,
      toggleDebugProfiler,
      dispatchExtensionStateUpdate,
      addConfirmUpdateExtensionRequest,
      openWelcomeDialog: welcomeActions.resetAndReopen,
    }),
    [
      openAuthDialog,
      openThemeDialog,
      openEditorDialog,
      openPrivacyNotice,
      openSettingsDialog,
      openLoggingDialog,
      openSubagentDialog,
      openModelsDialog,
      openPermissionsDialog,
      openProviderDialog,
      openLoadProfileDialog,
      openCreateProfileDialog,
      openProfileListDialog,
      viewProfileDetail,
      openProfileEditor,
      setQuittingMessages,
      setDebugMessage,
      toggleCorgiMode,
      toggleDebugProfiler,
      dispatchExtensionStateUpdate,
      addConfirmUpdateExtensionRequest,
      welcomeActions.resetAndReopen,
    ],
  );

  /**
   * @plan PLAN-20260129-TODOPERSIST.P07
   * Get TodoContext for /todo command integration
   */
  const todoContextForCommands = useMemo(
    () => ({
      todos,
      updateTodos,
      refreshTodos: () => {
        /* refreshTodos is available but not needed in commands */
      },
    }),
    [todos, updateTodos],
  );

  const {
    handleSlashCommand,
    slashCommands,
    pendingHistoryItems: pendingSlashCommandHistoryItems,
    commandContext,
    shellConfirmationRequest,
    confirmationRequest,
  } = useSlashCommandProcessor(
    config,
    settings,
    addItem,
    clearItems,
    loadHistory,
    refreshStatic,
    toggleVimEnabled,
    setIsProcessing,
    setLlxprtMdFileCount,
    slashCommandProcessorActions,
    extensionsUpdateState,
    true, // isConfigInitialized
    todoContextForCommands, // @plan PLAN-20260129-TODOPERSIST.P07
  );

  // Memoize viewport to ensure it updates when inputWidth changes
  const viewport = useMemo(
    () => ({ height: 10, width: inputWidth }),
    [inputWidth],
  );

  const buffer = useTextBuffer({
    initialText: '',
    viewport,
    stdin,
    setRawMode,
    isValidPath,
    shellModeActive,
  });

  // Independent input history management (unaffected by /clear)
  const inputHistoryStore = useInputHistoryStore();
  const lastSubmittedPromptRef = useRef<string>('');

  const handleUserCancel = useCallback(
    (shouldRestorePrompt?: boolean) => {
      if (shouldRestorePrompt) {
        const lastUserMessage = lastSubmittedPromptRef.current;
        if (lastUserMessage) {
          buffer.setText(lastUserMessage);
        }
      } else {
        buffer.setText('');
      }
    },
    [buffer],
  );

  const handleOAuthCodeDialogClose = useCallback(() => {
    appDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
  }, [appDispatch]);

  const handleOAuthCodeSubmit = useCallback(
    async (code: string) => {
      submitOAuthCode(
        {
          getOAuthManager: () => runtime.getCliOAuthManager(),
          getActiveProvider: () =>
            (global as unknown as { __oauth_provider?: string })
              .__oauth_provider,
        },
        code,
      );
    },
    [runtime],
  );

  const {
    streamingState,
    submitQuery,
    initError,
    pendingHistoryItems: pendingGeminiHistoryItems,
    thought,
    cancelOngoingRequest,
    activeShellPtyId: geminiActiveShellPtyId,
    lastOutputTime,
  } = useGeminiStream(
    config.getGeminiClient(),
    history,
    addItem,
    config,
    settings,
    setDebugMessage,
    handleSlashCommand,
    shellModeActive,
    getPreferredEditor,
    onAuthError,
    performMemoryRefresh,
    refreshStatic,
    handleUserCancel,
    setEmbeddedShellFocused,
    stdout?.columns,
    stdout?.rows,
    registerTodoPause,
    handleExternalEditorOpen,
    activeProfileName,
  );

  const pendingHistoryItems = useMemo(
    () => [...pendingSlashCommandHistoryItems, ...pendingGeminiHistoryItems],
    [pendingSlashCommandHistoryItems, pendingGeminiHistoryItems],
  );

  // Use the activeShellPtyId from useGeminiStream (which gets it from useShellCommandProcessor)
  const activeShellPtyId = geminiActiveShellPtyId;

  // Auto-reset embeddedShellFocused when no shell tool is executing.
  // Without this, cancelling a shell while focused (embeddedShellFocused=true)
  // leaves the input prompt permanently disabled.
  const anyShellExecuting = useMemo(
    () =>
      pendingHistoryItems.some(
        (item) =>
          item?.type === 'tool_group' &&
          item.tools.some(
            (tool) =>
              (tool.name === SHELL_COMMAND_NAME || tool.name === SHELL_NAME) &&
              tool.status === ToolCallStatus.Executing,
          ),
      ),
    [pendingHistoryItems],
  );

  useEffect(() => {
    if (embeddedShellFocused && !anyShellExecuting) {
      debug.log('Auto-resetting embeddedShellFocused: no shell executing');
      setEmbeddedShellFocused(false);
    }
  }, [embeddedShellFocused, anyShellExecuting]);

  // Update the cancel handler with message queue support
  const cancelHandlerRef = useRef<
    ((shouldRestorePrompt?: boolean) => void) | null
  >(null);
  cancelHandlerRef.current = useCallback(
    (shouldRestorePrompt?: boolean) => {
      if (isToolExecuting(pendingHistoryItems)) {
        buffer.setText('');
        return;
      }

      if (shouldRestorePrompt) {
        const lastUserMessage = lastSubmittedPromptRef.current;
        if (lastUserMessage) {
          buffer.setText(lastUserMessage);
        }
      } else {
        buffer.setText('');
      }
    },
    [buffer, pendingHistoryItems],
  );

  // Input handling - queue messages for processing
  const handleFinalSubmit = useCallback(
    (submittedValue: string) => {
      const trimmedValue = submittedValue.trim();
      if (trimmedValue.length > 0) {
        /**
         * @plan PLAN-20260129-TODOPERSIST.P12
         * Reset continuation attempt counter when user submits a new prompt.
         * This prevents the continuation limit from blocking future continuations
         * after user interaction.
         */
        hadToolCallsRef.current = false;
        todoContinuationRef.current?.clearPause();

        // Capture synchronously before async state updates (prevents race condition on restore)
        lastSubmittedPromptRef.current = trimmedValue;
        // Add to independent input history
        inputHistoryStore.addInput(trimmedValue);
        submitQuery(trimmedValue);
      }
    },
    [submitQuery, inputHistoryStore],
  );

  const { handleUserInputSubmit } = useTodoPausePreserver({
    controller: todoPauseController,
    updateTodos,
    handleFinalSubmit,
    todos,
  });

  const handleIdePromptComplete = useCallback(
    (result: IdeIntegrationNudgeResult) => {
      if (result.userSelection === 'yes') {
        if (result.isExtensionPreInstalled) {
          handleSlashCommand('/ide enable');
        } else {
          handleSlashCommand('/ide install');
        }
        settings.setValue(
          SettingScope.User,
          'hasSeenIdeIntegrationNudge',
          true,
        );
      } else if (result.userSelection === 'dismiss') {
        settings.setValue(
          SettingScope.User,
          'hasSeenIdeIntegrationNudge',
          true,
        );
      }
      setIdePromptAnswered(true);
    },
    [handleSlashCommand, settings],
  );

  const { handleInput: vimHandleInput } = useVim(buffer, handleFinalSubmit);

  const { elapsedTime, currentLoadingPhrase } = useLoadingIndicator(
    streamingState,
    settings.merged.ui?.wittyPhraseStyle ??
      settings.merged.wittyPhraseStyle ??
      'default',
    settings.merged.ui?.customWittyPhrases ??
      settings.merged.customWittyPhrases,
    !!activeShellPtyId && !embeddedShellFocused,
    lastOutputTime,
  );
  const showAutoAcceptIndicator = useAutoAcceptIndicator({ config, addItem });

  const handleExit = useCallback(
    (
      pressedOnce: boolean,
      setPressedOnce: (value: boolean) => void,
      timerRef: React.MutableRefObject<NodeJS.Timeout | null>,
    ) => {
      if (pressedOnce) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        // Directly invoke the central command handler.
        handleSlashCommand('/quit');
      } else {
        setPressedOnce(true);
        timerRef.current = setTimeout(() => {
          setPressedOnce(false);
          timerRef.current = null;
        }, CTRL_EXIT_PROMPT_DURATION_MS);
      }
    },
    [handleSlashCommand],
  );

  const handleSettingsRestart = useCallback(() => {
    handleSlashCommand('/quit');
  }, [handleSlashCommand]);

  const handleGlobalKeypress = useCallback(
    (key: Key) => {
      if (copyModeEnabled) {
        setCopyModeEnabled(false);
        enableMouseEvents();
        // We don't want to process any other keys if we're in copy mode.
        return;
      }

      // Debug log keystrokes if enabled
      if (settings.merged.debugKeystrokeLogging) {
        console.log('[DEBUG] Keystroke:', JSON.stringify(key));
      }

      if (
        settings.merged.ui?.useAlternateBuffer === true &&
        keyMatchers[Command.TOGGLE_COPY_MODE](key)
      ) {
        setCopyModeEnabled(true);
        disableMouseEvents();
        return;
      }

      // Handle exit keys BEFORE dialog visibility check so exit prompts work even when dialogs are open
      if (keyMatchers[Command.QUIT](key)) {
        if (!ctrlCPressedOnce) {
          cancelOngoingRequest?.();
        }

        if (!ctrlCPressedOnce) {
          setCtrlCPressedOnce(true);
          ctrlCTimerRef.current = setTimeout(() => {
            setCtrlCPressedOnce(false);
            ctrlCTimerRef.current = null;
          }, CTRL_EXIT_PROMPT_DURATION_MS);
          return;
        }

        handleExit(ctrlCPressedOnce, setCtrlCPressedOnce, ctrlCTimerRef);
        return;
      } else if (keyMatchers[Command.EXIT](key)) {
        if (buffer.text.length > 0) {
          return;
        }
        handleExit(ctrlDPressedOnce, setCtrlDPressedOnce, ctrlDTimerRef);
        return;
      }

      let enteringConstrainHeightMode = false;
      if (!constrainHeight) {
        enteringConstrainHeightMode = true;
        setConstrainHeight(true);
      }

      if (keyMatchers[Command.SHOW_ERROR_DETAILS](key)) {
        setShowErrorDetails((prev) => !prev);
      } else if (keyMatchers[Command.TOGGLE_MOUSE_EVENTS](key)) {
        const nextActive = !isMouseEventsActive();
        setMouseEventsActive(nextActive);
        addItem(
          {
            type: MessageType.INFO,
            text: nextActive
              ? 'Mouse events enabled (wheel scrolling + in-app selection/copy on).'
              : 'Mouse events disabled (terminal selection/copy on; in-app wheel scrolling off).',
          },
          Date.now(),
        );
      } else if (keyMatchers[Command.TOGGLE_TOOL_DESCRIPTIONS](key)) {
        const newValue = !showToolDescriptions;
        setShowToolDescriptions(newValue);

        const mcpServers = config.getMcpServers();
        if (Object.keys(mcpServers || {}).length > 0) {
          handleSlashCommand(newValue ? '/mcp desc' : '/mcp nodesc');
        }
      } else if (keyMatchers[Command.TOGGLE_MARKDOWN](key)) {
        setRenderMarkdown((prev) => {
          const newValue = !prev;
          // Force re-render of static content
          refreshStatic();
          return newValue;
        });
      } else if (
        keyMatchers[Command.TOGGLE_IDE_CONTEXT_DETAIL](key) &&
        config.getIdeMode() &&
        ideContextState
      ) {
        // Show IDE status when in IDE mode and context is available.
        handleSlashCommand('/ide status');
      } else if (keyMatchers[Command.TOGGLE_TODO_DIALOG](key)) {
        // Toggle todo panel collapsed/expanded state
        setIsTodoPanelCollapsed((prev) => !prev);
      } else if (
        keyMatchers[Command.SHOW_MORE_LINES](key) &&
        !enteringConstrainHeightMode
      ) {
        setConstrainHeight(false);
      } else if (
        keyMatchers[Command.TOGGLE_SHELL_INPUT_FOCUS](key) &&
        config.getEnableInteractiveShell()
      ) {
        const lastPtyId = ShellExecutionService.getLastActivePtyId();
        debug.log(
          'Ctrl+F: activeShellPtyId=%s, lastActivePtyId=%s, will toggle=%s',
          activeShellPtyId,
          lastPtyId,
          !!(activeShellPtyId || lastPtyId),
        );
        if (activeShellPtyId || lastPtyId) {
          // Toggle focus between shell and LLxprt input.
          setEmbeddedShellFocused((prev) => {
            debug.log('Ctrl+F: embeddedShellFocused %s -> %s', prev, !prev);
            return !prev;
          });
        }
      }
    },
    [
      constrainHeight,
      setConstrainHeight,
      setShowErrorDetails,
      showToolDescriptions,
      setShowToolDescriptions,
      config,
      ideContextState,
      handleExit,
      ctrlCPressedOnce,
      setCtrlCPressedOnce,
      ctrlCTimerRef,
      buffer.text.length,
      ctrlDPressedOnce,
      setCtrlDPressedOnce,
      ctrlDTimerRef,
      handleSlashCommand,
      cancelOngoingRequest,
      addItem,
      settings.merged.debugKeystrokeLogging,
      refreshStatic,
      setCopyModeEnabled,
      copyModeEnabled,
      settings.merged.ui?.useAlternateBuffer,
      activeShellPtyId,
    ],
  );

  useKeypress(handleGlobalKeypress, {
    isActive: true,
  });

  useEffect(() => {
    if (config) {
      setLlxprtMdFileCount(config.getLlxprtMdFileCount());
    }
  }, [config, config.getLlxprtMdFileCount]);

  const logger = useLogger(config.storage);

  // Initialize independent input history from logger
  useEffect(() => {
    inputHistoryStore.initializeFromLogger(logger);
  }, [logger, inputHistoryStore]);

  // Handle process exit when quit command is issued
  useEffect(() => {
    if (quittingMessages) {
      // Allow UI to render the quit message briefly before exiting
      const timer = setTimeout(() => {
        // Flush protocol restore before process.exit() so script/pty wrappers
        // don't drop the final disable sequences.
        restoreTerminalProtocolsSync();
        // Note: We don't call runExitCleanup() here because it includes
        // instance.waitUntilExit() which would deadlock. The cleanup is
        // triggered by process.exit() which fires SIGTERM/exit handlers.
        // The mouse events cleanup is registered in gemini.tsx and will
        // run via the process exit handlers. (fixes #959)
        process.exit(0);
      }, 100); // 100ms delay to show quit screen

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [quittingMessages]);

  const isInputActive =
    (streamingState === StreamingState.Idle ||
      streamingState === StreamingState.Responding) &&
    !initError &&
    !isProcessing &&
    !!slashCommands;

  useEffect(() => {
    if (selectionLogger.enabled) {
      if (confirmationRequest) {
        selectionLogger.debug(() => 'Confirmation dialog opened');
      } else {
        selectionLogger.debug(() => 'Confirmation dialog closed');
      }
    }
  }, [confirmationRequest]);

  const handleClearScreen = useCallback(() => {
    clearItems();
    clearConsoleMessagesState();
    if (!useAlternateBuffer) {
      console.clear();
    }
    refreshStatic();
  }, [
    clearItems,
    clearConsoleMessagesState,
    refreshStatic,
    useAlternateBuffer,
  ]);

  const handleConfirmationSelect = useCallback(
    (value: boolean) => {
      if (confirmationRequest) {
        if (selectionLogger.enabled) {
          selectionLogger.debug(
            () =>
              `AppContainer.handleConfirmationSelect value=${value} hasRequest=${Boolean(
                confirmationRequest,
              )}`,
          );
        }
        confirmationRequest.onConfirm(value);
      }
    },
    [confirmationRequest],
  );

  const mainControlsRef = useRef<DOMElement>(null);
  const pendingHistoryItemRef = useRef<DOMElement>(null);
  const rootUiRef = useRef<DOMElement>(null);

  const { copySelectionToClipboard } = useMouseSelection({
    enabled: true,
    rootRef: rootUiRef,
    onCopiedText: (text) => {
      if (selectionLogger.enabled) {
        selectionLogger.debug(
          () => `Copied ${text.length} characters to clipboard`,
        );
      }
    },
  });

  // Fix for issue #1284: Add keyboard shortcut for Cmd+C/Ctrl+C to copy selection
  useKeypress(
    (key) => {
      if (key.name === 'c' && (key.ctrl || key.meta)) {
        void copySelectionToClipboard();
      }
    },
    { isActive: true },
  );

  useLayoutEffect(() => {
    if (mainControlsRef.current) {
      const fullFooterMeasurement = measureElement(mainControlsRef.current);
      setFooterHeight(fullFooterMeasurement.height);
    }
  }, [terminalHeight, consoleMessages, showErrorDetails]);

  const staticExtraHeight = /* margins and padding */ 3;
  const availableTerminalHeight = useMemo(
    () => terminalHeight - footerHeight - staticExtraHeight,
    [terminalHeight, footerHeight],
  );

  // Flicker detection - measures root UI element vs terminal height
  // to detect overflow that could cause flickering (issue #456)
  // This is for TELEMETRY ONLY - actual prevention is via availableTerminalHeight
  useFlickerDetector(rootUiRef, terminalHeight, constrainHeight);

  // Listen for Flicker events for additional corrective actions
  useEffect(() => {
    const handleFlicker = (data: {
      contentHeight: number;
      terminalHeight: number;
      overflow: number;
    }) => {
      debug.log(
        `Flicker event received: overflow=${data.overflow}, content=${data.contentHeight}, terminal=${data.terminalHeight}`,
      );
      // When flicker is detected, ensure constrainHeight is enabled
      // This provides a feedback loop to keep the UI constrained
      if (!constrainHeight) {
        setConstrainHeight(true);
      }
    };
    appEvents.on(AppEvent.Flicker, handleFlicker);
    return () => {
      appEvents.off(AppEvent.Flicker, handleFlicker);
    };
  }, [constrainHeight]);

  useEffect(() => {
    // skip refreshing Static during first mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // debounce so it doesn't fire up too often during resize
    const handler = setTimeout(() => {
      if (streamingState === StreamingState.Idle) {
        refreshStatic();
      } else {
        setStaticNeedsRefresh(true);
      }
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [terminalWidth, terminalHeight, refreshStatic, streamingState]);

  useEffect(() => {
    if (streamingState === StreamingState.Idle && _staticNeedsRefresh) {
      setStaticNeedsRefresh(false);
      refreshStatic();
    }
  }, [streamingState, refreshStatic, _staticNeedsRefresh]);

  // Session persistence - always save so sessions can be resumed with --continue
  // Use stable dependencies to avoid recreating service (and new file path) on config changes
  const storage = config.storage;
  const sessionId = config.getSessionId();
  const sessionPersistence = useMemo(
    () => new SessionPersistenceService(storage, sessionId),
    [storage, sessionId],
  );

  /**
   * @plan PLAN-20260129-TODOPERSIST.P12
   * Wire up todo continuation detection to trigger continuation prompts
   * when streams complete without tool calls and active TODOs exist.
   */
  const geminiClientForContinuation = config.getGeminiClient();
  const todoContinuation = useTodoContinuation(
    geminiClientForContinuation,
    config,
    streamingState === StreamingState.Responding ||
      streamingState === StreamingState.WaitingForConfirmation,
    setDebugMessage,
  );

  todoContinuationRef.current = todoContinuation;

  // Track previous streaming state to detect turn completion
  const prevStreamingStateRef = useRef<StreamingState>(streamingState);

  /**
   * @plan PLAN-20260129-TODOPERSIST.P12
   * Track whether tool calls were made during the turn for continuation decision.
   * Tool calls signal the AI made progress, so we don't need continuation.
   */
  const hadToolCallsRef = useRef<boolean>(false);

  /**
   * @plan PLAN-20260129-TODOPERSIST.P12
   * Track tool calls by detecting tool_group items in history and pending items.
   */
  useEffect(() => {
    const hasToolCalls =
      history.some((item) => item.type === 'tool_group') ||
      pendingHistoryItems.some((item) => item.type === 'tool_group');

    if (
      hasToolCalls &&
      (streamingState === StreamingState.Responding ||
        streamingState === StreamingState.WaitingForConfirmation)
    ) {
      hadToolCallsRef.current = true;
    }
  }, [history, pendingHistoryItems, streamingState]);

  // Save session when turn completes (streaming goes idle)
  useEffect(() => {
    const wasActive =
      prevStreamingStateRef.current === StreamingState.Responding ||
      prevStreamingStateRef.current === StreamingState.WaitingForConfirmation;
    const isNowIdle = streamingState === StreamingState.Idle;
    prevStreamingStateRef.current = streamingState;

    if (!wasActive || !isNowIdle) {
      return;
    }

    /**
     * @plan PLAN-20260129-TODOPERSIST.P12
     * Notify continuation logic that stream completed.
     * Pass hadToolCalls to determine if continuation is needed.
     */
    todoContinuation.handleStreamCompleted(hadToolCallsRef.current);

    // Reset for next turn
    hadToolCallsRef.current = false;

    // Get history from gemini client and save
    const geminiClient = config.getGeminiClient();
    const historyService = geminiClient?.getHistoryService?.();
    if (!historyService) {
      return;
    }

    const historyToSave = historyService.getComprehensive();
    if (historyToSave.length === 0) {
      return;
    }

    sessionPersistence
      .save(
        historyToSave,
        {
          provider: config.getProvider?.() ?? undefined,
          model: config.getModel(),
          tokenCount: historyService.getTotalTokens(),
        },
        history, // Save UI history for exact display restoration
      )
      .catch((err: unknown) => {
        debug.error('Failed to save session:', err);
      });
  }, [streamingState, sessionPersistence, config, history, todoContinuation]);

  const filteredConsoleMessages = useMemo(() => {
    if (config.getDebugMode()) {
      return consoleMessages;
    }
    return consoleMessages.filter((msg) => msg.type !== 'debug');
  }, [consoleMessages, config]);

  const branchName = useGitBranchName(config.getTargetDir());

  const contextFileNames = useMemo(() => {
    const fromSettings = settings.merged.ui?.contextFileName;
    if (fromSettings) {
      return Array.isArray(fromSettings) ? fromSettings : [fromSettings];
    }
    return getAllLlxprtMdFilenames();
  }, [settings.merged.ui?.contextFileName]);

  const initialPrompt = useMemo(() => config.getQuestion(), [config]);
  const geminiClient = config.getGeminiClient();

  useEffect(() => {
    if (
      initialPrompt &&
      !initialPromptSubmitted.current &&
      !isAuthDialogOpen &&
      !isThemeDialogOpen &&
      !isEditorDialogOpen &&
      !isProviderDialogOpen &&
      !isToolsDialogOpen &&
      !isCreateProfileDialogOpen &&
      !showPrivacyNotice &&
      !isWelcomeDialogOpen &&
      geminiClient
    ) {
      submitQuery(initialPrompt);
      initialPromptSubmitted.current = true;
    }
  }, [
    initialPrompt,
    submitQuery,
    isAuthDialogOpen,
    isThemeDialogOpen,
    isEditorDialogOpen,
    isProviderDialogOpen,

    isToolsDialogOpen,
    isCreateProfileDialogOpen,
    showPrivacyNotice,
    isWelcomeDialogOpen,
    geminiClient,
  ]);

  const mainAreaWidth = calculateMainAreaWidth(terminalWidth, settings);

  // Detect PowerShell for file reference syntax tip
  const isPowerShell =
    process.env.PSModulePath !== undefined ||
    process.env.PSVERSION !== undefined;

  const placeholder = vimModeEnabled
    ? "  Press 'i' for INSERT mode and 'Esc' for NORMAL mode."
    : isPowerShell
      ? '  Type your message, @path/to/file or +path/to/file'
      : '  Type your message or @path/to/file';

  useEffect(() => {
    config.setPtyTerminalSize(mainAreaWidth, terminalHeight);
  }, [config, mainAreaWidth, terminalHeight]);

  // Build UIState object
  const uiState: UIState = {
    // Core app context
    config,
    settings,

    // Terminal dimensions
    terminalWidth,
    terminalHeight,
    mainAreaWidth,
    inputWidth,
    suggestionsWidth,

    // History and streaming
    history,
    pendingHistoryItems,
    streamingState,
    thought,

    // Input buffer
    buffer,
    shellModeActive,

    // Dialog states
    isThemeDialogOpen,
    isSettingsDialogOpen,
    isAuthDialogOpen,
    isEditorDialogOpen,
    isProviderDialogOpen,
    isLoadProfileDialogOpen,
    isCreateProfileDialogOpen,
    isProfileListDialogOpen,
    isProfileDetailDialogOpen,
    isProfileEditorDialogOpen,
    isToolsDialogOpen,
    isFolderTrustDialogOpen,
    showWorkspaceMigrationDialog,
    showPrivacyNotice,
    isOAuthCodeDialogOpen: appState.openDialogs.oauthCode,
    isPermissionsDialogOpen,
    isLoggingDialogOpen,
    isSubagentDialogOpen,
    isModelsDialogOpen,

    // Dialog data
    providerOptions: isCreateProfileDialogOpen
      ? createProfileProviders
      : providerOptions,
    selectedProvider,
    currentModel,
    profiles,
    toolsDialogAction,
    toolsDialogTools,
    toolsDialogDisabledTools,
    workspaceGeminiCLIExtensions,
    loggingDialogData,
    subagentDialogInitialView,
    subagentDialogInitialName,
    modelsDialogData,

    // Profile management dialog data
    profileListItems,
    selectedProfileName,
    selectedProfileData,
    defaultProfileName,
    activeProfileName,
    profileDialogError,
    profileDialogLoading,

    // Confirmation requests
    shellConfirmationRequest,
    confirmationRequest,
    confirmUpdateGeminiCLIExtensionRequests: confirmUpdateExtensionRequests,

    // Exit/warning states
    ctrlCPressedOnce,
    ctrlDPressedOnce,
    showEscapePrompt,
    showIdeRestartPrompt,
    quittingMessages,

    // Display options
    constrainHeight,
    showErrorDetails,
    showToolDescriptions,
    isTodoPanelCollapsed,
    isNarrow,
    vimModeEnabled,
    vimMode,

    // Context and status
    ideContextState,
    llxprtMdFileCount,
    branchName,
    errorCount,

    // Console and messages
    consoleMessages: filteredConsoleMessages,

    // Loading and status
    elapsedTime,
    currentLoadingPhrase,
    showAutoAcceptIndicator,

    // Token metrics
    tokenMetrics,
    historyTokenCount: sessionStats.historyTokenCount,

    // Error states
    initError,
    authError,
    themeError,
    editorError,

    // Processing states
    isProcessing,
    isInputActive,
    isFocused,

    // Refs for flicker detection
    rootUiRef,
    pendingHistoryItemRef,

    // Slash commands
    slashCommands,
    commandContext,

    // IDE prompt
    shouldShowIdePrompt: !!shouldShowIdePrompt,
    currentIDE,

    // Trust
    isRestarting,
    isTrustedFolder: config.isTrustedFolder(),

    // Welcome onboarding
    isWelcomeDialogOpen,
    welcomeState,
    welcomeAvailableProviders,
    welcomeAvailableModels,

    // Input history
    inputHistory: inputHistoryStore.inputHistory,

    // Static key for refreshing
    staticKey,

    // Debug
    debugMessage,
    showDebugProfiler,

    // Copy mode
    copyModeEnabled,

    // Footer height
    footerHeight,

    // Placeholder text
    placeholder,

    // Available terminal height for content (after footer measurement)
    availableTerminalHeight,

    // Queue error message
    queueErrorMessage,

    // Markdown rendering toggle
    renderMarkdown,

    // Interactive shell focus state
    activeShellPtyId,
    embeddedShellFocused,
  };

  // Build UIActions object - memoized to avoid unnecessary re-renders (upstream optimization)
  const uiActions: UIActions = useMemo(
    () => ({
      // History actions
      addItem,
      clearItems,
      loadHistory,
      refreshStatic,

      // Input actions
      handleUserInputSubmit,
      handleClearScreen,

      // Theme dialog
      openThemeDialog,
      handleThemeSelect,
      handleThemeHighlight,

      // Settings dialog
      openSettingsDialog,
      closeSettingsDialog,
      handleSettingsRestart,

      // Auth dialog
      openAuthDialog,
      handleAuthSelect,
      handleAuthTimeout,

      // Editor dialog
      openEditorDialog,
      handleEditorSelect,
      exitEditorDialog,

      // Provider dialog
      openProviderDialog,
      handleProviderSelect,
      exitProviderDialog,

      // Load profile dialog
      openLoadProfileDialog,
      handleProfileSelect,
      exitLoadProfileDialog,

      // Create profile dialog
      openCreateProfileDialog,
      exitCreateProfileDialog,

      // Profile management dialogs
      openProfileListDialog,
      closeProfileListDialog,
      viewProfileDetail,
      closeProfileDetailDialog,
      loadProfileFromDetail,
      deleteProfileFromDetail,
      setProfileAsDefault,
      openProfileEditor,
      closeProfileEditor,
      saveProfileFromEditor,

      // Tools dialog
      openToolsDialog,
      handleToolsSelect,
      exitToolsDialog,

      // Folder trust dialog
      handleFolderTrustSelect,

      // Welcome onboarding
      welcomeActions,
      triggerWelcomeAuth,

      // Permissions dialog
      openPermissionsDialog,
      closePermissionsDialog,

      // Logging dialog
      openLoggingDialog,
      closeLoggingDialog,

      // Subagent dialog
      openSubagentDialog,
      closeSubagentDialog,

      // Models dialog
      openModelsDialog,
      closeModelsDialog,

      // Workspace migration dialog
      onWorkspaceMigrationDialogOpen,
      onWorkspaceMigrationDialogClose,

      // Privacy notice
      openPrivacyNotice,
      handlePrivacyNoticeExit,

      // OAuth code dialog
      handleOAuthCodeDialogClose,
      handleOAuthCodeSubmit,

      // Confirmation handlers
      handleConfirmationSelect,

      // IDE prompt
      handleIdePromptComplete,

      // Vim
      vimHandleInput,
      toggleVimEnabled,

      // Slash commands
      handleSlashCommand,

      // Memory
      performMemoryRefresh,

      // Display toggles
      setShowErrorDetails,
      setShowToolDescriptions,
      setConstrainHeight,

      // Shell mode
      setShellModeActive,

      // Escape prompt
      handleEscapePromptChange,

      // Cancel ongoing request
      cancelOngoingRequest,

      // Queue error message
      setQueueErrorMessage,
    }),
    [
      addItem,
      clearItems,
      loadHistory,
      refreshStatic,
      handleUserInputSubmit,
      handleClearScreen,
      openThemeDialog,
      handleThemeSelect,
      handleThemeHighlight,
      openSettingsDialog,
      closeSettingsDialog,
      handleSettingsRestart,
      openAuthDialog,
      handleAuthSelect,
      handleAuthTimeout,
      openEditorDialog,
      handleEditorSelect,
      exitEditorDialog,
      openProviderDialog,
      handleProviderSelect,
      exitProviderDialog,
      openLoadProfileDialog,
      handleProfileSelect,
      exitLoadProfileDialog,
      openCreateProfileDialog,
      exitCreateProfileDialog,
      openProfileListDialog,
      closeProfileListDialog,
      viewProfileDetail,
      closeProfileDetailDialog,
      loadProfileFromDetail,
      deleteProfileFromDetail,
      setProfileAsDefault,
      openProfileEditor,
      closeProfileEditor,
      saveProfileFromEditor,
      openToolsDialog,
      handleToolsSelect,
      exitToolsDialog,
      handleFolderTrustSelect,
      welcomeActions,
      triggerWelcomeAuth,
      openPermissionsDialog,
      closePermissionsDialog,
      openLoggingDialog,
      closeLoggingDialog,
      openSubagentDialog,
      closeSubagentDialog,
      openModelsDialog,
      closeModelsDialog,
      onWorkspaceMigrationDialogOpen,
      onWorkspaceMigrationDialogClose,
      openPrivacyNotice,
      handlePrivacyNoticeExit,
      handleOAuthCodeDialogClose,
      handleOAuthCodeSubmit,
      handleConfirmationSelect,
      handleIdePromptComplete,
      vimHandleInput,
      toggleVimEnabled,
      handleSlashCommand,
      performMemoryRefresh,
      setShowErrorDetails,
      setShowToolDescriptions,
      setConstrainHeight,
      setShellModeActive,
      handleEscapePromptChange,
      cancelOngoingRequest,
      setQueueErrorMessage,
    ],
  );

  return (
    <UIStateProvider value={uiState}>
      <UIActionsProvider value={uiActions}>
        <DefaultAppLayout
          config={config}
          settings={settings}
          startupWarnings={startupWarnings}
          version={props.version}
          nightly={nightly}
          mainControlsRef={mainControlsRef}
          availableTerminalHeight={availableTerminalHeight}
          contextFileNames={contextFileNames}
          updateInfo={updateInfo}
        />
      </UIActionsProvider>
    </UIStateProvider>
  );
};
