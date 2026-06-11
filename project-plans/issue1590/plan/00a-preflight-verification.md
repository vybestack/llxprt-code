# Phase 00a: Preflight Verification

## Phase ID

`PLAN-20260609-ISSUE1590.P00a`

## Purpose

Verify all extraction assumptions before writing implementation code.

## Prerequisites

- Required: branch `issue1590` exists.
- Expected files from previous phase: none.

## Requirements Implemented (Expanded)

### REQ-LEAF-001: Storage Package Boundary

**Full Text**: `packages/storage` must not depend on any other `@vybestack/llxprt-code-*` workspace package and must not import from `packages/core`.
**Behavior**:

- GIVEN: the plan is about to create `packages/storage`
- WHEN: dependency and import assumptions are checked
- THEN: storage package can be designed as a leaf package with no llxprt workspace dependencies

**Why This Matters**: A storage package that depends on core would create the circular dependency the issue explicitly forbids.

### REQ-TEST-001: Existing Test Coverage Baseline

**Full Text**: Moved storage tests pass in `packages/storage`; compatibility and consuming package tests pass.
**Behavior**:

- GIVEN: existing core tests cover the target storage functionality
- WHEN: preflight inventories those tests
- THEN: each moved implementation has a corresponding moved or added behavioral test

**Why This Matters**: This extraction should preserve behavior, not only move files.

## Implementation Tasks

### Step 1: Quick Baseline Checks

```bash
git status --short && git branch --show-current
if test -d packages/storage; then echo "BLOCKER: packages/storage already exists — STOP and adapt plan (do NOT delete)"; exit 1; else echo "OK: packages/storage absent"; fi
npm ls env-paths ignore @napi-rs/keyring --workspace @vybestack/llxprt-code-core || true
for f in \
  packages/core/src/config/storage.ts \
  packages/core/src/config/storage.test.ts \
  packages/core/src/services/fileSystemService.ts \
  packages/core/src/services/fileSystemService.test.ts \
  packages/core/src/services/fileDiscoveryService.ts \
  packages/core/src/services/fileDiscoveryService.test.ts \
  packages/core/src/utils/gitIgnoreParser.ts \
  packages/core/src/utils/gitIgnoreParser.test.ts \
  packages/core/src/utils/gitUtils.ts \
  packages/core/src/storage/secure-store.ts \
  packages/core/src/storage/secure-store.test.ts \
  packages/core/src/storage/secure-store.spec.ts \
  packages/core/src/storage/secure-store-integration.test.ts \
  packages/core/src/storage/provider-key-storage.ts \
  packages/core/src/storage/provider-key-storage.test.ts \
  packages/core/src/storage/sessionTypes.ts \
  packages/core/src/storage/ConversationFileWriter.ts; do test -f "$f" || { echo "MISSING: $f"; exit 1; }; done
rg "gitIgnoreParser|gitUtils" packages/core/src -g '*.ts' -l
```

**If `packages/storage` already exists**: STOP. Do NOT delete it. Adapt the plan to work with the existing scaffold — check what files already exist, what exports are already configured, and adjust subsequent phases accordingly. Deletion of existing work is never the correct action.

### Step 2: TypeScript Parser-Based Import Inventory

Line-based grep cannot reliably detect multi-line import statements, namespace imports, import-equals, dynamic `import(...)`, or `vi.mock(...)`. Use the TypeScript compiler API to parse every `.ts` file and extract import specifiers with their module specifiers.

Create and run this script from the repository root. The script must:

1. Parse every `.ts` file under `packages/` (excluding `packages/*/dist/**` and `packages/*/node_modules/**`).
2. For each **import kind**, extract identifiers and module specifiers:
   - **Static imports**: `import { X } from '...'` and `import X from '...'` — use `ts.isImportDeclaration`.
   - **Namespace imports**: `import * as X from '...'` — detect `ts.isNamespaceImport`.
   - **Import-equals declarations**: `import X = require('...')` — use `ts.isImportEqualsDeclaration`.
   - **Dynamic imports**: `import('...')` — use `ts.isCallExpression` where `expression.kind === ts.SyntaxKind.ImportKeyword`.
   - **`vi.mock(...)` calls**: detect mock calls referencing core, parse factory return objects for moved symbol names, detect `importOriginal` spreads and local class shadows.
