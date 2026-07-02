# CLI Session Exact Seam Audit

@plan:PLAN-20260629-ISSUE2285.P10
@requirement:REQ-006

Audit of `packages/cli/src/cliSessionDispatch.tsx` (610 lines). Analysis-only:
no production code was modified, extracted, or created for this audit (finding
2 — characterization tests in P11 must precede any extraction in P12).

## 1. Exported names (structural table)

The six names `cli.tsx` imports (and re-exports) plus the additional exports
defined in the module:

| Exported name | Kind | Line | Responsibility | Candidate module |
|---------------|------|------|----------------|------------------|
| `formatNonInteractiveError` | `export function` | :91 | Normalize/format an unknown error into a printable string (parseAndFormatApiError fallback → stack/message → JSON → String). | `session/errorReporting.ts` |
| `installNonInteractiveSigintHandler` | `export function` | :112 | Install a once-only SIGINT handler that writes "Cancelled." to stderr and `process.exit(130)`; returns a disposer. | `session/signalHandlers.ts` |
| `setupUnhandledRejectionHandler` | `export function` | :138 | Install a process-wide `unhandledRejection` listener (emit LogError + open debug console on first rejection); returns a disposer. | `session/signalHandlers.ts` |
| `setWindowTitle` (not imported by cli.tsx) | `export function` | :222 | Compute + write the terminal title escape; register a once-per-process exit listener to reset the title. | `session/interactiveUI.ts` |
| `initializeOutputListenersAndFlush` | `export function` | :246 | If no Output listeners exist, install Output + ConsoleLog sinks that route chunks to stdout/stderr; then drain backlogs. | `session/outputListeners.ts` |
| `startInteractiveUI` | `export async function` | :274 | Bootstrap the interactive Ink UI: version, title, render options, mouse/terminal cleanup registration, `render()` of AppWrapper/ErrorBoundary/SettingsContext, update check, and exit cleanup registration. | `session/interactiveUI.ts` |
| `dispatchInteractiveOrNonInteractive` | `export async function` | :404 | Collect startup warnings; if interactive, build the foreground Agent and delegate to `startInteractiveUI`; otherwise delegate to `runPipedOrPromptSession`. | `session/nonInteractiveSession.ts` |

cli.tsx re-exports the six import-list names (cli.tsx :101-108) and separately
re-exports `validateDnsResolutionOrder` from `cliBootstrap.js` (cli.tsx :100).
`validateDnsResolutionOrder` is NOT part of this split (lives in
`packages/cli/src/cliBootstrap.tsx` :69; `packages/cli/src/session/` does not
exist).

## 2. Non-exported helper functions

| Helper | Lines | Responsibility |
|--------|-------|----------------|
| `appendInteractiveUiDebug` | :165-173 | Append a debug line to `$LLXPRT_TMUX_ARTIFACT_DIR/cli-debug.log` when the env var is set; swallow failures. |
| `handleError` | :175-192 | ErrorBoundary onError callback: append debug line, debugLogger.error, detect "Maximum update depth exceeded" render loop. |
| `mouseEventsExitHandler` | :213-220 | Module-level process 'exit' handler: `disableMouseEvents()` and write disable-sequence string (TTY-guarded). |
| `runPipedOrPromptSession` | :456-505 | Merge piped stdin with any prompt; error+exit on empty input; run `runNonInteractiveSession`; shut down telemetry; `runExitCleanup()`; `process.exit(code)`. |
| `runNonInteractiveSession` | :511-591 | Validate auth; install SIGINT handler; flush output listeners; fire SessionStart hook + inject context; run `runNonInteractive`; fire SessionEnd; catch→report error; finally remove handler; return exit code. |
| `reportNonInteractiveError` | :599-610 | Format+report a non-interactive error: JSON formatter to stderr when JSON output, else `formatNonInteractiveError` via debugLogger.error. |

Module-level mutable state (not a function, but tracked for seam cleanliness):
`titleResetExitListenerRegistered` (:200) — boolean guard ensuring the
title-reset exit listener registers at most once per process.

## 3. Types / interfaces

