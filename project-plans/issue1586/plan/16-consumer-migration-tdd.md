# Phase 16: Consumer Migration Integration Tests

Plan ID: PLAN-20260608-ISSUE1586.P16
## Prerequisites
- Required: Phase 15a completed

## Requirements Implemented

### REQ-TEST-001.1: Integration tests written BEFORE implementation
### REQ-API-001.3: Existing auth behavior MUST remain reachable

## Phase Tasks

1. Write integration test: core DI factories create working auth instances.
2. Write integration test: CLI auth flow works end-to-end after migration.
3. Write integration test: providers package uses AuthPrecedenceResolver from auth package with SettingsService from core (structural typing verification — `SettingsService` satisfies `ISettingsService`).
4. Write package boundary test: forbidden import scan for auth→core and auth relative import escapes.
5. Write compile-time test: `SettingsService` satisfies `ISettingsService` (structural compatibility).

## TDD Pass/Fail Expectation
- **Expected: MIXED** — Some consumer paths may fail if import migration stubs are not yet complete for all consumer files. Primary CLI and providers migration should work.

## Verification Commands

```bash
set -euo pipefail
npm run test --workspace @vybestack/llxprt-code-auth
npm run test --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code
```