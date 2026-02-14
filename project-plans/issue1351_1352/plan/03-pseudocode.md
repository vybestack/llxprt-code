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
