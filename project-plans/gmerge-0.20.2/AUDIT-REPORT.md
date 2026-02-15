# gmerge-0.20.2 Audit Report: PLANNED vs ACTUAL

**Auditor:** Claude (automated deep audit)
**Date:** 2026-02-15
**Branch:** `gmerge/0.20.2` — 30 commits (29 code + 1 docs tracking)
**Scope:** 13 PICK + 13 REIMPLEMENT upstream commits across 14 batches

---

## Executive Summary

The merge was substantially executed as planned. All 14 batches completed with commits. However, the audit identifies **3 critical wiring gaps** where infrastructure was built but callers were never wired, **1 moderate gap** in telemetry, and several minor issues. These must be addressed before PR.

### Severity Counts

| Severity | Count | Description |
|----------|------:|-------------|
|  CRITICAL | 3 | Feature infrastructure exists but has no callers — dead code |
|  MODERATE | 1 | Telemetry field added but never populated by callers |
|  MINOR | 4 | Non-blocking quality or completeness issues |
| [OK] CLEAN | 10 | Batch fully implemented as planned |

---

## Batch-by-Batch Audit

---

### Batch 1 (PICK) — Commits d97bbd53, 3406dc5b, 0f12d6c4, 450734e3, 6a43b312

**Plan:** Cherry-pick 5 upstream commits: exit codes, consent flag, MCP auth, LICENSE revert, telemetry finish_reasons.

**What was actually done:**
- [OK] `d97bbd53` → `359c73a41`: Exit codes landed. `ExitCodes` object in `exitCodes.ts`, used in `gemini.tsx`, `FolderTrustDialog`, `useFolderTrust`, `validateNonInterActiveAuth`.
- [OK] `3406dc5b` → `3bfe562a6`: Consent flag landed. `--consent` option in `link.ts`.
- [OK] `0f12d6c4` → `bf1edc599`: MCP auth landed. `auth-provider.ts` created with `McpAuthProvider` interface. `google-auth-provider.ts` has `getRequestHeaders()` with `X-Goog-User-Project`. `mcp-client.ts` wired. Tests present.
- [OK] `450734e3` → `609c9eb94`: LICENSE reverted to Apache 2.0 boilerplate (no Google LLC).
- WARNING: `6a43b312` → `5de26eaca`: `finish_reasons` field added to `ApiResponseEvent` class in `types.ts`.
- [OK] Post-batch fix `04246b8db`: Removed unused `coreEvents` import.

**Plan also included project-plan files** in commit 359c73a41 (all 11 playbooks, PLAN.md, CHERRIES.md, etc.) — makes sense for bootstrapping.

**GAPS:**
-  **finish_reasons never populated by callers.** The `ApiResponseEvent` constructor accepts `finish_reasons` but NO call site passes it. Verified: `LoggingProviderWrapper.ts` and `loggingContentGenerator.ts` both create `new ApiResponseEvent(...)` without the `finish_reasons` parameter. The field defaults to `[]` and will never contain data. The upstream commit (`6a43b312`) modified `loggers.ts` to extract and pass `finish_reasons` from API responses — that part was not ported.

**EXTRAS:** None.

**CONCERNS:** The finish_reasons gap means the telemetry event carries a permanently-empty field. Low runtime impact but defeats the purpose of the upstream change.

---

### Batch 2 (PICK, FULL VERIFY) — Commits f98e84f0, 2fe609cb, f4babf17, 70a48a3d, 98d7238e

**Plan:** Cherry-pick 5 commits: schema test, EPIPE fix, async hardening, markdown fix, setup-github.

