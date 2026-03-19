# Execution Plan: gmerge-0.24.5

## START HERE (If you were told to "DO this plan")

### Step 1: Check current state
```bash
git branch --show-current  # Should be gmerge/0.24.5
git status                 # Check for uncommitted changes
```

### Step 2: Check or create the todo list
Call `todo_read()` first. If empty or doesn't exist, call `todo_write()` with the EXACT todo list from the "Todo List" section below.

### Step 3: Find where to resume
- Look at the todo list for the first `pending` item
- If an item is `in_progress`, restart that item
- If all items are `completed`, you're done

### Step 4: Execute using subagents
For each batch, use the `task` tool to invoke subagents:
- **For cherry-pick batches (PICK-BN):** Call `task` with `subagent_name: "cherrypicker"`
- **For REIMPLEMENT batches:** Call `task` with `subagent_name: "typescriptexpert"`
- **For review tasks (BN-review):** Call `task` with `subagent_name: "typescriptreviewer"`
- **DO NOT** do the work yourself — use subagents
- Continue until todo list is empty or you hit a blocker

### Step 5: If blocked
- Call `todo_pause()` with the specific reason
- Wait for human intervention

---

## Non-Negotiables

See `dev-docs/cherrypicking.md` for full details. Summary:

- **Privacy:** No ClearcutLogger, no Google telemetry
- **Multi-provider:** `AuthType.USE_PROVIDER`, not `USE_GEMINI`
- **Branding:** `@vybestack/llxprt-code-core`, `.llxprt` dirs, LLxprt naming
- **Tool batching:** Keep LLxprt's parallel batching in CoreToolScheduler
- **Removed features:** No NextSpeakerChecker, no FlashFallback, no SmartEdit
- **Note:** `gemini.tsx`, `GeminiClient`, `GeminiCLIExtension`, `GeminiStreamEvent` are REAL LLxprt file/class names — NOT branding leakage

## Branding Substitutions

| Upstream | LLxprt |
|----------|--------|
| `@google/gemini-cli-core` | `@vybestack/llxprt-code-core` |
| `@google/gemini-cli` | `@vybestack/llxprt-code` |
| `.gemini/` (user dir) | `.llxprt/` |
| `GEMINI_SYSTEM_MD` | N/A (LLxprt uses `LLXPRT.md`) |
| `gemini skills` (CLI) | `llxprt skills` |

---

## Batch Schedule

### Phase A: Cherry-Picks (34 PICK commits in 8 batches)

Cherry-pick batches of 5, oldest first. Skills chain (11 commits) stays together in 3 batches. Race condition fixes are solo (high-risk).

| Batch | Type | SHAs | Description | Verify |
|-------|------|------|-------------|--------|
| PICK-B1 | PICK×5 | `0a216b28`, `b0d5c4c0`, `e9a601c1`, `b6b0727e`, `5f28614760` | EIO fix, dynamic policy, MCP type fix, schema non-fatal, MCP resources limit | Quick |
| PICK-B2 | PICK×5 | `873d10df`, `56b05042`, `acecd80a`, `21388a0a`, `0eb84f51` | Terse image paths, typo fix, IDE promise fix, GitService fix, integration test cleanup | Full |
| PICK-B3 | PICK×5 | `de1233b8`, `958284dc`, `764b1959`, `e78c3fe4`, `f0a039f7` | Skills: core infra, activation tool, system prompt, status bar, refactor | Quick |
| PICK-B4 | PICK×4 | `bdb349e7`, `d3563e2f`, `2cb33b2f`, `0c541362` | Skills: extension support, CLI commands, reload, workspace context | Full |
| PICK-B5 | PICK×2 | `5f027cb6`, `59a18e71` | Skills: UI fix, documentation | Quick |
| PICK-B6 | PICK×5 | `8a0190ca`, `18fef0db`, `0f3555a4`, `30f5c4af`, `615b218f` | MCP promise fix, shell redirection, /dir add, powershell mock, consent test | Full |
| PICK-B7 | PICK×5 | `3997c7ff`, `dc6dda5c`, `2da911e4`, `8f0324d8`, `a61fb058` | Terminal hang fix, SDK logging, /copy Windows, paste Windows, writeTodo fix | Quick |
| PICK-B8 | PICK×3 | `d2849fda`, `687ca40b`, `588c1a6d` | Keyboard modes exit, **race condition fix** (await scheduleToolCalls), rationale rendering | Full |

