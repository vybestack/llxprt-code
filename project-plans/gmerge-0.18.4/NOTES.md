# NOTES.md — gmerge-0.18.4

Running notes during batch execution.

---

## Batch 1
- CONTRIBUTING.md conflict: LLxprt had restructured PR Guidelines section. Resolved by keeping LLxprt structure and applying upstream's "remove help wanted" intent.
- KeypressContext.tsx conflict: HEAD already had 3-parameter modifyOtherKeys support; kept HEAD's more complete regex.
- zedIntegration.ts import conflict: Merged LLxprt's imports (todoEvents, TodoUpdateEvent, etc.) with upstream's ReadManyFilesTool addition.
- Banner.tsx: Deleted in LLxprt — kept deleted.
- docs/get-started/configuration.md: Deleted in LLxprt — kept deleted.

## Batch 2
- Reimplement of Escape clears input. Added `lastSubmittedPromptRef` to store prompt at submit time. Cancel handler checks streaming state: if idle, clears input; if streaming, cancels model.

## Batch 3
- Many conflicts due to LLxprt's different architecture (AppContainer v2, no chatRecordingService, etc.)
- Post-pick fix needed for: branding in sessions.test.ts, CliArgs interface (added resume/listSessions/deleteSession), sessionUtils sort callback, McpPromptLoader.test.ts mock updates.
- Removed orphaned sessions.test.ts that referenced deleted chatRecordingService.

## Batch 4
- kittyProtocolDetector.ts fully rewritten to merge LLxprt's error handling with upstream's SGR mouse support, finish() cleanup, 200ms timeout.
- genai bumped 1.16.0 → 1.30.0 in both cli and core. Package-lock.json regenerated.
- McpPromptLoader kept LLxprt's extractFirstTextContent helper approach.
- d0a845b6 SKIPPED (empty — useIncludeDirsTrust.tsx deleted in LLxprt).
- Post-fix: removed duplicate write-todos.ts, fixed ThemedGradient `{...props}` spreading, removed unused Key import.

## Batch 5
- Created ToolShared.tsx (ToolStatusIndicator, ToolInfo, TrailingIndicator), ToolResultDisplay.tsx, useMouseClick.ts.
- Preserved all LLxprt-specific features: stripShellMarkers, todo formatting, ANSI output, multi-provider imports.

## Batch 6
- Replaced process.stdout.write with fs.writeSync in kittyProtocolDetector.ts for synchronous keyboard mode detection.
- Added try/catch around keyboard query functions.

## Batch 7
- NO-OP: The context overflow race condition fix (lastSubmittedPromptRef) was already implemented in Batch 2.

