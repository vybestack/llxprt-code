# Feature Specification: Extract Agents Package (Issue #1592)

Plan ID: PLAN-20260610-ISSUE1592

## Purpose

Extract the agent runtime, chat loop, and subagent system out of `packages/core/src/core` and `packages/core/src/agents` into a dedicated workspace package `packages/agents` (`@vybestack/llxprt-code-agents`). This is architectural modularization for parent issue #1568: reduce core's responsibilities and public surface while preserving current runtime behavior exactly. This is a refactoring plan, not a user-visible feature addition.

## Architectural Decisions

- **Pattern**: package-boundary refactoring with contract-first migration, construction inversion via injected factories, and integration-first verification. This mirrors the proven approach used for issue #1584 (providers extraction, PR #1953).
- **Technology Stack**: TypeScript strict mode, Node.js >=20, npm workspaces, Vitest, existing `scripts/build_package.js` build process.
- **Dependency Direction** (MANDATORY, cycle-free):

```text
packages/agents     ->  packages/core (deep module imports, interim until #1585/#1590/#1591 extract further)
packages/agents     ->  packages/auth, packages/settings, packages/telemetry, packages/mcp (as needed, same as core)
packages/cli        ->  packages/agents
packages/cli        ->  packages/core
packages/a2a-server ->  packages/agents
packages/core       -X-> packages/agents   (NO production dependency, ever)
packages/providers  -X-> packages/agents   (NO dependency; providers stays below agents)
packages/agents     -X-> packages/providers (NO dependency; agents consumes provider behavior only through core-owned structural runtime contracts, exactly as core does today post-#1584)
packages/agents     -X-> packages/cli
```

- **No Compatibility Shims**: `packages/core/src/index.ts` must stop exporting moved implementation APIs. Core must not re-export anything from `@vybestack/llxprt-code-agents`. Callers import moved APIs from `@vybestack/llxprt-code-agents` directly.
- **Construction Inversion**: Core code that today constructs moved classes (`AgentClient`, `CoreToolScheduler`, `TaskTool`) must be inverted to injected factories registered on `Config` by the composition roots (CLI, a2a-server, tests). Core-owned factory *types* and structural *contracts* stay in core; concrete classes live in agents.

## Deliberate Deviations From the Issue File List (with rationale)

The issue text lists files assuming `packages/tools`/`packages/policy` already exist and assuming nothing else in core consumes these modules. Preflight analysis shows four listed modules are consumed by code that stays in core and/or by `packages/providers`. Moving them would create a `core -> agents` package cycle or a `providers -> agents` dependency — both forbidden: providers must remain independent of agents, and agents consumes provider behavior only through core-owned runtime contracts (agents must not import providers). Therefore:

| Module | Issue says | This plan | Rationale |
|---|---|---|---|
| `core/contentGenerator.ts` | move | **stays in core** | `ContentGenerator` interface/config consumed by core `config/`, `runtime/AgentRuntimeLoader`, `code_assist/`, `test-utils/`, and `packages/providers` (`ProviderContentGenerator implements ContentGenerator`). It is a model-I/O contract, not chat-loop machinery. |
| `core/loggingContentGenerator.ts` | move | **does not exist** | File no longer exists in the codebase (verified by glob/grep); nothing to move. |
| `core/prompts.ts` | move | **stays in core** | `getCoreSystemPromptAsync` is imported by 5 provider implementation files in `packages/providers`. Moving it forces `providers -> agents`, inverting layering. `prompt-config/` and `prompts/` directories stay in core regardless. |
| `core/tokenLimits.ts` | move | **stays in core** | Consumed by `runtime/createAgentRuntimeContext.ts` (staying in core). Pure data module; no chat-loop logic. |
| `core/logger.ts` | not listed | **stays in core** | Session/checkpoint logger used by CLI hooks; not chat-loop machinery. |

Everything else from the issue list moves. These deviations MUST be stated in the PR description.

## What Moves to packages/agents

From `packages/core/src/core/` (implementation + their co-located tests):

