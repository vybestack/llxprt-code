# Reverse Dependency Map (Preflight Evidence)

Plan ID: PLAN-20260610-ISSUE1592

All data gathered on branch `issue1592` (fresh from main, 2026-06-10) via grep over `packages/*/src`, excluding `*.test.ts` unless noted.

## 1. Non-moved core code importing from `src/core/` (the move set)

These are the ONLY production files outside `src/core/` + `src/agents/` that import moved-or-split modules:

| Importing file (stays in core) | Imports | Resolution strategy |
|---|---|---|
| `adapters/IStreamAdapter.ts` | `turn.js` (`ServerGeminiStreamEvent` type) | turn.ts becomes types-only in core — unchanged |
| `code_assist/codeAssist.ts`, `code_assist/server.ts` | `contentGenerator.js` | contentGenerator stays — unchanged |
| `config/config.ts` | `client.js` (AgentClient class!), `contentGenerator.js`, `coreToolScheduler.js` (type) | **REQ-INV-001**: factory injection; scheduler type -> core contract |
| `config/configBaseCore.ts` | `client.js` (type), `contentGenerator.js`, `subagentScheduler.js` (`SubagentSchedulerFactory` type) | client type -> core contract; factory type relocates to core-owned module |
| `config/schedulerSingleton.ts` | `coreToolScheduler.js` (dynamic import + types) | **REQ-INV-002**: factory injection; types -> core contract |
| `config/toolRegistryFactory.ts` | `tools/task.js` (TaskTool class!), `subagentScheduler.js` (type) | **REQ-INV-003**: factory injection |
| `hooks/index.ts` | `lifecycleHookTriggers.js` (re-export) | lifecycleHookTriggers consumers: `chatSession.ts`, `AgentHookManager.ts` (both move), `hooks/index.ts` (stays). DECISION: lifecycleHookTriggers **stays in core** (it is hook-system glue, not chat loop); movers import it via core deep module. |
| `hooks/tool-render-suppression-hook.ts` | `turn.js` (types) | types stay — unchanged |
| `policy/policy-helpers.ts` | `turn.js` (types) | unchanged |
| `runtime/AgentRuntimeLoader.ts` | `contentGenerator.js` | stays — unchanged |
| `runtime/createAgentRuntimeContext.ts` | `tokenLimits.js`, `contentGenerator.js` | both stay — unchanged |
| `scheduler/*` (moves except types.ts) | `turn.js`, `toolGovernance.js`, `coreToolHookTriggers.js` | scheduler impl moves; `coreToolHookTriggers.ts` STAYS in core (staying hooks test imports it: hooks/notification-hook.test.ts:20; hooks-caller-application.test.ts also imports it at :49 but that test MOVES to agents since it constructs concrete CoreToolScheduler at :34-35) — moved scheduler files and the moved test import it via core subpath |
| `services/asyncTaskManager.ts` | `subagentTypes.js` (types) | stays — unchanged |
| `services/history/HistoryService.ts` | `compression/types.js` | compression/types.ts stays — unchanged |
| `services/loopDetectionService.ts` | `turn.js` (types) | unchanged |
| `services/todo-context-tracker.ts`, `services/tool-call-tracker-service.ts` | `turn.js` (types) | unchanged |
| `tools/task.ts` (MOVES) | subagent modules | moves together |
| `tools/todo-store.ts`, `tools/todo-write.ts` | `turn.js` (types) | unchanged |
| `utils/checkpointUtils.ts` | `client.js` (type), `turn.js` | client type -> core contract |
| `utils/errorParsing.ts` | `turn.js` (types) | unchanged |
| `utils/generateContentResponseUtilities.ts` | `turn.js`, `chatSessionTypes.js` (types) | both stay — unchanged |
| `utils/llm-edit-fixer.ts` | `client.js` (type) | -> core contract |
| `utils/quotaErrorDetection.ts` | `turn.js` (types) | unchanged |
| `utils/summarizer.ts` | `client.js` (type) | -> core contract |
| `test-utils/config.ts` | `contentGenerator.js` | stays — unchanged |
| `telemetry/loggers.test.circular.ts` (test) | `turn.js`, `coreToolScheduler.js` | test: type imports -> contract; update in consumer-migration phase |
| `telemetry/uiTelemetry.test.ts` (test) | `coreToolScheduler.js` (type-only: `CompletedToolCall`, `ErroredToolCall`, `SuccessfulToolCall` at ~17-21) | RETARGET TO CONTRACT — these result types belong in staying `core/toolSchedulerContract.ts` |
| `tools/glob.test.ts` (test) | `geminiRequest.js` (`partListUnionToString` at :9) | unchanged — `geminiRequest.ts` STAYS in core (see move-map) |