**After PICK-B5:** Do the yolo.toml manual add (`allow_redirection = true` from `334b813d`).

**Skills branding (PICK-B3 through B5):** Every skills commit needs `.gemini` → `.llxprt`, `@google/gemini-cli-core` → `@vybestack/llxprt-code-core`, `gemini skills` → `llxprt skills`.

### Phase B: ToolScheduler REIMPLEMENT (12 phases)

Execute per `project-plans/gmerge-0.24.5/toolscheduler/plan/`. Extract-not-rewrite pattern.

| Batch | Phases | Description | Verify |
|-------|--------|-------------|--------|
| TS-B1 | 00a, 01, 01a | Preflight + extract types + verify | Quick |
| TS-B2 | 02, 02a | Add re-exports + verify | Full |
| TS-B3 | 03, 03a | Characterize tool execution + verify | Quick |
| TS-B4 | 04, 04a | Extract ToolExecutor + verify | Full |
| TS-B5 | 05, 05a | Extract response formatting + verify | Full |

### Phase C: MessageBus DI REIMPLEMENT (8 phases)

Execute per `project-plans/gmerge-0.24.5/messagebus/plan/`. 3-phase DI migration.

| Batch | Phases | Description | Verify |
|-------|--------|-------------|--------|
| MB-B1 | 00a, 01, 01a | Preflight + optional params (5 files) + verify | Quick |
| MB-B2 | 02, 02a | Standardize constructors (12 files) + verify | Full |
| MB-B3 | 03, 03a | Mandatory injection (31 files) + verify | Full |

### Phase D: SHA-Plan Playbook REIMPLEMENTs (25 playbooks in 7 groups)

Execute per individual `project-plans/gmerge-0.24.5/<sha>-plan.md` files. Grouped by dependency.

| Batch | Playbook(s) | Description | Verify |
|-------|-------------|-------------|--------|
| RE-B1 | `3b1dbcd4` | Environment sanitization (new service, foundational) | Quick |
| RE-B2 | `6f4b2ad0`, `881b026f` | Default folder trust + tsconfig circular dep fix | Full |
| RE-B3 | `dced409a`, `e6344a8c`, `15c9f88d` | Hooks infrastructure: folder trust, project warnings, agent dedup | Quick |
| RE-B4 | `90eb1e02`, `05049b5a`, `dd84c2fb` | Hooks core: tool input mod, STOP_EXECUTION, granular stop/block | Full |
| RE-B5 | `6d1e2763`, `61dbab03`, `56092bd7`, `9c48cd84` | Hooks UI: context injection, visual indicators, hooks.enabled, security warning | Quick |
| RE-B6 | `37be1624`, `dcd2449b`, `d3c206c6` | Policy: granular allowlisting, deprecate legacy, unify shell security | Full |
| RE-B7 | `563d81e0`, `ec79fe1a`, `ec11b8af`, `4c67eef0`, `7edd8030` | Extensions: install/uninstall, update notification, settings info, missing settings, settings fallback | Quick |
| RE-B8 | `9172e283`, `2fe45834` | Settings: item descriptions, remote admin settings | Full |
| RE-B9 | `006de1dd` | Security documentation (LLxprt rewrite) | Quick |
| RE-B10 | `10ae8484` | Console → coreEvents migration (biggest single item, 47 files) | Full |

**Hooks execution order:** See `project-plans/gmerge-0.24.5/HOOKS-EXECUTION-ORDER.md` for the required dependency chain within RE-B3 through RE-B5.

### Phase E: Final Verification + PR

| Batch | Description |
|-------|-------------|
| FINAL-VERIFY | Full verify: `npm run lint && npm run typecheck && npm run test && npm run format && npm run build && node scripts/start.js --profile-load synthetic --prompt "write me a haiku"` |
| FINAL-DOCS | Update PROGRESS.md, NOTES.md, AUDIT.md |
| FINAL-PR | Create PR against main, watch CI, review CodeRabbit |

---

## Verification Cadence

- **Quick verify:** `npm run lint && npm run typecheck`
- **Full verify:** `npm run lint && npm run typecheck && npm run test && npm run format && npm run build && node scripts/start.js --profile-load synthetic --prompt "write me a haiku"`
- If `npm run format` modifies files, commit formatting changes separately
- After every PICK batch: commit cherry-picks, then run verify
- After every REIMPLEMENT batch: commit implementation, then run verify

---

## Subagent Orchestration

### Cherry-Pick Batches (PICK-BN)

