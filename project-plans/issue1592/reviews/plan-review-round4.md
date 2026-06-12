# Plan Review Round 4 — issue #1592 Extract `packages/agents`

## Verdict

**REVISE**

The plan is close and is materially integration-first: it has a real move map, forbids shims, makes P03 an atomic move-plus-consumer-migration phase, explicitly justifies most deviations from the issue's literal file list, and uses feasible construction-inversion seams for `Config`, `schedulerSingleton`, and `toolRegistryFactory`. I verified the plan against the actual tree rather than trusting the analysis documents.

However, I found several issues that should be fixed before execution. The most important are release/sandbox wiring omissions around `Dockerfile` and release-process tests, missing explicit TypeScript workspace resolution updates for `packages/cli` and `packages/a2a-server`, and dependency-inventory scans that still miss dynamic imports and some non-source packaging surfaces. These are execution risks for a phase-gated plan that requires every phase to end green.

## Findings

### MAJOR 1 — P02 release/sandbox wiring misses the Dockerfile and release-process tests that encode the providers precedent

P02 says release/sandbox wiring must mirror providers and lists `.github/workflows/release.yml`, `.github/workflows/build-sandbox.yml`, `scripts/prepare-package.js`, `scripts/build_sandbox.js`, `scripts/version.js`, `esbuild.config.js`, and publish config checks (`project-plans/issue1592/plan/02-package-scaffold.md:32-38`). P02 verification uses a providers grep over `package.json .github/workflows scripts/*.js` (`project-plans/issue1592/plan/02a-package-scaffold-verification.md:10-12`). That omits two real provider precedent surfaces:

1. `Dockerfile` copies and installs provider tarballs directly. It currently copies auth/settings/telemetry/mcp/core/providers/cli tarballs in order (`Dockerfile:53-59`) and installs them in one `npm install -g` transaction (`Dockerfile:64-71`). If agents becomes a published workspace and CLI depends on it, the sandbox image needs the agents tarball copied and installed between core/providers and cli.
2. `scripts/tests/release-process.test.js` hard-codes provider-aware release expectations. It expects the release package list to include providers before CLI (`scripts/tests/release-process.test.js:63-73`), checks release publish order through providers then CLI (`scripts/tests/release-process.test.js:109-139`), checks sandbox tarball preparation for settings/providers (`scripts/tests/release-process.test.js:166-173`), checks `scripts/build_sandbox.js` packs providers (`scripts/tests/release-process.test.js:176-193`), checks Dockerfile copy order for providers before CLI (`scripts/tests/release-process.test.js:201-234`), and checks the global install command includes providers (`scripts/tests/release-process.test.js:236-249`). Once `packages/agents/package.json` is added as a non-private workspace package, the derivation in `npmReleasePackages()` will include it unless explicitly excluded (`scripts/tests/release-process.test.js:53-59`), so these tests must be updated as part of the providers-precedent wiring.

This matters because the plan's verification battery includes full tests (`project-plans/issue1592/specification.md:140-142`, `project-plans/issue1592/plan/05-cleanup-final.md:27-32`). If P02 does not update these surfaces, later full verification can fail even when source extraction is correct.

**Required revision:** add `Dockerfile` and `scripts/tests/release-process.test.js` to P02 mandatory edits/checklist and P02a verification. Require the agents tarball to be copied and installed in dependency order before the CLI tarball, and require release-process tests to be updated so the package derivation/order expectations include `@vybestack/llxprt-code-agents`.

### MAJOR 2 — CLI and a2a TypeScript path/reference updates are not explicit, so P03 import flips may not typecheck

P02's behavioral requirement says the scaffold should make `packages/agents/dist` build and make cli/a2a resolve `@vybestack/llxprt-code-agents` (`project-plans/issue1592/plan/02-package-scaffold.md:14-18`). But the implementation tasks only create `packages/agents` files, add the root workspace, defer cli/a2a package dependencies to P03, and add core export-map entries (`project-plans/issue1592/plan/02-package-scaffold.md:23-31`). P03 says to add cli/a2a package dependencies and flip imports (`project-plans/issue1592/plan/03-code-move.md:44`) but does not explicitly require updating tsconfig path aliases/includes/references.

