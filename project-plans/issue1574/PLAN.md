# Issue #1574: Decompose `ast-edit.ts` into Focused Modules

**Related Issues:** #1568 (codebase-wide god object decomposition), #1574 (ast-edit.ts specific)
**Branch:** `issue1574`
**Guiding Principles:** Separation of Concerns (SoC), DRY, behavioral testing (per `dev-docs/RULES.md`)

## Problem Statement

`packages/core/src/tools/ast-edit.ts` is a 2,491-line monolith containing 10 classes, 18 interfaces, and 3 exported constants. It mixes **ten** distinct concerns:

1. **AST parsing and declaration extraction** (`ASTQueryExtractor`, L267–479)
2. **Configuration and feature flags** (`ASTConfig`, L482–544)
3. **Repository/git context collection** (`RepositoryContextProvider`, L547–665)
4. **Cross-file symbol analysis** (`CrossFileRelationshipAnalyzer`, L668–989)
5. **Prompt optimization** (`ContextOptimizer`, L992–1079)
6. **Context orchestration** (`ASTContextCollector`, L1082–1537)
7. **Tool definitions** (`ASTEditTool` L1540–1692, `ASTReadFileTool` L1695–1775)
8. **Edit execution logic** (`ASTEditToolInvocation` L1778–2325 — preview, apply, confirm, calculateEdit, validation, diff, file I/O)
9. **Read execution logic** (`ASTReadFileToolInvocation`, L2327–2480)
10. **Shared types and constants** (interfaces L88–264, `CalculatedEdit` L2482–2491, `KEYWORDS` L60–70, `COMMENT_PREFIXES` L76, `REGEX` L82–85)

Additionally, `ast-edit.ts` duplicates utilities found in `edit.ts` and within itself:
- `ensureParentDirectoriesExist` — verbatim duplicate (ast-edit.ts L2317, edit.ts L822)
- `Diff.createPatch` with `DEFAULT_CREATE_PATCH_OPTIONS` — repeated 3x in ast-edit.ts (L1815, L1946, L2082) and 2x in edit.ts (L596, L741)
- `extractImports` — near-identical logic in both `CrossFileRelationshipAnalyzer` (L899) and `ASTContextCollector` (L1285)
- `detectLanguage` — identical logic in both `CrossFileRelationshipAnalyzer` (L981) and `ASTContextCollector` (L1244)

## Goals

1. Decompose `ast-edit.ts` into focused single-responsibility modules
2. Preserve all existing behavior — zero functional changes
3. Maintain import path stability (`'../tools/ast-edit.js'` must continue to work)
4. Establish clear internal module visibility policy (see below)
5. Eliminate DRY violations both with `edit.ts` and within `ast-edit.ts` itself
6. Ensure behavioral test coverage for all high-risk extraction targets

## Non-Goals

- Changing any behavior of ASTEditTool or ASTReadFileTool
- Changing the tool schemas or parameter shapes
- Refactoring `edit.ts` beyond importing shared utilities
- Adding new features to the AST tools
- Arbitrary method-size limits (methods should be coherent, not artificially chopped)
- **Unifying `applyReplacement` logic between `edit.ts` and `ast-edit.ts`** — see "No-Behavior-Unification Warning" below

## WARNING: No-Behavior-Unification Warning: `edit.ts` vs `ast-edit.ts` `applyReplacement`

The `applyReplacement` implementations in `edit.ts` (L69–169) and `ast-edit.ts` (L1547–1565) **intentionally diverge** and MUST NOT be unified:

- **`edit.ts`** `applyReplacement` (L69): Accepts `expectedReplacements` parameter, supports fuzzy matching via `fuzzyReplace()`, handles multi-occurrence replacement with index tracking, preserves trailing newlines.
- **`ast-edit.ts`** `ASTEditTool.applyReplacement` (L1547): Simple single-replace via `String.replace()`, no fuzzy matching, no multi-occurrence support.

These are **different domain behaviors**, not copy-paste duplication. Extracting `ast-edit.ts`'s version to `edit-helpers.ts` is correct. Merging them into a shared function would break one or both tools. Any future implementer must be warned: do not "DRY" these two functions together.

## Internal Module Visibility Policy

The files under `ast-edit/` are **package-internal modules** — they are implementation details of the `ast-edit` subsystem, not part of the public API surface. However, they are **intentionally importable** for testing and internal use within the `packages/core` package.

**Concrete rules:**

1. **External consumers** (anything outside `packages/core/src/tools/`) import only from `ast-edit.ts` (the thin shell). The re-export contract is: `ASTEditTool`, `ASTReadFileTool`, `EnhancedDeclaration`, `ASTEditToolParams`, `ASTReadFileToolParams`, `KEYWORDS`, `COMMENT_PREFIXES`, `REGEX`, `LANGUAGE_MAP`, `JAVASCRIPT_FAMILY_EXTENSIONS`.

2. **Test files** import directly from `ast-edit/` submodules. This replaces the current pattern of cast-based access to private internals (e.g., `(tool as unknown as { contextCollector: ... }).contextCollector.astExtractor`). Tests importing directly from submodules is cleaner than cast-based access through opaque type assertions and `any`.

3. **`createInvocation`** is `protected` on `ASTEditTool` (L1640) and `ASTReadFileTool` (L1766). This wiring is **not changed** — both tool classes continue to instantiate their respective invocation classes internally. Tests that currently cast through `createInvocation` (ast-edit.test.ts L57–75, ast-edit-lsp-integration.test.ts L132–134) will continue using the same cast pattern since `createInvocation` remains a protected method on the tool class, not on the extracted invocation module.

### Submodule Test Import Stability Warning

**Direct submodule test imports (e.g., `from '../ast-edit/context-collector.js'`) are package-internal convenience paths, not a stable API contract.** These import paths exist solely for testing and may change without deprecation in future refactoring. Only the `ast-edit.ts` thin shell re-exports constitute stable API. Tests that import from submodules accept the coupling cost of updating import paths if submodule boundaries shift. This is an explicit trade-off: cleaner test code now vs. potential import churn later.

## Dependency Direction Rules

**Mandatory rule: submodules never import from the parent.** All `ast-edit/` submodules MUST NOT import from `../ast-edit.js` (the thin shell). Only `ast-edit.ts` imports downward into the `ast-edit/` directory. This rule prevents circular dependencies.

**Allowed dependency directions:**
```
ast-edit.ts → ast-edit/*.ts           [OK] (parent imports submodules)
ast-edit/foo.ts → ast-edit/bar.ts     [OK] (sibling imports between submodules)
ast-edit/foo.ts → ../ast-edit.ts      [ERROR] FORBIDDEN (upward dependency)
ast-edit/foo.ts → ../tools.ts         [OK] (external dependency on peer modules)
ast-edit/foo.ts → ../../utils/*.ts    [OK] (external dependency on utils)
```

**Additional rule: no cycles among sibling submodules.** The import graph of all `ast-edit/*.ts` files must be a DAG (directed acyclic graph). Example of a forbidden cycle: `context-collector.ts → local-context-analyzer.ts → context-collector.ts`.

**Enforcement:** A dedicated test in the export-contract test file (see Phase 0) will verify both rules: (1) no upward imports to `../ast-edit.js`, and (2) no import cycles among sibling `ast-edit/*.ts` files. See Step 0.4 for the exact implementation.

**Known circular dependency risk:** `ASTEditToolInvocation.calculateEdit` (L2227) calls `ASTEditTool.applyReplacement`. After extraction, the invocation module cannot import from `ast-edit.ts`. Solution: extract `applyReplacement` to `edit-helpers.ts` first (Phase 5, Step 5.1). `ASTEditTool` retains `static applyReplacement = applyReplacement` (delegating to the extracted function) for backward compatibility. Additional potential cycles (e.g., if invocation modules needed tool-level config) are prevented by the blanket "no upward import" rule — any such need must be resolved by passing values as constructor/method parameters.

## Governance Exception: TDD Compliance for Structural Refactoring

> **WARNING: APPROVED GOVERNANCE EXCEPTION to `dev-docs/RULES.md`**
>
> `dev-docs/RULES.md` states: *"Every line of production code must be written in response to a failing test. No exceptions."* This plan deviates from that rule for structural code movement. RULES.md does not grant exceptions; therefore, **this deviation requires explicit user/team approval before implementation begins.**
>
> **What conforms to RULES.md:**
> - Phase 0 `ensure-dirs.test.ts` is genuine RED→GREEN TDD: the test is written first, fails (import error), then `ensure-dirs.ts` is created to make it pass.
> - Phase 0 export-contract and dependency-direction tests are written first, fail initially (no submodule dir exists), and pass only when extraction is complete.
> - Phase 0 schema stability tests are written first against the current monolith — they pass immediately as characterization tests and serve as regression guards.
> - Phase 0 `validateToolParamValues` behavior tests are written first against the current monolith.
>
> **What deviates from RULES.md:**
> - Tests for newly extracted modules (Phases 3–5) are written after extraction, not before. When we create `ast-config.test.ts`, `language-analysis.test.ts`, etc., the production code already exists (it was moved from the monolith). Writing a "RED" test for an import path that doesn't exist yet tests module resolution, not behavior.
> - Phase 0 characterization tests pass immediately — they document existing behavior as regression safety nets, not RED tests. They provide equivalent safety to TDD for behavior preservation during code movement.
>
> **Why this is justified:**
> - This is a pure structural refactoring: code is *moved*, not *written*. The moved code already works and is already covered by characterization tests written in Phase 0.
> - Forcing artificial RED→GREEN for code moves would require either (a) writing import-path tests that test Node.js module resolution rather than application behavior, or (b) temporarily deleting production code to make tests fail, then re-adding it — both are busywork that provides no safety benefit.
>
> **Approval status:** This plan must be reviewed and approved by the team before implementation. If this exception is not approved, the plan must be restructured so that all tests precede code moves (likely by moving all characterization tests to import from the *future* submodule paths in Phase 0, accepting that those tests will fail until extraction is complete, then extracting code to make them pass).

## Test Strategy

### Prioritization Testing: Deterministic Unit Test

**`prioritizeSymbolsFromDeclarations`** (L1222) is currently a private method on `ASTContextCollector`. The current plan's indirect testing approach (test via `collectEnhancedContext` + inspect `relatedSymbols` ordering) is **flawed** because results depend on external workspace state and cross-file search behavior.

**Revised approach:** Extract `prioritizeSymbolsFromDeclarations` as a **module-private exported-for-tests pure function** in `context-collector.ts`:

```typescript
// context-collector.ts

/** @internal Exported for testing only. Not part of public API. */
export function prioritizeSymbolsFromDeclarations(
  declarations: EnhancedDeclaration[],
): string[] {
  // ... exact same logic from L1222-1241
}
```

Add a **deterministic unit test** with controlled input data in `__tests__/context-collector.test.ts`:

```typescript
import { prioritizeSymbolsFromDeclarations } from '../ast-edit/context-collector.js';

describe('prioritizeSymbolsFromDeclarations', () => {
  it('should rank classes above functions above variables', () => {
    const decls: EnhancedDeclaration[] = [
      { name: 'myHelper', type: 'function', line: 11, column: 1,
        range: { start: { line: 11, column: 1 }, end: { line: 12, column: 1 } } },
      { name: 'MyClass', type: 'class', line: 1, column: 1,
        range: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } } },
      { name: 'someVar', type: 'variable', line: 13, column: 1,
        range: { start: { line: 13, column: 1 }, end: { line: 13, column: 10 } } },
    ];
    const result = prioritizeSymbolsFromDeclarations(decls);
    expect(result.indexOf('MyClass')).toBeLessThan(result.indexOf('myHelper'));
  });

  it('should exclude short symbol names (length < MIN_SYMBOL_LENGTH)', () => {
    const decls: EnhancedDeclaration[] = [
      { name: 'ab', type: 'class', line: 1, column: 1,
        range: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } } },
      { name: 'LongEnoughName', type: 'function', line: 11, column: 1,
        range: { start: { line: 11, column: 1 }, end: { line: 12, column: 1 } } },
    ];
    const result = prioritizeSymbolsFromDeclarations(decls);
    expect(result).not.toContain('ab');
    expect(result).toContain('LongEnoughName');
  });

  it('should boost public visibility declarations', () => {
    const decls: EnhancedDeclaration[] = [
      { name: 'privateFunc', type: 'function', line: 1, column: 1,
        range: { start: { line: 1, column: 1 }, end: { line: 5, column: 1 } } },
      { name: 'publicFunc', type: 'function', line: 6, column: 1, visibility: 'public',
        range: { start: { line: 6, column: 1 }, end: { line: 10, column: 1 } } },
    ];
    const result = prioritizeSymbolsFromDeclarations(decls);
    expect(result.indexOf('publicFunc')).toBeLessThan(result.indexOf('privateFunc'));
  });
});
```

This is a pure function with controlled input — no external dependencies, no workspace, no flakiness.

### Schema Stability Tests

**Tool schemas are public behavior** — they define the parameter contract that LLM clients depend on. Schema changes are breaking changes. These tests pin the exact schema shape for both tools.

Tests in `__tests__/ast-edit-characterization.test.ts`:

```typescript
describe('ASTEditTool schema stability', () => {
  it('should have exactly the expected required parameters', () => {
    const tool = new ASTEditTool(mockConfig);
    const schema = tool.schema;
    expect(schema.required).toEqual(['file_path', 'old_string', 'new_string']);
  });

  it('should have exactly the expected optional parameters', () => {
    const tool = new ASTEditTool(mockConfig);
    const schema = tool.schema;
    const allParams = Object.keys(schema.properties).sort();
    const requiredParams = [...schema.required].sort();
    const optionalParams = allParams.filter(p => !requiredParams.includes(p)).sort();
    expect(optionalParams).toEqual(['force', 'last_modified']);
  });

  it('should have correct property types and descriptions', () => {
    const tool = new ASTEditTool(mockConfig);
    const props = tool.schema.properties;
    // Required params
    expect(props.file_path.type).toBe('string');
    expect(props.file_path.description).toContain('absolute path');
    expect(props.old_string.type).toBe('string');
    expect(props.old_string.description).toContain('exact literal text');
    expect(props.new_string.type).toBe('string');
    // Optional params
    expect(props.force.type).toBe('boolean');
    expect(props.force.default).toBe(false);
    expect(props.last_modified.type).toBe('number');
    expect(props.last_modified.description).toContain('Timestamp');
  });
});

describe('ASTReadFileTool schema stability', () => {
  it('should have exactly the expected required parameters', () => {
    const tool = new ASTReadFileTool(mockConfig);
    const schema = tool.schema;
    expect(schema.required).toEqual(['file_path']);
  });

  it('should have exactly the expected optional parameters', () => {
    const tool = new ASTReadFileTool(mockConfig);
    const schema = tool.schema;
    const allParams = Object.keys(schema.properties).sort();
    const requiredParams = [...schema.required].sort();
    const optionalParams = allParams.filter(p => !requiredParams.includes(p)).sort();
    expect(optionalParams).toEqual(['limit', 'offset']);
  });

  it('should have correct property types and descriptions', () => {
    const tool = new ASTReadFileTool(mockConfig);
    const props = tool.schema.properties;
    expect(props.file_path.type).toBe('string');
    expect(props.file_path.description).toContain('absolute path');
    expect(props.offset.type).toBe('number');
    expect(props.offset.minimum).toBe(1);
    expect(props.limit.type).toBe('number');
    expect(props.limit.minimum).toBe(1);
  });
});
```

These tests verify exact schema parity: not just "these params exist" but "these are the ONLY params, with the correct types, defaults, and required status." Any param added, removed, or changed will fail these tests.

### `validateToolParamValues` Behavior Tests

Both `ASTEditTool` (L1620–1638) and `ASTReadFileTool` (L1746–1764) implement identical validation logic:
1. Reject empty `file_path`
2. Reject non-absolute `file_path`
3. Reject paths outside workspace directories

Since Phase 6 (shell slimming) is high-risk, these need explicit test coverage to catch regressions.

Tests in `__tests__/ast-edit-characterization.test.ts`:

```typescript
describe('validateToolParamValues behavior', () => {
  describe('ASTEditTool', () => {
    it('should reject empty file_path', () => {
      const tool = new ASTEditTool(mockConfig);
      // validateToolParamValues is protected — test via createInvocation + execute
      // which calls validateToolParamValues internally via BaseDeclarativeTool
      // The base class returns an error ToolResult when validation fails
    });

    it('should reject relative file_path', () => {
      // params.file_path = 'relative/path.ts' → error containing 'must be absolute'
    });

    it('should reject file_path outside workspace', () => {
      // params.file_path = '/outside/workspace/file.ts' → error containing 'workspace directories'
    });

    it('should accept valid absolute file_path within workspace', () => {
      // params.file_path = '/test/valid.ts' → no validation error
    });
  });

  describe('ASTReadFileTool', () => {
    it('should reject empty file_path', () => {
      // Same pattern as ASTEditTool tests above
    });

    it('should reject relative file_path', () => {
      // Same pattern
    });

    it('should reject file_path outside workspace', () => {
      // Same pattern
    });

    it('should accept valid absolute file_path within workspace', () => {
      // Same pattern
    });
  });
});
```

These tests verify the validation boundary that protects against arbitrary filesystem access. Because `validateToolParamValues` is a `protected override`, tests exercise it through the public tool API (construct tool → create invocation → execute with invalid params → verify error).

### `getModifyContext()` Behavior Test

`ASTEditTool.getModifyContext` (L1650–1691) is specifically preserved because it provides the `ModifyContext<ASTEditToolParams>` interface used by the modifiable-tool system. It delegates to `ASTEditTool.applyReplacement` (L1670–1675) for proposed content computation. This behavior must be pinned.

Test in `__tests__/ast-edit-characterization.test.ts`:

