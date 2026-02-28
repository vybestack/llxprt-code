# Execution Plan: gmerge/0.23.0 (v0.22.0 -> v0.23.0)

> **Coordination protocol:** Follow `dev-docs/COORDINATING.md` strictly.
> Each batch = one phase. ONE PHASE = ONE SUBAGENT. VERIFY BEFORE PROCEEDING. NO COMBINING.

---

## Verification Commands

Use these standardized verification command sets throughout all batches:

- **Quick** = `npm run lint && npm run typecheck`
- **Full** = `npm run test && npm run lint && npm run typecheck && npm run format --check && npm run build`
- **Final** = Full + `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

Reference these by name (e.g., "run Quick verification") in batch prompts for consistency.

---

## Test-Driven Development (TDD) Requirement

All REIMPLEMENT batches MUST follow RED-GREEN-REFACTOR TDD:
1. **RED**: Write/update behavioral tests FIRST. Run them to confirm they FAIL.
2. **GREEN**: Implement minimal code to make tests PASS.
3. **REFACTOR**: Only then refactor if valuable.

All batches (PICK and REIMPLEMENT) MUST achieve **100% behavior coverage for changed behaviors**. Every behavioral change must be covered by tests. **Exception:** docs-only batches (no production code changes) require deterministic validation (e.g., grep for old patterns) instead of unit tests.

---

## START HERE (If you were told to "DO this plan")

### Step 1: Check current state
```bash
git branch --show-current   # Should be gmerge/0.23.0
git status                  # Should be clean (no uncommitted changes)
git log --oneline -5        # See what's already been applied
```
If not on `gmerge/0.23.0`, run `git checkout gmerge/0.23.0`.
If there are uncommitted changes, stash or commit them before proceeding.

### Step 2: Check or create the todo list
Call `todo_read()` first. If empty or doesn't exist, call `todo_write()` with the EXACT todo list from the "Todo List" section below.

### Step 3: Find where to resume
- Look at the todo list for the first `pending` item
- If an item is `in_progress`, restart that item from scratch
- If all items are `completed`, you're done -- skip to the "PR Creation" section

### Step 4: Execute sequentially using subagents

Follow `dev-docs/COORDINATING.md`. For each batch:

1. **Phase-skip guard:** Verify this is the NEXT batch in sequence. If current batch index != last completed batch + 1, STOP with `todo_pause("Phase skip detected: expected batch {N}, last completed was {M}")`.
2. **Mark todo `in_progress`**
3. **BN-exec:** Launch `task` with `subagent_name: "cherrypicker"` using the EXACT prompt from the batch section below
4. **Wait for completion**
5. **BN-review:** Launch `task` with `subagent_name: "deepthinker"` using the EXACT prompt from the batch section below
6. **Read deepthinker output.** If PASS -> proceed to commit. If FAIL -> remediate (see Failure Recovery).
7. **BN-commit:** YOU (the coordinator) run the commit commands from the batch section.
   - For PICK batches: cherry-pick already creates commits. Only run `git add -A && git commit` if you made post-cherry-pick fixes.
   - For REIMPLEMENT batches: always run `git add -A && git commit -m "<message from batch section>"`.
   - If no changes are unstaged (cherry-pick was clean), mark BN-commit completed without creating an extra commit.
8. **Mark todo `completed`**
9. **Proceed to next batch** -- do NOT skip, do NOT combine

### Step 5: If blocked
- Call `todo_pause()` with the specific reason
- Do NOT attempt to work around the issue

---

## Non-Negotiables

Per `dev-docs/cherrypicking.md`:
1. **Multi-provider architecture preserved** -- `USE_PROVIDER` not `USE_GEMINI`
2. **Import paths** -- `@vybestack/llxprt-code-core` not `@google/gemini-cli-core`
3. **Branding** -- LLxprt, not Gemini CLI (applies to imports, user-facing names, env vars, config paths -- NOT copyright headers)
4. **Copyright headers preserved** -- `Copyright Google LLC` headers stay on Google-sourced files; `Copyright Vybestack LLC` on Vybestack-created files
5. **No ClearcutLogger** -- zero Google telemetry
5. **No NextSpeakerChecker, FlashFallback, SmartEdit** -- removed features stay removed
6. **Parallel batching** -- LLxprt's coreToolScheduler processes in parallel, not serial
7. **JSONL session recording** -- `SessionRecordingService`, not upstream recording

## Branding Substitutions

| Upstream | LLxprt |
|----------|--------|
| `@google/gemini-cli-core` | `@vybestack/llxprt-code-core` |
| `@google/gemini-cli` | `@vybestack/llxprt-code` |
| `GEMINI_CLI_IDE_AUTH_TOKEN` | `LLXPRT_CODE_IDE_AUTH_TOKEN` |
| `AuthType.USE_GEMINI` | `AuthType.USE_PROVIDER` |
| `GEMINI.md` | `LLXPRT.md` |
| `.gemini/` | `.llxprt/` |
| `gemini-cli` | `llxprt-code` |
| `.geminiignore` | `.llxprtignore` |
| `GEMINI_PROJECT_DIR` | `LLXPRT_PROJECT_DIR` |

**DO NOT CHANGE copyright/license headers.** Files originating from Google retain their `Copyright 20xx Google LLC` and `SPDX-License-Identifier: Apache-2.0` headers. Files created by Vybestack use `Copyright 20xx Vybestack LLC`. Branding substitutions apply ONLY to import paths, user-facing names, env vars, config paths, and auth types -- never to copyright/license blocks.

## Subagent Config

**Cherrypicker** (executes changes):
- `subagent_name: "cherrypicker"`
- `tool_whitelist: ["read_file", "run_shell_command", "search_file_content", "glob", "list_directory", "read_many_files", "read_line_range", "write_file", "replace", "insert_at_line", "delete_line_range", "apply_patch"]`
- **For REIMPLEMENT batches:** MANDATORY TDD -- Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.
- **For ALL batches:** MANDATORY 100% behavior coverage for changed behaviors.

**Deepthinker** (reviews changes -- holistic: mechanical + behavioral):
- `subagent_name: "deepthinker"`
- `tool_whitelist: ["read_file", "run_shell_command", "search_file_content", "glob", "list_directory", "read_many_files", "read_line_range"]`
- **MANDATORY for ALL batches:** Verify 100% behavior coverage for changed behaviors. All behavioral changes must be covered by tests.

---

## Batch Schedule

---

### Batch 1 -- REIMPLEMENT: `cc52839f` hooks docs tool names

**Upstream SHA:** `cc52839f19`
**Subject:** Update docs/hooks/ to use snake_case tool names (write_file, replace, search_file_content, etc.)
**Verification:** Quick (lint + typecheck) | **Risk:** LOW

#### B1 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 1 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK: Reimplement upstream commit cc52839f19.
Update docs/hooks/ to use snake_case tool names (write_file, replace, search_file_content, etc.)

NOTE: This is a docs-only change — no production code is modified. No unit tests required per RULES.md. Use deterministic grep validation instead.

REFERENCE: Read the upstream diff first:
git show cc52839f19

Then read LLxprt's current versions of affected files in docs/hooks/.
Apply the equivalent changes, adapting for LLxprt branding and architecture.

VALIDATION: After changes, run:
grep -rn '"ReadFile"\|"WriteFile"\|"Edit"\|"RunShellCommand"\|"SearchText"\|"ListDirectory"' docs/hooks/
Expected: zero matches (exit code 1). If any matches remain, the change is incomplete.

After changes, run Quick verification (see Verification Commands).

DELIVERABLES: Hook docs updated with snake_case tool names. Grep validation confirms zero old-pattern matches. Quick verification passes.

DO NOT:
- Skip ahead to Batch 2
- Make changes beyond this batch's scope
```

