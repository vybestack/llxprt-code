# Phase 14: Release Process And Trusted Publish Updates

## Phase ID

`PLAN-20260608-ISSUE1585.P14`

## Purpose

Update release workflow, release tests, sandbox packing, Dockerfile, package versioning/bind-release-deps behavior, and create manual trusted publishing checklist. Includes exact steps for `scripts/version.js`, inspection of `scripts/prepare-package.js` and `scripts/build.js`.

## Prerequisites

- Required: P13a completed (consumer migration verified).
- Artifacts: all migrated imports, tools package exports.

## Requirements Implemented

### REQ-REL-001

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-RELEASE-PROCESS

**Behavior specification**:
- GIVEN: packages/tools is a publishable workspace package
- WHEN: Release workflow, sandbox build, Dockerfile, and scripts are updated
- THEN: Tools is published before dependents, sandbox includes tools tarball, Dockerfile copies/installs tools first using repo-shaped paths, release-process tests pass including build-sandbox workflow coverage

**Why it matters**: Missing tools from release causes downstream install failures. Wrong install order causes npm resolution failures.

## Implementation Tasks

### Step 1: Update .github/workflows/release.yml

Exact edits:
1. Add `Publish @vybestack/llxprt-code-tools` step BEFORE the existing core publish step
2. Add command: `npm publish --workspace=@vybestack/llxprt-code-tools --access public --provenance --tag=${{ steps.version.outputs.NPM_TAG }} ${{ steps.vars.outputs.is_dry_run == 'true' && '--dry-run' || '' }}`
3. Add `if: ${{ steps.vars.outputs.should_run_standard_release == 'true' }}` condition (matching existing publish steps)
4. In tarball preparation section, add: `npm pack -w @vybestack/llxprt-code-tools`
5. Ensure tools publish precedes core/providers/cli in job step order

**Style rule**: Match adjacent release.yml publish steps exactly, differing only by package name. Do not introduce new step names, env vars, or formatting patterns that diverge from existing publish steps.

### Step 1b: Update .github/workflows/build-sandbox.yml

`.github/workflows/build-sandbox.yml` builds and pushes the sandbox Docker image. Current pack commands pack only core and cli. Tools must be packed BEFORE core/cli because dependents require the tools tarball.

Exact edits:
1. Add `npm pack -w @vybestack/llxprt-code-tools --pack-destination ./packages/tools/dist` BEFORE existing pack commands in the "Pack npm packages" step
2. The build-sandbox workflow already runs `npm run build` which will include tools (since tools is a workspace package)
3. The Dockerfile (used by this workflow) must be updated separately (Step 4)
4. Evidence: `rg -n "@vybestack/llxprt-code-tools" .github/workflows/build-sandbox.yml`

**Current build-sandbox.yml pack step** (before tools addition):
```yaml
      - name: Pack npm packages
        run: |
          npm pack -w @vybestack/llxprt-code --pack-destination ./packages/cli/dist
          npm pack -w @vybestack/llxprt-code-core --pack-destination ./packages/core/dist
```

**Target build-sandbox.yml pack step** (after tools addition):
```yaml
      - name: Pack npm packages
        run: |
          npm pack -w @vybestack/llxprt-code-tools --pack-destination ./packages/tools/dist
          npm pack -w @vybestack/llxprt-code-core --pack-destination ./packages/core/dist
          npm pack -w @vybestack/llxprt-code-providers --pack-destination ./packages/providers/dist
          npm pack -w @vybestack/llxprt-code --pack-destination ./packages/cli/dist
```

**Consistent sandbox pack order**: tools, core, providers, cli. This order applies in all sandbox-related files: build-sandbox workflow, `scripts/build_sandbox.js`, Dockerfile COPY, and Dockerfile install transaction.

**Release-process test coverage for build-sandbox**: P14 Step 2 must add test assertions verifying:
- Tools pack step exists in build-sandbox.yml (`rg -n "@vybestack/llxprt-code-tools" .github/workflows/build-sandbox.yml`)
- Tools appears before core in the pack command sequence

### Step 2: Update scripts/tests/release-process.test.js