KEY INSIGHT: outside `config/` and three `utils/` helpers, every staying-in-core import is a **type-only** import from `turn.js` / `chatSessionTypes.js` / `subagentTypes.js` / `compression/types.js` / `contentGenerator.js` — all of which stay. The class-level couplings are exactly three: `Config` -> `AgentClient`, `schedulerSingleton` -> `CoreToolScheduler`, `toolRegistryFactory` -> `TaskTool`.

## 2. `src/agents/` directory

Zero imports from outside the directory (verified: no `from '.*agents/'` matches outside `src/agents/`, no exports from `index.ts`). Moves wholesale with zero consumer impact. NOTE: `a2a-server`'s `AgentExecutor` (from `@a2a-js/sdk`) is an unrelated same-named type.

## 3. `src/scheduler/` directory

- Implementation files (`tool-executor`, `tool-dispatcher`, `result-aggregator`, `confirmation-coordinator`, `status-transitions`, `utils`) are imported ONLY by `core/coreToolScheduler.ts` and each other → move with the scheduler.
- `scheduler/types.ts` imported by `confirmation-bus/types.ts` (`ToolCall`) and `policy/policy-helpers.ts` (`PolicyContext`) → **stays in core**. Moved impl files import it via core deep module.
- `scheduler/utils.ts` (`setToolContext`) — check consumers; imported by coreToolScheduler + dispatcher only → moves. Re-verify during impl.

## 4. index.ts export surface affected (packages/core/src/index.ts)

```
66: export { SubagentTerminateMode } from './core/subagentTypes.js';        -> stays (types module stays)
73: export * from './core/client.js';                                       -> replaced by contract export
74: export * from './core/baseLlmClient.js';                                -> REMOVE (moves)
75: export * from './core/contentGenerator.js';                             -> stays
76: export * from './core/chatSession.js';                                  -> replaced by types/contract export
77: export * from './core/logger.js';                                       -> stays
78: export * from './core/prompts.js';                                      -> stays
79: export * from './core/tokenLimits.js';                                  -> stays
80: export * from './core/turn.js';                                         -> stays (types-only after split)
81: export * from './core/geminiRequest.js';                                -> KEEP (module STAYS — only consumers are staying tools/glob.test.ts:9 and this export)
82: export * from './core/coreToolScheduler.js';                            -> replaced by contract export
83: export * from './core/nonInteractiveToolExecutor.js';                   -> REMOVE (moves)
84: export type { SubagentSchedulerFactory } from './core/subagentScheduler.js'; -> retarget to core-owned module
85: export { buildContinuationDirective } from './core/compression/utils.js';   -> KEEP exported from core. VERIFIED CONSUMER: cli/src/integration-tests/compression-todo.integration.test.ts:31 imports it from the core root barrel and exercises it at lines 226-310. Since compression impl moves to agents, the function itself must either (a) stay in core (move buildContinuationDirective into a staying core module, e.g. core/compression/types.ts or a small core util, with agents importing it via subpath) or (b) move to agents and the CLI test imports it from agents. Decision: (a) RELOCATE to a staying core module — it is a pure string-building util with no chat-loop deps, and core's TodoContinuationService-adjacent consumers may reasonably need it; verify its imports in P00a and record. Either way: NO shim, single owner.
461: export { SubagentOrchestrator } from './core/subagentOrchestrator.js';  -> REMOVE (moves)
13: export * from './config/schedulerSingleton.js';                         -> stays (inverted internals)
```

