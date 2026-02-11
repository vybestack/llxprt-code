# Batch Execution Plan: sync to gemini-cli v0.17.1

**Branch:** `gmerge/0.17.1`
**Upstream Range:** `v0.16.0..v0.17.1`
**Created:** 2026-02-09

---

## START HERE (If you were told to "DO this plan")

If you're reading this because someone said "DO @project-plans/gmerge-0.17.1/PLAN.md", follow these steps:

### Step 1: Check current state
```bash
git branch --show-current  # Should be gmerge/0.17.1
git status                 # Check for uncommitted changes
```

### Step 2: Check or create the todo list
Call `todo_read()` first. If empty or doesn't exist, call `todo_write()` with the EXACT todo list from the "Todo List Management" section below.

### Step 3: Find where to resume
- Look at the todo list for the first `pending` item
- If an item is `in_progress`, restart that item
- If all items are `completed`, you're done

### Step 4: Execute using subagents
For each batch, you MUST use the `task` tool to invoke subagents:

- **For execution tasks (BN-exec):** Call `task` with `subagent_name: "cherrypicker"` using the prompt from that batch's section
- **For review tasks (BN-review):** Call `task` with `subagent_name: "reviewer"` using the prompt from that batch's section
- **For remediation (if review fails):** Call `task` with `subagent_name: "cherrypicker"` with the remediation prompt

- **DO NOT** do the cherry-picks yourself - use the cherrypicker subagent
- **DO NOT** do the reviews yourself - use the reviewer subagent
- **DO NOT** stop to ask questions or report progress
- **DO NOT** skip review steps
- Continue until todo list is empty or you hit a blocker

### Step 5: If blocked
- Call `todo_pause()` with the specific reason
- Wait for human intervention

---

## Non-Negotiables

See `dev-docs/cherrypicking.md` for full details. Key rules:
- **Multi-provider architecture**: Preserve `USE_PROVIDER`, `@vybestack/llxprt-code-core` imports
- **Privacy**: No ClearcutLogger, no Google telemetry
- **Tool naming**: LLxprt canonical names (`list_directory`, `search_file_content`, `replace`, `todo_write`, `google_web_search`, `google_web_fetch`, `direct_web_fetch`)
- **No emoji**: LLxprt is emoji-free
- **No model routing / flash fallback / next-speaker**: Permanently disabled/removed

## Branding Substitutions

| Upstream | LLxprt |
|----------|--------|
| `@google/gemini-cli-core` | `@vybestack/llxprt-code-core` |
| `@google/gemini-cli` | `@vybestack/llxprt-code` |
| `gemini-extension.json` | `llxprt-extension.json` (with fallback) |
| `AuthType.USE_GEMINI` | `AuthType.USE_PROVIDER` |
| `gemini-cli` (display name) | `llxprt` |
| `.gemini/` (config dir) | `.llxprt/` |

## File Existence Pre-Check

Files referenced by reimplement plans that may not exist in LLxprt:

| File | Expected State |
|------|---------------|
| `packages/core/src/utils/retry.ts` | EXISTS — ModelNotFoundError will be added here (Batch 4) |
| `packages/core/src/utils/editor.ts` | EXISTS |
| `packages/core/src/ide/detect-ide.ts` | EXISTS |
| `packages/core/src/config/models.ts` | EXISTS |
| `packages/core/src/config/config.ts` | EXISTS |
| `packages/core/src/utils/googleQuotaErrors.ts` | EXISTS |
| `packages/cli/src/config/settingsSchema.ts` | EXISTS |
| `packages/cli/src/commands/extensions/uninstall.ts` | EXISTS |
| `packages/cli/src/commands/extensions/disable.test.ts` | Does NOT exist — will be created (Batch 9) |
| `packages/cli/src/commands/extensions/enable.test.ts` | Does NOT exist — will be created (Batch 9) |
| `packages/cli/src/commands/extensions/link.test.ts` | Does NOT exist — will be created (Batch 9) |
| `packages/cli/src/commands/extensions/list.test.ts` | Does NOT exist — will be created (Batch 9) |

---

## Subagent Orchestration

Each batch uses a **three-phase pattern** with mandatory review:

1. **Execute** (`cherrypicker` subagent) — Cherry-pick or reimplement
2. **Review** (`reviewer` subagent) — Mandatory verification — MUST PASS
3. **Remediate** (`cherrypicker` subagent) — Fix issues if review fails

### Review-Remediate Loop (MANDATORY)

```
LOOP (max 5 iterations):
  reviewer -> PASS? -> Continue to next batch
           -> FAIL? -> cherrypicker (remediate) -> back to reviewer
```

### Review Requirements

Every reviewer prompt MUST verify BOTH:

**Mechanical verification:**
- `npm run lint` passes
- `npm run typecheck` passes
- `npm run test` passes (for full verify batches: 2, 4, 6, 8, FINAL)
- `npm run build` passes (for full verify batches)
- Branding check: no `@google/gemini-cli`, no `USE_GEMINI`, no emoji

