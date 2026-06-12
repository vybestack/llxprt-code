# Plan Review Round 2 — Issue #1592 Extract `packages/agents`

## Verdict: REVISE

The revised plan is materially stronger than the previous version. It is integration-first overall, has a concrete move map, identifies consumer files, forbids shims, includes preflight verification, adds provider-test relocation, and now explicitly mirrors the known providers packaging/versioning touchpoints.

However, I found two execution-blocking issues and several major risks after verifying the plan against the actual tree. Most importantly, the phase ordering still cannot keep the workspace green: P03 removes/moves core implementation exports before P04 updates CLI/a2a consumers, while the plan also forbids backward-compatibility shims. There is also a missed subagent-system boundary around `ListSubagentsTool` / `SubagentManager` that leaves part of the user-visible subagent tool system in core without a clear architectural disposition.

I verified the findings below with direct reads/greps of the current codebase. Evidence is cited as `file:line`.

---

## Findings

### BLOCKER 1: P03 cannot leave the workspace green because consumer migration is deferred to P04 while no shims are allowed

The plan requires every intermediate phase to keep the workspace green, but P03 moves implementation APIs out of core and removes core exports before P04 updates CLI/a2a consumers.

Plan evidence:

- `project-plans/issue1592/plan/00-overview.md:30-36` orders the phases as P01 inversion, P02 scaffold, P03 code move/core index cleanup, then P04 consumer migration.
- `project-plans/issue1592/plan/00-overview.md:18` forbids compatibility shims: “core must never re-export agents APIs; no forwarding wrapper files.”
- `project-plans/issue1592/plan/03-code-move.md:23-30` makes P03 do the `git mv`, internal import rewrites, core stayer updates, and moved-module export removal.
- `project-plans/issue1592/plan/03a-code-move-verification.md:13-15` requires P03a to verify `packages/core/src/index.ts` exports no moved implementation and to run package tests.
- `project-plans/issue1592/plan/04-consumer-migration.md:1` defines consumer migration as the next phase, after the move.

Actual consumer evidence:

- CLI directly imports concrete `AgentClient` from the core package and constructs it in `packages/cli/src/ui/utils/autoPromptGenerator.ts:9` and `packages/cli/src/ui/utils/autoPromptGenerator.ts:27`.
- CLI integration tests directly import and construct `AgentClient` in `packages/cli/src/integration-tests/todo-continuation.integration.test.ts:10`, `packages/cli/src/integration-tests/todo-continuation.integration.test.ts:40`, and `packages/cli/src/integration-tests/todo-continuation.integration.test.ts:78`.
- CLI imports moved `executeToolCall` from core in `packages/cli/src/nonInteractiveCliSupport.ts:4` and calls it at `packages/cli/src/nonInteractiveCliSupport.ts:287`.
- CLI imports concrete/type moved APIs such as `ChatSession` and `AgentClient` from core in `packages/cli/src/zed-integration/zedIntegration.ts:13-14`.
- CLI imports moved `CoreToolScheduler` type from core in `packages/cli/src/ui/hooks/useReactToolScheduler.ts:16` and uses it in the scheduler hook contract at `packages/cli/src/ui/hooks/useReactToolScheduler.ts:59`.
- a2a-server directly constructs `AgentClient` in `packages/a2a-server/src/agent/task.ts:154`.
- Core currently re-exports moved implementations from `packages/core/src/index.ts:73-85`, including `client.js`, `baseLlmClient.js`, `geminiRequest.js`, `nonInteractiveToolExecutor.js`, and `buildContinuationDirective`.

Why this blocks execution:

If P03 removes or stops exporting those moved implementation APIs, these CLI/a2a imports fail before P04 runs. If P03 leaves forwarding exports in core to keep P03a green, it violates the explicit no-shim rule and P03a’s core export-surface check. Therefore P03 and P04 must be combined into one atomic phase, or P03 must include all external consumer import updates before its green gate.

Required revision:

