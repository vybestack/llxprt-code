# Release Process Requirements For packages/tools

Plan ID: PLAN-20260608-ISSUE1585

## Current Release Evidence

.github/workflows/release.yml has npm provenance permissions and publish steps for:
- @vybestack/llxprt-code-core
- @vybestack/llxprt-code-lsp
- @vybestack/llxprt-code-providers
- @vybestack/llxprt-code

.github/workflows/build-sandbox.yml builds and pushes a sandbox Docker image. Current pack commands:
- `npm pack -w @vybestack/llxprt-code --pack-destination ./packages/cli/dist`
- `npm pack -w @vybestack/llxprt-code-core --pack-destination ./packages/core/dist`
- No providers pack step currently (providers is a runtime dependency, not CLI dependency in sandbox)

scripts/tests/release-process.test.js verifies publish order, provider ordering, sandbox packaging, Dockerfile copy/install behavior, and bind-release-deps behavior.

scripts/build_sandbox.js packs cli and core tarballs.

Dockerfile copies and installs core/providers/cli tarballs using actual repo-shaped paths. After tools extraction, tools tarball must be copied/installed FIRST:

```dockerfile
# Repo-shaped tarball paths matching packages/*/dist/ directory layout
COPY --chown=node:node packages/tools/dist/vybestack-llxprt-code-tools-*.tgz /tmp/
COPY --chown=node:node packages/core/dist/vybestack-llxprt-code-core-*.tgz /tmp/
COPY --chown=node:node packages/providers/dist/vybestack-llxprt-code-providers-*.tgz /tmp/
COPY --chown=node:node packages/cli/dist/vybestack-llxprt-code-*.tgz /tmp/
RUN npm install -g \
      /tmp/vybestack-llxprt-code-tools-*.tgz \
      /tmp/vybestack-llxprt-code-core-*.tgz \
      /tmp/vybestack-llxprt-code-providers-*.tgz \
      /tmp/vybestack-llxprt-code-*.tgz && \
    npm cache clean --force && \
    rm -f /tmp/*.tgz
```

**Key constraint**: All tarball paths use repo-shaped `packages/*/dist/` layout. Install order is tools first because npm resolves dependencies left-to-right within a single install transaction. This ordering is a **required and tested** install order, not merely an unverified npm behavior assumption. The release-process tests in `scripts/tests/release-process.test.js` explicitly verify the tools-first ordering in the Dockerfile npm install command.

**Current-vs-Target Release/Sandbox State**

| Aspect | Current State | Target State (After P14) | Delta |
| --- | --- | --- | --- |
| `.github/workflows/release.yml` publish steps | core, lsp, providers, cli | tools, core, lsp, providers, cli | Add tools publish step before core |
| `.github/workflows/build-sandbox.yml` pack step | core, cli (no providers) | tools, core, providers, cli | Add tools and providers pack steps; tools first |
| `scripts/build_sandbox.js` pack commands | core, cli (no providers) | tools, core, providers, cli | Add tools and providers pack; tools first |
| `Dockerfile` COPY+install | core, providers, cli (no tools) | tools, core, providers, cli | Add tools COPY and install; tools first in install transaction |
| `scripts/version.js` actualWorkspaces | cli, core, providers, test-utils, vscode, lsp (unordered) | tools, core, lsp, providers, cli, test-utils, vscode (semantic order) | Add tools; reorder to canonical publish order |
| `scripts/prepare-package.js` | core, cli (no tools, no providers) | core, cli, tools, providers | Add copyFiles calls for tools and providers |
| `scripts/tests/release-process.test.js` | Tests core, providers, cli order | Tests tools, core, providers, cli order | Add tools to expectedPublishOrder; add build-sandbox assertions |
| `scripts/bind-release-deps.js` | Derives from workspace graph | Derives from workspace graph (tools adds naturally) | No structural change; verify tools appears in derivation |

## Required Publish Order

1. @vybestack/llxprt-code-tools
2. @vybestack/llxprt-code-core
3. @vybestack/llxprt-code-lsp
4. @vybestack/llxprt-code-providers
5. @vybestack/llxprt-code

Release order must be reconciled between test expectations and release.yml actual step order.

## Required Repository Changes (Exact File Edits)

### .github/workflows/release.yml

1. Add "Publish @vybestack/llxprt-code-tools" step BEFORE the existing core publish step
2. Add command: `npm publish --workspace=@vybestack/llxprt-code-tools --access public --provenance --tag=${{ steps.version.outputs.NPM_TAG }} ${{ steps.vars.outputs.is_dry_run == 'true' && '--dry-run' || '' }}`
3. Add `if: ${{ steps.vars.outputs.should_run_standard_release == 'true' }}` condition (matching existing publish steps)
4. In tarball preparation: add `npm run build --workspace=@vybestack/llxprt-code-tools` and `npm pack -w @vybestack/llxprt-code-tools`

### .github/workflows/build-sandbox.yml

1. Add `npm pack -w @vybestack/llxprt-code-tools --pack-destination ./packages/tools/dist` BEFORE existing pack commands in the "Pack npm packages" step (tools must pack before core/providers/cli because dependents require it)
2. The build-sandbox workflow already runs `npm run build` which will include tools (since tools is a workspace package)
3. The Dockerfile (used by this workflow) must be updated separately (see Dockerfile section below)
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

**Consistent sandbox pack order**: tools, core, providers, cli. This order applies in all sandbox-related files: build-sandbox workflow, `scripts/build_sandbox.js`, Dockerfile COPY, and Dockerfile install transaction. This is a **required and tested** ordering, not merely an assumed npm behavior.