| Type/interface | Lines | Candidate module |
|----------------|-------|------------------|
| `NonInteractiveSessionOptions` | :373-379 | `session/nonInteractiveSession.ts` |
| `PipedOrPromptSessionOptions` | :381-388 | `session/nonInteractiveSession.ts` |
| `SessionDispatchOptions` | :390-398 | `session/nonInteractiveSession.ts` |

(Type-only imports `ErrorInfo` (react), `Config`, `SessionRecordingService`,
`RecordingIntegration`, `IContent`, `LockHandle`, `MessageBus`,
`OutputPayload`, `ConsoleLogPayload`, `LoadedSettings`, `SessionRecordingSetup`,
`Agent` are consumed across modules; they travel with their owning helper.)

## 4. Side effects

| Side effect | Location | Owner |
|-------------|----------|-------|
| `process.on('SIGINT', ...)` / `process.off` | :122, :124 | signalHandlers |
| `process.stderr.write` (SIGINT cancel) | :119 | signalHandlers |
| `process.exit(130)` (SIGINT) | :120 | signalHandlers |
| `process.on('unhandledRejection', ...)` / `process.off` | :159, :161 | signalHandlers |
| `appEvents.emit(LogError/OpenDebugConsole)` | :153, :156 | signalHandlers |
| `appendFileSync` (debug log) | :169 | interactiveUI / shared debug util |
| `process.on('exit', ...)` (title reset) | :239 | interactiveUI |
| `writeToStdout` (title escape `\x1b]0;...\x07`) | :232, :240 | interactiveUI |
| `coreEvents.on(Output/ConsoleLog)` sinks | :251, :259 | outputListeners |
| `coreEvents.drainBacklogs()` | :267 | outputListeners |
| `writeToStdout` / `writeToStderr` (listener sinks) | :253-264 | outputListeners |
| `enableMouseEvents()` / `disableMouseEvents()` | :301, :214 | terminalCleanup |
| `process.on('exit', mouseEventsExitHandler)` / `process.off` | :312, :313 | terminalCleanup |
| `process.on('exit', restoreTerminalProtocolsSync)` / `process.off` | :322, :323 | terminalCleanup |
| `registerSyncCleanup(restoreTerminalProtocolsSync)` | :329 | terminalCleanup |
| Ink `render(...)` (StrictMode/ErrorBoundary/AppWrapper) | :331 | interactiveUI |
| `checkForUpdates` / `handleAutoUpdate` (fire-and-forget promise) | :355-364 | interactiveUI |
| `registerCleanup(async waitUntilExit…)` | :366 | interactiveUI |
| `debugLogger.error` (handleError + reportNonInteractiveError) | :180-190, :608 | interactiveUI / errorReporting |
| `process.exit(1)` (empty piped input) | :485 | nonInteractiveSession |
| `writeToStderr` (no-input message) | :481 | nonInteractiveSession |
| `runExitCleanup()` | :503 | nonInteractiveSession |
| `process.exit(nonInteractiveExitCode)` | :504 | nonInteractiveSession |
| `writeToStderr` (JSON error / systemMessage) | :552, :604 | nonInteractiveSession / errorReporting |

## 5. Import dependencies (grouped by source)

- **react** (:30): `React`, `type ErrorInfo`.
- **ink** (:31): `render`.
- **node:fs / node:path** (:34, :79-80): `appendFileSync`, `basename`, `join`.
- **@vybestack/llxprt-code-core** (:36-59): `Config`, `parseAndFormatApiError`,
  `SessionRecordingService`, `RecordingIntegration`, `IContent`, `LockHandle`,
  `MessageBus`, `debugLogger`, `isTelemetrySdkInitialized`,
  `shutdownTelemetry`, `writeToStderr`, `writeToStdout`, `OutputFormat`,
  `JsonFormatter`, `coreEvents`, `CoreEvent`, `OutputPayload`,
  `ConsoleLogPayload`, `triggerSessionStartHook`, `triggerSessionEndHook`,
  `SessionStartSource`, `SessionEndReason`.
