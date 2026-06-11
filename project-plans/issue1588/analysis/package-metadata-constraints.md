# Package Metadata Constraints

Plan ID: PLAN-20260608-ISSUE1588

## Root Workspace

Root `package.json` must include `packages/settings` in `workspaces` alongside existing package entries.

Expected workspace set includes:

- `packages/core`
- `packages/providers`
- `packages/cli`
- `packages/a2a-server`
- `packages/test-utils`
- `packages/vscode-ide-companion`
- `packages/lsp`
- `packages/settings`

## Settings Package Metadata

`packages/settings/package.json` must follow the package conventions established by `packages/providers`.

Required fields:

```json
{
  "name": "@vybestack/llxprt-code-settings",
  "version": "0.10.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./settings/SettingsService.js": {
      "types": "./dist/src/settings/SettingsService.d.ts",
      "import": "./dist/src/settings/SettingsService.js"
    },
    "./settings/settingsServiceInstance.js": {
      "types": "./dist/src/settings/settingsServiceInstance.d.ts",
      "import": "./dist/src/settings/settingsServiceInstance.js"
    },
    "./settings/settingsRegistry.js": {
      "types": "./dist/src/settings/settingsRegistry.d.ts",
      "import": "./dist/src/settings/settingsRegistry.js"
    },
    "./profiles/ProfileManager.js": {
      "types": "./dist/src/profiles/ProfileManager.d.ts",
      "import": "./dist/src/profiles/ProfileManager.js"
    },
    "./profiles/types.js": {
      "types": "./dist/src/profiles/types.d.ts",
      "import": "./dist/src/profiles/types.js"
    },
    "./storage/Storage.js": {
      "types": "./dist/src/storage/Storage.d.ts",
      "import": "./dist/src/storage/Storage.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "node ../../scripts/build_package.js",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:ci": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

The exact version must match the repository's current package version when implementation begins.

**Export map convention**: The root export uses `{types, import}` objects (not bare string), matching the `packages/providers/package.json` convention. All subpath exports also use `{types, import}` objects. Every subpath is verified at build time (tsc resolves types) and runtime (ESM dynamic import resolves JS). Deviations from this style are only allowed where a subpath does not have a separate types file (justified with inline comment in package.json). **Style verification**: After P03 scaffold, verify the settings export map uses `{types, import}` objects consistently for ALL subpath exports, matching the providers precedent. Run `node -e "const p=require('./packages/settings/package.json'); for (const [k,v] of Object.entries(p.exports)) { if (typeof v === 'string') { console.error('FAIL: bare string export for', k); process.exit(1); } } console.log('OK: all exports use {types, import} objects');"`

**Note on `zod` dependency**: `packages/core/src/types/modelParams.ts` currently imports `zod` for `AuthConfigSchema`. Since `AuthConfig`/`AuthConfigSchema` moves to settings, `zod` is a verified required production dependency for the settings package.

## Settings Package Dependencies

Allowed production dependencies:

- Node built-ins (no package.json entry)
- `zod` — verified required: `AuthConfigSchema` in `modelParams.ts` uses `zod` for runtime validation; this file moves to settings.
- Other direct non-workspace dependencies already used by moved code, **only if preflight scan-plus-metadata assertion proves they are required** (scan for `import ... from '<dep>'` in `packages/settings/src` and record evidence)

Forbidden production dependencies:

- `@vybestack/llxprt-code-core`
- `@vybestack/llxprt-code-providers`
- `@vybestack/llxprt-code` (CLI package)
- any future `@vybestack/llxprt-code-tools` package

## Downstream Package Dependencies

Packages that import settings APIs directly must declare `@vybestack/llxprt-code-settings` as a dependency with `file:../settings`.

Required likely updates:

| Package | Required Dependency | Section | Reason |
|---------|---------------------|---------|--------|
| `packages/core` | `"@vybestack/llxprt-code-settings": "file:../settings"` | `dependencies` | core config/runtime consumes settings APIs |
| `packages/providers` | `"@vybestack/llxprt-code-settings": "file:../settings"` | `dependencies` | providers use `SettingsService`, registry, singleton helpers |
| `packages/cli` | `"@vybestack/llxprt-code-settings": "file:../settings"` | `dependencies` | CLI profile/settings commands and imports migrate |
| `packages/a2a-server` | **no direct settings dependency** | — | a2a-server uses its own `Settings` interface; does not import Storage/SettingsService directly. Uses `LLXPRT_CONFIG_DIR` from core (not a settings symbol). No `@vybestack/llxprt-code-settings` dependency needed. |
| `packages/test-utils` | `"@vybestack/llxprt-code-settings": "file:../settings"` **if** direct imports exist | `dependencies` | scan required; add only if test utilities import settings package directly |
| `packages/lsp` | **only if** direct imports exist | `dependencies` | scan required; may remain indirect through core config |

### Downstream Package tsconfig.json and Vitest Alias Updates

Adding `@vybestack/llxprt-code-settings` requires coordinated updates in downstream packages that use TypeScript path aliases and Vitest workspace source alias plugins. These are **not optional** — they are required for compile and test before settings build artifacts exist.

#### Providers package

`packages/providers/tsconfig.json` currently has path aliases for `@vybestack/llxprt-code-core` and `@vybestack/llxprt-code-providers`. It must add:

```json
"paths": {
  "@vybestack/llxprt-code-settings": ["../settings/index.ts"],
  "@vybestack/llxprt-code-settings/*": ["../settings/src/*"]
}
```

`packages/providers/vitest.config.ts` has a custom workspace alias plugin for core/providers source paths. It must add settings alias entries following the same pattern, so that provider tests resolve settings source before build artifacts.

In addition to path aliases, providers must add settings source to its `include` array (if providers currently includes core source files) and add a `{ "path": "../settings" }` reference to its `references` array (if it has one). **Verification**: `npm run typecheck --workspace @vybestack/llxprt-code-providers` MUST pass after all tsconfig changes, proving TypeScript resolves settings imports correctly.

#### Core package

`packages/core/tsconfig.json` must add settings path aliases:

```json
"paths": {
  "@vybestack/llxprt-code-settings": ["../settings/index.ts"],
  "@vybestack/llxprt-code-settings/*": ["../settings/src/*"]
}
```

Note: Root alias resolves to `../settings/index.ts` (source entrypoint), NOT `../settings/src`. This matches core's own self-reference convention (`"@vybestack/llxprt-code-core": ["./index.ts"]`).

Core does not currently have `references` entries. Path aliases alone should resolve settings imports, but if typecheck fails, add `"../settings/index.ts"` to the `include` array.

#### CLI package

`packages/cli/tsconfig.json` must add settings path aliases:

```json
"paths": {
  "@vybestack/llxprt-code-settings": ["../settings/index.ts"],
  "@vybestack/llxprt-code-settings/*": ["../settings/src/*"]
}
```

`packages/cli/vitest.config.ts` must add settings workspace source alias entries for both root and subpath. The CLI vitest config must resolve `@vybestack/llxprt-code-settings` to source (not stale dist artifacts). Verification command after adding:

```bash
# Verify CLI vitest resolves settings to source, not dist
npm run typecheck --workspace @vybestack/llxprt-code
```

CLI must also add `"../settings/index.ts"` and `"../settings/src/**/*.ts"` to its `include` array and `{ "path": "../settings" }` to its `references` array alongside the existing `{ "path": "../core" }`. **Without these `include`/`references` additions, TypeScript may not resolve settings source files through the path aliases when `rootDir` is `..`.** Verification: `npm run typecheck --workspace @vybestack/llxprt-code` must pass.

#### Verification

After each package's tsconfig/vitest config is updated:

```bash
npm run typecheck --workspace <package>
npm run test --workspace <package>
```

Both must pass, confirming aliases resolve correctly to settings source.

## TypeScript References

`packages/settings/tsconfig.json` should extend root `../../tsconfig.json` and follow provider-package conventions:

- `outDir: "dist"`
- package-local include/exclude consistent with `packages/providers`
- `tsBuildInfoFile` under `../../node_modules/.cache/tsbuildinfo`
- no references to core/providers/cli

Downstream packages that use project references should add `../settings` where needed and ensure build order is:

```text
settings -> core -> providers -> cli