**What was actually done:**
- [OK] `f98e84f0` → `71e36562f`: Schema `$schema` property test added to `generate-settings-schema.test.ts`.
- [OK] `2fe609cb` → `b0fdbc222`: EPIPE handler added BEFORE `child.stdin.write` in `hookRunner.ts`. EPIPE silently ignored, others logged. Test mock updated.
- [OK] `f4babf17` → `29fb1e883`: ESLint `return-await` rule added (`in-try-catch`). Applied across 6 files in the cherry-pick itself (async hardening).
- [OK] `70a48a3d` → `bfd242838`: Regex in `InlineMarkdownRenderer.tsx` changed from `\*(.*?)\*` to `\*(.+?)\*`. Test added.
- [OK] `98d7238e` → `8e6909e08`: `setupGithubCommand.ts` conditionally adds `set -eEuo pipefail`. Tests expanded.
- [OK] Post-batch fixes: `9e44dbf51` (formatting), `f0038b964` (debugLogger reference), `dab3ec629` (return-await across 20+ files, test fixes, branding fixes).

**GAPS:** None.

**EXTRAS:** The `dab3ec629` fix commit was extensive — touched 25 files to apply return-await compliance, fix 6 test files (branding, exit codes, assertions), and add `debugLogger` constant. This was correctly reactive to the ESLint rule change.

**CONCERNS:** None. Full verify passed.

---

### Batch 3 (PICK) — Commits 1689e9b6, 71b0e7ab, ba864380

**Plan:** Cherry-pick 3 commits: React state fix, cleanup error handling, IDE auth.

**What was actually done:**
- [OK] `71b0e7ab` → `1284ff27b`: try-catch around `rm()` in `globalSetup.ts` teardown. Failure logged as warning.
- [OK] `ba864380` → `596763831`: IDE `ide-client.ts` auth token fallback — re-reads connection config, falls back to `LLXPRT_CODE_IDE_AUTH_TOKEN` env. Release scaffolding discarded. Test added.
- [OK] `1689e9b6` → `1f9c0598e`: React setState-during-render fix applied to AppContainer, InputPrompt, useCommandCompletion.
- [OK] Post-batch fix `cc125f519`: Removed 58 lines of duplicate code from AppContainer (cherry-pick added code that already existed), fixed `useCommandCompletion` compute dirs.

**GAPS:** None.

**EXTRAS:** None.

**CONCERNS:** The cherry-pick order was 71b0e7ab → ba864380 → 1689e9b6 (not the planned 1689e9b6 → 71b0e7ab → ba864380). This is fine — the commits are independent.

---

### Batch 4 (REIMPLEMENT, FULL VERIFY) — Gemini 3.0 Prompt Overrides (upstream 1187c7fd)

**Plan (playbook):**
1. Add "Do not call tools in silence" mandate to gemini-3-pro-preview/core.md
2. Ensure "No Chitchat" is absent from Tone & Style
3. Keep "Clarity over Brevity"
4. Add test verifying the override

**What was actually done:**
- [OK] `055fe608c`: Added `# Core Mandates` section with "Do not call tools in silence" bullet to `gemini-3-pro-preview/core.md`.
- [OK] "No Chitchat" was already absent from the model-specific override (Tone & Style section never contained it).
- [OK] "Clarity over Brevity" retained in Tone & Style.
- [OK] Test added: `prompt-service.test.ts` verifies gemini-3-pro-preview prompt contains "Do not call tools in silence", does NOT contain "No Chitchat", and DOES contain "Clarity over Brevity".
- [OK] Also fixed `useCommandCompletion.test.ts` (unrelated test cleanup) and `ide-client.test.ts` (branding fix).
- [OK] Updated `provider-defaults.ts` — added gemini-3-pro-preview to model override registry.

**GAPS:** None.

**EXTRAS:** The commit also included test cleanup for other files. Appropriate batch hygiene.

**CONCERNS:** None. Clean implementation.

---

### Batch 5 (REIMPLEMENT) — Interactive/Non-Interactive/Subagent Prompt Mode (upstream 4a82b0d8)

