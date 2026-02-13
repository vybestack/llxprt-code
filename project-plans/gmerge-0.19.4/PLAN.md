# PLAN.md — gmerge-0.19.4 (upstream v0.18.4 → v0.19.4)

## START HERE (If you were told to "DO this plan")

If you're reading this because someone said "DO @project-plans/gmerge-0.19.4/PLAN.md", follow these steps:

### Step 1: Check current state

```bash
git branch --show-current  # Should be gmerge/0.19.4
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
- **Branding**: All `@google/gemini-cli-core` → `@vybestack/llxprt-code-core`, `gemini` → `llxprt` where appropriate

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
| `USE_GEMINI` (sole auth) | `USE_PROVIDER` (where applicable) |

## File Existence Pre-Check

All PICK commits target files that exist in our tree. Key files to verify before starting:

- `packages/core/src/tools/mcp-client.ts` [OK]
- `packages/cli/src/gemini.tsx` [OK]
- `packages/cli/src/ui/AppContainer.tsx` [OK]
- `packages/core/src/services/gitService.ts` [OK]
- `packages/cli/src/ui/components/shared/text-buffer.ts` [OK]
- `packages/core/src/utils/shell-utils.ts` [OK]
- `packages/cli/src/zed-integration/zedIntegration.ts` [OK]
- `packages/core/src/core/baseLlmClient.ts` [OK]
- `docs/extension.md` [OK] (target for REIMPLEMENT R1)
- `packages/cli/src/ui/commands/statsCommand.ts` [OK] (target for REIMPLEMENT R2)

---

## Batch Schedule

### Batch 1 (PICK) — Commits 1–5

Cherry-pick in order:

| # | SHA | Subject |
|---|-----|---------|
| 1 | `9937fb22` | Use lenient MCP output schema validator |
| 2 | `fec0eba0` | move stdio |
| 3 | `78b10dcc` | Skip pre-commit hooks for shadow repo |
| 4 | `5982abef` | fix(ui): Correct mouse click cursor positioning for wide characters |
| 5 | `613b8a45` | fix(core): correct bash @P prompt transformation detection |

**Command:**
```bash
git cherry-pick 9937fb22 fec0eba0 78b10dcc 5982abef 613b8a45
```

**Verification:** Quick verify (lint + typecheck)

**Commit message:** `cherry-pick: upstream v0.18.4..v0.19.4 batch 1`

**Cherrypicker prompt:**
```
Cherry-pick these 5 upstream commits onto the gmerge/0.19.4 branch:
9937fb22 fec0eba0 78b10dcc 5982abef 613b8a45

Run: git cherry-pick 9937fb22 fec0eba0 78b10dcc 5982abef 613b8a45

If conflicts occur:
- Replace @google/gemini-cli-core with @vybestack/llxprt-code-core
- Replace @google/gemini-cli with @vybestack/llxprt-code
- Preserve LLxprt's multi-provider architecture
- Resolve in favor of LLxprt's existing code structure

After cherry-pick completes (or after resolving conflicts and running git cherry-pick --continue):
- Run: npm run lint
- Run: npm run typecheck
- Fix any issues
- If package-lock.json conflicts: run npm install to regenerate

Do NOT commit separately — the cherry-pick creates its own commits.
```

**Reviewer prompt:**
```
Review Batch 1 of gmerge-0.19.4 cherry-picks.

MECHANICAL CHECKS:
1. Run: npm run lint && npm run typecheck
2. Verify no @google/gemini-cli-core or @google/gemini-cli imports remain in changed files
3. Verify no USE_GEMINI references were introduced

QUALITATIVE CHECKS — for EACH commit verify:

1. 9937fb22 (MCP lenient schema validator):
   - packages/core/src/tools/mcp-client.ts has the schema validation change
   - The lenient validator is actually used, not just imported

2. fec0eba0 (move stdio):
   - packages/core/src/utils/stdio.ts exists with the moved code
   - packages/core/src/index.ts exports the new module
   - packages/cli/src/gemini.tsx and AppContainer.tsx import from the new location

3. 78b10dcc (skip pre-commit hooks):
   - packages/core/src/services/gitService.ts has the pre-commit hook skip logic

