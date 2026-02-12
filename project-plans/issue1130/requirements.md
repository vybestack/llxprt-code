# Issue #1130: Requirements (EARS Format)

Requirements for two new LLM-facing tools: `ast_grep` and `structural_analysis`.

EARS patterns used:
- **Ubiquitous**: The [system] shall [behavior].
- **Event-driven**: When [trigger], the [system] shall [behavior].
- **State-driven**: While [state], the [system] shall [behavior].
- **Unwanted behavior**: If [condition], then the [system] shall [behavior].
- **Optional**: Where [feature], the [system] shall [behavior].

---

## REQ-ASTGREP: ast_grep Tool

### REQ-ASTGREP-001: Tool Registration

The `ast_grep` tool shall be registered as a core tool in the tool registry, available to the LLM alongside existing tools like `search_file_content` and `read_file`.

### REQ-ASTGREP-002: Pattern Search

When the LLM invokes `ast_grep` with a `pattern` parameter and a `language` parameter, the tool shall execute an ast-grep structural pattern search against the target path and return all matching AST nodes according to ast-grep's matching semantics.

### REQ-ASTGREP-003: YAML Rule Search

When the LLM invokes `ast_grep` with a `rule` parameter (containing `kind`, `has`, `inside`, `stopBy`, or `regex` fields) and a `language` parameter, the tool shall execute an ast-grep YAML rule search against the target path and return all matching AST nodes.

### REQ-ASTGREP-004: Mutually Exclusive Input

When the LLM provides both `pattern` and `rule` parameters, the tool shall return an error indicating that exactly one of `pattern` or `rule` must be provided. When neither is provided, the tool shall also return an error.

### REQ-ASTGREP-005: Default Path

When the LLM does not provide a `path` parameter, or provides an empty string, the tool shall default to the workspace root directory.

### REQ-ASTGREP-006: Workspace Boundary

If the resolved `path` is outside the workspace root, then the tool shall return an error and not execute the search.

### REQ-ASTGREP-007: Match Result Format

The tool shall return each match with the following fields: `file` (path relative to workspace root), `startLine`, `startCol`, `endLine`, `endCol`, `text` (matched source text), `nodeKind` (AST node type), and `metaVariables` (captured pattern variables as key-value pairs).

### REQ-ASTGREP-008: Result Limit

Where the `maxResults` parameter is provided, the tool shall return at most that many matches. The default limit shall be 100. When results are truncated, the response shall include `truncated: true` and the total match count.

### REQ-ASTGREP-009: Empty Results

When a search returns zero matches, the tool shall return an empty array with `truncated: false`.

### REQ-ASTGREP-010: Glob Filtering

Where the `globs` parameter is provided, the tool shall include only files matching the specified glob patterns and exclude files matching negated patterns (prefixed with `!`).

### REQ-ASTGREP-011: Error Handling for Invalid Patterns

If the provided `pattern` cannot be parsed as a valid ast-grep pattern, then the tool shall return a clear error message including the ast-grep parse error text, not a stack trace.

### REQ-ASTGREP-012: Error Handling for Unavailable Engine

If the ast-grep engine (either `@ast-grep/napi` or the `sg` CLI) is not available, then the tool shall not be registered in the tool registry rather than failing at runtime.

### REQ-ASTGREP-013: Language Parameter

The `language` parameter shall be required when `path` targets a directory or multiple files. Where `path` points to a single file and `language` is not provided, the tool shall attempt to detect the language from the file extension. If detection fails, the tool shall return an error requesting a `language` parameter.

### REQ-ASTGREP-014: Tool Description

The tool's schema description shall clearly explain that it performs structural/AST-aware code search (not text search), mention metavariable capture, and distinguish itself from `search_file_content` (ripgrep).

### REQ-ASTGREP-015: Cancellation Support

While an ast_grep search is in progress, if the operation is cancelled via AbortSignal, the tool shall terminate the search and return a cancellation response.

### REQ-ASTGREP-016: Per-File Error Handling

If individual files within the search path cannot be parsed (permission denied, binary file, unsupported encoding), then the tool shall skip those files and continue searching remaining files, including a `skippedFiles` count in the response metadata.

---

## REQ-SA: structural_analysis Tool

### REQ-SA-001: Tool Registration

The `structural_analysis` tool shall be registered as a core tool in the tool registry, available to the LLM alongside `ast_grep` and other tools.

### REQ-SA-002: Mode Parameter

When the LLM invokes `structural_analysis`, it shall provide a `mode` parameter. The tool shall support these modes: `callers`, `callees`, `definitions`, `hierarchy`, `references`, `dependencies`, `exports`. When an unsupported mode is provided, the tool shall return an error listing the valid modes.

### REQ-SA-003: Language Parameter

The `structural_analysis` tool shall require a `language` parameter for all modes.

### REQ-SA-004: Tool Description

The tool's schema description shall clearly explain that it performs multi-hop AST-based code analysis (call graphs, hierarchies, references), that it is name-based (not type-resolved), and how it differs from `ast_grep` (which is single-query).

### REQ-SA-005: Workspace Boundary

If the resolved `path` or `target` is outside the workspace root, then the tool shall return an error and not execute the analysis.

### REQ-SA-006: Cancellation Support

While a structural_analysis operation is in progress, if the operation is cancelled via AbortSignal, the tool shall terminate and return a cancellation response with any partial results collected so far.

### REQ-SA-007: Empty Results

When any mode returns zero results, the tool shall return an empty result set with `truncated: false` and mode-appropriate structure (empty arrays for list modes, empty categories for references mode).

### REQ-SA-008: Path Output Format

All file paths in results shall be relative to the workspace root, consistent across all modes.

