# Execution Plan: gemini-cli v0.25.2 → v0.26.0

## START HERE (If you were told to "DO this plan")

If you're reading this because someone said `DO @project-plans/gmerge-0.26.0/PLAN.md`, follow these steps exactly.

### Step 1: Check current state

```bash
git branch --show-current   # Must be gmerge/0.26.0
git status                  # Must be clean or only contain in-scope gmerge work
```

If the branch is wrong or the work tree contains unrelated changes, stop and get the tree back to a safe state before proceeding.

### Step 2: Check or create the todo list

Call `todo_read()` first.

- If the todo list is empty, missing the `P1-exec` / `P1-review` / `P1-commit` structure, or clearly belongs to another task, call `todo_write()` with the EXACT block in the **Todo List Management** section below.
- If the todo list already exists, do not rewrite it unless recovery requires restoring the exact plan todos.

### Step 3: Find where to resume

- Resume from the first `pending` todo item.
- If an item is `in_progress`, restart that item from the beginning.
- If every item is `completed`, execution is done and only final verification / PR handling remains.

### Step 4: Execute using subagents

- For every `*-exec` item, call `task()` with `subagent_name: "cherrypicker"` and use the exact execution prompt for that batch from this plan.
- For every `*-review` item, call `task()` with `subagent_name: "deepthinker"` and use the exact review prompt for that batch from this plan.
- If review fails, call `task()` again with `subagent_name: "cherrypicker"` for remediation, then re-run the deepthinker.
- Do **not** cherry-pick or review the batch directly yourself; execution and review must go through the required subagents.
- The coordinator may perform the `*-commit` todo directly once review passes.

### Step 5: If blocked

If a required file is missing, a cherry-pick cannot be completed, verification reveals a blocker that cannot be remediated within the allowed loop, or git state is unsafe, call `todo_pause()` with the specific reason and wait for human intervention.

---

## Scope and Source of Truth

- **Branch:** `gmerge/0.26.0`
- **Upstream range:** `v0.25.2..v0.26.0`
- **Current parity baseline:** LLxprt already matched upstream through `v0.25.2`
- **Authoritative decision file:** [`CHERRIES.md`](./CHERRIES.md)
- **Authoritative audit evidence:** [`AUDIT-DETAILS.md`](./AUDIT-DETAILS.md), `audit-batch1.md` through `audit-batch5.md`
- **Execution artifacts to update continuously:** [`PROGRESS.md`](./PROGRESS.md), [`NOTES.md`](./NOTES.md), [`AUDIT.md`](./AUDIT.md)

This plan is based on the **revised** `CHERRIES.md` counts (post human review 2026-03-25):

- PICK: **22**
- REIMPLEMENT: **42**
- SKIP: **85**
- NO_OP: **5**
- Total upstream commits audited: **154**
- Executable batches in this plan: **47** (5 PICK batches + 42 REIMPLEMENT batches)

---

## Non-Negotiables

- Preserve LLxprt multi-provider architecture, provider-neutral auth, and LLxprt tool batching behavior.
- Do not reintroduce Clearcut, Google telemetry, Google auth assumptions, quota-dialog UX, Smart Edit, NextSpeakerChecker, Flash fallback behavior, or automatic model routing.
- Do not adopt upstream /agents, AgentRegistry, DelegateToAgentTool, or markdown-frontmatter agent architecture where LLxprt uses /subagent, SubagentManager, and task().
- Keep A2A server work private and leave deferred A2A follow-ups with issue #1675 unless a playbook says otherwise.
- Preserve LLxprt branding, package names, tool names, and policy semantics; use `dev-docs/cherrypicking.md` as the canonical substitution guide.

Use both [`dev-docs/cherrypicking-runbook.md`](../../dev-docs/cherrypicking-runbook.md) and [`dev-docs/cherrypicking.md`](../../dev-docs/cherrypicking.md) throughout execution. If they ever disagree on workflow or cadence, the runbook wins.

---

## File Existence Pre-Check

Before any REIMPLEMENT batch, confirm the current tree still matches this pre-check. If a path listed as present disappears, or a path listed as missing now exists, re-read the relevant playbook before editing.

**Present and expected to be adapted in-place:**

- `packages/core/src/utils/shell-parser.ts` (R10: shell timeout)
- `packages/core/src/utils/shell-utils.ts`
- `packages/core/src/services/shellExecutionService.ts`
- `packages/cli/src/config/keyBindings.ts` (R3, R4, R7, R9, R19)
- `packages/cli/src/config/keyMatchers.ts`
- `packages/cli/src/ui/components/text-buffer.ts`
- `packages/cli/src/ui/components/Help.tsx` (R24)
- `packages/cli/src/ui/constants.ts` (R24)
- `packages/cli/src/utils/installationInfo.ts` (R25)
- `packages/core/src/skills/skillManager.ts` (R12)
- `packages/cli/src/commands/skills/install.ts` (R11)
- `packages/core/src/hooks/hookRegistry.ts` (R20)
- `packages/core/src/hooks/types.ts` (R20)
- `packages/core/src/hooks/hookSystem.ts` (R30, R33, R40)
- `packages/core/src/core/geminiChatHookTriggers.ts`
- `packages/core/src/core/lifecycleHookTriggers.ts`
- `packages/cli/src/ui/hooks/useGeminiStream.ts` (R27)
- `packages/cli/src/ui/hooks/useReactToolScheduler.ts` (R18, R26)
- `packages/core/src/config/config.ts` (R14, R21, R36)
- `packages/cli/src/config/settingsSchema.ts` (R14, R21)
- `packages/core/src/policy/policyEngine.ts` (R13, R28)
- `packages/core/src/core/compression/CompressionHandler.ts` (R29)
- `packages/core/src/core/client.ts` (R37)
- `packages/core/src/utils/package.ts` (R41, R42)
- `packages/cli/src/ui/components/SettingsDialog.tsx`
- `packages/cli/src/ui/components/ShellConfirmationDialog.tsx` (R22)
- `packages/cli/src/ui/components/views/ExtensionsList.tsx` (R1)
- `packages/cli/src/config/extensions/settingsIntegration.ts` (R1)
- `packages/core/src/core/prompts.ts`
- `packages/core/src/tools/tool-executor.ts` (R2)
- `packages/core/src/scheduler/types.ts` (R6)
- `packages/core/src/core/turn.ts`
- `packages/cli/src/ui/AppContainer.tsx`
- `packages/cli/src/utils/fileSearch.ts` (R15)
- `packages/cli/src/ui/components/ChatInput.tsx` (R31, R34, R35)

**Missing (may need to be created):**

- `packages/cli/src/ui/hooks/toolMapping.ts` (R26 may create)
- `packages/core/src/hooks/hookConfigTypes.ts` (R33 may create)