- Move CLI/a2a/bundle consumer migration into the same phase as the code move, or split P03 into a staged sequence where no phase removes a core export until all consumers have been updated in that same phase.
- Keep the no-shim invariant: do not use temporary core forwarding files or root re-exports to bridge P03 to P04.
- Update P03a/P04a gates accordingly so each phase can actually pass without relying on forbidden shims.

---

### BLOCKER 2: The subagent system is not fully dispositioned; `ListSubagentsTool` and `SubagentManager` remain in core while `TaskTool` moves

The issue asks to extract the “subagent system” along with the agent runtime and chat loop. The plan moves `tools/task.ts` and the `core/subagent*` implementation files, but it leaves the other user-visible subagent tool and its manager in core without a clear justification or contract boundary.

Plan evidence:

- `project-plans/issue1592/analysis/move-map.md:59-70` moves `core/subagent.ts`, `core/subagentOrchestrator.ts`, `core/subagentScheduler.ts`, `core/subagentExecution.ts`, `core/subagentRuntimeSetup.ts`, `core/subagentToolProcessing.ts`, and `tools/task.ts`; it leaves `core/subagentTypes.ts` in core.
- `project-plans/issue1592/analysis/move-map.md:94-105` lists staying/inverted files, but does not include `tools/list-subagents.ts` or `config/subagentManager.ts` as explicit dispositions.
- `project-plans/issue1592/specification.md:54` defines the moved subagent set as implementation files plus `subagentScheduler`, but does not mention `ListSubagentsTool` or `SubagentManager`.
- `project-plans/issue1592/specification.md:129` says the agents public API includes the “subagent system” and `TaskTool`, but not `ListSubagentsTool` or `SubagentManager`.

Actual code evidence:

- `packages/core/src/config/toolRegistryFactory.ts:38-40` imports both `TaskTool` and `ListSubagentsTool`; P01 only inverts `TaskTool`.
- `packages/core/src/config/toolRegistryFactory.ts:263-280` registers or records `ListSubagentsTool` using the same subagent manager path as `TaskTool`.
- `packages/core/src/config/toolRegistryFactory.ts:310-311` forces both `ListSubagentsTool` and its static `Name` into `coreTools`, just as it does for `TaskTool` at `packages/core/src/config/toolRegistryFactory.ts:308-309`.
- `packages/core/src/tools/list-subagents.ts:13-16` imports `Config`, `SubagentManager`, `SubagentConfig`, and `MessageBus` from core.
- `packages/core/src/tools/list-subagents.ts:125-170` implements the `ListSubagentsTool` production class.
- `packages/core/src/config/subagentManager.ts:65` defines the concrete `SubagentManager`, and `packages/core/src/config/subagentManager.ts:437-457` implements the user-visible `listSubagents()` behavior used by `ListSubagentsTool`.
- `packages/core/src/index.ts:12` and `packages/core/src/index.ts:460` currently export `SubagentManager` from core.

Why this blocks architecture:

Leaving `ListSubagentsTool` in core means a user-visible subagent tool remains in the core package while `TaskTool` and subagent execution move to agents. That is neither “all relevant code in packages/agents” nor a clearly justified deviation. Moving only `TaskTool` also leaves `toolRegistryFactory` coupled to subagent tooling and concrete `SubagentManager` semantics. If `ListSubagentsTool` is intentionally a core/config tool, the plan must say so and justify why it is not part of the subagent system. If it is part of agents, it needs the same descriptor/factory inversion as `TaskTool` so core does not import agents.

Required revision:

- Add explicit dispositions for `packages/core/src/tools/list-subagents.ts`, `packages/core/src/tools/list-subagents.test.ts`, `packages/core/src/config/subagentManager.ts`, and `packages/core/src/config/test/subagentManager.test.ts`.
- Decide whether `ListSubagentsTool` moves with agents or remains in core as a documented deviation. If it moves, add `ListSubagentsToolRegistration` or a more general `AgentToolRegistrations` descriptor to `toolRegistryFactory`.
- Decide whether `SubagentManager` is configuration/storage infrastructure that stays in core, or subagent-system implementation that moves. If it stays, define a core-owned structural contract consumed by moved agents code.
- Add dependency-boundary tests/scans covering this decision.

---

