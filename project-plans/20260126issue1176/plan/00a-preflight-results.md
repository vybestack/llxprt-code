# Phase 0.5: Preflight Verification Results

## Execution Summary
**Date**: 2026-01-26  
**Status**: [OK] PASSED - All call paths verified, proceed with implementation

---

## 1. DEPENDENCY CHECK

### msw (Mock Service Worker)
```bash
grep -r "msw" packages/core/package.json
# Exit code: 1 (not found)
```
**Status**: [ERROR] **MISSING**  
**Impact**: Required for behavioral HTTP request testing  
**Action**: Add `msw` to `packages/core/package.json` devDependencies

### vitest (Test Runner)
```bash
grep -r "vitest" packages/core/package.json
# Output:
packages/core/package.json:    "test": "vitest run",
packages/core/package.json:    "test:ci": "vitest run",
packages/core/package.json:    "vitest": "^3.1.1"
```
**Status**: [OK] **PRESENT**  
**Version**: 3.1.1

---

## 2. TYPE CHECK

### RuntimeInvocationContext Interface
```bash
grep -A 20 "interface RuntimeInvocationContext" packages/core/src/runtime/RuntimeInvocationContext.ts
```

**Status**: [OK] **EXISTS**  
**Current Fields**:
- [OK] `runtimeId: string`
- [OK] `metadata: Readonly<Record<string, unknown>>`
- [OK] `settings: SettingsService`
- [OK] `ephemerals: Readonly<Record<string, unknown>>`
- [OK] `telemetry?: ProviderTelemetryContext`
- [OK] `userMemory?: string`
- [OK] `redaction?: Readonly<RedactionConfig>`
- [OK] `getEphemeral<T>(key: string): T | undefined`
- [OK] `getProviderOverrides<T>(providerName: string): T | undefined`

**Missing Fields** (to be added):
- [ERROR] `cliSettings: Readonly<Record<string, unknown>>`
- [ERROR] `modelBehavior: Readonly<Record<string, unknown>>`
- [ERROR] `modelParams: Readonly<Record<string, unknown>>`
- [ERROR] `customHeaders: Readonly<Record<string, string>>`
- [ERROR] `getCliSetting<T>(key: string): T | undefined`
- [ERROR] `getModelBehavior<T>(key: string): T | undefined`
- [ERROR] `getModelParam<T>(key: string): T | undefined`

### EphemeralSettings Type
```bash
grep -A 10 "EphemeralSettings" packages/core/src/types/modelParams.ts
```

**Status**: [OK] **EXISTS**  
**Current Definition**: Interface with CLI settings like `context-limit`, `compression-threshold`, `auth-key`, etc.

**Action Required**: Replace with registry-generated type after registry is created.

---

## 3. CALL PATH CHECK

### buildEphemeralsSnapshot (ProviderManager)
```bash
grep -n "buildEphemeralsSnapshot" packages/core/src/providers/ProviderManager.ts
# Line 628: ephemeralsSnapshot: this.buildEphemeralsSnapshot(
# Line 650: private buildEphemeralsSnapshot(
```
**Status**: [OK] **EXISTS** at line 650  
**Usage**: Called at line 628 during context creation

### filterOpenAIRequestParams (OpenAI)
```bash
grep -n "filterOpenAIRequestParams" packages/core/src/providers/openai/openaiRequestParams.ts
# Line 87: export function filterOpenAIRequestParams(
```
**Status**: [OK] **EXISTS** at line 87  
**Action**: Will be DELETED after registry migration (logic moves to registry)

### getModelParams (AnthropicProvider)
```bash
grep -n "getModelParams" packages/core/src/providers/anthropic/AnthropicProvider.ts
# Line 588: override getModelParams(): Record<string, unknown> | undefined {
```
**Status**: [OK] **EXISTS** at line 588  
**Action**: Will be UPDATED to use separated fields

### getModelParams (OpenAIProvider)
```bash
grep -n "getModelParams" packages/core/src/providers/openai/OpenAIProvider.ts
# Line 3032: override getModelParams(): Record<string, unknown> | undefined {
```
**Status**: [OK] **EXISTS** at line 3032  
**Action**: Will be UPDATED to use separated fields

### getModelParams (GeminiProvider)
```bash
grep -n "getModelParams" packages/core/src/providers/gemini/GeminiProvider.ts
# Line 637: override getModelParams(): Record<string, unknown> | undefined {
```
**Status**: [OK] **EXISTS** at line 637  
**Action**: Will be UPDATED to use separated fields

### getCustomHeaders (BaseProvider)
```bash
grep -n "getCustomHeaders" packages/core/src/providers/BaseProvider.ts
# Line 1165: protected getCustomHeaders(): Record<string, string> | undefined {
```
**Status**: [OK] **EXISTS** at line 1165  
**Action**: Will be UPDATED to merge invocation.customHeaders

