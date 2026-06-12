# Plan Review Round 9: issue #1592 Extract packages/agents

Verdict: REVISE

I reviewed the requested plan files under `project-plans/issue1592/` and ignored existing files under `project-plans/issue1592/reviews/`. I also verified claims directly against the working tree with greps/file reads rather than trusting the analysis documents.

## Summary

The plan is substantially stronger than a naive package-extraction plan: it is integration-first, explicitly rejects backward-compatibility shims, has a clear core/agents dependency direction, justifies several deviations from the issue's literal file list, requires atomic move + consumer migration, and covers release/sandbox/Docker wiring. The construction-inversion approach is feasible based on the actual `Config`, `schedulerSingleton`, `toolRegistryFactory`, and a2a bootstrap code.

However, there is one execution-blocking factual omission in the stayer-test disposition: a core hooks test imports and instantiates the concrete `CoreToolScheduler`, but the plan does not classify it. After `core/coreToolScheduler.ts` moves, core tests are not allowed to import agents and the P03a anti-leftover scan forbids the old path, so P03 cannot end green without an explicit disposition for that test. I also found two major hardening issues around consumer/test import inventory and verification scans that should be tightened before implementation.

## Verified factual claims and evidence

These are the main claims I independently checked against the codebase:

1. `Config` currently directly imports `AgentClient` from `../core/client.js` (`packages/core/src/config/config.ts:17`) and constructs it in `initialize()` (`packages/core/src/config/config.ts:196-198`).
2. `Config.initializeContentGeneratorConfig()` constructs a replacement `AgentClient` after rebuilding content-generator config (`packages/core/src/config/config.ts:306-315`) and hands off history through `transferHistoryToNewClient()` (`packages/core/src/config/config.ts:272-300`).
3. The `Config` constructor currently only delegates to `applyConfigParams()` (`packages/core/src/config/config.ts:103-107`), which supports the plan's use-time factory absence semantics.
4. `ConfigBaseCore` currently stores `agentClient` as the concrete `AgentClient` type and returns it from `getAgentClient()` (`packages/core/src/config/configBaseCore.ts:19`, `packages/core/src/config/configBaseCore.ts:126`, `packages/core/src/config/configBaseCore.ts:501-503`).
5. `schedulerSingleton` currently imports concrete scheduler types from `../core/coreToolScheduler.js` (`packages/core/src/config/schedulerSingleton.ts:13-17`) and dynamically imports the class before construction (`packages/core/src/config/schedulerSingleton.ts:265-288`).
6. `toolRegistryFactory` currently imports the concrete `TaskTool` (`packages/core/src/config/toolRegistryFactory.ts:38`) and registers it through the generic `registerCoreTool` path when managers exist (`packages/core/src/config/toolRegistryFactory.ts:247-249`).
7. `ToolRecord.toolName` is currently the class name and `displayName` is `ToolClass.Name`/raw tool name (`packages/core/src/config/toolRegistryFactory.ts:101-105`, `packages/core/src/config/toolRegistryFactory.ts:131-135`), matching the plan's descriptor mapping.
8. The TaskTool allow-list force-includes both class and static names today (`packages/core/src/config/toolRegistryFactory.ts:304-310`), so the descriptor must preserve both identifiers.
9. a2a-server constructs and initializes `Config`: `loadConfig()` calls `new Config(configParams)` and `initializeConfig(config)` (`packages/a2a-server/src/config/config.ts:31-45`), and `initializeConfig()` calls `config.initialize({ messageBus })` (`packages/a2a-server/src/config/config.ts:135-145`). Therefore a2a must wire the factories/TaskTool registration.
10. The providers stop-reason test really imports and constructs `ChatSession` (`packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:11`, `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:79`), so its relocation/rewrite is necessary if providers must not depend on agents.
11. Providers production code really imports `core/prompts.js`: for example Gemini (`packages/providers/src/gemini/GeminiProvider.ts:22`) and OpenAI request preparation (`packages/providers/src/openai/OpenAIRequestPreparation.ts:23`), supporting the plan's deviation that `core/prompts.ts` stays in core.
12. Providers production code really imports `core/contentGenerator.js` through `ProviderContentGenerator` (`packages/providers/src/ProviderContentGenerator.ts:10`), supporting the plan's deviation that `core/contentGenerator.ts` stays in core.
13. `geminiRequest.ts` has a staying test consumer in core (`packages/core/src/tools/glob.test.ts:9`, `packages/core/src/tools/glob.test.ts:194`), supporting the plan's current stay disposition.
14. A CLI integration test directly imports and constructs `AgentClient` (`packages/cli/src/integration-tests/todo-continuation.integration.test.ts:8-15`, `packages/cli/src/integration-tests/todo-continuation.integration.test.ts:74-79`), confirming that consumer migration must include test imports as well as production imports.
15. Release/sandbox/Docker provider precedents exist today: publish step (`.github/workflows/release.yml:344-346`), pack steps (`.github/workflows/release.yml:368-377`, `.github/workflows/build-sandbox.yml:65`), script tests (`scripts/tests/release-process.test.js:70`, `scripts/tests/release-process.test.js:126`, `scripts/tests/release-process.test.js:221`, `scripts/tests/release-process.test.js:247`), `scripts/version.js:50`, `scripts/build_sandbox.js:159-165`, `scripts/build_sandbox.js:227`, and Dockerfile tgz copy/install (`Dockerfile:58`, `Dockerfile:70`). This supports P02's release wiring requirements.

