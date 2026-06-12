# Plan Review Round 7 — Issue #1592 Extract `packages/agents`

Verdict: **REVISE**

The plan is substantially stronger than earlier rounds: it is integration-first, identifies concrete consumers and removals, rejects compatibility shims, includes package/release wiring, and now has a generated workspace dependency gate that allows direct `auth`/`settings` dependencies when proven by inventory. I verified the plan against the actual codebase with fresh reads/greps rather than relying on the analysis docs.

However, one behavior-preservation problem remains around the `TaskToolRegistration` seam and a2a/non-CLI composition roots, plus a few verification and planning gaps that should be corrected before execution.

## Findings

### MAJOR — TaskTool inversion can silently disable TaskTool outside CLI unless every Config-initializing composition root wires the registration

The plan repeatedly frames the TaskTool registration as CLI-owned while saying a2a should preserve its current missing-reason behavior:

- Spec says `TaskTool` inversion uses an injected descriptor and when absent behaves like the existing missing profile/subagent-manager path (`project-plans/issue1592/specification.md:94-97`).
- The integration contract says absence uses constants and `toolClass: undefined`, and asks for parity tests (`project-plans/issue1592/analysis/integration-contract.md:69-76`).
- P04 specifically says to verify “a2a does not wire profileManager/subagentManager” and the missing-reason path still produces today’s behavior (`project-plans/issue1592/plan/04-consumer-migration.md:19-20`).

That premise is not accurate for today’s code. `toolRegistryFactory` auto-creates a `ProfileManager` when absent and then auto-creates a `SubagentManager` when a profile manager exists (`packages/core/src/config/toolRegistryFactory.ts:207-226`). Therefore, the normal current path reaches `profileManager !== undefined && subagentManager !== undefined` and registers the concrete `TaskTool` (`packages/core/src/config/toolRegistryFactory.ts:247-250`). The “missing manager” disabled record path is only used when those managers remain absent (`packages/core/src/config/toolRegistryFactory.ts:250-260`), which is not the typical result after `resolveManagers()`.

If P01/P03 only wires `TaskToolRegistration` from CLI, then any non-CLI Config initialization that currently auto-registers `TaskTool` will instead produce a disabled/missing-wiring record. That is a behavior change, not a preservation of today’s missing-reason behavior. This is particularly relevant because a2a directly imports `AgentClient` from core today (`packages/a2a-server/src/agent/task.ts:9-20`) and constructs it (`packages/a2a-server/src/agent/task.ts:145-154`), and the spec identifies a2a Config construction as a composition-root integration point (`project-plans/issue1592/specification.md:108-110`).

Required revision:

1. Decide and state the architectural rule: every composition root that can initialize a Config/tool registry must pass `taskToolRegistration`, not only CLI; or explicitly prove a2a never builds a core tool registry where TaskTool is reachable.
2. Update P01/P03/P04 to include a2a TaskTool registration if needed.
3. Change the parity test requirement from “missing registration behaves like missing manager” to a precise matrix:
   - managers present + registration present: registered record identical to today;
   - managers present + registration missing: either impossible in production wiring and tested as a clear configuration error/disabled diagnostic, or documented as an intentional non-runtime fallback;
   - managers missing: missing-manager record preserved.

### MAJOR — P02 dependency inventory is too weak for the phase’s own “no transitive/workspace leakage” requirement

P02 requires deriving `packages/agents/package.json` dependencies from a generated inventory, but the command only matches static single-quoted `from` imports (`project-plans/issue1592/plan/02-package-scaffold.md:23-25`). Actual move-set tests and files include other import forms that matter for dependency declarations and boundary checks. For example, the move-set currently has a dynamic import of `@vybestack/llxprt-code-auth` in a test (`packages/core/src/core/StreamProcessor.unbucketed-auth-failover.test.ts:12`) and a static auth import (`packages/core/src/core/StreamProcessor.unbucketed-auth-failover.test.ts:21`), and moved tests also contain provider imports that must be rewritten (`packages/core/src/core/chatSession.issue1729.test.ts:8`, `packages/core/src/core/chatSession.runtime.test.ts:15`, `packages/core/src/core/chatSession.thinking-toolcalls.test.ts:46`).

