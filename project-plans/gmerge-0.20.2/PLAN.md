# PLAN.md — gmerge-0.20.2 (upstream v0.19.4 → v0.20.2)

## START HERE (If you were told to "DO this plan")

If you're reading this because someone said "DO @project-plans/gmerge-0.20.2/PLAN.md", follow these steps:

### Step 1: Check current state

```bash
git branch --show-current  # Should be gmerge/0.20.2
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

- **For execution tasks (BN-exec):** Call `task` with `subagent_name: "cherrypicker"`
- **For review tasks (BN-review):** Call `task` with `subagent_name: "reviewer"`
- **For remediation (if review fails):** Call `task` with `subagent_name: "cherrypicker"`

- **DO NOT** do the cherry-picks yourself - use the cherrypicker subagent
- **DO NOT** do the reviews yourself - use the reviewer subagent
- Continue until todo list is empty or you hit a blocker

### Step 5: If blocked

- Call `todo_pause()` with the specific reason
- Wait for human intervention

---

## Non-Negotiables

See `dev-docs/cherrypicking.md` for full details:

- **Privacy**: A2A server stays private
- **Multi-provider**: Never break USE_PROVIDER architecture
- **Tool batching**: LLxprt has superior parallel batching
- **Branding**: All Google-specific imports/names must be replaced

## Branding Substitutions

| Upstream | LLxprt |
|----------|--------|
| `@google/gemini-cli-core` | `@vybestack/llxprt-code-core` |
| `@google/gemini-cli` | `@vybestack/llxprt-code` |
| `gemini-extension.json` | `llxprt-extension.json` |
| `GEMINI.md` | `LLXPRT.md` |
| `.gemini/` | `.llxprt/` |
| `GeminiCLI` | `LLxprt Code` |
| `gemini_cli` | `llxprt_code` |
| `GEMINI_CLI` | `LLXPRT_CODE` |
| `USE_GEMINI` (sole auth) | `USE_PROVIDER` (where applicable) |

## File Existence Pre-Check

Key files for PICK commits:

- `packages/cli/src/gemini.tsx` — exit codes (#1)
- `packages/cli/src/commands/extensions/link.ts` — consent flag (#2)
- `packages/core/src/mcp/google-auth-provider.ts` — MCP auth (#3)
- `packages/core/src/tools/mcp-client.ts` — MCP auth (#3)
- `LICENSE` — license revert (#4)
- `packages/core/src/telemetry/types.ts` — finish_reasons (#5)
- `packages/core/src/telemetry/loggers.ts` — finish_reasons (#5)
- `scripts/tests/generate-settings-schema.test.ts` — schema test (#6)
- `packages/core/src/hooks/hookRunner.ts` — EPIPE fix (#7)
- `packages/cli/src/ui/utils/InlineMarkdownRenderer.tsx` — markdown fix (#9)
- `packages/cli/src/ui/commands/setupGithubCommand.ts` — setup-github (#10)
- `packages/cli/src/ui/components/InputPrompt.tsx` — React state (#11)
- `integration-tests/globalSetup.ts` — cleanup (#12)
- `packages/core/src/ide/ide-client.ts` — IDE auth (#13)

Key files for REIMPLEMENT commits:

- `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-pro-preview/core.md` — gemini-3 prompts (R1)
- `packages/core/src/prompt-config/defaults/core.md` — interactive mode (R4)
- `packages/core/src/prompt-config/types.ts` — PromptEnvironment (R4)
- `packages/core/src/tools/shell.ts` — inactivity timeout (R5)
- `packages/core/src/services/shellExecutionService.ts` — inactivity timeout (R5)
- `packages/cli/src/ui/commands/types.ts` — autoExecute (R9)

Files that DO NOT exist (confirmed absent):

- `packages/core/src/mcp/auth-provider.ts` — must be CREATED for PICK #3
- `packages/core/src/telemetry/semantic.ts` — OTelFinishReason type needed for PICK #5
- `packages/core/src/core/coreToolHookTriggers.ts` — needed for R2 REIMPLEMENT
- `packages/core/src/core/geminiChatHookTriggers.ts` — needed for R6 REIMPLEMENT

---

## Subagent Orchestration

Pattern for each batch:

```
Execute (cherrypicker) -> Review (reviewer) -> PASS? continue : Remediate (cherrypicker) -> Review again
Loop remediation up to 5 times, then escalate to human if still failing.
```

---

## Batch Schedule

### Batch 1 (PICK) — Commits 1-5

Cherry-pick in order:

| # | SHA | Subject |
|---|-----|---------|
| 1 | `d97bbd53` | Update error codes when process exiting (#13728) |
| 2 | `3406dc5b` | Add consent flag to Link command (#13832) |
| 3 | `0f12d6c4` | feat(mcp): Inject GoogleCredentialProvider headers in McpClient (#13783) |
| 4 | `450734e3` | Revert to default LICENSE (#13876) |
| 5 | `6a43b312` | update(telemetry): OTel API response event with finish reasons (#13849) |

**Command:**
```bash
git cherry-pick d97bbd53 3406dc5b 0f12d6c4 450734e3 6a43b312
```

**Verification:** Quick verify (lint + typecheck)

**Commit message:** `cherry-pick: upstream v0.19.4..v0.20.2 batch 1`

**High-risk notes:**
- `0f12d6c4` creates new file `packages/core/src/mcp/auth-provider.ts`. Verify it lands.
- `6a43b312` may reference `OTelFinishReason` from `semantic.ts` which doesn't exist. Need to inline the type or create a stub.

**Cherrypicker prompt:**
```
Cherry-pick these 5 upstream commits onto the gmerge/0.20.2 branch:
d97bbd53 3406dc5b 0f12d6c4 450734e3 6a43b312