## Root Build Ordering Verification

After adding `packages/settings` to the workspace, verify that the root build process correctly orders package builds so settings builds before consumers that import it. The root `package.json` workspaces array currently lists `packages/core` before any settings entry. The root build script (`scripts/build.js`) uses `npm run build --workspaces` which builds in workspace-array order. **The implementation MUST insert `packages/settings` before `packages/core` in the workspaces array** (or modify `scripts/build.js` to build settings first).

```bash
# 1. Verify settings appears before core in workspaces
node -e "const p=require('./package.json'); const ws=p.workspaces; const si=ws.indexOf('packages/settings'); const ci=ws.indexOf('packages/core'); console.log('settings at index', si, 'core at index', ci); if (si === -1) { console.error('FAIL: settings not in workspaces'); process.exit(1); } if (si > ci) { console.error('FAIL: settings must be before core'); process.exit(1); } console.log('OK: settings builds before core');"
# 2. Build settings independently first
npm run build --workspace @vybestack/llxprt-code-settings
# 3. Full root build must succeed
npm run build
# 4. Check scripts/build.js for hard-coded package lists that might exclude settings
grep -n 'packages/(core|providers|cli)' scripts/ --include='*.js' --include='*.ts' || echo "OK: no hard-coded package ordering in build scripts"
# 5. predocs:settings must build settings before core (currently only builds core)
npm run predocs:settings 2>&1 | tail -3
```