```typescript
describe('getModifyContext behavior', () => {
  it('should return ModifyContext with getFilePath, getCurrentContent, getProposedContent, createUpdatedParams', () => {
    const tool = new ASTEditTool(mockConfig);
    const ctx = tool.getModifyContext(new AbortController().signal);
    expect(typeof ctx.getFilePath).toBe('function');
    expect(typeof ctx.getCurrentContent).toBe('function');
    expect(typeof ctx.getProposedContent).toBe('function');
    expect(typeof ctx.createUpdatedParams).toBe('function');
  });

  it('getFilePath should return params.file_path', () => {
    const tool = new ASTEditTool(mockConfig);
    const ctx = tool.getModifyContext(new AbortController().signal);
    const params: ASTEditToolParams = {
      file_path: '/test/foo.ts',
      old_string: 'a',
      new_string: 'b',
    };
    expect(ctx.getFilePath(params)).toBe('/test/foo.ts');
  });

  it('getProposedContent should apply replacement using ASTEditTool.applyReplacement', async () => {
    const tool = new ASTEditTool(mockConfig);
    const ctx = tool.getModifyContext(new AbortController().signal);
    const params: ASTEditToolParams = {
      file_path: '/test/sample.ts',
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    };
    // mockConfig.getFileSystemService().readTextFile returns 'const x = 1;'
    const proposed = await ctx.getProposedContent(params);
    expect(proposed).toBe('const x = 2;');
  });

  it('getProposedContent should return new_string when file does not exist', async () => {
    const enoentConfig = {
      ...mockConfig,
      getFileSystemService: () => ({
        readTextFile: async () => { const err = new Error('ENOENT'); (err as any).code = 'ENOENT'; throw err; },
        writeTextFile: async () => {},
      }),
    } as unknown as Config;
    const tool = new ASTEditTool(enoentConfig);
    const ctx = tool.getModifyContext(new AbortController().signal);
    const params: ASTEditToolParams = {
      file_path: '/test/nonexistent.ts',
      old_string: '',
      new_string: 'new file content',
    };
    const proposed = await ctx.getProposedContent(params);
    expect(proposed).toBe('new file content');
  });

  it('createUpdatedParams should merge old/new content into params', () => {
    const tool = new ASTEditTool(mockConfig);
    const ctx = tool.getModifyContext(new AbortController().signal);
    const original: ASTEditToolParams = {
      file_path: '/test/foo.ts',
      old_string: 'a',
      new_string: 'b',
      force: true,
    };
    const updated = ctx.createUpdatedParams('old-content', 'new-content', original);
    expect(updated.old_string).toBe('old-content');
    expect(updated.new_string).toBe('new-content');
    expect(updated.file_path).toBe('/test/foo.ts');
    expect(updated.force).toBe(true);
  });
});
```

This pins the `getModifyContext` contract so that when `ASTEditTool.applyReplacement` is extracted to `edit-helpers.ts` (Phase 5, Step 5.1), the delegation still works correctly.

### Preview/Apply Consistency Characterization Test

**Risk:** Preview computes `newContent` directly via `ASTEditTool.applyReplacement()` in `executePreview` (L1932–1942), while apply goes through `calculateEdit` (L2046–2050) which contains its own `applyReplacement` call (L2226–2232). This duplication means preview and apply could compute different results for the same input.

**Characterization test** in `__tests__/ast-edit-characterization.test.ts`:

```typescript
it('should produce identical newContent between preview and apply for same input', async () => {
  // 1. Call with force:false (preview) — capture returnDisplay.newContent
  // 2. Call with force:true (apply) — capture returnDisplay.newContent
  // 3. Assert they are identical
  // 4. Also verify astValidation shape matches between both
});
```

This pins the current behavior so any future divergence is caught.

### Empty-Existing-File vs Nonexistent-File Characterization Tests

**Risk:** The preview and apply paths determine `isNewFile` differently:
- **Preview (L1897–1900):** `isNewFile = old_string === '' && rawCurrentContent === ''`
  - `readFileContent()` (L2271–2281) returns `''` on ENOENT *and* for actual empty existing files
  - So preview treats both empty-existing and nonexistent identically: `isNewFile = true`
- **Apply (L2197–2199):** `isNewFile = old_string === '' && !fileExists`
  - Uses actual filesystem `fileExists` check (L2161)
  - So apply distinguishes: nonexistent → `isNewFile = true`, empty-existing → `isNewFile = false`

This is a **real behavioral divergence** that must be characterized with explicit tests:

```typescript
describe('empty-existing-file vs nonexistent-file behavior', () => {
  it('preview: empty old_string + nonexistent file → isNewFile behavior', async () => {
    // old_string='', file doesn't exist
    // Preview: readFileContent returns '' → isNewFile = ('' === '' && '' === '') = true
    // Verify: newContent === new_string
  });

  it('preview: empty old_string + empty existing file → isNewFile behavior', async () => {
    // old_string='', file exists but is empty
    // Preview: readFileContent returns '' → isNewFile = ('' === '' && '' === '') = true
    // Verify: newContent === new_string (same as nonexistent!)
  });

  it('apply: empty old_string + nonexistent file → creates file', async () => {
    // old_string='', file doesn't exist
    // Apply: fileExists=false → isNewFile = true → writes new_string
  });

  it('apply: empty old_string + empty existing file → no-op', async () => {
    // old_string='', file exists but is empty
    // Apply: fileExists=true → isNewFile = false
    // applyReplacement('', '', new_string, false) → returns '' (old_string==='' && !isNewFile → currentContent)
    // This means the existing empty file is NOT overwritten
  });
});
```

### What we do NOT preserve as compatibility targets

**Private property names** (`astExtractor`, `relationshipAnalyzer`) on `ASTContextCollector` are NOT compatibility targets. These names are only used by tests via bad casts — that's accidental internal structure, not API stability. The compatibility targets are:
- Public tool exports from `ast-edit.ts` (classes, types, constants)
- Public tool behavior (return shapes, error types, schemas)
- Externally consumed schema/return shapes (FileDiff metadata, ToolResult shapes)

After extraction, the existing cast-based tests that access these private properties will be rewritten as proper behavioral tests on the extracted submodules' public APIs.

### Snapshot file migration

The snapshot file `__snapshots__/ast-edit.test.ts.snap` contains snapshots keyed by test name:
- `AST Tools > AST extraction logic > should extract TypeScript declarations correctly 1`
- `AST Tools > AST extraction logic > should extract Python declarations correctly 1`

When these tests move to `__tests__/ast-query-extractor.test.ts`, the snapshot file path changes. The new test file must use the same `describe`/`it` names so that `--update` regenerates identical snapshots. New snapshot file: `__tests__/__snapshots__/ast-query-extractor.test.ts.snap`. The old snapshot file entries will be orphaned and should be deleted.

**IMPORTANT: Manual semantic review of regenerated snapshots is required.** After running `--update`, the regenerated snapshots must be manually compared against the original snapshots to verify they are semantically identical (same declarations, same ordering, same types). Simply running `--update` and trusting the output is insufficient — a subtle behavioral change during extraction could silently produce a new "passing" snapshot that differs from the original. The reviewer must diff old vs new snapshot files line-by-line.

## Current State Analysis

### File Structure (before)

```
packages/core/src/tools/
├── ast-edit.ts              (2,491 lines — the monolith)
├── ast-edit.test.ts         (246 lines)
├── __tests__/
│   └── ast-edit-lsp-integration.test.ts  (271 lines)
├── __snapshots__/
│   └── ast-edit.test.ts.snap             (snapshot for extraction tests)
├── edit.ts                  (1,017 lines — has duplicate utilities)
├── diffOptions.ts           (76 lines — already extracted)
├── lsp-diagnostics-helper.ts (93 lines — already extracted)
├── modifiable-tool.ts       (224 lines — already extracted)
└── tools.ts                 (924 lines — base types)
```

### Import Consumers (COMPLETE — verified via grep)

All files in the repository that import from `ast-edit`:

```typescript
// packages/core/src/config/config.ts (L27-28)
import { ASTEditTool } from '../tools/ast-edit.js';
import { ASTReadFileTool } from '../tools/ast-edit.js';

// packages/core/src/tools/ast-edit.test.ts (L9-13)
import { ASTEditTool, ASTReadFileTool, EnhancedDeclaration } from './ast-edit.js';

// packages/core/src/tools/__tests__/ast-edit-lsp-integration.test.ts (L11)
import { ASTEditTool } from '../ast-edit.js';
```

**Verification command used:** `grep -r "from.*ast-edit" --include="*.ts" --include="*.tsx"` (excluding `PLAN.md` and `node_modules`). These are the **only three** consumer files. No other files in the codebase import from `ast-edit`. All three must continue to work unchanged after extraction.

## Target Architecture

### File Structure (after)

```
packages/core/src/tools/
├── ast-edit.ts                            (~200 lines — thin shell with re-exports)
├── ast-edit.test.ts                       (~80 lines — export-contract + exhaustive export-surface + dependency-direction + instantiation + schema stability)
├── ast-edit/
│   ├── types.ts                           (~150 lines — interfaces EXCEPT CalculatedEdit)
│   ├── constants.ts                       (~30 lines — KEYWORDS, COMMENT_PREFIXES, REGEX)
│   ├── ast-config.ts                      (~70 lines — ASTConfig class)
│   ├── ast-query-extractor.ts             (~220 lines — ASTQueryExtractor)
│   ├── repository-context-provider.ts     (~120 lines — RepositoryContextProvider)
│   ├── cross-file-analyzer.ts             (~350 lines — CrossFileRelationshipAnalyzer + getWorkspaceFiles)
│   ├── context-optimizer.ts               (~90 lines — ContextOptimizer)
│   ├── language-analysis.ts               (~30 lines — shared detectLanguage + extractImports)
│   ├── local-context-analyzer.ts          (~250 lines — parseAST, extractImports, collectSnippets, buildLanguageContext, helpers)
│   ├── workspace-context-provider.ts      (~80 lines — enrichWithWorkingSetContext only)
│   ├── context-collector.ts               (~150 lines — orchestration-only ASTContextCollector + prioritizeSymbolsFromDeclarations)
│   ├── edit-helpers.ts                    (~20 lines — applyReplacement standalone function)
│   ├── edit-calculator.ts                 (~200 lines — calculateEdit, countOccurrences, validateASTSyntax, getFileLastModified, CalculatedEdit interface)
│   ├── ast-edit-invocation.ts             (~350 lines — ASTEditToolInvocation: preview, apply, confirm, description)
│   └── ast-read-file-invocation.ts        (~160 lines — ASTReadFileToolInvocation)
├── ensure-dirs.ts                         (~15 lines — shared ensureParentDirectoriesExist)
├── __tests__/
│   ├── ast-edit-lsp-integration.test.ts   (UNCHANGED — imports from '../ast-edit.js')
│   ├── ast-edit-characterization.test.ts  (NEW — characterization tests for current public behavior + schema stability + validateToolParamValues + getModifyContext)
│   ├── calculate-edit-characterization.test.ts (NEW — characterization tests for calculateEdit edge cases)
│   ├── ast-query-extractor.test.ts        (relocated extraction tests + snapshot migration)
│   ├── context-collector.test.ts          (relocated perf tests + prioritizeSymbolsFromDeclarations deterministic tests)
│   ├── ast-edit-invocation.test.ts        (relocated freshness/preview tests)
│   ├── ast-read-file-invocation.test.ts   (NEW — offset/limit, error mapping, EMFILE/ENFILE, metadata shape)
│   ├── repository-context-provider.test.ts (NEW — null on git failures, working set paths)
│   ├── cross-file-analyzer.test.ts        (NEW — import extraction, workspace guard)
│   ├── ast-config.test.ts                 (NEW — ENABLE_SYMBOL_INDEXING env var)
│   ├── language-analysis.test.ts          (NEW — shared detectLanguage + extractImports)
│   └── ensure-dirs.test.ts               (NEW — standalone ensureParentDirectoriesExist)
├── __snapshots__/
│   └── ast-edit.test.ts.snap              (orphaned entries cleaned up)
└── edit.ts                                (1 import changed — uses ensure-dirs.ts)
```

### Key design decisions on types

**`CalculatedEdit` stays near edit computation, NOT in `types.ts`.** The `CalculatedEdit` interface (L2482–2491) is tightly coupled to `calculateEdit` and `ASTEditToolInvocation`. It contains `ToolErrorType` references and `astValidation` shapes that are edit-specific. It belongs in `edit-calculator.ts`, not in the shared `types.ts` file. This keeps `types.ts` focused on the context/analysis domain.

**`types.ts` contains:** `ASTContext`, `ASTNode`, `Declaration`, `CodeSnippet`, `Import`, `FunctionInfo`, `ClassInfo`, `VariableInfo`, `Position`, `SgNode`, `RepositoryContext`, `SymbolReference`, `FileContext`, `CrossFileContext`, `ConnectedFile`, `EnhancedDeclaration`, `EnhancedASTContext`, `ASTEditToolParams`, `ASTReadFileToolParams`.

### `workspace-context-provider.ts` and `cross-file-analyzer.ts` boundary clarification

**`getWorkspaceFiles` moves to `cross-file-analyzer.ts`, NOT `workspace-context-provider.ts`.** `getWorkspaceFiles` (L1521–1536) performs file discovery via `fast-glob` for the symbol indexing codepath (`ENABLE_SYMBOL_INDEXING`, L1179). Its sole consumer is `collectEnhancedContext`, which passes the result to `CrossFileRelationshipAnalyzer.buildSymbolIndex`. This is file discovery *for indexing* — it belongs with `CrossFileRelationshipAnalyzer`, not as a general workspace utility.

**`workspace-context-provider.ts` has a single responsibility: working-set enrichment.** It exports only `enrichWithWorkingSetContext(targetFilePath, workspaceRoot, repoProvider, astExtractor): Promise<ConnectedFile[]>`, which takes working-set files from `RepositoryContextProvider.getWorkingSetFiles()`, reads them, extracts declarations, and returns `ConnectedFile[]`. This is the working-set enrichment loop from `collectEnhancedContext` (L1146–1168).

This clean split avoids the original design where `workspace-context-provider.ts` mixed two different responsibilities (file discovery for indexing vs. working-set enrichment).

### `local-context-analyzer.ts` — intermediate boundary acknowledgment

**`local-context-analyzer.ts` is an intermediate extraction boundary, not a final ideal SoC state.** It aggregates several concerns that are currently tightly interleaved in `ASTContextCollector`:

- AST node parsing/extraction (`parseAST`, `extractASTNodes`)
- Language-specific context building (`buildLanguageContext`, `extractFunctions`, `extractClasses`, `extractVariables`)
- Code snippet collection (`collectSnippets`, `calculateRelevance`, `isSignificantLine`, `inferNodeType`)
- Context optimization (`optimizeContextCollection`)

These could be further split in a future PR into:
- `local-ast-analysis.ts` — AST node parsing, `parseAST`, `extractASTNodes`
- `language-context-builder.ts` — `buildLanguageContext`, `extractFunctions`, `extractClasses`, `extractVariables`
- `snippet-collector.ts` — `collectSnippets`, `calculateRelevance`, `isSignificantLine`, `inferNodeType`

For this PR, extracting them as one unit is pragmatic: they share internal data structures and calling patterns that would require additional interface design to separate cleanly. Acknowledging this boundary as non-final avoids presenting it as ideal SoC.

### `EnhancedDeclaration` export contract note

`EnhancedDeclaration` is a TypeScript `interface` (L197–205). At runtime, TypeScript types are **erased** — there is no runtime representation of `EnhancedDeclaration`. The export contract test for `EnhancedDeclaration` can only verify compile-time correctness by constructing a conforming object literal. It cannot verify a runtime export like `typeof EnhancedDeclaration !== 'undefined'` because no such runtime value exists. The test must create an object satisfying the interface shape and verify it compiles.

## Primary DRY Analysis

**Note: This analysis covers the primary DRY violations identified. It is not exhaustive — additional duplication patterns exist but are deferred.**

| Duplicate | Location 1 | Location 2 | Resolution |
|---|---|---|---|
| `ensureParentDirectoriesExist` | ast-edit.ts L2317 | edit.ts L822 | Extract to `ensure-dirs.ts`, both import |
| `extractImports` | `CrossFileRelationshipAnalyzer` L899 | `ASTContextCollector` L1285 | Extract to `language-analysis.ts` |
| `detectLanguage` | `CrossFileRelationshipAnalyzer` L981 | `ASTContextCollector` L1244 | Extract to `language-analysis.ts` |
| `extractImportModule` | `CrossFileRelationshipAnalyzer` L930 | `ASTContextCollector` L1380 | Inline into shared `extractImports` |
| `extractImportItems` | `CrossFileRelationshipAnalyzer` L935 | `ASTContextCollector` L1385 | Inline into shared `extractImports` |
| `Diff.createPatch` pattern | ast-edit.ts L1815, L1946, L2082 | edit.ts L596, L741 | Document as candidate for future `createFileDiff` helper; **out of scope** for this PR since it requires touching the `Diff.createPatch` call sites with different parameters across edit.ts and ast-edit.ts. The pattern is a one-liner call, not a substantial DRY violation. |

### Known additional DRY issues (NOT addressed in this PR)

These are deferred to future work to keep the PR focused on structural decomposition:

| Duplicate | Location 1 | Location 2 | Notes |
|---|---|---|---|
| `validateToolParamValues` | `ASTEditTool` L1620–1638 | `ASTReadFileTool` L1746–1764 | Identical logic: check non-empty, check absolute, check workspace. Could be extracted to a shared validator. |
| `contextCollector` construction | `ASTEditTool` constructor L1617 | `ASTReadFileTool` constructor L1743 | Both `new ASTContextCollector()` — could share via factory or base class. |
| Path-shortening description patterns | `ASTEditToolInvocation.getDescription()` L1846–1867 | `ASTReadFileToolInvocation.getDescription()` L2341–2347 | Similar `makeRelative` + `shortenPath` patterns. |
| `Diff.createPatch` repetition | L1815, L1946, L2082 within ast-edit.ts | — | Three call sites with slightly different params (`'Proposed'` vs `'Applied'`). |

## Implementation Plan — Phased Extraction

### Phase 0: Characterization Tests, Schema Stability, and Export Contract (BEFORE any extraction)

**Goal:** Lock down current public behavior of `ast-edit.ts` so that any behavioral regression during extraction is immediately caught. Also write genuine RED tests for `ensure-dirs.ts`. Also create the export-contract and dependency-direction tests that will pass only when extraction is complete.

**This phase creates the safety net. No production code changes.**

#### Step 0.1: Create `packages/core/src/tools/__tests__/ast-edit-characterization.test.ts`

These tests import from `'../ast-edit.js'` (the current monolith) and pass immediately. They document exact behavior:

```typescript
import { ASTEditTool, ASTReadFileTool, EnhancedDeclaration, KEYWORDS, COMMENT_PREFIXES, REGEX } from '../ast-edit.js';
import { LANGUAGE_MAP, JAVASCRIPT_FAMILY_EXTENSIONS } from '../ast-edit.js';
```

**Tests (all must pass against the current monolith):**