Run: git cherry-pick d97bbd53 3406dc5b 0f12d6c4 450734e3 6a43b312

CONFLICT RESOLUTION RULES:
- Replace @google/gemini-cli-core with @vybestack/llxprt-code-core
- Replace @google/gemini-cli with @vybestack/llxprt-code
- Replace GEMINI_CLI with LLXPRT_CODE
- Preserve LLxprt's multi-provider architecture
- Resolve in favor of LLxprt's existing code structure

SPECIAL NOTES:
- 0f12d6c4 creates packages/core/src/mcp/auth-provider.ts (new file). Ensure it lands.
- 6a43b312 may import from './semantic.js' which doesn't exist. If so, inline the OTelFinishReason type definition in types.ts or create a minimal semantic.ts.
- 450734e3 changes LICENSE. Accept the upstream change (revert to Apache boilerplate).

After cherry-pick completes (or after resolving conflicts):
- Run: npm run lint
- Run: npm run typecheck
- Fix any issues
- If package-lock.json conflicts: run npm install to regenerate

Do NOT commit separately - the cherry-pick creates its own commits.
```

**Reviewer prompt:**
```
Review Batch 1 of gmerge-0.20.2 cherry-picks.

MECHANICAL CHECKS:
1. Run: npm run lint && npm run typecheck
2. Verify no @google/gemini-cli-core or @google/gemini-cli imports remain in changed files
3. Verify no USE_GEMINI references were introduced

QUALITATIVE CHECKS - for EACH commit verify:

1. d97bbd53 (exit codes):
   - packages/core/src/utils/exitCodes.ts has updated exit code definitions
   - packages/cli/src/gemini.tsx uses the new exit codes

2. 3406dc5b (consent flag):
   - packages/cli/src/commands/extensions/link.ts has --consent flag
   - Test file validates the flag behavior

3. 0f12d6c4 (MCP auth headers):
   - packages/core/src/mcp/auth-provider.ts EXISTS with McpAuthProvider interface
   - packages/core/src/mcp/google-auth-provider.ts has getRequestHeaders() method
   - packages/core/src/tools/mcp-client.ts calls getRequestHeaders() in transport creation

4. 450734e3 (LICENSE):
   - LICENSE file no longer contains "Copyright 2025 Google LLC"
   - LICENSE file contains "Copyright [yyyy] [name of copyright owner]"

5. 6a43b312 (telemetry finish_reasons):
   - packages/core/src/telemetry/types.ts has finish_reasons field
   - packages/core/src/telemetry/loggers.ts logs finish_reasons in API response events
   - No import errors from missing semantic.ts