**predocs:settings**: Currently `npm run build --workspace @vybestack/llxprt-code-core`. After settings extraction, core depends on settings for type imports. The implementation must update `predocs:settings` to build settings first: either `npm run build --workspace @vybestack/llxprt-code-settings && npm run build --workspace @vybestack/llxprt-code-core` or `npm run build`.
```

Provider package may depend on both core and settings. Core must never depend on providers.

## Export Map Requirements

The settings package public API must be intentionally small and documented. Root export is required. Subpath exports are allowed only for migration ergonomics and should be package-owned paths, not core compatibility paths.

### Decision: Root-Plus-Subpaths Export Map

The settings package supports **both root and grouped subpath exports**. This matches the consumer import matrix which includes both `@vybestack/llxprt-code-settings` (root) and `@vybestack/llxprt-code-settings/profiles/ProfileManager.js` (subpath) import styles.

Recommended subpath exports (matching `packages/providers` build convention of `dist/src/...`):

- `./settings/SettingsService.js`
- `./settings/settingsServiceInstance.js`
- `./settings/settingsRegistry.js`
- `./profiles/ProfileManager.js`
- `./profiles/types.js`
- `./storage/Storage.js`

**Source layout vocabulary**: Settings package source files live under `packages/settings/src/` with subdirectories `src/settings/`, `src/profiles/`, `src/storage/`, and `src/types.ts`. The TypeScript `outDir` is `dist`, so build artifacts appear at `dist/src/settings/`, `dist/src/profiles/`, `dist/src/storage/`. Subpath exports MUST reference `./dist/src/...` paths, matching the pattern used by `packages/providers` (e.g., `"./BaseProvider.js": "./dist/src/BaseProvider.js"`).

### Mandatory `package.json` Exports Map

`packages/settings/package.json` MUST include all subpath exports. This is a build-time verification requirement:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./settings/SettingsService.js": {
      "types": "./dist/src/settings/SettingsService.d.ts",
      "import": "./dist/src/settings/SettingsService.js"
    },
    "./settings/settingsServiceInstance.js": {
      "types": "./dist/src/settings/settingsServiceInstance.d.ts",
      "import": "./dist/src/settings/settingsServiceInstance.js"
    },
    "./settings/settingsRegistry.js": {
      "types": "./dist/src/settings/settingsRegistry.d.ts",
      "import": "./dist/src/settings/settingsRegistry.js"
    },
    "./profiles/ProfileManager.js": {
      "types": "./dist/src/profiles/ProfileManager.d.ts",
      "import": "./dist/src/profiles/ProfileManager.js"
    },
    "./profiles/types.js": {
      "types": "./dist/src/profiles/types.d.ts",
      "import": "./dist/src/profiles/types.js"
    },
    "./storage/Storage.js": {
      "types": "./dist/src/storage/Storage.d.ts",
      "import": "./dist/src/storage/Storage.js"
    }
  }
}
```

# **Built-runtime verification**: ESM dynamic import (`node --input-type=module -e "await import(...)"`) is used for all built-runtime export verification. The settings package is `type: "module"`; `require()` does not work. **Prerequisite**: Built-runtime verification requires that `npm install` and full workspace build (`npm run build`) are complete, AND that workspace resolution is current. Verification MUST validate package exports against the actual `package.json` export map AND confirm each declared `dist/src/...` file exists on disk. See the built-runtime verification script in `plan/03-decoupling-stub.md` section 8a for the validation script.

After building the settings package, verify every documented export path resolves using ESM dynamic import (the package is `type: "module"` and uses `import`-style exports; `require()` will fail):

**Prerequisite**: Built-runtime verification MUST run after `npm install` and workspace resolution are complete, AND after a full `npm run build`. Only then can `node --input-type=module` resolve the package against its actual `package.json` export map.

```bash
# Prerequisite: ensure workspace resolution is current
npm install
npm run build

# Built-runtime verification: validate package exports against package.json export map and actual built files
node --input-type=module -e "
  const fs = await import('fs');
  const path = await import('path');
  const pkg = JSON.parse(fs.readFileSync('./packages/settings/package.json', 'utf8'));
  const paths = ['.', ...Object.keys(pkg.exports).filter(k => k !== '.')];
  for (const p of paths) {
    const importSpecifier = p === '.' ? '@vybestack/llxprt-code-settings' : '@vybestack/llxprt-code-settings/' + p.replace('./', '');
    try {
      const mod = await import(importSpecifier);
      console.log('OK:', p);
    } catch (e) {
      console.error('FAIL:', p, e.message);
      process.exitCode = 1;
    }
  }
"
```

This verification is required in P05a, P06a, P08a, and P10.

## Lockfile Requirement

