# Cherry-Pick Analysis: v0.14.0 → v0.15.4

**Branch:** `20260128gmerge`
**Created:** 2026-01-28
**Upstream range:** `v0.14.0..v0.15.4` (54 substantive commits, 79 total including release/nightly)
**Last Updated:** 2026-01-28 (with full research findings)

---

## Summary

| Decision | Count | Notes |
|----------|-------|-------|
| **PICK** | 24 | Clean cherry-picks (added `331dbd563`, `2abc288c5`) |
| **SKIP** | 25 | Telemetry, smart-edit, alternate buffer UI, scrolling, experiments, etc. |
| **REIMPLEMENT** | 10 | Need adaptation for LLxprt architecture (KeypressContext, extensions, UI, sessions) |
| **Total substantive** | 54 |

---

## RESEARCH FINDINGS (2026-01-28)

### 1. Session Resuming (`6893d2744`) - --continue Error Analysis

**User Error:** `"INFO: Session restored (100 messages restored from UI cache) ... Could not restore AI context - history service unavailable."`

**Root Cause:** Core history restore waits for `geminiClient.getHistoryService()`, which stays null because GeminiChat never initializes when content generator/auth aren't ready. `resetChat()` fails or never creates chat, so the 30s polling in AppContainer times out and emits "history service unavailable." UI restore succeeds but AI context remains empty.

**Feature Gaps Between Upstream and LLxprt:**
1. Session resume is UI-driven polling, not a deterministic core restore path
2. No explicit resume/session selection flags beyond `--continue` (most-recent only)
3. No guarantee of provider/auth readiness before core history restore; failures silently degrade to UI-only restore
4. No retry/deferral tied to auth/provider initialization or config readiness
5. No explicit restore API in GeminiClient to ensure HistoryService exists before `addAll()`

**Implementation Plan (Priority Order):**
- **P0:** Add a core restore API (`GeminiClient.restoreHistory` or `SessionRestoreService`) that ensures content generator + chat are initialized before calling `historyService.addAll()`. Surface explicit errors when auth/config not ready.
- **P0:** Wire CLI startup to call the core restore API once config/provider/auth are initialized (before rendering UI or immediately after auth success). Replace AppContainer polling with a single call + success/failure state.
- **P1:** Add deferral/retry hook tied to auth/provider readiness (e.g., when refreshAuth completes, re-run restore if pending).
- **P1:** Track restore status in UI and expose a user-visible banner when AI context could not be restored, including retry action.
- **P2:** Add `--resume`/`--session` flags to resume by explicit session id/tag and to control behavior when combined with `--prompt`.
- **P2:** Persist/restore more metadata (provider/model/settings snapshot) and validate compatibility before restore.

---

### 2. Kitty Keyboard Protocol (`9e4ae214a` + `c0b766ad7`)