3. Report every file that imports or mocks any **moved symbol** from `@vybestack/llxprt-code-core`.
4. Output to:
   - **JSON**: `project-plans/issue1590/.completed/P00a-import-inventory.json`
   - **Text**: `project-plans/issue1590/.completed/P00a-import-inventory.txt`
5. **FAIL** if any moved symbol is imported/mocked from core that is not listed in P06.

#### P00a Hard-Gate Inventory Write-Back

The generated `project-plans/issue1590/.completed/P00a-import-inventory.json` MUST include **every** moved symbol discovered by the parser, including:
- All runtime value imports (`SecureStore`, `Storage`, `FileDiscoveryService`, etc.)
- All type-only imports (`SecureStoreErrorCode`, `KeyringAdapter`, `SecureStoreOptions`, `FilterFilesOptions`, `FilterReport`, `ConversationRecord`, `BaseMessageRecord`, `ToolCallRecord`)
- All `vi.mock(...)` factory symbols (e.g., `Storage`, `SecureStore`, `FileDiscoveryService`, `ProviderKeyStorage`, `LLXPRT_DIR` in mock factory return objects)
- All `vi.mock(...)` factory local class names (e.g., `Storage` in `class Storage { ... }` inside `vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => { ... })`)

**Hard-gate write-back procedure**:

After the parser inventory completes, P00a MUST perform the following validation:

1. Read the generated `P00a-import-inventory.json`.
2. For every file in `consumers[]`, verify each imported/mocked symbol appears in the `movedSymbols` array.
3. Compare the list of consumer file paths against the consumer file paths listed in `plan/06-consumer-integration-dependency-graph.md`.
4. **If any consumer file path exists in the inventory but NOT in P06**: P00a returns **BLOCKED** with the following required remediation:
   - Print: `BLOCKED: P00a inventory found <N> consumers not listed in P06: <file paths>`
   - Update `plan/06-consumer-integration-dependency-graph.md` to add each missing consumer with exact import rewrite instructions.
   - Update `specification.md` with the missing consumer in the "Existing Non-Core Consumers To Update Directly" section.
   - Update `analysis/domain-model.md` with the missing consumer in the "Consumer Touchpoints" section.
   - Re-run the parser inventory to confirm completeness.
   - Only after ALL plan files are updated may P00a proceed (re-run Step 2 and confirm BLOCKED is not triggered).
5. **If any consumer file path exists in P06 but NOT in the inventory**: P00a reports a warning in `.completed/P00a.md` noting the discrepancy but does not block (P06 consumer may be a future/planned import).
6. Write the reconciliation status to `P00a-import-inventory.json` under `reconciliation.status` as either `"pending"` (default, no comparison done yet — must be updated to `"pass"` or `"blocked"` before P00a completes).

**P00a completion requires**: `reconciliation.status` in the JSON file must be `"pass"`. If it is `"blocked"` or `"pending"`, P00a returns BLOCKED and the executor must update plan files before proceeding to P01.

#### P00a-import-inventory.json Output Schema (Exact)

The JSON output file MUST conform to this schema. P06 depends on this file for reconciliation and the exact structure must be parseable by downstream scripts.

