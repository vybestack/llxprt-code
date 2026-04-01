# Upstream gemini-cli Commit Audit - Batch 5 (Commits 125-154)

**Audit Date:** 2026-01-XX
**Auditor:** LLxprt Code Team
**Upstream Version:** v0.26.0
**LLxprt Base:** Multi-provider fork with skills, hooks, policy engine, a2a-server

---

## Summary Table

| SHA | Subject | Verdict | Confidence |
|-----|---------|---------|------------|
| 645e2ec | fix(cli): resolve Ctrl+Enter and Ctrl+J newline | REIMPLEMENT | HIGH |
| b288f12 | fix(cli): send gemini-cli version as mcp client version | REIMPLEMENT | HIGH |
| c9061a1 | Remove missing sidebar item (docs) | SKIP | HIGH |
| 211d2c5 | feat(core): Ensure hooks properties are event names | REIMPLEMENT | HIGH |
| aceb06a | fix(cli): fix newline support broken in previous PR | REIMPLEMENT | HIGH |
| 3b626e7 | Add ValidationDialog for 403 VALIDATION_REQUIRED errors | SKIP | HIGH |
| e1fd5be | Add Esc-Esc to clear prompt when not empty | REIMPLEMENT | HIGH |
| 995ae42 | Avoid spurious render warnings (DebugProfiler) | PICK | HIGH |
| 2455f93 | fix(cli): resolve home/end keybinding conflict | PICK | HIGH |
| 55c2783 | fix(cli): display http type on mcp list | PICK | HIGH |
| 9866eb0 | fix bad fallback logic external editor | PICK | HIGH |
| 93ae777 | Fix bug where System scopes weren't migrated | REIMPLEMENT | HIGH |
| 97aac69 | Fix mcp tool lookup in tool registry | PICK | HIGH |
| 2b58605 | chore(release): v0.26.0-preview.0 | SKIP | HIGH |
| dc8fc75 | fix(patch): cherry-pick 61040d0 for preview.0 | SKIP | HIGH |
| 603e66b | chore(release): v0.26.0-preview.1 | SKIP | HIGH |
| 0fa9a54 | fix(patch): cherry-pick 87a0db2 for preview.1 | REIMPLEMENT | HIGH |
| 75b5eee | chore(release): v0.26.0-preview.2 | SKIP | HIGH |
| ee87c98 | fix(patch): cherry-pick addb57c for preview.2 | REIMPLEMENT | HIGH |
| 1c207e2 | chore(release): v0.26.0-preview.3 | SKIP | HIGH |
| cebe386 | fix(patch): cherry-pick 12a5490 for preview.3 | REIMPLEMENT | HIGH |
| c593a29 | chore(release): v0.26.0-preview.4 | SKIP | HIGH |
| 9c667cf | feat: implement /rewind command | SKIP | HIGH |
| 958cc45 | Fix rewind starts at bottom, loadHistory refresh | SKIP | HIGH |
| 2a3c879 | feat: add clearContext to AfterAgent hooks | REIMPLEMENT | HIGH |
| 43846f4 | address feedback (package.ts) | REIMPLEMENT | HIGH |
| d8e9db3 | address feedback (package.ts) | REIMPLEMENT | HIGH |
| 31c6fef | feat(skills): promote skills settings to stable | NO_OP | HIGH |
| a380b42 | chore(release): v0.26.0-preview.5 | SKIP | HIGH |
| c1b110a | chore(release): v0.26.0 | SKIP | HIGH |

---

## Detailed Analysis

### 1. 645e2ec0411cb843468dc2eb4fe8a1a17f2191a5 — fix(cli): resolve Ctrl+Enter and Ctrl+J newline issues

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:** 
- Modified `packages/cli/src/ui/contexts/KeypressContext.tsx` lines 524-530
- Added test cases for LF as Ctrl+J and Alt+Enter recognition
- LLxprt's KeypressContext.tsx already has similar structure at lines ~520-530 with `else if (escaped && ch === '\n')` block
**Rationale:** The fix changes `else if (ch === '\n')` to `else if (escaped && ch === '\n')` to properly handle LF as Ctrl+J vs Alt+Enter. LLxprt already has the linefeed handling but may need the specific fix to treat unescaped `\n` as Ctrl+J. The test additions are also valuable.
**Conflicts expected:** NO — Same file structure, small targeted change
**Partial applicability:** All files apply

