# Release/Sandbox Baseline Evidence

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585

This document specifies the evidence that MUST be captured from release/sandbox infrastructure files BEFORE any edits in P14. P00a preflight is responsible for capturing this baseline.

## Files Requiring Pre-Edit Baseline

| File | Purpose | Baseline Evidence Command |
| --- | --- | --- |
| `.github/workflows/build-sandbox.yml` | Sandbox Docker workflow | `cat .github/workflows/build-sandbox.yml > project-plans/issue1585/analysis/baseline-build-sandbox.yml` |
| `scripts/build_sandbox.js` | Sandbox build script | `cat scripts/build_sandbox.js > project-plans/issue1585/analysis/baseline-build_sandbox.js` |
| `Dockerfile` | Sandbox Docker image definition | `cat Dockerfile > project-plans/issue1585/analysis/baseline-Dockerfile` |
| `scripts/version.js` | Workspace version/order management | `cat scripts/version.js > project-plans/issue1585/analysis/baseline-version.js` |
| `scripts/prepare-package.js` | Pre-publish file copying | `cat scripts/prepare-package.js > project-plans/issue1585/analysis/baseline-prepare-package.js` |
| `.github/workflows/release.yml` | Release publish workflow | `cat .github/workflows/release.yml > project-plans/issue1585/analysis/baseline-release.yml` |

## Verification Requirements

P14 MUST verify against baselines:
1. `scripts/version.js` actualWorkspaces array order matches canonical publish order
2. `scripts/prepare-package.js` has copyFiles for tools (added, not replacing existing copyFiles)
3. `Dockerfile` COPY and install order is tools→core→providers→cli (no toolsPackageDir/chmodSync in Dockerfile, those belong in build_sandbox.js only)
4. `scripts/build_sandbox.js` includes tools pack, toolsPackageDir, and chmodSync for tools tarball
5. `.github/workflows/build-sandbox.yml` includes tools pack step before core
6. `.github/workflows/release.yml` publishes tools before core

## P00a Baseline Capture Commands

```bash
mkdir -p project-plans/issue1585/analysis
cat .github/workflows/build-sandbox.yml > project-plans/issue1585/analysis/baseline-build-sandbox.yml
cat scripts/build_sandbox.js > project-plans/issue1585/analysis/baseline-build_sandbox.js
cat Dockerfile > project-plans/issue1585/analysis/baseline-Dockerfile
cat scripts/version.js > project-plans/issue1585/analysis/baseline-version.js
cat scripts/prepare-package.js > project-plans/issue1585/analysis/baseline-prepare-package.js
cat .github/workflows/release.yml > project-plans/issue1585/analysis/baseline-release.yml
```

## Package-Lock Checks For All Dependents

```bash
# Verify core lockfile entry structure
node -e "const lock=require('./package-lock.json'); const core=lock.packages['packages/core']; console.log('core deps:', Object.keys(core?.dependencies||{}).filter(k=>k.startsWith('@vybestack')).join(', '))"

# Verify providers lockfile entry structure
node -e "const lock=require('./package-lock.json'); const prov=lock.packages['packages/providers']; console.log('providers deps:', Object.keys(prov?.dependencies||{}).filter(k=>k.startsWith('@vybestack')).join(', '))"

# Verify CLI lockfile entry structure (should NOT have tools)
node -e "const lock=require('./package-lock.json'); const cli=lock.packages['packages/cli']; console.log('cli deps:', Object.keys(cli?.dependencies||{}).filter(k=>k.startsWith('@vybestack')).join(', '))"
```