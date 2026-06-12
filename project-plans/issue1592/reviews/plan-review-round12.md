# Plan Review Round 12 — issue #1592 Extract packages/agents

Verdict: **APPROVE**

I reviewed the requested plan files under `project-plans/issue1592/` and ignored prior reviews. I also checked `dev-docs/PLAN.md` and verified factual claims against the current working tree with fresh reads/greps.

## Findings

No BLOCKER or MAJOR findings.

### MINOR 1 — Execution tracker understates where the smoke test must run

The authoritative battery in the overview correctly requires the smoke test for every code-changing phase and every verification phase: `plan/00-overview.md:60-73` defines “full battery” and includes `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"` at line 73. P01/P02/P03/P04 all include the same smoke command in their local gates (`plan/01-contracts-inversion.md:77-78`, `plan/02-package-scaffold.md:54-55`, `plan/03-code-move.md:79-80`, `plan/04-consumer-migration.md:35-36`), and P03a/P04a/P05/P05a refer back to the full battery (`plan/03a-code-move-verification.md:9`, `plan/04a-consumer-migration-verification.md:9`, `plan/05-cleanup-final.md:27-32`, `plan/05a-final-review.md:14`).

However, `execution-tracker.md:21-23` says “Full battery green at P01a, P03a, P04a, P05a” and “Smoke test ... green at P01a, P04a, P05”, omitting P02/P02a/P03/P03a/P05a despite the authoritative battery requiring them. This is only a tracking/documentation inconsistency because phase docs are stricter, but it could mislead a coordinator using the tracker as a checklist.

**Recommendation:** update `execution-tracker.md:21-23` to say the full battery/smoke follows `plan/00-overview.md` for every code-changing phase and every verification phase.

## Verified claims and assessment

### PLAN.md compliance / integration-first

`dev-docs/PLAN.md:11-21` requires TDD, preflight, no isolated features, integration-first testing, and semantic verification. The plan explicitly acknowledges that this is an existing-code extraction, not a new isolated feature, and scopes TDD to the new inversion seams (`plan/00-overview.md:10`). It also makes P03 an atomic move plus consumer migration, not an isolated package build (`plan/00-overview.md:42-45`, `plan/03-code-move.md:13`, `plan/03-code-move.md:44`).

The plan identifies specific consumers and integration points:

- Core construction seams: `Config` currently imports and constructs `AgentClient` at `packages/core/src/config/config.ts:17` and `packages/core/src/config/config.ts:196-198`, and constructs the replacement client at `packages/core/src/config/config.ts:314-315`.
- Scheduler seam: `schedulerSingleton` currently imports scheduler types from `../core/coreToolScheduler.js` at `packages/core/src/config/schedulerSingleton.ts:13-17` and dynamically imports the concrete scheduler at `packages/core/src/config/schedulerSingleton.ts:271-287`.
- TaskTool seam: `toolRegistryFactory` imports `TaskTool` at `packages/core/src/config/toolRegistryFactory.ts:38`, registers it at `packages/core/src/config/toolRegistryFactory.ts:247-250`, and force-includes both identifiers in coreTools at `packages/core/src/config/toolRegistryFactory.ts:308-309`.
- a2a composition root: `packages/a2a-server/src/config/config.ts:43-45` constructs and initializes `Config`; initialization calls `Config.initialize` at `packages/a2a-server/src/config/config.ts:135-145`. a2a also directly constructs `AgentClient` at `packages/a2a-server/src/agent/task.ts:154`.
- CLI consumer: `packages/cli/src/ui/utils/autoPromptGenerator.ts:9-27` imports and constructs `AgentClient`.
- Provider test coupling: `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:11` imports `ChatSession` from core.

Old-code removal is also identified: P03 removes moved files/exports and deletes the stage-1 TaskTool default (`plan/03-code-move.md:61-65`, `plan/03-code-move.md:75-76`), while the spec forbids core re-export shims (`specification.md:27`, `specification.md:121-123`). Because P03 cannot finish green without moving code, deleting old core implementations, and updating CLI/a2a imports, this plan cannot be built in isolation if followed.

