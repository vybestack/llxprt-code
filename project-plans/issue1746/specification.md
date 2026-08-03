# Issue #1746 Specification: Non-JS/TS Import Extraction

## Status and authority

- **Issue:** [#1746, “ast-edit: Improve import parsing for Python and other non-JS/TS languages”](https://github.com/vybestack/llxprt-code/issues/1746)
- **Repository branch:** `issue1746-followup`
- **Authoritative inputs:** the issue body and comments, the current source tree, `dev-docs/RULES.md`, `dev-docs/PLAN.md`, and `dev-docs/PLAN-TEMPLATE.md`
- **Specification rule:** where the issue's historical paths or assumptions differ from the current tree, the current tree determines the integration location while the issue determines the behavior to deliver.

## Purpose

Issue #1746 requires `extractImports` to represent ordinary static imports from Python, Go, Rust, and Ruby without forcing those languages through JavaScript/TypeScript syntax. PR #2945 delivered the initial Go/Ruby extraction and focused tests. This follow-up retains that implementation's valid Go block handling and Ruby parenthesized/no-space forms while completing the missing Python multi-target behavior, static Ruby boundaries, stricter Go boundaries, and real collector-path evidence.

## Merged-baseline reconciliation

PR #2945 merged as commit `83c74b86c` while this specification was being implemented. Directly running each implementation's behavioral suite against the other showed that neither should replace the other wholesale: the merged implementation correctly supports Ruby parenthesized/no-space calls and robust Go block termination, while the local investigation found missing Python comma-separated imports and incorrect acceptance of interpolated Ruby requires. The follow-up therefore starts from PR #2945 and adds only those non-duplicative correctness and evidence improvements. The preflight findings below record the repository state before that merge.

## Preflight findings

### Current location and API

- The issue names historical `packages/core` paths. The implementation now resides at `packages/tools/src/tools/ast-edit/language-analysis.ts`.
- `extractImports(content, language)` is defined at `packages/tools/src/tools/ast-edit/language-analysis.ts:32-68` and is publicly re-exported without a wrapper at `packages/tools/src/index.ts:448-451`.
- The existing `Import` contract is exactly `{ module: string; items: string[]; line: number }` at `packages/tools/src/tools/ast-edit/types.ts:58-62`. There is no alias field and this issue does not add one.
- `detectLanguage` already maps `.py`, `.rb`, `.go`, and `.rs` to `python`, `ruby`, `go`, and `rust` through `ASTConfig.SUPPORTED_LANGUAGES` at `packages/tools/src/tools/ast-edit/ast-config.ts:57-75`.

### Existing behavior

- Python has a dedicated branch at `language-analysis.ts:47-55`, module extraction at `language-analysis.ts:118-137`, and item/alias extraction at `language-analysis.ts:139-178`.
- A direct preflight probe confirmed the current Python implementation already returns the original module for `import os` and `import package.module as alias`, and original imported item names for `from typing import List as L, Dict`.
- Standard comma-separated direct imports are not represented correctly by the current implementation because one line always pushes one `Import` and direct module extraction stops at the first whitespace. This is the bounded Python behavior gap in addition to missing focused tests.
- Rust has a dedicated parser at `language-analysis.ts:180-311`. Existing tests at `packages/tools/src/tools/ast-edit/__tests__/ast-edit-rust-validation.test.ts:281-493` cover simple paths, grouped paths, aliases, visibility, comments, globs, normalization, and source lines. The exact `std::collections::HashMap` example is covered at lines 282-293 and 476-483; crate-root normalization is covered at lines 355-363.
- C extraction exists at `language-analysis.ts:61-64` and `language-analysis.ts:314-352`, with behavioral tests at `packages/tools/src/tools/ast-edit/__tests__/ast-edit-c-validation.test.ts:421-448`.
- Go and Ruby are recognized languages but have no branch in `extractImports`; preflight probes return `[]` for the issue's valid Go and Ruby examples.
- JavaScript/TypeScript currently has its own branch at `language-analysis.ts:38-46`. A preflight probe confirmed the supported side-effect form `import 'polyfill';` returns `[{ module: 'polyfill', items: [], line: 1 }]`.
- `constants.ts:29-35` confirms the historical issue regexes no longer exist; import parsing now uses private string-scanning helpers. This issue must not recreate or change shared regex constants.

### Behavioral evidence already present

The existing Rust and C ast-edit suites were run together during preflight:

```text
ast-edit-rust-validation.test.ts: passed
ast-edit-c-validation.test.ts: passed
```

These suites remain the regression authority for Rust and C. There is no focused `language-analysis.test.ts` under the current ast-edit test directory, and searches found no tests of `detectLanguage`, `ASTContextCollector.collectContext`, or the Python/Go/Ruby import paths.

### Dependencies and test infrastructure

- The tools package uses Vitest through `packages/tools/package.json:220-226`; ast-edit tests conventionally live under `packages/tools/src/tools/ast-edit/__tests__/` and import `extractImports` from `../language-analysis.js`.
- Python, Go, Rust, and Ruby ast-grep grammars are already dependencies at `packages/tools/package.json:252-259` and mappings at `packages/tools/src/utils/ast-grep-utils.ts:67-103`, but import extraction is a local source-to-`Import[]` transformation. No grammar or new dependency is needed for this issue.
- There are no dependency, type, or call-path blockers. If implementation discovers that an accepted behavior cannot be added with private helpers in the existing module and current `Import` shape, implementation must stop and revise this specification rather than widening APIs or tooling.

## Architectural contract

### Data flow and integration

```text
file path ── detectLanguage ──┐
                             ├─ extractImports(content, language) ── Import[]
source text ──────────────────┘                                      │
                                                                    ├─ ASTContext.imports
                                                                    ├─ symbol import indexing
                                                                    └─ related-file candidate resolution
```

Existing call paths are:

1. `ASTContextCollector.collectContext` detects the language and places `extractImports` output directly into `ASTContext.imports` at `context-collector.ts:85-101`.
2. `collectEnhancedContext` calls `collectContext` at `context-collector.ts:104-118`, so the same output reaches enhanced AST context without new wiring.
3. `CrossFileRelationshipAnalyzer.buildSymbolIndex` calls `extractImports` at `cross-file-analyzer.ts:68-85`, and `indexImports` consumes each item's original name and module at `cross-file-analyzer.ts:106-117`.
4. `CrossFileRelationshipAnalyzer.findRelatedFiles` calls `extractImports` at `cross-file-analyzer.ts:311-324` before current path resolution.
5. The public package export remains the existing `extractImports` export at `packages/tools/src/index.ts:448-451`.

The implementation is therefore an in-place extension of an already integrated function. No caller, registry, command, public export, or migration change is required.

Two current downstream limitations are explicitly not part of issue #1746:

- `getWorkspaceFiles` discovers TypeScript, JavaScript, and Python files at `cross-file-analyzer.ts:39-55`; adding Go/Ruby discovery is not part of import parsing.
- `resolveImportPath` tries JavaScript/TypeScript extensions at `cross-file-analyzer.ts:332-365`; language-aware Python/Go/Ruby resolution is not part of import extraction.

The new extraction behavior remains useful immediately through `ASTContext.imports`, explicit `buildSymbolIndex(files)` inputs, direct `findRelatedFiles(filePath)` parsing, and the public `extractImports` API. This specification does not claim that issue #1746 makes every downstream resolver language-aware.

### Implementation shape

- Keep `extractImports(content: string, language: string): Import[]` and `Import` unchanged.
- Add only private language-specific helpers inside `packages/tools/src/tools/ast-edit/language-analysis.ts` and dispatch to them by the existing language strings.
- Preserve source order. When one physical source line yields multiple imports, preserve left-to-right order.
- Preserve one-based physical source line numbers.
- Return plain `Import[]` values; do not add parser state or mutable shared state.
- Continue the existing linear string-scanning approach. Do not introduce speculative parser abstractions, regexes with backtracking risk, AST grammar coupling, or cross-language fallback behavior.
- Do not modify `constants.ts`, public exports, types, schemas, dependencies, workflows, quality tooling, or callers.
- Do not add ESLint/type suppression directives or loosen any lint, complexity, source-size, safety, coverage, cross-platform, or CI rule.

## Accepted language behavior

### Python

Accepted Python statements are complete on one physical line.

1. `import name` produces one `Import` whose `module` is `name` and whose `items` is empty.
2. Dotted direct names such as `import package.module` preserve the complete dotted module.
3. A direct alias such as `import package.module as alias` preserves `package.module`; the alias is intentionally not represented because `Import` has no alias field.
4. Standard comma-separated direct imports are accepted. Each direct import target becomes its own `Import` with the same physical line number and empty `items`. For example, `import os, package.module as pm` yields one record for `os` followed by one for `package.module`.
5. The comma-separated decision is necessary rather than speculative: Python's ordinary direct-import syntax permits multiple targets, `extractImports` already returns an array, and `Import.module` is singular. Returning one record per target is the only representation that preserves all source modules without changing the public type.
6. `from module import item` and comma-separated named items produce one `Import`: `module` is the complete source module and `items` contains the imported names in source order.
7. Dotted source modules such as `from package.submodule import item` remain complete.
8. Item aliases such as `from package import item as alias` retain `item`, not the local alias.

Relative imports (`from .module ...`), wildcard imports, parenthesized import lists, backslash continuations, imports split over multiple physical lines, semicolon-separated statements, dynamic `importlib`/`__import__` calls, and syntactically malformed statements are outside this issue's accepted Python contract.

### Go

Accepted Go import specs use complete double-quoted paths.

1. A single `import "pkg"` produces `{ module: "pkg", items: [], line: <statement line> }`.
2. A parenthesized block beginning with `import (` and ending with `)` may span physical lines. Each physical line containing one complete double-quoted import path produces a separate `Import` at that path's line.
3. Empty lines and comment-only lines inside a block produce no record.
4. Ordinary Go import aliases are included as a necessary parsing boundary: `alias "pkg"`, `_ "pkg"`, and `. "pkg"` are valid import specs and must not prevent extraction of the quoted path. The alias is ignored because `Import` has no alias field. The same import-spec rule applies to a single import and a block entry.
5. Output order follows import-spec order. Every Go record has empty `items`.

This is not a Go source parser. Raw-string paths, multiple specs on one physical line, generated/dynamic constructs, malformed or unterminated quotes/blocks, and speculative syntax are not accepted. Cgo preambles, comments associated with `import "C"`, and cgo-specific semantics or output are not added. The generic quoted-path rule need not special-case a path whose literal value is `C`, but no cgo behavior is promised or tested.

### Rust

The issue's two Rust examples are accepted with the current normalized representation:

- `use crate::module;` → `[{ module: "crate", items: ["module"], line: 1 }]`
- `use std::collections::HashMap;` → `[{ module: "std::collections", items: ["HashMap"], line: 1 }]`

This is already implemented. Evidence is reused from the existing Rust suite and the preflight probe. No Rust helper, Rust dispatch, Rust test expansion, or normalization change is part of issue #1746.

### Ruby

Accepted Ruby calls contain exactly one static string literal.

1. `require 'gem'` and `require "gem"` produce the unquoted module string, empty `items`, and the statement's one-based line.
2. `require_relative 'file'` and `require_relative "file"` produce the unquoted relative string exactly as written, without path normalization, empty `items`, and the statement's one-based line.
3. Parenthesized forms such as `require('gem')` and Ruby's valid no-space forms such as `require'gem'` remain accepted as merged regression behavior.
4. Single-quoted and non-interpolated double-quoted literals are accepted. Escaped quotes and escaped interpolation markers preserve their source spelling; quote delimiters are not included in `module`.

Variables, method results, concatenation, active interpolation such as `require "#{name}"`, multiple arguments, arrays, `load`, `autoload`, multiline calls/literals, and malformed or unterminated strings are outside this issue's accepted Ruby contract and must not be deliberately interpreted as accepted imports.

### Regression languages

- JavaScript and TypeScript keep their current dispatch and extraction behavior. Focused regression evidence covers valid current side-effect imports with both quote styles; this issue must not encode known or newly discovered incorrect behavior as a regression expectation.
- Existing C extraction and its tests remain unchanged.
- Existing Rust extraction and its tests remain unchanged.
- Other languages continue to receive current behavior, including an empty result when no existing branch recognizes an import.

## Behavior matrix

Every row marked **new evidence** must be asserted with whole-array exact equality, including module, items, order, and line.

| ID | Language/input | Exact output | Evidence disposition |
| --- | --- | --- | --- |
| PY-1 | `import os` | `[{ module: 'os', items: [], line: 1 }]` | New focused characterization |
| PY-2 | `import package.module as alias` | `[{ module: 'package.module', items: [], line: 1 }]` | New focused characterization |
| PY-3 | `import os, package.module as pm` | `[{ module: 'os', items: [], line: 1 }, { module: 'package.module', items: [], line: 1 }]` | New RED behavior |
| PY-4 | blank line, then `from pathlib import Path` | `[{ module: 'pathlib', items: ['Path'], line: 2 }]` | New focused characterization and line evidence |
| PY-5 | `from package.submodule import first, second as local` | `[{ module: 'package.submodule', items: ['first', 'second'], line: 1 }]` | New focused characterization |
| GO-1 | blank line, then `import "fmt"` | `[{ module: 'fmt', items: [], line: 2 }]` | New RED behavior |
| GO-2 | `import (` on line 1, `"fmt"` on line 2, `alias "example.com/lib"` on line 3, `_ "driver/pkg"` on line 4, `. "dot/pkg"` on line 5, `)` on line 6 | `[{ module: 'fmt', items: [], line: 2 }, { module: 'example.com/lib', items: [], line: 3 }, { module: 'driver/pkg', items: [], line: 4 }, { module: 'dot/pkg', items: [], line: 5 }]` | New RED behavior |
| RS-1 | `use crate::module;` | `[{ module: 'crate', items: ['module'], line: 1 }]` | Reuse current parser, crate-path suite, and preflight probe |
| RS-2 | `use std::collections::HashMap;` | `[{ module: 'std::collections', items: ['HashMap'], line: 1 }]` | Reuse existing Rust test |
| RB-1 | `require 'json'` followed by `require "set"` | `[{ module: 'json', items: [], line: 1 }, { module: 'set', items: [], line: 2 }]` | New RED behavior |
| RB-2 | blank line, then `require_relative './helper'`, then `require_relative "lib/file"` | `[{ module: './helper', items: [], line: 2 }, { module: 'lib/file', items: [], line: 3 }]` | New RED behavior |
| RB-3 | `require dependency`, `require "#{name}"`, and `require_relative base + '/file'` | `[]` | New literal-only boundary evidence |
| JS-1 | `import 'polyfill';` followed by `import "setup";` | `[{ module: 'polyfill', items: [], line: 1 }, { module: 'setup', items: [], line: 2 }]` | New regression characterization; no JS/TS production change |
| C-1 | `#include <stdio.h>` | `[{ module: 'stdio.h', items: [], line: 1 }]` | Reuse existing C suite |

## Formal requirements and acceptance criteria

### REQ-API-001: Preserve the public import model

- **Given** callers use the current `extractImports(content, language): Import[]` export and `Import` fields
- **When** issue #1746 is implemented
- **Then** the function signature, export path, `Import` type, field meanings, ordering, and one-based line convention remain unchanged
- **And** aliases are represented by preserving original module/item names rather than adding an alias field.

### REQ-PY-001: Extract one-line direct Python imports

- **Given** Python source contains `import name`, a dotted name, a direct `as` alias, or comma-separated direct imports on one physical line
- **When** `extractImports(source, 'python')` is called
- **Then** it returns one exact `Import` per original module in left-to-right order
- **And** every record has empty `items`, the full original module path, and the statement's one-based line.

### REQ-PY-002: Extract one-line Python from-imports

- **Given** Python source contains `from module import item` or comma-separated named items, including dotted modules and item aliases
- **When** `extractImports(source, 'python')` is called
- **Then** it returns one exact `Import` with the complete module and original imported item names in source order
- **And** local aliases do not replace the original names in `items`.

### REQ-GO-001: Extract a single Go import

- **Given** Go source contains one complete double-quoted import spec, with or without a standard named, blank, or dot alias
- **When** `extractImports(source, 'go')` is called
- **Then** it returns the unquoted path with empty `items` and the spec's one-based physical line.

### REQ-GO-002: Extract a parenthesized Go import block

- **Given** Go source contains a parenthesized multiline import block with complete double-quoted path specs and optional standard aliases
- **When** `extractImports(source, 'go')` is called
- **Then** it returns one exact `Import` per path in source order
- **And** each record's line is the physical line containing that path, not the opening `import (` line.

### REQ-RS-001: Preserve the issue's accepted Rust examples

- **Given** Rust source contains `use crate::module;` or `use std::collections::HashMap;`
- **When** `extractImports(source, 'rust')` is called
- **Then** current module/item normalization and one-based source lines are preserved exactly
- **And** implementation reuses existing Rust behavior rather than changing or expanding it.

### REQ-RB-001: Extract literal Ruby requires

- **Given** Ruby source contains no-parenthesis `require` or `require_relative` with a single- or non-interpolated double-quoted literal
- **When** `extractImports(source, 'ruby')` is called
- **Then** it returns the unquoted literal exactly as `module`, empty `items`, and the call's one-based line.

### REQ-RB-002: Keep Ruby extraction literal-only

- **Given** the argument is a variable, interpolated string, concatenation, method result, multiple arguments, or another out-of-scope form
- **When** `extractImports(source, 'ruby')` is called
- **Then** that expression does not produce an accepted Ruby import record
- **And** the implementation does not evaluate Ruby or infer a path.

### REQ-REG-001: Preserve existing language behavior

- **Given** valid currently supported JavaScript/TypeScript side-effect imports, C includes, and Rust use declarations
- **When** the new Python/Go/Ruby behavior is added
- **Then** their existing exact outputs remain unchanged
- **And** no C or Rust implementation is refactored.

### REQ-INT-001: Flow extraction through existing callers

- **Given** a `.py`, `.go`, or `.rb` file path and accepted source content are passed to the real `ASTContextCollector`
- **When** `collectContext` performs language detection and context collection
- **Then** `ASTContext.imports` exactly equals the corresponding `extractImports` output
- **And** no caller mock substitutes for `detectLanguage`, `extractImports`, or the collector.

### REQ-QUAL-001: Preserve project quality constraints

- **Given** the implementation and tests are reviewed and verified
- **When** project checks run
- **Then** there are no new dependencies, public API/type/schema changes, workflow or quality-tool changes, lint/type suppressions, safety regressions, or relaxed gates
- **And** all production changes are direct responses to observed failing behavioral tests.

## Test and evidence specification

### Exact intended locations

- Add every follow-up behavior and real `ASTContextCollector` scenario to `packages/tools/test-bun/language-analysis.followup.bun.ts`, importing assertions from `bun:test`. Register that file in `scripts/bun-test-manifest.ts` so the repository's isolated native Bun runner executes it.
- Reuse, without changing for this follow-up:
  - PR #2945's `packages/tools/src/tools/ast-edit/__tests__/language-analysis.test.ts`
  - `packages/tools/src/tools/ast-edit/__tests__/ast-edit-rust-validation.test.ts`
  - `packages/tools/src/tools/ast-edit/__tests__/ast-edit-c-validation.test.ts`

No tests are added under the historical `packages/core` path.

### Evidence rules

- Tests call the real `extractImports` and compare the entire returned array with `toEqual`; partial property checks, `toHaveProperty`, existence-only assertions, snapshots, and implementation-detail assertions are insufficient.
- Integration scenarios instantiate the real `ASTContextCollector`, pass in-memory source text with representative `.py`, `.go`, and `.rb` paths, and compare `context.imports` to exact arrays. Do not mock the collector, language detection, extraction, or AST parsing. Infrastructure setup may be isolated only if unrelated to import behavior.
- Every accepted behavior in the behavior matrix is mapped to an executable test or named existing suite. A code-reading claim alone does not complete a new behavior.
- Unsupported syntax must not be turned into a broad hardening project. Add the Ruby dynamic-expression test because literal-only behavior is an explicit issue boundary. For other malformed or multiline forms, do not add speculative support or enshrine accidental current outputs; they remain outside the contract.
- A test must fail if the relevant real extraction branch is removed or broken. Verifying a mock invocation is prohibited.

### Evidence map

| Requirement | Required behavioral evidence |
| --- | --- |
| REQ-API-001 | Exact-output tests compile against the unchanged public shape; typecheck and build pass |
| REQ-PY-001 | PR #2945's merged characterizations plus PY-3 in the Bun follow-up suite |
| REQ-PY-002 | PR #2945's unchanged merged suite |
| REQ-GO-001 | PR #2945's merged Go assertions plus malformed-alias and empty-path boundaries in the Bun follow-up suite |
| REQ-GO-002 | PR #2945's unchanged merged suite |
| REQ-RS-001 | Existing Rust suite sections at lines 281-293, 355-363, and 476-483; targeted suite remains green |
| REQ-RB-001 | PR #2945's unchanged merged suite plus escaped-literal boundaries in the Bun follow-up suite |
| REQ-RB-002 | RB-3 in the Bun follow-up suite |
| REQ-REG-001 | Unchanged merged language-analysis, C, and Rust suites |
| REQ-INT-001 | Real collector scenarios for `.py`, `.go`, and `.rb` in the Bun follow-up suite, asserting exact `context.imports` |
| REQ-QUAL-001 | Targeted and full verification commands, diff review, and suppression/dependency/API checks |

## TDD execution order

The implementation must follow integration-first RED → GREEN slices. Unexpected test or architecture results are blockers, not reasons to bypass a gate.

1. **Baseline:** Run the existing Rust and C suites and record green results before editing production code.
2. **Integration RED first:** Add exact `ASTContextCollector.collectContext` scenarios for `.go` and `.rb`; verify they fail because `context.imports` is empty. Add the Python collector scenario as current-behavior characterization; it should pass and does not authorize production changes.
3. **Focused characterization:** Add PY-1, PY-2, PY-4, PY-5, and JS-1 exact-output tests. They should pass against current correct behavior. If a characterization exposes incorrect behavior, do not enshrine it; stop and reconcile it with this specification.
4. **Python RED/GREEN:** Add PY-3 and observe the exact failure for comma-separated direct imports. Make the minimum private Python parsing change needed for REQ-PY-001, then run the focused suite to green.
5. **Go RED/GREEN slices:** Add GO-1 and its standard-alias counterpart, observe RED, and implement only the single-spec behavior. Then add GO-2, observe RED, and implement only multiline block state and per-spec line capture. Keep the collector integration scenario exact and green.
6. **Ruby RED/GREEN slices:** Add RB-1, observe RED, and implement literal `require`; add RB-2, observe RED, and implement literal `require_relative`; add RB-3 and ensure dynamic forms produce no accepted records. Keep the collector integration scenario exact and green.
7. **Regression:** Run the entire focused suite together with the unchanged Rust and C suites. No production change is permitted solely to alter Rust, C, or JS/TS behavior.
8. **Full verification:** Run package and repository gates. If any gate fails, fix only behavior or quality regressions caused by issue #1746. Do not loosen the gate or widen architecture.

No production code may precede its failing behavioral test. Passing characterization tests establish evidence but do not authorize unrelated edits.

## Verification commands

Run from the repository root.

### Focused RED/GREEN and regression checks

```bash
bun scripts/run_bun_tests.ts --workspace tools --junit packages/tools/junit-bun.xml
npm test --workspace @vybestack/llxprt-code-tools -- --run src/tools/ast-edit/__tests__/language-analysis.test.ts src/tools/ast-edit/__tests__/ast-edit-rust-validation.test.ts src/tools/ast-edit/__tests__/ast-edit-c-validation.test.ts
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run lint --workspace @vybestack/llxprt-code-tools
npm run build --workspace @vybestack/llxprt-code-tools
```

### Full project gate before completion

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

After formatting, rerun affected tests and inspect `git diff` to ensure formatting did not create unrelated changes.

### Scope and safety review

```bash
git diff -- packages/tools/src/tools/ast-edit/language-analysis.ts packages/tools/src/tools/ast-edit/__tests__/language-analysis.test.ts
git status --short
```

The review must confirm no changes to `.llxprt`, dependencies, lockfiles, public exports/types, schemas, workflows, quality tooling, C/Rust implementation/tests, JS/TS extraction, or downstream callers.

## Completion gate

Issue #1746 implementation is complete only when all of the following are true:

- [ ] REQ-PY-001 and REQ-PY-002 have whole-array exact-output evidence for every accepted Python form, including comma-separated direct imports and alias preservation of original names.
- [ ] REQ-GO-001 and REQ-GO-002 have whole-array exact-output evidence for single imports, multiline blocks, aliases, empty items, ordering, and physical source lines.
- [ ] REQ-RS-001 is satisfied by unchanged current behavior and the reused Rust evidence remains green.
- [ ] REQ-RB-001 and REQ-RB-002 have whole-array exact-output evidence for both quote styles, `require`, `require_relative`, source lines, and literal-only rejection.
- [ ] REQ-REG-001 has JavaScript/TypeScript regression evidence and unchanged C/Rust suites remain green.
- [ ] REQ-INT-001 is proven through the real collector call path for Python, Go, and Ruby without mock theater.
- [ ] Every accepted behavior row has named executable evidence; no accepted behavior relies only on manual inspection.
- [ ] The public function, `Import` shape, exports, and caller wiring are unchanged.
- [ ] No unsupported syntax was speculatively implemented and no accidental malformed-input behavior was enshrined.
- [ ] No dependency, workflow, quality-tool, suppression, schema, or unrelated refactor change is present.
- [ ] Focused tests, tools-package checks, full repository checks, build, formatting, and runtime smoke all pass.
- [ ] Final diff review shows only the bounded implementation and behavioral evidence required by issue #1746.
