# Plan Review Round 3 — issue #1592 packages/agents extraction

Verdict: **REVISE**

I reviewed the plan documents under `project-plans/issue1592/` (excluding `reviews/`) against `dev-docs/PLAN.md`, GitHub issue #1592, and the actual working tree. I verified claims with direct file reads and greps rather than trusting the analysis artifacts.

## Summary

The plan is materially stronger than a naive package-extraction plan: it is integration-first, forbids shims, requires an atomic move/consumer migration phase, requires full-workspace verification, and correctly identifies the main construction couplings (`Config -> AgentClient`, `schedulerSingleton -> CoreToolScheduler`, `toolRegistryFactory -> TaskTool`). It also correctly justifies most deviations from issue #1592's literal file list (`contentGenerator.ts`, `prompts.ts`, `tokenLimits.ts`, nonexistent `loggingContentGenerator.ts`).

However, there are still plan defects that can make execution fail or produce the wrong boundary. The biggest issues are:

1. `coreToolHookTriggers.ts` is planned to move based on a false consumer claim; core hook tests currently import it, and core tests are forbidden from depending on agents.
2. The plan says `buildContinuationDirective` can be removed from core based on a false preflight claim; a CLI integration test imports it from the core root barrel today.
3. The TaskTool inversion contract contains an internally inconsistent `ToolRecord.toolName` definition that conflicts with current code and with the P01 text.
4. P02 adds `@vybestack/llxprt-code-agents` to `packages/cli` and `packages/a2a-server` before any imports use it, which can violate no-unused-dependencies/depcheck-style checks if the repo enforces them during P02.

These should be corrected before implementation begins.

## Verified factual checks

I verified at least the following plan claims against the codebase:

1. **Issue asks for the package extraction and listed files.** `gh issue view 1592 --json title,body` shows the issue title is “Extract packages/agents” and asks to move agent runtime/chat loop/subagent system into `packages/agents`, including `client.ts`, `geminiChat.ts`, `coreToolScheduler.ts`, `subagent*`, `turn.ts`, `geminiRequest.ts`, `contentGenerator.ts / loggingContentGenerator.ts`, `prompts.ts`, `tokenLimits.ts`, `compression/`, and all `core/src/agents` code.
2. **Current `Config` directly constructs `AgentClient`.** `packages/core/src/config/config.ts:17` imports `AgentClient`; `config.ts:198` creates the startup client; `config.ts:315` creates a new client during `initializeContentGeneratorConfig()`.
3. **Current `Config` history handoff depends on concrete client methods.** `config.ts:272-300` calls `storeHistoryServiceForReuse()` and `storeHistoryForLaterUse()` on the new client; `config.ts:325-345` initializes, disposes the previous client, and swaps the field.
4. **Current `ConfigBaseCore` stores concrete `AgentClient` type.** `packages/core/src/config/configBaseCore.ts:19` imports the type and `configBaseCore.ts:126` declares `protected agentClient!: AgentClient`.
5. **Current `schedulerSingleton` dynamically imports and constructs `CoreToolScheduler`.** `packages/core/src/config/schedulerSingleton.ts:273-276` dynamically imports `../core/coreToolScheduler.js` and returns a `new CoreToolSchedulerClass(...)`; its singleton maps store `CoreToolScheduler` at `schedulerSingleton.ts:64-79`.
6. **Current `toolRegistryFactory` directly imports and uses `TaskTool`.** `packages/core/src/config/toolRegistryFactory.ts:38` imports `TaskTool`; `toolRegistryFactory.ts:248-260` registers it or records a disabled `ToolRecord`; `toolRegistryFactory.ts:308-309` force-includes both `TaskTool` and `TaskTool.Name` in `coreTools`.
7. **Current `ToolRecord` semantics are class-name for `toolName`, static `Name` for `displayName`.** `toolRegistryFactory.ts:101-105` derives `className` and `rawName`; `toolRegistryFactory.ts:131-135` sets `toolName: className` and `displayName: toolName` (where local `toolName` is static `Name` when present). The disabled TaskTool path does the same at `toolRegistryFactory.ts:251-255`.
8. **`TaskTool.Name` is `task`, not `TaskTool`.** `packages/core/src/tools/task.ts:1343` defines `static readonly Name = 'task'`; `ListSubagentsTool.Name` is similarly `list_subagents` at `packages/core/src/tools/list-subagents.ts:129`.
9. **The contentGenerator/prompts/tokenLimits deviations are largely justified.** `packages/core/src/config/config.ts:10`, `configBaseCore.ts:15-18`, `code_assist/codeAssist.ts:7`, `runtime/AgentRuntimeLoader.ts:30`, and `test-utils/config.ts:8` consume `core/contentGenerator.js`; providers consume it at `packages/providers/src/ProviderContentGenerator.ts:10`. Providers consume `core/prompts.js` in production at `packages/providers/src/gemini/GeminiProvider.ts:22`, `anthropic/AnthropicRequestPreparation.ts:34`, `openai/OpenAIRequestPreparation.ts:23`, `openai-responses/OpenAIResponsesProviderCore.ts:27`, and `openai-vercel/OpenAIVercelProvider.ts:61`. `tokenLimits` is used by `packages/core/src/runtime/createAgentRuntimeContext.ts:21`.
10. **The nonexistent `loggingContentGenerator.ts` deviation is correct.** `find packages/core/src/core -name '*loggingContentGenerator*'` finds no such file; the file inventory under `packages/core/src/core` includes `contentGenerator.ts`, `googleGenAIWrapper.ts`, `prompts.ts`, and `tokenLimits.ts`, but no `loggingContentGenerator.ts`.
11. **Providers currently have a ChatSession test coupling.** `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:11` imports `ChatSession` from `@vybestack/llxprt-code-core/core/chatSession.js`; this supports the plan’s relocation requirement because providers must not depend on agents.
12. **The agents directory has no external consumers today.** Grepping for imports from `src/agents` outside `packages/core/src/agents` produced no hits, supporting the wholesale move claim.
13. **Scheduler implementation files are currently only pulled by the scheduler implementation path.** `packages/core/src/core/coreToolScheduler.ts:34-61` imports `scheduler/tool-executor`, `tool-dispatcher`, `result-aggregator`, `confirmation-coordinator`, `utils`, and `status-transitions`; I did not find non-test production imports of those implementation files elsewhere.
14. **`scheduler/types.ts` really has core stayers.** `packages/core/src/confirmation-bus/types.ts:6` imports `ToolCall` from `scheduler/types.js`; `packages/core/src/policy/policy-helpers.ts:15` imports `PolicyContext` from `scheduler/types.js`.
15. **External concrete `AgentClient` constructions exist.** CLI constructs it in `packages/cli/src/ui/utils/autoPromptGenerator.ts:19-28`; a2a constructs it in `packages/a2a-server/src/agent/task.ts:9-20` and `task.ts:145-154`.
16. **The Config construction blast radius is large.** `grep -rn "new Config(" packages --include="*.ts"` returns 251 hits. The plan’s preflight item to enumerate these is necessary.
17. **P02 providers precedent touchpoints exist.** Root workspaces include providers at `package.json:13-15`; release publishes/pack providers at `.github/workflows/release.yml:344-377`; sandbox packs providers at `.github/workflows/build-sandbox.yml:65`; `scripts/build_sandbox.js:97`, `159-165`, and `225-227` handle providers; `scripts/version.js:50` includes providers.

## Findings

### BLOCKER 1 — `coreToolHookTriggers.ts` move disposition is factually wrong and conflicts with the core-test boundary

The move map says `core/coreToolHookTriggers.ts` moves and claims its consumers are “scheduler/tool-executor only — verify” (`project-plans/issue1592/analysis/move-map.md:47`). The specification similarly says it moves only “if (and only if) analysis confirms all consumers move” (`project-plans/issue1592/specification.md:52`).

That condition is not met. Actual consumers include core hook tests that are not in the proposed move set:

- `packages/core/src/hooks/notification-hook.test.ts:20` imports `triggerToolNotificationHook` from `../core/coreToolHookTriggers.js`.
- `packages/core/src/hooks/hooks-caller-application.test.ts:49` imports from `../core/coreToolHookTriggers.js`.
- The production scheduler path also imports it as expected: `packages/core/src/core/coreToolScheduler.ts:33` and `packages/core/src/scheduler/tool-executor.ts:24`.

The plan’s own boundary forbids core importing agents in source or tests (`project-plans/issue1592/plan/00-overview.md:43`, `plan/00-overview.md:60-61`; `plan/03-code-move.md:56-57`). If `coreToolHookTriggers.ts` moves to agents, those core hook tests cannot import it from agents, and keeping a forwarding core file would violate the no-shim rule (`plan/00-overview.md:5`, `plan/00-overview.md:44`; `specification.md:25-26`).