#### B1 Deepthinker Review Prompt
```
CONTEXT: Review Batch 1 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: updating hook docs to use snake_case tool names
3. Docs-only batch: verify grep validation (zero old PascalCase tool names remain in docs/hooks/)
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Quick verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B1 Commit
```bash
git add -A
git commit -m "docs: update hook docs to use snake_case tool names (reimplements cc52839f)"
```

---

### Batch 2 -- PICK x5 (clean UI/quality)

**Upstream commits:** `db643e9166`, `26c115a4fb`, `3e9a0a7628`, `7f2d33458a`, `da85aed5aa`
**Subject:** Theme foreground removal, tips removal, footer debug removal, eslint no-return-await, settings padding fix
**Verification:** Quick (lint + typecheck)

#### B2 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 2 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK:
Cherry-pick these 5 commits:

git cherry-pick db643e9166 26c115a4fb 3e9a0a7628 7f2d33458a da85aed5aa

After cherry-pick, run Quick verification (see Verification Commands).

If cherry-pick fails with conflicts:
1. Run: git cherry-pick --abort
2. Cherry-pick one at a time to isolate the problem
3. Resolve conflicts preserving LLxprt branding (see PLAN.md Branding Substitutions)
4. Run: git cherry-pick --continue

DELIVERABLES: All 5 commits applied. 100% behavior coverage for changed behaviors. Quick verification passes.

DO NOT:
- Modify any files beyond what the cherry-pick changes
- Skip ahead to Batch 3
- Combine with other batches
```

#### B2 Deepthinker Review Prompt
```
CONTEXT: Review Batch 2 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~5 (or appropriate range for 5 commits)
2. Verify changes match upstream intent for: theme foreground removal, tips removal, footer debug removal, eslint no-return-await, settings padding fix
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Quick verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B2 Commit
Cherry-pick creates commits. If fixes were needed:
```bash
git add -A
git commit -m "fix: resolve conflicts from batch 2 cherry-picks"
```

---

### Batch 3 -- REIMPLEMENT: `bb8f181ef1` ripGrep debugLogger

**Upstream SHA:** `bb8f181ef1`
**Subject:** Replace console.error with debugLogger in packages/core/src/tools/ripGrep.ts
**Verification:** Quick (lint + typecheck) | **Risk:** LOW

#### B3 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 3 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK: Reimplement upstream commit bb8f181ef1.
Replace console.error with debugLogger in packages/core/src/tools/ripGrep.ts

MANDATORY TDD: Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.

REFERENCE: Read the upstream diff first:
git show bb8f181ef1

Then read LLxprt's current version of packages/core/src/tools/ripGrep.ts.
Apply the equivalent changes, adapting for LLxprt branding and architecture.

After changes, run Quick verification (see Verification Commands).

DELIVERABLES: console.error replaced with debugLogger in ripGrep.ts. 100% behavior coverage for changed behaviors. Quick verification passes.

DO NOT:
- Skip ahead to Batch 4
- Make changes beyond this batch's scope
```

#### B3 Deepthinker Review Prompt
```
CONTEXT: Review Batch 3 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: replacing console.error with debugLogger in ripGrep.ts
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Quick verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B3 Commit
```bash
git add -A
git commit -m "refactor: migrate console.error to debugLogger in ripGrep (reimplements bb8f181e)"
```

---

### Batch 4 -- PICK x2

**Upstream commits:** `948401a450`, `3d486ec1bf`
**Subject:** a2a-js SDK update, Windows clipboard paste
**Verification:** Quick (lint + typecheck)

#### B4 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 4 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK:
Cherry-pick these 2 commits:

git cherry-pick 948401a450 3d486ec1bf

After cherry-pick, run Quick verification (see Verification Commands).

If cherry-pick fails with conflicts:
1. Run: git cherry-pick --abort
2. Cherry-pick one at a time to isolate the problem
3. Resolve conflicts preserving LLxprt branding (see PLAN.md Branding Substitutions)
4. Run: git cherry-pick --continue

DELIVERABLES: Both commits applied. Quick verification passes.

DO NOT:
- Modify any files beyond what the cherry-pick changes
- Skip ahead to Batch 5
- Combine with other batches
```

#### B4 Deepthinker Review Prompt
```
CONTEXT: Review Batch 4 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~2 (or appropriate range for 2 commits)
2. Verify changes match upstream intent for: a2a-js SDK update, Windows clipboard paste
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Quick verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B4 Commit
Cherry-pick creates commits. If fixes were needed:
```bash
git add -A
git commit -m "fix: resolve conflicts from batch 4 cherry-picks"
```

---

### Batch 5 -- REIMPLEMENT: `6ddd5abd7b` slash completion eager fix

**Plan:** `project-plans/gmerge-0.23.0/6ddd5abd-plan.md`
**Upstream SHA:** `6ddd5abd7b`
**Subject:** Fix slash completion to not hide sibling commands on eager match
**Verification:** Quick (lint + typecheck) | **Risk:** LOW

#### B5 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 5 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK: Reimplement upstream commit 6ddd5abd7b.
Fix slash completion to not hide sibling commands on eager match.

MANDATORY TDD: Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.

REFERENCE: Read the upstream diff first:
git show 6ddd5abd7b

Then read the playbook:
cat project-plans/gmerge-0.23.0/6ddd5abd-plan.md

Then read LLxprt's current versions of affected files.
Apply the equivalent changes, adapting for LLxprt branding and architecture.

After changes, run Quick verification (see Verification Commands).

DELIVERABLES: Slash completion fix implemented. 100% behavior coverage for changed behaviors. Quick verification passes.

DO NOT:
- Skip ahead to Batch 6
- Make changes beyond this batch's scope
```

