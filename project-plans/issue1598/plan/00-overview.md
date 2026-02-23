# Plan Overview: Bucket Failover Recovery (Issue #1598)

**Plan ID**: `PLAN-20260223-ISSUE1598`  
**Created**: 2026-02-23  
**Issue**: #1598  
**Total Phases**: 38 (19 implementation + 19 verification)

---

## Executive Summary

This plan implements intelligent bucket failover recovery for multi-key API profiles. When a bucket exhausts its quota, the system will:
1. Classify the failure reason (quota-exhausted, expired-refresh-failed, no-token, etc.)
2. Rotate to next available bucket automatically  
3. Attempt foreground reauth for expired/missing tokens
4. Report detailed failure reasons in error messages

Additionally, this plan fixes proactive token renewal to prevent mid-request expirations.

---

## Requirements Implemented

This plan implements ALL requirements from `requirements.md`:

### Proactive Renewal (REQ-1598-PR01 through PR06)
- Schedule renewal at 80% token lifetime
- Automatic rescheduling on success
- Failure tracking with 3-attempt threshold
- Timer cancellation on session reset

### Bucket Classification (REQ-1598-CL01 through CL09)
- 429 → `quota-exhausted`
- Expired + refresh fails → `expired-refresh-failed`
- No token → `no-token`
- Already tried → `skipped`
- Malformed tokens handled gracefully
- Token-store read errors logged and classified as `no-token`

### Failover Logic (REQ-1598-FL01 through FL18)
- Three sequential passes: classification, candidate search, foreground reauth
- Profile-order bucket iteration
- `setSessionBucket` failure handling
- Near-expiry token acceptance (30-second threshold)
- Single-bucket profile skip

### Foreground Reauth (REQ-1598-FR01 through FR05)
- `oauthManager.authenticate()` integration
- 5-minute timeout enforcement
- Post-reauth token validation
- Known limitation: no abort support (documented)

### Error Reporting (REQ-1598-ER01 through ER04)
- `AllBucketsExhaustedError` enhanced with `bucketFailureReasons`
- Backward-compatible constructor (optional parameter)
- Human-readable message format

### Interface Changes (REQ-1598-IC01 through IC11)
- `getLastFailoverReasons?()` method (optional)
- `FailoverContext` type with `triggeringStatus`
- `BucketFailureReason` type exported from errors.ts
- No circular imports

### State Management (REQ-1598-SM01 through SM10)
- `triedBucketsThisSession` reset at request boundaries
- `lastFailoverReasons` cleared at start of `tryFailover()`
- `reset()` clears session state and timers

---

## Phase List

### Analysis & Pseudocode
- **Phase 00**: Overview (this document)
- **Phase 00a**: Preflight Verification
- **Phase 01**: Domain Analysis → `analysis/domain-model.md`
- **Phase 01a**: Analysis Verification
- **Phase 02**: Pseudocode Development
- **Phase 02a**: Pseudocode Verification

### Bucket Classification
- **Phase 03**: Classification Stub
- **Phase 03a**: Classification Stub Verification
- **Phase 04**: Classification TDD (Behavioral Tests)
- **Phase 04a**: Classification TDD Verification
- **Phase 05**: Classification Implementation
- **Phase 05a**: Classification Implementation Verification

### Error Reporting
- **Phase 06**: Error Reporting Stub (AllBucketsExhaustedError update)
- **Phase 06a**: Error Reporting Stub Verification
- **Phase 07**: Error Reporting TDD
- **Phase 07a**: Error Reporting TDD Verification
- **Phase 08**: Error Reporting Implementation
- **Phase 08a**: Error Reporting Implementation Verification

### Foreground Reauth
- **Phase 09**: Foreground Reauth Stub
- **Phase 09a**: Foreground Reauth Stub Verification
- **Phase 10**: Foreground Reauth TDD
- **Phase 10a**: Foreground Reauth TDD Verification
- **Phase 11**: Foreground Reauth Implementation
- **Phase 11a**: Foreground Reauth Implementation Verification

### Proactive Renewal
- **Phase 12**: Proactive Renewal Stub
- **Phase 12a**: Proactive Renewal Stub Verification
- **Phase 13**: Proactive Renewal TDD
- **Phase 13a**: Proactive Renewal TDD Verification
- **Phase 14**: Proactive Renewal Implementation
- **Phase 14a**: Proactive Renewal Implementation Verification

