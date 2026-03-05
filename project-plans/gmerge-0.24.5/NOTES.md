# Execution Notes: gmerge-0.24.5

Running notes captured during batch execution. Append after each batch.

---

## Pre-Execution Notes

- A2A remote agents descoped to issue #1675 (4 commits moved to SKIP)
- Skills chain (11 commits) must be picked in order — heavy branding changes
- Race condition fixes (PICK-B8) are high-risk — `687ca40b` changes `void` → `await` on `scheduleToolCalls`
- Console migration (RE-B10) is the biggest single item at 47 files
- MessageBus P03 is the biggest DI phase at 31 files (11 prod + 20 test)
- `gemini.tsx`, `GeminiClient`, `GeminiCLIExtension` are REAL LLxprt names — not branding leakage

---

## PICK-B1 (Batch 1)

**Result: 2/5 committed, 3 reclassified**

Cherry-picked successfully:
- `0a216b28` (as `77d400cb0`) — EIO fix. Minor conflict in readStdin.test.ts resolved.
- `e9a601c1` (as `1edf8b902`) — MCP type field. Conflict in settings-validation.test.ts resolved.
- Fix commit `df76e9067` — suppress unused _onErrorHandler lint warning

Reclassified:
- `b0d5c4c0` → REIMPLEMENT: 7 policy engine files conflicted. LLxprt has custom policy extensions (syncPlanModeTools, auto-add, extension policies). Too diverged for mechanical cherry-pick.
- `b6b0727e` → REIMPLEMENT: 7 conflicts in settings.ts (heavily diverged) + gemini.tsx (LLxprt has different bootstrap). Non-fatal schema validation is a good idea, needs manual port.
- `5f286147` → SKIP: McpStatus.tsx (modify/delete conflict). LLxprt doesn't have this UI component. Constant-only addition would be orphaned.

Quick verify: lint [OK] typecheck [OK]

## PICK-B2 (Batch 2)

**Result: 3/5 committed, 2 reclassified**

Cherry-picked successfully:
- `56b05042` (as `31d67db0a`) -- typo fix in tools.ts. Clean.
- `acecd80a` (as `768747190`) -- IDE promise rejection fix. Clean.
- `21388a0a` (as `11abb491e`) -- GitService checkIsRepo fix. 1 import conflict resolved (kept LLxprt imports + added upstream's debugLogger import).

Reclassified:
- `873d10df` -> REIMPLEMENT: terse image path transformations had 6 conflicted files across InputPrompt, text-buffer, vim-buffer, highlight — these areas have diverged significantly in LLxprt (secureInputHandler, buildSegmentsForVisualSlice, etc.)
- `0eb84f51` -> SKIP: integration-tests/hooks-agent-flow.test.ts deleted in LLxprt (modify/delete conflict)

Full verify: lint PASS, typecheck PASS, test 106 failures -- ALL PRE-EXISTING (confirmed same failures on main branch, caused by ajv-formats + ProviderRuntimeContext issues, not by cherry-picks).

## PICK-B3 (Batch 3)

**Result: 5/5 committed**

Cherry-picked via subagent. All 5 Skills core commits applied:
- `de1233b8` (as `4989cded7`) — Skills core infra (skillLoader, skillManager, types)
- `958284dc` (as `50b5e9cfd`) — Skills activation tool
- `764b1959` (as `aa7c0b456`) — Skills system prompt integration
- `e78c3fe4` (as `6015c7e60`) — Skills status bar display
- `f0a039f7` (as `fe31e61c3`) — Skills code refactor

Branding changes applied in fix commit `d94355b84`:
- `.gemini/skills/` → `.llxprt/skills/` paths
- `@google/gemini-cli-core` → `@vybestack/llxprt-code-core` imports
- `gemini skills` → `llxprt skills` in CLI text
- `GEMINI.md` → `LLXPRT.md` references

Additional lint fix `1e6c23f84` — type assertion cascading from upstream's type widening in tool-names.ts.

Quick verify: lint PASS, typecheck PASS.

## PICK-B4 (Batch 4 — FULL VERIFY)

**Result: 4/4 committed**

- `bdb349e7` (as `bfc4670ac`) — Skills extension support + security disclosure. HEAVY conflict:
  - `extension-manager.ts` was deleted (LLxprt split into separate modules under extensions/)
  - `consent.ts` completely rewritten: merged LLxprt's hook consent functions (requestConsentNonInteractive, requestConsentInteractive, maybeRequestConsentOrFail) with upstream's new general consent + SKILLS_WARNING_MESSAGE
  - `consent.test.ts` rewritten to merge both test suites
  
- `d3563e2f` (as `464c9db2c`) — Skills CLI management command (/skills list/enable/disable). Config import conflict + settings.ts conflict (kept LEGACY_UI_KEYS, dropped MIGRATION_MAP which isn't wired in).

- `2cb33b2f` (as `a04ab3e11`) — Skills /reload command. 6-file conflict:
  - `config.ts` (cli): kept LLxprt hooks handling + added onReload callback for skills refresh
  - `AppContainer.tsx`: added settingsNonce state + settings changed event handler, kept LLxprt's UIState structure (much more detailed than upstream), dropped upstream's useMemo UIState
  - `UIStateContext.tsx`: kept LLxprt's detailed UIState type, added settingsNonce field
  - `config.test.ts` (core): added ACTIVATE_SKILL_TOOL_NAME + SkillDefinition imports, added stripThoughtsFromHistory mock
  - `events.ts`: kept LLxprt's method overload approach, added SettingsChanged on/off overloads
  - `skillsCommand.test.ts`: fixed import branding

- `0c541362` (as `3dcc9871e`) — Skills directory in WorkspaceContext. Applied cleanly.

Fix commit `65621d379`:
- Created `packages/core/src/utils/debugLogger.ts` compat shim wrapping LLxprt's DebugLogger class — upstream Skills code imports a singleton `debugLogger` from `utils/debugLogger` which doesn't exist in LLxprt
- Added on/off overloads for CoreEvent.SettingsChanged
- Format fixes

Full verify: lint PASS, typecheck PASS, test 181 failures (down from 183 — 2 files fixed by debugLogger shim) — all remaining failures are PRE-EXISTING ajv-formats/ProviderRuntimeContext issues confirmed on main.

<!-- Append batch notes below this line -->
