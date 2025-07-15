/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  Box,
  DOMElement,
  Static,
  Text,
  useStdin,
  useStdout,
  useInput,
  type Key as InkKeyType,
} from 'ink';
import { StreamingState, type HistoryItem, MessageType } from './types.js';
import { useGeminiStream } from './hooks/useGeminiStream.js';
import { useLoadingIndicator } from './hooks/useLoadingIndicator.js';
import { useThemeCommand } from './hooks/useThemeCommand.js';
import { useAuthCommand } from './hooks/useAuthCommand.js';
import { useEditorSettings } from './hooks/useEditorSettings.js';
import { useProviderModelDialog } from './hooks/useProviderModelDialog.js';
import { useProviderDialog } from './hooks/useProviderDialog.js';
import { ProviderModelDialog } from './components/ProviderModelDialog.js';
import { ProviderDialog } from './components/ProviderDialog.js';
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
import { EditorSettingsDialog } from './components/EditorSettingsDialog.js';
import { Colors } from './colors.js';
import { Help } from './components/Help.js';
// loadHierarchicalGeminiMemory is now imported in SessionController
import { LoadedSettings } from '../config/settings.js';
import { Tips } from './components/Tips.js';
import { ConsolePatcher } from './utils/ConsolePatcher.js';
import { registerCleanup } from '../utils/cleanup.js';
import { DetailedMessagesDisplay } from './components/DetailedMessagesDisplay.js';
import { HistoryItemDisplay } from './components/HistoryItemDisplay.js';
import { ContextSummaryDisplay } from './components/ContextSummaryDisplay.js';
// useHistory is now managed by SessionController
import process from 'node:process';
import {
  type Config,
  getAllLlxprtMdFilenames,
  ApprovalMode,
  isEditorAvailable,
  EditorType,
} from '@vybestack/llxprt-code-core';
import { validateAuthMethod } from '../config/auth.js';
import { useLogger } from './hooks/useLogger.js';
import { StreamingContext } from './contexts/StreamingContext.js';
import {
  SessionStatsProvider,
  useSessionStats,
} from './contexts/SessionContext.js';
import { useGitBranchName } from './hooks/useGitBranchName.js';
import { useBracketedPaste } from './hooks/useBracketedPaste.js';
import { useTextBuffer } from './components/shared/text-buffer.js';
import * as fs from 'fs';
import { UpdateNotification } from './components/UpdateNotification.js';
// Quota error functions moved to SessionController
import { checkForUpdates } from './utils/updateCheck.js';
import ansiEscapes from 'ansi-escapes';
import { OverflowProvider } from './contexts/OverflowContext.js';
import { ShowMoreLines } from './components/ShowMoreLines.js';
import { PrivacyNotice } from './privacy/PrivacyNotice.js';
import { getProviderManager } from '../providers/providerManagerInstance.js';
import { UIStateShell } from './containers/UIStateShell.js';
import { useLayout } from './components/LayoutManager.js';
import { SessionController } from './containers/SessionController.js';
import { useSession } from './hooks/useSession.js';

const CTRL_EXIT_PROMPT_DURATION_MS = 1000;

// Helper functions moved to SessionController

interface AppProps {
  config: Config;
  settings: LoadedSettings;
  startupWarnings?: string[];
  version: string;
}

interface AppInnerProps extends AppProps {
  isAuthenticating: boolean;
  setIsAuthenticating: (value: boolean) => void;
}

export const AppWrapper = (props: AppProps) => (
  <SessionStatsProvider>
    <App {...props} />
  </SessionStatsProvider>
);

