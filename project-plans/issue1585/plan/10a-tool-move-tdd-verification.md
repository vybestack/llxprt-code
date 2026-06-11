# Phase 10a: Tool Move TDD Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P10a`

## Purpose

Verify tests are behavioral, cover registry/scheduler/provider integration, and avoid mock theater.

## Prerequisites

- Required: P10 completed with behavioral regression test files.

## Verification Tasks

### Step 1: Verify Test Groups Coverage

```bash
for group in filesystem edit-ast shell todo mcp subagent memory tool-key-storage boundary; do
  test -f "packages/tools/src/__tests__/${group}*.test.ts" && echo "OK: ${group}" || echo "MISSING: ${group}"
done
test -f "packages/core/src/__tests__/tools-registry-scheduler.test.ts" && echo "OK: registry-scheduler" || echo "MISSING: registry-scheduler"
test -f "packages/providers/src/__tests__/tools-formatting.test.ts" && echo "OK: provider-formatting" || echo "MISSING: provider-formatting"
```

### Step 2: Verify No Mock Theater Or Structure-Only Tests

```bash
# Check for constructor/delegation-only tests (anti-pattern)
rg -n "toHaveBeenCalledWith\|expect.*constructor\|expect.*implements\|\.toReturnType\|expect.*calledWith.*Adapter" packages/tools/src/__tests__ -g "*.ts" | head -10
# Each occurrence MUST be justified as secondary evidence with documented rationale
# If any toHaveBeenCalled* assertion is the PRIMARY assertion for a shell/todo/key-storage test, the test fails review
# Check for tests that only assert file existence or export presence
rg -n "expect.*exist\|expect.*toBeDefined.*export\|test.*exports.*present" packages/tools/src/__tests__ -g "*.ts" | head -10
# Should be zero or very few
```

### Step 2b: Verify Observable Behavior Assertions for Shell/Todo/Key-Storage

For shell, todo, and key-storage test groups specifically, verify:

```bash
# Shell tests: Must assert ToolResult content, not just method calls
rg -n "ToolResult|llmContent|returnDisplay|error" packages/tools/src/__tests__/shell-tool.test.ts | wc -l
# Expected: > 3 (observable output assertions exist)

# Todo tests: Must assert observable state changes, not just method calls
rg -n "ToolResult|llmContent|returnDisplay|todo.*items|state.*change" packages/tools/src/__tests__/todo-tools.test.ts | wc -l
# Expected: > 3

# Key-storage tests: Must assert observable key/masking values, not just method calls
rg -n "expect.*maskKey|expect.*getSupported|expect.*saveKey|expect.*getKey|expect.*null|ToolResult" packages/tools/src/__tests__/tool-key-storage.test.ts | wc -l
# Expected: > 3

# Review any toHaveBeenCalled* usage in these three test groups as secondary-only
# Each occurrence MUST have a justification comment. Use grep (not rg -g) since these are specific files.
rg -n "toHaveBeenCalled" packages/tools/src/__tests__/shell-tool.test.ts packages/tools/src/__tests__/todo-tools.test.ts packages/tools/src/__tests__/tool-key-storage.test.ts 2>/dev/null
# Each occurrence must have a justification comment or be flagged for review
# A test that ONLY uses toHaveBeenCalled without an observable output assertion fails review
```

### Step 3: Verify Behavioral Assertions

```bash
grep -c "expect" packages/tools/src/__tests__/*.test.ts | awk -F: '$2 < 2 {print "LOW:", $0}'
# Flag test files with fewer than 2 expectations
# Verify observable behavior: each test should assert ToolResult, filesystem state, storage state, or provider output
rg -n "ToolResult\|llmContent\|returnDisplay\|filesystem\|storage.*state" packages/tools/src/__tests__ -g "*.ts" | wc -l
# Expected: high count (most tests reference observable outcomes)
```

### Step 4: Verify Tests Would Fail With Broken Implementation

For each test group, verify that replacing the real implementation with a no-op stub would cause the test to fail:
```bash
# This is a design review, not an automated check
# Reviewer must confirm that each test file's assertions are sufficient to detect broken tool logic
```

## Verification Commands

```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run test --workspace @vybestack/llxprt-code-tools 2>&1 | tail -20
```

## Semantic Verification Checklist

- [ ] All 9+ tool group test files exist.
- [ ] Registry/scheduler and provider integration tests exist.
- [ ] No mock theater, reverse testing, or structure-only tests.
- [ ] Shell/todo/key-storage tests assert observable behavior (ToolResult, storage state, key values) as primary assertions.
- [ ] `toHaveBeenCalled*` assertions in shell/todo/key-storage tests are secondary-only with documented justification.
- [ ] Tests would fail if real implementation is broken (no no-op stub pass risk).

## Success Criteria

- All test groups covered.
- Test quality is behavioral.

## Failure Recovery

Return to P10 to add missing tests.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P10a.md` with test group coverage and quality assessment.
