# Execution Plan: v0.14.0 → v0.15.4 Cherry-Pick

**Branch:** `20260128gmerge`
**Created:** 2026-01-28
**Upstream range:** `v0.14.0..v0.15.4`
**Tracking Issue:** TBD

---

## START HERE (If you were told to "DO this plan")

If you're reading this because someone said "DO @project-plans/20260128gmerge/PLAN.md", follow these steps:

### Step 1: Check current state

```bash
git branch --show-current  # Should be 20260128gmerge
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

- Privacy: No Clearcut telemetry, no Google-specific auth
- Multi-provider: Preserve provider abstraction
- Tool batching: Keep LLxprt's parallel tool execution
- Branding: Replace gemini -> llxprt in user-facing strings

---

## File Existence Pre-Check

Files that REIMPLEMENT plans reference that may differ in LLxprt:

| Upstream File | LLxprt Equivalent | Status |
|---------------|-------------------|--------|
| `extension-manager.ts` | Functional extensions in `src/services/extensions/` | Different architecture |
| `KeypressContext.tsx` | Same path | Exists, will be refactored |
| `hookRunner.ts` | Missing | Will be added via PICK |

---

## Branding Substitutions

| Upstream | LLxprt |
|----------|--------|
| `gemini` | `llxprt` |
| `Gemini CLI` | `LLxprt Code` |
| `GEMINI_` env vars | `LLXPRT_` env vars |
| `@google/gemini-cli` | `@vybestack/llxprt-code` |

---

## Todo List Management

### EXACT todo_write call to use:

```typescript
todo_write({
  todos: [
    // Batch 1: Low-risk picks (8 commits)
    { id: "B1-exec", content: "Batch 1 EXECUTE: cherry-pick 054497c7a 475e92da5 ef4030331 5ff7cdc9e 331dbd563 4ab94dec5 3c9052a75 2136598e8", status: "pending", priority: "high" },
    { id: "B1-review", content: "Batch 1 REVIEW: verify commits landed, lint, typecheck, qualitative check", status: "pending", priority: "high" },
    { id: "B1-commit", content: "Batch 1 COMMIT: git add -A && git commit", status: "pending", priority: "high" },
    
    // Batch 2: Medium-risk picks (6 commits) + FULL VERIFY
    { id: "B2-exec", content: "Batch 2 EXECUTE: cherry-pick 5ba6bc713 51f952e70 fd59d9dd9 9116cf2ba c1076512d 2abc288c5", status: "pending", priority: "high" },
    { id: "B2-review", content: "Batch 2 REVIEW + FULL VERIFY: lint, typecheck, test, build, qualitative check", status: "pending", priority: "high" },
    { id: "B2-commit", content: "Batch 2 COMMIT: git add -A && git commit", status: "pending", priority: "high" },
    
    // Batch 3: Extension/A2A picks (2 commits)
    { id: "B3-exec", content: "Batch 3 EXECUTE: cherry-pick a0a682826 69339f08a", status: "pending", priority: "high" },
    { id: "B3-review", content: "Batch 3 REVIEW: verify commits landed, lint, typecheck, qualitative check", status: "pending", priority: "high" },
    { id: "B3-commit", content: "Batch 3 COMMIT: git add -A && git commit", status: "pending", priority: "high" },
    
    // Batch 4: Hooks + Ink (2 commits) + FULL VERIFY
    { id: "B4-exec", content: "Batch 4 EXECUTE: cherry-pick 4ef4bd6f0 + manual ink bump to @jrichman/ink@6.4.8", status: "pending", priority: "high" },
    { id: "B4-review", content: "Batch 4 REVIEW + FULL VERIFY: lint, typecheck, test, build, qualitative check", status: "pending", priority: "high" },
    { id: "B4-commit", content: "Batch 4 COMMIT: git add -A && git commit", status: "pending", priority: "high" },
    
    // Batch 5: REIMPLEMENT - KeypressContext (HIGH priority)
    { id: "B5-exec", content: "Batch 5 REIMPLEMENT: KeypressContext unified ANSI parser (9e4ae214a + c0b766ad7) - see 9e4ae214a-c0b766ad7-plan.md", status: "pending", priority: "high" },
    { id: "B5-review", content: "Batch 5 REVIEW: verify parser works, ESC handling, paste, kitty CSI-u", status: "pending", priority: "high" },
    { id: "B5-commit", content: "Batch 5 COMMIT: git add -A && git commit", status: "pending", priority: "high" },
    
    // Batch 6: REIMPLEMENT - Editor diff drift + tmux crash + FULL VERIFY
    { id: "B6-exec", content: "Batch 6 REIMPLEMENT: 37ca643a6 (editor diff drift) + 22b055052 (tmux gradient crash)", status: "pending", priority: "high" },
    { id: "B6-review", content: "Batch 6 REVIEW + FULL VERIFY: lint, typecheck, test, build, qualitative check", status: "pending", priority: "high" },
    { id: "B6-commit", content: "Batch 6 COMMIT: git add -A && git commit", status: "pending", priority: "high" },
    
    // Batch 7: REIMPLEMENT - Extension fixes
    { id: "B7-exec", content: "Batch 7 REIMPLEMENT: cc2c48d59 (uninstall fix) + b248ec6df (blockGitExtensions)", status: "pending", priority: "high" },
    { id: "B7-review", content: "Batch 7 REVIEW: verify extension fixes work", status: "pending", priority: "high" },
    { id: "B7-commit", content: "Batch 7 COMMIT: git add -A && git commit", status: "pending", priority: "high" },
    
    // Batch 8: REIMPLEMENT - Extension reload + restart + FULL VERIFY
    { id: "B8-exec", content: "Batch 8 REIMPLEMENT: 47603ef8e (memory refresh) + c88340314 (toolset refresh) + bafbcbbe8 (/extensions restart)", status: "pending", priority: "high" },
    { id: "B8-review", content: "Batch 8 REVIEW + FULL VERIFY: lint, typecheck, test, build, qualitative check", status: "pending", priority: "high" },
    { id: "B8-commit", content: "Batch 8 COMMIT: git add -A && git commit", status: "pending", priority: "high" },
    
    // Batch 9: REIMPLEMENT - Animated scroll
    { id: "B9-exec", content: "Batch 9 REIMPLEMENT: e192efa1f (animated scroll) - see Research Findings in CHERRIES.md", status: "pending", priority: "medium" },
    { id: "B9-review", content: "Batch 9 REVIEW: verify scroll animation works", status: "pending", priority: "medium" },
    { id: "B9-commit", content: "Batch 9 COMMIT: git add -A && git commit", status: "pending", priority: "medium" },
    
    // Batch 10: REIMPLEMENT - Session resuming (largest) + FULL VERIFY
    { id: "B10-exec", content: "Batch 10 REIMPLEMENT: 6893d2744 (session resuming) - see Research Findings for --continue fix", status: "pending", priority: "high" },
    { id: "B10-review", content: "Batch 10 REVIEW + FULL VERIFY: lint, typecheck, test, build, --continue works", status: "pending", priority: "high" },
    { id: "B10-commit", content: "Batch 10 COMMIT: git add -A && git commit", status: "pending", priority: "high" },
    
    // Final documentation
    { id: "FINAL-progress", content: "UPDATE PROGRESS.md with all commit hashes", status: "pending", priority: "medium" },
    { id: "FINAL-notes", content: "UPDATE NOTES.md with conflicts/deviations", status: "pending", priority: "medium" },
    { id: "FINAL-audit", content: "UPDATE AUDIT.md with all outcomes", status: "pending", priority: "medium" },
  ]
})
```

---

## Batch Schedule

### Batch 1: Low-Risk Picks (8 commits)
**Type:** PICK
**Verify:** Quick (lint, typecheck)

| Order | SHA | Subject |
|-------|-----|---------|
| 1 | `054497c7a` | fix(core): Handle null command in VSCode IDE detection |
| 2 | `475e92da5` | Fix test in windows |
| 3 | `ef4030331` | docs: fix typos in some files |
| 4 | `5ff7cdc9e` | test(policy): add extreme priority value tests |
| 5 | `331dbd563` | Preserve tabs on paste |
| 6 | `4ab94dec5` | test: fix flaky file system integration test |
| 7 | `3c9052a75` | Stop printing garbage characters for F1,F2.. keys |
| 8 | `2136598e8` | Harden modifiable tool temp workspace |

**Cherrypicker prompt:**
```
Execute cherry-pick batch 1 for LLxprt Code sync from upstream gemini-cli.