- **Chat loop / client**: `client.ts` (class `AgentClient`), `clientHelpers.ts`, `clientLlmUtilities.ts`, `clientToolGovernance.ts`, `baseLlmClient.ts`, `ConversationManager.ts`, `DirectMessageProcessor.ts`, `MessageConverter.ts`, `MessageStreamOrchestrator.ts`, `MessageStreamTerminalHandler.ts`, `StreamProcessor.ts`, `TurnProcessor.ts`, `IdeContextTracker.ts`, `TodoContinuationService.ts`, `AgentHookManager.ts`, `bucketFailoverIntegration.ts`, `turnLogging.ts`
- **Chat session**: `chatSession.ts`, `ChatSessionFactory.ts` (class implementations; shared types stay, see splits)
- **Turn**: `turn.ts` class `Turn` (event/protocol types stay in core, see splits)
- **Request**: `geminiRequest.ts` — **STAYS in core** (deviation: verified zero move-set consumers; its only importers are staying `tools/glob.test.ts:9` (`partListUnionToString`) and `index.ts:81`. It is a thin alias/util over `utils/partUtils.js`, not chat-loop machinery — moving it would break a stayer test for no benefit)
- **Scheduler**: `coreToolScheduler.ts` (class), `nonInteractiveToolExecutor.ts`; plus `packages/core/src/scheduler/` implementation files (`tool-executor.ts`, `tool-dispatcher.ts`, `result-aggregator.ts`, `confirmation-coordinator.ts`, `status-transitions.ts`, `utils.ts`) — `scheduler/types.ts` stays in core (consumed by `confirmation-bus/types.ts`, `policy/policy-helpers.ts`). `coreToolHookTriggers.ts` STAYS in core: the staying core hooks test `hooks/notification-hook.test.ts:20` imports it and it depends only on staying modules; moved consumers use a core deep subpath. NOTE: `hooks/hooks-caller-application.test.ts` also imports it (:49) but that test MOVES to packages/agents (it constructs the concrete `CoreToolScheduler` at :34-35 — see P03 task 9 disposition table) and will import `coreToolHookTriggers` via the core subpath after the move.
- **Tool governance**: `toolGovernance.ts` (all consumers move with it: `task.ts`, `tool-dispatcher.ts`, `clientToolGovernance.ts`)
- **Subagents**: `subagent.ts`, `subagentOrchestrator.ts`, `subagentScheduler.ts` (implementation; `SubagentSchedulerFactory` type stays in core), `subagentExecution.ts`, `subagentRuntimeSetup.ts`, `subagentToolProcessing.ts`
- **Compression**: `compression/` implementation (`CompressionHandler.ts`, strategies, `compressionBudgeting.ts`, `reasoningUtils.ts`, `utils.ts`, `index.ts`, `compressionStrategyFactory.ts`) and `compression-config.ts` — `compression/types.ts` stays in core (consumed by `services/history/HistoryService.ts`)
- **Lifecycle triggers**: `lifecycleHookTriggers.ts` only if analysis confirms `hooks/index.ts` re-export can be migrated without core importing agents; otherwise it stays in core and movers deep-import it.

From `packages/core/src/agents/` (entire directory): `executor.ts`, `executor-prompt-builder.ts`, `executor-termination.ts`, `executor-validation.ts`, `invocation.ts`, `recovery.ts`, `types.ts`, `utils.ts` + tests. (No consumers outside the directory exist; verified.)

From `packages/core/src/tools/`: `task.ts` (`TaskTool`) — constructs subagent machinery; registration inverted via factory (see REQ-INV-003).

### Subagent boundary: what stays in core (explicit disposition)

- `config/subagentManager.ts` (`SubagentManager`) **stays in core**: it is subagent *configuration* management (reads/writes subagent definition files; imports only fs/path, `config/types`, settings, interfaces, debug utils — zero chat-loop dependencies) and is consumed by core config (`configBaseCore`, `toolRegistryFactory`, `config.ts`, `extensionLoader`, `prompt-config/subagent-delegation`) and by CLI UI (SubagentManagement components, hooks). The agents package consumes it via core deep module, exactly like other core services.
- `tools/list-subagents.ts` (`ListSubagentsTool`) **stays in core**: it depends only on `Config` + `SubagentManager` + base tool classes (verified imports) — no chat-loop machinery. Only `TaskTool` (which constructs `SubAgentScope`/orchestrator/scheduler) moves.
- The boundary rule: subagent *runtime execution* (scope, orchestrator, scheduler, execution, runtime setup, tool processing, TaskTool) moves to agents; subagent *configuration/registry* (SubagentManager, SubagentConfig types, ListSubagentsTool, `subagentTypes.ts` shared types) stays in core.