Actual tsconfig evidence shows this is necessary:

- `packages/cli/tsconfig.json` maps workspace aliases for auth, core, mcp, providers, and settings, but has no agents alias today (`packages/cli/tsconfig.json:12-21`). Its includes explicitly pull in provider/auth/mcp sibling sources (`packages/cli/tsconfig.json:24-36`), so agents needs the same treatment if CLI typechecks directly against source.
- `packages/a2a-server/tsconfig.json` maps only core and mcp aliases (`packages/a2a-server/tsconfig.json:10-15`) and references only core (`packages/a2a-server/tsconfig.json:30`). It will not resolve a new `@vybestack/llxprt-code-agents` source import without explicit updates.

This is not just metadata. P03 explicitly flips a2a's direct `AgentClient` construction import (`project-plans/issue1592/plan/03-code-move.md:44`), and the current a2a file does construct `new AgentClient(this.config, runtimeState)` (`packages/a2a-server/src/agent/task.ts:154`) from imports currently sourced from core (`packages/a2a-server/src/agent/task.ts:20`, `packages/a2a-server/src/agent/task.ts:33`). Without tsconfig updates, `npm run typecheck` can fail at P03a even though package.json dependencies were added.

**Required revision:** add explicit P02 or P03 tasks to update `packages/cli/tsconfig.json`, `packages/cli/tsconfig.build.json`, `packages/a2a-server/tsconfig.json`, and any vitest alias/package resolution config that mirrors workspace aliases. P03a should include a targeted resolution check for `@vybestack/llxprt-code-agents` from both CLI and a2a.

### MAJOR 3 — Dependency inventory gates still miss dynamic imports and package surfaces outside `src`

The plan correctly strengthens dependency checks by requiring a generated import inventory and package.json dependency-section reconciliation (`project-plans/issue1592/plan/03-code-move.md:45`, `project-plans/issue1592/plan/03a-code-move-verification.md:19-20`). But the actual command only greps static `from ...` imports (`project-plans/issue1592/plan/03-code-move.md:45`; `project-plans/issue1592/plan/03a-code-move-verification.md:20`). That misses dynamic imports and non-source package/config files.

The repo uses dynamic imports in package code and tests. Examples include the scheduler's current dynamic class load that P01 must remove (`packages/core/src/config/schedulerSingleton.ts:272-287`), provider dynamic imports of external packages (`packages/providers/src/gemini/GeminiProvider.ts:853`, `packages/providers/src/gemini/GeminiProvider.ts:2028`), and CLI dynamic imports of providers (`packages/cli/src/auth/provider-usage-info.ts:128`, `packages/cli/src/auth/provider-usage-info.ts:195`). A package extraction dependency audit that only scans `from` imports can miss direct runtime dependencies introduced by moved code or tests.

The plan also says workspace-leakage checks cover `packages/agents` source, tests, and config files (`project-plans/issue1592/plan/03a-code-move-verification.md:20`), but the sample command is scoped to `--include="*.ts"` and only extracts `from` specifiers. It does not parse `package.json` script references, tsconfig path references, vitest aliases, dynamic `import('...')`, or import specifiers in `.tsx` if any are later added.

**Required revision:** replace the grep-only inventory with a generated module-specifier inventory that covers static imports, dynamic `import('...')`, `export ... from`, `require()` if present, `.ts`/`.tsx` config and test files, package.json dependency sections, and tsconfig/vitest aliases. Keep the forbidden workspace-package allow-list gate across all dependency sections.

### MAJOR 4 — P01/P03 must explicitly handle provider-owned `new Config(...)` construction, or document it as non-initializing