#### B5 Deepthinker Review Prompt
```
CONTEXT: Review Batch 5 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: fixing slash completion eager match hiding siblings
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Quick verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B5 Commit
```bash
git add -A
git commit -m "fix(ui): prevent eager slash completion hiding siblings (reimplements 6ddd5abd)"
```

---

### Batch 6 -- REIMPLEMENT: `739c02bd6d` history length constant

**Plan:** `project-plans/gmerge-0.23.0/739c02bd-plan.md`
**Upstream SHA:** `739c02bd6d`
**Subject:** Replace magic number 2 with INITIAL_HISTORY_LENGTH in chatCommand
**Verification:** Quick (lint + typecheck) | **Risk:** LOW

#### B6 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 6 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK: Reimplement upstream commit 739c02bd6d.
Replace magic number 2 with INITIAL_HISTORY_LENGTH in chatCommand.

MANDATORY TDD: Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.

REFERENCE: Read the upstream diff first:
git show 739c02bd6d

Then read the playbook:
cat project-plans/gmerge-0.23.0/739c02bd-plan.md

Then read LLxprt's current versions of affected files.
Apply the equivalent changes, adapting for LLxprt branding and architecture.

After changes, run Quick verification (see Verification Commands).

DELIVERABLES: Magic number replaced with named constant. 100% behavior coverage for changed behaviors. Quick verification passes.

DO NOT:
- Skip ahead to Batch 7
- Make changes beyond this batch's scope
```

#### B6 Deepthinker Review Prompt
```
CONTEXT: Review Batch 6 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: replacing magic history length with named constant
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Quick verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B6 Commit
```bash
git add -A
git commit -m "fix(cli): replace magic history length with named constant (reimplements 739c02bd)"
```

---

### Batch 7 -- PICK x1: `bc168bbae4` Table component

**Upstream commit:** `bc168bbae4`
**Subject:** New shared Table component, model stats layout fix
**Verification:** Quick (lint + typecheck)

#### B7 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 7 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK:
Cherry-pick this 1 commit:

git cherry-pick bc168bbae4

After cherry-pick, run Quick verification (see Verification Commands).

If cherry-pick fails with conflicts:
1. Run: git cherry-pick --abort
2. Resolve conflicts preserving LLxprt branding (see PLAN.md Branding Substitutions)
3. Run: git cherry-pick --continue

DELIVERABLES: Commit applied. Quick verification passes.

DO NOT:
- Modify any files beyond what the cherry-pick changes
- Skip ahead to Batch 8
- Combine with other batches
```

#### B7 Deepthinker Review Prompt
```
CONTEXT: Review Batch 7 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: new shared Table component, model stats layout fix
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Quick verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B7 Commit
Cherry-pick creates the commit. If fixes were needed:
```bash
git add -A
git commit -m "fix: resolve conflicts from batch 7 cherry-pick (Table component)"
```

---

### Batch 8 -- REIMPLEMENT: `54466a3ea8` hooks friendly names

**Plan:** `project-plans/gmerge-0.23.0/54466a3e-plan.md`
**Upstream SHA:** `54466a3ea8`
**Subject:** Add name/description to hook config; update registry, planner, UI
**Verification:** Full (test + lint + typecheck + build) | **Risk:** MED

#### B8 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 8 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK: Reimplement upstream commit 54466a3ea8.
Add name and description fields to hook config. Update hook registry, planner, and UI to use them.

MANDATORY TDD: Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.

REFERENCE: Read the upstream diff first:
git show 54466a3ea8

Then read the playbook:
cat project-plans/gmerge-0.23.0/54466a3e-plan.md

Then read LLxprt's current versions of affected files.
Apply the equivalent changes, adapting for LLxprt branding and architecture.

After changes, run Full verification (see Verification Commands).

DELIVERABLES: Hook name/description support implemented. 100% behavior coverage for changed behaviors. Full verification passes.

DO NOT:
- Skip ahead to Batch 9
- Make changes beyond this batch's scope
```

#### B8 Deepthinker Review Prompt
```
CONTEXT: Review Batch 8 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: adding name and description to hook config
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Full verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B8 Commit
```bash
git add -A
git commit -m "feat(hooks): add name and description to hook config (reimplements 54466a3e)"
```

---

### Batch 9 -- REIMPLEMENT: `322232e514` background color detection

**Plan:** `project-plans/gmerge-0.23.0/322232e5-plan.md`
**Upstream SHA:** `322232e514`
**Subject:** SELECTIVE: add detectTerminalBackgroundColor + getThemeTypeFromBackgroundColor only, wire into theme init. Do NOT do the full 28-file refactor.
**Verification:** Full (test + lint + typecheck + build) | **Risk:** MED

#### B9 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 9 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK: Reimplement upstream commit 322232e514.
SELECTIVE implementation: add detectTerminalBackgroundColor + getThemeTypeFromBackgroundColor only, wire into theme init.
Do NOT do the full 28-file refactor from upstream.

MANDATORY TDD: Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.

REFERENCE: Read the upstream diff first:
git show 322232e514

Then read the playbook:
cat project-plans/gmerge-0.23.0/322232e5-plan.md

Then read LLxprt's current versions of affected files.
Apply the equivalent changes, adapting for LLxprt branding and architecture.

After changes, run verification:
Full verification (see Verification Commands)

DELIVERABLES: Terminal background color detection implemented and wired into theme. 100% behavior coverage for changed behaviors. Full verification passes.

DO NOT:
- Perform the full 28-file refactor from upstream
- Skip ahead to Batch 10
- Make changes beyond this batch's scope
```

#### B9 Deepthinker Review Prompt
```
CONTEXT: Review Batch 9 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: auto-detecting terminal background color for theme selection
3. Verify SELECTIVE scope: only detectTerminalBackgroundColor + getThemeTypeFromBackgroundColor + theme init wiring. NOT the full 28-file refactor.
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Full verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B9 Commit
```bash
git add -A
git commit -m "feat(ui): auto-detect terminal background color for theme (reimplements 322232e5)"
```

---

### Batch 10 -- REIMPLEMENT: `2515b89e2b` shell env vars

**Plan:** `project-plans/gmerge-0.23.0/2515b89e-plan.md`
**Upstream SHA:** `2515b89e2b`
**Subject:** Add CI env vars to shell sanitization whitelist
**Verification:** Quick (lint + typecheck) | **Risk:** LOW

#### B10 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 10 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK: Reimplement upstream commit 2515b89e2b.
Add CI environment variables to shell sanitization whitelist.

MANDATORY TDD: Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.

REFERENCE: Read the upstream diff first:
git show 2515b89e2b

Then read the playbook:
cat project-plans/gmerge-0.23.0/2515b89e-plan.md

Then read LLxprt's current versions of affected files.
Apply the equivalent changes, adapting for LLxprt branding and architecture.

After changes, run Quick verification (see Verification Commands).

DELIVERABLES: CI env vars added to shell allowlist. 100% behavior coverage for changed behaviors. Quick verification passes.

DO NOT:
- Skip ahead to Batch 11
- Make changes beyond this batch's scope
```