## What Stays in core (contracts and shared types)

- `core/turn.ts` — becomes types-only: `GeminiEventType`, all `ServerGemini*Event` interfaces, `ServerGeminiStreamEvent`, `ToolCallRequestInfo`, `ToolCallResponseInfo`, `DEFAULT_AGENT_ID`, and related protocol types. Class `Turn` moves out. Existing core-internal `../core/turn.js` imports keep working unchanged.
- `core/chatSessionTypes.ts` — stays (consumed by `utils/generateContentResponseUtilities.ts`).
- `core/subagentTypes.ts` — stays (consumed by `services/asyncTaskManager.ts`, root export of `SubagentTerminateMode`). `SubagentSchedulerFactory` type relocates here (or an equivalent core-owned module) from `subagentScheduler.ts`.
- `core/contentGenerator.ts`, `core/googleGenAIWrapper.ts`, `core/prompts.ts`, `core/tokenLimits.ts`, `core/logger.ts`, `core/compression/types.ts`, `scheduler/types.ts` — stay as today.
- **New core-owned structural contracts** (named for runtime use, NOT provider/agent package compatibility shims):
  - `AgentClientContract` in NEW staying module `core/clientContract.ts` (decided path — distinct from `core/client.ts`, which moves wholesale, so dependency scans can unambiguously separate contract imports from implementation imports): the public surface of the agent client that core (`config/`, `utils/summarizer.ts`, `utils/llm-edit-fixer.ts`, `utils/checkpointUtils.ts`) and CLI/a2a call. Concrete `AgentClient` in agents implements it.
  - `ToolSchedulerContract` (or types-only `coreToolScheduler.ts`): surface used by `config.getOrCreateScheduler` consumers (CLI `useReactToolScheduler`, a2a `agent/task.ts`).
  - `ChatSessionContract` if and only if `AgentClientContract`'s signatures require it (analysis decides the minimal surface).
  - Factory types: `AgentClientFactory`, `ToolSchedulerFactory`, `TaskToolRegistration` descriptor (core-owned; see integration-contract.md).
- `config/schedulerSingleton.ts` stays in core (session-keyed registry/lifecycle) but constructs via injected `ToolSchedulerFactory` instead of dynamic import of the class.

## Required Construction Inversions

[REQ-INV-001] AgentClient inversion
  [REQ-INV-001.1] `Config` no longer imports or constructs class `AgentClient`. It holds an injected `AgentClientFactory` (set via constructor param or setter before first use) and calls it in `initialize()` and `initializeContentGeneratorConfig()`.
  [REQ-INV-001.2] If the factory is missing when needed, throw a clear error naming the wiring requirement.
  [REQ-INV-001.3] CLI and a2a-server composition roots register the factory using the concrete class from `@vybestack/llxprt-code-agents`.
  [REQ-INV-001.4] `Config.getAgentClient()` returns the core-owned contract type.

[REQ-INV-002] CoreToolScheduler inversion
  [REQ-INV-002.1] `config/schedulerSingleton.ts` replaces its dynamic `import('../core/coreToolScheduler.js')` with the injected `ToolSchedulerFactory`.
  [REQ-INV-002.2] `Config.getOrCreateScheduler` keeps its public signature, returning the contract type.
  [REQ-INV-002.3] Composition roots (CLI, a2a-server) register the factory; agents-internal scheduler creation (subagent machinery) constructs the concrete class directly inside the agents package.

