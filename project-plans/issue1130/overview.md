# Issue #1130: AST-Grep Tooling

## Overview

Two new tools that give the LLM structural/semantic code understanding beyond what text-based grep provides. These tools are for the LLM to use during code analysis, not user-facing.

**ast-grep** operates on syntax trees (via tree-sitter), not text. It matches code *structure* — a pattern like `$OBJ.getAsyncTaskManager()` matches only actual method calls, not comments, strings, or type annotations containing that text. It also captures metavariables: searching for `registerCoreTool($TOOL, $$$REST)` returns each match *and* extracts the `$TOOL` argument as structured data.

---

## Tool 1: `ast_grep`

The raw ast-grep primitive exposed as a tool call.

### Purpose

Structural code search. The LLM uses this when it needs to find code patterns that regex can't express cleanly — specific call shapes, class declarations matching a structure, try/catch blocks, assignments to a property, etc.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | yes (or `rule`) | ast-grep pattern string, e.g. `$OBJ.getAsyncTaskManager()`, `class $NAME extends $PARENT { $$$BODY }` |
| `rule` | object | yes (or `pattern`) | YAML rule for complex queries using `kind`, `has`, `inside`, `stopBy`, `regex` etc. Needed for things pattern syntax can't express (e.g. finding method definitions by name, matching type annotations) |
| `language` | string | yes | `typescript`, `python`, `rust`, `go`, `java`, etc. |
| `path` | string | no | Directory or file to search. Defaults to workspace root. |
| `globs` | string[] | no | File glob patterns to include/exclude (e.g. `["*.ts", "!*.test.ts"]`) |
| `maxResults` | number | no | Cap the number of returned matches. Default 100. |

### Returns

- `truncated` — boolean, true if results were capped by `maxResults`
- `totalMatches` — total match count (even if truncated)
- `matches` — array, each containing:
  - `file` — file path (relative to workspace root)
  - `startLine`, `startCol`, `endLine`, `endCol` — precise location
  - `text` — matched source text
  - `nodeKind` — the AST node type of the match (e.g. `call_expression`, `class_declaration`)
  - `metaVariables` — captured `$NAME`, `$OBJ`, `$$$ARGS` etc. as structured key/value pairs

### What it handles well

- **Method/function calls**: `$OBJ.foo($$$ARGS)` — finds only actual calls, not definitions or comments
- **Optional chaining calls**: `$OBJ?.foo?.($$$ARGS)`
- **Class hierarchy**: `class $NAME extends $PARENT { $$$BODY }` — extracts class name and parent
- **Interface implementations**: `class $NAME implements $IFACE { $$$BODY }`
- **Assignments**: `this.toolRegistry = $VALUE`
- **Imports**: `import { $$$NAMES } from $SOURCE`
- **Structural patterns**: `try { $$$TRYBLOCK } catch ($ERR) { $$$CATCHBLOCK }`
- **Complex queries via YAML rules**: find method definitions by name, match type annotations, combine `kind` + `has` + `inside` + `regex`

### What it doesn't handle

- Patterns that produce multiple AST nodes (e.g. `async $METHOD(...)` fails — `async` is a separate node)
- String literal internals are not tokenized as separate metavariable-friendly nodes — `from '$PATH'` won't work. Match the whole string node as `$SOURCE` instead.
- Semantic analysis: no type resolution, no following through interfaces, no generic inference
- Method definition matching is grammar-specific — TS/JS has regular methods, arrow functions assigned to consts, class fields, object literal methods, etc. Each has a different AST shape. YAML rules with `kind` are more reliable than pattern syntax for this.

### Naming

`ast_grep` — named by function (structural code search), not by the underlying binary (`sg`). Consistent with existing tool naming (`search_file_content` wraps ripgrep, `read_file` wraps fs).

---

## Tool 2: `structural_analysis`

Higher-level analysis tool that chains multiple ast-grep queries internally to answer structural questions about code. This is syntax-graph analysis (AST-based, non-type-resolving) — not full semantic static analysis.

### Purpose

The LLM uses this when it needs to understand code relationships — call graphs, type hierarchies, symbol references, module dependencies. Each of these requires multiple ast-grep hops that the tool handles internally, returning assembled results.

### Parameters

Parameters are mode-specific. Common parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | string | yes | One of: `callers`, `callees`, `definitions`, `hierarchy`, `references`, `dependencies`, `exports` |
| `language` | string | yes | `typescript`, `python`, etc. |
| `path` | string | no | Directory or file scope. Defaults to workspace root. |

