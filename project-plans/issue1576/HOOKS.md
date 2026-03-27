# Hook Specifications - Issue #1576

## Hook Contracts

Each hook must include this header:

```typescript
/**
 * @hook useHookName
 * @description One-line description
 * @inputs List of parameters
 * @outputs List of return values
 * @sideEffects List of side effects
 * @cleanup Cleanup guarantees
 * @strictMode Idempotency behavior
 * @subscriptionStrategy One of: N/A, Stable, Resubscribe, Poll
 */
```

## Phase 1: Low Risk (Isolated)

### useFlickerDetector.ts
```typescript
/**
 * @hook useFlickerDetector
 * @description Telemetry-only flicker detection
 * @inputs rootUiRef, terminalHeight, constrainHeight
 * @outputs void
 * @sideEffects AppEvent.Flicker emission
 * @cleanup Removes listeners on unmount
 * @strictMode Safe - no persistent state
 * @subscriptionStrategy Resubscribe
 */
```

**Location:** Lines 1898-1920
**Implementation:** ~50 lines

### useRecordingInfrastructure.ts
```typescript
/**
 * @hook useRecordingInfrastructure
 * @description Recording refs and swap callbacks
 * @inputs initialRecordingService, recordingIntegration, initialLockHandle
 * @outputs recordingServiceRef, recordingIntegrationRef, recordingSwapCallbacks
 * @sideEffects Ref synchronization effects
 * @cleanup Clears refs on unmount
 * @strictMode Safe - ref updates are idempotent
 * @subscriptionStrategy Stable (useRef + useMemo)
 */
```

**Location:** Lines 287-349
**Implementation:** ~80 lines

### useLayoutMeasurement.ts
```typescript
/**
 * @hook useLayoutMeasurement
 * @description Mouse selection and layout measurement
 * @inputs enabled, rootRef, onCopiedText
 * @outputs copySelectionToClipboard
 * @sideEffects useLayoutEffect for measurement
 * @cleanup Removes listeners on unmount
 * @strictMode Safe - measurements in layout effect
 * @subscriptionStrategy Resubscribe
 */
```

**Location:** Lines 1770-1896
**Implementation:** ~120 lines

## Phase 2: Medium Risk (Self-Contained State)

### useDialogOrchestration.ts
```typescript
/**
 * @hook useDialogOrchestration
 * @description Dialog state machines with open/close callbacks
 * @inputs none
 * @outputs All dialog states and callbacks
 * @sideEffects useState only
 * @cleanup N/A
 * @strictMode Safe - useState initialization is stable
 * @subscriptionStrategy N/A
 */

interface DialogState {
  isPermissionsDialogOpen: boolean;
  isLoggingDialogOpen: boolean;
  loggingDialogData: { entries: unknown[] };
  isSubagentDialogOpen: boolean;
  subagentDialogInitialView: SubagentView | undefined;
  subagentDialogInitialName: string | undefined;
  isModelsDialogOpen: boolean;
  modelsDialogData: ModelsDialogData | undefined;
  isSessionBrowserDialogOpen: boolean;
  openPermissionsDialog: () => void;
  closePermissionsDialog: () => void;
  openLoggingDialog: (data?: { entries: unknown[] }) => void;
  closeLoggingDialog: () => void;
  openSubagentDialog: (initialView?: SubagentView, initialName?: string) => void;
  closeSubagentDialog: () => void;
  openModelsDialog: (data?: ModelsDialogData) => void;
  closeModelsDialog: () => void;
  openSessionBrowserDialog: () => void;
  closeSessionBrowserDialog: () => void;
}
```

**Location:** Lines 672-805
**Implementation:** ~130 lines

### useDisplayPreferences.ts
```typescript
/**
 * @hook useDisplayPreferences
 * @description Display toggles and settings sync
 * @inputs none
 * @outputs Display states, setters, settingsNonce
 * @sideEffects CoreEvent.SettingsChanged subscription
 * @cleanup Unsubscribes on unmount
 * @strictMode Safe - subscription cleanup runs on both unmounts
 * @subscriptionStrategy Resubscribe
 */

interface DisplayPreferencesState {
  showErrorDetails: boolean;
  setShowErrorDetails: (show: boolean) => void;
  showToolDescriptions: boolean;
  setShowToolDescriptions: (show: boolean) => void;
  showDebugProfiler: boolean;
  toggleDebugProfiler: () => void;
  copyModeEnabled: boolean;
  setCopyModeEnabled: (enabled: boolean) => void;
  renderMarkdown: boolean;
  setRenderMarkdown: (render: boolean) => void;
  isTodoPanelCollapsed: boolean;
  setIsTodoPanelCollapsed: (collapsed: boolean) => void;
  settingsNonce: number;
}
```

**Location:** Lines 851-917
**Implementation:** ~80 lines

### useModelTracking.ts
```typescript
/**
 * @hook useModelTracking
 * @description Current model tracking from config
 * @inputs config
 * @outputs currentModel
 * @sideEffects Polling effect for model changes
 * @cleanup Clears interval on unmount
 * @strictMode Safe - interval cleanup runs on both unmounts
 * @subscriptionStrategy Poll (500ms)
 */
```