4. 5982abef (wide char cursor):
   - packages/cli/src/ui/components/shared/text-buffer.ts has the fix

5. 613b8a45 (bash @P prompt):
   - packages/core/src/utils/shell-utils.ts has the detection fix

Output: Per-commit assessment with LANDED/NOT_LANDED and FUNCTIONAL/BROKEN flags.
```

---

### Batch 2 (PICK) — Commits 6–10 [FULL VERIFY]

| # | SHA | Subject |
|---|-----|---------|
| 6 | `0f0b463a` | docs: fix typos in source code and documentation |
| 7 | `3370644f` | Improved code coverage for cli/src/zed-integration |
| 8 | `030a5ace` | Fix multiple bugs with auth flow |
| 9 | `d351f077` | feat: custom loading phrase when interactive shell requires input |
| 10 | `0713c86d` | feat(docs): Ensure multiline JS objects are rendered properly |

**Command:**
```bash
git cherry-pick 0f0b463a 3370644f 030a5ace d351f077 0713c86d
```

**Verification:** Full verify (lint + typecheck + test + format + build + haiku)

**Commit message:** `cherry-pick: upstream v0.18.4..v0.19.4 batch 2`

**Note:** `030a5ace` (auth flow fixes) is high-risk — touches auth dialog, oauth2, mouse utils. If it conflicts heavily, abort and make it a solo batch.

**Cherrypicker prompt:**
```
Cherry-pick these 5 upstream commits onto the gmerge/0.19.4 branch:
0f0b463a 3370644f 030a5ace d351f077 0713c86d

Run: git cherry-pick 0f0b463a 3370644f 030a5ace d351f077 0713c86d

HIGH-RISK: 030a5ace touches auth flow. If it has severe conflicts:
- Abort: git cherry-pick --abort
- Cherry-pick the others first, then 030a5ace solo
- Preserve LLxprt's multi-provider auth (USE_PROVIDER, not USE_GEMINI)

Standard conflict resolution:
- Replace @google/gemini-cli-core with @vybestack/llxprt-code-core
- Preserve LLxprt branding and architecture

After cherry-pick:
- Run: npm run lint && npm run typecheck && npm run test && npm run format && npm run build
- Run: node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
- If npm run format modifies files, commit them separately: git add -A && git commit -m "fix: post-batch 2 formatting"
- Fix any issues
```

**Reviewer prompt:**
```
Review Batch 2 of gmerge-0.19.4 cherry-picks. This is a FULL VERIFY batch.

MECHANICAL CHECKS:
1. Run: npm run lint && npm run typecheck && npm run test && npm run format && npm run build
2. Run: node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
3. Verify no @google/gemini-cli-core or @google/gemini-cli imports remain in changed files
4. Verify no USE_GEMINI references were introduced

QUALITATIVE CHECKS — for EACH commit verify:

1. 0f0b463a (typo fixes): Spot-check a few files for the typo corrections landing

2. 3370644f (zed integration tests):
   - packages/cli/src/zed-integration/connection.test.ts exists and has real tests
   - packages/cli/src/zed-integration/fileSystemService.test.ts exists and has real tests
   - packages/cli/src/zed-integration/zedIntegration.test.ts is significantly expanded
   - Tests reference actual source file exports, not stubs

3. 030a5ace (auth flow fixes):
   - Auth restart support is actually connected
   - oauth2.ts changes preserve multi-provider compatibility
   - No hardcoded Google-only auth paths introduced

4. d351f077 (loading phrases):
   - useLoadingIndicator and usePhraseCycler have the new functionality
   - ShellToolMessage uses the new loading indicator

5. 0713c86d (multiline JS rendering):
   - scripts/utils/autogen.ts has the rendering fix
   - settings.schema.json reflects the change