### Factual spot checks against the real codebase

I verified more than 10 high-risk factual claims:

1. `Config` constructor only applies params: `packages/core/src/config/config.ts:103-107`.
2. `Config.initialize()` constructs `AgentClient` after tool registry/subagent setup: `packages/core/src/config/config.ts:162-198`.
3. `initializeContentGeneratorConfig()` constructs a replacement `AgentClient` and transfers history before initialization: `packages/core/src/config/config.ts:310-325`.
4. `ConfigBaseCore` currently types `agentClient` and `getAgentClient()` as concrete `AgentClient`: `packages/core/src/config/configBaseCore.ts:19`, `packages/core/src/config/configBaseCore.ts:126`, `packages/core/src/config/configBaseCore.ts:501-503`.
5. `ConfigParameters` currently has no factory fields: `packages/core/src/config/configTypes.ts:344-457` has many params but no `agentClientFactory`, `toolSchedulerFactory`, or `taskToolRegistration`; a grep for those names in `packages/core/src` found no existing hits.
6. `schedulerSingleton` currently uses a dynamic import of `../core/coreToolScheduler.js`: `packages/core/src/config/schedulerSingleton.ts:271-287`.
7. `toolRegistryFactory` uses `ToolClass.name` as `ToolRecord.toolName` and static `Name` as `displayName`: `packages/core/src/config/toolRegistryFactory.ts:101-105` and `packages/core/src/config/toolRegistryFactory.ts:131-138`; the plan’s descriptor semantics match this.
8. `resolveManagers()` auto-creates both managers when absent: `packages/core/src/config/toolRegistryFactory.ts:207-226`; therefore a2a omission of TaskTool registration after P03 would be a behavior regression, as the plan says.
9. Core package exports do not expose `tools/task.js`: `packages/core/package.json:13-85` lists exports and includes no `./tools/task.js`; a grep confirmed no such export. This supports the two-stage TaskTool rollout.
10. Core package exports currently expose `./core/chatSession.js`: `packages/core/package.json:25-27`, which explains the provider test coupling and the need to remove/retarget it after the move.
11. `geminiRequest` staying is supported: current exports include `packages/core/src/index.ts:81`, and the only grep hits I found were `packages/core/src/tools/glob.test.ts:9` and the root export; no move-set consumer appeared.
12. `buildContinuationDirective` staying is supported: it is exported from core at `packages/core/src/index.ts:85`, implemented in `packages/core/src/core/compression/utils.ts:194`, used by moved strategies at `packages/core/src/core/compression/MiddleOutStrategy.ts:42` and `packages/core/src/core/compression/OneShotStrategy.ts:41`, and used externally by CLI integration tests at `packages/cli/src/integration-tests/compression-todo.integration.test.ts:31` and `:226-310`.
13. `coreToolHookTriggers` staying is supported: moved scheduler/client code imports it (`packages/core/src/core/coreToolScheduler.ts:33`, `packages/core/src/scheduler/tool-executor.ts:24`), but a staying core hook test also imports it (`packages/core/src/hooks/notification-hook.test.ts:20`).
14. `lifecycleHookTriggers` staying is supported: moved chat/hook manager code imports it (`packages/core/src/core/chatSession.ts:29`, `packages/core/src/core/AgentHookManager.ts:11`), and `hooks/index.ts` re-exports it from core (`packages/core/src/hooks/index.ts:50`).
15. The plan’s Config-construction-site scale is accurate: `grep -rn "new Config(" packages --include='*.ts' | wc -l` returned 251, matching the plan’s “~251 occurrences” claim (`plan/00a-preflight-verification.md:24`).
16. The provider dependency deviation for `prompts`/`contentGenerator` is justified: provider production files import core prompts/content generator (`packages/providers/src/gemini/GeminiProvider.ts:22`, `packages/providers/src/openai/OpenAIRequestPreparation.ts:23`, `packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:61`, `packages/providers/src/openai-responses/OpenAIResponsesProviderCore.ts:27`, `packages/providers/src/ProviderContentGenerator.ts:10`).