Output: Per-commit assessment with LANDED/NOT_LANDED and FUNCTIONAL/BROKEN flags.
```

---

### Batch 2 (PICK) — Commits 6-10 [FULL VERIFY]

| # | SHA | Subject |
|---|-----|---------|
| 6 | `f98e84f0` | test: Add verification for $schema property in settings schema (#13497) |
| 7 | `2fe609cb` | fix(core): handle EPIPE error in hook runner (#14231) |
| 8 | `f4babf17` | fix(async): prevent missed async errors (#13714) |
| 9 | `70a48a3d` | fix(ui): misaligned markdown table rendering (#8336) |
| 10 | `98d7238e` | fix: Conditionally add set -eEuo pipefail in setup-github (#8550) |

**Command:**
```bash
git cherry-pick f98e84f0 2fe609cb f4babf17 70a48a3d 98d7238e
```

**Verification:** Full verify (lint + typecheck + test + format + build + haiku)

**High-risk notes:**
- `f4babf17` touches many files across the codebase (eslint config + numerous async fixes). High conflict potential.
- `2fe609cb` modifies hookRunner.ts which was partly reimplemented in LLxprt.

**Cherrypicker prompt:**
```
Cherry-pick these 5 upstream commits onto the gmerge/0.20.2 branch:
f98e84f0 2fe609cb f4babf17 70a48a3d 98d7238e

Run: git cherry-pick f98e84f0 2fe609cb f4babf17 70a48a3d 98d7238e

HIGH-RISK: f4babf17 touches eslint.config.js and ~20 source files for async/await hardening.
If conflicts are severe, abort and cherry-pick it solo after the other 4.

SPECIAL NOTES:
- 2fe609cb: hookRunner.ts L238-239 has child.stdin.write/end without EPIPE handler. The upstream fix adds an error event listener before the write. Apply cleanly.
- 70a48a3d: Fix regex in InlineMarkdownRenderer.tsx getPlainTextLength from \*(.*?)\* to \*(.+?)\*
- f4babf17: Many files get return-await-in-try-catch fixes. Resolve conflicts per-file, keeping LLxprt imports.

After cherry-pick:
- Run: npm run lint && npm run typecheck && npm run test && npm run format && npm run build
- Run: node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
- If npm run format modifies files, commit separately: git add -A && git commit -m "fix: post-batch 2 formatting"
- Fix any issues

Standard conflict resolution applies (branding, imports).
```

**Reviewer prompt:**
```
Review Batch 2 of gmerge-0.20.2 cherry-picks. This is a FULL VERIFY batch.

MECHANICAL CHECKS:
1. Run: npm run lint && npm run typecheck && npm run test && npm run format && npm run build
2. Run: node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
3. Verify no @google/gemini-cli-core or @google/gemini-cli imports
4. Verify no USE_GEMINI references

QUALITATIVE CHECKS:

1. f98e84f0 (schema test):
   - scripts/tests/generate-settings-schema.test.ts has $schema verification

2. 2fe609cb (EPIPE fix):
   - packages/core/src/hooks/hookRunner.ts has child.stdin.on('error', ...) BEFORE the write call
   - EPIPE errors are silently ignored, other errors are logged
   - hookRunner.test.ts mocks updated to support the error handler

3. f4babf17 (async error handling):
   - eslint.config.js has return-await rule
   - Spot-check at least 3 modified files for the return await pattern in try blocks

4. 70a48a3d (markdown rendering):
   - InlineMarkdownRenderer.tsx getPlainTextLength regex uses .+? not .*?
   - InlineMarkdownRenderer.test.ts has the new focused test

5. 98d7238e (setup-github):
   - setupGithubCommand.ts conditionally adds strict-mode flags

