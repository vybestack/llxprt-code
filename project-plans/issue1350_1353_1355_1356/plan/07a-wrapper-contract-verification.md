# Phase 07a: Thin Wrapper Contract Test Verification

## Phase ID

`PLAN-20260211-SECURESTORE.P07a`

## Prerequisites

- Required: Phase 07 completed
- Verification: `grep -r "@plan.*SECURESTORE.P07" packages/core/src/storage/secure-store-integration.test.ts`

## Verification Commands

```bash
# 1. Integration test file exists
wc -l packages/core/src/storage/secure-store-integration.test.ts
# Expected: 200+ lines

# 2. Test count
grep -c "it(" packages/core/src/storage/secure-store-integration.test.ts
# Expected: 15+

# 3. Existing tests still pass
npm test -- packages/core/src/tools/tool-key-storage.test.ts
# Expected: ALL PASS

# 4. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/storage/secure-store-integration.test.ts
# Expected: 0

# 5. Contract tests cover all three wrappers
grep -c "ToolKeyStorage\|KeychainTokenStorage\|ExtensionSettingsStorage" packages/core/src/storage/secure-store-integration.test.ts
# Expected: 3+ (all three mentioned)

# 6. Legacy format tests present
grep -c "legacy\|CORRUPT\|\.key" packages/core/src/storage/secure-store-integration.test.ts
# Expected: 2+
```

## Semantic Verification Checklist (MANDATORY)

1. **Are all three wrapper contracts tested?**
   - [ ] ToolKeyStorage behavior preserved
   - [ ] KeychainTokenStorage behavior preserved
   - [ ] ExtensionSettingsStorage behavior preserved

2. **Is legacy format detection tested?**
   - [ ] Old .key file format → CORRUPT
   - [ ] Old mcp-oauth-tokens-v2.json format → CORRUPT

## Holistic Functionality Assessment

### What was tested?
[Describe the contract tests]

### Do they ensure behavioral equivalence?
[Explain how]

### Verdict
[PASS/FAIL]

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P07a.md`
