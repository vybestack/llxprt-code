# Phase 16: Full Verification Suite

## Phase ID

`PLAN-20260608-ISSUE1585.P16`

## Purpose

Run full repository verification and smoke test required by project memory.

## Prerequisites

- Required: P15a completed (cleanup verified, no shims).

## Requirements Implemented

### REQ-CLEAN-001, REQ-TEST-001, REQ-BEHAVIOR-PRESERVATION, REQ-FORMAT-DIFF-CHECK

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-BEHAVIOR-PRESERVATION, REQ-FORMAT-DIFF-CHECK, REQ-PKG-BOUNDARY

**Behavior specification**:
- GIVEN: All phases completed, cleanup done
- WHEN: Full verification suite runs
- THEN: npm run test/lint/typecheck/format/build all pass; format produces zero diff; smoke test runs; forbidden imports scan clean; key storage/memory path behavior preserved

**Why it matters**: This is the final gate before merge. Any regression here ships to users.

## Canonical Final Verification Commands

```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load waferglm5 "write me a haiku and nothing else"
```

## Implementation Tasks

### Step 1: Run Full Verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
# Verify format produced zero diff (REQ-FORMAT-DIFF-CHECK)
git diff --quiet
# Expected: exit code 0
```

### Step 2: Run Smoke Test

```bash
node scripts/start.js --profile-load waferglm5 "write me a haiku and nothing else"
```

### Step 3: Run Post-Extraction Package Checks

```bash
npm ls @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run build --workspace @vybestack/llxprt-code-tools
npm run test --workspace @vybestack/llxprt-code-tools
```

### Step 4: Run Forbidden Dependency Checks

```bash
rg -n "@vybestack/llxprt-code-core|packages/core/src|@vybestack/llxprt-code-providers|packages/providers/src|packages/cli/src" packages/tools/src -g "*.ts"
# Expected: zero matches
```

### Step 4b: Post-Move Transitive External Import Scan

```bash
rg -n "^import .* from ['"][^./]" packages/tools/src -g "*.ts" | sort
```

Every external package in this scan MUST be listed in `packages/tools/package.json` dependencies.

### Step 4c: Tarball Smoke Test

```bash
rm -rf /tmp/llxprt-tools-pack /tmp/llxprt-tools-smoke
mkdir -p /tmp/llxprt-tools-pack /tmp/llxprt-tools-smoke
npm pack -w @vybestack/llxprt-code-tools --pack-destination /tmp/llxprt-tools-pack
cd /tmp/llxprt-tools-smoke
npm init -y
npm install /tmp/llxprt-tools-pack/vybestack-llxprt-code-tools-*.tgz
node --input-type=module -e "import('@vybestack/llxprt-code-tools').then(m => { if (!Object.keys(m).length) process.exit(1); })"
cd "$OLDPWD"
rm -rf /tmp/llxprt-tools-pack /tmp/llxprt-tools-smoke
```

### Step 4d: A2A Server Verification

```bash
npm run typecheck --workspace @vybestack/llxprt-code-a2a-server
npm run test --workspace @vybestack/llxprt-code-a2a-server
```

### Step 4e: Package-Lock And Root Workspace Assertions

```bash
node -e "const p=require('./package-lock.json'); if (!p.packages['packages/tools']) process.exit(1)"
node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/tools')) process.exit(1)"
```

### Step 5: Run Release Checks

```bash
npm run test:scripts
node scripts/bind-release-deps.js --dry-run
# Verify tools references using rg (consistent syntax — not grep -g)
rg -n "@vybestack/llxprt-code-tools" .github/workflows/release.yml .github/workflows/build-sandbox.yml scripts/tests/release-process.test.js scripts/build_sandbox.js Dockerfile package.json packages/tools/package.json
# Verify scripts/version.js coverage
rg -n "@vybestack/llxprt-code-tools" scripts/version.js
# Verify scripts/prepare-package.js coverage
rg -n "copyFiles.*tools|'tools'" scripts/prepare-package.js
# Verify scripts/build.js workspaces
rg -n "workspaces" scripts/build.js
# Verify Dockerfile install order and repo-shaped paths
rg -n "packages/tools/dist|/tmp/vybestack-llxprt-code-tools" Dockerfile
# Verify build-sandbox.yml tools pack step
rg -n "npm pack.*tools" .github/workflows/build-sandbox.yml
# Verify sandbox pack order consistency (tools, core, providers, cli)
rg -n "npm pack" .github/workflows/build-sandbox.yml
```

### Step 6: Key Storage And Memory Path Regression Coverage

```bash
npm run test --workspace @vybestack/llxprt-code-tools -- --grep "key.*storage\|maskKey\|tool.*key\|memory\|LLXPRT.*dir"
```

### Step 7: Provider Integration Check

```bash
npm run test --workspace @vybestack/llxprt-code-providers
```

### Step 8: Package Metadata Constraints

```bash
# Anti-cycle checks
node -e "const p=require('./packages/tools/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; if (d['@vybestack/llxprt-code-core'] || d['@vybestack/llxprt-code-providers'] || d['@vybestack/llxprt-code']) process.exit(1)"
# test-utils devDependency-only
node -e "const p=require('./packages/tools/package.json'); if (p.dependencies && p.dependencies['@vybestack/llxprt-code-test-utils']) process.exit(1)"
# tsconfig anti-cycle
node -e "const c=require('./packages/tools/tsconfig.json'); if ((c.references||[]).some(r => String(r.path).includes('../core') || String(r.path).includes('../providers') || String(r.path).includes('../cli'))) process.exit(1)"
# IToolFormatter export path check
node -e "const p=require('./packages/tools/package.json'); const e=p.exports&&p.exports['./IToolFormatter.js']; if (!e || !e.includes('formatters')) process.exit(1)"
```

### Step 9: No-Shim Scan

```bash
# All-file retained artifact scan for packages/core/src/tools/**
find packages/core/src/tools -type f | sort > project-plans/issue1585/analysis/core-tools-final-files.txt
cat project-plans/issue1585/analysis/core-tools-final-files.txt
# Expected: every remaining file is classified in the approved retained-file allowlist, including non-TS artifacts

