# P03 Code Move Review — Clean

## Verdict

REVISE

The extraction is broadly in the intended shape: concrete chat/client/scheduler/subagent/task/compression files have moved to `packages/agents`, core no longer imports `@vybestack/llxprt-code-agents`, agents has no provider/CLI dependency, and CLI/A2A composition roots now wire the agent client, scheduler, and task-tool registration into core `Config`.

However, I found two blocking conformance/behavior issues against the P03 plan and completion marker:

1. Core silently omits TaskTool from `allPotentialTools` when `taskToolRegistration` is absent instead of emitting the required post-P03 misconfiguration diagnostic record.
2. `buildContinuationDirective` now has two owners/copies: core owns `core/compression/continuationDirective.ts`, but agents still exports an independent implementation from `compression/utils.ts`, and the moved compression strategies import the agents-local copy. This violates the move-map's single-owner/no-shim requirement and creates behavior divergence risk.

## Blockers

### 1. Missing post-P03 TaskTool misconfiguration diagnostic record

Requirement source:

- `project-plans/issue1592/analysis/integration-contract.md` requires post-P03 missing `TaskToolRegistration` to surface as an explicit disabled/diagnostic record when managers are present and no default exists.
- `project-plans/issue1592/specification.md` REQ-INV-003.3 row (b) requires: managers present + registration absent + no default -> explicit configuration-error/disabled diagnostic record.

Current source:

- `packages/core/src/config/toolRegistryFactory.ts`, `registerAgentTools()`, lines 347-386, obtains `const registration = host.getTaskToolRegistration();` and only pushes a TaskTool `ToolRecord` inside `if (registration !== undefined)`. If registration is absent, no TaskTool record is synthesized at all.

Impact:

- The required misconfiguration path is not implemented.
- Settings/UI `allPotentialTools` metadata loses the TaskTool entry entirely for this state, rather than presenting a disabled diagnostic record.
- This contradicts both the integration contract and P03 completion marker's architecture/verification claims around TaskTool registration behavior.

### 2. `buildContinuationDirective` has two concrete implementations after extraction

Requirement source:

- `move-map.md` section E says `buildContinuationDirective` is extracted into a staying core module because CLI imports it from the core root barrel; moved strategies import it via core subpath; "NO shim — single owner (core)."
- P03 plan task 4 similarly requires moved compression code to import staying modules through explicit core subpaths.

Current source:

- Core owner exists: `packages/core/src/core/compression/continuationDirective.ts`.
- Agents still contains a full duplicate implementation: `packages/agents/src/compression/utils.ts`, lines 194-235.
- Agents production strategies import the duplicate from local `./utils.js`:
  - `packages/agents/src/compression/MiddleOutStrategy.ts`, lines 42-50 imports `buildContinuationDirective` from `./utils.js`.
  - `packages/agents/src/compression/OneShotStrategy.ts`, lines 41-49 imports `buildContinuationDirective` from `./utils.js`.

Impact:

- Core and agents can diverge in continuation behavior without tests catching both call paths.
- This is an accidental compatibility/duplication shim in practice, despite the completion marker claiming the function was extracted to core as a single owner.
- The fix should make agents strategies import `buildContinuationDirective` from `@vybestack/llxprt-code-core/core/compression/continuationDirective.js` and remove the duplicate export/function from agents compression utils.

## Major Issues

### 1. Core package exports are not sufficient for at least one core subpath used by agents tests/documented extraction

`packages/core/package.json` does not export `./core/compression/continuationDirective.js`, even though agents tests import that subpath and the move-map explicitly establishes it as the new core-owned location. My audit command reported:

- missing export `./core/compression/continuationDirective.js`

Production agents code currently avoids this missing export only because it incorrectly imports the duplicate local agents implementation. Once blocker #2 is fixed, this export must be added for package-boundary correctness.

Additional missing exports found by a full agents source audit were test-only or `packages/agents/src/test-utils`-only in the current tree, including `./runtime/contracts/RuntimeModel.js`, `./runtime/contracts/RuntimeProviderManager.js`, `./test-utils/config.js`, and several hook/policy/test utility paths. These are not production blockers if intentionally limited to source-path test execution, but they mean the completion marker's broad "missing 0" export claim should be narrowed to production-only and re-run after the continuation directive fix.

### 2. P03 completion marker overstates TaskTool behavior parity