Symbol-scoped modes (`callers`, `callees`, `definitions`, `hierarchy`, `references`):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `symbol` | string | yes | The function, method, class, or interface name to analyze |
| `depth` | number | no | For `callers`/`callees`: how many levels to recurse. Default 1. Max 5. |
| `maxNodes` | number | no | Max nodes to visit during recursive traversal. Default 50. Prevents explosion on common names like `get`. |

File/module-scoped modes (`dependencies`, `exports`):

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | string | yes | File or directory to analyze |
| `reverse` | boolean | no | For `dependencies`: also find what imports the target. Default false. |

All modes return a `truncated: boolean` flag indicating whether results were capped by limits.

### Modes

#### `definitions` — Where is this symbol defined?

Finds the definition site(s) of a function, class, interface, type alias, or const. This is often the first hop before callers/callees.

**How it works internally:** YAML rules matching `method_definition`, `function_declaration`, `class_declaration`, `interface_declaration`, `type_alias_declaration`, `variable_declarator` with `property_identifier` or `identifier` matching the symbol name.

#### `callers` — Who calls this function/method?

Finds all method/function definitions that contain a call to the given symbol. With `depth > 1`, recursively finds callers of callers. Includes cycle detection and early termination at `maxNodes`.

Each caller result includes the containing method name AND the specific call-site line (`via:`) that links the caller to the callee, so the LLM can verify the connection.

**How it works internally:** YAML rule — find `method_definition` nodes that `has` (with `stopBy: end`) a `call_expression` matching `$OBJ.<symbol>()`. Also matches direct calls `<symbol>()` and optional chaining `$OBJ?.<symbol>?.()`. For each result, extract the containing method name and recurse.

**Example output (depth 2):**
```
createToolRegistry()
  ← initialize()  config.ts:823
    via: this.toolRegistry = await this.createToolRegistry();
    ← getPrompt()  prompt-service.ts:189
      via: await this.initialize();
    ← loadPrompt()  prompt-service.ts:302
      via: await this.initialize();
```

#### `callees` — What does this function/method call?

Finds all call expressions inside the given function/method definition. Deduplicates chained subcalls — if `a.b().c()` is a call, `a.b()` is not listed separately. With `depth > 1`, recursively traces what those callees call. Includes cycle detection.

**How it works internally:** YAML rule — find `call_expression` nodes `inside` (with `stopBy: end`) a `method_definition` whose `property_identifier` matches the symbol. Deduplication: for each match, discard calls whose byte range is fully contained within another match's byte range (keeping only outermost calls).

**Example output:**
```
initialize()
  → Error('Config was already initialized')  config.ts:825
  → IdeClient.getInstance()  config.ts:828
  → this.getFileService()  config.ts:830
  → this.getGitService()  config.ts:832
  → this.createToolRegistry()  config.ts:835
  → Promise.all([...)  config.ts:841
```

#### `hierarchy` — Class/interface inheritance tree

For a class: finds what it extends and implements, and what extends/implements it.
For an interface: finds all classes that implement it.

**How it works internally:** Combines `class $NAME extends $PARENT` and `class $NAME implements $IFACE` patterns across the codebase, then assembles the tree.

**Example output:**
```
BaseDeclarativeTool
  ← EditTool
  ← ShellTool
  ← RipGrepTool
  ← GrepTool
  ← ReadFileTool
  ← WriteFileTool
  ← ASTEditTool
  ... (52 subclasses)
```

#### `references` — All structural references to a symbol

Finds every place a symbol appears in a structurally meaningful way. Unlike text grep, this excludes comments and string literals.

Categories searched:
- **Method calls on instances**: calls on variables whose name matches or contains the symbol (e.g. `toolRegistry.register()`)
- **Direct calls**: the symbol used as a function/method name (e.g. `$OBJ.createToolRegistry()`)
- **Instantiations**: `new_expression` matches (e.g. `new ToolRegistry(...)`)
- **Type annotations**: `type_annotation` containing the identifier
- **Extends/implements**: class heritage clauses
- **Imports**: import specifiers
- **Re-exports**: `export { X } from` statements

**How it works internally:** Runs multiple ast-grep queries per category, deduplicates, and groups results.

