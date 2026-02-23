# Phase 00a: Preflight Verification

**Plan ID**: `PLAN-20260223-ISSUE1598.P00a`  
**Phase**: Preflight Verification  
**Type**: Analysis  
**Prerequisites**: Phase 00 (Overview)

---

## Purpose

Verify ALL assumptions about dependencies, types, call paths, and test infrastructure BEFORE writing any implementation code. This phase prevents the most common planning failures by validating that:
- Dependencies exist and are at correct versions
- Type interfaces match what the plan assumes
- Call patterns are architecturally possible
- Test infrastructure is present and working

**Historical context**: 60%+ of remediation work traces back to incorrect assumptions made during planning. This phase catches those issues early.

---

## Dependency Verification

### Required Dependencies (Check Existence)

```bash
# Vitest (testing framework)
npm ls vitest
# Expected: vitest@x.x.x (any version present)

# TypeScript
npm ls typescript
# Expected: typescript@5.x.x

# Core package (internal)
npm ls @vybestack/llxprt-code-core
# Expected: link to packages/core
```

**Checklist**:
- [ ] `vitest` found: _____ (paste version)
- [ ] `typescript` found: _____ (paste version)
- [ ] `@vybestack/llxprt-code-core` found: _____ (paste status)

**Action if missing**: STOP. Install missing dependencies before proceeding.

---

## Type/Interface Verification

### 1. BucketFailoverHandler Interface

**File**: `packages/core/src/config/config.ts`

```bash
grep -A 10 "interface BucketFailoverHandler" packages/core/src/config/config.ts
```

**Expected methods** (from plan assumption):
- `getBuckets(): string[]`
- `getCurrentBucket(): string | undefined`
- `tryFailover(context?: FailoverContext): Promise<boolean>` — NOTE: context parameter does NOT exist yet (will be added)
- `isEnabled(): boolean`
- `resetSession(): void`
- `reset(): void`

**Actual output**:
```
(Paste grep output here)
```

**Verification**:
- [ ] Interface exists: YES / NO
- [ ] Has all expected methods (excluding `getLastFailoverReasons?()` and `context` parameter which are NEW): YES / NO
- [ ] Method signatures match: YES / NO

**Action if mismatch**: Update plan to reflect actual interface.

---

### 2. OAuthToken Type

**File**: `packages/cli/src/auth/types.ts`

```bash
grep -A 10 "interface OAuthToken\|type OAuthToken" packages/cli/src/auth/types.ts
```

**Expected fields** (from plan assumption):
- `access_token: string`
- `expiry: number` — Unix timestamp in SECONDS (NOT `expiresAt`)
- `refresh_token?: string`
- `scope?: string`

**Actual output**:
```
(Paste grep output here)
```

**Verification**:
- [ ] Type exists: YES / NO
- [ ] Has `expiry` field (NOT `expiresAt`): YES / NO
- [ ] Type is correct: YES / NO

**Action if mismatch**: CRITICAL. Update all pseudocode and references to use correct field name.

---

### 3. AllBucketsExhaustedError Constructor

**File**: `packages/core/src/providers/errors.ts`

```bash
grep -A 10 "class AllBucketsExhaustedError" packages/core/src/providers/errors.ts
```

**Expected constructor** (from plan assumption):
```typescript
constructor(
  providerName: string,
  attemptedBuckets: string[],
  lastError: Error
)
```

**Actual output**:
```
(Paste grep output here)
```

**Verification**:
- [ ] Class exists: YES / NO
- [ ] Constructor signature matches: YES / NO
- [ ] Has exactly 3 parameters: YES / NO

**Action if mismatch**: Update plan to add `bucketFailureReasons` as 4th parameter (optional).

---

### 4. RetryOrchestrator Error Handling

**File**: `packages/core/src/providers/RetryOrchestrator.ts`

```bash
grep -B 5 -A 15 "AllBucketsExhaustedError" packages/core/src/providers/RetryOrchestrator.ts
```

