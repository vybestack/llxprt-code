# Plan: AST-Grep Tooling

Plan ID: PLAN-20260211-ASTGREP
Generated: 2026-02-11
Total Phases: 12 (P01–P12)
Requirements: REQ-ASTGREP-001 through REQ-ASTGREP-016, REQ-SA-001 through REQ-SA-008, REQ-SA-CALLERS-001 through REQ-SA-CALLERS-006, REQ-SA-CALLEES-001 through REQ-SA-CALLEES-003, REQ-SA-DEFS-001, REQ-SA-HIER-001/002, REQ-SA-REFS-001 through REQ-SA-REFS-003, REQ-SA-DEPS-001/002, REQ-SA-EXPORTS-001, REQ-INFRA-001 through REQ-INFRA-007

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase P01)
2. Verified @ast-grep/napi APIs work as assumed (parse, findInFiles, SgNode)
3. Written tests BEFORE implementation code (test phase precedes impl phase)
4. Verified all imports, types, and dependencies exist as assumed

---

## Requirements Traceability Matrix

| Requirement | Phase (Test) | Phase (Impl) |
|-------------|-------------|--------------|
| REQ-INFRA-001 (napi integration) | — | P03 |
| REQ-INFRA-002 (shared utils) | P02 | P03 |
| REQ-INFRA-003 (graceful degradation) | P11 | P12 |
| REQ-INFRA-004 (tool defaults) | — | P05, P07 |
| REQ-INFRA-005 (no test file dep) | all | all |
| REQ-INFRA-006 (timeouts) | P11 | P12 |
| REQ-INFRA-007 (existing compat) | P11 | P12 |
| REQ-ASTGREP-001 (registration) | P04 | P05 |
| REQ-ASTGREP-002 (pattern search) | P04 | P05 |
| REQ-ASTGREP-003 (rule search) | P04 | P05 |
| REQ-ASTGREP-004 (mutual exclusion) | P04 | P05 |
| REQ-ASTGREP-005 (default path) | P04 | P05 |
| REQ-ASTGREP-006 (workspace boundary) | P04 | P05 |
| REQ-ASTGREP-007 (result format) | P04 | P05 |
| REQ-ASTGREP-008 (result limit) | P04 | P05 |
| REQ-ASTGREP-009 (empty results) | P04 | P05 |
| REQ-ASTGREP-010 (glob filtering) | P04 | P05 |
| REQ-ASTGREP-011 (invalid pattern error) | P04 | P05 |
| REQ-ASTGREP-012 (unavailable engine) | P11 | P12 |
| REQ-ASTGREP-013 (language detect) | P04 | P05 |
| REQ-ASTGREP-014 (tool description) | — | P05 |
| REQ-ASTGREP-015 (cancellation) | P04 | P05 |
| REQ-ASTGREP-016 (per-file errors) | P04 | P05 |
| REQ-SA-001 (registration) | P06 | P07 |
| REQ-SA-002 (mode parameter) | P06 | P07 |
| REQ-SA-003 (language param) | P06 | P07 |
| REQ-SA-004 (tool description) | — | P07 |
| REQ-SA-005 (workspace boundary) | P06 | P07 |
| REQ-SA-006 (cancellation) | P06 | P07 |
| REQ-SA-007 (empty results) | P06 | P07 |
| REQ-SA-008 (path output format) | P06 | P07 |
| REQ-SA-DEFS-001 (definitions) | P06 | P07 |
| REQ-SA-HIER-001 (upward hierarchy) | P06 | P07 |
| REQ-SA-HIER-002 (downward hierarchy) | P06 | P07 |
| REQ-SA-CALLERS-001–006 | P08 | P09 |
| REQ-SA-CALLEES-001–003 | P08 | P09 |
| REQ-SA-REFS-001–003 | P10 | P10 |
| REQ-SA-DEPS-001/002 | P10 | P10 |
| REQ-SA-EXPORTS-001 | P10 | P10 |

---

## Architecture Overview