The plan's preflight item 7 says to enumerate all `new Config(` call sites across packages and classify them (`project-plans/issue1592/plan/00a-preflight-verification.md:24`), which is good. But the P01 implementation wording narrows composition-root factory wiring to CLI bootstrap, a2a config, and test-utils helpers (`project-plans/issue1592/plan/01-contracts-inversion.md:53`). Actual grep finds a provider production `new Config(...)` in `GeminiProvider.resolveOAuthConfig()` (`packages/providers/src/gemini/GeminiProvider.ts:950-966`, construction at `packages/providers/src/gemini/GeminiProvider.ts:958-964`).

This may be safe because the plan allows factories to be optional with a clear error at use time (`project-plans/issue1592/plan/01-contracts-inversion.md:51`), and this provider path appears to create a minimal Config for OAuth tooling rather than initializing an `AgentClient`. But it must be classified explicitly because providers must not depend on agents (`project-plans/issue1592/specification.md:21-23`, `project-plans/issue1592/specification.md:129-132`). If a future implementation makes `Config` require `agentClientFactory` at construction time rather than at `initialize()`/client-refresh use time, this provider code would either break or force an illegal providers→agents dependency.

**Required revision:** add `packages/providers/src/gemini/GeminiProvider.ts:958` to the preflight classification table as a known provider production `new Config` call. State explicitly that provider Config construction must remain valid without agents factories unless/until it calls `initialize()` or client-refresh paths, because providers cannot wire concrete agents dependencies.

### MINOR 1 — The dependency-direction rationale contains a confusing contradiction with the intended layering

The dependency table clearly says agents must not depend on providers, providers must not depend on agents, and core must not depend on agents (`project-plans/issue1592/specification.md:13-23`). That matches the user's requested architecture. But the deviation rationale says moving listed modules would invert the intended layering, quoting “agents should depend on providers” (`project-plans/issue1592/specification.md:32`). That phrase conflicts with the table and with the no-agents→providers rule.

**Required revision:** change that phrase to the actual intended layering, e.g. “providers must remain below/independent of agents” or “agents consumes provider behavior only through core-owned runtime contracts; agents must not import providers.”

### MINOR 2 — P05 documentation wording still says to mirror providers README even if providers has none

P05 says to add an equivalent `packages/agents/README.md` if `packages/providers` has a README (`project-plans/issue1592/plan/05-cleanup-final.md:25`). That conditional is fine, but the phase should require the worker to document the actual result. This is minor because it will not break extraction, but it helps avoid fake documentation work.

**Required revision:** require P05 completion notes to state whether `packages/providers/README.md` exists and whether an agents README was added or deliberately skipped.

## Verified factual claims and architecture assessment

I verified the following plan claims against the actual codebase:

1. **`Config.initialize()` constructs `AgentClient` today.** `packages/core/src/config/config.ts:196-198` assigns `this.agentClient = new AgentClient(this, this.runtimeState)`, and `config.ts:17` imports the concrete class. This supports the P01 constructor/factory seam.
2. **`initializeContentGeneratorConfig()` constructs another `AgentClient`.** `packages/core/src/config/config.ts:306-315` builds a new runtime config and does `new AgentClient(this, this.runtimeState)`, then initializes it at `config.ts:325` and assigns it at `config.ts:345`. P01's history-handoff behavioral test requirement is necessary.
3. **`ConfigParameters` currently has no factory fields.** The interface spans `packages/core/src/config/configTypes.ts:344-457` and contains no `agentClientFactory`, `toolSchedulerFactory`, or `taskToolRegistration` fields. P01 is adding real new constructor parameters.
4. **`applyConfigParams()` is field-assignment based and can accept new params if `ConfigConstructorTarget` is extended.** It applies grouped parameter functions at `packages/core/src/config/configConstructor.ts:466-475`, supporting the plan's in-place constructor-param approach.
5. **`schedulerSingleton` has a hard dynamic import of `CoreToolScheduler`.** `packages/core/src/config/schedulerSingleton.ts:272-287` imports `../core/coreToolScheduler.js` dynamically and constructs the concrete class. Replacing this with `ToolSchedulerFactory` is necessary and feasible.
6. **`toolRegistryFactory` imports `TaskTool` and `ListSubagentsTool` today.** Imports are at `packages/core/src/config/toolRegistryFactory.ts:38-39`. The plan's TaskTool descriptor seam is needed if `TaskTool` moves and `ListSubagentsTool` stays.
7. **The `ToolRecord` class-name/static-name semantics are real.** `buildRegisterCoreTool()` stores `toolName: className` and `displayName: toolName` at `packages/core/src/config/toolRegistryFactory.ts:101-105` and `toolRegistryFactory.ts:131-138`. Disabled TaskTool records currently use `toolName: 'TaskTool'` and `displayName: TaskTool.Name || 'TaskTool'` at `toolRegistryFactory.ts:251-258`. The integration-contract mapping (`className` -> `ToolRecord.toolName`, `staticName` -> `displayName`) is correct (`project-plans/issue1592/analysis/integration-contract.md:58-76`).
8. **`ListSubagentsTool` staying is justifiable.** It imports base tool/config/subagent-manager types and not chat-loop runtime (`packages/core/src/tools/list-subagents.ts:14-21`, `packages/core/src/tools/list-subagents.ts:153-160`), while `SubagentManager` is config/storage code exported from core (`packages/core/src/config/subagentManager.ts:65`, `packages/core/src/index.ts:12`, `packages/core/src/index.ts:460`). The plan's boundary between subagent runtime execution and configuration/registry is reasonable (`project-plans/issue1592/specification.md:62-66`).
9. **`contentGenerator.ts` staying is justified.** Core config imports it at `packages/core/src/config/config.ts:10`; config base imports it at `packages/core/src/config/configBaseCore.ts:18`; runtime imports it at `packages/core/src/runtime/AgentRuntimeLoader.ts:30`; code assist imports it at `packages/core/src/code_assist/server.ts:29`; providers import it at `packages/providers/src/ProviderContentGenerator.ts:10` and in the ChatSession stopReason test at `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:27`.
10. **`prompts.ts` staying is justified by provider production imports.** Providers import `getCoreSystemPromptAsync` in `packages/providers/src/gemini/GeminiProvider.ts:22`, `packages/providers/src/openai/OpenAIRequestPreparation.ts:23`, `packages/providers/src/anthropic/AnthropicRequestPreparation.ts:34`, `packages/providers/src/openai-responses/OpenAIResponsesProviderCore.ts:27`, and `packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:61`.
11. **`tokenLimits.ts` staying is justified.** Core runtime imports it at `packages/core/src/runtime/createAgentRuntimeContext.ts:21`; moving it would force core to depend on agents for a pure runtime constant.
12. **`coreToolHookTriggers.ts` staying is justified.** Core hook tests import it at `packages/core/src/hooks/notification-hook.test.ts:20` and `packages/core/src/hooks/hooks-caller-application.test.ts:49`; moved scheduler files can deep-import it from core (`packages/core/src/scheduler/tool-executor.ts:24`, current scheduler consumer evidence).
13. **`buildContinuationDirective` has a real CLI root-barrel consumer.** Core exports it at `packages/core/src/index.ts:85`; the CLI compression integration test imports it from the core root at `packages/cli/src/integration-tests/compression-todo.integration.test.ts:28-32` and exercises it at `packages/cli/src/integration-tests/compression-todo.integration.test.ts:226-238` and `:255`, `:310`. The plan's decision to make it core-owned rather than a shim is correct.
14. **Provider test coupling to `ChatSession` exists and must be relocated/reworked without providers↔agents dependency.** `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:11` imports `ChatSession` from core, constructs provider infrastructure at `:31-79`, and calls `chatSession.convertIContentToResponse(...)` repeatedly (`:110`, `:130`, etc.). The move-map's relocation/structural-fake requirement is necessary.
15. **Moved chatSession tests currently import providers.** `packages/core/src/core/chatSession.issue1729.test.ts:8`, `packages/core/src/core/chatSession.runtime.test.ts:15`, and `packages/core/src/core/chatSession.thinking-toolcalls.test.ts:46` import `@vybestack/llxprt-code-providers`. The plan correctly requires structural fakes because agents must not depend on providers, including tests (`project-plans/issue1592/analysis/move-map.md:124-125`).
16. **The whole `packages/core/src/agents` directory is a plausible wholesale move.** The actual files are `executor.ts`, `executor-prompt-builder.ts`, `executor-termination.ts`, `executor-validation.ts`, `invocation.ts`, `recovery.ts`, `types.ts`, `utils.ts`, plus tests (`glob packages/core/src/agents/*.ts` verified 11 files). The reverse-dependency map's “zero external consumers” claim is plausible, but P00a should still paste command evidence as required.
17. **Core root-barrel self-imports are a real moved-file hazard.** Current core files import from `../index.js`, including `scheduler/status-transitions.ts:28-30`, `core/coreToolScheduler.ts:7` and `:18`, and `core/nonInteractiveToolExecutor.ts:12`. The P03 hard scan against `../index.js` imports in agents is warranted.
18. **Config construction blast radius is real.** Grep found 251 `new Config(` occurrences across packages and tests, including a2a (`packages/a2a-server/src/config/config.ts:43`), CLI composition (`packages/cli/src/config/configBuilder.ts:318`, `packages/cli/src/runtime/runtimeContextFactory.ts:224`), providers production (`packages/providers/src/gemini/GeminiProvider.ts:958`), and many tests. The plan's classification-first preflight is necessary; blanket edits would be risky.
19. **Core package exports are currently narrow and will need explicit deep-module additions for agents.** `packages/core/package.json` exports only selected subpaths, including `./core/contentGenerator.js`, `./core/chatSession.js`, and `./core/prompts.js` (`packages/core/package.json:18-85`). Agents deep-imports into core will require export-map updates, as P02 notes.
20. **Release/sandbox providers precedent is real.** Root workspaces include providers at `package.json:13-15`; `scripts/build_sandbox.js` has provider pack/copy handling at `scripts/build_sandbox.js:97`, `:159-165`, and `:225-227`; `scripts/version.js:50` includes providers; release-process tests assert these relationships (`scripts/tests/release-process.test.js:166-193`, `:201-249`). Agents needs equivalent handling where applicable.

