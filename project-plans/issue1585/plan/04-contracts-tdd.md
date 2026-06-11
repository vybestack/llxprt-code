# Phase 04: Contract And Boundary TDD

## Phase ID

`PLAN-20260608-ISSUE1585.P04`

## Purpose

Write behavioral and package-boundary tests for tool contracts, registry host interfaces, and forbidden imports. Tests must be behavioral and fail naturally without implementation.

## Prerequisites

- Required: P03a completed (interface stubs verified, no forbidden imports).
- Artifacts from P03a: packages/tools with interface stubs.

## Requirements Implemented

### REQ-TEST-001, REQ-DEP-001, REQ-BEHAVIORAL-TDD

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-BEHAVIORAL-TDD, REQ-PKG-BOUNDARY

**Behavior specification**:
- GIVEN: Interface stubs are verified with no forbidden imports
- WHEN: Contract and boundary tests are written
- THEN: Tests are behavioral and fail naturally without implementation; forbidden import test detects actual violations; no mock theater or reverse testing

**Why it matters**: If contract tests only check file existence, they pass even when the interface is wrong, giving false confidence.

## Implementation Tasks

### Step 1: Forbidden Import Boundary Test

Create `packages/tools/src/__tests__/forbidden-imports.test.ts`:

```typescript
// Test that packages/tools never imports core/cli/providers
// This test passes when the forbidden import scan returns zero matches
// It should use grep-based detection at test time, not module-level import checks
```

### Step 2: Interface Contract Behavioral Tests

Create `packages/tools/src/__tests__/interface-contracts.test.ts`:

Tests that verify:
- Each interface method signature is callable (structure test of the contract, not implementation)
- IToolKeyStorage.maskKeyForDisplay masks keys correctly (pure function test)
- IToolKeyStorage.getSupportedToolNames returns expected tool names
- ToolContext does not accept arbitrary service injections

### Step 3: Package Boundary Tests

Create `packages/tools/src/__tests__/package-boundary.test.ts`:

Tests that verify:
- packages/tools does not depend on packages/core in package.json dependencies
- packages/tools does not depend on packages/providers in package.json dependencies
- packages/tools package.json has correct name, type, main, types, exports fields

### Step 4: Registry Integration Contract Tests

Create `packages/tools/src/__tests__/registry-contract.test.ts`:

Tests that verify:
- ToolRegistry can register tools that implement the tools-owned interfaces
- Tool classes accept injected service interfaces in constructors
- ToolRegistry discovers and lists registered tools

### Files To Create

- `packages/tools/src/__tests__/forbidden-imports.test.ts`
- `packages/tools/src/__tests__/interface-contracts.test.ts`
- `packages/tools/src/__tests__/package-boundary.test.ts`
- `packages/tools/src/__tests__/registry-contract.test.ts`

## Verification Commands

```bash
# Run tools package tests (should fail because interfaces are stubs)
npm run test --workspace @vybestack/llxprt-code-tools 2>&1 | head -60
# Verify test files exist
ls packages/tools/src/__tests__/*.test.ts
# Typecheck
npm run typecheck --workspace @vybestack/llxprt-code-tools
```

## Semantic Verification Checklist

- [ ] Tests are behavioral, not just file-existence checks.
- [ ] Tests would fail if the implementation were broken.
- [ ] No mock theater (no NotYetImplemented, no reverse testing).
- [ ] Forbidden import test detects actual violations.

## Success Criteria

- Test files exist and typecheck.
- Behavioral tests are written to fail naturally.
- No mock theater or reverse testing.

## Failure Recovery

Return to P04 to fix test quality.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P04.md` with test file listing and quality assessment.