---

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
| `gemini-cli` (package name) | `llxprt-code` |
| `geminicli.com` | `vybestack.dev/llxprt-code` |
| `GEMINI.md` | `LLXPRT.md` |
| `gemini-cli` (Homebrew formula) | `llxprt-code` (tap: `vybestack/homebrew-tap`) |

Aliases like `ls`, `grep`, and `edit` remain model-facing aliases only. LLxprt canonical tool names stay `list_directory`, `search_file_content`, and `replace`.

---

## Verification Cadence

After **every batch**, the reviewer must run **Quick Verify**:

```bash
npm run lint
npm run typecheck
```

After **every even-numbered batch** (P2, P4, R2, R4, R6, …), the reviewer must run **Full Verify**:

```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

If `npm run format` changes files during Full Verify, keep those formatting changes and commit them with the batch or its immediate follow-up fix commit. Do **not** rerun lint/typecheck/test solely because formatting changed files.

Before final push / PR prep, rerun the full verification suite.

---

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

> **Note:** The reviewer role is implemented via the `deepthinker` subagent.

---

## Coordinator Execution Rules

1. Create the todo list first using the exact `todo_write` block below.
2. Execute sequentially in batch order; do not skip ahead.
3. Mark todos `in_progress` when starting and `completed` only when actually done.
4. Review is mandatory; never skip the `*-review` item.
5. Commit only after review passes.
6. If remediation is needed, keep the `*-exec` item in play until deepthinker PASS is obtained.
7. Create a follow-up fix commit immediately if remediation after review produces additional changes that should not be squashed into the original batch commit.
8. Do not stop for progress-report questions; keep going until the todo list is empty or a true blocker appears.
9. On context wipe, recover by reading this plan, `todo_read()`, `PROGRESS.md`, `NOTES.md`, and `AUDIT.md`.
10. Use `task()` for execution and review work; do not self-perform cherry-picks or reviews.

---

## Note-taking Requirement

After **every batch** (PICK or REIMPLEMENT), update these files before proceeding to the next batch:

1. **`PROGRESS.md`** — Record the batch ID, commit SHA(s), LLxprt commit hash, and status (success/fix-needed).
2. **`NOTES.md`** — Record any conflicts resolved, LLxprt-specific adaptations made, or deviations from the playbook.
3. **`AUDIT.md`** — Record the upstream SHA, LLxprt SHA, verification result (PASS/FAIL), and any issues found during review.

These updates are mandatory and must be completed before the `*-commit` todo is marked `completed`.

---

## Dependency Chains (Batch Ordering Constraints)

These commits have dependencies. Their batches MUST be executed in this order:

1. **Keybinding chain:** R3 (09a7301) → R7 (fb76408) → R9 (42c26d1) → R19 (ce35d84)
2. **Skills chain:** P1 includes 4848f42 → R12 (222b739 depends on skill frontmatter)
3. **Newline chain:** R31 (645e2ec) → R34 (aceb06a)
4. **Package.ts chain:** R41 (43846f4) → R42 (d8e9db3)
5. **Settings chain:** R14 (f7f38e2) should precede R21 (608da23) and R36 (93ae777)
6. **Hooks chain:** R20 (9722ec9) before R30 (e92f60b) before R33 (211d2c5) before R40 (2a3c879)

The batch numbering already respects these constraints.

---

## Todo List Management

Use this exact tool call when initializing or restoring the execution todo list:

```json
{
  "todos": [
    {"id": "P1-exec", "content": "Batch P1 EXECUTE: cherry-pick c04af6c f6c2d61 c8c7b57 4848f42 d0bbc7f — docs + skills (project→workspace, colons, parsing)", "status": "pending"},
    {"id": "P1-review", "content": "Batch P1 REVIEW: verify commits landed, quick verify (lint+typecheck), qualitative check", "status": "pending"},
    {"id": "P1-commit", "content": "Batch P1 COMMIT: git add -A && git commit", "status": "pending"},
    {"id": "P2-exec", "content": "Batch P2 EXECUTE: cherry-pick 448fd3c 6740886 be37c26 41e01c2 d8a8b43 — tsconfig, ModelInfo abort, text-buffer perf, PKCE, OSC-52", "status": "pending"},
    {"id": "P2-review", "content": "Batch P2 REVIEW: FULL VERIFY (lint+typecheck+test+format+build+smoke), qualitative check", "status": "pending"},
    {"id": "P2-commit", "content": "Batch P2 COMMIT: git add -A && git commit", "status": "pending"},
    {"id": "P3-exec", "content": "Batch P3 EXECUTE: cherry-pick a90bcf7 155d9aa 4920ad2 166e04a 88df621 — /introspect, hooks return type, themes doc, mcp instructions, hook tests", "status": "pending"},
    {"id": "P3-review", "content": "Batch P3 REVIEW: verify commits landed, quick verify (lint+typecheck), qualitative check", "status": "pending"},
    {"id": "P3-commit", "content": "Batch P3 COMMIT: git add -A && git commit", "status": "pending"},
    {"id": "P4-exec", "content": "Batch P4 EXECUTE: cherry-pick 85b1716 b99e841 995ae42 2455f93 55c2783 — extension examples, Windows pty, DebugProfiler, home/end, mcp http", "status": "pending"},
    {"id": "P4-review", "content": "Batch P4 REVIEW: FULL VERIFY (lint+typecheck+test+format+build+smoke), qualitative check", "status": "pending"},
    {"id": "P4-commit", "content": "Batch P4 COMMIT: git add -A && git commit", "status": "pending"},
    {"id": "P5-exec", "content": "Batch P5 EXECUTE: cherry-pick 9866eb0 97aac69 — editor fallback, mcp tool lookup", "status": "pending"},
    {"id": "P5-review", "content": "Batch P5 REVIEW: verify commits landed, quick verify (lint+typecheck), qualitative check", "status": "pending"},
    {"id": "P5-commit", "content": "Batch P5 COMMIT: git add -A && git commit", "status": "pending"},
    {"id": "R1-exec", "content": "Batch R1 REIMPLEMENT: 3b55581 — extension config setting", "status": "pending"},
    {"id": "R1-review", "content": "Batch R1 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R1-commit", "content": "Batch R1 COMMIT", "status": "pending"},
    {"id": "R2-exec", "content": "Batch R2 REIMPLEMENT: a3234fb — rootCommands array for policy parsing", "status": "pending"},
    {"id": "R2-review", "content": "Batch R2 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R2-commit", "content": "Batch R2 COMMIT", "status": "pending"},
    {"id": "R3-exec", "content": "Batch R3 REIMPLEMENT: 09a7301 — remove \\x7f key bindings (keybinding chain 1/4)", "status": "pending"},
    {"id": "R3-review", "content": "Batch R3 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R3-commit", "content": "Batch R3 COMMIT", "status": "pending"},
    {"id": "R4-exec", "content": "Batch R4 REIMPLEMENT: 94d5ae5 — simplify paste handling", "status": "pending"},
    {"id": "R4-review", "content": "Batch R4 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R4-commit", "content": "Batch R4 COMMIT", "status": "pending"},
    {"id": "R5-exec", "content": "Batch R5 REIMPLEMENT: 7e6817d — stdin close exit cleanup (Zed ACP)", "status": "pending"},
    {"id": "R5-review", "content": "Batch R5 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R5-commit", "content": "Batch R5 COMMIT", "status": "pending"},
    {"id": "R6-exec", "content": "Batch R6 REIMPLEMENT: 6021e4c — scheduler event types", "status": "pending"},
    {"id": "R6-review", "content": "Batch R6 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R6-commit", "content": "Batch R6 COMMIT", "status": "pending"},
    {"id": "R7-exec", "content": "Batch R7 REIMPLEMENT: fb76408 — remove sequence binding (keybinding chain 2/4)", "status": "pending"},
    {"id": "R7-review", "content": "Batch R7 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R7-commit", "content": "Batch R7 COMMIT", "status": "pending"},
    {"id": "R8-exec", "content": "Batch R8 REIMPLEMENT: a2dab14 — undeprecate --prompt flag", "status": "pending"},
    {"id": "R8-review", "content": "Batch R8 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R8-commit", "content": "Batch R8 COMMIT", "status": "pending"},
    {"id": "R9-exec", "content": "Batch R9 REIMPLEMENT: 42c26d1 — improve keybindings MOVE_UP/MOVE_DOWN (keybinding chain 3/4)", "status": "pending"},
    {"id": "R9-review", "content": "Batch R9 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R9-commit", "content": "Batch R9 COMMIT", "status": "pending"},
    {"id": "R10-exec", "content": "Batch R10 REIMPLEMENT: ae19802 — add timeout to tree-sitter parsing in shell-parser.ts", "status": "pending"},
    {"id": "R10-review", "content": "Batch R10 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R10-commit", "content": "Batch R10 COMMIT", "status": "pending"},
    {"id": "R11-exec", "content": "Batch R11 REIMPLEMENT: a81500a — security consent for skill installation", "status": "pending"},
    {"id": "R11-review", "content": "Batch R11 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R11-commit", "content": "Batch R11 COMMIT", "status": "pending"},
    {"id": "R12-exec", "content": "Batch R12 REIMPLEMENT: 222b739 — skill conflict detection and warnings", "status": "pending"},
    {"id": "R12-review", "content": "Batch R12 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R12-commit", "content": "Batch R12 COMMIT", "status": "pending"},
    {"id": "R13-exec", "content": "Batch R13 REIMPLEMENT: f909c9e — policy source tracking", "status": "pending"},
    {"id": "R13-review", "content": "Batch R13 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R13-commit", "content": "Batch R13 COMMIT", "status": "pending"},
    {"id": "R14-exec", "content": "Batch R14 REIMPLEMENT: f7f38e2 — **HIGH RISK** non-nullable merged settings (59 files)", "status": "pending"},
    {"id": "R14-review", "content": "Batch R14 REVIEW: FULL VERIFY, qualitative check — extra scrutiny", "status": "pending"},
    {"id": "R14-commit", "content": "Batch R14 COMMIT", "status": "pending"},
    {"id": "R15-exec", "content": "Batch R15 REIMPLEMENT: e77d7b2 — OOM prevention (maxFiles/timeout in crawler)", "status": "pending"},
    {"id": "R15-review", "content": "Batch R15 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R15-commit", "content": "Batch R15 COMMIT", "status": "pending"},
    {"id": "R16-exec", "content": "Batch R16 REIMPLEMENT: 8a627d6 — /dev/tty safety (async pickTty with timeout)", "status": "pending"},
    {"id": "R16-review", "content": "Batch R16 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R16-commit", "content": "Batch R16 COMMIT", "status": "pending"},
    {"id": "R17-exec", "content": "Batch R17 REIMPLEMENT: 1e8f87f — MCPDiscoveryState tracking", "status": "pending"},
    {"id": "R17-review", "content": "Batch R17 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R17-commit", "content": "Batch R17 COMMIT", "status": "pending"},
    {"id": "R18-exec", "content": "Batch R18 REIMPLEMENT: cfdc4cf — scheduleToolCalls race condition fix", "status": "pending"},
    {"id": "R18-review", "content": "Batch R18 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R18-commit", "content": "Batch R18 COMMIT", "status": "pending"},
    {"id": "R19-exec", "content": "Batch R19 REIMPLEMENT: ce35d84 — organize key bindings (keybinding chain 4/4)", "status": "pending"},
    {"id": "R19-review", "content": "Batch R19 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R19-commit", "content": "Batch R19 COMMIT", "status": "pending"},
    {"id": "R20-exec", "content": "Batch R20 REIMPLEMENT: 9722ec9 — hook event name validation (hooks chain 1/4)", "status": "pending"},
    {"id": "R20-review", "content": "Batch R20 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R20-commit", "content": "Batch R20 COMMIT", "status": "pending"},
    {"id": "R21-exec", "content": "Batch R21 REIMPLEMENT: 608da23 — **HIGH RISK** rename disable* → enable* settings (22+ files)", "status": "pending"},
    {"id": "R21-review", "content": "Batch R21 REVIEW: FULL VERIFY, qualitative check — extra scrutiny", "status": "pending"},
    {"id": "R21-commit", "content": "Batch R21 COMMIT", "status": "pending"},
    {"id": "R22-exec", "content": "Batch R22 REIMPLEMENT: 1681ae1 — unify shell confirmation dialogs", "status": "pending"},
    {"id": "R22-review", "content": "Batch R22 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R22-commit", "content": "Batch R22 COMMIT", "status": "pending"},
    {"id": "R23-exec", "content": "Batch R23 REIMPLEMENT: 272570c — skills enabled by default", "status": "pending"},
    {"id": "R23-review", "content": "Batch R23 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R23-commit", "content": "Batch R23 COMMIT", "status": "pending"},
    {"id": "R24-exec", "content": "Batch R24 REIMPLEMENT: 6900253 — keyboard shortcuts URL → vybestack.dev", "status": "pending"},
    {"id": "R24-review", "content": "Batch R24 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R24-commit", "content": "Batch R24 COMMIT", "status": "pending"},
    {"id": "R25-exec", "content": "Batch R25 REIMPLEMENT: 4cfbe4c — Homebrew detection fix for llxprt-code", "status": "pending"},
    {"id": "R25-review", "content": "Batch R25 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R25-commit", "content": "Batch R25 COMMIT", "status": "pending"},
    {"id": "R26-exec", "content": "Batch R26 REIMPLEMENT: 1b6b6d4 — centralize tool mapping", "status": "pending"},
    {"id": "R26-review", "content": "Batch R26 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R26-commit", "content": "Batch R26 COMMIT", "status": "pending"},
    {"id": "R27-exec", "content": "Batch R27 REIMPLEMENT: 0bebc66 — flush rationale before scheduling tool calls", "status": "pending"},
    {"id": "R27-review", "content": "Batch R27 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R27-commit", "content": "Batch R27 COMMIT", "status": "pending"},
    {"id": "R28-exec", "content": "Batch R28 REIMPLEMENT: ec74134 — shell redirection transparency and security", "status": "pending"},
    {"id": "R28-review", "content": "Batch R28 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R28-commit", "content": "Batch R28 COMMIT", "status": "pending"},
    {"id": "R29-exec", "content": "Batch R29 REIMPLEMENT: 1182168 — enhanced compression (adapt concepts to LLxprt strategy pattern)", "status": "pending"},
    {"id": "R29-review", "content": "Batch R29 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R29-commit", "content": "Batch R29 COMMIT", "status": "pending"},
    {"id": "R30-exec", "content": "Batch R30 REIMPLEMENT: e92f60b — migrate BeforeModel/AfterModel hooks to HookSystem (hooks chain 2/4)", "status": "pending"},
    {"id": "R30-review", "content": "Batch R30 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R30-commit", "content": "Batch R30 COMMIT", "status": "pending"},
    {"id": "R31-exec", "content": "Batch R31 REIMPLEMENT: 645e2ec — Ctrl+Enter/Ctrl+J newline fix", "status": "pending"},
    {"id": "R31-review", "content": "Batch R31 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R31-commit", "content": "Batch R31 COMMIT", "status": "pending"},
    {"id": "R32-exec", "content": "Batch R32 REIMPLEMENT: b288f12 — MCP client version (llxprt-code package name)", "status": "pending"},
    {"id": "R32-review", "content": "Batch R32 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R32-commit", "content": "Batch R32 COMMIT", "status": "pending"},
    {"id": "R33-exec", "content": "Batch R33 REIMPLEMENT: 211d2c5 — **HIGH RISK** hooks properties are event names (schema split) (hooks chain 3/4)", "status": "pending"},
    {"id": "R33-review", "content": "Batch R33 REVIEW: FULL VERIFY, qualitative check — extra scrutiny", "status": "pending"},
    {"id": "R33-commit", "content": "Batch R33 COMMIT", "status": "pending"},
    {"id": "R34-exec", "content": "Batch R34 REIMPLEMENT: aceb06a — newline fix follow-up (depends on R31)", "status": "pending"},
    {"id": "R34-review", "content": "Batch R34 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R34-commit", "content": "Batch R34 COMMIT", "status": "pending"},
    {"id": "R35-exec", "content": "Batch R35 REIMPLEMENT: e1fd5be — Esc-Esc to clear prompt", "status": "pending"},
    {"id": "R35-review", "content": "Batch R35 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R35-commit", "content": "Batch R35 COMMIT", "status": "pending"},
    {"id": "R36-exec", "content": "Batch R36 REIMPLEMENT: 93ae777 — System scopes migration fix", "status": "pending"},
    {"id": "R36-review", "content": "Batch R36 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R36-commit", "content": "Batch R36 COMMIT", "status": "pending"},
    {"id": "R37-exec", "content": "Batch R37 REIMPLEMENT: 0fa9a54 — auth failure sandbox handling", "status": "pending"},
    {"id": "R37-review", "content": "Batch R37 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R37-commit", "content": "Batch R37 COMMIT", "status": "pending"},
    {"id": "R38-exec", "content": "Batch R38 REIMPLEMENT: ee87c98 — fast return buffer keypress flags", "status": "pending"},
    {"id": "R38-review", "content": "Batch R38 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R38-commit", "content": "Batch R38 COMMIT", "status": "pending"},
    {"id": "R39-exec", "content": "Batch R39 REIMPLEMENT: cebe386 — **HIGH RISK** MCP status hook refactor (hooks chain 4/4)", "status": "pending"},
    {"id": "R39-review", "content": "Batch R39 REVIEW: FULL VERIFY, qualitative check — extra scrutiny", "status": "pending"},
    {"id": "R39-commit", "content": "Batch R39 COMMIT", "status": "pending"},
    {"id": "R40-exec", "content": "Batch R40 REIMPLEMENT: 2a3c879 — clearContext for AfterAgent hooks", "status": "pending"},
    {"id": "R40-review", "content": "Batch R40 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R40-commit", "content": "Batch R40 COMMIT", "status": "pending"},
    {"id": "R41-exec", "content": "Batch R41 REIMPLEMENT: 43846f4 — package.ts try/catch readPackageUp", "status": "pending"},
    {"id": "R41-review", "content": "Batch R41 REVIEW: quick verify, qualitative check", "status": "pending"},
    {"id": "R41-commit", "content": "Batch R41 COMMIT", "status": "pending"},
    {"id": "R42-exec", "content": "Batch R42 REIMPLEMENT: d8e9db3 — package.ts debugLogger.error in catch", "status": "pending"},
    {"id": "R42-review", "content": "Batch R42 REVIEW: FULL VERIFY, qualitative check", "status": "pending"},
    {"id": "R42-commit", "content": "Batch R42 COMMIT", "status": "pending"},
    {"id": "FINAL-progress", "content": "UPDATE PROGRESS.md with all commit hashes", "status": "pending"},
    {"id": "FINAL-notes", "content": "UPDATE NOTES.md with final summary", "status": "pending"},
    {"id": "FINAL-audit", "content": "UPDATE AUDIT.md with all outcomes and LLxprt commit hashes", "status": "pending"}
  ]
}
```

---

## Batch Schedule

### PICK Batches (22 commits in 5 batches)

---

### Batch P1 — PICK x5: docs + skills

**Commits:** `c04af6c` `f6c2d61` `c8c7b57` `4848f42` `d0bbc7f`

**Subjects:**
1. `c04af6c` — docs: clarify F12 to open debug console
2. `f6c2d61` — docs: Remove .md extension from internal links
3. `c8c7b57` — refactor(skills): replace project with workspace scope
4. `4848f42` — fix: Handle colons in skill description frontmatter
5. `d0bbc7f` — refactor(core): harden skill frontmatter parsing

**Verification:** Quick (lint + typecheck)

#### Execution Prompt (cherrypicker)

```
You are cherry-picking 5 upstream gemini-cli commits into LLxprt Code on branch gmerge/0.26.0.

