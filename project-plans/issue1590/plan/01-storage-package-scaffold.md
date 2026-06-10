# Phase 01: Storage Package Scaffold

## Phase ID

`PLAN-20260609-ISSUE1590.P01`

## Prerequisites

- Required: Phase P00a completed and P00a-V PASS.
- Verification: `test -f project-plans/issue1590/.completed/P00a.md`.
- Preflight verification: P00a must report no blockers.

## Requirements Implemented (Expanded)

### REQ-PKG-001: Create Storage Workspace Package

**Full Text**: Create `packages/storage` as a workspace package with package metadata, export map, build, test, lint, typecheck, root `index.ts`, source `src/index.ts`, and TypeScript config consistent with the monorepo.
**Behavior**:

- GIVEN: the repository has existing TypeScript workspace package conventions
- WHEN: `packages/storage` is scaffolded
- THEN: it can be built, typechecked, tested, linted, and imported as `@vybestack/llxprt-code-storage`

**Why This Matters**: The extraction needs a real package, not a loose folder of copied files.

### REQ-LEAF-001: Leaf Package Boundary

**Full Text**: `packages/storage` must not depend on any other `@vybestack/llxprt-code-*` workspace package and must not import from `packages/core`.
**Behavior**:

- GIVEN: the new package metadata is created
- WHEN: dependencies are declared
- THEN: no llxprt workspace dependency appears in `packages/storage/package.json`

**Why This Matters**: Storage is foundational and must not depend on higher-level packages.

## Implementation Tasks

### Files to Create

