author:	acoliver
association:	member
edited:	false
status:	none
--
@coderabbit plan this and let's get specific on the interfaces
--
author:	coderabbitai
association:	contributor
edited:	false
status:	none
--
<!-- This is an auto-generated reply by CodeRabbit -->
## Coding Plan

### Summary

- Define abstraction interfaces in packages/tools that specify contracts for configuration, messaging, and services — core implements these interfaces, breaking the circular `Config ↔ ToolRegistry` dependency
- Move tools incrementally: pure types first, then base classes, then registry, then individual tools grouped by complexity
- Tools with deep core dependencies (shell, task) accept injected service interfaces rather than importing core modules directly
- Core re-exports all tool types for backward compatibility, so existing consumers continue working without changes

<details>
<summary><b>Design Choices</b></summary>

<details>
<summary><b>Design Choice 1: How to handle the Config ↔ ToolRegistry circular dependency?</b></summary>



**Options Considered:**
1. Define abstraction interfaces in packages/tools (e.g., `IToolRegistryHost`) that capture what ToolRegistry needs from Config; core implements these interfaces
2. Use TypeScript `import type` for type-only dependencies and inject runtime dependencies
3. Create a shared packages/common for types used by both

**Chosen Option:** 1

**Rationale:** Option 1 — Define interfaces in packages/tools that specify the contract for configuration, governance, and messaging; core's Config implements these interfaces. This provides the cleanest separation with explicit contracts and no circular package dependencies.

</details>

<details>
<summary><b>Design Choice 2: What to do with MCP-related tools?</b></summary>



**Options Considered:**
1. Move all MCP tools to packages/tools
2. Keep MCP client/manager in core, move only mcp-tool.ts
3. Keep all MCP-related files in core for now

**Chosen Option:** 2

**Rationale:** Option 2 — Move `mcp-tool.ts` (the tool wrapper) to packages/tools since it only needs type-level dependencies. Keep `mcp-client.ts` and `mcp-client-manager.ts` in core due to heavy auth provider coupling; these can be extracted later with packages/mcp.

</details>

<details>
<summary><b>Design Choice 3: How to handle tools with deep core dependencies (task.ts, shell.ts)?</b></summary>



**Options Considered:**
1. Move tools and define interfaces for all their dependencies
2. Keep heavily-coupled tools in core
3. Move tool classes but have them accept injected service interfaces

**Chosen Option:** 3

**Rationale:** Option 3 — Move tool classes to packages/tools but define service interfaces (e.g., `ISubagentLauncher`, `IShellExecutor`) that encapsulate the complex operations. Core provides implementations of these interfaces when instantiating tools.

</details>

</details>

<b>💡 User Tips</b>

Regenerate the plan with different choices with `@coderabbitai <feedback>`.


## Implementation Steps


### Phase 1: Package Structure and Interface Definitions

Create the new packages/tools package with proper build configuration and define the abstraction interfaces needed to break circular dependencies with core.


<details>
<summary><b>Task 1: Create packages/tools Package Structure</b></summary>

Set up the new package with standard build configuration following existing patterns.

- Create `packages/tools/package.json` following the core package pattern with name `@vybestack/llxprt-code-tools`, ESM module type, `dist/` output, and `build_package.js` build script
- Create `packages/tools/tsconfig.json` extending root config with `composite: true`, `outDir: dist`, and self-referential path alias
- Create `packages/tools/src/` directory structure mirroring the organization in `core/src/tools/`
- Create `packages/tools/src/index.ts` as the public export barrel
- Add `packages/tools` to root `package.json` workspaces array

</details>


<details>
<summary><b>Task 2: Define Core Abstraction Interfaces</b></summary>

Create interfaces that define what tools and ToolRegistry need from external systems, enabling dependency injection without circular imports.

- Create `packages/tools/src/interfaces/` directory for abstraction interfaces
- Define `IToolRegistryHost` interface capturing what ToolRegistry needs: `getEphemeralSettings()`, `getExcludeTools()`, `getToolDiscoveryCommand()`, `getToolCallCommand()`, tool governance methods
- Define `IToolMessageBus` interface with the confirmation/approval methods tools need (subset of MessageBus functionality)
- Define `IToolHost` interface for individual tools capturing common Config methods they require (workspace paths, approval modes)
- Define service interfaces for complex operations: `ISubagentLauncher` for task.ts, `IShellExecutor` for shell.ts, `IStorageProvider` for memoryTool.ts
- Export all interfaces from `packages/tools/src/index.ts`

</details>


<details>
<summary><b>🤖 Prompt for AI agents</b></summary>

```
Create the `packages/tools` package scaffold and define all abstraction
interfaces needed to break the circular `Config ↔ ToolRegistry` dependency. The
goal is to establish the package structure and explicit contracts before any
code is migrated.

**Package Setup:**
- Create `packages/tools/package.json` with name `@vybestack/llxprt-code-tools`,
ESM module type (`"type": "module"`), `dist/` output, and a `build_package.js`
build script — follow the existing `packages/core/package.json` as the pattern
- Create `packages/tools/tsconfig.json` extending the root config with
`composite: true`, `outDir: dist`, and a self-referential path alias
- Create the `packages/tools/src/` directory structure mirroring
`core/src/tools/`
- Create `packages/tools/src/index.ts` as the public export barrel (initially
empty or with placeholder exports)
- Add `packages/tools` to the root `package.json` workspaces array

**Interface Definitions (`packages/tools/src/interfaces/`):**
- `IToolRegistryHost`: methods `getEphemeralSettings()`, `getExcludeTools()`,
`getToolDiscoveryCommand()`, `getToolCallCommand()`, and any tool governance
methods currently consumed from `Config` in `tool-registry.ts`
- `IToolMessageBus`: the subset of `MessageBus` confirmation/approval methods
used by tools
- `IToolHost`: common `Config` methods consumed by individual tools — workspace
paths, approval modes, etc.
- Service interfaces for complex operations:
  - `ISubagentLauncher` (for `task.ts`)
  - `IShellExecutor` (for `shell.ts`)
  - `IStorageProvider` (for `memoryTool.ts`)
- Export all interfaces from `packages/tools/src/index.ts`
```

</details>




### Phase 2: Core Tool Infrastructure Migration

Move the foundational tool classes, types, and registry to the new package while maintaining interface-based dependencies.


<details>
<summary><b>Task 1: Move Pure Types and Constants</b></summary>

Migrate files with no external dependencies first.

- Move `tool-context.ts` to `packages/tools/src/` (zero external dependencies, straightforward copy)
- Move `tool-names.ts` to `packages/tools/src/` (tool name constants and ToolName union type)
- Move `tool-error.ts` to `packages/tools/src/` (ToolErrorType enum)
- Move `tool-confirmation-types.ts` to `packages/tools/src/` (confirmation outcome types)
- Move `toolNameUtils.ts` to `packages/tools/src/` (name normalization utilities)
- Update internal imports within moved files to use relative paths

</details>


<details>
<summary><b>Task 2: Move Tool Base Classes and Result Types</b></summary>

Migrate the core tool abstractions that all tools inherit from.

- Move `tools.ts` to `packages/tools/src/` containing `ToolBuilder`, `DeclarativeTool`, `BaseDeclarativeTool`, `BaseTool`, `BaseToolInvocation`, `ToolResult`, `Kind` enum
- Update imports in `tools.ts` to use local interfaces (`IToolMessageBus`) instead of importing MessageBus from core
- Move `IToolFormatter.ts` and `ToolFormatter.ts` to `packages/tools/src/`
- Move `ToolIdStrategy.ts` to `packages/tools/src/`
- Move `modifiable-tool.ts` to `packages/tools/src/`
- Ensure all type imports use the defined interfaces rather than core types

</details>


<details>
<summary><b>Task 3: Move Tool Registry</b></summary>

Migrate ToolRegistry with interface-based configuration dependency.

