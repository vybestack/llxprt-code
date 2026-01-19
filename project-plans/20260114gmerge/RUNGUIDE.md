# Execution Runguide: v0.12.0 → v0.13.0 Cherry-Pick Plan

## Overview

This guide explains how to execute the 21-batch cherry-pick plan using subagents. Each batch follows a 4-step workflow with specific subagents.

## Subagent Mapping

| Batch Type | Implementation Subagent | Review Subagent | Remediation Subagent |
|------------|------------------------|-----------------|---------------------|
| PICK (Batches 1-13) | `cherrypicker` | `reviewer` | `deepthinker` |
| REIMPLEMENT (Batches 14-21) | `typescriptexpert` | `reviewer` | `deepthinker` |

## Workflow Per Batch

```
1. IMPLEMENT → 2. REVIEW → 3. REMEDIATE (if needed) → 4. COMMIT
                    ↑              ↓
                    └──────────────┘ (repeat until pass)
```

---

## Verification Commands (MANDATORY)

Every subagent MUST run these commands and ALL MUST PASS:

```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load zai "tell me a haiku and do nothing else"
```

### Critical Rules

1. **NO PRE-EXISTING FAILURES** - All tests pass in the current codebase. Any failure after a batch is caused by that batch and MUST be fixed.
2. **ALL CONFLICT MARKERS MUST BE GONE** - For cherry-pick batches, search for `<<<<<<<`, `=======`, `>>>>>>>` - none should exist.
3. **ROOT CAUSE ANALYSIS** - When fixing failures, understand WHY it failed and make correct code changes. No workarounds or skipping tests.
4. **DO NOT MARK COMPLETE** until all verification commands pass.

---

## Subagent Prompt Templates

### For PICK Batches (1-13) - Using `cherrypicker`

```
GOAL: Cherry-pick upstream commits for Batch N of the LLxprt v0.12.0→v0.13.0 merge.

CONTEXT FILES TO READ FIRST:
- /Users/acoliver/projects/llxprt/branch-1/llxprt-code/project-plans/20260114gmerge/PLAN.md (find Batch N section)
- /Users/acoliver/projects/llxprt/branch-1/llxprt-code/project-plans/20260114gmerge/CHERRIES.md (for commit details)
- /Users/acoliver/projects/llxprt/branch-1/llxprt-code/dev-docs/cherrypicking.md (for non-negotiables and branding)

UPSTREAM REPOSITORY: The upstream remote should already be configured. If not, add it:
  git remote add upstream https://github.com/anthropics/claude-code.git (or the actual upstream URL)

COMMITS TO CHERRY-PICK (Batch N):
[List the specific SHAs and subjects from PLAN.md]

CHERRY-PICK COMMAND:
git cherry-pick [SHA1] [SHA2] [SHA3] [SHA4] [SHA5]

CONFLICT RESOLUTION:
- If conflicts occur, resolve them following LLxprt conventions
- Apply branding substitutions: @google/gemini-cli-core → @vybestack/llxprt-code-core
- Replace gemini-cli references with llxprt-code
- Preserve LLxprt's multi-provider architecture
- Remove any ClearcutLogger/Google telemetry additions

VERIFICATION (ALL MUST PASS):
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load zai "tell me a haiku and do nothing else"

COMPLETION CRITERIA:
- All cherry-picks applied
- No conflict markers remain (search for <<<<<<<, =======, >>>>>>>)
- All verification commands pass
- Fix any issues with root cause analysis and correct code changes

OUTPUT: Report what was done, any conflicts resolved, and verification results.
```

### For REIMPLEMENT Batches (14-21) - Using `typescriptexpert`

