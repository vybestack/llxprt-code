# Move Map: core -> agents

Plan ID: PLAN-20260610-ISSUE1592

Concrete file-by-file disposition. Source paths relative to `packages/core/src/`, destinations relative to `packages/agents/src/`. Co-located `*.test.ts`/`*.spec.ts`/`__tests__`/`__snapshots__`/`__mocks__` follow their subjects unless noted. Use `git mv`.

## A. MOVE — chat loop & client (-> agents/src/core/)

| Source | Dest | Notes |
|---|---|---|
| core/client.ts | core/client.ts | class `AgentClient` + `FullEventLoggingPayload` etc. Core keeps a NEW contract-only `core/clientContract.ts` (see splits) |
| core/clientHelpers.ts | core/clientHelpers.ts | |
| core/clientLlmUtilities.ts | core/clientLlmUtilities.ts | |
| core/clientToolGovernance.ts | core/clientToolGovernance.ts | imports prompt-config via core deep module |
| core/baseLlmClient.ts | core/baseLlmClient.ts | |
| core/ConversationManager.ts | core/ConversationManager.ts | |
| core/DirectMessageProcessor.ts | core/DirectMessageProcessor.ts | |
| core/MessageConverter.ts | core/MessageConverter.ts | |
| core/MessageStreamOrchestrator.ts | core/MessageStreamOrchestrator.ts | |
| core/MessageStreamTerminalHandler.ts | core/MessageStreamTerminalHandler.ts | |
| core/StreamProcessor.ts | core/StreamProcessor.ts | |
| core/TurnProcessor.ts | core/TurnProcessor.ts | |
| core/IdeContextTracker.ts | core/IdeContextTracker.ts | |
| core/TodoContinuationService.ts | core/TodoContinuationService.ts | CLI references type via agents or core contract — audit |
| core/AgentHookManager.ts | core/AgentHookManager.ts | imports lifecycleHookTriggers from core deep module |
| core/bucketFailoverIntegration.ts | core/bucketFailoverIntegration.ts | |
| core/turnLogging.ts | core/turnLogging.ts | |
| core/chatSession.ts | core/chatSession.ts | class `ChatSession`; types consumed by stayers live in chatSessionTypes.ts (already separate, stays in core) |
| core/ChatSessionFactory.ts | core/ChatSessionFactory.ts | |
| core/geminiRequest.ts | **STAYS in core** | Zero move-set consumers; staying `tools/glob.test.ts:9` imports `partListUnionToString`; thin wrapper over staying `utils/partUtils.js`. index.ts:81 export unchanged. |
| core/googleGenAIWrapper.ts | STAYS in core | used by contentGenerator.ts (stays) |
| core/logger.ts | STAYS in core | session logger, CLI consumers |
| core/prompts.ts, core/tokenLimits.ts, core/contentGenerator.ts | STAY | see specification deviations |

## B. SPLIT — turn.ts

- `core/turn.ts` STAYS as types/protocol module: `GeminiEventType`, all event interfaces, `ServerGeminiStreamEvent`, `ToolCallRequestInfo`, `ToolCallResponseInfo`, `DEFAULT_AGENT_ID`, etc.
- class `Turn` (and any logic-bearing members) MOVES to `agents/src/core/turn.ts`, importing the protocol types from core.
- Verify CLI's 5 `Turn`-referencing files: if they only use it as a type for `sendMessageStream` return, the core contract uses a minimal `TurnResultContract` or re-uses the agents type structurally — P03 decides with call-site evidence; default: core contract avoids referencing class Turn (use structural type).

## C. MOVE — scheduler

| Source | Dest |
|---|---|
| core/coreToolScheduler.ts (class + helpers) | core/coreToolScheduler.ts — moves wholesale; core keeps contract-only types (`ToolSchedulerContract`, options/callbacks types) in NEW staying module `core/toolSchedulerContract.ts` (distinct path so scans unambiguously separate contract from implementation, same rule as clientContract.ts) |
| core/nonInteractiveToolExecutor.ts | core/nonInteractiveToolExecutor.ts |
| core/coreToolHookTriggers.ts | **STAYS in core** — consumed by the staying core hooks test `hooks/notification-hook.test.ts:20` and depends only on staying modules (config, hooks/types, tools/tools, debug — verified lines 13-24). Moved consumers (`coreToolScheduler.ts:33`, `scheduler/tool-executor.ts:24`, and `hooks/hooks-caller-application.test.ts` which MOVES to agents per §H since it constructs concrete `CoreToolScheduler` at :34-35) import it via core deep subpath (`@vybestack/llxprt-code-core/core/coreToolHookTriggers.js`); add exports-map entry in P02. |
| core/toolGovernance.ts | core/toolGovernance.ts (consumers all move: task.ts, tool-dispatcher.ts, clientToolGovernance.ts) |
| scheduler/tool-executor.ts | scheduler/tool-executor.ts |
| scheduler/tool-dispatcher.ts | scheduler/tool-dispatcher.ts |
| scheduler/result-aggregator.ts | scheduler/result-aggregator.ts |
| scheduler/confirmation-coordinator.ts | scheduler/confirmation-coordinator.ts |
| scheduler/status-transitions.ts | scheduler/status-transitions.ts |
| scheduler/utils.ts | scheduler/utils.ts (verify no stayer consumers) |
| scheduler/types.ts | STAYS in core (confirmation-bus, policy-helpers consume) |

