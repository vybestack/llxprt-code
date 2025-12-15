# Subagent Workflow for 20251215gemerge

This document defines the subagent-based execution workflow for the gemini-cli v0.9.0 to v0.10.0 merge.

---

## Available Subagent Types

These are the actual subagent types available for this workflow:

| Subagent Type | Model | Use For |
|---------------|-------|---------|
| `general-purpose` | sonnet | Batch selection, prerequisite checking, research |
| `llxprt-cherrypicker` | opus | Cherry-picking commits from upstream, conflict resolution during cherry-pick |
| `llxprt-conflict-merger` | sonnet | Resolving merge conflicts after cherry-pick |
| `typescript-master-coder` | opus | Reimplementing features (REIMPLEMENT batches) - complex playbooks |
| `typescript-coder` | sonnet | Simple code changes (fallback for simple batches) |
| `typescript-code-reviewer` | sonnet | Code review, verification of changes |
| `integration-tester` | sonnet | Running full test suite, integration testing |
| `Explore` | sonnet | Quick codebase exploration, finding files |

**Remediation Subagent** (used when verification fails):
| `typescript-coder` | sonnet | Remediation - fixing test failures, lint errors, type errors |

---

## Subagent Role Mapping

### 1. Picker Role → `general-purpose`

**Purpose**: Select and prepare the next batch for execution.

**Invoke with**:
```
Task(
  subagent_type="general-purpose",
  description="Select batch NN",
  prompt="Read PROGRESS.md and select the next uncompleted batch..."
)
```

**Responsibilities**:

- Read `PROGRESS.md` to identify the next uncompleted batch
- Verify prerequisites are met (prior phase records exist and are valid)
- If prerequisites missing, report back (orchestrator invokes Researcher)
- Output the batch details and cherry-pick/reimplement instructions

**Output Required**:

```
BATCH SELECTION RECORD
======================
Batch: NN
Type: PICK | REIMPLEMENT
Upstream SHA(s): <sha(s)>
Subject: <subject>
Playbook: <path if REIMPLEMENT>
Prerequisites Met: YES | NO (with missing items listed)
Ready to Execute: YES | NO
```

---

### 2. Merger Role → `llxprt-cherrypicker`

**Purpose**: Execute cherry-pick and resolve conflicts.

**Invoke with**:
```
Task(
  subagent_type="llxprt-cherrypicker",
  description="Cherry-pick batch NN",
  prompt="Cherry-pick upstream commits <sha(s)> following the plan..."
)
```

**Responsibilities**:

- Execute the cherry-pick command(s)
- Resolve any conflicts following `Non-Negotiables (LLxprt Invariants)` in PLAN.md
- Apply branding substitutions per PLAN.md
- Run quick verification after resolution
- Create the batch commit

**Output Required**:

```
MERGE EXECUTION RECORD
======================
Batch: NN
Upstream SHA(s): <sha(s)>
LLXPRT Commit SHA: <resulting commit sha>
Conflicts Resolved: YES | NO | NONE
Conflict Files:
  - <file>: <resolution summary>
Branding Applied: YES | NO
Files Modified:
  - <list of files changed>
Quick Verification: PASS | FAIL
  - typecheck: PASS | FAIL
  - lint: PASS | FAIL

COMMAND OUTPUT (typecheck):
```bash
<actual npm run typecheck output>
```

COMMAND OUTPUT (lint):
```bash
<actual npm run lint output>
```
```

**For complex conflicts**, use `llxprt-conflict-merger`:
```
Task(
  subagent_type="llxprt-conflict-merger",
  description="Resolve conflicts in batch NN",
  prompt="Resolve the merge conflicts in <files> preserving LLxprt's multi-provider architecture..."
)
```

---

### 3. Implementer Role → `typescript-master-coder`

**Purpose**: Manually port upstream changes following the playbook.

**Invoke with**:
```
Task(
  subagent_type="typescript-master-coder",
  description="Reimplement batch NN",
  prompt="Follow the playbook at project-plans/20251215gemerge/<sha>-plan.md to reimplement..."
)
```

**Responsibilities**:

- Read the per-commit playbook (`<sha>-plan.md`)
- Implement the changes following playbook instructions
- Apply LLxprt adaptations per `Non-Negotiables`
- Apply branding substitutions
- Create a single commit with proper message format

**Output Required**:

```
REIMPLEMENTATION EXECUTION RECORD
=================================
Batch: NN
Upstream SHA: <sha>
Playbook: project-plans/20251215gemerge/<sha>-plan.md
LLXPRT Commit SHA: <resulting commit sha>
Status: COMPLETED | SKIPPED (with reason)

Implementation Summary:
- <what was implemented>
- <LLxprt adaptations made>

Files Modified:
- <list of files changed>

UPSTREAM DIFF ANALYSIS:
Files Changed Upstream:
- <file1>
- <file2>

Corresponding LLXPRT Changes:
- <file1>: <what changed and why>
- <file2>: <what changed and why>
- <fileN>: SKIPPED - <reason if not ported>

Feature Verification:
- Feature: <description of feature from commit subject>
- Evidence: <how we verified the feature landed>
```

---

### 4. Verifier Role → `integration-tester` + `typescript-code-reviewer`

**Purpose**: Run full verification suite and confirm feature landed.

**Invoke with** (for running tests):
```
Task(
  subagent_type="integration-tester",
  description="Verify batch NN",
  prompt="Run the full verification suite for batch NN: test, lint, typecheck, build, synthetic..."
)
```

**Invoke with** (for code review):
```
Task(
  subagent_type="typescript-code-reviewer",
  description="Review batch NN changes",
  prompt="Review the changes from batch NN for compliance with LLxprt standards..."
)
```

**Responsibilities**:

- Run the complete verification suite:
  - `npm run test`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic --prompt "write me a haiku"`
- Verify the actual feature from the batch landed (not just that tests pass)
- Compare upstream diff vs downstream diff to confirm code landed
- Generate evidence record

**Verification Commands** (run in order):

```bash
# 1. Kill any running vitest instances first
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true

# 2. Run tests
npm run test

# 3. Kill vitest again (cleanup)
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true

# 4. Run lint
npm run lint

# 5. Run typecheck
npm run typecheck

# 6. Run build
npm run build

# 7. Run synthetic test
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

**Output Required**:

```
VERIFICATION RECORD
===================
Batch: NN
Verification Type: QUICK | FULL
Timestamp: <ISO timestamp>

TEST RESULTS:
- test: PASS | FAIL
- lint: PASS | FAIL
- typecheck: PASS | FAIL
- build: PASS | FAIL
- synthetic: PASS | FAIL

COMMAND OUTPUT (test):
```bash
<actual npm run test output - last 50 lines minimum>
```

COMMAND OUTPUT (lint):
```bash
<actual npm run lint output>
```

COMMAND OUTPUT (typecheck):
```bash
<actual npm run typecheck output>
```

COMMAND OUTPUT (build):
```bash
<actual npm run build output - last 20 lines>
```

COMMAND OUTPUT (synthetic):
```bash
<actual synthetic test output>
```

FEATURE LANDING VERIFICATION:
Upstream Commit: <sha>
Subject: <subject>
Feature Description: <what the commit does>
Evidence Code Landed:
- File: <file path>
- Expected Change: <what should be different>
- Actual Change: <evidence from grep/read showing the change exists>

UPSTREAM VS DOWNSTREAM DIFF COMPARISON:
```diff
# Key changes from upstream commit:
<relevant diff from upstream>

# Corresponding changes in LLXPRT:
<grep/read output showing the same changes exist in our codebase>
```

VERIFICATION RESULT: PASS | FAIL
Failure Reasons (if any):
- <reason 1>
- <reason 2>
```

---

### 5. Researcher Role → `general-purpose` or `Explore`

**Purpose**: Fill in missing prerequisite records when prior phases are incomplete.

**Invoke with** (for detailed investigation):
```
Task(
  subagent_type="general-purpose",
  description="Research batch NN",
  prompt="Investigate what was done in batch NN. Check git log, verify commits exist..."
)
```

**Invoke with** (for quick file searches):
```
Task(
  subagent_type="Explore",
  description="Find batch NN evidence",
  prompt="Search the codebase for evidence that batch NN feature landed..."
)
```

**Responsibilities**:

- Investigate what was done in previous batches
- Verify commits exist via git log
- Check that features landed via code inspection
- Generate missing batch records based on evidence

**Output Required**:

```
RESEARCH RECORD
===============
Missing Prerequisite: Batch NN record
Investigation:
- Git commit found: <sha> at <date>
- Commit message: <message>
- Files changed: <list>
- Feature verified: YES | NO

Reconstructed Record:
<full batch record in appropriate format>
```

---

### 6. Remediation Role → `typescript-coder`

**Purpose**: Fix verification failures (test failures, lint errors, type errors).

**MANDATORY INVOCATION**: When Verifier reports ANY failure, Remediation MUST be invoked. No exceptions.

