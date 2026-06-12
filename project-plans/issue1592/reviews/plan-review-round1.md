# Plan Review Round 1: Issue #1592 Extract packages/agents

## Scope reviewed

Reviewed `project-plans/issue1592/specification.md`, `analysis/*.md`, `plan/*.md`, `execution-tracker.md`, and `dev-docs/PLAN.md` against the current codebase under `/Users/acoliver/projects/llxprt/branch-5/llxprt-code`.

I did not trust the analysis documents as facts; I verified claims with direct reads and greps of the actual code, including the requested files:

- `packages/core/src/index.ts`
- `packages/core/src/config/config.ts`
- `packages/core/src/config/schedulerSingleton.ts`
- `packages/core/src/config/toolRegistryFactory.ts`
- samples/inventory from `packages/core/src/core/`, `packages/core/src/agents/`, `packages/core/src/scheduler/`
- reverse-dependency and consumer claims with greps across `packages/*/src`

## Summary verdict

**REVISE**

The plan is directionally strong and integration-first: it identifies concrete existing consumers, old code to remove, user-visible access paths, inversion seams, package/CI wiring, anti-shim scans, and a substantial verification battery. The main architecture (core-owned contracts + injected factories; agents depends on core; no core -> agents import; no shims) is sound.

However, I found several factual and execution gaps that must be corrected before execution:

1. The plan incorrectly says CLI constructs `new AgentClient(...)` in only `autoPromptGenerator.ts`; `a2a-server` also directly constructs it and must be part of the construction-inversion/wiring blast radius.
2. The plan undercounts and incompletely specifies provider-package test coupling to moved `ChatSession`; that test currently depends on a concrete class that the plan says core must stop exporting.
3. The move-map omits at least one production file in `packages/core/src/core/`: `core/compression/HighDensityStrategy.ts`.
4. The package/CI wiring phase misses confirmed providers touchpoints in `scripts/build_sandbox.js` and `scripts/version.js`; P02 only says to check them, not explicitly update them, while the code has real provider references that must be mirrored.
5. The `TaskToolFactory` seam is underspecified for `ToolRecord.toolClass` and `TaskTool.Name`/allow-list behavior; a naive factory returning an instance will break existing all-potential-tools/settings UI metadata.
6. Verification commands use `npm run format` plus `git diff --exit-code`, which is not a check command and can mutate unrelated files; the project already has `npm run format:check`.
7. The plan says every phase leaves the workspace green, but P02 adds CLI/a2a dependencies on an empty `packages/agents` package before imports/wiring exist. It is probably buildable, but the phase must explicitly verify that no unresolved export imports are introduced and that the empty package has compatible TS path/vitest aliasing; otherwise P02 can become isolated scaffolding rather than integrated package wiring.

Details below.

## Verified factual claims (sample of >10)

These are examples of plan claims I verified as correct:

