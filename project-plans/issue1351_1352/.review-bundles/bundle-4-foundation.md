# BUNDLE 4: Foundation Phases + Verification Files

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

---

# Phase 02: Domain Analysis

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P02`

## Prerequisites

- Required: Phase 01 completed (preflight verification passed)
- Verification: `test -f project-plans/issue1351_1352/.completed/P01.md`
- Expected files from previous phase: `plan/01a-preflight-verification.md` with all checks passing
- Preflight verification: Phase 01 MUST be completed before this phase

## Requirements Implemented (Expanded)

This phase produces analysis artifacts. It does not implement requirements directly, but ensures comprehensive understanding before pseudocode and implementation.

### R1.1: TokenStore Interface Implementation

**Full Text**: KeyringTokenStore shall implement the `TokenStore` interface from `packages/core/src/auth/token-store.ts`.
**Behavior**:
- GIVEN: The TokenStore interface defines 8 methods for token CRUD, listing, stats, and lock management
- WHEN: Domain analysis is performed
- THEN: The analysis documents all 8 methods, their contracts, and how KeyringTokenStore will implement each
**Why This Matters**: Understanding the full interface contract prevents partial implementations that compile but miss behaviors.

### R1.2: SecureStore Delegation

**Full Text**: KeyringTokenStore shall delegate all credential storage operations (set, get, delete, list) to a `SecureStore` instance configured with service name `llxprt-code-oauth` and fallback policy `allow`.
**Behavior**:
- GIVEN: SecureStore provides OS keyring + encrypted fallback storage
- WHEN: Domain analysis maps KeyringTokenStore operations to SecureStore
- THEN: The analysis clearly documents which SecureStore method backs each TokenStore method
**Why This Matters**: The thin-wrapper pattern must be clearly understood — KeyringTokenStore adds naming/validation/serialization but delegates all storage.

### R2.1–R2.4: Account Naming and Validation

**Full Text**: KeyringTokenStore shall map provider+bucket to `{provider}:{bucket}`, default bucket is `default`, names validated against `[a-zA-Z0-9_-]+`, invalid names throw before storage operations.
**Behavior**:
- GIVEN: Multiple providers and buckets exist
- WHEN: Domain analysis documents naming scheme
- THEN: Analysis covers naming convention, validation rules, edge cases (empty, special chars, unicode)
**Why This Matters**: Name validation is the first line of defense — all operations go through accountKey().

### R3.1–R3.3: Token Serialization

**Full Text**: saveToken validates with `OAuthTokenSchema.passthrough().parse()` and stores as JSON; getToken parses JSON and validates with passthrough; `.passthrough()` preserves provider-specific fields.
**Behavior**:
- GIVEN: Different providers have different token schemas (Codex adds account_id)
- WHEN: Domain analysis documents serialization
- THEN: Analysis explains why `.passthrough()` is critical, what fields could be lost without it
**Why This Matters**: Silent data loss on round-trip would break Codex authentication.

### R4.1–R4.4: Corrupt Token Handling

**Full Text**: Corrupt JSON → log warning + null; invalid schema → log warning + null; do NOT delete corrupt entries; SHA-256 hash in logs.
**Behavior**:
- GIVEN: Token data may become corrupt (external modification, version mismatch)
- WHEN: Domain analysis documents error handling
- THEN: Analysis covers all corruption scenarios, logging format, preservation policy
**Why This Matters**: Users need diagnosable failures, not silent data destruction.

### R8.1–R8.6, R9.1–R9.2, R10.1–R10.2: Refresh Lock Mechanism

**Full Text**: File-based advisory locks in `~/.llxprt/oauth/locks/`, exclusive write, stale detection, polling, lock file naming convention.
**Behavior**:
- GIVEN: Multiple processes may attempt concurrent token refresh
- WHEN: Domain analysis documents lock mechanism
- THEN: Analysis covers acquisition algorithm, stale detection, release semantics, naming convention
**Why This Matters**: Lock mechanism prevents double-refresh which could invalidate tokens.

## Implementation Tasks

### Files to Create

- `project-plans/issue1351_1352/analysis/domain-model.md`
  - Entity relationships (KeyringTokenStore, SecureStore, TokenStore interface)
  - State transitions (token lifecycle, lock states, corrupt token detection)
  - Business rules (7 rules covering naming, validation, error propagation)
  - Edge cases (10 cases from empty bucket to race conditions)
  - Error scenarios (6 scenarios from keyring locked to SHA-256 hashing)
  - Integration touch points (production sites, re-export sites, test files)

### Files to Modify

None — analysis phase produces only analysis artifacts.

### Required Code Markers

No code markers — analysis artifacts only. The domain model will be referenced by pseudocode and implementation phases.

## Verification Commands

### Automated Checks (Structural)

```bash
# Verify domain model was created
test -f project-plans/issue1351_1352/analysis/domain-model.md || echo "FAIL: Domain model not created"

