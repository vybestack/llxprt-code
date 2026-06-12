# Dependency Relocation Final: Non-Relative Imports For Moved Tools

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585
Generated: 2026-06-08

This document classifies every non-relative import used by tools-bound files and specifies the `packages/tools/package.json` direct runtime dependencies required after extraction.

## Evidence Collection Commands

```bash
# Full tools non-relative import inventory (excluding Node stdlib and vitest)
rg -n "^import .* from ['\"][^./]" packages/core/src/tools -g "*.ts" | \
  rg -v "vitest|@types|node:|child_process|fs'|fs/|fs\"|path'|path\"|os'|os\"|crypto|events|string_decoder|stream" | sort
```

**Evidence preservation rule**: Dependency versions MUST be preserved exactly from `packages/core/package.json` unless intentionally changed with documented evidence. Run:

```bash
node -e "const core=require('./packages/core/package.json'); for (const d of ['@ast-grep/napi','@google/genai','cheerio','diff','fast-glob','glob','html-to-text','node-fetch','shell-quote','turndown','zod']) console.log(d, core.dependencies[d])"
```

Versions verified on 2026-06-08 against actual `packages/core/package.json`:
- `@ast-grep/napi` → `^0.40.5` [OK]
- `@google/genai` → `1.30.0` [OK]
- `cheerio` → `^1.1.2` [OK]
- `diff` → `^8.0.3` [OK]
- `fast-glob` → `^3.3.3` [OK]
- `glob` → `^12.0.0` [OK]
- `html-to-text` → `^9.0.5` [OK]
- `node-fetch` → `^3.3.2` [OK]
- `shell-quote` → `^1.8.3` [OK]
- `turndown` → `^7.2.2` [OK]
- `zod` → `^3.25.76` [OK]

For `zod-to-json-schema`, not in core/package.json dependencies; lockfile version `3.25.1` verified:
```bash
rg -n "zod-to-json-schema" packages/core/package.json package-lock.json | head -5
# Result: only in package-lock.json as "^3.25.1"
```

## External Runtime Dependencies Required By Moved Tools

### Category: diff

| Package | Used By (Moved Files) | Type | Notes |
| --- | --- | --- | --- |
| `diff` | edit.ts, apply-patch.ts, delete_line_range.ts, insert_at_line.ts, write-file.ts, modifiable-tool.ts, memoryTool.ts, ast-edit-invocation.ts, diffOptions.ts | runtime | Text diffing for edit tools |

### Category: glob/search

| Package | Used By (Moved Files) | Type | Notes |
| --- | --- | --- | --- |
| `fast-glob` | ast-grep.ts, structural-analysis.ts | runtime | Fast globbing for AST tools |
| `glob` | glob.ts, read-many-files.ts, grep.ts | runtime | Glob pattern matching |

### Category: AST

| Package | Used By (Moved Files) | Type | Notes |
| --- | --- | --- | --- |
| `@ast-grep/napi` | ast-grep.ts, structural-analysis.ts, ast-edit/ast-query-extractor.ts, ast-edit/edit-calculator.ts, ast-edit/cross-file-analyzer.ts | runtime | AST pattern matching |

### Category: Web/fetch

| Package | Used By (Moved Files) | Type | Notes |
| --- | --- | --- | --- |
| `node-fetch` | codesearch.ts, direct-web-fetch.ts, exa-web-search.ts | runtime | HTTP fetch polyfill |
| `turndown` | direct-web-fetch.ts | runtime | HTML to markdown |
| `cheerio` | direct-web-fetch.ts | runtime | HTML parsing |
| `html-to-text` | google-web-fetch.ts | runtime | HTML to text conversion |

### Category: Schema/validation

| Package | Used By (Moved Files) | Type | Notes |
| --- | --- | --- | --- |
| `zod` | activate-skill.ts, todo-schemas.ts | runtime | Schema validation |

