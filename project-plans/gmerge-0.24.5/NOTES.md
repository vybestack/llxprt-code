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

<!-- Append batch notes below this line -->