# Verify all required sections exist
grep -c "Entity Relationships\|State Transitions\|Business Rules\|Edge Cases\|Error Scenarios\|Integration Touch Points" project-plans/issue1351_1352/analysis/domain-model.md
# Expected: 6 (one per section)

# Verify integration touch points list specific files
grep -c "runtimeContextFactory\|authCommand\|profileCommand\|providerManagerInstance" project-plans/issue1351_1352/analysis/domain-model.md
# Expected: 4+ (each file mentioned at least once)
```

### Structural Verification Checklist

- [ ] Domain model file created
- [ ] Entity relationships documented
- [ ] State transitions documented (token lifecycle, lock states)
- [ ] All 7 business rules documented
- [ ] All 10 edge cases documented
- [ ] All 6 error scenarios documented
- [ ] Integration touch points list specific files with line numbers

### Deferred Implementation Detection (MANDATORY)

N/A — this phase produces no implementation code.

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the analysis cover ALL requirements?**
   - [ ] Every requirement group (R1–R19) has corresponding analysis
   - [ ] No requirement was mentioned but not analyzed

2. **Is this REAL analysis, not template filler?**
   - [ ] Entity relationships reference actual codebase types
   - [ ] Integration touch points list real files with approximate line numbers
   - [ ] Edge cases are specific to this feature, not generic

3. **Would the pseudocode phase benefit from this analysis?**
   - [ ] Business rules are precise enough to translate to pseudocode
   - [ ] Edge cases are testable (can be converted to test cases)
   - [ ] Error scenarios have specific expected behaviors

4. **Are integration points accurate?**
   - [ ] Listed files actually contain MultiProviderTokenStore references
   - [ ] Line numbers are approximately correct
   - [ ] No production sites were missed

5. **What's MISSING?**
   - [ ] [gap 1]
   - [ ] [gap 2]

## Success Criteria

- Domain model file created with all 6 required sections
- Analysis references real codebase types and files
- Integration touch points are accurate and complete
- Edge cases are specific and testable
- No generic or template content

## Failure Recovery

If this phase fails:

1. `rm project-plans/issue1351_1352/analysis/domain-model.md`
2. Re-run Phase 02 with corrected understanding
3. Cannot proceed to Phase 03 until domain model is complete

## Phase Completion Marker

Create: `project-plans/issue1351_1352/.completed/P02.md`
Contents:

```markdown
Phase: P02
Completed: YYYY-MM-DD HH:MM
Files Created: [analysis/domain-model.md with line count]
Files Modified: [none]
Tests Added: 0
Verification: [paste of verification command outputs]
```

---

# Phase 03: Pseudocode Development

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P03`

## Prerequisites

- Required: Phase 02 completed (domain analysis)
- Verification: `test -f project-plans/issue1351_1352/.completed/P02.md`
- Expected files from previous phase: `analysis/domain-model.md`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

This phase produces pseudocode artifacts that will be referenced line-by-line during implementation. ALL requirements are covered in pseudocode.

### R1.1: TokenStore Interface Implementation

**Full Text**: KeyringTokenStore shall implement the `TokenStore` interface from `packages/core/src/auth/token-store.ts`.
**Behavior**:
- GIVEN: TokenStore defines 8 methods
- WHEN: Pseudocode is developed
- THEN: Every method has numbered pseudocode lines covering the complete algorithm
**Why This Matters**: Implementation phase must reference these line numbers — incomplete pseudocode means incomplete implementation.

### R1.2: SecureStore Delegation

**Full Text**: KeyringTokenStore shall delegate all credential storage operations to SecureStore('llxprt-code-oauth', allow).
**Behavior**:
- GIVEN: SecureStore provides the actual storage backend
- WHEN: Pseudocode documents each method
- THEN: Every storage operation explicitly shows the SecureStore call with parameters
**Why This Matters**: The thin-wrapper pattern must be clearly expressed in pseudocode to prevent over-engineering.

### R2.1–R2.4: Account Naming and Validation

**Full Text**: Account key format, default bucket, name validation regex, throw on invalid.
**Behavior**:
- GIVEN: Provider and bucket names must be validated
- WHEN: Pseudocode documents accountKey() and validateName()
- THEN: Validation logic, regex pattern, error message format, and call ordering are all numbered
**Why This Matters**: Validation is the gatekeeper — pseudocode ensures it's always called before storage operations.