COMMITS (apply in this order):
1. c04af6c — docs: clarify F12 to open debug console
2. f6c2d61 — docs: Remove .md extension from internal links
3. c8c7b57 — refactor(skills): replace project with workspace scope
4. 4848f42 — fix: Handle colons in skill description frontmatter
5. d0bbc7f — refactor(core): harden skill frontmatter parsing

COMMANDS:
git cherry-pick c04af6c3e f6c2d6190 c8c7b57a7 4848f4248 d0bbc7fa5

CONFLICT RESOLUTION:
- For c8c7b57: if conflicts occur in skill files, keep LLxprt's structure but accept the "project" → "workspace" terminology change. LLxprt commands, settings, and CLI still say "project" — all should become "workspace".
- For doc files: preserve LLxprt branding. Replace any @google/gemini-cli references with @vybestack/llxprt-code.
- For skill frontmatter (4848f42, d0bbc7f): these should apply cleanly to packages/core/src/skills/skillLoader.ts.

AFTER CHERRY-PICKING:
Run: npm run lint && npm run typecheck
Fix any errors. Do NOT commit — the coordinator will commit after review.

Read dev-docs/cherrypicking.md for branding rules.
```

#### Review Prompt (deepthinker)

```
Review Batch P1 of the gmerge/0.26.0 cherry-pick sync.

