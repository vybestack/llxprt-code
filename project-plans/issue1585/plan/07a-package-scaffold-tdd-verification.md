# Phase 07a: Scaffold TDD Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P07a`

## Purpose

Verify release/build tests fail for missing implementation and test real metadata text.

## Prerequisites

- Required: P07 completed with test files.
- Artifacts: release-process test extensions, package metadata tests.

## Verification Tasks

### Step 1: Verify Release Tests Fail

```bash
npm run test:scripts 2>&1 | grep -i "tools\|fail\|error" | head -20
```

Release tests mentioning tools should fail because release process isn't wired yet.

### Step 2: Verify Package Metadata Tests Pass

```bash
npm run test --workspace @vybestack/llxprt-code-tools
```

### Step 3: Review Test Quality

```bash
# Ensure release tests assert actual content
rg -n "tools" scripts/tests/release-process.test.js | head -10
```

## Verification Commands

```bash
npm run typecheck
npm run test --workspace @vybestack/llxprt-code-tools
```

## Semantic Verification Checklist

- [ ] Release process tests exist and fail for missing implementation.
- [ ] Package metadata tests pass.
- [ ] Forbidden dependency tests pass (test-utils devDep-only).
- [ ] Anti-cycle assertions exist in test file.

## Success Criteria

- Release tests fail as expected.
- Metadata tests pass.

## Failure Recovery

Return to P07 to fix test quality.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P07a.md` with test behavior assessment.
