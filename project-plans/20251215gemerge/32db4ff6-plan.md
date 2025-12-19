# Implementation Plan: 32db4ff6 - Disable Flaky Tests

## Upstream Commit Summary

**Commit:** `32db4ff66d041a66321d2212b4b8ce6241842bb7`
**Date:** 2025-10-10
**Subject:** Disable flakey tests. (#10914)
**Files Modified:**
1. `integration-tests/file-system-interactive.test.ts` - Added `describe.skip()`
2. `integration-tests/replace.test.ts` - Added `describe.skip()`

## Current State Verification

### Files That Exist in LLxprt
- ✅ `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/replace.test.ts`
- ✅ `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/file-system.test.ts`

### Files That Do NOT Exist in LLxprt
- ❌ `integration-tests/file-system-interactive.test.ts` (upstream only)

### Current Skip Status in LLxprt

**replace.test.ts:**
- Line 11: `it.skip('should be able to replace content in a file', ...)` ← ONE test skipped
- Lines 65-93: `it('should handle $ literally when replacing text ending with $', ...)` ← ENABLED
- Lines 95-179: `it('should fail safely when old_string is not found', ...)` ← ENABLED
- Lines 181-205: `it('should insert a multi-line block of text', ...)` ← ENABLED
- Lines 207-236: `it('should delete a block of text', ...)` ← ENABLED

**Test Suite Status:** `describe('replace', ...)` is ENABLED (not skipped at suite level)

### Relevant GitHub Issues
- Issue #11598: "Fix flakey tests in replace.test" (OPEN)
- Issue #11707: "Fix flaky file-system.test.ts: should replace multiple instances of a string" (OPEN)

### LLxprt Git History Context

The upstream commit `32db4ff66` already exists in LLxprt's history. After it was applied:

1. **32db4ff66** (2025-10-10): Upstream added `describe.skip('replace')` to disable entire suite
2. **f56a561f0** (2025-10-13): Upstream fixed and unskipped the first test, re-enabled suite
3. **769fe8b16** (2025-10-14): Upstream deleted "should fail safely when old_string is not found" test, re-enabled suite
4. **2bb64333e** (LLxprt): We improved robustness of the flaky test (#725)
5. **40e85927b** (LLxprt): We prevented LLM from bypassing replace test with write_file tool
6. **653b3e1e7** (LLxprt): We refactored to use beforeEach/afterEach for reliable cleanup

**Conclusion:** LLxprt has already diverged significantly from upstream's approach. We have one test skipped with improvements to the others.

## LLxprt Policy on Test Skipping

**NEVER blindly copy upstream skips.** Each skip must be justified for LLxprt's codebase.

## Decision Criteria

### When to Skip a Test
1. **Pass rate < 80%** over 10 consecutive runs in clean environment
2. **Unfixable timing issues** despite multiple remediation attempts
3. **Test depends on removed features** (N/A for this commit)
4. **Documented GitHub issue** tracking the flakiness

### When NOT to Skip a Test
1. Test passes reliably (≥95% pass rate)
2. Test has been recently fixed/improved
3. Test validates critical functionality
4. No GitHub issue documenting the problem

## Implementation Steps

### Step 1: Verify Current Test Status (MANDATORY)

Before making ANY changes, run the replace.test.ts suite 10 times to establish baseline:

```bash
# Kill any existing vitest instances
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs -r kill -9

# Run tests 10 times and capture results
for i in {1..10}; do
  echo "=== Run $i ===" >> replace-test-results.log
  npm test -- integration-tests/replace.test.ts 2>&1 | tee -a replace-test-results.log
  echo "" >> replace-test-results.log
done

# Kill any leftover vitest instances
ps -ef | grep -i vitest | grep -v grep | awk '{print $2}' | xargs -r kill -9
```

### Step 2: Analyze Results

Calculate pass rate for each test:
- `it.skip('should be able to replace content in a file')` - Already skipped, issue #11598
- `it('should handle $ literally when replacing text ending with $')` - Count passes/failures
- `it('should fail safely when old_string is not found')` - Count passes/failures
- `it('should insert a multi-line block of text')` - Count passes/failures
- `it('should delete a block of text')` - Count passes/failures

### Step 3: Make Targeted Decisions

For each test:

**IF pass rate ≥ 95%:**
- ✅ Keep test ENABLED
- ✅ No changes needed

**IF pass rate 80-94%:**
- ⚠️ Keep test ENABLED
- 📝 Add comment documenting intermittent flakiness
- 🐛 Update or create GitHub issue with pass rate data
- 🔍 Consider additional stabilization improvements

**IF pass rate < 80%:**
- ❌ Add `it.skip()` to the specific test
- 📝 Add comment with issue number and pass rate
- 🐛 Ensure GitHub issue exists and is updated
- 📋 Document in this plan why the skip is necessary

### Step 4: Apply Changes (Only if Needed)

**Format for skipping a test:**
```typescript
// TODO(#11598): Flaky test - 45% pass rate over 10 runs; needs timing improvements
it.skip('test name', async () => {
  // test code
});
```

**NEVER use `describe.skip()` for entire suite** - Only skip individual problematic tests.

### Step 5: Create GitHub Issue (If New Skips)

If any NEW tests are skipped that don't have an issue:
1. Create GitHub issue with title: "Fix flaky replace.test.ts: [test name]"
2. Include pass rate data from testing
3. Include error messages/patterns from failures
4. Link to this plan and upstream commit

### Step 6: Update This Plan

Add section documenting final decisions:
- Which tests were evaluated
- Pass rates measured
- Actions taken (skip/keep enabled)
- Issue numbers referenced

## Acceptance Criteria

- [ ] All 5 tests in replace.test.ts have been run 10 times minimum
- [ ] Pass rates documented for each test
- [ ] Decisions made based on objective pass rate thresholds
- [ ] Any new skips have corresponding GitHub issues
- [ ] No blanket `describe.skip('replace')` added
- [ ] All skip comments include issue numbers and justification
- [ ] This plan updated with final results

## Files to Modify

| File | Potential Action | Condition |
|------|-----------------|-----------|
| `integration-tests/replace.test.ts` | Add targeted `it.skip()` with issue links | Only if pass rate < 80% |
| New GitHub issue(s) | Create if new skips needed | Only if no existing issue |

## Non-Actions

- ❌ Do NOT skip entire replace suite with `describe.skip()`
- ❌ Do NOT create/modify `file-system-interactive.test.ts` (doesn't exist in LLxprt)
- ❌ Do NOT blindly copy upstream's approach
- ❌ Do NOT skip tests without running them first
- ❌ Do NOT skip tests without GitHub issue tracking

## Rationale

**Why not just copy upstream?**
1. Upstream skipped entire suite, then later unskipped and deleted problematic test
2. LLxprt has made independent improvements (commits 2bb64333e, 40e85927b, 653b3e1e7)
3. Our test infrastructure may have different timing characteristics
4. We already have issue #11598 tracking replace test flakiness
5. Blindly copying creates technical debt without understanding root cause

**Why measure pass rates?**
1. Objective decision-making based on data, not guesses
2. Documents current state for future reference
3. Helps prioritize which tests need fixing first
4. Validates whether our previous fixes (2bb64333e, 40e85927b) actually worked

**Why require GitHub issues?**
1. Ensures skipped tests don't become permanently ignored
2. Provides tracking for future fix efforts
3. Creates accountability for technical debt
4. Allows prioritization across all test flakiness issues