#### B10 Deepthinker Review Prompt
```
CONTEXT: Review Batch 10 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: adding CI environment variables to shell allowlist
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Quick verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B10 Commit
```bash
git add -A
git commit -m "feat: add CI environment variables to shell allowlist (reimplements 2515b89e)"
```

---

### Batch 11 -- PICK x2

**Upstream commits:** `0c4fb6afd2`, `1e10492e55`
**Subject:** Remove unnecessary deps, fix prompt infinite loop
**Verification:** Quick (lint + typecheck)

#### B11 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 11 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK:
Cherry-pick these 2 commits:

git cherry-pick 0c4fb6afd2 1e10492e55

After cherry-pick, run Quick verification (see Verification Commands).

If cherry-pick fails with conflicts:
1. Run: git cherry-pick --abort
2. Cherry-pick one at a time to isolate the problem
3. Resolve conflicts preserving LLxprt branding (see PLAN.md Branding Substitutions)
4. Run: git cherry-pick --continue

DELIVERABLES: Both commits applied. 100% behavior coverage for changed behaviors. Quick verification passes.

DO NOT:
- Modify any files beyond what the cherry-pick changes
- Skip ahead to Batch 12
- Combine with other batches
```

#### B11 Deepthinker Review Prompt
```
CONTEXT: Review Batch 11 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~2 (or appropriate range for 2 commits)
2. Verify changes match upstream intent for: removing unnecessary deps, fixing prompt infinite loop
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Quick verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B11 Commit
Cherry-pick creates commits. If fixes were needed:
```bash
git add -A
git commit -m "fix: resolve conflicts from batch 11 cherry-picks"
```

---

### Batch 12 -- REIMPLEMENT: `70696e364b` command suggestions on perfect match

**Plan:** `project-plans/gmerge-0.23.0/70696e36-plan.md`
**Upstream SHA:** `70696e364b`
**Subject:** Show suggestions on perfect match + sort
**Verification:** Quick (lint + typecheck) | **Risk:** LOW

#### B12 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 12 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK: Reimplement upstream commit 70696e364b.
Show slash command suggestions on perfect match and sort them.

MANDATORY TDD: Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.

REFERENCE: Read the upstream diff first:
git show 70696e364b

Then read the playbook:
cat project-plans/gmerge-0.23.0/70696e36-plan.md

Then read LLxprt's current versions of affected files.
Apply the equivalent changes, adapting for LLxprt branding and architecture.

After changes, run Quick verification (see Verification Commands).

DELIVERABLES: Slash suggestions show on perfect match and are sorted. 100% behavior coverage for changed behaviors. Quick verification passes.

DO NOT:
- Skip ahead to Batch 13
- Make changes beyond this batch's scope
```

#### B12 Deepthinker Review Prompt
```
CONTEXT: Review Batch 12 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: showing slash suggestions on perfect match and sorting
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Quick verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B12 Commit
```bash
git add -A
git commit -m "fix(ui): show slash suggestions on perfect match and sort (reimplements 70696e36)"
```

---

### Batch 13 -- REIMPLEMENT: `402148dbc4` hooks UI feedback

**Plan:** `project-plans/gmerge-0.23.0/402148db-plan.md`
**Upstream SHA:** `402148dbc4`
**Subject:** Add coreEvents.emitFeedback for hook failures
**Verification:** Quick (lint + typecheck) | **Risk:** LOW

#### B13 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 13 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK: Reimplement upstream commit 402148dbc4.
Add coreEvents.emitFeedback for hook failures so users see feedback in the UI.

MANDATORY TDD: Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.

REFERENCE: Read the upstream diff first:
git show 402148dbc4

Then read the playbook:
cat project-plans/gmerge-0.23.0/402148db-plan.md

Then read LLxprt's current versions of affected files.
Apply the equivalent changes, adapting for LLxprt branding and architecture.

After changes, run Quick verification (see Verification Commands).

DELIVERABLES: Hook failure UI feedback implemented. 100% behavior coverage for changed behaviors. Quick verification passes.

DO NOT:
- Skip ahead to Batch 14
- Make changes beyond this batch's scope
```

#### B13 Deepthinker Review Prompt
```
CONTEXT: Review Batch 13 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: emitting UI feedback on hook failures
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Quick verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B13 Commit
```bash
git add -A
git commit -m "feat(hooks): emit UI feedback on hook failures (reimplements 402148db)"
```

---

### Batch 14 -- PICK x1: `e0f1590850` tool confirmation labels

**Upstream commit:** `e0f1590850`
**Subject:** Simplify tool confirmation labels
**Verification:** Quick (lint + typecheck)

#### B14 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 14 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK:
Cherry-pick this 1 commit:

git cherry-pick e0f1590850

After cherry-pick, run Quick verification (see Verification Commands).

If cherry-pick fails with conflicts:
1. Run: git cherry-pick --abort
2. Resolve conflicts preserving LLxprt branding (see PLAN.md Branding Substitutions)
3. Run: git cherry-pick --continue

DELIVERABLES: Commit applied. 100% behavior coverage for changed behaviors. Quick verification passes.

DO NOT:
- Modify any files beyond what the cherry-pick changes
- Skip ahead to Batch 15
- Combine with other batches
```

#### B14 Deepthinker Review Prompt
```
CONTEXT: Review Batch 14 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: simplifying tool confirmation labels
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Quick verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B14 Commit
Cherry-pick creates the commit. If fixes were needed:
```bash
git add -A
git commit -m "fix: resolve conflicts from batch 14 cherry-pick (tool confirmation labels)"
```

---

### Batch 15 -- REIMPLEMENT: `2e229d3bb6` JIT context memory

**Plan:** `project-plans/gmerge-0.23.0/2e229d3b-plan.md`
**Upstream SHA:** `2e229d3bb6`
**Subject:** Create ContextManager for lazy .llxprt/LLXPRT.md loading with refresh
**Verification:** Full (test + lint + typecheck + build) | **Risk:** MED

#### B15 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 15 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK: Reimplement upstream commit 2e229d3bb6.
Create ContextManager for lazy .llxprt/LLXPRT.md loading with refresh capability.

MANDATORY TDD: Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.

REFERENCE: Read the upstream diff first:
git show 2e229d3bb6

Then read the playbook:
cat project-plans/gmerge-0.23.0/2e229d3b-plan.md

Then read LLxprt's current versions of affected files.
Apply the equivalent changes, adapting for LLxprt branding and architecture.

IMPORTANT: All references to .gemini/GEMINI.md must be .llxprt/LLXPRT.md in LLxprt.

After changes, run verification:
Full verification (see Verification Commands)

DELIVERABLES: ContextManager implemented with lazy loading and refresh. 100% behavior coverage for changed behaviors. Full verification passes.

DO NOT:
- Skip ahead to Batch 16
- Make changes beyond this batch's scope
```