## Findings

### BLOCKER: A staying core hooks test imports the moved concrete scheduler but is missing from the disposition tables

The plan says co-located tests move with subjects and lists stayer tests that reference moved concrete classes, including config, utils, tools, telemetry, and lsp tests (`project-plans/issue1592/analysis/move-map.md:120-126`). It also explicitly uses `hooks/hooks-caller-application.test.ts` as evidence that `coreToolHookTriggers.ts` should stay in core (`project-plans/issue1592/analysis/reverse-dependency-map.md:24`).

The same test imports the concrete moved scheduler API:

- `packages/core/src/hooks/hooks-caller-application.test.ts:31-35` imports `ToolCall`, `SuccessfulToolCall`, and `CoreToolScheduler` from `../core/coreToolScheduler.js`.
- `packages/core/src/hooks/hooks-caller-application.test.ts:46-49` imports the staying hook trigger functions from `../core/coreToolHookTriggers.js`.

After P03, `core/coreToolScheduler.ts` is supposed to move wholesale and only a contract module remains (`project-plans/issue1592/analysis/move-map.md:43-45`). P03a then requires zero remaining references to `core/client.js`, `core/chatSession.js`, `core/coreToolScheduler.js`, `core/nonInteractiveToolExecutor.js`, and `tools/task.js` in core/cli/a2a imports (`project-plans/issue1592/plan/03a-code-move-verification.md:20-22`). Core also must not depend on agents in production or dev dependency sections (`project-plans/issue1592/specification.md:133-135`).

That combination leaves this test with no executable path unless the plan explicitly classifies it. It cannot keep importing `../core/coreToolScheduler.js`; it cannot import `@vybestack/llxprt-code-agents` from core tests; and it is not listed among tests to move/rewrite. P03 would fail typecheck/test or violate the dependency boundary.

Required plan fix:

- Add `packages/core/src/hooks/hooks-caller-application.test.ts` to the test disposition table.
- Decide one of:
  - move it to `packages/agents` if it is truly a scheduler integration test and rewrite only the hook trigger imports to core subpaths, or
  - keep it in core but replace concrete scheduler usage with a structural fake/contract-level behavior that still validates hook application semantics.
- Update P03/P03a verification to assert this specific test has no old concrete scheduler import and still preserves its behavioral assertions.

### MAJOR: Consumer migration mentions CLI/a2a production paths but under-specifies the large test import/mocking surface that will break after the root export cleanup

P03 correctly says consumer migration happens atomically and names some concrete production sites such as `autoPromptGenerator.ts`, `a2a-server/src/agent/task.ts`, `executeToolCall`, `ChatSession` references, and factory registrations (`project-plans/issue1592/plan/03-code-move.md:44`). But the actual consumer surface includes many CLI/a2a tests and integration tests importing or mocking `AgentClient`/`ChatSession`/`CoreToolScheduler` through the core root or core subpaths.

Evidence examples:

- CLI integration test imports and constructs `AgentClient` from the core root today (`packages/cli/src/integration-tests/todo-continuation.integration.test.ts:8-15`, `packages/cli/src/integration-tests/todo-continuation.integration.test.ts:74-79`).
- CLI production `autoPromptGenerator.ts` constructs detached `AgentClient` today (found by grep at `packages/cli/src/ui/utils/autoPromptGenerator.ts:9`, `:19`, `:27`).
- a2a-server `agent/task.ts` imports `AgentClient` and `CoreToolScheduler` from core and directly constructs `AgentClient` (`packages/a2a-server/src/agent/task.ts:10`, `packages/a2a-server/src/agent/task.ts:32`, `packages/a2a-server/src/agent/task.ts:154`).
- Many CLI tests mock `@vybestack/llxprt-code-core` and/or import `AgentClient` types through the root barrel; this matters because P03 removes moved concrete exports from core and no shims are allowed (`project-plans/issue1592/plan/00-overview.md:24-27`).

The plan has a preflight item to create a full stayer-test blast-radius table for core (`project-plans/issue1592/plan/00a-preflight-verification.md:33`), but it does not require an equivalent complete CLI/a2a consumer/test disposition table before P03. Given the size of the CLI test mocking surface, relying on the broad P03 phrase "flip every CLI and a2a-server import" is risky and not sufficiently foolproof under PLAN.md's "specific existing files" and preflight assumptions requirements.