**Qualitative verification:**
For EACH commit/change in the batch:
- **Code actually landed** — not stubbed, not faked
- **Behavioral equivalence** — does what was intended
- **Integration correctness** — properly connected, would work at runtime

---

## Todo List Management (CRITICAL)

Before starting execution, the coordinator MUST call `todo_write` with this EXACT todo list:

```json
{
  "todos": [
    { "id": "B1-exec", "content": "Batch 1 EXECUTE: cherry-pick 555e25e63 d683e1c0d 472e775a1 9786c4dcf 78a28bfc0 — model msg formatting, trust exit fix, /permissions modify, folder trust /add, NO_COLOR scrollbar", "status": "pending" },
    { "id": "B1-review", "content": "Batch 1 REVIEW: verify 5 commits landed, lint, typecheck, qualitative check", "status": "pending" },
    { "id": "B1-commit", "content": "Batch 1 COMMIT: git add -A && git commit if needed", "status": "pending" },

    { "id": "B2-exec", "content": "Batch 2 EXECUTE: cherry-pick 8c78fe4f1 — MCP rework (solo, expect conflicts, preserve DebugLogger)", "status": "pending" },
    { "id": "B2-review", "content": "Batch 2 REVIEW (FULL): verify MCP rework landed, lint, typecheck, test, build, branding check", "status": "pending" },
    { "id": "B2-commit", "content": "Batch 2 COMMIT: git add -A && git commit", "status": "pending" },

    { "id": "B3-exec", "content": "Batch 3 EXECUTE: cherry-pick cc0eadffe — setupGithubCommand patch", "status": "pending" },
    { "id": "B3-review", "content": "Batch 3 REVIEW: verify commit landed, lint, typecheck", "status": "pending" },
    { "id": "B3-commit", "content": "Batch 3 COMMIT: git add -A && git commit if needed", "status": "pending" },

    { "id": "B4-exec", "content": "Batch 4 EXECUTE REIMPLEMENT: Gemini 3 extracts (86828bb56) — see REVISED 86828bb56-plan.md. Add ModelNotFoundError to retry.ts, add Antigravity to editor.ts + detect-ide.ts, add model helpers to models.ts, add previewFeatures to settingsSchema + config, update googleQuotaErrors 404 classification. TDD: tests first.", "status": "pending" },
    { "id": "B4-review", "content": "Batch 4 REVIEW (FULL): verify all 7 extractions landed correctly, lint, typecheck, test, build, no routing/fallback/banner code leaked in", "status": "pending" },
    { "id": "B4-commit", "content": "Batch 4 COMMIT: git add -A && git commit -m 'reimplement: Gemini 3 useful extracts (upstream 86828bb5)'", "status": "pending" },

    { "id": "B5-exec", "content": "Batch 5 EXECUTE REIMPLEMENT: multi-extension uninstall (7d33baabe) — see 7d33baabe-plan.md. Change uninstall to accept names.. array, add loop + error collection, update tests", "status": "pending" },
    { "id": "B5-review", "content": "Batch 5 REVIEW: verify uninstall accepts multiple names, lint, typecheck, qualitative check", "status": "pending" },
    { "id": "B5-commit", "content": "Batch 5 COMMIT: git add -A && git commit -m 'reimplement: uninstall multiple extensions (upstream 7d33baab)'", "status": "pending" },

    { "id": "B6-exec", "content": "Batch 6 EXECUTE REIMPLEMENT: terminal mode cleanup (ba88707b1) — see ba88707b1-plan.md. Add mouse mocks to gemini.test.tsx, add comprehensive exit cleanup in gemini.tsx for bracketed paste / focus / cursor", "status": "pending" },
    { "id": "B6-review", "content": "Batch 6 REVIEW (FULL): verify test mocks added, exit cleanup covers all modes, lint, typecheck, test, build", "status": "pending" },
    { "id": "B6-commit", "content": "Batch 6 COMMIT: git add -A && git commit -m 'reimplement: comprehensive terminal mode cleanup on exit (upstream ba88707b)'", "status": "pending" },

    { "id": "B7-exec", "content": "Batch 7 EXECUTE REIMPLEMENT: right-click paste in alt buffer (8877c8527) — see 8877c8527-plan.md. Add clipboardy dep, rename PASTE_CLIPBOARD_IMAGE, add getOffset to text-buffer, add mouse handler to InputPrompt, add clipboardy text paste", "status": "pending" },
    { "id": "B7-review", "content": "Batch 7 REVIEW: verify right-click paste implementation, lint, typecheck, qualitative check", "status": "pending" },
    { "id": "B7-commit", "content": "Batch 7 COMMIT: git add -A && git commit -m 'reimplement: right-click paste in alternate buffer mode (upstream 8877c852)'", "status": "pending" },

    { "id": "B8-exec", "content": "Batch 8 EXECUTE REIMPLEMENT: show profile name on change (ab11b2c27) — see REVISED ab11b2c27-plan.md. Add HistoryItemProfile type (in ui/types.ts), profile change detection in useGeminiStream (pass activeProfileName as arg), render in HistoryItemDisplay, add showProfileChangeInChat setting. TDD: tests first. No ProfileChanged event needed.", "status": "pending" },
    { "id": "B8-review", "content": "Batch 8 REVIEW (FULL): verify profile change shows in history, setting works, lint, typecheck, test, build", "status": "pending" },
    { "id": "B8-commit", "content": "Batch 8 COMMIT: git add -A && git commit -m 'reimplement: show profile name on change in chat history (upstream ab11b2c2)'", "status": "pending" },

    { "id": "B9-exec", "content": "Batch 9 EXECUTE REIMPLEMENT: extension tests + test refactoring (638dd2f6c + LLxprt-originated) — see 638dd2f6c-plan.md. Create disable.test.ts, enable.test.ts, link.test.ts, list.test.ts. Expand uninstall.test.ts. Refactor existing tests to use it.each where appropriate", "status": "pending" },
    { "id": "B9-review", "content": "Batch 9 REVIEW: verify all new tests pass, existing tests not broken, lint, typecheck, test", "status": "pending" },
    { "id": "B9-commit", "content": "Batch 9 COMMIT: git add -A && git commit -m 'reimplement: extension command tests + it.each refactoring (upstream 638dd2f6)'", "status": "pending" },

    { "id": "FINAL-verify", "content": "FINAL VERIFY: npm run lint && npm run typecheck && npm run test && npm run format && npm run build && node scripts/start.js --profile-load synthetic --prompt 'write me a haiku'", "status": "pending" },
    { "id": "FINAL-progress", "content": "UPDATE PROGRESS.md with all commit hashes", "status": "pending" },
    { "id": "FINAL-notes", "content": "UPDATE NOTES.md with any conflicts/deviations", "status": "pending" },
    { "id": "FINAL-audit", "content": "UPDATE AUDIT.md with all outcomes and LLxprt commit hashes", "status": "pending" }
  ]
}
```

