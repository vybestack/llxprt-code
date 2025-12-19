# Implementation Plan: bd6bba8d - Deflake Command Doc Fix

## Summary of Upstream Changes

Upstream commit `bd6bba8d` ("fix(doc) - Update doc for deflake command (#10829)"):
- Fixes the deflake command example in `docs/integration-tests.md`
- Adds an extra `--` before `--test-name-pattern` for proper npm argument forwarding through the nested command structure
- This change applies to the "Deflaking a test" section added in Batch 05 (commit `8d8a2ab6`)

## Current State in LLxprt

- `dev-docs/integration-tests.md` exists (llxprt's equivalent of upstream `docs/integration-tests.md`)
- The deflake section should exist after Batch 05 (commit `8d8a2ab6`) is applied
- This fix updates the command syntax in that section

## Prerequisites

**DEPENDENCY:** This plan depends on Batch 05 (commit `8d8a2ab6`) being applied first.

**When executing this plan:**
1. First verify the prerequisite is met by checking for the deflake section
2. If the section doesn't exist, apply Batch 05 (8d8a2ab6) before executing this plan
3. Once the prerequisite is met, proceed with the implementation steps below

### Prerequisite Verification

Before starting implementation, verify the deflake section exists:

```bash
grep -q "Deflaking a test" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md && echo "✓ Prerequisite met: Deflake section exists" || echo "⚠ Apply Batch 05 (8d8a2ab6) first, then return to this plan"
```

## Implementation Steps

### Step 1: Locate the Deflake Section

The "Deflaking a test" section should exist in `dev-docs/integration-tests.md`. Confirm its location:

```bash
grep -n "Deflaking a test" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md
```

**Expected Output:** Line number where the section begins (e.g., `36:### Deflaking a test`)

### Step 2: Apply the Double Dash Fix

**File:** `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md`

**Change Description:** Add an extra `--` before `--test-name-pattern` in the deflake command example.

**Context:** This change occurs in the code block within the "Deflaking a test" section, typically appearing after the "Running a single test by name" section.

**Exact Before Text:**
```bash
npm run deflake -- --runs=5 --command="npm run test:e2e -- --test-name-pattern '<your-new-test-name>'"
```

**Exact After Text:**
```bash
npm run deflake -- --runs=5 --command="npm run test:e2e -- -- --test-name-pattern '<your-new-test-name>'"
```

**Why This Change:** The extra `--` is needed because:
1. First `--` terminates `npm run test:e2e` arguments
2. Second `--` passes through to the underlying vitest command
3. This matches how npm scripts forward arguments through nested command invocations

**Line Number Range:** The deflake section should appear after line 35 (after "Running a single test by name" section). The exact line number depends on where Batch 05 inserted it, but it should be within the "Running a specific set of tests" area of the document.

**Search Pattern to Find Exact Location:**
```bash
grep -n "npm run deflake" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md
```

### Step 3: Verify the Change

**Command:**
```bash
grep "npm run deflake.*-- -- --test-name-pattern" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md
```

**Expected Output:** The full command line with double `--` before `--test-name-pattern`

## Files to Modify

| File | Line(s) | Change |
|------|---------|--------|
| `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md` | Within "Deflaking a test" section (search for `npm run deflake`) | Add extra `--` before `--test-name-pattern` in deflake command example |

## Dependencies

- **Depends on:** Batch 05 (commit `8d8a2ab6`) - Must be applied first to add the deflake section
- **Required by:** None (this is a documentation fix)

## Acceptance Criteria

All criteria must pass:

- [ ] **Prerequisite Check Passes:**
  ```bash
  grep -q "Deflaking a test" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md && echo "PASS" || echo "FAIL"
  ```
  Expected: `PASS`

- [ ] **Double Dash Present:**
  ```bash
  grep -q "npm run deflake.*-- -- --test-name-pattern" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md && echo "PASS" || echo "FAIL"
  ```
  Expected: `PASS`

- [ ] **Old Single Dash Pattern Removed:**
  ```bash
  grep "npm run deflake.*--runs=5.*-- --test-name-pattern" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md | grep -v "-- --" && echo "FAIL: Old pattern still exists" || echo "PASS"
  ```
  Expected: `PASS`

- [ ] **File Formatted and Valid:**
  ```bash
  test -f /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/dev-docs/integration-tests.md && echo "PASS" || echo "FAIL"
  ```
  Expected: `PASS`

## Testing

This is a documentation-only change. No code changes or build/test cycle required.

Verify that the command example is correct by manually inspecting the documentation.

## Rollback

If this change needs to be reverted, simply restore the single `--` version:

```bash
npm run deflake -- --runs=5 --command="npm run test:e2e -- --test-name-pattern '<your-new-test-name>'"
```

## Notes

- This is a minor documentation fix to correct argument forwarding syntax
- The change only affects documentation, not code behavior
- Batch number reference: This is Batch 12 in the 0.9.0→0.10.0 merge plan
- Related batch: Batch 05 (8d8a2ab6) added the original deflake documentation
- **Execution note:** This plan is valid and executable once its prerequisite (8d8a2ab6) is met