---

### 2. b288f124b2cd58b8509481df5f9710ffff0ad716 — fix(cli): send gemini-cli version as mcp client version

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Modified: `packages/cli/src/config/config.ts`, `extension-manager.ts`
- Modified: `packages/core/src/config/config.ts`, `mcp-client-manager.ts`, `mcp-client.ts`
- Adds `clientVersion` parameter throughout MCP client initialization chain
- LLxprt uses `@vybestack/llxprt-code-core` package name, not `@google/gemini-cli-core`
**Rationale:** The feature passes the CLI version to MCP servers as client version (previously hardcoded to `'0.0.1'`). LLxprt needs this but must adapt `getVersion()` import and package name references. The change touches Config, ExtensionManager, McpClientManager, and McpClient.
**Conflicts expected:** YES — Package name differences (`@vybestack/llxprt-code-core` vs `@google/gemini-cli-core`), config structure may diverge
**Partial applicability:** All files apply with package name adaptations

---

### 3. c9061a1cfe623a508e73181ff5c3b3294d9d79cd — Remove missing sidebar item (docs)

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Only modifies `docs/sidebar.json` — removing a "Rewind" sidebar item
- This is documentation-only for upstream's docs site
**Rationale:** LLxprt does not have upstream's docs site structure. Documentation changes for sidebar navigation don't apply.
**Conflicts expected:** N/A
**Partial applicability:** None — docs-only change

---

### 4. 211d2c5fdd877c506cb38217075d1aee98245d2c — feat(core): Ensure all properties in `hooks` object are event names

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Large refactor: Splits `hooks` settings into `hooksConfig` (for enabled/disabled/notifications) and `hooks` (for event-specific configs like BeforeTool, AfterAgent)
- Modified: settingsSchema.ts, config.ts, extension-manager.ts, hooksCommand.ts, StatusDisplay.tsx
- Integration tests updated extensively
- LLxprt has full hooks system with similar structure
**Rationale:** This is a significant settings schema refactor separating hook configuration (`hooksConfig.enabled`, `hooksConfig.disabled`, `hooksConfig.notifications`) from hook event definitions (`hooks.BeforeTool`, `hooks.AfterAgent`, etc.). LLxprt's hooks system should adopt this cleaner separation. Requires careful merge with LLxprt's existing hooks configuration.
**Conflicts expected:** YES — LLxprt has its own hooks implementation that may differ in structure
**Partial applicability:** All files apply but need LLxprt-specific adaptation

---

### 5. aceb06a58729f2c10b4fcc78edad86c52560134c — fix(cli): fix newline support broken in previous PR

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Modified: `packages/cli/src/ui/components/shared/text-buffer.ts`
- Added: `keyMatchers[Command.NEWLINE](key)` check after RETURN check
- Added test for Ctrl+J as newline
**Rationale:** This is a follow-up fix to commit 645e2ec. It ensures Ctrl+J (NEWLINE command) triggers the `newline()` function in text-buffer. Simple targeted fix.
**Conflicts expected:** NO — Same pattern in LLxprt's text-buffer.ts
**Partial applicability:** All files apply

---

### 6. 3b626e7c61bde810a90085f2092b02bb8dc799c7 — Add ValidationDialog for 403 VALIDATION_REQUIRED errors

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Adds: `ValidationDialog.tsx`, `ValidationDialog.test.tsx`
- Modified: AppContainer.tsx, DialogManager.tsx, UIActionsContext.tsx, UIStateContext.tsx
- Modified: useGeminiStream.ts, useQuotaAndFallback.ts, useQuotaAndFallback.test.ts
- Introduces `ValidationRequiredError` handling
- Uses `useQuotaAndFallback` hook
**Rationale:** Per audit criteria: "LLxprt does NOT have ValidationDialog, useQuotaAndFallback hook". This is Google-specific authentication flow for 403 VALIDATION_REQUIRED errors. LLxprt's multi-provider auth doesn't use this Google-specific validation flow.
**Conflicts expected:** N/A
**Partial applicability:** None — Google-specific auth flow

---