---

## Batch Schedule

### Batch 1 — PICK (5 commits)

**Type:** PICK
**Upstream SHAs:** `555e25e63`, `d683e1c0d`, `472e775a1`, `9786c4dcf`, `78a28bfc0`
**Verification:** Quick (lint + typecheck)

**Command:**
```bash
git cherry-pick 555e25e63 d683e1c0d 472e775a1 9786c4dcf 78a28bfc0
```

**Commits in order:**
1. `555e25e63` — slightly adjust model message formatting
2. `d683e1c0d` — fix: exit CLI when trust save unsuccessful during launch
3. `472e775a1` — feat: /permissions modify trust for other dirs
4. `9786c4dcf` — check folder trust before allowing /add directory
5. `78a28bfc0` — fix: animated scrollbar renders black in NO_COLOR mode

**Conflict notes:**
- `555e25e63` references `ModelMessage.tsx` — if this file doesn't exist in LLxprt, skip with `git cherry-pick --skip` (reimplemented differently in Batch 8). If it DOES exist, check if the formatting change is a LLxprt-equivalent rendering path and only apply if semantically applicable.
- `d683e1c0d`, `472e775a1`, `9786c4dcf` share trust infrastructure — pick in order. If one partially applies, verify shared helpers/types from earlier commits before continuing.
- `472e775a1` touches directoryCommand and slashCommandProcessor — may have LLxprt divergence in command routing/response text style.
- `78a28bfc0` may conflict on ThemedGradient.tsx — keep LLxprt's version of that file. Apply ONLY the NO_COLOR-safe animation/color logic in `color-utils.ts` and `useAnimatedScrollbar.ts`.

**Trust commit invariants (preserve these):**
- Trust path normalization rules (how paths are resolved/stored)
- Failure mode: hard exit with error message on save failure
- /permissions mutation: allowed target directories, command response style
- /add trust gate: exact decision path (check trust → deny if untrusted → allow if trusted)

**Cherrypicker prompt:**
```
Cherry-pick these 5 commits in order onto the gmerge/0.17.1 branch:
git cherry-pick 555e25e63 d683e1c0d 472e775a1 9786c4dcf 78a28bfc0

HANDLING 555e25e63 (model message formatting):
First check: does packages/cli/src/ui/components/ModelMessage.tsx exist?
- If NO: skip with `git cherry-pick --skip` — reimplemented differently in Batch 8.
- If YES: apply and verify the formatting change makes sense for LLxprt's rendering.

TRUST COMMITS (d683e1c0d, 472e775a1, 9786c4dcf):
These share trust infrastructure. Apply in order. After each, verify:
- Trust path normalization unchanged
- Exit-on-save-failure preserved (d683e1c0d)
- /permissions accepts dir args, preserves response style (472e775a1)
- /add checks trust before allowing directory addition (9786c4dcf)
Preserve all @vybestack imports, USE_PROVIDER auth, LLxprt command routing.

NO_COLOR FIX (78a28bfc0):
If ThemedGradient.tsx conflicts, keep LLxprt's version.
Apply ONLY: null/empty-string guards in color-utils.ts interpolateColor(),
and NO_COLOR-safe logic in useAnimatedScrollbar.ts.
Do NOT overwrite LLxprt's theming abstractions.

After all picks: npm run lint && npm run typecheck
Fix any issues and stage changes.
```

