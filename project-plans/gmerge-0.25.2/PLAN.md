# Execution Plan: gemini-cli v0.24.5 → v0.25.2

## START HERE (If you were told to "DO this plan")

If you're reading this because someone said `DO @project-plans/gmerge-0.25.2/PLAN.md`, follow these steps exactly.

### Step 1: Check current state

```bash
git branch --show-current   # Must be gmerge/0.25.2
git status                  # Must be clean or only contain in-scope gmerge work
```

If the branch is wrong or the work tree contains unrelated changes, stop and get the tree back to a safe state before proceeding.

### Step 2: Check or create the todo list

Call `todo_read()` first.

- If the todo list is empty, missing the `B1-exec` / `B1-review` / `B1-commit` structure, or clearly belongs to another task, call `todo_write()` with the EXACT block in the **Todo List Management** section below.
- If the todo list already exists, do not rewrite it unless recovery requires restoring the exact plan todos.

### Step 3: Find where to resume

- Resume from the first `pending` todo item.
- If an item is `in_progress`, restart that item from the beginning.
- If every item is `completed`, execution is done and only final verification / PR handling remains.

### Step 4: Execute using subagents

- For every `B*-exec` item, call `task()` with `subagent_name: "cherrypicker"` and use the exact execution prompt for that batch.
- For every `B*-review` item, call `task()` with `subagent_name: "deepthinker"` and use the exact review prompt for that batch.
- If review fails, call `task()` again with `subagent_name: "cherrypicker"` for remediation, then re-run the deepthinker.
- Do **not** cherry-pick or review the batch directly yourself; execution and review must go through the required subagents.
- The coordinator may perform the `B*-commit` todo directly once review passes.

### Step 5: If blocked

If a required file is missing, a cherry-pick cannot be completed, verification reveals a blocker that cannot be remediated within the allowed loop, or git state is unsafe, call `todo_pause()` with the specific reason and wait for human intervention.

## Scope and Source of Truth

- **Branch:** `gmerge/0.25.2`
- **Upstream range:** `v0.24.5..v0.25.2`
- **Current parity baseline:** LLxprt already matched upstream through `v0.24.5`
- **Authoritative decision file:** [`CHERRIES.md`](./CHERRIES.md)
- **Authoritative audit evidence:** [`AUDIT-DETAILS.md`](./AUDIT-DETAILS.md)
- **Execution artifacts to update continuously:** [`PROGRESS.md`](./PROGRESS.md), [`NOTES.md`](./NOTES.md), [`AUDIT.md`](./AUDIT.md)
- **Tracking issue:** not identified in the planning artifacts. Do not open the final PR until the correct tracking issue number is confirmed.

This plan is based on the finalized `CHERRIES.md` counts:

- PICK: **48**
- SKIP: **78**
- REIMPLEMENT: **28**
- NO_OP: **15**
- Total upstream commits audited: **169**
- Executable batches in this plan: **55** (`27` PICK batches + `28` REIMPLEMENT batches)

## Non-Negotiables


- Preserve LLxprt multi-provider architecture, provider-neutral auth, and LLxprt tool batching behavior.

- Do not reintroduce Clearcut, Google telemetry, Google auth assumptions, quota-dialog UX, Smart Edit, NextSpeakerChecker, Flash fallback behavior, or automatic model routing.

- Do not adopt upstream /agents, AgentRegistry, DelegateToAgentTool, or markdown-frontmatter agent architecture where LLxprt uses /subagent, SubagentManager, and task().

- Keep A2A server work private and leave deferred A2A follow-ups with issue #1675 unless a playbook says otherwise.

- Preserve LLxprt branding, package names, tool names, and policy semantics; use cherrypicking.md as the canonical substitution guide.


Use both [`dev-docs/cherrypicking-runbook.md`](../../dev-docs/cherrypicking-runbook.md) and [`dev-docs/cherrypicking.md`](../../dev-docs/cherrypicking.md) throughout execution. If they ever disagree on workflow or cadence, the runbook wins.


## File Existence Pre-Check


Before any REIMPLEMENT batch, confirm the current tree still matches this pre-check. If a path listed as present disappears, or a path listed as missing now exists, re-read the relevant playbook before editing.


**Present and expected to be adapted in-place:**

- `packages/core/src/hooks/hookSystem.ts`

- `packages/core/src/hooks/hookTranslator.ts`

- `packages/core/src/core/geminiChatHookTriggers.ts`

- `packages/core/src/core/lifecycleHookTriggers.ts`

- `packages/cli/src/ui/hooks/useGeminiStream.ts`

- `packages/core/src/utils/events.ts`

- `packages/core/src/core/coreToolHookTriggers.ts`

- `packages/core/src/hooks/hookEventHandler.ts`

- `packages/cli/src/ui/commands/bugCommand.ts`

- `packages/cli/src/ui/commands/chatCommand.ts`

- `packages/cli/src/ui/commands/hooksCommand.ts`

- `packages/cli/src/ui/components/views/HooksList.tsx`

- `packages/cli/src/ui/components/SettingsDialog.tsx`

- `packages/cli/src/ui/components/views/ExtensionsList.tsx`

- `packages/cli/src/ui/components/SuggestionsDisplay.tsx`

- `packages/cli/src/ui/commands/types.ts`

- `packages/cli/src/ui/hooks/atCommandProcessor.ts`

- `packages/cli/src/ui/hooks/useAtCompletion.ts`

- `packages/cli/src/config/extensions/settingsIntegration.ts`

- `packages/cli/src/config/settingsSchema.ts`

- `packages/core/src/config/subagentManager.ts`

- `packages/core/src/skills/skillLoader.ts`

- `packages/core/src/agents/types.ts`

- `packages/cli/src/ui/layouts/DefaultAppLayout.tsx`

- `packages/cli/src/utils/sessionCleanup.ts`

- `packages/cli/src/utils/userStartupWarnings.ts`

- `packages/cli/src/utils/windowTitle.ts`

- `docs/hooks/index.md`

- `docs/hooks/writing-hooks.md`

- `docs/extension.md`

- `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-pro-preview/core.md`

- `integration-tests/test-helper.ts`


**Missing now and likely to be created only by the relevant reimplementation batch:**

- `packages/cli/src/commands/extensions/configure.ts`

- `packages/cli/src/config/extension-manager.ts`

- `packages/cli/src/ui/utils/historyExportUtils.ts`

- `packages/core/src/utils/apiConversionUtils.ts`

- `packages/core/src/skills/builtin/`

- `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-flash-preview/core.md`

- `packages/cli/src/utils/activityLogger.ts`

- `evals/`


## Branding / Naming Substitutions


| Upstream term / path | LLxprt equivalent |

| --- | --- |

| `@google/gemini-cli-core` | `@vybestack/llxprt-code-core` |

| `AuthType.USE_GEMINI / USE_GEMINI` | `AuthType.USE_PROVIDER / USE_PROVIDER` |

| `web_search` | `google_web_search` |

| `web_fetch` | `google_web_fetch or direct_web_fetch` |

| `write_todos` | `todo_write / todo_read / todo_pause` |

| `delegate_to_agent` | `task` |

| `/agents` | `/subagent and LLxprt subagent flows` |

| `/restore` | `/continue when adapting session-browser behavior` |

| `AgentRegistry / markdown-frontmatter agents` | `SubagentManager / JSON-backed subagent configs` |


Aliases like `ls`, `grep`, and `edit` remain model-facing aliases only. LLxprt canonical tool names stay `list_directory`, `search_file_content`, and `replace`.


## Verification Cadence


After **every batch**, the deepthinker must run **Quick Verify**:


```bash
npm run lint
npm run typecheck
```


After **every even-numbered batch** (`B2`, `B4`, …), the deepthinker must run **Full Verify**:


```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```


If `npm run format` changes files during Full Verify, keep those formatting changes and commit them with the batch or its immediate follow-up fix commit. Do **not** rerun lint/typecheck/test solely because formatting changed files.


Before final push / PR prep, rerun the repository-local verification memory as needed (`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`).


## Subagent Orchestration


Execution pattern for every batch:

```text
Execute (cherrypicker) -> Review (deepthinker) -> PASS? continue : Remediate (cherrypicker) -> Review again
```

Rules:

1. `cherrypicker` executes the batch or reimplementation but does **not** commit.
2. `deepthinker` is mandatory after every batch and performs both mechanical and qualitative verification.
3. If review fails, remediate with `cherrypicker`, then re-run `deepthinker`.
4. Maximum remediation loop: **5** review/remediation cycles per batch.
5. Commit only after deepthinker returns PASS.
6. If the fifth review still fails, call `todo_pause()` with the concrete blocker.


## Coordinator Execution Rules


1. Create the todo list first using the exact `todo_write` block below.
2. Execute sequentially in batch order; do not skip ahead.
3. Mark todos `in_progress` when starting and `completed` only when actually done.
4. Review is mandatory; never skip the `B*-review` item.
5. Commit only after review passes.
6. If remediation is needed, keep the `B*-exec` item in play until deepthinker PASS is obtained.
7. Create a follow-up fix commit immediately if remediation after review produces additional changes that should not be squashed into the original batch commit.
8. Do not stop for progress-report questions; keep going until the todo list is empty or a true blocker appears.
9. On context wipe, recover by reading this plan, `todo_read()`, `PROGRESS.md`, `NOTES.md`, and `AUDIT.md`.
10. Use `task()` for execution and review work; do not self-perform cherry-picks or reviews.


## Todo List Management

Use this exact tool call when initializing or restoring the execution todo list:

```text

todo_write({
  "todos": [
  {
    "id": "B1-exec",
    "content": "Batch 1 EXECUTE: cherry-pick da85e3f8f23 982eee63b61 a26463b056d 2d683bb6f8a \u2014 feat(core): improve activate_skill tool and use lowercase XML tags (+3 more)",
    "status": "pending"
  },
  {
    "id": "B1-review",
    "content": "Batch 1 REVIEW: verify da85e3f8f23 982eee63b61 a26463b056d 2d683bb6f8a with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B1-commit",
    "content": "Batch 1 COMMIT: git add -A && git commit -m \"cherry-pick: upstream da85e3f8f23..2d683bb6f8a batch 01\"",
    "status": "pending"
  },
  {
    "id": "B2-exec",
    "content": "Batch 2 EXECUTE: reimplement 5fe5d1da467 \u2014 policy: extract legacy policy from core tool scheduler to policy engine",
    "status": "pending"
  },
  {
    "id": "B2-review",
    "content": "Batch 2 REVIEW: verify 5fe5d1da467 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B2-commit",
    "content": "Batch 2 COMMIT: git add -A && git commit -m \"reimplement: policy: extract legacy policy from core tool scheduler to policy engine (upstream 5fe5d1da467)\"",
    "status": "pending"
  },
  {
    "id": "B3-exec",
    "content": "Batch 3 EXECUTE: reimplement 416d243027d \u2014 Enhance TestRig with process management and timeouts",
    "status": "pending"
  },
  {
    "id": "B3-review",
    "content": "Batch 3 REVIEW: verify 416d243027d with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B3-commit",
    "content": "Batch 3 COMMIT: git add -A && git commit -m \"reimplement: Enhance TestRig with process management and timeouts (upstream 416d243027d)\"",
    "status": "pending"
  },
  {
    "id": "B4-exec",
    "content": "Batch 4 EXECUTE: cherry-pick 8f9bb6bccc6 \u2014 Update troubleshooting doc for UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "status": "pending"
  },
  {
    "id": "B4-review",
    "content": "Batch 4 REVIEW: verify 8f9bb6bccc6 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B4-commit",
    "content": "Batch 4 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 8f9bb6bccc6 batch 04\"",
    "status": "pending"
  },
  {
    "id": "B5-exec",
    "content": "Batch 5 EXECUTE: reimplement 97b31c4eefa \u2014 Simplify extension settings command",
    "status": "pending"
  },
  {
    "id": "B5-review",
    "content": "Batch 5 REVIEW: verify 97b31c4eefa with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B5-commit",
    "content": "Batch 5 COMMIT: git add -A && git commit -m \"reimplement: Simplify extension settings command (upstream 97b31c4eefa)\"",
    "status": "pending"
  },
  {
    "id": "B6-exec",
    "content": "Batch 6 EXECUTE: cherry-pick 57012ae5b33 \u2014 Core data structure updates for Rewind functionality",
    "status": "pending"
  },
  {
    "id": "B6-review",
    "content": "Batch 6 REVIEW: verify 57012ae5b33 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B6-commit",
    "content": "Batch 6 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 57012ae5b33 batch 06\"",
    "status": "pending"
  },
  {
    "id": "B7-exec",
    "content": "Batch 7 EXECUTE: reimplement c64b5ec4a3a \u2014 feat(hooks): simplify hook firing with HookSystem wrapper methods",
    "status": "pending"
  },
  {
    "id": "B7-review",
    "content": "Batch 7 REVIEW: verify c64b5ec4a3a with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B7-commit",
    "content": "Batch 7 COMMIT: git add -A && git commit -m \"reimplement: feat(hooks): simplify hook firing with HookSystem wrapper methods (upstream c64b5ec4a3a)\"",
    "status": "pending"
  },
  {
    "id": "B8-exec",
    "content": "Batch 8 EXECUTE: reimplement 4c961df3136 \u2014 feat(core): Decouple enabling hooks UI from subsystem.",
    "status": "pending"
  },
  {
    "id": "B8-review",
    "content": "Batch 8 REVIEW: verify 4c961df3136 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B8-commit",
    "content": "Batch 8 COMMIT: git add -A && git commit -m \"reimplement: feat(core): Decouple enabling hooks UI from subsystem. (upstream 4c961df3136)\"",
    "status": "pending"
  },
  {
    "id": "B9-exec",
    "content": "Batch 9 EXECUTE: reimplement 17b3eb730a9 \u2014 docs: add docs for hooks + extensions",
    "status": "pending"
  },
  {
    "id": "B9-review",
    "content": "Batch 9 REVIEW: verify 17b3eb730a9 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B9-commit",
    "content": "Batch 9 COMMIT: git add -A && git commit -m \"reimplement: docs: add docs for hooks + extensions (upstream 17b3eb730a9)\"",
    "status": "pending"
  },
  {
    "id": "B10-exec",
    "content": "Batch 10 EXECUTE: cherry-pick 1bd4f9d8b6f d48c934357c 3e2f4eb8ba1 722c4933dc3 \u2014 Optimize json-output tests with mock responses (+3 more)",
    "status": "pending"
  },
  {
    "id": "B10-review",
    "content": "Batch 10 REVIEW: verify 1bd4f9d8b6f d48c934357c 3e2f4eb8ba1 722c4933dc3 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B10-commit",
    "content": "Batch 10 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 1bd4f9d8b6f..722c4933dc3 batch 10\"",
    "status": "pending"
  },
  {
    "id": "B11-exec",
    "content": "Batch 11 EXECUTE: reimplement 030847a80a4 \u2014 feat(cli): export chat history in /bug and prefill GitHub issue",
    "status": "pending"
  },
  {
    "id": "B11-review",
    "content": "Batch 11 REVIEW: verify 030847a80a4 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B11-commit",
    "content": "Batch 11 COMMIT: git add -A && git commit -m \"reimplement: feat(cli): export chat history in /bug and prefill GitHub issue (upstream 030847a80a4)\"",
    "status": "pending"
  },
  {
    "id": "B12-exec",
    "content": "Batch 12 EXECUTE: reimplement 97ad3d97cba \u2014 Reapply \"feat(admin): implement extensions disabled\" (#16082)",
    "status": "pending"
  },
  {
    "id": "B12-review",
    "content": "Batch 12 REVIEW: verify 97ad3d97cba with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B12-commit",
    "content": "Batch 12 COMMIT: git add -A && git commit -m \"reimplement: Reapply feat(admin): implement extensions disabled (#16082) (upstream 97ad3d97cba)\"",
    "status": "pending"
  },
  {
    "id": "B13-exec",
    "content": "Batch 13 EXECUTE: reimplement 660368f2490 \u2014 bug(core): Fix spewie getter in hookTranslator.ts",
    "status": "pending"
  },
  {
    "id": "B13-review",
    "content": "Batch 13 REVIEW: verify 660368f2490 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B13-commit",
    "content": "Batch 13 COMMIT: git add -A && git commit -m \"reimplement: bug(core): Fix spewie getter in hookTranslator.ts (upstream 660368f2490)\"",
    "status": "pending"
  },
  {
    "id": "B14-exec",
    "content": "Batch 14 EXECUTE: reimplement eb3f3cfdb8a \u2014 feat(hooks): add mcp_context to BeforeTool and AfterTool hook inputs",
    "status": "pending"
  },
  {
    "id": "B14-review",
    "content": "Batch 14 REVIEW: verify eb3f3cfdb8a with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B14-commit",
    "content": "Batch 14 COMMIT: git add -A && git commit -m \"reimplement: feat(hooks): add mcp_context to BeforeTool and AfterTool hook inputs (upstream eb3f3cfdb8a)\"",
    "status": "pending"
  },
  {
    "id": "B15-exec",
    "content": "Batch 15 EXECUTE: cherry-pick 1a4ae413978 \u2014 fix: yolo should auto allow redirection",
    "status": "pending"
  },
  {
    "id": "B15-review",
    "content": "Batch 15 REVIEW: verify 1a4ae413978 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B15-commit",
    "content": "Batch 15 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 1a4ae413978 batch 15\"",
    "status": "pending"
  },
  {
    "id": "B16-exec",
    "content": "Batch 16 EXECUTE: cherry-pick f8138262fa7 fbfad06307c 01d2d437372 e5f7a9c4240 4ab1b9895ad \u2014 fix(cli): disableYoloMode shouldn't enforce default approval mode against args (+4 more)",
    "status": "pending"
  },
  {
    "id": "B16-review",
    "content": "Batch 16 REVIEW: verify f8138262fa7 fbfad06307c 01d2d437372 e5f7a9c4240 4ab1b9895ad with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B16-commit",
    "content": "Batch 16 COMMIT: git add -A && git commit -m \"cherry-pick: upstream f8138262fa7..4ab1b9895ad batch 16\"",
    "status": "pending"
  },
  {
    "id": "B17-exec",
    "content": "Batch 17 EXECUTE: reimplement 18dd399cb57 \u2014 Support @ suggestions for subagents",
    "status": "pending"
  },
  {
    "id": "B17-review",
    "content": "Batch 17 REVIEW: verify 18dd399cb57 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B17-commit",
    "content": "Batch 17 COMMIT: git add -A && git commit -m \"reimplement: Support @ suggestions for subagents (upstream 18dd399cb57)\"",
    "status": "pending"
  },
  {
    "id": "B18-exec",
    "content": "Batch 18 EXECUTE: reimplement e1e3efc9d04 \u2014 feat(hooks): Support explicit stop and block execution control in model hooks",
    "status": "pending"
  },
  {
    "id": "B18-review",
    "content": "Batch 18 REVIEW: verify e1e3efc9d04 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B18-commit",
    "content": "Batch 18 COMMIT: git add -A && git commit -m \"reimplement: feat(hooks): Support explicit stop and block execution control in model hooks (upstream e1e3efc9d04)\"",
    "status": "pending"
  },
  {
    "id": "B19-exec",
    "content": "Batch 19 EXECUTE: reimplement 41e627a7ee4 \u2014 Refine Gemini 3 system instructions to reduce model verbosity",
    "status": "pending"
  },
  {
    "id": "B19-review",
    "content": "Batch 19 REVIEW: verify 41e627a7ee4 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B19-commit",
    "content": "Batch 19 COMMIT: git add -A && git commit -m \"reimplement: Refine Gemini 3 system instructions to reduce model verbosity (upstream 41e627a7ee4)\"",
    "status": "pending"
  },
  {
    "id": "B20-exec",
    "content": "Batch 20 EXECUTE: cherry-pick 88f1ec8d0ae \u2014 Always enable bracketed paste",
    "status": "pending"
  },
  {
    "id": "B20-review",
    "content": "Batch 20 REVIEW: verify 88f1ec8d0ae with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B20-commit",
    "content": "Batch 20 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 88f1ec8d0ae batch 20\"",
    "status": "pending"
  },
  {
    "id": "B21-exec",
    "content": "Batch 21 EXECUTE: reimplement 77e226c55fe \u2014 Show settings source in extensions lists",
    "status": "pending"
  },
  {
    "id": "B21-review",
    "content": "Batch 21 REVIEW: verify 77e226c55fe with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B21-commit",
    "content": "Batch 21 COMMIT: git add -A && git commit -m \"reimplement: Show settings source in extensions lists (upstream 77e226c55fe)\"",
    "status": "pending"
  },
  {
    "id": "B22-exec",
    "content": "Batch 22 EXECUTE: cherry-pick 8bc3cfe29a6 c1401682ed0 14f0cb45389 \u2014 feat(skills): add pr-creator skill and enable skills (+2 more)",
    "status": "pending"
  },
  {
    "id": "B22-review",
    "content": "Batch 22 REVIEW: verify 8bc3cfe29a6 c1401682ed0 14f0cb45389 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B22-commit",
    "content": "Batch 22 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 8bc3cfe29a6..14f0cb45389 batch 22\"",
    "status": "pending"
  },
  {
    "id": "B23-exec",
    "content": "Batch 23 EXECUTE: reimplement c7d17dda49d \u2014 fix: properly use systemMessage for hooks in UI",
    "status": "pending"
  },
  {
    "id": "B23-review",
    "content": "Batch 23 REVIEW: verify c7d17dda49d with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B23-commit",
    "content": "Batch 23 COMMIT: git add -A && git commit -m \"reimplement: fix: properly use systemMessage for hooks in UI (upstream c7d17dda49d)\"",
    "status": "pending"
  },
  {
    "id": "B24-exec",
    "content": "Batch 24 EXECUTE: cherry-pick ea7393f7fd5 e04a5f0cb0e 1fb55dcb2e0 \u2014 Infer modifyOtherKeys support (+2 more)",
    "status": "pending"
  },
  {
    "id": "B24-review",
    "content": "Batch 24 REVIEW: verify ea7393f7fd5 e04a5f0cb0e 1fb55dcb2e0 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B24-commit",
    "content": "Batch 24 COMMIT: git add -A && git commit -m \"cherry-pick: upstream ea7393f7fd5..1fb55dcb2e0 batch 24\"",
    "status": "pending"
  },
  {
    "id": "B25-exec",
    "content": "Batch 25 EXECUTE: reimplement b08b0d715b5 \u2014 Update system prompt to prefer non-interactive commands",
    "status": "pending"
  },
  {
    "id": "B25-review",
    "content": "Batch 25 REVIEW: verify b08b0d715b5 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B25-commit",
    "content": "Batch 25 COMMIT: git add -A && git commit -m \"reimplement: Update system prompt to prefer non-interactive commands (upstream b08b0d715b5)\"",
    "status": "pending"
  },
  {
    "id": "B26-exec",
    "content": "Batch 26 EXECUTE: reimplement 461c277bf2d \u2014 Support for Built-in Agent Skills",
    "status": "pending"
  },
  {
    "id": "B26-review",
    "content": "Batch 26 REVIEW: verify 461c277bf2d with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B26-commit",
    "content": "Batch 26 COMMIT: git add -A && git commit -m \"reimplement: Support for Built-in Agent Skills (upstream 461c277bf2d)\"",
    "status": "pending"
  },
  {
    "id": "B27-exec",
    "content": "Batch 27 EXECUTE: reimplement 0e955da1710 \u2014 feat(cli): add /chat debug command for nightly builds",
    "status": "pending"
  },
  {
    "id": "B27-review",
    "content": "Batch 27 REVIEW: verify 0e955da1710 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B27-commit",
    "content": "Batch 27 COMMIT: git add -A && git commit -m \"reimplement: feat(cli): add /chat debug command for nightly builds (upstream 0e955da1710)\"",
    "status": "pending"
  },
  {
    "id": "B28-exec",
    "content": "Batch 28 EXECUTE: cherry-pick 93b57b82c10 \u2014 style: format pr-creator skill",
    "status": "pending"
  },
  {
    "id": "B28-review",
    "content": "Batch 28 REVIEW: verify 93b57b82c10 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B28-commit",
    "content": "Batch 28 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 93b57b82c10 batch 28\"",
    "status": "pending"
  },
  {
    "id": "B29-exec",
    "content": "Batch 29 EXECUTE: reimplement 9703fe73cf9 \u2014 feat(cli): Hooks enable-all/disable-all feature with dynamic status",
    "status": "pending"
  },
  {
    "id": "B29-review",
    "content": "Batch 29 REVIEW: verify 9703fe73cf9 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B29-commit",
    "content": "Batch 29 COMMIT: git add -A && git commit -m \"reimplement: feat(cli): Hooks enable-all/disable-all feature with dynamic status (upstream 9703fe73cf9)\"",
    "status": "pending"
  },
  {
    "id": "B30-exec",
    "content": "Batch 30 EXECUTE: cherry-pick 64c75cb767c \u2014 Fix crash on unicode character",
    "status": "pending"
  },
  {
    "id": "B30-review",
    "content": "Batch 30 REVIEW: verify 64c75cb767c with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B30-commit",
    "content": "Batch 30 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 64c75cb767c batch 30\"",
    "status": "pending"
  },
  {
    "id": "B31-exec",
    "content": "Batch 31 EXECUTE: reimplement 950244f6b00 \u2014 Attempt to resolve OOM w/ useMemo on history items",
    "status": "pending"
  },
  {
    "id": "B31-review",
    "content": "Batch 31 REVIEW: verify 950244f6b00 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B31-commit",
    "content": "Batch 31 COMMIT: git add -A && git commit -m \"reimplement: Attempt to resolve OOM w/ useMemo on history items (upstream 950244f6b00)\"",
    "status": "pending"
  },
  {
    "id": "B32-exec",
    "content": "Batch 32 EXECUTE: reimplement 8a2e0fac0d8 \u2014 Add other hook wrapper methods to hooksystem",
    "status": "pending"
  },
  {
    "id": "B32-review",
    "content": "Batch 32 REVIEW: verify 8a2e0fac0d8 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B32-commit",
    "content": "Batch 32 COMMIT: git add -A && git commit -m \"reimplement: Add other hook wrapper methods to hooksystem (upstream 8a2e0fac0d8)\"",
    "status": "pending"
  },
  {
    "id": "B33-exec",
    "content": "Batch 33 EXECUTE: cherry-pick 15891721ad0 \u2014 feat: introduce useRewindLogic hook for conversation history navigation",
    "status": "pending"
  },
  {
    "id": "B33-review",
    "content": "Batch 33 REVIEW: verify 15891721ad0 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B33-commit",
    "content": "Batch 33 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 15891721ad0 batch 33\"",
    "status": "pending"
  },
  {
    "id": "B34-exec",
    "content": "Batch 34 EXECUTE: cherry-pick 64cde8d4395 \u2014 fix(policy): enhance shell command safety and parsing",
    "status": "pending"
  },
  {
    "id": "B34-review",
    "content": "Batch 34 REVIEW: verify 64cde8d4395 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B34-commit",
    "content": "Batch 34 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 64cde8d4395 batch 34\"",
    "status": "pending"
  },
  {
    "id": "B35-exec",
    "content": "Batch 35 EXECUTE: cherry-pick 3b678a4da0f 8437ce940a1 e049d5e4e8f \u2014 fix(core): avoid 'activate_skill' re-registration warning (+2 more)",
    "status": "pending"
  },
  {
    "id": "B35-review",
    "content": "Batch 35 REVIEW: verify 3b678a4da0f 8437ce940a1 e049d5e4e8f with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B35-commit",
    "content": "Batch 35 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 3b678a4da0f..e049d5e4e8f batch 35\"",
    "status": "pending"
  },
  {
    "id": "B36-exec",
    "content": "Batch 36 EXECUTE: cherry-pick 95d9a339966 \u2014 migrate yolo/auto-edit keybindings",
    "status": "pending"
  },
  {
    "id": "B36-review",
    "content": "Batch 36 REVIEW: verify 95d9a339966 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B36-commit",
    "content": "Batch 36 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 95d9a339966 batch 36\"",
    "status": "pending"
  },
  {
    "id": "B37-exec",
    "content": "Batch 37 EXECUTE: cherry-pick 2e8c6cfdbb8 \u2014 feat(cli): add install and uninstall commands for skills",
    "status": "pending"
  },
  {
    "id": "B37-review",
    "content": "Batch 37 REVIEW: verify 2e8c6cfdbb8 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B37-commit",
    "content": "Batch 37 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 2e8c6cfdbb8 batch 37\"",
    "status": "pending"
  },
  {
    "id": "B38-exec",
    "content": "Batch 38 EXECUTE: cherry-pick ca6786a28bd \u2014 feat(ui): use Tab to switch focus between shell and input",
    "status": "pending"
  },
  {
    "id": "B38-review",
    "content": "Batch 38 REVIEW: verify ca6786a28bd with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B38-commit",
    "content": "Batch 38 COMMIT: git add -A && git commit -m \"cherry-pick: upstream ca6786a28bd batch 38\"",
    "status": "pending"
  },
  {
    "id": "B39-exec",
    "content": "Batch 39 EXECUTE: cherry-pick e9c9dd1d672 \u2014 feat(core): support shipping built-in skills with the CLI",
    "status": "pending"
  },
  {
    "id": "B39-review",
    "content": "Batch 39 REVIEW: verify e9c9dd1d672 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B39-commit",
    "content": "Batch 39 COMMIT: git add -A && git commit -m \"cherry-pick: upstream e9c9dd1d672 batch 39\"",
    "status": "pending"
  },
  {
    "id": "B40-exec",
    "content": "Batch 40 EXECUTE: cherry-pick 8d3e93cdb0d \u2014 Migrate keybindings",
    "status": "pending"
  },
  {
    "id": "B40-review",
    "content": "Batch 40 REVIEW: verify 8d3e93cdb0d with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B40-commit",
    "content": "Batch 40 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 8d3e93cdb0d batch 40\"",
    "status": "pending"
  },
  {
    "id": "B41-exec",
    "content": "Batch 41 EXECUTE: reimplement c572b9e9ac6 \u2014 feat(cli): cleanup activity logs alongside session files",
    "status": "pending"
  },
  {
    "id": "B41-review",
    "content": "Batch 41 REVIEW: verify c572b9e9ac6 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B41-commit",
    "content": "Batch 41 COMMIT: git add -A && git commit -m \"reimplement: feat(cli): cleanup activity logs alongside session files (upstream c572b9e9ac6)\"",
    "status": "pending"
  },
  {
    "id": "B42-exec",
    "content": "Batch 42 EXECUTE: cherry-pick 2fc61685a32 \u2014 feat(cli): implement dynamic terminal tab titles for CLI status",
    "status": "pending"
  },
  {
    "id": "B42-review",
    "content": "Batch 42 REVIEW: verify 2fc61685a32 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B42-commit",
    "content": "Batch 42 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 2fc61685a32 batch 42\"",
    "status": "pending"
  },
  {
    "id": "B43-exec",
    "content": "Batch 43 EXECUTE: cherry-pick 6adae9f7756 \u2014 fix: Set both tab and window title instead of just window title",
    "status": "pending"
  },
  {
    "id": "B43-review",
    "content": "Batch 43 REVIEW: verify 6adae9f7756 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B43-commit",
    "content": "Batch 43 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 6adae9f7756 batch 43\"",
    "status": "pending"
  },
  {
    "id": "B44-exec",
    "content": "Batch 44 EXECUTE: reimplement 304caa4e43a \u2014 fix(cli): refine 'Action Required' indicator and focus hints",
    "status": "pending"
  },
  {
    "id": "B44-review",
    "content": "Batch 44 REVIEW: verify 304caa4e43a with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B44-commit",
    "content": "Batch 44 COMMIT: git add -A && git commit -m \"reimplement: fix(cli): refine 'Action Required' indicator and focus hints (upstream 304caa4e43a)\"",
    "status": "pending"
  },
  {
    "id": "B45-exec",
    "content": "Batch 45 EXECUTE: reimplement a6dca02344b \u2014 Refactor beforeAgent and afterAgent hookEvents to follow desired output",
    "status": "pending"
  },
  {
    "id": "B45-review",
    "content": "Batch 45 REVIEW: verify a6dca02344b with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B45-commit",
    "content": "Batch 45 COMMIT: git add -A && git commit -m \"reimplement: Refactor beforeAgent and afterAgent hookEvents to follow desired output (upstream a6dca02344b)\"",
    "status": "pending"
  },
  {
    "id": "B46-exec",
    "content": "Batch 46 EXECUTE: reimplement aa524625503 \u2014 Implement support for subagents as extensions.",
    "status": "pending"
  },
  {
    "id": "B46-review",
    "content": "Batch 46 REVIEW: verify aa524625503 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B46-commit",
    "content": "Batch 46 COMMIT: git add -A && git commit -m \"reimplement: Implement support for subagents as extensions. (upstream aa524625503)\"",
    "status": "pending"
  },
  {
    "id": "B47-exec",
    "content": "Batch 47 EXECUTE: cherry-pick 91fcca3b1c7 e931ebe581b \u2014 refactor: make baseTimestamp optional in addItem and remove redundant calls (+1 more)",
    "status": "pending"
  },
  {
    "id": "B47-review",
    "content": "Batch 47 REVIEW: verify 91fcca3b1c7 e931ebe581b with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B47-commit",
    "content": "Batch 47 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 91fcca3b1c7..e931ebe581b batch 47\"",
    "status": "pending"
  },
  {
    "id": "B48-exec",
    "content": "Batch 48 EXECUTE: reimplement 92e31e3c4ae \u2014 feat(core, cli): Add support for agents in settings.json.",
    "status": "pending"
  },
  {
    "id": "B48-review",
    "content": "Batch 48 REVIEW: verify 92e31e3c4ae with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B48-commit",
    "content": "Batch 48 COMMIT: git add -A && git commit -m \"reimplement: feat(core, cli): Add support for agents in settings.json. (upstream 92e31e3c4ae)\"",
    "status": "pending"
  },
  {
    "id": "B49-exec",
    "content": "Batch 49 EXECUTE: cherry-pick e8be252b755 c7c409c68fb 778de55fd8c 8dbaa2bceaf \u2014 fix(cli): fix 'gemini skills install' unknown argument error (+3 more)",
    "status": "pending"
  },
  {
    "id": "B49-review",
    "content": "Batch 49 REVIEW: verify e8be252b755 c7c409c68fb 778de55fd8c 8dbaa2bceaf with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B49-commit",
    "content": "Batch 49 COMMIT: git add -A && git commit -m \"cherry-pick: upstream e8be252b755..8dbaa2bceaf batch 49\"",
    "status": "pending"
  },
  {
    "id": "B50-exec",
    "content": "Batch 50 EXECUTE: cherry-pick eda47f587cf \u2014 fix(core): Resolve race condition in tool response reporting",
    "status": "pending"
  },
  {
    "id": "B50-review",
    "content": "Batch 50 REVIEW: verify eda47f587cf with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B50-commit",
    "content": "Batch 50 COMMIT: git add -A && git commit -m \"cherry-pick: upstream eda47f587cf batch 50\"",
    "status": "pending"
  },
  {
    "id": "B51-exec",
    "content": "Batch 51 EXECUTE: reimplement 8030404b08b \u2014 Behavioral evals framework.",
    "status": "pending"
  },
  {
    "id": "B51-review",
    "content": "Batch 51 REVIEW: verify 8030404b08b with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B51-commit",
    "content": "Batch 51 COMMIT: git add -A && git commit -m \"reimplement: Behavioral evals framework. (upstream 8030404b08b)\"",
    "status": "pending"
  },
  {
    "id": "B52-exec",
    "content": "Batch 52 EXECUTE: reimplement 66e7b479ae4 \u2014 Aggregate test results.",
    "status": "pending"
  },
  {
    "id": "B52-review",
    "content": "Batch 52 REVIEW: verify 66e7b479ae4 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B52-commit",
    "content": "Batch 52 COMMIT: git add -A && git commit -m \"reimplement: Aggregate test results. (upstream 66e7b479ae4)\"",
    "status": "pending"
  },
  {
    "id": "B53-exec",
    "content": "Batch 53 EXECUTE: cherry-pick bb6c5741443 f6a5fa0e03a \u2014 feat(admin): support admin-enforced settings for Agent Skills (+1 more)",
    "status": "pending"
  },
  {
    "id": "B53-review",
    "content": "Batch 53 REVIEW: verify bb6c5741443 f6a5fa0e03a with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B53-commit",
    "content": "Batch 53 COMMIT: git add -A && git commit -m \"cherry-pick: upstream bb6c5741443..f6a5fa0e03a batch 53\"",
    "status": "pending"
  },
  {
    "id": "B54-exec",
    "content": "Batch 54 EXECUTE: cherry-pick ea0e3de4302 \u2014 fix(core): deduplicate ModelInfo emission in GeminiClient",
    "status": "pending"
  },
  {
    "id": "B54-review",
    "content": "Batch 54 REVIEW: verify ea0e3de4302 with FULL verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B54-commit",
    "content": "Batch 54 COMMIT: git add -A && git commit -m \"cherry-pick: upstream ea0e3de4302 batch 54\"",
    "status": "pending"
  },
  {
    "id": "B55-exec",
    "content": "Batch 55 EXECUTE: cherry-pick 217f2775805 \u2014 fix: update currentSequenceModel when modelChanged",
    "status": "pending"
  },
  {
    "id": "B55-review",
    "content": "Batch 55 REVIEW: verify 217f2775805 with QUICK verification and per-commit landed/functional/integration checks",
    "status": "pending"
  },
  {
    "id": "B55-commit",
    "content": "Batch 55 COMMIT: git add -A && git commit -m \"cherry-pick: upstream 217f2775805 batch 55\"",
    "status": "pending"
  },
  {
    "id": "FINAL-progress",
    "content": "UPDATE PROGRESS.md with statuses, commit hashes, and batch notes",
    "status": "pending"
  },
  {
    "id": "FINAL-notes",
    "content": "APPEND NOTES.md with conflicts, deviations, remediation loops, and follow-ups",
    "status": "pending"
  },
  {
    "id": "FINAL-audit",
    "content": "UPDATE AUDIT.md with upstream SHA outcomes, LLxprt commit hashes, and adaptation notes",
    "status": "pending"
  },
  {
    "id": "FINAL-pr-prep",
    "content": "PREPARE final verification and PR metadata after all batches are complete",
    "status": "pending"
  }
]
})

```