1. `Config.initialize()` directly constructs `AgentClient` after subagent registration. Evidence: `packages/core/src/config/config.ts:17` imports `AgentClient`; `packages/core/src/config/config.ts:196-198` constructs `new AgentClient(this, this.runtimeState)`.
2. `Config.initializeContentGeneratorConfig()` constructs a second `AgentClient`. Evidence: `packages/core/src/config/config.ts:314-315` builds `newContentGeneratorConfig` then `new AgentClient(this, this.runtimeState)`.
3. `schedulerSingleton.ts` uses a dynamic import and direct `CoreToolScheduler` construction. Evidence: `packages/core/src/config/schedulerSingleton.ts:273-276` imports `../core/coreToolScheduler.js`; `packages/core/src/config/schedulerSingleton.ts:276-287` constructs `new CoreToolSchedulerClass(...)`.
4. `toolRegistryFactory.ts` directly imports `TaskTool`. Evidence: `packages/core/src/config/toolRegistryFactory.ts:38`.
5. `toolRegistryFactory.ts` directly uses `TaskTool.Name` in allow-list inclusion. Evidence: `packages/core/src/config/toolRegistryFactory.ts:308-309`.
6. `toolRegistryFactory.ts` registers `TaskTool` directly when managers exist. Evidence: `packages/core/src/config/toolRegistryFactory.ts:247-250`.
7. `toolRegistryFactory.ts` records `TaskTool` as a potential unregistered tool when managers are missing. Evidence: `packages/core/src/config/toolRegistryFactory.ts:251-259`.
8. `contentGenerator.ts` staying is justified: core config/runtime/code_assist and providers import it. Evidence: `packages/core/src/config/config.ts:10`, `packages/core/src/config/configBaseCore.ts:18`, `packages/core/src/runtime/AgentRuntimeLoader.ts:30`, `packages/core/src/code_assist/server.ts:29`, and `packages/providers/src/ProviderContentGenerator.ts:10`.
9. `prompts.ts` staying is justified by providers usage. Evidence: `packages/providers/src/gemini/GeminiProvider.ts:22`, `packages/providers/src/openai/OpenAIRequestPreparation.ts:23`, `packages/providers/src/anthropic/AnthropicRequestPreparation.ts:34`, `packages/providers/src/openai-responses/OpenAIResponsesProviderCore.ts:27`, `packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:61`.
10. `tokenLimits.ts` staying is justified by core runtime usage. Evidence: `packages/core/src/runtime/createAgentRuntimeContext.ts:21` imports `tokenLimit` from `../core/tokenLimits.js`.
11. `loggingContentGenerator.ts` does not appear in the codebase by grep; I found no `loggingContentGenerator` match in `packages`.
12. `scheduler/types.ts` has non-scheduler core consumers. Evidence: `packages/core/src/confirmation-bus/types.ts:6` imports `ToolCall`; `packages/core/src/policy/policy-helpers.ts:15` imports `PolicyContext`.
13. `packages/core/src/agents` appears isolated from outside production code. A grep for imports of `agents/` outside `packages/core/src/agents/**` returned no matches.
14. Moved production files include barrel/root imports that must be rewritten. Evidence: `packages/core/src/core/coreToolScheduler.ts:7` and `:18`, `packages/core/src/core/nonInteractiveToolExecutor.ts:12`, `packages/core/src/scheduler/status-transitions.ts:28` and `:30` import from `../index.js`.
15. Providers production code does not import moved agent/client/scheduler files, but provider tests do import `ChatSession`. Evidence: no production `providers` imports of moved files were found; `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:11` imports `ChatSession` from core.

## Findings

### BLOCKER 1: P01 misses an existing production `new AgentClient(...)` in a2a-server

The reverse-dependency map states:

> a2a-server: `CoreToolScheduler` type in `agent/task.ts` ... `GeminiEventType` in 3 files ... Wiring `AgentClientFactory` will add agents dep.

It does not acknowledge that `a2a-server` directly constructs the concrete `AgentClient` today. Evidence:

- `packages/a2a-server/src/agent/task.ts:10` imports `AgentClient` from core root.
- `packages/a2a-server/src/agent/task.ts:108` stores `agentClient: AgentClient` in runtime state.
- `packages/a2a-server/src/agent/task.ts:154` executes `this.agentClient = new AgentClient(this.config, runtimeState);`.

This invalidates the plan's wording in `analysis/reverse-dependency-map.md §5` and the scoping of P01/P04. If P01 is supposed to introduce construction inversion before moving code and keep the workspace green, this direct construction must be included in the P01 seam or explicitly deferred with an executable intermediate import source. As written, P01 says CLI/a2a/test composition roots register Config factories, but it does not require replacing the independent a2a `new AgentClient` path.

**Required revision:** Add a2a `AgentClient` construction to the integration contract, reverse-dependency map, P01 tasks, and P04 consumer migration. Decide whether a2a creates detached clients through an agents-owned factory/helper or imports `AgentClient` concrete directly from `@vybestack/llxprt-code-agents` after P03. Add tests/verification for that path.

### MAJOR 1: Provider test coupling to moved `ChatSession` is understated and not given a concrete migration

The plan correctly says providers production code does not depend on moved modules, but it underplays a concrete provider test dependency on moved `ChatSession`:

- `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:11` imports `ChatSession` from `@vybestack/llxprt-code-core/core/chatSession.js`.
- `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:29` declares `function createChatSession(): ChatSession`.
- `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:79` constructs `new ChatSession(...)`.

The move-map says `core/chatSession.ts` moves and core `index.ts` no longer re-exports moved implementations; no backward-compat shims are allowed. The reverse-dependency map notes only that `providers` imports `core/prompts.js` and `core/contentGenerator.js`, and says providers needs no change. That is only true for production code, not for the workspace test suite that must pass.

This can break `npm run test --workspaces` unless providers test code either:

- adds a dev/test dependency on `@vybestack/llxprt-code-agents` and imports `ChatSession` there, or
- rewrites the test to use a minimal test double/contract without concrete `ChatSession`, or
- moves that behavioral test to agents if it is actually testing chat-session behavior.

**Required revision:** Add this specific provider test to preflight item 6 and the test relocation/consumer migration plan. The final dependency rule says `packages/providers` gains no dependency on agents; if that rule includes devDependencies/tests, this test must be rewritten or moved, not imported from agents.