Output: Per-commit assessment with LANDED/NOT_LANDED and FUNCTIONAL/BROKEN flags.
Full verify result: PASS/FAIL.
```

---

### Batch 3 (PICK) — Commits 11-13

| # | SHA | Subject |
|---|-----|---------|
| 11 | `1689e9b6` | fix(cli): fix issue updating a component while rendering (#14319) |
| 12 | `71b0e7ab` | Don't fail test if we can't cleanup (#14389) |
| 13 | `ba864380` | fix(patch): cherry-pick 3f5f030 (IDE auth env fallback) (#15002) |

**Command:**
```bash
git cherry-pick 1689e9b6 71b0e7ab ba864380
```

**Verification:** Quick verify (lint + typecheck)

**High-risk notes:**
- `1689e9b6` touches AppContainer, InputPrompt, message queue hooks, and useCommandCompletion. Multiple UI files.
- `ba864380` is a release-branch patch — carries an IDE client fix. May have release scaffolding to discard.

**Cherrypicker prompt:**
```
Cherry-pick these 3 upstream commits onto the gmerge/0.20.2 branch:
1689e9b6 71b0e7ab ba864380

Run: git cherry-pick 1689e9b6 71b0e7ab ba864380

SPECIAL NOTES:
- 1689e9b6 touches multiple UI files (AppContainer, InputPrompt, message queue, command completion). Resolve conflicts preserving LLxprt's existing UI structure.
- ba864380 is a release-branch patch carrying an IDE client fix. If it includes release scaffolding (version bumps, package-lock changes), discard those and keep only the ide-client.ts changes.
- 71b0e7ab adds try-catch around rm() in integration-tests/globalSetup.ts teardown.

After cherry-pick:
- Run: npm run lint && npm run typecheck
- Fix any issues

Standard conflict resolution applies.
```

**Reviewer prompt:**
```
Review Batch 3 of gmerge-0.20.2 cherry-picks.

MECHANICAL CHECKS:
1. Run: npm run lint && npm run typecheck
2. Verify no @google/gemini-cli-core or @google/gemini-cli imports

QUALITATIVE CHECKS:

1. 1689e9b6 (React state fix):
   - AppContainer.tsx, InputPrompt.tsx, useMessageQueue.ts have the setState-during-render fix
   - Changes use useEffect or callback patterns instead of direct setState during render

2. 71b0e7ab (cleanup error handling):
   - integration-tests/globalSetup.ts teardown() has try-catch around rm()
   - Failure is logged as warning, not thrown

3. ba864380 (IDE auth):
   - packages/core/src/ide/ide-client.ts has the env token fallback fix
   - No version bump artifacts from release branch leaked into the commit

Output: Per-commit assessment with LANDED/NOT_LANDED and FUNCTIONAL/BROKEN flags.
```

---

### Batch 4 (REIMPLEMENT) — R1: Gemini 3.0 Prompt Overrides [FULL VERIFY]

**Upstream:** `1187c7fdacee20b2f1f728eaf2093a1c44b5f6f1`

**Playbook:** `project-plans/gmerge-0.20.2/1187c7fd-plan.md`

**Summary:** Add "Do not call tools in silence" and remove "No Chitchat" as gemini-3 model-specific prompt override, following the pattern of existing `gemini-2.5-flash/core.md` and `gemini-3-pro-preview/core.md`.

**Verification:** Full verify

**Commit message:** `reimplement: gemini-3 prompt overrides (upstream 1187c7fd)`

**Cherrypicker prompt:**
```
Reimplement upstream commit 1187c7fd for LLxprt.

CONTEXT: Upstream adds two behavioral changes to system prompts for Gemini 3.0:
1. "Do not call tools in silence: You must provide a very short explanation before calling tools."
2. Remove "No Chitchat" for Gemini 3.0 models.

LLxprt uses per-model markdown prompt overrides. Existing examples:
- packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-2.5-flash/core.md
- packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-pro-preview/core.md

TASK:
1. Read the existing gemini-3-pro-preview/core.md override
2. Read the base core.md to understand what "No Chitchat" means (look for the "No Chitchat" bullet)
3. Update gemini-3-pro-preview/core.md to:
   a. Add under Core Mandates: "- **Do not call tools in silence:** You must provide to the user a very short and concise natural explanation (one sentence) before calling tools."
   b. In Tone and Style, ensure "No Chitchat" is NOT present (it already may be absent)
   c. Keep the "Clarity over Brevity" line
4. If there are other gemini-3 model directories, apply the same pattern
5. Add or update tests in packages/core/src/prompt-config/ that verify the model-specific override renders correctly