[REQ-INV-003] TaskTool inversion
  [REQ-INV-003.1] TWO-STAGE rollout (because `TaskTool` has NO public import path until P03 — it is absent from core's barrel `src/index.ts`, core's package.json exports map, and all CLI/a2a imports; verified by grep):
    - P01: `config/toolRegistryFactory.ts` consumes an injected `TaskToolRegistration` descriptor (plus core-owned `TASK_TOOL_CLASS_NAME`/`TASK_TOOL_NAME` constants) with today's gating logic (profileManager + subagentManager present) preserved exactly. When no registration is injected, it falls back to a CORE-LOCAL DEFAULT registration module (the only remaining file importing `../tools/task.js` in core config) — behavior is byte-identical to today and external composition roots need no wiring yet. This default is NOT a compatibility shim: it is the pre-move implementation living in its pre-move package, scheduled for deletion.
    - P03 (atomic with the move): the core-local default registration module is DELETED along with `tools/task.ts`; BOTH composition roots (CLI and a2a-server) wire `taskToolRegistration` importing the concrete `TaskTool` from `@vybestack/llxprt-code-agents`. After P03, core contains zero imports of the concrete TaskTool in any form.
  [REQ-INV-003.2] ARCHITECTURAL RULE (effective from P03): EVERY composition root that initializes a Config (and therefore builds a tool registry) MUST pass `taskToolRegistration` — that is CLI AND a2a-server (a2a calls `config.initialize()` via `initializeConfig` at a2a-server/src/config/config.ts:44,135-145, and `resolveManagers` at toolRegistryFactory.ts:207-226 AUTO-CREATES ProfileManager/SubagentManager, so TaskTool registers concretely in a2a TODAY — registration absence there would be a behavior regression, not a preserved fallback). During P01-P02 the core-local default registration (REQ-INV-003.1 stage 1) covers both roots automatically.
  [REQ-INV-003.3] Behavior matrix (binding; parity tests required for each row):
    (a) managers present + registration injected → registered ToolRecord identical to today (toolRegistryFactory.ts:247-250);
    (a2) managers present + no injection, core-local default present (P01-P02 state) → registered ToolRecord identical to today (byte-identical metadata to row a);
    (b) managers present + registration ABSENT and no default (post-P03 misconfiguration) → impossible in production wiring (both composition roots pass it); tested as an explicit configuration-error/disabled diagnostic record, documented as non-runtime fallback;
    (c) managers missing → missing-manager ToolRecord preserved exactly (toolRegistryFactory.ts:250-260) using core-owned constants and `toolClass: undefined`.

## Integration Points

### Existing Code That Will Use the Extracted Package