**`zod-to-json-schema` EXCLUDED**: Although `packages/core/src/tools/activate-skill.ts` imports `zod-to-json-schema` (evidence: `rg -n "zod-to-json-schema" packages/core/src/tools/activate-skill.ts`), `activate-skill.ts` is an adapter-bridged tool that receives its dependencies via constructor injection (`ISkillService`). The `zodToJsonSchema` import in `activate-skill.ts` is used only in the tool's `build()` method for schema conversion. After extraction, this import will be a direct import in `packages/tools/src/tools/activate-skill.ts`. However, `packages/core/src/agents/executor.ts` ALSO imports `zod-to-json-schema` (line 49), and executor.ts STAYS in core. Since both packages use `zod-to-json-schema`, it MUST be declared in both `packages/tools/package.json` AND `packages/core/package.json` dependencies. For packages/tools: add `"zod-to-json-schema": "^3.25.1"`. For packages/core: add to dependencies (it is currently only in the lockfile, not in core/package.json deps — this is a pre-existing undeclared dependency). **Update the `packages/tools/package.json` final dependencies block below to include `zod-to-json-schema`.**

### Category: Provider SDK

| Package | Used By (Moved Files) | Type | Notes |
| --- | --- | --- | --- |
| `@google/genai` | read-file.ts, read_line_range.ts, read-many-files.ts, memoryTool.ts, tool-registry.ts, mcp-tool.ts, todo-pause.ts, todo-read.ts, todo-write.ts, ToolFormatter.test.ts | runtime | Google GenAI SDK types |

### Category: MCP SDK (only if mcp-tool.ts moves)

| Package | Used By (Moved Files) | Type | Notes |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | mcp-tool.ts (conditional) | runtime | Only needed if mcp-tool moves. mcp-client stays in core. |

### Category: Shell

| Package | Used By (Moved Files) | Type | Notes |
| --- | --- | --- | --- |
| `shell-quote` | tool-registry.ts | runtime | Shell command parsing |

## packages/tools/package.json Dependencies (Final)

Dependency versions sourced from current `packages/core/package.json` (evidence: `node -e "const core=require('./packages/core/package.json'); for (const d of [...]) console.log(d, core.dependencies[d])"`). Versions are preserved exactly unless intentionally changed with evidence. All dependencies verified on 2026-06-08 against actual `packages/core/package.json`:

| Package | Version | Source | Evidence |
| --- | --- | --- | --- |
| `@ast-grep/napi` | `^0.40.5` | core/package.json | Verified |
| `@google/genai` | `1.30.0` | core/package.json | Verified |
| `cheerio` | `^1.1.2` | core/package.json | Verified |
| `diff` | `^8.0.3` | core/package.json | Verified |
| `fast-glob` | `^3.3.3` | core/package.json | Verified |
| `glob` | `^12.0.0` | core/package.json | Verified |
| `html-to-text` | `^9.0.5` | core/package.json | Verified |
| `node-fetch` | `^3.3.2` | core/package.json | Verified |
| `shell-quote` | `^1.8.3` | core/package.json | Verified |
| `turndown` | `^7.2.2` | core/package.json | Verified |
| `zod` | `^3.25.76` | core/package.json | Verified |
| `zod-to-json-schema` | `^3.25.1` | package-lock.json | Both core/src/agents/executor.ts and core/src/tools/activate-skill.ts use it. Add to tools deps; core must also add it. |

```json
{
  "dependencies": {
    "@ast-grep/napi": "^0.40.5",
    "@google/genai": "1.30.0",
    "cheerio": "^1.1.2",
    "diff": "^8.0.3",
    "fast-glob": "^3.3.3",
    "glob": "^12.0.0",
    "html-to-text": "^9.0.5",
    "node-fetch": "^3.3.2",
    "shell-quote": "^1.8.3",
    "turndown": "^7.2.2",
    "zod": "^3.25.76",
    "zod-to-json-schema": "^3.25.1"
  },
  "devDependencies": {
    "@types/node": "^24.2.1",
    "@vybestack/llxprt-code-test-utils": "file:../test-utils",
    "typescript": "^5.3.3",
    "vitest": "^3.2.4"
  }
}
```