After implementation:
- Run: npm run lint && npm run typecheck && npm run test && npm run format && npm run build
- Run: node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
- git add -A && git commit -m "reimplement: gemini-3 prompt overrides (upstream 1187c7fd)"
```

---

### Batch 5 (REIMPLEMENT) — R4: Interactive/Non-Interactive/Subagent Prompt Mode

**Upstream:** `4a82b0d891a8caed2fa3e6b5761fc785cd4dcc38`

**Playbook:** `project-plans/gmerge-0.20.2/4a82b0d8-plan.md`

**Summary:** Add `interactionMode` to PromptEnvironment to fix contradictory instructions in subagent mode. Template variables conditionally render "Confirm Ambiguity" vs "Handle Ambiguity" + "Continue the work".

**Verification:** Quick verify

**Commit message:** `reimplement: interactive/non-interactive/subagent prompt mode (upstream 4a82b0d8)`

**Cherrypicker prompt:**
```
Reimplement upstream commit 4a82b0d8 for LLxprt.

CONTEXT: Upstream differentiates system prompt language for interactive vs non-interactive mode. LLxprt currently has contradictory instructions in subagent mode: core prompt says "interactive agent" + "confirm with user" while appended rules say "you CANNOT ask the user". This confuses some models (especially gpt-5.3-codex).

LLxprt already has the {{SUBAGENT_DELEGATION}} template variable pattern as precedent.

TASK:
1. Read these files to understand the prompt architecture:
   - packages/core/src/prompt-config/types.ts (PromptEnvironment, PromptContext)
   - packages/core/src/prompt-config/template-engine.ts (createVariablesFromContext)
   - packages/core/src/prompt-config/prompt-service.ts
   - packages/core/src/core/prompts.ts (CoreSystemPromptOptions, buildPromptContext)
   - packages/core/src/prompt-config/defaults/core.md

2. Add interactionMode to PromptEnvironment:
   interactionMode?: 'interactive' | 'non-interactive' | 'subagent';

3. Add interactionMode to CoreSystemPromptOptions and wire through buildPromptContext

4. Add template variables in TemplateEngine.createVariablesFromContext:
   - {{INTERACTION_MODE}} - raw value
   - {{INTERACTION_MODE_LABEL}} - "an interactive" / "a non-interactive" / "a subagent"
   - {{INTERACTIVE_CONFIRM}} - full bullet text (confirm with user vs handle autonomously)
   - {{NON_INTERACTIVE_CONTINUE}} - "Continue the work" directive (empty for interactive)

5. Update defaults/core.md:
   - Replace "You are an interactive CLI agent" with "You are {{INTERACTION_MODE_LABEL}} CLI agent"
   - Replace the "Confirm Ambiguity" bullet with {{INTERACTIVE_CONFIRM}}
   - Add {{NON_INTERACTIVE_CONTINUE}} after the confirm bullet

6. Update Gemini provider-specific core.md files similarly

7. Wire interactionMode in callers:
   - subagent.ts: pass interactionMode: 'subagent'
   - executor.ts: pass interactionMode: 'subagent' for agent-based subagents
   - Main CLI entry: pass interactionMode based on config.isInteractive()

8. Include interactionMode in prompt cache key

9. Add tests verifying all three modes render correctly