**Location:** Lines 807-850
**Implementation:** ~50 lines

## Phase 3: Medium Risk (Side Effects)

### useOAuthOrchestration.ts
```typescript
/**
 * @hook useOAuthOrchestration
 * @description OAuth flow coordination via global flags
 * @inputs appDispatch, isOAuthCodeDialogOpen
 * @outputs void
 * @sideEffects Interval polling (100ms), dispatch
 * @cleanup Clears interval on unmount/dialog close
 * @strictMode Safe - interval cleared on both unmounts
 * @subscriptionStrategy Poll with dedupe
 * @technicalDebt ISSUE-1576-OAUTH-EVENT: Replace with event-driven
 */

// Implementation notes:
// - Uses processedCodeRef to prevent duplicate handling
// - Max poll duration: 5 minutes
// - Stop conditions: dialog closed, code processed, max duration, unmount
```

**Location:** Lines 350-398
**Implementation:** ~60 lines

### useExtensionAutoUpdate.ts
```typescript
/**
 * @hook useExtensionAutoUpdate
 * @description Extension auto-update checking
 * @inputs settings, onConsoleMessage
 * @outputs void
 * @sideEffects Check interval
 * @cleanup Clears interval on unmount
 * @strictMode Safe - interval cleanup runs on both unmounts
 * @subscriptionStrategy Resubscribe
 */
```

**Location:** Lines 451-500
**Implementation:** ~50 lines

### useCoreEventHandlers.ts
```typescript
/**
 * @hook useCoreEventHandlers
 * @description Bridge core event system to UI
 * @inputs handleNewMessage, config, addItem, setUpdateInfo, setShowErrorDetails, setConstrainHeight, recordingIntegrationRef, runtime
 * @outputs void
 * @sideEffects Multiple event subscriptions
 * @cleanup Unsubscribes all listeners on unmount
 * @strictMode Safe - all cleanups run on unmounts
 * @subscriptionStrategy Stable (refs for handler freshness)
 */
```

**Location:** Lines 400-450
**Implementation:** ~80 lines

## Phase 4: Higher Risk (Orchestration)

### useTokenMetricsTracking.ts
```typescript
/**
 * @hook useTokenMetricsTracking
 * @description Token metrics collection with HistoryService subscription
 * @inputs runtime, config, updateHistoryTokenCount, recordingIntegrationRef
 * @outputs tokenMetrics
 * @sideEffects Interval (1s), HistoryService subscription
 * @cleanup Clears interval, unsubscribes on unmount/swap
 * @strictMode Safe - subscriptions managed with cleanup
 * @subscriptionStrategy Mixed (Stable subscription + Poll)
 */
```

**Location:** Lines 501-573
**Implementation:** ~100 lines

### useStaticRefreshManager.ts
```typescript
/**
 * @hook useStaticRefreshManager
 * @description Terminal refresh orchestration with debouncing
 * @inputs refreshStaticBase, streamingState, setConstrainHeight
 * @outputs staticKey, constrainHeight, refreshStatic, setConstrainHeight
 * @sideEffects Debounced resize handler, deferred refresh
 * @cleanup Clears debounce timers on unmount
 * @strictMode Safe - timers cleared on cleanup
 * @subscriptionStrategy Poll with debounce (300ms)
 */
```

**Location:** Lines 575-670, 1921-1970
**Implementation:** ~140 lines

### useTodoContinuationFlow.ts
```typescript
/**
 * @hook useTodoContinuationFlow
 * @description Todo continuation detection and prompts
 * @inputs geminiClient, config, isResponding, setDebugMessage
 * @outputs handleTodoPause, clearPause
 * @sideEffects Effect watching streaming state
 * @cleanup N/A
 * @strictMode Safe - effect deps are stable
 * @subscriptionStrategy Resubscribe
 */
```

**Location:** Lines 1971-2024
**Implementation:** ~60 lines

## Phase 5: Higher Risk (Complex State)

### useExitHandling.ts
```typescript
/**
 * @hook useExitHandling
 * @description Exit/quit lifecycle with double-press detection
 * @inputs handleSlashCommand, config, processExitAdapter
 * @outputs ExitState
 * @sideEffects Timer creation, exit effect
 * @cleanup Clears timers on unmount
 * @strictMode Idempotent (guard refs prevent duplicate)
 * @subscriptionStrategy Stable (refs for timers)
 */

interface ExitState {
  ctrlCPressedOnce: boolean;
  ctrlDPressedOnce: boolean;
  quittingMessages: HistoryItem[] | null;
  requestCtrlCExit: () => void;  // Semantic method
  requestCtrlDExit: () => void;  // Semantic method
  setQuittingMessages: (messages: HistoryItem[] | null) => void;
}

// Timing: "Pressed once" window = CTRL_EXIT_PROMPT_DURATION_MS (1000ms)
// Idempotency: Guard ref prevents multiple /quit dispatches
```

