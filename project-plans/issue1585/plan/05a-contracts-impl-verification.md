# Phase 05a: Contract Implementation Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P05a`

## Purpose

Verify contract implementation follows pseudocode, no package cycles exist, and all utilities are self-contained.

## Prerequisites

- Required: P05 completed (utilities implemented, tests passing).
- Artifacts: implemented utilities, passing tests.

## Verification Tasks

### Step 1: Verify No Package Cycles

```bash
# Verify tools does not import core
rg -n "@vybestack/llxprt-code-core\|packages/core/src" packages/tools/src -g "*.ts"
# Verify tools does not import providers
rg -n "@vybestack/llxprt-code-providers\|packages/providers/src" packages/tools/src -g "*.ts"
# Verify tools package.json has no core/providers dependencies
node -e "const p=require('./packages/tools/package.json'); console.log('deps:', Object.keys(p.dependencies||{})); console.log('devDeps:', Object.keys(p.devDependencies||{}))"
```

### Step 2: Verify Tests Pass

```bash
npm run test --workspace @vybestack/llxprt-code-tools
```

### Step 3: Verify Contract Follows Pseudocode

Cross-reference interface files with pseudocode line numbers.

## Verification Commands

```bash
npm run typecheck
npm run test --workspaces --if-present
npm run test --workspace @vybestack/llxprt-code-tools
```

## Semantic Verification Checklist

- [ ] No package cycles.
- [ ] Utilities are self-contained (no core imports).
- [ ] Contract tests pass.
- [ ] Implementation matches pseudocode.

## Success Criteria

- Zero forbidden imports in tools.
- All contract tests pass.
- No cycles exist.

## Failure Recovery

Return to P05 to fix implementations.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P05a.md` with cycle analysis and test results.