```
packages/core/src/
├── tools/
│   ├── ast-grep.ts                    # NEW: ast_grep tool
│   ├── ast-grep.test.ts               # NEW: tests
│   ├── structural-analysis.ts         # NEW: structural_analysis tool
│   ├── structural-analysis.test.ts    # NEW: tests
│   ├── ast-edit.ts                    # MODIFY: use shared utils
│   └── tool-names.ts                  # MODIFY: add constants
├── utils/
│   ├── ast-grep-utils.ts             # NEW: shared ast-grep utilities
│   └── ast-grep-utils.test.ts        # NEW: tests
├── config/
│   └── config.ts                      # MODIFY: register new tools
└── prompt-config/
    └── defaults/
        ├── tools/ast-grep.md          # NEW: tool prompt
        ├── tools/structural-analysis.md # NEW: tool prompt
        └── tool-defaults.ts           # MODIFY: add entries
```

Key decisions:
- Use `@ast-grep/napi` (already a dependency) — NOT the `sg` CLI binary
- Extract shared language mapping + parse helpers from `ast-edit.ts` into `ast-grep-utils.ts`
- Both new tools extend `BaseDeclarativeTool` (like RipGrepTool, GrepTool)
- Both tools use `Config` for workspace root and path validation

---

# Phase P01: Preflight Verification

## Phase ID
`PLAN-20260211-ASTGREP.P01`

## Prerequisites
- Branch `issue1130` exists and is clean

## Tasks

### Verify @ast-grep/napi availability and APIs
```bash
npm ls @ast-grep/napi
```

### Verify parse + findAll + getMatch behavior
```bash
node -e "
const { parse, Lang } = require('@ast-grep/napi');
const root = parse(Lang.TypeScript, 'class Foo extends Bar { hello() { this.world(); } }');
const matches = root.root().findAll('\$OBJ.world()');
console.log('matches:', matches.length);
if (matches.length > 0) {
  const m = matches[0];
  console.log('text:', m.text());
  console.log('kind:', m.kind());
  console.log('range:', JSON.stringify(m.range()));
  const env = m.getMatch('OBJ');
  console.log('metavar OBJ:', env ? env.text() : 'null');
}
"
```
Expected: 1 match, text=`this.world()`, kind=`call_expression`, metavar OBJ=`this`

### Verify findInFiles API and callback contract
```bash
node -e "
const { findInFiles, Lang } = require('@ast-grep/napi');
findInFiles({
  paths: ['packages/core/src/config/config.ts'],
  language: Lang.TypeScript,
  matcher: { rule: { kind: 'class_declaration' } }
}, (err, nodes) => {
  // Verify callback shape: err is null on success, nodes is array of SgNode
  console.log('callback err:', err);
  console.log('callback nodes type:', Array.isArray(nodes) ? 'array' : typeof nodes);
  console.log('callback nodes count:', nodes.length);
  if (nodes.length > 0) {
    const n = nodes[0];
    console.log('node has text():', typeof n.text === 'function');
    console.log('node has kind():', typeof n.kind === 'function');
    console.log('node has range():', typeof n.range === 'function');
    console.log('node has getMatch():', typeof n.getMatch === 'function');
  }
  return nodes;
}).then(r => {
  console.log('findInFiles resolved, file count:', r.length);
}).catch(e => console.log('Error:', e.message));
"
```
Expected: callback receives null err, array of SgNode objects with text/kind/range/getMatch methods

### Verify existing exports in ast-edit.ts
```bash
grep -n 'export const LANGUAGE_MAP\|export const JAVASCRIPT_FAMILY' packages/core/src/tools/ast-edit.ts
```

### Verify tool registration pattern
```bash
grep -c 'registerCoreTool' packages/core/src/config/config.ts
```

### Blocking issues
If any check fails, document the issue and stop.

---

# Phase P02: Shared AST Utilities — Tests

## Phase ID
`PLAN-20260211-ASTGREP.P02`

## Prerequisites
- Phase P01 completed

## Requirements Implemented