**Required revision:** either keep `coreToolHookTriggers.ts` in core as hook-system glue (parallel to the plan’s decision to keep `lifecycleHookTriggers.ts` in core at `move-map.md:113`) or explicitly move/retarget the affected hook tests with a behavior-preserving strategy that does not create core→agents test dependencies. The current disposition is not executable as written.

### BLOCKER 2 — `buildContinuationDirective` removal claim misses a current CLI consumer

The reverse-dependency map says `buildContinuationDirective` can be removed from the core root export because preflight found “only compression internals + index” and marks “CLI re-check required” (`project-plans/issue1592/analysis/reverse-dependency-map.md:68`). The specification lists `buildContinuationDirective` among moved API export lines to remove from core (`project-plans/issue1592/specification.md:116`).

Actual code has a CLI integration test importing it from the core root barrel:

- `packages/cli/src/integration-tests/compression-todo.integration.test.ts:28-32` imports `TodoStore` and `buildContinuationDirective` from `@vybestack/llxprt-code-core`.
- The same file calls it repeatedly at `compression-todo.integration.test.ts:226`, `236-238`, `255`, and `310`.

Because no backward-compatible core re-export is allowed, P03 must explicitly migrate this consumer to `@vybestack/llxprt-code-agents` if `buildContinuationDirective` moves with compression, or justify keeping this utility in core. The current plan does neither in the consumer migration list, so P03 can end with a broken CLI test/import or an accidental shim.

**Required revision:** update the reverse-dependency map, move map, and P03/P04 consumer audit to include `packages/cli/src/integration-tests/compression-todo.integration.test.ts` and any other root-barrel consumers of `buildContinuationDirective`. Decide whether the function is part of agents’ compression public API or a core-owned shared helper; do not leave it as an implicit core export removal.

### MAJOR 1 — TaskTool inversion contract is internally inconsistent about `ToolRecord.toolName`

The plan correctly recognizes that TaskTool cannot be replaced by a bare instance factory because `toolRegistryFactory` depends on class/static metadata (`project-plans/issue1592/analysis/integration-contract.md:53-75`). But the descriptor text says `toolName: string` is “static ToolClass.Name ('task')” (`integration-contract.md:60`). That is not the current `ToolRecord.toolName` behavior.

Actual code:

- `TaskTool.Name` is `task` (`packages/core/src/tools/task.ts:1343`).
- The generic registration path sets `ToolRecord.toolName` to `className` and `displayName` to the static name (`packages/core/src/config/toolRegistryFactory.ts:101-105`, `131-135`).
- The disabled TaskTool record also sets `toolName: 'TaskTool'` and `displayName: TaskTool.Name || 'TaskTool'` (`toolRegistryFactory.ts:251-255`).

P01’s prose is correct: it requires `toolName='TaskTool'` and `displayName=TaskTool.Name` (`project-plans/issue1592/plan/01-contracts-inversion.md:35`). The integration contract conflicts with it. That conflict is dangerous because implementers may use the descriptor literally and change settings/UI `allPotentialTools` metadata from `TaskTool` to `task`.

**Required revision:** change `TaskToolRegistration.toolName` in `integration-contract.md` to mean the class-name `ToolRecord.toolName` (`TaskTool`), and add a separate `displayName` or `staticName` field for `TaskTool.Name` (`task`). Keep the parity tests required in P01 and P03a (`plan/01-contracts-inversion.md:48`, `plan/03a-code-move-verification.md:12`).

### MAJOR 2 — P02 may fail green-phase verification by adding unused workspace dependencies before imports use them

P02 instructs adding `@vybestack/llxprt-code-agents` to `packages/cli/package.json` and `packages/a2a-server/package.json` immediately (`project-plans/issue1592/plan/02-package-scaffold.md:29-31`) while also forbidding any imports of the new package until P03 (`plan/02-package-scaffold.md:28`). P02 then requires `npm run build`, `npm run typecheck`, and `npm run lint` to pass (`plan/02-package-scaffold.md:42-46`; `plan/02-package-scaffold.md:53`).

This is potentially incompatible with dependency hygiene checks if lint/CI includes unused dependency detection. The repo already contains dependency-boundary/check scripts such as `scripts/check-settings-boundary.js` with provider/core dependency scanning patterns (`scripts/check-settings-boundary.js` contains providers/core checks in the grep output I ran), and root `package.json:71` maps `npm run check` to `npm run lint:all`. Even if today’s `npm run lint` does not run depcheck, adding unused package dependencies in a phase required to end green is fragile and contradicts the plan’s own integration-first/no-isolated-feature intent.