# No-shim scan restricted to packages/core/src/tools/ only (NOT index.ts)
# Uses rg for consistent syntax
rg -n "export \\* from ['\"]@vybestack/llxprt-code-tools|export \\{.*\\} from ['\"]@vybestack/llxprt-code-tools" packages/core/src/tools -g "*.ts"
# Expected: zero matches
# Allowed top-level re-exports (separate verification — NOT flagged as shims)
rg -n "export .* from ['\"]@vybestack/llxprt-code-tools" packages/core/src/index.ts
# Expected: non-zero (allowed for CLI compatibility)
```

### Step 10: Format Diff Check

```bash
# Verify npm run format produced zero diff (REQ-FORMAT-DIFF-CHECK)
# Use format:check if available (preferred — does not modify files)
npm run format:check 2>/dev/null || (npm run format && git diff --quiet -- ':!project-plans/')
# Expected: exit code 0
# Fallback: run format then check diff excluding project-plans/
# The format:check approach avoids confusion from uncommitted intentional edits
```

### Step 11: Test Fixture Anti-Coupling

```bash
# Verify test fixtures do not import core/providers
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers" packages/tools/src/__tests__/fixtures -g "*.ts"
# Expected: zero matches
```

## Verification Commands

```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load waferglm5 "write me a haiku and nothing else"
```

## Semantic Verification Checklist

- [ ] Full project verification passes.
- [ ] Smoke test produces expected output.
- [ ] Forbidden import scan is clean.
- [ ] Post-move transitive external import scan matches declared dependencies.
- [ ] Tarball smoke test passes (pack, install, import).
- [ ] A2A server typecheck and tests pass.
- [ ] Release checks pass.
- [ ] Key storage and memory path behavior regression covered.
- [ ] Provider integration preserved.
- [ ] Package metadata constraints pass (anti-cycle, test-utils devDep-only, IToolFormatter export path).
- [ ] No-shim scan returns zero matches for core/tools/ (allowed index.ts re-exports verified separately).
- [ ] scripts/version.js, scripts/prepare-package.js, scripts/build.js cover tools.
- [ ] Dockerfile install order is tools, core, providers, cli.
- [ ] Format diff check passes (`npm run format:check` exits 0, or `npm run format && git diff --quiet -- ':!project-plans/'` exits 0).
- [ ] Test fixtures in packages/tools do not import core/providers.
- [ ] package-lock.json includes packages/tools and core declares tools dependency.
- [ ] Root package.json workspaces include packages/tools.

## Success Criteria

- All verification commands succeed.

## Failure Recovery

Identify and fix failures. Return to the relevant implementation phase if needed.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P16.md` with full verification output.
