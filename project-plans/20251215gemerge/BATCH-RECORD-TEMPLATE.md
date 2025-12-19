# Batch Record Template

This file contains ready-to-copy templates for subagents executing batches.

---

## PICK Batch Template

```markdown
## Batch NN — PICK — <sha(s)>

### Selection Record
Batch: NN
Type: PICK
Upstream SHA(s): <sha(s)>
Subject: <subject>
Playbook: N/A
Prerequisites Checked:
  - Previous batch record exists: YES
  - Previous batch verification: PASS
  - Previous batch pushed: YES
  - Special dependencies: None
Ready to Execute: YES

### Execution Record (PICK)
Cherry-pick Command: git cherry-pick <sha(s)>
Conflicts: NONE
Branding Substitutions Applied: NO
Files Modified:
  - <file1>
  - <file2>
LLXPRT Commit SHA: <sha>

### Verification Record
Type: QUICK
Timestamp: 2025-12-15T00:00:00Z

Results:
  - typecheck: PASS
  - lint: PASS
  - test: SKIPPED
  - build: SKIPPED
  - synthetic: SKIPPED

COMMAND OUTPUT (typecheck):
```bash
$ npm run typecheck

> @vybestack/llxprt-code@0.6.1 typecheck
> tsc --noEmit

<output>
```

COMMAND OUTPUT (lint):
```bash
$ npm run lint

> @vybestack/llxprt-code@0.6.1 lint
> eslint .

<output>
```

### Feature Landing Verification
Upstream Commit: <sha>
Feature Description: <what the commit does>

Upstream Changes (key files):
  - <file1>: <what changed>

LLXPRT Evidence:
```bash
$ git show HEAD --stat
<output showing files changed>

$ grep -n "<key pattern>" <file>
<output showing the feature landed>
```

UPSTREAM VS DOWNSTREAM COMPARISON:
```diff
# Key upstream change:
+ <code from upstream>

# Same code now in LLXPRT:
$ grep -A2 "<pattern>" <file>
<output>
```

FEATURE VERIFIED: YES

### Commit/Push Record
Records Commit SHA: <sha>
Pushed: YES at 2025-12-15T00:00:00Z
Push Output:
```bash
$ git push
<output>
```

---
```

---

## REIMPLEMENT Batch Template

```markdown
## Batch NN — REIMPLEMENT — <sha>

### Selection Record
Batch: NN
Type: REIMPLEMENT
Upstream SHA(s): <sha>
Subject: <subject>
Playbook: project-plans/20251215gemerge/<sha>-plan.md
Prerequisites Checked:
  - Previous batch record exists: YES
  - Previous batch verification: PASS
  - Previous batch pushed: YES
  - Special dependencies: None
Ready to Execute: YES

### Execution Record (REIMPLEMENT)
Playbook Followed: project-plans/20251215gemerge/<sha>-plan.md
Status: COMPLETED
Implementation Summary:
  - <what was implemented>
  - <LLxprt adaptations made>
Files Modified:
  - <file1>
  - <file2>
LLXPRT Commit SHA: <sha>
Commit Message:
```
reimplement: <subject> (upstream <shortsha>)

Upstream: <full sha>
LLXPRT adaptations:
- <adaptation 1>
- <adaptation 2>
```

### Verification Record
Type: FULL
Timestamp: 2025-12-15T00:00:00Z

Results:
  - typecheck: PASS
  - lint: PASS
  - test: PASS
  - build: PASS
  - synthetic: PASS

COMMAND OUTPUT (typecheck):
```bash
$ npm run typecheck

> @vybestack/llxprt-code@0.6.1 typecheck
> tsc --noEmit

<output>
```

COMMAND OUTPUT (lint):
```bash
$ npm run lint

> @vybestack/llxprt-code@0.6.1 lint
> eslint .

<output>
```

COMMAND OUTPUT (test):
```bash
$ ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true
$ npm run test

> @vybestack/llxprt-code@0.6.1 test
> vitest run

