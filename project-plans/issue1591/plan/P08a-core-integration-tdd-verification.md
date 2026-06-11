# Phase P08a: Core Integration TDD Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P08 (core integration RED tests written)

## Purpose

Verify RED tests for core integration are properly structured — they fail for the right reason and cover all backward compatibility requirements.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (verifies RED test quality)
- **Verifier**: deepthinker (confirms coverage completeness)

## Exact File Tasks

None (verification only).

## @plan / @requirement Marker Verification

```bash
rg "@plan.*PLAN-20260609-ISSUE1591\.P08" packages/core/src/policy/integration-policy-package.test.ts --count
# Expected: 1+ matches

rg "@requirement:REQ-006" packages/core/src/policy/integration-policy-package.test.ts --count
# Expected: 1+ matches
```

## Verification Commands

```bash
# 1. Tests must fail (RED state)
npm run test --workspace @vybestack/llxprt-code-core -- --testNamePattern="policy-package" 2>&1
# Expected: failures

# 2. Verify failure reason — must be assertion failures, not import resolution
npm run test --workspace @vybestack/llxprt-code-core -- --testNamePattern="policy-package" 2>&1 | rg -i "AssertionError|expected|fail|error"
# Expected: assertion failures (manifest dep missing, re-export not in place, alias broken)
# NOT: "cannot find module" (policy package resolves via workspace)

# 3. Verify test coverage completeness
rg -c "it\(|test\(" packages/core/src/policy/integration-policy-package.test.ts
# Expected: 18+ test cases

# 4. Verify backward compat tests present
rg "ToolConfirmationOutcome|ToolConfirmationPayload|createPolicyEngineConfig|createPolicyUpdater" packages/core/src/policy/integration-policy-package.test.ts
# Expected: all present

# 5. Verify manifest/shim assertions present
rg "package\.json|dependencies|re-export|from.*@vybestack/llxprt-code-policy" packages/core/src/policy/integration-policy-package.test.ts
# Expected: present (tests assert manifest dep and re-export shim content)
```

## Success Criteria

- [ ] Tests fail due to missing manifest dependency, missing re-export shims, or broken alias identity (RED state)
- [ ] RED failure is NOT import-resolution failure (policy package already resolves from workspace)
- [ ] 18+ test cases covering backward compatibility
- [ ] Tests for ToolConfirmationOutcome/ToolConfirmationPayload aliases
- [ ] Tests for createPolicyEngineConfig/createPolicyUpdater from core
- [ ] Tests for PolicyFunctionCall, PolicyToolCallState, ToolCallsUpdateMessage<T>
- [ ] Tests assert manifest dependency presence (core package.json has policy dep)
- [ ] Tests assert re-export shim content (barrel files re-export from policy)
- [ ] @plan markers present
- [ ] @requirement markers map to REQ-006

## Failure Recovery

1. If tests fail for wrong reason — fix test structure
2. If backward compat tests missing — add them
3. Do NOT proceed to P09 until RED state is confirmed
