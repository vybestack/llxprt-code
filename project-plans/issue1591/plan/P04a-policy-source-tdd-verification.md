# Phase P04a: Policy Source TDD Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P04 (RED tests written)

## Purpose

Verify that the RED tests are properly structured — they fail because skeleton stubs return wrong behavioral values (not because of import-resolution failures or test bugs). Confirm test coverage, behavioral assertions, and marker compliance.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (verifies RED test quality)
- **Verifier**: deepthinker (confirms semantic correctness of test design)

## Expanded Requirements

- Confirm tests fail due to wrong behavioral values from skeleton stubs, not due to test bugs or import errors
- Confirm imports resolve (skeleton stubs from P03b make them resolvable)
- Confirm test coverage matches the plan's requirements
- Confirm no forbidden imports in test files
- Confirm no mock theater
- Confirm test infrastructure (vitest config, setup) works correctly
- Confirm skeleton stubs exist and resolve imports (P03b completed)
- Confirm tests contain behavioral assertions (expected outputs, decisions, values) not just import gates

## @plan / @requirement Marker Verification

Verify that all test files include proper markers:

```bash
# Check @plan markers
rg "@plan.*PLAN-20260609-ISSUE1591\.P04" packages/policy/src -g '*.test.ts' --count
# Expected: 5+ files with markers

# Check @requirement markers
rg "@requirement:REQ-002" packages/policy/src -g '*.test.ts' --count
# Expected: 4+ files
rg "@requirement:REQ-004" packages/policy/src -g '*.test.ts' --count
# Expected: 1+ files
```

## Exact File Tasks

None (verification only).

## Verification Commands

```bash
# 1. Tests must fail (RED state)
npm run test --workspace @vybestack/llxprt-code-policy 2>&1
# Expected: assertion failures (wrong values from skeletons)

# 2. Verify failure reason — must be assertion failures, NOT import resolution
npm run test --workspace @vybestack/llxprt-code-policy 2>&1 | rg -i "AssertionError|expected|received"
# Expected: assertion failures (null !== ALLOW, 0 !== expected_count, etc.)
# NOT: "cannot find module" (skeletons make imports resolve)

# 3. Verify skeleton stubs exist (imports should resolve)
ls packages/policy/src/types.ts packages/policy/src/policy-engine.ts packages/policy/src/stable-stringify.ts packages/policy/src/utils.ts packages/policy/src/toml-loader.ts packages/policy/src/config.ts 2>&1
# Expected: all files exist (P03b skeletons)

# 4. Verify no forbidden imports
rg "@vybestack/llxprt-code-core|@google/genai|@vybestack/llxprt-code-telemetry" packages/policy/src -g '*.test.ts'
# Expected: zero matches

# 5. Verify no mock theater
rg "toThrow.*NotYetImplemented|vi\.mock|jest\.mock" packages/policy/src -g '*.test.ts'
# Expected: zero matches

# 6. Verify test count
rg "it\(|test\(" packages/policy/src -g '*.test.ts' --count
# Expected: matches coverage requirements (20+ test cases across 5 files)

# 7. Verify vitest config resolves correctly
npm run test --workspace @vybestack/llxprt-code-policy -- --reporter=verbose 2>&1 | head -20

# 8. Verify @plan markers present
rg "@plan.*PLAN-20260609-ISSUE1591\.P04" packages/policy/src -g '*.test.ts' --count
# Expected: 5+ matches
```

## Success Criteria

- [ ] Tests fail due to wrong behavioral values from skeleton stubs (assertion failures)
- [ ] RED failure is NOT import-resolution failure (skeletons make imports resolve)
- [ ] Zero forbidden imports in all test files
- [ ] Zero mock theater (no NotYetImplemented, no vi.mock)
- [ ] Test count matches coverage requirements (at least 20+ test cases across 5 files)
- [ ] Vitest config resolves correctly (test discovery works)
- [ ] All test files use behavioral assertions (verify outputs, not structure)
- [ ] @plan markers present in all 5 test files
- [ ] @requirement markers map to REQ-002, REQ-004

## Failure Recovery

1. If tests fail due to import errors (not behavioral assertions) — check that P03b skeletons exist and resolve
2. If forbidden imports found in tests — replace with policy-local imports
3. If mock theater found — rewrite as behavioral tests
4. If skeleton stubs missing — run P03b first
5. If test infrastructure broken — check vitest.config.ts setup
6. Do NOT proceed to P05 until RED state is clean and confirmed (behavioral assertion failures)
