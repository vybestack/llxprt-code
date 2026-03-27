# Builder Specifications - Issue #1576

## Overview

Builders are **pure functions** that assemble UIState and UIActions from primitives. They don't contain React hooks - they're called from wrapper hooks that handle memoization.

## Core Principle: Primitives In, Objects Out

Builders take **primitive values** (booleans, numbers, functions) not slice objects. This eliminates object identity stability problems.

## buildUIState.ts

### Signature

```typescript
export function buildUIState(
  // Dialog primitives (9)
  isPermissionsDialogOpen: boolean,
  isLoggingDialogOpen: boolean,
  loggingDialogData: LoggingDialogData,
  isSubagentDialogOpen: boolean,
  subagentDialogInitialView: SubagentView | undefined,
  subagentDialogInitialName: string | undefined,
  isModelsDialogOpen: boolean,
  modelsDialogData: ModelsDialogData | undefined,
  isSessionBrowserDialogOpen: boolean,
  
  // Display primitives (7)
  showErrorDetails: boolean,
  showToolDescriptions: boolean,
  showDebugProfiler: boolean,
  copyModeEnabled: boolean,
  renderMarkdown: boolean,
  isTodoPanelCollapsed: boolean,
  settingsNonce: number,
  
  // Session primitives (4)
  history: HistoryItem[],
  pendingHistoryItems: HistoryItemWithoutId[],
  streamingState: StreamingState,
  thought: ThoughtSummary | null,
  
  // Runtime primitives (5)
  buffer: TextBuffer,
  shellModeActive: boolean,
  isProcessing: boolean,
  isInputActive: boolean,
  isFocused: boolean,
  
  // Exit primitives (3)
  ctrlCPressedOnce: boolean,
  ctrlDPressedOnce: boolean,
  quittingMessages: HistoryItem[] | null,
  
  // Token primitives (3)
  tokensPerMinute: number,
  throttleWaitTimeMs: number,
  sessionTokenTotal: number,
  historyTokenCount: number,
  
  // Dimension primitives (7)
  terminalWidth: number,
  terminalHeight: number,
  mainAreaWidth: number,
  inputWidth: number,
  suggestionsWidth: number,
  footerHeight: number,
  availableTerminalHeight: number,
  
  // Context primitives (10)
  config: Config,
  settings: LoadedSettings,
  ideContextState: IdeContext | undefined,
  branchName: string | undefined,
  llxprtMdFileCount: number,
  coreMemoryFileCount: number,
  errorCount: number,
  staticKey: number,
  debugMessage: string,
  placeholder: string,
  
  // Dialog data primitives (from other hooks)
  providerOptions: string[],
  selectedProvider: string,
  currentModel: string,
  profiles: string[],
  toolsDialogAction: 'enable' | 'disable',
  toolsDialogTools: AnyDeclarativeTool[],
  toolsDialogDisabledTools: string[],
  workspaceGeminiCLIExtensions: GeminiCLIExtension[],
  profileListItems: ProfileListItem[],
  selectedProfileName: string | null,
  selectedProfileData: unknown | null,
  defaultProfileName: string | null,
  activeProfileName: string | null,
  profileDialogError: string | null,
  profileDialogLoading: boolean,
  
  // Confirmation primitives
  shellConfirmationRequest: ShellConfirmationRequest | null,
  confirmationRequest: ConfirmationRequest | null,
  confirmUpdateExtensionRequests: ConfirmationRequest[],
  
  // Other primitives
  isThemeDialogOpen: boolean,
  isSettingsDialogOpen: boolean,
  isAuthDialogOpen: boolean,
  isEditorDialogOpen: boolean,
  isProviderDialogOpen: boolean,
  isLoadProfileDialogOpen: boolean,
  isCreateProfileDialogOpen: boolean,
  isProfileListDialogOpen: boolean,
  isProfileDetailDialogOpen: boolean,
  isProfileEditorDialogOpen: boolean,
  isToolsDialogOpen: boolean,
  isFolderTrustDialogOpen: boolean,
  showWorkspaceMigrationDialog: boolean,
  showPrivacyNotice: boolean,
  isOAuthCodeDialogOpen: boolean,
  isNarrow: boolean,
  vimModeEnabled: boolean,
  vimMode: string | undefined,
  isRestarting: boolean,
  isWelcomeDialogOpen: boolean,
  welcomeState: WelcomeState,
  welcomeAvailableProviders: string[],
  welcomeAvailableModels: ModelInfo[],
  inputHistory: string[],
  queueErrorMessage: string | null,
  initError: string | null,
  authError: string | null,
  themeError: string | null,
  editorError: string | null,
  slashCommands: readonly SlashCommand[] | undefined,
  commandContext: CommandContext,
  shouldShowIdePrompt: boolean,
  currentIDE: IdeInfo | undefined,
  activeShellPtyId: number | null,
  embeddedShellFocused: boolean,
  constrainHeight: boolean,
  showAutoAcceptIndicator: ApprovalMode,
  elapsedTime: number,
  currentLoadingPhrase: string | undefined,
): UIState;
```

### Implementation

