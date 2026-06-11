# Phase 11: Tool Move Implementation — Grouped Compile-Safe Migrations

## Phase ID

`PLAN-20260608-ISSUE1585.P11`

## Purpose

Move approved contract, utility, and concrete tool groups to packages/tools using compile-safe migration groups. Each group includes moved tool files, interface updates, matching core adapter implementation, constructor changes, registry factory construction changes, affected import rewrites, and core/tools verification. No group depends on a later group.

## Prerequisites

- Required: P10a completed (behavioral regression tests verified).
- **Required MCP decision gate**: `analysis/mcp-tool-decision.md` MUST exist before any P11 group starts. If missing, stop and generate it with:
  ```bash
  rg -n "^import .* from" packages/core/src/tools/mcp-tool.ts -g "*.ts" > project-plans/issue1585/analysis/mcp-tool-imports.txt
  ```
  The decision artifact MUST contain exactly these fields: (1) actual import list for `mcp-tool.ts`, (2) per-import classification showing whether `IMcpToolService` satisfies it, (3) final classification (`MOVE_AFTER_INTERFACE` or `STAY_CORE_INFRASTRUCTURE`), and (4) justification. If the final classification is `STAY_CORE_INFRASTRUCTURE`, P11 Group 8 is skipped and P15 retained-file allowlist must include `mcp-tool.ts` with the same rationale.
- **Required LSP decision gate**: `analysis/lsp-diagnostics-helper-decision.md` MUST exist before any P11 group starts. If missing, stop and generate it with:
  ```bash
  rg -n "^import .* from" packages/core/src/tools/lsp-diagnostics-helper.ts -g "*.ts" > project-plans/issue1585/analysis/lsp-diagnostics-helper-imports.txt
  ```
  The decision artifact MUST contain exactly these fields: (1) actual import list for `lsp-diagnostics-helper.ts`, (2) per-import classification showing whether `ILspService` and `IToolHost` satisfy it, (3) final classification (`MOVE_AFTER_INTERFACE` or `STAY_CORE_INFRASTRUCTURE`), and (4) justification. If the final classification is `STAY_CORE_INFRASTRUCTURE`, remove it from Group 3 and add it to the P15 retained-file allowlist with the same rationale.
- **Required: `analysis/non-tools-core-dependency-map.md` exists with zero `FORBIDDEN_UNRESOLVED` entries**. Before each migration group, verify all non-tools core imports for that group are resolved against this map. No moved file in packages/tools may import from packages/core via package import, copied relative path, or unresolved utility dependency.
- Artifacts: move-map-final.md, test files, interface/adapter contracts, dependency-relocation-final.md, consumer-rewrite-map-final.md.

## Requirements Implemented

### REQ-MOVE-001, REQ-DEP-001

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-CONFIG-REPLACEMENT, REQ-PKG-BOUNDARY, REQ-BEHAVIOR-PRESERVATION, REQ-BEHAVIORAL-TDD, REQ-TEST-FIXTURE-COUPLING

**Behavior specification**:
- GIVEN: Config and tool files are classified with interface/adapter mappings
- WHEN: Each migration group moves tool code and replaces Config dependencies with injected interfaces
- THEN: All moved files compile in packages/tools, zero forbidden imports remain, behavioral tests pass, and pre-extraction fixtures match

**Why it matters**: Moving code without replacing every Config dependency creates immediate build failures. Missing an adapter breaks tool functionality. Any behavior change is a regression.

**`npm run format` diff check**: After each migration group, `npm run format` MUST produce zero diff. Phase completion requires verifying no uncommitted formatting changes remain in code files (excluding `project-plans/`). Use pre/post-format diff comparison or `npm run format:check` (if available) rather than relying on raw `git diff` which can be confused by intentionally uncommitted edits. This is REQ-FORMAT-DIFF-CHECK per `plan/requirements-appendix.md`.

```bash
# After each group: format and verify zero diff (scope: code files, excluding project-plans)
npm run format
git diff --quiet -- ':!project-plans/'
# Expected: exit code 0

# Alternative (preferred if format:check exists):
npm run format:check
# Expected: exit code 0
```