MECHANICAL VERIFICATION:
1. Run: npm run lint && npm run typecheck
2. Confirm no @google/gemini-cli-core imports, no USE_GEMINI references
3. Confirm no geminicli.com URLs

QUALITATIVE VERIFICATION — for EACH of these 5 commits, verify:
- c04af6c: doc change landed in LLxprt's docs (not upstream-only path)
- f6c2d61: internal links updated (no broken .md extensions)
- c8c7b57: ALL "project" → "workspace" changes applied in skill scope strings, CLI descriptions, settings. Check: packages/cli/src/commands/skills/disable.ts, packages/cli/src/utils/skillUtils.ts, packages/core/src/skills/skillManager.ts
- 4848f42: YAML colon handling in skillLoader.ts — test with a skill that has colons in description
- d0bbc7f: frontmatter regex hardening in skillLoader.ts

OUTPUT: For each commit state LANDED/NOT_LANDED and FUNCTIONAL/NOT_FUNCTIONAL. Then overall PASS or FAIL with specific issues.
```

**Commit message:** `cherry-pick: upstream v0.25.2..v0.26.0 batch P1 — docs + skills`

---

### Batch P2 — PICK x5: core fixes + UI perf

**Commits:** `448fd3c` `6740886` `be37c26` `41e01c2` `d8a8b43`

**Subjects:**
1. `448fd3c` — fix(core): resolve circular dependency tsconfig
2. `6740886` — fix(core): prevent ModelInfo emission on aborted signal
3. `be37c26` — perf(ui): optimize text buffer and highlighting
4. `41e01c2` — fix(core): resolve PKCE length and OAuth redirect port
5. `d8a8b43` — fix(cli): use OSC-52 clipboard copy in Windows Terminal

**Verification:** FULL (even batch — lint+typecheck+test+format+build+smoke)

#### Execution Prompt (cherrypicker)

```
You are cherry-picking 5 upstream gemini-cli commits into LLxprt Code on branch gmerge/0.26.0.