### MAJOR 1: P01 leaves the independent a2a `new AgentClient` path out of the construction-inversion seam

The revised plan acknowledges the a2a direct construction, but it explicitly says “no change needed yet” in P01. That is risky because the stated P01 goal is construction inversion of class dependencies before moving `AgentClient`.

Plan evidence:

- `project-plans/issue1592/plan/01-contracts-inversion.md:14-20` says `Config` no longer imports or constructs `AgentClient`, and composition roots register the factory.
- `project-plans/issue1592/plan/01-contracts-inversion.md:51-53` adds factories to `ConfigParameters`, then says the a2a direct construction at `a2a-server/src/agent/task.ts:154` keeps importing the class from core in P01 and flips in P04.
- `project-plans/issue1592/analysis/reverse-dependency-map.md:78-79` correctly identifies the a2a direct construction and says a2a must add the agents dependency and import the concrete class in P04.

Actual code evidence:

- `packages/a2a-server/src/agent/task.ts:154` constructs `this.agentClient = new AgentClient(this.config, runtimeState);` independently of `Config.getAgentClient()`.
- `packages/core/src/config/config.ts:198` constructs an `AgentClient` during `Config.initialize()`.
- `packages/core/src/config/config.ts:315` constructs another `AgentClient` during `initializeContentGeneratorConfig()`.

Why this matters:

The `Config` inversion is feasible and needed, but it is not the full construction inversion for `AgentClient` consumers. The a2a path is a composition root that constructs a detached client directly. Deferring it to P04 is only safe if P03/P04 are made atomic as described in BLOCKER 1. Otherwise P03 cannot be green after moving `AgentClient`.

Required revision:

- Either include a2a direct construction in P01 by routing it through a core-owned `AgentClientFactory` contract, or explicitly merge the a2a import/constructor update into the atomic move+consumer phase.
- Add a verification check that searches all packages, not only `packages/core/src`, for `new AgentClient(` and accounts for each occurrence.

---

### MAJOR 2: The package dependency plan may miss non-core workspace deps required by moved files

P02 says agents dependencies should be derived from preflight and gives examples, but the move set imports several workspace packages today through files that will move. The plan must require exact dependency enumeration and forbid accidental reliance on transitive dependencies.

Plan evidence:

- `project-plans/issue1592/plan/02-package-scaffold.md:23` says `packages/agents/package.json` should depend on core and “any external deps the move set needs,” with examples, and may include `@vybestack/llxprt-code-test-utils` as devDependency.
- `project-plans/issue1592/analysis/move-map.md:119` says deps are “core, auth?, settings?, telemetry?, mcp? — derive from actual imports.”
- `project-plans/issue1592/specification.md:125` allows agents to depend on core and “auth/settings/telemetry/mcp as needed,” but not providers or CLI.

Actual code evidence:

- `packages/core/src/core/subagentRuntimeSetup.ts:39-41` imports `ContentGenerator` and `getCoreSystemPromptAsync`; after the move those come from core, so core is required.
- `packages/core/src/core/subagentOrchestrator.ts:11` imports `SubagentManager` from core config.
- `packages/core/src/tools/task.ts:27` imports `SubagentManager` from core config and `packages/core/src/tools/task.ts:26` imports `SubagentSchedulerFactory` from core.
- `packages/core/src/config/configBaseCore.ts:23` imports `McpClientManager` from `@vybestack/llxprt-code-mcp`, showing the current package split already has workspace-level dependencies that must be explicit when imported by moved files.
- `packages/providers/package.json:55-66` demonstrates the precedent: providers lists all workspace packages and external packages it directly imports; it does not rely on root/package transitive availability.

Why this matters:

The plan has the right principle, but P02’s success criteria should require a generated import inventory from the actual move set and an explicit `package.json` dependency table. Without that, the new package may compile locally through workspace leakage or fail in isolation after publish/pack.

Required revision:

- In P02, require a script/grep-generated import inventory for every moved production file and moved test file.
- Convert the inventory into explicit `dependencies`/`devDependencies` entries and document why each workspace dependency is allowed.
- Add a verification command using `npm pack --dry-run -w @vybestack/llxprt-code-agents` plus a build from packed artifacts where practical.

