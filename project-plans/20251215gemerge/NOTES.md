# 20251215gemerge Implementation Notes

Keep this as a running log while executing the batches.

## Rules

- Add a **complete entry** after every batch (PICK or REIMPLEMENT).
- **EVIDENCE REQUIRED**: All records must include actual command output, not summaries.
- **NO FAKING**: Records without command output will be rejected.
- If a batch deviates from its playbook, document the reason and what was done instead.
- Always record what verification was run and whether it passed.

---

## Record Structure (Required for Every Batch)

Each batch entry MUST contain all of the following sections:

### 1. Selection Record

```
### Selection Record
Batch: NN
Type: PICK | REIMPLEMENT
Upstream SHA(s): <sha(s)>
Subject: <subject>
Playbook: <path if REIMPLEMENT, "N/A" for PICK>
Prerequisites Checked:
  - Previous batch record exists: YES | NO
  - Previous batch verification: PASS | N/A
  - Previous batch pushed: YES | N/A
  - Special dependencies: <list or "None">
Ready to Execute: YES | NO
```

### 2. Execution Record

**For PICK batches:**

```
### Execution Record (PICK)
Cherry-pick Command: git cherry-pick <sha(s)>
Conflicts: NONE | YES (list below)
  - <file>: <resolution summary>
Branding Substitutions Applied: YES | NO | N/A
Files Modified:
  - <file1>
  - <file2>
LLXPRT Commit SHA: <sha>
```

**For REIMPLEMENT batches:**

```
### Execution Record (REIMPLEMENT)
Playbook Followed: project-plans/20251215gemerge/<sha>-plan.md
Status: COMPLETED | SKIPPED (with reason)
Implementation Summary:
  - <what was implemented>
  - <LLxprt adaptations made>
Files Modified:
  - <file1>
  - <file2>
LLXPRT Commit SHA: <sha>
Commit Message: <full commit message>
```

### 3. Verification Record

```
### Verification Record
Type: QUICK | FULL
Timestamp: <ISO timestamp>

Results:
  - typecheck: PASS | FAIL
  - lint: PASS | FAIL
  - test: PASS | FAIL | SKIPPED (QUICK only)
  - build: PASS | FAIL | SKIPPED (QUICK only)
  - synthetic: PASS | FAIL | SKIPPED (QUICK only)

COMMAND OUTPUT (typecheck):
```bash
<actual npm run typecheck output>
```

COMMAND OUTPUT (lint):
```bash
<actual npm run lint output>
```

[For FULL verification only:]
COMMAND OUTPUT (test):
```bash
<actual npm run test output - last 50 lines minimum>
```

COMMAND OUTPUT (build):
```bash
<actual npm run build output - last 20 lines>
```

COMMAND OUTPUT (synthetic):
```bash
<actual node scripts/start.js --profile-load synthetic --prompt "write me a haiku" output>
```
```

### 4. Feature Landing Verification

```
### Feature Landing Verification
Upstream Commit: <sha>
Feature Description: <what the commit does>

Upstream Changes (key files):
  - <file1>: <what changed>
  - <file2>: <what changed>

LLXPRT Evidence:
```bash
# Command to show the feature landed
$ grep -n "<pattern>" <file>
<output>
```

UPSTREAM VS DOWNSTREAM COMPARISON:
```diff
# Upstream change:
+ <upstream diff snippet>

# LLXPRT equivalent:
+ <llxprt diff or grep output showing same change>
```

FEATURE VERIFIED: YES | NO
```

### 5. Commit/Push Record

```
### Commit/Push Record
Records Commit SHA: <sha>
Pushed: YES at <timestamp>
Push Output:
```bash
<actual git push output>
```
```

---

## Full Template (Copy/Paste Per Batch)

```markdown
## Batch NN — PICK|REIMPLEMENT — <sha(s)>

### Selection Record
Batch: NN
Type: PICK | REIMPLEMENT
Upstream SHA(s): <sha(s)>
Subject: <subject>
Playbook: <path | N/A>
Prerequisites Checked:
  - Previous batch record exists: YES | NO
  - Previous batch verification: PASS | N/A
  - Previous batch pushed: YES | N/A
  - Special dependencies: <list | None>
Ready to Execute: YES

### Execution Record (PICK|REIMPLEMENT)
<see format above>

### Verification Record
Type: QUICK | FULL
Timestamp: <ISO timestamp>

Results:
  - typecheck: PASS | FAIL
  - lint: PASS | FAIL
  - test: PASS | FAIL | SKIPPED
  - build: PASS | FAIL | SKIPPED
  - synthetic: PASS | FAIL | SKIPPED

COMMAND OUTPUT (typecheck):
```bash
<output>
```

COMMAND OUTPUT (lint):
```bash
<output>
```

### Feature Landing Verification
Upstream Commit: <sha>
Feature Description: <description>

LLXPRT Evidence:
```bash
<command and output>
```

FEATURE VERIFIED: YES

### Commit/Push Record
Records Commit SHA: <sha>
Pushed: YES at <timestamp>

---
```

---

## Preflight Record

Before Batch 01, document the preflight steps:

```
## Preflight — <date>

### Git Setup
```bash
$ git checkout main
<output>

$ git pull --ff-only
<output>

$ git checkout -b 20251215gemerge
<output>

$ git fetch upstream --tags
<output>

$ git status --porcelain
<output - should be empty>
```

### File Existence Check
```bash
$ for f in \
  integration-tests/test-helper.ts \
  integration-tests/file-system-interactive.test.ts \
  integration-tests/ctrl-c-exit.test.ts \
  dev-docs/integration-tests.md \
  docs/integration-tests.md \
  docs/changelogs/index.md; do
  test -f "$f" && echo "EXISTS: $f" || echo "MISSING: $f"
done
<output>
```

### Upstream Commit Verification
```bash
$ git show 8980276b --stat | head -10
<output - should show the upstream commit>
```

PREFLIGHT COMPLETE: YES
```

---

## Batch Records Start Below

<!-- Add batch records here as you complete them -->