## ToolFormatter/Provider/History Type Ownership (per review-05)

ToolFormatter and related formatters must not import from `packages/core/src/runtime/contracts` or `packages/core/src/services/history`. Before moving any file that currently imports these, replace with tools-owned structural types defined in `packages/tools/src/types/provider-content-types.ts` per `analysis/interface-contracts-detailed.md §12`. Verify:

```bash
# After each group: verify no core runtime/history imports in moved code
! rg -n "runtime/contracts|services/history" packages/tools/src -g "*.ts"
# Expected: exit code 0 (no matches)
```

## Non-Tools Core Dependency Resolution (per review-05)

Before executing any P11 migration group, verify all non-tools core imports for that group are resolved against `analysis/non-tools-core-dependency-map.md`. No moved file in packages/tools may import from packages/core via package import, copied relative path, or unresolved utility dependency. Every import must have a classification of `MOVE_PURE_UTILITY`, `MOVE_TYPE_ONLY`, `TOOLS_OWNED_INTERFACE`, `CORE_ADAPTER`, `STAY_WITH_RETAINED_CORE_TOOL`, or `REPLACE_WITH_TOOLS_OWNED_TYPE` — no `FORBIDDEN_UNRESOLVED` entries may remain.

## Method

P11 is a sequence of compile-safe migration groups. Each group is atomic: move files, implement the matching core adapter, update the registry factory to construct the adapter and pass it to moved tool constructors, rewrite affected consumer imports, and verify both packages compile and tests pass. No bulk move followed by later adapter creation.

### Group-Scoped Test Rule

P10 may create the complete behavioral regression test set up front, but P11 group verification MUST run only tests tagged for the current group plus tests for groups already completed. Do not run the full `@vybestack/llxprt-code-tools` test suite after an early group if later-group tools cannot yet be constructed because their adapters have not been created. The full tools test suite is required only after all applicable groups complete. Each group completion marker must record the exact group-scoped test command(s) used and the test tags included.

## Exhaustive Config/Core Method Replacement Requirement

Before executing any P11 migration group, verify that ALL Config method usages for tools in that group have been mapped to a specific tools-owned interface per `analysis/interface-contracts-detailed.md §10`. Evidence command:

```bash
rg -n "this\.config\.|config\.|getConfig\(\)" packages/core/src/tools -g "*.ts" > project-plans/issue1585/analysis/tool-config-usage.txt
```

Every `this.config.*` or `config.*` reference in production code being moved MUST have an explicit replacement in the interface-adapter mapping table. If a Config method has no mapping, the implementation agent MUST NOT proceed — instead, add the mapping to the table and get it reviewed before proceeding.

**Plan markers for large mechanical moves**: Do not add TODO/progress comments to production files. Track large mechanical move progress in `project-plans/issue1585/.completed/P11-files.md` with one row per moved file: source, destination, classification, adapter/interface used, import rewrites completed, tests run. Alternatively, if the group is sufficiently self-contained, explicitly justify why tracking is omitted (e.g., "Group 1 has zero config dependencies, atomic copy+delete"). This replaces REQ-MECHANICAL-MOVE-MARKERS per `plan/requirements-appendix.md`. Completion artifacts in `project-plans/` are excluded from format diff checks.

**Exact adapter list**: The total adapter count is 14 mandatory + 1 conditional (CoreMcpToolServiceAdapter). The canonical adapter table with P11 group assignments is in `analysis/final-architecture.md` §Contract Ownership — refer there for the authoritative list. Each migration group specifies which adapters it creates. After all groups, `ls packages/core/src/tools-adapters/Core*Adapter.ts` must produce exactly this list:
- CoreToolHostAdapter.ts, CoreToolRegistryHostAdapter.ts, CoreMessageBusAdapter.ts, CoreShellToolHostAdapter.ts, CoreSubagentServiceAdapter.ts, CoreAsyncTaskServiceAdapter.ts, CoreSkillServiceAdapter.ts, CoreIdeServiceAdapter.ts, CoreLspServiceAdapter.ts, CoreStorageServiceAdapter.ts, CoreToolKeyStorageAdapter.ts, CoreTodoServiceAdapter.ts, CoreSettingsServiceAdapter.ts, CorePromptRegistryServiceAdapter.ts, CoreWebSearchServiceAdapter.ts, CoreMcpToolServiceAdapter.ts
- + CoreMcpToolServiceAdapter.ts (conditional: only if mcp-tool.ts moves)

