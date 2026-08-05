# Issue 3038 — Code analysis/search tooling fixes

Scope: `structural_analysis` modes `callees`, `definitions`, `dependencies`, the
`structural_analysis` tool description, and the `codesearch` tool endpoint.
Issue 3039 (codesearch non-functional) is folded in per the maintainer comment
on 3038 and ships as its own commit in the same PR.

## Verified root causes (reproduced locally)

1. **callees** — `callees.ts` queries only `kind: 'method_definition'`, which in
   the tree-sitter TS grammar matches class/object methods only. Standalone
   `function_declaration`, `generator_function_declaration`, and arrow functions
   never match, so the mode returns `[]` for them.
2. **definitions** — `definitions.ts` matches functions with the literal pattern
   `function ${symbol}($$$PARAMS) { $$$BODY }`. A `function_declaration` that
   carries a return type has an extra `type_annotation` child between
   `formal_parameters` and `statement_block`, so the pattern matches 0 nodes.
   Verified: `parse(...).findAll('function withReturnType($$$PARAMS) { $$$BODY }')`
   returns 0 for `function withReturnType(x: number): number { ... }`.
3. **dependencies without target** — `validateAndResolveParams` enforces `symbol`
   for the symbol modes but nothing for `dependencies`, so the mode silently
   falls back to the workspace root and walks every file.
4. **dependencies duplicate/bogus kind** — the pattern `import $DEFAULT from $SOURCE`
   binds `$DEFAULT` to the whole `import_clause`, so it also matches
   `import { c, d } from ...` and `import * as ns from ...`. Every named or
   namespace import is therefore emitted a second time labelled `default`.
   Verified against the grammar.
5. **type-only imports dropped** — `import type { A } from 'x'` has a `type`
   keyword child between `import` and `import_clause`, so neither existing
   pattern matches it and the entry is silently omitted.
6. **codesearch** — the hosted Exa MCP server at `https://mcp.exa.ai/mcp` no
   longer advertises `get_code_context_exa` in its default tool set
   (`tools/list` returns only `web_search_exa` and `web_fetch_exa`). The tool is
   still available but must be requested via the `tools` query parameter.
   Verified: `POST https://mcp.exa.ai/mcp?tools=get_code_context_exa` with
   `tools/call` returns real results. This is an upstream default-tool-set
   change, not a missing credential.
   Separately, the upstream failure arrives as
   `{"result":{"content":[{"text":"MCP error -32602: ..."}],"isError":true}}`,
   and the current parser ignores `isError`, so an upstream failure is returned
   to the model as a successful result.

## Acceptance criteria

### AC1 — `callees` resolves callees of every function-like container
Given a TypeScript file containing a standalone function, an arrow function
bound to a `const`, a generator function, a class method, and function
expressions bound to a `const` (plain, generator, and named), each of which
calls distinct leaf functions:

- `callees` for the standalone function returns both of its call sites.
- `callees` for the arrow function returns its call site.
- `callees` for the generator function returns its call site.
- `callees` for the class method returns its call site (no regression).
- `callees` for a `const` bound to a plain function expression (`const fn =
  function () { ... }`) returns its call site.
- `callees` for a `const` bound to a generator function expression (`const gen =
  function* () { ... }`) returns its call site.
- `callees` for a `const` bound to a named function expression, looked up by the
  const name, returns its call site.
- The nested-container rule holds for function expressions: a call inside a
  nested function declared within a function expression is NOT reported as a
  callee of the function expression.
- The `callers`/`callees` directionality agrees: for the same edge,
  `callers(leaf)` naming the enclosing function and `callees(enclosing)`
  naming the leaf both return a non-empty result.
- `callers` attributes a call made inside a variable-bound function expression
  (arrow, plain, or generator) to that binding's name, instead of walking up to
  whatever encloses it.

### AC2 — `definitions` finds declarations that carry return type annotations
- `definitions` for `export function withReturnType(x: number): number { ... }`
  returns exactly one entry with `kind: 'function'` and the declaration's line.
- `definitions` for a function without a return type still returns one entry
  with `kind: 'function'` (no regression).
- `definitions` for a class method with a return type returns an entry with
  `kind: 'method'`.
- `definitions` for a `class`, an `interface`, and a `type` alias still returns
  their existing entries (no regression).