**Why "Removed"?** Upstream did NOT fully remove Kitty protocol support. They removed Kitty-specific parsing/buffering logic and readline usage to simplify key handling and fix ESC+mouse garbage input (issue #12613), replacing it with a unified ANSI escape parser. This eliminated kitty-specific timeouts/overflow telemetry.

**Replacement Mechanism:** A new in-house state machine that parses raw stdin ANSI escape sequences (modeled after readline), handling CSI codes (including Kitty CSI-u keycodes) within a single parser, with separate buffering for paste/backslash and mouse filtering. Kitty capability detection/enabling remains via `terminalCapabilityManager`.

**Recommendation for LLxprt:** 
- **KEEP** Kitty protocol support
- **CONSIDER** adopting upstream's unified ANSI parser approach if LLxprt has similar ESC/mouse or buffering issues
- Upstream did not drop Kitty; it simplified parsing to reduce bugs and remove kitty-specific buffering/telemetry
- If LLxprt's current implementation is stable and already handles timeouts, no need to remove Kitty

**Evidence:** Commit 9e4ae214a / PR #12746 body (Revamp KeypressContext): states removal of readline + kitty-protocol-specific parsing in favor of ANSI state machine; fixes issue #12613 (ESC+mouse garbage input). KeypressContext.tsx diff shows unified parser still handling Kitty CSI-u sequences; terminalCapabilityManager still enables Kitty protocol.

---

### 3. Extension Commits - Case-by-Case Decisions

| Commit | Decision | What It Does | Action |
|--------|----------|--------------|--------|
| `cc2c48d59` | **REIMPLEMENT** | Fix uninstall when extension name differs from directory name | LLxprt uninstall uses name not actual dir, needs adapted fix in `extension.ts` |
| `b248ec6df` | **REIMPLEMENT** | Adds `security.blockGitExtensions` setting and enforcement | LLxprt lacks setting and enforcement |
| `47603ef8e` | **REIMPLEMENT** | Adds core memory refresh helper + MemoryChanged event and refresh on extension load/unload | LLxprt lacks this mechanism |
| `c88340314` | **REIMPLEMENT** | Refresh toolset on extension reload when `excludeTools` changes | LLxprt lacks reload handling; needs adaptation |
| `bafbcbbe8` | **REIMPLEMENT** | Adds `/extensions restart` and `ExtensionLoader.restartExtension` | Missing in LLxprt |

---

### 4. Ink Fork Status (`@jrichman/ink`)

| Component | Version |
|-----------|---------|
| **LLxprt** | `@jrichman/ink@6.4.7` |
| **gemini-cli (current)** | `@jrichman/ink@6.4.8` |
| **Mainline ink** | `6.6.0` |

**Can Switch Back to Mainline?** **Unknown/Not Yet**

**Reasoning:**
- LLxprt uses `npm:@jrichman/ink@6.4.7`; gemini-cli uses `npm:@jrichman/ink@6.4.8` per package.json
- Mainline ink latest on npm is `6.6.0`
- Upstream `vadimdemedes/ink` PR/issue searches for jrichman/fork references returned no results
- gemini-cli history shows ongoing fork bumps with no reversion
- Fork hosted at `github.com/jacob314/ink`, maintained by Jacob Richman (Google/gemini-cli dev)
- Recent fork commits focus on IME fixes and cursor positioning

**Action Items:**
1. **Bump to `@jrichman/ink@6.4.8`** - gemini-cli is using newer version
2. **Monitor for upstream merge** - No public signal that fork changes were merged to mainline
3. **Diff fork vs mainline 6.6.0** - To determine concrete blockers for switching back

---

### 5. Scrollbar Drag Support - **ALREADY IMPLEMENTED**

**Good News:** Scrollbar drag support is **fully implemented** in LLxprt!

**Location:** `packages/cli/src/ui/contexts/ScrollProvider.tsx`

**Features Already Working:**
- [OK] Drag state management using refs (lines 118-127)
- [OK] Mouse press handler for thumb/track detection (lines 176-265)
- [OK] Mouse move handler for smooth dragging (lines 267-316)
- [OK] Mouse release handler for cleanup (lines 318-329)
- [OK] Comprehensive test coverage in `ScrollProvider.test.tsx`

**No Action Required** - Feature is production-ready.

---

### 6. Animated Scroll Support (`e192efa1f` style)

**Implementation Plan for LLxprt:**

**Single File to Modify:** `packages/cli/src/ui/components/shared/ScrollableList.tsx`

**Changes Required (~160 lines):**
1. Add `useEffect` to React imports
2. Add `ANIMATION_FRAME_DURATION_MS = 33` constant
3. Replace `Colors` import with `useAnimatedScrollbar` import (hook already exists)
4. Add `smoothScrollState` ref and `stopSmoothScroll` callback
5. Implement `smoothScrollTo` function with ease-in-out easing
6. Update `useKeypress` handler to use `stopSmoothScroll` and `smoothScrollTo`
7. Update `scrollableEntry` useMemo to use `scrollByWithAnimation`
8. Remove hardcoded `scrollbarColor` definition

**Key Features:**
- 200ms ease-in-out animation for PAGE_UP, PAGE_DOWN, HOME, END
- `stopSmoothScroll()` pattern for rapid keypress handling
- 33ms frame rate (~30fps) optimized for terminal rendering
- Mid-animation handling uses target position for smooth chaining

---

### 7. MAX_GEMINI_MESSAGE_LINES Constant

**Note:** This constant (`MAX_GEMINI_MESSAGE_LINES = 65536`) exists in upstream's cbbf56512 (ink scrolling) as a safety cap. 

**Status:** Not applicable to LLxprt - we don't have this constant and the scrolling architecture is different.

---

## SKIP: Release/Nightly/Patch Automation (25 commits)

These are release version bumps, nightly releases, and automated cherry-pick-to-release-branch commits. No code changes.

| SHA | Subject | Reason |
|-----|---------|--------|
| `40fa8136e` | chore(release): v0.15.4 | Release automation |
| `60407daf5` | fix(patch): cherry-pick 78a28bf to release/v0.15.3... | Release automation |
| `aa5ca13ef` | chore(release): v0.15.3 | Release automation |
| `a9789ae61` | fix(patch): cherry-pick d03496b to release/v0.15.2... | Release automation |
| `cb5c7fbdc` | chore(release): v0.15.2 | Release automation |
| `4067f85da` | fix(patch): cherry-pick ab6b229 to release/v0.15.1... | Release automation |
| `2c6d3eb51` | chore(release): v0.15.1 | Release automation |
| `79d867379` | fix(patch): cherry-pick ba15eeb to release/v0.15.0... | Release automation |
| `90adfb9a5` | chore(release): v0.15.0 | Release automation |
| `37af6f4f8` | chore(release): v0.15.0-preview.7 | Release automation |
| `d13152b05` | chore(release): v0.15.0-preview.6 | Release automation |
| `24b5eec88` | fix(patch): cherry-pick fb99b95 to release/v0.15.0-preview.5... | Release automation |
| `16f40a284` | chore(release): v0.15.0-preview.5 | Release automation |
| `77751a073` | fix(patch): cherry-pick 13d8d94 to release/v0.15.0-preview.4... | Release automation |
| `4ae2d4b18` | chore(release): v0.15.0-preview.4 | Release automation |
| `2639d7481` | fix(patch): cherry-pick 102905b to release/v0.15.0-preview.3... | Release automation |
| `fcd9b2a5f` | chore(release): v0.15.0-preview.3 | Release automation |
| `605d9167d` | fix(patch): cherry-pick fe1bfc6 to release/v0.15.0-preview.2... | Release automation |
| `128c22ece` | chore(release): v0.15.0-preview.2 | Release automation |
| `e27197096` | fix(patch): cherry-pick 7ec7845 to release/v0.15.0-preview.1... | Release automation |
| `48fa48ca3` | chore(release): v0.15.0-preview.1 | Release automation |
| `dfe7fc9a5` | fix(patch): cherry-pick 540f606 to release/v0.15.0-preview.0... | Release automation |
| `af5a1ebec` | chore(release): v0.15.0-preview.0 | Release automation |
| `e79f62694` | chore/release: bump version to 0.15.0-nightly... | Nightly automation |
| `cd27cae84` | chore(release): bump version to 0.15.0-nightly... | Nightly automation |

---

## SKIP: Feature/Architecture Not Applicable (27 commits)

| # | SHA | Subject | Reason |
|---|-----|---------|--------|
| 1 | `3f90001f8` | Added active experiment ids to Clearcut log events | **Clearcut telemetry removed from LLxprt** |
| 2 | `7bb13d1c4` | telemetry: track interactive session state | **Clearcut telemetry removed from LLxprt** |
| 3 | `4fbeac8b3` | Add experiment logging and add caching experiment | **Clearcut telemetry + experiments infra not in LLxprt** (no `code_assist/experiments/` dir) |
| 4 | `1cab68185` | Support incremental update experiment flag | **Experiment flags infra not in LLxprt** |
| 5 | `ac733d40b` | Add expected_replacements to smart-edit tool | **LLxprt doesn't have smart-edit** (uses deterministic replace + fuzzy edit) |
| 6 | `cbbf56512` | Support ink scrolling final pr (#12567) | **Major UI overhaul** — LLxprt uses different ink version (`@jrichman/ink@6.4.7`), no Scrollable.tsx. Very large diff (45+ files). Would need complete reimplementation. |
| 7 | `8f4b1b582` | Switch to alternate buffer mode before rendering Ink | **Depends on ink scrolling (#12567)** — LLxprt already has `useAlternateBuffer` via different path |
| 8 | `b37c674f2` | feat(ui) Make useAlternateBuffer the default | **Depends on ink scrolling stack** — LLxprt already has this as configurable setting |
| 9 | `046b3011c` | Sticky headers where the top rounded border is sticky | **Depends on ink scrolling stack** |
| 10 | `0c4d3b266` | Turns out the node console.clear() clears the buffer | **Not applicable** — LLxprt only supports alternate buffer mode |
| 11 | `f64994871` | Branch batch scroll (#12680) | **Already implemented** — LLxprt has useBatchedScroll |
| 12 | `395587105` | Switch back to truncating headers | **Depends on sticky headers/scrolling stack** |
| 13 | `f581ae81d` | jacob314/drag scrollbar | **Already implemented** — LLxprt's ScrollProvider.tsx has full drag support |
| 14 | `9ac47ebf8` | Fix merge conflicts. | **Fixup for scrolling/keyBindings stack** — no standalone value |
| 15 | `3032a8242` | Polish sticky headers | **Depends on sticky headers stack** |
| 16 | `9893da300` | Fix snapshot. | **Fixup for sticky headers** — no standalone value |
| 17 | `43b873124` | Fix extensions logging race condition and slash command logging | **Requires extension-manager.ts** — LLxprt doesn't have this file |
| 18 | `a4415f15d` | feat(core): Migrate generateContent to model configs | **Requires defaultModelConfigs.ts** — LLxprt doesn't have this file. Multi-provider architecture uses different approach. |
| 19 | `fdb608860` | feat(core): Migrate generateJson to resolved model configs | **Same as above** — depends on defaultModelConfigs.ts |
| 20 | `4af4f8644` | Plumb headers through google_credentials transport | **Google-specific auth transport** — LLxprt uses multi-provider auth, not google_credentials |
| 21 | `6893d2744` | feat(sessions): add resuming to geminiChat and CLI flags for session management | **Separate feature work** — See Research Findings section for implementation plan |
| 22 | `6d90b7ddb` | feat(issue-templates): Refine issue template labels and types | **GitHub issue template for upstream repo** — LLxprt has own templates |
| 23 | `f3a8b7371` | fix(ci): ensure correct version calculation and git ls-remote filtering | **CI workflow for upstream release process** — LLxprt has own CI |
| 24 | `2077521f8` | Trivial yaml fixes for linter | **Not applicable** — LLxprt's YAML issue templates are completely different structure |
| 25 | `2e2b06671` | Move temp dir from system prompt to first user msg | **Not applicable** — LLxprt doesn't have the "Shell tool output token efficiency" prompt section |
| 26 | `3154c06dc` | fix(ci): pre-download ripgrep in global setup to prevent race conditions | **Not applicable** — LLxprt uses @lvce-editor/ripgrep (pre-packaged), no download = no race |

---

## PICK: Clean Cherry-Picks (19 commits)

| # | SHA | Subject | Risk | Notes |
|---|-----|---------|------|-------|
| 1 | `054497c7a` | fix(core): Handle null command in VSCode IDE detection | LOW | 1 file, 5 lines |
| 2 | `475e92da5` | Fix test in windows | LOW | Test-only, 2 files |
| 3 | `ef4030331` | docs: fix typos in some files | LOW | Doc typos, 2 files |
| 4 | `5ff7cdc9e` | test(policy): add extreme priority value tests | LOW | Test-only, 1 file |
| 5 | `331dbd563` | Preserve tabs on paste | LOW | 2 files, text utils — **Same bug exists in LLxprt** |
| 6 | `4ab94dec5` | test: fix flaky file system integration test | LOW | 1 file, test fix |
| 7 | `3c9052a75` | Stop printing garbage characters for F1,F2.. keys | LOW | Text buffer + tests |
| 8 | `2136598e8` | Harden modifiable tool temp workspace | LOW | 2 files, security hardening |
| 9 | `5ba6bc713` | fix(prompt): Add Angular support to base prompt | LOW | Prompt snapshot + 2 lines |
| 10 | `51f952e70` | fix(core): use ripgrep --json output for robust cross-platform parsing | MEDIUM | ripGrep.ts + tests |
| 11 | `a0a682826` | fix: Downloading release assets from private GitHub repository | LOW | Extension github.ts |
| 12 | `69339f08a` | Adds listCommands endpoint to a2a server | LOW | A2A server only |
| 13 | `fd59d9dd9` | Fix shift+return in vscode | LOW | KeypressContext, 2 files |
| 14 | `9116cf2ba` | [cleanup] rename info message property 'icon' to 'prefix' | LOW | 2 files, types.ts |
| 15 | `c1076512d` | Deprecate read_many_files tool | LOW-MED | Docs + toolsCommand.ts |
| 16 | `2abc288c5` | Make useFullWidth the default | LOW | Simple default change — **Match upstream** |
| 17 | `4ef4bd6f0` | feat(hooks): Hook Execution Engine | MEDIUM | LLxprt has hooks/ but missing hookRunner.ts — **Critical missing component** |
| 18 | `6cf1c9852` | Update ink version | LOW | Bump `@jrichman/ink` from 6.4.7 to 6.4.8 |
| 19 | `e192efa1f` | feat(ui) support animated page up/down, fn-up/down and end+home | MEDIUM | Reimplement for LLxprt's ScrollableList.tsx — **See Research Findings** |

---

## REIMPLEMENT: Need LLxprt-Specific Adaptation (10 commits)

| # | SHA | Subject | Reason | Effort |
|---|-----|---------|--------|--------|
| 1 | `9e4ae214a` + `c0b766ad7` | KeypressContext unified ANSI parser | Architectural improvement, fixes ESC+mouse garbage. See `9e4ae214a-c0b766ad7-plan.md` | HIGH |
| 2 | `37ca643a6` | Fix external editor diff drift | LLxprt has `onEditorOpen` parameter, need to add `contentOverrides` while keeping `onEditorOpen` | MEDIUM |
| 3 | `22b055052` | Fix gemini crash on startup in tmux environments | LLxprt's Footer.tsx has WORSE vulnerability (no protection). Create shared ThemedGradient component. | MEDIUM |
| 4 | `cc2c48d59` | Fix uninstalling extensions named differently | LLxprt uninstall uses name not actual dir, needs adapted fix in `extension.ts` | MEDIUM |
| 5 | `b248ec6df` | Add `security.blockGitExtensions` setting and enforcement | LLxprt lacks setting and enforcement, needs to add to functional extension system | MEDIUM |
| 6 | `47603ef8e` | Reload gemini memory on extension load/unload + memory refresh refactor | Add core memory refresh helper + MemoryChanged event | MEDIUM |
| 7 | `c88340314` | Extension Reloading - respect updates to exclude tools | Refresh toolset when `excludeTools` changes on extension reload | MEDIUM |
| 8 | `bafbcbbe8` | Add `/extensions restart` command | Add to LLxprt's extensionsCommand.ts + ExtensionLoader.restartExtension | MEDIUM |
| 9 | `e192efa1f` | Animated scroll support | Reimplement for LLxprt's ScrollableList.tsx using useAnimatedScrollbar hook | MEDIUM |
| 10 | `6893d2744` | Session resuming | Separate feature work — see Research Findings for detailed implementation plan | HIGH |

---

## Decisions Made (Based on Research)

### Kitty Protocol (`9e4ae214a` + `c0b766ad7`) - **REIMPLEMENT**
Upstream refactored to a unified ANSI parser (keeping Kitty CSI-u support). This fixes ESC+mouse garbage input (#12613) and improves maintainability via table-driven dispatch. We're adopting this NOW. See `9e4ae214a-c0b766ad7-plan.md` for full implementation plan.

### Extension Commits (`cc2c48d59`, `b248ec6df`, `47603ef8e`, `c88340314`, `bafbcbbe8`) - **ALL REIMPLEMENT**
All need adaptation to LLxprt's functional extension architecture (no extension-manager.ts class).

### Hook Execution Engine (`4ef4bd6f0`) - **PICK**
LLxprt has hooks/ infrastructure but is MISSING hookRunner.ts — this is a critical missing component that makes the entire hooks system non-functional.

### Ink Version (`6cf1c9852`) - **PICK (bump to 6.4.8)**
gemini-cli is on `@jrichman/ink@6.4.8`, LLxprt is on `6.4.7`. Simple version bump.

### useFullWidth Default (`2abc288c5`) - **PICK**
Simple default change to match upstream.

### Session Resuming (`6893d2744`) - **REIMPLEMENT (separate feature)**
See Research Findings for detailed implementation plan addressing the `--continue` error.

### Animated Scroll (`e192efa1f`) - **REIMPLEMENT**
See Research Findings for ScrollableList.tsx implementation plan.

### Scrollbar Drag (`f581ae81d`) - **SKIP (already implemented)**
LLxprt's ScrollProvider.tsx already has full drag support!

---

## Updated Proposed Batching

### Batch 1: Low-risk picks (8 commits)
`054497c7a` `475e92da5` `ef4030331` `5ff7cdc9e` `331dbd563` `4ab94dec5` `3c9052a75` `2136598e8`

### Batch 2: Medium-risk picks (6 commits) + FULL VERIFY
`5ba6bc713` `51f952e70` `fd59d9dd9` `9116cf2ba` `c1076512d` `2abc288c5`

### Batch 3: Extension/A2A picks (2 commits)
`a0a682826` `69339f08a`

### Batch 4: Hooks + Ink (2 commits)
`4ef4bd6f0` (Hook Execution Engine) `6cf1c9852` (Ink 6.4.8)

### Batch 5: Reimplementations (10 commits)
1. `9e4ae214a` + `c0b766ad7` - **KeypressContext unified ANSI parser** (HIGH priority - see `9e4ae214a-c0b766ad7-plan.md`)
2. `37ca643a6` - Editor diff drift (add contentOverrides param)
3. `22b055052` - tmux gradient crash (create ThemedGradient component)
4. `cc2c48d59` - Extension uninstall fix
5. `b248ec6df` - security.blockGitExtensions setting
6. `47603ef8e` - Memory refresh on extension load/unload
7. `c88340314` - Refresh toolset on extension reload
8. `bafbcbbe8` - /extensions restart command
9. `e192efa1f` - Animated scroll support
10. `6893d2744` - Session resuming (--continue fix + --resume support)

---

## Additional Action Items

1. **Bump ink:** `@jrichman/ink` from 6.4.7 to 6.4.8
2. **Monitor ink fork:** No public signal that jrichman's changes will merge to mainline ink. Continue using fork.

---

## Ready for Execution

All decisions have been made based on research. PLAN.md can now be created with specific implementation steps for each batch.
