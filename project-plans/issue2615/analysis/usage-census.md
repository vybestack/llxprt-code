# Cross-Package Usage Census

Read-only analysis. Generated at `05d50c1e8` from `packages/*/src/**/*.{ts,tsx}` by parsing every
`import`/`export ... from` statement whose specifier begins with `@vybestack/llxprt-code`.

Purpose: design the public API from evidence. Every deep import is a consumer stating
"I needed this specific thing and the barrel did not have it." That is a requirements
document nobody has read.

## 0. Totals

| | Count |
|---|---|
| Cross-package import statements | 5,634 |
| — deep (subpath) | 3,285 |
| — root barrel | 2,349 |
| — production | 2,487 |
| — test | 3,147 |

Deep imports by target package:

| Target | Total | Production | Test |
|---|---|---|---|
| core | 2,873 | 1,169 | 1,704 |
| tools | 181 | 114 | 67 |
| providers | 104 | 56 | 48 |
| telemetry | 47 | 25 | 22 |
| auth | 27 | 25 | 2 |
| storage | 25 | 15 | 10 |
| settings | 18 | 13 | 5 |
| agents | 10 | 1 | 9 |

Note the production/test split: **59% of deep imports are in test files.** The public API is
being shaped substantially by test convenience, not by production need.

## 1. Half the surface is types

Of 2,873 core deep imports, **1,472 (51.2%) are type-only**; 1,401 pull values.

Consequence for mechanism choice: a runtime-schema approach (zod) cannot describe the majority
of this surface. Surface control has to be a compile-time artifact. Zod remains the right tool
for *data crossing* the boundary, which is a different problem from *names reachable across* it.

## 2. Demand is extremely concentrated

125 distinct core subpaths are imported. The top 10 account for a large majority of traffic:

| Subpath | n | prod | consumers |
|---|---|---|---|
| `services/history/IContent.js` | 426 | 150 | core, providers, agents, cli, a2a-server |
| `config/config.js` | 297 | 127 | providers, agents, mcp, cli, a2a-server |
| `runtime/providerRuntimeContext.js` | 168 | 33 | providers, agents |
| `debug/index.js` | 125 | 101 | providers, agents, mcp |
| `llm-types/index.js` | 113 | 66 | core, providers, agents, cli |
| `test-utils/runtime.js` | 100 | 3 | providers, agents |
| `services/history/HistoryService.js` | 84 | 21 | agents, cli |
| `debug/DebugLogger.js` | 75 | 61 | providers, agents, mcp |
| `test-utils/providerCallOptions.js` | 72 | 2 | providers |
| `core/turn.js` | 68 | 33 | providers, agents, cli, a2a-server |

448 distinct symbols are reached for. Top demand:

| Symbol | n | type-only |
|---|---|---|
| `IContent` | 355 | 354 |
| `Config` | 266 | **231** |
| `DebugLogger` | 200 | 67 |
| `HistoryService` | 84 | 26 |
| `ContentBlock` | 82 | 81 |
| `createRuntimeConfigStub` | 78 | 0 |
| `ProviderRuntimeContext` | 73 | 57 |

**`Config` is imported 266 times and 231 of those are type-only.** Consumers overwhelmingly want
a *type to annotate against*, not the god-object itself. Role interfaces satisfy 87% of `Config`
demand without touching the implementation.

## 3. Test scaffolding ships in the public API

231 statements import core's `test-utils/*` from other packages:

| Path | n |
|---|---|
| `test-utils/runtime.js` | 100 |
| `test-utils/providerCallOptions.js` | 72 |
| `test-utils/mock-tool.js` | 40 |
| `test-utils/config.js` | 15 |
| `test-utils/tools.js` | 4 |

`createRuntimeConfigStub` (78 calls) and `createProviderCallOptions` (72) are among the most-used
symbols core exposes. A dedicated `test-utils` workspace package already exists. This is pure
misplacement, requires no design, and removes ~231 imports plus several subpaths from core's
surface.

## 4. Dead surface — deletable without any design work

Exported subpaths with zero importers anywhere in the monorepo:

| Package | Subpaths | Used | **Dead** |
|---|---|---|---|
| policy | 9 | 0 | **9 (100%)** |
| providers | 42 | 14 | **28 (67%)** |
| core | 126 | 108 | 18 |
| telemetry | 20 | 16 | 4 |
| tools | 44 | 41 | 3 |
| storage | 11 | 9 | 2 |
| settings | 6 | 5 | 1 |
| auth | 10 | 10 | 0 |
| agents | 3 | 3 | 0 |