Exact edits:
1. Add `@vybestack/llxprt-code-tools` to the expectedPublishOrder array BEFORE core
2. Add test assertion: tools tarball preparation step exists
3. Add test assertion: tools appears in sandbox pack list
4. Add test assertion: tools appears in Dockerfile install transaction (using repo-shaped `/tmp/` paths)
5. Add test assertion: bind-release-deps derivation includes tools
6. Add test assertion: build-sandbox workflow includes tools pack step (verify `rg -n "@vybestack/llxprt-code-tools" .github/workflows/build-sandbox.yml`)
7. Add test assertion: tools appears before core in build-sandbox pack sequence
8. Add test assertion: sandbox pack order is tools, core, providers, cli

### Step 3: Update scripts/build_sandbox.js

Exact edits:
1. Add `npm pack -w @vybestack/llxprt-code-tools --pack-destination ./packages/tools/dist` BEFORE existing pack commands (consistent sandbox pack order: tools, core, providers, cli)
2. Add tools tarball to the COPY/assembly list for sandbox builds
3. Add `toolsPackageDir=packages/tools/dist` variable reference so the sandbox script can locate tools build output
4. Chmod tools tarball: `chmodSync(tarballPath, 0o755)` (consistent with existing `build_sandbox.js` which uses `0o755` for all tarballs)

### Step 4: Update Dockerfile — Correct Tarball Ordering (Repo-Shaped Paths)

**Critical**: tools must pack/copy/install BEFORE core/providers/cli because dependents require the tools tarball.

The Dockerfile uses repo-shaped paths: tarballs are in `packages/*/dist/` directories, copied to `/tmp/`, and installed from `/tmp/`. This matches the current Dockerfile layout.

**Note**: `toolsPackageDir` variable assignment and `chmodSync` for the tools tarball belong ONLY in `scripts/build_sandbox.js` (Step 3). The Dockerfile handles COPY and install only — it does not assign variables or chmod tarballs. Dockerfile edits are limited to COPY lines and install transaction order.

Exact edits:
1. **Dockerfile COPY tools BEFORE core**: Add tools COPY line BEFORE existing COPY lines:
```dockerfile
COPY --chown=node:node packages/tools/dist/vybestack-llxprt-code-tools-*.tgz /tmp/
COPY --chown=node:node packages/core/dist/vybestack-llxprt-code-core-*.tgz /tmp/
COPY --chown=node:node packages/providers/dist/vybestack-llxprt-code-providers-*.tgz /tmp/
COPY --chown=node:node packages/cli/dist/vybestack-llxprt-code-*.tgz /tmp/
```
2. **Install transaction order**: In the npm install transaction, install tools BEFORE core/providers/cli from `/tmp/`:
```dockerfile
RUN npm install -g \
      /tmp/vybestack-llxprt-code-tools-*.tgz \
      /tmp/vybestack-llxprt-code-core-*.tgz \
      /tmp/vybestack-llxprt-code-providers-*.tgz \
      /tmp/vybestack-llxprt-code-*.tgz && \
    npm cache clean --force && \
    rm -f /tmp/*.tgz
```

The install command places tools first because npm resolves dependencies left-to-right within a single install transaction.

### Step 5: Update scripts/version.js

**Exact step**: Add `@vybestack/llxprt-code-tools` to the `actualWorkspaces` array in `scripts/version.js`. The `actualWorkspaces` array order is **semantic** — it determines processing and publish order for publishable workspaces. It MUST match the canonical publish order: tools → core → lsp → providers → cli. Non-publishable workspaces (test-utils, vscode-ide-companion) may appear after the publishable ones.

Current `actualWorkspaces` array:
```javascript
const actualWorkspaces = [
  '@vybestack/llxprt-code',
  '@vybestack/llxprt-code-core',
  '@vybestack/llxprt-code-providers',
  '@vybestack/llxprt-code-test-utils',
  'llxprt-code-vscode-ide-companion',
  '@vybestack/llxprt-code-lsp',
];
```

Updated `actualWorkspaces` array (semantic order — MUST match canonical publish order):
```javascript
const actualWorkspaces = [
  '@vybestack/llxprt-code-tools',     // FIRST: zero in-repo publishable deps
  '@vybestack/llxprt-code-core',      // depends on tools
  '@vybestack/llxprt-code-lsp',       // depends on core
  '@vybestack/llxprt-code-providers', // depends on core + tools
  '@vybestack/llxprt-code',           // depends on all above
  '@vybestack/llxprt-code-test-utils',
  'llxprt-code-vscode-ide-companion',
];
```

