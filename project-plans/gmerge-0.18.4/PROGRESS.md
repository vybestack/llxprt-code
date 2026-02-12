# PROGRESS.md — gmerge-0.18.4

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit(s) | Notes |
| ----: | ---- | --------------- | ------ | ----------------- | ----- |
| 1 | PICK x7 | fd9d3e19, b916d79f, 10003a64, 90c764ce, c5498bbb, e8d0e0d3, 1e8ae5b9 | DONE | ca61dd9f4..f7092dec2, 455dbbb50 (fix) | CONTRIBUTING conflict, KeypressContext conflict (HEAD had modifyOtherKeys), zed import conflict, Banner.tsx deleted, docs deleted |
| 2 | REIMPLEMENT | b644f037 | DONE | 9560a8348 | Escape clears input when idle |
| 3 | PICK x5 | 61f0f3c2, 5c475921, 0d89ac74, e1c711f5, 300205b0 | DONE | dfa35e03b..3cf8b7d79, ed0be7d08 (fix) | Session utils, chat recording, zed cancel. Post-fix: branding, CliArgs, McpPromptLoader test |
| 4 | PICK x6 | 84573992, 25f84521, f8a86273, 0f845407, e4c4bb26, d0a845b6 | DONE | a5fc5a507..c7cecda0c, 1ce754dbf (fix) | genai 1.30 bump, kittyProtocolDetector rewritten with SGR mouse, d0a845b6 SKIPPED (useIncludeDirsTrust deleted) |
| 5 | REIMPLEMENT | 2231497b | DONE | c0b1e2cc6 | Created ToolShared.tsx, ToolResultDisplay.tsx, useMouseClick.ts; refactored ToolMessage.tsx |
| 6 | REIMPLEMENT | 9ebf3217 | DONE | 8db029052 | Synchronous keyboard writes (fs.writeSync) in kittyProtocolDetector |
| 7 | REIMPLEMENT | b1258dd5 | NO-OP | — | Already implemented in Batch 2 (lastSubmittedPromptRef) |
| 8 | REIMPLEMENT | 1d2e27a6 | DONE | b6b602ce1 | updateSystemInstruction on LLXPRT.md reload |
| 9 | PICK x2 | 6c126b9e, 4adfdad4 | DONE | 48e4c47cc, 3624742bc | Zed interactive classification, setup-github copy commands |
| 10 | PICK SOLO | d1e35f86 | DONE | 1401fd9ee, 9313ad954 (format) | stdout/stderr protection — 17 source + 20 test files reverted (LLxprt deletions/rewrites) |
| 11 | PICK x4 | ade9dfee, c7b5dcd2, d15970e1, 83d0bdc3 | DONE | 9113677df, a11ed05f2, 9f25de00d (fix) | c7b5dcd2 + d15970e1 SKIPPED (empty after resolution). Stray conflict marker fixed. |
| 12 | REIMPLEMENT | 316349ca | DONE | bd60cea23 | Alternate buffer default to false, === true strict check |
| 13 | REIMPLEMENT | 843b019c | DONE | 61fa4c1bf | Created useInactivityTimer; modified usePhraseCycler, useLoadingIndicator, useReactToolScheduler (5-tuple), shellCommandProcessor, useGeminiStream, AppContainer, LoadingIndicator |
| 14 | REIMPLEMENT | ea3d022c | DONE | b9423caf2 | Created persistentState.ts, useBanner.ts, AppHeader.tsx; replaced inline header in DefaultAppLayout |
| 15 | REIMPLEMENT | 013f9848 | DONE | e0bebe781 | Created exitCli(); replaced 9 process.exit(1) calls; removed config.ts early-exit block. Output middleware deferred (function-local in gemini.tsx). |
| 16 | PICK x1 | 4b19a833 | DONE | 5da8ce21c | MCP SDK bumped to ^1.25.2 in vscode-ide-companion (cli/core already ahead) |
| 17 | REIMPLEMENT | 2e8d7831 | DONE | 75abfc44a | Moved stdio.ts to core; created terminal.ts; exported from core index; skipped auth/oauth changes |

## Out-of-Band: Session Recording Service

Upstream's `ChatRecordingService` (introduced across multiple commits including e1c711f5 in Batch 3) is
**not** being cherry-picked into LLxprt. Instead, LLxprt is building its own replacement for
`SessionPersistenceService` as a standalone design effort tracked under GitHub issue #1361.

**Why out-of-band:**
- Upstream's `ChatRecordingService` is Gemini-specific (`PartListUnion`, `GenerateContentResponseUsageMetadata`)
- LLxprt needs a provider-agnostic solution built on `IContent` / `HistoryService`
- Upstream uses sync I/O and JSON snapshots; LLxprt design uses async append-only JSONL
- The architectural gap is too large for cherry-pick + adapt; a clean-room design is more maintainable

**Tracking:**
- Parent: [#1361 — Session Recording Service](https://github.com/vybestack/llxprt-code/issues/1361)
- Sub-issues: #1362 (Core types + writer), #1363 (Replay engine), #1364 (Recording integration), #1365 (Resume flow), #1366 (List/delete), #1367 (Concurrency), #1368 (Remove old persistence), #1369 (Cleanup)
- Design reviewed through 4 rounds of deepthinker review, declared implementation-ready
- Local design artifacts: `project-plans/gmerge-0.18.4/sessionrecording/`