Output: Per-commit assessment with LANDED/NOT_LANDED and FUNCTIONAL/BROKEN flags.
Full verify result: PASS/FAIL with details.
```

---

### Batch 3 (PICK) — Commits 11–15

| # | SHA | Subject |
|---|-----|---------|
| 11 | `1e715d1e` | Restore bracketed paste mode after external editor exit |
| 12 | `8c36b106` | feat(core): Add BaseLlmClient.generateContent |
| 13 | `5e218a56` | Turn off alternate buffer mode by default |
| 14 | `bdf80ea7` | fix(cli): Prevent stdout/stderr patching for extension commands |
| 15 | `b3fcddde` | Update ink version to 6.4.6 |

**Command:**
```bash
git cherry-pick 1e715d1e 8c36b106 5e218a56 bdf80ea7 b3fcddde
```

**Verification:** Quick verify (lint + typecheck)

**Note:** `bdf80ea7` is a large commit touching all extension commands. `b3fcddde` updates package-lock.json — may need `npm install` to resolve.

**Cherrypicker prompt:**
```
Cherry-pick these 5 upstream commits onto the gmerge/0.19.4 branch:
1e715d1e 8c36b106 5e218a56 bdf80ea7 b3fcddde

Run: git cherry-pick 1e715d1e 8c36b106 5e218a56 bdf80ea7 b3fcddde

NOTES:
- bdf80ea7 is large (touches all extension + MCP commands). Resolve branding conflicts.
- b3fcddde updates ink in package-lock.json. If conflicts in package-lock.json:
  Accept theirs for package.json version bumps, then run: npm install
  to regenerate package-lock.json cleanly.

Standard conflict resolution:
- Replace @google/gemini-cli-core with @vybestack/llxprt-code-core
- Replace @google/gemini-cli with @vybestack/llxprt-code
- Preserve LLxprt branding

After cherry-pick:
- Run: npm run lint && npm run typecheck
- Fix any issues
```

**Reviewer prompt:**
```
Review Batch 3 of gmerge-0.19.4 cherry-picks.

MECHANICAL CHECKS:
1. Run: npm run lint && npm run typecheck
2. Verify no @google/gemini-cli-core or @google/gemini-cli imports
3. Verify package.json ink version is 6.4.6

QUALITATIVE CHECKS:

1. 1e715d1e (bracketed paste):
   - packages/cli/src/ui/hooks/useBracketedPaste.ts has restore logic
   - packages/cli/src/ui/utils/bracketedPaste.ts exists with utility

2. 8c36b106 (BaseLlmClient.generateContent):
   - packages/core/src/core/baseLlmClient.ts has the new method
   - Test file has coverage for it

3. 5e218a56 (alternate buffer off):
   - Settings schema default is false
   - packages/cli/src/ui/hooks/useAlternateBuffer.ts reflects the default

4. bdf80ea7 (extension stdout/stderr):
   - Extension command files no longer patch process.stdout/stderr
   - All extension command tests pass

5. b3fcddde (ink update):
   - package.json shows ink 6.4.6
   - package-lock.json is consistent

Output: Per-commit assessment.
```

---

### Batch 4 (PICK) — Commits 16–19 [FULL VERIFY]

| # | SHA | Subject |
|---|-----|---------|
| 16 | `7350399a` | fix(core): Fix context window overflow warning for PDF files |
| 17 | `569c6f1d` | feat: rephrasing the extension logging messages |
| 18 | `d53a5c4f` | fix: minor improvements to configs and getPackageJson |
| 19 | `d14779b2` | feat(core): Land bool for alternate system prompt |

**Command:**
```bash
git cherry-pick 7350399a 569c6f1d d53a5c4f d14779b2
```

**Verification:** Full verify (lint + typecheck + test + format + build + haiku)

**Cherrypicker prompt:**
```
Cherry-pick these 4 upstream commits onto the gmerge/0.19.4 branch:
7350399a 569c6f1d d53a5c4f d14779b2

Run: git cherry-pick 7350399a 569c6f1d d53a5c4f d14779b2

Standard conflict resolution:
- Replace @google/gemini-cli-core with @vybestack/llxprt-code-core
- Preserve LLxprt branding

d53a5c4f touches eslint.config.js, cli/index.ts, core/utils/package.ts — verify these exist and resolve.

After cherry-pick:
- Run: npm run lint && npm run typecheck && npm run test && npm run format && npm run build
- Run: node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
- If npm run format modifies files, commit separately
- Fix any issues
```

**Reviewer prompt:**
```
Review Batch 4 of gmerge-0.19.4. FULL VERIFY batch.