```jsonc
{
  // Top-level metadata
  "generatedAt": "ISO-8601 timestamp",
  "fromPackage": "@vybestack/llxprt-code-core",
  "scanDir": "packages",
  "movedSymbols": [
    "LLXPRT_DIR", "PROVIDER_ACCOUNTS_FILENAME", "OAUTH_FILE",
    "Storage", "SecureStore", "SecureStoreError", "SecureStoreErrorCode",
    "KeyringAdapter", "SecureStoreOptions", "createDefaultKeyringAdapter",
    "FileSystemService", "StandardFileSystemService",
    "FileDiscoveryService", "FilterFilesOptions", "FilterReport",
    "ProviderKeyStorage", "KEY_NAME_REGEX", "validateKeyName",
    "getProviderKeyStorage", "resetProviderKeyStorage",
    "ConversationFileWriter", "getConversationFileWriter",
    "SESSION_FILE_PREFIX", "ConversationRecord", "BaseMessageRecord", "ToolCallRecord"
  ],

  // Array of every file that imports or mocks a moved symbol from core
  "consumers": [
    {
      "filePath": "packages/cli/src/config/paths.ts",  // absolute or relative from repo root
      "imports": [
        {
          "symbol": "Storage",           // the moved symbol imported
          "importKind": "static-import",  // one of: "static-import", "namespace-import", "import-equals", "dynamic-import", "vi.mock"
          "moduleSpecifier": "@vybestack/llxprt-code-core",  // the full module specifier
          "line": 42                      // 1-based line number in the source file
        }
      ]
    }
  ],

  // Summary counts for quick validation
  "summary": {
    "totalFiles": 57,             // total consumer files found
    "totalImports": 83,           // total individual import entries across all files
    "byImportKind": {
      "static-import": 60,
      "namespace-import": 0,
      "import-equals": 0,
      "dynamic-import": 5,
      "vi.mock": 18
    },
    "byPackage": {
      "packages/cli": 35,
      "packages/mcp": 4,
      "packages/providers": 2,
      "packages/a2a-server": 1,
      "packages/core": 15
    }
  },

  // Reconciliation result
  // P00a sets status to "pass" (all consumers matched) or "blocked" (missing consumers found).
  // P06 performs a separate reconciliation by re-running the inventory script post-rewiring
  // and writes its own P06 reconciliation result in .completed/P06.md, not in this file.
  "reconciliation": {
    "status": "pass",  // set by P00a: "pass" or "blocked". P06 does NOT modify this field.
    "missingFromPlan": [], // consumers found by inventory but not listed in P06 — populated by P00a
    "extraInPlan": []      // consumers listed in P06 but not found by inventory — populated by P00a
  }
}
```

**Key invariants**:
- Every entry in `consumers[].imports[].symbol` MUST be one of the `movedSymbols` array values.
- Every entry in `consumers[].imports[].importKind` MUST be one of: `"static-import"`, `"namespace-import"`, `"import-equals"`, `"dynamic-import"`, `"vi.mock"`.
- `summary.totalFiles` MUST equal `consumers.length`.
- `summary.totalImports` MUST equal the sum of all `consumers[].imports.length`.
- `reconciliation.status` is set by P00a to `"pass"` or `"blocked"`. P06 does NOT modify this field — P06 performs its own separate reconciliation (recorded in `.completed/P06.md`).

Save the script as `scripts/preflight-import-inventory.mjs` and run it:

```bash
mkdir -p project-plans/issue1590/.completed
node scripts/preflight-import-inventory.mjs \
  --moved-symbols LLXPRT_DIR,PROVIDER_ACCOUNTS_FILENAME,OAUTH_FILE,Storage,SecureStore,SecureStoreError,SecureStoreErrorCode,KeyringAdapter,SecureStoreOptions,createDefaultKeyringAdapter,FileSystemService,StandardFileSystemService,FileDiscoveryService,FilterFilesOptions,FilterReport,ProviderKeyStorage,KEY_NAME_REGEX,validateKeyName,getProviderKeyStorage,resetProviderKeyStorage,ConversationFileWriter,getConversationFileWriter,SESSION_FILE_PREFIX,ConversationRecord,BaseMessageRecord,ToolCallRecord \
  --from-package @vybestack/llxprt-code-core \
  --scan-dir packages \
  --exclude-glob 'packages/*/dist/**,packages/*/node_modules/**' \
  --detect-kinds static-import,namespace-import,import-equals,dynamic-import,vi.mock \
  --expected-consumers-file project-plans/issue1590/plan/06-consumer-integration-dependency-graph.md \
  --output-json project-plans/issue1590/.completed/P00a-import-inventory.json \
  --output-text project-plans/issue1590/.completed/P00a-import-inventory.txt
```