1. **Preview llmContent structure:** Call `createInvocation` with `force: false` on an existing file. Verify `llmContent` starts with `'LLXPRT EDIT PREVIEW:'`, contains `'AST validation:'`, contains `'NEXT STEP: Call again with force: true'`.
2. **Preview returnDisplay metadata shape:** Verify `returnDisplay` is a `FileDiff` object with properties `fileDiff` (string), `fileName` (string), `originalContent` (string), `newContent` (string), `metadata.astValidation` (object with `valid` boolean), `metadata.currentMtime` (number or undefined).
3. **Apply result metadata shape:** Call with `force: true`. Verify `returnDisplay` has `applied: true`, `metadata.astValidation` (object).
4. **AST validation success propagation:** Edit a `.ts` file with valid syntax → `astValidation.valid === true`.
5. **AST validation failure propagation:** Edit a `.ts` file producing invalid syntax → `astValidation.valid === false`, `astValidation.errors` is non-empty array.
6. **CRLF normalization:** Provide `old_string` with `\r\n` line endings. Verify the match still succeeds (L2146–2147 normalize to `\n`).
7. **New-file creation:** `old_string === ''` + file doesn't exist → creates file with `new_string` content. Verify `isNewFile` behavior via successful apply.
8. **No-change behavior:** `old_string === new_string` → error with type `ToolErrorType.EDIT_NO_CHANGE`.
9. **`toolLocations()` for ASTEditTool:** Verify returns `[{ path: params.file_path }]`.
10. **`toolLocations()` for ASTReadFileTool:** Verify returns `[{ path: params.file_path, line: params.offset }]`.
11. **`getDescription()` for ASTEditTool preview:** Verify contains `[PREVIEW]` (L1866).
12. **`getDescription()` for ASTEditTool execute:** Verify contains `[EXECUTE]` when `force: true` (L1866).
13. **`getDescription()` for ASTEditTool create:** `old_string === ''` → starts with `'Create '` (L1851–1852).
14. **`getDescription()` for ASTReadFileTool:** Returns shortened relative path (L2341–2347).
15. **Unknown error mapping in ASTReadFileToolInvocation:** Pass a non-NodeError to execute → error type is `ToolErrorType.UNKNOWN` (L2467–2468).
16. **Export-contract verification:** Verify that `ASTEditTool`, `ASTReadFileTool`, `EnhancedDeclaration` (as conforming object), `KEYWORDS`, `COMMENT_PREFIXES`, `REGEX`, `LANGUAGE_MAP`, `JAVASCRIPT_FAMILY_EXTENSIONS` are all importable from `'../ast-edit.js'` and are defined (not undefined). `EnhancedDeclaration` is compile-time only (types erased at runtime) — verify by constructing a conforming object literal, not by checking runtime existence.
17. **Preview/apply consistency:** Same `file_path`, `old_string`, `new_string` should produce identical `newContent` and `astValidation` shapes between preview (`force: false`) and apply (`force: true`) paths. See "Preview/Apply Consistency Characterization Test" above for detail.
18. **EMFILE/ENFILE mapping in ASTReadFileToolInvocation:** Simulate EMFILE or ENFILE error code → error type is `ToolErrorType.READ_CONTENT_FAILURE` (L2457–2461).
19. **Successful ASTReadFileTool metadata shape:** Call execute on a valid file → verify `returnDisplay` has `content` (string), `fileName` (string), `filePath` (string), `metadata.language` (string), `metadata.declarationsCount` (number) (L2432–2439).
20. **ASTEditTool.applyReplacement static method availability:** Verify `ASTEditTool.applyReplacement` is callable as a static method and returns correct result for known inputs.
21. **ASTEditTool schema stability** — exact required params, exact optional params, property types and descriptions (see "Schema Stability Tests" above).
22. **ASTReadFileTool schema stability** — exact required params, exact optional params, property types and descriptions (see "Schema Stability Tests" above).
23. **ASTEditTool validateToolParamValues** — reject empty, reject relative, reject outside workspace, accept valid (see "validateToolParamValues Behavior Tests" above).
24. **ASTReadFileTool validateToolParamValues** — reject empty, reject relative, reject outside workspace, accept valid (see "validateToolParamValues Behavior Tests" above).
25. **getModifyContext behavior** — getFilePath, getCurrentContent, getProposedContent, createUpdatedParams all behave correctly (see "getModifyContext Behavior Test" above).
26. **shouldConfirmExecute — preview bypass:** Call with `force: false` → `shouldConfirmExecute` returns `undefined` (no confirmation needed, L1794–1797).
27. **shouldConfirmExecute — AUTO_EDIT bypass:** Call with `force: true` + `ApprovalMode.AUTO_EDIT` → returns `undefined` (L1800–1806).
28. **shouldConfirmExecute — manual confirmation payload shape:** Call with `force: true` + manual mode → returns `ToolEditConfirmationDetails` with `diff` (string), `fileDiff` (FileDiff), `metadata.astValidation`, `metadata.fileFreshness` (L1814–1841).
29. **shouldConfirmExecute — ProceedAlways side effect:** When user confirms with `ProceedAlways`, verify `setApprovalMode(ApprovalMode.AUTO_EDIT)` is called (L1805).
30. **`$` replacement semantics in applyReplacement:** `ASTEditTool.applyReplacement` uses `String.replace()` (L1564) which treats `$&`, `$'`, `` $` `` as special replacement patterns. Characterize: `applyReplacement('hello', 'hello', '$&world', false)` → returns `'helloworld'` (not `'$&world'`). This is existing behavior that must be preserved, not "fixed."
31. **countOccurrences returns 0/1, not true count:** `countOccurrences` (L2263–2269) returns `content.includes(searchString) ? 1 : 0`, NOT the actual number of occurrences. Characterize: content with 3 occurrences → `countOccurrences` effectively returns 1. This is intentional (aligned with single-replace semantics) and must be preserved.
32. **Diff labels differ between preview and apply:** Preview uses `'Proposed'` (L1949–1951), apply uses `'Applied'` (L2085–2087), confirmation uses `'Proposed'` (L1818–1820). Characterize all three label values to prevent accidental normalization during extraction.


#### Step 0.1.1: Add empty-existing-file vs nonexistent-file characterization tests

These tests **must** be in the characterization test file to pin the behavioral divergence between preview and apply. See "Empty-Existing-File vs Nonexistent-File Characterization Tests" section above for the four specific tests.

#### Step 0.2: Create `packages/core/src/tools/__tests__/calculate-edit-characterization.test.ts`

These tests exercise `calculateEdit` edge cases through the public tool API (via `createInvocation` + `execute`). All pass immediately against the current monolith:

```typescript
import { ASTEditTool } from '../ast-edit.js';
```

**Tests:**

1. **Nonexistent file + empty old_string → create:** `old_string: ''`, `new_string: 'content'`, file doesn't exist → successful apply creates file.
2. **Nonexistent file + non-empty old_string → FILE_NOT_FOUND:** `old_string: 'something'`, file doesn't exist → error type `ToolErrorType.FILE_NOT_FOUND`.
3. **Freshness conflict precedence:** Provide `last_modified` older than file mtime → error type `ToolErrorType.FILE_MODIFIED_CONFLICT`, even if `old_string` is also invalid.
4. **No occurrence:** `old_string` not found in file → error type `ToolErrorType.EDIT_NO_OCCURRENCE_FOUND`.
5. **No change (old equals new):** → error type `ToolErrorType.EDIT_NO_CHANGE`.
6. **CRLF normalization in calculateEdit:** File content has `\r\n`, `old_string` has `\r\n` → match succeeds.
7. **AST validation generated on success:** Successful edit on `.ts` file → `astValidation` is defined.
8. **AST validation skipped for unknown language:** Successful edit on `.xyz` file → `astValidation.valid === true`, `errors: []` (L2290–2291).

#### Step 0.3: Create `packages/core/src/tools/__tests__/ensure-dirs.test.ts` (TRUE RED-GREEN TDD)

```typescript
import { ensureParentDirectoriesExist } from '../ensure-dirs.js';
```

Tests:
- `should create parent directories when they don't exist`
- `should not throw when parent directories already exist`
- `should handle nested directory creation`

These fail because `ensure-dirs.ts` does not exist yet. This is **genuine RED** per RULES.md.

#### Step 0.4: Add exhaustive export-surface, dependency-direction, and schema tests to `ast-edit.test.ts`

Add to the existing `ast-edit.test.ts`:

```typescript
import * as AstEditModule from './ast-edit.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

describe('export contract', () => {
  it('should export all public symbols', () => {
    // Verify each export is defined and has expected type
    expect(ASTEditTool).toBeDefined();
    expect(ASTReadFileTool).toBeDefined();
    // EnhancedDeclaration is a TypeScript interface — types are erased at runtime.
    // Verify compile-time correctness by constructing a conforming object:
    const decl: EnhancedDeclaration = {
      name: 'x', type: 'function', line: 1, column: 0,
      range: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } }
    };
    expect(decl.name).toBe('x');
    expect(KEYWORDS).toBeDefined();
    expect(KEYWORDS.FUNCTION).toBe('function');
    expect(COMMENT_PREFIXES).toContain('//');
    expect(REGEX.IMPORT_MODULE).toBeInstanceOf(RegExp);
    expect(LANGUAGE_MAP).toBeDefined();
    expect(JAVASCRIPT_FAMILY_EXTENSIONS).toBeDefined();
  });

  it('should export EXACTLY the expected runtime symbols and no others', () => {
    // Exhaustive export-surface test: verify EXACT parity, not just "these exist"
    const actualExports = Object.keys(AstEditModule).sort();
    const expectedExports = [
      'ASTEditTool',
      'ASTReadFileTool',
      'COMMENT_PREFIXES',
      'JAVASCRIPT_FAMILY_EXTENSIONS',
      'KEYWORDS',
      'LANGUAGE_MAP',
      'REGEX',
    ].sort();
    expect(actualExports).toEqual(expectedExports);
    // NOTE: EnhancedDeclaration, ASTEditToolParams, ASTReadFileToolParams are
    // TypeScript types — erased at runtime, not visible in Object.keys().
    // Their compile-time correctness is verified by the conforming object test above
    // and by TypeScript's own type checker during `npm run typecheck`.
  });

  it('should export ASTEditTool.applyReplacement as a static method', () => {
    expect(typeof ASTEditTool.applyReplacement).toBe('function');
    const result = ASTEditTool.applyReplacement('hello world', 'hello', 'goodbye', false);
    expect(result).toBe('goodbye world');
  });
});

describe('dependency direction', () => {
  it('should not have submodules importing from parent ast-edit.ts', async () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    // Navigate from __tests__ or tools dir to find the ast-edit submodule dir
    const toolsDir = currentDir.includes('__tests__')
      ? path.resolve(currentDir, '..')
      : currentDir;
    const submoduleDir = path.join(toolsDir, 'ast-edit');

    let submoduleFiles: string[] = [];
    try {
      const entries = await fs.readdir(submoduleDir);
      submoduleFiles = entries
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'))
        .map(f => path.join(submoduleDir, f));
    } catch {
      // No submodule dir yet — structural guard test, passes vacuously in Phase 0.
      // This test becomes meaningful only after Phase 2+ creates the ast-edit/ directory.
      // It is NOT a RED test — see "Governance Exception" section.
      return;
    }

    for (const file of submoduleFiles) {
      const content = await fs.readFile(file, 'utf-8');
      // Rule 1: No upward imports to parent ast-edit.ts
      expect(content).not.toMatch(/from\s+['"]\.\.\/ast-edit\.js['"]/);
      expect(content).not.toMatch(/from\s+['"]\.\.\/ast-edit['"]/);
    }
  });

  it('should have no import cycles among ast-edit/* sibling modules', async () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const toolsDir = currentDir.includes('__tests__')
      ? path.resolve(currentDir, '..')
      : currentDir;
    const submoduleDir = path.join(toolsDir, 'ast-edit');

    let submoduleFiles: string[] = [];
    try {
      const entries = await fs.readdir(submoduleDir);
      submoduleFiles = entries
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'));
    } catch {
      // No submodule dir yet — structural guard test, passes vacuously in Phase 0.
      // See note in upward-import test above.
      return;
    }

    // Build import graph: module name → set of imported sibling module names
    // LIMITATION: This uses regex-based import detection. It will catch static
    // `import ... from './foo.js'` statements but will NOT catch:
    // - Dynamic imports: `await import('./foo.js')`
    // - Multiline import statements (regex matches single-line only)
    // - Re-exports via `export ... from './foo.js'`
    // These limitations are acceptable because the codebase uses only static
    // single-line imports in the ast-edit/ submodules.
    const importGraph = new Map<string, Set<string>>();
    const moduleNames = new Set(submoduleFiles.map(f => f.replace(/\.ts$/, '')));

    for (const file of submoduleFiles) {
      const moduleName = file.replace(/\.ts$/, '');
      const content = await fs.readFile(path.join(submoduleDir, file), 'utf-8');
      const imports = new Set<string>();

      // Match: from './foo.js' or from './foo'
      const importRegex = /from\s+['"]\.\/([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const importedName = match[1].replace(/\.js$/, '');
        if (moduleNames.has(importedName)) {
          imports.add(importedName);
        }
      }
      importGraph.set(moduleName, imports);
    }

    // Detect cycles using standard DFS with three-color marking:
    // WHITE (unvisited) → GRAY (in current path) → BLACK (fully explored)
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const name of moduleNames) {
      color.set(name, WHITE);
    }

    function dfs(node: string, path: string[]): string[] | null {
      color.set(node, GRAY);
      path.push(node);

      for (const dep of importGraph.get(node) || []) {
        if (color.get(dep) === GRAY) {
          // Found cycle — return the cycle path
          const cycleStart = path.indexOf(dep);
          return [...path.slice(cycleStart), dep];
        }
        if (color.get(dep) === WHITE) {
          const cycle = dfs(dep, path);
          if (cycle) return cycle;
        }
        // BLACK nodes are fully explored, skip
      }

      path.pop();
      color.set(node, BLACK);
      return null;
    }

    for (const moduleName of moduleNames) {
      if (color.get(moduleName) === WHITE) {
        const cycle = dfs(moduleName, []);
        if (cycle) {
          throw new Error(
            `Import cycle detected among ast-edit/* modules: ${cycle.join(' → ')}`
          );
        }
      }
    }
  });
});
```

**Key differences from previous version:**
1. **Exhaustive export-surface test** uses `Object.keys(AstEditModule).sort()` compared to an expected list — verifies no exports were lost AND no unexpected exports were added.
2. **Dependency-direction tests are labeled as "structural guard tests"** with explicit comments noting they pass vacuously when no submodule dir exists. They are NOT labeled as RED tests.
3. **Cycle detection uses standard three-color DFS** (WHITE/GRAY/BLACK) — the standard textbook algorithm. No per-root `visited.clear()` bug. A single traversal correctly detects cycles across all connected components.
4. **Regex limitations are explicitly documented** — won't catch dynamic imports, multiline imports, or re-exports. Acceptable for this codebase's import style.

#### Step 0.5: Verify characterization tests pass, ensure-dirs test fails

Run: `npm run test -- --run packages/core/src/tools/__tests__/ast-edit-characterization.test.ts packages/core/src/tools/__tests__/calculate-edit-characterization.test.ts packages/core/src/tools/__tests__/ensure-dirs.test.ts packages/core/src/tools/ast-edit.test.ts`

Expected:
- `ast-edit-characterization.test.ts` — **passes** (characterization of existing behavior)
- `calculate-edit-characterization.test.ts` — **passes** (characterization of existing behavior)
- `ensure-dirs.test.ts` — **fails** (import error — TRUE RED)
- `ast-edit.test.ts` — **passes** (including new export-surface, dependency-direction, and schema tests)
- `ast-edit-lsp-integration.test.ts` — **passes** (unchanged)

**[GATE 1 REVIEW] Phase 0 Review**
Submit to `deepthinker` for review: all new test files, the characterization test coverage map, and verification that no production code was changed. Reviewer checks:
- Are all critical behavioral paths characterized?
- Are the empty-existing vs nonexistent tests present and correct?
- Is the preview/apply consistency test present?
- Does the cycle detection logic (three-color DFS) look correct?
- Are schema stability tests present for both tools?
- Are `validateToolParamValues` tests present for both tools?
- Is the `getModifyContext` behavior test present?
- Does the exhaustive export-surface test verify exact parity (not just "exists")?
- Are shouldConfirmExecute behavior tests present (preview bypass, AUTO_EDIT bypass, payload shape, ProceedAlways)?
- Are `# Issue #1574: Decompose `ast-edit.ts` into Focused Modules

**Related Issues:** #1568 (codebase-wide god object decomposition), #1574 (ast-edit.ts specific)
**Branch:** `issue1574`
**Guiding Principles:** Separation of Concerns (SoC), DRY, behavioral testing (per `dev-docs/RULES.md`)

## Problem Statement

`packages/core/src/tools/ast-edit.ts` is a 2,491-line monolith containing 10 classes, 18 interfaces, and 3 exported constants. It mixes **ten** distinct concerns:

1. **AST parsing and declaration extraction** (`ASTQueryExtractor`, L267–479)
2. **Configuration and feature flags** (`ASTConfig`, L482–544)
3. **Repository/git context collection** (`RepositoryContextProvider`, L547–665)
4. **Cross-file symbol analysis** (`CrossFileRelationshipAnalyzer`, L668–989)
5. **Prompt optimization** (`ContextOptimizer`, L992–1079)
6. **Context orchestration** (`ASTContextCollector`, L1082–1537)
7. **Tool definitions** (`ASTEditTool` L1540–1692, `ASTReadFileTool` L1695–1775)
8. **Edit execution logic** (`ASTEditToolInvocation` L1778–2325 — preview, apply, confirm, calculateEdit, validation, diff, file I/O)
9. **Read execution logic** (`ASTReadFileToolInvocation`, L2327–2480)
10. **Shared types and constants** (interfaces L88–264, `CalculatedEdit` L2482–2491, `KEYWORDS` L60–70, `COMMENT_PREFIXES` L76, `REGEX` L82–85)

Additionally, `ast-edit.ts` duplicates utilities found in `edit.ts` and within itself:
- `ensureParentDirectoriesExist` — verbatim duplicate (ast-edit.ts L2317, edit.ts L822)
- `Diff.createPatch` with `DEFAULT_CREATE_PATCH_OPTIONS` — repeated 3x in ast-edit.ts (L1815, L1946, L2082) and 2x in edit.ts (L596, L741)
- `extractImports` — near-identical logic in both `CrossFileRelationshipAnalyzer` (L899) and `ASTContextCollector` (L1285)
- `detectLanguage` — identical logic in both `CrossFileRelationshipAnalyzer` (L981) and `ASTContextCollector` (L1244)

## Goals

1. Decompose `ast-edit.ts` into focused single-responsibility modules
2. Preserve all existing behavior — zero functional changes
3. Maintain import path stability (`'../tools/ast-edit.js'` must continue to work)
4. Establish clear internal module visibility policy (see below)
5. Eliminate DRY violations both with `edit.ts` and within `ast-edit.ts` itself
6. Ensure behavioral test coverage for all high-risk extraction targets

## Non-Goals

- Changing any behavior of ASTEditTool or ASTReadFileTool
- Changing the tool schemas or parameter shapes
- Refactoring `edit.ts` beyond importing shared utilities
- Adding new features to the AST tools
- Arbitrary method-size limits (methods should be coherent, not artificially chopped)
- **Unifying `applyReplacement` logic between `edit.ts` and `ast-edit.ts`** — see "No-Behavior-Unification Warning" below

## WARNING: No-Behavior-Unification Warning: `edit.ts` vs `ast-edit.ts` `applyReplacement`

The `applyReplacement` implementations in `edit.ts` (L69–169) and `ast-edit.ts` (L1547–1565) **intentionally diverge** and MUST NOT be unified:

- **`edit.ts`** `applyReplacement` (L69): Accepts `expectedReplacements` parameter, supports fuzzy matching via `fuzzyReplace()`, handles multi-occurrence replacement with index tracking, preserves trailing newlines.
- **`ast-edit.ts`** `ASTEditTool.applyReplacement` (L1547): Simple single-replace via `String.replace()`, no fuzzy matching, no multi-occurrence support.

These are **different domain behaviors**, not copy-paste duplication. Extracting `ast-edit.ts`'s version to `edit-helpers.ts` is correct. Merging them into a shared function would break one or both tools. Any future implementer must be warned: do not "DRY" these two functions together.

## Internal Module Visibility Policy

The files under `ast-edit/` are **package-internal modules** — they are implementation details of the `ast-edit` subsystem, not part of the public API surface. However, they are **intentionally importable** for testing and internal use within the `packages/core` package.

**Concrete rules:**

1. **External consumers** (anything outside `packages/core/src/tools/`) import only from `ast-edit.ts` (the thin shell). The re-export contract is: `ASTEditTool`, `ASTReadFileTool`, `EnhancedDeclaration`, `ASTEditToolParams`, `ASTReadFileToolParams`, `KEYWORDS`, `COMMENT_PREFIXES`, `REGEX`, `LANGUAGE_MAP`, `JAVASCRIPT_FAMILY_EXTENSIONS`.

2. **Test files** import directly from `ast-edit/` submodules. This replaces the current pattern of cast-based access to private internals (e.g., `(tool as unknown as { contextCollector: ... }).contextCollector.astExtractor`). Tests importing directly from submodules is cleaner than cast-based access through opaque type assertions and `any`.

3. **`createInvocation`** is `protected` on `ASTEditTool` (L1640) and `ASTReadFileTool` (L1766). This wiring is **not changed** — both tool classes continue to instantiate their respective invocation classes internally. Tests that currently cast through `createInvocation` (ast-edit.test.ts L57–75, ast-edit-lsp-integration.test.ts L132–134) will continue using the same cast pattern since `createInvocation` remains a protected method on the tool class, not on the extracted invocation module.

### Submodule Test Import Stability Warning

**Direct submodule test imports (e.g., `from '../ast-edit/context-collector.js'`) are package-internal convenience paths, not a stable API contract.** These import paths exist solely for testing and may change without deprecation in future refactoring. Only the `ast-edit.ts` thin shell re-exports constitute stable API. Tests that import from submodules accept the coupling cost of updating import paths if submodule boundaries shift. This is an explicit trade-off: cleaner test code now vs. potential import churn later.

## Dependency Direction Rules

**Mandatory rule: submodules never import from the parent.** All `ast-edit/` submodules MUST NOT import from `../ast-edit.js` (the thin shell). Only `ast-edit.ts` imports downward into the `ast-edit/` directory. This rule prevents circular dependencies.

**Allowed dependency directions:**
```
ast-edit.ts → ast-edit/*.ts           [OK] (parent imports submodules)
ast-edit/foo.ts → ast-edit/bar.ts     [OK] (sibling imports between submodules)
ast-edit/foo.ts → ../ast-edit.ts      [ERROR] FORBIDDEN (upward dependency)
ast-edit/foo.ts → ../tools.ts         [OK] (external dependency on peer modules)
ast-edit/foo.ts → ../../utils/*.ts    [OK] (external dependency on utils)
```

**Additional rule: no cycles among sibling submodules.** The import graph of all `ast-edit/*.ts` files must be a DAG (directed acyclic graph). Example of a forbidden cycle: `context-collector.ts → local-context-analyzer.ts → context-collector.ts`.

**Enforcement:** A dedicated test in the export-contract test file (see Phase 0) will verify both rules: (1) no upward imports to `../ast-edit.js`, and (2) no import cycles among sibling `ast-edit/*.ts` files. See Step 0.4 for the exact implementation.

**Known circular dependency risk:** `ASTEditToolInvocation.calculateEdit` (L2227) calls `ASTEditTool.applyReplacement`. After extraction, the invocation module cannot import from `ast-edit.ts`. Solution: extract `applyReplacement` to `edit-helpers.ts` first (Phase 5, Step 5.1). `ASTEditTool` retains `static applyReplacement = applyReplacement` (delegating to the extracted function) for backward compatibility. Additional potential cycles (e.g., if invocation modules needed tool-level config) are prevented by the blanket "no upward import" rule — any such need must be resolved by passing values as constructor/method parameters.

## Governance Exception: TDD Compliance for Structural Refactoring

> **WARNING: APPROVED GOVERNANCE EXCEPTION to `dev-docs/RULES.md`**
>
> `dev-docs/RULES.md` states: *"Every line of production code must be written in response to a failing test. No exceptions."* This plan deviates from that rule for structural code movement. RULES.md does not grant exceptions; therefore, **this deviation requires explicit user/team approval before implementation begins.**
>
> **What conforms to RULES.md:**
> - Phase 0 `ensure-dirs.test.ts` is genuine RED→GREEN TDD: the test is written first, fails (import error), then `ensure-dirs.ts` is created to make it pass.
> - Phase 0 export-contract and dependency-direction tests are written first, fail initially (no submodule dir exists), and pass only when extraction is complete.
> - Phase 0 schema stability tests are written first against the current monolith — they pass immediately as characterization tests and serve as regression guards.
> - Phase 0 `validateToolParamValues` behavior tests are written first against the current monolith.
>
> **What deviates from RULES.md:**
> - Tests for newly extracted modules (Phases 3–5) are written after extraction, not before. When we create `ast-config.test.ts`, `language-analysis.test.ts`, etc., the production code already exists (it was moved from the monolith). Writing a "RED" test for an import path that doesn't exist yet tests module resolution, not behavior.
> - Phase 0 characterization tests pass immediately — they document existing behavior as regression safety nets, not RED tests. They provide equivalent safety to TDD for behavior preservation during code movement.
>
> **Why this is justified:**
> - This is a pure structural refactoring: code is *moved*, not *written*. The moved code already works and is already covered by characterization tests written in Phase 0.
> - Forcing artificial RED→GREEN for code moves would require either (a) writing import-path tests that test Node.js module resolution rather than application behavior, or (b) temporarily deleting production code to make tests fail, then re-adding it — both are busywork that provides no safety benefit.
>
> **Approval status:** This plan must be reviewed and approved by the team before implementation. If this exception is not approved, the plan must be restructured so that all tests precede code moves (likely by moving all characterization tests to import from the *future* submodule paths in Phase 0, accepting that those tests will fail until extraction is complete, then extracting code to make them pass).

## Test Strategy

### Prioritization Testing: Deterministic Unit Test

**`prioritizeSymbolsFromDeclarations`** (L1222) is currently a private method on `ASTContextCollector`. The current plan's indirect testing approach (test via `collectEnhancedContext` + inspect `relatedSymbols` ordering) is **flawed** because results depend on external workspace state and cross-file search behavior.

**Revised approach:** Extract `prioritizeSymbolsFromDeclarations` as a **module-private exported-for-tests pure function** in `context-collector.ts`:

```typescript
// context-collector.ts

/** @internal Exported for testing only. Not part of public API. */
export function prioritizeSymbolsFromDeclarations(
  declarations: EnhancedDeclaration[],
): string[] {
  // ... exact same logic from L1222-1241
}
```

Add a **deterministic unit test** with controlled input data in `__tests__/context-collector.test.ts`:

```typescript
import { prioritizeSymbolsFromDeclarations } from '../ast-edit/context-collector.js';