COMMITS (apply in this order):
1. 448fd3c — fix(core): resolve circular dependency tsconfig
2. 6740886 — fix(core): prevent ModelInfo emission on aborted signal
3. be37c26 — perf(ui): optimize text buffer and highlighting
4. 41e01c2 — fix(core): resolve PKCE length and OAuth redirect port
5. d8a8b43 — fix(cli): use OSC-52 clipboard copy in Windows Terminal

COMMANDS:
git cherry-pick 448fd3ca6 6740886e2 be37c26c8 41e01c232 d8a8b434f

CONFLICT RESOLUTION:
- be37c26 (text buffer): LLxprt uses LruCache not mnemoist. If conflicts in text-buffer.ts or highlight.ts, keep LLxprt's LruCache imports. The performance optimizations (avoid redundant highlighting, buffer pooling) should still apply.
- 41e01c2 (PKCE/OAuth): should apply cleanly to packages/core/src/auth/oauth-provider.ts
- d8a8b43 (OSC-52): should apply cleanly to packages/cli/src/ui/commandUtils.ts

AFTER CHERRY-PICKING:
Run FULL verification: npm run lint && npm run typecheck && npm run test && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
Fix any errors. Do NOT commit.

Read dev-docs/cherrypicking.md for branding rules.
```

#### Review Prompt (deepthinker)

```
Review Batch P2 of the gmerge/0.26.0 cherry-pick sync. This is an EVEN batch — FULL VERIFY required.

MECHANICAL VERIFICATION:
1. Run: npm run lint && npm run typecheck && npm run test && npm run format && npm run build
2. Run: node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
3. Confirm no @google/gemini-cli-core imports, no USE_GEMINI, no geminicli.com

QUALITATIVE VERIFICATION — for EACH commit:
- 448fd3c: tsconfig paths change resolves circular dep — verify tsc resolves cleanly
- 6740886: check client.ts for !signal.aborted guard before ModelInfo yield
- be37c26: verify LruCache still used (not mnemoist). Performance optimizations in text-buffer.ts and highlight.ts landed correctly.
- 41e01c2: PKCE code verifier length fix + OAuth port stability in oauth-provider.ts
- d8a8b43: OSC-52 clipboard copy added to commandUtils.ts for Windows Terminal detection

OUTPUT: Per-commit LANDED/FUNCTIONAL. Overall PASS/FAIL.
```

**Commit message:** `cherry-pick: upstream v0.25.2..v0.26.0 batch P2 — core fixes + UI perf`

---

### Batch P3 — PICK x5: commands + hooks + mcp

**Commits:** `a90bcf7` `155d9aa` `4920ad2` `166e04a` `88df621`

**Subjects:**
1. `a90bcf7` — feat: add /introspect slash command
2. `155d9aa` — fix: return type of fireSessionStartEvent
3. `4920ad2` — docs(themes): remove unsupported DiffModified
4. `166e04a` — Fix mcp instructions
5. `88df621` — Test coverage for hook exit code cases

**Verification:** Quick (lint + typecheck)

#### Execution Prompt (cherrypicker)

```
You are cherry-picking 5 upstream gemini-cli commits into LLxprt Code on branch gmerge/0.26.0.

COMMITS:
1. a90bcf7 — feat: add /introspect slash command (TOML policy file)
2. 155d9aa — fix: return type of fireSessionStartEvent to DefaultHookOutput
3. 4920ad2 — docs(themes): remove unsupported DiffModified color key
4. 166e04a — Fix mcp instructions refresh
5. 88df621 — Test coverage for hook exit code cases