**Important**: `actualWorkspaces` array order is **semantic** — it determines the processing and publish order. It MUST match the canonical publish order: tools → core → lsp → providers → cli. Non-publishable workspaces (test-utils, vscode-ide-companion) may appear in any position after the publishable ones.

**Verification approach**: Since `scripts/version.js` does not currently export `actualWorkspaces` as a named export, P14 must verify order by one of two approaches:

**Option A (Preferred)**: Intentionally export `actualWorkspaces` from `scripts/version.js` with tests proving the export is correct. This requires:
1. Add `module.exports = { actualWorkspaces, ... };` (or ESM named export) to `scripts/version.js`
2. Write a test in `scripts/tests/release-process.test.js` that imports `actualWorkspaces` and verifies the publishable subset matches canonical order:
```javascript
import { actualWorkspaces } from '../../scripts/version.js';
const publishable = ['@vybestack/llxprt-code-tools','@vybestack/llxprt-code-core','@vybestack/llxprt-code-lsp','@vybestack/llxprt-code-providers','@vybestack/llxprt-code'];
const actualPublishable = actualWorkspaces.filter(n => publishable.includes(n));
// Assert actualPublishable matches publishable
```

**Option B (Fallback)**: Verify order by parsing `scripts/version.js` file text in release-process tests:
```javascript
// Read and parse actualWorkspaces from version.js source text
const versionSource = fs.readFileSync('scripts/version.js', 'utf8');
const match = versionSource.match(/const actualWorkspaces = \[([\s\S]*?)\]/);
const entries = match[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
// Verify publishable subset matches canonical order
```

**Evidence**:
```bash
# Verify version.js covers tools
rg -n "@vybestack/llxprt-code-tools" scripts/version.js
# Expected: 1 match
```

### Step 6: Inspect scripts/prepare-package.js

`scripts/prepare-package.js` copies README.md, LICENSE, and .npmrc into package directories before npm publish. Currently it handles `core` and `cli` packages.

**Inspection result**: It does NOT currently handle `providers`, `tools`, or other packages. The `copyFiles('core', ...)` and `copyFiles('cli', ...)` calls are hardcoded.

**Required update**: Add a `copyFiles('tools', ...)` call following the same pattern:
```javascript
// Prepare 'tools' package
copyFiles('tools', {
  'README.md': 'README.md',
  LICENSE: 'LICENSE',
  '.npmrc': '.npmrc',
});
```

**Evidence**:
```bash
# Verify prepare-package.js handles tools
rg -n "@vybestack/llxprt-code-tools|copyFiles.*tools|'tools'" scripts/prepare-package.js
```

### Step 7: Inspect scripts/build.js

`scripts/build.js` runs `npm run build --workspaces` which builds ALL workspace packages. Since tools will be in the workspaces array, `npm run build --workspaces` will automatically include it.

**Inspection result**: No changes needed to `scripts/build.js` itself. The workspace build command already covers all workspaces.

**Evidence**:
```bash
# Verify build.js uses workspaces command
rg -n "workspaces|build" scripts/build.js | head -10
```

### Step 8: Verify package.json Workspaces

```bash
node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/tools')) process.exit(1)"
# Expected: exit code 0
```

### Step 9: Update package-lock.json

```bash
npm install
# Verify packages/tools exists in package-lock.json
node -e "const p=require('./package-lock.json'); if (!p.packages['packages/tools']) process.exit(1)"
# Verify core/providers package-lock entries include tools dependencies after install
node -e "
const lock = require('./package-lock.json');
const coreDeps = lock.packages['packages/core'];
const providersDeps = lock.packages['packages/providers'];
if (coreDeps && !coreDeps.dependencies?.['@vybestack/llxprt-code-tools']) process.exit(1);
"
```

**npm/package-lock process guards** (reinforcing P08 guards in release context):