**Reviewer prompt:**
```
Review Batch 1 of gmerge/0.17.1 cherry-picks. Check git log for the latest commits.

MECHANICAL:
- Run: npm run lint && npm run typecheck
- Verify no @google/gemini-cli imports, no USE_GEMINI, no emoji

QUALITATIVE - verify EACH commit landed:
1. 555e25e63 - ModelMessage formatting: LANDED (verify formatting change) OR SKIPPED (verify ModelMessage.tsx doesn't exist and skip was correct)
2. d683e1c0d - Exit on trust save fail:
   - Verify process exits when trust save fails during launch
   - Verify error message is displayed
   - Verify trust path normalization unchanged
3. 472e775a1 - /permissions modify trust:
   - Verify command accepts directory arguments
   - Verify mutation targets are correct
   - Verify response text style matches LLxprt conventions
4. 9786c4dcf - Folder trust /add:
   - Verify trust check occurs BEFORE add directory action
   - Verify untrusted dirs are denied, trusted dirs are allowed
5. 78a28bfc0 - NO_COLOR scrollbar:
   - Verify null/empty-string guards in color-utils.ts interpolateColor
   - Verify useAnimatedScrollbar.ts handles NO_COLOR
   - Verify LLxprt's ThemedGradient.tsx is UNCHANGED (if it exists)

BEHAVIORAL SPOT-CHECK:
- Trust save failure path → process exits correctly
- /permissions modify trust for non-CWD dir works
- /add directory denied when untrusted, allowed when trusted
- NO_COLOR mode: scrollbar doesn't render as black

Output per-commit: LANDED/SKIPPED/FAILED with explanation.
```

**Commit message:** `cherry-pick: upstream v0.16.0..v0.17.1 batch 1`

---

### Batch 2 — PICK WITH CONFLICTS (1 commit, solo)

**Type:** PICK WITH CONFLICTS
**Upstream SHA:** `8c78fe4f1`
**Verification:** Full (lint + typecheck + test + build + smoke)

**Command:**
```bash
git cherry-pick 8c78fe4f1
```

**This is a high-risk pick** — MCP rework. Solo batch because:
- Replaces `mcpToTool()` with direct MCP SDK calls
- Restructures tool discovery
- Adds `McpCallableTool` class
- LLxprt has additional DebugLogger calls that must be preserved

**Cherrypicker prompt:**
```
Cherry-pick 8c78fe4f1 (MCP rework) onto gmerge/0.17.1.

git cherry-pick 8c78fe4f1

This commit reworks MCP tool discovery and invocation in TWO files:
1. packages/core/src/tools/mcp-client.ts
2. packages/core/src/tools/mcp-client.test.ts

Resolve conflicts in BOTH files.

CRITICAL — DebugLogger Preservation Checklist:
LLxprt has DebugLogger calls in mcp-client.ts that upstream doesn't have.
After conflict resolution, verify ALL these debug log points are preserved:
- discovery start log
- per-tool creation / mcpCallableTool log
- tool response log
- missing function declarations log
- per-tool processing / disabled tool log
- discovered tool count / return log
These MUST be integrated into the new McpCallableTool class and discoverTools flow.

Key structural changes:
- REMOVE import of mcpToTool from @google/genai
- ADD McpCallableTool class
- CHANGE discoverTools to use mcpClient.listTools() directly (not mcpToTool)
- CHANGE discoverPrompts to use mcpClient.listPrompts()
- CHANGE invokeMcpPrompt to use mcpClient.getPrompt()
- ADD $defs/$ref JSON schema handling (nested refs and defs resolution)
- FunctionDeclaration typing source changes (from @google/genai to direct)

After pick, run FULL verification:
npm run lint && npm run typecheck && npm run test && npm run build

Fix any branding (@google/ -> @vybestack/).

POST-MERGE VERIFICATION:
Run: search_file_content for 'mcpToTool(' — must return ZERO matches in mcp-client.ts
Run: search_file_content for 'DebugLogger' in mcp-client.ts — must find existing debug points
```

**Reviewer prompt:**
```
Review Batch 2 of gmerge/0.17.1: MCP rework cherry-pick (8c78fe4f1).

MECHANICAL:
- Run: npm run lint && npm run typecheck && npm run test && npm run build
- Run: node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
- Verify no @google/gemini-cli imports

QUALITATIVE:
1. Read packages/core/src/tools/mcp-client.ts IN FULL
2. Verify McpCallableTool class exists and is properly structured
3. REMOVAL CHECK: Verify mcpToTool() import is REMOVED
   - search_file_content for 'mcpToTool(' in packages/core — must be ZERO
4. REMOVAL CHECK: Verify no residual @google/genai FunctionDeclaration imports
5. DEBUGLOGGER CHECK: search_file_content for 'debug.log\|DebugLogger' in mcp-client.ts
   - Verify ALL LLxprt debug log points are preserved (discovery, per-tool, response, disabled, count)
6. Verify discoverTools uses mcpClient.listTools()
7. Verify $defs/$ref handling — look for concrete schema normalization logic
8. Verify error handling returns proper functionResponse format
9. Read mcp-client.test.ts IN FULL — verify tests cover new McpCallableTool API
10. Verify call-site compatibility: McpCallableTool works with DiscoveredMCPTool interface
11. Verify prompt path uses listPrompts()/getPrompt()

Output: PASS/FAIL with specific findings per check.
```

