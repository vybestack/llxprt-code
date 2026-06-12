# P03 Code Move Review Final

## Verdict

APPROVE

The current uncommitted P03 implementation satisfies the requested extraction boundaries at the source/package level I inspected. Concrete agent runtime, chat/session, scheduler, subagent runtime, TaskTool, and compression implementations have moved to `packages/agents`; core keeps contracts, structural types, configuration/registry utilities, and explicitly retained shared modules. CLI and A2A now depend on the agents package and wire the required factories/TaskTool registration into `Config`.

I found no blockers. I noted a few minor follow-up items around TypeScript reference consistency, test-only core root-barrel imports, and completion-marker precision.

## Blockers

None.

## Major Issues

None.

## Minor Issues

1. **A2A tsconfig does not add an explicit project reference to agents.**
   - `packages/a2a-server/tsconfig.json` adds agents `paths` and `include` entries, and targeted `npm run typecheck -w @vybestack/llxprt-code-a2a-server` passes.
   - However, the file still has only `"references": [{ "path": "../core" }]`, while the P03 plan said to add agents to references/paths/include as appropriate. This is not currently breaking typecheck, but adding `../agents` as a project reference would make the package dependency graph more explicit and consistent with the new runtime dependency.

2. **Agents tests still import the core root barrel in several scheduler/hook tests.**
   - Production agents code is clean: my production export audit found zero `@vybestack/llxprt-code-core` root-barrel imports and zero missing core subpath exports.
   - Tests have root-barrel imports in files such as `packages/agents/src/core/coreToolScheduler.test.ts`, `coreToolScheduler.duplication.test.ts`, `hooks-caller-application.test.ts`, `messageBus.core-integration.tdd.test.ts`, and `nonInteractiveToolExecutor.test.ts`.
   - The stated requirement was production code, so this is not a blocker. If the project wants stricter package-boundary hygiene, those tests can also move to explicit core subpaths.

3. **P03 completion marker says full verification passed; I only independently reran targeted verification.**
   - `.completed/P03.md` claims full root test/format/typecheck/build/lint and both smoke variants passed.
   - I did not rerun the full battery in this review. I ran targeted agents typecheck, agents test suite, A2A typecheck, and lockfile check, all passing. Treat the full-battery claim as implementation-provided unless reproduced before commit/PR.

## Boundary Findings

- **Core ownership cleanup:** PASS.
  - `packages/core/src/agents` is absent.
  - `packages/core/src/scheduler` contains only `types.ts`.
  - `packages/core/src/tools/task.ts` is absent.
  - `packages/core/src/config/defaultTaskToolRegistration.ts` is absent.
  - `packages/core/src/core` now contains retained modules such as `turn.ts`, `chatSessionTypes.ts`, `clientContract.ts`, `toolSchedulerContract.ts`, `subagentTypes.ts`, retained content/prompt/logger/token modules, and `core/compression/{types,continuationDirective}.ts`.
  - Grep found no concrete `AgentClient`, `ChatSession`, `TaskTool`, `Turn`, `SubAgentScope`, or `SubagentOrchestrator` implementation classes in core. The `CoreToolScheduler` hits in core are local structural test fakes only.

- **Forbidden dependencies:** PASS.
  - No `packages/core` import/package reference to `@vybestack/llxprt-code-agents` was found.
  - No `packages/agents` import/package reference to `@vybestack/llxprt-code-providers` or CLI was found.
  - `packages/agents/package.json` depends on core/auth/settings and direct external libraries, not providers or CLI.

- **Agents production imports:** PASS.
  - Production agents source uses explicit core subpaths and avoids the core package root barrel.
  - A production audit against `packages/core/package.json` exports found zero missing core subpath exports.