MECHANICAL CHECKS:
1. Run: npm run lint && npm run typecheck && npm run test && npm run format && npm run build
2. Run: node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
3. Branding check

QUALITATIVE CHECKS:

1. 7350399a (PDF context overflow):
   - packages/core/src/core/client.ts has the PDF warning fix

2. 569c6f1d (extension explore messaging):
   - packages/cli/src/ui/commands/extensionsCommand.ts has updated messaging

3. d53a5c4f (config improvements):
   - eslint.config.js changes landed
   - packages/core/src/utils/package.ts changes landed

4. d14779b2 (alternate system prompt):
   - packages/core/src/core/prompts.ts has the boolean support
   - Test snapshot updated

Full verify result: PASS/FAIL.
```

---

### Batch 5 (PICK) — Commits 20–22

| # | SHA | Subject |
|---|-----|---------|
| 20 | `2b41263a` | fix: Add $schema property to settings.schema.json |
| 21 | `f2c52f77` | fix(cli): allow non-GitHub SCP-styled URLs for extension installation |
| 22 | `6f9118dc` | Fix TypeError: URL.parse is not a function for Node.js < v22 |

**Command:**
```bash
git cherry-pick 2b41263a f2c52f77 6f9118dc
```

**Verification:** Quick verify (lint + typecheck)

**Cherrypicker prompt:**
```
Cherry-pick these 3 upstream commits onto the gmerge/0.19.4 branch:
2b41263a f2c52f77 6f9118dc

Run: git cherry-pick 2b41263a f2c52f77 6f9118dc

Standard conflict resolution. These are low-risk commits.

After cherry-pick:
- Run: npm run lint && npm run typecheck
- Fix any issues
```

**Reviewer prompt:**
```
Review Batch 5 of gmerge-0.19.4.

MECHANICAL: npm run lint && npm run typecheck. Branding check.

QUALITATIVE:
1. 2b41263a: schemas/settings.schema.json has $schema property
2. f2c52f77: packages/cli/src/config/extensions/github.ts handles SCP URLs
3. 6f9118dc: packages/cli/src/config/extensions/github.ts has URL.parse fallback

Output: Per-commit assessment.
```

---

### Batch 6 (REIMPLEMENT) — R1: Extension Documentation [FULL VERIFY]

**Upstream SHA:** `19d4384f`
**Plan:** `project-plans/gmerge-0.19.4/19d4384f-plan.md`

**Solo batch.** Rewrite `docs/extension.md` to reach parity with upstream's extension management documentation, adapted for LLxprt.

**Cherrypicker prompt:**
```
REIMPLEMENT upstream commit 19d4384f — Extension documentation parity.

Read the plan at: project-plans/gmerge-0.19.4/19d4384f-plan.md

Summary:
1. Read current docs/extension.md
2. Read upstream docs for reference: git show 19d4384f:docs/extensions/index.md
3. Rewrite docs/extension.md to add comprehensive Extension Management CLI section covering:
   install, uninstall (multiple names), disable, enable, update, new, link, list, validate
4. Apply LLxprt branding: llxprt (not gemini), llxprt-extension.json, LLXPRT.md, .llxprt/extensions
5. Keep existing sections (How it works, Extension Commands, Conflict Resolution, Custom Transports, Variables)
6. Run: npm run format
7. Commit: git add -A && git commit -m "reimplement: extension documentation parity (upstream 19d4384f)"

After writing:
- Run: npm run format
- Run: npm run lint && npm run typecheck && npm run test && npm run build
- Run: node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

**Reviewer prompt:**
```
Review REIMPLEMENT R1 — Extension documentation parity. FULL VERIFY batch.

MECHANICAL:
1. npm run lint && npm run typecheck && npm run test && npm run format && npm run build
2. node scripts/start.js --profile-load synthetic --prompt "write me a haiku"

QUALITATIVE:
1. docs/extension.md exists and is comprehensive
2. Has Extension Management section with ALL commands: install, uninstall, disable, enable, update, new, link, list, validate
3. Uninstall shows multiple extension support (llxprt extensions uninstall ext1 ext2)
4. No upstream branding (no gemini, no @google, no GEMINI.md, no .gemini/)
5. All existing content preserved (How it works, Commands, Conflict Resolution, Custom Transports, Variables)
6. Commands use llxprt (not gemini)
7. File is well-formatted markdown

Full verify result: PASS/FAIL.
```