## Batch 8
- Added updateSystemInstruction() to GeminiClient and updateSystemInstructionIfInitialized() to Config.
- Wired memoryCommand.ts refresh to call updateSystemInstructionIfInitialized().
- getCoreSystemPromptAsync is async (unlike upstream's sync version) — updateSystemInstruction handles this.

## Batch 9
- 6c126b9e (zed interactive): Conflict in zedIntegration.ts imports, resolved by keeping LLxprt imports and adding isInteractive flag.
- 4adfdad4 (setup-github): Applied cleanly.

## Batch 10
- LARGEST commit: 82 files in upstream. Massive conflict resolution.
- 17 source files reverted to HEAD (LLxprt has different/deleted versions).
- 20 test files reverted to HEAD (tests reference deleted components).
- Key additions kept: patchStdio, writeToStdout/writeToStderr, createInkStdio, CoreEvent.Output/ConsoleLog events, registerSyncCleanup, AppEvent.LogError.
- Package-lock.json regenerated.

## Batch 11
- c7b5dcd2 (compress threshold) SKIPPED: Empty after resolution — LLxprt doesn't have chatCompressionService.
- d15970e1 (mouse dedup) SKIPPED: Empty after resolution — LLxprt's kittyProtocolDetector was already rewritten.
- Stray conflict marker found and fixed in zedIntegration.ts line 62.
- 83d0bdc3 (Zed model routing): Kept HEAD for import conflicts; LLxprt doesn't export getEffectiveModel as standalone function.

## Batch 12
- Changed useAlternateBuffer default from true to false in settingsSchema.ts and settings.schema.json.
- Added `=== true` strict check in AppContainer.tsx copy mode toggle.
- inkRenderOptions.ts already had `=== true` check.

## Batch 13
- Created useInactivityTimer.ts hook (pure utility).
- Modified usePhraseCycler to support shell focus hints via inactivity timer.
- Modified useReactToolScheduler to return 5-tuple (added lastToolOutputTime).
- Modified shellCommandProcessor to track lastShellOutputTime.
- Modified useGeminiStream to compute and return lastOutputTime.
- Preserved WittyPhraseStyle system and phrasesCollections.

## Batch 14
- Created persistentState.ts with SHA-256 per-content banner tracking.
- Created useBanner.ts (simplified vs upstream — no previewFeatures check).
- Created AppHeader.tsx (takes config/settings as props, not from context).
- Replaced inline header blocks in DefaultAppLayout with AppHeader.

## Batch 15
- Created exitCli() utility with try/finally pattern wrapping runExitCleanup().
- Replaced 8 process.exit(1) calls in extension commands + 1 in mcp/add.ts.
- Removed config.ts early-exit block for mcp/extensions subcommands.
- initializeOutputListenersAndFlush middleware deferred — function is local to gemini.tsx, not exported.

## Batch 16
- MCP SDK version: cli/core already at ^1.25.2 (ahead of upstream's ^1.23.0).
- Bumped vscode-ide-companion from ^1.15.1 to ^1.25.2.
- mcp-server example package.json deleted (already removed in LLxprt).

## Batch 17
- Moved stdio.ts from packages/cli/src/utils/ to packages/core/src/utils/.
- Created terminal.ts in core with terminal escape sequence utilities.
- Updated gemini.tsx import to use @vybestack/llxprt-code-core.
- Fixed stdio.test.ts assertions: corrected from positional args to object-form emitOutput.
- Skipped: Auth dialog changes (multi-provider), oauth2 changes (Google-specific).

## Session Recording — Out-of-Band
- Upstream's `ChatRecordingService` (Gemini-specific, sync I/O, JSON snapshots) was partially cherry-picked
  in Batch 3 (e1c711f5) but the architecture is incompatible with LLxprt's multi-provider design.
- Batch 3 notes already recorded: "Removed orphaned sessions.test.ts that referenced deleted chatRecordingService."
- An initial WIP attempt to port `ChatRecordingService` directly was reverted — too many Gemini-specific
  assumptions (`PartListUnion`, `GenerateContentResponseUsageMetadata`, Gemini-only model field).
- Instead, a clean-room Session Recording Service was designed from scratch as an out-of-band effort:
  - Append-only JSONL format (inspired by codex-cli's RolloutRecorder approach)
  - Provider-agnostic: records `IContent` blocks, not Gemini-specific types
  - Async I/O with explicit flush points (awaited at turn boundaries)
  - Compression recorded as in-stream event in same file (not new file like upstream)
  - Replaces `SessionPersistenceService` entirely (no migration shim)
- Design tracked under GitHub #1361 with 8 sub-issues (#1362-#1369).
- 4 rounds of deepthinker review completed; declared implementation-ready.
- All upstream `ChatRecordingService` feature areas are covered (see `sessionrecording/chatrecording-features.md`).

## General Notes
- Subagent tool (cherrypicker/reviewer) was broken throughout this session due to API errors. Work done directly by coordinator and via deepthinker subagent.
- LLxprt's AppContainer.tsx is fundamentally different from upstream (v2 architecture with useAppDispatch/appState/AppDispatchProvider) — always keep HEAD on conflicts.
- Several upstream files don't exist in LLxprt (Banner.tsx, Header.test.tsx, AppContainer.test.tsx, chatCompressionService.ts, useIncludeDirsTrust.tsx, etc.) — kept deleted on modify/delete conflicts.