`.completed/P03.md` claims core is factory-driven and that TaskTool registration behavior is preserved. The composition roots do pass `createTaskToolRegistration()`, so normal production wiring is covered, but the required absence diagnostic behavior is missing as described in Blocker #1. The completion marker should be corrected after remediation and test coverage should explicitly exercise the missing-registration post-P03 diagnostic row.

## Minor Issues

### 1. Agents tests still import the core package root barrel

Production agents code passed the root-barrel audit, but several agents tests import from `@vybestack/llxprt-code-core` root, for example:

- `packages/agents/src/core/coreToolScheduler.duplication.test.ts`
- `packages/agents/src/core/coreToolScheduler.test.ts`
- `packages/agents/src/core/hooks-caller-application.test.ts`
- `packages/agents/src/core/messageBus.core-integration.tdd.test.ts`
- `packages/agents/src/core/nonInteractiveToolExecutor.test.ts`
- `packages/agents/src/core/coreToolScheduler.contextBudget.test.ts`
- `packages/agents/src/core/coreToolScheduler.raceCondition.test.ts`

The explicit review requirement only calls out agents production code, so this is not a blocker. Still, using explicit subpaths in moved tests would make boundary expectations more uniform and reduce accidental reliance on the root barrel.

### 2. Some comments still describe P01 default fallback semantics after P03

`ToolRegistryHost.getTaskToolRegistration()` comment in `packages/core/src/config/toolRegistryFactory.ts` still says it returns undefined "to use core-local default". The core-local default is deleted in P03, so that comment is stale and should be updated to describe post-P03 misconfiguration semantics.

### 3. `packages/a2a-server/tsconfig.json` includes agents source but does not add an agents project reference

The file adds agents path mappings/includes and excludes agents tests, but `references` remains only `[{ "path": "../core" }]`. This may be acceptable because `packages/agents` is not composite, but it is inconsistent with the intent to mirror sibling package resolution. If agents later becomes composite, this will need cleanup.

## Boundary Findings

### Core ownership / leftovers

Reviewed with find/grep:

- `packages/core/src/agents` is gone.
- Concrete moved files such as `core/client.ts`, `core/chatSession.ts`, `core/coreToolScheduler.ts`, `core/subagent.ts`, `tools/task.ts`, and `config/defaultTaskToolRegistration.ts` are absent from core.
- Remaining core `class CoreToolScheduler` hits are local test fakes in `packages/core/src/config/config.scheduler.test.ts` and `packages/core/src/config/config.test.ts`, not moved production implementations.
- Core `turn.ts` is now protocol/type definitions only; agents owns the concrete `Turn` class in `packages/agents/src/core/turn.ts`.
- Core retains expected structural/type/shared modules such as `clientContract.ts`, `toolSchedulerContract.ts`, `subagentTypes.ts`, `scheduler/types.ts`, `compression/types.ts`, and `compression/continuationDirective.ts`.

### Dependency direction

Reviewed with greps:

- No `@vybestack/llxprt-code-agents` imports or dependency entries were found under `packages/core` or `packages/providers`.
- No `@vybestack/llxprt-code-providers` imports/dependency entries were found under `packages/agents`.
- No CLI package imports were found under `packages/agents`; the grep hit in `providerAgnosticNaming.test.ts` is a string literal in a test description.
- Agents production code avoids importing the core root barrel. Root barrel imports remain in agents tests only.

### Composition roots

CLI:

- `packages/cli/src/config/configBuilder.ts` imports agents concrete APIs and passes:
  - `agentClientFactory: (config, runtimeState) => new AgentClient(config, runtimeState)`
  - `toolSchedulerFactory: (options) => new CoreToolScheduler(options)`
  - `taskToolRegistration: createTaskToolRegistration()`
- `packages/cli/src/runtime/runtimeContextFactory.ts` also wires the same seams for its Config construction path.
- CLI direct concrete usage such as `autoPromptGenerator.ts` now imports `AgentClient` from agents.

A2A:

- `packages/a2a-server/src/config/config.ts` imports agents concrete APIs and passes all three seams into `ConfigParameters`.
- `packages/a2a-server/src/agent/task.ts` imports `AgentClient` from agents and directly constructs it for the A2A task lifecycle, matching the plan's direct-construction migration point.

### Public exports / package config

