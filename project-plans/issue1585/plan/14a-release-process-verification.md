# Phase 14a: Release Process Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P14a`

## Purpose

Run release-process tests, bind-release-deps dry-run, verify manual trusted publish checklist exists, and verify script coverage for version.js, prepare-package.js, and build.js.

## Prerequisites

- Required: P14 completed (release process updated).

## Verification Tasks

### Step 1: Release Process Tests

```bash
npm run test:scripts
```

### Step 2: Bind-Release-Deps Dry Run

```bash
node scripts/bind-release-deps.js --dry-run
```

### Step 3: Manual Trusted Publishing Checklist

```bash
test -f project-plans/issue1585/manual-trusted-publishing.md
grep -c "@vybestack/llxprt-code-tools" project-plans/issue1585/manual-trusted-publishing.md
grep -c "vybestack/llxprt-code" project-plans/issue1585/manual-trusted-publishing.md
grep -c "release.yml" project-plans/issue1585/manual-trusted-publishing.md

# For searching source code files, prefer rg for consistent syntax:
rg -n "@vybestack/llxprt-code-tools" .github/workflows/release.yml scripts/tests/release-process.test.js scripts/build_sandbox.js Dockerfile package.json packages/tools/package.json
```

### Step 4b: Build-Sandbox Workflow Verification

```bash
# Verify build-sandbox.yml packs tools using rg (consistent syntax)
rg -n "@vybestack/llxprt-code-tools" .github/workflows/build-sandbox.yml
# Expected: at least 1 match (tools pack command)
# Verify Dockerfile uses repo-shaped paths for tools
rg -n "packages/tools/dist" Dockerfile
# Expected: at least 1 match (tools COPY line)
# Verify Dockerfile install from /tmp/ with tools first
rg -n "/tmp/vybestack-llxprt-code-tools" Dockerfile
# Expected: at least 1 match
```

### Step 5: scripts/version.js Coverage

```bash
# Verify tools is in actualWorkspaces array using rg
rg -n "@vybestack/llxprt-code-tools" scripts/version.js
# Expected: 1 match in actualWorkspaces array
```

### Step 6: scripts/prepare-package.js Coverage

```bash
# Verify prepare-package.js handles tools using rg
rg -n "copyFiles.*tools|'tools'" scripts/prepare-package.js
# Expected: at least 1 match
```

### Step 7: scripts/build.js Coverage

```bash
# Verify build.js uses workspaces (automatically includes tools) using rg
rg -n "workspaces" scripts/build.js
# Expected: at least 1 match
```

### Step 8: Dockerfile Install Order Verification

```bash
# Verify tools appears before core in Dockerfile using rg
rg -n "npm install.*tools|COPY.*tools" Dockerfile
# Expected: tools COPY and install precede core COPY and install
```

### Step 9: npm/package-lock Process Note

Verify that despite root `packageManager` saying pnpm, the plan follows existing npm/package-lock release process:
```bash
test -f package-lock.json
grep "packageManager" package.json
```

## Verification Commands

```bash
npm run test:scripts && node scripts/bind-release-deps.js --dry-run && test -f project-plans/issue1585/manual-trusted-publishing.md
rg -n "@vybestack/llxprt-code-tools" scripts/version.js
rg -n "copyFiles.*tools|'tools'" scripts/prepare-package.js
rg -n "workspaces" scripts/build.js
rg -n "npm install.*tools|COPY.*tools" Dockerfile
```

## Semantic Verification Checklist

- [ ] Release process tests pass.
- [ ] bind-release-deps includes tools.
- [ ] Manual trusted publishing checklist names tools package and repository.
- [ ] Release workflow references are complete.
- [ ] scripts/version.js includes @vybestack/llxprt-code-tools.
- [ ] scripts/prepare-package.js has copyFiles for tools.
- [ ] scripts/build.js uses workspaces (auto-includes tools).
- [ ] Dockerfile install order is tools -> core -> providers -> cli.
- [ ] npm/package-lock process used despite root packageManager pnpm field.

## Success Criteria

- All release tests pass.
- Manual checklist exists and is complete.
- scripts/version.js and scripts/prepare-package.js cover tools.
- Dockerfile install order correct.

## Failure Recovery

Return to P14 to fix release issues.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P14a.md` with verification output.