Required plan fix:

- Add a P00a/P03 input table for all CLI and a2a source/test files that import, type-import, instantiate, mock, or re-export moved symbols, covering static imports, root-barrel imports, dynamic imports, `require`, `vi.mock`, and test helper types.
- For each file, specify the exact disposition: concrete import from agents, contract type from core, structural fake, root mock update, or unaffected.
- Include tests in the P03 migration task, not only production consumers.

### MAJOR: The dependency-direction scans are conceptually right but need one stricter guard for package metadata and path alias leakage

The plan's dependency direction is sound: core must not depend on agents, agents must not depend on providers or cli, and agents may depend on core plus auth/settings/telemetry/mcp only when the import inventory proves it (`project-plans/issue1592/specification.md:133-135`; `project-plans/issue1592/plan/03a-code-move-verification.md:28`). P02 also correctly requires package dependencies to be generated from a full import inventory and not guessed (`project-plans/issue1592/plan/02-package-scaffold.md:23-29`).

The gap is that some quick scans shown in phases are narrower than the boundary rule. For example, the overview's dependency scans check core `package.json` for agents and `packages/agents` TS files/package.json for providers/cli (`project-plans/issue1592/plan/00-overview.md:74-76`), while P03a later broadens this to tsconfig paths and vitest aliases (`project-plans/issue1592/plan/03a-code-move-verification.md:28`). The stricter P03a version should be made the single authoritative scan everywhere after P02, because workspace leakage can happen through:

- `dependencies`, `devDependencies`, `peerDependencies`, or `optionalDependencies`.
- `tsconfig.json` `paths` aliases.
- vitest aliases or setup files.
- root/CLI package mocks that accidentally keep exporting concrete agents APIs from core.

This is especially important because `packages/core/vitest.config.ts` already has provider-specific alias behavior (`packages/core/vitest.config.ts:11`, `packages/core/vitest.config.ts:70`, `packages/core/vitest.config.ts:153`), so package-boundary leakage through test config is a real pattern in this repo.

Required plan fix:

- Promote the P03a strict dependency scan to the authoritative definition in `00-overview.md` and use it at P02a/P03/P04/P05 gates.
- Explicitly scan all dependency sections and all package-level tsconfig/vitest/esbuild aliases for `@vybestack/llxprt-code-agents`, `@vybestack/llxprt-code-providers`, and `@vybestack/llxprt-code` in the forbidden directions.
- Keep the generated import inventory as the only allowed source for package.json workspace dependencies.

### MINOR: The P01 TDD plan is acceptable for a refactor, but the verification text should explicitly protect against mock-only seam tests

The plan deliberately deviates from the canonical stub/TDD/implementation sequence because this is a behavior-preserving extraction, and it limits new TDD to the inversion seams (`project-plans/issue1592/plan/00-overview.md:8-10`). That deviation is reasonable for this kind of package refactor.

P01 does say seam tests must be behavioral and that `toHaveBeenCalled` alone is insufficient (`project-plans/issue1592/plan/01-contracts-inversion.md:48-52`). The examples are also behavior-oriented: factory-produced object returned by `getAgentClient()`, real history handoff, same scheduler object/callback behavior, and ToolRecord metadata parity.

To fully align with `dev-docs/PLAN.md`'s no-mock-theater requirement, P01a should explicitly require the reviewer to read each new test and answer whether it would fail if the seam was wired incorrectly, rather than only checking that tests exist and pass. This is a minor strengthening, not a blocker.

## Integration-first assessment

Pass, with the blocker above.

The plan does identify specific existing consumers and replacements:

- Core class couplings are identified in the reverse dependency map: `config/config.ts`, `config/configBaseCore.ts`, `config/schedulerSingleton.ts`, `config/toolRegistryFactory.ts`, and the three utils (`project-plans/issue1592/analysis/reverse-dependency-map.md:15-18`, `project-plans/issue1592/analysis/reverse-dependency-map.md:31-35`).
- P01 replaces those couplings with constructor-parameter factories/contracts (`project-plans/issue1592/plan/01-contracts-inversion.md:44-61`).
- P03 moves code and flips CLI/a2a consumers atomically because no shims are allowed (`project-plans/issue1592/plan/03-code-move.md:13`, `project-plans/issue1592/plan/03-code-move.md:44`).
- P03a explicitly scans for old moved imports and anti-shims (`project-plans/issue1592/plan/03a-code-move-verification.md:20-22`).

This cannot be built in isolation: the plan requires Config inversion, core export cleanup, CLI/a2a package deps, consumer import flips, root workspace updates, lockfile updates, CI/release/Docker wiring, and moved tests. The only integration-first failure is the missing concrete-scheduler disposition for `hooks/hooks-caller-application.test.ts`.