#### B15 Deepthinker Review Prompt
```
CONTEXT: Review Batch 15 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: JIT context memory loading via ContextManager
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
4. BRANDING CRITICAL: Verify all context file paths reference .llxprt/LLXPRT.md, NOT .gemini/GEMINI.md:
   grep -rn "GEMINI.md\|\.gemini/" packages/ --include="*.ts" | grep -v node_modules | grep -v dist | grep -v "Copyright"
   Must return ZERO results (excluding existing known references).
5. Run Full verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B15 Commit
```bash
git add -A
git commit -m "feat(core): implement JIT context memory loading via ContextManager (reimplements 2e229d3b)"
```

---

### Batch 16 -- PICK x4 (security-relevant)

**Upstream commits:** `419464a8c2`, `181da07dd9`, `9383b54d50`, `db67bb106a`
**Subject:** Security approval gate, shell placeholder, OAuth validation, parsing logs
**Verification:** Full (test + lint + typecheck + build)

#### B16 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 16 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK:
Cherry-pick these 4 commits (security-relevant -- extra care required):

git cherry-pick 419464a8c2 181da07dd9 9383b54d50 db67bb106a

After cherry-pick, run Full verification (see Verification Commands).

If cherry-pick fails with conflicts:
1. Run: git cherry-pick --abort
2. Cherry-pick one at a time to isolate the problem
3. Resolve conflicts preserving LLxprt branding (see PLAN.md Branding Substitutions)
4. Run: git cherry-pick --continue

DELIVERABLES: All 4 commits applied. 100% behavior coverage for changed behaviors. Full verification passes.

DO NOT:
- Modify any files beyond what the cherry-pick changes
- Skip ahead to Batch 17
- Combine with other batches
```

#### B16 Deepthinker Review Prompt
```
CONTEXT: Review Batch 16 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~4 (or appropriate range for 4 commits)
2. Verify changes match upstream intent for: security approval gate, shell placeholder, OAuth validation, parsing logs
3. SECURITY REVIEW: These are security-relevant commits. Verify:
   - Approval gate logic is correct and cannot be bypassed
   - Shell placeholder does not introduce injection risks
   - OAuth validation is properly implemented
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Full verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B16 Commit
Cherry-pick creates commits. If fixes were needed:
```bash
git add -A
git commit -m "fix: resolve conflicts from batch 16 cherry-picks (security-relevant)"
```

---

### Batch 17 -- REIMPLEMENT: `41a1a3eed1` hook injection fix -- CRITICAL SECURITY

**Plan:** `project-plans/gmerge-0.23.0/41a1a3ee-plan.md`
**Upstream SHA:** `41a1a3eed1`
**Subject:** Sanitize expandCommand() in hookRunner.ts to prevent shell injection. Use LLXPRT_PROJECT_DIR not GEMINI_PROJECT_DIR.
**Verification:** Full + dedicated security test | **Risk:** HIGH (CRITICAL SECURITY)

#### B17 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 17 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK: Reimplement upstream commit 41a1a3eed1.
CRITICAL SECURITY FIX: Sanitize expandCommand() in hookRunner.ts to prevent shell injection.
Use LLXPRT_PROJECT_DIR not GEMINI_PROJECT_DIR.

MANDATORY TDD: Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.

REFERENCE: Read the upstream diff first:
git show 41a1a3eed1

Then read the playbook:
cat project-plans/gmerge-0.23.0/41a1a3ee-plan.md

Then read LLxprt's current versions of affected files.
Apply the equivalent changes, adapting for LLxprt branding and architecture.

CRITICAL BRANDING: All occurrences of GEMINI_PROJECT_DIR must be LLXPRT_PROJECT_DIR.

After changes, run full verification:
Full verification (see Verification Commands)

DELIVERABLES: Shell injection prevention implemented. LLXPRT_PROJECT_DIR used everywhere. 100% behavior coverage for changed behaviors. Full verification passes.

DO NOT:
- Use GEMINI_PROJECT_DIR anywhere
- Skip ahead to Batch 18
- Make changes beyond this batch's scope
```

#### B17 Deepthinker Review Prompt
```
CONTEXT: Review Batch 17 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: sanitizing expandCommand() to prevent shell injection
3. CRITICAL SECURITY REVIEW:
   - Verify expandCommand() properly sanitizes all user-controlled inputs
   - Verify no shell metacharacters can be injected via hook command expansion
   - Verify dedicated security tests exist and cover injection vectors
4. CRITICAL BRANDING CHECK:
   grep -rn "GEMINI_PROJECT_DIR" packages/ --include="*.ts" | grep -v node_modules | grep -v dist
   Must return ZERO results. All must be LLXPRT_PROJECT_DIR.
5. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
6. Run verification:
   Full verification (see Verification Commands)
7. Output: PASS or FAIL with specific issues
```

#### B17 Commit
```bash
git add -A
git commit -m "fix(core): sanitize hook command expansion to prevent injection (reimplements 41a1a3ee)"
```

---

### Batch 18 -- PICK x3

**Upstream commits:** `8ed0f8981f`, `6084708cc2`, `e64146914a`
**Subject:** Trusted folder validation, trust dialog border, accepting-edits fix
**NOTE for e64146914a:** Skip changes to smart-edit.ts (removed in LLxprt)
**Verification:** Full (test + lint + typecheck + build)

#### B18 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 18 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK:
Cherry-pick these 3 commits:

git cherry-pick 8ed0f8981f 6084708cc2 e64146914a

IMPORTANT for e64146914a: If this commit includes changes to smart-edit.ts, SKIP those changes.
smart-edit.ts is removed in LLxprt. If cherry-pick conflicts on smart-edit.ts:
1. Run: git checkout --ours -- <path-to-smart-edit.ts> (or delete the file)
2. Run: git add <path-to-smart-edit.ts>
3. Run: git cherry-pick --continue

After all 3, run Full verification (see Verification Commands).

If cherry-pick fails with other conflicts:
1. Run: git cherry-pick --abort
2. Cherry-pick one at a time to isolate the problem
3. Resolve conflicts preserving LLxprt branding (see PLAN.md Branding Substitutions)
4. Run: git cherry-pick --continue

DELIVERABLES: All 3 commits applied (smart-edit.ts changes skipped). 100% behavior coverage for changed behaviors. Full verification passes.