**Script lifecycle**: `scripts/preflight-import-inventory.mjs` is retained after P00a for use in P06 reconciliation and P07 stale-import checks. It MUST NOT be deleted after P00a. It may only be removed after P07 completes successfully if explicitly desired. P06 and P07 must be able to re-run it.

### Step 3: Core Export Map Baseline

```bash
node -e "
const p = require('./packages/core/package.json');
const e = p.exports || {};
const existing = ['./config/storage.js','./storage/secure-store.js','./storage/ConversationFileWriter.js'];
const missing = ['./services/fileSystemService.js','./services/fileDiscoveryService.js','./storage/provider-key-storage.js','./storage/sessionTypes.js'];
console.log('=== Existing core deep exports (already in export map) ===');
existing.forEach(k => console.log(k + ': ' + JSON.stringify(e[k])));
console.log('=== Missing core deep exports (P05 must ADD these) ===');
missing.forEach(k => console.log(k + ': ' + (e[k] ? 'UNEXPECTED PRESENT' : 'MISSING - will be added as NEW compatibility export in P05')));
"
```

Record the output.

### Step 4: Git Utilities Core Usage Check

```bash
rg "gitIgnoreParser|gitUtils" packages/core/src -g '*.ts' -l
```

Record output. Verify that non-storage core code (outside `fileDiscoveryService.ts`) uses these utilities, confirming they must remain in core.

### Step 5: Create Verification Scripts

Define the import boundary and cycle detection scripts in P00a so they are available for use throughout P02-P07. These scripts are validated in P00a with initial test runs against the current codebase (before any storage package exists).

#### `scripts/check-storage-import-boundary.mjs`

- Parse `.ts` files with TypeScript compiler API.
- Exclude `packages/*/dist/**`.
- Detect all import kinds: static imports, namespace imports, import-equals, dynamic `import(...)`, and `vi.mock(...)`.
- Check all moved deep paths: `config/storage`, `services/fileSystemService`, `services/fileDiscoveryService`, `storage/secure-store`, `storage/provider-key-storage`, `storage/sessionTypes`, `storage/ConversationFileWriter`.
- Also check root imports of moved symbol names from `@vybestack/llxprt-code-core`.
- Accept `--exclude-core-compat-tests` flag to whitelist `packages/core/src/storage/storage-compat.test.ts`.
- Moved symbols: `LLXPRT_DIR`, `PROVIDER_ACCOUNTS_FILENAME`, `OAUTH_FILE`, `Storage`, `SecureStore`, `SecureStoreError`, `SecureStoreErrorCode`, `FileDiscoveryService`, `FileSystemService`, `StandardFileSystemService`, `ProviderKeyStorage`, `getProviderKeyStorage`, `resetProviderKeyStorage`, `createDefaultKeyringAdapter`, `ConversationFileWriter`, `getConversationFileWriter`, `SESSION_FILE_PREFIX`, `ConversationRecord`, `BaseMessageRecord`, `ToolCallRecord`, `KeyringAdapter`, `SecureStoreOptions`, `FilterFilesOptions`, `FilterReport`.
- **P00a validation**: Run against the current codebase (pre-extraction) to confirm the script correctly detects all known consumers listed in P06. If the script output does not match P06, adjust the script or update P06 accordingly.

#### `scripts/check-storage-package-cycle.mjs`

- Read package manifests for workspace packages.
- In `--production` mode inspect only `dependencies` and `optionalDependencies`.
- In `--all-dependencies` mode also inspect `devDependencies`.
- Fail if any dependency cycle includes `@vybestack/llxprt-code-storage`.
- **P00a validation**: Run in `--production` and `--all-dependencies` modes. Before extraction, storage does not exist yet, so the script should exit cleanly (no cycle involving a nonexistent package). If it errors on missing storage package, add a `--skip-missing` flag or conditional check.