---

### Callers Mode

### REQ-SA-CALLERS-001: Basic Caller Discovery

When `mode` is `callers`, the tool shall find all function/method definitions that contain a call expression matching the given `symbol`.

### REQ-SA-CALLERS-002: Call-Site Context

Each caller result shall include the containing method name, file path, line number, AND the specific call-site line text (`via:`) that connects the caller to the callee. Where a method contains multiple calls to the target symbol, the result shall include the first matching call site.

### REQ-SA-CALLERS-003: Recursive Depth

Where the `depth` parameter is greater than 1, the tool shall recursively find callers of callers up to the specified depth. The default depth shall be 1 and the maximum shall be 5.

### REQ-SA-CALLERS-004: Cycle Detection

While traversing callers recursively, the tool shall track visited symbols by name+file and skip any symbol already visited at a given file scope, preventing infinite loops.

### REQ-SA-CALLERS-005: Node Limit

Where the `maxNodes` parameter is provided, the tool shall stop traversal after visiting that many unique symbols. The default shall be 50. When traversal is truncated, the tool shall return all results collected up to that point with `truncated: true`.

### REQ-SA-CALLERS-006: Call Forms

The callers search shall match member calls (`$OBJ.symbol()`), direct calls (`symbol()`), and optional chaining calls (`$OBJ?.symbol?.()`).

---

### Callees Mode

### REQ-SA-CALLEES-001: Basic Callee Discovery

When `mode` is `callees`, the tool shall find all call expressions inside the function/method definition matching the given `symbol`.

### REQ-SA-CALLEES-002: Chained Call Deduplication

The tool shall deduplicate chained subcalls by byte-range containment: if call A's source range fully contains call B's source range (B is a subexpression of A), only call A (the outermost) shall be returned.

### REQ-SA-CALLEES-003: Recursive Depth

Where the `depth` parameter is greater than 1, the tool shall recursively trace callees of callees, with cycle detection. Depth default is 1, max is 5.

---

### Definitions Mode

### REQ-SA-DEFS-001: Symbol Definition Discovery

When `mode` is `definitions`, the tool shall find definition sites for the given `symbol` by searching for: method definitions, function declarations, class declarations, interface declarations, type alias declarations, and const/variable declarators whose name matches the symbol.

---

### Hierarchy Mode

### REQ-SA-HIER-001: Upward Hierarchy

When `mode` is `hierarchy`, the tool shall find what the given class extends and what interfaces it implements.

### REQ-SA-HIER-002: Downward Hierarchy

When `mode` is `hierarchy`, the tool shall find all classes that extend or implement the given symbol.

---

### References Mode

### REQ-SA-REFS-001: Categorized References

When `mode` is `references`, the tool shall find all structural references to the given symbol, categorized into: method calls on instances, direct calls, instantiations, type annotations, extends/implements, and imports. Each category shall include a match count.

### REQ-SA-REFS-002: Instance Method Call Heuristic

For the "method calls on instances" category, the tool shall match calls on variables whose identifier name contains the symbol (case-insensitive substring match). This is a heuristic because ast-grep cannot resolve types. The output shall label this category to indicate it is heuristic-based.

### REQ-SA-REFS-003: Deduplication

The tool shall deduplicate results by file and line number within each category.

---

### Dependencies Mode

### REQ-SA-DEPS-001: Import Graph

When `mode` is `dependencies`, the tool shall find all imports in the target file/directory, including: named imports, default imports, namespace imports, side-effect imports, dynamic imports, and re-exports. For TypeScript/JavaScript only, the tool shall also match CommonJS `require()` calls.

### REQ-SA-DEPS-002: Reverse Dependencies

Where the `reverse` parameter is true, the tool shall also find all files in the workspace that import the target file.

---

### Exports Mode

### REQ-SA-EXPORTS-001: Export Discovery

When `mode` is `exports`, the tool shall list all exported symbols from the target file, including exported classes, functions, constants, interfaces, types, default exports, and re-exports.

---

## REQ-INFRA: Infrastructure Requirements

### REQ-INFRA-001: AST Engine Integration

The tools shall use `@ast-grep/napi` (the Node.js native bindings) as the primary ast-grep integration, sharing the engine with the existing `ast_edit` and `ast_read_file` tools in `packages/core/src/tools/ast-edit.ts`. Where `@ast-grep/napi` is unavailable, the `sg` CLI binary may be used as a fallback.

### REQ-INFRA-002: Shared AST Utilities

AST operations common to `ast_grep`, `structural_analysis`, `ast_edit`, and `ast_read_file` (language registration, query execution, error normalization) shall be factored into a shared utility module to avoid duplication and drift.

### REQ-INFRA-003: Graceful Degradation

If neither `@ast-grep/napi` nor the `sg` CLI is available, both tools shall be excluded from the tool registry (not registered) rather than registered and failing at runtime.

### REQ-INFRA-004: Tool Defaults

The tools shall have entries in the tool defaults configuration, following the pattern of existing tools (enable/disable, description override).

### REQ-INFRA-005: No Test File Dependency

The tools shall not depend on any test infrastructure for production functionality. Test files shall be separate from implementation files.

### REQ-INFRA-006: Timeouts

The `ast_grep` tool shall enforce a timeout of 30 seconds per invocation. The `structural_analysis` tool shall enforce a timeout of 60 seconds per invocation. When a timeout is reached, the tool shall return whatever results have been collected with `truncated: true` and a timeout indication.

### REQ-INFRA-007: Existing Tool Compatibility

The new tools shall not modify the behavior or registration of any existing tool. They shall coexist with `search_file_content`, `ast_edit`, `ast_read_file`, and all other registered tools.