**Commit message:** `cherry-pick: MCP rework (upstream 8c78fe4f)`

---

### Batch 3 — PICK (1 commit)

**Type:** PICK
**Upstream SHA:** `cc0eadffe`
**Verification:** Quick (lint + typecheck)

**Command:**
```bash
git cherry-pick cc0eadffe
```

**IMPORTANT NOTE:** LLxprt's setupGithubCommand may be intentionally disabled/stubbed. This cherry-pick must NOT re-enable functionality that LLxprt has disabled.

**Cherrypicker prompt:**
```
Cherry-pick cc0eadffe (setupGithubCommand patch) onto gmerge/0.17.1.

git cherry-pick cc0eadffe

PRECONDITIONS — check before applying:
1. Read packages/cli/src/ui/commands/setupGithubCommand.ts (or wherever it lives)
2. Check if the command is currently DISABLED/STUBBED in LLxprt
3. If disabled: only port bugfixes that apply to shared helper logic. Do NOT re-enable the command.
4. If active: apply normally.

Do NOT introduce upstream Google/Gemini GitHub action URLs (google-github-actions/run-gemini-cli) into active runtime paths.

After pick: npm run lint && npm run typecheck
If the pick causes conflicts with LLxprt's disabled state, prefer keeping LLxprt's current behavior.
```

**Reviewer prompt:**
```
Review Batch 3: setupGithubCommand patch (cc0eadffe).

MECHANICAL: npm run lint && npm run typecheck

QUALITATIVE:
1. Check packages/cli/src/ui/commands/setupGithubCommand.ts current state
2. Verify the command was NOT re-enabled if it was previously disabled in LLxprt
3. Verify no new active network download flow was wired into command execution
4. Verify no google-github-actions upstream URL assumptions in active runtime paths
5. Verify tests reflect LLxprt's current state (disabled or active)
6. Check imports use @vybestack

Output: PASS/FAIL with specific findings.
```

**Commit message:** `cherry-pick: setupGithubCommand patch (upstream cc0eadff)`

---

### Batch 4 — REIMPLEMENT: Gemini 3 Extracts (solo)

**Type:** REIMPLEMENT
**Upstream SHA:** `86828bb56`
**Plan:** `project-plans/gmerge-0.17.1/86828bb56-plan.md`
**Verification:** Full (lint + typecheck + test + build)

**Cherrypicker prompt:**
```
REIMPLEMENT selective extracts from upstream 86828bb5 (Gemini 3 launch).

Read the REVISED plan at project-plans/gmerge-0.17.1/86828bb56-plan.md — it has been updated with TDD ordering and resolved duplication issues.

FOLLOW THE PLAN'S TDD ORDERING: Write tests FIRST (RED), then implement (GREEN), then refactor.

Key changes from original plan:
- NO separate httpErrors.ts file. ModelNotFoundError goes into retry.ts (where getErrorStatus already lives)
- Each extraction follows RED→GREEN→REFACTOR
- config.ts uses constructor param + private readonly field pattern (like folderTrust/extensionManagement)
- Schema regen required after settingsSchema changes
- Check barrel exports in packages/core/src/index.ts

DO NOT add: routing, fallback, banner, ProQuotaDialog, experiments, persistentState, quota tiers, Gemini 3 docs, client.ts changes, geminiChat.ts changes, any UI components.

Use @vybestack/llxprt-code-core for all imports.

After changes: npm run lint && npm run typecheck && npm run test && npm run build
Then: npm run build --workspace @vybestack/llxprt-code-core (schema regen)
```

**Reviewer prompt:**
```
Review Batch 4 of gmerge/0.17.1: Gemini 3 selective extracts (86828bb5).

Read the REVISED plan: project-plans/gmerge-0.17.1/86828bb56-plan.md

MECHANICAL:
- npm run lint && npm run typecheck && npm run test && npm run build
- node scripts/start.js --profile-load synthetic --prompt "write me a haiku"

QUALITATIVE — verify each extraction:
1. retry.ts: ModelNotFoundError class added HERE (not in separate httpErrors.ts). getErrorStatus unchanged.
2. editor.ts: 'antigravity' in EditorType + ALL 6 touchpoints (isValidEditorType, editorCommands, allowEditorTypeInSandbox, getDiffCommand, openDiff, EDITOR_DISPLAY_NAMES)
3. detect-ide.ts: antigravity IDE definition, isCloudShell() helper, barrel export updated if needed
4. models.ts: resolveModel() function, isGemini2Model(), alias constants, PREVIEW_GEMINI_MODEL
5. settingsSchema.ts: previewFeatures boolean under general + settings.schema.json regenerated
6. config.ts: previewFeatures as constructor param + private readonly field (matching folderTrust pattern), ConfigParameters updated, getter method (no setter if restart-required)
7. googleQuotaErrors.ts: 404 classified as ModelNotFoundError, imported from retry.ts

TDD CHECK — verify tests were written:
- Tests exist for each extraction (editor, detect-ide, models, config, googleQuotaErrors)
- Tests cover the new behavior specifically

NEGATIVE CHECK — verify NONE of these leaked in:
- No modelRouterService imports/references
- No fallbackStrategy imports/references
- No Banner, ProQuotaDialog, persistentState
- No experiments/flagNames
- No ClearcutLogger
- No emoji
- No duplicate getErrorStatus (only in retry.ts)

Output: per-extraction PASS/FAIL + negative check result.
```

