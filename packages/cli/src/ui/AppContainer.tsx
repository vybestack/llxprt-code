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
} from './types.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { useResponsive } from './hooks/useResponsive.js';
import { useGeminiStream } from './hooks/useGeminiStream.js';
import { useLoadingIndicator } from './hooks/useLoadingIndicator.js';
import { useThemeCommand } from './hooks/useThemeCommand.js';
import { useAuthCommand } from './hooks/useAuthCommand.js';
import { useFolderTrust } from './hooks/useFolderTrust.js';
import { useIdeTrustListener } from './hooks/useIdeTrustListener.js';
import { useEditorSettings } from './hooks/useEditorSettings.js';
import { useSlashCommandProcessor } from './hooks/slashCommandProcessor.js';
import { useAutoAcceptIndicator } from './hooks/useAutoAcceptIndicator.js';
import { useConsoleMessages } from './hooks/useConsoleMessages.js';
import { useExtensionAutoUpdate } from './hooks/useExtensionAutoUpdate.js';
import { useExtensionUpdates } from './hooks/useExtensionUpdates.js';
import { loadHierarchicalLlxprtMemory } from '../config/config.js';
import {
  DEFAULT_HISTORY_MAX_BYTES,
  DEFAULT_HISTORY_MAX_ITEMS,
} from '../constants/historyLimits.js';
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
  type IModel,
  // type IdeInfo, // TODO: Fix IDE integration
  getSettingsService,
  DebugLogger,
  uiTelemetryService,
} from '@vybestack/llxprt-code-core';
import { IdeIntegrationNudgeResult } from './IdeIntegrationNudge.js';
import { validateAuthMethod } from '../config/auth.js';
import { useLogger } from './hooks/useLogger.js';
import { useSessionStats } from './contexts/SessionContext.js';
import { useGitBranchName } from './hooks/useGitBranchName.js';
import { useFocus } from './hooks/useFocus.js';
import { useBracketedPaste } from './hooks/useBracketedPaste.js';
import { useTextBuffer } from './components/shared/text-buffer.js';
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
import { useProviderModelDialog } from './hooks/useProviderModelDialog.js';
import { useProviderDialog } from './hooks/useProviderDialog.js';
import { useLoadProfileDialog } from './hooks/useLoadProfileDialog.js';
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
import {
  ENABLE_FOCUS_TRACKING,
  DISABLE_FOCUS_TRACKING,
  SHOW_CURSOR,
} from './utils/terminalSequences.js';

const CTRL_EXIT_PROMPT_DURATION_MS = 1000;
const debug = new DebugLogger('llxprt:ui:appcontainer');
const selectionLogger = new DebugLogger('llxprt:ui:selection');