**Example output:**
```
ToolRegistry — 135 references
  Method calls on instances (75):
    tool-registry.test.ts:142  toolRegistry.registerTool(tool)
    tool-registry.test.ts:143  toolRegistry.getTool('mock-tool')
    ...
  Instantiations (6):
    config.ts:1978        new ToolRegistry(this)
    executor.ts:83        new ToolRegistry(runtimeContext)
    ...
  Type annotations (32):
    coreToolScheduler.ts:384   : ToolRegistry
    subagent.ts:150            : ToolRegistry
    ...
  Imports (22):
    config.ts:15           import { ToolRegistry } from '../tools/tool-registry.js'
    ...
```

#### `dependencies` — Import/export graph

For a given file or directory, maps what it imports from where. With `reverse: true`, also finds what imports the target.

Import forms matched:
- Named imports: `import { X } from 'y'`
- Default imports: `import X from 'y'`
- Namespace imports: `import * as X from 'y'`
- Side-effect imports: `import 'y'`
- Dynamic imports: `import('y')`
- Re-exports: `export { X } from 'y'`
- CommonJS (when applicable): `require('y')`, `module.exports`

#### `exports` — Module surface area

Lists all exports from a file or directory — what symbols a module makes available.

---

## Key Limitations (both tools)

These tools operate on **syntax trees, not semantics**. They match by name and structure, not by resolved types.

- **No cross-interface dispatch**: if `foo(x: SomeInterface)` calls `x.bar()`, the tools can find the call to `bar()` but can't resolve which concrete implementation of `bar()` will run.
- **No type alias resolution**: searching for `MyType` won't find usages of a type alias that points to `MyType`.
- **No generic inference**: can't follow type parameters through generic functions.
- **Name-based matching**: `callers` of `get()` will find ALL methods named `get`, not just `SettingsService.get()`. Scoping by file/directory helps, but it's not the same as a language server. The `maxNodes` limit prevents this from becoming a performance problem.
- **Grammar-specific method shapes**: In TypeScript/JavaScript, functions can be declared as methods, arrow functions assigned to variables, class fields, or object literal methods. Each has a different AST node kind. The tools handle common forms but may miss unusual declaration patterns.
- **Instance method calls are heuristic**: The "method calls on instances" category in references mode matches by variable name pattern, not by resolved type. This works well for distinctively named variables but can produce false positives for generic names.
- **Hierarchy is syntax-only**: The `hierarchy` mode finds `extends` and `implements` clauses. It does not detect mixin patterns, decorator-based composition (e.g. Angular `@Component`), or runtime composition via `Object.assign`/spread.

These limitations are acceptable for the current scope. The tools provide 80-90% of the insight a language server would, at a fraction of the complexity, and across any language tree-sitter supports.

---

## Relationship to Issue #438 (LSP Support)

Issue #438 proposes LSP server integration for edit validation (lint, type-check without full build). LSP would also enable type-resolved analysis: precise "find references," "go to implementation," and cross-interface dispatch.

**These tools are complementary to LSP, not competing:**

| Capability | ast-grep tools (this issue) | LSP (issue #438) |
|---|---|---|
| Cross-language support | Yes (any tree-sitter grammar) | No (per-language servers) |
| Pattern matching | Yes (`try/catch`, structural queries) | No |
| Speed (full codebase scan) | Fast (seconds) | Slow (requires loaded project) |
| Type resolution | No | Yes |
| Interface dispatch | No | Yes |
| Setup complexity | Low (single binary) | High (server lifecycle, config) |

**Upgrade path:** When LSP lands, `structural_analysis` can use LSP for type-resolved queries where available (precise references, go-to-implementation) and fall back to ast-grep for pattern matching, cross-language search, and environments where no LSP is configured.

---

## Relationship to Existing Tools

| Tool | Purpose | When the LLM uses it |
|------|---------|---------------------|
| `search_file_content` (ripgrep) | Text regex search | "Find lines containing this string" |
| `ast_grep` (new) | Structural pattern search | "Find all calls matching this shape" / "Find classes extending X" |
| `structural_analysis` (new) | Multi-hop code analysis | "Who calls this method?" / "What's the class hierarchy?" |
| `ast_read_file` (existing) | Context-enhanced file reading | "Read this file with AST declarations from related files" |
| `ast_edit` (existing) | Context-enhanced editing | "Edit this file with AST validation" |

`ast_grep` and `structural_analysis` are complementary to ripgrep, not replacements. Ripgrep is still the right tool for text search. The new tools handle structural questions that regex can't express.