- `packages/agents/src/index.ts` exports the expected public surface: `AgentClient`, `ChatSession`, `ChatSessionFactory`, `CoreToolScheduler`, `executeToolCall`, `Turn`, subagent modules, `TaskTool`, compression, and agent executor APIs, plus `createTaskToolRegistration()`.
- `packages/core/src/index.ts` removed moved implementation exports and now exports contracts/types/staying utilities.
- Core package exports removed stale `./core/chatSession.js`, `./core/client.js`, and `./core/coreToolScheduler.js` entries.
- Missing `./core/compression/continuationDirective.js` export should be added as part of resolving blocker #2.

### Tests

- Moved tests are present under `packages/agents/src` for chat/client/scheduler/subagent/task/compression/agent executor areas.
- Provider-coupled moved tests appear to have been rewritten to structural fakes (`TestRuntimeProviderManager`) rather than importing providers.
- The former provider OpenAI stopReason/ChatSession coupling was relocated into agents as `packages/agents/src/core/MessageConverter.stopReason.test.ts`, with no providers dependency.
- Core tests that remain use structural fakes/contracts for AgentClient/scheduler where inspected.

### Build/package metadata

- Root workspaces include `packages/agents` between providers and CLI.
- CLI and A2A package.json files depend on `@vybestack/llxprt-code-agents`.
- Agents package depends on core/auth/settings and not providers/CLI.
- Release, sandbox, and version scripts/workflows contain agents package handling.
- `package-lock.json` was updated.

## Verification Reviewed

Commands/read operations used for this review included:

- `git status --short && git diff --stat HEAD`
- Read P03 specification, move map, reverse-dependency map, integration contract, P03 plan, and completion marker.
- Greps for forbidden imports/dependencies:
  - core/providers -> agents
  - agents -> providers/CLI
  - agents production -> core root barrel
- Greps/finds for remaining core moved implementation files/classes.
- Greps for CLI/A2A agents imports and Config factory/task registration wiring.
- Read key files:
  - `packages/agents/src/index.ts`
  - `packages/core/src/index.ts`
  - `packages/core/package.json`
  - `packages/agents/package.json`
  - `packages/agents/tsconfig.json`
  - `packages/agents/tsconfig.build.json`
  - `packages/cli/package.json`
  - `packages/cli/tsconfig.json`
  - `packages/cli/tsconfig.build.json`
  - `packages/a2a-server/package.json`
  - `packages/a2a-server/tsconfig.json`
  - `packages/cli/src/config/configBuilder.ts`
  - `packages/a2a-server/src/config/config.ts`
  - `packages/a2a-server/src/agent/task.ts`
  - `packages/core/src/config/toolRegistryFactory.ts`
  - `packages/core/src/core/turn.ts`
  - `packages/agents/src/core/turn.ts`
  - `packages/core/src/core/compression/continuationDirective.ts`
  - `packages/agents/src/compression/utils.ts`
  - `packages/agents/src/compression/MiddleOutStrategy.ts`
  - `packages/agents/src/compression/OneShotStrategy.ts`
- Audited agents explicit core subpath imports against `packages/core/package.json` exports.

I did not run the full test/lint/typecheck/build battery during this review; I relied on targeted source and boundary inspection.

## Recommended Remediations

1. Implement the required post-P03 missing-registration diagnostic in `packages/core/src/config/toolRegistryFactory.ts`:
   - When managers are present but `taskToolRegistration` is undefined, push a disabled TaskTool `ToolRecord` with core-owned identity constants (`TaskTool`, `task`), `toolClass: undefined`, empty or documented args, and a clear configuration-error reason.
   - Add/adjust core tests for REQ-INV-003.3 row (b).

2. Make `buildContinuationDirective` single-owner in core:
   - Export `./core/compression/continuationDirective.js` from `packages/core/package.json`.
   - Update `MiddleOutStrategy.ts` and `OneShotStrategy.ts` to import it from the core subpath.
   - Remove the duplicate function and private `extractFirstTaskContent` helper from `packages/agents/src/compression/utils.ts` if no other local consumers remain.
   - Ensure tests cover the core-owned function and strategy call path.

3. Re-run the production core-export audit after the continuation fix and update `.completed/P03.md` to reflect exact results.

4. Optionally retarget agents tests away from the core root barrel to explicit core subpaths for consistency with production boundary rules.

5. Update stale comments in `toolRegistryFactory.ts` that still describe the deleted P01/P02 core-local TaskTool fallback.

6. Run the required verification battery after changes: agents/core tests, full workspace tests, lint, typecheck, format, build, lockfile check, and the project smoke command.