### REQ-INFRA-002: Shared AST Utilities
**Full Text**: AST operations common to ast_grep, structural_analysis, ast_edit, and ast_read_file shall be factored into a shared utility module.
**Behavior**:
- GIVEN: A test imports `getAstLanguage` from `ast-grep-utils`
- WHEN: Called with extension `'ts'`
- THEN: Returns `Lang.TypeScript`
**Why This Matters**: Single source of truth for language mapping

## Implementation Tasks

### Files to Create
- `packages/core/src/utils/ast-grep-utils.test.ts`
  - MUST include: `@plan PLAN-20260211-ASTGREP.P02`
  - Test: `getAstLanguage('ts')` → `Lang.TypeScript`
  - Test: `getAstLanguage('py')` → `'python'`
  - Test: `getAstLanguage('unknown')` → `undefined`
  - Test: `resolveLanguageFromPath('foo.ts')` → `Lang.TypeScript`
  - Test: `resolveLanguageFromPath('foo.xyz')` → `undefined`
  - Test: `isAstGrepAvailable()` → `true`
  - Test: `parseSource(Lang.TypeScript, 'const x = 1;')` → success
  - Test: `parseSource(Lang.TypeScript, '}{invalid')` → error (not throw)

## Verification
```bash
test -f packages/core/src/utils/ast-grep-utils.test.ts && echo "OK"
npm run typecheck
```

---

# Phase P03: Shared AST Utilities — Implementation

## Phase ID
`PLAN-20260211-ASTGREP.P03`

## Prerequisites
- Phase P02 completed (failing tests exist)

## Requirements Implemented
### REQ-INFRA-001: napi integration, REQ-INFRA-002: shared utils

## Implementation Tasks

### Files to Create
- `packages/core/src/utils/ast-grep-utils.ts`
  - MUST include: `@plan PLAN-20260211-ASTGREP.P03`
  - Extract from ast-edit.ts: `LANGUAGE_MAP`, `JAVASCRIPT_FAMILY_EXTENSIONS`, dynamic language registration
  - New exports: `getAstLanguage()`, `resolveLanguageFromPath()`, `isAstGrepAvailable()`, `parseSource()`

### Files to Modify
- `packages/core/src/tools/ast-edit.ts`
  - Replace local LANGUAGE_MAP, JAVASCRIPT_FAMILY_EXTENSIONS, language registration with imports from `../utils/ast-grep-utils.js`
  - ALL existing behavior unchanged
  - ADD: `@plan PLAN-20260211-ASTGREP.P03`

## Verification
```bash
npm test -- --run packages/core/src/utils/ast-grep-utils.test.ts
npm test -- --run packages/core/src/tools/ast-edit.test.ts
npm run test && npm run typecheck
```

---

# Phase P04: ast_grep Tool — Tests

## Phase ID
`PLAN-20260211-ASTGREP.P04`

## Prerequisites
- Phase P03 completed

## Requirements Implemented
### REQ-ASTGREP-002 through REQ-ASTGREP-016 (test side)

## Implementation Tasks

### Files to Create
- `packages/core/src/tools/ast-grep.test.ts`
  - MUST include: `@plan PLAN-20260211-ASTGREP.P04`
  - Use real temp files, real ast-grep parsing, no mocks of ast-grep

  **REQ-ASTGREP-002**: pattern `$OBJ.foo()` finds `this.foo()`, doesn't find `// foo()` comment
  **REQ-ASTGREP-003**: rule with `kind: call_expression` + `has` finds calls
  **REQ-ASTGREP-004**: both pattern+rule → error; neither → error
  **REQ-ASTGREP-005/006**: no path → workspace root; path outside → error
  **REQ-ASTGREP-007**: result format: file (relative), startLine, startCol, endLine, endCol, text, nodeKind, metaVariables
  **REQ-ASTGREP-008**: maxResults=2 on 5 matches → 2 returned, truncated=true
  **REQ-ASTGREP-009**: no matches → empty array, truncated=false
  **REQ-ASTGREP-011**: unparseable pattern → clear error message
  **REQ-ASTGREP-010**: globs `["*.ts"]` includes only .ts files; globs `["!*.test.ts"]` excludes test files
  **REQ-ASTGREP-013**: single .ts file auto-detects; directory without language → error
  **REQ-ASTGREP-016**: binary file skipped, skippedFiles count