describe('prioritizeSymbolsFromDeclarations', () => {
  it('should rank classes above functions above variables', () => {
    const decls: EnhancedDeclaration[] = [
      { name: 'myHelper', type: 'function', line: 11, column: 1,
        range: { start: { line: 11, column: 1 }, end: { line: 12, column: 1 } } },
      { name: 'MyClass', type: 'class', line: 1, column: 1,
        range: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } } },
      { name: 'someVar', type: 'variable', line: 13, column: 1,
        range: { start: { line: 13, column: 1 }, end: { line: 13, column: 10 } } },
    ];
    const result = prioritizeSymbolsFromDeclarations(decls);
    expect(result.indexOf('MyClass')).toBeLessThan(result.indexOf('myHelper'));
  });

  it('should exclude short symbol names (length < MIN_SYMBOL_LENGTH)', () => {
    const decls: EnhancedDeclaration[] = [
      { name: 'ab', type: 'class', line: 1, column: 1,
        range: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } } },
      { name: 'LongEnoughName', type: 'function', line: 11, column: 1,
        range: { start: { line: 11, column: 1 }, end: { line: 12, column: 1 } } },
    ];
    const result = prioritizeSymbolsFromDeclarations(decls);
    expect(result).not.toContain('ab');
    expect(result).toContain('LongEnoughName');
  });

  it('should boost public visibility declarations', () => {
    const decls: EnhancedDeclaration[] = [
      { name: 'privateFunc', type: 'function', line: 1, column: 1,
        range: { start: { line: 1, column: 1 }, end: { line: 5, column: 1 } } },
      { name: 'publicFunc', type: 'function', line: 6, column: 1, visibility: 'public',
        range: { start: { line: 6, column: 1 }, end: { line: 10, column: 1 } } },
    ];
    const result = prioritizeSymbolsFromDeclarations(decls);
    expect(result.indexOf('publicFunc')).toBeLessThan(result.indexOf('privateFunc'));
  });
});
```

This is a pure function with controlled input — no external dependencies, no workspace, no flakiness.

### Schema Stability Tests

**Tool schemas are public behavior** — they define the parameter contract that LLM clients depend on. Schema changes are breaking changes. These tests pin the exact schema shape for both tools.

Tests in `__tests__/ast-edit-characterization.test.ts`:

```typescript
describe('ASTEditTool schema stability', () => {
  it('should have exactly the expected required parameters', () => {
    const tool = new ASTEditTool(mockConfig);
    const schema = tool.schema;
    expect(schema.required).toEqual(['file_path', 'old_string', 'new_string']);
  });

  it('should have exactly the expected optional parameters', () => {
    const tool = new ASTEditTool(mockConfig);
    const schema = tool.schema;
    const allParams = Object.keys(schema.properties).sort();
    const requiredParams = [...schema.required].sort();
    const optionalParams = allParams.filter(p => !requiredParams.includes(p)).sort();
    expect(optionalParams).toEqual(['force', 'last_modified']);
  });

  it('should have correct property types and descriptions', () => {
    const tool = new ASTEditTool(mockConfig);
    const props = tool.schema.properties;
    // Required params
    expect(props.file_path.type).toBe('string');
    expect(props.file_path.description).toContain('absolute path');
    expect(props.old_string.type).toBe('string');
    expect(props.old_string.description).toContain('exact literal text');
    expect(props.new_string.type).toBe('string');
    // Optional params
    expect(props.force.type).toBe('boolean');
    expect(props.force.default).toBe(false);
    expect(props.last_modified.type).toBe('number');
    expect(props.last_modified.description).toContain('Timestamp');
  });
});

describe('ASTReadFileTool schema stability', () => {
  it('should have exactly the expected required parameters', () => {
    const tool = new ASTReadFileTool(mockConfig);
    const schema = tool.schema;
    expect(schema.required).toEqual(['file_path']);
  });

  it('should have exactly the expected optional parameters', () => {
    const tool = new ASTReadFileTool(mockConfig);
    const schema = tool.schema;
    const allParams = Object.keys(schema.properties).sort();
    const requiredParams = [...schema.required].sort();
    const optionalParams = allParams.filter(p => !requiredParams.includes(p)).sort();
    expect(optionalParams).toEqual(['limit', 'offset']);
  });

  it('should have correct property types and descriptions', () => {
    const tool = new ASTReadFileTool(mockConfig);
    const props = tool.schema.properties;
    expect(props.file_path.type).toBe('string');
    expect(props.file_path.description).toContain('absolute path');
    expect(props.offset.type).toBe('number');
    expect(props.offset.minimum).toBe(1);
    expect(props.limit.type).toBe('number');
    expect(props.limit.minimum).toBe(1);
  });
});
```

These tests verify exact schema parity: not just "these params exist" but "these are the ONLY params, with the correct types, defaults, and required status." Any param added, removed, or changed will fail these tests.

### `validateToolParamValues` Behavior Tests

Both `ASTEditTool` (L1620–1638) and `ASTReadFileTool` (L1746–1764) implement identical validation logic:
1. Reject empty `file_path`
2. Reject non-absolute `file_path`
3. Reject paths outside workspace directories

Since Phase 6 (shell slimming) is high-risk, these need explicit test coverage to catch regressions.

Tests in `__tests__/ast-edit-characterization.test.ts`:

```typescript
describe('validateToolParamValues behavior', () => {
  describe('ASTEditTool', () => {
    it('should reject empty file_path', () => {
      const tool = new ASTEditTool(mockConfig);
      // validateToolParamValues is protected — test via createInvocation + execute
      // which calls validateToolParamValues internally via BaseDeclarativeTool
      // The base class returns an error ToolResult when validation fails
    });

    it('should reject relative file_path', () => {
      // params.file_path = 'relative/path.ts' → error containing 'must be absolute'
    });

    it('should reject file_path outside workspace', () => {
      // params.file_path = '/outside/workspace/file.ts' → error containing 'workspace directories'
    });

    it('should accept valid absolute file_path within workspace', () => {
      // params.file_path = '/test/valid.ts' → no validation error
    });
  });

  describe('ASTReadFileTool', () => {
    it('should reject empty file_path', () => {
      // Same pattern as ASTEditTool tests above
    });

    it('should reject relative file_path', () => {
      // Same pattern
    });

    it('should reject file_path outside workspace', () => {
      // Same pattern
    });

    it('should accept valid absolute file_path within workspace', () => {
      // Same pattern
    });
  });
});
```

These tests verify the validation boundary that protects against arbitrary filesystem access. Because `validateToolParamValues` is a `protected override`, tests exercise it through the public tool API (construct tool → create invocation → execute with invalid params → verify error).

### `getModifyContext()` Behavior Test

`ASTEditTool.getModifyContext` (L1650–1691) is specifically preserved because it provides the `ModifyContext<ASTEditToolParams>` interface used by the modifiable-tool system. It delegates to `ASTEditTool.applyReplacement` (L1670–1675) for proposed content computation. This behavior must be pinned.

Test in `__tests__/ast-edit-characterization.test.ts`:

```typescript
describe('getModifyContext behavior', () => {
  it('should return ModifyContext with getFilePath, getCurrentContent, getProposedContent, createUpdatedParams', () => {
    const tool = new ASTEditTool(mockConfig);
    const ctx = tool.getModifyContext(new AbortController().signal);
    expect(typeof ctx.getFilePath).toBe('function');
    expect(typeof ctx.getCurrentContent).toBe('function');
    expect(typeof ctx.getProposedContent).toBe('function');
    expect(typeof ctx.createUpdatedParams).toBe('function');
  });

  it('getFilePath should return params.file_path', () => {
    const tool = new ASTEditTool(mockConfig);
    const ctx = tool.getModifyContext(new AbortController().signal);
    const params: ASTEditToolParams = {
      file_path: '/test/foo.ts',
      old_string: 'a',
      new_string: 'b',
    };
    expect(ctx.getFilePath(params)).toBe('/test/foo.ts');
  });

  it('getProposedContent should apply replacement using ASTEditTool.applyReplacement', async () => {
    const tool = new ASTEditTool(mockConfig);
    const ctx = tool.getModifyContext(new AbortController().signal);
    const params: ASTEditToolParams = {
      file_path: '/test/sample.ts',
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    };
    // mockConfig.getFileSystemService().readTextFile returns 'const x = 1;'
    const proposed = await ctx.getProposedContent(params);
    expect(proposed).toBe('const x = 2;');
  });

  it('getProposedContent should return new_string when file does not exist', async () => {
    const enoentConfig = {
      ...mockConfig,
      getFileSystemService: () => ({
        readTextFile: async () => { const err = new Error('ENOENT'); (err as any).code = 'ENOENT'; throw err; },
        writeTextFile: async () => {},
      }),
    } as unknown as Config;
    const tool = new ASTEditTool(enoentConfig);
    const ctx = tool.getModifyContext(new AbortController().signal);
    const params: ASTEditToolParams = {
      file_path: '/test/nonexistent.ts',
      old_string: '',
      new_string: 'new file content',
    };
    const proposed = await ctx.getProposedContent(params);
    expect(proposed).toBe('new file content');
  });

  it('createUpdatedParams should merge old/new content into params', () => {
    const tool = new ASTEditTool(mockConfig);
    const ctx = tool.getModifyContext(new AbortController().signal);
    const original: ASTEditToolParams = {
      file_path: '/test/foo.ts',
      old_string: 'a',
      new_string: 'b',
      force: true,
    };
    const updated = ctx.createUpdatedParams('old-content', 'new-content', original);
    expect(updated.old_string).toBe('old-content');
    expect(updated.new_string).toBe('new-content');
    expect(updated.file_path).toBe('/test/foo.ts');
    expect(updated.force).toBe(true);
  });
});
```

This pins the `getModifyContext` contract so that when `ASTEditTool.applyReplacement` is extracted to `edit-helpers.ts` (Phase 5, Step 5.1), the delegation still works correctly.

### Preview/Apply Consistency Characterization Test

**Risk:** Preview computes `newContent` directly via `ASTEditTool.applyReplacement()` in `executePreview` (L1932–1942), while apply goes through `calculateEdit` (L2046–2050) which contains its own `applyReplacement` call (L2226–2232). This duplication means preview and apply could compute different results for the same input.

**Characterization test** in `__tests__/ast-edit-characterization.test.ts`:

```typescript
it('should produce identical newContent between preview and apply for same input', async () => {
  // 1. Call with force:false (preview) — capture returnDisplay.newContent
  // 2. Call with force:true (apply) — capture returnDisplay.newContent
  // 3. Assert they are identical
  // 4. Also verify astValidation shape matches between both
});
```

This pins the current behavior so any future divergence is caught.

### Empty-Existing-File vs Nonexistent-File Characterization Tests

**Risk:** The preview and apply paths determine `isNewFile` differently:
- **Preview (L1897–1900):** `isNewFile = old_string === '' && rawCurrentContent === ''`
  - `readFileContent()` (L2271–2281) returns `''` on ENOENT *and* for actual empty existing files
  - So preview treats both empty-existing and nonexistent identically: `isNewFile = true`
- **Apply (L2197–2199):** `isNewFile = old_string === '' && !fileExists`
  - Uses actual filesystem `fileExists` check (L2161)
  - So apply distinguishes: nonexistent → `isNewFile = true`, empty-existing → `isNewFile = false`

This is a **real behavioral divergence** that must be characterized with explicit tests:

```typescript
describe('empty-existing-file vs nonexistent-file behavior', () => {
  it('preview: empty old_string + nonexistent file → isNewFile behavior', async () => {
    // old_string='', file doesn't exist
    // Preview: readFileContent returns '' → isNewFile = ('' === '' && '' === '') = true
    // Verify: newContent === new_string
  });

  it('preview: empty old_string + empty existing file → isNewFile behavior', async () => {
    // old_string='', file exists but is empty
    // Preview: readFileContent returns '' → isNewFile = ('' === '' && '' === '') = true
    // Verify: newContent === new_string (same as nonexistent!)
  });

  it('apply: empty old_string + nonexistent file → creates file', async () => {
    // old_string='', file doesn't exist
    // Apply: fileExists=false → isNewFile = true → writes new_string
  });

  it('apply: empty old_string + empty existing file → no-op', async () => {
    // old_string='', file exists but is empty
    // Apply: fileExists=true → isNewFile = false
    // applyReplacement('', '', new_string, false) → returns '' (old_string==='' && !isNewFile → currentContent)
    // This means the existing empty file is NOT overwritten
  });
});
```

### What we do NOT preserve as compatibility targets

**Private property names** (`astExtractor`, `relationshipAnalyzer`) on `ASTContextCollector` are NOT compatibility targets. These names are only used by tests via bad casts — that's accidental internal structure, not API stability. The compatibility targets are:
- Public tool exports from `ast-edit.ts` (classes, types, constants)
- Public tool behavior (return shapes, error types, schemas)
- Externally consumed schema/return shapes (FileDiff metadata, ToolResult shapes)

After extraction, the existing cast-based tests that access these private properties will be rewritten as proper behavioral tests on the extracted submodules' public APIs.

### Snapshot file migration

The snapshot file `__snapshots__/ast-edit.test.ts.snap` contains snapshots keyed by test name:
- `AST Tools > AST extraction logic > should extract TypeScript declarations correctly 1`
- `AST Tools > AST extraction logic > should extract Python declarations correctly 1`

When these tests move to `__tests__/ast-query-extractor.test.ts`, the snapshot file path changes. The new test file must use the same `describe`/`it` names so that `--update` regenerates identical snapshots. New snapshot file: `__tests__/__snapshots__/ast-query-extractor.test.ts.snap`. The old snapshot file entries will be orphaned and should be deleted.

**IMPORTANT: Manual semantic review of regenerated snapshots is required.** After running `--update`, the regenerated snapshots must be manually compared against the original snapshots to verify they are semantically identical (same declarations, same ordering, same types). Simply running `--update` and trusting the output is insufficient — a subtle behavioral change during extraction could silently produce a new "passing" snapshot that differs from the original. The reviewer must diff old vs new snapshot files line-by-line.

## Current State Analysis

### File Structure (before)

```
packages/core/src/tools/
├── ast-edit.ts              (2,491 lines — the monolith)
├── ast-edit.test.ts         (246 lines)
├── __tests__/
│   └── ast-edit-lsp-integration.test.ts  (271 lines)
├── __snapshots__/
│   └── ast-edit.test.ts.snap             (snapshot for extraction tests)
├── edit.ts                  (1,017 lines — has duplicate utilities)
├── diffOptions.ts           (76 lines — already extracted)
├── lsp-diagnostics-helper.ts (93 lines — already extracted)
├── modifiable-tool.ts       (224 lines — already extracted)
└── tools.ts                 (924 lines — base types)
```

### Import Consumers (COMPLETE — verified via grep)

All files in the repository that import from `ast-edit`:

```typescript
// packages/core/src/config/config.ts (L27-28)
import { ASTEditTool } from '../tools/ast-edit.js';
import { ASTReadFileTool } from '../tools/ast-edit.js';