### R3.1–R3.3: Token Serialization

**Full Text**: passthrough().parse() on both write and read paths.
**Behavior**:
- GIVEN: Tokens must survive round-trip through storage
- WHEN: Pseudocode documents saveToken and getToken
- THEN: Both parse calls explicitly use .passthrough() and the reason is documented
**Why This Matters**: Without pseudocode enforcing .passthrough(), implementation might use .parse() and silently lose Codex fields.

### R4.1–R4.4: Corrupt Token Handling

**Full Text**: Corrupt JSON → warning + null; invalid schema → warning + null; no deletion; SHA-256 hash in logs.
**Behavior**:
- GIVEN: getToken may encounter corrupt data
- WHEN: Pseudocode documents error handling in getToken
- THEN: Each corruption scenario has specific numbered lines with the exact behavior
**Why This Matters**: The two-layer corruption detection (JSON parse vs schema validation) must be clearly separated.

### R5.1–R5.2: Token Removal

**Full Text**: removeToken calls delete; errors are swallowed.
**Behavior**:
- GIVEN: Deletion is best-effort
- WHEN: Pseudocode documents removeToken
- THEN: Try/catch with error logging (not propagation) is explicit
**Why This Matters**: Best-effort semantics must be documented — implementation might accidentally propagate errors.

### R6.1–R6.3: Provider and Bucket Listing

**Full Text**: Parse keys, extract providers/buckets, sorted, errors → empty array.
**Behavior**:
- GIVEN: SecureStore.list() returns all account keys
- WHEN: Pseudocode documents listProviders and listBuckets
- THEN: Parsing, filtering, sorting, and error degradation are all numbered
**Why This Matters**: The key-parsing logic (split on colon) must be precise — wrong parsing breaks listing.

### R8.1–R8.6, R9.1–R9.2, R10.1–R10.2: Refresh Lock Mechanism

**Full Text**: File-based advisory locks with acquisition, stale detection, polling, release, and naming.
**Behavior**:
- GIVEN: Multiple processes may attempt concurrent refresh
- WHEN: Pseudocode documents acquireRefreshLock and releaseRefreshLock
- THEN: The complete algorithm including exclusive write, stale detection, polling interval, timeout, and lock breaking is numbered line by line
**Why This Matters**: Lock algorithms are notoriously error-prone — pseudocode prevents implementation shortcuts.

### R11.1–R12.3: Error Propagation

**Full Text**: Different error behaviors for saveToken (propagate all) vs getToken (propagate some, null for others).
**Behavior**:
- GIVEN: SecureStoreError has different codes with different semantics
- WHEN: Pseudocode documents error handling per method
- THEN: Each error code's behavior is explicitly documented per method
**Why This Matters**: Asymmetric error handling is the most common source of bugs — pseudocode makes it explicit.

## Implementation Tasks

### Files to Create

- `project-plans/issue1351_1352/analysis/pseudocode/keyring-token-store.md`
  - MUST have numbered lines (1-211+)
  - MUST include Interface Contracts section
  - MUST include Integration Points section
  - MUST include Anti-Pattern Warnings section
  - NO actual TypeScript — only numbered pseudocode

- `project-plans/issue1351_1352/analysis/pseudocode/wiring-and-elimination.md`
  - MUST have numbered lines for each wiring change
  - MUST include Interface Contracts section
  - MUST include Integration Points section
  - MUST include Anti-Pattern Warnings section

### Files to Modify

None — pseudocode phase produces only analysis artifacts.

### Required Code Markers

No code markers — pseudocode artifacts only. Line numbers will be referenced in implementation phases.

## Verification Commands

### Automated Checks (Structural)

```bash
# Verify pseudocode files exist
test -f project-plans/issue1351_1352/analysis/pseudocode/keyring-token-store.md || echo "FAIL"
test -f project-plans/issue1351_1352/analysis/pseudocode/wiring-and-elimination.md || echo "FAIL"

# Verify line numbers exist
grep -cE "^[0-9]+:" project-plans/issue1351_1352/analysis/pseudocode/keyring-token-store.md
# Expected: 200+ numbered lines

grep -cE "^[0-9]+:" project-plans/issue1351_1352/analysis/pseudocode/wiring-and-elimination.md
# Expected: 100+ numbered lines

# Verify required sections
grep -c "Interface Contracts\|Integration Points\|Anti-Pattern Warnings" project-plans/issue1351_1352/analysis/pseudocode/keyring-token-store.md
# Expected: 3

grep -c "Interface Contracts\|Integration Points\|Anti-Pattern Warnings" project-plans/issue1351_1352/analysis/pseudocode/wiring-and-elimination.md
# Expected: 3

# Verify NO actual TypeScript in pseudocode
grep -cE "^(import |export |const |let |function |class |interface )" project-plans/issue1351_1352/analysis/pseudocode/keyring-token-store.md
# Expected: 0 (only pseudocode, not TypeScript)
# NOTE: Interface Contracts section may have TypeScript-like declarations — those are acceptable as interface documentation

# Verify all TokenStore methods are covered
for method in saveToken getToken removeToken listProviders listBuckets getBucketStats acquireRefreshLock releaseRefreshLock; do
  grep -c "$method" project-plans/issue1351_1352/analysis/pseudocode/keyring-token-store.md || echo "FAIL: $method missing"
done
```