### Files to Modify
- `packages/core/src/tools/tool-names.ts`
  - ADD: `export const AST_GREP_TOOL = 'ast_grep';`
  - ADD to ToolName union type
  - ADD: `@plan PLAN-20260211-ASTGREP.P04`

## Verification
```bash
test -f packages/core/src/tools/ast-grep.test.ts && echo "OK"
grep 'AST_GREP_TOOL' packages/core/src/tools/tool-names.ts
npm run typecheck
```

---

# Phase P05: ast_grep Tool — Implementation

## Phase ID
`PLAN-20260211-ASTGREP.P05`

## Prerequisites
- Phase P04 completed (failing tests)

## Requirements Implemented
### REQ-ASTGREP-001 through REQ-ASTGREP-016 (implementation)

## Implementation Tasks

### Files to Create
- `packages/core/src/tools/ast-grep.ts`
  - MUST include: `@plan PLAN-20260211-ASTGREP.P05`
  - `AstGrepTool` extends `BaseDeclarativeTool<AstGrepToolParams, ToolResult>`
  - Constructor: name `ast_grep`, Kind.Search, JSON schema
  - Execute flow:
    1. Validate exactly one of pattern/rule (REQ-ASTGREP-004)
    2. Resolve path, validate workspace boundary (REQ-ASTGREP-005/006)
    3. Language detection for single files (REQ-ASTGREP-013)
    4. Pattern mode: iterate files, parseSource + root.findAll(pattern)
    5. Rule mode: findInFiles with NapiConfig
    6. Glob filtering via fast-glob (REQ-ASTGREP-010)
    7. Map results: file (relative), line/col, text, nodeKind, metaVariables (REQ-ASTGREP-007)
    8. Apply maxResults, set truncated (REQ-ASTGREP-008)
    9. Per-file error handling: skip unparseable, count skippedFiles (REQ-ASTGREP-016)
    10. AbortSignal check between files (REQ-ASTGREP-015)

- `packages/core/src/prompt-config/defaults/tools/ast-grep.md`
  - Tool description for LLM (REQ-ASTGREP-014)
  - Explain: structural AST search, metavariable syntax, differs from search_file_content

### Files to Modify
- `packages/core/src/config/config.ts`
  - Import and registerCoreTool(AstGrepTool, this)
  - ADD: `@plan PLAN-20260211-ASTGREP.P05`
- `packages/core/src/prompt-config/defaults/tool-defaults.ts`
  - Add: `'tools/ast-grep.md': loadMarkdownFile('tools/ast-grep.md'),`

## Verification
```bash
npm test -- --run packages/core/src/tools/ast-grep.test.ts
npm test -- --run packages/core/src/tools/ast-edit.test.ts
npm run test && npm run typecheck && npm run lint
```

---

# Phase P06: structural_analysis — Definitions + Hierarchy Tests

## Phase ID
`PLAN-20260211-ASTGREP.P06`

## Prerequisites
- Phase P05 completed

## Requirements Implemented
### REQ-SA-001–008, REQ-SA-DEFS-001, REQ-SA-HIER-001/002 (test side)

## Implementation Tasks

### Files to Create
- `packages/core/src/tools/structural-analysis.test.ts`
  - MUST include: `@plan PLAN-20260211-ASTGREP.P06`
  - Real temp files, no mocks

  **REQ-SA-002**: invalid mode → error listing valid modes
  **REQ-SA-003**: missing language → error
  **REQ-SA-005**: path outside workspace → error
  **REQ-SA-007**: nonexistent symbol → empty result
  **REQ-SA-DEFS-001**: find class, function, interface, const by name; multi-file
  **REQ-SA-HIER-001**: class extends → parent found; class implements → interface found
  **REQ-SA-HIER-002**: parent → subclasses; interface → implementors

### Files to Modify
- `packages/core/src/tools/tool-names.ts`
  - ADD: `export const STRUCTURAL_ANALYSIS_TOOL = 'structural_analysis';`
  - ADD to ToolName union
  - ADD: `@plan PLAN-20260211-ASTGREP.P06`