## Integration-first assessment

The plan is not an isolated package build if followed. It identifies specific existing consumers and access paths: CLI, a2a-server, Config construction, scheduler singleton, tool registry, provider tests, moved chatSession tests, release/bundle/sandbox flows, and smoke tests. It also identifies old code removal: moved implementation exports removed from `packages/core/src/index.ts`, no forwarding wrapper files, no core re-export of agents APIs, and no leftover moved implementations in core (`project-plans/issue1592/plan/00-overview.md:24-27`, `project-plans/issue1592/plan/03-code-move.md:27-45`, `project-plans/issue1592/plan/03-code-move.md:64-68`).

The atomic P03 design is the right no-shim strategy: the plan explicitly says moved implementations and consumer import flips land as one change set because intermediate typecheck failures are expected during the phase, and the phase is only complete when the workspace is green (`project-plans/issue1592/plan/03-code-move.md:9-14`). That satisfies `dev-docs/PLAN.md`'s integration-first intent for a behavior-preserving extraction.

The remaining integration gaps are not conceptual isolation, but missing wiring details: TypeScript alias/reference updates, Dockerfile/release-test updates, and complete dependency inventory coverage.

## Dependency-direction assessment

The intended dependency direction is sound:

- `agents -> core` for contracts/shared services, with deep imports only.
- `cli/a2a -> agents` for concrete runtime classes.
- `core -X-> agents` in production and tests.
- `agents -X-> providers/cli` in production and tests.
- `providers -X-> agents` in production and tests.