**Required revision:** either (a) add the consumer package dependencies in the same atomic P03 phase that introduces imports, or (b) explicitly verify that the repo has no unused-dependency gate in P02 and document why the temporary unused dependency is acceptable. The safer executable ordering is P02 creates only the `packages/agents` workspace and root lockfile entry; P03 adds cli/a2a dependencies with the import flips.

### MAJOR 3 — P01 “update ALL Config construction sites” is underspecified for 251 call sites and can become mechanical churn without behavioral value

P01 says to update **ALL** Config construction sites found in preflight to pass factories (`project-plans/issue1592/plan/01-contracts-inversion.md:52`). Actual grep finds 251 `new Config(` occurrences across packages and tests. Many of these tests construct `Config` only to exercise configuration accessors or unrelated tools and never initialize the agent client. Current `ConfigParameters` has no factory fields (`packages/core/src/config/configTypes.ts:344-457`), and `applyConfigParams()` assigns known fields directly (`packages/core/src/config/configConstructor.ts:466-475`).

Updating all 251 call sites by hand is high-risk churn and conflicts with the plan’s desire for phases to end green and preserve behavior. At the same time, making factories optional with “clear error at use time” is already allowed by P01 (`plan/01-contracts-inversion.md:50`), which means most non-initializing call sites should not need factories.

**Required revision:** distinguish:

- true composition roots that must pass concrete factories (CLI, a2a, test-utils used by initializing tests),
- tests that initialize `Config` or call `initializeContentGeneratorConfig()` and need test fakes/factories,
- unrelated `new Config()` tests that can omit factories because they never cross the seam.

The preflight output should classify the 251 call sites rather than mandate blanket edits.

### MAJOR 4 — Dependency-direction scans do not fully cover workspace package leakage

The plan forbids agents depending on providers or CLI (`specification.md:22-23`, `plan/00-overview.md:45`), including devDependencies (`move-map.md:124-125`). The scans catch `llxprt-code-providers` and `llxprt-code-cli` in `packages/agents/package.json` and source (`plan/00-overview.md:60-65`; `plan/03-code-move.md:56-60`).

But the source scans are string-specific and can miss:

- relative path leakage such as `packages/cli` imports in comments or build config,
- `@vybestack/llxprt-code` root-package imports if any are introduced,
- dev-only leakage through test helpers not named `providers`/`cli`,
- package.json dependencies on root `@vybestack/llxprt-code` or other workspace packages not allowed by the dependency table.

This matters because moved tests already include provider-related cases. The plan correctly identifies three ChatSession tests importing providers (`move-map.md:125`) and the providers test relocation (`move-map.md:124`), and my grep confirms those imports exist in `packages/core/src/core/chatSession.issue1729.test.ts:8`, `chatSession.runtime.test.ts:15`, and `chatSession.thinking-toolcalls.test.ts:46`.

**Required revision:** add a generated package-import inventory gate for `packages/agents/src` and `packages/agents/package.json` at P03a/P05a, failing on any workspace package not explicitly listed as allowed. Include `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies`.

### MINOR 1 — Plan numbering does not follow PLAN.md’s canonical phase template, but the custom sequence is acceptable if explicitly acknowledged

`dev-docs/PLAN.md:155-170` describes required integration phases (stub, integration TDD, integration impl, migration, deprecation), and `PLAN.md:187-210` shows a broader template with analysis/pseudocode phases. This plan uses a custom sequence: P00a, P01/P01a, P02/P02a, P03/P03a, P04/P04a, P05/P05a (`project-plans/issue1592/plan/00-overview.md:5`, `execution-tracker.md:5-16`).

For a behavior-preserving package extraction, the custom sequence is reasonable because P03 is explicitly atomic and integration-first (`plan/00-overview.md:34`; `plan/03-code-move.md:9-14`). Still, the plan should explicitly state why it deviates from the standard feature-stub/TDD/impl/migration/deprecation template: this is a refactor/move with existing behavior tests, not a new feature implementation.

### MINOR 2 — Smoke-test command conflict should be resolved in the plan