I also hunted for missed core/test consumers of moved module paths. A multi-form grep over core/cli/a2a/providers found the expected core test blast radius and provider test hit: e.g. `packages/core/src/tools/edit.test.ts:17`, `packages/core/src/tools/write-file.test.ts:25/34`, `packages/core/src/config/config-lsp-integration.test.ts:96`, `packages/core/src/config/config.test.ts:29/90`, `packages/core/src/lsp/__tests__/e2e-lsp.test.ts:82`, `packages/core/src/lsp/__tests__/system-integration.test.ts:81`, `packages/core/src/hooks/hooks-caller-application.test.ts:34-35`, `packages/core/src/telemetry/uiTelemetry.test.ts:21`, `packages/core/src/telemetry/loggers.test.circular.ts:15`, and `packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:11`. These are either explicitly named in P03’s audit list (`plan/03-code-move.md:40-44`) or covered by P03/P04’s generated test-surface inventories (`plan/03a-code-move-verification.md:18-22`, `plan/04-consumer-migration.md:20-24`). I did not find an unplanned production coupling that invalidates the plan.

### Deviations from the issue’s literal file list

The deviations are justified and consistent with the code:

- `contentGenerator.ts` stays because core runtime/config and providers consume it (`specification.md:36`; evidence above from `packages/providers/src/ProviderContentGenerator.ts:10` and `packages/core/src/config/config.ts:10`).
- `prompts.ts` stays because providers import it (`specification.md:38`; evidence above).
- `tokenLimits.ts` stays because `runtime/createAgentRuntimeContext.ts` consumes it (`specification.md:39`; I verified the reverse-dep map names this at `analysis/reverse-dependency-map.md:23`).
- `logger.ts` stays as session/checkpoint logger (`specification.md:40`, `analysis/move-map.md:32`); it imports `@google/genai` and `Storage` but not chat-loop machinery (`packages/core/src/core/logger.ts:9-12`).
- `geminiRequest.ts` stays because its observed consumers are staying (`analysis/move-map.md:30`; evidence above).
- `coreToolHookTriggers.ts`, `lifecycleHookTriggers.ts`, `subagentTypes.ts`, `scheduler/types.ts`, and `compression/types.ts` stay as shared contracts/glue; their consumers include staying core files/tests (examples above plus `packages/core/src/services/asyncTaskManager.ts:14` for `subagentTypes` and `packages/core/src/services/history/HistoryService.ts` importing compression types per `analysis/reverse-dependency-map.md:20`).

These deviations avoid forbidden `core -> agents`, `providers -> agents`, or `agents -> providers` edges.

### Dependency direction and package boundaries

The intended direction is internally consistent across the spec and verification gates:

- Spec forbids core depending on agents and forbids providers/agents cross-dependencies (`specification.md:16-24`, `specification.md:136-139`, `specification.md:150`).
- P03/P03a/P04a/P05a require scans covering source/tests/package.json sections and import forms (`plan/00-overview.md:75-87`, `plan/03a-code-move-verification.md:24-29`, `plan/04a-consumer-migration-verification.md:11`, `plan/05-cleanup-final.md:32`, `plan/05a-final-review.md:14`).
- P03 explicitly rewrites provider-coupled moved tests to structural fakes and forbids a providers dependency in agents (`plan/03-code-move.md:32-33`, `analysis/move-map.md:118-123`).