Note: today `coreToolScheduler.ts` re-exports scheduler types (`export {...} from '../scheduler/types.js'`). Whatever stayers/CLI import via root index must keep resolving from core's contract module.

## D. MOVE — subagents & task tool

| Source | Dest |
|---|---|
| core/subagent.ts | core/subagent.ts |
| core/subagentOrchestrator.ts | core/subagentOrchestrator.ts |
| core/subagentScheduler.ts | core/subagentScheduler.ts — `SubagentSchedulerFactory` TYPE relocates to core (`core/subagentTypes.ts` or new core module); agents module imports the type from core |
| core/subagentExecution.ts | core/subagentExecution.ts |
| core/subagentRuntimeSetup.ts | core/subagentRuntimeSetup.ts |
| core/subagentToolProcessing.ts | core/subagentToolProcessing.ts |
| core/subagentTypes.ts | STAYS in core (asyncTaskManager + root export) |
| tools/task.ts (TaskTool) | tools/task.ts |

### D2. STAYS — subagent configuration layer (explicit disposition)

| File | Why it stays |
|---|---|
| config/subagentManager.ts | Subagent config/registry management; imports only fs/path, config/types, settings, interfaces, debug (verified lines 9-14); consumed by core config (configBaseCore, toolRegistryFactory, config.ts, extensionLoader, prompt-config/subagent-delegation) + CLI UI (SubagentManagement components/hooks). Agents consumes via core deep module. |
| tools/list-subagents.ts | Depends only on base tool classes + Config + SubagentManager types (verified lines 7-16); no chat-loop machinery. |
| core/subagentTypes.ts | Shared types; SubagentSchedulerFactory type relocates here (see §D). |

Boundary rule: subagent runtime EXECUTION moves (scope/orchestrator/scheduler/execution/runtime-setup/tool-processing/TaskTool); subagent CONFIGURATION/registry stays in core. Because ListSubagentsTool stays, the TaskToolRegistration descriptor does NOT need to generalize to other tools.


## E. MOVE — compression

