# Phase 01: Preflight Verification

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P01`

## Prerequisites

- Required: Plan overview (00-overview.md) reviewed
- Verification: Plan files exist in `project-plans/issue1351_1352/`
- Expected files from previous phase: `requirements.md`, `overview.md`, `technical-overview.md`
- Preflight verification: This IS the preflight phase

## Requirements Implemented (Expanded)

This phase does not implement requirements directly. It verifies ALL assumptions before any code is written.

### ALL REQUIREMENTS (Preflight Scope)

**Full Text**: All 19 requirement groups (R1–R19) depend on correct assumptions about the codebase.
**Behavior**:
- GIVEN: The plan references SecureStore, OAuthTokenSchema, TokenStore interface, DebugLogger, and specific file paths
- WHEN: Preflight verification runs
- THEN: Every referenced dependency, type, call path, and test infrastructure item is confirmed to exist and match plan expectations
**Why This Matters**: 60%+ of plan failures trace back to incorrect assumptions made during planning. Verifying upfront prevents cascading remediation.

## Implementation Tasks

### Dependency Verification

Execute the following and record results:

```bash
# Verify SecureStore exists and is importable
grep -r "export class SecureStore" packages/core/src/storage/secure-store.ts

# Verify SecureStoreError exists
grep -r "export class SecureStoreError" packages/core/src/storage/secure-store.ts

# Verify OAuthTokenSchema exists with passthrough capability
grep -r "export const OAuthTokenSchema" packages/core/src/auth/types.ts

# Verify TokenStore interface exists
grep -r "export interface TokenStore" packages/core/src/auth/token-store.ts

# Verify DebugLogger exists
grep -r "export class DebugLogger" packages/core/src/debug/DebugLogger.ts

# Verify fast-check is installed (for property-based tests)
npm ls fast-check 2>/dev/null || echo "fast-check NOT FOUND"

# Verify vitest is available
npm ls vitest 2>/dev/null || echo "vitest NOT FOUND"

# Verify zod is available
npm ls zod 2>/dev/null || echo "zod NOT FOUND"

# Verify @napi-rs/keyring is available (optional — fallback is fine)
npm ls @napi-rs/keyring 2>/dev/null || echo "@napi-rs/keyring NOT FOUND (OK — fallback path exists)"
```

### Type/Interface Verification

```bash
# Verify TokenStore interface has ALL expected methods
grep -A 80 "export interface TokenStore" packages/core/src/auth/token-store.ts

# Expected methods: saveToken, getToken, removeToken, listProviders, listBuckets, getBucketStats, acquireRefreshLock, releaseRefreshLock

# Verify OAuthTokenSchema fields
grep -A 10 "export const OAuthTokenSchema" packages/core/src/auth/types.ts

# Expected: access_token, refresh_token, expiry, scope, token_type, resource_url

# Verify BucketStats type
grep -A 6 "export const BucketStatsSchema" packages/core/src/auth/types.ts

# Expected: bucket, requestCount, percentage, lastUsed

# Verify SecureStore methods
grep -E "async (set|get|delete|list|has)\(" packages/core/src/storage/secure-store.ts

# Expected: set(key, value), get(key), delete(key), list(), has(key)

# Verify SecureStoreErrorCode type
grep -A 8 "export type SecureStoreErrorCode" packages/core/src/storage/secure-store.ts

# Expected: UNAVAILABLE, LOCKED, DENIED, CORRUPT, TIMEOUT, NOT_FOUND

# Verify ProviderKeyStorage pattern (our model)
grep -A 15 "constructor" packages/core/src/storage/provider-key-storage.ts

# Expected: optional SecureStore injection, same constructor pattern we'll follow
```

### Call Path Verification

```bash
# Verify MultiProviderTokenStore is instantiated where we expect
grep -rn "new MultiProviderTokenStore" packages/cli/src --include="*.ts"

# Expected sites:
# runtimeContextFactory.ts
# authCommand.ts (2 sites)
# profileCommand.ts (2 sites)
# providerManagerInstance.ts

# Verify re-export chain
grep -n "MultiProviderTokenStore" packages/core/index.ts
grep -n "MultiProviderTokenStore" packages/cli/src/auth/types.ts

# Verify DebugLogger constructor signature
grep -A 3 "constructor" packages/core/src/debug/DebugLogger.ts

# Verify SecureStore constructor signature
grep -A 10 "constructor(serviceName" packages/core/src/storage/secure-store.ts
```

### Test Infrastructure Verification

```bash
# Verify test files exist for token-store
ls packages/core/src/auth/token-store.spec.ts
ls packages/core/src/auth/token-store.refresh-race.spec.ts

# Verify test runner works for core package
cd packages/core && npm test -- --run --reporter=verbose 2>&1 | tail -5

# Verify __tests__ directory exists in auth
ls packages/core/src/auth/__tests__/ 2>/dev/null || echo "No __tests__ dir in core/auth"

# Check existing test patterns
grep -c "describe\|it\|test" packages/core/src/auth/token-store.spec.ts
```

### Files to Create

- `project-plans/issue1351_1352/plan/01a-preflight-verification.md` (filled with verification results)

### Required Code Markers

No code markers in this phase — it's a verification-only phase.

## Verification Commands

### Automated Checks (Structural)

```bash
# Verify preflight results file was created
test -f project-plans/issue1351_1352/plan/01a-preflight-verification.md || echo "FAIL: Preflight results not created"

# Verify all sections are filled (not placeholder)
grep -c "OK\|MISSING\|YES\|NO" project-plans/issue1351_1352/plan/01a-preflight-verification.md
# Expected: Multiple matches (one per verification item)
```

### Structural Verification Checklist

- [ ] All dependency commands executed
- [ ] All type/interface verifications completed
- [ ] All call paths confirmed
- [ ] Test infrastructure verified
- [ ] No blocking issues (or blocking issues documented with resolution plan)

### Deferred Implementation Detection (MANDATORY)

N/A — this phase produces no implementation code.

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] N/A — no code produced
   - [ ] Verification results are accurate (commands were actually run)

2. **Is this REAL implementation, not placeholder?**
   - [ ] Verification results contain actual command outputs, not template placeholders
   - [ ] Every "OK" or "YES" has supporting evidence

3. **Would the test FAIL if implementation was removed?**
   - [ ] N/A — no tests in this phase

4. **Is the feature REACHABLE by users?**
   - [ ] N/A — no feature code in this phase

5. **What's MISSING?**
   - [ ] Any missing dependencies documented
   - [ ] Any type mismatches documented
   - [ ] Any impossible call paths documented
   - [ ] Resolution plan for each blocking issue

## Success Criteria

- All dependencies verified as present
- All types match plan expectations
- All call paths confirmed as possible
- Test infrastructure is ready
- No unresolved blocking issues (or issues have documented resolution)

## Failure Recovery

If this phase fails:

1. Document the blocking issue in `01a-preflight-verification.md`
2. Update the plan to address the issue before proceeding
3. Do NOT proceed to Phase 02 until all issues resolved

## Phase Completion Marker

Create: `project-plans/issue1351_1352/.completed/P01.md`
Contents:

```markdown
Phase: P01
Completed: YYYY-MM-DD HH:MM
Files Created: [01a-preflight-verification.md]
Files Modified: [none]
Tests Added: 0
Verification: [paste of verification command outputs]
Blocking Issues: [list or "none"]
```
