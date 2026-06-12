# Plan Review Round 10: Issue #1592 Extract packages/agents

## Verdict: REVISE

The plan is substantially integration-first and generally well grounded: it names concrete consumers, old-code removals, inversion seams, CI/release wiring, anti-shim scans, and an atomic move strategy. I verified the plan against the actual working tree with fresh file reads and greps rather than relying on the analysis documents.

I still found blockers/majors that should be fixed before execution. Most importantly, the package scaffold uses the wrong entry-point layout for this monorepo, the authoritative full-battery gate is not executable as written for uncommitted phase work, and the CI/release wiring checklist misses at least one providers-related boundary script that should be consciously updated or explicitly waived.

## Findings

### BLOCKER 1 — P02/P03 use `packages/agents/src/index.ts`, but existing workspace packages build from root `index.ts`

P02 says to create `packages/agents/src/index.ts` as the placeholder, and P03 says `agents/src/index.ts` exports the public API. That does not match the package/build precedent in this repository and will likely produce a package whose declared `main`/`types` do not exist or whose root import does not resolve the intended API.

Evidence:

- The plan explicitly instructs `packages/agents/src/index.ts` in `project-plans/issue1592/plan/02-package-scaffold.md` and repeats `agents/src/index.ts` in `project-plans/issue1592/plan/03-code-move.md`.
- Existing workspaces use root package entry points. I verified with `find packages -maxdepth 2 -name index.ts`, which returns root entries such as `packages/core/index.ts`, `packages/providers/index.ts`, `packages/cli/index.ts`, `packages/auth/index.ts`, `packages/settings/index.ts`, `packages/mcp/index.ts`, `packages/telemetry/index.ts`, `packages/test-utils/index.ts`, and no `packages/*/src/index.ts` package entry.
- `packages/providers/package.json:11-17` declares root output `dist/index.js` / `dist/index.d.ts` for the package root export, while subpaths point into `dist/src/...` at `packages/providers/package.json:18-35`.
- `packages/providers/tsconfig.json:22-31` includes both `index.ts` and `src/**/*.ts`, confirming the root `index.ts` is the package entry source.
- `scripts/build_package.js:37-44` simply runs TypeScript build then copies markdown/json; it does not synthesize a root `dist/index.js` from `src/index.ts`.

Required revision: P02/P03 should scaffold and maintain `packages/agents/index.ts` as the package root entry, with `src/**` for implementation files, mirroring providers. If the plan intentionally wants `src/index.ts`, it must also change package metadata, tsconfig, and exports consistently, but that would deviate from sibling convention without benefit.

### BLOCKER 2 — The full-battery definition cannot pass during normal uncommitted code-changing phases because it runs `git diff --exit-code` immediately after `npm run format`

The overview defines the authoritative full battery as `npm run format` followed by `git diff --exit-code`, and says every code-changing phase must end with that full battery. In a phase that has made deliberate source changes but has not yet committed them, `git diff --exit-code` fails even when formatting is correct. This makes P01/P02/P03/P04/P05 completion impossible unless workers commit before running verification, which the phase docs do not require and which conflicts with using a dirty working tree as the phase's deliverable for review.

Evidence:

- `project-plans/issue1592/plan/00-overview.md` says every code-changing phase ends with the full battery and defines it as `npm run format` then `git diff --exit-code` before typecheck/build/test/lint/smoke.
- P01, P02, P03, P04, and P05 verification sections all refer to that authoritative full battery.
- The repository is a git repo, and any intentional edits to package files or moved source files would be visible to `git diff --exit-code` until committed.

Required revision: replace this with an executable formatting gate. For example: run `npm run format`, then fail only if formatting introduced additional changes beyond the worker's intended diff by requiring workers to review/stage/record format diffs, or use a format-check command if the repo has one. If phases require local commits before gates, state that explicitly and consistently.

### MAJOR 1 — Release/CI wiring misses an existing providers-related boundary script: `scripts/check-settings-boundary.js`

P02 has a good providers-precedent checklist, but my grep found an additional script with hard-coded providers package references that the plan does not mention. Because this extraction creates a new workspace package with explicit forbidden dependency directions, the plan should either update that boundary script to account for agents or explicitly document why it is out of scope.

Evidence:

- Fresh grep for providers wiring found `scripts/check-settings-boundary.js` references to `@vybestack/llxprt-code-providers` and `packages/providers/src` at lines `26`, `174`, `194`, `297`, `478`, `508`, and `757`.
- The same grep confirmed the plan-covered providers touchpoints exist: root workspace at `package.json:14`; release publish/pack handling in `.github/workflows/release.yml:344-377`; sandbox pack in `.github/workflows/build-sandbox.yml:65`; release tests in `scripts/tests/release-process.test.js:70`, `126`, `168`, `171`, `191`, `221`, `247`, `268-311`; version list at `scripts/version.js:50`; sandbox build at `scripts/build_sandbox.js:97`, `159-165`, `225-227`; Dockerfile package copy/install at `Dockerfile:58` and `Dockerfile:70`.
- P02 mentions release.yml, build-sandbox.yml, prepare-package.js, build_sandbox.js, version.js, Dockerfile, release-process.test.js, esbuild, and npm/publish configs, but not `scripts/check-settings-boundary.js`.

Required revision: add a P02/P04 task to inspect and update `scripts/check-settings-boundary.js` for the new agents package if its rules should cover workspace boundaries, or add a documented waiver explaining why agents is not part of that settings-boundary check.

### MAJOR 2 — P02 package dependency inventory is under-specified for dependencies that exist only after P03 rewrites, so P02 cannot truly complete dependency correctness

P02 says `packages/agents/package.json` dependencies must be derived from a generated import inventory, but at P02 the target package contains only a placeholder and the actual moved imports do not exist yet. The plan partially acknowledges final reconciliation in P03, but P02 still requires a package.json dependency table with exact dependencies. This is ambiguous and likely to produce either guessed dependencies in P02 or churn in P03.

Evidence:

- `project-plans/issue1592/plan/02-package-scaffold.md` requires deriving `packages/agents/package.json` dependencies from a generated inventory over the move set, then says final dependency reconciliation happens in P03 after rewrites.
- The actual move set includes direct imports that will become package dependencies, verified by grep: `packages/core/src/core/subagentOrchestrator.ts:16` and `:44` import `@vybestack/llxprt-code-settings`; `packages/core/src/core/StreamProcessor.unbucketed-auth-failover.test.ts:12` dynamically imports `@vybestack/llxprt-code-auth`; `packages/core/src/tools/task.ts:28` imports `ProfileManager` from `@vybestack/llxprt-code-settings`.
- The same grep found provider imports in moved tests only: `packages/core/src/core/chatSession.issue1729.test.ts:8`, `chatSession.runtime.test.ts:15`, and `chatSession.thinking-toolcalls.test.ts:46`, which the plan correctly says must be rewritten to structural fakes before final dependency reconciliation.
- Because those rewrites happen in P03, P02 cannot know the final dependency set solely from the post-rewrite inventory.

Required revision: make P02 scaffold dependencies minimal and explicit (for example core plus dev tooling only), and make P03 the authoritative dependency reconciliation gate after import rewrites. Alternatively, require P00a to generate a provisional dependency table and P03 to replace it with final truth.

### MAJOR 3 — Some plan docs disagree on workspace order for `packages/agents`

This is not a code failure by itself, but it is exactly the sort of contradiction that causes autonomous workers to make inconsistent package.json edits.

Evidence:

- `specification.md:130` says root workspaces should include `packages/agents` ordered after `packages/core` and before `packages/cli`.
- `move-map.md:132` says add `packages/agents` between core/providers and cli, i.e. after providers and before cli.
- `00-overview.md` phase summary says workspaces entry after core/providers and before cli.
- Current root workspace order is auth, settings, telemetry, mcp, core, providers, cli, a2a-server, test-utils, vscode, lsp at `package.json:8-19`.

Required revision: choose one order and update all docs. Given providers already exists at `package.json:14`, “after providers, before cli” is the least disruptive and matches several plan docs.

### MAJOR 4 — P01 TaskTool descriptor must preserve `registerCoreTool` semantics exactly; the plan is mostly right, but the missing-registration fallback is a deliberate behavior change that must be tightly tested