## Verification
```bash
test -f packages/core/src/tools/structural-analysis.test.ts && echo "OK"
grep 'STRUCTURAL_ANALYSIS_TOOL' packages/core/src/tools/tool-names.ts
npm run typecheck
```

---

# Phase P07: structural_analysis — Definitions + Hierarchy Implementation

## Phase ID
`PLAN-20260211-ASTGREP.P07`

## Prerequisites
- Phase P06 completed (failing tests)

## Requirements Implemented
### REQ-SA-001–008, REQ-SA-DEFS-001, REQ-SA-HIER-001/002 (implementation)

## Implementation Tasks

### Files to Create
- `packages/core/src/tools/structural-analysis.ts`
  - MUST include: `@plan PLAN-20260211-ASTGREP.P07`
  - `StructuralAnalysisTool` extends `BaseDeclarativeTool`
  - Schema: mode (enum), language, path, symbol, depth, maxNodes, target, reverse
  - Mode dispatch: definitions → `executeDefinitions()`, hierarchy → `executeHierarchy()`, others → throw "mode not yet available"
  - `executeDefinitions()`: findInFiles with rules for method_definition, function_declaration, class_declaration, interface_declaration, type_alias_declaration, variable_declarator matching symbol
  - `executeHierarchy()`: patterns for extends/implements, reverse search for subclasses
  - Workspace boundary, AbortSignal, relative path output

- `packages/core/src/prompt-config/defaults/tools/structural-analysis.md`
  - Tool description (REQ-SA-004)

### Files to Modify
- `packages/core/src/config/config.ts` — register StructuralAnalysisTool
- `packages/core/src/prompt-config/defaults/tool-defaults.ts` — add entry

## Verification
```bash
npm test -- --run packages/core/src/tools/structural-analysis.test.ts
npm run test && npm run typecheck && npm run lint
```

---

# Phase P08: structural_analysis — Callers + Callees Tests

## Phase ID
`PLAN-20260211-ASTGREP.P08`

## Prerequisites
- Phase P07 completed

## Requirements Implemented
### REQ-SA-CALLERS-001–006, REQ-SA-CALLEES-001–003 (test side)

## Implementation Tasks

### Files to Modify
- `packages/core/src/tools/structural-analysis.test.ts`
  - MUST include: `@plan PLAN-20260211-ASTGREP.P08`
  - Multi-file temp dirs, real TS source

  **Callers**: basic discovery, via context, depth 1 vs 2, cycle detection, maxNodes truncation, member/direct/optional-chaining
  **Callees**: basic discovery, chained dedup, recursive depth

## Verification
```bash
npm test -- --run packages/core/src/tools/structural-analysis.test.ts
npm run typecheck
```

---

# Phase P09: structural_analysis — Callers + Callees Implementation

## Phase ID
`PLAN-20260211-ASTGREP.P09`

## Prerequisites
- Phase P08 completed (failing tests)

## Requirements Implemented
### REQ-SA-CALLERS-001–006, REQ-SA-CALLEES-001–003 (implementation)

## Implementation Tasks

### Files to Modify
- `packages/core/src/tools/structural-analysis.ts`
  - MUST include: `@plan PLAN-20260211-ASTGREP.P09`
  - `executeCallers()`: YAML rule — method_definition has (stopBy:end) call_expression with property_identifier regex matching symbol. Extract containing method, file, line, via text. Recurse with name+file visited set and maxNodes cap.
  - `executeCallees()`: YAML rule — call_expression inside (stopBy:end) method_definition matching symbol. Byte-range dedup. Recurse with cycle detection.

## Verification
```bash
npm test -- --run packages/core/src/tools/structural-analysis.test.ts
npm run test && npm run typecheck && npm run lint
```

---

# Phase P10: structural_analysis — References, Dependencies, Exports

## Phase ID
`PLAN-20260211-ASTGREP.P10`

## Prerequisites
- Phase P09 completed