```bash
# Guard: package-lock.json MUST exist (not pnpm-lock.yaml)
test -f package-lock.json
# Guard: pnpm-lock.yaml MUST NOT exist
test ! -f pnpm-lock.yaml
# Guard: packages/tools entry exists in package-lock.json with correct dependencies
node -e "const p=require('./package-lock.json'); if (!p.packages['packages/tools']) { console.error('MISSING: packages/tools not in package-lock.json'); process.exit(1); }"
# Guard: core declares tools dependency in lockfile
node -e "const lock=require('./package-lock.json'); const core=lock.packages['packages/core']; if (core && !core.dependencies?.['@vybestack/llxprt-code-tools']) { console.error('MISSING: core tools dep'); process.exit(1); }"
# Guard: providers declares tools dependency in lockfile
node -e "const lock=require('./package-lock.json'); const prov=lock.packages['packages/providers']; if (prov && !prov.dependencies?.['@vybestack/llxprt-code-tools']) { console.error('NOTE: providers may not need tools in lockfile yet (post-P13)'); }"
# Guard: CLI does NOT have direct tools dependency in lockfile
node -e "const lock=require('./package-lock.json'); const cli=lock.packages['packages/cli']; if (cli && cli.dependencies?.['@vybestack/llxprt-code-tools']) { console.error('FORBIDDEN: CLI has direct tools dependency in lockfile'); process.exit(1); }"
```

**Note**: Root `packageManager` says pnpm but repository uses npm with package-lock.json for all release and workspace scripts. This plan follows the existing npm/package-lock release process. The packageManager field is vestigial and outside the scope of this issue.

### Step 10: Verify packages/tools/package.json

Follow packages/providers/package.json conventions:
- name: @vybestack/llxprt-code-tools
- version: matches other packages (0.10.0)
- license: Apache-2.0
- repository: same structure
- type, main, types, exports, scripts, files, engines all follow providers pattern
- dependencies: external-only per dependency-relocation-final.md (NO core/providers/cli)
- devDependencies: @vybestack/llxprt-code-test-utils, typescript, vitest, @types/node

### Step 10b: ESM-Compatible Runtime Export Smoke Test

After building and packing the tools package, verify it can be dynamically imported as ESM without errors:

```bash
# Build tools package
npm run build --workspace @vybestack/llxprt-code-tools
# Pack tools tarball into temp directory
rm -rf /tmp/llxprt-tools-pack /tmp/llxprt-tools-smoke
mkdir -p /tmp/llxprt-tools-pack /tmp/llxprt-tools-smoke
npm pack -w @vybestack/llxprt-code-tools --pack-destination /tmp/llxprt-tools-pack
# Install packed tarball in a temp directory and verify ESM import
cd /tmp/llxprt-tools-smoke
npm init -y
npm install /tmp/llxprt-tools-pack/vybestack-llxprt-code-tools-*.tgz
node --input-type=module -e "import('@vybestack/llxprt-code-tools').then(m => { console.log('ESM import OK, exports:', Object.keys(m).length); process.exit(0); }).catch(e => { console.error('ESM import FAILED:', e.message); process.exit(1); })"
# Clean up
cd "$OLDPWD"
rm -rf /tmp/llxprt-tools-pack /tmp/llxprt-tools-smoke
```

### Step 10c: Subpath Export Importability Smoke Tests

Verify every declared subpath export is importable:

```bash
# Build and pack tools
npm run build --workspace @vybestack/llxprt-code-tools
rm -rf /tmp/llxprt-tools-pack /tmp/llxprt-tools-smoke
mkdir -p /tmp/llxprt-tools-pack /tmp/llxprt-tools-smoke
npm pack -w @vybestack/llxprt-code-tools --pack-destination /tmp/llxprt-tools-pack
cd /tmp/llxprt-tools-smoke
npm init -y
npm install /tmp/llxprt-tools-pack/vybestack-llxprt-code-tools-*.tgz

# Test each subpath export
node --input-type=module -e "import('@vybestack/llxprt-code-tools/IToolFormatter.js').then(m => { console.log('IToolFormatter OK:', Object.keys(m).length); process.exit(0); }).catch(e => { console.error('IToolFormatter FAILED:', e.message); process.exit(1); })"
node --input-type=module -e "import('@vybestack/llxprt-code-tools/ToolFormatter.js').then(m => { console.log('ToolFormatter OK:', Object.keys(m).length); process.exit(0); }).catch(e => { console.error('ToolFormatter FAILED:', e.message); process.exit(1); })"
node --input-type=module -e "import('@vybestack/llxprt-code-tools/ToolIdStrategy.js').then(m => { console.log('ToolIdStrategy OK:', Object.keys(m).length); process.exit(0); }).catch(e => { console.error('ToolIdStrategy FAILED:', e.message); process.exit(1); })"
node --input-type=module -e "import('@vybestack/llxprt-code-tools/toolIdNormalization.js').then(m => { console.log('toolIdNormalization OK:', Object.keys(m).length); process.exit(0); }).catch(e => { console.error('toolIdNormalization FAILED:', e.message); process.exit(1); })"
node --input-type=module -e "import('@vybestack/llxprt-code-tools/doubleEscapeUtils.js').then(m => { console.log('doubleEscapeUtils OK:', Object.keys(m).length); process.exit(0); }).catch(e => { console.error('doubleEscapeUtils FAILED:', e.message); process.exit(1); })"
node --input-type=module -e "import('@vybestack/llxprt-code-tools/toolNameUtils.js').then(m => { console.log('toolNameUtils OK:', Object.keys(m).length); process.exit(0); }).catch(e => { console.error('toolNameUtils FAILED:', e.message); process.exit(1); })"

# Clean up
cd "$OLDPWD"
rm -rf /tmp/llxprt-tools-pack /tmp/llxprt-tools-smoke
```