COMMANDS:
git cherry-pick a90bcf749 155d9aafe 4920ad269 166e04a8d 88df6210e

CONFLICT RESOLUTION:
- a90bcf7 (/introspect): This adds a new TOML policy file for the /introspect command. The path may need adjustment — verify it goes in packages/core/src/policy/policies/ or equivalent. The command should be provider-agnostic.
- 155d9aa: Should apply cleanly to hookSystem.ts — just changes return type.
- 166e04a: Should apply to mcp-client-manager.ts — fixes instruction refresh timing.
- 88df621: New test file for hook exit codes — should be provider-agnostic.

AFTER CHERRY-PICKING:
Run: npm run lint && npm run typecheck
Fix any errors. Do NOT commit.
```

#### Review Prompt (deepthinker)

```
Review Batch P3 of the gmerge/0.26.0 cherry-pick sync.

MECHANICAL: npm run lint && npm run typecheck
BRANDING: no @google/gemini-cli-core, no USE_GEMINI, no geminicli.com

QUALITATIVE — per commit:
- a90bcf7: /introspect command TOML exists and is valid, command registered
- 155d9aa: fireSessionStartEvent return type is DefaultHookOutput
- 4920ad2: DiffModified removed from theme docs
- 166e04a: MCP instruction refresh fix in mcp-client-manager.ts
- 88df621: hook exit code tests — verify tests are provider-agnostic

OUTPUT: Per-commit LANDED/FUNCTIONAL. Overall PASS/FAIL.
```

**Commit message:** `cherry-pick: upstream v0.25.2..v0.26.0 batch P3 — commands + hooks + mcp`

---

### Batch P4 — PICK x5: extensions + pty + UI + mcp

**Commits:** `85b1716` `b99e841` `995ae42` `2455f93` `55c2783`

**Subjects:**
1. `85b1716` — Revert "Revert "Update extension examples""
2. `b99e841` — Fixes Windows crash: resize pty already exited
3. `995ae42` — Avoid spurious render warnings (DebugProfiler)
4. `2455f93` — fix(cli): resolve home/end keybinding conflict
5. `55c2783` — fix(cli): display http type on mcp list

**Verification:** FULL (even batch)

#### Execution Prompt (cherrypicker)

```
You are cherry-picking 5 upstream gemini-cli commits into LLxprt Code on branch gmerge/0.26.0.

COMMITS:
1. 85b1716 — Update extension examples
2. b99e841 — Windows pty crash fix (resize after exit)
3. 995ae42 — DebugProfiler spurious render warnings
4. 2455f93 — home/end keybinding conflict resolution
5. 55c2783 — display 'http' type on mcp list command

COMMANDS:
git cherry-pick 85b17166a b99e84102 995ae42f5 2455f939a 55c2783e6

CONFLICT RESOLUTION:
- 85b1716: Extension examples may reference gemini-cli package names — fix to llxprt-code
- 2455f93: LLxprt has extra commands in keyBindings.ts (TOGGLE_TODO_DIALOG, TOGGLE_MOUSE_EVENTS, REFRESH_KEYPRESS). Preserve all LLxprt-specific bindings while applying the home/end conflict fix.
- 55c2783: should apply cleanly to the mcp list command handler

AFTER CHERRY-PICKING:
Run FULL: npm run lint && npm run typecheck && npm run test && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
Fix any errors. Do NOT commit.
```

#### Review Prompt (deepthinker)

```
Review Batch P4 of the gmerge/0.26.0 cherry-pick sync. EVEN batch — FULL VERIFY.

MECHANICAL:
1. npm run lint && npm run typecheck && npm run test && npm run format && npm run build
2. node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
3. Branding check

QUALITATIVE — per commit:
- 85b1716: Extension examples use @vybestack/llxprt-code-core, not @google
- b99e841: try/catch around pty.resize() in shellExecutionService.ts
- 995ae42: DebugProfiler event listener warning fix
- 2455f93: home/end keybindings don't conflict; LLxprt extra commands preserved (TOGGLE_TODO_DIALOG, TOGGLE_MOUSE_EVENTS, REFRESH_KEYPRESS)
- 55c2783: 'http' displayed instead of 'sse' for URL-based MCP servers

OUTPUT: Per-commit LANDED/FUNCTIONAL. Overall PASS/FAIL.
```

**Commit message:** `cherry-pick: upstream v0.25.2..v0.26.0 batch P4 — extensions + pty + UI + mcp`

---

### Batch P5 — PICK x2: editor + mcp lookup

**Commits:** `9866eb0` `97aac69`

**Subjects:**
1. `9866eb0` — fix: bad fallback logic external editor
2. `97aac69` — Fix mcp tool lookup in tool registry

**Verification:** Quick (lint + typecheck)

#### Execution Prompt (cherrypicker)

```
You are cherry-picking 2 upstream gemini-cli commits into LLxprt Code on branch gmerge/0.26.0.

COMMITS:
1. 9866eb0 — fix: operator precedence in external editor fallback logic
2. 97aac69 — Fix mcp tool lookup: adds getFullyQualifiedName() and fallback lookup

COMMANDS:
git cherry-pick 9866eb055 97aac696f

CONFLICT RESOLUTION:
- 9866eb0: Simple operator precedence fix — should apply cleanly
- 97aac69: Adds getFullyQualifiedName() to MCP tool registry. Check LLxprt's tool registry for compatibility.

AFTER CHERRY-PICKING:
Run: npm run lint && npm run typecheck
Fix any errors. Do NOT commit.
```

#### Review Prompt (deepthinker)

```
Review Batch P5 of the gmerge/0.26.0 cherry-pick sync.

MECHANICAL: npm run lint && npm run typecheck. Branding check.

QUALITATIVE:
- 9866eb0: editor fallback logic uses correct operator precedence
- 97aac69: getFullyQualifiedName() added to MCP tool registry, fallback lookup works for tools with server prefix

OUTPUT: Per-commit LANDED/FUNCTIONAL. Overall PASS/FAIL.
```

**Commit message:** `cherry-pick: upstream v0.25.2..v0.26.0 batch P5 — editor + mcp lookup`

---

### REIMPLEMENT Batches (42 commits, solo batches)

Each REIMPLEMENT batch has a corresponding playbook file: `project-plans/gmerge-0.26.0/<sha>-plan.md`

For every REIMPLEMENT batch, the execution prompt follows this template:

```
You are reimplementing upstream gemini-cli commit <SHA> for LLxprt Code on branch gmerge/0.26.0.

UPSTREAM COMMIT: <SHA> — <subject>