---

### Batch 7 (REIMPLEMENT) — R2: /stats session Subcommand

**Upstream SHA:** `c21b6899`
**Plan:** `project-plans/gmerge-0.19.4/c21b6899-plan.md`

**Solo batch.** Add `/stats session` subcommand to our statsCommand.ts.

**Cherrypicker prompt:**
```
REIMPLEMENT upstream commit c21b6899 — /stats session subcommand.

Read the plan at: project-plans/gmerge-0.19.4/c21b6899-plan.md

Summary:
1. Open packages/cli/src/ui/commands/statsCommand.ts
2. Extract the default action into a defaultSessionView(context: CommandContext) function
3. Add 'session' as the FIRST subcommand in the subCommands array
4. Update the main action to call defaultSessionView(context)
5. Update description to: 'check session stats. Usage: /stats [session|model|tools|cache|buckets|quota|lb]'
6. Update packages/cli/src/ui/hooks/useSlashCompletion.test.ts — find all stats description strings and update them
7. Run: npm run lint && npm run typecheck
8. Commit: git add -A && git commit -m "reimplement: /stats session subcommand (upstream c21b6899)"
```

**Reviewer prompt:**
```
Review REIMPLEMENT R2 — /stats session subcommand.

MECHANICAL: npm run lint && npm run typecheck

QUALITATIVE:
1. packages/cli/src/ui/commands/statsCommand.ts has:
   - defaultSessionView() function extracted
   - 'session' subcommand as FIRST in subCommands array
   - Main action calls defaultSessionView()
   - Description includes 'session'
2. Existing subcommands (model, tools, cache, quota, buckets, lb) are unchanged
3. useSlashCompletion.test.ts description strings updated
4. No other files modified

Output: PASS/FAIL.
```

---

### Batch 8 — Final Documentation Updates [FULL VERIFY]

Update tracking documents and run final full verification.

**Steps:**
1. Update `project-plans/gmerge-0.19.4/PROGRESS.md` with all commit hashes
2. Update `project-plans/gmerge-0.19.4/NOTES.md` with any conflicts/deviations
3. Update `project-plans/gmerge-0.19.4/AUDIT.md` with all outcomes
4. Run full verify: lint, typecheck, test, format, build, haiku
5. Commit docs: `git add -A && git commit -m "docs: gmerge-0.19.4 tracking documentation"`

---

## Failure Recovery

### Cherry-pick conflicts

```bash
# See what conflicted
git status
git diff

# Fix conflicts, then continue
git add -A
git cherry-pick --continue

# Or abort and retry
git cherry-pick --abort
```

### Review-remediate loop

If review fails:
1. Cherrypicker fixes the issues
2. Reviewer reviews again
3. Loop up to 5 times
4. If still failing after 5, call `todo_pause()` with details

### Follow-up fix commits

If a batch requires fixes after cherry-pick:
```bash
git add -A
git commit -m "fix: post-batch N verification"
```

---

## Subagent Orchestration

Pattern for each batch:

```
Execute (cherrypicker) -> Review (reviewer) -> PASS? continue : Remediate (cherrypicker) -> Review again
Loop remediation up to 5 times, then escalate to human.
```

---

## Todo List Management

The executing agent MUST create this todo list before starting:

