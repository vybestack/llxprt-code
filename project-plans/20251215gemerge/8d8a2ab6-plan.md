# Implementation Plan: 8d8a2ab6 - Deflake Documentation

## Summary of Upstream Changes

Upstream commit `8d8a2ab6` ("Fix(doc) - Add section in docs for deflaking (#10750)"):
1. Added "Deflaking a test" section to `docs/integration-tests.md`
2. Changed default `--runs` value from 50 to 5 in `scripts/deflake.js` (line 60)

## Current State in LLxprt

- `scripts/deflake.js` - Does not exist yet (will be added by Batch 03 commit `603ec2b2`)
- `dev-docs/integration-tests.md` - Exists (llxprt's equivalent of upstream docs)

**HARD DEPENDENCY:** This implementation MUST NOT proceed unless `scripts/deflake.js` exists. Batch 03 must be applied first.

## Implementation Steps

### Step 0: Hard Dependency Check (BLOCKING)

Execute this verification command. If it fails, STOP and do not proceed:

```bash
if [ ! -f /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js ]; then
  echo "FATAL ERROR: scripts/deflake.js does not exist. Apply Batch 03 first."
  exit 1
fi
echo "OK: deflake.js exists"
```

**Expected output:** `OK: deflake.js exists`
**If check fails:** Exit immediately with error message directing to apply Batch 03

### Step 1: Verify Current deflake.js Structure

Before making changes, verify the file has the expected structure:

```bash
grep -n "default: 50" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js
```

**Expected output:** Should show a line number (approximately line 60) with `default: 50,`

If this grep returns no results, the file structure differs from expectations and manual review is required.

### Step 2: Modify scripts/deflake.js

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js`

**Change location:** Within the `.option('runs', {...})` configuration block

**Edit command pattern:**
Use the Edit tool to change the default value from 50 to 5. The exact old_string to match will be:

```javascript
.option('runs', {
  type: 'number',
  default: 50,
  description: 'The number of runs to perform',
})
```

Replace with:

```javascript
.option('runs', {
  type: 'number',
  default: 5,
  description: 'The number of runs to perform',
})
```

**Verification after edit:**
```bash
grep -n "default: 5" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js | grep -q "runs" && echo "OK: default changed to 5" || echo "FAILED: default not changed"
```

### Step 3: Update dev-docs/integration-tests.md

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md`

**Insertion location:** After line 36 (after the "### Running a single test by name" section and its code block)

Current structure shows:
- Lines 29-35: "### Running a single test by name" section with code example
- Line 36: Blank line
- Line 37: Blank line
- Line 38: "### Running all tests" section begins

**Edit command pattern:**
Use the Edit tool to find this exact old_string:

```markdown
```bash
npm run test:e2e -- --test-name-pattern "reads a file"
```

### Running all tests
```

Replace with:

```markdown
```bash
npm run test:e2e -- --test-name-pattern "reads a file"
```

### Deflaking a test

Before adding a **new** integration test, you should test it at least 5 times with the deflake script to make sure that it is not flaky.

```bash
npm run deflake -- --runs=5 --command="npm run test:e2e -- --test-name-pattern '<your-new-test-name>'"
```

### Running all tests
```

**Verification after edit:**
```bash
grep -n "### Deflaking a test" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md
```

**Expected output:** Should show line number (approximately line 38) with `### Deflaking a test`

### Step 4: Verify Section Order

Confirm the documentation sections appear in the correct order:

```bash
grep -n "^### " /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md | head -6
```

**Expected output should show this order:**
```
29:### Running a single test by name
38:### Deflaking a test
45:### Running all tests
47:### Sandbox matrix
```

(Line numbers may vary slightly but order must be: "Running a single test by name" → "Deflaking a test" → "Running all tests")

## Files to Modify

| File | Change | Verification Command |
|------|--------|---------------------|
| `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js` | Change default runs from 50 to 5 (line ~60) | `grep "default: 5" scripts/deflake.js \| grep runs` |
| `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md` | Add "Deflaking a test" section after line 36 | `grep -n "### Deflaking a test" dev-docs/integration-tests.md` |

## Acceptance Criteria (Testable)

All of these commands MUST succeed for the implementation to be considered complete:

### AC1: deflake.js exists
```bash
test -f /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js && echo "PASS" || echo "FAIL"
```

### AC2: Default runs changed to 5
```bash
grep -q "default: 5" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js && \
grep "default: 5" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js | grep -q "runs" && \
echo "PASS: default runs = 5" || echo "FAIL: default not 5"
```

### AC3: Help text shows default runs=5
```bash
node /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js --help 2>&1 | grep -q "default: 5" && \
echo "PASS: help shows default 5" || echo "FAIL: help does not show default 5"
```

### AC4: Deflaking section exists in docs
```bash
grep -q "### Deflaking a test" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md && \
echo "PASS: section exists" || echo "FAIL: section missing"
```

### AC5: Deflaking section contains deflake command
```bash
grep -q "npm run deflake" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md && \
echo "PASS: deflake command documented" || echo "FAIL: deflake command missing"
```

### AC6: Deflaking section contains runs=5 example
```bash
grep -q "runs=5" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md && \
echo "PASS: runs=5 in example" || echo "FAIL: runs=5 not in example"
```

### AC7: No default: 50 remains in deflake.js
```bash
! grep -q "default: 50" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js && \
echo "PASS: no default 50 found" || echo "FAIL: default 50 still exists"
```

## Success Criteria Summary

Run this comprehensive verification script:

```bash
#!/bin/bash
FAILED=0

# AC1
test -f /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js || FAILED=1

# AC2
grep -q "default: 5" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js || FAILED=1

# AC3
node /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js --help 2>&1 | grep -q "default: 5" || FAILED=1

# AC4
grep -q "### Deflaking a test" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md || FAILED=1

# AC5
grep -q "npm run deflake" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md || FAILED=1

# AC6
grep -q "runs=5" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md || FAILED=1

# AC7
! grep -q "default: 50" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/scripts/deflake.js || FAILED=1

if [ $FAILED -eq 0 ]; then
  echo "ALL ACCEPTANCE CRITERIA PASSED"
  exit 0
else
  echo "ACCEPTANCE CRITERIA FAILED"
  exit 1
fi
```

**Expected final result:** `ALL ACCEPTANCE CRITERIA PASSED`

## Notes for Automated Agent

1. **STOP if deflake.js doesn't exist** - This is a hard blocker
2. **Read files first** - Use Read tool on both files before making Edit calls
3. **Exact string matching** - The Edit tool requires exact old_string matches including whitespace
4. **Include context** - The old_string should include surrounding lines for uniqueness
5. **Verify after each edit** - Run the grep verification commands after each change
6. **Final verification** - Run all AC tests before declaring success