### Integration
- **Phase 15**: Integration Stub (RetryOrchestrator wiring)
- **Phase 15a**: Integration Stub Verification
- **Phase 16**: Integration TDD (End-to-end tests)
- **Phase 16a**: Integration TDD Verification
- **Phase 17**: Integration Implementation
- **Phase 17a**: Integration Implementation Verification

### Cleanup
- **Phase 18**: Deprecation (Legacy behavior removal if any)
- **Phase 18a**: Deprecation Verification

---

## Integration Analysis (CRITICAL)

### Existing Files That WILL BE MODIFIED

1. **`packages/cli/src/auth/BucketFailoverHandlerImpl.ts`**
   - **Current**: Simple round-robin failover
   - **Change**: Complete rewrite of `tryFailover()` with three-pass algorithm
   - **Lines affected**: ~100-150 (entire tryFailover method + new state)
   - **New methods**: `getLastFailoverReasons()`
   - **New state**: `lastFailoverReasons: Record<string, BucketFailureReason>`

2. **`packages/core/src/providers/errors.ts`**
   - **Current**: `AllBucketsExhaustedError` constructor takes 3 params
   - **Change**: Add optional `bucketFailureReasons` parameter
   - **Lines affected**: ~10 (constructor signature)
   - **New exports**: `BucketFailureReason` type

3. **`packages/core/src/config/config.ts`**
   - **Current**: `BucketFailoverHandler` interface with 6 methods
   - **Change**: Add optional `getLastFailoverReasons?()` method
   - **Lines affected**: ~5 (interface definition)
   - **New types**: `FailoverContext` interface, import `BucketFailureReason`

4. **`packages/core/src/providers/RetryOrchestrator.ts`**
   - **Current**: Calls `tryFailover()` without context
   - **Change**: Pass `FailoverContext` with `triggeringStatus`, retrieve reasons
   - **Lines affected**: ~20 (error handling in retry loop)
   - **New behavior**: Construct `AllBucketsExhaustedError` with reasons

5. **`packages/cli/src/auth/oauth-manager.ts`**
   - **Current**: `scheduleProactiveRenewal()` has bug with expired tokens
   - **Change**: Fix condition to check `remainingSec > 0` AND `lifetime >= 300`
   - **Lines affected**: ~5 (scheduleProactiveRenewal function)
   - **New behavior**: Correct proactive renewal scheduling

### Existing Files with TEST MODIFICATIONS

1. **`packages/cli/src/auth/BucketFailoverHandlerImpl.spec.ts`**
   - Add tests for classification accuracy (all 5 reasons)
   - Add tests for three-pass algorithm
   - Add tests for foreground reauth flow
   - Add tests for state management (lastFailoverReasons clearing)

2. **`packages/core/src/providers/__tests__/RetryOrchestrator.test.ts`**
   - Add tests for FailoverContext passing
   - Add tests for AllBucketsExhaustedError with reasons
   - Add integration tests for end-to-end failover scenarios

3. **`packages/core/src/providers/__tests__/errors.test.ts`** (if exists, else create)
   - Add tests for AllBucketsExhaustedError backward compatibility
   - Add tests for optional bucketFailureReasons parameter

### User Access Points

**This feature is TRANSPARENT to users.** Failover happens automatically when API calls fail. The visible change is:

1. **Before**: Session breaks when first bucket exhausts quota, even with fallback buckets configured
2. **After**: Session continues seamlessly by rotating to next available bucket

**Error Message Enhancement**:
- **Before**: `AllBucketsExhaustedError: All API key buckets exhausted for anthropic`
- **After**: `AllBucketsExhaustedError: All API key buckets exhausted for anthropic` PLUS `bucketFailureReasons: { default: "quota-exhausted", claudius: "expired-refresh-failed", vybestack: "no-token" }`

---

## Dependencies & Prerequisites

### Required Dependencies (Already Present)
- Vitest (testing framework)
- `@vybestack/llxprt-code-core` (internal package)
- TypeScript 5.x (strict mode)

### File Dependencies
- `packages/cli/src/auth/types.ts` (OAuthToken type)
- `packages/core/src/config/config.ts` (BucketFailoverHandler interface)
- `packages/core/src/providers/errors.ts` (error classes)
- `packages/core/src/providers/RetryOrchestrator.ts` (retry logic)

