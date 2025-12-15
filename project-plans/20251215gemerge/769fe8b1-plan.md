# Implementation Plan: 769fe8b1 - Replace Test Cleanup [REIMPLEMENT]

## Plan Type
**REIMPLEMENT** - Upstream deleted flaky test; LLxprt fixed it instead. Document the divergence.

## Summary of Upstream Changes

Upstream commit `769fe8b16` ("Delete unworkable replace test and enabled the rest (#11125)"):
- Changed `describe.skip('replace', ...)` to `describe('replace', ...)` to enable the test suite
- Deleted the flaky "should fail safely when old_string is not found" test (31 lines removed)
- Changed json-output.test.ts: skipped one test with `it.skip` (changed line 88)
- Rationale: The replace test was too flaky/unworkable to maintain; json test skip was likely related to test stability

## Current State in LLxprt

### /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/replace.test.ts
LLxprt's replace.test.ts has ALREADY diverged significantly from upstream:

**Current state (line 10):**
- Line 10: `describe('replace', () => {` - Suite is NOT skipped (matches upstream after their commit)
- Line 11: First test has `it.skip` - Different from upstream (unrelated divergence)

**The controversial test (lines 95-179):**
- LLxprt KEPT and ENHANCED the "should fail safely when old_string is not found" test
- Made robust through commits 40e85927b and 2bb64333e:
  - **Commit 40e85927b** (Dec 9, 2025): "fix(tests): Prevent LLM from bypassing replace test with write_file tool"
  - **Commit 2bb64333e** (Dec 6, 2025): "fix(test): improve robustness of flaky e2e replace test (#725)"
  - Key improvements:
    - `rig.sync()` to ensure filesystem flush before child process
    - File content assertion as primary check (tests behavior not implementation)
    - `excludeTools: ['write_file']` to prevent LLM bypass
    - Extensive diagnostic logging for debugging

**Other tests:**
- Lines 65-93: Dollar sign literal test - active
- Lines 181-205: Multi-line block insert test - active
- Lines 207-236: Delete block test - active, accepts both `replace` and `delete_line_range` tools

### /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/json-output.test.ts
**LLxprt does NOT have this file** - it was removed in an earlier divergence from upstream.

## Implementation Steps

### Step 1: Document the Divergence in replace.test.ts

**File**: `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/replace.test.ts`

**Location**: Before line 95 (before the `it('should fail safely when old_string is not found'` test)

**Action**: Use Edit tool to add a divergence comment

**old_string**:
```
  it('should fail safely when old_string is not found', async () => {
```

**new_string**:
```
  // LLxprt divergence from upstream commit 769fe8b1: We keep this test that upstream deleted.
  // Upstream found it too flaky and removed it entirely. LLxprt fixed the root causes instead
  // (commits 40e85927b, 2bb64333e) with rig.sync(), excludeTools: ['write_file'], and robust
  // file content assertions. This test now reliably validates error handling for missing strings.
  it('should fail safely when old_string is not found', async () => {
```

### Step 2: JSON Output Test - No Action Required
1. **No action required** - LLxprt doesn't have `integration-tests/json-output.test.ts`
2. This change is automatically irrelevant to our codebase

### Step 3: Leave First Test Skip Unchanged
1. LLxprt has `it.skip` on line 11 (first test is skipped)
2. Upstream does NOT have this skip (their first test is active)
3. **Decision**: Leave as-is - this is a separate quality decision unrelated to this merge plan

## Files to Modify

| File | Action | Lines |
|------|--------|-------|
| `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/replace.test.ts` | Add 4-line divergence comment before line 95 | 95 |
| `integration-tests/json-output.test.ts` | N/A - file doesn't exist in LLxprt | N/A |

## Exact Implementation Command

```bash
# No bash commands needed - use Edit tool with the exact strings above
```

## Verification Steps

### Success Criteria
1. **Comment Added**: Lines 95-98 contain the divergence comment (4 lines)
2. **Test Still Present**: The "should fail safely when old_string is not found" test exists and is not skipped
3. **Tests Pass**: All tests in replace.test.ts pass
4. **Format Clean**: `npm run format` makes no changes
5. **Lint Clean**: `npm run lint` reports no errors

### Commands to Run
```bash
# 1. Verify comment was added
grep -A 1 "LLxprt divergence from upstream commit 769fe8b1" /Users/acoliver/projects/llxprt-code-branches/llxprt-code-1/integration-tests/replace.test.ts

# 2. Run the specific test file
npm test -- replace.test.ts

# 3. Expected output: All tests pass (4 tests, 1 skipped on line 11)
# - should be able to replace content in a file [SKIPPED]
# - should handle $ literally when replacing text ending with $ [PASS]
# - should fail safely when old_string is not found [PASS]
# - should insert a multi-line block of text [PASS]
# - should delete a block of text [PASS]

# 4. Format check
npm run format

# 5. Lint check
npm run lint
```

## Related Commits

- **Upstream**: 769fe8b161a59d3690feb7069ee717e2be4829cc - Deleted flaky test
- **LLxprt**: 40e85927b - Prevented LLM bypass with excludeTools
- **LLxprt**: 2bb64333e - Fixed flaky test with defensive measures

## Decision Rationale

While CHERRIES.md says REIMPLEMENT, the actual implementation is to document WHY we're NOT taking upstream's deletion. We're reimplementing their intent (stable tests) through a different approach (fixing rather than deleting). The divergence comment serves as the "reimplementation" - it documents our superior solution for future maintainers.

**Why this is correct**:
1. LLxprt invested engineering effort to fix the test (2 commits, 84 lines of defensive code)
2. The test now validates important edge case behavior (graceful failure on non-existent strings)
3. Upstream's solution (deletion) loses test coverage; LLxprt's solution (fixing) maintains it
4. The comment ensures future merge conflicts are handled with context

## Automation-Ready Checklist

- [x] Exact file paths provided (absolute paths)
- [x] Exact line numbers identified (line 95)
- [x] Exact old_string provided (single line with 'it(' declaration)
- [x] Exact new_string provided (4-line comment + original line)
- [x] Success criteria defined (5 specific checks)
- [x] Verification commands provided (5 bash commands with expected output)
- [x] No ambiguous language ("add a comment" → exact string to add)
- [x] REIMPLEMENT meaning clarified (document divergence, not delete & recreate)