// Inner component that uses layout context
const AppInner = ({
  config,
  settings,
  startupWarnings = [],
  version,
  setIsAuthenticating,
}: AppInnerProps) => {
  useBracketedPaste();
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const { stdout } = useStdout();
  const nightly = version.includes('nightly');

  useEffect(() => {
    checkForUpdates().then(setUpdateMessage);
  }, []);

  const {
    history,
    addItem,
    clearItems,
    loadHistory,
    sessionState,
    dispatch: sessionDispatch,
    appState,
    appDispatch,
    checkPaymentModeChange,
    performMemoryRefresh,
  } = useSession();
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

  const { stats: sessionStats } = useSessionStats();

  // These are now managed by SessionController
  const {
    currentModel,
    isPaidMode,
    transientWarnings: sessionTransientWarnings,
    modelSwitchedFromQuotaError,
  } = sessionState;

  // Add payment mode warning to startup warnings only at startup
  const allStartupWarnings = useMemo(() => {
    const warnings = [...startupWarnings];

    // Only show payment warnings at startup (when history is empty)
    if (history.length === 0) {
      try {
        const providerManager = getProviderManager();
        if (providerManager.hasActiveProvider()) {
          const provider = providerManager.getActiveProvider();
          const isPaidMode = provider.isPaidMode?.();

          if (isPaidMode !== undefined) {
            if (isPaidMode) {
              warnings.push(
                `⚠️  PAID MODE: You are using ${provider.name} with API credentials - usage will be charged to your account`,
              );
            } else if (provider.name === 'gemini') {
              warnings.push(
                `✅ FREE MODE: You are using Gemini with OAuth authentication - no charges will apply`,
              );
            }
          }
        }
      } catch (_e) {
        // Ignore errors when checking payment mode
      }
    }

    return warnings;
  }, [startupWarnings, history]);
  // Use transient warnings from session state
  const transientWarnings = sessionTransientWarnings;
  const [staticNeedsRefresh, setStaticNeedsRefresh] = useState(false);
  const [staticKey, setStaticKey] = useState(0);
  const refreshStatic = useCallback(() => {
    stdout.write(ansiEscapes.clearTerminal);
    setStaticKey((prev) => prev + 1);
  }, [setStaticKey, stdout]);

  const [llxprtMdFileCount, setGeminiMdFileCount] = useState<number>(0);
  const [debugMessage, setDebugMessage] = useState<string>('');
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [corgiMode, setCorgiMode] = useState(false);
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
  const showPrivacyNotice = appState.openDialogs.privacy;
  // modelSwitchedFromQuotaError and userTier are now in sessionState

  const openPrivacyNotice = useCallback(() => {
    appDispatch({ type: 'OPEN_DIALOG', payload: 'privacy' });
  }, [appDispatch]);

  const closePrivacyNotice = useCallback(() => {
    appDispatch({ type: 'CLOSE_DIALOG', payload: 'privacy' });
  }, [appDispatch]);

  const initialPromptSubmitted = useRef(false);

  const errorCount = useMemo(
    () => consoleMessages.filter((msg) => msg.type === 'error').length,
    [consoleMessages],
  );

  // Create dispatch-based wrapper for addItem
  const addItemViaDispatch = useCallback(
    (itemData: Omit<HistoryItem, 'id'>, baseTimestamp: number) => {
      appDispatch({
        type: 'ADD_ITEM',
        payload: { itemData, baseTimestamp },
      });
    },
    [appDispatch],
  );

  const {
    isThemeDialogOpen,
    openThemeDialog,
    handleThemeSelect,
    handleThemeHighlight,
  } = useThemeCommand(settings, appState, addItemViaDispatch);

  const {
    isAuthDialogOpen,
    openAuthDialog,
    handleAuthSelect,
    isAuthenticating: authIsAuthenticating,
    cancelAuthentication,
  } = useAuthCommand(settings, appState, config);

  // Sync auth state with parent
  useEffect(() => {
    setIsAuthenticating(authIsAuthenticating);
  }, [authIsAuthenticating, setIsAuthenticating]);

  const onAuthTimeout = useCallback(() => {
    appDispatch({
      type: 'SET_AUTH_ERROR',
      payload: 'Authentication timed out. Please try again.',
    });
    cancelAuthentication();
    openAuthDialog();
  }, [cancelAuthentication, openAuthDialog, appDispatch]);

  useEffect(() => {
    if (settings.merged.selectedAuthType) {
      const error = validateAuthMethod(settings.merged.selectedAuthType);
      if (error) {
        appDispatch({ type: 'SET_AUTH_ERROR', payload: error });
        openAuthDialog();
      }
    }
  }, [settings.merged.selectedAuthType, openAuthDialog, appDispatch]);

  // User tier sync is now handled by SessionController

  const {
    isEditorDialogOpen,
    openEditorDialog,
    handleEditorSelect,
    exitEditorDialog,
  } = useEditorSettings(settings, appState, addItemViaDispatch);

  const providerModelDialog = useProviderModelDialog({
    addMessage: (m) =>
      addItemViaDispatch(
        { type: m.type, text: m.content },
        m.timestamp.getTime(),
      ),
    onModelChange: () => {
      // Model change detection is handled by SessionController's useEffect
      // No need to manually update here
    },
    appState,
  });

  // Provider selection dialog
  const providerDialog = useProviderDialog({
    addMessage: (m: { type: MessageType; content: string; timestamp: Date }) =>
      addItemViaDispatch(
        { type: m.type, text: m.content },
        m.timestamp.getTime(),
      ),
    onProviderChange: () => {
      // Provider change will be detected by SessionController's useEffect
      checkPaymentModeChange?.();
    },
    appState,
  });

  const toggleCorgiMode = useCallback(() => {
    setCorgiMode((prev) => !prev);
  }, []);

  // checkPaymentModeChange is now provided by SessionController

  // performMemoryRefresh is now provided by SessionController

  // Model watching is now handled by SessionController

  // Flash fallback handler is now set up by SessionController

  const {
    handleSlashCommand,
    slashCommands,
    pendingHistoryItems: pendingSlashCommandHistoryItems,
    commandContext,
  } = useSlashCommandProcessor(
    config,
    settings,
    history,
    addItem,
    clearItems,
    loadHistory,
    refreshStatic,
    setShowHelp,
    setDebugMessage,
    openThemeDialog,
    openAuthDialog,
    openEditorDialog,
    providerDialog.openDialog,
    providerModelDialog.openDialog,
    performMemoryRefresh,
    toggleCorgiMode,
    showToolDescriptions,
    setQuittingMessages,
    openPrivacyNotice,
    checkPaymentModeChange,
  );
  // FIX: Initialize as empty array, will be combined with pendingGeminiHistoryItems later
  // This prevents mutations during render
  let pendingHistoryItems = [...pendingSlashCommandHistoryItems];

  const {
    terminalHeight,
    terminalWidth,
    constrainHeight,
    availableTerminalHeight,
    setConstrainHeight,
    footerRef,
    registerFooterDependency,
  } = useLayout();
  const isInitialMount = useRef(true);
  const { stdin, setRawMode } = useStdin();
  const isValidPath = useCallback((filePath: string): boolean => {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch (_e) {
      return false;
    }
  }, []);

  const widthFraction = 0.9;
  const inputWidth = Math.max(
    20,
    Math.floor(terminalWidth * widthFraction) - 3,
  );
  const suggestionsWidth = Math.max(60, Math.floor(terminalWidth * 0.8));

  const buffer = useTextBuffer({
    initialText: '',
    viewport: useMemo(() => ({ height: 10, width: inputWidth }), [inputWidth]),
    stdin,
    setRawMode,
    isValidPath,
    shellModeActive,
  });

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
        const quitCommand = slashCommands.find(
          (cmd) => cmd.name === 'quit' || cmd.altName === 'exit',
        );
        if (quitCommand && quitCommand.action) {
          quitCommand.action(commandContext, '');
        } else {
          // This is unlikely to be needed but added for an additional fallback.
          process.exit(0);
        }
      } else {
        setPressedOnce(true);
        timerRef.current = setTimeout(() => {
          setPressedOnce(false);
          timerRef.current = null;
        }, CTRL_EXIT_PROMPT_DURATION_MS);
      }
    },
    // Add commandContext to the dependency array here!
    [slashCommands, commandContext],
  );

  useInput((input: string, key: InkKeyType) => {
    let enteringConstrainHeightMode = false;
    if (!constrainHeight) {
      // Automatically re-enter constrain height mode if the user types
      // anything. When constrainHeight==false, the user will experience
      // significant flickering so it is best to disable it immediately when
      // the user starts interacting with the app.
      enteringConstrainHeightMode = true;
      setConstrainHeight(true);
    }

    if (key.ctrl && input === 'o') {
      setShowErrorDetails((prev) => !prev);
    } else if (key.ctrl && input === 't') {
      const newValue = !showToolDescriptions;
      setShowToolDescriptions(newValue);

      const mcpServers = config.getMcpServers();
      if (Object.keys(mcpServers || {}).length > 0) {
        handleSlashCommand(newValue ? '/mcp desc' : '/mcp nodesc');
      }
    } else if (key.ctrl && (input === 'c' || input === 'C')) {
      handleExit(ctrlCPressedOnce, setCtrlCPressedOnce, ctrlCTimerRef);
    } else if (key.ctrl && (input === 'd' || input === 'D')) {
      if (buffer.text.length > 0) {
        // Do nothing if there is text in the input.
        return;
      }
      handleExit(ctrlDPressedOnce, setCtrlDPressedOnce, ctrlDTimerRef);
    } else if (key.ctrl && input === 's' && !enteringConstrainHeightMode) {
      setConstrainHeight(false);
    }
  });

  useEffect(() => {
    if (config) {
      setGeminiMdFileCount(config.getGeminiMdFileCount());
    }
  }, [config]);

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
    appDispatch({ type: 'SET_AUTH_ERROR', payload: 'reauth required' });
    openAuthDialog();
  }, [openAuthDialog, appDispatch]);

  const geminiClientForStream = config.getGeminiClient();

  const {
    streamingState,
    submitQuery,
    initError,
    pendingHistoryItems: pendingGeminiHistoryItems,
    thought,
  } = useGeminiStream(
    geminiClientForStream,
    history,
    addItem,
    setShowHelp,
    config,
    setDebugMessage,
    handleSlashCommand,
    shellModeActive,
    getPreferredEditor,
    onAuthError,
    performMemoryRefresh,
    modelSwitchedFromQuotaError,
    useCallback(
      (value: boolean | ((prev: boolean) => boolean)) => {
        if (typeof value === 'function') {
          // Handle function form of setState
          const currentValue = modelSwitchedFromQuotaError;
          sessionDispatch({
            type: 'SET_MODEL_SWITCHED_FROM_QUOTA_ERROR',
            payload: value(currentValue),
          });
        } else {
          sessionDispatch({
            type: 'SET_MODEL_SWITCHED_FROM_QUOTA_ERROR',
            payload: value,
          });
        }
      },
      [modelSwitchedFromQuotaError, sessionDispatch],
    ) as React.Dispatch<React.SetStateAction<boolean>>,
  );
  // FIX: Create a new array instead of mutating the existing one
  // This ensures React can properly track changes and prevents infinite loops
  pendingHistoryItems = [...pendingHistoryItems, ...pendingGeminiHistoryItems];
  const { elapsedTime, currentLoadingPhrase } =
    useLoadingIndicator(streamingState);
  const showAutoAcceptIndicator = useAutoAcceptIndicator({ config });

  const handleFinalSubmit = useCallback(
    (submittedValue: string) => {
      const trimmedValue = submittedValue.trim();
      if (trimmedValue.length > 0) {
        submitQuery(trimmedValue);
      }
    },
    [submitQuery],
  );

  const logger = useLogger();
  const [userMessages, setUserMessages] = useState<string[]>([]);

  useEffect(() => {
    const fetchUserMessages = async () => {
      const pastMessagesRaw = (await logger?.getPreviousUserMessages()) || []; // Newest first

      const currentSessionUserMessages = history
        .filter(
          (item): item is HistoryItem & { type: 'user'; text: string } =>
            item.type === 'user' &&
            typeof item.text === 'string' &&
            item.text.trim() !== '',
        )
        .map((item) => item.text)
        .reverse(); // Newest first, to match pastMessagesRaw sorting

      // Combine, with current session messages being more recent
      const combinedMessages = [
        ...currentSessionUserMessages,
        ...pastMessagesRaw,
      ];

      // Deduplicate consecutive identical messages from the combined list (still newest first)
      const deduplicatedMessages: string[] = [];
      if (combinedMessages.length > 0) {
        deduplicatedMessages.push(combinedMessages[0]); // Add the newest one unconditionally
        for (let i = 1; i < combinedMessages.length; i++) {
          if (combinedMessages[i] !== combinedMessages[i - 1]) {
            deduplicatedMessages.push(combinedMessages[i]);
          }
        }
      }
      // Reverse to oldest first for useInputHistory
      setUserMessages(deduplicatedMessages.reverse());
    };
    fetchUserMessages();
  }, [history, logger]);

  const isInputActive = streamingState === StreamingState.Idle && !initError;

  const handleClearScreen = useCallback(() => {
    clearItems();
    clearConsoleMessagesState();
    console.clear();
    refreshStatic();
  }, [clearItems, clearConsoleMessagesState, refreshStatic]);

  const pendingHistoryItemRef = useRef<DOMElement>(null);

  // Register dependencies that affect footer height with LayoutManager
  useEffect(() => {
    registerFooterDependency();
  }, [consoleMessages, showErrorDetails, registerFooterDependency]);

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
      !authIsAuthenticating &&
      !isAuthDialogOpen &&
      !isThemeDialogOpen &&
      !isEditorDialogOpen &&
      !showPrivacyNotice &&
      geminiClient
    ) {
      submitQuery(initialPrompt);
      initialPromptSubmitted.current = true;
    }
  }, [
    initialPrompt,
    submitQuery,
    authIsAuthenticating,
    isAuthDialogOpen,
    isThemeDialogOpen,
    isEditorDialogOpen,
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

  // Show loading state if geminiClient is not initialized
  if (!geminiClientForStream) {
    return <Text>Initializing Gemini client...</Text>;
  }

  return (
    <StreamingContext.Provider value={streamingState}>
      <Box flexDirection="column" marginBottom={1} width="90%">
        {/* Move UpdateNotification outside Static so it can re-render when updateMessage changes */}
        {updateMessage && <UpdateNotification message={updateMessage} />}

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
              {!settings.merged.hideBanner && (
                <Header
                  terminalWidth={terminalWidth}
                  version={version}
                  nightly={nightly}
                />
              )}
              {!settings.merged.hideTips && <Tips config={config} />}
            </Box>,
            ...history.map((h) => (
              <HistoryItemDisplay
                terminalWidth={mainAreaWidth}
                availableTerminalHeight={staticAreaMaxItemHeight}
                key={h.id}
                item={h}
                isPending={false}
                config={config}
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
              />
            ))}
            <ShowMoreLines constrainHeight={constrainHeight} />
          </Box>
        </OverflowProvider>

        {showHelp && <Help commands={slashCommands} />}

        <Box flexDirection="column" ref={footerRef}>
          {(allStartupWarnings.length > 0 || transientWarnings.length > 0) && (
            <Box
              borderStyle="round"
              borderColor={Colors.AccentYellow}
              paddingX={1}
              marginY={1}
              flexDirection="column"
            >
              {allStartupWarnings.map((warning, index) => (
                <Text key={index} color={Colors.AccentYellow}>
                  {warning}
                </Text>
              ))}
              {transientWarnings.map((warning, index) => (
                <Text key={index} color={Colors.AccentYellow}>
                  {warning}
                </Text>
              ))}
            </Box>
          )}

          {isThemeDialogOpen ? (
            <Box flexDirection="column">
              {appState.errors.theme && (
                <Box marginBottom={1}>
                  <Text color={Colors.AccentRed}>{appState.errors.theme}</Text>
                </Box>
              )}
              <ThemeDialog
                onSelect={handleThemeSelect}
                onHighlight={handleThemeHighlight}
                settings={settings}
                availableTerminalHeight={
                  constrainHeight
                    ? terminalHeight - 3 // margins and padding
                    : undefined
                }
                terminalWidth={mainAreaWidth}
              />
            </Box>
          ) : authIsAuthenticating ? (
            <>
              <AuthInProgress onTimeout={onAuthTimeout} />
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
                initialErrorMessage={appState.errors.auth}
              />
            </Box>
          ) : isEditorDialogOpen ? (
            <Box flexDirection="column">
              {appState.errors.editor && (
                <Box marginBottom={1}>
                  <Text color={Colors.AccentRed}>{appState.errors.editor}</Text>
                </Box>
              )}
              <EditorSettingsDialog
                onSelect={handleEditorSelect}
                settings={settings}
                onExit={exitEditorDialog}
              />
            </Box>
          ) : providerModelDialog.showDialog ? (
            <Box flexDirection="column">
              <ProviderModelDialog
                models={providerModelDialog.models}
                currentModel={providerModelDialog.currentModel}
                onSelect={providerModelDialog.handleSelect}
                onClose={providerModelDialog.closeDialog}
              />
            </Box>
          ) : providerDialog.showDialog ? (
            <Box flexDirection="column">
              <ProviderDialog
                providers={providerDialog.providers}
                currentProvider={providerDialog.currentProvider}
                onSelect={providerDialog.handleSelect}
                onClose={providerDialog.closeDialog}
              />
            </Box>
          ) : showPrivacyNotice ? (
            <PrivacyNotice onExit={closePrivacyNotice} config={config} />
          ) : (
            <>
              <LoadingIndicator
                thought={
                  streamingState === StreamingState.WaitingForConfirmation ||
                  config.getAccessibility()?.disableLoadingPhrases
                    ? undefined
                    : thought
                }
                currentLoadingPhrase={
                  config.getAccessibility()?.disableLoadingPhrases
                    ? undefined
                    : currentLoadingPhrase
                }
                elapsedTime={elapsedTime}
              />
              <Box
                marginTop={1}
                display="flex"
                justifyContent="space-between"
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
                  ) : (
                    <ContextSummaryDisplay
                      llxprtMdFileCount={llxprtMdFileCount}
                      contextFileNames={contextFileNames}
                      mcpServers={config.getMcpServers()}
                      showToolDescriptions={showToolDescriptions}
                    />
                  )}
                </Box>
                <Box>
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
                <InputPrompt
                  buffer={buffer}
                  inputWidth={inputWidth}
                  suggestionsWidth={suggestionsWidth}
                  onSubmit={handleFinalSubmit}
                  userMessages={userMessages}
                  onClearScreen={handleClearScreen}
                  config={config}
                  slashCommands={slashCommands}
                  commandContext={commandContext}
                  shellModeActive={shellModeActive}
                  setShellModeActive={setShellModeActive}
                />
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
          <Footer
            model={currentModel}
            targetDir={config.getTargetDir()}
            debugMode={config.getDebugMode()}
            branchName={branchName}
            debugMessage={debugMessage}
            corgiMode={corgiMode}
            errorCount={errorCount}
            showErrorDetails={showErrorDetails}
            showMemoryUsage={
              config.getDebugMode() || config.getShowMemoryUsage()
            }
            promptTokenCount={sessionStats.lastPromptTokenCount}
            isPaidMode={isPaidMode}
            nightly={nightly}
          />
        </Box>
      </Box>
    </StreamingContext.Provider>
  );
};

// Intermediate component to pass isAuthenticating to SessionController
const AppWithAuth = (props: AppProps) => {
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  return (
    <SessionController
      config={props.config}
      isAuthenticating={isAuthenticating}
    >
      <AppInner
        {...props}
        isAuthenticating={isAuthenticating}
        setIsAuthenticating={setIsAuthenticating}
      />
    </SessionController>
  );
};

// Main App component that provides the UIStateShell wrapper
const App = (props: AppProps) => (
  <UIStateShell>
    <AppWithAuth {...props} />
  </UIStateShell>
);
