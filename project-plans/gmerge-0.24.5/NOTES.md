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

<!-- Append batch notes below this line -->