**Plan (playbook):** 11-item checklist:
1. [OK] Add `interactionMode` to `PromptEnvironment` (types.ts)
2. [OK] Add template variables to `TemplateEngine` (4 variables: INTERACTION_MODE, INTERACTION_MODE_LABEL, INTERACTIVE_CONFIRM, NON_INTERACTIVE_CONTINUE)
3. [OK] Add to `CoreSystemPromptOptions` and wire through `buildPromptContext`
4. [OK] Include in prompt cache key (`prompt-cache.ts`)
5. [OK] Update `defaults/core.md` with template variables
6. [OK] Update Gemini provider `core.md` files (gemini/core.md AND gemini-2.5-flash/core.md)
7. [ERROR] **Wire interactionMode in subagent.ts** — `interactionMode: 'subagent'` NOT passed
8. [ERROR] **Wire interactionMode in executor.ts** — NOT wired
9. [ERROR] **Wire interactionMode in main CLI** — NOT wired (`config.isInteractive()` not used)
10. [OK] Add tests (TemplateEngine.test.ts: 51 new lines; prompt-cache.test.ts: 38 new lines; prompts-async.test.ts: 18 new lines)

**What was actually done:**
- [OK] Infrastructure: Types, template engine, prompt context, cache key, markdown templates — all correctly implemented.
- [OK] Tests: Template rendering verified for all 3 modes.
- [ERROR] **NO CALLERS WIRED.** Confirmed by grep: `interactionMode` appears in 0 lines of `subagent.ts`, `executor.ts`, `gemini.tsx`, or `client.ts`.
- The NOTES.md openly acknowledges: "Callers not yet wired to pass interactionMode (infrastructure-only, to be wired by callers as needed)."

**GAPS:**
-  **CRITICAL: interactionMode is never passed by any caller.** The default is `'interactive'` (from TemplateEngine fallback), so ALL modes — including subagent mode — render as "interactive". This completely defeats the purpose of the feature. The upstream change was specifically to fix contradictory instructions in subagent mode where prompts say "interactive agent" + "confirm with user" while appended rules say "you CANNOT ask the user". **Without wiring, this exact bug persists.**

**EXTRAS:** None.

**CONCERNS:**
- The notes say "to be wired by callers as needed" — but the plan explicitly said to wire them. This is a known skip, not an oversight.
- The latent test failure (prompt-service.test.ts checking for literal "interactive") was introduced here but only fixed in Batch 12. This means Batches 6-11 had a failing test that wasn't caught during their verify cycles (or was tolerantly ignored).

---

### Batch 6 (REIMPLEMENT, FULL VERIFY) — Shell Inactivity Timeout (upstream 0d29385e)

**Plan (playbook):**
1. Add `inactivityTimeoutMs` to `ShellExecutionConfig`
2. Implement reset-on-output timer in both PTY and child_process paths
3. Add setting (`shell-inactivity-timeout-seconds`, default 120s, -1 unlimited)
4. Wire through `Config.getShellExecutionConfig()`
5. Add tests

**What was actually done:**
- [OK] `58460743c`: `inactivityTimeoutMs` added to `ShellExecutionConfig` interface.
- [OK] Reset-on-output timer implemented in BOTH child_process (L268-310) AND PTY (L589-834) paths.
- [OK] Setting registered in `settingsRegistry.ts` with default 120s.
- [OK] `Config.getShellExecutionConfig()` reads ephemeral settings, converts seconds to ms, returns in config.
- [OK] `shell.ts` tool spreads `this.config.getShellExecutionConfig()` into executor call.
- [OK] Tests: 110 new lines in `shellExecutionService.test.ts`.
- [OK] Also fixed formatting issues from Batch 5 (template var indentation in core.md files).

**GAPS:** None. Full end-to-end wiring: setting → config → shell tool → execution service → timer with reset-on-output.

**EXTRAS:** Template formatting fixes from Batch 5 included here.

**CONCERNS:** None. This is one of the best-implemented batches.

---

### Batch 7 (REIMPLEMENT) — Auto-Execute Slash Commands (upstream f918af82)

**Plan (playbook):**
1. Add `autoExecute?: boolean` to `SlashCommand` interface
2. Add auto-execute check on Enter in `InputPrompt.tsx`
3. Add `getCommandFromSuggestion()` helper in `useSlashCompletion.tsx`
4. Classify commands (autoExecute: true/false)
5. Tab always autocompletes