- `packages/cli/src/config/config.ts` + `packages/cli/src/gemini.tsx` (composition root wiring of the three factories)
- `packages/cli/src/ui/utils/autoPromptGenerator.ts` (constructs detached `AgentClient`)
- `packages/cli/src/nonInteractiveCliSupport.ts`, `packages/cli/src/zed-integration/zedIntegration.ts` (`executeToolCall` from nonInteractiveToolExecutor)
- `packages/cli/src/ui/hooks/useReactToolScheduler.ts` (scheduler via Config API; contract types from core)
- ~14 CLI files importing `AgentClient` type, ~5 importing turn event types (event types stay in core, so most CLI imports are unchanged)
- `packages/a2a-server/src/agent/task.ts` (constructs `new AgentClient(...)` at line 154 — must import concrete class from agents; also a Config construction site needing factory params), `packages/a2a-server/src/agent/executor.ts`, `packages/a2a-server/src/config/config.ts` (wiring + scheduler usage)
- `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts` (constructs `ChatSession`; relocates to packages/agents per move-map §H since providers must not depend on agents)
- `packages/core/src/config/config.ts`, `configBaseCore.ts`, `schedulerSingleton.ts`, `toolRegistryFactory.ts` (inverted factories)
- Release/CI: `.github/workflows/release.yml`, `.github/workflows/build-sandbox.yml`, `scripts/prepare-package.js`, root `package.json` workspaces (mirroring providers integration from PR #1953/#1957)

### Existing Code To Be Replaced or Removed

- All moved files under `packages/core/src/core/` and `packages/core/src/agents/` (deleted from core after migration; no wrapper/forwarding files may remain)
- Moved-API export lines in `packages/core/src/index.ts` (`export * from './core/client.js'`, `chatSession.js`, `coreToolScheduler.js` class exports, `nonInteractiveToolExecutor.js`, `baseLlmClient.js`, `SubagentOrchestrator`, etc.) — contract/type exports stay; `geminiRequest.js` export stays as-is (module stays in core). `buildContinuationDirective` (index.ts:85) KEEPS its core export, re-pointed to its new staying core module (CLI integration test consumes it from core — see move-map §E)
- Direct construction of `AgentClient` / `CoreToolScheduler` / `TaskTool` inside core

### User Access Points (must be preserved identically)

- Interactive CLI chat (all providers), non-interactive `-p` prompt mode, zed integration, subagents via `task` tool and `/agents`, todo continuation, compression, checkpointing, a2a server flows.

## Formal Requirements

[REQ-PKG-001] Package boundary
  [REQ-PKG-001.1] New workspace package `packages/agents` named `@vybestack/llxprt-code-agents`, version aligned with other packages, built with `scripts/build_package.js`, tested with vitest, linted/typechecked like siblings.
  [REQ-PKG-001.2] Root `package.json` workspaces list includes `packages/agents` ordered immediately after `packages/providers` and before `packages/cli` (current order: ...core, providers, [agents], cli...).
  [REQ-PKG-001.3] Release workflow publishes the package; sandbox build packs it; `prepare-package.js` handles it (mirror providers).
[REQ-DEP-001] Dependency rules
  [REQ-DEP-001.1] `packages/core` has NO production or dev dependency on `@vybestack/llxprt-code-agents`.
  [REQ-DEP-001.2] `packages/agents` depends on `@vybestack/llxprt-code-core` (and auth/settings/telemetry/mcp as needed) and NOT on `@vybestack/llxprt-code-providers` or `packages/cli`.
  [REQ-DEP-001.3] `packages/providers` gains NO dependency on `@vybestack/llxprt-code-agents`.
  [REQ-DEP-001.4] Core deep-module imports used by agents must resolve through `packages/core` package.json `exports` entries (explicit entries or per-directory subpath patterns).
[REQ-API-001] Public interface
  [REQ-API-001.1] `packages/agents/src/index.ts` exports the public API: `AgentClient`, `ChatSession`, `ChatSessionFactory`, `Turn`, `CoreToolScheduler`, `executeToolCall`, subagent system (`SubAgentScope`, `SubagentOrchestrator`, scheduler factory impl), `TaskTool`, compression entry points, `AgentExecutor` system, and the wiring helpers needed by composition roots.
  [REQ-API-001.2] Core keeps exporting ONLY contracts/types that stay core-owned. No moved implementation is re-exported by core.
  [REQ-API-001.3] No `*V2`, `*New`, copied implementations, or compatibility adapters preserving old import paths.
[REQ-INV-001..003] Construction inversions (above).
[REQ-TEST-001] Tests
  [REQ-TEST-001.1] Tests co-located with moved files move into `packages/agents` and pass there.
  [REQ-TEST-001.2] Core tests that depended on moved concrete classes are updated to inject test factories or move to agents; no test deletions without equivalent coverage relocation.
  [REQ-TEST-001.3] Full workspace verification passes: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, plus smoke test `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`.
[REQ-CLEAN-001] Cleanup
  [REQ-CLEAN-001.1] No file under `packages/core/src` imports from `@vybestack/llxprt-code-agents` (production OR test).
  [REQ-CLEAN-001.2] No leftover moved files, no forwarding stubs, no TODO/HACK markers introduced.
  [REQ-CLEAN-001.3] `npx madge --circular` (or equivalent import-cycle check used in repo) shows no new package-level cycle.

## Behavior Preservation Constraints

- Streaming chat events (order, shape), tool scheduling semantics (confirmation flows, parallel batching, cancellation), subagent isolation (#897), duplicate-output prevention (#898/#905), single-shared-scheduler invariant (#1060), subagent self-identification (#1373), compression behavior, token tracking, retry/failover paths — all MUST be byte-for-byte behavior-identical. No logic edits during moves; only import-path and construction-wiring changes.
- Any file move must preserve git history where practical (`git mv`).

## Constraints

- No external HTTP calls in unit tests; existing test isolation rules per dev-docs/RULES.md (behavioral tests, no mock theater).
- TypeScript strict; `npm run typecheck` green at every phase boundary.
- Intermediate phases must keep the whole workspace green (build/tests) — the plan stages contracts first, then scaffold, then move, then consumer migration, then cleanup.

## Performance Requirements

- No startup-time regression beyond noise: CLI startup must not add synchronous package loading beyond what bundling already does (CLI is bundled by esbuild; verify bundle still resolves workspace deps).