- **@vybestack/llxprt-code-agents** (:83): `type Agent`.
- **CLI config** (:35): `type LoadedSettings` from `./config/settings.js`.
- **CLI utils** (:60-63, :71-78): `getStartupWarnings`,
  `getUserStartupWarnings`, `getCliVersion`, `computeTerminalTitle`,
  `handleAutoUpdate`, `appEvents`, `AppEvent`, `inkRenderOptions`,
  `isMouseEventsEnabled`.
- **CLI nonInteractive** (:62): `runNonInteractive` from `./nonInteractiveCli.js`.
- **CLI auth** (:84): `validateNonInteractiveAuth`.
- **CLI cleanup** (:85-89): `registerCleanup`, `registerSyncCleanup`,
  `runExitCleanup`.
- **CLI bootstrap** (:81-82): `type SessionRecordingSetup` from
  `./cliSessionBootstrap.js`; `createForegroundAgent` from
  `./cliAgentBootstrap.js`.
- **CLI UI** (:32-33, :64-70, :74, :78): `AppWrapper`, `ErrorBoundary`,
  `disableMouseEvents`, `enableMouseEvents`, `restoreTerminalProtocolsSync`,
  `DISABLE_BRACKETED_PASTE`, `DISABLE_FOCUS_TRACKING`, `SHOW_CURSOR`,
  `SettingsContext`, `StreamingState`.

## 6. Internal call graph

```
dispatchInteractiveOrNonInteractive (:404)
├── getStartupWarnings / getUserStartupWarnings (external)
├── createForegroundAgent (external)
├── startInteractiveUI (:274)
│   ├── appendInteractiveUiDebug (:165)
│   ├── setWindowTitle (:222)
│   │   └── computeTerminalTitle (external) + writeToStdout
│   ├── inkRenderOptions / isMouseEventsEnabled (external)
│   ├── enableMouseEvents (external) → mouseEventsExitHandler (:213) [exit]
│   ├── restoreTerminalProtocolsSync (external) [exit / syncCleanup]
│   ├── render (external) → handleError (:175) [ErrorBoundary onError]
│   │   └── appendInteractiveUiDebug (:165)
│   ├── checkForUpdates / handleAutoUpdate (external)
│   └── registerCleanup (external)
└── runPipedOrPromptSession (:456)
    ├── readStdinData (external, injected)
    ├── runNonInteractiveSession (:511)
    │   ├── validateNonInteractiveAuth (external)
    │   ├── installNonInteractiveSigintHandler (:112)
    │   ├── initializeOutputListenersAndFlush (:246)
    │   ├── triggerSessionStartHook / triggerSessionEndHook (external)
    │   ├── runNonInteractive (external)
    │   └── reportNonInteractiveError (:599)
    │       └── formatNonInteractiveError (:91)
    ├── shutdownTelemetry (external)
    └── runExitCleanup (external)

setupUnhandledRejectionHandler (:138)
└── appendInteractiveUiDebug (:165) + appEvents.emit (external)
```

Leaf helpers (no intra-module calls): `formatNonInteractiveError`,
`installNonInteractiveSigintHandler`, `appendInteractiveUiDebug`,
`mouseEventsExitHandler`, `reportNonInteractiveError` (calls
`formatNonInteractiveError` — single inbound edge).
Composite helpers: `startInteractiveUI`, `runPipedOrPromptSession`,
`runNonInteractiveSession`, `setupUnhandledRejectionHandler`, `handleError`,
`setWindowTitle`.

## 7. Candidate module map