```typescript
/**
 * @builder buildUIState
 * @description Pure function assembling UIState from primitives
 * @inputs ~80 primitive parameters
 * @outputs UIState object (plain, not memoized)
 * @sideEffects None
 * @strictMode N/A (pure function)
 */
export function buildUIState(
  // ... all parameters
): UIState {
  return {
    // Core
    config,
    settings,
    settingsNonce,
    
    // Dimensions
    terminalWidth,
    terminalHeight,
    mainAreaWidth,
    inputWidth,
    suggestionsWidth,
    terminalBackgroundColor: config.getTerminalBackground(),
    
    // History and streaming
    history,
    pendingHistoryItems,
    streamingState,
    thought,
    
    // Input
    buffer,
    shellModeActive,
    
    // Dialog states
    isThemeDialogOpen,
    isSettingsDialogOpen,
    isAuthDialogOpen,
    // ... all dialog states
    isPermissionsDialogOpen,
    isLoggingDialogOpen,
    // ... etc
    
    // Dialog data
    providerOptions,
    selectedProvider,
    currentModel,
    // ... etc
    
    // Confirmation
    shellConfirmationRequest,
    confirmationRequest,
    confirmUpdateGeminiCLIExtensionRequests: confirmUpdateExtensionRequests,
    
    // Exit/warning
    ctrlCPressedOnce,
    ctrlDPressedOnce,
    showEscapePrompt: false, // Derived
    showIdeRestartPrompt: false, // Derived
    quittingMessages,
    
    // Display
    constrainHeight,
    showErrorDetails,
    showToolDescriptions,
    isTodoPanelCollapsed,
    isNarrow,
    vimModeEnabled,
    vimMode,
    
    // Context
    ideContextState,
    llxprtMdFileCount,
    coreMemoryFileCount,
    branchName,
    errorCount,
    
    // Console
    consoleMessages: [], // Filtered upstream
    
    // Loading
    elapsedTime,
    currentLoadingPhrase,
    showAutoAcceptIndicator,
    
    // Token metrics
    tokenMetrics: {
      tokensPerMinute,
      throttleWaitTimeMs,
      sessionTokenTotal,
    },
    historyTokenCount,
    
    // Errors
    initError,
    authError,
    themeError,
    editorError,
    
    // Processing
    isProcessing,
    isInputActive,
    isFocused,
    
    // Refs (passed through)
    rootUiRef: undefined as unknown as React.RefObject<DOMElement>, // Set by AppContainer
    pendingHistoryItemRef: undefined as unknown as React.RefObject<DOMElement>,
    
    // Commands
    slashCommands,
    commandContext,
    
    // IDE
    shouldShowIdePrompt,
    currentIDE,
    
    // Trust
    isRestarting,
    isTrustedFolder: config.isTrustedFolder(),
    
    // Welcome
    isWelcomeDialogOpen,
    welcomeState,
    welcomeAvailableProviders,
    welcomeAvailableModels,
    
    // Input history
    inputHistory,
    
    // Static
    staticKey,
    
    // Debug
    debugMessage,
    showDebugProfiler,
    
    // Copy mode
    copyModeEnabled,
    
    // Footer
    footerHeight,
    
    // Placeholder
    placeholder,
    
    // Height
    availableTerminalHeight,
    
    // Queue
    queueErrorMessage,
    
    // Markdown
    renderMarkdown,
    
    // Shell
    activeShellPtyId,
    embeddedShellFocused,
  };
}
```

## buildUIActions.ts

### Signature