### Step 11: Create Manual Trusted Publishing Checklist

Create `project-plans/issue1585/manual-trusted-publishing.md` with setup instructions for @vybestack/llxprt-code-tools (see required artifact). **Style**: Match the existing format of adjacent release documentation. If `manual-trusted-publishing.md` already exists for other packages, follow its structure exactly, differing only by package name.

### Step 12: Verify Release Order Reconciliation

**Canonical publish order**: tools → core → lsp → providers → cli. This order MUST be consistent across ALL of the following:

1. `.github/workflows/release.yml` publish step order
2. `scripts/tests/release-process.test.js` expectedPublishOrder array
3. `scripts/version.js` actualWorkspaces array (semantic order for publishable workspaces)
4. `.github/workflows/build-sandbox.yml` pack step order (sandbox: tools, core, providers, cli — no lsp in sandbox)
5. `scripts/build_sandbox.js` pack order (sandbox: tools, core, providers, cli)
6. Dockerfile COPY and install transaction order (tools, core, providers, cli)

### Step 12a: bind-release-deps.js Order Requirement

`bind-release-deps.js` currently derives publish order from root workspace array. This is fragile — the derived order may not match the canonical publish order if root workspaces are not topologically sorted.

**P14 MUST require one of the following**:

**Option A (Preferred)**: Reorder root `package.json` workspaces to match canonical publish order: `packages/tools`, `packages/core`, `packages/lsp`, `packages/providers`, `packages/cli`. Then `bind-release-deps.js` naturally derives correct order from the workspace array.

**Option B**: Update `bind-release-deps.js` to topologically sort packages by dependency graph rather than workspace array order, so it produces canonical order regardless of workspace array position.

**Either option MUST include a test** asserting that `deriveNpmReleasePackages()` (or equivalent export) returns the canonical publish order:

```javascript
// In scripts/tests/release-process.test.js
test('deriveNpmReleasePackages returns canonical publish order', async () => {
  const packages = await deriveNpmReleasePackages(); // or parse from bind-release-deps output
  const publishable = packages.filter(n =>
    ['@vybestack/llxprt-code-tools','@vybestack/llxprt-code-core','@vybestack/llxprt-code-lsp','@vybestack/llxprt-code-providers','@vybestack/llxprt-code'].includes(n)
  );
  const expected = ['@vybestack/llxprt-code-tools','@vybestack/llxprt-code-core','@vybestack/llxprt-code-lsp','@vybestack/llxprt-code-providers','@vybestack/llxprt-code'];
  expect(publishable).toEqual(expected);
});
```

**Evidence**: `node scripts/bind-release-deps.js --dry-run` must list tools before core before providers before cli.