**`zod-to-json-schema` decision**: Confirmed used by both `packages/core/src/tools/activate-skill.ts` (moves to tools) and `packages/core/src/agents/executor.ts` (stays in core). Evidence: `rg -n "zod-to-json-schema" packages/core/src packages/cli/src packages/providers/src -g "*.ts"`. Since the activate-skill.ts file moves to packages/tools, `zod-to-json-schema` MUST be in tools dependencies. Core must also declare it (currently undeclared in core/package.json — a pre-existing gap).

**Note**: If `mcp-tool.ts` moves to packages/tools, add `"@modelcontextprotocol/sdk": "^1.0.0"` to dependencies. If it stays in core, omit it.

**Note**: `@vybestack/llxprt-code-test-utils` MUST be a devDependency only, never a runtime dependency.

**npm/package-lock process**: This plan follows the existing npm/package-lock release process despite the root `packageManager` field saying pnpm. The packageManager field is vestigial.

**FORBIDDEN**: packages/tools MUST NOT list `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, or `@vybestack/llxprt-code` in dependencies or devDependencies.

## Moved Non-Tools Utility External Dependency Scan

External dependency relocation scans must cover ALL files classified to move — not just current direct imports under `packages/core/src/tools`. When non-tools utilities are moved into `packages/tools` (e.g., SchemaValidator, AnsiOutput, pure functions from tool-key-storage, and all MOVE_PURE_UTILITY items from `analysis/non-tools-core-utility-ownership-final.md`), their runtime dependencies MUST also be declared in `packages/tools/package.json` before P11.

### Complete Scan Scope

1. **Tools-bound files**: `packages/core/src/tools/**/*.ts` (production files classified as MOVE_NOW or MOVE_AFTER_INTERFACE)
2. **Moved utility files**: All `MOVE_PURE_UTILITY` entries from `analysis/non-tools-core-utility-ownership-final.md` (e.g., `utils/schemaValidator.ts`, `utils/paths.ts`, `utils/errors.ts`, `utils/gitUtils.ts`, `utils/ripgrepPathResolver.ts`, `utils/ignorePatterns.ts`, `utils/retry.ts`, `utils/unicodeUtils.ts`, `utils/generateContentResponseUtilities.ts`, `utils/fetch.ts`, `utils/shell-parser.ts`, `utils/summarizer.ts`, `utils/toolOutputLimiter.ts`, `utils/formatters.ts`, `utils/shell-utils.ts`, `utils/fileUtils.ts`, `utils/ast-grep-utils.ts`, `utils/safeJsonStringify.ts`, `utils/gitLineChanges.ts`, `utils/getFolderStructure.ts`, `utils/resolveTextSearchTarget.ts`)
3. **Moved service/helper files**: Any helper or service file classified as MOVE that has its own external imports

### P09 Dependency Classification Requirements

P09 must:
1. Run `rg -n "^import .* from ['"][^./]" packages/core/src/tools -g "*.ts"` and classify every result
2. For each external package, determine if it is runtime or dev-only (test files only)
3. Add every runtime dependency to `packages/tools/package.json` dependencies
4. Add every dev-only dependency to `packages/tools/package.json` devDependencies
5. Verify no core/providers/cli packages appear in either list
6. After classifying utilities to move per `analysis/non-tools-core-utility-ownership-final.md`, run the moved-utility external dependency scan:
   ```bash
   xargs rg -n "^import .* from ['"][^./]" < project-plans/issue1585/analysis/moved-non-tools-utils.txt > project-plans/issue1585/analysis/moved-utility-external-imports.txt
   ```
7. Add every newly-discovered external runtime dependency to `packages/tools/package.json` dependencies
8. Verify no new dependency is a forbidden core/providers/cli package
9. Generate `analysis/tools-external-dependency-map-final.md` with complete per-file external import classification for ALL moved files (tools + utilities + service/helpers)

## P09/P11 Dependency Classification Requirements