```typescript
export function buildUIActions(
  // History actions (4)
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => number,
  clearItems: () => void,
  loadHistory: (newHistory: HistoryItem[]) => void,
  refreshStatic: () => void,
  
  // Input actions (2)
  handleUserInputSubmit: (value: string) => void,
  handleClearScreen: () => void,
  
  // Dialog actions - permissions (2)
  openPermissionsDialog: () => void,
  closePermissionsDialog: () => void,
  
  // Dialog actions - logging (2)
  openLoggingDialog: (data?: { entries: unknown[] }) => void,
  closeLoggingDialog: () => void,
  
  // Dialog actions - subagent (2)
  openSubagentDialog: (initialView?: SubagentView, initialName?: string) => void,
  closeSubagentDialog: () => void,
  
  // Dialog actions - models (2)
  openModelsDialog: (data?: ModelsDialogData) => void,
  closeModelsDialog: () => void,
  
  // Dialog actions - session browser (2)
  openSessionBrowserDialog: () => void,
  closeSessionBrowserDialog: () => void,
  
  // Theme dialog (3)
  openThemeDialog: () => void,
  handleThemeSelect: (themeName: string | undefined, scope: SettingScope) => void,
  handleThemeHighlight: (themeName: string | undefined) => void,
  
  // Settings dialog (3)
  openSettingsDialog: () => void,
  closeSettingsDialog: () => void,
  handleSettingsRestart: () => void,
  
  // Auth dialog (3)
  openAuthDialog: () => void,
  handleAuthSelect: (method: string | undefined, scope: SettingScope) => Promise<void>,
  handleAuthTimeout: () => void,
  
  // Editor dialog (3)
  openEditorDialog: () => void,
  handleEditorSelect: (editorType: EditorType | undefined, scope: SettingScope) => void,
  exitEditorDialog: () => void,
  
  // Provider dialog (3)
  openProviderDialog: () => void,
  handleProviderSelect: (provider: string) => Promise<void>,
  exitProviderDialog: () => void,
  
  // Profile dialogs (many)
  openLoadProfileDialog: () => void,
  handleProfileSelect: (profile: string) => void,
  exitLoadProfileDialog: () => void,
  openCreateProfileDialog: () => void,
  exitCreateProfileDialog: () => void,
  openProfileListDialog: () => void,
  closeProfileListDialog: () => void,
  viewProfileDetail: (profileName: string, openedDirectly?: boolean) => void,
  closeProfileDetailDialog: () => void,
  loadProfileFromDetail: (profileName: string) => void,
  deleteProfileFromDetail: (profileName: string) => void,
  setProfileAsDefault: (profileName: string) => void,
  openProfileEditor: (profileName: string, openedDirectly?: boolean) => void,
  closeProfileEditor: () => void,
  saveProfileFromEditor: (profileName: string, updatedProfile: unknown) => Promise<void>,
  
  // Tools dialog (3)
  openToolsDialog: (action: 'enable' | 'disable') => void,
  handleToolsSelect: (tool: string) => void,
  exitToolsDialog: () => void,
  
  // Folder trust (1)
  handleFolderTrustSelect: (choice: FolderTrustChoice) => void,
  
  // Welcome (2)
  welcomeActions: WelcomeActions,
  triggerWelcomeAuth: (provider: string, method: 'oauth' | 'api_key', apiKey?: string) => Promise<void>,
  
  // Workspace migration (2)
  onWorkspaceMigrationDialogOpen: () => void,
  onWorkspaceMigrationDialogClose: () => void,
  
  // Privacy (2)
  openPrivacyNotice: () => void,
  handlePrivacyNoticeExit: () => void,
  
  // OAuth (2)
  handleOAuthCodeDialogClose: () => void,
  handleOAuthCodeSubmit: (code: string) => Promise<void>,
  
  // Confirmation (1)
  handleConfirmationSelect: (value: boolean) => void,
  
  // IDE prompt (1)
  handleIdePromptComplete: (result: IdeIntegrationNudgeResult) => void,
  
  // Vim (2)
  vimHandleInput: (key: Key) => boolean,
  toggleVimEnabled: () => void,
  
  // Commands (3)
  handleSlashCommand: (command: string) => Promise<void>,
  performMemoryRefresh: () => Promise<void>,
  cancelOngoingRequest: () => void,
  setQueueErrorMessage: (message: string | null) => void,
  
  // Display toggles (3)
  setShowErrorDetails: (show: boolean) => void,
  setShowToolDescriptions: (show: boolean) => void,
  setConstrainHeight: (constrain: boolean) => void,
  
  // Shell (1)
  setShellModeActive: (active: boolean) => void,
  
  // Escape prompt (1)
  handleEscapePromptChange: (show: boolean) => void,
): UIActions;
```

### Implementation

Returns a UIActions object with all callbacks. The object is plain (not memoized) - memoization happens in the wrapper hook.

## Wrapper Hooks

### useUIStateBuilder.ts

```typescript
/**
 * @hook useUIStateBuilder
 * @description Wraps buildUIState with useMemo
 * @inputs All primitives from hooks
 * @outputs Memoized UIState
 * @sideEffects useMemo
 * @strictMode Safe - useMemo deps are primitives
 */

export function useUIStateBuilder(
  // Destructure all primitives from hook outputs
  // Example:
  isPermissionsDialogOpen: boolean,
  isLoggingDialogOpen: boolean,
  // ... ~80 primitives total
): UIState {
  return useMemo(
    () => buildUIState(
      isPermissionsDialogOpen,
      isLoggingDialogOpen,
      // ... all primitives
    ),
    // Direct primitive dependencies
    [isPermissionsDialogOpen, isLoggingDialogOpen, /* ... */]
  );
}
```

### useUIActionsBuilder.ts

```typescript
/**
 * @hook useUIActionsBuilder
 * @description Wraps buildUIActions with useMemo
 * @inputs All action primitives from hooks
 * @outputs Memoized UIActions
 * @sideEffects useMemo
 * @strictMode Safe - useMemo deps are stable callbacks
 */

export function useUIActionsBuilder(
  // All action primitives
  addItem: typeof addItem,
  clearItems: typeof clearItems,
  // ... ~40 action primitives
): UIActions {
  return useMemo(
    () => buildUIActions(addItem, clearItems, /* ... */),
    [addItem, clearItems, /* ... */]
  );
}
```

## Builder Acceptance Criteria

- [ ] buildUIState takes only primitives (no slice objects)
- [ ] buildUIActions takes only primitives (no slice objects)
- [ ] Both functions are pure (no side effects)
- [ ] Wrapper hooks useMemo with primitive deps
- [ ] Builder contract test passes
