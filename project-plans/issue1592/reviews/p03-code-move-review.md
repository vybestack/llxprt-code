# P03 Code Move Review

## Verdict

REVISE

The implementation substantially moves the concrete agent/chat/scheduler/subagent/task/compression code into `packages/agents`, and the primary CLI/A2A composition roots are mostly wired. However, I found boundary/export correctness problems that should be fixed before approving P03. The most important issues are stale core references to moved module paths, agents production code importing the core root barrel despite the P03 plan's hard scan, and incomplete/incorrect core package subpath exports for paths now imported from agents.

## Blockers

1. **Agents production code still imports the core root barrel.**

   P03 explicitly required agents to use core subpaths and included a hard scan for root-barrel imports. The scan is not clean. Production files still import from `@vybestack/llxprt-code-core` directly:

   - `packages/agents/src/core/coreToolScheduler.ts:7`
   - `packages/agents/src/core/coreToolScheduler.ts:8-18`
   - `packages/agents/src/scheduler/status-transitions.ts:23-30`

   These imports are not just tests. This violates the P03 plan's “NO importing the core root barrel from agents” requirement and makes the completion marker's boundary claim incomplete.

2. **Core still contains source tests importing moved implementation module paths that no longer exist in core.**

   The following core tests still refer to moved concrete-module paths:

   - `packages/core/src/utils/checkpointUtils.test.ts:19` imports `AgentClient` from `../core/client.js`.
   - `packages/core/src/telemetry/uiTelemetry.test.ts:17-21` imports scheduler result types from `../core/coreToolScheduler.js`.

   The P03 plan specifically called out these exact dispositions: `checkpointUtils` should use the core-owned contract, and `uiTelemetry.test.ts` should retarget to scheduler contract/types. These are stale moved-path references in core and contradict the completion marker's claim that these tests were updated to structural contracts.

3. **Core package exports include a stale `./core/chatSession.js` subpath even though `packages/core/src/core/chatSession.ts` was moved/deleted.**

   `packages/core/package.json:26` still exports:

   - `./core/chatSession.js`: `./dist/src/core/chatSession.js`

   But `packages/core/src/core/chatSession.ts` no longer exists. That is an accidental compatibility/stale export path for a moved implementation API, contrary to “No Compatibility Shims” and “Core must stop exporting moved implementation APIs.” Even if no current consumer uses it, the package advertises an implementation subpath that should not exist after P03.

4. **Several agents imports reference core subpaths that are not exported by `packages/core/package.json`.**

   The production-critical examples are:

   - `packages/agents/src/test-utils/runtimeProviderManager.ts:13` imports `@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderManager.js`
   - `packages/agents/src/test-utils/runtimeProviderManager.ts:14` imports `@vybestack/llxprt-code-core/runtime/contracts/RuntimeModel.js`

   Those subpaths are not present in the core exports map. Additional test-only imports also lack exports, including `hooks/hookSystem.js`, `hooks/HookSystem.js`, `policy/policy-engine.js`, `prompt-config/PromptResolver.js`, `services/fileDiscoveryService.js`, `services/history/blocks/ThinkingBlock.js`, `test-utils/tools.js`, and `utils/logger.js`. TypeScript path aliases mask this locally, but package consumers and built-package tests/imports can fail under Node package export enforcement.

## Major Issues

1. **P03 completion marker overstates the export audit.**

   `.completed/P03.md` claims “agents production core export audit: missing 0.” My review found at least the agents `src/test-utils/runtimeProviderManager.ts` imports above missing from `packages/core/package.json`. If `src/test-utils` is intentionally non-production, it should either be excluded from build/package output or its imports should be valid package exports. As currently configured, `packages/agents/tsconfig.build.json` includes `src/**/*.ts`, so this file is part of the build input.

2. **P03 completion marker says `packages/core/src/utils/checkpointUtils.test.ts` was retargeted to a type-only contract path, but it was not.**

   It still imports from `../core/client.js`, a moved/deleted path. This is both an accuracy issue in the marker and a concrete source hygiene issue.

3. **P03 completion marker omits `packages/core/src/telemetry/uiTelemetry.test.ts` from the retained-test disposition list even though the P03 plan explicitly listed it as a known mandatory audit item.**

   It still imports from `../core/coreToolScheduler.js`, another moved/deleted path.

4. **The agents public API is mostly present, but `ChatSessionFactory` is not exported.**

   REQ-API-001.1 names `ChatSessionFactory` as part of the public agents API. `packages/agents/src/index.ts` exports `ChatSession`, `AgentClient`, `CoreToolScheduler`, `executeToolCall`, `TaskTool`, `Turn`, subagent modules, compression, and executor APIs, but I did not see `ChatSessionFactory` exported.

5. **Core root still exports scheduler result types incompletely relative to previous root consumers.**

   `packages/core/src/index.ts` exports selected scheduler types from `scheduler/types.js`, but not `ErroredToolCall`, `SuccessfulToolCall`, `ToolCall`, `Status`, handlers, etc. Some consumers may be intentionally moved, but the stale `uiTelemetry.test.ts` import suggests this migration was not fully reconciled.