```
GOAL: Reimplement upstream commit for Batch N of the LLxprt v0.12.0→v0.13.0 merge.

CONTEXT FILES TO READ FIRST:
- /Users/acoliver/projects/llxprt/branch-1/llxprt-code/project-plans/20260114gmerge/PLAN.md (find Batch N section)
- /Users/acoliver/projects/llxprt/branch-1/llxprt-code/project-plans/20260114gmerge/[SHA]-plan.md (detailed reimplementation plan)
- /Users/acoliver/projects/llxprt/branch-1/llxprt-code/dev-docs/cherrypicking.md (for non-negotiables)

UPSTREAM COMMIT: [SHA] - [Subject]

REIMPLEMENTATION APPROACH:
1. Read the specific plan file for this commit
2. Understand what the upstream commit does
3. Adapt it to LLxprt's architecture (NOT a direct cherry-pick)
4. Key adaptations needed:
   - Use LLxprt's existing systems (policy engine, extension manager, etc.)
   - Preserve multi-provider support
   - No Google telemetry
   - Follow LLxprt naming conventions

VERIFICATION (ALL MUST PASS):
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load zai "tell me a haiku and do nothing else"

COMPLETION CRITERIA:
- Feature/fix from upstream is implemented in LLxprt style
- All verification commands pass
- Fix any issues with root cause analysis and correct code changes

OUTPUT: Report what was implemented, key adaptations made, and verification results.
```

### For Review - Using `reviewer`

```
GOAL: Review the implementation of Batch N for the LLxprt v0.12.0→v0.13.0 merge.

CONTEXT:
- This batch was just implemented by [cherrypicker|typescriptexpert] subagent
- Review the git changes: git diff HEAD~N (where N is number of commits in batch)
- Or use: git log --oneline -10 to see recent commits

REVIEW CHECKLIST:
1. Code Quality:
   - Does the code follow LLxprt conventions?
   - Are there any conflict markers remaining? (search for <<<<<<<)
   - Is branding correct? (no @google/gemini-cli-core, no gemini-cli references)

2. Architecture:
   - Does it preserve LLxprt's multi-provider support?
   - No ClearcutLogger or Google telemetry added?
   - No model routing code added?

3. Functionality:
   - Does the implementation match the upstream intent?
   - Are there any obvious bugs or issues?

VERIFICATION (RUN ALL):
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load zai "tell me a haiku and do nothing else"

OUTPUT:
- PASS: All checks pass, code is good
- FAIL: List specific issues that need remediation

If FAIL, be specific about:
- What failed (which command, which test, what error)
- What code is problematic
- What needs to be fixed
```

### For Remediation - Using `deepthinker`

```
GOAL: Fix issues identified in Batch N review for the LLxprt v0.12.0→v0.13.0 merge.

ISSUES TO FIX:
[List specific issues from reviewer output]

ROOT CAUSE ANALYSIS REQUIRED:
- Do NOT apply band-aid fixes
- Understand WHY each issue exists
- Make correct code changes that address the root cause
- If a test is failing, fix the code being tested (or the test if it's wrong), don't skip the test

CONTEXT FILES:
- /Users/acoliver/projects/llxprt/branch-1/llxprt-code/project-plans/20260114gmerge/PLAN.md
- /Users/acoliver/projects/llxprt/branch-1/llxprt-code/project-plans/20260114gmerge/NOTES.md (for any existing notes)

VERIFICATION (ALL MUST PASS):
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load zai "tell me a haiku and do nothing else"

OUTPUT:
- What was the root cause of each issue?
- What changes were made to fix it?
- Verification results (all should pass now)
```

---

## Batch-Specific Information Quick Reference

### PICK Batches