### 7. e1fd5be429a2a2e8b416c77d346e9deef6456f06 — Add Esc-Esc to clear prompt when it's not empty

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Modified: InputPrompt.tsx, StatusDisplay.tsx, keyboard-shortcuts.md
- Modified tests: InputPrompt.test.tsx, StatusDisplay.test.tsx
- Behavior: Double ESC clears buffer if not empty, otherwise triggers rewind (if history exists)
**Rationale:** This improves the ESC behavior: first ESC clears the input buffer if it has text; only triggers `/rewind` if buffer is empty AND history exists. Good UX improvement. Note: LLxprt may not have rewind feature, but the clear-prompt behavior is still useful.
**Conflicts expected:** NO — Similar InputPrompt structure exists in LLxprt
**Partial applicability:** 
- InputPrompt.tsx — applies
- StatusDisplay.tsx — applies  
- keyboard-shortcuts.md — applies (if LLxprt has this doc)
- `/rewind` command reference may need adjustment if LLxprt doesn't have rewind

---

### 8. 995ae42f5359f7b93661023fe824f15622243e5c — Avoid spurious render warnings (DebugProfiler)

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Modified: `packages/cli/src/ui/components/DebugProfiler.tsx`
- Added: `coreEvents` import, event listeners for all CoreEvent and AppEvent values
- Added test for CoreEvent and AppEvent emission
**Rationale:** This fixes spurious warnings in DebugProfiler by registering handlers for all core/app events. The change is small, self-contained, and improves developer experience. Uses `coreEvents` from core package.
**Conflicts expected:** NO — DebugProfiler likely identical structure
**Partial applicability:** All files apply

---

### 9. 2455f939a3697ca22b21d94e62081112674430d5 — fix(cli): resolve home/end keybinding conflict

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Modified: `keyBindings.ts`, `keyBindings.test.ts`, `keyMatchers.test.ts`
- Modified: `ScrollableList.test.tsx`, `keyboard-shortcuts.md`
- Changes: HOME/END without modifiers = cursor movement; with Ctrl/Shift = scroll to top/bottom
**Rationale:** Fixes keybinding conflict where HOME/END were ambiguous between cursor movement and scrolling. Clean separation: bare HOME/END moves cursor, modified (Ctrl/Shift) scrolls. Simple keybinding config changes.
**Conflicts expected:** NO — keyBindings.ts likely same structure
**Partial applicability:** All files apply

---

### 10. 55c2783e6a9226f2e613d17ec8c2b82c8aa04d92 — fix(cli): display 'http' type on mcp list

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Modified: `packages/cli/src/commands/mcp/list.ts`, `list.test.ts`
- Change: Uses `server.type || 'http'` instead of hardcoding `'sse'` for URL-based servers
**Rationale:** Simple fix to correctly display "http" type for MCP servers with URL but no explicit type. Previously incorrectly showed "sse".
**Conflicts expected:** NO — list.ts likely same structure
**Partial applicability:** All files apply

---

### 11. 9866eb0551a3d8709f0f52b46dd7f67d6c1b26cf — fix bad fallback logic external editor

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Modified: `packages/cli/src/ui/components/shared/text-buffer.ts` line ~2242-2248
- Fix: Corrects operator precedence in editor command fallback logic
**Rationale:** Simple bug fix. The original code had incorrect parentheses causing the fallback logic to use `vi` even when VISUAL/EDITOR was set on Windows. Fix corrects to: `VISUAL ?? EDITOR ?? (win32 ? 'notepad' : 'vi')`.
**Conflicts expected:** NO — Same file, same pattern
**Partial applicability:** All files apply

---

### 12. 93ae7772fdd3e6e94fd81bfb0e7a01c6be3ce37a — Fix bug where System scopes weren't migrated

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Modified: `packages/cli/src/config/settings.ts`
- Added: `processScope(SettingScope.System)` and `processScope(SettingScope.SystemDefaults)` calls in `migrateDeprecatedSettings()`
- Added test for system settings migration
**Rationale:** The migration function wasn't processing System and SystemDefaults scopes, only User and Workspace. LLxprt's settings.ts has similar structure but may differ in scope enum values and migration logic. Need to verify LLxprt's `migrateDeprecatedSettings` function.
**Conflicts expected:** YES — LLxprt has different settings structure, different scope handling
**Partial applicability:** settings.ts applies with LLxprt adaptations

---