**Invoke with**:
```
Task(
  subagent_type="typescript-coder",
  description="Remediate batch NN failures",
  prompt="Fix the following verification failures from batch NN:

FAILURES:
<paste exact failure output from Verifier>

REQUIREMENTS:
1. Root-cause each failure
2. Fix all failures - not 'some' or 'most' - ALL
3. Run verification after each fix to confirm
4. Do NOT declare done until ALL checks pass
5. Commit fixes with message: 'fix: <description> addresses #707'

VERIFICATION COMMANDS TO RUN AFTER FIXING:
npm run typecheck
npm run lint
npm run test
npm run build
node scripts/start.js --profile-load synthetic --prompt 'write me a haiku'

OUTPUT: Full verification output showing ALL PASS."
)
```

**Responsibilities**:

- Analyze the exact failure messages
- Root-cause WHY the failure occurred (not just patch symptoms)
- Fix all failures completely
- Re-run verification to confirm fixes
- Commit the fixes with proper message format
- Only report success when ALL checks pass

**Output Required**:

```
REMEDIATION RECORD
==================
Batch: NN
Failures Received:
  - test: FAIL (N tests failing)
  - lint: FAIL (N errors)
  - typecheck: FAIL (N errors)

Root Cause Analysis:
- Failure 1: <exact error> caused by <root cause>
- Failure 2: <exact error> caused by <root cause>

Fixes Applied:
- File: <path>
  - Line: <line number>
  - Change: <what was changed and why>

Verification After Fix:
- typecheck: PASS | FAIL
- lint: PASS | FAIL
- test: PASS | FAIL
- build: PASS | FAIL
- synthetic: PASS | FAIL

COMMAND OUTPUT (all verification):
```bash
<actual full verification output>
```

Fix Commit SHA: <sha>
Commit Message: <message>

REMEDIATION RESULT: SUCCESS | NEEDS_MORE_WORK
```

**CRITICAL RULES FOR REMEDIATION**:

1. **Never declare partial success** - "5 of 6 tests pass" is FAILURE
2. **Never skip verification** - Must run ALL checks after fixing
3. **Never guess at fixes** - Root-cause first, then fix
4. **Loop until green** - If re-verification fails, fix again
5. **Include full output** - No summarizing, actual terminal output required

---

## Workflow Phases

### Phase 1: Batch Selection

```
Orchestrator → general-purpose (Picker role)
  Input: Current progress state
  Output: Batch selection record

If prerequisites missing:
  Orchestrator → general-purpose or Explore (Researcher role)
    Input: Missing prerequisite details
    Output: Research record filling the gap
```

### Phase 2: Batch Execution

**For PICK batches:**

```
Orchestrator → llxprt-cherrypicker (Merger role)
  Input: Batch selection record
  Output: Merge execution record

If complex conflicts:
  Orchestrator → llxprt-conflict-merger
    Input: Conflict details
    Output: Resolved conflicts
```

**For REIMPLEMENT batches:**

```
Orchestrator → typescript-master-coder (Implementer role)
  Input: Batch selection record + playbook path
  Output: Reimplementation execution record
```

### Phase 3: Verification

**After every batch (Quick Verification):**

```
Orchestrator → integration-tester (Verifier role)
  Input: Batch number, verification type = QUICK
  Output: Verification record (typecheck + lint only)
```

**After every 2nd batch (Full Verification):**

```
Orchestrator → integration-tester (Verifier role)
  Input: Batch number, verification type = FULL
  Output: Full verification record (all checks + feature landing)

Optionally also:
Orchestrator → typescript-code-reviewer
  Input: Batch changes
  Output: Code quality review
```

### Phase 4: Commit/Push

After each batch completes verification:

1. Update `PROGRESS.md` (check off batch)
2. Append batch record to `NOTES.md`
3. Commit the batch records
4. Push to remote

```bash
git add project-plans/20251215gemerge/
git commit -S -m "docs: batch NN execution record"
git push
```

---

## Record Storage

All batch execution records are stored in `NOTES.md` with the following structure:

```markdown
## Batch NN - <TYPE> - <sha(s)>

### Selection Record
<picker output>

### Execution Record
<merger or implementer output>

### Verification Record
<verifier output>

### Commit/Push
- LLXPRT Branch Commit: <sha>
- Pushed: YES at <timestamp>
```

---

## Prerequisites Chain

Each phase requires records from the previous phase:

| Current Phase | Required Prerequisites |
|---------------|----------------------|
| Batch 01 | Preflight checklist complete |
| Batch N (N>1) | Batch N-1 verification PASS + commit/push complete |
| REIMPLEMENT | Per-commit playbook exists |

If prerequisites are not met:

1. Picker Subagent detects the gap
2. Researcher Subagent investigates and fills the gap
3. Only then can the batch proceed

---

## Verification Cadence

| Batch | Verification Type | Checks |
|-------|------------------|--------|
| Odd batches | QUICK | typecheck, lint |
| Even batches | FULL | test, lint, typecheck, build, synthetic |
| Docs-only | FORMAT ONLY | prettier on touched files |

**Exception**: Any batch with `FULL` in the schedule table (PLAN.md) always gets full verification regardless of odd/even.

---

## Evidence Requirements

All records MUST include:

1. **Actual command output** - Copy/pasted from terminal, not summarized
2. **Timestamps** - When commands were run
3. **SHA references** - Both upstream and LLXPRT commit hashes
4. **Diff evidence** - For feature landing verification:
   - Show the upstream diff (what changed)
   - Show grep/read output proving the same change exists in LLXPRT

**No faking allowed**: Records without actual command output will be rejected and must be regenerated.

---

## Failure Handling

### Verification Failure — MANDATORY REMEDIATION LOOP

**THIS IS NOT OPTIONAL. Any verification failure triggers this loop.**

```
┌─────────────────────────────────────────────────────────────────┐
│                    VERIFICATION FAILURE LOOP                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Verifier runs → ANY FAIL?                                       │
│       │                                                          │
│       ├── NO → Proceed to commit/push                            │
│       │                                                          │
│       └── YES → MANDATORY: Invoke Remediation Subagent           │
│                     │                                            │
│                     ▼                                            │
│             Remediation fixes failures                           │
│                     │                                            │
│                     ▼                                            │
│             Remediation runs full verification                   │
│                     │                                            │
│                     ├── ALL PASS? → Continue to commit/push      │
│                     │                                            │
│                     └── STILL FAILING? → Loop (max 3 attempts)   │
│                                   │                              │
│                                   └── After 3 attempts → STOP    │
│                                         Request human review     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Failure Response Steps:**

1. **STOP** - Do not proceed to next batch
2. **LOG** - Full command output showing exact failures
3. **INVOKE** - Remediation Subagent with exact failure messages
4. **FIX** - Remediation fixes all issues, runs verification
5. **LOOP** - If still failing, repeat (max 3 attempts)
6. **ESCALATE** - After 3 failed attempts, stop and request human review

**NEVER DO:**
- ❌ Skip verification steps
- ❌ Declare "mostly passing" as success
- ❌ Proceed to next batch with failures
- ❌ Commit with failing tests
- ❌ Summarize failure output instead of including actual output

**ALWAYS DO:**
- ✅ Run ALL verification steps (test, lint, typecheck, build, synthetic)
- ✅ Include full command output in records
- ✅ Invoke Remediation on ANY failure
- ✅ Re-verify after Remediation fixes
- ✅ Only proceed when ALL checks pass

### Prerequisite Missing

1. Invoke Researcher Subagent
2. Researcher must provide evidence the batch was completed
3. If evidence cannot be found, the batch must be re-executed

### Cherry-pick Conflict

1. Merger Subagent resolves following Non-Negotiables
2. If uncertain, log the conflict and request human review
3. Never silently drop changes

---

## Parallelization Opportunities

While batches MUST complete sequentially (Batch N before Batch N+1), some subagent work can overlap:

### Safe to Parallelize

1. **Picker can run ahead**: While Batch N is in verification, Picker can select Batch N+1 and verify its prerequisites
2. **Researcher is independent**: If Picker detects missing records for an earlier batch, Researcher can investigate in parallel with ongoing work
3. **Human review overlaps with Picker**: While human reviews verification results, Picker prepares next batch

### Never Overlap

- Two Merger/Implementer subagents (only one batch execution at a time)
- Two Verifier subagents (verify current batch before starting next)
- Commit/push of Batch N while Batch N+1 is executing

### Parallel Execution Pattern

```
Time →
Batch N:  [Execution] [Verification] [Commit/Push]
Batch N+1:            [Picker]       [Execution] [Verification] [Commit/Push]
```

The Picker for Batch N+1 can start as soon as Batch N enters verification, since:
- Picker only reads files (no conflicts with Verifier running tests)
- Prerequisites check uses previous batch's record (which exists before verification)
- Picker output is held until Batch N commits/pushes
