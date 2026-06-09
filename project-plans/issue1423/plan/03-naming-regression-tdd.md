# Phase 03: Naming Regression TDD

## Phase ID

`PLAN-20260608-ISSUE1423.P03`

## Prerequisites

- Required: Phase 02a PASS.
- Verification: `grep -q "PASS" project-plans/issue1423/.completed/P02a.md`.
- Pseudocode: `analysis/pseudocode/rename-refactor.md` lines 10-16.

## Requirements Implemented (Expanded)

### REQ-VERIFY-001.2: Old-name regression verification

**Full Text**: Add a regression test or verification script that fails while old provider-agnostic source files/classes/accessors still exist.

**Behavior**:

- GIVEN: the current codebase contains old provider-agnostic Gemini names
- WHEN: the new regression check runs before implementation
- THEN: it fails for the targeted old names
- AND: after implementation it passes while still allowing legitimate Gemini provider-specific names

**Why This Matters**: Without an explicit negative check, aliases or missed call sites can satisfy TypeScript while violating issue #1423.

## Implementation Tasks

### Files to Create or Modify

- Create `packages/core/src/core/__tests__/providerAgnosticNaming.test.ts`.
  - MUST include marker `@plan:PLAN-20260608-ISSUE1423.P03`.
  - MUST include marker `@requirement:REQ-VERIFY-001.2`.
  - MUST scan source/test/package metadata files under `packages/` excluding generated/out-of-scope paths: `**/dist/**`, `**/coverage/**`, `**/node_modules/**`, `tmp/**`, `project-plans/**`, `**/*.log`, and `**/*.xml`.
  - MUST fail in the pre-rename state because targeted old names exist.
  - MUST not fail on legitimate Gemini provider-specific files/names listed in `analysis/rename-surface.md`.
  - MUST scan contents of `packages/cli/src/ui/hooks/geminiStream/**` for provider-agnostic client/session names even though the folder name remains allowed.
  - MUST fail if `packages/core/package.json` exposes `./core/geminiChat.js` or any source/test file keeps old targeted import paths, classes, accessors, local mocks, or local variables.

## Required Code Markers

Tests created in this phase must include comments or test names with:

```typescript
// @plan:PLAN-20260608-ISSUE1423.P03
// @requirement:REQ-VERIFY-001.2
```

## Verification Commands

```bash
grep -r "@plan:PLAN-20260608-ISSUE1423.P03" packages project-plans/issue1423 | wc -l
# Expected: 1+ occurrences

npm run test --workspace @vybestack/llxprt-code-core -- providerAgnosticNaming.test.ts
# Expected for the new naming regression check: fails before implementation due to old names.
```

Record the targeted package command and failure output in the completion marker. Do not use Jest-only flags such as `--runInBand`.

## Semantic Verification Checklist

- [ ] Test checks behavior/contract of naming policy, not implementation details of a mock.
- [ ] Test fails before implementation.
- [ ] Test excludes generated/out-of-scope Gemini provider-specific paths.
- [ ] Test would fail if a shim/alias old symbol remains.

## Failure Recovery

Do not proceed to P04 until the regression check exists and fails for the current old names.

## Phase Completion Marker

Create `project-plans/issue1423/.completed/P03.md` with test file path and failing output.