**Commit message:** `reimplement: Gemini 3 useful extracts (upstream 86828bb5)`

---

### Batch 5 — REIMPLEMENT: Multi-Extension Uninstall (solo)

**Type:** REIMPLEMENT
**Upstream SHA:** `7d33baabe`
**Plan:** `project-plans/gmerge-0.17.1/7d33baabe-plan.md`
**Verification:** Quick (lint + typecheck)

**Cherrypicker prompt:**
```
REIMPLEMENT multi-extension uninstall from upstream 7d33baab.

Read the plan: project-plans/gmerge-0.17.1/7d33baabe-plan.md

Modify packages/cli/src/commands/extensions/uninstall.ts:
1. Change interface from { name: string } to { names: string[] }
2. Rewrite handleUninstall() with loop + error collection over standalone uninstallExtension()
3. Update command from 'uninstall <name>' to 'uninstall <names..>'
4. Deduplicate names with [...new Set(args.names)]
5. Continue after partial failures, log errors, exit(1) if any failed

Update packages/cli/src/commands/extensions/uninstall.test.ts:
- Test single uninstall, multiple uninstall, deduplication, partial failure, all-pass

After changes: npm run lint && npm run typecheck
Run tests: npm run test -- --filter uninstall
```

**Reviewer prompt:**
```
Review Batch 5: multi-extension uninstall (7d33baab).

MECHANICAL: npm run lint && npm run typecheck
QUALITATIVE:
1. uninstall.ts: accepts names.. array, loops with error collection, deduplicates
2. Backward compatible: single name still works
3. Tests cover: single, multiple, dedup, partial failure, all-pass
4. Uses standalone uninstallExtension() (NOT ExtensionManager class)
Output: PASS/FAIL.
```

**Commit message:** `reimplement: uninstall multiple extensions (upstream 7d33baab)`

---

### Batch 6 — REIMPLEMENT: Terminal Mode Cleanup (solo)

**Type:** REIMPLEMENT
**Upstream SHA:** `ba88707b1`
**Plan:** `project-plans/gmerge-0.17.1/ba88707b1-plan.md`
**Verification:** Full (lint + typecheck + test + build)

**Cherrypicker prompt:**
```
REIMPLEMENT terminal mode cleanup from upstream ba88707b, with broader scope.

Read the plan: project-plans/gmerge-0.17.1/ba88707b1-plan.md

Phase 1 — Test mocks:
Add vi.mock for mouse utilities in packages/cli/src/gemini.test.tsx (near other mocks):
vi.mock('./ui/utils/mouse.js', () => ({
  enableMouseEvents: vi.fn(),
  disableMouseEvents: vi.fn(),
  parseMouseEvent: vi.fn(),
  isIncompleteMouseSequence: vi.fn(),
}));

Phase 2 — Production exit cleanup:
Modify packages/cli/src/gemini.tsx to add comprehensive terminal mode restoration.
Use registerCleanup() to disable ALL modes on exit:
- Mouse tracking (check if disableMouseEvents already handles this)
- Bracketed paste (\x1b[?2004l)
- Focus reporting (\x1b[?1004l)
- Show cursor (\x1b[?25h)

Check what disableMouseEvents() already does to avoid duplication.
Check that cleanup.ts runExitCleanup() is called on SIGINT/SIGTERM.

After changes: npm run lint && npm run typecheck && npm run test && npm run build
```

**Reviewer prompt:**
```
Review Batch 6: terminal mode cleanup (ba88707b).

MECHANICAL:
- npm run lint && npm run typecheck && npm run test && npm run build
- node scripts/start.js --profile-load synthetic --prompt "write me a haiku"

QUALITATIVE:
1. gemini.test.tsx: vi.mock for mouse.js exists near top of file
2. gemini.tsx: registerCleanup covers bracketed paste, focus reporting, cursor visibility
3. No duplication: if disableMouseEvents already writes mouse sequences, don't repeat them
4. Cleanup runs on all exit paths (normal, SIGINT, SIGTERM)
5. No regression: test suite passes cleanly
Output: PASS/FAIL.
```

**Commit message:** `reimplement: comprehensive terminal mode cleanup on exit (upstream ba88707b)`

---

### Batch 7 — REIMPLEMENT: Right-Click Paste (solo)

