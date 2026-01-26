# Master Feature Implementation Plan: v0.14.0 Sync Completion

**Branch:** `20260126gmerge`  
**Created:** 2026-01-26  
**Status:** Cherry-picks complete, features remaining

---

## Executive Summary

The v0.13.0 to v0.14.0 cherry-pick sync is complete for commits that could be directly picked. Three upstream commits require feature implementations rather than cherry-picks:

| Upstream Commit | Feature | Status | Plan File |
|-----------------|---------|--------|-----------|
| `c13ec85d7d` | Keychain storage names | Blocked | `FEATURE-extension-settings.md` |
| `fa93b56243` | Extension reloading | Ready | `FEATURE-extension-reloading.md` |
| `f05d937f39` | Consistent params | Ready | `FEATURE-consistent-params.md` |

**Dependency:** `c13ec85d7d` requires extension settings feature first.

---

## START HERE (If you were told to "DO this plan")

### Step 1: Check current state
```bash
git branch --show-current  # Should be 20260126gmerge
git status                 # Should be clean (commit any pending changes first)
```

### Step 2: Verify cherry-picks are done
```bash
git log --oneline -20  # Should show the cherry-picked commits
```

### Step 3: Read the todo list
Call `todo_read()`. If it shows cherry-pick todos, those are stale. Create fresh feature todos.

### Step 4: Execute features IN ORDER
**Order matters!** Execute in this sequence:

1. **Extension Reloading** (`FEATURE-extension-reloading.md`) - No dependencies
2. **Consistent Parameters** (`FEATURE-consistent-params.md`) - No dependencies  
3. **Extension Settings** (`FEATURE-extension-settings.md`) - Largest, do last

### Step 5: For each feature plan
1. Read the FEATURE-*.md file
2. Create the todo list from that file
3. Execute each phase using subagents (doer/verifier pattern)
4. Commit after each phase passes review
5. Update this master plan with completion status

---

## Execution Pattern (CRITICAL)

Each feature follows this pattern:

```
For each phase in feature:
  1. Mark phase-test as in_progress
  2. Call task(subagent_name="typescriptexpert", goal_prompt=<test prompt>)
  3. Mark phase-test as completed
  
  4. Mark phase-impl as in_progress
  5. Call task(subagent_name="typescriptexpert", goal_prompt=<impl prompt>)
  6. Mark phase-impl as completed
  
  7. Mark phase-review as in_progress
  8. Call task(subagent_name="reviewer", goal_prompt=<review prompt>)
  9. If FAIL:
     - Call task(subagent_name="typescriptexpert", goal_prompt=<remediation>)
     - Re-run reviewer
     - Loop max 5 times
  10. Mark phase-review as completed
  
  11. Mark phase-commit as in_progress
  12. Run: git add -A && git commit -m "<message from plan>"
  13. Mark phase-commit as completed
```

### Subagent Roles

| Subagent | Role | When to Use |
|----------|------|-------------|
| `typescriptexpert` | Implementation | Write tests, write code, fix issues |
| `reviewer` | **Qualitative** Verification | Actually READ the code, verify behavior, not just run commands |
| `codeanalayzer` | Research | Audit code, find patterns, understand architecture |

### Qualitative Review (CRITICAL)

The `reviewer` subagent does NOT just run commands and check exit codes. It MUST:

1. **Actually read the test files** - Are tests meaningful? Do they test behavior?
2. **Actually read the implementation** - Will this work at runtime? Is it correct?
3. **Trace execution paths** - Follow the code for specific scenarios
4. **Check integration** - Does this connect properly to the rest of the system?
5. **Verify RULES.md compliance** - No `any`, immutable, types from schemas

Example reviewer output structure:
```json
{
  "result": "PASS" or "FAIL",
  "mechanical": {
    "lint": "PASS/FAIL",
    "typecheck": "PASS/FAIL",
    "tests": "PASS/FAIL"
  },
  "qualitative": {
    "test_quality": {
      "verdict": "PASS/FAIL",
      "tests_verify_behavior": true/false,
      "edge_cases_covered": ["list"],
      "issues": []
    },
    "implementation_quality": {
      "verdict": "PASS/FAIL",
      "will_work_at_runtime": true/false,
      "code_path_traced": "description of what happens",
      "issues": []
    },
    "integration": {
      "verdict": "PASS/FAIL",
      "connects_correctly": true/false,
      "issues": []
    },
    "rules_compliance": {
      "verdict": "PASS/FAIL",
      "any_types": false,
      "mutations": false,
      "types_from_schemas": true
    }
  },
  "behavioral_trace": {
    "scenario": "description",
    "expected": "what should happen",
    "actual": "what code actually does",
    "verdict": "PASS/FAIL"
  },
  "issues_requiring_remediation": []
}
```

**If reviewer just runs commands and says "all pass" without reading code: REJECT and re-run.**

---

## Feature 1: Extension Reloading

**Plan:** `FEATURE-extension-reloading.md`  
**Complexity:** Low-Medium  
**Phases:** 3

### What It Adds
- `SettingScope.Session` for runtime-only enable/disable
- Auto-reload commands when extensions change
- Tab completion with scope options