**65 dead subpaths across the monorepo**, including every subpath policy exports. Deleting these
is mechanically safe and needs no contract decisions.

## 5. The wildcard aliases are actively used to import unexported paths

19 distinct paths (44 statements) are imported despite being absent from the target's exports map.
They resolve only through the wildcard tsconfig aliases:

| Path | n | by |
|---|---|---|
| `core/test-utils/config.js` | 15 | agents |
| `core/test-utils/tools.js` | 4 | agents |
| `core/hooks/hookSystem.js` | 3 | agents |
| `core/prompt-config/PromptResolver.js` | 3 | agents |
| `core/utils/logger.js` | 3 | agents |

Small in volume, but it is direct proof that the exports map is not binding today. Note
`core/hooks/hookSystem.js` and `core/hooks/HookSystem.js` both appear — a case-collision that
only survives because nothing validates these specifiers.

## 6. Config role clustering (input for the decomposition)

`Config` spans 2,514 lines across `config.ts` (1,020), `configBaseCore.ts` (937) and
`configConstructor.ts` (557), declaring **~200 methods**. Of those, **81 are called from outside
core**; 119 are internal-only and need not appear in any published contract.

Cross-package call distribution is heavily skewed — 5 methods dominate, and ~45 methods are called
exactly once:

| Method | calls | files |
|---|---|---|
| `getToolRegistry` | 70 | 27 |
| `getProviderManager` | 45 | 24 |
| `getSessionId` | 41 | 22 |
| `getEphemeralSetting` | 33 | 9 |
| `getModel` | 32 | 19 |
| `setProviderManager` | 14 | 14 |
| `setEphemeralSetting` | 14 | 5 |
| `refreshAuth` | 12 | 7 |
| `getPolicyEngine` | 12 | 7 |
| `getSettingsService` | 10 | 10 |

The single-call tail is diagnostic: `getSkillManager`, `getExtensionLoader`, `getAsyncTaskManager`,
`getShellJobManager`, `getLspServiceClient`, `getSubagentManager`, `getHookSystem`,
`getPromptRegistry`, `getResourceRegistry`. Each is a *service being fetched through Config*
rather than injected — textbook service-locator usage, and the mechanism by which Config accreted.

### Roles visible in the data

Clustering the 81 externally-called methods by concern:

1. **Tool access** — `getToolRegistry`, `getAllowedTools`
2. **Provider & model** — `get/setProviderManager`, `get/setProvider`, `get/setModel`,
   `getEmbeddingModel`, `refreshAuth`, `get/initializeContentGeneratorConfig`, `getTokenizerFactory`
3. **Session identity** — `getSessionId`, `getMaxSessionTurns`, `isInteractive`
4. **Settings** — `get/setEphemeralSetting`, `getEphemeralSettings`, `getSettingsService`, `getProfileManager`
5. **Workspace & paths** — `getWorkspaceContext`, `getTargetDir`, `getProjectRoot`, `getWorkingDir`, `getProjectTempDir`
6. **Memory** — `get/setUserMemory`, `get/setCoreMemory`, `getGlobalMemory`, `getJitMemoryForPath`, `refreshMemory`, file-count accessors
7. **MCP** — `getMcpServers`, `getMcpClientManager`, `getMcpInstructions`, `refresh/reloadMcpServers`, `getMcpRuntimeStatus`, `getBlockedMcpServers`, `awaitMcpDiscoveryGate`
8. **Policy & approval** — `getPolicyEngine`, `get/setApprovalMode`
9. **Service-locator tail** — the ~15 single-call service getters above; these should become
   constructor injection, not interface members

Roles 1–8 are candidate role interfaces. Role 9 should not exist.

## 7. What the census implies for the target API

- Surface control must be compile-time (51% type-only). Declared barrel plus exports map;
  snapshots of emitted declarations are a derived artifact and can be dropped.
- ~231 test-utils imports and 65 dead subpaths leave the surface with zero design debate.
- `Config`'s cross-package contract is 81 methods, not 200 — and 87% of `Config` references only
  need a type. Role interfaces are sufficient for the overwhelming majority of consumers.
- The concentration (10 subpaths carrying most traffic) means a curated barrel is viable; this is
  not a case where thousands of unrelated symbols are genuinely needed.

## Reproduction

    bun tmp/census.ts     # totals, subpath ranking, symbol demand, dead surface
    bun tmp/census2.ts    # exports-map bypasses, test-utils leakage, Config clustering

Scripts are throwaway analysis kept under the gitignored `tmp/`.