### Structural Verification Checklist

- [ ] Both pseudocode files created
- [ ] All lines numbered
- [ ] Interface Contracts sections present
- [ ] Integration Points sections present
- [ ] Anti-Pattern Warnings sections present
- [ ] No actual TypeScript in pseudocode body
- [ ] All 8 TokenStore methods covered in keyring-token-store.md
- [ ] All wiring sites covered in wiring-and-elimination.md

### Deferred Implementation Detection (MANDATORY)

N/A — this phase produces no implementation code.

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the pseudocode cover ALL requirements?**
   - [ ] R1–R12 covered in keyring-token-store.md
   - [ ] R13 covered in wiring-and-elimination.md
   - [ ] Error handling for each method documented

2. **Is this REAL pseudocode, not template filler?**
   - [ ] Algorithm steps are specific to this feature
   - [ ] Error handling distinguishes between different SecureStoreError codes
   - [ ] Lock algorithm includes stale detection, polling, timeout

3. **Can implementation reference these line numbers?**
   - [ ] Every algorithmic step has a unique line number
   - [ ] Complex methods have sufficient granularity (not one line per method)
   - [ ] Edge cases have corresponding numbered steps

4. **Are anti-pattern warnings relevant?**
   - [ ] .parse() vs .passthrough().parse() warning present
   - [ ] Raw provider name in logs warning present
   - [ ] Delete corrupt data warning present

5. **What's MISSING?**
   - [ ] [gap 1]
   - [ ] [gap 2]

## Success Criteria

- Both pseudocode files created with numbered lines
- All 3 mandatory sections present in each file
- All 8 TokenStore methods have complete algorithm pseudocode
- All wiring sites documented with file paths and change descriptions
- Anti-pattern warnings cover the known pitfalls from requirements

## Failure Recovery

If this phase fails:

1. `rm -rf project-plans/issue1351_1352/analysis/pseudocode/`
2. Re-run Phase 03 with corrected understanding
3. Cannot proceed to Phase 04 until pseudocode is complete

## Phase Completion Marker

Create: `project-plans/issue1351_1352/.completed/P03.md`
Contents:

```markdown
Phase: P03
Completed: YYYY-MM-DD HH:MM
Files Created: [keyring-token-store.md, wiring-and-elimination.md with line counts]
Files Modified: [none]
Tests Added: 0
Verification: [paste of verification command outputs]
```

---

# Execution Tracker: KeyringTokenStore & Wire as Default

Plan ID: `PLAN-20260213-KEYRINGTOKENSTORE`
Issues: #1351 (KeyringTokenStore), #1352 (Wire as Default)

## Execution Status

