# Phase 06a: Build Wiring Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P06a`

## Purpose

Verify build wiring, lockfile, and workspace listing for packages/tools.

## Prerequisites

- Required: P06 completed.
- Artifacts: lockfile, build output.

## Verification Tasks

### Step 1: Verify Workspace And Lockfile

```bash
node -e "const p=require('./package.json'); console.log(p.workspaces.includes('packages/tools'))"
npm ls @vybestack/llxprt-code-tools
```

### Step 2: Verify Build Passes

```bash
npm run build --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-tools
```

### Step 3: Verify No Cycles

```bash
npm ls @vybestack/llxprt-code-core 2>&1 | grep -i cycle
# Expected: no cycle warnings
```

## Verification Commands

```bash
npm run typecheck
npm run build --workspace @vybestack/llxprt-code-tools
npm ls @vybestack/llxprt-code-tools
npm ls @vybestack/llxprt-code-core 2>&1 | grep -i cycle
```

## Semantic Verification Checklist

- [ ] Workspace includes tools.
- [ ] Build passes.
- [ ] No cycles in dependency graph.

## Success Criteria

- All checks pass.
- No code quality issues.

## Failure Recovery

Return to P06 to fix wiring.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P06a.md` with wiring verification output.