```
cherrypicker subagent:
  - git cherry-pick <sha1> <sha2> ... <sha5>
  - If conflicts: resolve per dev-docs/cherrypicking.md (preserve LLxprt branding/architecture)
  - For Skills commits: apply branding substitutions
  - Run quick/full verify per schedule
  - Commit

typescriptreviewer subagent:
  - Verify cherry-picks landed (git log, git diff)
  - Check no branding leakage
  - Check compilation passes
  - PASS/FAIL
```

### REIMPLEMENT Batches (TS-BN, MB-BN, RE-BN)

```
typescriptexpert subagent:
  - Read the phase file / playbook
  - Execute implementation tasks
  - Run verification commands from the phase file
  - Commit

typescriptreviewer subagent:
  - Verify implementation matches requirements
  - Check behavioral tests exist and pass
  - Check no regressions
  - PASS/FAIL
```

### Remediation Loop

```
If typescriptreviewer returns FAIL:
  → typescriptexpert remediates specific issues
  → typescriptreviewer re-reviews
  → Loop up to 5 times
  → If still failing after 5: todo_pause() with reason
```

---

## Todo List

When starting execution, create this EXACT todo list:

```javascript
todo_write({
  todos: [
    // Phase A: Cherry-Picks
    { id: "PICK-B1-exec", content: "PICK Batch 1: cherry-pick 0a216b28 b0d5c4c0 e9a601c1 b6b0727e 5f28614760 (EIO fix, dynamic policy, MCP type, schema non-fatal, MCP resources)", status: "pending" },
    { id: "PICK-B1-review", content: "PICK Batch 1 REVIEW: verify cherry-picks, branding, typecheck", status: "pending" },
    { id: "PICK-B2-exec", content: "PICK Batch 2: cherry-pick 873d10df 56b05042 acecd80a 21388a0a 0eb84f51 (terse images, typo, IDE, GitService, integration test)", status: "pending" },
    { id: "PICK-B2-review", content: "PICK Batch 2 REVIEW + FULL VERIFY: lint, typecheck, test, format, build", status: "pending" },
    { id: "PICK-B3-exec", content: "PICK Batch 3: cherry-pick de1233b8 958284dc 764b1959 e78c3fe4 f0a039f7 (Skills 1-5: core, activation, prompt, status bar, refactor) — BRANDING CHANGES NEEDED", status: "pending" },
    { id: "PICK-B3-review", content: "PICK Batch 3 REVIEW: verify skills branding (.gemini→.llxprt, @google→@vybestack)", status: "pending" },
    { id: "PICK-B4-exec", content: "PICK Batch 4: cherry-pick bdb349e7 d3563e2f 2cb33b2f 0c541362 (Skills 6-9: extensions, CLI, reload, workspace)", status: "pending" },
    { id: "PICK-B4-review", content: "PICK Batch 4 REVIEW + FULL VERIFY", status: "pending" },
    { id: "PICK-B5-exec", content: "PICK Batch 5: cherry-pick 5f027cb6 59a18e71 (Skills 10-11: UI fix, docs) + manual add allow_redirection=true to yolo.toml", status: "pending" },
    { id: "PICK-B5-review", content: "PICK Batch 5 REVIEW: verify skills docs branding + yolo.toml change", status: "pending" },
    { id: "PICK-B6-exec", content: "PICK Batch 6: cherry-pick 8a0190ca 18fef0db 0f3555a4 30f5c4af 615b218f (MCP, shell, /dir add, powershell, consent)", status: "pending" },
    { id: "PICK-B6-review", content: "PICK Batch 6 REVIEW + FULL VERIFY", status: "pending" },
    { id: "PICK-B7-exec", content: "PICK Batch 7: cherry-pick 3997c7ff dc6dda5c 2da911e4 8f0324d8 a61fb058 (terminal, SDK, /copy, paste, writeTodo)", status: "pending" },
    { id: "PICK-B7-review", content: "PICK Batch 7 REVIEW", status: "pending" },
    { id: "PICK-B8-exec", content: "PICK Batch 8: cherry-pick d2849fda 687ca40b 588c1a6d (keyboard modes, RACE CONDITION FIX, rationale rendering) — HIGH RISK", status: "pending" },
    { id: "PICK-B8-review", content: "PICK Batch 8 REVIEW + FULL VERIFY", status: "pending" },

    // Phase B: ToolScheduler
    { id: "TS-B1-exec", content: "ToolScheduler Batch 1: phases 00a, 01, 01a (preflight + extract types). Plan: toolscheduler/plan/", status: "pending" },
    { id: "TS-B1-review", content: "ToolScheduler Batch 1 REVIEW", status: "pending" },
    { id: "TS-B2-exec", content: "ToolScheduler Batch 2: phases 02, 02a (re-exports). Plan: toolscheduler/plan/", status: "pending" },
    { id: "TS-B2-review", content: "ToolScheduler Batch 2 REVIEW + FULL VERIFY", status: "pending" },
    { id: "TS-B3-exec", content: "ToolScheduler Batch 3: phases 03, 03a (characterize tool execution). Plan: toolscheduler/plan/", status: "pending" },
    { id: "TS-B3-review", content: "ToolScheduler Batch 3 REVIEW", status: "pending" },
    { id: "TS-B4-exec", content: "ToolScheduler Batch 4: phases 04, 04a (extract ToolExecutor). Plan: toolscheduler/plan/", status: "pending" },
    { id: "TS-B4-review", content: "ToolScheduler Batch 4 REVIEW + FULL VERIFY", status: "pending" },
    { id: "TS-B5-exec", content: "ToolScheduler Batch 5: phases 05, 05a (extract response formatting). Plan: toolscheduler/plan/", status: "pending" },
    { id: "TS-B5-review", content: "ToolScheduler Batch 5 REVIEW + FULL VERIFY", status: "pending" },

    // Phase C: MessageBus
    { id: "MB-B1-exec", content: "MessageBus Batch 1: phases 00a, 01, 01a (preflight + optional params). Plan: messagebus/plan/", status: "pending" },
    { id: "MB-B1-review", content: "MessageBus Batch 1 REVIEW", status: "pending" },
    { id: "MB-B2-exec", content: "MessageBus Batch 2: phases 02, 02a (standardize constructors, 12 files). Plan: messagebus/plan/", status: "pending" },
    { id: "MB-B2-review", content: "MessageBus Batch 2 REVIEW + FULL VERIFY", status: "pending" },
    { id: "MB-B3-exec", content: "MessageBus Batch 3: phases 03, 03a (mandatory injection, 31 files). Plan: messagebus/plan/", status: "pending" },
    { id: "MB-B3-review", content: "MessageBus Batch 3 REVIEW + FULL VERIFY", status: "pending" },

    // Phase D: SHA-Plan Playbooks
    { id: "RE-B1-exec", content: "REIMPLEMENT Batch 1: 3b1dbcd4 (env sanitization). Playbook: 3b1dbcd42d8f-plan.md", status: "pending" },
    { id: "RE-B1-review", content: "RE Batch 1 REVIEW", status: "pending" },
    { id: "RE-B2-exec", content: "REIMPLEMENT Batch 2: 6f4b2ad0 + 881b026f (folder trust default + tsconfig fix). Playbooks: 6f4b2ad0b95a-plan.md, 881b026f2454-plan.md", status: "pending" },
    { id: "RE-B2-review", content: "RE Batch 2 REVIEW + FULL VERIFY", status: "pending" },
    { id: "RE-B3-exec", content: "REIMPLEMENT Batch 3: dced409a + e6344a8c + 15c9f88d (hooks infra). Playbooks + HOOKS-EXECUTION-ORDER.md", status: "pending" },
    { id: "RE-B3-review", content: "RE Batch 3 REVIEW", status: "pending" },
    { id: "RE-B4-exec", content: "REIMPLEMENT Batch 4: 90eb1e02 + 05049b5a + dd84c2fb (hooks core). Playbooks + HOOKS-EXECUTION-ORDER.md", status: "pending" },
    { id: "RE-B4-review", content: "RE Batch 4 REVIEW + FULL VERIFY", status: "pending" },
    { id: "RE-B5-exec", content: "REIMPLEMENT Batch 5: 6d1e2763 + 61dbab03 + 56092bd7 + 9c48cd84 (hooks UI). Playbooks + HOOKS-EXECUTION-ORDER.md", status: "pending" },
    { id: "RE-B5-review", content: "RE Batch 5 REVIEW", status: "pending" },
    { id: "RE-B6-exec", content: "REIMPLEMENT Batch 6: 37be1624 + dcd2449b + d3c206c6 (policy). Playbooks", status: "pending" },
    { id: "RE-B6-review", content: "RE Batch 6 REVIEW + FULL VERIFY", status: "pending" },
    { id: "RE-B7-exec", content: "REIMPLEMENT Batch 7: 563d81e0 + ec79fe1a + ec11b8af + 4c67eef0 + 7edd8030 (extensions). Playbooks", status: "pending" },
    { id: "RE-B7-review", content: "RE Batch 7 REVIEW", status: "pending" },
    { id: "RE-B8-exec", content: "REIMPLEMENT Batch 8: 9172e283 + 2fe45834 (settings). Playbooks", status: "pending" },
    { id: "RE-B8-review", content: "RE Batch 8 REVIEW + FULL VERIFY", status: "pending" },
    { id: "RE-B9-exec", content: "REIMPLEMENT Batch 9: 006de1dd (security docs rewrite). Playbook: 006de1dd318d-plan.md", status: "pending" },
    { id: "RE-B9-review", content: "RE Batch 9 REVIEW", status: "pending" },
    { id: "RE-B10-exec", content: "REIMPLEMENT Batch 10: 10ae8484 (console→coreEvents migration, 47 files). Playbook: 10ae84869a39-plan.md", status: "pending" },
    { id: "RE-B10-review", content: "RE Batch 10 REVIEW + FULL VERIFY", status: "pending" },

    // Phase E: Final
    { id: "FINAL-verify", content: "FINAL: full verify suite (lint, typecheck, test, format, build, synthetic smoke)", status: "pending" },
    { id: "FINAL-docs", content: "FINAL: update PROGRESS.md, NOTES.md, AUDIT.md with all outcomes", status: "pending" },
    { id: "FINAL-pr", content: "FINAL: create PR against main, watch CI, review CodeRabbit, remediate", status: "pending" },
  ]
})
```