## Requirements Implemented
### REQ-SA-REFS-001–003, REQ-SA-DEPS-001/002, REQ-SA-EXPORTS-001

Tests and implementation together — each mode is a straightforward set of queries with no recursion or complex state.

## Implementation Tasks

### Files to Modify
- `packages/core/src/tools/structural-analysis.test.ts`
  - MUST include: `@plan PLAN-20260211-ASTGREP.P10`
  - **References**: categorized results, counts, dedup, heuristic label
  - **Dependencies**: all import forms, re-exports, CommonJS (JS/TS), reverse mode
  - **Exports**: all export forms

- `packages/core/src/tools/structural-analysis.ts`
  - MUST include: `@plan PLAN-20260211-ASTGREP.P10`
  - `executeReferences()`, `executeDependencies()`, `executeExports()`

## Verification
```bash
npm test -- --run packages/core/src/tools/structural-analysis.test.ts
npm run test && npm run typecheck && npm run lint
```

---

# Phase P11: Integration Tests

## Phase ID
`PLAN-20260211-ASTGREP.P11`

## Prerequisites
- Phase P10 completed

## Requirements Implemented
### REQ-INFRA-003 (test), REQ-INFRA-006 (test), REQ-INFRA-007 (test)

## Implementation Tasks

### Files to Modify
- `packages/core/src/tools/ast-grep.test.ts`
  - MUST include: `@plan PLAN-20260211-ASTGREP.P11`
  - Integration: pattern `registerCoreTool($TOOL, $$$REST)` against config.ts → finds registrations
  - Integration: pattern on tools/ → finds BaseDeclarativeTool subclasses

- `packages/core/src/tools/structural-analysis.test.ts`
  - MUST include: `@plan PLAN-20260211-ASTGREP.P11`
  - Integration: callers of `createToolRegistry` → finds `initialize`
  - Integration: hierarchy of `ContentGenerator` → finds implementations

## Verification
```bash
npm run test && npm run typecheck && npm run lint
```

---

# Phase P12: Graceful Degradation, Timeouts, Final Cleanup

## Phase ID
`PLAN-20260211-ASTGREP.P12`

## Prerequisites
- Phase P11 completed

## Requirements Implemented
### REQ-INFRA-003, REQ-INFRA-006, REQ-INFRA-007

## Implementation Tasks

### Graceful Degradation (REQ-INFRA-003)
- Wrap both tool registrations in config.ts in try/catch — if @ast-grep/napi fails, skip registration

### Timeouts (REQ-INFRA-006)
- ast_grep: 30s timeout
- structural_analysis: 60s timeout
- On timeout: partial results with truncated=true

### Cleanup
- Remove `@plan` markers from production code
- Verify no TODO/FIXME/HACK in production files

### Full Verification
```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/tools/ast-grep.ts packages/core/src/tools/structural-analysis.ts packages/core/src/utils/ast-grep-utils.ts
# Expected: No matches

# Feature reachability
grep 'AstGrepTool' packages/core/src/config/config.ts
grep 'StructuralAnalysisTool' packages/core/src/config/config.ts
```

---

## Execution Tracker

| Phase | ID | Status | Description |
|-------|-----|--------|-------------|
| P01 | P01 | ⬜ | Preflight verification |
| P02 | P02 | ⬜ | Shared AST utilities — tests |
| P03 | P03 | ⬜ | Shared AST utilities — implementation |
| P04 | P04 | ⬜ | ast_grep tool — tests |
| P05 | P05 | ⬜ | ast_grep tool — implementation |
| P06 | P06 | ⬜ | structural_analysis — defs + hierarchy tests |
| P07 | P07 | ⬜ | structural_analysis — defs + hierarchy implementation |
| P08 | P08 | ⬜ | structural_analysis — callers + callees tests |
| P09 | P09 | ⬜ | structural_analysis — callers + callees implementation |
| P10 | P10 | ⬜ | References + dependencies + exports (tests + impl) |
| P11 | P11 | ⬜ | Integration tests |
| P12 | P12 | ⬜ | Graceful degradation, timeouts, cleanup |