**Expected**: RetryOrchestrator calls `tryFailover()` and constructs `AllBucketsExhaustedError` when it returns `false`.

**Actual output**:
```
(Paste grep output here)
```

**Verification**:
- [ ] RetryOrchestrator imports AllBucketsExhaustedError: YES / NO
- [ ] RetryOrchestrator calls `tryFailover()`: YES / NO
- [ ] Location of error construction: Line _____ (record for modification)

**Action if missing**: Update plan with actual call site.

---

## Call Path Verification

### 1. BucketFailoverHandlerImpl Instantiation

**File**: `packages/cli/src/auth/oauth-manager.ts`

```bash
grep -n "new BucketFailoverHandlerImpl" packages/cli/src/auth/oauth-manager.ts
```

**Expected**: Two instantiation sites (from technical.md):
1. In `getOAuthToken()` method (~line 991)
2. In `authenticate()` method (~line 2343)

**Actual output**:
```
(Paste grep output with line numbers here)
```

**Verification**:
- [ ] First instantiation found: Line _____ (in which method?)
- [ ] Second instantiation found: Line _____ (in which method?)
- [ ] Constructor signature matches `BucketFailoverHandlerImpl(buckets, providerName, oauthManager)`: YES / NO

**Action if mismatch**: Update technical.md with correct line numbers and method names.

---

### 2. OAuthManager Methods Used by Failover

**File**: `packages/cli/src/auth/oauth-manager.ts`

Verify these methods exist and are accessible:

```bash
# Check getOAuthToken method
grep -n "getOAuthToken.*provider.*bucket" packages/cli/src/auth/oauth-manager.ts | head -5

# Check refreshOAuthToken method
grep -n "refreshOAuthToken.*provider.*bucket" packages/cli/src/auth/oauth-manager.ts | head -5

# Check authenticate method
grep -n "authenticate.*provider.*bucket" packages/cli/src/auth/oauth-manager.ts | head -5

# Check setSessionBucket method
grep -n "setSessionBucket.*provider.*bucket" packages/cli/src/auth/oauth-manager.ts | head -5
```

**Expected**: All four methods exist and are public (or accessible to BucketFailoverHandlerImpl).

**Actual output**:
```
(Paste all four grep outputs here)
```

**Verification**:
- [ ] `getOAuthToken(provider, bucket)` exists: YES / NO (Line _____)
- [ ] `refreshOAuthToken(provider, bucket)` exists: YES / NO (Line _____)
- [ ] `authenticate(provider, bucket)` exists: YES / NO (Line _____)
- [ ] `setSessionBucket(provider, bucket)` exists: YES / NO (Line _____)

**Action if missing**: STOP. Cannot proceed without these methods.

---

## Test Infrastructure Verification

### 1. BucketFailoverHandlerImpl Test File

```bash
ls -la packages/cli/src/auth/BucketFailoverHandlerImpl.spec.ts
```

**Expected**: File exists with Vitest tests.

**Actual output**:
```
(Paste ls output here)
```

**Verification**:
- [ ] Test file exists: YES / NO
- [ ] Uses Vitest (`import { describe, it, expect, vi } from 'vitest'`): YES / NO

**Test pattern verification**:
```bash
grep "describe\|it(" packages/cli/src/auth/BucketFailoverHandlerImpl.spec.ts | head -10
```

**Actual output**:
```
(Paste test patterns here)
```

**Verification**:
- [ ] Vitest patterns found: YES / NO
- [ ] Tests executable via `npm test`: YES / NO

---

### 2. RetryOrchestrator Test File

```bash
ls -la packages/core/src/providers/__tests__/RetryOrchestrator.test.ts
```

**Expected**: File exists (or can be created).

**Actual output**:
```
(Paste ls output here)
```

**Verification**:
- [ ] Test file exists: YES / NO
- [ ] If missing, can create: YES / NO

---

### 3. Test Execution Verification

```bash
# Run existing BucketFailoverHandler tests
npm test -- packages/cli/src/auth/BucketFailoverHandlerImpl.spec.ts
```