P03a’s later gate is much better: it explicitly scans static imports, exports, dynamic imports, `require`, and `vi.mock`, plus package dependency sections and aliases (`project-plans/issue1592/plan/03a-code-move-verification.md:20-24`). But P02 still asks the implementer to populate dependencies from the weaker inventory before the move/rewrite phase. That can create either missing direct dependencies or unnecessary temporary dependencies that have to be corrected later.

Required revision: make P02’s dependency inventory use the same generated import-specifier extraction as P03a, or explicitly allow P02 to start with only scaffold/dev deps plus core and require final dependency reconciliation in P03 after import rewrites. Do not claim “every external lib/workspace package directly imported” has been derived in P02 from a command that misses dynamic imports, double quotes, `vi.mock`, and `export ... from`.

### MINOR — Full-battery command order is inconsistent with project memory and can leave formatting changes after the gate

The plan consistently defines the full battery as `npm run typecheck && npm run build && npm run test && npm run lint && npm run format && git diff --exit-code` followed by the smoke test (`project-plans/issue1592/plan/03-code-move.md:72-74`, `project-plans/issue1592/plan/04-consumer-migration.md:27-30`). Project memory says before checking in code changes, run `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and the smoke test. More importantly, running `format` after `lint`/`typecheck` can modify files after earlier checks, so the gate should either run format before lint/typecheck/build or run lint/typecheck/build again after format. The current `git diff --exit-code` catches uncommitted formatter changes, but it does not prove the formatted code passed the earlier commands.

Required revision: define one authoritative order that formats before semantic checks, or add a second post-format typecheck/lint/build pass. Apply it identically to all `a` verification phases and final review.

## Verified factual claims and dispositions

I verified the following plan claims against the current codebase:

1. **Integration-first requirement is satisfied overall.** The spec lists real existing consumers (`packages/cli/src/config/config.ts`, `packages/cli/src/gemini.tsx`, `autoPromptGenerator.ts`, `nonInteractiveCliSupport.ts`, zed integration, `useReactToolScheduler.ts`, a2a files, provider test relocation, core config inversion, and release/CI wiring) at `project-plans/issue1592/specification.md:101-111`. It also lists old code/removals at `project-plans/issue1592/specification.md:113-117`. P03 performs move plus consumer flips in one atomic phase because shims are forbidden (`project-plans/issue1592/plan/03-code-move.md:43-50`). This cannot be built as an isolated package without touching consumers.

2. **No backward-compatibility shim rule is explicit.** The spec forbids core re-exporting moved implementation APIs (`project-plans/issue1592/specification.md:27`, `project-plans/issue1592/specification.md:134-137`), and P03 scans for core imports/re-exports of agents (`project-plans/issue1592/plan/03-code-move.md:61-70`).

3. **`contentGenerator.ts` staying is justified.** Actual core consumers include `packages/core/src/config/config.ts:10`, `packages/core/src/config/configBaseCore.ts:15-18`, `packages/core/src/runtime/AgentRuntimeLoader.ts:30`, and `packages/core/src/code_assist/server.ts:29`; providers implement/consume the same contract in `packages/providers/src/ProviderContentGenerator.ts:10`. This supports the deviation in `project-plans/issue1592/specification.md:36`.

4. **`prompts.ts` staying is justified.** Provider production code imports `getCoreSystemPromptAsync` from core prompts in `packages/providers/src/gemini/GeminiProvider.ts:22`, `packages/providers/src/openai/OpenAIRequestPreparation.ts:23`, `packages/providers/src/anthropic/AnthropicRequestPreparation.ts:34`, `packages/providers/src/openai-responses/OpenAIResponsesProviderCore.ts:27`, and `packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:61`, matching the deviation in `project-plans/issue1592/specification.md:38`.

5. **`tokenLimits.ts` staying is justified.** `packages/core/src/runtime/createAgentRuntimeContext.ts:21` imports `tokenLimit` from `../core/tokenLimits.js`, matching the plan’s rationale at `project-plans/issue1592/specification.md:39`.

6. **`geminiRequest.ts` staying is justified.** `packages/core/src/tools/glob.test.ts:9` imports `partListUnionToString` from `../core/geminiRequest.js`, and core root currently exports it at `packages/core/src/index.ts:81`. The plan’s deviation is recorded at `project-plans/issue1592/specification.md:51` and move map §A.

7. **Provider test coupling to moved `ChatSession` exists and is correctly dispositioned.** `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:11` imports `ChatSession` from `@vybestack/llxprt-code-core/core/chatSession.js`; the plan requires relocation/no providers→agents dependency (`project-plans/issue1592/analysis/reverse-dependency-map.md:83-85`, `project-plans/issue1592/plan/03a-code-move-verification.md:15-16`).

8. **Moved chat-session tests currently import providers and need rewriting.** The move set has provider imports at `packages/core/src/core/chatSession.issue1729.test.ts:8`, `packages/core/src/core/chatSession.runtime.test.ts:15`, and `packages/core/src/core/chatSession.thinking-toolcalls.test.ts:46`. The move map’s instruction to replace these with structural fakes is necessary.

9. **Core currently has the exact class-level construction couplings the inversion targets.** `Config.initialize()` constructs `new AgentClient(this, this.runtimeState)` at `packages/core/src/config/config.ts:196-198`; `initializeContentGeneratorConfig()` constructs another at `packages/core/src/config/config.ts:306-315`; `schedulerSingleton` dynamically imports `../core/coreToolScheduler.js` at `packages/core/src/config/schedulerSingleton.ts:271-276`; `toolRegistryFactory` imports `TaskTool` at `packages/core/src/config/toolRegistryFactory.ts:38` and registers it at `packages/core/src/config/toolRegistryFactory.ts:247-250`. These support REQ-INV-001..003 (`project-plans/issue1592/specification.md:81-97`).

10. **Constructor-parameter factory design is feasible for `AgentClient`.** The Config constructor only calls `applyConfigParams` (`packages/core/src/config/config.ts:103-107`); the first `AgentClient` construction happens later in `initialize()` (`packages/core/src/config/config.ts:196-198`), and refresh construction happens in `initializeContentGeneratorConfig()` (`packages/core/src/config/config.ts:306-315`). That matches the integration contract’s lifecycle rationale (`project-plans/issue1592/analysis/integration-contract.md:82-85`).

11. **`TaskToolRegistration` descriptor needs class/static-name semantics.** `registerCoreTool` reads `ToolClass.name` and static `ToolClass.Name` (`packages/core/src/config/toolRegistryFactory.ts:101-105`), matches allow/exclude lists on both (`packages/core/src/config/toolRegistryFactory.ts:112-124`), and disabled records currently use `toolName: 'TaskTool'` with `displayName: TaskTool.Name || 'TaskTool'` (`packages/core/src/config/toolRegistryFactory.ts:251-255`). This supports the descriptor mapping in `project-plans/issue1592/analysis/integration-contract.md:52-79`.

12. **a2a direct construction is real.** `packages/a2a-server/src/agent/task.ts:9-20` imports `AgentClient` from core and constructs it at `packages/a2a-server/src/agent/task.ts:145-154`; this validates the plan’s a2a consumer migration requirement (`project-plans/issue1592/specification.md:108`, `project-plans/issue1592/analysis/reverse-dependency-map.md:80`).

13. **CLI/a2a TypeScript path updates are necessary.** Current CLI tsconfig maps core/providers/settings/auth/mcp but not agents (`packages/cli/tsconfig.json:11-22`) and includes provider/auth/mcp/settings source globs but not agents (`packages/cli/tsconfig.json:24-41`). a2a currently maps only core/mcp and references only core (`packages/a2a-server/tsconfig.json:9-15`, `packages/a2a-server/tsconfig.json:30`). P03’s explicit tsconfig tasks are therefore necessary (`project-plans/issue1592/plan/03-code-move.md:45-49`).

14. **Release/Docker/test wiring completeness is now covered.** The root workspace currently has no `packages/agents` entry (`package.json:8-19`). Existing release-process tests hard-code package order including providers but not agents (`scripts/tests/release-process.test.js:63-73`) and assert publish order through providers→CLI (`scripts/tests/release-process.test.js:109-139`) plus sandbox/Docker tarball handling (`scripts/tests/release-process.test.js:166-249`). P02 now requires updating release workflow, sandbox workflow, build_sandbox, version script, Dockerfile, and release-process tests (`project-plans/issue1592/plan/02-package-scaffold.md:32-41`).

15. **Workspace dependency direction is internally consistent after the latest revisions.** The spec allows agents to depend on core and auth/settings/telemetry/mcp as needed, while forbidding providers/CLI (`project-plans/issue1592/specification.md:129-133`). P03a now allows core plus auth/settings/telemetry/mcp when direct import inventory proves it, and hard-fails providers/root CLI (`project-plans/issue1592/plan/03a-code-move-verification.md:20-24`). Actual move-set imports prove at least settings (`packages/core/src/tools/task.ts:28`, `packages/core/src/core/subagentOrchestrator.ts:16`) and auth (`packages/core/src/core/StreamProcessor.ts:27`) are likely direct dependencies.

16. **Root barrel imports in the move set are real and P03 correctly calls them out.** Current move-set files import from `../index.js` in production (`packages/core/src/core/coreToolScheduler.ts:7`, `packages/core/src/core/nonInteractiveToolExecutor.ts:12`, `packages/core/src/scheduler/status-transitions.ts:28-30`) and many tests. P03 explicitly requires resolving these to core subpaths or agents-internal imports and forbids agents importing the core root barrel (`project-plans/issue1592/plan/03-code-move.md:27-31`, `project-plans/issue1592/plan/03-code-move.md:66-67`).

17. **Core test/import audit is appropriately broad.** Actual core tests and production files reference moved modules in many places, including `packages/core/src/config/config.test.ts:29` and `:90`, `packages/core/src/lsp/__tests__/system-integration.test.ts:81`, `packages/core/src/lsp/__tests__/e2e-lsp.test.ts:82`, `packages/core/src/hooks/hooks-caller-application.test.ts:34-35`, `packages/core/src/tools/write-file.test.ts:25` and `:34`, and `packages/core/src/telemetry/uiTelemetry.test.ts:21`. P03’s mechanical audit list and disposition table requirement matches this blast radius (`project-plans/issue1592/plan/03-code-move.md:38-42`).

18. **P03 atomic strategy is executable in principle.** Since moved core exports exist today (`packages/core/src/index.ts:73-85`, `packages/core/src/index.ts:461`) and no shims are allowed, intermediate typecheck failures are unavoidable. P03 correctly treats the move plus import flips as one change set and only ends the phase after the full workspace is green (`project-plans/issue1592/plan/03-code-move.md:9-14`, `project-plans/issue1592/plan/03-code-move.md:43-51`).

## PLAN.md compliance assessment

- **Integration-first:** Pass. Specific existing consumers and removed/replaced code are listed (`project-plans/issue1592/specification.md:101-117`), and P03/P04 require import flips/audits rather than isolated package construction.
- **Preflight/factual analysis:** Mostly pass. The plan includes reverse dependency, integration contract, move map, and verification phases. The remaining weakness is P02’s weaker dependency inventory command.
- **TDD discipline:** Mostly pass. P01 requires behavioral seam tests first and explicitly forbids call-count-only mock theater (`project-plans/issue1592/plan/01-contracts-inversion.md:46-54`). The TaskTool parity matrix needs the correction described above.
- **No isolated features / modify existing system:** Pass. P03 deletes/moves old core implementations and updates consumers in the same phase (`project-plans/issue1592/plan/03-code-move.md:43-50`).
- **Aggressive verification:** Mostly pass. The plan has anti-shim scans, dependency scans, provider-test migration verification, package pack checks, release-process tests, bundle checks, and final semantic review. Fix the full-battery ordering and P02 inventory gap.

## Required revisions before approval

1. Fix TaskTool registration wiring semantics for non-CLI Config initializers/a2a, and update the parity tests accordingly.
2. Strengthen P02 dependency inventory or defer dependency completeness claims until P03’s generated import inventory after import rewrites.
3. Normalize the full-battery order so formatted code is what gets linted/typechecked/built, or add post-format semantic checks.

Final verdict: **REVISE**
