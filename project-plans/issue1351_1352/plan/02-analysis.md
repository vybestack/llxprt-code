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