Read the playbook: project-plans/gmerge-0.26.0/<sha>-plan.md

Then:
1. Run `git show <SHA>` to understand the upstream change
2. Read each LLxprt file mentioned in the playbook
3. Apply the changes described in the playbook
4. Run verification as specified

BRANDING RULES: Read dev-docs/cherrypicking.md
Do NOT commit — the coordinator will commit after review.
```

And the review prompt template:

```
Review Batch R<N> of the gmerge/0.26.0 cherry-pick sync.
Upstream commit: <SHA> — <subject>

MECHANICAL VERIFICATION:
1. Run: npm run lint && npm run typecheck
   (Add npm run test && npm run format && npm run build && smoke test if EVEN batch or HIGH RISK)
2. Branding check: no @google/gemini-cli-core, no USE_GEMINI, no geminicli.com

QUALITATIVE VERIFICATION:
1. Read `git show <SHA>` to understand upstream intent
2. Read the changed LLxprt files
3. Verify: code actually landed (not stubbed), behavioral equivalence achieved, integration correct
4. For this specific commit verify: <specific checks from playbook>

OUTPUT: LANDED/NOT_LANDED, FUNCTIONAL/NOT_FUNCTIONAL, overall PASS/FAIL with specific issues.
```

---

### Batch R1 — 3b55581: extension config setting

**Playbook:** [`3b55581-plan.md`](./3b55581-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: extension config setting (upstream 3b55581)`

---

### Batch R2 — a3234fb: rootCommands array