// packages/core/src/tools/ast-edit.test.ts (L9-13)
import { ASTEditTool, ASTReadFileTool, EnhancedDeclaration } from './ast-edit.js';

// packages/core/src/tools/__tests__/ast-edit-lsp-integration.test.ts (L11)
import { ASTEditTool } from '../ast-edit.js';
```

**Verification command used:** `grep -r "from.*ast-edit" --include="*.ts" --include="*.tsx"` (excluding `PLAN.md` and `node_modules`). These are the **only three** consumer files. No other files in the codebase import from `ast-edit`. All three must continue to work unchanged after extraction.

## Target Architecture

### File Structure (after)

```
packages/core/src/tools/
├── ast-edit.ts                            (~200 lines — thin shell with re-exports)
├── ast-edit.test.ts                       (~80 lines — export-contract + exhaustive export-surface + dependency-direction + instantiation + schema stability)
├── ast-edit/
│   ├── types.ts                           (~150 lines — interfaces EXCEPT CalculatedEdit)
│   ├── constants.ts                       (~30 lines — KEYWORDS, COMMENT_PREFIXES, REGEX)
│   ├── ast-config.ts                      (~70 lines — ASTConfig class)
│   ├── ast-query-extractor.ts             (~220 lines — ASTQueryExtractor)
│   ├── repository-context-provider.ts     (~120 lines — RepositoryContextProvider)
│   ├── cross-file-analyzer.ts             (~350 lines — CrossFileRelationshipAnalyzer + getWorkspaceFiles)
│   ├── context-optimizer.ts               (~90 lines — ContextOptimizer)
│   ├── language-analysis.ts               (~30 lines — shared detectLanguage + extractImports)
│   ├── local-context-analyzer.ts          (~250 lines — parseAST, extractImports, collectSnippets, buildLanguageContext, helpers)
│   ├── workspace-context-provider.ts      (~80 lines — enrichWithWorkingSetContext only)
│   ├── context-collector.ts               (~150 lines — orchestration-only ASTContextCollector + prioritizeSymbolsFromDeclarations)
│   ├── edit-helpers.ts                    (~20 lines — applyReplacement standalone function)
│   ├── edit-calculator.ts                 (~200 lines — calculateEdit, countOccurrences, validateASTSyntax, getFileLastModified, CalculatedEdit interface)
│   ├── ast-edit-invocation.ts             (~350 lines — ASTEditToolInvocation: preview, apply, confirm, description)
│   └── ast-read-file-invocation.ts        (~160 lines — ASTReadFileToolInvocation)
├── ensure-dirs.ts                         (~15 lines — shared ensureParentDirectoriesExist)
├── __tests__/
│   ├── ast-edit-lsp-integration.test.ts   (UNCHANGED — imports from '../ast-edit.js')
│   ├── ast-edit-characterization.test.ts  (NEW — characterization tests for current public behavior + schema stability + validateToolParamValues + getModifyContext)
│   ├── calculate-edit-characterization.test.ts (NEW — characterization tests for calculateEdit edge cases)
│   ├── ast-query-extractor.test.ts        (relocated extraction tests + snapshot migration)
│   ├── context-collector.test.ts          (relocated perf tests + prioritizeSymbolsFromDeclarations deterministic tests)
│   ├── ast-edit-invocation.test.ts        (relocated freshness/preview tests)
│   ├── ast-read-file-invocation.test.ts   (NEW — offset/limit, error mapping, EMFILE/ENFILE, metadata shape)
│   ├── repository-context-provider.test.ts (NEW — null on git failures, working set paths)
│   ├── cross-file-analyzer.test.ts        (NEW — import extraction, workspace guard)
│   ├── ast-config.test.ts                 (NEW — ENABLE_SYMBOL_INDEXING env var)
│   ├── language-analysis.test.ts          (NEW — shared detectLanguage + extractImports)
│   └── ensure-dirs.test.ts               (NEW — standalone ensureParentDirectoriesExist)
├── __snapshots__/
│   └── ast-edit.test.ts.snap              (orphaned entries cleaned up)
└── edit.ts                                (1 import changed — uses ensure-dirs.ts)
```

### Key design decisions on types

**`CalculatedEdit` stays near edit computation, NOT in `types.ts`.** The `CalculatedEdit` interface (L2482–2491) is tightly coupled to `calculateEdit` and `ASTEditToolInvocation`. It contains `ToolErrorType` references and `astValidation` shapes that are edit-specific. It belongs in `edit-calculator.ts`, not in the shared `types.ts` file. This keeps `types.ts` focused on the context/analysis domain.

**`types.ts` contains:** `ASTContext`, `ASTNode`, `Declaration`, `CodeSnippet`, `Import`, `FunctionInfo`, `ClassInfo`, `VariableInfo`, `Position`, `SgNode`, `RepositoryContext`, `SymbolReference`, `FileContext`, `CrossFileContext`, `ConnectedFile`, `EnhancedDeclaration`, `EnhancedASTContext`, `ASTEditToolParams`, `ASTReadFileToolParams`.

### `workspace-context-provider.ts` and `cross-file-analyzer.ts` boundary clarification

**`getWorkspaceFiles` moves to `cross-file-analyzer.ts`, NOT `workspace-context-provider.ts`.** `getWorkspaceFiles` (L1521–1536) performs file discovery via `fast-glob` for the symbol indexing codepath (`ENABLE_SYMBOL_INDEXING`, L1179). Its sole consumer is `collectEnhancedContext`, which passes the result to `CrossFileRelationshipAnalyzer.buildSymbolIndex`. This is file discovery *for indexing* — it belongs with `CrossFileRelationshipAnalyzer`, not as a general workspace utility.

**`workspace-context-provider.ts` has a single responsibility: working-set enrichment.** It exports only `enrichWithWorkingSetContext(targetFilePath, workspaceRoot, repoProvider, astExtractor): Promise<ConnectedFile[]>`, which takes working-set files from `RepositoryContextProvider.getWorkingSetFiles()`, reads them, extracts declarations, and returns `ConnectedFile[]`. This is the working-set enrichment loop from `collectEnhancedContext` (L1146–1168).

This clean split avoids the original design where `workspace-context-provider.ts` mixed two different responsibilities (file discovery for indexing vs. working-set enrichment).

### `local-context-analyzer.ts` — intermediate boundary acknowledgment

**`local-context-analyzer.ts` is an intermediate extraction boundary, not a final ideal SoC state.** It aggregates several concerns that are currently tightly interleaved in `ASTContextCollector`:

- AST node parsing/extraction (`parseAST`, `extractASTNodes`)
- Language-specific context building (`buildLanguageContext`, `extractFunctions`, `extractClasses`, `extractVariables`)
- Code snippet collection (`collectSnippets`, `calculateRelevance`, `isSignificantLine`, `inferNodeType`)
- Context optimization (`optimizeContextCollection`)

These could be further split in a future PR into:
- `local-ast-analysis.ts` — AST node parsing, `parseAST`, `extractASTNodes`
- `language-context-builder.ts` — `buildLanguageContext`, `extractFunctions`, `extractClasses`, `extractVariables`
- `snippet-collector.ts` — `collectSnippets`, `calculateRelevance`, `isSignificantLine`, `inferNodeType`

For this PR, extracting them as one unit is pragmatic: they share internal data structures and calling patterns that would require additional interface design to separate cleanly. Acknowledging this boundary as non-final avoids presenting it as ideal SoC.

### `EnhancedDeclaration` export contract note

`EnhancedDeclaration` is a TypeScript `interface` (L197–205). At runtime, TypeScript types are **erased** — there is no runtime representation of `EnhancedDeclaration`. The export contract test for `EnhancedDeclaration` can only verify compile-time correctness by constructing a conforming object literal. It cannot verify a runtime export like `typeof EnhancedDeclaration !== 'undefined'` because no such runtime value exists. The test must create an object satisfying the interface shape and verify it compiles.

## Primary DRY Analysis

**Note: This analysis covers the primary DRY violations identified. It is not exhaustive — additional duplication patterns exist but are deferred.**

| Duplicate | Location 1 | Location 2 | Resolution |
|---|---|---|---|
| `ensureParentDirectoriesExist` | ast-edit.ts L2317 | edit.ts L822 | Extract to `ensure-dirs.ts`, both import |
| `extractImports` | `CrossFileRelationshipAnalyzer` L899 | `ASTContextCollector` L1285 | Extract to `language-analysis.ts` |
| `detectLanguage` | `CrossFileRelationshipAnalyzer` L981 | `ASTContextCollector` L1244 | Extract to `language-analysis.ts` |
| `extractImportModule` | `CrossFileRelationshipAnalyzer` L930 | `ASTContextCollector` L1380 | Inline into shared `extractImports` |
| `extractImportItems` | `CrossFileRelationshipAnalyzer` L935 | `ASTContextCollector` L1385 | Inline into shared `extractImports` |
| `Diff.createPatch` pattern | ast-edit.ts L1815, L1946, L2082 | edit.ts L596, L741 | Document as candidate for future `createFileDiff` helper; **out of scope** for this PR since it requires touching the `Diff.createPatch` call sites with different parameters across edit.ts and ast-edit.ts. The pattern is a one-liner call, not a substantial DRY violation. |

### Known additional DRY issues (NOT addressed in this PR)

These are deferred to future work to keep the PR focused on structural decomposition:

| Duplicate | Location 1 | Location 2 | Notes |
|---|---|---|---|
| `validateToolParamValues` | `ASTEditTool` L1620–1638 | `ASTReadFileTool` L1746–1764 | Identical logic: check non-empty, check absolute, check workspace. Could be extracted to a shared validator. |
| `contextCollector` construction | `ASTEditTool` constructor L1617 | `ASTReadFileTool` constructor L1743 | Both `new ASTContextCollector()` — could share via factory or base class. |
| Path-shortening description patterns | `ASTEditToolInvocation.getDescription()` L1846–1867 | `ASTReadFileToolInvocation.getDescription()` L2341–2347 | Similar `makeRelative` + `shortenPath` patterns. |
| `Diff.createPatch` repetition | L1815, L1946, L2082 within ast-edit.ts | — | Three call sites with slightly different params (`'Proposed'` vs `'Applied'`). |

## Implementation Plan — Phased Extraction

### Phase 0: Characterization Tests, Schema Stability, and Export Contract (BEFORE any extraction)

**Goal:** Lock down current public behavior of `ast-edit.ts` so that any behavioral regression during extraction is immediately caught. Also write genuine RED tests for `ensure-dirs.ts`. Also create the export-contract and dependency-direction tests that will pass only when extraction is complete.

**This phase creates the safety net. No production code changes.**

#### Step 0.1: Create `packages/core/src/tools/__tests__/ast-edit-characterization.test.ts`

These tests import from `'../ast-edit.js'` (the current monolith) and pass immediately. They document exact behavior:

```typescript
import { ASTEditTool, ASTReadFileTool, EnhancedDeclaration, KEYWORDS, COMMENT_PREFIXES, REGEX } from '../ast-edit.js';
import { LANGUAGE_MAP, JAVASCRIPT_FAMILY_EXTENSIONS } from '../ast-edit.js';
```

**Tests (all must pass against the current monolith):**

1. **Preview llmContent structure:** Call `createInvocation` with `force: false` on an existing file. Verify `llmContent` starts with `'LLXPRT EDIT PREVIEW:'`, contains `'AST validation:'`, contains `'NEXT STEP: Call again with force: true'`.
2. **Preview returnDisplay metadata shape:** Verify `returnDisplay` is a `FileDiff` object with properties `fileDiff` (string), `fileName` (string), `originalContent` (string), `newContent` (string), `metadata.astValidation` (object with `valid` boolean), `metadata.currentMtime` (number or undefined).
3. **Apply result metadata shape:** Call with `force: true`. Verify `returnDisplay` has `applied: true`, `metadata.astValidation` (object).
4. **AST validation success propagation:** Edit a `.ts` file with valid syntax → `astValidation.valid === true`.
5. **AST validation failure propagation:** Edit a `.ts` file producing invalid syntax → `astValidation.valid === false`, `astValidation.errors` is non-empty array.
6. **CRLF normalization:** Provide `old_string` with `\r\n` line endings. Verify the match still succeeds (L2146–2147 normalize to `\n`).
7. **New-file creation:** `old_string === ''` + file doesn't exist → creates file with `new_string` content. Verify `isNewFile` behavior via successful apply.
8. **No-change behavior:** `old_string === new_string` → error with type `ToolErrorType.EDIT_NO_CHANGE`.
9. **`toolLocations()` for ASTEditTool:** Verify returns `[{ path: params.file_path }]`.
10. **`toolLocations()` for ASTReadFileTool:** Verify returns `[{ path: params.file_path, line: params.offset }]`.
11. **`getDescription()` for ASTEditTool preview:** Verify contains `[PREVIEW]` (L1866).
12. **`getDescription()` for ASTEditTool execute:** Verify contains `[EXECUTE]` when `force: true` (L1866).
13. **`getDescription()` for ASTEditTool create:** `old_string === ''` → starts with `'Create '` (L1851–1852).
14. **`getDescription()` for ASTReadFileTool:** Returns shortened relative path (L2341–2347).
15. **Unknown error mapping in ASTReadFileToolInvocation:** Pass a non-NodeError to execute → error type is `ToolErrorType.UNKNOWN` (L2467–2468).
16. **Export-contract verification:** Verify that `ASTEditTool`, `ASTReadFileTool`, `EnhancedDeclaration` (as conforming object), `KEYWORDS`, `COMMENT_PREFIXES`, `REGEX`, `LANGUAGE_MAP`, `JAVASCRIPT_FAMILY_EXTENSIONS` are all importable from `'../ast-edit.js'` and are defined (not undefined). `EnhancedDeclaration` is compile-time only (types erased at runtime) — verify by constructing a conforming object literal, not by checking runtime existence.
17. **Preview/apply consistency:** Same `file_path`, `old_string`, `new_string` should produce identical `newContent` and `astValidation` shapes between preview (`force: false`) and apply (`force: true`) paths. See "Preview/Apply Consistency Characterization Test" above for detail.
18. **EMFILE/ENFILE mapping in ASTReadFileToolInvocation:** Simulate EMFILE or ENFILE error code → error type is `ToolErrorType.READ_CONTENT_FAILURE` (L2457–2461).
19. **Successful ASTReadFileTool metadata shape:** Call execute on a valid file → verify `returnDisplay` has `content` (string), `fileName` (string), `filePath` (string), `metadata.language` (string), `metadata.declarationsCount` (number) (L2432–2439).
20. **ASTEditTool.applyReplacement static method availability:** Verify `ASTEditTool.applyReplacement` is callable as a static method and returns correct result for known inputs.
21. **ASTEditTool schema stability** — exact required params, exact optional params, property types and descriptions (see "Schema Stability Tests" above).
22. **ASTReadFileTool schema stability** — exact required params, exact optional params, property types and descriptions (see "Schema Stability Tests" above).
23. **ASTEditTool validateToolParamValues** — reject empty, reject relative, reject outside workspace, accept valid (see "validateToolParamValues Behavior Tests" above).
24. **ASTReadFileTool validateToolParamValues** — reject empty, reject relative, reject outside workspace, accept valid (see "validateToolParamValues Behavior Tests" above).
25. **getModifyContext behavior** — getFilePath, getCurrentContent, getProposedContent, createUpdatedParams all behave correctly (see "getModifyContext Behavior Test" above).
26. **shouldConfirmExecute — preview bypass:** Call with `force: false` → `shouldConfirmExecute` returns `undefined` (no confirmation needed, L1794–1797).
27. **shouldConfirmExecute — AUTO_EDIT bypass:** Call with `force: true` + `ApprovalMode.AUTO_EDIT` → returns `undefined` (L1800–1806).
28. **shouldConfirmExecute — manual confirmation payload shape:** Call with `force: true` + manual mode → returns `ToolEditConfirmationDetails` with `diff` (string), `fileDiff` (FileDiff), `metadata.astValidation`, `metadata.fileFreshness` (L1814–1841).
29. **shouldConfirmExecute — ProceedAlways side effect:** When user confirms with `ProceedAlways`, verify `setApprovalMode(ApprovalMode.AUTO_EDIT)` is called (L1805).
30. **`$` replacement semantics in applyReplacement:** `ASTEditTool.applyReplacement` uses `String.replace()` (L1564) which treats `$&`, `$'`, `` $` `` as special replacement patterns. Characterize: `applyReplacement('hello', 'hello', '$&world', false)` → returns `'helloworld'` (not `'$&world'`). This is existing behavior that must be preserved, not "fixed."
31. **countOccurrences returns 0/1, not true count:** `countOccurrences` (L2263–2269) returns `content.includes(searchString) ? 1 : 0`, NOT the actual number of occurrences. Characterize: content with 3 occurrences → `countOccurrences` effectively returns 1. This is intentional (aligned with single-replace semantics) and must be preserved.
32. **Diff labels differ between preview and apply:** Preview uses `'Proposed'` (L1949–1951), apply uses `'Applied'` (L2085–2087), confirmation uses `'Proposed'` (L1818–1820). Characterize all three label values to prevent accidental normalization during extraction.