After implementation:
- Run: npm run lint && npm run typecheck
- Fix any issues
- git add -A && git commit -m "reimplement: interactive/non-interactive/subagent prompt mode (upstream 4a82b0d8)"
```

---

### Batch 6 (REIMPLEMENT) — R5: Shell Inactivity Timeout [FULL VERIFY]

**Upstream:** `0d29385e1bdf0f73e663df490a1b88ed3117ae16`

**Playbook:** `project-plans/gmerge-0.20.2/0d29385e-plan.md`

**Summary:** Add inactivity timeout (resets on output) distinct from total timeout. Control via /set ephemeral or /setting.

**Verification:** Full verify

**Commit message:** `reimplement: shell inactivity timeout (upstream 0d29385e)`

---

### Batch 7 (REIMPLEMENT) — R9: Auto-Execute Slash Commands

**Upstream:** `f918af82fe13eae28b324843d03e00f02937b521`

**Playbook:** `project-plans/gmerge-0.20.2/f918af82-plan.md`

**Summary:** Add `autoExecute?: boolean` to SlashCommand interface. Simple commands execute on Enter from suggestion; complex commands autocomplete. Tab always autocompletes.

**Verification:** Quick verify

**Commit message:** `reimplement: auto-execute slash commands (upstream f918af82)`

---

### Batch 8 (REIMPLEMENT) — R2+R6: Hook Integration (Tool + LLM) [FULL VERIFY]

**Upstream:** `558c8ece2ca2f3fec851228e050227fdb0cec8fb` + `5bed97064a99233e4c116849abb138db4e15daa3`

**Playbook:** `project-plans/gmerge-0.20.2/558c8ece-5bed9706-plan.md`

**Summary:** Wire LLxprt's existing hook infrastructure (hookRegistry, hookPlanner, hookRunner) into coreToolScheduler and geminiChat runtime paths. Creates coreToolHookTriggers.ts and geminiChatHookTriggers.ts.

**Verification:** Full verify

**Commit message:** `reimplement: hook integration into scheduler and model call (upstream 558c8ece + 5bed9706)`

---

### Batch 9 (REIMPLEMENT) — R3+R8: MCP Instructions

**Upstream:** `bc365f1eaa39c0414b4d70e600d733eb0867aec6` + `844d3a4dfa207fbfe3c083ecb12f0c090ddfa524`

**Playbook:** `project-plans/gmerge-0.20.2/bc365f1e-844d3a4d-plan.md`

**Summary:** Add MCP server instruction aggregation (getMcpInstructions, useInstructions setting) and always-include behavior.

**Verification:** Quick verify

**Commit message:** `reimplement: MCP server instructions (upstream bc365f1e + 844d3a4d)`

---

### Batch 10 (REIMPLEMENT) — R7: Stats Quota Display [FULL VERIFY]

**Upstream:** `69188c8538af44f6cbae7c57f4d8478a474802d0`

**Playbook:** `project-plans/gmerge-0.20.2/69188c85-plan.md`

**Summary:** Add quota/usage-limit display to /stats, treating Gemini quotas generically like other provider quotas.

**Verification:** Full verify

**Commit message:** `reimplement: stats quota display (upstream 69188c85)`

---

### Batch 11 (REIMPLEMENT) — R10: A2A ModelInfo Propagation

**Upstream:** `806cd112ac974ca54e39d6c28d2d243839aa9fd0`

**Playbook:** `project-plans/gmerge-0.20.2/806cd112-plan.md`

**Summary:** Add modelInfo tracking to A2A Task class for metadata/status updates.

**Verification:** Quick verify

**Commit message:** `reimplement: a2a modelInfo propagation (upstream 806cd112)`

---

### Batch 12 (REIMPLEMENT) — R11: JIT Context Manager [FULL VERIFY]

**Upstream:** `752a521423630589e49f9b5c1aed3b05173f686f`

**Playbook:** `project-plans/gmerge-0.20.2/752a5214-plan.md`

**Summary:** Wire existing JIT memory discovery into settings/config/context-manager service.

**Verification:** Full verify

**Commit message:** `reimplement: JIT context manager (upstream 752a5214)`

---

### Batch 13 (REIMPLEMENT) — R12: Stdio Hardening

**Upstream:** `f9997f92c99f9ec2d0eaee6910c47dffe9d25745`

**Playbook:** `project-plans/gmerge-0.20.2/f9997f92-plan.md`

**Summary:** Selective adoption of createWorkingStdio intent via LLxprt's createInkStdio pattern.

**Verification:** Quick verify

**Commit message:** `reimplement: stdio hardening (upstream f9997f92)`

---

### Batch 14 (REIMPLEMENT) — R13: Shell Env Sanitization [FULL VERIFY]

**Upstream:** `8872ee0ace406f105476764be54c1e029684093c`

**Playbook:** `project-plans/gmerge-0.20.2/8872ee0a-plan.md`

**Summary:** Sanitize shell environment in CI to prevent leaks while preserving LLXPRT_TEST variables.

**Verification:** Full verify

**Commit message:** `reimplement: shell env sanitization (upstream 8872ee0a)`

---

## Failure Recovery

### Cherry-pick conflicts

```bash
# View conflict
git diff
# Resolve and continue
git add -A
git cherry-pick --continue
# Or abort the batch
git cherry-pick --abort
```

### When to create a fix commit

After any batch where post-cherry-pick fixes were needed:
```bash
git add -A
git commit -m "fix: post-batch N verification"
```

### Review-remediate loop

If reviewer reports failures:
1. Send cherrypicker subagent to remediate specific issues
2. Re-run reviewer
3. Repeat up to 5 times
4. After 5 failures, call `todo_pause("Batch N failed review 5 times: <specific issue>")` and escalate to human

---

## Note-Taking Requirement

After each batch:
1. Update `PROGRESS.md` with batch status and LLxprt commit hash
2. Append to `NOTES.md` with conflicts, deviations, and follow-ups
3. Update `AUDIT.md` with per-SHA outcomes

---

## Todo List Management

Call `todo_write()` with this exact todo list:

```json
[
  {"id": "B1-exec", "content": "Batch 1 EXECUTE: cherry-pick d97bbd53 3406dc5b 0f12d6c4 450734e3 6a43b312", "status": "pending"},
  {"id": "B1-review", "content": "Batch 1 REVIEW: verify 5 commits landed, lint, typecheck", "status": "pending"},
  {"id": "B1-commit", "content": "Batch 1 COMMIT: fix commits created by cherry-pick are already committed", "status": "pending"},
  {"id": "B2-exec", "content": "Batch 2 EXECUTE [FULL]: cherry-pick f98e84f0 2fe609cb f4babf17 70a48a3d 98d7238e", "status": "pending"},
  {"id": "B2-review", "content": "Batch 2 REVIEW [FULL]: lint+typecheck+test+format+build+haiku, verify 5 commits", "status": "pending"},
  {"id": "B2-commit", "content": "Batch 2 COMMIT: fix commit if needed after full verify", "status": "pending"},
  {"id": "B3-exec", "content": "Batch 3 EXECUTE: cherry-pick 1689e9b6 71b0e7ab ba864380", "status": "pending"},
  {"id": "B3-review", "content": "Batch 3 REVIEW: verify 3 commits landed, lint, typecheck", "status": "pending"},
  {"id": "B3-commit", "content": "Batch 3 COMMIT: fix commit if needed", "status": "pending"},
  {"id": "B4-exec", "content": "Batch 4 REIMPLEMENT [FULL]: Gemini 3.0 prompt overrides (1187c7fd)", "status": "pending"},
  {"id": "B4-review", "content": "Batch 4 REVIEW [FULL]: verify prompt override, full verify", "status": "pending"},
  {"id": "B4-commit", "content": "Batch 4 COMMIT: reimplement gemini-3 prompts", "status": "pending"},
  {"id": "B5-exec", "content": "Batch 5 REIMPLEMENT: interactive/non-interactive/subagent prompt mode (4a82b0d8)", "status": "pending"},
  {"id": "B5-review", "content": "Batch 5 REVIEW: verify interactionMode in prompt system", "status": "pending"},
  {"id": "B5-commit", "content": "Batch 5 COMMIT: reimplement interactive mode", "status": "pending"},
  {"id": "B6-exec", "content": "Batch 6 REIMPLEMENT [FULL]: shell inactivity timeout (0d29385e)", "status": "pending"},
  {"id": "B6-review", "content": "Batch 6 REVIEW [FULL]: verify timeout, full verify", "status": "pending"},
  {"id": "B6-commit", "content": "Batch 6 COMMIT: reimplement inactivity timeout", "status": "pending"},
  {"id": "B7-exec", "content": "Batch 7 REIMPLEMENT: auto-execute slash commands (f918af82)", "status": "pending"},
  {"id": "B7-review", "content": "Batch 7 REVIEW: verify autoExecute flag and Enter behavior", "status": "pending"},
  {"id": "B7-commit", "content": "Batch 7 COMMIT: reimplement auto-execute", "status": "pending"},
  {"id": "B8-exec", "content": "Batch 8 REIMPLEMENT [FULL]: hook integration tool+LLM (558c8ece + 5bed9706)", "status": "pending"},
  {"id": "B8-review", "content": "Batch 8 REVIEW [FULL]: verify hooks wired into scheduler+geminiChat", "status": "pending"},
  {"id": "B8-commit", "content": "Batch 8 COMMIT: reimplement hook integration", "status": "pending"},
  {"id": "B9-exec", "content": "Batch 9 REIMPLEMENT: MCP instructions (bc365f1e + 844d3a4d)", "status": "pending"},
  {"id": "B9-review", "content": "Batch 9 REVIEW: verify getMcpInstructions plumbing", "status": "pending"},
  {"id": "B9-commit", "content": "Batch 9 COMMIT: reimplement MCP instructions", "status": "pending"},
  {"id": "B10-exec", "content": "Batch 10 REIMPLEMENT [FULL]: stats quota display (69188c85)", "status": "pending"},
  {"id": "B10-review", "content": "Batch 10 REVIEW [FULL]: verify /stats quota, full verify", "status": "pending"},
  {"id": "B10-commit", "content": "Batch 10 COMMIT: reimplement stats quota", "status": "pending"},
  {"id": "B11-exec", "content": "Batch 11 REIMPLEMENT: A2A modelInfo propagation (806cd112)", "status": "pending"},
  {"id": "B11-review", "content": "Batch 11 REVIEW: verify modelInfo in task metadata", "status": "pending"},
  {"id": "B11-commit", "content": "Batch 11 COMMIT: reimplement A2A modelInfo", "status": "pending"},
  {"id": "B12-exec", "content": "Batch 12 REIMPLEMENT [FULL]: JIT context manager (752a5214)", "status": "pending"},
  {"id": "B12-review", "content": "Batch 12 REVIEW [FULL]: verify context manager wiring, full verify", "status": "pending"},
  {"id": "B12-commit", "content": "Batch 12 COMMIT: reimplement JIT context manager", "status": "pending"},
  {"id": "B13-exec", "content": "Batch 13 REIMPLEMENT: stdio hardening (f9997f92)", "status": "pending"},
  {"id": "B13-review", "content": "Batch 13 REVIEW: verify stdio changes", "status": "pending"},
  {"id": "B13-commit", "content": "Batch 13 COMMIT: reimplement stdio hardening", "status": "pending"},
  {"id": "B14-exec", "content": "Batch 14 REIMPLEMENT [FULL]: shell env sanitization (8872ee0a)", "status": "pending"},
  {"id": "B14-review", "content": "Batch 14 REVIEW [FULL]: verify env sanitization, full verify", "status": "pending"},
  {"id": "B14-commit", "content": "Batch 14 COMMIT: reimplement shell env sanitization", "status": "pending"},
  {"id": "FINAL-progress", "content": "UPDATE PROGRESS.md with all commit hashes", "status": "pending"},
  {"id": "FINAL-notes", "content": "UPDATE NOTES.md with all conflicts/deviations", "status": "pending"},
  {"id": "FINAL-audit", "content": "UPDATE AUDIT.md with all outcomes", "status": "pending"}
]
```

---

## Context Recovery

If you lose context and need to resume:

1. **Check git state:**
   ```bash
   git branch --show-current  # Should be gmerge/0.20.2
   git status
   git log --oneline -20
   ```

2. **Read the todo list:** `todo_read()`

3. **Resume from first pending item** in the todo list

4. **Key files for context:**
   - `project-plans/gmerge-0.20.2/CHERRIES.md` — all decisions
   - `project-plans/gmerge-0.20.2/PLAN.md` — this file (batch schedule)
   - `project-plans/gmerge-0.20.2/PROGRESS.md` — batch completion status
   - `project-plans/gmerge-0.20.2/NOTES.md` — running notes
   - `project-plans/gmerge-0.20.2/AUDIT.md` — per-SHA outcomes

5. **Summary:** Branch `gmerge/0.20.2` syncs upstream `v0.19.4..v0.20.2`. 13 PICKs in 3 batches, 13 REIMPLEMENTs in 11 batches (2 pairs grouped). 40 SKIPs.