| Candidate module | Exported names / helpers that move | Depends on (intra-split) |
|------------------|------------------------------------|--------------------------|
| `session/outputListeners.ts` | `initializeOutputListenersAndFlush` (:246) | none (leaf; core `coreEvents`/`writeToStdout`/`writeToStderr`) |
| `session/signalHandlers.ts` | `installNonInteractiveSigintHandler` (:112), `setupUnhandledRejectionHandler` (:138) | none (leaf; `appEvents`, `appendInteractiveUiDebug` shared util — see entanglement §9) |
| `session/errorReporting.ts` | `formatNonInteractiveError` (:91), `reportNonInteractiveError` (:599) | `errorReporting` → `formatNonInteractiveError` is internal to this module (self-contained) |
| `session/terminalCleanup.ts` | `mouseEventsExitHandler` (:213), `restoreTerminalProtocolsSync` registration wiring (currently inline in `startInteractiveUI` :312-329) | none (leaf; `disableMouseEvents`, terminal sequences, `registerSyncCleanup`) |
| `session/interactiveUI.ts` | `startInteractiveUI` (:274), `setWindowTitle` (:222), `handleError` (:175), `titleResetExitListenerRegistered` (:200) | `interactiveUI` → `terminalCleanup` (mouse/protocol registration), `interactiveUI` → shared `appendInteractiveUiDebug` |
| `session/nonInteractiveSession.ts` | `dispatchInteractiveOrNonInteractive` (:404), `runPipedOrPromptSession` (:456), `runNonInteractiveSession` (:511), `NonInteractiveSessionOptions`/`PipedOrPromptSessionOptions`/`SessionDispatchOptions` | `nonInteractiveSession` → `outputListeners`, `signalHandlers`, `errorReporting`, `interactiveUI` |

## 8. Intra-split dependency edges

```
outputListeners        (leaf)
signalHandlers         (leaf)
errorReporting         (leaf; formatNonInteractiveError internal)
terminalCleanup        (leaf)
interactiveUI          → terminalCleanup
nonInteractiveSession  → outputListeners
nonInteractiveSession  → signalHandlers
nonInteractiveSession  → errorReporting
nonInteractiveSession  → interactiveUI  (interactive branch of dispatch)
```

No cycles: `interactiveUI` → `terminalCleanup` is acyclic;
`nonInteractiveSession` is the sole composite aggregator. Extraction order
per pseudocode (leaf modules first, then interactiveUI, then
nonInteractiveSession) is respected by this graph.

## 9. Entanglement / shared state (for P11/P12 awareness)

Two cross-cutting items do NOT cleanly fit a single candidate module and must
be accounted for during characterization (P11) and extraction (P12). Neither
requires a forbidden production seam; both are pure code-motion resolvable:

1. **`appendInteractiveUiDebug` (:165-173)** is a shared debug-writing util
   called by `setupUnhandledRejectionHandler` (signalHandlers), `handleError`
   + `startInteractiveUI` (interactiveUI). It is stateless (only reads an env
   var and appends a file). Resolution: move it into a tiny shared
   `session/`-local helper (e.g. `session/debugLog.ts`) imported by both
   `signalHandlers.ts` and `interactiveUI.ts`, OR inline per-module. No
   behavior change, no new exported production seam (module-internal import
   only).

2. **`titleResetExitListenerRegistered` (:200) + the module-level
   `mouseEventsExitHandler` (:213)** are module-scoped mutable guards relied
   on by `setWindowTitle`/`startInteractiveUI` (interactiveUI) and the
   terminal-cleanup registration. They must travel together with
   `interactiveUI.ts` + `terminalCleanup.ts` to preserve the
   once-per-process registration semantics. Resolution: keep the guards
   co-located with the function that mutates them (interactiveUI owns
   `titleResetExitListenerRegistered`; terminalCleanup owns
   `mouseEventsExitHandler`). Pure code-motion.

These are the only entanglements. No circular helper dependency exists
(§6/§8). No shared mutable state crosses an extraction boundary that cannot
be preserved by co-location.

## 10. Verdict B:

Entangled seams identified but resolvable by pure code-motion. The six
candidate modules have single, clear responsibilities and the internal call
graph is acyclic. Two cross-cutting items (the shared `appendInteractiveUiDebug`
helper and the module-level once-only registration guards) are entangled
across `signalHandlers`/`interactiveUI`/`terminalCleanup`, but neither
requires introducing a new exported production seam, a deep import that
violates the boundary checker, or a characterization mock — they are
resolvable by co-location / a module-internal shared helper during P12.

Per architect finding 2, Verdict B does NOT perform any extraction in this
phase. P11 characterization tests MUST target the current monolith
(`cliSessionDispatch.tsx`) and account for the two entanglements documented in
§9 (the shared debug util and the once-per-process registration guards). P12
handles the entanglement during extraction along the seams confirmed here.

No blocker for P11/P12. No `P10a.revised-plan.md` is required (this is not
the forbidden-seam stop condition).