The moved-set import inventory shows agents will legitimately need `core`, `settings`, `auth`, and external libraries such as `@google/genai`, `undici`, `diff`, `fast-levenshtein`, `zod`, and `zod-to-json-schema` (`packages/core/src/core/StreamProcessor.ts:27`, `packages/core/src/core/subagentOrchestrator.ts:16`, `packages/core/src/core/client.ts:37`, `packages/core/src/scheduler/tool-dispatcher.ts:25`, `packages/core/src/scheduler/confirmation-coordinator.ts:18`, `packages/core/src/agents/executor.ts:83-84`). P02/P03 require deriving the actual dependency table instead of relying on transitive leakage (`plan/02-package-scaffold.md:28`, `plan/03-code-move.md:50-55`, `plan/03a-code-move-verification.md:24-29`). That is sound.

### Phase ordering and construction inversion feasibility

The ordering is executable:

- P00a preflight is a hard prerequisite for P01 (`plan/01-contracts-inversion.md:9-10`).
- P01 adds contracts/inversion while classes still live in core, so imports remain legal (`plan/01-contracts-inversion.md:54-62`).
- The TaskTool two-stage rollout is necessary and feasible because `TaskTool` has no package export today (verified via `packages/core/package.json:13-85`), while the current behavior is preserved by a core-local default until P03 (`plan/01-contracts-inversion.md:40`, `specification.md:95-98`).
- P02 creates only an empty package scaffold and forbids consumer imports until P03 (`plan/02-package-scaffold.md:32-35`, `plan/02-package-scaffold.md:63-64`), so it can end green.
- P03 atomically moves code, deletes the core-local TaskTool default, updates imports and package dependencies, and must end green (`plan/03-code-move.md:13`, `plan/03-code-move.md:44-55`).

The construction-inversion design is behavior-preserving given the actual code. Constructor-param factories are reasonable because `Config` construction only delegates to `applyConfigParams` (`packages/core/src/config/config.ts:103-107`), and the real use sites are later (`packages/core/src/config/config.ts:196-198`, `packages/core/src/config/config.ts:314-315`, `packages/core/src/config/schedulerSingleton.ts:318-357`). Use-time absence errors are required because there are many non-initializing `Config` tests and provider helper constructions; e.g. provider code constructs a minimal `Config` at `packages/providers/src/gemini/GeminiProvider.ts:958` and the plan explicitly classifies it as non-initializing (`plan/00a-preflight-verification.md:25`).

### Verification rigor

The plan has a single authoritative full battery (`plan/00-overview.md:60-73`) and repeats/references it in all phase gates. It also adds:

- anti-shim scans (`plan/00-overview.md:89-92`, `plan/03-code-move.md:75-76`),
- dependency/leakage scans across import forms and package dependency sections (`plan/03a-code-move-verification.md:18-29`),
- provider-test migration checks (`plan/03a-code-move-verification.md:16`),
- behavior-preservation audits including TaskTool matrix parity (`plan/01-contracts-inversion.md:47-52`, `plan/03a-code-move-verification.md:29`),
- package dry-run checks (`plan/02-package-scaffold.md:29`, `plan/03a-code-move-verification.md:23`),
- release/sandbox/Docker/release-test wiring (`plan/02-package-scaffold.md:36-46`),
- bundle checks (`plan/04-consumer-migration.md:26`, `plan/04a-consumer-migration-verification.md:12`), and
- final cycle check with madge (`plan/05-cleanup-final.md:28`).

The only rigor nit is the execution tracker inconsistency noted above.

### TDD discipline in P01

P01 is appropriately TDD-first for the new production seams: it requires behavioral tests before implementation (`plan/01-contracts-inversion.md:47-52`) and P01a requires semantic review that the tests would fail if factory wiring were dropped (`plan/01a-contracts-inversion-verification.md:15-26`). This is consistent with `dev-docs/PLAN.md:11-21` while recognizing the extraction mostly moves already-tested code (`plan/00-overview.md:10`).

## Verdict

**APPROVE** — the plan is integration-first, factually grounded, dependency-direction safe, executable phase-by-phase, and sufficiently rigorous. Fixing the minor execution-tracker wording would reduce coordinator confusion, but it is not a blocker because the authoritative phase docs already require the stricter battery.
