# Phase 04: Package Scaffold Boundary/Verification Tests

Plan ID: PLAN-20260608-ISSUE1586.P04

> **Filename matches content:** `04-package-scaffold-tdd.md` — scaffold phase
>
> **Note on naming:** This phase is titled "TDD" for consistent naming convention with other phases, but the tests are **boundary/verification tests** for the scaffold, not classical TDD (no red→green cycle). The scaffold is pre-built in P03; these tests verify the scaffold exists and meets structural requirements. This is a standard refactoring exception: scaffolding must exist before meaningful TDD can begin. The tests validate configuration, dependency constraints, and package metadata — not behavioral requirements of production code.

## Prerequisites
- Required: Phase 03a completed

## Requirements Implemented

### REQ-DEP-001.2: packages/auth production code MUST NOT import from core/cli/providers/tools
### REQ-AUTH-001.3: packages/auth MUST expose a clean public API

## Implementation Tasks

### Files to Create
- `packages/auth/src/__tests__/package-boundary.test.ts` — verify auth package never imports core/cli/providers
  - Test: `import('@vybestack/llxprt-code-auth')` resolves
  - Test: auth package exports placeholder (even if empty initially)
  - Test: forbidden import scan (will be enforced post-move in P09+)

## TDD Pass/Fail Expectation
- **Expected: PASS** — These are boundary/verification tests for the scaffold (not classical TDD red→green). The scaffold exists from P03; these tests verify structural requirements are met. Minimal tests for an empty package should pass.
- Tests for forbidden imports will be meaningful once auth source files exist (P09+).

## Verification Commands

```bash
npm run test --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code-auth
```