**What was actually done:**
- [OK] `68755ca4d`: `autoExecute?: boolean` added to `SlashCommand` (types.ts, 5 new lines).
- [OK] InputPrompt.tsx Enter handler checks `command?.autoExecute` and submits immediately.
- [OK] `getCommandFromSuggestion()` added to `useSlashCompletion.tsx` (23 new lines).
- [OK] Propagated through `useCommandCompletion.tsx`.
- [OK] 20 command files updated with `autoExecute: true`: about, clear, compress, copy, docs, editor, extensions, help, ide, init, mcp, memory (×2), policies, quit, settings, setupGithub, stats (×3), theme.
- [OK] Tests: `useCommandCompletion.autoexecute.test.tsx` (63 lines), `useSlashCompletion.autoexecute.test.tsx` (136 lines).

**GAPS:** None.

**EXTRAS:** None.

**CONCERNS:** None. Well-classified commands, good test coverage.

---

### Batch 8 (REIMPLEMENT, FULL VERIFY) — Hook Integration Tool+LLM (upstream 558c8ece + 5bed9706)

**Plan (playbook):**
1. Create `coreToolHookTriggers.ts` — fire hooks before/after tool execution
2. Create `geminiChatHookTriggers.ts` — fire hooks before/after model calls
3. Wire into `coreToolScheduler.ts`
4. Wire into `geminiChat.ts`
5. Check `config.getEnableHooks()` before firing
6. Non-blocking: hook failures don't block main flow

**What was actually done:**
- [OK] `0c876702d`: `coreToolHookTriggers.ts` created (158 lines) with `triggerBeforeToolHook` and `triggerAfterToolHook`.
- [OK] `geminiChatHookTriggers.ts` created (242 lines) with `triggerBeforeModelHook`, `triggerAfterModelHook`, `triggerBeforeToolSelectionHook`.
- [OK] `coreToolScheduler.ts` wired: `triggerBeforeToolHook` called before execution, `triggerAfterToolHook` after.
- [OK] `geminiChat.ts` wired: `triggerBeforeToolSelectionHook`, `triggerBeforeModelHook`, `triggerAfterModelHook` at appropriate points.
- [OK] All hook calls use `void` (non-blocking fire-and-forget).
- [OK] Tests: `coreToolHookTriggers.test.ts` (116 lines), `geminiChatHookTriggers.test.ts` (174 lines), `coreToolScheduler.test.ts` (16 new lines).
- [OK] Hooks check enablement before firing (in trigger functions).

**GAPS:** None.

**EXTRAS:** None.

**CONCERNS:** None. Full end-to-end implementation.

---

### Batch 9 (REIMPLEMENT) — MCP Server Instructions (upstream bc365f1e + 844d3a4d)

**Plan (playbook):**
1. Add `getInstructions()` to `McpClient`
2. Add `getMcpInstructions()` to `McpClientManager`
3. Wire into system prompt
4. Wire in callers (client.ts, subagent.ts, all providers)
5. Always include (no toggle)
6. Tests

