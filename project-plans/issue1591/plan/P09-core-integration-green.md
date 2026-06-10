# Phase P09: Core Integration — GREEN Implementation

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Implementation
Prerequisites: P08a (core integration RED tests verified)

## Purpose

Wire `packages/core` to use `@vybestack/llxprt-code-policy`. Add the dependency, update all imports, create re-export shims, update tool-confirmation-types. All P08 tests must pass.

## Worker / Verifier Assignment

- **Worker**: typescriptexpert (updates core imports, creates re-export shims)
- **Verifier**: typescriptreviewer (verifies GREEN state in P09a)

## Expanded Requirements

- Add `@vybestack/llxprt-code-policy` as dependency in core's package.json
- Add path alias in core's tsconfig.json for `@vybestack/llxprt-code-policy`
- Add workspace dependency alias in core's vitest.config.ts
- Replace core's policy/confirmation-bus barrel exports with re-exports from policy package
- Update all internal core imports to use `@vybestack/llxprt-code-policy`
- Create re-export shim for tool-confirmation-types.ts
- Keep `createPolicyEngineConfig`, `createPolicyUpdater`, `persistPolicyToToml` in core's config.ts
- Keep `policy-helpers.ts` in core

## @plan / @requirement Marker Requirements

Every **TypeScript source file** modified in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260609-ISSUE1591.P09
 * @requirement REQ-006.1
 */
```

Marker mapping:
- `core/src/policy/index.ts`: `@requirement REQ-006.3`
- `core/src/confirmation-bus/index.ts`: `@requirement REQ-006.4`
- `core/src/tools/tool-confirmation-types.ts`: `@requirement REQ-006.5`
- All import-updated files: `@requirement REQ-006.6`

**Note**: `@plan`/`@requirement` markers go in TypeScript source files only. JSON files (`package.json`, `tsconfig.json`) and `vitest.config.ts` imports **cannot contain comments**. Do not add markers to these files. Instead, track the configuration changes in the phase completion doc and reference them from the TS re-export shims.

## Exact File Tasks

### Core Package Configuration

| File | Action | Description |
|------|--------|-------------|
| `packages/core/package.json` | MODIFY | Add `"@vybestack/llxprt-code-policy": "file:../policy"` to dependencies |
| `packages/core/tsconfig.json` | MODIFY | Add path alias for `@vybestack/llxprt-code-policy` |
| `packages/core/vitest.config.ts` | MODIFY | Add workspace dependency alias for policy package |

### Core Re-Export Shims

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/policy/index.ts` | REPLACE | Re-export from `@vybestack/llxprt-code-policy` + keep policy-helpers |
| `packages/core/src/confirmation-bus/index.ts` | REPLACE | Re-export from `@vybestack/llxprt-code-policy` |
| `packages/core/src/tools/tool-confirmation-types.ts` | REPLACE | Re-export `ConfirmationOutcome as ToolConfirmationOutcome`, `ConfirmationPayload as ToolConfirmationPayload` |

### Core Import Updates (exact files)

| File | Old Import | New Import |
|------|-----------|------------|
| `packages/core/src/config/configTypes.ts` | `'../policy/types.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/config/configBaseCore.ts` | `'../policy/policy-engine.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/config/configConstructor.ts` | `'../policy/policy-engine.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/config/config.ts` | `'../confirmation-bus/message-bus.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/config/configBase.ts` | `'../confirmation-bus/message-bus.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/config/toolRegistryFactory.ts` | `'../confirmation-bus/message-bus.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/config/schedulerSingleton.ts` | `'../confirmation-bus/message-bus.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/scheduler/confirmation-coordinator.ts` | `'../policy/types.js'`, `'../confirmation-bus/message-bus.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/scheduler/types.ts` | `'../confirmation-bus/types.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/core/coreToolScheduler.ts` | `'../confirmation-bus/types.js'`, `'../confirmation-bus/message-bus.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/core/subagent*.ts` (6 files) | `'../confirmation-bus/message-bus.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/agents/executor.ts` | `'../confirmation-bus/message-bus.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/agents/invocation.ts` | `'../confirmation-bus/message-bus.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/hooks/hookEventHandler.ts` | `'../confirmation-bus/message-bus.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/hooks/hookSystem.ts` | `'../confirmation-bus/types.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/tools/*.ts` (~25 files) | `'../confirmation-bus/message-bus.js'` | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/test-utils/tools.ts` | Various policy/bus imports | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/test-utils/config.ts` | Various policy/bus imports | `'@vybestack/llxprt-code-policy'` |
| `packages/core/src/test-utils/mock-tool.ts` | Various policy/bus imports | `'@vybestack/llxprt-code-policy'` |