**`npm run format` diff check**: After each migration group, format must produce zero diff. Phase completion requires checking that no formatting changes remain uncommitted. However, the correct approach is to compare the state before and after the format run, or use `npm run format:check` if available, rather than relying on `git diff` which can be confused by intentionally uncommitted edits (e.g., new completion artifacts). The following verification is correct:

**For P11 migration groups**: After running `npm run format`, verify zero diff for code files only (excluding `project-plans/`):

```bash
# After each group: format and verify zero diff (scope: code files, excluding project-plans)
npm run format
git diff --quiet -- ':!project-plans/'
# Expected: exit code 0
```

**For P16 final verification**: Use `npm run format:check` (or equivalent) if available. If not, run `npm run format` first, then verify zero diff:

```bash
npm run format
git diff --quiet -- ':!project-plans/'
# Expected: exit code 0
```

**Alternative (preferred if `format:check` exists)**:
```bash
npm run format:check
# Expected: exit code 0 (verifies all files are formatted without modifying anything)
```

Diff check is scoped to code files only; completion artifacts in `project-plans/` are intentionally new/changed and excluded from the diff check.

## Migration Groups

### Group 1: Contracts, Types, And Pure Utilities (MOVE_NOW)

These have zero core dependencies and no adapters needed.

**Moved files:**
- tool-confirmation-types.ts → packages/tools/src/types/
- tool-error.ts → packages/tools/src/types/
- tool-names.ts → packages/tools/src/types/
- tool-context.ts → packages/tools/src/types/tool-context.ts (canonical destination: types directory, not utils)
- mediaUtils.ts → packages/tools/src/utils/ (with package-local MediaBlock type)
- doubleEscapeUtils.ts → packages/tools/src/formatters/
- toolNameUtils.ts → packages/tools/src/formatters/
- toolIdNormalization.ts → packages/tools/src/formatters/
- IToolFormatter.ts → packages/tools/src/formatters/
- ToolFormatter.ts → packages/tools/src/formatters/
- ToolIdStrategy.ts → packages/tools/src/formatters/
- diffOptions.ts → packages/tools/src/utils/
- fuzzy-replacer.ts → packages/tools/src/utils/
- ensure-dirs.ts → packages/tools/src/utils/
- todo-schemas.ts → packages/tools/src/types/
- SchemaValidator → packages/tools/src/utils/schemaValidator.ts (package-local)
- AnsiOutput type → packages/tools/src/utils/terminalSerializer.ts (package-local)

**Interface updates:** None (no core deps to invert).

**Core adapter:** None needed.

**Constructor changes:** None (these are types/utilities).

**Registry factory changes:** None (these are not tool classes).

**Affected import rewrites:** Core files importing from `../tools/tool-confirmation-types`, `../tools/tool-error`, `../tools/toolNameUtils`, etc. → `@vybestack/llxprt-code-tools`. Provider files importing from `@vybestack/llxprt-code-core/tools/IToolFormatter`, `@vybestack/llxprt-code-core/tools/toolIdNormalization`, etc. → `@vybestack/llxprt-code-tools/IToolFormatter.js`, etc.

**packages/tools/package.json:** Add runtime dependencies from dependency-relocation-final.md (`diff`, `zod`, `zod-to-json-schema` for this group).

**Verification:**
```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-tools
npm run test --workspace @vybestack/llxprt-code-core
```

### Group 2: Base Tool Classes (tools.ts, modifiable-tool.ts)

These require IToolMessageBus and a few type imports.

**Moved files:**
- tools.ts → packages/tools/src/tools/tools.ts (replace MessageBus import with IToolMessageBus, SchemaValidator with package-local, DiffUpdateResult with IIdeService type, AnsiOutput with package-local)
- modifiable-tool.ts → packages/tools/src/tools/modifiable-tool.ts (replace core imports)