## 5. External consumers (cli, a2a-server)

- CLI has NO deep imports of MOVED modules except one: `consumer-migration-p13.integration.test.ts` -> `core/contentGenerator.js` (contentGenerator STAYS, so it remains valid). Note: CLI does have other deep imports of STAYING core modules (e.g. `runtime/settingsRuntimeAdapter.js` in profileBootstrap.ts:17, provider-usage-info.ts:20, providerManagerInstance.ts:24, runtimeContextFactory.ts:36, nonInteractiveCli.ts:26; `test-utils/mock-tool.js` in useToolScheduler.test.ts:51) — these are unaffected by the extraction and need no changes.
- CLI symbol usage (non-test files): `AgentClient` 14 files, `Turn`/`ServerGemini*` 5 files (types — stay in core), `CoreToolScheduler` 2 files (type — contract), `ChatSession` 2 files, `executeToolCall` 2 files, `createContentGenerator` 1 file (stays), `tokenLimit` 1 file (stays).
- CLI constructs `new AgentClient(...)` in `ui/utils/autoPromptGenerator.ts` → import concrete class from agents package.
- a2a-server: `CoreToolScheduler` type in `agent/task.ts` (via Config API — contract type), `GeminiEventType` in 3 files (stays in core). **CRITICAL**: `a2a-server/src/agent/task.ts:154` does `this.agentClient = new AgentClient(this.config, runtimeState)` — a DIRECT concrete construction (verified: `import { AgentClient }` at line 10, field type at line 108). a2a-server MUST add the agents dependency and import the concrete class from `@vybestack/llxprt-code-agents` in P04; it is also a Config construction site that needs factory params in P01.
- a2a-server currently has NO dependency on providers; it depends on core+mcp. Wiring `AgentClientFactory` will add agents dep.

## 5b. providers package test coupling (verified)

`packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts` imports and constructs `ChatSession` from `@vybestack/llxprt-code-core/core/chatSession.js` (line 11) and calls `chatSession.convertIContentToResponse(...)`. Since `ChatSession` moves to agents and providers must NOT depend on agents (even devDependency — boundary rule), this test MUST be relocated to `packages/agents` (it exercises ChatSession conversion behavior; the OpenAI-specific stopReason mapping it asserts flows through IContent metadata, which the relocated test can exercise identically). Disposition recorded in move-map §H.

## 6. providers package

`packages/providers` imports `core/prompts.js`, `core/contentGenerator.js` (type) — both stay in core. NO imports of any moved module. Confirms providers needs no change beyond none.

## 7. Core package.json `exports`

69 subpath entries today, including `./core/contentGenerator.js`, `./core/chatSession.js`, `./core/prompts.js`. After the move, `./core/chatSession.js` must point at the types-only module or be retargeted; agents' deep imports into core (e.g. `./scheduler/types.js`, `./core/turn.js`, `./hooks/*`, `./services/*`, `./utils/*`, `./config/*`, `./tools/*`, `./runtime/*`, `./debug/*`, `./confirmation-bus/*`, `./policy/*`, `./prompt-config/*`, `./test-utils/*`) need exports entries. Strategy: add the specific entries agents actually needs (enumerate during scaffold phase from actual import list), or wildcard subpaths per directory as already partially done for providers.

## 8. Scale

- Move set: ~60 implementation files + ~89 co-located test files from `src/core/`, 11 files from `src/agents/`, 6 files from `src/scheduler/`, 1 file from `src/tools/` (task.ts, 1533 lines). Roughly 61k lines including tests.