P09 must:
1. Run `rg -n "^import .* from ['\"][^./]" packages/core/src/tools -g "*.ts"` and classify every result
2. For each external package, determine if it is runtime or dev-only (test files only)
3. Add every runtime dependency to `packages/tools/package.json` dependencies
4. Add every dev-only dependency to `packages/tools/package.json` devDependencies
5. Verify no core/providers/cli packages appear in either list

P11 must:
1. Before each migration group, verify all required dependencies are declared in `packages/tools/package.json`
2. After each migration group, run `npm install --workspace @vybestack/llxprt-code-tools` to resolve new deps
3. After each migration group, run `npm run typecheck --workspace @vybestack/llxprt-code-tools` to verify resolution
4. After ALL migration groups, run the post-move transitive external import scan:
   ```bash
   rg -n "^import .* from ['"][^./]" packages/tools/src -g "*.ts" | sort
   ```
   Compare the scan output against `packages/tools/package.json` dependencies. Every external package in the scan MUST appear in dependencies. Any package not declared is a missing dependency that MUST be added before the move is considered complete.

## Post-Move External Dependency Scan

After all P11 migration groups complete, run the transitive external import scan to verify complete dependency coverage:

```bash
# Full post-move external import scan (production code only, excluding test/spec files)
rg -n "^import .* from ['\"][^./]" packages/tools/src -g "*.ts" | rg -v "__tests__|\.test\.|\.spec\." | sort

# Full post-move external import scan (all files, for completeness)
rg -n "^import .* from ['\"][^./]" packages/tools/src -g "*.ts" | sort
```

Every external package in the production scan MUST be listed in `packages/tools/package.json` dependencies.

```bash
# Compare against declared dependencies
node -e "const p=require('./packages/tools/package.json'); console.log(Object.keys(p.dependencies||{}).sort().join('\n'))"

# Verify every external import is declared
node -e "
const p = require('./packages/tools/package.json');
const deps = new Set(Object.keys(p.dependencies || {}));
const stdlib = new Set(['node:child_process','node:fs','node:fs/promises','node:path','node:os','node:crypto','node:events','node:stream','node:string_decoder','node:url','node:util','node:assert']);
"
```

### Per-File External Import Classification

Every non-relative import in every moved production file MUST be classified as one of:

| Classification | Description | Action |
| --- | --- | --- |
| `RUNTIME` | Import used in production code path | MUST be in `packages/tools/package.json` dependencies |
| `TYPE_ONLY` | `import type` only — erased at compile | If from npm package, must still be in dependencies (TypeScript needs it for compilation) |
| `TEST_ONLY` | Used only in `*.test.ts` or `*.spec.ts` files | Must be in devDependencies, NOT dependencies |
| `STDLIB` | Node.js built-in (`node:fs`, `node:path`, etc.) | No action needed |
| `MONOREPO_LOCAL` | Import from `@vybestack/llxprt-code-tools` (self-reference) | No action needed |
| `FORBIDDEN` | Import from core/providers/cli | MUST NOT exist — build must fail |

**Evidence command to classify all production imports**:
```bash
rg -n "^import .* from ['\"][^./]" packages/tools/src -g "*.ts" | rg -v "__tests__|\.test\.|\.spec\." | awk -F: '{print $1}' | sort -u | while read f; do
  echo "=== $f ==="
  rg -n "^import .* from ['\"][^./]" "$f" -g "*.ts" | rg -v "node:"
done
```

**Complete package dependency verifier for packages/tools** (replaces partial Node snippet). This script fails on undeclared external imports:

```bash
# Complete dependency verifier: fails if any external import is undeclared
! rg -n "^import .* from ['\"][^./]" packages/tools/src -g "*.ts" | rg -v "__tests__|\.test\.|\.spec\.|node:|vitest|@vybestack/llxprt-code-tools" | awk -F"from ['\"" '{print $2}' | awk -F"['\"]" '{print $1}' | sort -u | while read pkg; do
  node -e "const p=require('./packages/tools/package.json'); const d=Object.keys({...p.dependencies,...(p.devDependencies||{})}); if (!d.includes('$pkg')) { console.error('UNDECLARED: $pkg'); process.exit(1); }"
done
# Expected: exit code 0 (all external imports declared)
```