DO NOT:
- Add smart-edit.ts code back to the project
- Skip ahead to Batch 19
- Combine with other batches
```

#### B18 Deepthinker Review Prompt
```
CONTEXT: Review Batch 18 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~3 (or appropriate range for 3 commits)
2. Verify changes match upstream intent for: trusted folder validation, trust dialog border, accepting-edits fix
3. SMART-EDIT CHECK:
   grep -rn "smart.edit\|smartEdit\|smart_edit" packages/ --include="*.ts" | grep -v node_modules | grep -v dist
   Must return ZERO new results from this batch. smart-edit.ts must NOT exist.
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Full verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B18 Commit
Cherry-pick creates commits. If fixes were needed:
```bash
git add -A
git commit -m "fix: resolve conflicts from batch 18 cherry-picks (skip smart-edit.ts)"
```

---

### Batch 19 -- REIMPLEMENT: `58fd00a3df` .llxprtignore

**Plan:** `project-plans/gmerge-0.23.0/58fd00a3-plan.md`
**Upstream SHA:** `58fd00a3df`
**Subject:** Add .llxprtignore support for SearchText/ripgrep tool (upstream uses .geminiignore)
**Verification:** Full (test + lint + typecheck + build) | **Risk:** MED

#### B19 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 19 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK: Reimplement upstream commit 58fd00a3df.
Add .llxprtignore support for SearchText/ripgrep tool.
Upstream uses .geminiignore -- LLxprt must use .llxprtignore instead.

MANDATORY TDD: Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.

REFERENCE: Read the upstream diff first:
git show 58fd00a3df

Then read the playbook:
cat project-plans/gmerge-0.23.0/58fd00a3-plan.md

Then read LLxprt's current versions of affected files.
Apply the equivalent changes, adapting for LLxprt branding and architecture.

CRITICAL BRANDING: All references to .geminiignore must be .llxprtignore.

After changes, run full verification:
Full verification (see Verification Commands)

DELIVERABLES: .llxprtignore support implemented for SearchText tool. 100% behavior coverage for changed behaviors. Full verification passes.

DO NOT:
- Use .geminiignore anywhere
- Skip ahead to Batch 20
- Make changes beyond this batch's scope
```

#### B19 Deepthinker Review Prompt
```
CONTEXT: Review Batch 19 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: adding .llxprtignore support to SearchText tool
3. CRITICAL BRANDING CHECK:
   grep -rn "geminiignore\|\.geminiignore" packages/ --include="*.ts" | grep -v node_modules | grep -v dist
   Must return ZERO results. All must reference .llxprtignore.
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
5. Run Full verification (see Verification Commands)
6. Output: PASS or FAIL with specific issues
```

#### B19 Commit
```bash
git add -A
git commit -m "fix(core): add .llxprtignore support to SearchText tool (reimplements 58fd00a3)"
```

---

### Batch 20 -- PICK x1: `703d2e0dcc` policy/shell patch

**Upstream commit:** `703d2e0dcc`
**Subject:** Policy persistence, confirmation-bus, shell fixes
**Verification:** Full (test + lint + typecheck + build)

#### B20 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 20 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK:
Cherry-pick this 1 commit:

git cherry-pick 703d2e0dcc

After cherry-pick, run Full verification (see Verification Commands).

If cherry-pick fails with conflicts:
1. Run: git cherry-pick --abort
2. Resolve conflicts preserving LLxprt branding (see PLAN.md Branding Substitutions)
3. Run: git cherry-pick --continue

DELIVERABLES: Commit applied. 100% behavior coverage for changed behaviors. Full verification passes.

DO NOT:
- Modify any files beyond what the cherry-pick changes
- Skip ahead to Batch 21
- Combine with other batches
```

#### B20 Deepthinker Review Prompt
```
CONTEXT: Review Batch 20 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: policy persistence, confirmation-bus, shell fixes
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
4. Run Full verification (see Verification Commands)
5. Output: PASS or FAIL with specific issues
```

#### B20 Commit
Cherry-pick creates the commit. If fixes were needed:
```bash
git add -A
git commit -m "fix: resolve conflicts from batch 20 cherry-pick (policy/shell patch)"
```

---

### Batch 21 -- REIMPLEMENT: `b7ad7e1035` quota retry

**Plan:** `project-plans/gmerge-0.23.0/b7ad7e10-plan.md`
**Upstream SHA:** `b7ad7e1035`
**Subject:** Make retryDelayMs optional, add exponential backoff
**Verification:** Full (test + lint + typecheck + build) | **Risk:** MED

#### B21 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 21 of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK: Reimplement upstream commit b7ad7e1035.
Make retryDelayMs optional and add exponential backoff for quota retries.

MANDATORY TDD: Write/update behavioral tests FIRST. Run them to confirm RED (failing). Then implement minimal code to make them GREEN. Only then refactor if valuable.

REFERENCE: Read the upstream diff first:
git show b7ad7e1035

Then read the playbook:
cat project-plans/gmerge-0.23.0/b7ad7e10-plan.md

Then read LLxprt's current versions of affected files.
Apply the equivalent changes, adapting for LLxprt branding and architecture.

After changes, run Full verification (see Verification Commands).

DELIVERABLES: Quota retry with optional delay and exponential backoff. 100% behavior coverage for changed behaviors. Full verification passes.

DO NOT:
- Skip ahead to Batch 22
- Make changes beyond this batch's scope
```

#### B21 Deepthinker Review Prompt
```
CONTEXT: Review Batch 21 of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: making retryDelayMs optional and adding exponential backoff
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
4. Run Full verification (see Verification Commands)
5. Output: PASS or FAIL with specific issues
```

#### B21 Commit
```bash
git add -A
git commit -m "fix(core): improve quota retry with optional delay and exponential backoff (reimplements b7ad7e10)"
```

---

### Batch 22 -- PICK x1: `17fb758664` token calc patch (FINAL BATCH)

**Upstream commit:** `17fb758664`
**Subject:** Token calculation + eslint + client fix
**Verification:** Full + Final (last batch -- run full verification suite including synthetic smoke test)

#### B22 Cherrypicker Prompt
```
CONTEXT: You are executing Batch 22 (FINAL BATCH) of the gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

PREREQUISITE CHECK:
Run: git branch --show-current  # Must be gmerge/0.23.0
Run: git status                 # Must be clean

YOUR TASK:
Cherry-pick this 1 commit:

git cherry-pick 17fb758664

After cherry-pick, run Final verification (see Verification Commands).

If cherry-pick fails with conflicts:
1. Run: git cherry-pick --abort
2. Resolve conflicts preserving LLxprt branding (see PLAN.md Branding Substitutions)
3. Run: git cherry-pick --continue

DELIVERABLES: Commit applied. FULL final verification passes including synthetic smoke test.

DO NOT:
- Modify any files beyond what the cherry-pick changes
- Skip the synthetic smoke test
```

#### B22 Deepthinker Review Prompt
```
CONTEXT: Review Batch 22 (FINAL BATCH) of gmerge/0.23.0 cherry-pick sync.
Branch: gmerge/0.23.0. Working directory: /Users/acoliver/projects/llxprt/branch-1/llxprt-code