<last 50+ lines of output>
```

COMMAND OUTPUT (build):
```bash
$ npm run build

> @vybestack/llxprt-code@0.6.1 build
> npm run build --workspaces --if-present

<last 20+ lines of output>
```

COMMAND OUTPUT (synthetic):
```bash
$ node scripts/start.js --profile-load synthetic --prompt "write me a haiku"

<output>
```

### Feature Landing Verification
Upstream Commit: <sha>
Feature Description: <what the commit does>

Upstream Changes (key files):
  - <file1>: <what changed>
  - <file2>: <what changed>

LLXPRT Evidence:
```bash
$ ls -la <new-file-if-any>
<output>

$ grep -n "<key pattern>" <file>
<output showing the feature landed>

$ head -20 <file>
<output showing implementation>
```

UPSTREAM VS DOWNSTREAM COMPARISON:
```diff
# Upstream adds this:
+ export function newFeature() {
+   // implementation
+ }

# LLXPRT now has:
$ grep -A5 "newFeature" <file>
export function newFeature() {
  // llxprt implementation (adapted for multi-provider)
}
```

FEATURE VERIFIED: YES

### Commit/Push Record
Records Commit SHA: <sha>
Pushed: YES at 2025-12-15T00:00:00Z
Push Output:
```bash
$ git push
<output>
```

---
```

---

## SKIPPED Batch Template (for NO-OP batches)

```markdown
## Batch NN — REIMPLEMENT — <sha>

### Selection Record
Batch: NN
Type: REIMPLEMENT
Upstream SHA(s): <sha>
Subject: <subject>
Playbook: project-plans/20251215gemerge/<sha>-plan.md
Prerequisites Checked:
  - Previous batch record exists: YES
  - Previous batch verification: PASS
  - Previous batch pushed: YES
  - Special dependencies: None
Ready to Execute: YES

### Execution Record (REIMPLEMENT)
Playbook Followed: project-plans/20251215gemerge/<sha>-plan.md
Status: SKIPPED
Skip Reason: <reason - e.g., "Already covered by Batch XX", "Target file does not exist">
LLXPRT Commit SHA: <sha of empty commit>
Commit Message:
```
reimplement: <subject> (upstream <shortsha>)

Upstream: <full sha>
SKIPPED: <reason>
```

### Verification Record
Type: QUICK
Timestamp: 2025-12-15T00:00:00Z

Results:
  - typecheck: PASS
  - lint: PASS
  - test: SKIPPED
  - build: SKIPPED
  - synthetic: SKIPPED

COMMAND OUTPUT (typecheck):
```bash
$ npm run typecheck
<output>
```

COMMAND OUTPUT (lint):
```bash
$ npm run lint
<output>
```

### Feature Landing Verification
Upstream Commit: <sha>
Feature Description: <what the commit does>

Skip Justification:
- <reason why this is a valid skip>
- <evidence that the functionality is already present or not needed>

Evidence:
```bash
$ <command showing the functionality already exists or is not applicable>
<output>
```

FEATURE VERIFIED: YES (via skip justification)

### Commit/Push Record
Records Commit SHA: <sha>
Pushed: YES at 2025-12-15T00:00:00Z

---
```

---

## Full Verification Commands

Copy this block for FULL verification batches:

```bash
# Kill any stale vitest
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true

# Run test
npm run test

# Kill vitest after tests
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs -r kill -9 2>/dev/null || true

# Run lint
npm run lint

# Run typecheck
npm run typecheck

# Run build
npm run build

# Run synthetic test
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

---

## Quick Verification Commands

Copy this block for QUICK verification batches:

```bash
# Run typecheck
npm run typecheck

# Run lint
npm run lint
```

---

## Commit/Push Commands

After verification passes:

```bash
# Stage tracking files
git add project-plans/20251215gemerge/PROGRESS.md
git add project-plans/20251215gemerge/NOTES.md

# Commit with signing (NO CLAUDE SIGNATURE)
git commit -S -m "docs: batch NN execution record"

# Push
git push
```