After all moves and before merge, verify the tools package can be packed, installed, and imported as a publishable npm package:

```bash
rm -rf /tmp/llxprt-tools-pack /tmp/llxprt-tools-smoke
mkdir -p /tmp/llxprt-tools-pack /tmp/llxprt-tools-smoke
npm pack -w @vybestack/llxprt-code-tools --pack-destination /tmp/llxprt-tools-pack
cd /tmp/llxprt-tools-smoke
npm init -y
npm install /tmp/llxprt-tools-pack/vybestack-llxprt-code-tools-*.tgz
node -e "import('@vybestack/llxprt-code-tools').then(m => { if (!Object.keys(m).length) process.exit(1); })"
cd "$OLDPWD"
```

This smoke test verifies:
1. `npm pack` produces a valid tarball (no missing files, build artifacts exist)
2. The tarball installs into a clean project (dependency resolution works)
3. The package exports are importable and non-empty (public API is accessible)

## Package-Lock And Root Workspace Assertions

```bash
# Verify packages/tools exists in package-lock.json
node -e "const p=require('./package-lock.json'); if (!p.packages['packages/tools']) process.exit(1)"

# Verify packages/tools is in root workspaces
node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/tools')) process.exit(1)"

# Verify core/providers package-lock entries include tools dependencies after install
node -e "
const lock = require('./package-lock.json');
const coreDeps = lock.packages['packages/core'];
const providersDeps = lock.packages['packages/providers'];
if (coreDeps && !coreDeps.dependencies?.['@vybestack/llxprt-code-tools']) console.log('WARNING: core does not declare tools dependency in lockfile');
if (providersDeps && !providersDeps.dependencies?.['@vybestack/llxprt-code-tools']) console.log('NOTE: providers may not need tools in lockfile yet (post-P13)');
"
```

## Verification Commands

```bash
# Verify no forbidden dependencies — failing form
! rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code" packages/tools/package.json
# Expected: exit code 0 (zero matches)

# Verify test-utils is devDependency only
node -e "const p=require('./packages/tools/package.json'); if (p.dependencies && p.dependencies['@vybestack/llxprt-code-test-utils']) process.exit(1)"

# Full dependency health check (advisory — do not treat as sole proof)
npx depcheck packages/tools
```

## Tests Violating Dependency Direction

These tests currently import from providers while living in core/tools. After tools extraction to packages/tools, these tests MUST NOT import from providers (which would create a forbidden tools→providers dependency). Resolution: rewrite to local structural fixtures or keep provider-specific assertions in providers.

| Test File | Current Import | Violation | Required Resolution |
| --- | --- | --- | --- |
| `ToolFormatter.toResponsesTool.test.ts` | `import type { ITool } from '@vybestack/llxprt-code-providers/ITool.js'` | tools→providers dependency direction violation | Rewrite: replace provider `ITool` type with a local structural fixture that tests the same ToolFormatter output shape. OR: move this specific test file to `packages/providers/src/__tests__/` and import `ToolFormatter` from tools. The test must NOT remain in packages/tools importing from providers. |

**Rule**: After tools extraction, NO test file in packages/tools may import from @vybestack/llxprt-code-providers. If a test needs provider types, either:
1. Replace the provider type with a tools-local structural type matching the required shape, OR
2. Move the test to the providers package where it can import both providers and tools

**Test fixture anti-coupling rule**: Test fixtures in `packages/tools/src/__tests__/fixtures/**` MUST NOT import from `@vybestack/llxprt-code-core` or `@vybestack/llxprt-code-providers`. Fixtures must use tools-local types and structural shapes. This prevents the test infrastructure from creating forbidden dependency paths. The `@vybestack/llxprt-code-test-utils` devDependency must not transitively introduce core/provider types into tools test files.