```
todo_write({
  todos: [
    { id: "B1-exec", content: "Batch 1 EXECUTE: cherry-pick 9937fb22 fec0eba0 78b10dcc 5982abef 613b8a45 (MCP, stdio, git, cursor, bash)", status: "pending" },
    { id: "B1-review", content: "Batch 1 REVIEW: verify 5 commits landed, lint, typecheck, qualitative check", status: "pending" },
    { id: "B2-exec", content: "Batch 2 EXECUTE: cherry-pick 0f0b463a 3370644f 030a5ace d351f077 0713c86d (typos, zed tests, auth, loading, docs)", status: "pending" },
    { id: "B2-review", content: "Batch 2 REVIEW [FULL]: verify 5 commits, lint, typecheck, test, format, build, haiku", status: "pending" },
    { id: "B3-exec", content: "Batch 3 EXECUTE: cherry-pick 1e715d1e 8c36b106 5e218a56 bdf80ea7 b3fcddde (paste, baseLlm, altbuf, extensions, ink)", status: "pending" },
    { id: "B3-review", content: "Batch 3 REVIEW: verify 5 commits, lint, typecheck", status: "pending" },
    { id: "B4-exec", content: "Batch 4 EXECUTE: cherry-pick 7350399a 569c6f1d d53a5c4f d14779b2 (PDF, extensions, config, sysprompt)", status: "pending" },
    { id: "B4-review", content: "Batch 4 REVIEW [FULL]: verify 4 commits, lint, typecheck, test, format, build, haiku", status: "pending" },
    { id: "B5-exec", content: "Batch 5 EXECUTE: cherry-pick 2b41263a f2c52f77 6f9118dc (schema, SCP URLs, URL.parse)", status: "pending" },
    { id: "B5-review", content: "Batch 5 REVIEW: verify 3 commits, lint, typecheck", status: "pending" },
    { id: "B6-exec", content: "Batch 6 REIMPLEMENT: Extension documentation parity (19d4384f-plan.md)", status: "pending" },
    { id: "B6-review", content: "Batch 6 REVIEW [FULL]: verify extension docs, lint, typecheck, test, format, build, haiku", status: "pending" },
    { id: "B7-exec", content: "Batch 7 REIMPLEMENT: /stats session subcommand (c21b6899-plan.md)", status: "pending" },
    { id: "B7-review", content: "Batch 7 REVIEW: verify stats change, lint, typecheck", status: "pending" },
    { id: "FINAL-verify", content: "FINAL: Full verify — lint, typecheck, test, format, build, haiku", status: "pending" },
    { id: "FINAL-progress", content: "UPDATE PROGRESS.md with commit hashes", status: "pending" },
    { id: "FINAL-notes", content: "UPDATE NOTES.md with conflicts/deviations", status: "pending" },
    { id: "FINAL-audit", content: "UPDATE AUDIT.md with all outcomes", status: "pending" },
    { id: "FINAL-commit", content: "COMMIT tracking docs: git add -A && git commit -m 'docs: gmerge-0.19.4 tracking documentation'", status: "pending" }
  ]
})
```

## Coordinator Execution Rules

1. **Create todo list FIRST** using the exact `todo_write` call above
2. **Execute sequentially** — do not skip steps, do not reorder
3. **Mark status as you go** — `in_progress` when starting, `completed` when done
4. **Review is MANDATORY** — never skip the review step
5. **Commit after review passes** — cherry-picks auto-commit; reimplements need explicit commit
6. **Remediate on failure** — loop up to 5 times, then escalate
7. **DO NOT pause for progress reports** — continue until todo list empty or blocked
8. **DO NOT ask what to do next** — the todo list tells you
9. **Context wipe recovery** — read PLAN.md and todo list to resume
10. **Use subagents via task() tool** — do not do cherry-picks or reviews yourself

---

## Context Recovery

If you've lost context:

1. **Check git state:** `git branch --show-current` (should be `gmerge/0.19.4`), `git status`, `git log --oneline -20`
2. **Read todo list:** `todo_read()`
3. **Resume from first pending item** in the todo list
4. **Key files for context:**
   - `project-plans/gmerge-0.19.4/PLAN.md` (this file)
   - `project-plans/gmerge-0.19.4/CHERRIES.md` (decisions)
   - `project-plans/gmerge-0.19.4/PROGRESS.md` (batch completion)
   - `project-plans/gmerge-0.19.4/NOTES.md` (conflicts/deviations)
5. **What this sync is doing:** Branch `gmerge/0.19.4`, syncing upstream v0.18.4→v0.19.4, 22 PICKs in 5 batches + 2 REIMPLEMENTs + final docs