### Core config.ts (keep orchestration)

`packages/core/src/policy/config.ts`:
- KEEP: `createPolicyEngineConfig`, `createPolicyUpdater`, `persistPolicyToToml`
- UPDATE: import types from `@vybestack/llxprt-code-policy`
- KEEP: imports of `Storage`, `coreEvents`, `debugLogger` (core deps)
- REMOVE: any imports of moved files (they now come from policy package)

## Verification Commands

```bash
# 1. P08 integration tests must PASS
npm run test --workspace @vybestack/llxprt-code-core -- --testNamePattern="policy-package"
# Expected: ALL pass

# 2. Full core test suite
npm run test --workspace @vybestack/llxprt-code-core
# Expected: ALL pass

# 3. Build verification
npm run build
npm run typecheck

# 4. Verify core imports resolve to policy package
rg -c "@vybestack/llxprt-code-policy" packages/core/src --type ts
# Expected: 40+ matches (all import sites updated)

# 5. Verify old import paths are gone — comprehensive scan
# Scan ALL old policy/confirmation-bus relative imports (not just selected patterns)
find packages/core/src -name '*.ts' ! -name '*.test.ts' ! -path '*/node_modules/*' -exec rg -l "from.*\.\./policy/(types|policy-engine|stable-stringify|utils|toml-loader|config)\.js|from.*\.\./confirmation-bus/(message-bus|types)\.js" {} \; | rg -v 'policy/index\.ts|policy/config\.ts|policy/policy-helpers\.ts'
# Expected: zero matches (all updated to policy package imports)
# EXCEPTION: policy/index.ts, policy/config.ts, policy/policy-helpers.ts may still have local relative imports

# 6. Verify re-export shims
rg "@vybestack/llxprt-code-policy" packages/core/src/policy/index.ts
rg "@vybestack/llxprt-code-policy" packages/core/src/confirmation-bus/index.ts
rg "@vybestack/llxprt-code-policy" packages/core/src/tools/tool-confirmation-types.ts
# Expected: all present

# 7. Verify package.json boundary — core does not add forbidden reverse deps
rg "@vybestack/llxprt-code-core" packages/policy/package.json
# Expected: zero matches

# 8. Verify @plan markers
rg "@plan.*PLAN-20260609-ISSUE1591\.P09" packages/core/src --type ts --count
# Expected: 40+ files with markers (one per modified file)
```

## Success Criteria

- [ ] All P08 integration tests pass (GREEN state)
- [ ] Full core test suite passes
- [ ] Full workspace builds and typechecks
- [ ] All tool files (~25) import MessageBus from `@vybestack/llxprt-code-policy`
- [ ] All config/scheduler/agent/hook files updated
- [ ] Re-export shims in place for policy/index.ts, confirmation-bus/index.ts, tool-confirmation-types.ts
- [ ] `createPolicyEngineConfig`, `createPolicyUpdater` still in core's config.ts
- [ ] `policy-helpers.ts` still in core
- [ ] Zero old import paths remaining (except policy-helpers local refs)
- [ ] Package boundary enforced: policy package.json has no core dep
- [ ] @plan markers present in all modified TypeScript source files (not JSON/config files)
- [ ] @requirement markers map to REQ-006

## Failure Recovery

1. If import resolution fails — check tsconfig path alias and vitest alias
2. If type errors — check that policy package exports match core's expectations
3. If tests fail — identify the specific failing test, fix the import or re-export
4. Targeted revert: `git checkout -- packages/core/src/<specific-file>`
5. Do NOT use broad `git checkout -- packages/core/`