REVIEW TASK:
1. Run: git diff HEAD~1
2. Verify changes match upstream intent for: token calculation, eslint fixes, client fix
3. Verify 100% behavior coverage: All changed behaviors must be covered by tests
4. Check Non-Negotiables:
   - No @google/gemini-cli-core imports (must be @vybestack/llxprt-code-core)
   - No .gemini/ paths (must be .llxprt/)
   - No ClearcutLogger references
   - No GEMINI.md references (must be LLXPRT.md)
   - Copyright headers unchanged
4. Run Final verification (see Verification Commands)
5. Output: PASS or FAIL with specific issues
```

#### B22 Commit
Cherry-pick creates the commit. If fixes were needed:
```bash
git add -A
git commit -m "fix: resolve conflicts from batch 22 cherry-pick (token calc patch)"
```

---

## Todo List

When starting execution, create this EXACT todo list:

```
todo_write({ todos: [
  { id: "B1-exec",    content: "B1 EXECUTE: reimplement cc52839f hook docs snake_case tool names (subagent: cherrypicker)", status: "pending" },
  { id: "B1-review",  content: "B1 REVIEW: quick verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B1-commit",  content: "B1 COMMIT: coordinator commits", status: "pending" },
  { id: "B2-exec",    content: "B2 EXECUTE: cherry-pick db643e91 26c115a4 3e9a0a76 7f2d3345 da85aed5 (subagent: cherrypicker)", status: "pending" },
  { id: "B2-review",  content: "B2 REVIEW: quick verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B2-commit",  content: "B2 COMMIT: coordinator commits if fixes needed", status: "pending" },
  { id: "B3-exec",    content: "B3 EXECUTE: reimplement bb8f181e ripGrep debugLogger (subagent: cherrypicker)", status: "pending" },
  { id: "B3-review",  content: "B3 REVIEW: quick verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B3-commit",  content: "B3 COMMIT: coordinator commits", status: "pending" },
  { id: "B4-exec",    content: "B4 EXECUTE: cherry-pick 948401a4 3d486ec1 (subagent: cherrypicker)", status: "pending" },
  { id: "B4-review",  content: "B4 REVIEW: quick verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B4-commit",  content: "B4 COMMIT: coordinator commits if fixes needed", status: "pending" },
  { id: "B5-exec",    content: "B5 EXECUTE: reimplement 6ddd5abd slash completion eager fix (subagent: cherrypicker)", status: "pending" },
  { id: "B5-review",  content: "B5 REVIEW: quick verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B5-commit",  content: "B5 COMMIT: coordinator commits", status: "pending" },
  { id: "B6-exec",    content: "B6 EXECUTE: reimplement 739c02bd history length constant (subagent: cherrypicker)", status: "pending" },
  { id: "B6-review",  content: "B6 REVIEW: quick verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B6-commit",  content: "B6 COMMIT: coordinator commits", status: "pending" },
  { id: "B7-exec",    content: "B7 EXECUTE: cherry-pick bc168bba Table component (subagent: cherrypicker)", status: "pending" },
  { id: "B7-review",  content: "B7 REVIEW: quick verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B7-commit",  content: "B7 COMMIT: coordinator commits if fixes needed", status: "pending" },
  { id: "B8-exec",    content: "B8 EXECUTE: reimplement 54466a3e hooks friendly names (subagent: cherrypicker)", status: "pending" },
  { id: "B8-review",  content: "B8 REVIEW: FULL verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B8-commit",  content: "B8 COMMIT: coordinator commits", status: "pending" },
  { id: "B9-exec",    content: "B9 EXECUTE: reimplement 322232e5 background color detection [SELECTIVE] (subagent: cherrypicker)", status: "pending" },
  { id: "B9-review",  content: "B9 REVIEW: FULL verify + scope check (subagent: deepthinker)", status: "pending" },
  { id: "B9-commit",  content: "B9 COMMIT: coordinator commits", status: "pending" },
  { id: "B10-exec",   content: "B10 EXECUTE: reimplement 2515b89e shell env vars (subagent: cherrypicker)", status: "pending" },
  { id: "B10-review", content: "B10 REVIEW: quick verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B10-commit", content: "B10 COMMIT: coordinator commits", status: "pending" },
  { id: "B11-exec",   content: "B11 EXECUTE: cherry-pick 0c4fb6af 1e10492e (subagent: cherrypicker)", status: "pending" },
  { id: "B11-review", content: "B11 REVIEW: quick verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B11-commit", content: "B11 COMMIT: coordinator commits if fixes needed", status: "pending" },
  { id: "B12-exec",   content: "B12 EXECUTE: reimplement 70696e36 command suggestions on perfect match (subagent: cherrypicker)", status: "pending" },
  { id: "B12-review", content: "B12 REVIEW: quick verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B12-commit", content: "B12 COMMIT: coordinator commits", status: "pending" },
  { id: "B13-exec",   content: "B13 EXECUTE: reimplement 402148db hooks UI feedback (subagent: cherrypicker)", status: "pending" },
  { id: "B13-review", content: "B13 REVIEW: quick verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B13-commit", content: "B13 COMMIT: coordinator commits", status: "pending" },
  { id: "B14-exec",   content: "B14 EXECUTE: cherry-pick e0f15908 tool confirmation labels (subagent: cherrypicker)", status: "pending" },
  { id: "B14-review", content: "B14 REVIEW: quick verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B14-commit", content: "B14 COMMIT: coordinator commits if fixes needed", status: "pending" },
  { id: "B15-exec",   content: "B15 EXECUTE: reimplement 2e229d3b JIT context memory (subagent: cherrypicker)", status: "pending" },
  { id: "B15-review", content: "B15 REVIEW: FULL verify + branding audit (subagent: deepthinker)", status: "pending" },
  { id: "B15-commit", content: "B15 COMMIT: coordinator commits", status: "pending" },
  { id: "B16-exec",   content: "B16 EXECUTE: cherry-pick 419464a8 181da07d 9383b54d db67bb10 [SECURITY] (subagent: cherrypicker)", status: "pending" },
  { id: "B16-review", content: "B16 REVIEW: FULL verify + security review (subagent: deepthinker)", status: "pending" },
  { id: "B16-commit", content: "B16 COMMIT: coordinator commits if fixes needed", status: "pending" },
  { id: "B17-exec",   content: "B17 EXECUTE: reimplement 41a1a3ee hook injection fix [CRITICAL SECURITY] (subagent: cherrypicker)", status: "pending" },
  { id: "B17-review", content: "B17 REVIEW: FULL verify + security audit + branding check (subagent: deepthinker)", status: "pending" },
  { id: "B17-commit", content: "B17 COMMIT: coordinator commits", status: "pending" },
  { id: "B18-exec",   content: "B18 EXECUTE: cherry-pick 8ed0f898 6084708c e6414691 -- skip smart-edit.ts (subagent: cherrypicker)", status: "pending" },
  { id: "B18-review", content: "B18 REVIEW: FULL verify + smart-edit contamination check (subagent: deepthinker)", status: "pending" },
  { id: "B18-commit", content: "B18 COMMIT: coordinator commits if fixes needed", status: "pending" },
  { id: "B19-exec",   content: "B19 EXECUTE: reimplement 58fd00a3 .llxprtignore (subagent: cherrypicker)", status: "pending" },
  { id: "B19-review", content: "B19 REVIEW: FULL verify + .geminiignore branding check (subagent: deepthinker)", status: "pending" },
  { id: "B19-commit", content: "B19 COMMIT: coordinator commits", status: "pending" },
  { id: "B20-exec",   content: "B20 EXECUTE: cherry-pick 703d2e0d policy/shell patch (subagent: cherrypicker)", status: "pending" },
  { id: "B20-review", content: "B20 REVIEW: FULL verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B20-commit", content: "B20 COMMIT: coordinator commits if fixes needed", status: "pending" },
  { id: "B21-exec",   content: "B21 EXECUTE: reimplement b7ad7e10 quota retry (subagent: cherrypicker)", status: "pending" },
  { id: "B21-review", content: "B21 REVIEW: FULL verify + holistic review (subagent: deepthinker)", status: "pending" },
  { id: "B21-commit", content: "B21 COMMIT: coordinator commits", status: "pending" },
  { id: "B22-exec",   content: "B22 EXECUTE: cherry-pick 17fb7586 token calc patch [FINAL] (subagent: cherrypicker)", status: "pending" },
  { id: "B22-review", content: "B22 REVIEW: FULL + FINAL verify including synthetic smoke test (subagent: deepthinker)", status: "pending" },
  { id: "B22-commit", content: "B22 COMMIT: coordinator commits if fixes needed", status: "pending" },
  { id: "FINAL-progress", content: "FINAL: update PROGRESS.md with all batch commit hashes (coordinator)", status: "pending" },
  { id: "FINAL-notes",    content: "FINAL: update NOTES.md with conflicts and deviations (coordinator)", status: "pending" },
  { id: "FINAL-audit",    content: "FINAL: update AUDIT.md with all commit outcomes (coordinator)", status: "pending" }
]})
```

---

## Failure Recovery

### Cherry-pick conflict
```bash
git cherry-pick --abort   # Reset to pre-cherry-pick state
# Then cherry-pick one at a time to isolate the problem
# Resolve conflicts preserving LLxprt branding/architecture
# git cherry-pick --continue
```

### Review failure -> remediation loop
Per `dev-docs/COORDINATING.md`:
1. Deepthinker identifies issues (numbered list)
2. Launch **cherrypicker** with remediation prompt:
   ```
   CONTEXT: Remediation for Batch {N}. The deepthinker review found these issues:
   {paste numbered issues from deepthinker output}

   Fix each issue. After fixing, run: {VERIFY_COMMANDS}
   ```
3. Launch **deepthinker** again with the same review prompt
4. Max 5 iterations. After 5 failures: `todo_pause("Batch {N} review failed after 5 remediation attempts")`
5. **NEVER skip a failed batch** -- fix it or escalate

### HIGH-RISK batch remediation (B17)

Batch 17 (hook injection fix) has elevated consequences and requires extra remediation checks:

**B17 (hook injection fix -- CRITICAL SECURITY):** Before re-review, re-run the GEMINI_PROJECT_DIR branding check and verify all security test cases from the review prompt. If any grep returns non-empty for GEMINI_PROJECT_DIR, the remediation MUST address it before proceeding. Verify shell injection vectors are covered in dedicated tests.

### Build/test failure
1. Check if pre-existing: `git stash && npm run test && git stash pop`
2. If pre-existing, document in NOTES.md and continue
3. If caused by batch, include in remediation loop

---

## Note-Taking (After Each Batch)

The coordinator should update these files after each batch commit:
1. `project-plans/gmerge-0.23.0/PROGRESS.md` -- batch status + LLxprt commit hash
2. `project-plans/gmerge-0.23.0/NOTES.md` -- append: conflicts, deviations, decisions
3. `project-plans/gmerge-0.23.0/AUDIT.md` -- update commit outcomes

---

## PR Creation (After All Batches)

After FINAL-audit is complete:

1. Run Final verification (see Verification Commands at top).

2. Push and create PR with proper title format:
```bash
git push origin gmerge/0.23.0
gh pr create --base main --head gmerge/0.23.0 \
  --title "chore: upstream sync v0.22.0..v0.23.0 (Fixes #<ISSUE_NUMBER>)" \
  --body "See project-plans/gmerge-0.23.0/CHERRIES.md and AUDIT.md for full details."
