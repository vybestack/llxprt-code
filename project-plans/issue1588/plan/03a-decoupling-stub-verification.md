# Phase 03a: Decoupling Stub Verification

## Phase ID

`PLAN-20260608-ISSUE1588.P03a`

## Prerequisites

- Required: Phase 03 completed.

## Requirements Implemented (Expanded)

### REQ-DEP-001: Cycle-Free Dependency Direction

**Full Text**: Settings must not depend on core/providers/tools/CLI.

**Behavior**:

- GIVEN P03 stubs
- WHEN reviewer inspects imports and types
- THEN no hidden cycle or compatibility wrapper is introduced

**Why This Matters**: Stubs can accidentally encode the wrong architecture.

## Implementation Tasks

No production implementation. Review P03 code and run scans.

## Verification Commands

```bash
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings/src --glob '*.ts'
find packages -type f | rg '(V2|New|Compat|Wrapper|Copy)\.(ts|tsx)$'
npm run typecheck
npm run typecheck --workspace @vybestack/llxprt-code-settings
npm run build --workspace @vybestack/llxprt-code-settings
npm run test --workspace @vybestack/llxprt-code-settings
# Package metadata check (dependencies AND devDependencies)
node -e "const p=require('./packages/settings/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; for (const n of ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code']) if (d[n]) { console.error('FORBIDDEN:', n); process.exit(1); }; console.log('settings deps OK')"
# Verify workspace registration
node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/settings')) process.exit(1)"
# Verify no pnpm-lock.yaml
test ! -f pnpm-lock.yaml && echo "no pnpm lockfile"
```

Expected: zero forbidden settings imports, no duplicate-version files, typecheck passes, settings builds and test command runs, package metadata has no forbidden deps, workspace registered, no pnpm lockfile.

## Semantic Verification Checklist

- [ ] Stubs are minimal and contract-shaped.
- [ ] Tests do not assert stub behavior.
- [ ] No old core wrappers were added.

## Success Criteria

P04 can add behavioral tests.

## Failure Recovery

Return to P03.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P03a.md`.