**Playbook:** [`a3234fb-plan.md`](./a3234fb-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: rootCommands array for policy parsing (upstream a3234fb)`

---

### Batch R3 — 09a7301: remove \x7f bindings (keybinding chain 1/4)

**Playbook:** [`09a7301-plan.md`](./09a7301-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: remove unnecessary \\x7f key bindings (upstream 09a7301)`

---

### Batch R4 — 94d5ae5: simplify paste handling

**Playbook:** [`94d5ae5-plan.md`](./94d5ae5-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: simplify paste handling (upstream 94d5ae5)`

---

### Batch R5 — 7e6817d: stdin close exit cleanup

**Playbook:** [`7e6817d-plan.md`](./7e6817d-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: stdin close exit cleanup for ACP (upstream 7e6817d)`

---

### Batch R6 — 6021e4c: scheduler event types

**Playbook:** [`6021e4c-plan.md`](./6021e4c-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: scheduler event types (upstream 6021e4c)`

---

### Batch R7 — fb76408: remove sequence binding (keybinding chain 2/4)

**Playbook:** [`fb76408-plan.md`](./fb76408-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: remove sequence binding (upstream fb76408)`

---

### Batch R8 — a2dab14: undeprecate --prompt

**Playbook:** [`a2dab14-plan.md`](./a2dab14-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: undeprecate --prompt flag (upstream a2dab14)`

---

### Batch R9 — 42c26d1: improve keybindings (keybinding chain 3/4)

**Playbook:** [`42c26d1-plan.md`](./42c26d1-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: improve keybindings MOVE_UP/MOVE_DOWN (upstream 42c26d1)`

---

### Batch R10 — ae19802: shell parsing timeout

**Playbook:** [`ae19802-plan.md`](./ae19802-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: add timeout to tree-sitter parsing (upstream ae19802)`

---

### Batch R11 — a81500a: skill installation consent

**Playbook:** [`a81500a-plan.md`](./a81500a-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: security consent for skill installation (upstream a81500a)`

---

### Batch R12 — 222b739: skill conflict detection

**Playbook:** [`222b739-plan.md`](./222b739-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: skill conflict detection and warnings (upstream 222b739)`

---

### Batch R13 — f909c9e: policy source tracking

**Playbook:** [`f909c9e-plan.md`](./f909c9e-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: policy source tracking (upstream f909c9e)`

---

### Batch R14 — f7f38e2: **HIGH RISK** non-nullable settings

**Playbook:** [`f7f38e2-plan.md`](./f7f38e2-plan.md)
**Verification:** FULL (forced — high risk) | **Commit msg:** `reimplement: non-nullable merged settings (upstream f7f38e2)`

WARNING: This touches ~59 files in upstream. LLxprt settings architecture has diverged. The playbook must identify which files exist in LLxprt and which settings accessors need the non-nullable treatment. Extra scrutiny during review.

---

### Batch R15 — e77d7b2: OOM prevention

**Playbook:** [`e77d7b2-plan.md`](./e77d7b2-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: OOM prevention in file search (upstream e77d7b2)`

---

### Batch R16 — 8a627d6: /dev/tty safety

**Playbook:** [`8a627d6-plan.md`](./8a627d6-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: safely handle /dev/tty on macOS (upstream 8a627d6)`

---

### Batch R17 — 1e8f87f: MCPDiscoveryState

**Playbook:** [`1e8f87f-plan.md`](./1e8f87f-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: MCP discovery state tracking (upstream 1e8f87f)`

---

### Batch R18 — cfdc4cf: scheduleToolCalls race

**Playbook:** [`cfdc4cf-plan.md`](./cfdc4cf-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: fix scheduleToolCalls race condition (upstream cfdc4cf)`

---

### Batch R19 — ce35d84: organize keybindings (keybinding chain 4/4)

**Playbook:** [`ce35d84-plan.md`](./ce35d84-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: organize key bindings (upstream ce35d84)`

---

### Batch R20 — 9722ec9: hook event name validation (hooks chain 1/4)

**Playbook:** [`9722ec9-plan.md`](./9722ec9-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: hook event name validation (upstream 9722ec9)`

---

### Batch R21 — 608da23: **HIGH RISK** disable→enable settings

**Playbook:** [`608da23-plan.md`](./608da23-plan.md)
**Verification:** FULL (forced — high risk) | **Commit msg:** `reimplement: rename disable* to enable* settings (upstream 608da23)`

WARNING: This touches 22+ files in upstream. Settings migration with backward compatibility. LLxprt has additional settings not in upstream. Extra scrutiny during review.

---

### Batch R22 — 1681ae1: unify shell confirmation

**Playbook:** [`1681ae1-plan.md`](./1681ae1-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: unify shell confirmation dialogs (upstream 1681ae1)`

---

### Batch R23 — 272570c: skills default enabled

**Playbook:** [`272570c-plan.md`](./272570c-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: enable agent skills by default (upstream 272570c)`

---

### Batch R24 — 6900253: keyboard shortcuts URL

**Playbook:** [`6900253-plan.md`](./6900253-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: keyboard shortcuts URL to vybestack.dev (upstream 6900253)`

---

### Batch R25 — 4cfbe4c: Homebrew detection

**Playbook:** [`4cfbe4c-plan.md`](./4cfbe4c-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: fix Homebrew detection for llxprt-code (upstream 4cfbe4c)`

---

### Batch R26 — 1b6b6d4: centralize tool mapping

**Playbook:** [`1b6b6d4-plan.md`](./1b6b6d4-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: centralize tool mapping (upstream 1b6b6d4)`

---

### Batch R27 — 0bebc66: rationale before tool calls

**Playbook:** [`0bebc66-plan.md`](./0bebc66-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: flush rationale before tool call scheduling (upstream 0bebc66)`

---

### Batch R28 — ec74134: shell redirection security

**Playbook:** [`ec74134-plan.md`](./ec74134-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: shell redirection transparency and security (upstream ec74134)`

---

### Batch R29 — 1182168: enhanced compression

**Playbook:** [`1182168-plan.md`](./1182168-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: enhanced compression concepts (upstream 1182168)`

WARNING: LLxprt has completely different compression architecture (CompressionHandler + strategy pattern). Only conceptual adaptation — verification, anchored instruction, empty summary handling.

---

### Batch R30 — e92f60b: migrate hooks (hooks chain 2/4)

**Playbook:** [`e92f60b-plan.md`](./e92f60b-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: migrate BeforeModel/AfterModel hooks (upstream e92f60b)`

---

### Batch R31 — 645e2ec: Ctrl+Enter/Ctrl+J

**Playbook:** [`645e2ec-plan.md`](./645e2ec-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: resolve Ctrl+Enter/Ctrl+J newline (upstream 645e2ec)`

---

### Batch R32 — b288f12: MCP client version

**Playbook:** [`b288f12-plan.md`](./b288f12-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: send llxprt-code version as MCP client version (upstream b288f12)`

---

### Batch R33 — 211d2c5: **HIGH RISK** hooks event names split (hooks chain 3/4)

**Playbook:** [`211d2c5-plan.md`](./211d2c5-plan.md)
**Verification:** FULL (forced — high risk) | **Commit msg:** `reimplement: hooks properties are event names (upstream 211d2c5)`

WARNING: Large schema change splitting hooks into hooksConfig + hooks event names. Extra scrutiny.

---

### Batch R34 — aceb06a: newline fix (depends on R31)

**Playbook:** [`aceb06a-plan.md`](./aceb06a-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: fix newline support (upstream aceb06a)`

---

### Batch R35 — e1fd5be: Esc-Esc clear prompt

**Playbook:** [`e1fd5be-plan.md`](./e1fd5be-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: Esc-Esc to clear prompt (upstream e1fd5be)`

---

### Batch R36 — 93ae777: System scopes migration

**Playbook:** [`93ae777-plan.md`](./93ae777-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: fix System scopes migration (upstream 93ae777)`

---

### Batch R37 — 0fa9a54: auth failure handling

**Playbook:** [`0fa9a54-plan.md`](./0fa9a54-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: auth failure sandbox handling (upstream 0fa9a54)`

---

### Batch R38 — ee87c98: fast return buffer flags

**Playbook:** [`ee87c98-plan.md`](./ee87c98-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: fast return buffer keypress flags (upstream ee87c98)`

---

### Batch R39 — cebe386: **HIGH RISK** MCP status hook (hooks chain 4/4)

**Playbook:** [`cebe386-plan.md`](./cebe386-plan.md)
**Verification:** FULL (forced — high risk) | **Commit msg:** `reimplement: MCP status hook refactor (upstream cebe386)`

WARNING: New useMcpStatus hook, switches appEvents→coreEvents. Significant refactor. Extra scrutiny.

---

### Batch R40 — 2a3c879: clearContext hooks

**Playbook:** [`2a3c879-plan.md`](./2a3c879-plan.md)
**Verification:** FULL (even) | **Commit msg:** `reimplement: add clearContext to AfterAgent hooks (upstream 2a3c879)`

---

### Batch R41 — 43846f4: package.ts error handling

**Playbook:** [`43846f4-plan.md`](./43846f4-plan.md)
**Verification:** Quick | **Commit msg:** `reimplement: package.ts try/catch readPackageUp (upstream 43846f4)`

---

### Batch R42 — d8e9db3: package.ts follow-up

**Playbook:** [`d8e9db3-plan.md`](./d8e9db3-plan.md)
**Verification:** FULL (even — final batch) | **Commit msg:** `reimplement: package.ts debugLogger.error in catch (upstream d8e9db3)`

---

## Failure Recovery

### Cherry-pick conflict (PICK batch)

```bash
git cherry-pick --abort   # Abandon the failed cherry-pick
# Then retry individual commits from the batch one at a time
git cherry-pick <sha1>
# Resolve conflict, git add, git cherry-pick --continue
git cherry-pick <sha2>
# etc.
```

### Reimplement failure

If a REIMPLEMENT batch fails verification:
1. Read the specific error from lint/typecheck/test output
2. Dispatch `cherrypicker` with remediation prompt including the error
3. Re-run `deepthinker` review
4. Loop up to 5 times
5. If still failing after 5 loops, call `todo_pause()` with the exact error

### Verification failure on a previously-passing batch

If a later batch breaks something that worked before:
1. Check `git diff HEAD~N..HEAD` to identify what changed
2. Create a fix commit: `fix: resolve issues from batch R<N>`
3. Rerun full verification before proceeding

### Context wipe recovery

1. `git branch --show-current` → must be `gmerge/0.26.0`
2. `git log --oneline -20` → see what's been done
3. Read `project-plans/gmerge-0.26.0/PLAN.md` (this file)
4. Call `todo_read()` → find first pending item
5. Read `PROGRESS.md`, `NOTES.md`, `AUDIT.md` for current state
6. Resume from the first pending todo item

---

## Context Recovery

**Branch:** `gmerge/0.26.0`
**Range:** `v0.25.2..v0.26.0` (154 upstream commits)
**Decisions:** 22 PICK, 42 REIMPLEMENT, 85 SKIP, 5 NO_OP
**Batches:** 5 PICK (P1-P5) + 42 REIMPLEMENT (R1-R42) = 47 total

**Key files to read:**
- This plan: `project-plans/gmerge-0.26.0/PLAN.md`
- Decisions: `project-plans/gmerge-0.26.0/CHERRIES.md`
- Progress: `project-plans/gmerge-0.26.0/PROGRESS.md`
- Notes: `project-plans/gmerge-0.26.0/NOTES.md`
- Audit: `project-plans/gmerge-0.26.0/AUDIT.md`
- Branding guide: `dev-docs/cherrypicking.md`
- Workflow: `dev-docs/cherrypicking-runbook.md`

**4 HIGH RISK batches** requiring extra scrutiny: R14 (settings non-nullable), R21 (disable→enable), R33 (hooks schema), R39 (MCP status hook)