**Location:** Lines 1599-1670
**Implementation:** ~90 lines

### useInputHandling.ts
```typescript
/**
 * @hook useInputHandling
 * @description Cancel handler and final submit logic
 * @inputs buffer, inputHistoryStore, submitQuery
 * @outputs handleUserCancel, handleFinalSubmit
 * @sideEffects None (callbacks only)
 * @cleanup N/A
 * @strictMode Safe - callbacks use latest refs
 * @subscriptionStrategy N/A
 */
```

**Location:** Lines 1503-1596
**Implementation:** ~100 lines

### useKeybindings.ts
```typescript
/**
 * @hook useKeybindings
 * @description Global keybinding handler with priority delegation
 * @inputs ExitKeybindingDeps, DisplayKeybindingDeps, ShellKeybindingDeps
 * @outputs void
 * @sideEffects useKeypress registration
 * @cleanup Removes handler on unmount
 * @strictMode Safe - handler stable via useCallback
 * @subscriptionStrategy Stable
 */

// Priority Order (highest to lowest):
// 1. Exit keys (Ctrl+C/D)
// 2. Copy mode toggle
// 3. Shell focus toggle (Ctrl+F)
// 4. Display toggles
// Short-circuit: handler returns true means stop propagation

interface ExitKeybindingDeps {
  requestCtrlCExit: () => void;
  requestCtrlDExit: () => void;
  ctrlCPressedOnce: boolean;
  cancelOngoingRequest?: () => void;
  bufferTextLength: number;
}

interface DisplayKeybindingDeps {
  setRenderMarkdown: (v: boolean) => void;
  setShowErrorDetails: (v: boolean) => void;
  setShowToolDescriptions: (v: boolean) => void;
  setCopyModeEnabled: (v: boolean) => void;
  setIsTodoPanelCollapsed: (v: boolean) => void;
  refreshStatic: () => void;
  addItem: (item: Omit<HistoryItem, 'id'>, ts: number) => number;
  showToolDescriptions: boolean;
}

interface ShellKeybindingDeps {
  activeShellPtyId: number | null;
  setEmbeddedShellFocused: (v: boolean) => void;
  config: Config;
}
```

**Location:** Lines 1671-1768
**Implementation:** ~100 lines

## Phase 6: Highest Risk (Session)

### useSessionInitialization.ts
```typescript
/**
 * @hook useSessionInitialization
 * @description One-time session initialization with state machine
 * @inputs config, addItem, loadHistory, resumedHistory
 * @outputs SessionInitState
 * @sideEffects Session start hook, history seeding
 * @cleanup AbortController.abort() on change/unmount
 * @strictMode Idempotent (guard refs + AbortController)
 * @subscriptionStrategy Stable (AbortController per run)
 */

// State Machine:
//   idle --(mount + resume)--> seeding
//   idle --(mount, no resume)--> starting
//   seeding --(success)--> seeded --> starting
//   starting --(success)--> started --> memoryInit --> complete
//   starting --(abort)--> aborted --> starting (new run)
//
// Guards:
//   - runId check at every await
//   - AbortController signal checked before external writes
//   - Monotonic: once complete, no transition (unless remount)

interface SessionInitState {
  llxprtMdFileCount: number;
  setLlxprtMdFileCount: (count: number) => void;
  coreMemoryFileCount: number;
  setCoreMemoryFileCount: (count: number) => void;
}
```

**Location:** Lines 203-286 (session portion)
**Implementation:** ~120 lines

## Per-Hook Subscription Strategy Summary

| Hook | Strategy | Rationale |
|------|----------|-----------|
| useFlickerDetector | Resubscribe | Low-frequency telemetry |
| useRecordingInfrastructure | Stable | Ref preservation |
| useLayoutMeasurement | Resubscribe | Layout effects |
| useDialogOrchestration | N/A | Local state only |
| useDisplayPreferences | Resubscribe | Settings event subscription |
| useModelTracking | Resubscribe | Model polling |
| useOAuthOrchestration | Poll | Global flag polling (debt) |
| useExtensionAutoUpdate | Resubscribe | Update checking |
| useCoreEventHandlers | Stable | Event subscriptions |
| useTokenMetricsTracking | Mixed | Events + polling |
| useStaticRefreshManager | Poll | Debounced refresh |
| useTodoContinuationFlow | Resubscribe | Streaming watcher |
| useExitHandling | Stable | Timer preservation |
| useInputHandling | N/A | Callbacks only |
| useKeybindings | Stable | Single registration |
| useSessionInitialization | Stable | Async orchestration |

## Cyclic Dependency Rule

Hooks may depend ONLY on:
1. Props passed from AppContainer
2. Primitive state from upstream hooks
3. Stable callbacks from upstream hooks (via useCallback)

Hooks may NOT depend on:
1. Downstream hook outputs
2. Builder outputs
3. Unstable object identities

**Enforcement:** `npx madge --circular` in CI