## Batch Schedule Overview


| Batch | Type | Verify | Upstream SHA(s) | Command / Playbook | Summary |

| --- | --- | --- | --- | --- | --- |

| B1 | PICK | QUICK | `da85e3f8f23 982eee63b61 a26463b056d 2d683bb6f8a` | `git cherry-pick -n ...` | feat(core): improve activate_skill tool and use lowercase XML tags (#16009) (+3 more) |

| B2 | REIMPLEMENT | FULL | `5fe5d1da467` | [`5fe5d1da467-plan.md`](./5fe5d1da467-plan.md) | policy: extract legacy policy from core tool scheduler to policy engine (#15902) |

| B3 | REIMPLEMENT | QUICK | `416d243027d` | [`416d243027d-plan.md`](./416d243027d-plan.md) | Enhance TestRig with process management and timeouts (#15908) |

| B4 | PICK | FULL | `8f9bb6bccc6` | `git cherry-pick -n ...` | Update troubleshooting doc for UNABLE_TO_GET_ISSUER_CERT_LOCALLY (#16069) |

| B5 | REIMPLEMENT | QUICK | `97b31c4eefa` | [`97b31c4eefa-plan.md`](./97b31c4eefa-plan.md) | Simplify extension settings command (#16001) |

| B6 | PICK | FULL | `57012ae5b33` | `git cherry-pick -n ...` | Core data structure updates for Rewind functionality (#15714) |

| B7 | REIMPLEMENT | QUICK | `c64b5ec4a3a` | [`c64b5ec4a3a-plan.md`](./c64b5ec4a3a-plan.md) | feat(hooks): simplify hook firing with HookSystem wrapper methods (#15982) |

| B8 | REIMPLEMENT | FULL | `4c961df3136` | [`4c961df3136-plan.md`](./4c961df3136-plan.md) | feat(core): Decouple enabling hooks UI from subsystem. (#16074) |

| B9 | REIMPLEMENT | QUICK | `17b3eb730a9` | [`17b3eb730a9-plan.md`](./17b3eb730a9-plan.md) | docs: add docs for hooks + extensions (#16073) |

| B10 | PICK | FULL | `1bd4f9d8b6f d48c934357c 3e2f4eb8ba1 722c4933dc3` | `git cherry-pick -n ...` | Optimize json-output tests with mock responses (#16102) (+3 more) |

| B11 | REIMPLEMENT | QUICK | `030847a80a4` | [`030847a80a4-plan.md`](./030847a80a4-plan.md) | feat(cli): export chat history in /bug and prefill GitHub issue (#16115) |

| B12 | REIMPLEMENT | FULL | `97ad3d97cba` | [`97ad3d97cba-plan.md`](./97ad3d97cba-plan.md) | Reapply "feat(admin): implement extensions disabled" (#16082) (#16109) |

| B13 | REIMPLEMENT | QUICK | `660368f2490` | [`660368f2490-plan.md`](./660368f2490-plan.md) | bug(core): Fix spewie getter in hookTranslator.ts (#16108) |

| B14 | REIMPLEMENT | FULL | `eb3f3cfdb8a` | [`eb3f3cfdb8a-plan.md`](./eb3f3cfdb8a-plan.md) | feat(hooks): add mcp_context to BeforeTool and AfterTool hook inputs (#15656) |

| B15 | PICK | QUICK | `1a4ae413978` | `git cherry-pick -n ...` | fix: yolo should auto allow redirection (#16183) |

| B16 | PICK | FULL | `f8138262fa7 fbfad06307c 01d2d437372 e5f7a9c4240 4ab1b9895ad` | `git cherry-pick -n ...` | fix(cli): disableYoloMode shouldn't enforce default approval mode against args (#16155) (+4 more) |

| B17 | REIMPLEMENT | QUICK | `18dd399cb57` | [`18dd399cb57-plan.md`](./18dd399cb57-plan.md) | Support @ suggestions for subagents (#16201) |

| B18 | REIMPLEMENT | FULL | `e1e3efc9d04` | [`e1e3efc9d04-plan.md`](./e1e3efc9d04-plan.md) | feat(hooks): Support explicit stop and block execution control in model hooks (#15947) |

| B19 | REIMPLEMENT | QUICK | `41e627a7ee4` | [`41e627a7ee4-plan.md`](./41e627a7ee4-plan.md) | Refine Gemini 3 system instructions to reduce model verbosity (#16139) |

| B20 | PICK | FULL | `88f1ec8d0ae` | `git cherry-pick -n ...` | Always enable bracketed paste (#16179) |

| B21 | REIMPLEMENT | QUICK | `77e226c55fe` | [`77e226c55fe-plan.md`](./77e226c55fe-plan.md) | Show settings source in extensions lists (#16207) |

| B22 | PICK | FULL | `8bc3cfe29a6 c1401682ed0 14f0cb45389` | `git cherry-pick -n ...` | feat(skills): add pr-creator skill and enable skills (#16232) (+2 more) |

| B23 | REIMPLEMENT | QUICK | `c7d17dda49d` | [`c7d17dda49d-plan.md`](./c7d17dda49d-plan.md) | fix: properly use systemMessage for hooks in UI (#16250) |

| B24 | PICK | FULL | `ea7393f7fd5 e04a5f0cb0e 1fb55dcb2e0` | `git cherry-pick -n ...` | Infer modifyOtherKeys support (#16270) (+2 more) |

| B25 | REIMPLEMENT | QUICK | `b08b0d715b5` | [`b08b0d715b5-plan.md`](./b08b0d715b5-plan.md) | Update system prompt to prefer non-interactive commands (#16117) |

| B26 | REIMPLEMENT | FULL | `461c277bf2d` | [`461c277bf2d-plan.md`](./461c277bf2d-plan.md) | Support for Built-in Agent Skills (#16045) |

| B27 | REIMPLEMENT | QUICK | `0e955da1710` | [`0e955da1710-plan.md`](./0e955da1710-plan.md) | feat(cli): add /chat debug command for nightly builds (#16339) |

| B28 | PICK | FULL | `93b57b82c10` | `git cherry-pick -n ...` | style: format pr-creator skill (#16381) |

| B29 | REIMPLEMENT | QUICK | `9703fe73cf9` | [`9703fe73cf9-plan.md`](./9703fe73cf9-plan.md) | feat(cli): Hooks enable-all/disable-all feature with dynamic status (#15552) |

| B30 | PICK | FULL | `64c75cb767c` | `git cherry-pick -n ...` | Fix crash on unicode character (#16420) |

| B31 | REIMPLEMENT | QUICK | `950244f6b00` | [`950244f6b00-plan.md`](./950244f6b00-plan.md) | Attempt to resolve OOM w/ useMemo on history items (#16424) |

| B32 | REIMPLEMENT | FULL | `8a2e0fac0d8` | [`8a2e0fac0d8-plan.md`](./8a2e0fac0d8-plan.md) | Add other hook wrapper methods to hooksystem (#16361) |

| B33 | PICK | QUICK | `15891721ad0` | `git cherry-pick -n ...` | feat: introduce useRewindLogic hook for conversation history navigation (#15716) |

| B34 | PICK | FULL | `64cde8d4395` | `git cherry-pick -n ...` | fix(policy): enhance shell command safety and parsing (#15034) |

| B35 | PICK | QUICK | `3b678a4da0f 8437ce940a1 e049d5e4e8f` | `git cherry-pick -n ...` | fix(core): avoid 'activate_skill' re-registration warning (#16398) (+2 more) |

| B36 | PICK | FULL | `95d9a339966` | `git cherry-pick -n ...` | migrate yolo/auto-edit keybindings (#16457) |

| B37 | PICK | QUICK | `2e8c6cfdbb8` | `git cherry-pick -n ...` | feat(cli): add install and uninstall commands for skills (#16377) |

| B38 | PICK | FULL | `ca6786a28bd` | `git cherry-pick -n ...` | feat(ui): use Tab to switch focus between shell and input (#14332) |

| B39 | PICK | QUICK | `e9c9dd1d672` | `git cherry-pick -n ...` | feat(core): support shipping built-in skills with the CLI (#16300) |

| B40 | PICK | FULL | `8d3e93cdb0d` | `git cherry-pick -n ...` | Migrate keybindings (#16460) |

| B41 | REIMPLEMENT | QUICK | `c572b9e9ac6` | [`c572b9e9ac6-plan.md`](./c572b9e9ac6-plan.md) | feat(cli): cleanup activity logs alongside session files (#16399) |

| B42 | PICK | FULL | `2fc61685a32` | `git cherry-pick -n ...` | feat(cli): implement dynamic terminal tab titles for CLI status (#16378) |

| B43 | PICK | QUICK | `6adae9f7756` | `git cherry-pick -n ...` | fix: Set both tab and window title instead of just window title (#16464) |

| B44 | REIMPLEMENT | FULL | `304caa4e43a` | [`304caa4e43a-plan.md`](./304caa4e43a-plan.md) | fix(cli): refine 'Action Required' indicator and focus hints (#16497) |

| B45 | REIMPLEMENT | QUICK | `a6dca02344b` | [`a6dca02344b-plan.md`](./a6dca02344b-plan.md) | Refactor beforeAgent and afterAgent hookEvents to follow desired output (#16495) |

| B46 | REIMPLEMENT | FULL | `aa524625503` | [`aa524625503-plan.md`](./aa524625503-plan.md) | Implement support for subagents as extensions. (#16473) |

| B47 | PICK | QUICK | `91fcca3b1c7 e931ebe581b` | `git cherry-pick -n ...` | refactor: make baseTimestamp optional in addItem and remove redundant calls (#16471) (+1 more) |

| B48 | REIMPLEMENT | FULL | `92e31e3c4ae` | [`92e31e3c4ae-plan.md`](./92e31e3c4ae-plan.md) | feat(core, cli): Add support for agents in settings.json. (#16433) |

| B49 | PICK | QUICK | `e8be252b755 c7c409c68fb 778de55fd8c 8dbaa2bceaf` | `git cherry-pick -n ...` | fix(cli): fix 'gemini skills install' unknown argument error (#16537) (+3 more) |

| B50 | PICK | FULL | `eda47f587cf` | `git cherry-pick -n ...` | fix(core): Resolve race condition in tool response reporting (#16557) |

| B51 | REIMPLEMENT | QUICK | `8030404b08b` | [`8030404b08b-plan.md`](./8030404b08b-plan.md) | Behavioral evals framework. (#16047) |

| B52 | REIMPLEMENT | FULL | `66e7b479ae4` | [`66e7b479ae4-plan.md`](./66e7b479ae4-plan.md) | Aggregate test results. (#16581) |

| B53 | PICK | QUICK | `bb6c5741443 f6a5fa0e03a` | `git cherry-pick -n ...` | feat(admin): support admin-enforced settings for Agent Skills (#16406) (+1 more) |

| B54 | PICK | FULL | `ea0e3de4302` | `git cherry-pick -n ...` | fix(core): deduplicate ModelInfo emission in GeminiClient (#17075) |

| B55 | PICK | QUICK | `217f2775805` | `git cherry-pick -n ...` | fix: update currentSequenceModel when modelChanged (#17051) |


## Detailed Batch Instructions


### B1 — PICK

        - **Upstream SHA(s):** `da85e3f8f23 982eee63b61 a26463b056d 2d683bb6f8a`
        - **Subjects:**
        - `da85e3f8f23` — feat(core): improve activate_skill tool and use lowercase XML tags (#16009)
- `982eee63b61` — Hx support (#16032)
- `a26463b056d` — [Skills] Foundation: Centralize management logic and feedback rendering (#15952)
- `2d683bb6f8a` — [Skills] Multi-scope skill enablement and shadowing fix (#15953)
        - **Exact command / playbook:** `git cherry-pick -n da85e3f8f23 982eee63b61 a26463b056d 2d683bb6f8a`
        - **Commit message template:** `cherry-pick: upstream da85e3f8f23..2d683bb6f8a batch 01`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B1 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): da85e3f8f23, 982eee63b61, a26463b056d, 2d683bb6f8a
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- da85e3f8f23 — feat(core): improve activate_skill tool and use lowercase XML tags (#16009)
- 982eee63b61 — Hx support (#16032)
- a26463b056d — [Skills] Foundation: Centralize management logic and feedback rendering (#15952)
- 2d683bb6f8a — [Skills] Multi-scope skill enablement and shadowing fix (#15953)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n da85e3f8f23 982eee63b61 a26463b056d 2d683bb6f8a`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B1 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): da85e3f8f23, 982eee63b61, a26463b056d, 2d683bb6f8a
- Required verification level: QUICK

Upstream subjects:
- da85e3f8f23 — feat(core): improve activate_skill tool and use lowercase XML tags (#16009)
- 982eee63b61 — Hx support (#16032)
- a26463b056d — [Skills] Foundation: Centralize management logic and feedback rendering (#15952)
- 2d683bb6f8a — [Skills] Multi-scope skill enablement and shadowing fix (#15953)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B2 — REIMPLEMENT

        - **Upstream SHA(s):** `5fe5d1da467`
        - **Subjects:**
        - `5fe5d1da467` — policy: extract legacy policy from core tool scheduler to policy engine (#15902)
        - **Exact command / playbook:** Follow [`5fe5d1da467-plan.md`](./5fe5d1da467-plan.md).
        - **Commit message template:** `reimplement: policy: extract legacy policy from core tool scheduler to policy engine (upstream 5fe5d1da467)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B2 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 5fe5d1da467
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 5fe5d1da467 — policy: extract legacy policy from core tool scheduler to policy engine (#15902)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/5fe5d1da467-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B2 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 5fe5d1da467
- Required verification level: FULL

Upstream subjects:
- 5fe5d1da467 — policy: extract legacy policy from core tool scheduler to policy engine (#15902)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B3 — REIMPLEMENT

        - **Upstream SHA(s):** `416d243027d`
        - **Subjects:**
        - `416d243027d` — Enhance TestRig with process management and timeouts (#15908)
        - **Exact command / playbook:** Follow [`416d243027d-plan.md`](./416d243027d-plan.md).
        - **Commit message template:** `reimplement: Enhance TestRig with process management and timeouts (upstream 416d243027d)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B3 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 416d243027d
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 416d243027d — Enhance TestRig with process management and timeouts (#15908)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/416d243027d-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B3 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 416d243027d
- Required verification level: QUICK

Upstream subjects:
- 416d243027d — Enhance TestRig with process management and timeouts (#15908)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B4 — PICK

        - **Upstream SHA(s):** `8f9bb6bccc6`
        - **Subjects:**
        - `8f9bb6bccc6` — Update troubleshooting doc for UNABLE_TO_GET_ISSUER_CERT_LOCALLY (#16069)
        - **Exact command / playbook:** `git cherry-pick -n 8f9bb6bccc6`
        - **Commit message template:** `cherry-pick: upstream 8f9bb6bccc6 batch 04`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B4 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 8f9bb6bccc6
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 8f9bb6bccc6 — Update troubleshooting doc for UNABLE_TO_GET_ISSUER_CERT_LOCALLY (#16069)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 8f9bb6bccc6`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B4 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 8f9bb6bccc6
- Required verification level: FULL

Upstream subjects:
- 8f9bb6bccc6 — Update troubleshooting doc for UNABLE_TO_GET_ISSUER_CERT_LOCALLY (#16069)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B5 — REIMPLEMENT

        - **Upstream SHA(s):** `97b31c4eefa`
        - **Subjects:**
        - `97b31c4eefa` — Simplify extension settings command (#16001)
        - **Exact command / playbook:** Follow [`97b31c4eefa-plan.md`](./97b31c4eefa-plan.md).
        - **Commit message template:** `reimplement: Simplify extension settings command (upstream 97b31c4eefa)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B5 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 97b31c4eefa
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 97b31c4eefa — Simplify extension settings command (#16001)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/97b31c4eefa-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B5 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 97b31c4eefa
- Required verification level: QUICK

Upstream subjects:
- 97b31c4eefa — Simplify extension settings command (#16001)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B6 — PICK

        - **Upstream SHA(s):** `57012ae5b33`
        - **Subjects:**
        - `57012ae5b33` — Core data structure updates for Rewind functionality (#15714)
        - **Exact command / playbook:** `git cherry-pick -n 57012ae5b33`
        - **Commit message template:** `cherry-pick: upstream 57012ae5b33 batch 06`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B6 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 57012ae5b33
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 57012ae5b33 — Core data structure updates for Rewind functionality (#15714)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 57012ae5b33`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B6 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 57012ae5b33
- Required verification level: FULL

Upstream subjects:
- 57012ae5b33 — Core data structure updates for Rewind functionality (#15714)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B7 — REIMPLEMENT

        - **Upstream SHA(s):** `c64b5ec4a3a`
        - **Subjects:**
        - `c64b5ec4a3a` — feat(hooks): simplify hook firing with HookSystem wrapper methods (#15982)
        - **Exact command / playbook:** Follow [`c64b5ec4a3a-plan.md`](./c64b5ec4a3a-plan.md).
        - **Commit message template:** `reimplement: feat(hooks): simplify hook firing with HookSystem wrapper methods (upstream c64b5ec4a3a)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B7 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): c64b5ec4a3a
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- c64b5ec4a3a — feat(hooks): simplify hook firing with HookSystem wrapper methods (#15982)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/c64b5ec4a3a-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B7 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): c64b5ec4a3a
- Required verification level: QUICK

Upstream subjects:
- c64b5ec4a3a — feat(hooks): simplify hook firing with HookSystem wrapper methods (#15982)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B8 — REIMPLEMENT

        - **Upstream SHA(s):** `4c961df3136`
        - **Subjects:**
        - `4c961df3136` — feat(core): Decouple enabling hooks UI from subsystem. (#16074)
        - **Exact command / playbook:** Follow [`4c961df3136-plan.md`](./4c961df3136-plan.md).
        - **Commit message template:** `reimplement: feat(core): Decouple enabling hooks UI from subsystem. (upstream 4c961df3136)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B8 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 4c961df3136
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 4c961df3136 — feat(core): Decouple enabling hooks UI from subsystem. (#16074)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/4c961df3136-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B8 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 4c961df3136
- Required verification level: FULL

Upstream subjects:
- 4c961df3136 — feat(core): Decouple enabling hooks UI from subsystem. (#16074)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B9 — REIMPLEMENT

        - **Upstream SHA(s):** `17b3eb730a9`
        - **Subjects:**
        - `17b3eb730a9` — docs: add docs for hooks + extensions (#16073)
        - **Exact command / playbook:** Follow [`17b3eb730a9-plan.md`](./17b3eb730a9-plan.md).
        - **Commit message template:** `reimplement: docs: add docs for hooks + extensions (upstream 17b3eb730a9)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B9 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 17b3eb730a9
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 17b3eb730a9 — docs: add docs for hooks + extensions (#16073)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/17b3eb730a9-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B9 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 17b3eb730a9
- Required verification level: QUICK

Upstream subjects:
- 17b3eb730a9 — docs: add docs for hooks + extensions (#16073)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B10 — PICK

        - **Upstream SHA(s):** `1bd4f9d8b6f d48c934357c 3e2f4eb8ba1 722c4933dc3`
        - **Subjects:**
        - `1bd4f9d8b6f` — Optimize json-output tests with mock responses (#16102)
- `d48c934357c` — feat(cli): add filepath autosuggestion after slash commands (#14738)
- `3e2f4eb8ba1` — [Skills] UX Polishing: Transparent feedback and CLI refinements (#15954)
- `722c4933dc3` — Polish: Move 'Failed to load skills' warning to debug logs (#16142)
        - **Exact command / playbook:** `git cherry-pick -n 1bd4f9d8b6f d48c934357c 3e2f4eb8ba1 722c4933dc3`
        - **Commit message template:** `cherry-pick: upstream 1bd4f9d8b6f..722c4933dc3 batch 10`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B10 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 1bd4f9d8b6f, d48c934357c, 3e2f4eb8ba1, 722c4933dc3
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 1bd4f9d8b6f — Optimize json-output tests with mock responses (#16102)
- d48c934357c — feat(cli): add filepath autosuggestion after slash commands (#14738)
- 3e2f4eb8ba1 — [Skills] UX Polishing: Transparent feedback and CLI refinements (#15954)
- 722c4933dc3 — Polish: Move 'Failed to load skills' warning to debug logs (#16142)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 1bd4f9d8b6f d48c934357c 3e2f4eb8ba1 722c4933dc3`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B10 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 1bd4f9d8b6f, d48c934357c, 3e2f4eb8ba1, 722c4933dc3
- Required verification level: FULL

Upstream subjects:
- 1bd4f9d8b6f — Optimize json-output tests with mock responses (#16102)
- d48c934357c — feat(cli): add filepath autosuggestion after slash commands (#14738)
- 3e2f4eb8ba1 — [Skills] UX Polishing: Transparent feedback and CLI refinements (#15954)
- 722c4933dc3 — Polish: Move 'Failed to load skills' warning to debug logs (#16142)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B11 — REIMPLEMENT

        - **Upstream SHA(s):** `030847a80a4`
        - **Subjects:**
        - `030847a80a4` — feat(cli): export chat history in /bug and prefill GitHub issue (#16115)
        - **Exact command / playbook:** Follow [`030847a80a4-plan.md`](./030847a80a4-plan.md).
        - **Commit message template:** `reimplement: feat(cli): export chat history in /bug and prefill GitHub issue (upstream 030847a80a4)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B11 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 030847a80a4
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 030847a80a4 — feat(cli): export chat history in /bug and prefill GitHub issue (#16115)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/030847a80a4-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B11 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 030847a80a4
- Required verification level: QUICK

Upstream subjects:
- 030847a80a4 — feat(cli): export chat history in /bug and prefill GitHub issue (#16115)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B12 — REIMPLEMENT

        - **Upstream SHA(s):** `97ad3d97cba`
        - **Subjects:**
        - `97ad3d97cba` — Reapply "feat(admin): implement extensions disabled" (#16082) (#16109)
        - **Exact command / playbook:** Follow [`97ad3d97cba-plan.md`](./97ad3d97cba-plan.md).
        - **Commit message template:** `reimplement: Reapply "feat(admin): implement extensions disabled" (#16082) (upstream 97ad3d97cba)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B12 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 97ad3d97cba
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 97ad3d97cba — Reapply "feat(admin): implement extensions disabled" (#16082) (#16109)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/97ad3d97cba-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B12 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 97ad3d97cba
- Required verification level: FULL

Upstream subjects:
- 97ad3d97cba — Reapply "feat(admin): implement extensions disabled" (#16082) (#16109)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B13 — REIMPLEMENT

        - **Upstream SHA(s):** `660368f2490`
        - **Subjects:**
        - `660368f2490` — bug(core): Fix spewie getter in hookTranslator.ts (#16108)
        - **Exact command / playbook:** Follow [`660368f2490-plan.md`](./660368f2490-plan.md).
        - **Commit message template:** `reimplement: bug(core): Fix spewie getter in hookTranslator.ts (upstream 660368f2490)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B13 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 660368f2490
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 660368f2490 — bug(core): Fix spewie getter in hookTranslator.ts (#16108)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/660368f2490-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B13 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 660368f2490
- Required verification level: QUICK

Upstream subjects:
- 660368f2490 — bug(core): Fix spewie getter in hookTranslator.ts (#16108)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B14 — REIMPLEMENT

        - **Upstream SHA(s):** `eb3f3cfdb8a`
        - **Subjects:**
        - `eb3f3cfdb8a` — feat(hooks): add mcp_context to BeforeTool and AfterTool hook inputs (#15656)
        - **Exact command / playbook:** Follow [`eb3f3cfdb8a-plan.md`](./eb3f3cfdb8a-plan.md).
        - **Commit message template:** `reimplement: feat(hooks): add mcp_context to BeforeTool and AfterTool hook inputs (upstream eb3f3cfdb8a)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B14 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): eb3f3cfdb8a
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- eb3f3cfdb8a — feat(hooks): add mcp_context to BeforeTool and AfterTool hook inputs (#15656)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/eb3f3cfdb8a-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B14 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): eb3f3cfdb8a
- Required verification level: FULL

Upstream subjects:
- eb3f3cfdb8a — feat(hooks): add mcp_context to BeforeTool and AfterTool hook inputs (#15656)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B15 — PICK

        - **Upstream SHA(s):** `1a4ae413978`
        - **Subjects:**
        - `1a4ae413978` — fix: yolo should auto allow redirection (#16183)
        - **Exact command / playbook:** `git cherry-pick -n 1a4ae413978`
        - **Commit message template:** `cherry-pick: upstream 1a4ae413978 batch 15`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B15 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 1a4ae413978
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 1a4ae413978 — fix: yolo should auto allow redirection (#16183)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 1a4ae413978`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B15 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 1a4ae413978
- Required verification level: QUICK

Upstream subjects:
- 1a4ae413978 — fix: yolo should auto allow redirection (#16183)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B16 — PICK

        - **Upstream SHA(s):** `f8138262fa7 fbfad06307c 01d2d437372 e5f7a9c4240 4ab1b9895ad`
        - **Subjects:**
        - `f8138262fa7` — fix(cli): disableYoloMode shouldn't enforce default approval mode against args (#16155)
- `fbfad06307c` — feat: add native Sublime Text support to IDE detection (#16083)
- `01d2d437372` — Add support for Antigravity terminal in terminal setup utility (#16051)
- `e5f7a9c4240` — feat: implement file system reversion utilities for rewind (#15715)
- `4ab1b9895ad` — Ensure TERM is set to xterm-256color (#15828)
        - **Exact command / playbook:** `git cherry-pick -n f8138262fa7 fbfad06307c 01d2d437372 e5f7a9c4240 4ab1b9895ad`
        - **Commit message template:** `cherry-pick: upstream f8138262fa7..4ab1b9895ad batch 16`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B16 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): f8138262fa7, fbfad06307c, 01d2d437372, e5f7a9c4240, 4ab1b9895ad
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- f8138262fa7 — fix(cli): disableYoloMode shouldn't enforce default approval mode against args (#16155)
- fbfad06307c — feat: add native Sublime Text support to IDE detection (#16083)
- 01d2d437372 — Add support for Antigravity terminal in terminal setup utility (#16051)
- e5f7a9c4240 — feat: implement file system reversion utilities for rewind (#15715)
- 4ab1b9895ad — Ensure TERM is set to xterm-256color (#15828)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n f8138262fa7 fbfad06307c 01d2d437372 e5f7a9c4240 4ab1b9895ad`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B16 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): f8138262fa7, fbfad06307c, 01d2d437372, e5f7a9c4240, 4ab1b9895ad
- Required verification level: FULL

Upstream subjects:
- f8138262fa7 — fix(cli): disableYoloMode shouldn't enforce default approval mode against args (#16155)
- fbfad06307c — feat: add native Sublime Text support to IDE detection (#16083)
- 01d2d437372 — Add support for Antigravity terminal in terminal setup utility (#16051)
- e5f7a9c4240 — feat: implement file system reversion utilities for rewind (#15715)
- 4ab1b9895ad — Ensure TERM is set to xterm-256color (#15828)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B17 — REIMPLEMENT

        - **Upstream SHA(s):** `18dd399cb57`
        - **Subjects:**
        - `18dd399cb57` — Support @ suggestions for subagents (#16201)
        - **Exact command / playbook:** Follow [`18dd399cb57-plan.md`](./18dd399cb57-plan.md).
        - **Commit message template:** `reimplement: Support @ suggestions for subagents (upstream 18dd399cb57)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B17 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 18dd399cb57
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 18dd399cb57 — Support @ suggestions for subagents (#16201)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/18dd399cb57-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B17 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 18dd399cb57
- Required verification level: QUICK

Upstream subjects:
- 18dd399cb57 — Support @ suggestions for subagents (#16201)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B18 — REIMPLEMENT

        - **Upstream SHA(s):** `e1e3efc9d04`
        - **Subjects:**
        - `e1e3efc9d04` — feat(hooks): Support explicit stop and block execution control in model hooks (#15947)
        - **Exact command / playbook:** Follow [`e1e3efc9d04-plan.md`](./e1e3efc9d04-plan.md).
        - **Commit message template:** `reimplement: feat(hooks): Support explicit stop and block execution control in model hooks (upstream e1e3efc9d04)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B18 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): e1e3efc9d04
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- e1e3efc9d04 — feat(hooks): Support explicit stop and block execution control in model hooks (#15947)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/e1e3efc9d04-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B18 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): e1e3efc9d04
- Required verification level: FULL

Upstream subjects:
- e1e3efc9d04 — feat(hooks): Support explicit stop and block execution control in model hooks (#15947)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B19 — REIMPLEMENT

        - **Upstream SHA(s):** `41e627a7ee4`
        - **Subjects:**
        - `41e627a7ee4` — Refine Gemini 3 system instructions to reduce model verbosity (#16139)
        - **Exact command / playbook:** Follow [`41e627a7ee4-plan.md`](./41e627a7ee4-plan.md).
        - **Commit message template:** `reimplement: Refine Gemini 3 system instructions to reduce model verbosity (upstream 41e627a7ee4)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B19 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 41e627a7ee4
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 41e627a7ee4 — Refine Gemini 3 system instructions to reduce model verbosity (#16139)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/41e627a7ee4-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B19 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 41e627a7ee4
- Required verification level: QUICK

Upstream subjects:
- 41e627a7ee4 — Refine Gemini 3 system instructions to reduce model verbosity (#16139)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B20 — PICK

        - **Upstream SHA(s):** `88f1ec8d0ae`
        - **Subjects:**
        - `88f1ec8d0ae` — Always enable bracketed paste (#16179)
        - **Exact command / playbook:** `git cherry-pick -n 88f1ec8d0ae`
        - **Commit message template:** `cherry-pick: upstream 88f1ec8d0ae batch 20`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B20 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 88f1ec8d0ae
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 88f1ec8d0ae — Always enable bracketed paste (#16179)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 88f1ec8d0ae`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B20 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 88f1ec8d0ae
- Required verification level: FULL

Upstream subjects:
- 88f1ec8d0ae — Always enable bracketed paste (#16179)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B21 — REIMPLEMENT

        - **Upstream SHA(s):** `77e226c55fe`
        - **Subjects:**
        - `77e226c55fe` — Show settings source in extensions lists (#16207)
        - **Exact command / playbook:** Follow [`77e226c55fe-plan.md`](./77e226c55fe-plan.md).
        - **Commit message template:** `reimplement: Show settings source in extensions lists (upstream 77e226c55fe)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B21 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 77e226c55fe
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 77e226c55fe — Show settings source in extensions lists (#16207)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/77e226c55fe-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B21 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 77e226c55fe
- Required verification level: QUICK

Upstream subjects:
- 77e226c55fe — Show settings source in extensions lists (#16207)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B22 — PICK

        - **Upstream SHA(s):** `8bc3cfe29a6 c1401682ed0 14f0cb45389`
        - **Subjects:**
        - `8bc3cfe29a6` — feat(skills): add pr-creator skill and enable skills (#16232)
- `c1401682ed0` — fix: handle Shift+Space in Kitty keyboard protocol terminals (#15767)
- `14f0cb45389` — feat(ui): reduce home directory warning noise and add opt-out setting (#16229)
        - **Exact command / playbook:** `git cherry-pick -n 8bc3cfe29a6 c1401682ed0 14f0cb45389`
        - **Commit message template:** `cherry-pick: upstream 8bc3cfe29a6..14f0cb45389 batch 22`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B22 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 8bc3cfe29a6, c1401682ed0, 14f0cb45389
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 8bc3cfe29a6 — feat(skills): add pr-creator skill and enable skills (#16232)
- c1401682ed0 — fix: handle Shift+Space in Kitty keyboard protocol terminals (#15767)
- 14f0cb45389 — feat(ui): reduce home directory warning noise and add opt-out setting (#16229)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 8bc3cfe29a6 c1401682ed0 14f0cb45389`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B22 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 8bc3cfe29a6, c1401682ed0, 14f0cb45389
- Required verification level: FULL

Upstream subjects:
- 8bc3cfe29a6 — feat(skills): add pr-creator skill and enable skills (#16232)
- c1401682ed0 — fix: handle Shift+Space in Kitty keyboard protocol terminals (#15767)
- 14f0cb45389 — feat(ui): reduce home directory warning noise and add opt-out setting (#16229)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B23 — REIMPLEMENT

        - **Upstream SHA(s):** `c7d17dda49d`
        - **Subjects:**
        - `c7d17dda49d` — fix: properly use systemMessage for hooks in UI (#16250)
        - **Exact command / playbook:** Follow [`c7d17dda49d-plan.md`](./c7d17dda49d-plan.md).
        - **Commit message template:** `reimplement: fix: properly use systemMessage for hooks in UI (upstream c7d17dda49d)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B23 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): c7d17dda49d
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- c7d17dda49d — fix: properly use systemMessage for hooks in UI (#16250)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/c7d17dda49d-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B23 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): c7d17dda49d
- Required verification level: QUICK

Upstream subjects:
- c7d17dda49d — fix: properly use systemMessage for hooks in UI (#16250)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B24 — PICK

        - **Upstream SHA(s):** `ea7393f7fd5 e04a5f0cb0e 1fb55dcb2e0`
        - **Subjects:**
        - `ea7393f7fd5` — Infer modifyOtherKeys support (#16270)
- `e04a5f0cb0e` — feat(core): Cache ignore instances for performance (#16185)
- `1fb55dcb2e0` — Autogenerate docs/cli/settings.md (#14408)
        - **Exact command / playbook:** `git cherry-pick -n ea7393f7fd5 e04a5f0cb0e 1fb55dcb2e0`
        - **Commit message template:** `cherry-pick: upstream ea7393f7fd5..1fb55dcb2e0 batch 24`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B24 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): ea7393f7fd5, e04a5f0cb0e, 1fb55dcb2e0
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- ea7393f7fd5 — Infer modifyOtherKeys support (#16270)
- e04a5f0cb0e — feat(core): Cache ignore instances for performance (#16185)
- 1fb55dcb2e0 — Autogenerate docs/cli/settings.md (#14408)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n ea7393f7fd5 e04a5f0cb0e 1fb55dcb2e0`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B24 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): ea7393f7fd5, e04a5f0cb0e, 1fb55dcb2e0
- Required verification level: FULL

Upstream subjects:
- ea7393f7fd5 — Infer modifyOtherKeys support (#16270)
- e04a5f0cb0e — feat(core): Cache ignore instances for performance (#16185)
- 1fb55dcb2e0 — Autogenerate docs/cli/settings.md (#14408)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B25 — REIMPLEMENT

        - **Upstream SHA(s):** `b08b0d715b5`
        - **Subjects:**
        - `b08b0d715b5` — Update system prompt to prefer non-interactive commands (#16117)
        - **Exact command / playbook:** Follow [`b08b0d715b5-plan.md`](./b08b0d715b5-plan.md).
        - **Commit message template:** `reimplement: Update system prompt to prefer non-interactive commands (upstream b08b0d715b5)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B25 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): b08b0d715b5
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- b08b0d715b5 — Update system prompt to prefer non-interactive commands (#16117)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/b08b0d715b5-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B25 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): b08b0d715b5
- Required verification level: QUICK

Upstream subjects:
- b08b0d715b5 — Update system prompt to prefer non-interactive commands (#16117)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B26 — REIMPLEMENT

        - **Upstream SHA(s):** `461c277bf2d`
        - **Subjects:**
        - `461c277bf2d` — Support for Built-in Agent Skills (#16045)
        - **Exact command / playbook:** Follow [`461c277bf2d-plan.md`](./461c277bf2d-plan.md).
        - **Commit message template:** `reimplement: Support for Built-in Agent Skills (upstream 461c277bf2d)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B26 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 461c277bf2d
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 461c277bf2d — Support for Built-in Agent Skills (#16045)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/461c277bf2d-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B26 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 461c277bf2d
- Required verification level: FULL

Upstream subjects:
- 461c277bf2d — Support for Built-in Agent Skills (#16045)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B27 — REIMPLEMENT

        - **Upstream SHA(s):** `0e955da1710`
        - **Subjects:**
        - `0e955da1710` — feat(cli): add /chat debug command for nightly builds (#16339)
        - **Exact command / playbook:** Follow [`0e955da1710-plan.md`](./0e955da1710-plan.md).
        - **Commit message template:** `reimplement: feat(cli): add /chat debug command for nightly builds (upstream 0e955da1710)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B27 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 0e955da1710
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 0e955da1710 — feat(cli): add /chat debug command for nightly builds (#16339)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/0e955da1710-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B27 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 0e955da1710
- Required verification level: QUICK

Upstream subjects:
- 0e955da1710 — feat(cli): add /chat debug command for nightly builds (#16339)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B28 — PICK

        - **Upstream SHA(s):** `93b57b82c10`
        - **Subjects:**
        - `93b57b82c10` — style: format pr-creator skill (#16381)
        - **Exact command / playbook:** `git cherry-pick -n 93b57b82c10`
        - **Commit message template:** `cherry-pick: upstream 93b57b82c10 batch 28`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B28 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 93b57b82c10
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 93b57b82c10 — style: format pr-creator skill (#16381)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 93b57b82c10`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B28 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 93b57b82c10
- Required verification level: FULL

Upstream subjects:
- 93b57b82c10 — style: format pr-creator skill (#16381)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B29 — REIMPLEMENT

        - **Upstream SHA(s):** `9703fe73cf9`
        - **Subjects:**
        - `9703fe73cf9` — feat(cli): Hooks enable-all/disable-all feature with dynamic status (#15552)
        - **Exact command / playbook:** Follow [`9703fe73cf9-plan.md`](./9703fe73cf9-plan.md).
        - **Commit message template:** `reimplement: feat(cli): Hooks enable-all/disable-all feature with dynamic status (upstream 9703fe73cf9)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B29 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 9703fe73cf9
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 9703fe73cf9 — feat(cli): Hooks enable-all/disable-all feature with dynamic status (#15552)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/9703fe73cf9-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B29 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 9703fe73cf9
- Required verification level: QUICK

Upstream subjects:
- 9703fe73cf9 — feat(cli): Hooks enable-all/disable-all feature with dynamic status (#15552)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B30 — PICK

        - **Upstream SHA(s):** `64c75cb767c`
        - **Subjects:**
        - `64c75cb767c` — Fix crash on unicode character (#16420)
        - **Exact command / playbook:** `git cherry-pick -n 64c75cb767c`
        - **Commit message template:** `cherry-pick: upstream 64c75cb767c batch 30`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B30 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 64c75cb767c
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 64c75cb767c — Fix crash on unicode character (#16420)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 64c75cb767c`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B30 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 64c75cb767c
- Required verification level: FULL

Upstream subjects:
- 64c75cb767c — Fix crash on unicode character (#16420)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B31 — REIMPLEMENT

        - **Upstream SHA(s):** `950244f6b00`
        - **Subjects:**
        - `950244f6b00` — Attempt to resolve OOM w/ useMemo on history items (#16424)
        - **Exact command / playbook:** Follow [`950244f6b00-plan.md`](./950244f6b00-plan.md).
        - **Commit message template:** `reimplement: Attempt to resolve OOM w/ useMemo on history items (upstream 950244f6b00)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B31 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 950244f6b00
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 950244f6b00 — Attempt to resolve OOM w/ useMemo on history items (#16424)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/950244f6b00-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B31 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 950244f6b00
- Required verification level: QUICK

Upstream subjects:
- 950244f6b00 — Attempt to resolve OOM w/ useMemo on history items (#16424)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B32 — REIMPLEMENT

        - **Upstream SHA(s):** `8a2e0fac0d8`
        - **Subjects:**
        - `8a2e0fac0d8` — Add other hook wrapper methods to hooksystem (#16361)
        - **Exact command / playbook:** Follow [`8a2e0fac0d8-plan.md`](./8a2e0fac0d8-plan.md).
        - **Commit message template:** `reimplement: Add other hook wrapper methods to hooksystem (upstream 8a2e0fac0d8)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B32 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 8a2e0fac0d8
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 8a2e0fac0d8 — Add other hook wrapper methods to hooksystem (#16361)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/8a2e0fac0d8-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B32 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 8a2e0fac0d8
- Required verification level: FULL

Upstream subjects:
- 8a2e0fac0d8 — Add other hook wrapper methods to hooksystem (#16361)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B33 — PICK

        - **Upstream SHA(s):** `15891721ad0`
        - **Subjects:**
        - `15891721ad0` — feat: introduce useRewindLogic hook for conversation history navigation (#15716)
        - **Exact command / playbook:** `git cherry-pick -n 15891721ad0`
        - **Commit message template:** `cherry-pick: upstream 15891721ad0 batch 33`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B33 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 15891721ad0
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 15891721ad0 — feat: introduce useRewindLogic hook for conversation history navigation (#15716)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 15891721ad0`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B33 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 15891721ad0
- Required verification level: QUICK

Upstream subjects:
- 15891721ad0 — feat: introduce useRewindLogic hook for conversation history navigation (#15716)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B34 — PICK

        - **Upstream SHA(s):** `64cde8d4395`
        - **Subjects:**
        - `64cde8d4395` — fix(policy): enhance shell command safety and parsing (#15034)
        - **Exact command / playbook:** `git cherry-pick -n 64cde8d4395`
        - **Commit message template:** `cherry-pick: upstream 64cde8d4395 batch 34`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B34 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 64cde8d4395
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 64cde8d4395 — fix(policy): enhance shell command safety and parsing (#15034)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 64cde8d4395`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B34 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 64cde8d4395
- Required verification level: FULL

Upstream subjects:
- 64cde8d4395 — fix(policy): enhance shell command safety and parsing (#15034)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B35 — PICK

        - **Upstream SHA(s):** `3b678a4da0f 8437ce940a1 e049d5e4e8f`
        - **Subjects:**
        - `3b678a4da0f` — fix(core): avoid 'activate_skill' re-registration warning (#16398)
- `8437ce940a1` — Revert "Update extension examples" (#16442)
- `e049d5e4e8f` — Fix: add back fastreturn support (#16440)
        - **Exact command / playbook:** `git cherry-pick -n 3b678a4da0f 8437ce940a1 e049d5e4e8f`
        - **Commit message template:** `cherry-pick: upstream 3b678a4da0f..e049d5e4e8f batch 35`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B35 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 3b678a4da0f, 8437ce940a1, e049d5e4e8f
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 3b678a4da0f — fix(core): avoid 'activate_skill' re-registration warning (#16398)
- 8437ce940a1 — Revert "Update extension examples" (#16442)
- e049d5e4e8f — Fix: add back fastreturn support (#16440)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 3b678a4da0f 8437ce940a1 e049d5e4e8f`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B35 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 3b678a4da0f, 8437ce940a1, e049d5e4e8f
- Required verification level: QUICK

Upstream subjects:
- 3b678a4da0f — fix(core): avoid 'activate_skill' re-registration warning (#16398)
- 8437ce940a1 — Revert "Update extension examples" (#16442)
- e049d5e4e8f — Fix: add back fastreturn support (#16440)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B36 — PICK

        - **Upstream SHA(s):** `95d9a339966`
        - **Subjects:**
        - `95d9a339966` — migrate yolo/auto-edit keybindings (#16457)
        - **Exact command / playbook:** `git cherry-pick -n 95d9a339966`
        - **Commit message template:** `cherry-pick: upstream 95d9a339966 batch 36`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B36 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 95d9a339966
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 95d9a339966 — migrate yolo/auto-edit keybindings (#16457)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 95d9a339966`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B36 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 95d9a339966
- Required verification level: FULL

Upstream subjects:
- 95d9a339966 — migrate yolo/auto-edit keybindings (#16457)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B37 — PICK

        - **Upstream SHA(s):** `2e8c6cfdbb8`
        - **Subjects:**
        - `2e8c6cfdbb8` — feat(cli): add install and uninstall commands for skills (#16377)
        - **Exact command / playbook:** `git cherry-pick -n 2e8c6cfdbb8`
        - **Commit message template:** `cherry-pick: upstream 2e8c6cfdbb8 batch 37`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B37 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 2e8c6cfdbb8
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 2e8c6cfdbb8 — feat(cli): add install and uninstall commands for skills (#16377)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 2e8c6cfdbb8`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B37 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 2e8c6cfdbb8
- Required verification level: QUICK

Upstream subjects:
- 2e8c6cfdbb8 — feat(cli): add install and uninstall commands for skills (#16377)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B38 — PICK

        - **Upstream SHA(s):** `ca6786a28bd`
        - **Subjects:**
        - `ca6786a28bd` — feat(ui): use Tab to switch focus between shell and input (#14332)
        - **Exact command / playbook:** `git cherry-pick -n ca6786a28bd`
        - **Commit message template:** `cherry-pick: upstream ca6786a28bd batch 38`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B38 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): ca6786a28bd
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- ca6786a28bd — feat(ui): use Tab to switch focus between shell and input (#14332)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n ca6786a28bd`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B38 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): ca6786a28bd
- Required verification level: FULL

Upstream subjects:
- ca6786a28bd — feat(ui): use Tab to switch focus between shell and input (#14332)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B39 — PICK

        - **Upstream SHA(s):** `e9c9dd1d672`
        - **Subjects:**
        - `e9c9dd1d672` — feat(core): support shipping built-in skills with the CLI (#16300)
        - **Exact command / playbook:** `git cherry-pick -n e9c9dd1d672`
        - **Commit message template:** `cherry-pick: upstream e9c9dd1d672 batch 39`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B39 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): e9c9dd1d672
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- e9c9dd1d672 — feat(core): support shipping built-in skills with the CLI (#16300)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n e9c9dd1d672`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B39 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): e9c9dd1d672
- Required verification level: QUICK

Upstream subjects:
- e9c9dd1d672 — feat(core): support shipping built-in skills with the CLI (#16300)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B40 — PICK

        - **Upstream SHA(s):** `8d3e93cdb0d`
        - **Subjects:**
        - `8d3e93cdb0d` — Migrate keybindings (#16460)
        - **Exact command / playbook:** `git cherry-pick -n 8d3e93cdb0d`
        - **Commit message template:** `cherry-pick: upstream 8d3e93cdb0d batch 40`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B40 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 8d3e93cdb0d
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 8d3e93cdb0d — Migrate keybindings (#16460)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 8d3e93cdb0d`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B40 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 8d3e93cdb0d
- Required verification level: FULL

Upstream subjects:
- 8d3e93cdb0d — Migrate keybindings (#16460)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B41 — REIMPLEMENT

        - **Upstream SHA(s):** `c572b9e9ac6`
        - **Subjects:**
        - `c572b9e9ac6` — feat(cli): cleanup activity logs alongside session files (#16399)
        - **Exact command / playbook:** Follow [`c572b9e9ac6-plan.md`](./c572b9e9ac6-plan.md).
        - **Commit message template:** `reimplement: feat(cli): cleanup activity logs alongside session files (upstream c572b9e9ac6)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B41 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): c572b9e9ac6
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- c572b9e9ac6 — feat(cli): cleanup activity logs alongside session files (#16399)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/c572b9e9ac6-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B41 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): c572b9e9ac6
- Required verification level: QUICK

Upstream subjects:
- c572b9e9ac6 — feat(cli): cleanup activity logs alongside session files (#16399)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B42 — PICK

        - **Upstream SHA(s):** `2fc61685a32`
        - **Subjects:**
        - `2fc61685a32` — feat(cli): implement dynamic terminal tab titles for CLI status (#16378)
        - **Exact command / playbook:** `git cherry-pick -n 2fc61685a32`
        - **Commit message template:** `cherry-pick: upstream 2fc61685a32 batch 42`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B42 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 2fc61685a32
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 2fc61685a32 — feat(cli): implement dynamic terminal tab titles for CLI status (#16378)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 2fc61685a32`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B42 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 2fc61685a32
- Required verification level: FULL

Upstream subjects:
- 2fc61685a32 — feat(cli): implement dynamic terminal tab titles for CLI status (#16378)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B43 — PICK

        - **Upstream SHA(s):** `6adae9f7756`
        - **Subjects:**
        - `6adae9f7756` — fix: Set both tab and window title instead of just window title (#16464)
        - **Exact command / playbook:** `git cherry-pick -n 6adae9f7756`
        - **Commit message template:** `cherry-pick: upstream 6adae9f7756 batch 43`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B43 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 6adae9f7756
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 6adae9f7756 — fix: Set both tab and window title instead of just window title (#16464)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 6adae9f7756`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B43 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 6adae9f7756
- Required verification level: QUICK

Upstream subjects:
- 6adae9f7756 — fix: Set both tab and window title instead of just window title (#16464)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B44 — REIMPLEMENT

        - **Upstream SHA(s):** `304caa4e43a`
        - **Subjects:**
        - `304caa4e43a` — fix(cli): refine 'Action Required' indicator and focus hints (#16497)
        - **Exact command / playbook:** Follow [`304caa4e43a-plan.md`](./304caa4e43a-plan.md).
        - **Commit message template:** `reimplement: fix(cli): refine 'Action Required' indicator and focus hints (upstream 304caa4e43a)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B44 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 304caa4e43a
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 304caa4e43a — fix(cli): refine 'Action Required' indicator and focus hints (#16497)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/304caa4e43a-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B44 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 304caa4e43a
- Required verification level: FULL

Upstream subjects:
- 304caa4e43a — fix(cli): refine 'Action Required' indicator and focus hints (#16497)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B45 — REIMPLEMENT

        - **Upstream SHA(s):** `a6dca02344b`
        - **Subjects:**
        - `a6dca02344b` — Refactor beforeAgent and afterAgent hookEvents to follow desired output (#16495)
        - **Exact command / playbook:** Follow [`a6dca02344b-plan.md`](./a6dca02344b-plan.md).
        - **Commit message template:** `reimplement: Refactor beforeAgent and afterAgent hookEvents to follow desired output (upstream a6dca02344b)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B45 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): a6dca02344b
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- a6dca02344b — Refactor beforeAgent and afterAgent hookEvents to follow desired output (#16495)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/a6dca02344b-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B45 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): a6dca02344b
- Required verification level: QUICK

Upstream subjects:
- a6dca02344b — Refactor beforeAgent and afterAgent hookEvents to follow desired output (#16495)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B46 — REIMPLEMENT

        - **Upstream SHA(s):** `aa524625503`
        - **Subjects:**
        - `aa524625503` — Implement support for subagents as extensions. (#16473)
        - **Exact command / playbook:** Follow [`aa524625503-plan.md`](./aa524625503-plan.md).
        - **Commit message template:** `reimplement: Implement support for subagents as extensions. (upstream aa524625503)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B46 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): aa524625503
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- aa524625503 — Implement support for subagents as extensions. (#16473)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/aa524625503-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B46 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): aa524625503
- Required verification level: FULL

Upstream subjects:
- aa524625503 — Implement support for subagents as extensions. (#16473)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B47 — PICK

        - **Upstream SHA(s):** `91fcca3b1c7 e931ebe581b`
        - **Subjects:**
        - `91fcca3b1c7` — refactor: make baseTimestamp optional in addItem and remove redundant calls (#16471)
- `e931ebe581b` — Improve key binding names and descriptions (#16529)
        - **Exact command / playbook:** `git cherry-pick -n 91fcca3b1c7 e931ebe581b`
        - **Commit message template:** `cherry-pick: upstream 91fcca3b1c7..e931ebe581b batch 47`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B47 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 91fcca3b1c7, e931ebe581b
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 91fcca3b1c7 — refactor: make baseTimestamp optional in addItem and remove redundant calls (#16471)
- e931ebe581b — Improve key binding names and descriptions (#16529)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 91fcca3b1c7 e931ebe581b`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B47 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 91fcca3b1c7, e931ebe581b
- Required verification level: QUICK

Upstream subjects:
- 91fcca3b1c7 — refactor: make baseTimestamp optional in addItem and remove redundant calls (#16471)
- e931ebe581b — Improve key binding names and descriptions (#16529)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B48 — REIMPLEMENT

        - **Upstream SHA(s):** `92e31e3c4ae`
        - **Subjects:**
        - `92e31e3c4ae` — feat(core, cli): Add support for agents in settings.json. (#16433)
        - **Exact command / playbook:** Follow [`92e31e3c4ae-plan.md`](./92e31e3c4ae-plan.md).
        - **Commit message template:** `reimplement: feat(core, cli): Add support for agents in settings.json. (upstream 92e31e3c4ae)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B48 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 92e31e3c4ae
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 92e31e3c4ae — feat(core, cli): Add support for agents in settings.json. (#16433)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/92e31e3c4ae-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B48 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 92e31e3c4ae
- Required verification level: FULL

Upstream subjects:
- 92e31e3c4ae — feat(core, cli): Add support for agents in settings.json. (#16433)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B49 — PICK

        - **Upstream SHA(s):** `e8be252b755 c7c409c68fb 778de55fd8c 8dbaa2bceaf`
        - **Subjects:**
        - `e8be252b755` — fix(cli): fix 'gemini skills install' unknown argument error (#16537)
- `c7c409c68fb` — fix(cli): copy uses OSC52 only in SSH/WSL (#16554)
- `778de55fd8c` — docs(skills): clarify skill directory structure and file location (#16532)
- `8dbaa2bceaf` — Fix: make ctrl+x use preferred editor (#16556)
        - **Exact command / playbook:** `git cherry-pick -n e8be252b755 c7c409c68fb 778de55fd8c 8dbaa2bceaf`
        - **Commit message template:** `cherry-pick: upstream e8be252b755..8dbaa2bceaf batch 49`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B49 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): e8be252b755, c7c409c68fb, 778de55fd8c, 8dbaa2bceaf
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- e8be252b755 — fix(cli): fix 'gemini skills install' unknown argument error (#16537)
- c7c409c68fb — fix(cli): copy uses OSC52 only in SSH/WSL (#16554)
- 778de55fd8c — docs(skills): clarify skill directory structure and file location (#16532)
- 8dbaa2bceaf — Fix: make ctrl+x use preferred editor (#16556)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n e8be252b755 c7c409c68fb 778de55fd8c 8dbaa2bceaf`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B49 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): e8be252b755, c7c409c68fb, 778de55fd8c, 8dbaa2bceaf
- Required verification level: QUICK

Upstream subjects:
- e8be252b755 — fix(cli): fix 'gemini skills install' unknown argument error (#16537)
- c7c409c68fb — fix(cli): copy uses OSC52 only in SSH/WSL (#16554)
- 778de55fd8c — docs(skills): clarify skill directory structure and file location (#16532)
- 8dbaa2bceaf — Fix: make ctrl+x use preferred editor (#16556)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B50 — PICK

        - **Upstream SHA(s):** `eda47f587cf`
        - **Subjects:**
        - `eda47f587cf` — fix(core): Resolve race condition in tool response reporting (#16557)
        - **Exact command / playbook:** `git cherry-pick -n eda47f587cf`
        - **Commit message template:** `cherry-pick: upstream eda47f587cf batch 50`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B50 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): eda47f587cf
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- eda47f587cf — fix(core): Resolve race condition in tool response reporting (#16557)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n eda47f587cf`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B50 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): eda47f587cf
- Required verification level: FULL

Upstream subjects:
- eda47f587cf — fix(core): Resolve race condition in tool response reporting (#16557)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B51 — REIMPLEMENT

        - **Upstream SHA(s):** `8030404b08b`
        - **Subjects:**
        - `8030404b08b` — Behavioral evals framework. (#16047)
        - **Exact command / playbook:** Follow [`8030404b08b-plan.md`](./8030404b08b-plan.md).
        - **Commit message template:** `reimplement: Behavioral evals framework. (upstream 8030404b08b)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B51 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 8030404b08b
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 8030404b08b — Behavioral evals framework. (#16047)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/8030404b08b-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B51 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 8030404b08b
- Required verification level: QUICK

Upstream subjects:
- 8030404b08b — Behavioral evals framework. (#16047)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B52 — REIMPLEMENT

        - **Upstream SHA(s):** `66e7b479ae4`
        - **Subjects:**
        - `66e7b479ae4` — Aggregate test results. (#16581)
        - **Exact command / playbook:** Follow [`66e7b479ae4-plan.md`](./66e7b479ae4-plan.md).
        - **Commit message template:** `reimplement: Aggregate test results. (upstream 66e7b479ae4)`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B52 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 66e7b479ae4
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 66e7b479ae4 — Aggregate test results. (#16581)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Read and follow `project-plans/gmerge-0.25.2/66e7b479ae4-plan.md` exactly, adapting the upstream intent to LLxprt-native architecture.
3. Implement only the behavior covered by this upstream SHA and its playbook; preserve LLxprt naming, branding, tool behavior, provider routing, and privacy constraints.
4. Create any missing files called out by the playbook only when they are necessary for the reimplementation to land cleanly.
5. Do not commit. Stop after the working tree contains the reimplementation changes ready for review.
6. Return a concise report: files changed/created, noteworthy design decisions, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B52 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: REIMPLEMENT
- Upstream SHA(s): 66e7b479ae4
- Required verification level: FULL

Upstream subjects:
- 66e7b479ae4 — Aggregate test results. (#16581)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B53 — PICK

        - **Upstream SHA(s):** `bb6c5741443 f6a5fa0e03a`
        - **Subjects:**
        - `bb6c5741443` — feat(admin): support admin-enforced settings for Agent Skills (#16406)
- `f6a5fa0e03a` — fix(ui): ensure rationale renders before tool calls (#17043)
        - **Exact command / playbook:** `git cherry-pick -n bb6c5741443 f6a5fa0e03a`
        - **Commit message template:** `cherry-pick: upstream bb6c5741443..f6a5fa0e03a batch 53`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B53 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): bb6c5741443, f6a5fa0e03a
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- bb6c5741443 — feat(admin): support admin-enforced settings for Agent Skills (#16406)
- f6a5fa0e03a — fix(ui): ensure rationale renders before tool calls (#17043)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n bb6c5741443 f6a5fa0e03a`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B53 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): bb6c5741443, f6a5fa0e03a
- Required verification level: QUICK

Upstream subjects:
- bb6c5741443 — feat(admin): support admin-enforced settings for Agent Skills (#16406)
- f6a5fa0e03a — fix(ui): ensure rationale renders before tool calls (#17043)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B54 — PICK

        - **Upstream SHA(s):** `ea0e3de4302`
        - **Subjects:**
        - `ea0e3de4302` — fix(core): deduplicate ModelInfo emission in GeminiClient (#17075)
        - **Exact command / playbook:** `git cherry-pick -n ea0e3de4302`
        - **Commit message template:** `cherry-pick: upstream ea0e3de4302 batch 54`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** YES
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B54 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): ea0e3de4302
- Verification level after execution: FULL
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- ea0e3de4302 — fix(core): deduplicate ModelInfo emission in GeminiClient (#17075)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n ea0e3de4302`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B54 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): ea0e3de4302
- Required verification level: FULL

Upstream subjects:
- ea0e3de4302 — fix(core): deduplicate ModelInfo emission in GeminiClient (#17075)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run format`
- `npm run build`
- `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



### B55 — PICK

        - **Upstream SHA(s):** `217f2775805`
        - **Subjects:**
        - `217f2775805` — fix: update currentSequenceModel when modelChanged (#17051)
        - **Exact command / playbook:** `git cherry-pick -n 217f2775805`
        - **Commit message template:** `cherry-pick: upstream 217f2775805 batch 55`
        - **Quick verify after review:**
  - `npm run lint`
  - `npm run typecheck`
        - **Full verify on this batch:** NO

        - **Complete subagent prompt for execution (cherrypicker):**

        ```text
        You are the `cherrypicker` subagent executing Batch B55 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2`.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 217f2775805
- Verification level after execution: QUICK
- Commit is reserved for the coordinator after review passes.

Upstream subjects:
- 217f2775805 — fix: update currentSequenceModel when modelChanged (#17051)

Non-negotiables:
- Preserve LLxprt multi-provider behavior, provider-neutral auth, branding, package names, and canonical tool names.
- Do not introduce Clearcut, Google telemetry, Google-only auth assumptions, auto model routing, /agents/AgentRegistry/delegate_to_agent flows, Smart Edit, NextSpeakerChecker, or public A2A publishing.
- Do not revert unrelated working-tree changes.

Do this now:
1. Confirm you are on branch gmerge/0.25.2 and inspect git status before changing anything.
2. Execute exactly this batch command without creating a commit yet: `git cherry-pick -n 217f2775805`.
3. Resolve conflicts preserving LLxprt-specific architecture, naming, multi-provider behavior, and the PICK/SKIP/REIMPLEMENT decisions already locked in CHERRIES.md.
4. Do not broaden scope beyond these upstream SHAs. If a fix is required to make the batch coherent, keep it minimal and note it for review.
5. Do not commit. Stop after the working tree contains the batch changes ready for review.
6. Return a concise report: files changed, conflicts resolved, and any residual review risks.
        ```

        - **Complete subagent prompt for review (deepthinker):**

        ```text
        You are the `deepthinker` subagent reviewing Batch B55 from `project-plans/gmerge-0.25.2/PLAN.md` on branch `gmerge/0.25.2` after execution and before commit.

Batch metadata:
- Type: PICK
- Upstream SHA(s): 217f2775805
- Required verification level: QUICK

Upstream subjects:
- 217f2775805 — fix: update currentSequenceModel when modelChanged (#17051)

Mechanical verification you MUST perform:
- `npm run lint`
- `npm run typecheck`
- Branding/policy drift check: no `@google/gemini-cli`, no `USE_GEMINI`, no `delegate_to_agent`, no public A2A publishing changes, and no accidental reintroduction of Google telemetry or auto model routing.

Qualitative verification you MUST perform for EACH upstream commit in the batch:
- Code actually landed (not stubbed, not fake, not just imports or dead code).
- Behavioral equivalence to the upstream intent as adapted for LLxprt.
- Integration correctness: wired into the real runtime/config/UI paths LLxprt actually uses.

Output format requirements:
1. Start with `PASS` or `FAIL`.
2. Provide a per-commit checklist with these exact fields for every SHA:
   - `sha:`
   - `landed: YES/NO`
   - `functional: YES/NO`
   - `integration: YES/NO`
   - `notes:`
3. Report the mechanical verification results.
4. If anything fails, provide explicit remediation instructions for the cherrypicker.

Do not commit. Do not make code changes yourself. Review only.
        ```



## Failure Recovery


### Cherry-pick failure handling

If a PICK batch conflicts or lands in the wrong state:

```bash
git status
git cherry-pick --abort
```

Then restart the same batch via its `B*-exec` todo using the same cherrypicker prompt. If only one commit in a multi-SHA batch is the problem, keep the batch boundary the same; do not silently reshuffle the schedule.

### Reimplementation failure handling

If a REIMPLEMENT playbook turns out to be incomplete:
- Update the relevant `SHA-plan.md` before retrying.
- Record the deviation in `NOTES.md`.
- Restart the same batch with `cherrypicker`.

### Review-remediate loop

- Reviewer FAIL -> cherrypicker remediation -> deepthinker re-run.
- Maximum 5 FAIL/PASS cycles per batch.
- After the fifth FAIL, pause and escalate with `todo_pause()`.

### Follow-up fix commits

Create a follow-up fix commit immediately after the batch commit when any of the following is true:
- conflict resolution required additional cleanup that should be tracked separately,
- deepthinker-requested remediation landed after the initial batch content was ready,
- full verification surfaced a discrete fix that belongs right after the batch,
- formatting changed files during Full Verify and you want a dedicated post-batch formatting/fix commit.

Recommended follow-up commit message template:

```text
fix: post-batch NN verification
```


## Note-Taking Requirement


After every batch completes (including any immediate follow-up fix commit), update all of the following before moving to the next batch:

- `PROGRESS.md` — mark status and record the LLxprt commit hash
- `NOTES.md` — append conflicts, deviations, deepthinker findings, and any follow-up issues
- `AUDIT.md` — map each upstream SHA in the batch to PICKED / REIMPLEMENTED / SKIPPED / NO_OP plus LLxprt commit hash(es)

Do not defer these updates to the end of the sync.


## Phase 5 PR Creation Notes


After all 55 batches are complete and the documentation artifacts are current:

1. Confirm the tracking issue number (not yet identified in the planning folder).
2. Run the full repository verification suite again if needed.
3. Open a PR against `main`.
4. Title format must include the issue number being fixed, for example: `Sync upstream v0.25.2 cherry-picks (Fixes #NNNN)`.
5. The PR body must reference this plan folder, `CHERRIES.md`, and `AUDIT.md`, and explain major functional changes plus intentional SKIPs / NO_OPs.
6. After PR creation, follow the project memory for `gh pr checks NUM --watch --interval 300`, CodeRabbit response handling, and CI remediation loops.


## Context Recovery


If execution context is lost, recover in this order:

1. **Check git state**
   ```bash
   git branch --show-current
   git status
   git log --oneline -n 10
   ```
   Expected branch is `gmerge/0.25.2`.

2. **Read the todo list**
   - Call `todo_read()`.
   - Resume from the first `pending` item.
   - If the list is missing or corrupted, restore it with the exact `todo_write` block in this file.

3. **Read the tracking artifacts**
   - `project-plans/gmerge-0.25.2/PROGRESS.md`
   - `project-plans/gmerge-0.25.2/NOTES.md`
   - `project-plans/gmerge-0.25.2/AUDIT.md`
   - `project-plans/gmerge-0.25.2/CHERRIES.md`
   - the relevant `project-plans/gmerge-0.25.2/<sha>-plan.md` for any REIMPLEMENT batch you are resuming

4. **Resume using the batch structure in this plan**
   - `B*-exec` -> `task(subagent_name="cherrypicker", ...)`
   - `B*-review` -> `task(subagent_name="deepthinker", ...)`
   - `B*-commit` -> coordinator commit after PASS

5. **Escalate real blockers**
   - If git state is unsafe, a playbook is missing, or the review/remediate loop has failed five times, call `todo_pause()` and wait.

### Quick summary for a context-wiped agent

- This sync is `gmerge/0.25.2`, bringing LLxprt from upstream parity `v0.24.5` to `v0.25.2`.
- The authoritative decisions are already frozen in `CHERRIES.md`: 48 PICK / 78 SKIP / 28 REIMPLEMENT / 15 NO_OP.
- Execution is split into 55 chronological batches: 27 PICK batches and 28 REIMPLEMENT batches.
- Every batch requires mandatory deepthinker verification before commit.
- REIMPLEMENT batches must follow their per-SHA playbooks in this folder.