## Minor Issues

1. The targeted vitest command I tried for the two stale core tests returned “No test files found” because the workspace root/package filter did not match the provided paths. I did not rely on that as evidence of passing tests.

2. `packages/agents/src/index.ts` still has P02 plan annotations at the top while implementing P03 additions. This is not functionally wrong, but the file is now carrying mixed phase metadata.

3. The boundary scan against `packages/agents` matched generated `packages/agents/dist` declarations with root-barrel imports. Those appear to be consequences of source root-barrel imports and should disappear once production imports are retargeted to explicit core subpaths and the package is rebuilt.

## Boundary Findings

- **Core moved implementations:** Most concrete implementations appear to have moved out of `packages/core/src`. A bounded file scan found only the explicitly retained `packages/core/src/scheduler/types.ts` from the scheduler area.
- **Core -> agents imports:** I found no `@vybestack/llxprt-code-agents` imports under `packages/core/src`.
- **Agents -> providers/CLI imports:** I found no direct `@vybestack/llxprt-code-providers` or `@vybestack/llxprt-code-cli` imports under `packages/agents/src` in the focused scans.
- **Agents -> core root barrel:** Not clean. Production imports remain in `coreToolScheduler.ts` and `scheduler/status-transitions.ts`.
- **CLI composition roots:** `packages/cli/src/config/configBuilder.ts` and `packages/cli/src/runtime/runtimeContextFactory.ts` import `AgentClient`, `CoreToolScheduler`, and `createTaskToolRegistration` from `@vybestack/llxprt-code-agents` and wire `agentClientFactory`, `toolSchedulerFactory`, and `taskToolRegistration` into `Config`.
- **A2A composition root:** `packages/a2a-server/src/config/config.ts` imports the concrete agents package and wires all three seams into `ConfigParameters`.
- **A2A task direct construction:** `packages/a2a-server/src/agent/task.ts` imports `AgentClient` from `@vybestack/llxprt-code-agents` and constructs it directly, matching the reverse-dependency map's requirement for that non-Config task runtime.
- **Package dependencies:** `packages/cli/package.json` and `packages/a2a-server/package.json` include `@vybestack/llxprt-code-agents`. `packages/agents/package.json` depends on core/auth/settings and not providers/CLI.
- **Core exports:** Core exports include many required subpaths, but retain the stale `./core/chatSession.js` and miss several subpaths that agents imports.

## Verification Reviewed

Commands/inspections performed:

- `git status --short && git diff --stat HEAD`
- Read the requested specification, move map, reverse dependency map, integration contract, P03 plan, and P03 completion marker.
- Scanned for moved implementation files remaining in `packages/core/src`.
- Scanned `packages/core/src` for `@vybestack/llxprt-code-agents` and moved implementation path imports.
- Scanned `packages/agents` for providers/CLI imports and core root-barrel imports.
- Scanned CLI/A2A Config construction and concrete agents usage.
- Inspected `packages/agents/src/index.ts`, `packages/core/src/index.ts`, `packages/core/package.json`, `packages/agents/package.json`, root workspace config, and agents tsconfig/build config.
- Ran targeted typechecks/builds:
  - `npm run typecheck -w @vybestack/llxprt-code-agents` — passed.
  - `npm run build -w @vybestack/llxprt-code-agents` — passed.
  - `npm run typecheck -w @vybestack/llxprt-code-core` — passed.

I did not run the full verification battery because the static boundary/export findings above are already sufficient to require revision.

## Recommended Remediations

1. Retarget agents production imports from the core root barrel to explicit core subpaths, especially in:
   - `packages/agents/src/core/coreToolScheduler.ts`
   - `packages/agents/src/scheduler/status-transitions.ts`

2. Retarget stale core test imports:
   - `checkpointUtils.test.ts`: use `AgentClientContract` from `../core/clientContract.js` or equivalent structural contract.
   - `uiTelemetry.test.ts`: import scheduler result types from `../scheduler/types.js` or the core-owned scheduler contract path, not `../core/coreToolScheduler.js`.

3. Remove the stale `./core/chatSession.js` export from `packages/core/package.json` unless a real core-owned contract/type module exists at that path. Do not create a forwarding shim to agents.

4. Export every core subpath that agents imports after the import cleanup, or retarget imports to already-exported paths. In particular, resolve the missing runtime contract/test utility subpaths used by agents build inputs.

5. Export `ChatSessionFactory` from `packages/agents/src/index.ts` if it is intended to satisfy REQ-API-001.1.

6. Re-run a clean export audit against `packages/agents/src` after fixes and update `.completed/P03.md` so its claims match the actual source, including the mandatory `uiTelemetry.test.ts` disposition.

7. After remediation, run the P03 full battery from the plan, including workspace typecheck/build/test/lint/format and the smoke test.