- Move `tool-registry.ts` to `packages/tools/src/`
- Refactor `ToolRegistry` constructor to accept `IToolRegistryHost` instead of concrete `Config`
- Update internal references to use interface methods for governance checks
- Keep `DiscoveredTool` class in the same file (it's coupled to registry)
- Move `tool-key-storage.ts` to `packages/tools/src/`
- Update all imports to use local modules and defined interfaces

</details>


<details>
<summary><b>🤖 Prompt for AI agents</b></summary>

```
Migrate the foundational tool infrastructure — pure types, base classes, and the
ToolRegistry — from `packages/core/src/tools/` into `packages/tools/src/`. The
goal is to move these files in dependency order (types first, then base classes,
then registry) and replace any direct `Config`/`MessageBus` imports with the
abstraction interfaces defined in Phase 1.

**Step 1 — Pure Types and Constants (no external deps):**
- Copy these files to `packages/tools/src/` and update internal relative
imports:
- `tool-context.ts`, `tool-names.ts`, `tool-error.ts`,
`tool-confirmation-types.ts`, `toolNameUtils.ts`

**Step 2 — Base Classes and Result Types:**
- Move `tools.ts` (contains `ToolBuilder`, `DeclarativeTool`,
`BaseDeclarativeTool`, `BaseTool`, `BaseToolInvocation`, `ToolResult`, `Kind`
enum) to `packages/tools/src/`
- Replace any import of `MessageBus` from core with `IToolMessageBus` from the
local interfaces
- Move `IToolFormatter.ts`, `ToolFormatter.ts`, `ToolIdStrategy.ts`, and
`modifiable-tool.ts` to `packages/tools/src/`
- Ensure all type imports reference the locally defined interfaces, not core
types

**Step 3 — Tool Registry:**
- Move `tool-registry.ts` to `packages/tools/src/`
- Refactor `ToolRegistry` constructor to accept `IToolRegistryHost` instead of
the concrete `Config` class
- Update all internal governance checks to use `IToolRegistryHost` interface
methods
  - Keep `DiscoveredTool` class co-located in the same file
- Move `tool-key-storage.ts` to `packages/tools/src/`
- Update all imports across moved files to reference local modules and defined
interfaces only
```

</details>




### Phase 3: Tool Implementation Migration

Move individual tool implementations, adapting those with complex dependencies to use injected service interfaces.


<details>
<summary><b>Task 1: Move Standalone Tools</b></summary>

Migrate tools with minimal external dependencies.

- Move file-system tools: `read-file.ts`, `read-many-files.ts`, `read_line_range.ts`, `write-file.ts`, `ls.ts`, `glob.ts`
- Move search tools: `grep.ts`, `ripGrep.ts`, `codesearch.ts`, `ast-grep.ts`
- Move edit tools: `edit.ts`, `insert_at_line.ts`, `delete_line_range.ts`, `apply-patch.ts`
- Move supporting edit utilities: `diffOptions.ts`, `fuzzy-replacer.ts`, `ensure-dirs.ts`
- Update constructors to accept `IToolHost` instead of concrete Config where applicable
- Ensure imports reference local types and interfaces

</details>


<details>
<summary><b>Task 2: Move AST Edit Subsystem</b></summary>

Migrate the ast-edit directory as a cohesive unit.

- Move entire `ast-edit/` directory to `packages/tools/src/ast-edit/`
- Update internal imports within ast-edit files to use relative paths
- Ensure `ast-edit-invocation.ts`, `ast-read-file-invocation.ts`, and related files compile against local interfaces
- Move `structural-analysis.ts` alongside ast-edit tools

</details>


<details>
<summary><b>Task 3: Move Tools with Service Dependencies</b></summary>

Migrate tools that require injected services for complex operations.

- Move `shell.ts` to packages/tools; refactor to accept `IShellExecutor` service interface instead of directly importing shellExecutionService
- Move `memoryTool.ts` to packages/tools; refactor to accept `IStorageProvider` interface instead of importing Storage directly
- Move `task.ts` to packages/tools; refactor to accept `ISubagentLauncher` interface encapsulating SubagentOrchestrator, SubagentManager, ProfileManager interactions
- Move `list-subagents.ts` and `check-async-tasks.ts` with appropriate service interfaces

</details>


<details>
<summary><b>Task 4: Move Web and Todo Tools</b></summary>

Migrate remaining tool implementations.

- Move web tools: `google-web-search.ts`, `exa-web-search.ts`, `google-web-fetch.ts`, `direct-web-fetch.ts`
- Move todo system: `todo-read.ts`, `todo-write.ts`, `todo-pause.ts`, `todo-store.ts`, `todo-schemas.ts`, `todo-events.ts`
- Move `mcp-tool.ts` (the tool wrapper, not mcp-client) with interface-based MessageBus dependency
- Move `activate-skill.ts` with appropriate interface abstraction

</details>


<details>
<summary><b>🤖 Prompt for AI agents</b></summary>

```
Migrate all individual tool implementations from `packages/core/src/tools/` to
`packages/tools/src/`, grouping them by dependency complexity. Replace any
direct imports of `Config`, `MessageBus`, or core services with the abstraction
interfaces from Phase 1.

**Step 1 — Standalone Tools (minimal external deps):**
- File-system tools: `read-file.ts`, `read-many-files.ts`, `read_line_range.ts`,
`write-file.ts`, `ls.ts`, `glob.ts`
- Search tools: `grep.ts`, `ripGrep.ts`, `codesearch.ts`, `ast-grep.ts`
- Edit tools: `edit.ts`, `insert_at_line.ts`, `delete_line_range.ts`,
`apply-patch.ts`
- Edit utilities: `diffOptions.ts`, `fuzzy-replacer.ts`, `ensure-dirs.ts`
- Update constructors to accept `IToolHost` instead of concrete `Config` where
applicable
- Ensure all imports reference local types and interfaces

**Step 2 — AST Edit Subsystem (cohesive unit):**
- Move the entire `ast-edit/` directory to `packages/tools/src/ast-edit/`
- Update all internal relative imports within the `ast-edit/` files
- Ensure `ast-edit-invocation.ts`, `ast-read-file-invocation.ts`, and related
files compile against local interfaces
- Move `structural-analysis.ts` alongside the ast-edit tools

**Step 3 — Tools with Service Dependencies:**
- `shell.ts`: refactor to accept `IShellExecutor` instead of directly importing
`shellExecutionService`
- `memoryTool.ts`: refactor to accept `IStorageProvider` instead of importing
`Storage` directly
- `task.ts`: refactor to accept `ISubagentLauncher` encapsulating
`SubagentOrchestrator`, `SubagentManager`, and `ProfileManager` interactions
- `list-subagents.ts` and `check-async-tasks.ts`: move with appropriate service
interfaces

**Step 4 — Web and Todo Tools:**
- Web tools: `google-web-search.ts`, `exa-web-search.ts`, `google-web-fetch.ts`,
`direct-web-fetch.ts`
- Todo system: `todo-read.ts`, `todo-write.ts`, `todo-pause.ts`,
`todo-store.ts`, `todo-schemas.ts`, `todo-events.ts`
- `mcp-tool.ts` (the tool wrapper only — do NOT move `mcp-client.ts` or
`mcp-client-manager.ts`): use interface-based `IToolMessageBus` dependency
- `activate-skill.ts`: use appropriate interface abstraction
```

</details>




### Phase 4: Integration and Consumer Updates

Update core and CLI to use the new packages/tools, implement required interfaces, and ensure all tests pass.


<details>
<summary><b>Task 1: Implement Interfaces in Core</b></summary>

Create concrete implementations of the tool interfaces in packages/core.

- Create adapter classes in `packages/core/src/tools/` that implement tool interfaces using existing core functionality
- Implement `IToolRegistryHost` adapter wrapping Config methods
- Implement `IToolMessageBus` adapter wrapping MessageBus
- Implement service interfaces: `ISubagentLauncher`, `IShellExecutor`, `IStorageProvider` wrapping existing services
- Export adapters from core's public API

</details>


<details>
<summary><b>Task 2: Update Tool Registration in Core</b></summary>

Refactor toolRegistryFactory to import tools from the new package and wire up dependencies.

- Update `packages/core/src/config/toolRegistryFactory.ts` to import tool classes from `@vybestack/llxprt-code-tools`
- Update tool instantiation to pass interface implementations (adapters) instead of raw Config
- Add `@vybestack/llxprt-code-tools` as a dependency in `packages/core/package.json` using `file:../tools`
- Update `packages/core/tsconfig.json` with path mapping and project reference to packages/tools

</details>


<details>
<summary><b>Task 3: Update Core Exports and Imports</b></summary>

Update core's public API and internal imports to re-export from packages/tools.

- Update `packages/core/src/index.ts` to re-export tool types, classes, and registry from `@vybestack/llxprt-code-tools`
- Remove original tool files from `packages/core/src/tools/` (keep only adapter implementations and MCP client files)
- Update any internal core imports that referenced moved files
- Ensure backward compatibility for existing consumers importing from `@vybestack/llxprt-code-core`

</details>


<details>
<summary><b>Task 4: Update CLI and Other Consumers</b></summary>

Update remaining packages that import tool-related code.

- Verify `packages/cli` imports continue working via core re-exports (no direct changes needed if re-exports are complete)
- Update any direct tool imports in `packages/a2a-server` if present
- Update `packages/vscode-ide-companion` if it imports tool types directly
- Run full test suite across all packages to identify any broken imports

</details>


<details>
<summary><b>Task 5: Migrate and Verify Tests</b></summary>

Move tool tests to the new package and ensure all tests pass.

- Move test files from `packages/core/src/tools/*.test.ts` to `packages/tools/src/`
- Update test imports to use local modules and mocked interfaces
- Create test fixtures and mocks for interface implementations
- Run `npm test` in packages/tools to verify isolated tests pass
- Run full workspace tests (`npm run test:ci` at root) to verify integration

</details>


<details>
<summary><b>🤖 Prompt for AI agents</b></summary>

```
Wire up the new `packages/tools` package into core and all downstream consumers,
implement the abstraction interfaces in core, and verify the full test suite
passes. The goal is to complete the integration without breaking existing
consumers.

**Step 1 — Implement Interfaces in Core (`packages/core/src/tools/`):**
- Create adapter classes implementing the tool interfaces using existing core
functionality:
  - `IToolRegistryHost` adapter wrapping `Config` methods
  - `IToolMessageBus` adapter wrapping `MessageBus`
- `ISubagentLauncher`, `IShellExecutor`, `IStorageProvider` adapters wrapping
existing services
- Export adapters from core's public API

**Step 2 — Update Tool Registration:**
- Update `packages/core/src/config/toolRegistryFactory.ts` to import tool
classes from `@vybestack/llxprt-code-tools`
- Update tool instantiation to pass adapter implementations instead of raw
`Config`
- Add `@vybestack/llxprt-code-tools` as a dependency in
`packages/core/package.json` using `file:../tools`
- Update `packages/core/tsconfig.json` with the path mapping and project
reference to `packages/tools`

**Step 3 — Update Core Exports:**
- Update `packages/core/src/index.ts` to re-export tool types, classes, and
registry from `@vybestack/llxprt-code-tools`
- Remove original tool files from `packages/core/src/tools/` (keep only adapter
implementations and MCP client files: `mcp-client.ts`, `mcp-client-manager.ts`)
- Update any internal core imports that previously referenced moved files
- Ensure backward compatibility for existing consumers importing from
`@vybestack/llxprt-code-core`

**Step 4 — Update CLI and Other Consumers:**
- Verify `packages/cli` imports continue working through core re-exports (no
direct changes expected if re-exports are complete)
- Update any direct tool imports in `packages/a2a-server` if present
- Update `packages/vscode-ide-companion` if it imports tool types directly
- Run full test suite across all packages to identify any broken imports

**Step 5 — Migrate and Verify Tests:**
- Move test files from `packages/core/src/tools/*.test.ts` to
`packages/tools/src/`
- Update test imports to use local modules and mocked interfaces
- Create test fixtures and mocks for interface implementations
- Run `npm test` in `packages/tools` to verify isolated tests pass
- Run `npm run test:ci` at root to verify full workspace integration
```

</details>

<details>
<summary><b>Research</b></summary>

The codebase is a TypeScript monorepo with ESM modules using workspace dependencies. Tools currently live in `packages/core/src/tools/` with ~100 files including base classes (`tools.ts`), the `ToolRegistry`, individual tool implementations (read-file, shell, grep, edit, mcp-*, task, etc.), and supporting utilities. The critical architectural challenge is a circular dependency between `Config` (in `core/config/`) and `ToolRegistry` (in `core/tools/`) — Config imports ToolRegistry during initialization, and ToolRegistry imports Config for governance. Tool implementations also depend on `MessageBus` for confirmation flow and various Config methods. The extraction requires defining abstraction interfaces in the new package that core can implement, breaking the circular dependency.

</details>


---



### 🚀 Next Steps


<details>
<summary><b>🤖 All AI agent prompts combined</b></summary>

```
Task: 1

Create the `packages/tools` package scaffold and define all abstraction
interfaces needed to break the circular `Config ↔ ToolRegistry` dependency. The
goal is to establish the package structure and explicit contracts before any
code is migrated.

**Package Setup:**
- Create `packages/tools/package.json` with name `@vybestack/llxprt-code-tools`,
ESM module type (`"type": "module"`), `dist/` output, and a `build_package.js`
build script — follow the existing `packages/core/package.json` as the pattern
- Create `packages/tools/tsconfig.json` extending the root config with
`composite: true`, `outDir: dist`, and a self-referential path alias
- Create the `packages/tools/src/` directory structure mirroring
`core/src/tools/`
- Create `packages/tools/src/index.ts` as the public export barrel (initially
empty or with placeholder exports)
- Add `packages/tools` to the root `package.json` workspaces array

**Interface Definitions (`packages/tools/src/interfaces/`):**
- `IToolRegistryHost`: methods `getEphemeralSettings()`, `getExcludeTools()`,
`getToolDiscoveryCommand()`, `getToolCallCommand()`, and any tool governance
methods currently consumed from `Config` in `tool-registry.ts`
- `IToolMessageBus`: the subset of `MessageBus` confirmation/approval methods
used by tools
- `IToolHost`: common `Config` methods consumed by individual tools — workspace
paths, approval modes, etc.
- Service interfaces for complex operations:
  - `ISubagentLauncher` (for `task.ts`)
  - `IShellExecutor` (for `shell.ts`)
  - `IStorageProvider` (for `memoryTool.ts`)
- Export all interfaces from `packages/tools/src/index.ts`
===============================================================================

Task: 2

Migrate the foundational tool infrastructure — pure types, base classes, and the
ToolRegistry — from `packages/core/src/tools/` into `packages/tools/src/`. The
goal is to move these files in dependency order (types first, then base classes,
then registry) and replace any direct `Config`/`MessageBus` imports with the
abstraction interfaces defined in Phase 1.

**Step 1 — Pure Types and Constants (no external deps):**
- Copy these files to `packages/tools/src/` and update internal relative
imports:
- `tool-context.ts`, `tool-names.ts`, `tool-error.ts`,
`tool-confirmation-types.ts`, `toolNameUtils.ts`

**Step 2 — Base Classes and Result Types:**
- Move `tools.ts` (contains `ToolBuilder`, `DeclarativeTool`,
`BaseDeclarativeTool`, `BaseTool`, `BaseToolInvocation`, `ToolResult`, `Kind`
enum) to `packages/tools/src/`
- Replace any import of `MessageBus` from core with `IToolMessageBus` from the
local interfaces
- Move `IToolFormatter.ts`, `ToolFormatter.ts`, `ToolIdStrategy.ts`, and
`modifiable-tool.ts` to `packages/tools/src/`
- Ensure all type imports reference the locally defined interfaces, not core
types

**Step 3 — Tool Registry:**
- Move `tool-registry.ts` to `packages/tools/src/`
- Refactor `ToolRegistry` constructor to accept `IToolRegistryHost` instead of
the concrete `Config` class
- Update all internal governance checks to use `IToolRegistryHost` interface
methods
  - Keep `DiscoveredTool` class co-located in the same file
- Move `tool-key-storage.ts` to `packages/tools/src/`
- Update all imports across moved files to reference local modules and defined
interfaces only
===============================================================================

Task: 3

Migrate all individual tool implementations from `packages/core/src/tools/` to
`packages/tools/src/`, grouping them by dependency complexity. Replace any
direct imports of `Config`, `MessageBus`, or core services with the abstraction
interfaces from Phase 1.

**Step 1 — Standalone Tools (minimal external deps):**
- File-system tools: `read-file.ts`, `read-many-files.ts`, `read_line_range.ts`,
`write-file.ts`, `ls.ts`, `glob.ts`
- Search tools: `grep.ts`, `ripGrep.ts`, `codesearch.ts`, `ast-grep.ts`
- Edit tools: `edit.ts`, `insert_at_line.ts`, `delete_line_range.ts`,
`apply-patch.ts`
- Edit utilities: `diffOptions.ts`, `fuzzy-replacer.ts`, `ensure-dirs.ts`
- Update constructors to accept `IToolHost` instead of concrete `Config` where
applicable
- Ensure all imports reference local types and interfaces

**Step 2 — AST Edit Subsystem (cohesive unit):**
- Move the entire `ast-edit/` directory to `packages/tools/src/ast-edit/`
- Update all internal relative imports within the `ast-edit/` files
- Ensure `ast-edit-invocation.ts`, `ast-read-file-invocation.ts`, and related
files compile against local interfaces
- Move `structural-analysis.ts` alongside the ast-edit tools

**Step 3 — Tools with Service Dependencies:**
- `shell.ts`: refactor to accept `IShellExecutor` instead of directly importing
`shellExecutionService`
- `memoryTool.ts`: refactor to accept `IStorageProvider` instead of importing
`Storage` directly
- `task.ts`: refactor to accept `ISubagentLauncher` encapsulating
`SubagentOrchestrator`, `SubagentManager`, and `ProfileManager` interactions
- `list-subagents.ts` and `check-async-tasks.ts`: move with appropriate service
interfaces

**Step 4 — Web and Todo Tools:**
- Web tools: `google-web-search.ts`, `exa-web-search.ts`, `google-web-fetch.ts`,
`direct-web-fetch.ts`
- Todo system: `todo-read.ts`, `todo-write.ts`, `todo-pause.ts`,
`todo-store.ts`, `todo-schemas.ts`, `todo-events.ts`
- `mcp-tool.ts` (the tool wrapper only — do NOT move `mcp-client.ts` or
`mcp-client-manager.ts`): use interface-based `IToolMessageBus` dependency
- `activate-skill.ts`: use appropriate interface abstraction
===============================================================================

Task: 4

Wire up the new `packages/tools` package into core and all downstream consumers,
implement the abstraction interfaces in core, and verify the full test suite
passes. The goal is to complete the integration without breaking existing
consumers.

**Step 1 — Implement Interfaces in Core (`packages/core/src/tools/`):**
- Create adapter classes implementing the tool interfaces using existing core
functionality:
  - `IToolRegistryHost` adapter wrapping `Config` methods
  - `IToolMessageBus` adapter wrapping `MessageBus`
- `ISubagentLauncher`, `IShellExecutor`, `IStorageProvider` adapters wrapping
existing services
- Export adapters from core's public API

**Step 2 — Update Tool Registration:**
- Update `packages/core/src/config/toolRegistryFactory.ts` to import tool
classes from `@vybestack/llxprt-code-tools`
- Update tool instantiation to pass adapter implementations instead of raw
`Config`
- Add `@vybestack/llxprt-code-tools` as a dependency in
`packages/core/package.json` using `file:../tools`
- Update `packages/core/tsconfig.json` with the path mapping and project
reference to `packages/tools`

**Step 3 — Update Core Exports:**
- Update `packages/core/src/index.ts` to re-export tool types, classes, and
registry from `@vybestack/llxprt-code-tools`
- Remove original tool files from `packages/core/src/tools/` (keep only adapter
implementations and MCP client files: `mcp-client.ts`, `mcp-client-manager.ts`)
- Update any internal core imports that previously referenced moved files
- Ensure backward compatibility for existing consumers importing from
`@vybestack/llxprt-code-core`

**Step 4 — Update CLI and Other Consumers:**
- Verify `packages/cli` imports continue working through core re-exports (no
direct changes expected if re-exports are complete)
- Update any direct tool imports in `packages/a2a-server` if present
- Update `packages/vscode-ide-companion` if it imports tool types directly
- Run full test suite across all packages to identify any broken imports

**Step 5 — Migrate and Verify Tests:**
- Move test files from `packages/core/src/tools/*.test.ts` to
`packages/tools/src/`
- Update test imports to use local modules and mocked interfaces
- Create test fixtures and mocks for interface implementations
- Run `npm test` in `packages/tools` to verify isolated tests pass
- Run `npm run test:ci` at root to verify full workspace integration
```

</details>


<details>
<summary><b>💡 Iterate on the plan with:
<code>@coderabbitai &lt;feedback&gt;</code>
</b></summary>

```
Example Feedback
- `@coderabbitai` You can skip phase 3. Add a simple unit test case for phase 2.
- `@coderabbitai` For design choice 1 go ahead with option 3 and replan.
```

</details>


---



💬 Have feedback or questions? Drop into our [discord](https://discord.gg/coderabbit)!



<!-- <agentComponentType>plan-edits</agentComponentType> -->

<!-- <rawResChunk><planningResult>## Coding Plan

### Summary

- Define abstraction interfaces in packages/tools that specify contracts for configuration, messaging, and services — core implements these interfaces, breaking the circular `Config ↔ ToolRegistry` dependency
- Move tools incrementally: pure types first, then base classes, then registry, then individual tools grouped by complexity
- Tools with deep core dependencies (shell, task) accept injected service interfaces rather than importing core modules directly
- Core re-exports all tool types for backward compatibility, so existing consumers continue working without changes

<details>
<summary><b>Design Choices</b></summary>

<details>
<summary><b>Design Choice 1: How to handle the Config ↔ ToolRegistry circular dependency?</b></summary>



**Options Considered:**
1. Define abstraction interfaces in packages/tools (e.g., `IToolRegistryHost`) that capture what ToolRegistry needs from Config; core implements these interfaces
2. Use TypeScript `import type` for type-only dependencies and inject runtime dependencies
3. Create a shared packages/common for types used by both

**Chosen Option:** 1

**Rationale:** Option 1 — Define interfaces in packages/tools that specify the contract for configuration, governance, and messaging; core's Config implements these interfaces. This provides the cleanest separation with explicit contracts and no circular package dependencies.

</details>

<details>
<summary><b>Design Choice 2: What to do with MCP-related tools?</b></summary>



**Options Considered:**
1. Move all MCP tools to packages/tools
2. Keep MCP client/manager in core, move only mcp-tool.ts
3. Keep all MCP-related files in core for now

**Chosen Option:** 2

**Rationale:** Option 2 — Move `mcp-tool.ts` (the tool wrapper) to packages/tools since it only needs type-level dependencies. Keep `mcp-client.ts` and `mcp-client-manager.ts` in core due to heavy auth provider coupling; these can be extracted later with packages/mcp.

</details>

<details>
<summary><b>Design Choice 3: How to handle tools with deep core dependencies (task.ts, shell.ts)?</b></summary>



**Options Considered:**
1. Move tools and define interfaces for all their dependencies
2. Keep heavily-coupled tools in core
3. Move tool classes but have them accept injected service interfaces

**Chosen Option:** 3

**Rationale:** Option 3 — Move tool classes to packages/tools but define service interfaces (e.g., `ISubagentLauncher`, `IShellExecutor`) that encapsulate the complex operations. Core provides implementations of these interfaces when instantiating tools.

</details>

</details>

<b>💡 User Tips</b>

Regenerate the plan with different choices with `@coderabbitai <feedback>`.


## Implementation Steps


### Phase 1: Package Structure and Interface Definitions

Create the new packages/tools package with proper build configuration and define the abstraction interfaces needed to break circular dependencies with core.


<details>
<summary><b>Task 1: Create packages/tools Package Structure</b></summary>

Set up the new package with standard build configuration following existing patterns.

- Create `packages/tools/package.json` following the core package pattern with name `@vybestack/llxprt-code-tools`, ESM module type, `dist/` output, and `build_package.js` build script
- Create `packages/tools/tsconfig.json` extending root config with `composite: true`, `outDir: dist`, and self-referential path alias
- Create `packages/tools/src/` directory structure mirroring the organization in `core/src/tools/`
- Create `packages/tools/src/index.ts` as the public export barrel
- Add `packages/tools` to root `package.json` workspaces array

</details>


<details>
<summary><b>Task 2: Define Core Abstraction Interfaces</b></summary>

Create interfaces that define what tools and ToolRegistry need from external systems, enabling dependency injection without circular imports.

- Create `packages/tools/src/interfaces/` directory for abstraction interfaces
- Define `IToolRegistryHost` interface capturing what ToolRegistry needs: `getEphemeralSettings()`, `getExcludeTools()`, `getToolDiscoveryCommand()`, `getToolCallCommand()`, tool governance methods
- Define `IToolMessageBus` interface with the confirmation/approval methods tools need (subset of MessageBus functionality)
- Define `IToolHost` interface for individual tools capturing common Config methods they require (workspace paths, approval modes)
- Define service interfaces for complex operations: `ISubagentLauncher` for task.ts, `IShellExecutor` for shell.ts, `IStorageProvider` for memoryTool.ts
- Export all interfaces from `packages/tools/src/index.ts`

</details>


<details>
<summary><b>🤖 Prompt for AI agents</b></summary>

```
Create the `packages/tools` package scaffold and define all abstraction
interfaces needed to break the circular `Config ↔ ToolRegistry` dependency. The
goal is to establish the package structure and explicit contracts before any
code is migrated.

**Package Setup:**
- Create `packages/tools/package.json` with name `@vybestack/llxprt-code-tools`,
ESM module type (`"type": "module"`), `dist/` output, and a `build_package.js`
build script — follow the existing `packages/core/package.json` as the pattern
- Create `packages/tools/tsconfig.json` extending the root config with
`composite: true`, `outDir: dist`, and a self-referential path alias
- Create the `packages/tools/src/` directory structure mirroring
`core/src/tools/`
- Create `packages/tools/src/index.ts` as the public export barrel (initially
empty or with placeholder exports)
- Add `packages/tools` to the root `package.json` workspaces array

**Interface Definitions (`packages/tools/src/interfaces/`):**
- `IToolRegistryHost`: methods `getEphemeralSettings()`, `getExcludeTools()`,
`getToolDiscoveryCommand()`, `getToolCallCommand()`, and any tool governance
methods currently consumed from `Config` in `tool-registry.ts`
- `IToolMessageBus`: the subset of `MessageBus` confirmation/approval methods
used by tools
- `IToolHost`: common `Config` methods consumed by individual tools — workspace
paths, approval modes, etc.
- Service interfaces for complex operations:
  - `ISubagentLauncher` (for `task.ts`)
  - `IShellExecutor` (for `shell.ts`)
  - `IStorageProvider` (for `memoryTool.ts`)
- Export all interfaces from `packages/tools/src/index.ts`
```

</details>




### Phase 2: Core Tool Infrastructure Migration

Move the foundational tool classes, types, and registry to the new package while maintaining interface-based dependencies.


<details>
<summary><b>Task 1: Move Pure Types and Constants</b></summary>

Migrate files with no external dependencies first.

- Move `tool-context.ts` to `packages/tools/src/` (zero external dependencies, straightforward copy)
- Move `tool-names.ts` to `packages/tools/src/` (tool name constants and ToolName union type)
- Move `tool-error.ts` to `packages/tools/src/` (ToolErrorType enum)
- Move `tool-confirmation-types.ts` to `packages/tools/src/` (confirmation outcome types)
- Move `toolNameUtils.ts` to `packages/tools/src/` (name normalization utilities)
- Update internal imports within moved files to use relative paths

</details>


<details>
<summary><b>Task 2: Move Tool Base Classes and Result Types</b></summary>

Migrate the core tool abstractions that all tools inherit from.

- Move `tools.ts` to `packages/tools/src/` containing `ToolBuilder`, `DeclarativeTool`, `BaseDeclarativeTool`, `BaseTool`, `BaseToolInvocation`, `ToolResult`, `Kind` enum
- Update imports in `tools.ts` to use local interfaces (`IToolMessageBus`) instead of importing MessageBus from core
- Move `IToolFormatter.ts` and `ToolFormatter.ts` to `packages/tools/src/`
- Move `ToolIdStrategy.ts` to `packages/tools/src/`
- Move `modifiable-tool.ts` to `packages/tools/src/`
- Ensure all type imports use the defined interfaces rather than core types

</details>


<details>
<summary><b>Task 3: Move Tool Registry</b></summary>

Migrate ToolRegistry with interface-based configuration dependency.

- Move `tool-registry.ts` to `packages/tools/src/`
- Refactor `ToolRegistry` constructor to accept `IToolRegistryHost` instead of concrete `Config`
- Update internal references to use interface methods for governance checks
- Keep `DiscoveredTool` class in the same file (it's coupled to registry)
- Move `tool-key-storage.ts` to `packages/tools/src/`
- Update all imports to use local modules and defined interfaces

</details>


<details>
<summary><b>🤖 Prompt for AI agents</b></summary>

```
Migrate the foundational tool infrastructure — pure types, base classes, and the
ToolRegistry — from `packages/core/src/tools/` into `packages/tools/src/`. The
goal is to move these files in dependency order (types first, then base classes,
then registry) and replace any direct `Config`/`MessageBus` imports with the
abstraction interfaces defined in Phase 1.

**Step 1 — Pure Types and Constants (no external deps):**
- Copy these files to `packages/tools/src/` and update internal relative
imports:
- `tool-context.ts`, `tool-names.ts`, `tool-error.ts`,
`tool-confirmation-types.ts`, `toolNameUtils.ts`

**Step 2 — Base Classes and Result Types:**
- Move `tools.ts` (contains `ToolBuilder`, `DeclarativeTool`,
`BaseDeclarativeTool`, `BaseTool`, `BaseToolInvocation`, `ToolResult`, `Kind`
enum) to `packages/tools/src/`
- Replace any import of `MessageBus` from core with `IToolMessageBus` from the
local interfaces
- Move `IToolFormatter.ts`, `ToolFormatter.ts`, `ToolIdStrategy.ts`, and
`modifiable-tool.ts` to `packages/tools/src/`
- Ensure all type imports reference the locally defined interfaces, not core
types

**Step 3 — Tool Registry:**
- Move `tool-registry.ts` to `packages/tools/src/`
- Refactor `ToolRegistry` constructor to accept `IToolRegistryHost` instead of
the concrete `Config` class
- Update all internal governance checks to use `IToolRegistryHost` interface
methods
  - Keep `DiscoveredTool` class co-located in the same file
- Move `tool-key-storage.ts` to `packages/tools/src/`
- Update all imports across moved files to reference local modules and defined
interfaces only
```

</details>




### Phase 3: Tool Implementation Migration

Move individual tool implementations, adapting those with complex dependencies to use injected service interfaces.


<details>
<summary><b>Task 1: Move Standalone Tools</b></summary>

Migrate tools with minimal external dependencies.

- Move file-system tools: `read-file.ts`, `read-many-files.ts`, `read_line_range.ts`, `write-file.ts`, `ls.ts`, `glob.ts`
- Move search tools: `grep.ts`, `ripGrep.ts`, `codesearch.ts`, `ast-grep.ts`
- Move edit tools: `edit.ts`, `insert_at_line.ts`, `delete_line_range.ts`, `apply-patch.ts`
- Move supporting edit utilities: `diffOptions.ts`, `fuzzy-replacer.ts`, `ensure-dirs.ts`
- Update constructors to accept `IToolHost` instead of concrete Config where applicable
- Ensure imports reference local types and interfaces

</details>


<details>
<summary><b>Task 2: Move AST Edit Subsystem</b></summary>

Migrate the ast-edit directory as a cohesive unit.

- Move entire `ast-edit/` directory to `packages/tools/src/ast-edit/`
- Update internal imports within ast-edit files to use relative paths
- Ensure `ast-edit-invocation.ts`, `ast-read-file-invocation.ts`, and related files compile against local interfaces
- Move `structural-analysis.ts` alongside ast-edit tools

</details>


<details>
<summary><b>Task 3: Move Tools with Service Dependencies</b></summary>

Migrate tools that require injected services for complex operations.

- Move `shell.ts` to packages/tools; refactor to accept `IShellExecutor` service interface instead of directly importing shellExecutionService
- Move `memoryTool.ts` to packages/tools; refactor to accept `IStorageProvider` interface instead of importing Storage directly
- Move `task.ts` to packages/tools; refactor to accept `ISubagentLauncher` interface encapsulating SubagentOrchestrator, SubagentManager, ProfileManager interactions
- Move `list-subagents.ts` and `check-async-tasks.ts` with appropriate service interfaces

</details>


<details>
<summary><b>Task 4: Move Web and Todo Tools</b></summary>

Migrate remaining tool implementations.

- Move web tools: `google-web-search.ts`, `exa-web-search.ts`, `google-web-fetch.ts`, `direct-web-fetch.ts`
- Move todo system: `todo-read.ts`, `todo-write.ts`, `todo-pause.ts`, `todo-store.ts`, `todo-schemas.ts`, `todo-events.ts`
- Move `mcp-tool.ts` (the tool wrapper, not mcp-client) with interface-based MessageBus dependency
- Move `activate-skill.ts` with appropriate interface abstraction

</details>


<details>
<summary><b>🤖 Prompt for AI agents</b></summary>

```
Migrate all individual tool implementations from `packages/core/src/tools/` to
`packages/tools/src/`, grouping them by dependency complexity. Replace any
direct imports of `Config`, `MessageBus`, or core services with the abstraction
interfaces from Phase 1.

**Step 1 — Standalone Tools (minimal external deps):**
- File-system tools: `read-file.ts`, `read-many-files.ts`, `read_line_range.ts`,
`write-file.ts`, `ls.ts`, `glob.ts`
- Search tools: `grep.ts`, `ripGrep.ts`, `codesearch.ts`, `ast-grep.ts`
- Edit tools: `edit.ts`, `insert_at_line.ts`, `delete_line_range.ts`,
`apply-patch.ts`
- Edit utilities: `diffOptions.ts`, `fuzzy-replacer.ts`, `ensure-dirs.ts`
- Update constructors to accept `IToolHost` instead of concrete `Config` where
applicable
- Ensure all imports reference local types and interfaces

**Step 2 — AST Edit Subsystem (cohesive unit):**
- Move the entire `ast-edit/` directory to `packages/tools/src/ast-edit/`
- Update all internal relative imports within the `ast-edit/` files
- Ensure `ast-edit-invocation.ts`, `ast-read-file-invocation.ts`, and related
files compile against local interfaces
- Move `structural-analysis.ts` alongside the ast-edit tools

**Step 3 — Tools with Service Dependencies:**
- `shell.ts`: refactor to accept `IShellExecutor` instead of directly importing
`shellExecutionService`
- `memoryTool.ts`: refactor to accept `IStorageProvider` instead of importing
`Storage` directly
- `task.ts`: refactor to accept `ISubagentLauncher` encapsulating
`SubagentOrchestrator`, `SubagentManager`, and `ProfileManager` interactions
- `list-subagents.ts` and `check-async-tasks.ts`: move with appropriate service
interfaces

**Step 4 — Web and Todo Tools:**
- Web tools: `google-web-search.ts`, `exa-web-search.ts`, `google-web-fetch.ts`,
`direct-web-fetch.ts`
- Todo system: `todo-read.ts`, `todo-write.ts`, `todo-pause.ts`,
`todo-store.ts`, `todo-schemas.ts`, `todo-events.ts`
- `mcp-tool.ts` (the tool wrapper only — do NOT move `mcp-client.ts` or
`mcp-client-manager.ts`): use interface-based `IToolMessageBus` dependency
- `activate-skill.ts`: use appropriate interface abstraction
```

</details>




### Phase 4: Integration and Consumer Updates

Update core and CLI to use the new packages/tools, implement required interfaces, and ensure all tests pass.


<details>
<summary><b>Task 1: Implement Interfaces in Core</b></summary>

Create concrete implementations of the tool interfaces in packages/core.

- Create adapter classes in `packages/core/src/tools/` that implement tool interfaces using existing core functionality
- Implement `IToolRegistryHost` adapter wrapping Config methods
- Implement `IToolMessageBus` adapter wrapping MessageBus
- Implement service interfaces: `ISubagentLauncher`, `IShellExecutor`, `IStorageProvider` wrapping existing services
- Export adapters from core's public API

</details>


<details>
<summary><b>Task 2: Update Tool Registration in Core</b></summary>

Refactor toolRegistryFactory to import tools from the new package and wire up dependencies.

- Update `packages/core/src/config/toolRegistryFactory.ts` to import tool classes from `@vybestack/llxprt-code-tools`
- Update tool instantiation to pass interface implementations (adapters) instead of raw Config
- Add `@vybestack/llxprt-code-tools` as a dependency in `packages/core/package.json` using `file:../tools`
- Update `packages/core/tsconfig.json` with path mapping and project reference to packages/tools

</details>


<details>
<summary><b>Task 3: Update Core Exports and Imports</b></summary>

Update core's public API and internal imports to re-export from packages/tools.

- Update `packages/core/src/index.ts` to re-export tool types, classes, and registry from `@vybestack/llxprt-code-tools`
- Remove original tool files from `packages/core/src/tools/` (keep only adapter implementations and MCP client files)
- Update any internal core imports that referenced moved files
- Ensure backward compatibility for existing consumers importing from `@vybestack/llxprt-code-core`

</details>


<details>
<summary><b>Task 4: Update CLI and Other Consumers</b></summary>

Update remaining packages that import tool-related code.

- Verify `packages/cli` imports continue working via core re-exports (no direct changes needed if re-exports are complete)
- Update any direct tool imports in `packages/a2a-server` if present
- Update `packages/vscode-ide-companion` if it imports tool types directly
- Run full test suite across all packages to identify any broken imports

</details>


<details>
<summary><b>Task 5: Migrate and Verify Tests</b></summary>

Move tool tests to the new package and ensure all tests pass.

- Move test files from `packages/core/src/tools/*.test.ts` to `packages/tools/src/`
- Update test imports to use local modules and mocked interfaces
- Create test fixtures and mocks for interface implementations
- Run `npm test` in packages/tools to verify isolated tests pass
- Run full workspace tests (`npm run test:ci` at root) to verify integration

</details>


<details>
<summary><b>🤖 Prompt for AI agents</b></summary>

```
Wire up the new `packages/tools` package into core and all downstream consumers,
implement the abstraction interfaces in core, and verify the full test suite
passes. The goal is to complete the integration without breaking existing
consumers.

**Step 1 — Implement Interfaces in Core (`packages/core/src/tools/`):**
- Create adapter classes implementing the tool interfaces using existing core
functionality:
  - `IToolRegistryHost` adapter wrapping `Config` methods
  - `IToolMessageBus` adapter wrapping `MessageBus`
- `ISubagentLauncher`, `IShellExecutor`, `IStorageProvider` adapters wrapping
existing services
- Export adapters from core's public API

**Step 2 — Update Tool Registration:**
- Update `packages/core/src/config/toolRegistryFactory.ts` to import tool
classes from `@vybestack/llxprt-code-tools`
- Update tool instantiation to pass adapter implementations instead of raw
`Config`
- Add `@vybestack/llxprt-code-tools` as a dependency in
`packages/core/package.json` using `file:../tools`
- Update `packages/core/tsconfig.json` with the path mapping and project
reference to `packages/tools`

**Step 3 — Update Core Exports:**
- Update `packages/core/src/index.ts` to re-export tool types, classes, and
registry from `@vybestack/llxprt-code-tools`
- Remove original tool files from `packages/core/src/tools/` (keep only adapter
implementations and MCP client files: `mcp-client.ts`, `mcp-client-manager.ts`)
- Update any internal core imports that previously referenced moved files
- Ensure backward compatibility for existing consumers importing from
`@vybestack/llxprt-code-core`

**Step 4 — Update CLI and Other Consumers:**
- Verify `packages/cli` imports continue working through core re-exports (no
direct changes expected if re-exports are complete)
- Update any direct tool imports in `packages/a2a-server` if present
- Update `packages/vscode-ide-companion` if it imports tool types directly
- Run full test suite across all packages to identify any broken imports

**Step 5 — Migrate and Verify Tests:**
- Move test files from `packages/core/src/tools/*.test.ts` to
`packages/tools/src/`
- Update test imports to use local modules and mocked interfaces
- Create test fixtures and mocks for interface implementations
- Run `npm test` in `packages/tools` to verify isolated tests pass
- Run `npm run test:ci` at root to verify full workspace integration
```

</details>

<details>
<summary><b>Research</b></summary>

The codebase is a TypeScript monorepo with ESM modules using workspace dependencies. Tools currently live in `packages/core/src/tools/` with ~100 files including base classes (`tools.ts`), the `ToolRegistry`, individual tool implementations (read-file, shell, grep, edit, mcp-*, task, etc.), and supporting utilities. The critical architectural challenge is a circular dependency between `Config` (in `core/config/`) and `ToolRegistry` (in `core/tools/`) — Config imports ToolRegistry during initialization, and ToolRegistry imports Config for governance. Tool implementations also depend on `MessageBus` for confirmation flow and various Config methods. The extraction requires defining abstraction interfaces in the new package that core can implement, breaking the circular dependency.

</details>


---



### 🚀 Next Steps


<details>
<summary><b>🤖 All AI agent prompts combined</b></summary>

```
Task: 1

Create the `packages/tools` package scaffold and define all abstraction
interfaces needed to break the circular `Config ↔ ToolRegistry` dependency. The
goal is to establish the package structure and explicit contracts before any
code is migrated.

**Package Setup:**
- Create `packages/tools/package.json` with name `@vybestack/llxprt-code-tools`,
ESM module type (`"type": "module"`), `dist/` output, and a `build_package.js`
build script — follow the existing `packages/core/package.json` as the pattern
- Create `packages/tools/tsconfig.json` extending the root config with
`composite: true`, `outDir: dist`, and a self-referential path alias
- Create the `packages/tools/src/` directory structure mirroring
`core/src/tools/`
- Create `packages/tools/src/index.ts` as the public export barrel (initially
empty or with placeholder exports)
- Add `packages/tools` to the root `package.json` workspaces array

**Interface Definitions (`packages/tools/src/interfaces/`):**
- `IToolRegistryHost`: methods `getEphemeralSettings()`, `getExcludeTools()`,
`getToolDiscoveryCommand()`, `getToolCallCommand()`, and any tool governance
methods currently consumed from `Config` in `tool-registry.ts`
- `IToolMessageBus`: the subset of `MessageBus` confirmation/approval methods
used by tools
- `IToolHost`: common `Config` methods consumed by individual tools — workspace
paths, approval modes, etc.
- Service interfaces for complex operations:
  - `ISubagentLauncher` (for `task.ts`)
  - `IShellExecutor` (for `shell.ts`)
  - `IStorageProvider` (for `memoryTool.ts`)
- Export all interfaces from `packages/tools/src/index.ts`
===============================================================================

Task: 2

Migrate the foundational tool infrastructure — pure types, base classes, and the
ToolRegistry — from `packages/core/src/tools/` into `packages/tools/src/`. The
goal is to move these files in dependency order (types first, then base classes,
then registry) and replace any direct `Config`/`MessageBus` imports with the
abstraction interfaces defined in Phase 1.

**Step 1 — Pure Types and Constants (no external deps):**
- Copy these files to `packages/tools/src/` and update internal relative
imports:
- `tool-context.ts`, `tool-names.ts`, `tool-error.ts`,
`tool-confirmation-types.ts`, `toolNameUtils.ts`

**Step 2 — Base Classes and Result Types:**
- Move `tools.ts` (contains `ToolBuilder`, `DeclarativeTool`,
`BaseDeclarativeTool`, `BaseTool`, `BaseToolInvocation`, `ToolResult`, `Kind`
enum) to `packages/tools/src/`
- Replace any import of `MessageBus` from core with `IToolMessageBus` from the
local interfaces
- Move `IToolFormatter.ts`, `ToolFormatter.ts`, `ToolIdStrategy.ts`, and
`modifiable-tool.ts` to `packages/tools/src/`
- Ensure all type imports reference the locally defined interfaces, not core
types

**Step 3 — Tool Registry:**
- Move `tool-registry.ts` to `packages/tools/src/`
- Refactor `ToolRegistry` constructor to accept `IToolRegistryHost` instead of
the concrete `Config` class
- Update all internal governance checks to use `IToolRegistryHost` interface
methods
  - Keep `DiscoveredTool` class co-located in the same file
- Move `tool-key-storage.ts` to `packages/tools/src/`
- Update all imports across moved files to reference local modules and defined
interfaces only
===============================================================================

Task: 3

Migrate all individual tool implementations from `packages/core/src/tools/` to
`packages/tools/src/`, grouping them by dependency complexity. Replace any
direct imports of `Config`, `MessageBus`, or core services with the abstraction
interfaces from Phase 1.

**Step 1 — Standalone Tools (minimal external deps):**
- File-system tools: `read-file.ts`, `read-many-files.ts`, `read_line_range.ts`,
`write-file.ts`, `ls.ts`, `glob.ts`
- Search tools: `grep.ts`, `ripGrep.ts`, `codesearch.ts`, `ast-grep.ts`
- Edit tools: `edit.ts`, `insert_at_line.ts`, `delete_line_range.ts`,
`apply-patch.ts`
- Edit utilities: `diffOptions.ts`, `fuzzy-replacer.ts`, `ensure-dirs.ts`
- Update constructors to accept `IToolHost` instead of concrete `Config` where
applicable
- Ensure all imports reference local types and interfaces

**Step 2 — AST Edit Subsystem (cohesive unit):**
- Move the entire `ast-edit/` directory to `packages/tools/src/ast-edit/`
- Update all internal relative imports within the `ast-edit/` files
- Ensure `ast-edit-invocation.ts`, `ast-read-file-invocation.ts`, and related
files compile against local interfaces
- Move `structural-analysis.ts` alongside the ast-edit tools

**Step 3 — Tools with Service Dependencies:**
- `shell.ts`: refactor to accept `IShellExecutor` instead of directly importing
`shellExecutionService`
- `memoryTool.ts`: refactor to accept `IStorageProvider` instead of importing
`Storage` directly
- `task.ts`: refactor to accept `ISubagentLauncher` encapsulating
`SubagentOrchestrator`, `SubagentManager`, and `ProfileManager` interactions
- `list-subagents.ts` and `check-async-tasks.ts`: move with appropriate service
interfaces

**Step 4 — Web and Todo Tools:**
- Web tools: `google-web-search.ts`, `exa-web-search.ts`, `google-web-fetch.ts`,
`direct-web-fetch.ts`
- Todo system: `todo-read.ts`, `todo-write.ts`, `todo-pause.ts`,
`todo-store.ts`, `todo-schemas.ts`, `todo-events.ts`
- `mcp-tool.ts` (the tool wrapper only — do NOT move `mcp-client.ts` or
`mcp-client-manager.ts`): use interface-based `IToolMessageBus` dependency
- `activate-skill.ts`: use appropriate interface abstraction
===============================================================================

Task: 4

Wire up the new `packages/tools` package into core and all downstream consumers,
implement the abstraction interfaces in core, and verify the full test suite
passes. The goal is to complete the integration without breaking existing
consumers.

**Step 1 — Implement Interfaces in Core (`packages/core/src/tools/`):**
- Create adapter classes implementing the tool interfaces using existing core
functionality:
  - `IToolRegistryHost` adapter wrapping `Config` methods
  - `IToolMessageBus` adapter wrapping `MessageBus`
- `ISubagentLauncher`, `IShellExecutor`, `IStorageProvider` adapters wrapping
existing services
- Export adapters from core's public API

**Step 2 — Update Tool Registration:**
- Update `packages/core/src/config/toolRegistryFactory.ts` to import tool
classes from `@vybestack/llxprt-code-tools`
- Update tool instantiation to pass adapter implementations instead of raw
`Config`
- Add `@vybestack/llxprt-code-tools` as a dependency in
`packages/core/package.json` using `file:../tools`
- Update `packages/core/tsconfig.json` with the path mapping and project
reference to `packages/tools`

**Step 3 — Update Core Exports:**
- Update `packages/core/src/index.ts` to re-export tool types, classes, and
registry from `@vybestack/llxprt-code-tools`
- Remove original tool files from `packages/core/src/tools/` (keep only adapter
implementations and MCP client files: `mcp-client.ts`, `mcp-client-manager.ts`)
- Update any internal core imports that previously referenced moved files
- Ensure backward compatibility for existing consumers importing from
`@vybestack/llxprt-code-core`

**Step 4 — Update CLI and Other Consumers:**
- Verify `packages/cli` imports continue working through core re-exports (no
direct changes expected if re-exports are complete)
- Update any direct tool imports in `packages/a2a-server` if present
- Update `packages/vscode-ide-companion` if it imports tool types directly
- Run full test suite across all packages to identify any broken imports

**Step 5 — Migrate and Verify Tests:**
- Move test files from `packages/core/src/tools/*.test.ts` to
`packages/tools/src/`
- Update test imports to use local modules and mocked interfaces
- Create test fixtures and mocks for interface implementations
- Run `npm test` in `packages/tools` to verify isolated tests pass
- Run `npm run test:ci` at root to verify full workspace integration
```

</details>


<details>
<summary><b>💡 Iterate on the plan with:
<code>@coderabbitai &lt;feedback&gt;</code>
</b></summary>

```
Example Feedback
- `@coderabbitai` You can skip phase 3. Add a simple unit test case for phase 2.
- `@coderabbitai` For design choice 1 go ahead with option 3 and replan.
```

</details>


---



💬 Have feedback or questions? Drop into our [discord](https://discord.gg/coderabbit)!</planningResult></rawResChunk> -->

<!-- <agentComponentType>plan-edits</agentComponentType> -->
--
author:	acoliver
association:	member
edited:	false
status:	none
--
Luther abandoning this issue: workflow failed at step abandon_and_log.
--
author:	acoliver
association:	member
edited:	false
status:	none
--
Luther abandoning this issue: workflow failed at step abandon_and_log.
--
author:	acoliver
association:	member
edited:	false
status:	none
--
The plan must also include modifying the release process, creating a package and adding it to trusted publishes (Even if some of that is manual)
--

## Traceability: Issue Requirements → Plan Phases

| Issue Requirement | Source | Plan Phase(s) | Artifact(s) | Status |
| --- | --- | --- | --- | --- |
| Plan the extraction and be specific on interfaces. | Issue body by acoliver: "plan this and let's get specific on the interfaces" | P00, P00a, P02, P02b, P03-P05a | plan/00-overview.md, analysis/final-architecture.md, analysis/interface-contracts-detailed.md, analysis/integration-contract.md, packages/tools/src/interfaces/** | Covered |
| Define abstraction interfaces in packages/tools so core implements them and breaks Config/ToolRegistry cycles. | CodeRabbit summary/design choice 1 | P02, P02b, P03, P05, P11, P12 | analysis/interface-contracts-detailed.md, analysis/integration-contract.md, packages/tools/src/interfaces/**, packages/core/src/tools-adapters/** | Covered |
| Create packages/tools package scaffold following existing package conventions and add it to workspaces. | CodeRabbit Phase 1 Task 1 | P03, P06-P08a | packages/tools/package.json, packages/tools/tsconfig.json, package.json, package-lock.json, analysis/package-metadata-constraints.md | Covered |
| Define specific service interfaces for tool registry host, message bus, tool host, subagent/task, shell, storage/memory, MCP, IDE/LSP, async tasks, skills, todo, key storage, settings, prompt registry. | CodeRabbit Phase 1 Task 2; issue asks for specific interfaces | P02, P02b, P03-P05a | analysis/interface-contracts-detailed.md, analysis/integration-contract.md, packages/tools/src/interfaces/** | Covered |
| Move pure tool contracts/types/constants before concrete tools. | CodeRabbit Phase 2 Task 1 | P09-P11a | analysis/tool-move-map.md, analysis/dependency-relocation-final.md, moved packages/tools/src files | Covered |
| Move base tool classes, result types, formatters, modifiable tool, and tool ID utilities with local/tools-owned dependencies. | CodeRabbit Phase 2 Task 2 | P09-P11a, P13 | analysis/tool-move-map.md, analysis/consumer-rewrite-map-final.md, packages/tools/src/formatters/** | Covered |
| Move ToolRegistry with interface-based Config/governance dependency. | CodeRabbit Phase 2 Task 3 | P02b, P09-P12a | analysis/integration-contract.md, analysis/tool-move-map.md, toolRegistryFactory integration updates | Covered |
| Tool key storage must not blindly move as a whole; split pure interface/functions to tools while SecureStore-backed implementation remains core until storage package exists. | CodeRabbit mentions moving tool-key-storage; plan/spec refine ownership because SecureStore-backed implementation is core-coupled | P00a, P02b, P09-P12a, P15-P16a | analysis/preflight-results.md, analysis/final-architecture.md, analysis/tool-move-map.md, CoreToolKeyStorageAdapter, retained-file allowlist | Covered with refined resolution |
| Move filesystem, read/write/list/search/edit, AST, structural analysis, web, todo, task/subagent, shell, memory, skill, and related tool implementations using injected interfaces where needed. | CodeRabbit Phase 3 tasks | P09-P11a, P12-P16a | analysis/tool-move-map.md, behavioral tests/fixtures, packages/tools/src/**, packages/core/src/tools-adapters/** | Covered |
| MCP client/manager stay in core; mcp-tool may move only behind an MCP tools-owned interface. | CodeRabbit design choice 2; plan MCP ownership | P00a, P02b, P09-P11a, P15-P16a | analysis/preflight-results.md, analysis/mcp-tool-decision.md, retained-file allowlist, IMcpToolService/CoreMcpToolServiceAdapter if applicable | Covered |
| Shell/task/deep-core-dependent tools should use injected services instead of importing core modules directly. | CodeRabbit design choice 3 | P02b, P04-P05a, P10-P12a | analysis/integration-contract.md, contract tests, packages/tools/src/interfaces/**, packages/core/src/tools-adapters/** | Covered |
| Implement core adapters for tools-owned interfaces and wire toolRegistryFactory to instantiate tools through adapters. | CodeRabbit Phase 4 Tasks 1-2 | P11-P12a | packages/core/src/tools-adapters/**, packages/core/src/config/toolRegistryFactory.ts, integration tests | Covered |
| Update core public exports while avoiding forbidden deep-import shims. | CodeRabbit Phase 4 Task 3; plan no-shim policy | P13-P15a | packages/core/src/index.ts, packages/core/package.json, no-shim scans, analysis/consumer-rewrite-map-final.md | Covered |
| Update CLI, A2A, VS Code companion, providers, and other direct consumers as needed. | CodeRabbit Phase 4 Task 4 | P01, P13-P13a, P16 | analysis/all-tool-consumers.txt, analysis/all-tool-consumers-final.md, analysis/consumer-rewrite-map-final.md, provider/CLI/A2A verification | Covered |
| Move/update tests with behavioral coverage and run workspace verification. | CodeRabbit Phase 4 Task 5 | P04-P05a, P10-P16a | package boundary tests, behavioral regression tests, moved tests/fixtures, verification outputs | Covered |
| Modify release process, create package, and add it to trusted publishes, including manual work where required. | Final acoliver comment | P06-P08a, P14-P14a, P16 | packages/tools/package.json, package-lock.json, .github/workflows/release.yml, .github/workflows/build-sandbox.yml, scripts/tests/release-process.test.js, scripts/build_sandbox.js, Dockerfile, scripts/version.js, scripts/prepare-package.js, scripts/build.js, manual-trusted-publishing.md | Covered |
| Luther abandoning workflow failed at step abandon_and_log. | Two acoliver comments | N/A | N/A | Not an implementation requirement; no plan action required |

### Traceability Exhaustiveness Assessment

No distinct actionable issue requirement was uncovered by the captured issue body/comments. The only non-plan item is the repeated Luther abandonment status comment, which is operational metadata rather than a tools-extraction requirement. One CodeRabbit suggestion to move tool-key-storage as a whole is intentionally superseded by the plan's more precise key-storage split, because SecureStore-backed implementation ownership remains in core until a storage package exists.