**Type:** REIMPLEMENT
**Upstream SHA:** `8877c8527`
**Plan:** `project-plans/gmerge-0.17.1/8877c8527-plan.md`
**Verification:** Quick (lint + typecheck)

**Cherrypicker prompt:**
```
REIMPLEMENT right-click paste in alternate buffer from upstream 8877c852.

Read the plan: project-plans/gmerge-0.17.1/8877c8527-plan.md

Steps:
1. Add clipboardy to packages/cli/package.json dependencies, run npm install
2. Rename PASTE_CLIPBOARD_IMAGE to PASTE_CLIPBOARD in keyBindings.ts
3. Add getOffset() method to text-buffer.ts (wrapper around logicalPosToOffset)
4. In InputPrompt.tsx:
   - Import useMouse and MouseEvent from MouseContext
   - Import clipboardy
   - Refactor handleClipboardImage -> handleClipboardPaste (try image first, then text via clipboardy.read())
   - Add mouse handler for right-release event
   - Wire up useMouse hook (active when focused and not in embedded shell)
5. Simplify commandUtils.ts to use clipboardy.write() if appropriate
6. Update tests: keyMatchers.test.ts command name, InputPrompt.test.tsx right-click test

After changes: npm run lint && npm run typecheck
```

**Reviewer prompt:**
```
Review Batch 7: right-click paste (8877c852).

MECHANICAL: npm run lint && npm run typecheck
QUALITATIVE:
1. clipboardy in package.json dependencies
2. PASTE_CLIPBOARD_IMAGE renamed to PASTE_CLIPBOARD in keyBindings.ts
3. text-buffer.ts has getOffset() method
4. InputPrompt.tsx: imports useMouse, has mouse handler for right-release, calls handleClipboardPaste
5. Paste handler: tries image first, falls back to text via clipboardy
6. Tests updated for new command name
Output: PASS/FAIL.
```

**Commit message:** `reimplement: right-click paste in alternate buffer mode (upstream 8877c852)`

---

### Batch 8 — REIMPLEMENT: Show Profile Name on Change (solo)

**Type:** REIMPLEMENT
**Upstream SHA:** `ab11b2c27`
**Plan:** `project-plans/gmerge-0.17.1/ab11b2c27-plan.md`
**Verification:** Full (lint + typecheck + test + build)

**Cherrypicker prompt:**
```
REIMPLEMENT "show profile name on change" from upstream ab11b2c2 (which shows model via router).

Read the REVISED plan at project-plans/gmerge-0.17.1/ab11b2c27-plan.md — it has been updated with TDD ordering, correct file targets, and all guards.

FOLLOW THE PLAN'S TDD ORDERING: Write tests FIRST (RED), then implement (GREEN).

Key design decisions:
- Show activeProfileName (NOT model name) — model already in Footer
- HistoryItemProfile type goes in ui/types.ts (wherever HistoryItem union is defined), NOT UIStateContext.tsx
- NO ProfileChanged event in events.ts — direct insertion in useGeminiStream is sufficient
- activeProfileName must be passed as arg to useGeminiStream (not currently passed)
- lastProfileNameRef starts undefined; first turn initializes WITHOUT emitting
- Guard: only insert when activeProfileName is non-null and non-empty
- Rendering: follow existing HistoryItemDisplay color conventions (dimColor, not SemanticColors)
- Setting: showProfileChangeInChat in settingsSchema + runtime read

After changes: npm run lint && npm run typecheck && npm run test && npm run build
```

**Reviewer prompt:**
```
Review Batch 8: show profile name on change (ab11b2c2).

MECHANICAL:
- npm run lint && npm run typecheck && npm run test && npm run build
- node scripts/start.js --profile-load synthetic --prompt "write me a haiku"

QUALITATIVE:
1. NO ProfileChanged event in events.ts (not needed)
2. HistoryItemProfile type in ui/types.ts (NOT UIStateContext.tsx)
3. HistoryItemDisplay renders profile change message using existing color conventions
4. Profile tracking in useGeminiStream:
   - activeProfileName passed as arg (verify it's plumbed from container)
   - lastProfileNameRef initialized correctly
   - First turn: initializes WITHOUT emitting history item (spurious guard)
   - Subsequent turns: only inserts on CHANGE
   - null/empty guard: no "switched to profile: null" messages
5. showProfileChangeInChat setting exists, has runtime read, gates the feature
6. Shows PROFILE name, NOT model name
7. Footer still independently shows model name

TDD CHECK: Tests exist for all 5 cases (change inserts, first turn no-insert, unchanged no-insert, disabled no-insert, null no-insert)
Output: PASS/FAIL.
```

**Reviewer prompt:**
```
Review Batch 8: show profile name on change (ab11b2c2).

MECHANICAL:
- npm run lint && npm run typecheck && npm run test && npm run build
- node scripts/start.js --profile-load synthetic --prompt "write me a haiku"

QUALITATIVE:
1. ProfileChanged event exists in events.ts
2. HistoryItemProfile type exists in UIStateContext.tsx
3. HistoryItemDisplay renders profile change message in subtle style
4. Profile tracking in stream handler: only inserts on CHANGE (not every turn)
5. showProfileChangeInChat setting exists and gates the feature
6. This shows PROFILE name, NOT model name
7. Footer still independently shows model name
Output: PASS/FAIL.
```