#### Step 0.1.1: Add empty-existing-file vs nonexistent-file characterization tests

These tests **must** be in the characterization test file to pin the behavioral divergence between preview and apply. See "Empty-Existing-File vs Nonexistent-File Characterization Tests" section above for the four specific tests.

#### Step 0.2: Create `packages/core/src/tools/__tests__/calculate-edit-characterization.test.ts`

These tests exercise `calculateEdit` edge cases through the public tool API (via `createInvocation` + `execute`). All pass immediately against the current monolith:

```typescript
import { ASTEditTool } from '../ast-edit.js';
```

**Tests:**

1. **Nonexistent file + empty old_string → create:** `old_string: ''`, `new_string: 'content'`, file doesn't exist → successful apply creates file.
2. **Nonexistent file + non-empty old_string → FILE_NOT_FOUND:** `old_string: 'something'`, file doesn't exist → error type `ToolErrorType.FILE_NOT_FOUND`.
3. **Freshness conflict precedence:** Provide `last_modified` older than file mtime → error type `ToolErrorType.FILE_MODIFIED_CONFLICT`, even if `old_string` is also invalid.
4. **No occurrence:** `old_string` not found in file → error type `ToolErrorType.EDIT_NO_OCCURRENCE_FOUND`.
5. **No change (old equals new):** → error type `ToolErrorType.EDIT_NO_CHANGE`.
6. **CRLF normalization in calculateEdit:** File content has `\r\n`, `old_string` has `\r\n` → match succeeds.
7. **AST validation generated on success:** Successful edit on `.ts` file → `astValidation` is defined.
8. **AST validation skipped for unknown language:** Successful edit on `.xyz` file → `astValidation.valid === true`, `errors: []` (L2290–2291).

#### Step 0.3: Create `packages/core/src/tools/__tests__/ensure-dirs.test.ts` (TRUE RED-GREEN TDD)

```typescript
import { ensureParentDirectoriesExist } from '../ensure-dirs.js';
```

Tests:
- `should create parent directories when they don't exist`
- `should not throw when parent directories already exist`
- `should handle nested directory creation`

These fail because `ensure-dirs.ts` does not exist yet. This is **genuine RED** per RULES.md.

#### Step 0.4: Add exhaustive export-surface, dependency-direction, and schema tests to `ast-edit.test.ts`

Add to the existing `ast-edit.test.ts`:

```typescript
import * as AstEditModule from './ast-edit.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

describe('export contract', () => {
  it('should export all public symbols', () => {
    // Verify each export is defined and has expected type
    expect(ASTEditTool).toBeDefined();
    expect(ASTReadFileTool).toBeDefined();
    // EnhancedDeclaration is a TypeScript interface — types are erased at runtime.
    // Verify compile-time correctness by constructing a conforming object:
    const decl: EnhancedDeclaration = {
      name: 'x', type: 'function', line: 1, column: 0,
      range: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } }
    };
    expect(decl.name).toBe('x');
    expect(KEYWORDS).toBeDefined();
    expect(KEYWORDS.FUNCTION).toBe('function');
    expect(COMMENT_PREFIXES).toContain('//');
    expect(REGEX.IMPORT_MODULE).toBeInstanceOf(RegExp);
    expect(LANGUAGE_MAP).toBeDefined();
    expect(JAVASCRIPT_FAMILY_EXTENSIONS).toBeDefined();
  });

  it('should export EXACTLY the expected runtime symbols and no others', () => {
    // Exhaustive export-surface test: verify EXACT parity, not just "these exist"
    const actualExports = Object.keys(AstEditModule).sort();
    const expectedExports = [
      'ASTEditTool',
      'ASTReadFileTool',
      'COMMENT_PREFIXES',
      'JAVASCRIPT_FAMILY_EXTENSIONS',
      'KEYWORDS',
      'LANGUAGE_MAP',
      'REGEX',
    ].sort();
    expect(actualExports).toEqual(expectedExports);
    // NOTE: EnhancedDeclaration, ASTEditToolParams, ASTReadFileToolParams are
    // TypeScript types — erased at runtime, not visible in Object.keys().
    // Their compile-time correctness is verified by the conforming object test above
    // and by TypeScript's own type checker during `npm run typecheck`.
  });

  it('should export ASTEditTool.applyReplacement as a static method', () => {
    expect(typeof ASTEditTool.applyReplacement).toBe('function');
    const result = ASTEditTool.applyReplacement('hello world', 'hello', 'goodbye', false);
    expect(result).toBe('goodbye world');
  });
});

describe('dependency direction', () => {
  it('should not have submodules importing from parent ast-edit.ts', async () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    // Navigate from __tests__ or tools dir to find the ast-edit submodule dir
    const toolsDir = currentDir.includes('__tests__')
      ? path.resolve(currentDir, '..')
      : currentDir;
    const submoduleDir = path.join(toolsDir, 'ast-edit');

    let submoduleFiles: string[] = [];
    try {
      const entries = await fs.readdir(submoduleDir);
      submoduleFiles = entries
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'))
        .map(f => path.join(submoduleDir, f));
    } catch {
      // No submodule dir yet — structural guard test, passes vacuously in Phase 0.
      // This test becomes meaningful only after Phase 2+ creates the ast-edit/ directory.
      // It is NOT a RED test — see "Governance Exception" section.
      return;
    }

    for (const file of submoduleFiles) {
      const content = await fs.readFile(file, 'utf-8');
      // Rule 1: No upward imports to parent ast-edit.ts
      expect(content).not.toMatch(/from\s+['"]\.\.\/ast-edit\.js['"]/);
      expect(content).not.toMatch(/from\s+['"]\.\.\/ast-edit['"]/);
    }
  });

  it('should have no import cycles among ast-edit/* sibling modules', async () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const toolsDir = currentDir.includes('__tests__')
      ? path.resolve(currentDir, '..')
      : currentDir;
    const submoduleDir = path.join(toolsDir, 'ast-edit');

    let submoduleFiles: string[] = [];
    try {
      const entries = await fs.readdir(submoduleDir);
      submoduleFiles = entries
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'));
    } catch {
      // No submodule dir yet — structural guard test, passes vacuously in Phase 0.
      // See note in upward-import test above.
      return;
    }

    // Build import graph: module name → set of imported sibling module names
    // LIMITATION: This uses regex-based import detection. It will catch static
    // `import ... from './foo.js'` statements but will NOT catch:
    // - Dynamic imports: `await import('./foo.js')`
    // - Multiline import statements (regex matches single-line only)
    // - Re-exports via `export ... from './foo.js'`
    // These limitations are acceptable because the codebase uses only static
    // single-line imports in the ast-edit/ submodules.
    const importGraph = new Map<string, Set<string>>();
    const moduleNames = new Set(submoduleFiles.map(f => f.replace(/\.ts$/, '')));

    for (const file of submoduleFiles) {
      const moduleName = file.replace(/\.ts$/, '');
      const content = await fs.readFile(path.join(submoduleDir, file), 'utf-8');
      const imports = new Set<string>();

      // Match: from './foo.js' or from './foo'
      const importRegex = /from\s+['"]\.\/([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const importedName = match[1].replace(/\.js$/, '');
        if (moduleNames.has(importedName)) {
          imports.add(importedName);
        }
      }
      importGraph.set(moduleName, imports);
    }

    // Detect cycles using standard DFS with three-color marking:
    // WHITE (unvisited) → GRAY (in current path) → BLACK (fully explored)
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const name of moduleNames) {
      color.set(name, WHITE);
    }

    function dfs(node: string, path: string[]): string[] | null {
      color.set(node, GRAY);
      path.push(node);

      for (const dep of importGraph.get(node) || []) {
        if (color.get(dep) === GRAY) {
          // Found cycle — return the cycle path
          const cycleStart = path.indexOf(dep);
          return [...path.slice(cycleStart), dep];
        }
        if (color.get(dep) === WHITE) {
          const cycle = dfs(dep, path);
          if (cycle) return cycle;
        }
        // BLACK nodes are fully explored, skip
      }

      path.pop();
      color.set(node, BLACK);
      return null;
    }

    for (const moduleName of moduleNames) {
      if (color.get(moduleName) === WHITE) {
        const cycle = dfs(moduleName, []);
        if (cycle) {
          throw new Error(
            `Import cycle detected among ast-edit/* modules: ${cycle.join(' → ')}`
          );
        }
      }
    }
  });
});
```

**Key differences from previous version:**
1. **Exhaustive export-surface test** uses `Object.keys(AstEditModule).sort()` compared to an expected list — verifies no exports were lost AND no unexpected exports were added.
2. **Dependency-direction tests are labeled as "structural guard tests"** with explicit comments noting they pass vacuously when no submodule dir exists. They are NOT labeled as RED tests.
3. **Cycle detection uses standard three-color DFS** (WHITE/GRAY/BLACK) — the standard textbook algorithm. No per-root `visited.clear()` bug. A single traversal correctly detects cycles across all connected components.
4. **Regex limitations are explicitly documented** — won't catch dynamic imports, multiline imports, or re-exports. Acceptable for this codebase's import style.

#### Step 0.5: Verify characterization tests pass, ensure-dirs test fails

Run: `npm run test -- --run packages/core/src/tools/__tests__/ast-edit-characterization.test.ts packages/core/src/tools/__tests__/calculate-edit-characterization.test.ts packages/core/src/tools/__tests__/ensure-dirs.test.ts packages/core/src/tools/ast-edit.test.ts`

Expected:
- `ast-edit-characterization.test.ts` — **passes** (characterization of existing behavior)
- `calculate-edit-characterization.test.ts` — **passes** (characterization of existing behavior)
- `ensure-dirs.test.ts` — **fails** (import error — TRUE RED)
- `ast-edit.test.ts` — **passes** (including new export-surface, dependency-direction, and schema tests)
- `ast-edit-lsp-integration.test.ts` — **passes** (unchanged)

 replacement semantics, countOccurrences 0/1, and diff label characterizations present?

---

### Phase 1: Extract Shared File Utilities (GREEN for ensure-dirs)

**Goal:** Create `ensure-dirs.ts` and make the RED test from Phase 0 go GREEN. Also update `edit.ts` to eliminate the DRY violation.

#### Step 1.1: Create `packages/core/src/tools/ensure-dirs.ts`

Extract `ensureParentDirectoriesExist` as a standalone exported function:

```typescript
import { promises as fsPromises } from 'fs';
import * as path from 'path';

export async function ensureParentDirectoriesExist(filePath: string): Promise<void> {
  const dirName = path.dirname(filePath);
  try {
    await fsPromises.access(dirName);
  } catch {
    await fsPromises.mkdir(dirName, { recursive: true });
  }
}
```

Verify: **ensure-dirs.test.ts now passes** (GREEN).

#### Step 1.2: Update `edit.ts` to use shared `ensure-dirs.ts`

Change `edit.ts`:
- Add import: `import { ensureParentDirectoriesExist } from './ensure-dirs.js';`
- Remove the private `ensureParentDirectoriesExist` method from `EditToolInvocation` (L822–829)
- Replace `await this.ensureParentDirectoriesExist(filePath)` (L707) with `await ensureParentDirectoriesExist(filePath)`

#### Step 1.3: Verify

Run all edit.ts tests + ensure-dirs.test.ts. All pass.

---

### Phase 2: Extract Types, Constants, and Foundation Modules

**Goal:** Extract pure-data modules (no behavioral logic) from `ast-edit.ts`. These are the lowest-risk extractions.

#### Step 2.1: Create `ast-edit/types.ts`

Extract all interfaces from `ast-edit.ts` (L88–264) **except `CalculatedEdit`** (which stays near edit computation):
- `ASTContext` (L88–101)
- `ASTNode` (L103–109)
- `Declaration` (L111–117)
- `CodeSnippet` (L119–126)
- `Import` (L128–132)
- `FunctionInfo` (L134–139)
- `ClassInfo` (L141–146)
- `VariableInfo` (L148–152)
- `Position` (L154–157)
- `SgNode` (L159–164)
- `RepositoryContext` (L167–172)
- `SymbolReference` (L174–180)
- `FileContext` (L182–186)
- `CrossFileContext` (L188–190)
- `ConnectedFile` (L192–195)
- `EnhancedDeclaration` (L197–205, exported)
- `EnhancedASTContext` (L207–214)
- `ASTEditToolParams` (L217–246, exported)
- `ASTReadFileToolParams` (L249–264, exported)

**Annotation preservation check:** Verify that the `@license` header is added to `types.ts`. Verify that any `[CCR]` or `@plan` annotations within the interface block (none currently exist in L88–264) are preserved.

#### Step 2.2: Create `ast-edit/constants.ts`

Extract (L60–85): `KEYWORDS`, `COMMENT_PREFIXES`, `REGEX`.

**Annotation preservation check:** Verify the JSDoc comments on `KEYWORDS` (L57–59), `COMMENT_PREFIXES` (L73–75), and `REGEX` (L79–81) are preserved.

#### Step 2.3: Update `ast-edit.ts` to import from new modules and re-export

```typescript
export type { EnhancedDeclaration, ASTEditToolParams, ASTReadFileToolParams } from './ast-edit/types.js';
export { KEYWORDS, COMMENT_PREFIXES, REGEX } from './ast-edit/constants.js';
```

Remove original declarations from `ast-edit.ts`. Remaining classes import from new files.

#### Step 2.4: Verify

Run full test suite. All existing tests pass (including characterization tests, LSP integration tests). No behavior change. **Exhaustive export-surface test passes** — `Object.keys()` still matches expected list.

**[CHECKPOINT] Phase 2 — verify all tests pass before continuing**
Submit to `deepthinker` for review: `types.ts`, `constants.ts`, `ast-edit.ts` diff, and verification that all exports remain available and all tests pass.

---

### Phase 3: Extract `ASTConfig` and `language-analysis`

**Goal:** Extract configuration and shared language utilities.

#### Step 3.1: Create `ast-edit/ast-config.ts`

Extract `ASTConfig` class (L482–544). Self-contained, no imports needed from other submodules.

**Annotation preservation check:** Verify that `[CCR]` annotations on `ENABLE_SYMBOL_INDEXING` (L494–496) and `MAX_WORKSPACE_FILES` (L518–519) are preserved.

#### Step 3.2: Create `ast-edit/language-analysis.ts`

Extract and **deduplicate** `detectLanguage` and `extractImports`:

```typescript
import { ASTConfig } from './ast-config.js';
import { KEYWORDS, REGEX } from './constants.js';
import type { Import } from './types.js';
import * as path from 'path';

export function detectLanguage(filePath: string): string {
  const extension = path.extname(filePath).substring(1);
  return (
    ASTConfig.SUPPORTED_LANGUAGES[
      extension as keyof typeof ASTConfig.SUPPORTED_LANGUAGES
    ] || 'unknown'
  );
}

export function extractImports(content: string, language: string): Import[] {
  // Single implementation replacing:
  // - CrossFileRelationshipAnalyzer.extractImports (L899–928)
  // - ASTContextCollector.extractImports (L1285–1314)
  // - CrossFileRelationshipAnalyzer.extractImportModule (L930–933)
  // - CrossFileRelationshipAnalyzer.extractImportItems (L935–941)
  // - ASTContextCollector.extractImportModule (L1380–1383)
  // - ASTContextCollector.extractImportItems (L1385–1391)
  ...
}
```

#### Step 3.3: Create `packages/core/src/tools/__tests__/ast-config.test.ts`

Tests for `ASTConfig.ENABLE_SYMBOL_INDEXING` env var behavior. Import directly from `'../ast-edit/ast-config.js'`.

#### Step 3.4: Create `packages/core/src/tools/__tests__/language-analysis.test.ts`

Tests for shared `detectLanguage` and `extractImports`. Import directly from `'../ast-edit/language-analysis.js'`.

#### Step 3.5: Update `ast-edit.ts` — remove extracted code, import from submodules

**Annotation preservation check:** Verify all `[CCR]` annotations that were on `ASTConfig` methods are present in `ast-config.ts`.

#### Step 3.6: Verify

All tests pass, including characterization tests and LSP integration tests.

---

### Phase 4: Extract AST Context Subsystem (one or two modules per step)

**Goal:** Extract the context-gathering classes from `ast-edit.ts`. Each step extracts ONE class, verifies GREEN after each.

#### Step 4.1: Extract `ast-edit/ast-query-extractor.ts`

Move `ASTQueryExtractor` class (L267–479).

Imports needed:
- `@ast-grep/napi` (`parse`, `Lang`)
- `../utils/ast-grep-utils.js` (`LANGUAGE_MAP`, `JAVASCRIPT_FAMILY_EXTENSIONS`)
- `./types.js` (interfaces)
- `./constants.js` (`KEYWORDS`, `COMMENT_PREFIXES`)

Create `__tests__/ast-query-extractor.test.ts`: Relocate the "AST extraction logic" tests (ast-edit.test.ts L83–132). Import `ASTQueryExtractor` directly from `'../ast-edit/ast-query-extractor.js'` instead of cast-based access. Regenerate snapshots with `--update` and **manually diff** old vs new snapshot files line-by-line to verify semantic identity.

**Annotation preservation check:** No `@plan`, `@requirement`, or `[CCR]` annotations exist in L267–479. Verify `@license` header is added to the new file.

Verify: `ast-query-extractor.test.ts` passes. All other tests pass. **LSP integration tests pass.**

#### Step 4.2: Extract `ast-edit/repository-context-provider.ts`

Move `RepositoryContextProvider` class (L547–665).

Imports needed:
- `child_process` (`spawnSync`)
- `fs` (`promises as fsPromises`)
- `path`
- `./types.js` (`RepositoryContext`)

Create `__tests__/repository-context-provider.test.ts`:
- `should return null when not in a git repo` (mock spawnSync)
- `should return RepositoryContext with all fields populated`
- `should return absolute paths from getWorkingSetFiles`
- `should filter out deleted files in getWorkingSetFiles`

**Annotation preservation check:** No `@plan`, `@requirement`, or `[CCR]` annotations exist in L547–665. Verify `@license` header is added.

Verify: All tests pass. **LSP integration tests pass.**

#### Step 4.3: Extract `ast-edit/cross-file-analyzer.ts`

Move `CrossFileRelationshipAnalyzer` class (L668–989) **AND `getWorkspaceFiles`** (L1521–1536).

**Key changes:**
- Remove private `extractImports`, `extractImportModule`, `extractImportItems`, and `detectLanguage` methods. Import shared versions from `./language-analysis.js` instead.
- Add `getWorkspaceFiles` as a standalone exported function in this module (file discovery for symbol indexing belongs here — see "workspace-context-provider.ts boundary clarification" above).

Imports needed:
- `@ast-grep/napi` (`parse`, `Lang`, `findInFiles`)
- `../utils/ast-grep-utils.js` (`LANGUAGE_MAP`, `JAVASCRIPT_FAMILY_EXTENSIONS`)
- `path`, `fs`, `fast-glob`
- `./types.js`, `./ast-config.js`, `./ast-query-extractor.js`
- `./language-analysis.js` (`extractImports`, `detectLanguage`)

Create `__tests__/cross-file-analyzer.test.ts`:
- `should extract imports from TypeScript content`
- `should extract imports from Python content`
- `should return empty array when workspace exceeds MAX_WORKSPACE_FILES`
- `should not call buildSymbolIndex when ENABLE_SYMBOL_INDEXING is false`

**Annotation preservation check:** Verify `[CCR]` annotations on `buildSymbolIndex` (L672–673), `findRelatedSymbols` (L731–733), the workspace size guard (L801–802), and `getWorkspaceFiles` are preserved.

Verify: All tests pass. **LSP integration tests pass.**

**[CHECKPOINT] Phase 4.3 — verify all tests pass, DRY resolved, getWorkspaceFiles placed correctly**
Submit to `deepthinker` for review: all modules created so far, dependency graph, DRY elimination of `extractImports`/`detectLanguage`, placement of `getWorkspaceFiles` in `cross-file-analyzer.ts`, and verification that no behavioral changes occurred.

#### Step 4.4: Extract `ast-edit/context-optimizer.ts`

Move `ContextOptimizer` class (L992–1079).

Imports needed:
- `./types.js` (`CodeSnippet`)
- `./ast-config.js` (`ASTConfig`)

**Annotation preservation check:** No `@plan`, `@requirement`, or `[CCR]` annotations exist in L992–1079.

Verify: All tests pass.

#### Step 4.5: Extract `ast-edit/local-context-analyzer.ts`

Extract the following methods from `ASTContextCollector` into standalone functions or a class:

- `parseAST` (L1253–1263)
- `extractASTNodes` (L1265–1283)
- `collectSnippets` (L1316–1340)
- `buildLanguageContext` (L1342–1351)
- `isSignificantLine` (L1354–1363)
- `inferNodeType` (L1365–1378)
- `calculateRelevance` (L1393–1401)
- `extractFunctions` (L1403–1441)
- `extractClasses` (L1443–1463)
- `extractVariables` (L1465–1484)
- `optimizeContextCollection` (L1488–1519)

This module uses shared `extractImports` from `./language-analysis.js`.

Imports needed:
- `./types.js` (all relevant interfaces)
- `./constants.js` (`KEYWORDS`, `COMMENT_PREFIXES`)
- `./ast-config.js` (`ASTConfig`)
- `./context-optimizer.js` (`ContextOptimizer`)
- `./language-analysis.js` (`extractImports`)

**Annotation preservation check:** No `@plan`, `@requirement`, or `[CCR]` annotations exist in these methods. Verify `@license` header is added.

Verify: All tests pass. **LSP integration tests pass.**

#### Step 4.6: Extract `ast-edit/workspace-context-provider.ts`

Extract working-set enrichment logic from `ASTContextCollector`:

- Working-set-file enrichment loop from `collectEnhancedContext` (L1146–1168) — extracted as `enrichWithWorkingSetContext(targetFilePath, workspaceRoot, repoProvider, astExtractor): Promise<ConnectedFile[]>`

**NOTE: `getWorkspaceFiles` is NOT in this module** — it was placed in `cross-file-analyzer.ts` (Step 4.3) where it belongs.

Imports needed:
- `fs` (`promises`)
- `./types.js`
- `./ast-query-extractor.js` (`ASTQueryExtractor`)
- `./repository-context-provider.js` (`RepositoryContextProvider`)

**Annotation preservation check:** No annotations exist in L1146–1168.

Verify: All tests pass. **LSP integration tests pass.**

#### Step 4.7: Extract `ast-edit/context-collector.ts` (orchestration only)

What remains in `ASTContextCollector` after extracting local analysis and workspace enrichment:

- Constructor (creates `ASTQueryExtractor`, `RepositoryContextProvider`, `CrossFileRelationshipAnalyzer`)
- `collectContext(filePath, content)` — delegates to `LocalContextAnalyzer` + `ASTQueryExtractor`
- `collectEnhancedContext(targetFilePath, content, workspaceRoot)` — orchestrates all subsystems

`prioritizeSymbolsFromDeclarations` is extracted as a **module-private exported-for-tests pure function**:

```typescript
/** @internal Exported for testing only. Not part of public API. */
export function prioritizeSymbolsFromDeclarations(
  declarations: EnhancedDeclaration[],
): string[] {
  // ... exact same logic from L1222-1241
}
```

Create `__tests__/context-collector.test.ts`:
- **Deterministic prioritization tests:** Import `prioritizeSymbolsFromDeclarations` directly. Test with controlled `EnhancedDeclaration[]` input (classes rank above functions, short names excluded, public visibility boosted). See "Prioritization Testing" section above for exact test cases.
- The `buildSymbolIndex` test becomes: instantiate `ASTContextCollector`, call `collectEnhancedContext`, verify that given `ENABLE_SYMBOL_INDEXING=false` the behavior is correct (no symbol index built).

**Annotation preservation check:** Verify the `[CCR]` annotation on `prioritizeSymbolsFromDeclarations` (L1219–1220) is preserved. Verify the `[CCR]` annotation on the cross-file relationship analysis segment (L1175–1176) is preserved in the orchestration code.

Target: ~150 lines of orchestration, no local analysis helpers.

Verify: All tests pass. **LSP integration tests pass.** Characterization tests pass.

**[GATE 2 REVIEW] Phase 4 Complete — deepthinker reviews all extraction (Phases 1-4)**
Submit to `deepthinker` for review: complete context subsystem extraction, dependency graph of all `ast-edit/` modules, the `prioritizeSymbolsFromDeclarations` extraction and its deterministic tests, placement of `getWorkspaceFiles` in `cross-file-analyzer.ts`, and full test results.

---

### Phase 5: Extract Invocation Classes (one or two modules per step)

**Goal:** Extract the edit/read invocation logic. Each step extracts one module, verifies GREEN after each. **LSP integration tests must pass after EVERY step** — they are the critical regression canary for invocation-related extraction.

#### Step 5.1: Extract `ast-edit/edit-helpers.ts`

Extract `ASTEditTool.applyReplacement` (L1547–1565) as a standalone function:

```typescript
export function applyReplacement(
  currentContent: string | null,
  oldString: string,
  newString: string,
  isNewFile: boolean,
): string { ... }
```

`ASTEditTool` retains `static applyReplacement = applyReplacement` (preserving the static API for `getModifyContext`). `ASTEditToolInvocation` imports from `edit-helpers.js` directly, **not from `ast-edit.ts`** — this breaks the circular dependency.

**Annotation preservation check:** No annotations exist on `applyReplacement` (L1547–1565).

Verify: All tests pass. **LSP integration tests pass.** `getModifyContext` characterization test passes (verifies delegation still works).

#### Step 5.2: Extract `ast-edit/edit-calculator.ts`

Extract edit computation logic from `ASTEditToolInvocation`:

- `CalculatedEdit` interface (L2482–2491) — lives here, not in types.ts
- `calculateEdit(params, config, abortSignal)` (L2141–2261) — becomes a standalone function
- `countOccurrences(content, searchString)` (L2263–2269)
- `validateASTSyntax(filePath, content)` (L2284–2304)
- `getFileLastModified(filePath)` (L2306–2315)

These are **edit computation concerns**, not invocation lifecycle concerns. The invocation class calls `calculateEdit(...)` rather than having it as a method.

Imports needed:
- `./types.js` (`ASTEditToolParams`)
- `./edit-helpers.js` (`applyReplacement`)
- `../tool-error.js` (`ToolErrorType`)
- `../../utils/errors.js` (`isNodeError`)
- `../../utils/ast-grep-utils.js` (`LANGUAGE_MAP`)
- `@ast-grep/napi` (`parse`)
- `../../config/config.js` (`Config`)
- `fs`, `path`

**Annotation preservation check:** No `@plan`, `@requirement`, or `[CCR]` annotations exist in L2141–2315 or L2482–2491.

Verify: All tests pass. **LSP integration tests pass.** Characterization tests pass.

**[CHECKPOINT] Phase 5.2 — verify edit-helpers + edit-calculator extraction, LSP tests pass**
Submit to `deepthinker` for review: `edit-helpers.ts`, `edit-calculator.ts`, the `CalculatedEdit` interface placement, and verification that the `applyReplacement` static delegation works correctly.

#### Step 5.3: Extract `ast-edit/ast-edit-invocation.ts`

Move `ASTEditToolInvocation` class (L1778–2325) **minus** the methods extracted to `edit-calculator.ts`.

Remaining methods:
- `shouldConfirmExecute(abortSignal)` — confirmation logic
- `getDescription()` — human-readable description
- `execute(signal, ...)` — dispatch to preview or apply
- `executePreview(signal)` — rich preview with context enrichment
- `executeApply(signal)` — file write with LSP diagnostics

The `executePreview` and `executeApply` methods call into `edit-calculator.ts` for computation and `ensure-dirs.ts` for directory creation.

Imports needed:
- `./types.js`, `./edit-calculator.js`, `./edit-helpers.js`
- `./context-collector.js` (`ASTContextCollector`)
- `./ast-config.js` (`ASTConfig`)
- `../ensure-dirs.js` (`ensureParentDirectoriesExist`)
- `../tools.js` (base types)
- `../tool-error.js` (`ToolErrorType`)
- `../diffOptions.js` (`DEFAULT_CREATE_PATCH_OPTIONS`)
- `../lsp-diagnostics-helper.js` (`collectLspDiagnosticsBlock`)
- `../../config/config.js` (`Config`, `ApprovalMode`)
- `../../utils/paths.js` (`makeRelative`, `shortenPath`)
- `../../utils/errors.js` (`isNodeError`)
- `diff`, `path`, `fs`

**Annotation preservation check:** Verify `@plan PLAN-20250212-LSP.P31` and `@requirement REQ-DIAG-010` (L2108–2109) move with `executeApply`. Verify the `[CCR]` comment on the LSP try/catch (L2120) is preserved.

Create/update `__tests__/ast-edit-invocation.test.ts`: Relocate preview test (L53–81) and freshness check (L134–175). These continue using `(tool as unknown as { createInvocation: ... }).createInvocation(...)` because the invocation class is instantiated via the tool's protected `createInvocation`.

Verify: All tests pass. **LSP integration tests pass.** Characterization tests pass.

#### Step 5.4: Extract `ast-edit/ast-read-file-invocation.ts`

Move `ASTReadFileToolInvocation` class (L2327–2480).

Imports needed:
- `./types.js`
- `./context-collector.js` (`ASTContextCollector`)
- `./ast-config.js` (`ASTConfig`)
- `../tools.js` (base types)
- `../tool-error.js` (`ToolErrorType`)
- `../../config/config.js` (`Config`)
- `../../utils/paths.js` (`makeRelative`, `shortenPath`)
- `../../utils/errors.js` (`isNodeError`)
- `path`

**Annotation preservation check:** No `@plan`, `@requirement`, or `[CCR]` annotations exist in L2327–2480. Verify `@license` header is added.

Create `__tests__/ast-read-file-invocation.test.ts`:
- `should map ENOENT to FILE_NOT_FOUND error type`
- `should map EACCES to PERMISSION_DENIED error type`
- `should map EISDIR to TARGET_IS_DIRECTORY error type`
- `should map EMFILE to READ_CONTENT_FAILURE error type` (L2457–2461)
- `should map ENFILE to READ_CONTENT_FAILURE error type` (L2457–2461)
- `should map unknown non-NodeError to UNKNOWN error type`
- `should slice lines correctly with offset and limit`
- `should handle offset beyond file length gracefully`
- `should return correct metadata shape on success` (L2432–2439: content, fileName, filePath, metadata.language, metadata.declarationsCount)

Verify: All tests pass. **LSP integration tests pass.** Characterization tests pass.

**[CHECKPOINT] Phase 5.4 — verify all invocation extraction, LSP tests pass**
Submit to `deepthinker` for review: complete invocation extraction, all test files, dependency graph, and full test results including LSP integration.

---

### Phase 6: Slim `ast-edit.ts` to Thin Shell

#### Step 6.1: Remove all extracted code

`ast-edit.ts` now contains only:
- `ASTEditTool` class definition (tool schema, `createInvocation`, `getModifyContext`, `validateToolParamValues`, `static applyReplacement`)
- `ASTReadFileTool` class definition (tool schema, `createInvocation`, `validateToolParamValues`)
- Re-exports of: `EnhancedDeclaration`, `ASTEditToolParams`, `ASTReadFileToolParams`, `KEYWORDS`, `COMMENT_PREFIXES`, `REGEX`
- Pass-through re-exports of: `LANGUAGE_MAP`, `JAVASCRIPT_FAMILY_EXTENSIONS` (from `../utils/ast-grep-utils.js`)
- Imports from the new submodules

Both tool classes retain their `private contextCollector: ASTContextCollector` property.

**Protected `createInvocation` wiring preserved:**
- `ASTEditTool.createInvocation` (L1640–1648) instantiates `ASTEditToolInvocation` — unchanged
- `ASTReadFileTool.createInvocation` (L1766–1774) instantiates `ASTReadFileToolInvocation` — unchanged

**Annotation preservation check (FINAL):** Verify the following are preserved in their correct final locations across all modules:
- `@license` headers — every new `ast-edit/*.ts` file must have the license block
- `@plan PLAN-20260211-ASTGREP.P03` (L44 of original) — stays in `ast-edit.ts` (it annotates the `@ast-grep/napi` import)
- `@plan PLAN-20250212-LSP.P31` and `@requirement REQ-DIAG-010` (L2108–2109) — in `ast-edit-invocation.ts` with `executeApply`
- All `[CCR]` annotations — in their respective extracted modules:
  - `ENABLE_SYMBOL_INDEXING` CCR → `ast-config.ts`
  - `MAX_WORKSPACE_FILES` CCR → `ast-config.ts`
  - `buildSymbolIndex` CCR → `cross-file-analyzer.ts`
  - `findRelatedSymbols` CCR → `cross-file-analyzer.ts`
  - Workspace size guard CCR → `cross-file-analyzer.ts`
  - `prioritizeSymbolsFromDeclarations` CCR → `context-collector.ts`
  - Cross-file relationship analysis segment CCR → `context-collector.ts`
  - REQ-GRACE-050/055 comment → `ast-edit-invocation.ts`

Target: ~200 lines.

#### Step 6.2: Verify all import paths

All three import consumers verified via grep (see "Import Consumers" section):
- `config.ts` imports `ASTEditTool` and `ASTReadFileTool` from `'../tools/ast-edit.js'` — works via direct export
- `ast-edit.test.ts` imports `ASTEditTool`, `ASTReadFileTool`, `EnhancedDeclaration` from `'./ast-edit.js'` — works via re-exports
- `ast-edit-lsp-integration.test.ts` imports `ASTEditTool` from `'../ast-edit.js'` — works via direct export

#### Step 6.3: Verify export contract, exhaustive export surface, and dependency direction

Run `ast-edit.test.ts` — the export-contract test now verifies all exports remain available. The **exhaustive export-surface test** verifies `Object.keys(AstEditModule).sort()` matches the expected list exactly — no exports lost, no unexpected exports added. The dependency-direction test now scans all `ast-edit/*.ts` files and verifies:
1. None import from `../ast-edit.js` (upward dependency check)
2. No import cycles exist among sibling modules (three-color DFS cycle detection)

#### Step 6.4: Full verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

All must pass.

---

### Phase 7: Final Quality Pass

#### Step 7.1: Review test coverage

| Module | Test Source | Coverage Type |
|---|---|---|
| `types.ts` | N/A | Pure types — no runtime behavior |
| `constants.ts` | N/A | Pure constants — no runtime behavior |
| `ast-config.ts` | `ast-config.test.ts` | New behavioral tests |
| `ast-query-extractor.ts` | `ast-query-extractor.test.ts` | Relocated tests + manually verified snapshots |
| `repository-context-provider.ts` | `repository-context-provider.test.ts` | New behavioral tests |
| `cross-file-analyzer.ts` | `cross-file-analyzer.test.ts` | New behavioral tests |
| `context-optimizer.ts` | Transitive via context-collector | Covered by orchestration tests |
| `language-analysis.ts` | `language-analysis.test.ts` | New behavioral tests (DRY extraction) |
| `local-context-analyzer.ts` | Transitive via context-collector | Covered by orchestration tests |
| `workspace-context-provider.ts` | Transitive via context-collector | Covered by orchestration tests |
| `context-collector.ts` | `context-collector.test.ts` + characterization | Deterministic prioritization + orchestration |
| `edit-helpers.ts` | Transitive via invocation + tool tests + export contract | Static method delegation verified |
| `edit-calculator.ts` | `calculate-edit-characterization.test.ts` + invocation + LSP | Characterization + invocation + LSP integration |
| `ast-edit-invocation.ts` | `ast-edit-invocation.test.ts` + `ast-edit-characterization.test.ts` + LSP | Relocated + characterization + LSP integration |
| `ast-read-file-invocation.ts` | `ast-read-file-invocation.test.ts` + characterization | New behavioral (EMFILE/ENFILE, metadata shape, error mapping) |
| `ensure-dirs.ts` | `ensure-dirs.test.ts` | Genuine RED-GREEN TDD |
| **Schema stability** | `ast-edit-characterization.test.ts` | Pinned required/optional params, types, descriptions for both tools |
| **`validateToolParamValues`** | `ast-edit-characterization.test.ts` | Empty, relative, outside-workspace rejection for both tools |
| **`getModifyContext`** | `ast-edit-characterization.test.ts` | All four ModifyContext methods pinned |

#### Step 7.2: Verify no behavioral changes

- Snapshot tests for AST extraction produce identical output (regenerated in new location, **manually verified** against original)
- LSP integration tests pass UNCHANGED
- Freshness check behavior identical
- Preview and apply flows identical (pinned by consistency characterization test)
- Error mapping in read tool identical (including EMFILE/ENFILE → READ_CONTENT_FAILURE)
- Empty-existing-file vs nonexistent-file behavior unchanged (pinned by characterization tests)
- All characterization tests still pass
- `ASTEditTool.applyReplacement` static method still available (pinned by export contract test)
- **Exhaustive export surface unchanged** — `Object.keys()` test confirms no exports lost or added
- **Schema stability unchanged** — both tools' required params, optional params, types, and descriptions match expected values
- **`validateToolParamValues` behavior unchanged** — both tools reject empty, relative, and out-of-workspace paths
- **`getModifyContext` behavior unchanged** — all four methods behave correctly, `getProposedContent` delegates through `applyReplacement`
- **All annotations preserved** — `@plan`, `@requirement`, `[CCR]`, `@license` headers verified in final locations

---

## Subagent Coordination

### Implementation: `typescriptexpert`

Responsible for all code changes. Each phase is a separate delegation with explicit review gates (see below).

### Review: `deepthinker`

Reviews after each major phase for SoC adherence, DRY compliance, import path stability, behavioral fidelity, and test adequacy. Reviews are always conducted as clean, first-time reviews — no references to prior review iterations, no "REVISED" labels, no hints toward rubber-stamping.

### Phase Review Gates

Each phase delegation to `typescriptexpert` must include review artifacts and explicit criteria:

| Gate | Description |
|---|---|
| **Files to create/edit** | Exact list of files created, modified, or deleted |
| **Tests expected to fail** | Which test files should fail before production code changes |
| **Tests expected to pass** | Which test files should pass after production code changes |
| **Forbidden behavior changes** | Explicit list: no tool schema changes, no createInvocation signature changes, no import path breaks for external consumers |
| **Annotation preservation** | Explicit checklist of `@plan`, `@requirement`, `[CCR]`, and `@license` annotations that must be verified after each phase |
| **Rollback criteria** | If any of the following occur, revert the phase: (1) existing tests break, (2) smoke test fails, (3) LSP integration tests break, (4) import consumers break |

### Detailed Phase Gates with Review Artifacts

#### Phase 0 Gate
- **Create:** `__tests__/ast-edit-characterization.test.ts`, `__tests__/calculate-edit-characterization.test.ts`, `__tests__/ensure-dirs.test.ts`
- **Edit:** `ast-edit.test.ts` (add exhaustive export-surface, dependency-direction, and structural guard tests)
- **Fail:** `ensure-dirs.test.ts` only (import error — TRUE RED)
- **Pass:** All characterization tests (including schema stability, validateToolParamValues, getModifyContext), `ast-edit.test.ts`, `ast-edit-lsp-integration.test.ts`
- **Forbidden:** No production code changes
- **Rollback:** If existing tests break
- **Review artifacts:** List of all characterization test names and what behavior each locks down; diff of changes to `ast-edit.test.ts`; confirmation that structural guard tests are labeled correctly (not claimed as RED)
- **[GATE 1] deepthinker review required**

#### Phase 1 Gate
- **Create:** `ensure-dirs.ts`
- **Edit:** `edit.ts` (import shared utility, remove private method)
- **Pass:** All tests including `ensure-dirs.test.ts` + all edit.ts tests
- **Forbidden:** No changes to EditToolInvocation behavior
- **Rollback:** If edit.ts tests fail
- **Review artifacts:** Diff of `edit.ts` changes; `ensure-dirs.ts` full content; test run output

#### Phase 2 Gate
- **Create:** `ast-edit/types.ts`, `ast-edit/constants.ts`
- **Edit:** `ast-edit.ts` (add re-exports, remove extracted types/constants)
- **Pass:** All existing tests + characterization tests + exhaustive export-surface test
- **Forbidden:** No changes to any class's public method signatures
- **Annotation check:** `@license` headers on new files; JSDoc comments preserved
- **Rollback:** If `npm run typecheck` fails
- **Review artifacts:** Full content of `types.ts` and `constants.ts`; `ast-edit.ts` diff; exported symbol list verification
- Covered by Gate 2 review (no standalone review needed)

#### Phase 3 Gate
- **Create:** `ast-edit/ast-config.ts`, `ast-edit/language-analysis.ts`, `__tests__/ast-config.test.ts`, `__tests__/language-analysis.test.ts`
- **Edit:** `ast-edit.ts` (remove extracted code, import from submodules)
- **Pass:** All tests including new test files
- **Forbidden:** No changes to `ASTConfig` static properties or `detectLanguage`/`extractImports` behavior
- **Annotation check:** `[CCR]` annotations on `ENABLE_SYMBOL_INDEXING` and `MAX_WORKSPACE_FILES` preserved
- **Rollback:** If any test fails
- **Review artifacts:** Full content of new files; dependency graph showing no cycles; test run output

#### Phase 4 Gate (per-step verification required)
After EACH step (4.1 through 4.7):
- **Pass:** ALL tests including `ast-edit-lsp-integration.test.ts` and characterization tests
- **Forbidden:** No changes to `ASTContextCollector` public API (`collectContext`, `collectEnhancedContext`); `prioritizeSymbolsFromDeclarations` must be exported as `@internal` for testing only, not added to the `ast-edit.ts` re-export contract
- **Annotation check:** All `[CCR]`, `@plan`, `@requirement` annotations in moved code are preserved
- **Rollback:** If any test fails at any step, revert that step

After Phase 4.3:
- Checkpoint only (no standalone review)
- **Extra review:** Confirm `getWorkspaceFiles` is in `cross-file-analyzer.ts`, NOT `workspace-context-provider.ts`

After Phase 4.7:
- **Created:** `ast-edit/ast-query-extractor.ts`, `ast-edit/repository-context-provider.ts`, `ast-edit/cross-file-analyzer.ts`, `ast-edit/context-optimizer.ts`, `ast-edit/local-context-analyzer.ts`, `ast-edit/workspace-context-provider.ts`, `ast-edit/context-collector.ts`
- **Created tests:** `__tests__/ast-query-extractor.test.ts`, `__tests__/repository-context-provider.test.ts`, `__tests__/cross-file-analyzer.test.ts`, `__tests__/context-collector.test.ts`
- **Review artifacts:** Dependency graph of all `ast-edit/` modules; list of public exports per module; diff scope; all test run outputs; known failures (should be zero)
- **[GATE 2] deepthinker review required — covers all of Phases 1-4**

#### Phase 5 Gate (per-step verification required — LSP is critical canary)
After EACH step (5.1 through 5.4):
- **Pass:** ALL tests including `ast-edit-lsp-integration.test.ts` and characterization tests
- **Forbidden:** No changes to `createInvocation` wiring in either tool class; no changes to `ASTEditTool.applyReplacement` static interface
- **Annotation check:** `@plan PLAN-20250212-LSP.P31`, `@requirement REQ-DIAG-010`, REQ-GRACE-050/055 comments preserved in `ast-edit-invocation.ts`
- **Rollback:** If LSP integration tests fail at any step

After Phase 5.2:
- Checkpoint only (no standalone review)

After Phase 5.4:
- **Created:** `ast-edit/edit-helpers.ts`, `ast-edit/edit-calculator.ts`, `ast-edit/ast-edit-invocation.ts`, `ast-edit/ast-read-file-invocation.ts`
- **Created tests:** `__tests__/ast-edit-invocation.test.ts`, `__tests__/ast-read-file-invocation.test.ts`
- **Review artifacts:** Dependency graph; `CalculatedEdit` interface location confirmation; diff scope; test outputs; verification that no `ast-edit/` file imports from `../ast-edit.js`
- Covered by Gate 3 review

#### Phase 6 Gate
- **Edit:** `ast-edit.ts` (final slim-down)
- **Pass:** ALL tests, full verification suite (`npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`)
- **Forbidden:** No new exports, no removed exports
- **Annotation check (FINAL):** Complete annotation preservation checklist verified (see Step 6.1)
- **Rollback:** If any test fails or smoke test fails
- **Review artifacts:** Final `ast-edit.ts` content (~200 lines); complete exported symbol list; dependency direction test passing; exhaustive export-surface test passing; full verification output

#### Phase 7 Gate (FINAL)
- **Pass:** `deepthinker` review approval
- **Rollback:** If reviewer finds behavioral changes
- **Review artifacts:** Complete diff of all changes from Phase 0 through Phase 6; all test files with pass/fail status; dependency graph of final module structure; exported symbols before/after comparison; annotation preservation checklist
- **[GATE 3] deepthinker final review required**

### Review Gate Summary (Consolidated — 3 Gates)

| Gate | After | Scope |
|---|---|---|
| **Gate 1** | Phase 0 | Test safety net complete: all characterization tests pass, ensure-dirs RED, export-surface exact, schema stability, shouldConfirmExecute, `$` replacement, countOccurrences, diff labels, validateToolParamValues, getModifyContext, cycle detection, empty-file edge cases |
| **Gate 2** | Phase 4 | All context subsystem extraction complete (Phases 1–4): ensure-dirs GREEN, types/constants/config/language-analysis extracted, all 7 context modules extracted, DRY violations resolved, dependency graph is DAG, all tests green including LSP integration, annotation preservation verified |
| **Gate 3** | Phase 7 | Full decomposition complete (Phases 5–7): invocation extraction, thin shell, final quality pass, full verification suite green, behavioral equivalence confirmed, complete diff review |

### Execution Order

```
Phase 0 → typescriptexpert (characterization tests + ensure-dirs RED + export-surface + schema + shouldConfirmExecute + $ replacement + countOccurrences + diff labels + validateToolParamValues + getModifyContext)
        → verify characterization PASS, ensure-dirs FAIL
        → [GATE 1 REVIEW] deepthinker review
Phase 1 → typescriptexpert (ensure-dirs GREEN + edit.ts DRY)
        → verify all tests pass
Phase 2 → typescriptexpert (types + constants extraction)
        → verify all tests pass
Phase 3 → typescriptexpert (ast-config + language-analysis)
        → verify all tests pass
Phase 4 → typescriptexpert (context subsystem -- one class per step, verify GREEN after each)
        → annotation preservation check after each step
        → verify all tests pass including LSP integration after EVERY step
        → [GATE 2 REVIEW] deepthinker review of complete Phases 1-4
Phase 5 → typescriptexpert (invocation + edit-calculator -- one module per step, verify GREEN after each)
        → annotation preservation check after each step
        → verify all tests pass including LSP integration after EVERY step
Phase 6 → typescriptexpert (slim ast-edit.ts shell)
        → FINAL annotation preservation checklist
        → full verification suite
Phase 7 → typescriptexpert (final quality pass)
        → full verification suite
        → [GATE 3 REVIEW] deepthinker final review
        → typescriptexpert remediation if needed
        → full verification suite
```



## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Circular imports between ast-edit.ts and invocation | Extract `applyReplacement` to `edit-helpers.ts`; invocation imports from there, not from `ast-edit.ts`. Blanket rule: no submodule imports from parent. |
| Import cycles among sibling submodules | Cycle detection test in `ast-edit.test.ts` uses standard three-color DFS (WHITE/GRAY/BLACK) — a single traversal correctly detects cycles across all components. Regex limitation: won't catch dynamic imports or multiline imports (acceptable for this codebase). |
| Test snapshots break on relocation | Use same `describe`/`it` names, regenerate with `--update`, **manually verify** old vs new snapshots are semantically identical |
| ESM import path resolution | All new imports use `.js` extensions per existing codebase pattern |
| `edit.ts` regression from DRY extraction | Run edit.ts test suite after importing from `ensure-dirs.ts` |
| Behavioral regression during extraction | Characterization tests written FIRST (Phase 0) catch any regression. LSP integration tests run after every invocation-related step. Preview/apply consistency test pins dual-path behavior. |
| Accidental unification of `applyReplacement` between edit.ts and ast-edit.ts | Explicit warning in plan, code comments in `edit-helpers.ts`, and fact that they have different signatures (ast-edit's has no `expectedReplacements` param) |
| Empty-file vs nonexistent-file behavioral divergence masked by refactoring | Explicit characterization tests in Phase 0 pin the divergent behavior between preview and apply paths |
| `prioritizeSymbolsFromDeclarations` flaky testing | Replaced indirect testing via `collectEnhancedContext` with deterministic pure-function unit tests using controlled input data |
| `workspace-context-provider.ts` scope creep | `getWorkspaceFiles` moved to `cross-file-analyzer.ts` where it belongs; `workspace-context-provider.ts` has single responsibility (working-set enrichment only) |
| `types.ts` becoming a catch-all | `CalculatedEdit` kept in `edit-calculator.ts`; `types.ts` only contains context/analysis domain types |
| `local-context-analyzer.ts` remaining a mini-god-module | Acknowledged as intermediate boundary; future split into `local-ast-analysis.ts`, `language-context-builder.ts`, `snippet-collector.ts` documented |
| Export surface inadvertently changed during extraction | Exhaustive export-surface test compares `Object.keys(module).sort()` to expected list — catches both lost and added exports |
| Tool schema changes during extraction | Schema stability tests pin required params, optional params, types, defaults, and descriptions for both tools |
| `validateToolParamValues` logic broken during shell slimming (Phase 6) | Explicit tests for empty, relative, and out-of-workspace path rejection for both tools |
| `getModifyContext` delegation broken when `applyReplacement` is extracted | Explicit tests pin all four `ModifyContext` methods, including `getProposedContent` which delegates through `applyReplacement` |
| `@plan`/`@requirement`/`[CCR]`/`@license` annotations lost during code moves | Annotation preservation checklist verified at EACH extraction phase, with a FINAL comprehensive check in Phase 6 |
| Submodule test import paths treated as stable API | Explicit warning: these are package-internal convenience paths, not stable API; may change without deprecation |
| `shouldConfirmExecute` behavior regresses during invocation extraction | Characterization tests pin preview bypass, AUTO_EDIT bypass, manual confirmation payload shape, ProceedAlways side effect |
| `$` replacement semantics silently change in extracted `applyReplacement` | Characterization test pins `String.replace()` special `$&` behavior |
| `countOccurrences` boolean-ish 0/1 return changed to actual count | Characterization test pins `includes ? 1 : 0` semantics |
| Diff labels (`Proposed`/`Applied`) accidentally normalized during extraction | Characterization tests pin all three label values (preview, apply, confirmation) |


## Line Count Estimates

| File | Estimated Lines | Source |
|---|---|---|
| `ast-edit.ts` (thin shell) | ~200 | Remaining tool classes + re-exports |
| `types.ts` | ~150 | 19 interfaces |
| `constants.ts` | ~30 | 3 constants |
| `ast-config.ts` | ~70 | ASTConfig class |
| `ast-query-extractor.ts` | ~220 | L267–479 |
| `repository-context-provider.ts` | ~120 | L547–665 |
| `cross-file-analyzer.ts` | ~350 | L668–989 + getWorkspaceFiles (L1521–1536) minus shared functions |
| `context-optimizer.ts` | ~90 | L992–1079 |
| `language-analysis.ts` | ~60 | Deduplicated shared functions |
| `local-context-analyzer.ts` | ~250 | Extracted from L1253–1519 |
| `workspace-context-provider.ts` | ~60 | Extracted from L1146–1168 only (enrichWithWorkingSetContext) |
| `context-collector.ts` | ~150 | Orchestration only + prioritizeSymbolsFromDeclarations |
| `edit-helpers.ts` | ~25 | applyReplacement standalone |
| `edit-calculator.ts` | ~200 | L2141–2315 + CalculatedEdit |
| `ast-edit-invocation.ts` | ~350 | L1778–2140 minus extracted methods |
| `ast-read-file-invocation.ts` | ~160 | L2327–2480 |
| `ensure-dirs.ts` | ~15 | Single function |
| **Total** | **~2,500** | Comparable to original 2,491 |