Cherry-pick these 8 commits in order:
1. 054497c7a - fix(core): Handle null command in VSCode IDE detection
2. 475e92da5 - Fix test in windows
3. ef4030331 - docs: fix typos in some files
4. 5ff7cdc9e - test(policy): add extreme priority value tests
5. 331dbd563 - Preserve tabs on paste
6. 4ab94dec5 - test: fix flaky file system integration test
7. 3c9052a75 - Stop printing garbage characters for F1,F2.. keys
8. 2136598e8 - Harden modifiable tool temp workspace

Commands:
git cherry-pick 054497c7a
git cherry-pick 475e92da5
git cherry-pick ef4030331
git cherry-pick 5ff7cdc9e
git cherry-pick 331dbd563
git cherry-pick 4ab94dec5
git cherry-pick 3c9052a75
git cherry-pick 2136598e8

If conflicts occur, resolve them following dev-docs/cherrypicking.md and continue.
Apply branding substitutions (gemini -> llxprt) where needed.
Run quick verify: npm run lint && npm run typecheck
```

**Reviewer prompt:**
```
Review cherry-pick batch 1 for LLxprt Code sync.

MECHANICAL VERIFICATION:
1. Run: npm run lint
2. Run: npm run typecheck
3. Check for branding issues: grep -r "@google/gemini-cli\|USE_GEMINI" packages/