**Release-process test coverage for build-sandbox**: Add test assertions in `scripts/tests/release-process.test.js` verifying:
- Tools pack step exists in build-sandbox.yml (`rg -n "@vybestack/llxprt-code-tools" .github/workflows/build-sandbox.yml`)
- Tools appears before core in the pack command sequence

### scripts/tests/release-process.test.js

1. Add `@vybestack/llxprt-code-tools` to expectedPublishOrder array BEFORE core
2. Add assertion: tools tarball preparation step exists
3. Add assertion: tools appears in sandbox pack list
4. Add assertion: tools appears in Dockerfile install transaction
5. Add assertion: bind-release-deps derivation includes tools

### scripts/build_sandbox.js

1. Add `npm pack -w @vybestack/llxprt-code-tools` BEFORE existing pack commands (tools must pack before core/providers/cli)
2. Add `toolsPackageDir=packages/tools/dist` reference
3. Add tools tarball to the copy/assembly list
4. Chmod tools tarball: `chmodSync(tarballPath, 0o755)` (consistent with existing `build_sandbox.js` which uses `0o755` for all tarballs)

### Dockerfile

1. Add tools tarball COPY BEFORE existing COPY lines (tools before core/providers/cli):
```dockerfile
COPY --chown=node:node packages/tools/dist/vybestack-llxprt-code-tools-*.tgz /tmp/
COPY --chown=node:node packages/core/dist/vybestack-llxprt-code-core-*.tgz /tmp/
COPY --chown=node:node packages/providers/dist/vybestack-llxprt-code-providers-*.tgz /tmp/
COPY --chown=node:node packages/cli/dist/vybestack-llxprt-code-*.tgz /tmp/
```
2. Add tools tarball as first argument in the npm install transaction:
```dockerfile
RUN npm install -g \
      /tmp/vybestack-llxprt-code-tools-*.tgz \
      /tmp/vybestack-llxprt-code-core-*.tgz \
      /tmp/vybestack-llxprt-code-providers-*.tgz \
      /tmp/vybestack-llxprt-code-*.tgz && \
    npm cache clean --force && \
    rm -f /tmp/*.tgz
```

### scripts/version.js

1. Add `@vybestack/llxprt-code-tools` to the `actualWorkspaces` array (after core, before providers)
2. Evidence: `rg -n "@vybestack/llxprt-code-tools" scripts/version.js`

### scripts/prepare-package.js

1. Add a `copyFiles('tools', { 'README.md': 'README.md', LICENSE: 'LICENSE', '.npmrc': '.npmrc' })` call following the same pattern as core and cli
2. Evidence: `rg -n "copyFiles.*tools|'tools'" scripts/prepare-package.js`

### scripts/build.js

1. No changes needed — `npm run build --workspaces` covers all workspace packages including tools
2. Evidence: `rg -n "workspaces" scripts/build.js`

### package.json (root)

1. Verify `"packages/tools"` is in workspaces array (added in P03)

### package-lock.json

1. Updated by `npm install` after workspace entry

### packages/tools/package.json

1. Follow packages/providers/package.json conventions:
   - name, version, description, license, repository
   - type: "module"
   - main: "dist/index.js"
   - types: "dist/index.d.ts"
   - exports: top-level + subpath
   - scripts: build, lint, format, test, test:ci, typecheck
   - files: ["dist"]
   - dependencies: (no core/providers/cli)
   - devDependencies: @types/node, @vybestack/llxprt-code-test-utils, typescript, vitest
   - engines: { "node": ">=20" }

## Manual Trusted Publishing Setup

Required artifact: project-plans/issue1585/manual-trusted-publishing.md

Steps for a maintainer:
- In npm package settings for @vybestack/llxprt-code-tools, configure GitHub Actions trusted publisher for repository vybestack/llxprt-code and workflow .github/workflows/release.yml
- Verify the package name is reserved/created under @vybestack
- Verify the GitHub environment/branch rules match existing package trusted publish settings
- Verify dry-run release passes

## npm/package-lock Process Note

The root `packageManager` field says `pnpm@10.17.0`, but the repository uses `npm` with `package-lock.json` for all release and workspace scripts. This plan follows the **existing npm/package-lock release process**. The `packageManager` field is vestigial.

## Verification Commands

```bash
npm run test:scripts
node scripts/bind-release-deps.js --dry-run
# Verify tools references in release files using rg (consistent syntax)
rg -n "@vybestack/llxprt-code-tools" .github/workflows/release.yml .github/workflows/build-sandbox.yml scripts/tests/release-process.test.js scripts/build_sandbox.js Dockerfile package.json packages/tools/package.json
# Verify version.js coverage
rg -n "@vybestack/llxprt-code-tools" scripts/version.js
# Verify prepare-package.js coverage
rg -n "copyFiles.*tools|'tools'" scripts/prepare-package.js
# Verify build.js uses workspaces
rg -n "workspaces" scripts/build.js
# Verify Dockerfile install order and repo-shaped paths
rg -n "packages/tools/dist|/tmp/vybestack-llxprt-code-tools" Dockerfile
# Verify Dockerfile npm install command
rg -n "npm install.*tools" Dockerfile
# Verify build-sandbox.yml tools pack step
rg -n "npm pack.*tools" .github/workflows/build-sandbox.yml
# Verify build-sandbox.yml pack order (tools, core, providers, cli)
rg -n "npm pack" .github/workflows/build-sandbox.yml
# Verify test coverage for build-sandbox workflow
rg -n "build-sandbox" scripts/tests/release-process.test.js
```

The full implementation must also run the canonical final verification commands.