## Deviations from the issue's literal file list

The plan's deviations are justified and mostly correct:

- `contentGenerator.ts` stays in core because providers implement/import the content-generator contract (`packages/providers/src/ProviderContentGenerator.ts:10`) and core config/runtime/code-assist imports it (`packages/core/src/config/config.ts:10`, `packages/core/src/config/configBaseCore.ts:15-18`, `packages/core/src/runtime/AgentRuntimeLoader.ts:30`). Moving it would force providers/core into agents.
- `prompts.ts` stays in core because provider production files import `getCoreSystemPromptAsync` from `core/prompts.js` (`packages/providers/src/gemini/GeminiProvider.ts:22`, `packages/providers/src/openai/OpenAIRequestPreparation.ts:23`, `packages/providers/src/anthropic/AnthropicRequestPreparation.ts:34`). Moving it would create providers -> agents.
- `geminiRequest.ts` staying is acceptable based on the current staying test/root export consumers (`packages/core/src/tools/glob.test.ts:9`, `packages/core/src/index.ts:81`) and no evidence that it is required by moved chat-loop code.
- `config/subagentManager.ts` and `tools/list-subagents.ts` staying is coherent: TaskTool runtime moves, subagent configuration/listing remains core-owned. `toolRegistryFactory` currently imports both TaskTool and ListSubagentsTool (`packages/core/src/config/toolRegistryFactory.ts:38-39`), and only the TaskTool concrete seam needs inversion.

## Dependency direction assessment

The target dependency direction is sound:

- `core` owns structural contracts and must not import/depend on agents.
- `agents` may import core and directly import auth/settings/telemetry/mcp only if generated inventory proves it.
- `agents` must not import providers or cli, including tests.
- `providers` must not depend on agents; the ChatSession-dependent provider test must move/rewrite.
- CLI and a2a-server are composition roots and may depend on agents.

The plan is internally consistent on this rule across the spec, P02, and P03a. The main requested change is to make the strict P03a scan authoritative at every post-scaffold gate.

## Phase ordering and construction-inversion feasibility

The phase ordering is executable in principle:

- P01 inverts construction while classes still live in core, so the workspace can remain green before any package move.
- P02 adds an empty package and release/build wiring without importing it from consumers.
- P03 is correctly atomic because no shims are allowed: moved implementations and consumer import flips must land together.
- P04/P05 audit and cleanup after the atomic move.

The construction-inversion design is feasible against actual code:

- `Config` constructor only applies parameters (`packages/core/src/config/config.ts:103-107`), while concrete AgentClient creation happens at use time (`packages/core/src/config/config.ts:196-198`, `packages/core/src/config/config.ts:314-315`), so optional constructor params with use-time absence errors are compatible with non-initializing tests.
- `schedulerSingleton` centralizes concrete scheduler creation in `createNewScheduler()` (`packages/core/src/config/schedulerSingleton.ts:265-288`), so replacing that dynamic import with a factory sourced from `Config` is localized.
- `toolRegistryFactory` has enough metadata requirements to justify a descriptor instead of a bare instance factory: class name/static name are used for allow-listing and `ToolRecord` metadata (`packages/core/src/config/toolRegistryFactory.ts:101-149`, `packages/core/src/config/toolRegistryFactory.ts:247-260`, `packages/core/src/config/toolRegistryFactory.ts:304-310`).
- a2a-server actually initializes `Config`, so it must wire all seams (`packages/a2a-server/src/config/config.ts:31-45`, `packages/a2a-server/src/config/config.ts:135-145`). The plan correctly treats a2a as a composition root.

## Verification rigor assessment

Strong overall, with the tightening requested above.

Positive points:

- The plan defines an authoritative full battery including format, typecheck, build, tests, lint, smoke, dependency scans, and anti-shim scans (`project-plans/issue1592/plan/00-overview.md:60-80`).
- P02 includes release workflow, build-sandbox workflow, `build_sandbox.js`, `version.js`, Dockerfile, and release-process tests (`project-plans/issue1592/plan/02-package-scaffold.md:36-45`), matching actual provider precedent files.
- P03a includes no-leftover moved-file scans, provider-test migration verification, dependency completeness, pack dry-run, and behavior-preservation traces (`project-plans/issue1592/plan/03a-code-move-verification.md:9-33`).

Needed improvements:

- Add the missing `hooks/hooks-caller-application.test.ts` disposition.
- Make CLI/a2a test import/mocking inventory explicit before P03.
- Promote the strict dependency/path-alias scan to every relevant gate.

## Final verdict

REVISE

The architecture and ordering are broadly correct, but the missing core hooks test disposition is a P03 green-build blocker, and the CLI/a2a test inventory plus dependency-scan hardening should be added before implementation.