**Interface updates:**
- IToolMessageBus exists from P03 (requestConfirmation, publishPolicyUpdate, subscribe)

**Core adapter:**
- Create `packages/core/src/tools-adapters/CoreMessageBusAdapter.ts` implementing IToolMessageBus
  - Delegates to `packages/core/src/confirmation-bus/message-bus.ts` MessageBus class
  - Implements correlation/abort/timeout behavior per interface-contracts-detailed.md §1

**Constructor changes:**
- BaseToolInvocation constructor: `messageBus?: MessageBus` → `messageBus?: IToolMessageBus`
- DeclarativeTool constructor: same change
- BaseTool constructor: same change

**Registry factory changes:** None yet (registry factory imports concrete tool classes, not base classes directly).

**Affected import rewrites:** Core files importing BaseToolInvocation, ToolResult, AnyToolInvocation, etc. from `../tools/tools.js` → `@vybestack/llxprt-code-tools`.

**packages/tools/package.json:** Already has `diff`, `@google/genai` from group 1/this group. Add `@google/genai` if not already present.

**Verification:**
```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-tools
# Adapter exists and compiles
test -f packages/core/src/tools-adapters/CoreMessageBusAdapter.ts
```

### Group 3: Low-Coupling Filesystem Tools (inject IToolHost)