---

## Failure Recovery

### Cherry-pick conflict
```bash
git cherry-pick --abort   # Reset to pre-cherry-pick state
# Then cherry-pick individually to isolate the conflict
git cherry-pick <sha>
# Resolve conflicts per dev-docs/cherrypicking.md
git cherry-pick --continue
```

### REIMPLEMENT failure
1. Check which tests fail: `npm run test 2>&1 | grep FAIL`
2. Check typecheck errors: `npm run typecheck 2>&1 | grep error`
3. Send specific errors back to typescriptexpert for remediation
4. Re-verify with typescriptreviewer
5. After 5 remediation attempts: `todo_pause("Batch X failed after 5 remediation attempts")`

### Build failure after Phase B/C
ToolScheduler and MessageBus refactors touch heavily-used code. If build breaks:
```bash
npm run build --workspace @vybestack/llxprt-code-core  # Rebuild core first
npm run typecheck                                       # Then typecheck all
```

---

## Key File References

| File | Purpose |
|------|---------|
| `project-plans/gmerge-0.24.5/CHERRIES.md` | All 121 commit decisions with rationale |
| `project-plans/gmerge-0.24.5/SUMMARY.md` | Overview and counts |
| `project-plans/gmerge-0.24.5/HOOKS-EXECUTION-ORDER.md` | Dependency chain for 9 hooks playbooks |
| `project-plans/gmerge-0.24.5/toolscheduler/plan/` | 12-phase ToolScheduler extraction plan |
| `project-plans/gmerge-0.24.5/messagebus/plan/` | 8-phase MessageBus DI migration plan |
| `project-plans/gmerge-0.24.5/<sha>-plan.md` | 25 individual REIMPLEMENT playbooks |
| `dev-docs/cherrypicking.md` | Selection criteria and non-negotiables |
| `dev-docs/cherrypicking-runbook.md` | Process documentation |
| `dev-docs/COORDINATING.md` | Subagent coordination rules |

---

## Context Recovery

If you lose context mid-execution:

1. **Check git state:**
   ```bash
   git branch --show-current  # Should be gmerge/0.24.5
   git log --oneline -20      # See what's been done
   git status                 # Any uncommitted work?
   ```

2. **Read the todo list:** `todo_read()` — find first pending item

3. **Read this plan:** `project-plans/gmerge-0.24.5/PLAN.md`

4. **Read progress:** `project-plans/gmerge-0.24.5/PROGRESS.md`

5. **Summary:** This sync merges upstream gemini-cli v0.23.0→v0.24.5 (121 commits) into LLxprt. Branch `gmerge/0.24.5`. 34 cherry-picks, 30 reimplementations (ToolScheduler refactor, MessageBus DI, 25 individual playbooks), 45 skips, 12 no-ops.