The construction-inversion design is feasible, but the TaskTool seam is risky. Today TaskTool registration uses the concrete class for both normal registration and missing-manager allPotentialTools metadata. After inversion, the “managers present + registration absent” branch is new behavior. The plan treats it as a configuration-error diagnostic, which is acceptable only if tests assert production composition roots always wire it.

Evidence:

- `packages/core/src/config/toolRegistryFactory.ts:38` imports `TaskTool` directly today.
- `buildRegisterCoreTool` derives `className = ToolClass.name`, `rawName = ToolClass.Name`, `toolName = rawName || className`, and stores `toolName: className`, `displayName: toolName`, `toolClass: ToolClass`, `args` at `toolRegistryFactory.ts:101-149`.
- `resolveManagers` auto-creates `ProfileManager` and `SubagentManager` when absent at `toolRegistryFactory.ts:207-226`, so the registered TaskTool path is normally reachable.
- Normal TaskTool registration is at `toolRegistryFactory.ts:247-250`; the missing-manager disabled record currently still uses `toolClass: TaskTool` and `displayName: TaskTool.Name || 'TaskTool'` at `toolRegistryFactory.ts:251-259`.
- `ensureCoreToolIncluded` force-includes both `TaskTool` and `TaskTool.Name` at `toolRegistryFactory.ts:308-309`.
- A2A really initializes Config: `packages/a2a-server/src/config/config.ts:43-44` constructs `Config` then calls `initializeConfig`, and `initializeConfig` calls `config.initialize({ messageBus })` at `config.ts:135-145`.

Assessment: The plan's descriptor shape and a2a wiring requirement are correct and behavior-preserving if implemented exactly. But any simplification to a bare factory, or treating absent registration as equivalent to missing managers, would be wrong. Keep the current mandatory ToolRecord parity matrix and add explicit a2a registered-TaskTool evidence in P01/P03 completion notes.

### MAJOR 5 — P03 atomic move is executable in principle, but the plan underestimates test blast radius in narrative sections

The detailed P03 task 9 asks for a complete generated audit table, which is good. But the narrative examples list only a subset, while a fresh grep shows a very large core test surface referencing moved classes/symbols. If workers rely on examples rather than the generated command, they will miss tests.

Evidence:

- Fresh generated grep for `AgentClient|ChatSession|CoreToolScheduler|SubAgentScope|SubagentOrchestrator|TaskTool|vi.mock moved paths` across core tests returned many files, including but not limited to `packages/core/src/config/config.test.ts`, `config.scheduler.test.ts`, `config-lsp-integration.test.ts`, `tools/edit.test.ts`, `tools/write-file.test.ts`, `utils/checkpointUtils.test.ts`, `utils/summarizer.test.ts`, `hooks/hooks-caller-application.test.ts`, `telemetry/loggers.test.ts`, and many co-located core/chat/session/scheduler/subagent tests.
- The plan does include the right generated audit command in `plan/03-code-move.md`, but the move-map narrative at `move-map.md:122-127` lists only selected stayer tests.
- CLI/a2a tests also have a large moved-symbol surface. For example, `packages/cli/src/ui/hooks/useTodoContinuation.spec.ts:22-34` imports/mocks AgentClient, and many `useGeminiStream` tests use a mocked AgentClient class; `packages/cli/src/ui/utils/autoPromptGenerator.ts:19-27` constructs a concrete AgentClient.

Required revision: emphasize that the generated audit table is binding and examples are non-exhaustive. Add `telemetry/loggers.test.ts` to the known examples (the reverse map mentions only `loggers.test.circular.ts`, while actual grep found concrete construction in `telemetry/loggers.test.ts:434`).

### MINOR 1 — Several factual claims I checked are accurate and should remain

These were independently verified and support the plan's architecture:

- `Config` constructor only applies params: `packages/core/src/config/config.ts:103-107`.
- `Config.initialize()` constructs `AgentClient` at `packages/core/src/config/config.ts:196-198`.
- `initializeContentGeneratorConfig()` constructs a replacement `AgentClient`, transfers history, initializes it, and disposes the previous client at `packages/core/src/config/config.ts:306-341`.
- `ConfigBaseCore` stores `agentClient` and imports its concrete type today at `packages/core/src/config/configBaseCore.ts:19` and `:126`, so a contract retarget is needed.
- `schedulerSingleton` imports scheduler types from `../core/coreToolScheduler.js` at `packages/core/src/config/schedulerSingleton.ts:13-17` and dynamically imports the class at `:273-275`, so factory inversion is needed.
- `a2a-server/src/agent/task.ts` imports `AgentClient` from core at `:9-20`, has an `agentClient: AgentClient` field at `:108`, and constructs it at `:154`; the plan correctly identifies this as a consumer import flip to agents.
- Providers have a ChatSession test coupling: `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:11` imports `ChatSession` from core. The plan correctly forbids providers depending on agents and relocates/reworks this test.
- The `buildContinuationDirective` staying-core deviation is justified: implementation is in `packages/core/src/core/compression/utils.ts:194`, used by moved strategies at `MiddleOutStrategy.ts:42` and `OneShotStrategy.ts:41`, by its co-located tests, and by CLI integration test at `packages/cli/src/integration-tests/compression-todo.integration.test.ts:31` and `:226-310`.
- The `geminiRequest.ts` staying-core deviation is justified by current consumers found: `packages/core/src/tools/glob.test.ts:9` imports `partListUnionToString`, and `packages/core/src/index.ts:81` exports it. I did not find move-set production consumers.
- Provider imports inside moved chatSession tests are exactly the three the plan names: `chatSession.issue1729.test.ts:8`, `chatSession.runtime.test.ts:15`, and `chatSession.thinking-toolcalls.test.ts:46`.

### MINOR 2 — The smoke-test instruction conflicts with broader saved memory, but the plan follows the project-local file

The overview uses `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`. Project-local memory says to use synthetic, while a broader memory says ollamaglm51. Because the user specifically asked to evaluate the plan in this repo and the project-local `.llxprt/LLXPRT.md` is more specific, I do not classify this as a plan defect. It is worth keeping the explicit note in `00-overview.md` so workers do not “fix” it inconsistently.

## Integration-first assessment

Pass with revisions. The plan identifies specific existing consumers (`packages/cli/src/config/config.ts`, `packages/cli/src/ui/utils/autoPromptGenerator.ts`, `packages/cli/src/nonInteractiveCliSupport.ts`, `packages/cli/src/zed-integration/zedIntegration.ts`, `packages/a2a-server/src/config/config.ts`, `packages/a2a-server/src/agent/task.ts`, provider test relocation), old code removal (`packages/core/src/core/*`, `packages/core/src/agents/*`, moved exports in `packages/core/src/index.ts`), and user access points (interactive CLI, non-interactive prompt mode, zed integration, task tool/subagents, compression, checkpointing, a2a). Because P03 atomically moves code and flips consumers with no shims, this cannot be built as a useful isolated package.

## Dependency-direction assessment

The desired direction is sound: core must not depend on agents, agents must not depend on providers or cli, agents may depend on core and proven supporting packages. The scans in P03a are appropriately broad in intent (static import/export, dynamic import, require, vi.mock, package.json sections, tsconfig/vitest/esbuild aliases). Revise P02/P03 as above so dependency correctness is finally asserted after import rewrites, not guessed before them.

## TDD / verification assessment

P01 is appropriately TDD-first for the new seam code and avoids reverse testing in its stated requirements. For the large behavior-preserving move, using existing behavioral tests plus strict behavior-preservation audits is reasonable. Fix the non-executable full-battery `git diff --exit-code` gate, and keep the ToolRecord parity tests and behavior-regression checklist mandatory.

## Required revisions summary

1. Change agents package entry to root `packages/agents/index.ts` (or fully redesign metadata/tsconfig if using `src/index.ts`, not recommended).
2. Replace or clarify the full-battery formatting/diff gate so it can pass with intentional uncommitted phase changes.
3. Add `scripts/check-settings-boundary.js` to the CI/release/boundary audit, or explicitly waive it with evidence.
4. Clarify P02 vs P03 dependency reconciliation: P02 scaffolds minimal/provisional deps; P03 owns final import-inventory reconciliation after rewrites.
5. Unify workspace order language across spec/move-map/overview.
6. Mark generated test/consumer audits as binding and examples as non-exhaustive; add `telemetry/loggers.test.ts` to known stayer-test blast-radius examples.

Final verdict: REVISE.
