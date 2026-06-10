# Phase 13: OAuth Split TDD/Contract Tests

Plan ID: PLAN-20260608-ISSUE1586.P13

> **Phase purpose:** Write TDD contract tests for the OAuthManager interface/implementation split. These tests drive and verify that CLI's `OAuthManager` structurally implements auth's `OAuthManager` interface, that adapters can be registered without auth package changes, and that `AuthPrecedenceResolver` works with an in-memory/fake `OAuthManager` implementation (asserting on resolved auth results, not on mock call counts — no mock theater). This phase CREATES tests (the TDD/contract-test phase), while P13a is the verification gate for those tests.
>
> **Filename:** `13-oauth-split-tdd-contract-tests.md` — renamed from `13-oauth-split-contract-verification.md` to clarify this phase creates TDD/contract tests, not just verifies.

## Prerequisites
- Required: Phase 12a completed

## Requirements Implemented

### REQ-ADAPTER-001.1: AuthPrecedenceResolver MUST NOT hard-code provider-specific OAuth logic
### REQ-ADAPTER-001.2: Provider-specific auth adapters must be registered/injected

## Phase Tasks

1. Write integration test: CLI `OAuthManager` implements auth package `OAuthManager` interface (compile-time type test).
2. Write behavioral test: AuthPrecedenceResolver works with in-memory/fake `OAuthManager` implementation; assert on resolved auth results, not on mock call counts.
3. Write adapter registration test: new provider can be registered without auth package changes.
4. Verify CLI provider adapters import from @vybestack/llxprt-code-auth.
5. **Reminder:** Any new behavior introduced in this phase (e.g., new adapter registration paths, new interface methods) still requires behavioral tests — not just structural/contract checks. If a task adds runtime logic beyond type compatibility verification, write a failing behavioral test first (TDD), then implement.

## TDD Pass/Fail Expectation
- **Expected: PASS** — These are regression/contract tests for an existing interface (`OAuthManager` in `precedence.ts`), not a new red-phase implementation. The `OAuthManager` interface already exists in `precedence.ts` (moved in P09) and is structurally compatible. The tests verify compile-time type compatibility and runtime behavioral contracts that should already hold. This is a refactoring exception: the interface exists and is verified, not newly created with a failing test first.
- **Note on TDD discipline:** If new runtime logic or new interface methods are added during this phase (beyond verifying existing structure), those additions must follow standard TDD (write failing behavioral test first, then implement). The contract tests here verify the existing split — they should pass immediately because the contract already exists.

## Verification Commands

```bash
set -euo pipefail
npm run test --workspace @vybestack/llxprt-code-auth
npm run test --workspace @vybestack/llxprt-code
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code
```