**Root workspace order verification command** (run during P14 verification):
```bash
# Verify actualWorkspaces order matches canonical publish order
# Option A: If actualWorkspaces is exported (preferred — see Step 5)
node -e "
const {actualWorkspaces} = require('./scripts/version.js');
const publishable = ['@vybestack/llxprt-code-tools','@vybestack/llxprt-code-core','@vybestack/llxprt-code-lsp','@vybestack/llxprt-code-providers','@vybestack/llxprt-code'];
const actualPublishable = actualWorkspaces.filter(n => publishable.includes(n));
for (let i = 0; i < publishable.length; i++) {
  if (actualPublishable[i] !== publishable[i]) {
    console.error('Order mismatch: expected', publishable[i], 'at position', i, 'but got', actualPublishable[i]);
    process.exit(1);
  }
}
console.log('actualWorkspaces publishable order: OK');
"

# Option B: Parse version.js source text (fallback — see Step 5)
node -e "
const fs = require('fs');
const src = fs.readFileSync('scripts/version.js', 'utf8');
const match = src.match(/const actualWorkspaces = \[([\s\S]*?)\]/);
if (!match) { console.error('Cannot find actualWorkspaces in version.js'); process.exit(1); }
const entries = match[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
const publishable = ['@vybestack/llxprt-code-tools','@vybestack/llxprt-code-core','@vybestack/llxprt-code-lsp','@vybestack/llxprt-code-providers','@vybestack/llxprt-code'];
const actualPublishable = entries.filter(n => publishable.includes(n));
for (let i = 0; i < publishable.length; i++) {
  if (actualPublishable[i] !== publishable[i]) {
    console.error('Order mismatch at', i, ': expected', publishable[i], 'got', actualPublishable[i]);
    process.exit(1);
  }
}
console.log('actualWorkspaces publishable order: OK');
"
```

**A2A server verification**: After P14, A2A verification is covered in P16 Step 4d. Do not duplicate here.

## Verification Commands

```bash
# Release process tests
npm run test:scripts
# Bind-release-deps dry run
node scripts/bind-release-deps.js --dry-run
# Verify tools references in release files using rg (consistent syntax — not grep -g)
rg -n "@vybestack/llxprt-code-tools" .github/workflows/release.yml .github/workflows/build-sandbox.yml scripts/tests/release-process.test.js scripts/build_sandbox.js Dockerfile package.json packages/tools/package.json
# Verify version.js coverage
rg -n "@vybestack/llxprt-code-tools" scripts/version.js
# Verify prepare-package.js coverage
rg -n "copyFiles.*tools|'tools'" scripts/prepare-package.js
# Verify build.js uses workspaces (no change needed)
rg -n "workspaces" scripts/build.js
# Verify manual trusted publishing checklist exists
test -f project-plans/issue1585/manual-trusted-publishing.md
# Verify Dockerfile install order and repo-shaped paths using rg
rg -n "packages/tools/dist|/tmp/vybestack-llxprt-code-tools" Dockerfile
# Verify build-sandbox.yml includes tools pack step
rg -n "npm pack.*tools" .github/workflows/build-sandbox.yml
```

## Semantic Verification Checklist

- [ ] release.yml publishes tools before dependents.
- [ ] release-process.test.js includes tools in publish order.
- [ ] build_sandbox.js packs tools tarball BEFORE core/providers/cli.
- [ ] build-sandbox.yml packs tools before core/providers/cli.
- [ ] Release-process test covers build-sandbox.yml tools inclusion.
- [ ] Dockerfile copies and installs tools tarball BEFORE core/providers/cli (COPY and install only — no toolsPackageDir/chmodSync in Dockerfile).
- [ ] scripts/version.js includes @vybestack/llxprt-code-tools in actualWorkspaces.
- [ ] scripts/prepare-package.js has copyFiles for tools package.
- [ ] scripts/build.js uses workspaces build (no change needed, verify only).
- [ ] packages/tools/package.json follows providers convention.
- [ ] Manual trusted publishing checklist exists with exact fields for npm trusted publishing setup.
- [ ] Release order reconciled between tests and workflow.
- [ ] bind-release-deps.js order verified: either root workspaces reordered to canonical order, or bind-release-deps.js updated to topologically sort; test for deriveNpmReleasePackages() exists.
- [ ] package-lock.json updated and includes packages/tools entry.
- [ ] Root workspaces include packages/tools.
- [ ] A2A server typecheck and tests pass after release changes.
- [ ] npm/package-lock process guards pass (package-lock.json exists, pnpm-lock.yaml absent, packages/tools in lockfile, core declares tools dep, CLI has no direct tools dep).

## Success Criteria

- All release tests pass.
- bind-release-deps includes tools.
- bind-release-deps derivation produces canonical publish order (tested).
- Manual trusted publishing checklist exists with exact fields.
- scripts/version.js covers tools.
- scripts/prepare-package.js covers tools.
- Dockerfile install order is tools -> core -> providers -> cli (COPY + install only, no toolsPackageDir/chmodSync in Dockerfile).

## Failure Recovery

Return to P14 to fix release wiring.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P14.md` with files modified, release order verification, and script coverage evidence.