**Moved files:**
- read-file.ts, read-many-files.ts, read_line_range.ts
- write-file.ts, insert_at_line.ts, delete_line_range.ts
- ls.ts, glob.ts, grep.ts, ripGrep.ts
- edit.ts, edit-utils.ts
- ast-grep.ts, structural-analysis.ts
- ast-edit.ts, ast-edit/** (move as cohesive unit)
- google-web-fetch.ts, direct-web-fetch.ts
- lsp-diagnostics-helper.ts → packages/tools/src/utils/ (replace Config parameter with ILspService + IToolHost per analysis/lsp-diagnostics-helper-decision.md; consumer ast-edit/ast-edit-invocation.ts is already in this group)

**Interface updates:**
- IToolHost exists from P03 (getTargetDir, getWorkspaceRoots, getApprovalMode, isInteractive, hasFeatureFlag)
- IIdeService exists from P03 (applyDiff with DiffUpdateResult, per interface-contracts-detailed.md §2)
- ILspService exists from P03 (getDiagnostics, waitForDiagnostics) — needed for lsp-diagnostics-helper.ts move per analysis/lsp-diagnostics-helper-decision.md

**Core adapters:**
- Create `packages/core/src/tools-adapters/CoreToolHostAdapter.ts` implementing IToolHost → delegates to Config
- Create `packages/core/src/tools-adapters/CoreIdeServiceAdapter.ts` implementing IIdeService → delegates to IdeClient
- Create `packages/core/src/tools-adapters/CoreLspServiceAdapter.ts` implementing ILspService → delegates to LspDiagnosticsHelper / Config.getLspServiceClient() (per analysis/lsp-diagnostics-helper-decision.md; lsp-diagnostics-helper.ts moves in this group)

**Constructor changes:**
- EditTool: constructor takes IToolHost instead of importing Config
- WriteFileTool/InsertAtLineTool/DeleteLineRangeTool/ApplyPatchTool: take IToolHost
- All filesystem tools: take IToolHost or IToolMessageBus as needed
- lsp-diagnostics-helper.ts: `collectLspDiagnosticsBlock(config: Config, ...)` → `collectLspDiagnosticsBlock(lspService: ILspService, host: IToolHost, absolutePath: string)` per analysis/lsp-diagnostics-helper-decision.md

**Registry factory changes:**
- Update `toolRegistryFactory.ts` to:
  1. Import moved classes from `@vybestack/llxprt-code-tools`
  2. Construct CoreToolHostAdapter
  3. Construct CoreIdeServiceAdapter
  4. Pass adapters to moved tool constructors

**Affected import rewrites:** Core files importing these tool classes from `../tools/` → `@vybestack/llxprt-code-tools`.

**packages/tools/package.json:** Add `node-fetch`, `turndown`, `cheerio`, `html-to-text`, `fast-glob`, `glob`, `@ast-grep/napi`, `shell-quote` as needed per dependency-relocation-final.md.

**Verification:**
```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-tools
npm run test --workspace @vybestack/llxprt-code-core
# Adapters exist
test -f packages/core/src/tools-adapters/CoreToolHostAdapter.ts
test -f packages/core/src/tools-adapters/CoreIdeServiceAdapter.ts
test -f packages/core/src/tools-adapters/CoreLspServiceAdapter.ts
```

### Group 4: Apply-Patch Tool (inject IIdeService)

**Moved files:**
- apply-patch.ts → packages/tools/src/tools/

**Interface updates:**
- IIdeService already exists from P03 and adapter created in Group 3

**Core adapter:** Already created in Group 3.

**Constructor changes:**
- ApplyPatchTool: constructor takes IIdeService for diff application

**Registry factory changes:**
- Already updated in Group 3 for filesystem tools.
- Add ApplyPatchTool construction with IIdeService adapter.

**Affected import rewrites:** Core files importing ApplyPatchTool from `../tools/apply-patch.js` → `@vybestack/llxprt-code-tools`.

**Verification:**
```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-tools
```

### Group 5: Stateful Runtime Tools (inject service interfaces)

**Moved files:**
- shell.ts → requires IShellToolHost, IToolHost, IToolMessageBus
- task.ts → requires ISubagentService
- list-subagents.ts → requires ISubagentService
- check-async-tasks.ts → requires IAsyncTaskService
- activate-skill.ts → requires ISkillService
- memoryTool.ts → requires IStorageService, IToolKeyStorage
- todo-read.ts, todo-write.ts, todo-pause.ts → require ITodoService
- todo-store.ts, todo-events.ts → require ITodoService or package-local
- codesearch.ts, exa-web-search.ts, google-web-search.ts, google-web-search-invocation.ts → require IToolKeyStorage (moved in this group only after CoreToolKeyStorageAdapter exists)

**Interface updates:** All service interfaces exist from P03.

**Core adapters:**
- Create `packages/core/src/tools-adapters/CoreShellToolHostAdapter.ts` implementing IShellToolHost
- Create `packages/core/src/tools-adapters/CoreSubagentServiceAdapter.ts` implementing ISubagentService
- Create `packages/core/src/tools-adapters/CoreAsyncTaskServiceAdapter.ts` implementing IAsyncTaskService
- Create `packages/core/src/tools-adapters/CoreSkillServiceAdapter.ts` implementing ISkillService
- Create `packages/core/src/tools-adapters/CoreStorageServiceAdapter.ts` implementing IStorageService
- Create `packages/core/src/tools-adapters/CoreToolKeyStorageAdapter.ts` implementing IToolKeyStorage (adapter owns ToolKeyStorage+SecureStore lifecycle, per interface-contracts-detailed.md §5)
- Create `packages/core/src/tools-adapters/CoreTodoServiceAdapter.ts` implementing ITodoService
- Create `packages/core/src/tools-adapters/CoreSettingsServiceAdapter.ts` implementing ISettingsService → delegates to Config.getSettingsService()
- Create `packages/core/src/tools-adapters/CorePromptRegistryServiceAdapter.ts` implementing IPromptRegistryService → delegates to Config.getPromptRegistry()
- Create `packages/core/src/tools-adapters/index.ts` barrel export

**Constructor changes:**
- ShellTool: constructor takes IShellToolHost, IToolHost, IToolMessageBus
- TaskTool/ListSubagentsTool: constructor takes ISubagentService
- CheckAsyncTasksTool: constructor takes IAsyncTaskService
- ActivateSkillTool: constructor takes ISkillService
- MemoryTool: constructor takes IStorageService, IToolKeyStorage
- CodeSearchTool/ExaWebSearchTool/GoogleWebSearchTool: constructor takes IToolKeyStorage
- TodoRead/TodoWrite/TodoPause: constructor takes ITodoService

**Registry factory changes:**
- Construct all new adapters
- Pass adapters to moved tool constructors
- Register tools using same names and discovery logic

**Affected import rewrites:** Core files importing these classes from `../tools/` → `@vybestack/llxprt-code-tools`.

**packages/tools/package.json:** Already has required external deps from earlier groups. No new deps (services use injected interfaces, not external packages).

**Verification:**
```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-tools
npm run test --workspace @vybestack/llxprt-code-core
# All adapters exist
ls packages/core/src/tools-adapters/Core*Adapter.ts | wc -l
# Expected: 14 adapters if mcp-tool.ts stays in core (no CoreMcpToolServiceAdapter)
# Expected: 15 adapters if mcp-tool.ts moves (includes CoreMcpToolServiceAdapter)
# Exact mandatory adapter list: CoreToolHostAdapter, CoreToolRegistryHostAdapter, CoreMessageBusAdapter,
#   CoreShellToolHostAdapter, CoreSubagentServiceAdapter, CoreAsyncTaskServiceAdapter, CoreSkillServiceAdapter,
#   CoreIdeServiceAdapter, CoreLspServiceAdapter, CoreStorageServiceAdapter, CoreToolKeyStorageAdapter,
#   CoreTodoServiceAdapter, CoreSettingsServiceAdapter, CorePromptRegistryServiceAdapter
# Conditional: CoreMcpToolServiceAdapter (only if mcp-tool.ts moves)
```

### Group 6: Tool Registry (inject IToolRegistryHost, IToolMessageBus)

**Moved files:**
- tool-registry.ts → packages/tools/src/tools/ (replace Config/MessageBus/DebugLogger imports with IToolRegistryHost + IToolMessageBus)

**Interface updates:**
- IToolRegistryHost exists from P03

**Core adapter:**
- Create `packages/core/src/tools-adapters/CoreToolRegistryHostAdapter.ts` implementing IToolRegistryHost → delegates to Config

**Constructor changes:**
- ToolRegistry: constructor takes IToolRegistryHost + IToolMessageBus instead of Config + MessageBus

**Registry factory changes:**
- Update toolRegistryFactory to use ToolRegistry from @vybestack/llxprt-code-tools with adapter

**Affected import rewrites:** Core files importing `type { ToolRegistry }` from `../tools/tool-registry.js` → `@vybestack/llxprt-code-tools`.

**Verification:**
```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-tools
npm run test --workspace @vybestack/llxprt-code-core
```

### Group 7: Tool Key Storage (ownership per review-02) — Including ToolKeyStorageFacade

**Moved files:**
- Pure functions to packages/tools/src/utils/tool-key-utils.ts:
  - isValidToolKeyName(toolName: string): boolean
  - getSupportedToolNames(): string[]
  - maskKeyForDisplay(key: string): string
- IToolKeyStorage → already in packages/tools/src/interfaces/IToolKeyStorage.ts
- **ToolKeyStorageFacade** → packages/tools/src/utils/tool-key-storage-facade.ts
  - Constructor takes IToolKeyStorage (injected) and IToolHost (for directory context)
  - Delegates all key operations to injected IToolKeyStorage
  - Provides the tools-package-local API surface for key storage that was previously the ToolKeyStorage class
  - Does NOT import SecureStore or any core storage modules

**NOT moved:**
- ToolKeyStorage class stays in packages/core (it imports SecureStore)
- CoreToolKeyStorageAdapter created in Group 5 owns the ToolKeyStorage + SecureStore instance

**Interface updates:** IToolKeyStorage already exists from P03.

**Core adapter:** CoreToolKeyStorageAdapter already created in Group 5.

**Constructor changes:**
- MemoryTool, CodeSearchTool, ExaWebSearchTool, and GoogleWebSearchTool constructor injection is already completed in Group 5.
- `maskKeyForDisplay`, `getSupportedToolNames`, and `isValidToolKeyName` used internally become package-local calls from `packages/tools/src/utils/tool-key-utils.ts`.

**Registry factory changes:** Already updated in Group 5.

**Affected import rewrites:**
- `core/src/storage/secure-store-integration.test.ts`: `maskKeyForDisplay` from `../tools/tool-key-storage.js` → `@vybestack/llxprt-code-tools` (pure function export)

**Verification:**
```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-tools
```

### Group 8: MCP Tool (conditional, move only if IMcpToolService met)

**Moved files:**
- mcp-tool.ts → packages/tools/src/tools/ ONLY if constructor accepts IMcpToolService instead of Config+MessageBus directly. If not cleanly separable, leave in core.

**Interface updates:** IMcpToolService exists from P03.

**Core adapter:**
- Create `packages/core/src/tools-adapters/CoreMcpToolServiceAdapter.ts` implementing IMcpToolService → delegates to McpClientManager (only if mcp-tool moves)

**Constructor changes:**
- DiscoveredMCPTool: constructor takes IMcpToolService

**Registry factory changes:** If mcp-tool moves, update factory to pass McpToolServiceAdapter.

**Affected import rewrites:** Only if mcp-tool moves.

**Decision gate:** Before this group, the pre-P11 MCP decision artifact (`analysis/mcp-tool-decision.md`) MUST be consulted. This artifact was produced in P09 and contains the final `MOVE_AFTER_INTERFACE` or `STAY_CORE_INFRASTRUCTURE` classification for mcp-tool.ts, based on an inspection of its actual imports. If the decision is `STAY_CORE_INFRASTRUCTURE`, skip this group entirely and leave mcp-tool.ts in core. Per the MCP ownership decision, mcp-client.ts and mcp-client-manager.ts STAY in `packages/core/src/tools/` as the only approved retained core tools infrastructure.

**Verification (if moved):**
```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-tools
```

## After All Groups

1. Update `packages/tools/src/index.ts` to export all moved modules from the barrel.
2. Verify `packages/tools/package.json` has all runtime dependencies per dependency-relocation-final.md.
3. Run full forbidden import scan:

```bash
rg -n "@vybestack/llxprt-code-core\|packages/core/src\|@vybestack/llxprt-code-providers\|packages/providers/src\|packages/cli/src" packages/tools/src -g "*.ts"
# Expected: zero matches
```

4. Verify MCP client/manager remain in core:
```bash
test -f packages/core/src/tools/mcp-client.ts
test -f packages/core/src/tools/mcp-client-manager.ts
```

## Files To Modify Or Create

- Move all MOVE_NOW and MOVE_AFTER_INTERFACE files to packages/tools/src/ per group schedule
- Create all core adapters per group schedule
- Update: `packages/tools/src/index.ts`
- Update: `packages/tools/package.json` (dependencies per group)
- Update: `packages/core/src/config/toolRegistryFactory.ts` (per group)
- Update: `packages/core/package.json` (add tools dependency when first adapter created)
- Create: `project-plans/issue1585/.completed/P11.md`

## Verification Commands

```bash
# Forbidden import scan
rg -n "@vybestack/llxprt-code-core\|packages/core/src\|@vybestack/llxprt-code-providers\|packages/providers/src\|packages/cli/src" packages/tools/src -g "*.ts"
# Expected: zero matches
# Typecheck both packages
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run typecheck --workspace @vybestack/llxprt-code-core
# Run behavioral tests
npm run test --workspace @vybestack/llxprt-code-tools
npm run test --workspace @vybestack/llxprt-code-core
# Verify core still compiles with tools dependency
npm run typecheck --workspace @vybestack/llxprt-code-core
# Verify adapters exist
ls packages/core/src/tools-adapters/Core*Adapter.ts | wc -l
# Expected: 14 (mandatory) or 15 (with CoreMcpToolServiceAdapter if mcp-tool moves)
```

## Semantic Verification Checklist

- [ ] Every moved file has zero core/cli/providers imports.
- [ ] Every migration group compiles independently.
- [ ] Behavioral tests pass after each group.
- [ ] Core adapters exist for every tools-owned interface.
- [ ] toolRegistryFactory constructs adapters and passes to moved tools.
- [ ] MCP client/manager remain in core.
- [ ] ToolKeyStorage class remains in core (only pure functions move).
- [ ] packages/tools/package.json has all required dependencies.

## Success Criteria

- All approved files moved via grouped compile-safe migrations.
- Zero forbidden imports in tools.
- All behavioral tests pass.
- All adapters exist and compile.

## Failure Recovery

Revert the last group's moves. Fix imports or create missing adapters. Do not proceed to next group until current group passes all verification.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P11.md` with groups completed, files moved, test results, and forbidden import scan.