### Files to Create or Modify

- Create `scripts/preflight-import-inventory.mjs` (retained through P07).
- Create `scripts/check-storage-import-boundary.mjs` (defined in P00a, available for P06/P07).
- Create `scripts/check-storage-package-cycle.mjs` (defined in P00a, available for P06/P07).
- Create `project-plans/issue1590/.completed/P00a.md`
  - MUST include command outputs from all steps.
  - MUST include parser inventory output.
  - MUST include core export map baseline.
  - MUST include verification script P00a validation results.
  - MUST include any plan adjustments.
  - MUST include explicit PASS/FAIL for parser inventory vs. P06 consumer list.
- Create `project-plans/issue1590/.completed/P00a-import-inventory.json`
- Create `project-plans/issue1590/.completed/P00a-import-inventory.txt`

## Verification Commands

- Confirm command outputs are captured in `.completed/P00a.md`.
- Confirm target source/test files exist.
- Confirm `packages/storage` is absent. If present, STOP and adapt (do NOT delete).
- Confirm parser inventory output exists at exact paths `project-plans/issue1590/.completed/P00a-import-inventory.json` and `.completed/P00a-import-inventory.txt`.
- Confirm parser inventory matches P06 consumer list.
- Confirm core export map baseline distinguishes existing vs. missing entries.
- Confirm `scripts/check-storage-import-boundary.mjs` and `scripts/check-storage-package-cycle.mjs` exist and pass initial validation.
- Confirm no preflight blocker is left unresolved.

## Semantic Verification Checklist

- [ ] Read `specification.md` and `analysis/domain-model.md`.
- [ ] Explain why `SessionPersistenceService` remains in core or revise the plan with evidence.
- [ ] Explain how storage can be leaf despite `SecureStore` logging needs.
- [ ] Identify all direct cross-package consumers to update (validated by parser output).
- [ ] Confirm core git utilities remain only because non-storage core utilities still use them.
- [ ] Confirm parser inventory validates P06 consumer list is complete, including `vi.mock` and dynamic import forms.
- [ ] Confirm `secure-store-integration.test.ts` imports core-owned `../tools/tool-key-storage.js` and plan accounts for split.
- [ ] Confirm non-core test files mocking storage symbols from core are in P06 consumer list.
- [ ] Confirm verification scripts (`check-storage-import-boundary.mjs`, `check-storage-package-cycle.mjs`) are created in P00a and available for P06/P07.
- [ ] Confirm `scripts/preflight-import-inventory.mjs` lifecycle: retained through P07, only removable after final verification.

## Success Criteria

- `.completed/P00a.md` exists with all step outputs.
- `.completed/P00a-import-inventory.json` and `.completed/P00a-import-inventory.txt` exist at exact paths.
- `P00a-import-inventory.json` has `reconciliation.status` equal to `"pass"` (not `"pending"` or `"blocked"`). P00a writes this field — P06 does NOT modify it but performs its own separate reconciliation recorded in `.completed/P06.md`.
- Parser inventory confirms P06 consumer list covers every moved-symbol import from core.
- Core export map baseline distinguishes existing deep exports from ones P05 must add.
- Verification scripts exist and pass initial validation.
- No unresolved preflight blocker remains.
- Proceeding to package scaffold is safe.

## Failure Recovery

If preflight fails:
1. **Parser inventory finds consumers not listed in P06**: **Hard STOP**. The `P00a-import-inventory.json` `reconciliation.status` must be set to `"blocked"`. Update `plan/06-consumer-integration-dependency-graph.md`, `specification.md`, and `analysis/domain-model.md` with exact missing consumer entries and import rewrite instructions. Then re-run P00a. P00a may only complete when `reconciliation.status` is `"pass"`.
2. If source files are missing: update the plan to reflect current file structure.
3. If `packages/storage` already exists: STOP and adapt the plan to work with the existing scaffold. Do NOT delete it.
4. Stop and update all affected plan files before P01.