### Why Do First
- No dependencies on other features
- Smallest scope
- Good warm-up for the architecture

### Master Todo Entry
```javascript
{
  id: "F1-start",
  content: "FEATURE 1: Extension Reloading - read FEATURE-extension-reloading.md and execute",
  status: "pending",
  priority: "high"
}
```

---

## Feature 2: Consistent Parameters

**Plan:** `FEATURE-consistent-params.md`  
**Complexity:** Medium (many files, simple changes)  
**Phases:** 5 + audit

### What It Adds
- All tools accept both `file_path` and `absolute_path`
- Consistent parameter naming across tools
- Backward compatibility maintained

### Why Do Second
- No dependencies
- Medium scope
- Audit phase helps understand tool architecture

### Master Todo Entry
```javascript
{
  id: "F2-start",
  content: "FEATURE 2: Consistent Parameters - read FEATURE-consistent-params.md and execute",
  status: "pending",
  priority: "high"
}
```

---

## Feature 3: Extension Settings

**Plan:** `FEATURE-extension-settings.md`  
**Complexity:** Medium-High  
**Phases:** 5

### What It Adds
- Extensions can declare required settings
- Prompt users during install/update
- Non-sensitive settings → env file
- Sensitive settings → keychain with user-friendly names
- Support both gemini.json and llxprt.json manifests

### Why Do Last
- Largest feature
- Unlocks upstream c13ec85d7d (keychain naming)
- Most complex integration

### Master Todo Entry
```javascript
{
  id: "F3-start",
  content: "FEATURE 3: Extension Settings - read FEATURE-extension-settings.md and execute",
  status: "pending",
  priority: "high"
}
```

---

## Master Todo List

Call `todo_write` with this list to begin:

```javascript
todo_write({
  todos: [
    // Feature 1: Extension Reloading
    {
      id: "F1-start",
      content: "FEATURE 1: Extension Reloading - read FEATURE-extension-reloading.md, create phase todos, execute",
      status: "pending",
      priority: "high"
    },
    {
      id: "F1-complete",
      content: "FEATURE 1 COMPLETE: All phases done, all tests pass, committed",
      status: "pending",
      priority: "high"
    },

    // Feature 2: Consistent Parameters
    {
      id: "F2-start",
      content: "FEATURE 2: Consistent Parameters - read FEATURE-consistent-params.md, run audit, create phase todos, execute",
      status: "pending",
      priority: "high"
    },
    {
      id: "F2-complete",
      content: "FEATURE 2 COMPLETE: All phases done, all tests pass, committed",
      status: "pending",
      priority: "high"
    },

    // Feature 3: Extension Settings
    {
      id: "F3-start",
      content: "FEATURE 3: Extension Settings - read FEATURE-extension-settings.md, create phase todos, execute",
      status: "pending",
      priority: "high"
    },
    {
      id: "F3-complete",
      content: "FEATURE 3 COMPLETE: All phases done, all tests pass, committed",
      status: "pending",
      priority: "high"
    },

    // Final verification
    {
      id: "FINAL-verify",
      content: "FINAL: Run full test suite, build, smoke test",
      status: "pending",
      priority: "high"
    },
    {
      id: "FINAL-docs",
      content: "FINAL: Update PROGRESS.md, NOTES.md, AUDIT.md with feature completion",
      status: "pending",
      priority: "medium"
    }
  ]
})
```

---

## Verification Commands

After each feature, run:
```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

After all features, smoke test:
```bash
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

## Rollback Strategy

Each feature phase has its own commit. If a feature breaks something:

```bash
# Find the commit that broke things
git log --oneline -20

# Revert the problematic commits
git revert <commit-hash>

# Or reset to before the feature
git log --oneline | grep -B1 "FEATURE N"
git reset --hard <commit-before-feature>
```

---

## Success Criteria

- [ ] Feature 1 (Extension Reloading) complete and committed
- [ ] Feature 2 (Consistent Parameters) complete and committed
- [ ] Feature 3 (Extension Settings) complete and committed
- [ ] All tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Build passes (`npm run build`)
- [ ] Smoke test passes
- [ ] PROGRESS.md updated
- [ ] NOTES.md updated with any issues
- [ ] AUDIT.md updated with feature completion

---

## Notes

### Why Not Cherry-Pick These?

1. **Extension Settings (c13ec85d7d)**: LLxprt doesn't have the extension settings feature that this commit improves. Need to add the feature first.

2. **Extension Reloading (fa93b56243)**: 24 files changed, many conflicts with LLxprt's different architecture. Reimplementation is cleaner.

3. **Consistent Parameters (f05d937f39)**: LLxprt tools already have different parameter patterns. Need to audit and update systematically.

### Multi-Provider Considerations

- Extension settings stored per-extension (not per-provider)
- Keychain service names use "LLxprt Code" branding
- Manifest compatibility: support both gemini.json and llxprt.json

### Test-First Is Mandatory

Per dev-docs/RULES.md, all code must be written in response to failing tests. Each phase:
1. Write tests first (RED)
2. Implement minimal code to pass (GREEN)
3. Refactor if valuable
4. Commit