The plan uses `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"` (`specification.md:142`, `plan/00-overview.md:54`). Project-local memory also says to use synthetic for llxprt-code smoke testing. Parent memory says to use `ollamaglm51` for this project. Because the project-local memory is more specific and repeated, synthetic is defensible, but the plan should mention that it intentionally follows project-local smoke-test guidance to avoid future reviewer confusion.

### MINOR 3 — `core/googleGenAIWrapper.ts` stays because `contentGenerator.ts` stays, but package exports should be checked

The move map keeps `core/googleGenAIWrapper.ts` because `contentGenerator.ts` stays (`project-plans/issue1592/analysis/move-map.md:31`). That is factually reasonable: `contentGenerator.ts` imports runtime provider contracts and remains core-owned, and `googleGenAIWrapper.ts` exists with tests in the current core file inventory. However, the package export map currently exports `./core/contentGenerator.js`, `./core/chatSession.js`, and `./core/prompts.js` (`packages/core/package.json:25-27`) but not every core subpath agents may need. P02 already says to enumerate exports (`plan/02-package-scaffold.md:31`); ensure `googleGenAIWrapper` is included only if a moved file actually imports it.

## Integration-first assessment

The plan is integration-first overall:

- It lists concrete existing consumers in the specification (`project-plans/issue1592/specification.md:104-111`).
- It identifies old code to remove (`specification.md:116`; `plan/03-code-move.md:54-65`).
- It explicitly rejects shims (`plan/00-overview.md:5`, `plan/00-overview.md:44`).
- It combines the move and consumer import flips in one atomic P03 because no shims are allowed (`plan/00-overview.md:34`; `plan/03-code-move.md:9-14`).

This cannot be built in isolation if followed: P03 requires CLI/a2a import flips, core export cleanup, moved tests, dependency scans, and full workspace verification. That satisfies `dev-docs/PLAN.md:117-184` in spirit. The two missed consumers above (`coreToolHookTriggers` core hook tests and CLI `buildContinuationDirective`) are the main integration gaps.

## Phase ordering/executability assessment

The construction-inversion design is feasible in principle:

- `ConfigParameters` is the right constructor-time seam location because `Config.initialize()` creates `AgentClient` before any post-construction setter could reliably be called (`config.ts:196-199`; plan warning at `integration-contract.md:85`).
- `applyConfigParams()` is the central assignment point for new params (`configConstructor.ts:466-475`), and existing provider-related seams already use params and setters (`configConstructor.ts:343`; `configBaseCore.ts:240-258`, `328-336`).
- `schedulerSingleton` can use an injected factory in place of the dynamic import while preserving singleton maps and callback merging (`schedulerSingleton.ts:64-79`, `201-263`, `318-357`).
- `toolRegistryFactory` can accept a TaskTool descriptor, but the descriptor must preserve current `ToolRecord` metadata exactly (`toolRegistryFactory.ts:101-149`, `248-260`, `308-309`).

The phases can end green if the blockers are fixed. Without fixing them, P03/P03a is likely to fail import scans or tests.

## Verification rigor and TDD discipline

The verification plan is strong:

- Full battery and smoke test are required at major gates (`plan/00-overview.md:52-55`, `plan/04-consumer-migration.md:27-31`, `plan/05-cleanup-final.md:27-32`).
- Anti-shim and dependency scans are present (`plan/00-overview.md:60-71`, `plan/03-code-move.md:54-65`).
- Behavior-preservation audits are required for key moved files (`plan/03a-code-move-verification.md:3`).
- P01 explicitly requires behavioral tests first and forbids mock-theater-only assertions (`plan/01-contracts-inversion.md:45-49`), which aligns with `dev-docs/PLAN.md:11-20` and `PLAN.md:727-821`.

The main verification gap is that the dependency scans should be generated from imports and package metadata rather than relying on a few string greps.

## Required revisions before approval

1. Fix `coreToolHookTriggers.ts` disposition and update move-map/reverse-dependency map/P03/P03a checks accordingly.
2. Add `buildContinuationDirective` CLI consumer migration or justify keeping that helper in core.
3. Correct `TaskToolRegistration` metadata fields so `ToolRecord.toolName` remains `TaskTool` and `displayName` remains `task`.
4. Move cli/a2a `agents` dependency additions from P02 to P03, or prove/document that unused dependency gates will not fail P02.
5. Classify `new Config()` call sites instead of mandating blanket edits for all 251 occurrences.
6. Strengthen dependency-leakage verification with generated import/package inventories for all dependency sections.

After these revisions, the plan should be close to approvable.