- No `(file, line)` pair is reported more than once.
- `definitions` finds variable-bound function-like declarations — an arrow
  function (`const f = () => {}`), a type-annotated arrow (`const f: () => void
  = () => {}`), a plain function expression (`const f = function () {}`), and a
  generator function expression (`const f = function* () {}`) — each returning
  exactly one entry with `kind: 'function'` and the declarator's line.

### AC3 — `dependencies` requires an explicit target
- `dependencies` with neither `target` nor `path` returns
  ``Error: `target` (or `path`) parameter is required for "dependencies" mode.`` and
  performs no scan (no `imports` payload).
- `dependencies` with `target` set succeeds.
- `dependencies` with `path` set (the documented alias for the search root)
  succeeds — the requirement is "an explicit search root", not literally the
  `target` key.

### AC4 — `dependencies` emits one correctly classified record per import binding
For a file containing:

    import type { A, B } from './types.js';
    import { c } from './c.js';
    import def from './def.js';
    import def2, { e } from './e.js';
    import * as ns from './ns.js';
    import './side.js';
    import qux = require('qux-module');
    import type quux = require('quux-module');

- `./c.js` appears exactly once, `kind: 'named'`, and no `default` record for it.
- `./def.js` appears exactly once, `kind: 'default'`.
- `./e.js` appears exactly twice: once `default`, once `named` (same line).
- `./ns.js` appears exactly once, `kind: 'namespace'`.
- `./side.js` appears exactly once, `kind: 'side-effect'`.
- `qux-module` appears exactly once, `kind: 'require'` (TypeScript
  import-equals `import x = require(...)`).
- `quux-module` appears exactly once, `kind: 'type'` (the `import type x =
  require(...)` form is routed as type-only with the correct source).
- No two records share the same `(file, line, source, kind)`.
- `source` is the module specifier with quotes stripped, for every static import.
- No emitted record has an empty `source`.

### AC5 — type-only imports are reported
- `import type { A, B } from './types.js'` yields exactly one record with
  `kind: 'type'` and `source: './types.js'`.
- `import { type A } from './only-type.js'` yields exactly one record with
  `kind: 'type'` — every `import_specifier` inside `named_imports` carries an
  inline `type` modifier, so the statement is type-only.
- `import { type B, C } from './mixed.js'` yields exactly one record with
  `kind: 'named'` — the specifiers are mixed (one inline `type`, one value), so
  the statement genuinely imports at least one value and is NOT type-only.

### AC6 — the tool description documents the per-mode parameter matrix
- The `structural_analysis` description contains one worked example call per
  mode for all seven modes.
- The description states which parameters are required for which mode:
  `dependencies` requires an explicit search root (`target`, or `path`),
  `exports` takes an optional `target` (defaulting to the workspace root), and
  the symbol modes take `symbol`.

### AC7 — `codesearch` reaches the Exa code-context tool and fails loudly
- The request URL carries `tools=get_code_context_exa`.
- When an `exa` key resolves, the URL carries both `tools` and `exaApiKey`
  (asserted by parsing the URL, not by string equality on parameter order).
- An upstream response with `isError: true` is returned as a `ToolResult` with
  an `error` of type `SEARCH_ERROR`, not as successful content.
- A successful response is unchanged.

## Explicitly out of scope

- Other languages (Python, Go, Rust) for `callees`/`definitions`: the module's
  queries are already TS/JS-grammar specific; broadening them is a separate
  change.
- `exports` mode target validation and the `text` truncation nit in `exports`.
- The identical `isError` blindness in `exa_web_search` (its tool is in the
  default set, so it is not broken).
- The oversized context dump noted for `ast_read_file` (tracked in 3035).

## Tests

New Bun (`bun:test`) behavioral suites, registered in
`scripts/bun-test-manifest-data-tools.ts`:

- `packages/tools/src/tools/structural-analysis/structural-analysis-modes.bun.test.ts`
  — AC1–AC6, driven through the real `StructuralAnalysisTool` against real
  files written to a temp directory. No mocking of the AST engine.
- `packages/tools/src/tools/codesearch-endpoint.bun.test.ts` — AC7, with
  `node-fetch` stubbed at the module boundary (the only external I/O).

The existing `packages/tools/src/tools/codesearch.test.ts` URL assertions are
updated for the new query string; that file already runs under Bun through the
repo's vitest compat shim.
