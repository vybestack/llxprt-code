# Phase P08: Core Integration — RED Tests

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: TDD Tests
Prerequisites: P07a (confirmation bus verified)

## Purpose

Write behavioral RED tests for core integration. These tests verify that core can import from `@vybestack/llxprt-code-policy` and that backward compatibility is maintained. Because `packages/policy` is already a registered workspace package by this phase, direct imports from `@vybestack/llxprt-code-policy` may resolve even before core declares an explicit dependency. RED tests must fail on **missing package manifest dependency**, **missing re-export shims**, **broken alias identity**, or **missing integration behavior** — NOT on import-resolution failure. Tests must contain full behavioral assertions (runtime identity checks, enum value checks, functional behavior) so they remain behavioral tests when GREEN.

## Worker / Verifier Assignment

- **Worker**: typescriptexpert (writes integration RED tests)
- **Verifier**: typescriptreviewer (verifies RED state in P08a)

## Expanded Requirements

- Tests verify core can import PolicyEngine, MessageBus, types from `@vybestack/llxprt-code-policy`
- Tests verify backward compatibility: existing `@vybestack/llxprt-code-core` imports still work
- Tests verify re-export shims produce correct values
- Tests verify `createPolicyEngineConfig` and `createPolicyUpdater` still work from core
- Tests verify `ToolConfirmationOutcome` alias resolves correctly
- Tests verify `ConfirmationPayload` alias resolves correctly
- **RED mechanism**: Tests must assert one or more of the following:
  - Core's `package.json` has `@vybestack/llxprt-code-policy` in `dependencies` or `devDependencies` (fails: not added yet)
  - Core's `policy/index.ts` re-exports from `@vybestack/llxprt-code-policy` (fails: still old barrel)
  - Core's `confirmation-bus/index.ts` re-exports from `@vybestack/llxprt-code-policy` (fails: still old barrel)
  - Core's `tools/tool-confirmation-types.ts` re-exports aliases (fails: still old types)
  - `ToolConfirmationOutcome` is an alias for `ConfirmationOutcome` (fails: no re-export shim)
  - Backward-compat runtime values exported from `@vybestack/llxprt-code-core` match `@vybestack/llxprt-code-policy` (fails: shims not in place)

## @plan / @requirement Marker Requirements

Every test file and test case created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260609-ISSUE1591.P08
 * @requirement REQ-006
 */
```

Marker mapping:
- Import from policy package tests: `@requirement REQ-006.1`–`REQ-006.3`
- Backward compat alias tests: `@requirement REQ-006.5`
- createPolicyEngineConfig/createPolicyUpdater tests: `@requirement REQ-006.4`

## Exact File Tasks

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/policy/integration-policy-package.test.ts` | CREATE | Tests for policy package integration with core |

### Test Coverage Requirements

**integration-policy-package.test.ts** (`@requirement REQ-006`):
- `PolicyEngine` importable from `@vybestack/llxprt-code-policy`
- `MessageBus` importable from `@vybestack/llxprt-code-policy`
- `PolicyDecision` enum values match expectations
- `ConfirmationOutcome` has all 8 values
- `ToolConfirmationOutcome` alias resolves to `ConfirmationOutcome` (asserted via runtime identity)
- `ConfirmationPayload` type alias resolves
- `ToolConfirmationPayload` type alias resolves
- `PolicyFunctionCall` interface accepts correct shape
- `PolicyToolCallState` interface accepts correct shape
- `ToolCallsUpdateMessage<T>` is generic
- `PolicyLogger` interface is correct
- `PolicyPathResolver` interface is correct
- Core re-exports match: `@vybestack/llxprt-code-core` still exports `PolicyEngine`
- `createPolicyEngineConfig` still importable from `@vybestack/llxprt-code-core`
- `createPolicyUpdater` still importable from `@vybestack/llxprt-code-core`
- `loadDefaultPolicies()` returns expected rule count
- **Manifest dependency check**: core's `package.json` lists `@vybestack/llxprt-code-policy` in dependencies
- **Re-export shim check**: core's `policy/index.ts` re-exports from `@vybestack/llxprt-code-policy`
- **Re-export shim check**: core's `confirmation-bus/index.ts` re-exports from `@vybestack/llxprt-code-policy`
- **Re-export shim check**: core's `tools/tool-confirmation-types.ts` re-exports aliases

## Verification Commands

```bash
# Tests must FAIL (core hasn't added policy dep, re-export shims, or manifest entries yet)
npm run test --workspace @vybestack/llxprt-code-core -- --testNamePattern="policy-package" 2>&1 | rg -i "fail|error|AssertionError"
# Expected: assertion failures (manifest dep missing, re-export shims not in place, alias identity broken)

# Verify test file exists
ls packages/core/src/policy/integration-policy-package.test.ts

# Verify @plan markers
rg "@plan.*PLAN-20260609-ISSUE1591\.P08" packages/core/src/policy/integration-policy-package.test.ts --count
# Expected: 1+ matches

# Verify @requirement markers
rg "@requirement:REQ-006" packages/core/src/policy/integration-policy-package.test.ts --count
# Expected: 1+ matches
```

## Success Criteria

- [ ] Integration test file created in core
- [ ] Tests fail because core hasn't added manifest dep, re-export shims, or alias entries (RED state)
- [ ] RED failure is NOT import-resolution failure (policy package already resolves from workspace)
- [ ] Tests cover backward compatibility (ToolConfirmationOutcome alias, etc.)
- [ ] Tests verify createPolicyEngineConfig/createPolicyUpdater still work from core
- [ ] Tests verify PolicyFunctionCall, PolicyToolCallState, ToolCallsUpdateMessage<T>
- [ ] Tests include manifest dependency assertion (core package.json has policy dep)
- [ ] Tests include re-export shim assertions (barrel files re-export from policy)
- [ ] Test count matches coverage requirements (18+ test cases)
- [ ] @plan markers present
- [ ] @requirement markers map to REQ-006

## Failure Recovery

If tests pass immediately — they may be importing from existing core paths or policy package resolves via workspace. Ensure they assert manifest dependency presence, re-export shim content, or alias runtime identity so they fail when core hasn't been wired yet.