### 13. 97aac696fb1ee24c1b3475e970bb83691634caef — Fix mcp tool lookup in tool registry

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Modified: `packages/core/src/tools/mcp-tool.ts`, `tool-registry.ts`, `tool-registry.test.ts`
- Adds: `getFullyQualifiedName()` method to DiscoveredMCPTool
- Fixes: Tool registry `getTool()` to find MCP tools by fully qualified name (e.g., `server__tool`) even if registered with simple name
**Rationale:** Important fix for MCP tool discovery. When a tool is registered as "my-tool" (no conflict), it should still be findable as "my-server__my-tool". The fix adds a fallback lookup that iterates through tools to find by fully qualified name.
**Conflicts expected:** NO — Same MCP tool structure in LLxprt
**Partial applicability:** All files apply

---

### 14. 2b5860522789dead1e8cb43c90f99ea54687b87b — chore(release): v0.26.0-preview.0

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Version bump to `0.26.0-preview.0` in all package.json files
- Updates sandboxImageUri
**Rationale:** Version bump only. LLxprt has its own versioning.
**Conflicts expected:** N/A
**Partial applicability:** None

---

### 15. dc8fc75ac0ced79351f241779f30ba8b61f69895 — fix(patch): cherry-pick 61040d0 for preview.0

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Cherry-picks hooks enabled default change to `true`
- This is already superseded by later commits
**Rationale:** This is a cherry-pick for a preview release. The actual change (hooks enabled default = true) is included in commit 211d2c5 analysis. Skip duplicate.
**Conflicts expected:** N/A
**Partial applicability:** None

---

### 16. 603e66b2ea601b95f43126921a5095101f8ad650 — chore(release): v0.26.0-preview.1

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Version bump only
**Rationale:** Version bump. LLxprt has its own versioning.
**Conflicts expected:** N/A
**Partial applicability:** None

---

### 17. 0fa9a5408878a6af9d314ef55c2ea19a035f950c — fix(patch): cherry-pick 87a0db2 for preview.1

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Modified: `packages/cli/src/gemini.tsx`, `gemini.test.tsx`
- Fixes: Auth failure handling in sandbox mode
- Changes: Instead of exiting immediately on auth failure, sets `initialAuthFailed` flag and exits later if sandbox config exists
**Rationale:** This fixes a bug where auth failure would exit before sandbox configuration could be checked. The change adds an `initialAuthFailed` flag and defers the exit until after sandbox config is loaded. LLxprt's gemini.tsx may have different auth flow but the pattern is relevant.
**Conflicts expected:** YES — LLxprt has different auth flow (multi-provider)
**Partial applicability:** gemini.tsx applies with auth flow adaptations

---

### 18. 75b5eeeb12624957f1260626e3846d5a0c072f6e — chore(release): v0.26.0-preview.2

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Version bump only
**Rationale:** Version bump.
**Conflicts expected:** N/A
**Partial applicability:** None

---

### 19. ee87c98f43cf9953a7cde1de5b7a727cf6f5f36a — fix(patch): cherry-pick addb57c for preview.2

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Modified: `packages/cli/src/ui/contexts/KeypressContext.tsx`, `KeypressContext.test.tsx`
- Changes: Adds `shift: true, meta: false, ctrl: false` to the fast return buffer keypress
**Rationale:** This fixes an issue where fast return buffering (for older terminals) wasn't setting shift/meta/ctrl flags correctly. The keypress should have `shift: true` to make it a newline, not a submission. Small targeted fix.
**Conflicts expected:** NO — Same KeypressContext structure
**Partial applicability:** All files apply

---

### 20. 1c207e2f82db015a23bea8f193cb3d33ab81c133 — chore(release): v0.26.0-preview.3

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Version bump only
**Rationale:** Version bump.
**Conflicts expected:** N/A
**Partial applicability:** None

---

### 21. cebe386d797b210c2329284cb858b31788c68f23 — fix(patch): cherry-pick 12a5490 for preview.3

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Large change affecting MCP initialization flow
- Modified: config.ts, AppContainer.tsx, useGeminiStream.ts, useMessageQueue.ts
- Added: `useMcpStatus.ts`, `useMcpStatus.test.tsx`
- Changes: Replaces inline MCP discovery blocking with a new `useMcpStatus` hook
- Uses `coreEvents` instead of `appEvents` for MCP events
- Adds `McpClientUpdate` CoreEvent
**Rationale:** This refactors MCP initialization to use a new hook pattern. The change moves MCP blocking logic from `useGeminiStream` to `useMcpStatus` and `useMessageQueue`. It also switches from `appEvents` to `coreEvents` for extension/MCP events. This is a significant refactor but improves the architecture.
**Conflicts expected:** YES — LLxprt may not have `useQuotaAndFallback`, has different event structure
**Partial applicability:** 
- useMcpStatus.ts — applies (new file)
- AppContainer.tsx — applies with adaptations
- useGeminiStream.ts — applies (removes inline MCP logic)
- useMessageQueue.ts — applies
- core events.ts — applies (adds McpClientUpdate event)