### Type Dependencies
- `OAuthToken` from `packages/cli/src/auth/types.ts`
- `Config` from `packages/core/src/config/config.ts`
- `BucketFailoverHandler` from `packages/core/src/config/config.ts`

---

## Risk Assessment

### High Risk
- **Multi-pass failover logic complexity**: Three-pass algorithm is complex; bugs could cause infinite loops or missed buckets
- **Proactive renewal timing**: Off-by-one errors in scheduling could cause premature or missed renewals

### Medium Risk
- **State management**: `lastFailoverReasons` and `triedBucketsThisSession` must be cleared at correct times
- **Backward compatibility**: Optional parameters and methods must not break existing code

### Low Risk
- **Error reporting**: Simple data structure addition, well-isolated
- **Type exports**: No runtime behavior change

### Mitigation Strategies
1. **Comprehensive TDD**: Write tests BEFORE implementation for all scenarios
2. **Behavioral testing**: Test actual outcomes, not implementation details
3. **Integration tests**: Verify end-to-end flows with real scenarios
4. **Mutation testing**: Use Stryker to verify test quality (80%+ score required)

---

## Success Criteria

### Phase Completion
- [ ] All 38 phases completed in numerical order
- [ ] Every phase has `@plan:PLAN-20260223-ISSUE1598.P##` markers in code
- [ ] All verification phases pass semantic checks

### Functional Correctness
- [ ] Single-bucket profiles: No failover attempted (existing behavior preserved)
- [ ] Multi-bucket profiles: Rotate through all buckets on failure
- [ ] Foreground reauth: Attempted for expired/missing tokens
- [ ] Proactive renewal: Scheduled correctly for tokens with lifetime > 5min
- [ ] Error reporting: `AllBucketsExhaustedError` includes detailed reasons

### Test Coverage
- [ ] 100% line coverage for modified code
- [ ] 80%+ mutation score (Stryker)
- [ ] All behavioral scenarios tested (no mock theater)
- [ ] Integration tests verify end-to-end flows

### Code Quality
- [ ] TypeScript strict mode passes
- [ ] No linting errors
- [ ] All tests pass (`npm run test`)
- [ ] Project builds successfully (`npm run build`)
- [ ] Smoke test passes: `node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"`

---

## Failure Recovery

### If Phase N Fails
1. Review phase N verification checklist
2. Identify specific failure (structural vs semantic)
3. Roll back phase N changes: `git checkout -- <affected-files>`
4. Fix issues and re-execute phase N
5. Do NOT proceed to phase N+1 until phase N passes verification

### If Tests Fail After Implementation
1. Check for reverse testing (tests expecting NotYetImplemented)
2. Check for mock theater (tests only verifying mock calls)
3. Check for structure-only tests (tests only checking object shape)
4. Rewrite tests to verify BEHAVIORAL outcomes
5. Re-run implementation phase

### If Integration Fails
1. Verify all components implement contracts from pseudocode
2. Check for missing error handling
3. Trace data flow through all components
4. Add missing integration tests
5. Re-execute integration phase

---

## Execution Tracker

See `execution-tracker.md` for detailed phase-by-phase tracking with timestamps, verification results, and notes.

---

## References

- **Functional Spec**: `specification.md` (copied from overview.md)
- **Technical Spec**: `technical.md`
- **Requirements**: `requirements.md` (EARS format)
- **Domain Model**: `analysis/domain-model.md`
- **Pseudocode**: `analysis/pseudocode/*.md`
- **Development Rules**: `../../dev-docs/RULES.md`
- **Plan Template**: `../../dev-docs/PLAN-TEMPLATE.md`
- **Plan Creation Guide**: `../../dev-docs/PLAN.md`

---

## Notes for Implementers

1. **Follow pseudocode EXACTLY**: Every implementation phase MUST reference pseudocode line numbers
2. **NO mock theater**: Tests must verify actual behavior, not mock configuration
3. **Behavioral tests FIRST**: Write TDD tests that fail naturally (not with NotYetImplemented checks)
4. **Semantic verification**: Verify features WORK, not just that files exist
5. **One feature at a time**: Complete all phases for classification before moving to error reporting
6. **Integration is NOT optional**: Plan includes explicit integration phases — DO THEM

---

## Approval

- [ ] Architect reviewed and approved plan structure
- [ ] Requirements fully mapped to phases
- [ ] Integration analysis complete
- [ ] Pseudocode reviewed for algorithm correctness
- [ ] Ready for phase 00a (preflight verification)