QUALITATIVE VERIFICATION (for each commit):
1. 054497c7a - Verify null check added in VSCode IDE detection code
2. 475e92da5 - Verify Windows test fix applied
3. ef4030331 - Verify doc typos fixed
4. 5ff7cdc9e - Verify policy tests added
5. 331dbd563 - Verify tab preservation in paste handling
6. 4ab94dec5 - Verify flaky test fix applied
7. 3c9052a75 - Verify F1/F2 key handling fixed
8. 2136598e8 - Verify temp workspace hardening applied

For each commit, verify:
- Code actually landed (not stubbed)
- Behavioral equivalence to upstream
- Integration correctness

Output format:
PASS/FAIL: [overall]
Per-commit:
- [sha]: LANDED=[yes/no] FUNCTIONAL=[yes/no] NOTES=[any issues]
```

---

### Batch 2: Medium-Risk Picks (6 commits) + FULL VERIFY
**Type:** PICK
**Verify:** Full (lint, typecheck, test, build)

| Order | SHA | Subject |
|-------|-----|---------|
| 1 | `5ba6bc713` | fix(prompt): Add Angular support to base prompt |
| 2 | `51f952e70` | fix(core): use ripgrep --json output for robust parsing |
| 3 | `fd59d9dd9` | Fix shift+return in vscode |
| 4 | `9116cf2ba` | [cleanup] rename info message property 'icon' to 'prefix' |
| 5 | `c1076512d` | Deprecate read_many_files tool |
| 6 | `2abc288c5` | Make useFullWidth the default |

**Cherrypicker prompt:**
```
Execute cherry-pick batch 2 for LLxprt Code sync.

Cherry-pick these 6 commits in order:
1. 5ba6bc713 - fix(prompt): Add Angular support to base prompt
2. 51f952e70 - fix(core): use ripgrep --json output for robust parsing
3. fd59d9dd9 - Fix shift+return in vscode
4. 9116cf2ba - [cleanup] rename info message property 'icon' to 'prefix'
5. c1076512d - Deprecate read_many_files tool
6. 2abc288c5 - Make useFullWidth the default

Commands:
git cherry-pick 5ba6bc713
git cherry-pick 51f952e70
git cherry-pick fd59d9dd9
git cherry-pick 9116cf2ba
git cherry-pick c1076512d
git cherry-pick 2abc288c5

Run FULL verify:
npm run lint
npm run typecheck
npm run test
npm run build
```

**Reviewer prompt:**
```
Review cherry-pick batch 2 for LLxprt Code sync.

MECHANICAL VERIFICATION (FULL):
1. npm run lint
2. npm run typecheck
3. npm run test
4. npm run build
5. Branding check: grep -r "@google/gemini-cli\|USE_GEMINI" packages/

QUALITATIVE VERIFICATION:
1. 5ba6bc713 - Angular support added to prompts
2. 51f952e70 - ripgrep uses --json output
3. fd59d9dd9 - shift+return fixed in VS Code
4. 9116cf2ba - 'icon' renamed to 'prefix' in types
5. c1076512d - read_many_files has deprecation warning
6. 2abc288c5 - useFullWidth defaults to true

Output PASS/FAIL with per-commit assessment.
```

---

### Batch 3: Extension/A2A Picks (2 commits)
**Type:** PICK
**Verify:** Quick

| Order | SHA | Subject |
|-------|-----|---------|
| 1 | `a0a682826` | fix: Downloading release assets from private GitHub repository |
| 2 | `69339f08a` | Adds listCommands endpoint to a2a server |

**Cherrypicker prompt:**
```
Execute cherry-pick batch 3 for LLxprt Code sync.

