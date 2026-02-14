# Phase 07: Thin Wrapper Contract Tests

## Phase ID

`PLAN-20260211-SECURESTORE.P07`

## Prerequisites

- Required: Phase 06a completed
- Verification: `ls .completed/P06a.md`
- Expected files: `packages/core/src/storage/secure-store.ts` (implemented)

## Requirements Implemented (Expanded)

### R7.6: Contract Tests for Thin Wrappers

**Full Text**: Each surviving refactored thin wrapper (ToolKeyStorage, KeychainTokenStorage, ExtensionSettingsStorage) shall pass contract tests proving identical observable behavior to the original implementation.
**Behavior**:
- GIVEN: Existing test suites for ToolKeyStorage and KeychainTokenStorage
- WHEN: The wrappers are refactored to use SecureStore
- THEN: All existing tests continue to pass, proving behavioral equivalence
**Why This Matters**: Refactoring must not break existing consumers.

### R7A.1: Behavioral Delta Audit (continued from P02)

**Full Text**: Intentional behavioral differences shall be preserved in the thin wrappers.
**Behavior**:
- GIVEN: Documented behavioral differences from P02 analysis
- WHEN: Contract tests are written
- THEN: Tests verify that intentional differences are preserved

### R7C.1: Legacy Data Startup Messaging

**Full Text**: When SecureStore detects an unreadable fallback file at a path previously used by a legacy implementation, it shall emit a user-facing message with actionable remediation.
**Behavior**:
- GIVEN: A legacy .key file exists in the ToolKeyStorage directory
- WHEN: SecureStore tries to read it
- THEN: CORRUPT error with remediation message is thrown

## Implementation Tasks

### Contract Test Strategy

The existing test suites serve as contract tests. This phase adds:

1. **Integration tests** that verify ToolKeyStorage → SecureStore wiring
2. **Integration tests** that verify KeychainTokenStorage → SecureStore wiring
3. **Integration tests** that verify ExtensionSettingsStorage → SecureStore wiring
4. **Legacy format detection tests** for R7C.1

### Files to Create

- `packages/core/src/storage/secure-store-integration.test.ts` — Integration tests
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P07`
  - Tests that verify SecureStore works correctly when used by thin wrappers
  - Tests for legacy format file detection

### Files to Verify (NOT modify)

- `packages/core/src/tools/tool-key-storage.test.ts` — Must continue passing post-refactoring
- `packages/core/src/mcp/token-storage/keychain-token-storage.test.ts` (if exists) — Must continue passing

### Required Tests

#### ToolKeyStorage Contract Tests
1. saveKey stores and retrieves via SecureStore backend
2. getKey retrieves from SecureStore
3. deleteKey removes from SecureStore
4. hasKey delegates to SecureStore
5. resolveKey chain works with SecureStore backend
6. Registry validation still enforced
7. Keyfile operations unchanged

#### KeychainTokenStorage Contract Tests
8. setCredentials stores JSON-serialized credentials via SecureStore
9. getCredentials retrieves and deserializes from SecureStore
10. sanitizeServerName still applied
11. validateCredentials still enforced
12. listServers works via SecureStore.list()

#### ExtensionSettingsStorage Contract Tests
13. Sensitive settings stored via SecureStore
14. Non-sensitive settings still use .env files
15. Service name formatting preserved

#### Legacy Format Detection (R7C.1)
16. Old ToolKeyStorage .key format file → CORRUPT error with remediation
17. Old FileTokenStorage format → CORRUPT error with remediation

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P07
 * @requirement R7.6
 */
```

## Verification Commands

```bash
# 1. Integration test file created
ls packages/core/src/storage/secure-store-integration.test.ts

# 2. Plan markers
grep -c "@plan.*SECURESTORE.P07" packages/core/src/storage/secure-store-integration.test.ts
# Expected: 3+

# 3. Test count
grep -c "it(" packages/core/src/storage/secure-store-integration.test.ts
# Expected: 15+

# 4. Existing test suites still pass
npm test -- packages/core/src/tools/tool-key-storage.test.ts
# Expected: ALL PASS (existing tests unchanged)

# 5. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/storage/secure-store-integration.test.ts
# Expected: 0
```

## Structural Verification Checklist

- [ ] Integration test file created
- [ ] 15+ contract tests
- [ ] Existing tool-key-storage tests unchanged and passing
- [ ] Plan markers present
- [ ] No mock theater

## Semantic Verification Checklist (MANDATORY)

1. **Do contract tests verify observable behavior?**
   - [ ] Tests check actual stored/retrieved values
   - [ ] Tests verify error messages match current behavior
   - [ ] Tests verify data format compatibility

2. **Are intentional behavioral differences preserved?**
   - [ ] ToolKeyStorage serialization (raw strings)
   - [ ] KeychainTokenStorage serialization (JSON)
   - [ ] ExtensionSettingsStorage no-fallback behavior

## Failure Recovery

1. `git checkout -- packages/core/src/storage/secure-store-integration.test.ts`
2. Re-run Phase 07

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P07.md`