---

### MAJOR 3: Core test boundary is stated correctly but the blast radius is larger than the plan’s named examples

The plan says core must not depend on agents, including tests, and it names several stayer tests. Actual greps show many core tests instantiate moved `CoreToolScheduler`/`AgentClient` or mock moved paths. P03 can handle this if it truly moves co-located tests, but the stayer-test audit needs a complete generated list.

Plan evidence:

- `project-plans/issue1592/analysis/integration-contract.md:79-80` correctly says core tests needing concrete classes must move to agents or use core fakes; core cannot devDepend on agents.
- `project-plans/issue1592/analysis/move-map.md:111-114` says co-located tests move and stayer tests referencing moved concrete classes need audit.
- `project-plans/issue1592/plan/03a-code-move-verification.md:15` requires moved test count accounting.

Actual code evidence:

- `packages/core/src/config/config.test.ts:29` imports concrete `AgentClient` and `packages/core/src/config/config.test.ts:90` mocks `../core/client.js`.
- `packages/core/src/utils/summarizer.test.ts:9`, `packages/core/src/utils/summarizer.test.ts:21`, and `packages/core/src/utils/summarizer.test.ts:49` import/mock/construct `AgentClient`.
- `packages/core/src/tools/write-file.test.ts:25` imports `AgentClient` and `packages/core/src/tools/write-file.test.ts:34` mocks `../core/client.js`.
- `packages/core/src/lsp/__tests__/system-integration.test.ts:81` mocks `../../core/client.js`.
- `packages/core/src/lsp/__tests__/e2e-lsp.test.ts:82` mocks `../../core/client.js`.
- `packages/core/src/hooks/hooks-caller-application.test.ts:35` imports concrete `CoreToolScheduler`, and `packages/core/src/hooks/hooks-caller-application.test.ts:220` constructs it.
- `packages/core/src/telemetry/loggers.test.ts:434` constructs `AgentClient`.

Required revision:

- Add a mandatory P00a/P03 generated audit: `rg -n "AgentClient|CoreToolScheduler|vi\.mock\(.*core/(client|chatSession|coreToolScheduler|subagent)" packages/core/src --glob '*.ts'`.
- For each hit, record `MOVE`, `STRUCTURAL FAKE`, or `RETARGET TO CONTRACT` before P03 begins.
- Add a hard P03a scan forbidding core tests from importing `@vybestack/llxprt-code-agents` or moved core paths.

---

### MAJOR 4: The `TaskToolRegistration` design is feasible but underspecified for exact `ToolRecord` semantics

The plan correctly identifies `TaskTool` as a concrete import that blocks moving `tools/task.ts`, and the descriptor approach is broadly feasible. But the implementation details must preserve the current `ToolRecord` semantics exactly, including `toolClass`, `toolName`, static `Name`, constructor args, and missing-registration behavior.

Plan evidence:

- `project-plans/issue1592/plan/01-contracts-inversion.md:30-38` states the behavior must preserve `ToolRecord` shape and allow-list matching.
- `project-plans/issue1592/analysis/integration-contract.md:57-67` sketches `TaskToolRegistration`.

Actual code evidence:

- `packages/core/src/config/toolRegistryFactory.ts:101-105` derives `className` from `ToolClass.name` and `toolName` from `ToolClass.Name`.
- `packages/core/src/config/toolRegistryFactory.ts:112-123` matches `coreTools`/`excludeTools` against both class name and static tool name.
- `packages/core/src/config/toolRegistryFactory.ts:131-149` stores `toolClass`, `toolName`, `displayName`, registration status, reason, and constructor `args` in `allPotentialTools`.
- `packages/core/src/config/toolRegistryFactory.ts:239-249` currently constructs `taskToolArgs` and registers `TaskTool` with `(config, taskToolArgs)`.
- `packages/core/src/config/toolRegistryFactory.ts:251-260` records a disabled `TaskTool` record using the concrete `TaskTool` class even when managers are missing.
- `packages/core/src/config/toolRegistryFactory.ts:308-309` force-includes both `TaskTool` and `TaskTool.Name`.