```
**IMPORTANT:** PR title MUST include the issue number being fixed (e.g., "Fixes #1234").

3. Watch CI and remediate until all green:
```bash
gh pr checks <PR_NUMBER> --watch --interval 300
```

Loop until workflows finish, then:
- Review ALL CodeRabbit comments
- For each CodeRabbit issue:
  - Evaluate against actual source code (don't trust blindly)
  - Ignore severity labels - treat all issues equally
  - DO NOT dismiss "code quality" issues - DRY and maintainability matter
  - DO dismiss issues well outside PR scope or factual mistakes
  - Add comment explaining action taken
  - Resolve if addressed or provably invalid
- For any failures or issues to address:
  - Fix the code
  - Run Final verification again
  - Commit and push
  - Watch workflows again
  - Loop until all workflows are green AND all CodeRabbit issues resolved

4. Never assume failures are "unrelated to my changes" - verify with evidence via `gh` that same tests fail on main before claiming pre-existing.

---

## Context Recovery

If you lose context:
1. **Branch:** `gmerge/0.23.0`
2. **Range:** upstream `v0.22.0..v0.23.0`
3. **Coordination protocol:** `dev-docs/COORDINATING.md`
4. **Key files:**
   - This file: `project-plans/gmerge-0.23.0/PLAN.md`
   - Decisions: `project-plans/gmerge-0.23.0/CHERRIES.md`
   - Progress: `project-plans/gmerge-0.23.0/PROGRESS.md`
   - Notes: `project-plans/gmerge-0.23.0/NOTES.md`
   - Audit: `project-plans/gmerge-0.23.0/AUDIT.md`
   - Per-reimplement plans: `project-plans/gmerge-0.23.0/<sha>-plan.md`
5. **Resume:** `todo_read()` -> find first pending -> execute using subagents per batch section above
6. **Git state:** `git log --oneline -20` to see what's been applied