### MAJOR 2: Move-map omits `core/compression/HighDensityStrategy.ts`

The specification says compression implementation moves, and lists several compression files, but `analysis/move-map.md §E` only says `core/compression/* (except types.ts)` moves. The detailed specification list includes `CompressionHandler.ts`, strategies, `compressionBudgeting.ts`, `reasoningUtils.ts`, `utils.ts`, `index.ts`, and `compressionStrategyFactory.ts`, but it omits a real production strategy file:

- `packages/core/src/core/compression/HighDensityStrategy.ts` exists in the current tree (verified by inventory of `packages/core/src/core`).

Because P03 says the move-map is the binding file-by-file authority, this omission creates an execution ambiguity: a worker following the enumerated file list could leave `HighDensityStrategy.ts` behind or miss import rewrites/tests.

**Required revision:** Add `core/compression/HighDensityStrategy.ts` explicitly to `analysis/move-map.md` and the specification's compression list, or explain why it stays (it appears to be a compression implementation and should move if `compression/* except types.ts` moves).

### MAJOR 3: CI/release/package tooling updates miss confirmed providers touchpoints

P02 lists `.github/workflows/release.yml`, `.github/workflows/build-sandbox.yml`, and `scripts/prepare-package.js` as concrete updates, then says to check `scripts/build_sandbox.js`, `esbuild.config.js`, `scripts/version.js`, etc. I verified that providers have real references in files that P02 does not explicitly require updating:

- `scripts/build_sandbox.js:159-165` packs `@vybestack/llxprt-code-providers`.
- `scripts/build_sandbox.js:227` references `vybestack-llxprt-code-providers-${packageVersion}.tgz`.
- `scripts/version.js:50` includes `@vybestack/llxprt-code-providers` in `actualWorkspaces`.
- `.github/workflows/build-sandbox.yml:65` packs providers.
- `.github/workflows/release.yml:344-346` publishes providers, and `:368-377` creates/cleans/packs provider tarballs.

The plan's phase success criteria says release/sandbox wiring mirrors providers, but the implementation tasks leave some known files as optional inspections. That is risky because an implementer can pass P02 without updating `scripts/build_sandbox.js` or `scripts/version.js`, causing sandbox/version/release breakage later.

**Required revision:** Promote `scripts/build_sandbox.js` and `scripts/version.js` to mandatory explicit edits in P02. Also add `grep -rn "llxprt-code-providers" package.json .github/workflows scripts/*.js` as a required checklist where every provider packaging/versioning touchpoint is either mirrored for agents or documented as not applicable.

### MAJOR 4: `TaskToolFactory` seam is underspecified and can break tool metadata/allow-list behavior

The plan says `toolRegistryFactory.ts` should replace `TaskTool` with an injected `TaskToolFactory` plus `TASK_TOOL_NAME`. That is necessary, but not sufficient for current behavior.

Current code relies on `TaskTool` as a class/static metadata object in multiple places:

- `packages/core/src/config/toolRegistryFactory.ts:38` imports the class.
- `packages/core/src/config/toolRegistryFactory.ts:247-250` passes `TaskTool` into `registerCoreTool`, which reads `ToolClass.name` and `ToolClass.Name` in `buildRegisterCoreTool` (`toolRegistryFactory.ts:101-105`) and constructs `new ToolClass(...args)` (`toolRegistryFactory.ts:140-142`).
- `packages/core/src/config/toolRegistryFactory.ts:251-259` stores `toolClass: TaskTool`, `toolName: 'TaskTool'`, `displayName: TaskTool.Name || 'TaskTool'`, and constructor args in `allPotentialTools` when not registered.
- `packages/core/src/config/toolRegistryFactory.ts:308-309` auto-includes both `'TaskTool'` and `TaskTool.Name`.
- CLI/settings tests inspect this metadata by class name. Evidence: `packages/cli/src/coreToolToggle.test.ts:136` expects `toolClass: 'TaskTool'`; `packages/cli/src/utils/dynamicSettings.test.ts:296` expects `toolClass: 'TaskTool'`.

A factory typed only as `(config, args) => AnyDeclarativeTool` does not provide class-level `name`, static `Name`, constructor-args metadata, or a `toolClass` value for unregistered potential tools. If the implementation substitutes a factory result directly, it can alter `getAllPotentialTools()` output and coreTools/excludeTools behavior.

**Required revision:** Specify a richer core-owned task tool descriptor, for example `{ className: 'TaskTool'; displayName: TASK_TOOL_NAME; create(config, args): AnyDeclarativeTool; potentialToolClass?: unknown }`, or explicitly preserve `ToolRecord` semantics without importing the concrete class. Add a P01 behavioral test that fails if `getAllPotentialTools()` no longer reports `TaskTool` exactly as today when enabled/disabled/missing managers.