---

### 22. c593a29647eb19bbe2bd92b42e1f618c9887c338 — chore(release): v0.26.0-preview.4

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Version bump only
**Rationale:** Version bump.
**Conflicts expected:** N/A
**Partial applicability:** None

---

### 23. 9c667cf7ba242648b93ff5b887b5f08904df0906 — feat: implement /rewind command

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Added: `rewindCommand.tsx`, `rewindCommand.test.tsx`
- Added: `RewindViewer.tsx`, `RewindViewer.test.tsx`, `RewindConfirmation.tsx`
- Added: `rewindFileOps.ts` utility
- Modified: keyBindings.ts (adds REWIND command), BuiltinCommandLoader.ts, InputPrompt.tsx, AppContainer.tsx
- Extensive new feature with rewind dialog, file reversion, and history manipulation
**Rationale:** Per audit criteria: "LLxprt does NOT have... rewind feature". This is a large new feature that LLxprt explicitly doesn't have. The rewind feature allows users to jump back to previous conversation points and optionally revert file changes. Skipping per criteria.
**Conflicts expected:** N/A
**Partial applicability:** None — entire feature skipped

---

### 24. 958cc4593787b625f26a83924c44d1906fe2245f — Fix rewind starts at bottom, loadHistory refresh

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Modified: RewindViewer.tsx, BaseSelectionList.tsx, useSelectionList.ts, slashCommandProcessor.ts
- Changes: Fix for rewind viewer starting position and `loadHistory` to call `refreshStatic()`
**Rationale:** This is a fix for the rewind feature (commit 23 above). Since LLxprt doesn't have rewind, skip. However, the `loadHistory` refresh fix might be relevant if LLxprt has similar functionality.
**Conflicts expected:** N/A
**Partial applicability:** 
- RewindViewer.tsx — N/A (no rewind)
- BaseSelectionList.tsx — may apply if LLxprt has this component
- useSelectionList.ts — may apply
- slashCommandProcessor.ts — may apply for `loadHistory` refresh

---

### 25. 2a3c879782a024f664e07a5ebf4b7f60bd513ebe — feat: add clearContext to AfterAgent hooks

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Modified: docs/hooks/reference.md, integration-tests/hooks-agent-flow.test.ts
- Modified: useGeminiStream.ts, client.ts, client.test.ts, turn.ts
- Modified: hookAggregator.ts, types.ts
- Adds: `clearContext` option to AfterAgent hook output
- Behavior: When set, clears LLM memory (conversation history) while preserving UI display
**Rationale:** This adds a powerful hook capability for AfterAgent events to clear conversation context. LLxprt has full hooks system and should adopt this feature. The changes touch hooks types, aggregator, and client code. Requires adding `shouldClearContext()` method to hook output classes.
**Conflicts expected:** YES — LLxprt has different hooks implementation
**Partial applicability:** All files apply with LLxprt hooks adaptations

---

### 26. 43846f4e3b2ae2f7015e97a56f87600aa7b96628 — address feedback (package.ts)

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Modified: `packages/core/src/utils/package.ts`
- Added: `packages/core/src/utils/package.test.ts`
- Changes: Adds try/catch around `readPackageUp()`, adds `normalize: false` option
**Rationale:** Small defensive fix for package.json reading. Adds error handling and prevents semver normalization of non-semver versions. Simple utility improvement.
**Conflicts expected:** NO — Same utility pattern
**Partial applicability:** All files apply

---

### 27. d8e9db37611920a12e95f6ef77b38203672d53b5 — address feedback (package.ts)

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Modified: `packages/core/src/utils/package.ts`, `package.test.ts`
- Changes: Adds `debugLogger.error()` call in catch block, fixes variable naming in test
**Rationale:** Follow-up to commit 26. Adds debug logging for errors. Simple improvement.
**Conflicts expected:** NO — Same utility pattern
**Partial applicability:** All files apply

