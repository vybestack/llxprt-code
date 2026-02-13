# AUDIT.md — gmerge-0.18.4 Post-Implementation Reconciliation

| Upstream SHA | Decision | LLxprt Commit(s) | Notes |
| -----------: | -------- | ----------------- | ----- |
| `fd9d3e19` | PICKED | ca61dd9f4 | CONTRIBUTING.md — removed "help wanted" reference |
| `379f09d9` | SKIPPED | — | Release version bump |
| `7cc5234b` | SKIPPED | — | Gemini 3 docs |
| `36b0a86c` | SKIPPED | — | Gemini 3 docs |
| `b916d79f` | PICKED | c06838db0 | Keyboard code parsing improvements |
| `10003a64` | PICKED | a82f21b1e | read_many_files for zed — import conflict resolved |
| `90c764ce` | PICKED | 1f11895ba | 3-parameter modifyOtherKeys |
| `c5498bbb` | PICKED | 967077094 | Pty resize error handling |
| `b644f037` | REIMPLEMENTED | 9560a8348 | Escape clears input — TDD, lastSubmittedPromptRef |
| `e8d0e0d3` | PICKED | fac17357c | showLineNumbers default fix — docs file deleted |
| `1e8ae5b9` | PICKED | f7092dec2 | NO_COLOR crash fix — Banner.tsx/Header.test.tsx deleted |
| `61f0f3c2` | PICKED | dfa35e03b | MCP prompts with spaces |
| `5c475921` | PICKED | 1eee84724 | createTransport refactor |
| `0d89ac74` | PICKED | 8fec97e36 | Session config/utils — large test addition |
| `282654e7` | SKIPPED | — | ClearcutLogger |
| `e1c711f5` | PICKED | 5a8e8d975 | Chat recording errors/warnings |
| `300205b0` | PICKED | 3cf8b7d79 | Zed cancellation errors |
| `3f8d6365` | SKIPPED | — | Gemini Code Wiki |
| `84573992` | PICKED | a5fc5a507 | Keyboard restore — kittyProtocolDetector fully rewritten |
| `25f84521` | PICKED | efc64d57f | genai 1.16→1.30 bump — package-lock regenerated |
| `f8a86273` | PICKED | 3867b9bef | Header ASCII color — ThemedGradient accent fallback |
| `b2a2ea36` | SKIPPED | — | LICENSE |
| `0f845407` | PICKED | 3bc78fc25 | Todos typo fix |
| `e4c4bb26` | PICKED | c7cecda0c | Thinking mode exclude gemini-2.0 — isThinkingSupported exported |
| `d0a845b6` | SKIPPED (empty) | — | useIncludeDirsTrust.tsx deleted in LLxprt |
| `2231497b` | REIMPLEMENTED | c0b1e2cc6 | Click-to-focus, ToolShared/ToolResultDisplay extraction |
| `43d6dc36` | SKIPPED | — | User email in about box |
| `257cd07a` | SKIPPED | — | Model config wiring — incompatible with multi-provider routing |
| `c3f1b29c` | SKIPPED | — | Release bump |
| `ff725dea` | SKIPPED | — | Reverted by 049a299b |
| `9ebf3217` | REIMPLEMENTED | 8db029052 | Synchronous keyboard writes (fs.writeSync) |
| `3476a97a` | SKIPPED | — | build bun (reverted) |
| `98cdaa01` | SKIPPED | — | Revert build bun |
| `b1258dd5` | REIMPLEMENTED (NO-OP) | — | Already covered by Batch 2 (lastSubmittedPromptRef) |
| `049a299b` | SKIPPED | — | Revert model override |
| `1d2e27a6` | REIMPLEMENTED | b6b602ce1 | Memory reload system instruction — updateSystemInstruction() |
| `6c126b9e` | PICKED | 48e4c47cc | Zed interactive classification |
| `4adfdad4` | PICKED | 3624742bc | Setup-github copy commands |
| `e20d2820` | SKIPPED | — | Banner design (branding) |
| `d1e35f86` | PICKED | 1401fd9ee | stdout/stderr protection — 37 files reverted (LLxprt deletions) |
| `ade9dfee` | PICKED | 9113677df | Preview features toggle without restart |
| `8c07ad2a` | SKIPPED | — | Gemini 3 thinking (#1330) |
| `c7b5dcd2` | SKIPPED (empty) | — | Compress threshold — chatCompressionService deleted in LLxprt |
| `d15970e1` | SKIPPED (empty) | — | Mouse dedup — kittyProtocolDetector already rewritten |
| `83d0bdc3` | PICKED | a11ed05f2 | Zed default model routing |
| `8e531dc0` | SKIPPED | — | Model config hierarchy (#1329) |
| `179010eb` | SKIPPED | — | Release tag |
| `316349ca` | REIMPLEMENTED | bd60cea23 | Alternate buffer default false, === true check |
| `80ef6f85` | SKIPPED | — | Release tag |
| `843b019c` | REIMPLEMENTED | 61fa4c1bf | Loading indicator + inactivity timer, WittyPhraseStyle preserved |
| `313688fd` | SKIPPED | — | Release tag |
| `ea3d022c` | REIMPLEMENTED | b9423caf2 | useBanner + persistentState + AppHeader |
| `9f55fb50` | SKIPPED | — | Release tag |
| `a640766f` | SKIPPED | — | FlashFallback |
| `7beccfa0` | SKIPPED | — | Release tag |
| `f01890b0` | SKIPPED | — | Release tag |
| `013f9848` | REIMPLEMENTED | e0bebe781 | exitCli utility, 9 process.exit replaced, config early-exit removed |
| `236af8bb` | SKIPPED | — | Release tag |
| `9b6d47fd` | SKIPPED | — | Gemini 3 thinking fix (#1330) |
| `8c9b49ce` | SKIPPED | — | Release tag |
| `4b19a833` | PICKED | 5da8ce21c | MCP SDK ^1.25.2, package-lock regenerated |
| `3f4d5c07` | SKIPPED | — | Release tag |
| `2e8d7831` | REIMPLEMENTED | 75abfc44a | stdio moved to core, terminal.ts created, auth skipped |
| `61227ea9` | SKIPPED | — | Release tag |

## Summary

- **Total upstream commits in range**: 64
- **PICKED**: 26 (2 became empty/skipped during resolution: d0a845b6, c7b5dcd2, d15970e1)
- **SKIPPED**: 28
- **REIMPLEMENTED**: 10 (1 was NO-OP: b1258dd5)
- **LLxprt commits produced**: 37 (including post-batch fixes and format commits)
- **Post-batch fix commits**: 4 (455dbbb50, ed0be7d08, 1ce754dbf, 9f25de00d, 9313ad954)

## Deferred Items

1. **initializeOutputListenersAndFlush middleware** for extension/MCP commands — function is local to gemini.tsx, not exported. Requires refactoring to move to a shared module.
2. **createInkStdio integration** into Ink render call — currently imported but not yet wired into `startInteractiveUI`.
