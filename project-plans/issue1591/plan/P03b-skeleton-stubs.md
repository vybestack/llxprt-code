# Phase P03b: Skeleton Stub Exports

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Stub
Prerequisites: P03a (scaffold verified)

## Purpose

Create minimal resolvable skeleton exports in `packages/policy/src/` so that P04/P06 RED tests fail on **behavioral assertions** (wrong return values, missing enum members, incorrect decisions) rather than import-resolution failures. Each skeleton file exports the correct types, classes, and functions with correct signatures but trivial/empty implementations that produce wrong behavioral results.

## Worker / Verifier Assignment

- **Worker**: typescriptexpert (creates skeleton stubs)
- **Verifier**: typescriptreviewer (verifies stubs resolve but produce wrong behavior)

## Expanded Requirements

- Create skeleton source files that export all types, classes, functions with correct signatures
- Skeletons must compile and resolve at import time (tests can `import { PolicyEngine } from './policy-engine.js'`)
- Skeletons must produce **deliberately wrong behavioral results** so RED tests fail on assertions:
  - `PolicyEngine.evaluate()` returns `null` or throws `Error('stub: not implemented')`
  - `loadPoliciesFromToml()` returns `[]` (empty array — wrong rule count)
  - `ConfirmationOutcome` enum is empty or has placeholder values
  - `MessageBus` methods are no-ops returning `undefined`
- TOML policy files are NOT copied yet (that happens in P05) — TOML loading tests will fail because the policies directory in policy package is empty
- All skeletons include `@plan PLAN-20260609-ISSUE1591.P03b` markers
- Package must build and typecheck after this phase (skeletons are valid TypeScript)

## @plan / @requirement Marker Requirements

Every skeleton file MUST include:

```typescript
/**
 * @plan PLAN-20260609-ISSUE1591.P03b
 * @requirement REQ-002 (or REQ-003 for confirmation-bus)
 */
```

## Exact File Tasks

| File | Action | Description |
|------|--------|-------------|
| `packages/policy/src/types.ts` | CREATE (skeleton) | Export all enums and types with correct shapes, but `PolicyDecision` is empty placeholder |
| `packages/policy/src/policy-engine.ts` | CREATE (skeleton) | Export `PolicyEngine` class with `evaluate()` that returns `{ decision: null }` |
| `packages/policy/src/stable-stringify.ts` | CREATE (skeleton) | Export `stableStringify`/`stableParse` that return wrong results |
| `packages/policy/src/utils.ts` | CREATE (skeleton) | Export `escapeRegex`/`buildArgsPatterns` that return empty/wrong results |
| `packages/policy/src/toml-loader.ts` | CREATE (skeleton) | Export `loadPoliciesFromToml`/`loadDefaultPolicies` that return `[]` |
| `packages/policy/src/config.ts` | CREATE (skeleton) | Export pure utilities with wrong return values |
| `packages/policy/src/utils/shell-utils.ts` | CREATE (skeleton) | Export `SHELL_TOOL_NAMES` as empty array, `splitCommands`/`hasRedirection` returning wrong values |
| `packages/policy/src/confirmation-bus/types.ts` | CREATE (skeleton) | Export all message types and interfaces; `ConfirmationOutcome` with placeholder values, `PolicyFunctionCall`/`PolicyToolCallState` as empty shapes |
| `packages/policy/src/confirmation-bus/message-bus.ts` | CREATE (skeleton) | Export `MessageBus` class with methods that return `undefined`/no-op |
| `packages/policy/src/confirmation-bus/index.ts` | CREATE (skeleton) | Barrel export with backward-compat aliases |
| `packages/policy/src/index.ts` | UPDATE | Re-export from all skeleton modules |

### Skeleton Implementation Pattern

Each skeleton follows this pattern — correct signature, wrong behavior:

```typescript
/**
 * @plan PLAN-20260609-ISSUE1591.P03b
 * @requirement REQ-002.2
 */
// SKELETON: correct types, deliberately wrong behavioral results for RED phase

export class PolicyEngine {
  evaluate(_toolName: string, _args: Record<string, unknown>): { decision: string | null } {
    return { decision: null }; // RED: always returns null — no rules evaluated
  }
}
```

```typescript
/**
 * @plan PLAN-20260609-ISSUE1591.P03b
 * @requirement REQ-002.5
 */
// SKELETON: correct signature, returns empty array

export async function loadDefaultPolicies(): Promise<never[]> {
  return []; // RED: no TOML files loaded, wrong rule count
}

export async function loadPoliciesFromToml(): Promise<never[]> {
  return []; // RED: always empty
}
```

```typescript
/**
 * @plan PLAN-20260609-ISSUE1591.P03b
 * @requirement REQ-003.1
 */
// SKELETON: ConfirmationOutcome with wrong/empty values for RED phase

export enum ConfirmationOutcome {
  Placeholder = '__stub__', // RED: tests assert exactly 8 specific values
}
```

## Verification Commands

```bash
# 1. Package builds (skeletons are valid TypeScript)
npm run build --workspace @vybestack/llxprt-code-policy
# Expected: success

# 2. Package typechecks
npm run typecheck --workspace @vybestack/llxprt-code-policy
# Expected: success

# 3. Imports resolve — no "cannot find module" errors
node -e "
  import('./packages/policy/dist/index.js').then(m => {
    const required = ['PolicyEngine', 'MessageBus', 'loadDefaultPolicies'];
    const missing = required.filter(k => !(k in m));
    if (missing.length > 0) { console.error('MISSING:', missing); process.exit(1); }
    console.log('PASS: all skeleton exports resolve');
  });
"
# Expected: all exports resolve (but produce wrong behavior)

# 4. Behavioral RED check — loadDefaultPolicies returns empty (wrong)
node -e "
  import('./packages/policy/dist/index.js').then(async m => {
    const rules = await m.loadDefaultPolicies();
    if (rules.length !== 0) { console.error('Expected empty, got', rules.length); process.exit(1); }
    console.log('PASS: skeleton returns empty rules (RED behavioral state)');
  });
"

# 5. Behavioral RED check — evaluate returns null
node -e "
  import('./packages/policy/dist/index.js').then(async m => {
    const engine = new m.PolicyEngine();
    const result = engine.evaluate('test', {});
    if (result.decision !== null) { console.error('Expected null, got', result); process.exit(1); }
    console.log('PASS: skeleton evaluate returns null (RED behavioral state)');
  });
"

# 6. Verify @plan markers in all skeleton files
rg "@plan.*PLAN-20260609-ISSUE1591\.P03b" packages/policy/src --type ts -g '!*.test.ts' --count
# Expected: 10+ files

# 7. Verify SKELETON markers present (for easy grep during GREEN phase)
rg "SKELETON" packages/policy/src --type ts -g '!*.test.ts' --count
# Expected: 10+ files
```

## Success Criteria

- [ ] All skeleton files created in `packages/policy/src/`
- [ ] Package builds and typechecks successfully
- [ ] All exports resolve (no import errors) — imports from test files will work
- [ ] Behavioral results are deliberately wrong (null decisions, empty arrays, placeholder enum values)
- [ ] TOML policy files are NOT copied (still empty `src/policies/`)
- [ ] `@plan PLAN-20260609-ISSUE1591.P03b` markers in all skeleton files
- [ ] `SKELETON` comment markers present for easy identification during GREEN phase
- [ ] Full workspace build still passes (skeletons don't break other packages)

## Failure Recovery

1. If skeletons don't compile — fix type signatures to match expected exports
2. If workspace build breaks — check for circular deps or type conflicts
3. If imports don't resolve — verify `src/index.ts` re-exports from all skeleton modules
4. Targeted revert: remove specific skeleton files, `git checkout -- packages/policy/src/<file>`