| Phase | ID | Title | Status | Started | Completed | Verified | Semantic? | Notes |
|---|---|---|---|---|---|---|---|---|
| 01 | P01 | Preflight Verification | [ ] | - | - | - | N/A | Verify deps, types, call paths, test infra |
| 01a | P01a | Preflight Results | [ ] | - | - | - | N/A | Record verification results |
| 02 | P02 | Domain Analysis | [ ] | - | - | - | [ ] | Entity relationships, state transitions, business rules |
| 02a | P02a | Analysis Verification | [ ] | - | - | - | [ ] | Verify analysis completeness |
| 03 | P03 | Pseudocode Development | [ ] | - | - | - | [ ] | Numbered lines, contracts, anti-patterns |
| 03a | P03a | Pseudocode Verification | [ ] | - | - | - | [ ] | Verify pseudocode coverage |
| 04 | P04 | KeyringTokenStore Stub | [ ] | - | - | - | [ ] | Compile-only skeleton |
| 04a | P04a | Stub Verification | [ ] | - | - | - | [ ] | Verify compilation, structure |
| 05 | P05 | KeyringTokenStore TDD | [ ] | - | - | - | [ ] | 40+ behavioral tests, 30% property-based |
| 05a | P05a | TDD Verification | [ ] | - | - | - | [ ] | Verify test quality, no anti-patterns |
| 06 | P06 | KeyringTokenStore Impl | [ ] | - | - | - | [ ] | Full implementation referencing pseudocode |
| 06a | P06a | Impl Verification | [ ] | - | - | - | [ ] | All tests pass, pseudocode compliance |
| 07 | P07 | Integration Stub | [ ] | - | - | - | [ ] | Update exports in core + CLI |
| 07a | P07a | Integration Stub Verification | [ ] | - | - | - | [ ] | Verify export chain |
| 08 | P08 | Integration TDD | [ ] | - | - | - | [ ] | End-to-end flow tests, concurrent process tests |
| 08a | P08a | Integration TDD Verification | [ ] | - | - | - | [ ] | Verify integration test quality |
| 09 | P09 | Integration Impl | [ ] | - | - | - | [ ] | Swap all instantiation sites |
| 09a | P09a | Integration Impl Verification | [ ] | - | - | - | [ ] | Zero legacy references, all tests pass |
| 10 | P10 | Eliminate Legacy | [ ] | - | - | - | [ ] | Delete MultiProviderTokenStore |
| 10a | P10a | Elimination Verification | [ ] | - | - | - | [ ] | Verify complete removal |
| 11 | P11 | Final Verification | [ ] | - | - | - | [ ] | Full suite, smoke test, traceability |
| 11a | P11a | Final Verification Review | [ ] | - | - | - | [ ] | Meta-verification, plan completion |

## Completion Markers

- [ ] All phases have @plan markers in code
- [ ] All requirements have @requirement markers
- [ ] Zero MultiProviderTokenStore references in codebase
- [ ] Full test suite passes
- [ ] Build succeeds
- [ ] Smoke test passes
- [ ] No phases skipped

## Key Metrics

| Metric | Target | Actual |
|---|---|---|
| Unit tests (Phase 05) | 40+ | - |
| Property-based tests | 30%+ | - |
| Integration tests (Phase 08) | 15+ | - |
| Plan markers in code | 50+ | - |
| Requirement markers in code | 30+ | - |
| Legacy references remaining | 0 | - |
| Test pass rate | 100% | - |

## File Change Summary

### Files Created
- [ ] `packages/core/src/auth/keyring-token-store.ts`
- [ ] `packages/core/src/auth/__tests__/keyring-token-store.test.ts`
- [ ] `packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts`

### Files Modified (Production)
- [ ] `packages/core/index.ts` — export swap
- [ ] `packages/core/src/auth/token-store.ts` — class deletion (interface preserved)
- [ ] `packages/cli/src/auth/types.ts` — re-export swap
- [ ] `packages/cli/src/runtime/runtimeContextFactory.ts` — instantiation swap
- [ ] `packages/cli/src/ui/commands/authCommand.ts` — instantiation swap (2 sites)
- [ ] `packages/cli/src/ui/commands/profileCommand.ts` — instantiation swap (2 sites)
- [ ] `packages/cli/src/providers/providerManagerInstance.ts` — instantiation swap
- [ ] `packages/cli/src/providers/oauth-provider-registration.ts` — type update

### Files Modified (Tests)
- [ ] `packages/cli/src/integration-tests/oauth-timing.integration.test.ts`
- [ ] `packages/cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts`
- [ ] `packages/cli/src/auth/oauth-manager-initialization.spec.ts`
- [ ] `packages/cli/src/auth/oauth-manager.refresh-race.spec.ts`
- [ ] `packages/cli/src/auth/__tests__/codex-oauth-provider.test.ts`
- [ ] `packages/cli/test/auth/gemini-oauth-fallback.test.ts`
- [ ] `packages/cli/test/ui/commands/authCommand-logout.test.ts`
- [ ] `packages/cli/src/ui/commands/__tests__/profileCommand.bucket.spec.ts`

### Files Deleted
- [ ] `packages/core/src/auth/token-store.spec.ts` (or replaced)
- [ ] `packages/core/src/auth/token-store.refresh-race.spec.ts` (or replaced)
- [ ] MultiProviderTokenStore class body (~250 lines from token-store.ts)

## Risk Log

| Risk | Mitigation | Status |
|---|---|---|
| Codex token fields lost by .parse() | Enforced .passthrough() in pseudocode + tests | Pending |
| Raw provider names in logs | SHA-256 hashing enforced in pseudocode + tests | Pending |
| Test files still import old class | Phase 09 updates all test imports | Pending |
| Lock directory missing on first use | ensureLockDir() in pseudocode + tests | Pending |
| Concurrent refresh race | File-based locks tested in Phase 05 + 08 | Pending |
