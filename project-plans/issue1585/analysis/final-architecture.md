# Final Architecture Decision: Cycle-Free Tools Extraction

Plan ID: PLAN-20260608-ISSUE1585

## Decision

The final architecture for issue #1585 is a lower-level tools package used by core and providers:

    packages/tools      -> no core/cli/providers imports
    packages/core       -> packages/tools
    packages/providers  -> packages/tools + packages/core as still required by issue #1584 interim architecture
    packages/cli        -> packages/core + packages/providers only
    packages/cli        -X-> packages/tools unless direct imports are intentionally added and documented
    packages/a2a-server -> packages/core (ToolRegistry via core re-exports; no direct tools dependency)
    packages/tools      -X-> packages/core
    packages/tools      -X-> packages/cli
    packages/tools      -X-> packages/providers

## Approved Missing-Packages Decision

packages/settings, packages/storage, and packages/mcp do not currently exist. The plan approves:

- **Temporary tools-owned interfaces** in `packages/tools/src/interfaces/**` for all services that tools need from core.
- **Core adapters** in `packages/core/src/tools-adapters/**` that implement tools-owned interfaces.
- **No tools-to-core dependency**: packages/tools imports only its own interfaces and other allowed packages.
- **Future replacement**: When packages/settings, packages/storage, or packages/mcp are created, corresponding temporary interfaces and adapters are replaced by direct imports from those packages.
- **MCP constraint**: mcp-client.ts and mcp-client-manager.ts remain in `packages/core/src/tools/` as the only approved retained core tools infrastructure. mcp-tool.ts may move only if it depends solely on IMcpToolService.
- **Behavior preservation**: Every temporary adapter MUST preserve the exact semantics of the original core service call, including return types, error behavior, optionality, and ordering. No caching, transformation, or filtering not present in the original code path.
- **Future replacement rule**: When packages/settings, packages/storage, or packages/mcp are created, the corresponding temporary interfaces and adapters are removed. packages/tools replaces the interface import with a direct package import. The adapter in packages/core/src/tools-adapters/** is deleted. This plan does NOT block on the existence of these future packages.

### Explicit Temporary Interfaces For Missing Packages

| Missing Package | Temporary Interface | Interface File | Core Adapter | Adapter Delegates To | Behavior Preservation Rule | Future Replacement |
| --- | --- | --- | --- | --- | --- | --- |
| packages/settings | ISettingsService | `packages/tools/src/interfaces/ISettingsService.ts` | CoreSettingsServiceAdapter | Config.getSettingsService() | Exact same settings read/write semantics; no caching, transformation, or filtering | Direct import from packages/settings |
| packages/settings | IPromptRegistryService | `packages/tools/src/interfaces/IPromptRegistryService.ts` | CorePromptRegistryServiceAdapter | Config.getPromptRegistry() | Prompt registry access preserved identically; no filtering or reordering | Direct import from packages/settings |
| packages/storage | IStorageService (memory/LLXPRT dir storage) | `packages/tools/src/interfaces/IStorageService.ts` | CoreStorageServiceAdapter | Config storage APIs (getLLXPRTDir, readFile, writeFile, ensureDir) | File I/O behavior preserved; LLXPRT dir resolution identical; no path transformation | Direct import from packages/storage |
| packages/storage | IToolKeyStorage (key storage) | `packages/tools/src/interfaces/IToolKeyStorage.ts` | CoreToolKeyStorageAdapter | ToolKeyStorage class + SecureStore (adapter owns lifecycle) | Key resolution order preserved (keychain → encrypted file → keyfile → null); FALLBACK_POLICY 'deny' preserved | Direct import from packages/storage |
| packages/mcp | IMcpToolService (MCP execution) | `packages/tools/src/interfaces/IMcpToolService.ts` | CoreMcpToolServiceAdapter (conditional) | McpClientManager (only if mcp-tool moves) | callTool and discoverTools behavior preserved; MCP tool lifecycle identical | Direct import from packages/mcp |

**All temporary interfaces are defined unconditionally** (not gated on current usage volume). ISettingsService and IPromptRegistryService exist even if current usage routes through IToolRegistryHost, because settings and prompt registry are semantically distinct services that will get their own packages. IMcpToolService is always defined; the CoreMcpToolServiceAdapter is conditional on mcp-tool.ts moving.

**MCP conditional decision**: If `mcp-tool.ts` cannot move without unacceptable core coupling (i.e., it imports Config or MessageBus directly rather than through IMcpToolService), then `mcp-tool.ts` remains in `packages/core/src/tools/` as a STAY_CORE_INFRASTRUCTURE file. In that case, IMcpToolService interface is still defined in tools (for future use), but no CoreMcpToolServiceAdapter is created in this plan.

**`mcp-tool.ts` decision gate**: Before P11 Group 8, a pre-P11 decision artifact MUST be produced by inspecting `mcp-tool.ts` imports and recording the final decision. The artifact is `analysis/mcp-tool-decision.md`. It MUST contain: (1) the actual import list of `mcp-tool.ts`, (2) whether each import can be satisfied by `IMcpToolService` alone, (3) the final classification `MOVE_AFTER_INTERFACE` or `STAY_CORE_INFRASTRUCTURE`, (4) justification. If the decision is `STAY_CORE_INFRASTRUCTURE`, add mcp-tool.ts to the retained-file allowlist with documented rationale. This decision artifact is produced in P09 (during move-map finalization) and consumed by P11 Group 8. **If P09 did not produce this artifact, P11 MUST produce it before Group 8 executes.** The artifact is a gating prerequisite — no P11 migration may proceed without it.

**Remaining core/tools `mcp-tool.ts`**: If mcp-tool.ts stays in core, it MUST still be listed in the retained-file allowlist with documented rationale. No file may remain in core/tools without explicit classification.

## Contract Ownership

ALL interfaces consumed by tools MUST be tools-owned. Core may ONLY implement adapters.

**NOTE**: This section is the canonical source for the complete adapter list. Other plan/analysis documents should reference this list rather than duplicating it, to reduce drift across artifacts.

| Interface | Location | Owner |
| --- | --- | --- |
| IToolHost | packages/tools/src/interfaces/IToolHost.ts | tools |
| IToolRegistryHost | packages/tools/src/interfaces/IToolRegistryHost.ts | tools |
| IToolMessageBus | packages/tools/src/interfaces/IToolMessageBus.ts | tools |
| IShellToolHost | packages/tools/src/interfaces/IShellToolHost.ts | tools |
| ISubagentService | packages/tools/src/interfaces/ISubagentService.ts | tools |
| IAsyncTaskService | packages/tools/src/interfaces/IAsyncTaskService.ts | tools |
| ISkillService | packages/tools/src/interfaces/ISkillService.ts | tools |
| IMcpToolService | packages/tools/src/interfaces/IMcpToolService.ts | tools |
| IIdeService | packages/tools/src/interfaces/IIdeService.ts | tools |
| ILspService | packages/tools/src/interfaces/ILspService.ts | tools |
| IStorageService | packages/tools/src/interfaces/IStorageService.ts | tools |
| IToolKeyStorage | packages/tools/src/interfaces/IToolKeyStorage.ts | tools |
| ITodoService | packages/tools/src/interfaces/ITodoService.ts | tools |
| ISettingsService | packages/tools/src/interfaces/ISettingsService.ts | tools |
| IPromptRegistryService | packages/tools/src/interfaces/IPromptRegistryService.ts | tools |

**Total: 15 interfaces**. All are defined unconditionally — even if current usage routes through another interface (e.g., settings through IToolRegistryHost), because they are semantically distinct services. Adapter count: 14 mandatory + 1 conditional (CoreMcpToolServiceAdapter only if mcp-tool.ts moves).

**Canonical core adapter list** (all in `packages/core/src/tools-adapters/`). Other plan files must reference this list rather than duplicating it:

| Adapter | Implements | P11 Group | Mandatory |
| --- | --- | --- | --- |
| CoreToolHostAdapter.ts | IToolHost | Group 3 | Yes |
| CoreToolRegistryHostAdapter.ts | IToolRegistryHost | Group 6 | Yes |
| CoreMessageBusAdapter.ts | IToolMessageBus | Group 2 | Yes |
| CoreShellToolHostAdapter.ts | IShellToolHost | Group 5 | Yes |
| CoreSubagentServiceAdapter.ts | ISubagentService | Group 5 | Yes |
| CoreAsyncTaskServiceAdapter.ts | IAsyncTaskService | Group 5 | Yes |
| CoreSkillServiceAdapter.ts | ISkillService | Group 5 | Yes |
| CoreMcpToolServiceAdapter.ts | IMcpToolService | Group 8 | Conditional |
| CoreIdeServiceAdapter.ts | IIdeService | Group 3 | Yes |
| CoreLspServiceAdapter.ts | ILspService | Group 3 | Yes |
| CoreStorageServiceAdapter.ts | IStorageService | Group 5 | Yes |
| CoreToolKeyStorageAdapter.ts | IToolKeyStorage | Group 5 | Yes |
| CoreTodoServiceAdapter.ts | ITodoService | Group 5 | Yes |
| CoreSettingsServiceAdapter.ts | ISettingsService | Group 5 | Yes |
| CorePromptRegistryServiceAdapter.ts | IPromptRegistryService | Group 5 | Yes |
| index.ts | barrel export | Group 5 | Yes |

## Ownership

| Concern | Final Owner | Rationale |
| --- | --- | --- |
| Tool base contracts, invocation/result types, ToolContext, ContextAwareTool | packages/tools | Core, scheduler, agents, and external consumers need these as stable lower-level contracts. |
| Tool confirmation outcome/payload types | packages/tools | Core confirmation-bus currently imports these. tools must not depend back on confirmation-bus. |
| Tool registry and discovered tool public entry point | packages/tools | Move only after Config and MessageBus are inverted behind tools-owned interfaces. |
| Concrete low-coupling tools | packages/tools | Filesystem, read/write/list/search/edit/AST/web/codesearch tools after host dependencies are injected. |
| Shell tool class | packages/tools | Tool behavior belongs in tools, but process execution service must be injected from core. |
| Task/list-subagents/check-async-tasks tools | packages/tools | Tool wrappers belong in tools, but services must be injected from core. |
| Todo tools and schemas | packages/tools | Tool UI/API belongs in tools, but services must be injected. |
| Memory tool | packages/tools | User-facing tool belongs in tools; storage operations depend on IStorageService. |
| Tool key storage (interfaces + pure functions) | packages/tools (IToolKeyStorage, maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName) | Interfaces and pure masking/naming behavior belong in tools; any facade that delegates only to injected tools-owned interfaces may exist in tools |
| Tool key storage (SecureStore-backed implementation) | packages/core (ToolKeyStorage class) | SecureStore/@napi-rs/keyring-backed implementations stay in core until packages/storage exists; CoreToolKeyStorageAdapter owns ToolKeyStorage+SecureStore lifecycle. Pure functions (maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName) move to packages/tools. |
| ToolFormatter, IToolFormatter, ToolIdStrategy, toolIdNormalization, doubleEscapeUtils, toolNameUtils | packages/tools | Providers use them to format provider requests; moving them eliminates provider deep imports. |
| MCP tool wrapper | packages/tools if IMcpToolService dependency met | mcp-tool.ts may move if constructor accepts IMcpToolService. |
| mcp-client and mcp-client-manager | core (STAY_CORE_INFRASTRUCTURE in packages/core/src/tools/) | OAuth/auth/provider coupling is too large for tools. Only approved retained core tools infrastructure. |
| Core adapters for tools-owned interfaces | packages/core/src/tools-adapters/ | Core code that implements tools interfaces by delegating to concrete core services. Adapter count: 14 mandatory + 1 conditional (CoreMcpToolServiceAdapter only if mcp-tool.ts moves). |

## MCP Ownership

| File | Location After Extraction | Rationale |
| --- | --- | --- |
| mcp-client.ts | packages/core/src/tools/ (STAY_CORE_INFRASTRUCTURE) | OAuth, auth providers, token storage — core infrastructure; only approved retained infrastructure |
| mcp-client-manager.ts | packages/core/src/tools/ (STAY_CORE_INFRASTRUCTURE) | Client lifecycle management, depends on Config/events; only approved retained infrastructure |
| mcp-tool.ts | packages/tools/src/ (MOVE_AFTER_INTERFACE) | Only if constructor accepts IMcpToolService instead of Config+MessageBus. If it cannot move, receives STAY_CORE_INFRASTRUCTURE classification and is added to retained-file allowlist with documented rationale. |

## Package Export Policy

- Top-level export "." exports full public API.
- Subpath exports for provider-needed modules: IToolFormatter, ToolFormatter, ToolIdStrategy, toolIdNormalization, doubleEscapeUtils, toolNameUtils.
  - IToolFormatter maps to `dist/src/formatters/IToolFormatter.js` (not dist/src/interfaces/).
- No core deep-import shims. Core removes ./tools/* exports for moved modules.
- Providers import tools modules from @vybestack/llxprt-code-tools subpath exports.
- CLI uses core top-level re-exports only — no direct tools dependency.

## Core tools Directory Final Policy

After cleanup, packages/core/src/tools/ may only contain:
1. **Approved retained infrastructure allowlist** (every file must have written rationale):
   - `mcp-client.ts` (STAY_CORE_INFRASTRUCTURE) — OAuth/auth/token-storage MCP infrastructure; only approved retained infrastructure
   - `mcp-client-manager.ts` (STAY_CORE_INFRASTRUCTURE) — MCP client lifecycle management; only approved retained infrastructure
   - `tool-key-storage.ts` (STAY_CORE_INFRASTRUCTURE) — SecureStore/keyring-backed ToolKeyStorage class implementation; pure functions (maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName) move to packages/tools
   - `mcp-client.test.ts` (if exists — TEST_STAYS_WITH_SOURCE) — test for retained mcp-client.ts
   - `mcp-client-manager.test.ts` (if exists — TEST_STAYS_WITH_SOURCE) — test for retained mcp-client-manager.ts
   - `tool-key-storage.test.ts` (if exists — TEST_STAYS_WITH_SOURCE) — test for retained ToolKeyStorage class (SecureStore integration only; masking/naming tests move with pure functions)
   - `mcp-tool.ts` (if it receives STAY_CORE_INFRASTRUCTURE classification — conditional) — only if it cannot move without core coupling (document the decision in the move map)
   - Any file explicitly classified as `STAY_CORE_INFRASTRUCTURE` with written rationale recorded in the move map
2. No re-export shims — no files that merely forward or re-export `@vybestack/llxprt-code-tools`.
3. **All other core/tools files** are moved to packages/tools or removed in P15. No core/tools file may re-export from packages/tools.
4. **Allowed `packages/core/src/index.ts` top-level re-exports**: Explicit re-exports from `@vybestack/llxprt-code-tools` in `packages/core/src/index.ts` are permitted for CLI compatibility. These are NOT in scope for this policy — they serve the core package's public API and are allowed. The no-shim scan scope is restricted to `packages/core/src/tools/**` only.
5. **Separation rule**: `packages/core/src/tools/**` → zero re-exports from `@vybestack/llxprt-code-tools`. `packages/core/src/index.ts` → allowed explicit re-exports for public API.
6. Approved retained-file list process: P09 classifies every file, P15 removes moved files, P15a verifies no shims exist.
7. **Retained-file verification**: After P15a, `find packages/core/src/tools -type f -name '*.ts' | sort` must match this allowlist exactly.

## Forbidden Implementations

- packages/tools importing from @vybestack/llxprt-code-core or packages/core/src.
- packages/tools importing from @vybestack/llxprt-code-providers or packages/providers/src.
- packages/tools importing from packages/cli.
- Core-local interfaces consumed by tools (all contracts must be tools-owned).
- packages/core/src/tools files that only re-export packages/tools deep modules.
- ToolV2, ToolRegistryNew, NewShellTool, duplicate implementations, or compatibility wrapper directories.
- Hiding Config inside ToolContext as a generic service bag.
- Moving mcp-client and mcp-client-manager into packages/tools.
- CoreToolKeyStorageAdapter delegating to a moved ToolKeyStorage class (unless that class is package-local pure/facade with no core storage imports).

## Allowed Implementations

- Core top-level package re-exports from @vybestack/llxprt-code-tools only if required for the existing public core top-level API and explicitly covered by tests. Deep import shims are not allowed.
- Temporary core adapters implementing tools-owned interfaces while packages/settings/storage/mcp are absent.
- Providers importing moved formatter/ID utilities directly from @vybestack/llxprt-code-tools subpath exports.
- ToolKeyStorage class remaining in core with SecureStore imports (adapter owns lifecycle internally).
- Tool tests using infrastructure fakes for filesystem/network/subprocess boundaries while testing real tool behavior.

## npm/package-lock Process Note

Root `packageManager` says pnpm but repo uses npm/package-lock for all release scripts. This plan follows the existing npm/package-lock process. The packageManager field is vestigial.

## CLI Migration Decision

CLI uses ONLY core top-level re-exports — no direct `@vybestack/llxprt-code-tools` dependency. CLI -X-> tools unless direct imports are intentionally added and documented.

## A2A Server Consumer Classification

packages/a2a-server does not import core tool deep paths directly, but consumes `Config.getToolRegistry()` and ToolRegistry-shaped values through:
- `packages/a2a-server/src/agent/task.ts` — uses `this.config.getToolRegistry()` for tool discovery and `toolRegistry.getAllTools()` for tool enumeration
- `packages/a2a-server/src/utils/testing_utils.ts` — provides mock Config with `getToolRegistry()` for test infrastructure
- `packages/a2a-server/src/http/app.test.ts` — tests A2A HTTP layer with mock `getToolRegistry()`

A2A does NOT need a direct `@vybestack/llxprt-code-tools` dependency. ToolRegistry and related types come through core top-level re-exports. Required verification after P13:
```bash
npm run typecheck --workspace @vybestack/llxprt-code-a2a-server
npm run test --workspace @vybestack/llxprt-code-a2a-server
```

## Non-Tools Core Dependency Rule

Moving a file from `packages/core/src/tools/**` is not sufficient if that file imports utilities, types, or services from elsewhere in `packages/core/src/**`. Before P11, create `analysis/non-tools-core-dependency-map.md` from `analysis/non-tools-core-relative-imports.txt`. Every non-tools relative import used by a moved tool MUST be classified exactly once as **MOVE_PURE_UTILITY**, **MOVE_TYPE_ONLY**, **TOOLS_OWNED_INTERFACE**, **CORE_ADAPTER**, **STAY_WITH_RETAINED_CORE_TOOL**, **REPLACE_WITH_TOOLS_OWNED_TYPE**, or **FORBIDDEN_UNRESOLVED**. P11 MUST NOT move a tool file until all of its non-tools core imports have entries in this map and no `FORBIDDEN_UNRESOLVED` entries remain.

**Evidence command**:
```bash
rg -n "from ['\"]\.\./" packages/core/src/tools -g "*.ts" | rg -v "from ['\"]\./|from ['\"]\.\./tools/" > project-plans/issue1585/analysis/non-tools-core-relative-imports.txt
```

**Critical P11 gate**: Before ANY P11 migration group, `analysis/non-tools-core-dependency-map.md` must exist and have zero `FORBIDDEN_UNRESOLVED` entries. This map is seeded from actual imports via the evidence command above and classifies every non-tools core import for every tool file.

**Classification definitions**:

| Classification | Meaning | Example |
| --- | --- | --- |
| MOVE_PURE_UTILITY | Pure function/type with no core service deps; moves to packages/tools/src/utils/ | SchemaValidator, AnsiOutput, DiffStat |
| MOVE_TYPE_ONLY | Type-only import with no runtime impact; moves to packages/tools/src/types/ | ToolResultDisplay, FileDiff, FileRead |
| TOOLS_OWNED_INTERFACE | Import replaced by a tools-owned interface; core adapter implements it | Config → IToolHost, MessageBus → IToolMessageBus |
| CORE_ADAPTER | Import satisfied by a core adapter that tools never imports directly | SecureStore → IToolKeyStorage (adapter owns lifecycle) |
| STAY_WITH_RETAINED_CORE_TOOL | Import comes from a file classified STAY_CORE_INFRASTRUCTURE | McpClient from retained mcp-client.ts |
| REPLACE_WITH_TOOLS_OWNED_TYPE | Import replaced by a tools-owned structural type | RuntimeProviderChat, IContent → tools-owned content shapes |
| COPY_STRUCTURAL_TYPE_ONLY | Type-only definition with no runtime behavior; may be copied to tools | AnsiOutput type only — see analysis/non-tools-core-utility-ownership-final.md |
| STAY_CORE_ONLY | Utility used only by core-resident files; does not move | debugLogger for mcp-client-manager, coreEvents for mcp-client-manager |
| FORBIDDEN_UNRESOLVED | Import has no viable replacement and blocks the move | Must be resolved before P11; zero allowed |

## Migration Strategy

1. P00a: Preflight records approved tools-owned interface/core-adapter path.
2. P01-P01a: Extended consumer inventory (18 groups).
3. P02-P02c: Pseudocode and integration contracts with exact interface/adapter mappings.
4. P03-P05a: Scaffold + interface stubs (tools-owned only) + contract implementation.
5. P06-P08a: Build/release wiring + release TDD + release implementation.
6. P09-P09a: Complete move map with retained-file list + dependency relocation.
7. P10-P10a: Behavioral regression TDD with pre-extraction characterization fixtures.
8. P11-P11a: Grouped compile-safe migrations (each group includes interface, adapter, constructor, registry, import rewrites, verification).
9. P12-P12a: Verify/complete remaining adapters and registry/scheduler integration.
10. P13-P13a: Consumer migration (providers + explicit CLI decision).
11. P14-P14a: Release process + scripts coverage + Dockerfile ordering.
12. P15-P15a: Cleanup, no shims, retained-file policy (tool-key-storage.ts stays in core).
13. P16-P16a: Full verification + final review.