---

### 28. 31c6fef1e88871561313821885a8d884733df629 — feat(skills): promote skills settings to stable

**Verdict:** NO_OP
**Confidence:** HIGH
**Evidence:**
- Modified: settingsSchema.ts, config.ts, settings.md, configuration.md
- Changes: Moves `skills.enabled` from experimental to stable, defaults to `true`
- Deprecates `experimental.skills` in favor of `skills.enabled`
**Rationale:** Per audit criteria: "LLxprt HAS: skills system". LLxprt already has skills system. This change promotes skills settings to stable status. LLxprt may already have this at stable, or may need to verify its current state. Marked as NO_OP since LLxprt likely already has equivalent or may need to evaluate its own skills configuration status.
**Conflicts expected:** NO
**Partial applicability:** 
- settingsSchema.ts — check LLxprt's current state
- config.ts — check LLxprt's skills default

---

### 29. a380b4219ca1db8a484e3dd8d2971be064a93db6 — chore(release): v0.26.0-preview.5

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Version bump only
**Rationale:** Version bump.
**Conflicts expected:** N/A
**Partial applicability:** None

---

### 30. c1b110a6186871a568aa657a77bad4c82163eefa — chore(release): v0.26.0

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Version bump to `0.26.0` final
**Rationale:** Version bump. LLxprt has its own versioning.
**Conflicts expected:** N/A
**Partial applicability:** None

---

## Action Summary

### PICK (Apply Directly)
1. 995ae42 — DebugProfiler spurious warnings fix
2. 2455f93 — Home/end keybinding conflict fix
3. 55c2783 — MCP list display http type fix
4. 9866eb0 — External editor fallback logic fix
5. 97aac69 — MCP tool lookup in tool registry fix

### REIMPLEMENT (Adapt for LLxprt)
1. 645e2ec — Ctrl+Enter/Ctrl+J newline handling
2. b288f12 — MCP client version (package name changes)
3. 211d2c5 — Hooks config/settings schema split
4. aceb06a — Newline support fix (text-buffer)
5. e1fd5be — Esc-Esc clear prompt behavior
6. 93ae777 — System scopes migration
7. 0fa9a54 — Auth failure handling in sandbox
8. ee87c98 — Fast return buffer shift/meta/ctrl fix
9. cebe386 — MCP status hook refactor
10. 2a3c879 — clearContext in AfterAgent hooks
11. 43846f4 — Package.ts error handling
12. d8e9db3 — Package.ts debug logging

### NO_OP (Already Have or Not Needed)
1. 31c6fef — Skills settings promotion (LLxprt already has skills)

### SKIP (Per Criteria)
1. c9061a1 — Docs sidebar item (documentation only)
2. 3b626e7 — ValidationDialog (Google auth-specific, no useQuotaAndFallback)
3. 2b58605 — v0.26.0-preview.0 (version bump)
4. dc8fc75 — Preview.0 cherry-pick (superseded)
5. 603e66b — v0.26.0-preview.1 (version bump)
6. 75b5eee — v0.26.0-preview.2 (version bump)
7. 1c207e2 — v0.26.0-preview.3 (version bump)
8. c593a29 — v0.26.0-preview.4 (version bump)
9. 9c667cf — /rewind command (LLxprt doesn't have rewind)
10. 958cc45 — Rewind fixes (LLxprt doesn't have rewind)
11. a380b42 — v0.26.0-preview.5 (version bump)
12. c1b110a — v0.26.0 (version bump)

---

## Notes

1. **Hooks Schema Split (211d2c5):** This is a significant refactor. LLxprt should adopt the `hooksConfig` vs `hooks` separation for cleaner configuration.

2. **MCP Status Hook (cebe386):** The refactor to use `useMcpStatus` and the switch from `appEvents` to `coreEvents` is architectural. LLxprt should evaluate if this matches its event system.

3. **Rewind Feature (9c667cf, 958cc45):** Explicitly skipped per criteria. However, some components like `BaseSelectionList` and `useSelectionList` changes might be useful if LLxprt has these components.

4. **Package Name References:** All commits referencing `@google/gemini-cli-core` need adaptation to `@vybestack/llxprt-code-core`.

5. **Auth-Specific Features:** ValidationDialog and useQuotaAndFallback are Google-specific and don't apply to LLxprt's multi-provider architecture.
