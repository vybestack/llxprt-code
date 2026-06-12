# P01a Implementation Review — Issue #1592 Construction Inversion

Verdict: **APPROVE**

Reviewed against:
- `project-plans/issue1592/plan/01-contracts-inversion.md`
- `project-plans/issue1592/analysis/integration-contract.md`

Typecheck run: `npm run typecheck` — passed.

## Summary

The P01 construction inversion is implemented correctly enough to approve. The core construction seams are present, production config code no longer constructs `AgentClient` directly, scheduler construction is delegated to an injected factory at first use, `toolRegistryFactory` no longer imports `tools/task.ts` directly, and the TaskTool metadata mapping preserves the required `className -> toolName` and `staticName -> displayName` semantics.

## Blockers

None.

## Majors

None.

## Minors

1. **New TaskTool contract uses `any` for `toolClass` rather than the plan's `unknown` wording.**
   - `packages/core/src/config/toolRegistryFactory.ts:74-85`
   - `packages/core/src/config/toolRegistryFactory.ts:99-106`
   - This matches the existing `ToolRecord.toolClass` style and is not behavior-breaking, but it is slightly less type-safe than the integration contract sketch (`toolClass: unknown`). If tightening is feasible later, prefer `unknown` or a structural constructor/static-name shape.

2. **The new P01 seam tests lean on fakes/mocks for some behavior assertions.**
   - `packages/core/src/config/config.agentInversion.test.ts:134-153`
   - `packages/core/src/config/config.agentInversion.test.ts:155-204`
   - These do prove the object identity and singleton/factory handoff expectations for the new seams, and existing scheduler tests still exercise the concrete scheduler. This is not a blocker for the implementation review, but the phase plan asked for behavioral/no-mock-theater emphasis, so future follow-up should keep real behavior coverage in mind.

## Targeted Findings

### AgentClient construction inversion

Pass.

- `packages/core/src/config/config.ts` imports only `AgentClientContract` / `AgentClientFactory` from `core/clientContract.js`, not the concrete client (`config.ts:17-20`).
- `Config.initialize()` obtains an injected factory via `requireAgentClientFactory('initialize')` and calls it with `(this, this.runtimeState)` (`config.ts:199-205`).
- `initializeContentGeneratorConfig()` creates the replacement client through the same factory after rebuilding runtime state (`config.ts:333-340`), then transfers history and disposes the previous client (`config.ts:341-369`).
- Targeted grep found no non-test `new AgentClient(` under `packages/core/src` outside the concrete client/test files.
- Missing factory is not validated by the constructor; it throws only at first client use (`config.ts:241-248`).

### Scheduler construction inversion

Pass.

- `packages/core/src/config/schedulerSingleton.ts` imports only contract types from `core/toolSchedulerContract.js` (`schedulerSingleton.ts:12-17`).
- No production import/dynamic import/require of `core/coreToolScheduler.js` remains in `packages/core/src/config`; matches are test-only (`config.scheduler.test.ts:21,28`).
- `createNewScheduler()` requires `config.getToolSchedulerFactory()` at use time and calls the injected factory with the scheduler options (`schedulerSingleton.ts:265-292`).
- Missing factory throws at scheduler creation time, not Config construction time (`schedulerSingleton.ts:275-279`).
- Existing singleton behavior is preserved through `schedulerEntries` / `schedulerInitStates` and the factory result is stored per session (`schedulerSingleton.ts:78-79`, `schedulerSingleton.ts:303-311`, `schedulerSingleton.ts:323-363`).

### TaskTool inversion and metadata preservation

Pass.

- `toolRegistryFactory.ts` no longer imports `../tools/task.js` directly. The only config production import of that module is the allowed default module:
  - `packages/core/src/config/defaultTaskToolRegistration.ts:19`
- `toolRegistryFactory.ts` imports `defaultTaskToolRegistration` instead (`toolRegistryFactory.ts:38-43`), consistent with the P01/P02 two-stage rule.
- Metadata mapping is correct:
  - `TASK_TOOL_CLASS_NAME = 'TaskTool'`, `TASK_TOOL_NAME = 'task'` (`toolRegistryFactory.ts:66-68`).
  - Registration path sets `toolName` from `registration.className` and `displayName` from `registration.staticName || className` (`toolRegistryFactory.ts:233-260`).
  - Default registration uses `TaskTool.name` for `className` and `TaskTool.Name` for `staticName` (`defaultTaskToolRegistration.ts:25-28`).
- Allow-list/exclude semantics still match both class and static names (`toolRegistryFactory.ts:239-255`), and `ensureCoreToolIncluded` still force-includes both identifiers (`toolRegistryFactory.ts:451-455`).
- Missing-manager and post-P03 missing-registration diagnostic paths are distinct (`toolRegistryFactory.ts:365-404`).

### Composition roots

Pass.

- CLI config builder provides both factories:
  - `packages/cli/src/config/configBuilder.ts:320-330`
- CLI runtime context fallback config also provides both factories:
  - `packages/cli/src/runtime/runtimeContextFactory.ts:224-241`
- a2a server config parameters provide both factories:
  - `packages/a2a-server/src/config/config.ts:69-106`
- P01 correctly does not wire `taskToolRegistration` from CLI/a2a yet, matching the two-stage rule in the plan/integration contract.

### Constructor absence semantics

Pass.

- `Config` constructor only applies params (`config.ts:106-110`).
- `applyConfigParams` stores optional factories without requiring them (`configConstructor.ts:437-441`).
- Use-time errors are emitted by `Config.requireAgentClientFactory()` and `schedulerSingleton.createNewScheduler()`, not construction.

### Core-owned contracts and dependency direction

Pass.

- New staying modules exist and are exported:
  - `packages/core/src/core/clientContract.ts`
  - `packages/core/src/core/toolSchedulerContract.ts`
  - `packages/core/src/index.ts:74-75`
- Concrete classes implement the contracts:
  - `packages/core/src/core/client.ts:73`
  - `packages/core/src/core/coreToolScheduler.ts:101`
- The contracts are core-owned and do not depend on a future agents package. No `@vybestack/llxprt-code-agents` imports were found.

### Behavior preservation / no shims

Pass.

- No compatibility shim for a moved agents package was introduced.
- Existing public class exports remain available during P01 through core, while construction is inverted in `Config` and scheduler creation.
- `npm run typecheck` passed across workspaces.