| Source | Dest |
|---|---|
| core/compression/CompressionHandler.ts | core/compression/CompressionHandler.ts |
| core/compression/compressionBudgeting.ts | core/compression/compressionBudgeting.ts |
| core/compression/compressionStrategyFactory.ts | core/compression/compressionStrategyFactory.ts |
| core/compression/HighDensityStrategy.ts | core/compression/HighDensityStrategy.ts |
| core/compression/MiddleOutStrategy.ts | core/compression/MiddleOutStrategy.ts |
| core/compression/OneShotStrategy.ts | core/compression/OneShotStrategy.ts |
| core/compression/TopDownTruncationStrategy.ts | core/compression/TopDownTruncationStrategy.ts |
| core/compression/reasoningUtils.ts | core/compression/reasoningUtils.ts |
| core/compression/utils.ts | core/compression/utils.ts — EXCEPT `buildContinuationDirective` (line ~194), which is extracted into a STAYING core module (e.g. alongside `core/compression/types.ts` or a small `continuationDirective.ts`) because `cli/src/integration-tests/compression-todo.integration.test.ts:31` imports it from core's root barrel. It is a pure string util with staying-module deps only. Moved strategies (MiddleOutStrategy:42, OneShotStrategy:41) import it via core subpath. Core index.ts line 85 re-points to the new staying location. NO shim — single owner (core). |
| core/compression/index.ts | core/compression/index.ts |
| core/compression/__tests__/* | core/compression/__tests__/* |
| core/compression/types.ts | STAYS in core (HistoryService consumer) |
| core/compression-config.ts | core/compression-config.ts (verify stayer consumers; chatSession-only ⇒ moves) |

## F. MOVE — agents executor system (wholesale)

`agents/**` -> `agents/src/agents/**` (zero external consumers).

## G. STAYS — with internal changes (inversion)

| File | Change |
|---|---|
| config/config.ts | replace `new AgentClient(...)` with injected factory (ConfigParameters); scheduler type import -> contract |
| config/configBaseCore.ts | `AgentClient` type -> `AgentClientContract`; factory storage |
| config/schedulerSingleton.ts | dynamic class import -> injected `ToolSchedulerFactory` |
| config/toolRegistryFactory.ts | `TaskTool` import -> injected `TaskToolRegistration` descriptor + `TASK_TOOL_CLASS_NAME`/`TASK_TOOL_NAME` constants |
| utils/summarizer.ts, utils/llm-edit-fixer.ts, utils/checkpointUtils.ts | type-only `AgentClient` -> `AgentClientContract` |
| hooks/index.ts | keeps re-exporting lifecycleHookTriggers (STAYS in core per reverse-dep analysis) |
| index.ts | remove moved-impl exports; export contracts; keep type modules |
| test-utils/config.ts | factory fakes |

lifecycleHookTriggers.ts: STAYS in core (hooks-system glue; consumers AgentHookManager/chatSession deep-import from core after move).

## H. Tests

- Co-located tests move with subjects (≈89 files from src/core, plus agents/, scheduler/, task tests).
- Stayer tests referencing moved concrete classes (`config/config.test.ts`, `utils/{checkpointUtils,summarizer}.test.ts`, `tools/{edit,write-file}.test.ts`, `telemetry/loggers.test.circular.ts`, lsp tests) — audit each: if they only need a client-shaped object, switch to structural fakes; if they exercise moved behavior, move to agents.
- **`hooks/hooks-caller-application.test.ts` MOVES to agents** (decided): it imports `ToolCall`/`SuccessfulToolCall` and constructs the concrete `CoreToolScheduler` (:34-35, ~220) to exercise the moved scheduler's hook-trigger behavior end-to-end; staying in core would require a forbidden core→agents dependency. After the move it imports the staying `coreToolHookTriggers.ts` via core deep subpath. (`hooks/notification-hook.test.ts` STAYS — it only imports `coreToolHookTriggers`.)
- **providers test relocation**: `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts` constructs `ChatSession` (line 11 import, line 79 construction). providers must not depend on agents — MOVE this test to `packages/agents/src/__tests__/` (or equivalent), keeping its assertions identical. It needs `ProviderManager` from providers — agents must NOT depend on providers either, so the relocated test must replace `ProviderManager` with a structural provider-adapter fake (the test only needs `convertIContentToResponse`, which doesn't call providers; verify and simplify accordingly). Record final form in P03 completion notes.
- **moved chatSession tests importing providers**: `core/chatSession.issue1729.test.ts:8`, `core/chatSession.runtime.test.ts:15`, `core/chatSession.thinking-toolcalls.test.ts:46` import from `@vybestack/llxprt-code-providers`. After moving to agents these would create an agents→providers TEST dependency, which is forbidden (boundary rule covers tests). Disposition: rewrite the provider usage in these tests to structural fakes implementing the core runtime provider contracts (same approach core uses post-#1584), preserving every behavioral assertion. If a fake cannot reproduce the scenario, escalate in P03 completion notes rather than silently weakening the test.
- `core/src/index.test.ts` updated for new export surface.

## I. Package metadata / build / CI

- `packages/agents/package.json` (name `@vybestack/llxprt-code-agents`, deps: core, auth?, settings?, telemetry?, mcp? — derive from actual imports; vitest/tsconfig mirroring providers).
- Root workspaces: add `packages/agents` between core/providers and cli.
- cli/package.json + a2a-server/package.json: add agents dep.
- core/package.json `exports`: add subpath entries needed by agents' deep imports (enumerated at scaffold time).
- `.github/workflows/release.yml`: publish agents (mirror providers, PR #1957 pattern); `build-sandbox.yml`: pack agents; `scripts/prepare-package.js`: include agents; esbuild bundle config: verify workspace resolution.
- `scripts/build_sandbox.js`: providers handled at lines ~97, ~159-165, ~225-227 (`providersPackageDir`, `npm pack -w`, tgz path) — mirror each for agents.
- `scripts/version.js`: providers listed at line ~50 in the version-bump package list — add agents.
- Sandbox/bundle: `npm pack -w @vybestack/llxprt-code-agents` in sandbox build.