Running `npm install` after adding the workspace is expected to update `package-lock.json`. The implementation phase must include lockfile updates if npm changes them.

**Package manager clarification**: Root `package.json` declares `packageManager: pnpm`, but project scripts and verification commands use `npm`, and a `package-lock.json` exists. This plan uses `npm` consistently as the intended package manager for this repository, matching existing verification commands. Implementers must use `npm` commands; do not accidentally run `pnpm install` which would create lockfile churn.

**Lockfile/no pnpm-lock verification**: After every workspace or dependency change (`npm install`), verify:

```bash
test -f package-lock.json && echo "npm lockfile present"
test ! -f pnpm-lock.yaml && echo "no pnpm lockfile"
git diff --stat package-lock.json
```

The `git diff --stat package-lock.json` command must show only settings-related changes (workspace addition, dependency additions). If unrelated churn appears, investigate before proceeding. This verification is required in P03, P03b, P05, P08, and P10.

## Generated Schema/Docs Scripts

Root `package.json` includes scripts such as `predocs:settings`, `schema:settings`, and `docs:settings`. After settings registry and types move to the settings package, these scripts may require import/path updates. Implementation phases must check whether these scripts reference moved core paths and update them if needed.

### Current Ownership

- `scripts/generate-settings-schema.ts` imports from `packages/cli/src/config/settingsSchema.js` — this is CLI-owned code, NOT being moved in this issue.
- `scripts/generate-settings-doc.ts` imports from the same CLI schema file.
- The CLI settings schema (`packages/cli/src/config/settingsSchema.js`) stays in CLI for this issue (deferred until god-object decomposition).

### Ownership After Extraction

- `scripts/generate-settings-schema.ts` and `scripts/generate-settings-doc.ts` remain root-owned scripts. They import from CLI settings schema which stays in CLI.
- The settings registry (`packages/settings/src/settingsRegistry.ts`) does NOT replace the CLI settings schema. They serve different purposes: registry provides runtime validation/metadata, CLI schema provides the user-facing settings definition and JSON schema generation.
- If a future issue consolidates these, that is out of scope for #1588.

### Required Verification

After settings package extraction, verify that `npm run schema:settings` and `npm run docs:settings` still work:

```bash
npm run schema:settings
npm run docs:settings
```

If either fails due to moved imports, update the script import paths. This verification is required in P05, P05a, and P10 (moved earlier from P10-only). **Any phase that touches CLI schema imports or tsconfig/vitest aliases used by those scripts must also run schema/docs verification**, not just P10.

Verification:

```bash
node -e "const p=require('./package.json'); const s={...p.scripts}; for (const k of Object.keys(s)) { if (k.includes('settings') || k.includes('schema') || k.includes('docs')) console.log(k, s[k]); }"
```

Ensure script targets point to correct paths after migration.

## Verification Commands

```bash
# Note: require() for local JSON metadata reads is acceptable (not importing ESM package code)
node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/settings')) process.exit(1)"
node -e "const p=require('./packages/settings/package.json'); if (p.name !== '@vybestack/llxprt-code-settings') process.exit(1)"
node -e "const p=require('./packages/settings/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; for (const n of ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code']) if (d[n]) process.exit(1)"
npm run build --workspace @vybestack/llxprt-code-settings
npm run test --workspace @vybestack/llxprt-code-settings -- --run src/__tests__
```

## Package Boundary Dependency Graph Checks

In addition to grep-based forbidden import scans, verify the package boundary using Node.js dependency graph checks. Use `require()` for local JSON metadata reads (this is acceptable — it reads file system JSON, not importing ESM package code).

```bash
# Verify settings package has no forbidden runtime dependencies (both dependencies and devDependencies)
node -e "
  const p = require('./packages/settings/package.json');
  const d = {...(p.dependencies||{}), ...(p.devDependencies||{})};
  const forbidden = ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code','@vybestack/llxprt-code-tools'];
  for (const n of forbidden) {
    if (d[n]) { console.error('FORBIDDEN:', n, 'found in', Object.keys(p.dependencies||{}).includes(n) ? 'dependencies' : 'devDependencies'); process.exit(1); }
  }
  console.log('Settings package deps OK:', Object.keys(d).filter(k => !k.startsWith('@vybestack/llxprt-code')).join(', ') || 'none');
"
```

Run these after P05, P08, and P09 to confirm the dependency graph is cycle-free. Also scan `packages/settings/**/*.ts` and `**/*.tsx`, `tsconfig.json`, `vitest.config.ts` for forbidden imports:

```bash
# Forbidden import scan for settings package (enforcing: must return zero)
SETTINGS_IMPORTS=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['"]" packages/settings --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_IMPORTS" && echo "OK: settings has no forbidden imports" || { echo "FAIL: forbidden imports in settings:"; echo "$SETTINGS_IMPORTS"; exit 1; }
```