| Batch | Upstream SHAs | Key Changes |
|-------|--------------|-------------|
| 1 | 706834ec, 6e026bd9, c60d8ef5, 3e970186, 42a265d2 | @command paths, security, tests, getPackageJson |
| 2 | 82c10421, 99f75f32, 523274db, 77df6d48, 1d9e6870 | alt keys Mac, deprecated flags, error logging, memory loaders |
| 3 | c583b510, b8330b62, 7d03151c, a3370ac8, b8969cce | UI tests, line fix, messages, validate cmd, docs |
| 4 | d4cad0cd, cc081337, 54fa26ef, b382ae68, 68afb720 | JSON test, reload extensions, act tests, self-imports, compression |
| 5 | 322feaaf, ab8c24f5, f8ff921c, f875911a, 01ad74a8 | decouple telemetry, Ink fixes, docs, remove dep |
| 6 | f4ee245b, c158923b, adddafe6, 6ee7165e, d72f8453 | Ink 6.4.0, policy docs, untrusted folders, slow logging, remove jsdom |
| 7 | 4b53b3a6, 9478bca6, 8b93a5f2, f9df4153, 61207fc2 | telemetry docs, policy indexes, gitignore, release channel, string width |
| 8 | f8ce3585, caf2ca14, e3262f87, d7243fb8, 02518d29 | Ink updates, kitty keys, gitignore logic, DarkGray, flag docs |
| 9 | 9187f6f6, 462c7d35, 1ef34261, 93f14ce6, 19ea68b8 | OAuth URLs, response color, tar bump, split prompt, UI tests |
| 10 | 9d642f3b, c4377c1b, 1c044ba8, 2144d258, ad33c223 | proxy error, settings ESC, ctrl+c, token file, nav shortcuts |
| 11 | bd06e5b1, fc42c461, f0c3c81e, b5315bfc, ab730512 | vite bump, screen reader, loop detection, ghostty, MCP OAuth |
| 12 | 6ab1b239, 96d7eb29, b8b66203, 460c3deb, f7966501 | telemetry tests, flicker test, bash options, screen reader, shift+tab |
| 13 | 75c2769b, fd885a3e, ece06155 | extension tests, quota fix, shell fixes (3 commits) |

### REIMPLEMENT Batches

| Batch | SHA | Plan File | Subject |
|-------|-----|-----------|---------|
| 14 | c0495ce2 | c0495ce2-plan.md | Hook Configuration Schema |
| 15 | 5062fadf | 5062fadf-plan.md | Settings Autogeneration |
| 16 | 80673a0c | 80673a0c-plan.md | Hook Type Decoupling |
| 17 | 4fc9b1cd | 4fc9b1cd-plan.md | Alternate Buffer Support |
| 18 | b2591534 | b2591534-plan.md | Hook Input/Output Contracts |
| 19 | cb2880cb | cb2880cb-plan.md | Hook Execution Planning |
| 20 | da4fa5ad | da4fa5ad-plan.md | Extensions MCP Refactor |
| 21 | ffc5e4d0 | ffc5e4d0-plan.md | PolicyEngine to Core |

---

## After Each Batch

1. **Update PROGRESS.md**: Change batch status from TODO → DONE, add LLxprt commit hash
2. **Update NOTES.md**: Document any conflicts, deviations, or issues encountered
3. **Commit message format**:
   - PICK: `cherry-pick: upstream v0.12.0..v0.13.0 batch N`
   - REIMPLEMENT: `reimplement: <subject> (upstream <sha>)`

---

## Recovery: If Context Is Lost

1. Read this RUNGUIDE.md first
2. Check PROGRESS.md to see which batch you're on
3. Check the todo list status
4. Look at `git log --oneline -20` to see what's been committed
5. Look at `git status` to see uncommitted work
6. Resume from current batch state

---

## Commit Commands

After all verification passes:

```bash
# For PICK batches (if cherry-pick created commits already, may just need to verify)
# If manual changes were made after cherry-pick:
git add -A
git commit -m "cherry-pick: upstream v0.12.0..v0.13.0 batch N

Upstream commits:
- SHA1 subject1
- SHA2 subject2
..."

# For REIMPLEMENT batches:
git add -A
git commit -m "reimplement: <upstream subject> (upstream <sha>)

Adapted for LLxprt's:
- <specific adaptation 1>
- <specific adaptation 2>"
```

---

## Troubleshooting

### Cherry-pick conflicts
```bash
git cherry-pick --abort  # Start over
# Or resolve conflicts, then:
git add -A
git cherry-pick --continue
```

### Test failures
1. Read the error carefully
2. Find the failing test file
3. Understand what it's testing
4. Fix the code (or test if test is wrong)
5. Re-run all verification

### Build failures
1. Check TypeScript errors
2. Check import paths
3. Ensure no circular dependencies
4. Run `npm run typecheck` for details