Required revision:

- Make the descriptor type explicit enough to carry the concrete class constructor for `ToolRecord.toolClass`, the class-name identifier (`TaskTool`), the static tool name (`task`/`TaskTool.Name`), and constructor argument builder.
- Add a test asserting `allPotentialTools` entries before/after inversion are identical for registered, missing-manager, coreTools allow-list, and excludeTools scenarios.
- If `ListSubagentsTool` moves too, generalize the descriptor mechanism instead of adding a one-off `TaskTool` seam.

---

### MINOR 1: The deviation justifications for `contentGenerator.ts`, `prompts.ts`, `tokenLimits.ts`, and missing `loggingContentGenerator.ts` are correct and now well supported

I verified the disputed issue-list deviations; the plan is correct here.

Evidence:

- `contentGenerator.ts` is consumed by core config/runtime/code_assist and providers: `packages/core/src/config/config.ts:10`, `packages/core/src/config/configBaseCore.ts:15-18`, `packages/core/src/runtime/AgentRuntimeLoader.ts:30`, `packages/core/src/code_assist/server.ts:29`, and `packages/providers/src/ProviderContentGenerator.ts:10`.
- `prompts.ts` is consumed by providers: `packages/providers/src/gemini/GeminiProvider.ts:22`, `packages/providers/src/openai/OpenAIRequestPreparation.ts:23`, `packages/providers/src/anthropic/AnthropicRequestPreparation.ts:34`, `packages/providers/src/openai-responses/OpenAIResponsesProviderCore.ts:27`, and `packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:61`.
- `tokenLimits.ts` is consumed by core runtime: `packages/core/src/runtime/createAgentRuntimeContext.ts:21`.
- I found no `loggingContentGenerator` implementation in the repo; the grep for `loggingContentGenerator|LoggingContentGenerator` produced no source hits outside plan/review text.

No required change other than keeping these evidence lines in the final PR description.

---

### MINOR 2: Release/sandbox/version wiring is now mostly complete; one wording issue remains for `prepare-package.js`

The plan now explicitly includes the known providers touchpoints in `release.yml`, `build-sandbox.yml`, `scripts/build_sandbox.js`, and `scripts/version.js`, which addresses the prior gap.

Evidence of provider precedent:

- Root workspaces include providers at `package.json:14`.
- Providers package version is `0.10.0` at `packages/providers/package.json:3`.
- Release publishes providers at `.github/workflows/release.yml:344-346` and packs providers at `.github/workflows/release.yml:368-377`.
- Sandbox workflow packs providers at `.github/workflows/build-sandbox.yml:65`.
- Sandbox script handles providers at `scripts/build_sandbox.js:97`, `scripts/build_sandbox.js:159-165`, and `scripts/build_sandbox.js:225-227`.
- Version script lists providers at `scripts/version.js:50`.

Caveat:

- `scripts/prepare-package.js` currently only prepares core and cli, at `scripts/prepare-package.js:38-49`; it does not handle providers. P02 says to “include agents (inspect how providers is handled)” at `project-plans/issue1592/plan/02-package-scaffold.md:33`, but there is no providers handling in that script to mirror.

Required revision:

- Change P02 wording from “mirror providers” for `prepare-package.js` to “determine whether agents needs README/LICENSE/.npmrc copying; if yes, add it explicitly; if no, document why.”

---

## Verified factual claims (sample)

I independently verified these plan claims against the codebase:

1. `Config` imports concrete `AgentClient`: `packages/core/src/config/config.ts:17`.
2. `Config.initialize()` constructs `AgentClient`: `packages/core/src/config/config.ts:198`.
3. `initializeContentGeneratorConfig()` constructs another `AgentClient`: `packages/core/src/config/config.ts:315`.
4. `ConfigParameters` currently has no agent/scheduler/task factory fields in its interface: `packages/core/src/config/configTypes.ts:344-457`.
5. `schedulerSingleton` imports the concrete scheduler type from core: `packages/core/src/config/schedulerSingleton.ts:13-17`.
6. `schedulerSingleton` dynamically imports and constructs `CoreToolScheduler`: `packages/core/src/config/schedulerSingleton.ts:273-287`.
7. `toolRegistryFactory` imports `TaskTool`: `packages/core/src/config/toolRegistryFactory.ts:38`.
8. `toolRegistryFactory` imports `ListSubagentsTool`, a missed adjacent subagent tool: `packages/core/src/config/toolRegistryFactory.ts:39`.
9. `scheduler/types.ts` has non-scheduler core consumers: the plan’s stated examples are consistent with `packages/core/src/confirmation-bus/types.ts:6` and `packages/core/src/policy/policy-helpers.ts:15` (verified by grep; not reread in full here).
10. Moved files include root-barrel imports that must be rewritten: `packages/core/src/core/coreToolScheduler.ts:7` and `packages/core/src/core/coreToolScheduler.ts:18`; `packages/core/src/core/nonInteractiveToolExecutor.ts:12`; `packages/core/src/scheduler/status-transitions.ts:28-30`.
11. Provider production code depends on `prompts.ts`: `packages/providers/src/gemini/GeminiProvider.ts:22`, `packages/providers/src/openai/OpenAIRequestPreparation.ts:23`, `packages/providers/src/anthropic/AnthropicRequestPreparation.ts:34`.
12. Provider test coupling to `ChatSession` exists: `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:11`.
13. Moved chatSession tests import providers and need fake rewrites: `packages/core/src/core/chatSession.issue1729.test.ts:8`, `packages/core/src/core/chatSession.runtime.test.ts:15`, `packages/core/src/core/chatSession.thinking-toolcalls.test.ts:46`.
14. `HighDensityStrategy.ts` is now included in the move-map and exists in the tree: `project-plans/issue1592/analysis/move-map.md:79` and `packages/core/src/core/compression/HighDensityStrategy.ts`.
15. Providers packaging/version touchpoints exist in `scripts/build_sandbox.js:97`, `scripts/build_sandbox.js:159-165`, `scripts/build_sandbox.js:225-227`, and `scripts/version.js:50`.

---

## Integration-first assessment

The plan is not an isolated package build overall. It identifies existing consumers, old code to remove, public access paths, CI/release wiring, package exports, tests to move, and anti-shim scans. From P03 onward, it cannot be built in isolation because it moves real code and updates consumers.

The integration-first flaw is phase ordering, not intent: P03 and P04 split a no-shim package extraction across two green gates in a way that cannot compile. Fixing that sequencing should make the integration approach sound.

---

## Dependency direction assessment

The intended direction is sound:

- `agents -> core`
- `cli -> agents + core + providers`
- `a2a-server -> agents + core`
- `core -X-> agents`
- `agents -X-> providers/cli`
- `providers -X-> agents`

The plan includes good scans for core→agents and agents→providers/cli. The main missed coupling is `ListSubagentsTool`/`SubagentManager` and the need for a complete core-test audit so tests do not create forbidden devDependency cycles.

---

## TDD / PLAN.md assessment

Positive:

- P01 explicitly requires behavioral tests first and rejects `toHaveBeenCalled`-only mock theater: `project-plans/issue1592/plan/01-contracts-inversion.md:45-49`.
- The plan includes integration contracts, preflight, behavior-preservation audits, anti-shim scans, dependency scans, full battery, smoke test, bundle checks, and release wiring.

Gaps:

- The plan does not use classic stub/TDD/implementation phase structure from `dev-docs/PLAN.md`, but for a behavior-preserving extraction that is acceptable if it keeps behavioral seam tests first and import-only move audits strict.
- P01 should explicitly require tests to fail before implementation, or require an implementation worker to document the red/green transition. Current wording says “TDD first” but does not require pasted failing output.
- Add a complete generated audit for all affected tests; otherwise a worker may miss core tests that depend on moved concrete classes.

---

## Final verdict

REVISE. The architecture is close, and many prior factual issues have been fixed, but the current phase ordering cannot satisfy both “workspace green after every phase” and “no backward-compatibility shims.” Also, the subagent tool/manager boundary needs an explicit disposition before execution. Fix those issues and add the expanded generated audits, then the plan should be viable.