**Commit message:** `reimplement: show profile name on change in chat history (upstream ab11b2c2)`

---

### Batch 9 — REIMPLEMENT: Extension Tests + Test Refactoring (solo)

**Type:** REIMPLEMENT
**Upstream SHA:** `638dd2f6c` + LLxprt-originated
**Plan:** `project-plans/gmerge-0.17.1/638dd2f6c-plan.md`
**Verification:** Quick (lint + typecheck + test)

**Cherrypicker prompt:**
```
REIMPLEMENT extension command handler tests from upstream 638dd2f6c, adapted for LLxprt's standalone function architecture, plus it.each test refactoring.

Read the plan: project-plans/gmerge-0.17.1/638dd2f6c-plan.md

CREATE these new test files:
1. packages/cli/src/commands/extensions/disable.test.ts — test handleDisable() with it.each for scope variations
2. packages/cli/src/commands/extensions/enable.test.ts — test handleEnable() with it.each for scope variations
3. packages/cli/src/commands/extensions/link.test.ts — test handleLink() with success/failure paths
4. packages/cli/src/commands/extensions/list.test.ts — test handleList() with empty/populated lists

EXPAND:
5. packages/cli/src/commands/extensions/uninstall.test.ts — add error cases, multiple extension scenarios

REFACTOR (if time permits):
6. install.test.ts — convert repetitive cases to it.each
7. validate.test.ts — convert validation cases to it.each

All tests must mock standalone functions from ../../config/extension.js (NOT ExtensionManager class).
Use it.each for variant testing where cases differ only in input/output.

After changes: npm run lint && npm run typecheck && npm run test
```

**Reviewer prompt:**
```
Review Batch 9: extension tests + test refactoring (638dd2f6c).

MECHANICAL: npm run lint && npm run typecheck && npm run test
QUALITATIVE:
1. NEW: disable.test.ts exists and tests handleDisable() with scope variations via it.each
2. NEW: enable.test.ts exists and tests handleEnable() with scope variations via it.each
3. NEW: link.test.ts exists and tests handleLink()
4. NEW: list.test.ts exists and tests handleList()
5. EXPANDED: uninstall.test.ts has more than 21 lines, covers error cases
6. All mocks target standalone functions (disableExtension, enableExtension, etc.) NOT ExtensionManager
7. it.each used where test cases are variants
8. All existing tests still pass
Output: PASS/FAIL with count of new/modified test files.
```

**Commit message:** `reimplement: extension command tests + it.each refactoring (upstream 638dd2f6)`

---

## Failure Recovery

### How to abort/retry a cherry-pick batch

```bash
# Abort current cherry-pick if in conflict state
git cherry-pick --abort

# Reset to before the batch started (find the commit hash)
git log --oneline -5
git reset --hard <commit-before-batch>
```

### When to create a follow-up fix commit

If a batch produces lint/typecheck/test failures that require fixes:
1. Fix the issues
2. Stage all changes: `git add -A`
3. Commit with: `git commit -m "fix: post-batch N verification"`
4. Continue to next batch

### Review-Remediate Loop

If review fails:
1. Launch cherrypicker with specific issues from reviewer output
2. Re-run reviewer
3. Loop up to 5 times
4. If still failing after 5, call `todo_pause("Batch N failed review 5 times: <specific issue>")` and escalate to human

---

## Note-Taking Requirement

After each batch:
1. Update `project-plans/gmerge-0.17.1/PROGRESS.md` — set status to DONE, add LLxprt commit hash
2. Append to `project-plans/gmerge-0.17.1/NOTES.md` — batch number, conflicts, deviations, follow-ups
3. Update `project-plans/gmerge-0.17.1/AUDIT.md` — fill in LLxprt commit hashes for PICKED/REIMPLEMENTED rows

---

## Context Recovery

If you're resuming after a context wipe:

1. **Check git state:**
   ```bash
   git branch --show-current  # Should be gmerge/0.17.1
   git status
   git log --oneline -15
   ```

2. **Read the todo list:** `todo_read()`

3. **Key files for context:**
   - This file: `project-plans/gmerge-0.17.1/PLAN.md`
   - Decisions: `project-plans/gmerge-0.17.1/CHERRIES.md`
   - Progress: `project-plans/gmerge-0.17.1/PROGRESS.md`
   - Notes: `project-plans/gmerge-0.17.1/NOTES.md`
   - Individual plans: `project-plans/gmerge-0.17.1/*-plan.md`

4. **What this sync does:**
   - Branch: `gmerge/0.17.1`
   - Range: `v0.16.0..v0.17.1` (45 upstream commits)
   - 7 PICK + 7 REIMPLEMENT + 31 SKIP = 9 batches
   - Batches 1-3 are cherry-picks, Batches 4-9 are reimplementations