**What was actually done:**
- [OK] `f9600bae9`: `McpClient.getInstructions()` returns `this.client.getInstructions() ?? ''`.
- [OK] `McpClientManager.getMcpInstructions()` aggregates from all connected servers with name headers.
- [OK] `mcpInstructions` added to `CoreSystemPromptOptions`.
- [OK] `getCoreSystemPromptAsync()` appends MCP instructions to core memory.
- [OK] **All callers wired:** `client.ts` (3 call sites), `subagent.ts` (1 call site). Verified by grep.
- [OK] Always included when available (no toggle — skips upstream's bc365f1e gate, goes straight to 844d3a4d behavior).
- [OK] Tests: 5 unit tests (McpClient, McpClientManager), 4 integration tests (prompts-async.test.ts).

**GAPS:** None. This is a model implementation — infrastructure + callers + tests.

**EXTRAS:** None.

**CONCERNS:** None. Excellent.

---

### Batch 10 (REIMPLEMENT, FULL VERIFY) — Stats Quota Display (upstream 69188c85)

**Plan (playbook):**
1. Add quota types
2. Add quota retrieval
3. Add `/stats quota` subcommand
4. Add quota section to StatsDisplay
5. Tests

**What was actually done:**
- [OK] `fd1226801`: `QuotaInfo` type added via `quotaLines?: string[]` in UI types.
- [OK] `fetchAllQuotaInfo()` function fetches OAuth provider quotas (Anthropic + Codex) with error handling.
- [OK] `/stats quota` subcommand registered in statsCommand.ts (158 new lines in statsCommand, 13 in StatsDisplay).
- [OK] StatsDisplay renders quota lines.
- [OK] Tests: `StatsDisplay.test.tsx` (188 new lines), snapshots updated.
- [OK] API key provider quota fetch also implemented.

**GAPS:** None.

**EXTRAS:** Format fix from previous batch (`prompts-async.test.ts`) bundled.

**CONCERNS:** None. Full verify passed.

---

### Batch 11 (REIMPLEMENT) — A2A ModelInfo Propagation (upstream 806cd112)

**Plan (playbook):**
1. Add `modelInfo` field to A2A `Task` class
2. Handle `ModelInfo` event type
3. Use in `getMetadata` and status updates
4. Fall back to config model when no modelInfo

**What was actually done:**
- [OK] `e9f314cf9`: Private `modelInfo` field added to Task.
- [OK] `ModelInfo` interface and `GeminiEventType.ModelInfo` added to `turn.ts`.
- [OK] `ServerGeminiModelInfoEvent` type added to stream event union.
- [OK] Task handles `GeminiEventType.ModelInfo` in event switch — stores `event.value`.
- [OK] `getMetadata()` uses `this.modelInfo?.model || this.config.getContentGeneratorConfig()?.model || 'unknown'`.
- [OK] `setTaskState()` uses `this.modelInfo?.model || this.config.getModel()`.
- [OK] Tests: `task.test.ts` (185 new lines), testing_utils updated.

**GAPS:** None.

**EXTRAS:** None.

**CONCERNS:** None. Clean A2A implementation.

---

### Batch 12 (REIMPLEMENT, FULL VERIFY) — JIT Context Manager (upstream 752a5214)

**Plan (playbook):**
1. Add `jitContextEnabled` getter to Config
2. Add setting to settingsSchema
3. Wire into memoryDiscovery / context manager
4. Add to settings.schema.json
5. Tests

**What was actually done:**
- [OK] `7966fb970`: `jitContextEnabled` added to `ConfigParameters` (default true).
- [OK] `Config.getJitContextEnabled()` checks settings service first, falls back to instance.
- [OK] Setting added to `settingsSchema.ts` (10 new lines).
- [OK] `settings.schema.json` updated (binary diff shows size change).
- [OK] Tests: `config.test.ts` (47 new lines).
- [OK] Fixed prompt-service test broken since Batch 5 (literal "interactive" check).

**GAPS:**
-  **CRITICAL: `getJitContextEnabled()` is never called by any runtime code.** Grep for `getJitContextEnabled` and `jitContextEnabled` outside config.ts, settingsSchema.ts, and test files returns **nothing**. The plan said to wire it into `memoryDiscovery.ts` or a context manager service — this was not done. The `loadJitSubdirectoryMemory()` function in `memoryDiscovery.ts` has no conditional check for this setting.

**EXTRAS:** Prompt-service test fix (from Batch 5 breakage). A2A test format fix.

**CONCERNS:** The setting exists, the config getter exists, tests verify the getter — but the setting has no runtime effect. It's dead infrastructure. The existing `loadJitSubdirectoryMemory` always runs regardless of this setting.

---

### Batch 13 (REIMPLEMENT) — Stdio Hardening (upstream f9997f92)

**Plan (playbook):**
1. Harden `createInkStdio()` in `stdio.ts` with error event handlers
2. EPIPE errors silently ignored; others logged
3. Apply to `gemini.tsx` stream wiring if applicable
4. Tests

**What was actually done:**
- [OK] `081822780`: Error event handlers added to `createInkStdio()` in `stdio.ts` (27 new lines).
- [OK] EPIPE errors silently ignored; non-EPIPE logged via `console.warn`.
- [OK] Tests: `stdio.test.ts` (82 new lines) — handlers attached, EPIPE handled, non-EPIPE logged.

**GAPS:**
-  Plan mentioned `gemini.tsx` stream wiring improvements — not done. The implementation focused solely on `createInkStdio()`. This is a minor gap since `createInkStdio` is the primary Ink stdio factory.

**EXTRAS:** None.

**CONCERNS:** None significant. The core hardening is in place.

---

### Batch 14 (REIMPLEMENT, FULL VERIFY) — Shell Env Sanitization (upstream 8872ee0a)

**Plan (playbook):**
1. Add `sanitizeEnvironment()` static method to `ShellExecutionService`
2. Blocklist approach for sensitive vars
3. Preserve LLXPRT_*, PATH, HOME, SHELL, TERM, GIT_*, etc.
4. Only active in CI/sandbox mode
5. User allowlist can override
6. Tests

**What was actually done:**
- [OK] `01280e89d`: `sanitizeEnvironment()` static method added (50 new lines).
- [OK] Blocklist patterns: API_KEY, SECRET, TOKEN, PASSWORD, CREDENTIAL, PRIVATE_KEY.
- [OK] Preserves LLXPRT_*, LLXPRT_CODE_*, PATH, HOME, SHELL, TERM, GIT_*, NODE_*, CI vars, SSH_AUTH_SOCK, XDG_*.
- [OK] User allowlist support.
- [OK] Passthrough in local dev mode (isSandboxOrCI=false).
- [OK] Tests: 249 new lines (8 test cases covering all scenarios).

**GAPS:**
-  **CRITICAL: `sanitizeEnvironment()` is never called.** Grep confirms only one non-test reference: the static method declaration at line 1176 of `shellExecutionService.ts`. No caller in shell.ts, config.ts, or anywhere else invokes it. The plan said to "Sanitize shell execution environment in CI" but the method is just a static utility with no callers.

**EXTRAS:** None.

**CONCERNS:** The method is well-designed and well-tested, but it has zero runtime effect. Shell commands in CI/sandbox will still inherit the full environment with all secrets.

---

## Cross-Cutting Concerns

### Template Variables in Markdown Files

| Variable | core.md | gemini/core.md | gemini-2.5-flash/core.md | gemini-3-pro-preview/core.md |
|----------|---------|----------------|--------------------------|------------------------------|
| `{{INTERACTION_MODE_LABEL}}` | [OK] | [OK] | [OK] | N/A (partial override) |
| `{{INTERACTIVE_CONFIRM}}` | [OK] | [OK] | [OK] | N/A |
| `{{NON_INTERACTIVE_CONTINUE}}` | [OK] | [OK] | [OK] | N/A |

Template variables are properly placed in all relevant markdown files. The gemini-3-pro-preview/core.md only overrides Tone & Style section (correct — it inherits the base/provider templates).

### Test Coverage

| Batch | New Tests | Test Quality |
|-------|-----------|--------------|
| 1 | 0 (cherry-pick) | Upstream tests carried |
| 2 | Upstream tests + 6 test fixes | Good |
| 3 | Upstream tests | Good |
| 4 | 1 prompt rendering test | Good |
| 5 | 3 test files (TemplateEngine, prompt-cache, prompts-async) | Good coverage of infrastructure; doesn't test runtime behavior |
| 6 | 1 test file (110 lines) | Good — tests timer reset |
| 7 | 2 test files (199 lines) | Good |
| 8 | 3 test files (306 lines) | Good |
| 9 | 5 unit + 4 integration tests | Excellent |
| 10 | 2 test files (188+ lines) + snapshots | Good |
| 11 | 1 test file (185 lines) | Good |
| 12 | 1 test file (47 lines) | Tests getter only |
| 13 | 1 test file (82 lines) | Good |
| 14 | 1 test file (249 lines) | Tests method only |

### Branding Compliance

No `@google/gemini-cli-core` or `@google/gemini-cli` imports found in any changed files. `GEMINI_CLI` → `LLXPRT_CODE` substitutions properly applied. `.gemini/` → `.llxprt/` verified in test files.

---

## Critical Items Requiring Action Before PR

### 1.  Batch 5: Wire `interactionMode` into callers

**Files to change:**
- `packages/core/src/core/subagent.ts` — pass `interactionMode: 'subagent'` to `getCoreSystemPromptAsync()`
- `packages/a2a-server/src/agent/executor.ts` — pass `interactionMode: 'subagent'` for agent subagents
- `packages/core/src/core/client.ts` — pass `interactionMode` based on `config.isNonInteractive()` / isSubagent detection
- Main CLI entry path — pass `interactionMode: 'interactive'` or `'non-interactive'` based on `config.isInteractive()`

**Impact:** Without this, subagent prompts still contain contradictory "interactive agent" + "confirm with user" instructions. This was the entire motivation for the upstream change.

### 2.  Batch 12: Wire `getJitContextEnabled()` into `memoryDiscovery.ts`

**Files to change:**
- `packages/core/src/utils/memoryDiscovery.ts` — check `config.getJitContextEnabled()` before calling `loadJitSubdirectoryMemory()`
- Or create a context manager service that wraps this check

**Impact:** The `jitContextEnabled` setting has no effect. Users cannot disable JIT context loading.

### 3.  Batch 14: Call `sanitizeEnvironment()` in shell execution path

**Files to change:**
- `packages/core/src/services/shellExecutionService.ts` — call `sanitizeEnvironment()` on the env passed to `child_process.spawn()` and PTY spawning when in CI/sandbox mode
- Or wire through `getShellExecutionConfig()` in `config.ts`

**Impact:** CI/sandbox environments still inherit full process.env including secrets.

### 4.  Batch 1: Populate `finish_reasons` in API response logging

**Files to change:**
- `packages/core/src/providers/LoggingProviderWrapper.ts` — extract finish_reasons from provider response, pass to `ApiResponseEvent` constructor
- `packages/core/src/core/loggingContentGenerator.ts` — same

**Impact:** Telemetry `finish_reasons` field is always `[]`. Low runtime impact but incomplete feature.

---

## Minor Items (Non-Blocking)

### 5.  Batch 13: `gemini.tsx` stream wiring not hardened
Plan mentioned applying stdio improvements to `gemini.tsx` as well. Only `createInkStdio()` was hardened. Low risk since `createInkStdio` is the primary factory.

### 6.  Batch 5: Latent test failure from Batch 5 → Batch 12
`prompt-service.test.ts` was broken for Batches 6-11 (checking literal "interactive" string that became a template variable). This suggests the "full verify" cycles during those batches either didn't run this specific test file or tolerantly skipped it. The test was fixed in Batch 12.

### 7.  Batch 5: `gemini-3-pro-preview/core.md` not checked for interaction mode
The gemini-3-pro-preview/core.md is a partial override that only sets Tone & Style and Core Mandates. It inherits interaction mode from the parent templates. This is CORRECT by design, but worth noting that if anyone extends this file to include the preamble section, they'd need to add the template variables.

### 8.  Batch 10: Quota display depends on OAuth manager
The `/stats quota` implementation fetches from `oauthManager.getAllAnthropicUsageInfo()` and `getAllCodexUsageInfo()`. This will silently return empty for API-key-only users. The plan mentioned "generic quota interface works across providers" but implementation is OAuth-provider-specific. This matches the upstream behavior but could be improved for API-key providers.

---

## Summary Statistics

| Metric | Count |
|--------|------:|
| Total commits | 30 |
| Cherry-pick commits | 13 |
| Post-cherry-pick fix commits | 6 |
| REIMPLEMENT commits | 11 |
| Docs commit | 1 (tracking artifacts) |
| Files changed (est.) | ~100+ |
| New test lines (est.) | ~1,800+ |
| Critical gaps | 3 |
| Moderate gaps | 1 |

**Bottom line:** The merge execution was high-quality with good test coverage and proper branding compliance. Three features (interactionMode, jitContextEnabled, sanitizeEnvironment) were implemented as infrastructure-only without wiring into callers, making them effectively dead code. These MUST be wired before PR, as they represent the core value of those upstream changes.