Cherry-pick these 2 commits:
1. a0a682826 - fix: Downloading release assets from private GitHub repository
2. 69339f08a - Adds listCommands endpoint to a2a server

Note: A2A server stays PRIVATE (do not make publishable).

Run quick verify: npm run lint && npm run typecheck
```

---

### Batch 4: Hooks + Ink (2 commits) + FULL VERIFY
**Type:** PICK + MANUAL
**Verify:** Full

| Order | SHA | Subject |
|-------|-----|---------|
| 1 | `4ef4bd6f0` | feat(hooks): Hook Execution Engine |
| 2 | `6cf1c9852` | Update ink version (MANUAL: bump to @jrichman/ink@6.4.8) |

**Cherrypicker prompt:**
```
Execute batch 4 for LLxprt Code sync.

1. Cherry-pick hookRunner:
   git cherry-pick 4ef4bd6f0

2. MANUAL ink version bump (do NOT cherry-pick 6cf1c9852):
   - Edit packages/cli/package.json
   - Change "ink": "npm:@jrichman/ink@6.4.7" to "ink": "npm:@jrichman/ink@6.4.8"
   - Run: npm install

Run FULL verify:
npm run lint
npm run typecheck
npm run test
npm run build
```

---

### Batch 5: REIMPLEMENT - KeypressContext Unified ANSI Parser
**Type:** REIMPLEMENT
**Plan:** `9e4ae214a-c0b766ad7-plan.md`
**Verify:** Quick + manual testing

**Cherrypicker prompt:**
```
Execute REIMPLEMENT batch 5 for LLxprt Code sync.

REIMPLEMENT upstream commits 9e4ae214a + c0b766ad7 (KeypressContext unified ANSI parser).

Follow the detailed plan in: project-plans/20260128gmerge/9e4ae214a-c0b766ad7-plan.md

Key changes:
1. Replace readline/PassThrough parsing with unified emitKeys generator
2. Add table-driven KEY_INFO_MAP for key lookup
3. Add bufferPaste, bufferBackslashEnter, nonKeyboardEventFilter
4. Remove kittyProtocolEnabled prop
5. Update tests for new parsing model

Run quick verify: npm run lint && npm run typecheck
```

---

### Batch 6: REIMPLEMENT - Editor Diff Drift + tmux Crash + FULL VERIFY
**Type:** REIMPLEMENT
**Verify:** Full

**Cherrypicker prompt:**
```
Execute REIMPLEMENT batch 6 for LLxprt Code sync.

REIMPLEMENT two fixes:

1. 37ca643a6 - Fix external editor diff drift
   - LLxprt has onEditorOpen parameter (keep it)
   - Add contentOverrides parameter to openInExternalEditor()
   - Prevents diff drift when editor saves with trailing newlines

2. 22b055052 - Fix gemini crash on startup in tmux
   - LLxprt Footer.tsx has NO protection (worse than upstream)
   - Create shared ThemedGradient component with try/catch
   - Apply to Header and Footer

Run FULL verify after implementation.
```

---

### Batch 7-10: Remaining Reimplementations

(Similar structure for each - see CHERRIES.md for details)

---

## Failure Recovery

### Cherry-pick conflict
```bash
git cherry-pick --abort
# Fix the issue
# Retry the cherry-pick
```

### Review fails
1. Call cherrypicker subagent with remediation prompt
2. Call reviewer subagent again
3. Loop up to 5 times
4. If still failing, call todo_pause() with reason

### Test failures
1. Identify failing test
2. Determine if LLxprt-specific adaptation needed
3. Fix and re-run
4. Create follow-up fix commit if needed

---

## Context Recovery

If you're resuming after a context wipe:

1. **Check git state:**
   ```bash
   git branch --show-current  # Should be 20260128gmerge
   git status
   git log --oneline -5
   ```

2. **Read the todo list:** Call `todo_read()`

3. **Find resume point:** First `pending` or `in_progress` item

4. **Key files to read:**
   - `project-plans/20260128gmerge/PLAN.md` (this file)
   - `project-plans/20260128gmerge/CHERRIES.md` (decisions)
   - `project-plans/20260128gmerge/PROGRESS.md` (what's done)
   - `project-plans/20260128gmerge/NOTES.md` (issues encountered)

5. **Summary:**
   - Branch: `20260128gmerge`
   - Upstream range: `v0.14.0..v0.15.4`
   - Counts: 19 PICK, 25 SKIP, 10 REIMPLEMENT
   - Use subagents: cherrypicker for execution, reviewer for verification
