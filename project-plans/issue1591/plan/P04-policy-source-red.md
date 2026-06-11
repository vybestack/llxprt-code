# Phase P04: Policy Source — RED Tests

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: TDD Tests
Prerequisites: P03b (skeleton stubs in place)

## Purpose

Write behavioral RED tests for the policy source extraction. Skeleton stubs from P03b are in place — imports resolve but produce wrong behavioral results (null decisions, empty arrays, placeholder values). Tests must fail on **behavioral assertions** (wrong return values, missing enum members, incorrect rule counts), NOT import-resolution failures.

## Worker / Verifier Assignment

- **Worker**: typescriptexpert (writes RED tests)
- **Verifier**: typescriptreviewer (verifies RED state in P04a)

## Expanded Requirements

- Tests import from `packages/policy/src/` paths — these resolve because P03b skeleton stubs exist
- Tests must fail on **behavioral assertions** because skeleton stubs return wrong values (null decisions, empty arrays, placeholder enum values)
- Tests must NOT import from `@vybestack/llxprt-code-core` or `@google/genai`
- **No mock theater** — tests verify real behavior with real TOML files (which don't exist in policy package yet — TOML loading returns empty)
- Tests cover: PolicyEngine evaluation, TOML loading, stable-stringify, utils, config utilities
- Tests assert specific expected values: `PolicyDecision.ALLOW`, exact rule counts, deterministic string output

## @plan / @requirement Marker Requirements

Every test file and test case created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260609-ISSUE1591.P04
 * @requirement REQ-002
 */
```

Each test case must include markers in the test description or comments:

```typescript
it('evaluate() returns ALLOW for matching ALLOW rule @plan:PLAN-20260609-ISSUE1591.P04 @requirement:REQ-002.2', () => { ... });
```

## Exact File Tasks

| File | Action | Description |
|------|--------|-------------|
| `packages/policy/src/policy-engine.test.ts` | CREATE | Behavioral tests for PolicyEngine.evaluate() |
| `packages/policy/src/stable-stringify.test.ts` | CREATE | Tests for deterministic JSON serialization |
| `packages/policy/src/utils.test.ts` | CREATE | Tests for escapeRegex, buildArgsPatterns |
| `packages/policy/src/toml-loader.test.ts` | CREATE | Tests for TOML loading, validation, error handling |
| `packages/policy/src/config.test.ts` | CREATE | Tests for getPolicyDirectories, getPolicyTier, formatPolicyError, migrateLegacyApprovalMode |

### Test Coverage Requirements

**policy-engine.test.ts** (`@requirement REQ-002.2`):
- `evaluate()` returns `ALLOW` for matching ALLOW rule
- `evaluate()` returns `DENY` for matching DENY rule
- `evaluate()` returns `ASK_USER` for no matching rule
- Shell command validation: compound commands split and evaluated
- Server name validation: spoofing detection
- Priority: higher-priority rules override lower-priority
- Redirection: DENY when `allowRedirection` is false

**stable-stringify.test.ts** (`@requirement REQ-002.3`):
- Deterministic key ordering across runs
- Handles nested objects
- Handles arrays
- Handles null, undefined, boolean, number types

**utils.test.ts** (`@requirement REQ-002.4`):
- `escapeRegex()` escapes special regex characters
- `buildArgsPatterns()` produces correct patterns

**toml-loader.test.ts** (`@requirement REQ-002.5`):
- `loadPoliciesFromToml()` loads valid TOML and returns PolicyRule[]
- `loadPoliciesFromToml()` returns errors for invalid TOML syntax
- `loadPoliciesFromToml()` validates schema (missing required fields)
- `loadDefaultPolicies()` loads all bundled default policies
- Priority transformation: tier + rawPriority/1000
- **Source+dist TOML load behavioral test**: `loadDefaultPolicies()` returns expected rule count and priority values documented in this phase

**config.test.ts** (`@requirement REQ-004.1`):
- `getPolicyDirectories(userDir, adminDir)` returns correct directory list
- `getPolicyTier(dir, userDir, adminDir)` returns correct tier value
- `formatPolicyError()` formats error messages
- `migrateLegacyApprovalMode()` converts legacy config to PolicyRule[]

## Verification Commands

```bash
# Tests must FAIL (skeleton stubs return wrong values — behavioral RED)
npm run test --workspace @vybestack/llxprt-code-policy 2>&1 | rg -i "fail|AssertionError|expected"
# Expected: assertion failures (null decisions, empty arrays, wrong values)
# NOT: "cannot find module" (skeleton stubs resolve imports)

# Verify imports resolve (skeletons in place)
node -e "
  import('./packages/policy/dist/index.js').then(m => {
    if (!m.PolicyEngine) { console.error('FAIL: PolicyEngine not exported'); process.exit(1); }
    console.log('PASS: imports resolve');
  });
"

# Verify no forbidden imports in tests
rg "@vybestack/llxprt-code-core|@google/genai|@vybestack/llxprt-code-telemetry" packages/policy/src --type ts -g '*.test.ts'
# Expected: zero matches

# Verify tests are behavioral (no mock theater)
rg "toThrow.*NotYetImplemented|vi\.mock|jest\.mock" packages/policy/src -g '*.test.ts'
# Expected: zero matches

# Verify @plan markers present
rg "@plan.*PLAN-20260609-ISSUE1591\.P04" packages/policy/src -g '*.test.ts' --count
# Expected: 5+ matches (one per test file)

# Verify @requirement markers present
rg "@requirement:REQ-002" packages/policy/src -g '*.test.ts' --count
# Expected: 4+ matches (one per policy source test file)
```

## Success Criteria

- [ ] All test files created in `packages/policy/src/`
- [ ] Tests fail because skeleton stubs return wrong behavioral values — RED state confirmed
- [ ] RED failure is NOT import-resolution failure (skeletons make imports resolve)
- [ ] Tests contain full behavioral assertions (specific expected values: decision enums, rule counts, string outputs)
- [ ] No forbidden imports in any test file
- [ ] No mock theater (no `toThrow('NotYetImplemented')`, no vi.mock for core)
- [ ] Test coverage is behavioral — verifies outputs, not structure
- [ ] All planned test cases from the coverage requirements above are written
- [ ] @plan markers present in all test files
- [ ] @requirement markers present mapping to REQ-002, REQ-004

## Failure Recovery

If tests pass immediately (not RED):
1. Skeleton stubs may be returning correct values — verify skeletons produce wrong results
2. Tests may have no assertions — add behavioral assertions with specific expected values
3. Tests may be importing from core instead of local policy paths — fix imports
4. Do NOT proceed to GREEN until RED state is confirmed (tests fail on wrong behavioral values)