---

## 4. TEST INFRASTRUCTURE CHECK

### Runtime Tests Directory
```bash
ls packages/core/src/runtime/__tests__/
# AgentRuntimeState.stub.test.ts
# regression-guards.test.ts
```
**Status**: [OK] **EXISTS**  
**Test Files**: 2 existing test files

### Providers Tests Directory
```bash
ls packages/core/src/providers/__tests__/
# BaseProvider.guard.stub.test.ts
# BaseProvider.guard.test.ts
# baseProvider.stateless.test.ts
# LoadBalancingProvider.circuitbreaker.test.ts
# ... (13 test files total)
```
**Status**: [OK] **EXISTS**  
**Test Files**: 13 existing test files

### Provider-Specific Test Files
```bash
find packages/core/src/providers -name "*.test.ts" | head -10
# GeminiProvider.test.ts
# GeminiProvider.e2e.test.ts
# gemini.userMemory.test.ts
# gemini.thoughtSignature.test.ts
# gemini.stateless.test.ts
# GeminiProvider.retry.test.ts
# BaseProvider.test.ts
# multi-provider.integration.test.ts
# ProviderManager.test.ts
# toolResponsePayload.test.ts
```
**Status**: [OK] **EXISTS**  
**Test Files**: 10+ provider test files found

---

## 5. BLOCKING ISSUES

### Issue #1: Missing MSW Dependency
**Severity**: WARNING: **MEDIUM**  
**Description**: `msw` is not installed in `packages/core/package.json`  
**Impact**: Cannot write behavioral HTTP request tests without MSW  
**Resolution**:
```bash
cd packages/core
npm install --save-dev msw@latest
```

**Workaround**: Can use alternative approaches (nock, manual fetch mocking) but MSW is preferred per architecture doc.

---

## 6. VERIFICATION GATE

- [x] All dependencies verified (vitest [OK], msw [ERROR] but not blocking)
- [x] All types match expectations (RuntimeInvocationContext [OK], EphemeralSettings [OK])
- [x] All call paths are possible (all functions exist [OK])
- [x] Test infrastructure ready (test dirs exist [OK], patterns work [OK])

**Gate Status**: [OK] **PASS WITH ADVISORY**  

**Advisory**: MSW dependency should be added before writing behavioral tests, but does NOT block implementation start.

---

## 7. RECOMMENDED NEXT STEPS

### Phase 1: Create Registry (Start Here)
1. [OK] All call paths verified - safe to proceed
2. Create `packages/core/src/settings/settingsRegistry.ts`
3. Install MSW for behavioral testing: `cd packages/core && npm install --save-dev msw`
4. Write TDD tests for `resolveAlias()`, `separateSettings()`, `normalizeSetting()`
5. Implement registry functions following RED-GREEN-REFACTOR

### Phase 2: Update RuntimeInvocationContext
1. Add separated fields (`cliSettings`, `modelBehavior`, `modelParams`, `customHeaders`)
2. Add typed accessors (`getCliSetting`, `getModelBehavior`, `getModelParam`)
3. Implement backward compatibility shim for `ephemerals`
4. Write behavioral tests for snapshot semantics

### Phase 3: Provider Updates
1. Update `ProviderManager.buildEphemeralsSnapshot()` to use `separateSettings()`
2. Update each provider's `getModelParams()` to use separated fields
3. Remove `filterOpenAIRequestParams()` calls
4. Add `translateReasoningToBehavior()` to each provider
5. Write behavioral tests to verify no CLI settings leak to API

---

## 8. RISK ASSESSMENT

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| MSW missing delays testing | Medium | Low | Add dependency immediately, use alternative mocking if needed |
| Alias normalization breaks OpenAI | Low | High | Comprehensive tests for all aliases, verify against existing `filterOpenAIRequestParams` |
| Provider-scoped overrides break | Low | Medium | Test extensively with nested settings, verify merge order |
| Backward compatibility breaks tools | Low | High | Proxy shim with deprecation warnings, extensive integration tests |
| Unknown settings leak to API | Medium | High | Default to `cli-behavior` (safe), add CI validation script |

**Overall Risk Level**:  **LOW** - All critical paths verified, comprehensive testing planned

---

## 9. SIGN-OFF

**Preflight Status**: [OK] **CLEARED FOR IMPLEMENTATION**

**Approver**: LLxprt Code Agent  
**Date**: 2026-01-26  
**Recommendation**: Proceed with Phase 1 (Registry Creation) using TDD approach.

**Next Command**:
```bash
cd packages/core && npm install --save-dev msw
```

Then start RED-GREEN-REFACTOR cycle for `settingsRegistry.ts`.