### MAJOR 5: Formatting verification command mutates the working tree

The overview verification battery uses:

```bash
npm run format:check   # or npm run format then git diff --exit-code
```

But P04 uses:

```bash
npm run format && git diff --exit-code   # formatting clean
```

The root package scripts are:

- `format: prettier --experimental-cli --write .`
- `format:check: prettier --check .`
- `format:all: ./scripts/format-all.sh`

Using `npm run format` in a verification phase mutates files, and `git diff --exit-code` will fail if formatting changes were needed. It may also touch unrelated plan files, lock files, or generated artifacts. This is a verification antipattern and can confuse phase boundaries.

**Required revision:** Change verification phases to run `npm run format:check` for checks. If an implementation phase needs to format, run `npm run format` as an implementation step, then explicitly review/stage the formatting diff.

### MAJOR 6: Phase ordering claims green-at-each-phase but P02 risks isolated package scaffolding

The plan satisfies the integration-first spirit overall, but P02 is close to an isolated package build: it adds an empty `packages/agents/src/index.ts`, package metadata, workspace entries, and cli/a2a dependencies before moving code. That is acceptable only if it is strictly preparatory and verifiably connected to the eventual consumers.

P02 currently says CLI/a2a package.json add agents deps now, but the empty agents package exports nothing and no source imports it yet. This likely builds, but the plan should make explicit that no source import from agents is introduced in P02, and that P02 is not considered feature-complete. The success criterion should include an anti-isolation check: the next phase must immediately move real code, and P02 should not create placeholder public APIs that tests can pass against.

**Required revision:** Add P02 verification that `packages/agents/src/index.ts` contains no fake exports/stubs and no production code depends on it yet; add P03 as the first phase where source imports from agents become legal. This prevents an implementer from building a parallel isolated package and leaving old core code in place.

### MINOR 1: Reverse-dependency map undercounts CLI concrete-class/import consumers

The reverse-dependency map says CLI symbol usage includes `AgentClient` in 14 files, `CoreToolScheduler` in 2 files, `ChatSession` in 2 files, `executeToolCall` in 2 files. My grep found many more test and type references under `packages/cli/src`, including:

- `packages/cli/src/ui/hooks/useTodoContinuation.ts:8` imports `AgentClient` type from core root.
- `packages/cli/src/ui/hooks/geminiStream/toolCompletionHandler.ts:19` imports `AgentClient` type from core root.
- `packages/cli/src/ui/hooks/geminiStream/checkpointPersistence.ts:23` imports `AgentClient` from core root.
- `packages/cli/src/ui/commands/compressCommand.ts:10` imports `ChatSession` type from core root.
- `packages/cli/src/nonInteractiveCliSupport.ts:4` imports `executeToolCall` from core root and uses it at `:287`.
- `packages/cli/src/zed-integration/zedIntegration.ts:13-14` imports `ChatSession` and `AgentClient` types.

The plan may have counted non-test production files differently, but the statement is too precise without listing the grep command and inclusion criteria. Since vi.mock path and type import breakage is a known risk, the plan should avoid approximate counts or include the exact file list from preflight before implementation.

**Required revision:** Replace approximate CLI counts with a generated file list in P00a/preflight and require P04 to audit every listed file.

### MINOR 2: `loggingContentGenerator.ts` deviation is correct but should include command evidence

The plan says `core/loggingContentGenerator.ts` does not exist. I verified no `loggingContentGenerator` matches in `packages`. This is factually correct. For auditability, P00a should require the exact command output (`rg -n "loggingContentGenerator|LoggingContentGenerator" packages`) so the PR deviation table has evidence.

### MINOR 3: P01 failure recovery suggests `git checkout -- packages/`

P01 failure recovery says:

```bash
git checkout -- packages/
```

This is not as dangerous as `git clean`, but it can discard unrelated user changes under `packages/`, contrary to the general instruction not to revert changes unless requested. Plans should prefer checkpoint commits/stashes or coordinator-guided targeted reverts of the phase's own changes.

**Required revision:** Replace broad checkout recovery commands with “reset to the pre-phase checkpoint commit only if the coordinator owns the working tree” or targeted revert instructions.

### MINOR 4: Smoke-test command conflicts with project memory

The plan uses the synthetic smoke test (`node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`), which matches the project-local memory but conflicts with the parent memory saying to use `ollamaglm51` for this project. The immediately local project memory also says synthetic, so this may be acceptable, but the plan should align with the currently authoritative project convention used by this repository's check-in instructions. If the intended smoke is synthetic, keep it consistently; if the parent convention is preferred, update all phase batteries.