**Expected**: Tests run successfully (may pass or fail, but framework works).

**Actual output** (first 20 lines):
```
(Paste test output here)
```

**Verification**:
- [ ] Test framework works: YES / NO
- [ ] No import errors: YES / NO
- [ ] Tests executable: YES / NO

---

## Architecture Verification

### 1. Token Field Name (CRITICAL)

From multiple sources, verify the actual field name used for token expiration:

```bash
# Check OAuthToken usage in codebase
grep -r "token\.expiry\|token\.expiresAt" packages/cli/src/auth/ --include="*.ts" | head -10
```

**Expected**: Code uses `token.expiry` (Unix seconds), NOT `token.expiresAt`.

**Actual output**:
```
(Paste grep results here)
```

**Verification**:
- [ ] Field name is `expiry`: YES / NO
- [ ] Field type is Unix seconds: YES / NO
- [ ] NO usage of `expiresAt`: YES / NO

**Action if `expiresAt` found**: CRITICAL ERROR. Update ALL pseudocode and documentation to use correct field name.

---

### 2. scheduleProactiveRenewal Bug Location

**File**: `packages/cli/src/auth/oauth-manager.ts`

```bash
grep -n -A 20 "scheduleProactiveRenewal" packages/cli/src/auth/oauth-manager.ts | grep -A 20 "function scheduleProactiveRenewal\|scheduleProactiveRenewal.*providerName"
```

**Expected**: Function exists and has bug with condition checking.

**Actual output**:
```
(Paste function definition here)
```

**Verification**:
- [ ] Function found: YES / NO (Line _____)
- [ ] Bug exists (checks expiry before lifetime): YES / NO
- [ ] Function signature matches `scheduleProactiveRenewal(providerName, bucket, token)`: YES / NO

---

## Blocking Issues Found

(List any critical issues that prevent plan execution)

### Issue 1: (if any)
- **Component**: _____
- **Problem**: _____
- **Impact**: _____
- **Resolution Required**: _____

### Issue 2: (if any)
- **Component**: _____
- **Problem**: _____
- **Impact**: _____
- **Resolution Required**: _____

---

## Preflight Verification Summary

### Dependencies
- [ ] All required dependencies installed and correct versions
- [ ] No missing packages

### Types
- [ ] BucketFailoverHandler interface exists and matches assumptions
- [ ] OAuthToken type exists with `expiry` field (NOT `expiresAt`)
- [ ] AllBucketsExhaustedError constructor signature known
- [ ] FailoverContext type does NOT exist yet (will be created)

### Call Paths
- [ ] BucketFailoverHandlerImpl instantiation sites identified
- [ ] OAuthManager methods accessible from BucketFailoverHandlerImpl
- [ ] RetryOrchestrator error handling location identified

### Test Infrastructure
- [ ] BucketFailoverHandlerImpl.spec.ts exists and runs
- [ ] RetryOrchestrator test file location known
- [ ] Test framework (Vitest) works correctly

### Critical Verifications
- [ ] Token field name is `expiry` (NOT `expiresAt`)
- [ ] scheduleProactiveRenewal bug location identified
- [ ] NO circular import issues anticipated

---

## Decision Gate

**Can proceed to Phase 01 (Analysis)?**

- [ ] YES — All verifications passed, no blocking issues
- [ ] NO — Blocking issues found (see list above)

**If NO**: STOP. Resolve all blocking issues before proceeding. Update plan documents to reflect actual codebase state.

**If YES**: Proceed to Phase 01 (Domain Analysis).

---

## Preflight Completion Marker

**Date Completed**: _____  
**Completed By**: _____  
**Blocking Issues**: (none / see list above)  
**Next Phase**: Phase 01 (Domain Analysis)

**Files Created**:
- (none — verification only)

**Files Modified**:
- (none — verification only)

**Verification Output** (save for reference):
```
(Optionally paste full verification script output here)
```