interface AppContainerProps {
  config: Config;
  settings: LoadedSettings;
  startupWarnings?: string[];
  version: string;
  appState: AppState;
  appDispatch: React.Dispatch<AppAction>;
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

export const AppContainer = (props: AppContainerProps) => {
  debug.log('AppContainer architecture active (v2)');
  const {
    config,
    settings,
    startupWarnings = [],
    appState,
    appDispatch,
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
  const { updateTodos } = useTodoContext();
  const todoPauseController = useMemo(() => new TodoPausePreserver(), []);
  const registerTodoPause = useCallback(() => {
    todoPauseController.registerTodoPause();
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
        } else if (historyService) {
          // Always get the current token count even if not a new instance
          const currentTokens = historyService.getTotalTokens();
          if (
            currentTokens > 0 &&
            currentTokens !== lastPublishedHistoryTokensRef.current
          ) {
            lastPublishedHistoryTokensRef.current = currentTokens;
            updateHistoryTokenCount(currentTokens);
          }
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
  const [_staticNeedsRefresh, setStaticNeedsRefresh] = useState(false);
  const [staticKey, setStaticKey] = useState(0);
  const externalEditorStateRef = useRef<{
    paused: boolean;
    rawModeManaged: boolean;
  } | null>(null);
  const keypressRefreshRef = useRef<() => void>(() => {});

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

    if (keypressRefreshRef.current) {
      keypressRefreshRef.current();
      debug.debug(
        () => 'Keypress refresh requested after external editor closed',
      );
    }

    externalEditorStateRef.current = null;
  }, [setRawMode, stdin]);

  const refreshStatic = useCallback(() => {
    stdout.write(ansiEscapes.clearTerminal);
    setStaticKey((prev) => prev + 1);

    restoreTerminalStateAfterEditor();

    // Re-send terminal control sequences
    enableBracketedPaste();
    enableSupportedProtocol();
    stdout.write(ENABLE_FOCUS_TRACKING);
    stdout.write(SHOW_CURSOR);
  }, [restoreTerminalStateAfterEditor, setStaticKey, stdout]);

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
  const [providerModels, setProviderModels] = useState<IModel[]>([]);
  const [isPermissionsDialogOpen, setIsPermissionsDialogOpen] = useState(false);

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

  const openLoggingDialog = useCallback((data?: { entries: unknown[] }) => {
    setLoggingDialogData(data || { entries: [] });
    setIsLoggingDialogOpen(true);
  }, []);

  const closeLoggingDialog = useCallback(() => {
    setIsLoggingDialogOpen(false);
  }, []);

  const {
    showWorkspaceMigrationDialog,
    workspaceExtensions,
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
    useFolderTrust(settings, config);

  const { needsRestart: ideNeedsRestart } = useIdeTrustListener(config);
  useEffect(() => {
    if (ideNeedsRestart) {
      // IDE trust changed, force a restart.
      setShowIdeRestartPrompt(true);
    }
  }, [ideNeedsRestart]);

  useKeypress(
    (key) => {
      if (key.name === 'r' || key.name === 'R') {
        process.exit(0);
      }
    },
    { isActive: showIdeRestartPrompt },
  );

  const {
    isAuthDialogOpen,
    openAuthDialog,
    handleAuthSelect,
    isAuthenticating,
    cancelAuthentication,
  } = useAuthCommand(settings, appState, config);

  useEffect(() => {
    if (settings.merged.selectedAuthType && !settings.merged.useExternalAuth) {
      const error = validateAuthMethod(settings.merged.selectedAuthType);
      if (error) {
        setAuthError(error);
        // Don't automatically open auth dialog - user must use /auth command
      }
    }
  }, [
    settings.merged.selectedAuthType,
    settings.merged.useExternalAuth,
    setAuthError,
  ]);

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

  const {
    showDialog: isProviderModelDialogOpen,
    openDialog: openProviderModelDialogRaw,
    handleSelect: handleProviderModelChange,
    closeDialog: exitProviderModelDialog,
  } = useProviderModelDialog({
    addMessage: (msg) =>
      addItem(
        { type: msg.type as MessageType, text: msg.content },
        msg.timestamp.getTime(),
      ),
    appState,
  });

  const openProviderModelDialog = useCallback(async () => {
    try {
      const models = await runtime.listAvailableModels();
      setProviderModels(models);
    } catch (e) {
      console.error('Failed to load models:', e);
      setProviderModels([]);
    }
    await openProviderModelDialogRaw();
  }, [openProviderModelDialogRaw, runtime]);

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
        process.cwd(),
        settings.merged.loadMemoryFromIncludeDirectories
          ? config.getWorkspaceContext().getDirectories()
          : [],
        config.getDebugMode(),
        config.getFileService(),
        settings.merged,
        config.getExtensionContextFilePaths(),
        config.getFolderTrust(),
        settings.merged.ui?.memoryImportFormat || 'tree', // Use setting or default to 'tree'
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
    cancelAuthentication();
    // NEVER automatically open auth dialog - user must use /auth
  }, [setAuthError, cancelAuthentication]);

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
      openProviderModelDialog,
      openPermissionsDialog,
      openProviderDialog,
      openLoadProfileDialog,
      quit: setQuittingMessages,
      setDebugMessage,
      toggleCorgiMode,
      toggleDebugProfiler,
      dispatchExtensionStateUpdate,
      addConfirmUpdateExtensionRequest,
    }),
    [
      openAuthDialog,
      openThemeDialog,
      openEditorDialog,
      openPrivacyNotice,
      openSettingsDialog,
      openLoggingDialog,
      openProviderModelDialog,
      openPermissionsDialog,
      openProviderDialog,
      openLoadProfileDialog,
      setQuittingMessages,
      setDebugMessage,
      toggleCorgiMode,
      toggleDebugProfiler,
      dispatchExtensionStateUpdate,
      addConfirmUpdateExtensionRequest,
    ],
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

  const handleUserCancel = useCallback(() => {
    const lastUserMessage = inputHistoryStore.inputHistory.at(-1);
    if (lastUserMessage) {
      buffer.setText(lastUserMessage);
    }
  }, [buffer, inputHistoryStore.inputHistory]);

  const handleOAuthCodeDialogClose = useCallback(() => {
    appDispatch({ type: 'CLOSE_DIALOG', payload: 'oauthCode' });
  }, [appDispatch]);

  const handleOAuthCodeSubmit = useCallback(
    async (code: string) => {
      const provider = (global as unknown as { __oauth_provider?: string })
        .__oauth_provider;

      if (provider === 'anthropic') {
        const oauthManager = runtime.getCliOAuthManager();

        if (oauthManager) {
          const anthropicProvider = oauthManager.getProvider('anthropic');
          if (anthropicProvider && 'submitAuthCode' in anthropicProvider) {
            (
              anthropicProvider as { submitAuthCode: (code: string) => void }
            ).submitAuthCode(code);
          }
        }
      }
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
    registerTodoPause,
    handleExternalEditorOpen,
  );

  const pendingHistoryItems = useMemo(
    () => [...pendingSlashCommandHistoryItems, ...pendingGeminiHistoryItems],
    [pendingSlashCommandHistoryItems, pendingGeminiHistoryItems],
  );

  // Update the cancel handler with message queue support
  const cancelHandlerRef = useRef<(() => void) | null>(null);
  cancelHandlerRef.current = useCallback(() => {
    if (isToolExecuting(pendingHistoryItems)) {
      buffer.setText(''); // Just clear the prompt
      return;
    }

    const lastUserMessage = inputHistoryStore.inputHistory.at(-1);
    const textToSet = lastUserMessage || '';

    if (textToSet) {
      buffer.setText(textToSet);
    }
  }, [buffer, inputHistoryStore.inputHistory, pendingHistoryItems]);

  // Input handling - queue messages for processing
  const handleFinalSubmit = useCallback(
    (submittedValue: string) => {
      const trimmedValue = submittedValue.trim();
      if (trimmedValue.length > 0) {
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
    settings.merged.wittyPhraseStyle || 'default',
    settings.merged.customWittyPhrases,
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
      // Debug log keystrokes if enabled
      if (settings.merged.debugKeystrokeLogging) {
        console.log('[DEBUG] Keystroke:', JSON.stringify(key));
      }

      // Handle exit keys BEFORE dialog visibility check so exit prompts work even when dialogs are open
      if (keyMatchers[Command.QUIT](key)) {
        // When authenticating, let AuthInProgress component handle Ctrl+C.
        if (isAuthenticating) {
          return;
        }
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
      } else if (keyMatchers[Command.TOGGLE_TOOL_DESCRIPTIONS](key)) {
        const newValue = !showToolDescriptions;
        setShowToolDescriptions(newValue);

        const mcpServers = config.getMcpServers();
        if (Object.keys(mcpServers || {}).length > 0) {
          handleSlashCommand(newValue ? '/mcp desc' : '/mcp nodesc');
        }
      } else if (
        keyMatchers[Command.TOGGLE_IDE_CONTEXT_DETAIL](key) &&
        config.getIdeMode() &&
        ideContextState
      ) {
        // Show IDE status when in IDE mode and context is available.
        handleSlashCommand('/ide status');
      } else if (
        keyMatchers[Command.SHOW_MORE_LINES](key) &&
        !enteringConstrainHeightMode
      ) {
        setConstrainHeight(false);
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
      isAuthenticating,
      cancelOngoingRequest,
      settings.merged.debugKeystrokeLogging,
    ],
  );

  const { refresh: globalKeypressRefresh } = useKeypress(handleGlobalKeypress, {
    isActive: true,
  });

  useEffect(() => {
    keypressRefreshRef.current = globalKeypressRefresh;
  }, [globalKeypressRefresh]);

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
    !isProcessing;

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
    console.clear();
    refreshStatic();
  }, [clearItems, clearConsoleMessagesState, refreshStatic]);

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
      !isAuthenticating &&
      !isAuthDialogOpen &&
      !isThemeDialogOpen &&
      !isEditorDialogOpen &&
      !isProviderDialogOpen &&
      !isProviderModelDialogOpen &&
      !isToolsDialogOpen &&
      !showPrivacyNotice &&
      geminiClient
    ) {
      submitQuery(initialPrompt);
      initialPromptSubmitted.current = true;
    }
  }, [
    initialPrompt,
    submitQuery,
    isAuthenticating,
    isAuthDialogOpen,
    isThemeDialogOpen,
    isEditorDialogOpen,
    isProviderDialogOpen,
    isProviderModelDialogOpen,
    isToolsDialogOpen,
    showPrivacyNotice,
    geminiClient,
  ]);

  const mainAreaWidth = Math.floor(terminalWidth * 0.9);

  // Detect PowerShell for file reference syntax tip
  const isPowerShell =
    process.env.PSModulePath !== undefined ||
    process.env.PSVERSION !== undefined;

  const placeholder = vimModeEnabled
    ? "  Press 'i' for INSERT mode and 'Esc' for NORMAL mode."
    : isPowerShell
      ? '  Type your message, @path/to/file or +path/to/file'
      : '  Type your message or @path/to/file';

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
    isAuthenticating,
    isEditorDialogOpen,
    isProviderDialogOpen,
    isProviderModelDialogOpen,
    isLoadProfileDialogOpen,
    isToolsDialogOpen,
    isFolderTrustDialogOpen,
    showWorkspaceMigrationDialog,
    showPrivacyNotice,
    isOAuthCodeDialogOpen: appState.openDialogs.oauthCode,
    isPermissionsDialogOpen,
    isLoggingDialogOpen,

    // Dialog data
    providerOptions,
    selectedProvider,
    providerModels,
    currentModel,
    profiles,
    toolsDialogAction,
    toolsDialogTools,
    toolsDialogDisabledTools,
    workspaceExtensions,
    loggingDialogData,

    // Confirmation requests
    shellConfirmationRequest,
    confirmationRequest,
    confirmUpdateExtensionRequests,

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

    // Input history
    inputHistory: inputHistoryStore.inputHistory,

    // Static key for refreshing
    staticKey,

    // Debug
    debugMessage,
    showDebugProfiler,

    // Footer height
    footerHeight,

    // Placeholder text
    placeholder,

    // Available terminal height for content (after footer measurement)
    availableTerminalHeight,
  };

  // Build UIActions object
  const uiActions: UIActions = {
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
    cancelAuthentication,
    handleAuthTimeout,

    // Editor dialog
    openEditorDialog,
    handleEditorSelect,
    exitEditorDialog,

    // Provider dialog
    openProviderDialog,
    handleProviderSelect,
    exitProviderDialog,

    // Provider model dialog
    openProviderModelDialog,
    handleProviderModelChange,
    exitProviderModelDialog,

    // Load profile dialog
    openLoadProfileDialog,
    handleProfileSelect,
    exitLoadProfileDialog,

    // Tools dialog
    openToolsDialog,
    handleToolsSelect,
    exitToolsDialog,

    // Folder trust dialog
    handleFolderTrustSelect,

    // Permissions dialog
    openPermissionsDialog,
    closePermissionsDialog,

    // Logging dialog
    openLoggingDialog,
    closeLoggingDialog,

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
  };

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