## Integration-first assessment

**Mostly passes, with revisions needed.**

The plan identifies real existing integration points and old code to replace:

- Existing code that will use the package: CLI config/gemini composition roots, `autoPromptGenerator`, non-interactive CLI, zed integration, React scheduler hook, a2a server, core config/seams, CI/release scripts.
- Existing code to remove: moved files from `packages/core/src/core`, `packages/core/src/agents`, scheduler implementations, `tools/task.ts`, core index exports, direct constructions in core.
- User access points: interactive chat, non-interactive prompt mode, zed integration, `task` tool/subagents, todo continuation, compression, checkpointing, a2a flows.

The plan could not be fully built in isolation if executed as written from P03 onward because it requires moving existing implementation and updating consumers. P02 alone is scaffold-only, but that is acceptable if guarded as preparatory. The a2a direct-construction gap and provider test gap must be fixed for true integration coverage.

## Dependency-direction and cycle assessment

The intended direction is sound:

```text
agents -> core
cli/a2a -> agents + core
core -X-> agents
agents -X-> providers/cli
providers -X-> agents
```

I did not find production moved files importing `@vybestack/llxprt-code-providers`; the only provider imports in the move set are tests:

- `packages/core/src/core/chatSession.issue1729.test.ts:8`
- `packages/core/src/core/chatSession.runtime.test.ts:15`
- `packages/core/src/core/chatSession.thinking-toolcalls.test.ts:46`

Those tests will need relocation/dependency decisions, but they do not prove a production cycle.

The main missed coupling risk is moved files importing core root `../index.js` after relocation. Evidence includes `packages/core/src/core/coreToolScheduler.ts:7`, `packages/core/src/core/nonInteractiveToolExecutor.ts:12`, and `packages/core/src/scheduler/status-transitions.ts:28-30`. The plan does mention `../index.js` self-imports and says to rewrite them to core subpaths or agents-internal modules, which is good. P03/P03a should make this a hard scan, not just a note.

## Phase ordering/executability assessment

The broad order is executable: contracts/inversion first, scaffold, move, consumer migration, cleanup. The plan correctly notes the constructor/factory timing hazard: `Config` must get factories via `ConfigParameters`, not a post-construction setter, because `initialize()` constructs the client. Evidence: `packages/core/src/config/config.ts:103-107` constructor only applies params; `:196-198` constructs during `initialize()`.

The wiring blast radius is significant. `ConfigParameters` currently has no factory fields (see `packages/core/src/config/configTypes.ts:344-410`, with no `agentClientFactory`, `toolSchedulerFactory`, or `taskToolFactory`; grep found no such fields except an unrelated scheduler factory provider in `toolRegistryFactory.ts:242`). P00a correctly requires enumerating all `new Config(` call sites; this is essential and should be treated as a major blast radius, not a minor mechanical update.

## TDD discipline assessment

P01 explicitly requires behavioral tests first and says no mock theater. P01a asks whether tests would fail if factory wiring was dropped. This aligns with `dev-docs/PLAN.md`.

I did not find reverse-testing encouragement such as tests expecting `NotYetImplemented`. The main TDD risk is that factory tests can devolve into `toHaveBeenCalled` mock assertions. P01 should require at least one real behavior assertion for each seam:

- agent factory result is the object `Config.getAgentClient()` uses and history handoff still transfers real history;
- scheduler singleton returns the same real object across repeated calls and updates callbacks;
- task tool registry metadata and enabled/disabled behavior match previous output.

## Verification assessment

The verification phases are generally rigorous:

- full test/lint/typecheck/build/format/smoke batteries;
- behavior-preservation audits with import-only diffs for moved files;
- anti-shim scans;
- dependency-direction scans;
- bundle checks;
- release/package dry-run checks;
- final semantic review with chat/tool/subagent/compression traces.

Revisions needed:

- use `npm run format:check` in verification rather than mutating `npm run format`;
- explicitly scan for `@vybestack/llxprt-code-agents` in `packages/core` including tests, not just `packages/core/src`, because REQ-CLEAN-001.1 says production OR test;
- add hard scans for moved files importing core root barrel (`@vybestack/llxprt-code-core` root or `../index.js`) where subpaths are required;
- add mandatory provider-test migration verification.

## Final verdict

**REVISE**

The plan is close and its core architectural approach is acceptable, but the factual gaps above are large enough that executing it as-is could leave broken a2a behavior, broken provider tests, missed compression files, incomplete packaging/version tooling, or altered `TaskTool` metadata semantics. Update the analysis and phase docs, then re-review before implementation.
