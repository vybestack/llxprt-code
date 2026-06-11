# Phase 04a: Contract Test Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P04a`

## Purpose

Verify tests are behavioral, fail naturally, and avoid NotYetImplemented/reverse testing/mock theater.

## Prerequisites

- Required: P04 completed with test files.
- Artifacts: test files in packages/tools/src/__tests__/.

## Verification Tasks

### Step 1: Verify Test Quality

```bash
# Ensure no NotYetImplemented patterns
rg -n "NotYetImplemented\|todo()\|skip()" packages/tools/src/__tests__ -g "*.ts"
# Ensure no reverse testing patterns
rg -n "expect.*toBeUndefined\|expect.*toBeNull.*import" packages/tools/src/__tests__ -g "*.ts"
# Ensure behavioral assertions exist
rg -n "expect.*toBe\|expect.*toEqual\|expect.*toThrow\|expect.*toContain" packages/tools/src/__tests__ -g "*.ts"
```

### Step 2: Verify Tests Would Fail If Implementation Were Broken

Manually review that each test asserts real behavior, not just that code exists.

## Verification Commands

```bash
npm run test --workspace @vybestack/llxprt-code-tools 2>&1 | tail -20
npm run typecheck --workspace @vybestack/llxprt-code-tools
```

## Semantic Verification Checklist

- [ ] No NotYetImplemented or skip patterns.
- [ ] No reverse testing patterns.
- [ ] Behavioral assertions are present.
- [ ] Tests would fail naturally with broken implementations.
- [ ] Tests would fail if real tool logic were broken (no no-op stub pass risk).

## Success Criteria

- Test quality meets behavioral standards.
- No mock theater found.

## Failure Recovery

Return to P04 to fix test quality.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P04a.md` with test quality assessment.
