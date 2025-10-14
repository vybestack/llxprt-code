/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  useReducer,
} from 'react';
import {
  Box,
  type DOMElement,
  measureElement,
  Static,
  Text,
  useStdin,
  useStdout,
} from 'ink';
import {
  StreamingState,
  type HistoryItem,
  MessageType,
  ToolCallStatus,
  type HistoryItemWithoutId,
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
import { Header } from './components/Header.js';
import { LoadingIndicator } from './components/LoadingIndicator.js';
import { AutoAcceptIndicator } from './components/AutoAcceptIndicator.js';
import { ShellModeIndicator } from './components/ShellModeIndicator.js';
import { InputPrompt } from './components/InputPrompt.js';
import { Footer } from './components/Footer.js';
import { ThemeDialog } from './components/ThemeDialog.js';
import { AuthDialog } from './components/AuthDialog.js';
import { AuthInProgress } from './components/AuthInProgress.js';
import { OAuthCodeDialog } from './components/OAuthCodeDialog.js';
import { EditorSettingsDialog } from './components/EditorSettingsDialog.js';
import { FolderTrustDialog } from './components/FolderTrustDialog.js';
import { ShellConfirmationDialog } from './components/ShellConfirmationDialog.js';
import { RadioButtonSelect } from './components/shared/RadioButtonSelect.js';
import { Colors } from './colors.js';
import { loadHierarchicalLlxprtMemory } from '../config/config.js';
import { LoadedSettings, SettingScope } from '../config/settings.js';
import { Tips } from './components/Tips.js';
import { ConsolePatcher } from './utils/ConsolePatcher.js';
import { registerCleanup } from '../utils/cleanup.js';
import { DetailedMessagesDisplay } from './components/DetailedMessagesDisplay.js';
import { HistoryItemDisplay } from './components/HistoryItemDisplay.js';
import { ContextSummaryDisplay } from './components/ContextSummaryDisplay.js';
import { useHistory } from './hooks/useHistoryManager.js';
import { useInputHistoryStore } from './hooks/useInputHistoryStore.js';
import process from 'node:process';
import {
  getErrorMessage,
  type Config,
  getAllLlxprtMdFilenames,
  ApprovalMode,
  isEditorAvailable,
  EditorType,
  FlashFallbackEvent,
  logFlashFallback,
  AuthType,
  type IdeContext,
  ideContext,
  type IModel,
  getSettingsService,
  DebugLogger,
  isProQuotaExceededError,
  isGenericQuotaExceededError,
  UserTierId,
  uiTelemetryService,
  DEFAULT_GEMINI_FLASH_MODEL,
} from '@vybestack/llxprt-code-core';
import {
  IdeIntegrationNudge,
  IdeIntegrationNudgeResult,
} from './IdeIntegrationNudge.js';
import { validateAuthMethod } from '../config/auth.js';
import { useLogger } from './hooks/useLogger.js';
import { StreamingContext } from './contexts/StreamingContext.js';
import {
  SessionStatsProvider,
  useSessionStats,
} from './contexts/SessionContext.js';
import { useGitBranchName } from './hooks/useGitBranchName.js';
import { useFocus } from './hooks/useFocus.js';
import { useBracketedPaste } from './hooks/useBracketedPaste.js';
import { useTextBuffer } from './components/shared/text-buffer.js';
import { useVimMode, VimModeProvider } from './contexts/VimModeContext.js';
import { useVim } from './hooks/vim.js';
import { useKeypress, Key } from './hooks/useKeypress.js';
import { KeypressProvider } from './contexts/KeypressContext.js';
import { useKittyKeyboardProtocol } from './hooks/useKittyKeyboardProtocol.js';
import { keyMatchers, Command } from './keyMatchers.js';
import * as fs from 'fs';
import {
  appReducer,
  initialAppState,
  type AppState,
  type AppAction,
} from './reducers/appReducer.js';
import { AppDispatchProvider } from './contexts/AppDispatchContext.js';
import { UpdateNotification } from './components/UpdateNotification.js';
import { UpdateObject } from './utils/updateCheck.js';
import ansiEscapes from 'ansi-escapes';
import { TodoProvider } from './contexts/TodoProvider.js';
import { ToolCallProvider } from './contexts/ToolCallProvider.js';
import { OverflowProvider } from './contexts/OverflowContext.js';
import { ShowMoreLines } from './components/ShowMoreLines.js';
import { PrivacyNotice } from './privacy/PrivacyNotice.js';
import { useSettingsCommand } from './hooks/useSettingsCommand.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { ProQuotaDialog } from './components/ProQuotaDialog.js';
import { setUpdateHandler } from '../utils/handleAutoUpdate.js';
import { appEvents, AppEvent } from '../utils/events.js';
import { getProviderManager } from '../providers/providerManagerInstance.js';
import { useProviderModelDialog } from './hooks/useProviderModelDialog.js';
import { useProviderDialog } from './hooks/useProviderDialog.js';
import { useLoadProfileDialog } from './hooks/useLoadProfileDialog.js';
import { useToolsDialog } from './hooks/useToolsDialog.js';
import { ProviderModelDialog } from './components/ProviderModelDialog.js';
import { ProviderDialog } from './components/ProviderDialog.js';
import { LoadProfileDialog } from './components/LoadProfileDialog.js';
import { ToolsDialog } from './components/ToolsDialog.js';

// Todo UI imports
import { TodoPanel } from './components/TodoPanel.js';
import { useTodoContext } from './contexts/TodoContext.js';
import { useWorkspaceMigration } from './hooks/useWorkspaceMigration.js';
import { WorkspaceMigrationDialog } from './components/WorkspaceMigrationDialog.js';
import { isWorkspaceTrusted } from '../config/trustedFolders.js';

const CTRL_EXIT_PROMPT_DURATION_MS = 1000;

interface AppProps {
  config: Config;
  settings: LoadedSettings;
  startupWarnings?: string[];
  version: string;
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

export const AppWrapper = (props: AppProps) => {
  const kittyProtocolStatus = useKittyKeyboardProtocol();
  return (
    <KeypressProvider
      kittyProtocolEnabled={kittyProtocolStatus.enabled}
      config={props.config}
      debugKeystrokeLogging={props.settings.merged.debugKeystrokeLogging}
    >
      <SessionStatsProvider>
        <VimModeProvider settings={props.settings}>
          <ToolCallProvider sessionId={props.config.getSessionId()}>
            <TodoProvider sessionId={props.config.getSessionId()}>
              <AppWithState {...props} />
            </TodoProvider>
          </ToolCallProvider>
        </VimModeProvider>
      </SessionStatsProvider>
    </KeypressProvider>
  );
};

// New intermediate component that manages state and provides context
const AppWithState = (props: AppProps) => {
  const [appState, appDispatch] = useReducer(appReducer, initialAppState);

  return (
    <AppDispatchProvider value={appDispatch}>
      <App {...props} appState={appState} appDispatch={appDispatch} />
    </AppDispatchProvider>
  );
};

interface AppInternalProps extends AppProps {
  appState: AppState;
  appDispatch: React.Dispatch<AppAction>;
}

const App = (props: AppInternalProps) => {
  const {
    config,
    settings,
    startupWarnings = [],
    version,
    appState,
    appDispatch,
  } = props;
  const isFocused = useFocus();
  const { isNarrow } = useResponsive();
  useBracketedPaste();
  const [updateInfo, setUpdateInfo] = useState<UpdateObject | null>(null);
  const { stdout } = useStdout();
  const nightly = version.includes('nightly');
  const { history, addItem, clearItems, loadHistory } = useHistory();
  const { updateTodos } = useTodoContext();

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
    return cleanup;
  }, [addItem]);

  const {
    consoleMessages,
    handleNewMessage,
    clearConsoleMessages: clearConsoleMessagesState,
  } = useConsoleMessages();

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
          if (currentTokens > 0) {
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
            updateHistoryTokenCount(event.totalTokens);
          };

          historyService.on('tokensUpdated', handleTokensUpdated);

          // Initialize with current token count
          const currentTokens = historyService.getTotalTokens();
          tokenLogger.debug(() => `Initial token count: ${currentTokens}`);
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
    };
  }, [config, updateHistoryTokenCount, tokenLogger]);
  const [staticNeedsRefresh, setStaticNeedsRefresh] = useState(false);
  const [staticKey, setStaticKey] = useState(0);
  const refreshStatic = useCallback(() => {
    stdout.write(ansiEscapes.clearTerminal);
    setStaticKey((prev) => prev + 1);
  }, [setStaticKey, stdout]);

  const [llxprtMdFileCount, setLlxprtMdFileCount] = useState<number>(0);
  const [debugMessage, setDebugMessage] = useState<string>('');
  const [_themeError, _setThemeError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [_editorError, _setEditorError] = useState<string | null>(null);
  const [footerHeight, setFooterHeight] = useState<number>(0);

  // Token metrics state for live updates
  const [tokenMetrics, setTokenMetrics] = useState({
    tokensPerMinute: 0,
    throttleWaitTimeMs: 0,
    sessionTokenTotal: 0,
  });
  const [_corgiMode, setCorgiMode] = useState(false);
  const [_isTrustedFolderState, _setIsTrustedFolder] = useState(
    isWorkspaceTrusted(settings.merged),
  );
  const [currentModel, setCurrentModel] = useState(config.getModel());
  const [shellModeActive, setShellModeActive] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState<boolean>(false);
  const [showToolDescriptions, setShowToolDescriptions] =
    useState<boolean>(false);

  const [ctrlCPressedOnce, setCtrlCPressedOnce] = useState(false);
  const [quittingMessages, setQuittingMessages] = useState<
    HistoryItem[] | null
  >(null);
  const ctrlCTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [ctrlDPressedOnce, setCtrlDPressedOnce] = useState(false);
  const ctrlDTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [constrainHeight, setConstrainHeight] = useState<boolean>(true);
  const [showPrivacyNotice, setShowPrivacyNotice] = useState<boolean>(false);
  const [modelSwitchedFromQuotaError, setModelSwitchedFromQuotaError] =
    useState<boolean>(false);
  const [userTier, setUserTier] = useState<UserTierId | undefined>(undefined);
  const [ideContextState, setIdeContextState] = useState<
    IdeContext | undefined
  >();
  const [showEscapePrompt, setShowEscapePrompt] = useState(false);
  const [showIdeRestartPrompt, setShowIdeRestartPrompt] = useState(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [providerModels, setProviderModels] = useState<IModel[]>([]);

  const {
    showWorkspaceMigrationDialog,
    workspaceExtensions,
    onWorkspaceMigrationDialogOpen,
    onWorkspaceMigrationDialogClose,
  } = useWorkspaceMigration(settings);

  const [isProQuotaDialogOpen, setIsProQuotaDialogOpen] = useState(false);
  const [proQuotaDialogResolver, setProQuotaDialogResolver] = useState<
    ((value: boolean) => void) | null
  >(null);

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

  // Sync user tier from config when authentication changes
  useEffect(() => {
    // Only sync when not currently authenticating
    if (!isAuthenticating) {
      setUserTier(config.getGeminiClient()?.getUserTier());
    }
  }, [config, isAuthenticating]);

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

  const providerManager = getProviderManager(config, false, settings, addItem);
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
      const activeProvider = providerManager.getActiveProvider();
      if (activeProvider) {
        const models = await activeProvider.getModels();
        setProviderModels(models);
      }
    } catch (e) {
      console.error('Failed to load models:', e);
      setProviderModels([]);
    }
    await openProviderModelDialogRaw();
  }, [providerManager, openProviderModelDialogRaw]);

  // Watch for model changes from config
  useEffect(() => {
    const checkModelChange = () => {
      const configModel = config.getModel();
      const activeProvider = providerManager.getActiveProvider();

      // Get the actual current model from provider
      const providerModel = activeProvider?.getCurrentModel?.() || configModel;

      // Update UI if different from what we're showing
      if (providerModel !== currentModel) {
        console.debug(
          `[Model Update] Updating footer from ${currentModel} to ${providerModel}`,
        );
        setCurrentModel(providerModel);
      }
    };

    // Check immediately
    checkModelChange();

    // Check periodically (every 500ms)
    const interval = setInterval(checkModelChange, 500);

    return () => clearInterval(interval);
  }, [config, providerManager, currentModel]); // Include currentModel in dependencies

  const toggleCorgiMode = useCallback(() => {
    setCorgiMode((prev) => !prev);
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
        settings.merged.memoryImportFormat || 'tree', // Use setting or default to 'tree'
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

  // Removed - consolidated into single useEffect above

  // Poll for token metrics updates
  useEffect(() => {
    const updateTokenMetrics = () => {
      const providerManager = getProviderManager();
      if (providerManager) {
        const metrics = providerManager.getProviderMetrics?.();
        const usage = providerManager.getSessionTokenUsage?.();

        const newMetrics = {
          tokensPerMinute: metrics?.tokensPerMinute || 0,
          throttleWaitTimeMs: metrics?.throttleWaitTimeMs || 0,
          sessionTokenTotal: usage?.total || 0,
        };

        setTokenMetrics(newMetrics);

        // Also update the telemetry service for other components
        if (usage) {
          uiTelemetryService.setTokenTrackingMetrics({
            tokensPerMinute: metrics?.tokensPerMinute || 0,
            throttleWaitTimeMs: metrics?.throttleWaitTimeMs || 0,
            sessionTokenUsage: {
              input: usage.input || 0,
              output: usage.output || 0,
              cache: usage.cache || 0,
              tool: usage.tool || 0,
              thought: usage.thought || 0,
              total: usage.total || 0,
            },
          });
        }
      }
    };

    // Update immediately
    updateTokenMetrics();

    // Poll every second to show live updates
    const interval = setInterval(updateTokenMetrics, 1000);

    return () => clearInterval(interval);
  }, []);

  // Set up Flash fallback handler
  useEffect(() => {
    const flashFallbackHandler = async (
      currentModel: string,
      fallbackModel: string,
      error?: unknown,
    ): Promise<boolean> => {
      // Check if we've already switched to the fallback model
      if (config.isInFallbackMode()) {
        // If we're already in fallback mode, don't show the dialog again
        return false;
      }

      let message: string;

      const contentGenConfig = config.getContentGeneratorConfig();
      const authType = contentGenConfig?.authType;
      if (authType === AuthType.LOGIN_WITH_GOOGLE) {
        // Use actual user tier if available; otherwise, default to FREE tier behavior (safe default)
        const isPaidTier =
          userTier === UserTierId.LEGACY || userTier === UserTierId.STANDARD;

        // Check if this is a Pro quota exceeded error
        if (error && isProQuotaExceededError(error)) {
          if (isPaidTier) {
            message = `⚡ You have reached your daily ${currentModel} quota limit.
⚡ You can choose to authenticate with a paid API key or continue with the fallback model.
⚡ To continue accessing the ${currentModel} model today, consider using /auth to switch to using a paid API key from AI Studio at https://aistudio.google.com/apikey`;
          } else {
            message = `⚡ You have reached your daily ${currentModel} quota limit.
⚡ You can choose to authenticate with a paid API key or continue with the fallback model.
⚡ To increase your limits, upgrade to a Gemini Code Assist Standard or Enterprise plan with higher limits at https://goo.gle/set-up-gemini-code-assist
⚡ Or you can utilize a Gemini API Key. See: https://goo.gle/gemini-cli-docs-auth#gemini-api-key
⚡ You can switch authentication methods by typing /auth`;
          }
        } else if (error && isGenericQuotaExceededError(error)) {
          if (isPaidTier) {
            message = `You have reached your daily quota limit.
To continue, consider using /auth to switch to using a paid API key from AI Studio at https://aistudio.google.com/apikey
Or you can switch to a different model using the /model command`;
          } else {
            message = `You have reached your daily quota limit.
To increase your limits, upgrade to a Gemini Code Assist Standard or Enterprise plan with higher limits at https://goo.gle/set-up-gemini-code-assist
Or you can utilize a Gemini API Key. See: https://goo.gle/gemini-cli-docs-auth#gemini-api-key
You can switch authentication methods by typing /auth or switch to a different model using /model`;
          }
        } else {
          if (isPaidTier) {
            // Default message for other cases (like consecutive 429s)
            message = `You are experiencing capacity issues with ${currentModel}.
Possible reasons are consecutive capacity errors or reaching your daily ${currentModel} quota limit.
To continue, consider using /auth to switch to using a paid API key from AI Studio at https://aistudio.google.com/apikey
Or you can switch to a different model using the /model command`;
          } else {
            // Default message for other cases (like consecutive 429s)
            message = `You are experiencing capacity issues with ${currentModel}.
Possible reasons are consecutive capacity errors or reaching your daily ${currentModel} quota limit.
To increase your limits, upgrade to a Gemini Code Assist Standard or Enterprise plan with higher limits at https://goo.gle/set-up-gemini-code-assist
Or you can utilize a Gemini API Key. See: https://goo.gle/gemini-cli-docs-auth#gemini-api-key
You can switch authentication methods by typing /auth or switch to a different model using /model`;
          }
        }

        // Add message to UI history
        if (message) {
          addItem(
            {
              type: MessageType.INFO,
              text: message,
            },
            Date.now(),
          );
        }

        // For Pro quota errors, show the dialog and wait for user's choice
        if (error && isProQuotaExceededError(error)) {
          // Set the flag to prevent tool continuation
          setModelSwitchedFromQuotaError(true);
          // Set global quota error flag to prevent Flash model calls
          config.setQuotaErrorOccurred(true);

          // Show the ProQuotaDialog and wait for user's choice
          const shouldContinueWithFallback = await new Promise<boolean>(
            (resolve) => {
              setIsProQuotaDialogOpen(true);
              setProQuotaDialogResolver(() => resolve);
            },
          );

          // If user chose to continue with fallback, we don't need to stop the current prompt
          if (shouldContinueWithFallback) {
            // Switch to fallback model for future use
            config.setModel(fallbackModel);
            config.setFallbackMode(true);
            logFlashFallback(
              config,
              new FlashFallbackEvent(
                config.getContentGeneratorConfig()?.authType ||
                  AuthType.USE_PROVIDER,
              ),
            );
            return true; // Continue with current prompt using fallback model
          }

          // If user chose to authenticate, stop current prompt
          return false;
        }

        // For other quota errors, automatically switch to fallback model
        // Set the flag to prevent tool continuation
        setModelSwitchedFromQuotaError(true);
        // Set global quota error flag to prevent Flash model calls
        config.setQuotaErrorOccurred(true);
      }

      // Don't switch models - let the user decide
      // Don't set fallback mode either
      const contentGenConfigForEvent = config.getContentGeneratorConfig();
      const authTypeForEvent =
        contentGenConfigForEvent?.authType || AuthType.USE_PROVIDER;
      // Still log the event for telemetry
      logFlashFallback(config, new FlashFallbackEvent(authTypeForEvent));
      return false; // Don't continue with current prompt
    };

    config.setFlashFallbackHandler(flashFallbackHandler);
  }, [config, addItem, userTier]);

  // Terminal and UI setup
  const { rows: terminalHeight, columns: terminalWidth } = useTerminalSize();
  const { stdin, setRawMode } = useStdin();
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
    const editorType = settings.merged.preferredEditor;
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

  // Commented out unused onOAuthCodeNeeded
  // const onOAuthCodeNeeded = useCallback(
  //   (provider: string) => {
  //     // Store provider for the dialog
  //     (global as unknown as { __oauth_provider: string }).__oauth_provider =
  //       provider;
  //     // Open the OAuth code input dialog
  //     appDispatch({ type: 'OPEN_DIALOG', payload: 'oauthCode' });
  //   },
  //   [appDispatch],
  // );

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
    setDebugMessage,
    openThemeDialog,
    openAuthDialog,
    openEditorDialog,
    openProviderDialog,
    openProviderModelDialog,
    openLoadProfileDialog,
    openToolsDialog,
    toggleCorgiMode,
    setQuittingMessages,
    openPrivacyNotice,
    openSettingsDialog,
    toggleVimEnabled,
    setIsProcessing,
    setLlxprtMdFileCount,
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

  const handleOAuthCodeSubmit = useCallback(async (code: string) => {
    const provider = (global as unknown as { __oauth_provider?: string })
      .__oauth_provider;

    if (provider === 'anthropic') {
      // Get the OAuth manager from provider manager
      const { getOAuthManager } = await import(
        '../providers/providerManagerInstance.js'
      );
      const oauthManager = getOAuthManager();

      if (oauthManager) {
        const anthropicProvider = oauthManager.getProvider('anthropic');
        if (anthropicProvider && 'submitAuthCode' in anthropicProvider) {
          // This will resolve the promise in initiateAuth
          (
            anthropicProvider as { submitAuthCode: (code: string) => void }
          ).submitAuthCode(code);
        }
      }
    }
  }, []);

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
    modelSwitchedFromQuotaError,
    setModelSwitchedFromQuotaError,
    refreshStatic,
    handleUserCancel,
  );

  const pendingHistoryItems = useMemo(
    () => [...pendingSlashCommandHistoryItems, ...pendingGeminiHistoryItems],
    [pendingSlashCommandHistoryItems, pendingGeminiHistoryItems],
  );

  // Message queue functionality removed - not implemented

  // Update the cancel handler with message queue support
  const cancelHandlerRef = useRef<(() => void) | null>(null);
  cancelHandlerRef.current = useCallback(() => {
    if (isToolExecuting(pendingHistoryItems)) {
      buffer.setText(''); // Just clear the prompt
      return;
    }

    const lastUserMessage = inputHistoryStore.inputHistory.at(-1);
    const textToSet = lastUserMessage || '';

    // Queue functionality removed - no queued messages to append

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

  const handleUserInputSubmit = useCallback(
    (submittedValue: string) => {
      // Clear todos only when user types and submits
      updateTodos([]);
      handleFinalSubmit(submittedValue);
    },
    [handleFinalSubmit, updateTodos],
  );

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
    settings.merged.customWittyPhrases,
  );
  const showAutoAcceptIndicator = useAutoAcceptIndicator({ config, addItem });

  const handleProQuotaChoice = useCallback(
    (choice: 'auth' | 'continue') => {
      setIsProQuotaDialogOpen(false);
      if (!proQuotaDialogResolver) return;

      const resolveValue = choice !== 'auth';
      proQuotaDialogResolver(resolveValue);
      setProQuotaDialogResolver(null);

      if (choice === 'auth') {
        openAuthDialog();
      } else {
        addItem(
          {
            type: MessageType.INFO,
            text: 'Switched to fallback model. Tip: Press Ctrl+P to recall your previous prompt and submit it again if you wish.',
          },
          Date.now(),
        );
      }
    },
    [proQuotaDialogResolver, openAuthDialog, addItem],
  );

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
      } else if (keyMatchers[Command.QUIT](key)) {
        // When authenticating, let AuthInProgress component handle Ctrl+C.
        if (isAuthenticating) {
          return;
        }
        if (!ctrlCPressedOnce) {
          cancelOngoingRequest?.();
        }
        handleExit(ctrlCPressedOnce, setCtrlCPressedOnce, ctrlCTimerRef);
      } else if (keyMatchers[Command.EXIT](key)) {
        if (buffer.text.length > 0) {
          return;
        }
        handleExit(ctrlDPressedOnce, setCtrlDPressedOnce, ctrlDTimerRef);
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

  const isInputActive =
    (streamingState === StreamingState.Idle ||
      streamingState === StreamingState.Responding) &&
    !initError &&
    !isProcessing &&
    !isProQuotaDialogOpen;

  const handleClearScreen = useCallback(() => {
    clearItems();
    clearConsoleMessagesState();
    console.clear();
    refreshStatic();
  }, [clearItems, clearConsoleMessagesState, refreshStatic]);

  const handleConfirmationSelect = useCallback(
    (value: boolean) => {
      if (confirmationRequest) {
        confirmationRequest.onConfirm(value);
      }
    },
    [confirmationRequest],
  );

  const mainControlsRef = useRef<DOMElement>(null);
  const pendingHistoryItemRef = useRef<DOMElement>(null);

  useEffect(() => {
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

  useEffect(() => {
    // skip refreshing Static during first mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // debounce so it doesn't fire up too often during resize
    const handler = setTimeout(() => {
      setStaticNeedsRefresh(false);
      refreshStatic();
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [terminalWidth, terminalHeight, refreshStatic]);

  useEffect(() => {
    if (streamingState === StreamingState.Idle && staticNeedsRefresh) {
      setStaticNeedsRefresh(false);
      refreshStatic();
    }
  }, [streamingState, refreshStatic, staticNeedsRefresh]);

  const filteredConsoleMessages = useMemo(() => {
    if (config.getDebugMode()) {
      return consoleMessages;
    }
    return consoleMessages.filter((msg) => msg.type !== 'debug');
  }, [consoleMessages, config]);

  const branchName = useGitBranchName(config.getTargetDir());

  const contextFileNames = useMemo(() => {
    const fromSettings = settings.merged.contextFileName;
    if (fromSettings) {
      return Array.isArray(fromSettings) ? fromSettings : [fromSettings];
    }
    return getAllLlxprtMdFilenames();
  }, [settings.merged.contextFileName]);

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
      geminiClient?.isInitialized?.()
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

  if (quittingMessages) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        {quittingMessages.map((item) => (
          <HistoryItemDisplay
            key={item.id}
            availableTerminalHeight={
              constrainHeight ? availableTerminalHeight : undefined
            }
            terminalWidth={terminalWidth}
            item={item}
            isPending={false}
            config={config}
            slashCommands={slashCommands}
          />
        ))}
      </Box>
    );
  }

  const mainAreaWidth = Math.floor(terminalWidth * 0.9);
  const debugConsoleMaxHeight = Math.floor(Math.max(terminalHeight * 0.2, 5));
  // Arbitrary threshold to ensure that items in the static area are large
  // enough but not too large to make the terminal hard to use.
  const staticAreaMaxItemHeight = Math.max(terminalHeight * 4, 100);

  // Detect PowerShell for file reference syntax tip
  const isPowerShell =
    process.env.PSModulePath !== undefined ||
    process.env.PSVERSION !== undefined;

  const placeholder = vimModeEnabled
    ? "  Press 'i' for INSERT mode and 'Esc' for NORMAL mode."
    : isPowerShell
      ? '  Type your message, @path/to/file or +path/to/file'
      : '  Type your message or @path/to/file';

  const hideContextSummary = settings.merged.hideContextSummary ?? false;

  return (
    <StreamingContext.Provider value={streamingState}>
      <Box flexDirection="column" width="90%">
        {/*
         * The Static component is an Ink intrinsic in which there can only be 1 per application.
         * Because of this restriction we're hacking it slightly by having a 'header' item here to
         * ensure that it's statically rendered.
         *
         * Background on the Static Item: Anything in the Static component is written a single time
         * to the console. Think of it like doing a console.log and then never using ANSI codes to
         * clear that content ever again. Effectively it has a moving frame that every time new static
         * content is set it'll flush content to the terminal and move the area which it's "clearing"
         * down a notch. Without Static the area which gets erased and redrawn continuously grows.
         */}
        <Static
          key={staticKey}
          items={[
            <Box flexDirection="column" key="header">
              {!(settings.merged.hideBanner || config.getScreenReader()) && (
                <Header
                  terminalWidth={terminalWidth}
                  version={version}
                  nightly={nightly}
                />
              )}
              {!(settings.merged.hideTips || config.getScreenReader()) && (
                <Tips config={config} />
              )}
            </Box>,
            ...history.map((h) => (
              <HistoryItemDisplay
                terminalWidth={mainAreaWidth}
                availableTerminalHeight={staticAreaMaxItemHeight}
                key={h.id}
                item={h}
                isPending={false}
                config={config}
                slashCommands={slashCommands}
              />
            )),
          ]}
        >
          {(item) => item}
        </Static>
        <OverflowProvider>
          <Box ref={pendingHistoryItemRef} flexDirection="column">
            {pendingHistoryItems.map((item, i) => (
              <HistoryItemDisplay
                key={i}
                availableTerminalHeight={
                  constrainHeight ? availableTerminalHeight : undefined
                }
                terminalWidth={mainAreaWidth}
                // TODO(taehykim): It seems like references to ids aren't necessary in
                // HistoryItemDisplay. Refactor later. Use a fake id for now.
                item={{ ...item, id: 0 }}
                isPending={true}
                config={config}
                isFocused={!isEditorDialogOpen}
                slashCommands={slashCommands}
              />
            ))}
            <ShowMoreLines constrainHeight={constrainHeight} />
          </Box>
        </OverflowProvider>

        <Box flexDirection="column" ref={mainControlsRef}>
          {/* Move UpdateNotification to render update notification above input area */}
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

          {/* TodoPanel outside the scrollable area */}
          <TodoPanel width={inputWidth} />

          {showWorkspaceMigrationDialog ? (
            <WorkspaceMigrationDialog
              workspaceExtensions={workspaceExtensions}
              onOpen={onWorkspaceMigrationDialogOpen}
              onClose={onWorkspaceMigrationDialogClose}
            />
          ) : shouldShowIdePrompt && currentIDE ? (
            <IdeIntegrationNudge
              ide={currentIDE}
              onComplete={handleIdePromptComplete}
            />
          ) : isProQuotaDialogOpen ? (
            <ProQuotaDialog
              currentModel={config.getModel()}
              fallbackModel={DEFAULT_GEMINI_FLASH_MODEL}
              onChoice={handleProQuotaChoice}
            />
          ) : showIdeRestartPrompt ? (
            <Box
              borderStyle="round"
              borderColor={Colors.AccentYellow}
              paddingX={1}
            >
              <Text color={Colors.AccentYellow}>
                Workspace trust has changed. Press &apos;r&apos; to restart
                Gemini to apply the changes.
              </Text>
            </Box>
          ) : isFolderTrustDialogOpen ? (
            <FolderTrustDialog
              onSelect={handleFolderTrustSelect}
              isRestarting={isRestarting}
            />
          ) : shellConfirmationRequest ? (
            <ShellConfirmationDialog request={shellConfirmationRequest} />
          ) : confirmationRequest ? (
            <Box flexDirection="column">
              {confirmationRequest.prompt}
              <Box paddingY={1}>
                <RadioButtonSelect
                  isFocused={!!confirmationRequest}
                  items={[
                    { label: 'Yes', value: true },
                    { label: 'No', value: false },
                  ]}
                  onSelect={handleConfirmationSelect}
                />
              </Box>
            </Box>
          ) : isThemeDialogOpen ? (
            <Box flexDirection="column">
              {_themeError && (
                <Box marginBottom={1}>
                  <Text color={Colors.AccentRed}>{_themeError}</Text>
                </Box>
              )}
              <ThemeDialog
                onSelect={handleThemeSelect}
                onHighlight={handleThemeHighlight}
                settings={settings}
                availableTerminalHeight={
                  constrainHeight
                    ? terminalHeight - staticExtraHeight
                    : undefined
                }
                terminalWidth={mainAreaWidth}
              />
            </Box>
          ) : isSettingsDialogOpen ? (
            <Box flexDirection="column">
              <SettingsDialog
                settings={settings}
                onSelect={closeSettingsDialog}
                onRestartRequest={handleSettingsRestart}
              />
            </Box>
          ) : isAuthenticating ? (
            <>
              <AuthInProgress onTimeout={handleAuthTimeout} />
              {showErrorDetails && (
                <OverflowProvider>
                  <Box flexDirection="column">
                    <DetailedMessagesDisplay
                      messages={filteredConsoleMessages}
                      maxHeight={
                        constrainHeight ? debugConsoleMaxHeight : undefined
                      }
                      width={inputWidth}
                    />
                    <ShowMoreLines constrainHeight={constrainHeight} />
                  </Box>
                </OverflowProvider>
              )}
            </>
          ) : isAuthDialogOpen ? (
            <Box flexDirection="column">
              <AuthDialog
                onSelect={handleAuthSelect}
                settings={settings}
                initialErrorMessage={authError}
              />
            </Box>
          ) : appState.openDialogs.oauthCode ? (
            <Box flexDirection="column">
              <OAuthCodeDialog
                provider={
                  ((global as Record<string, unknown>)
                    .__oauth_provider as string) || 'anthropic'
                }
                onClose={handleOAuthCodeDialogClose}
                onSubmit={handleOAuthCodeSubmit}
              />
            </Box>
          ) : isEditorDialogOpen ? (
            <Box flexDirection="column">
              {_editorError && (
                <Box marginBottom={1}>
                  <Text color={Colors.AccentRed}>{_editorError}</Text>
                </Box>
              )}
              <EditorSettingsDialog
                onSelect={handleEditorSelect}
                settings={settings}
                onExit={exitEditorDialog}
              />
            </Box>
          ) : isProviderDialogOpen ? (
            <Box flexDirection="column">
              <ProviderDialog
                providers={providerOptions}
                currentProvider={selectedProvider}
                onSelect={handleProviderSelect}
                onClose={exitProviderDialog}
              />
            </Box>
          ) : isProviderModelDialogOpen ? (
            <Box flexDirection="column">
              <ProviderModelDialog
                models={providerModels}
                currentModel={currentModel}
                onSelect={handleProviderModelChange}
                onClose={exitProviderModelDialog}
              />
            </Box>
          ) : isLoadProfileDialogOpen ? (
            <Box flexDirection="column">
              <LoadProfileDialog
                profiles={profiles}
                onSelect={handleProfileSelect}
                onClose={exitLoadProfileDialog}
              />
            </Box>
          ) : isToolsDialogOpen ? (
            <Box flexDirection="column">
              <ToolsDialog
                tools={toolsDialogTools}
                action={toolsDialogAction}
                disabledTools={toolsDialogDisabledTools}
                onSelect={handleToolsSelect}
                onClose={exitToolsDialog}
              />
            </Box>
          ) : showPrivacyNotice ? (
            <PrivacyNotice onExit={handlePrivacyNoticeExit} config={config} />
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
                    <Text color={Colors.AccentRed}>|⌐■_■| </Text>
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
              {showErrorDetails && (
                <OverflowProvider>
                  <Box flexDirection="column">
                    <DetailedMessagesDisplay
                      messages={filteredConsoleMessages}
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
                <>
                  <InputPrompt
                    buffer={buffer}
                    inputWidth={inputWidth}
                    suggestionsWidth={suggestionsWidth}
                    onSubmit={handleUserInputSubmit}
                    userMessages={inputHistoryStore.inputHistory}
                    onClearScreen={handleClearScreen}
                    config={config}
                    slashCommands={slashCommands}
                    commandContext={commandContext}
                    shellModeActive={shellModeActive}
                    setShellModeActive={setShellModeActive}
                    onEscapePromptChange={handleEscapePromptChange}
                    focus={isFocused}
                    vimHandleInput={vimHandleInput}
                    placeholder={placeholder}
                  />
                </>
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
              {history.find(
                (item) =>
                  item.type === 'error' && item.text?.includes(initError),
              )?.text ? (
                <Text color={Colors.AccentRed}>
                  {
                    history.find(
                      (item) =>
                        item.type === 'error' && item.text?.includes(initError),
                    )?.text
                  }
                </Text>
              ) : (
                <>
                  <Text color={Colors.AccentRed}>
                    Initialization Error: {initError}
                  </Text>
                  <Text color={Colors.AccentRed}>
                    {' '}
                    Please check API key and configuration.
                  </Text>
                </>
              )}
            </Box>
          )}
          {!settings.merged.hideFooter && (
            <Footer
              model={currentModel}
              targetDir={config.getTargetDir()}
              debugMode={config.getDebugMode()}
              branchName={branchName}
              debugMessage={debugMessage}
              errorCount={errorCount}
              showErrorDetails={showErrorDetails}
              showMemoryUsage={
                config.getDebugMode() ||
                settings.merged.showMemoryUsage ||
                false
              }
              historyTokenCount={sessionStats.historyTokenCount}
              nightly={nightly}
              vimMode={vimModeEnabled ? vimMode : undefined}
              contextLimit={
                config.getEphemeralSetting('context-limit') as
                  | number
                  | undefined
              }
              isTrustedFolder={config.isTrustedFolder()}
              tokensPerMinute={tokenMetrics.tokensPerMinute}
              throttleWaitTimeMs={tokenMetrics.throttleWaitTimeMs}
              sessionTokenTotal={tokenMetrics.sessionTokenTotal}
              hideCWD={settings.merged.hideCWD}
              hideSandboxStatus={settings.merged.hideSandboxStatus}
              hideModelInfo={settings.merged.hideModelInfo}
            />
          )}
        </Box>
      </Box>
    </StreamingContext.Provider>
  );
};