- **Composition roots:** PASS.
  - CLI `packages/cli/src/config/configBuilder.ts` imports `AgentClient`, `CoreToolScheduler`, and `createTaskToolRegistration` from `@vybestack/llxprt-code-agents` and injects `agentClientFactory`, `toolSchedulerFactory`, and `taskToolRegistration` into `Config`.
  - CLI isolated runtime `packages/cli/src/runtime/runtimeContextFactory.ts` also wires the three seams for constructed isolated Configs.
  - CLI detached auto-prompt client imports and constructs `AgentClient` from agents.
  - A2A `packages/a2a-server/src/config/config.ts` wires all three seams into `ConfigParameters`.
  - A2A `packages/a2a-server/src/agent/task.ts` imports concrete `AgentClient` from agents for its direct task-local runtime construction.

- **Public exports:** PASS.
  - `packages/agents/src/index.ts` exports the expected concrete public API: `AgentClient`, `ChatSession`, `ChatSessionFactory`, `CoreToolScheduler`, `executeToolCall`, `Turn`, subagent modules, `TaskTool`, compression API, agent executor system, and `createTaskToolRegistration()`.
  - Core root exports contracts/types and retained shared utilities; it does not re-export moved implementations or import/re-export from agents.
  - Core package exports no stale moved implementation paths such as `./core/client.js`, `./core/chatSession.js`, `./core/coreToolScheduler.js`, or `./tools/task.js`.

- **TaskTool registration diagnostic:** PASS.
  - `toolRegistryFactory.ts` records a disabled all-potential-tools diagnostic with `toolClass: undefined`, `toolName: 'TaskTool'`, `displayName: 'task'`, and reason `TaskTool registration was not provided by the composition root` when managers exist but registration is absent.
  - `config.agentInversion.test.ts` covers this post-P03 missing-registration diagnostic path.

- **Continuation directive ownership:** PASS.
  - `buildContinuationDirective` has single ownership in `packages/core/src/core/compression/continuationDirective.ts`.
  - The duplicate implementation was removed from agents compression utils.
  - Agents strategies/tests import the core-owned function via explicit subpath.

- **Package/build config:** PASS with minor note.
  - Root workspaces include `packages/agents` after providers and before CLI.
  - CLI and A2A package dependencies include `@vybestack/llxprt-code-agents`.
  - `package-lock` passes `node scripts/check-lockfile.js`.
  - Release/build-sandbox/version scripts and tests contain agents package handling.
  - `packages/agents/tsconfig.build.json` excludes tests and `src/test-utils/**` from build output.

## Verification Reviewed

I inspected:

- `project-plans/issue1592/specification.md`
- `project-plans/issue1592/analysis/move-map.md`
- `project-plans/issue1592/analysis/reverse-dependency-map.md`
- `project-plans/issue1592/analysis/integration-contract.md`
- `project-plans/issue1592/plan/03-code-move.md`
- `project-plans/issue1592/.completed/P03.md`
- Relevant package manifests, tsconfigs, core exports, agents exports, Config inversion, scheduler singleton, TaskTool registry factory, CLI/A2A composition roots, moved agents runtime files, compression files, and selected tests.

Commands run:

- `git status --short && git diff --stat`
- Boundary greps for core ownership, forbidden imports, root-barrel imports, stale moved core import paths, and continuation directive ownership
- Production agents core-export audit script: zero root-barrel production imports, zero missing core subpath exports
- Core test moved-class reference grep
- `npm run typecheck -w @vybestack/llxprt-code-agents` — PASS
- `npm run test -w @vybestack/llxprt-code-agents` — PASS, 86 files / 1521 tests
- `npm run typecheck -w @vybestack/llxprt-code-a2a-server` — PASS
- `node scripts/check-lockfile.js` — PASS

## Recommended Remediations

1. Add `../agents` to `packages/a2a-server/tsconfig.json` project references unless there is a deliberate reason not to; typecheck already passes, but the dependency is now real and should be explicit.
2. Optionally retarget agents test-only root-barrel imports from `@vybestack/llxprt-code-core` to explicit subpaths for consistency with the production boundary rule.
3. Before commit/PR, rerun the repository’s full verification battery if it has not been rerun after the latest edits: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and the project smoke command.