- `packages/storage/package.json`
  - `name`: `@vybestack/llxprt-code-storage`
  - `version`: match repository package version.
  - `type`: `module`
  - `main`: `dist/index.js`
  - `types`: `dist/index.d.ts`
  - `files`: `["dist"]`
  - `scripts`: `build`, `lint`, `format`, `test`, `test:ci`, `typecheck` consistent with `packages/core` where feasible.
  - `dependencies`: copy exact versions for `env-paths` and `ignore` from `packages/core/package.json`. Run `node -e "const p=require('./packages/core/package.json'); console.log(JSON.stringify({envPaths: p.dependencies['env-paths'], ignore: p.dependencies['ignore']}, null, 2))"` to get the exact versions. Do NOT infer version numbers.
  - `optionalDependencies`: copy exact version for `@napi-rs/keyring` from `packages/core/package.json`. Run `node -e "const p=require('./packages/core/package.json'); console.log(p.optionalDependencies?.['@napi-rs/keyring'] || 'not in optionalDependencies')"` and check `dependencies` as fallback.
  - `devDependencies`: all workspace packages declare their own `typescript`, `vitest`, and `@types/node` in devDependencies. Storage must follow this convention. Verified versions from existing packages:
    - `typescript: ^5.3.3` (consistent across all packages)
    - `vitest: ^3.1.1` (matches core; some packages use `^3.2.4` — use core's version for consistency since storage will run similar test patterns)
    - `@types/node: ^24.2.1` (core and providers both use this version; test-utils does not declare it but packages that test against Node APIs do)
    - Do NOT infer version numbers — the above were read from existing `package.json` files. If in doubt, re-verify with: `node -e "const p=require('./packages/core/package.json'); console.log(JSON.stringify(p.devDependencies, null, 2))"`
  - MUST NOT include any `@vybestack/llxprt-code-*` dependency.
  - **Export map must match actual monorepo convention.** The monorepo uses two shapes:
    - Root export (`"."`) uses object form with `types` and `import` keys (matching `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, and `@vybestack/llxprt-code-mcp` — all verified to use `{ "types": "./dist/...", "import": "./dist/..." }`).
    - Deep exports use **string values** (matching `@vybestack/llxprt-code-core` and `@vybestack/llxprt-code-providers` convention where each deep path maps directly to `./dist/src/...`).
  - Copy the following block verbatim into the `exports` field:
    ```json
    {
      ".": {
        "types": "./dist/index.d.ts",
        "import": "./dist/index.js"
      },
      "./config/storage.js": "./dist/src/config/storage.js",
      "./services/fileSystemService.js": "./dist/src/services/fileSystemService.js",
      "./services/fileDiscoveryService.js": "./dist/src/services/fileDiscoveryService.js",
      "./storage/secure-store.js": "./dist/src/secure-store/secure-store.js",
      "./storage/provider-key-storage.js": "./dist/src/secure-store/provider-key-storage.js",
      "./storage/sessionTypes.js": "./dist/src/session/sessionTypes.js",
      "./storage/ConversationFileWriter.js": "./dist/src/conversation/ConversationFileWriter.js",
      "./testing": "./dist/src/testing.js"
    }
    ```
- `packages/storage/tsconfig.json`
  - **Must match verified monorepo convention.** All workspace packages extend `../../tsconfig.json`, set `outDir: "dist"`, and include `composite` and `tsBuildInfoFile`. Verified values from `packages/core/tsconfig.json`:
    ```json
    {
      "extends": "../../tsconfig.json",
      "compilerOptions": {
        "outDir": "dist",
        "tsBuildInfoFile": "../../node_modules/.cache/tsbuildinfo/storage.tsbuildinfo",
        "lib": ["DOM", "DOM.Iterable", "ES2021", "ES2022.Error"],
        "composite": true,
        "types": ["node", "vitest/globals"],
        "baseUrl": ".",
        "paths": {
          "@vybestack/llxprt-code-storage": ["./index.ts"],
          "@vybestack/llxprt-code-storage/*": ["./src/*"],
          "@vybestack/llxprt-code-storage/config/storage.js": ["./src/config/storage.ts"],
          "@vybestack/llxprt-code-storage/services/fileSystemService.js": ["./src/services/fileSystemService.ts"],
          "@vybestack/llxprt-code-storage/services/fileDiscoveryService.js": ["./src/services/fileDiscoveryService.ts"],
          "@vybestack/llxprt-code-storage/storage/secure-store.js": ["./src/secure-store/secure-store.ts"],
          "@vybestack/llxprt-code-storage/storage/provider-key-storage.js": ["./src/secure-store/provider-key-storage.ts"],
          "@vybestack/llxprt-code-storage/storage/sessionTypes.js": ["./src/session/sessionTypes.ts"],
          "@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js": ["./src/conversation/ConversationFileWriter.ts"],
          "@vybestack/llxprt-code-storage/testing": ["./src/testing.ts"]
        }
      },
      "include": ["index.ts", "src/**/*.ts", "src/**/*.json"],
      "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
    }
    ```
- `packages/storage/index.ts`
  - `export * from './src/index.js';`
- `packages/storage/src/index.ts`
  - Initial exports for logger only in this phase.
- `packages/storage/src/types/logger.ts`
  - Implements pseudocode lines 11, 14-16, 21.
  - Define `StorageLogger` with `debug`, `warn`, and `error` methods accepting `string | (() => string)` and optional context.
  - Define `NullStorageLogger` that performs no output.
- `packages/storage/src/testing.ts`
  - Empty initially (populated in P04d when `resetConversationFileWriterForTesting` is added).
  - This file is the test-only deep export entry point (`@vybestack/llxprt-code-storage/testing`).
  - Must exist in P01 so the export map `"./testing": "./dist/src/testing.js"` resolves at typecheck time.
  - Initial content:
    ```typescript
    // Test-only exports — NOT part of stable public API (Tier 3)
    // Populated in P04d
    ```

### Package-Level Config Verification

Before finalizing the scaffold, verify the package has all required config by comparing with existing workspace packages:

```bash
# Verify storage package.json has all required top-level fields
node -e "
const core = require('./packages/core/package.json');
const storage = require('./packages/storage/package.json');
const required = ['name','version','type','main','types','exports','scripts','files','dependencies','devDependencies','engines'];
for (const f of required) {
  if (!storage[f]) { console.error('MISSING field in storage package.json:', f, '(core has it:', !!core[f], ')'); process.exit(1); }
}
// Verify scripts match convention
for (const s of ['build','lint','format','test','test:ci','typecheck']) {
  if (!storage.scripts[s]) { console.error('MISSING script:', s); process.exit(1); }
}
console.log('Package-level config matches convention');
"

# Verify tsconfig.json has all required fields matching verified convention
node -e "
const tsconfig = require('./packages/storage/tsconfig.json');
if (tsconfig.extends !== '../../tsconfig.json') { console.error('tsconfig must extend ../../tsconfig.json'); process.exit(1); }
if (tsconfig.compilerOptions.outDir !== 'dist') { console.error('outDir must be dist'); process.exit(1); }
if (tsconfig.compilerOptions.composite !== true) { console.error('composite must be true'); process.exit(1); }
if (!tsconfig.compilerOptions.tsBuildInfoFile) { console.error('tsBuildInfoFile must be set'); process.exit(1); }
if (!tsconfig.compilerOptions.types || !tsconfig.compilerOptions.types.includes('node') || !tsconfig.compilerOptions.types.includes('vitest/globals')) { console.error('types must include node and vitest/globals'); process.exit(1); }
if (!tsconfig.compilerOptions.paths || !tsconfig.compilerOptions.paths['@vybestack/llxprt-code-storage']) { console.error('paths must include @vybestack/llxprt-code-storage'); process.exit(1); }
console.log('tsconfig.json matches verified convention');
"
```

### Files to Modify

- `package.json`
  - Add `packages/storage` to `workspaces`.

## Verification Commands

```bash
test -f packages/storage/package.json
test -f packages/storage/tsconfig.json
test -f packages/storage/index.ts
test -f packages/storage/src/index.ts
test -f packages/storage/src/types/logger.ts
test -f packages/storage/src/testing.ts
node -e "const p=require('./packages/storage/package.json'); const deps={...p.dependencies,...p.devDependencies,...p.optionalDependencies}; if (Object.keys(deps).some(k=>k.startsWith('@vybestack/llxprt-code-'))) { console.error('FORBIDDEN: llxprt workspace dependency found'); process.exit(1); }"
rg 'packages/storage' package.json
# Run npm install BEFORE any workspace script so that the workspace is registered
npm install
npm run typecheck --workspace @vybestack/llxprt-code-storage
# Verify export map is exact JSON with all required entries, matching monorepo convention
node -e "
const p = require('./packages/storage/package.json');
const e = p.exports || {};
// Root export must be object with types and import
if (!e['.'] || !e['.'].types || !e['.'].import) { console.error('MISSING or malformed root export'); process.exit(1); }
// Deep exports must be simple strings matching convention
const deepExports = ['./config/storage.js','./services/fileSystemService.js','./services/fileDiscoveryService.js','./storage/secure-store.js','./storage/provider-key-storage.js','./storage/sessionTypes.js','./storage/ConversationFileWriter.js','./testing'];
for (const k of deepExports) {
  if (!e[k]) { console.error('MISSING export:', k); process.exit(1); }
  if (typeof e[k] !== 'string') { console.error('Deep export must be a string, not object:', k, JSON.stringify(e[k])); process.exit(1); }
  if (!e[k].startsWith('./dist/src/')) { console.error('Deep export must map to ./dist/src/...:', k, e[k]); process.exit(1); }
}
console.log('All export map entries present and matching monorepo string-convention');
"
```

### Deep Export Path Verification (Deferred to P05/P07)

The following verification command proves every deep export path resolves to a correct TypeScript source file via `tsconfig` paths. It MUST NOT be run in P01 because the target source files do not exist yet. It is run in P05 (after moved files exist) and P07 (full verification):

```bash
# Deep-export path resolution verification — run only after P04d completes
# Each import must resolve through tsconfig paths to the correct source file
node --input-type=module -e "
const deepExports = {
  '@vybestack/llxprt-code-storage/config/storage.js': ['LLXPRT_DIR', 'PROVIDER_ACCOUNTS_FILENAME', 'OAUTH_FILE', 'Storage'],
  '@vybestack/llxprt-code-storage/services/fileSystemService.js': ['FileSystemService', 'StandardFileSystemService'],
  '@vybestack/llxprt-code-storage/services/fileDiscoveryService.js': ['FileDiscoveryService'],
  '@vybestack/llxprt-code-storage/storage/secure-store.js': ['SecureStore', 'SecureStoreError', 'createDefaultKeyringAdapter'],
  '@vybestack/llxprt-code-storage/storage/provider-key-storage.js': ['ProviderKeyStorage', 'getProviderKeyStorage', 'resetProviderKeyStorage'],
  '@vybestack/llxprt-code-storage/storage/sessionTypes.js': ['SESSION_FILE_PREFIX', 'ConversationRecord', 'BaseMessageRecord', 'ToolCallRecord'],
  '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js': ['ConversationFileWriter', 'getConversationFileWriter'],
  '@vybestack/llxprt-code-storage/testing': ['resetConversationFileWriterForTesting'],
};
for (const [path, symbols] of Object.entries(deepExports)) {
  try {
    const mod = await import(path);
    for (const sym of symbols) {
      if (mod[sym] === undefined) {
        console.error('MISSING symbol:', sym, 'from', path);
        process.exit(1);
      }
    }
    console.log('OK:', path, '(' + symbols.length + ' symbols)');
  } catch (e) {
    console.error('FAIL:', path, e.message);
    process.exit(1);
  }
}
console.log('All deep export paths verified.');
"
```

### P01 Scope Boundaries — What NOT to Verify in P01

**Do NOT** verify that deep export targets resolve at build/import time in P01. The export-map entries in `package.json` are declarations that point to `./dist/src/...` paths. These target source files are created in P02-P04. Attempting to import from `@vybestack/llxprt-code-storage/config/storage.js` in P01 will fail because the source file does not exist yet. This is expected and correct.

Specifically, do NOT run any of these in P01:
- `npm run build --workspace @vybestack/llxprt-code-storage` (export targets don't exist yet)
- Deep import verification via `node -e "import('...')"`
- Any test that imports from `./config/storage.js`, `./services/fileSystemService.js`, etc.

**DO** verify in P01:
- `package.json` exists and has no llxprt workspace dependencies
- `tsconfig.json` exists and extends root config
- Barrel files exist
- Logger abstraction typechecks
- Root workspace list includes `packages/storage`

Deep export verification is deferred to P05 (after moved files exist) and P07 (full verification).

## Semantic Verification Checklist

- [ ] Package metadata matches current monorepo conventions (verified by comparing to `packages/core/package.json` and `packages/providers/package.json`).
- [ ] Root export (`"."`) uses object form `{ types, import }`; deep exports use simple string values — matching `@vybestack/llxprt-code-core` and `@vybestack/llxprt-code-providers` convention.
- [ ] Export map is literal exact JSON with all required entries (verified programmatically).
- [ ] No workspace package dependency is present in storage.
- [ ] Logger abstraction is storage-owned and does not import core.
- [ ] No production behavior moved yet beyond scaffolding/logger.
- [ ] `npm install` was run before `npm run typecheck` workspace command.

## Success Criteria

- Scaffold files exist.
- `packages/storage` is in root workspaces.
- Storage package remains leaf.
- P01-V verifier returns PASS before P02.

## Failure Recovery

If scaffold verification fails, fix P01 before moving files.

## Phase Completion Marker

Create `project-plans/issue1590/.completed/P01.md` with files changed and verification output.
