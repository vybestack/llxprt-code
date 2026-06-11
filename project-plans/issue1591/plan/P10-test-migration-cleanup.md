# Phase P10: Test Migration

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Implementation
Prerequisites: P09a (core integration verified)

## Purpose

Move policy-only tests to the policy package and update retained core test imports. No source file deletion, no CLI migration — those are separate phases (P10d, P10b/P10c).

## Worker / Verifier Assignment

- **Worker**: typescriptexpert (moves tests, updates imports)
- **Verifier**: typescriptreviewer (verifies in P10a)

## Expanded Requirements

- Move policy-only tests (policy-engine, shell-safety, toml-loader, utils, message-bus) to policy package
- Update moved test imports to use relative paths within policy package
- Keep in core: config.test.ts, persistence.test.ts, policy-helpers.test.ts, policy-updater.test.ts, integration.test.ts
- Update kept test imports to use `@vybestack/llxprt-code-policy`
- Verify all tests still pass after migration
- No source file deletion (that is P10d)
- No CLI migration (that is P10b/P10c)

## @plan / @requirement Marker Requirements

Every test file modified in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260609-ISSUE1591.P10
 * @requirement REQ-007
 */
```

Marker mapping:
- Moved test files: `@requirement REQ-007.1`–`REQ-007.5`
- Kept test files (import updates): `@requirement REQ-007.6`, `REQ-007.7`

## Exact File Tasks

### Tests to MOVE

| File | Source | Destination | Import Changes |
|------|--------|-------------|----------------|
| `policy-engine.test.ts` | `core/src/policy/` | `policy/src/` | Already moved in P05 (verify) |
| `shell-safety.test.ts` | `core/src/policy/` | `policy/src/` | Relative paths unchanged |
| `toml-loader.test.ts` | `core/src/policy/` | `policy/src/` | Relative paths unchanged |
| `utils.test.ts` | `core/src/policy/` | `policy/src/` | Relative paths unchanged |
| `message-bus.test.ts` | `core/src/confirmation-bus/` | `policy/src/confirmation-bus/` | `'../policy/policy-engine.js'` → `'../policy-engine.js'`, `'../policy/types.js'` → `'../types.js'`, `ToolConfirmationOutcome` → `ConfirmationOutcome` |

### Tests to KEEP in Core (update imports only)

| File | Reason | Import Changes |
|------|--------|---------------|
| `core/src/policy/config.test.ts` | Tests createPolicyEngineConfig (stays in core) | Types from `@vybestack/llxprt-code-policy` |
| `core/src/policy/persistence.test.ts` | Tests persistPolicyToToml (stays in core) | PolicyEngine, types from `@vybestack/llxprt-code-policy` |
| `core/src/policy/policy-helpers.test.ts` | Tests policy-helpers (stays in core) | Types from `@vybestack/llxprt-code-policy` |
| `core/src/policy/policy-updater.test.ts` | Tests createPolicyUpdater (stays in core) | Types from `@vybestack/llxprt-code-policy` |
| `core/src/confirmation-bus/integration.test.ts` | Tests cross-cutting concerns | MessageBus, types from `@vybestack/llxprt-code-policy` |

## Verification Commands

```bash
# 1. Policy package tests pass
npm run test --workspace @vybestack/llxprt-code-policy
# Expected: ALL pass

# 2. Core tests pass
npm run test --workspace @vybestack/llxprt-code-core
# Expected: ALL pass

# 3. Full workspace build
npm run build
npm run typecheck

# 4. Verify moved tests no longer in core
ls packages/core/src/policy/policy-engine.test.ts 2>&1 | rg -q "No such" && echo "PASS" || echo "FAIL: test still in core"
ls packages/core/src/policy/shell-safety.test.ts 2>&1 | rg -q "No such" && echo "PASS" || echo "FAIL: test still in core"
ls packages/core/src/policy/toml-loader.test.ts 2>&1 | rg -q "No such" && echo "PASS" || echo "FAIL: test still in core"
ls packages/core/src/policy/utils.test.ts 2>&1 | rg -q "No such" && echo "PASS" || echo "FAIL: test still in core"
ls packages/core/src/confirmation-bus/message-bus.test.ts 2>&1 | rg -q "No such" && echo "PASS" || echo "FAIL: test still in core"

# 5. Verify re-export shims still exist
ls packages/core/src/policy/index.ts
ls packages/core/src/confirmation-bus/index.ts
ls packages/core/src/tools/tool-confirmation-types.ts
ls packages/core/src/policy/config.ts
ls packages/core/src/policy/policy-helpers.ts

# 6. Verify @plan markers
rg "@plan.*PLAN-20260609-ISSUE1591\.P10" packages/policy/src -g '*.test.ts' --count
# Expected: 5+ files

rg "@plan.*PLAN-20260609-ISSUE1591\.P10" packages/core/src/policy -g '*.test.ts' --count
# Expected: 5+ files (kept tests with updated imports)
```

## Success Criteria

- [ ] All policy package tests pass
- [ ] All core tests pass (including kept tests with updated imports)
- [ ] Full workspace builds and typechecks
- [ ] Moved tests no longer in core
- [ ] Re-export shims and kept files still present
- [ ] config.test.ts, persistence.test.ts, policy-helpers.test.ts, policy-updater.test.ts remain in core
- [ ] createPolicyEngineConfig/createPolicyUpdater tests still pass from core
- [ ] @plan markers present in all modified test files
- [ ] @requirement markers map to REQ-007

## Failure Recovery

1. If moved test fails — check import paths, verify relative paths are correct within policy package
2. If kept test fails — check import update, verify `@vybestack/llxprt-code-policy` resolves
3. If build fails — check for stale import paths in retained test files
4. Targeted revert: `git checkout -- packages/core/src/<specific-file>` to restore only the affected file
5. Do NOT use `rm -rf` or broad `git checkout`