The plan has good hard scans for core importing agents, agents importing providers/cli, core tests importing moved modules, anti-shims, package dependency leakage, and core root-barrel imports from agents (`project-plans/issue1592/plan/00-overview.md:68-76`, `project-plans/issue1592/plan/03-code-move.md:56-68`, `project-plans/issue1592/plan/03a-code-move-verification.md:17-20`). The main improvement needed is making those scans generated and complete across dynamic imports, config files, package metadata, and tsconfig/vitest aliases.

## Phase-ordering and construction-inversion assessment

The phase ordering is executable after the revisions above:

- P01 introduces core-owned contracts and factories before moving concrete classes.
- P02 scaffolds the target package and release/build wiring without adding unused cli/a2a deps.
- P03 atomically moves code and flips consumers, preserving the no-shim invariant.
- P04 audits/hardens consumers and bundle behavior.
- P05 finalizes exports/docs/cleanup.

The construction-inversion design is feasible and behavior-preserving if implemented carefully:

- `AgentClientFactory` belongs in `ConfigParameters`/stored config state because `Config.initialize()` and `initializeContentGeneratorConfig()` construct clients (`packages/core/src/config/config.ts:196-198`, `packages/core/src/config/config.ts:306-315`).
- `ToolSchedulerFactory` can replace the dynamic import in `schedulerSingleton` while preserving the singleton maps/refcounts/callback merging (`packages/core/src/config/schedulerSingleton.ts:64-79`, `:201-263`, `:318-357`).
- `TaskToolRegistration` as a descriptor, not a bare factory, is the correct design because `ToolRecord` preserves both constructor/class-name and static display-name semantics (`packages/core/src/config/toolRegistryFactory.ts:101-105`, `:131-138`, `:251-258`; plan descriptor at `project-plans/issue1592/analysis/integration-contract.md:58-76`).

## Verification/TDD assessment

P01's TDD discipline is adequate for a refactor plan: it requires behavioral tests first, forbids `toHaveBeenCalled`-only mock theater, and demands real assertions for AgentClient factory return/history handoff, scheduler singleton behavior, and TaskTool metadata/gating (`project-plans/issue1592/plan/01-contracts-inversion.md:45-49`). P01a asks whether the tests would fail if the factory wiring were removed and scans for mock-theater-only tests (`project-plans/issue1592/plan/01a-contracts-inversion-verification.md:15-20`).

The broader plan's verification is strong: full battery, anti-shim scans, dependency scans, behavior-preservation audits, package dry-run, bundle checks, cycle checks, smoke test, release/sandbox wiring, and no test weakening (`project-plans/issue1592/specification.md:140-150`, `project-plans/issue1592/plan/03a-code-move-verification.md:10-25`, `project-plans/issue1592/plan/04a-consumer-migration-verification.md:11-13`, `project-plans/issue1592/plan/05-cleanup-final.md:18-32`). The missing release-test/Dockerfile and inventory-scan coverage should be fixed before execution.

## Required changes before approval

1. Add `Dockerfile` and `scripts/tests/release-process.test.js` to P02/P02a mandatory release/sandbox wiring and verification.
2. Add explicit CLI/a2a tsconfig, tsconfig.build, references/include, and vitest/package-resolution updates for `@vybestack/llxprt-code-agents`.
3. Replace grep-only import inventories with generated scans covering static imports, dynamic imports, export-from, require if present, package.json dependency sections, tsconfig/vitest aliases, and non-source package/config files.
4. Explicitly classify provider production `new Config(...)` at `packages/providers/src/gemini/GeminiProvider.ts:958` as non-initializing/no-agents-factory-required, or otherwise design a legal no-provider→agents path.
5. Fix the contradictory wording in the deviation rationale that says “agents should depend on providers.”

After those revisions, the plan should be approvable.
