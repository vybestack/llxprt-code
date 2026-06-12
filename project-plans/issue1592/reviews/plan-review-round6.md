# Plan Review Round 6 — Issue #1592 Extract packages/agents

Verdict: **REVISE**

I reviewed the specified plan documents and checked their factual claims against the current working tree. I ignored prior review files under `project-plans/issue1592/reviews/`.

## Findings

### MAJOR — Stayer test dependency on `core/geminiRequest.ts` is missed, so P03 can break core tests after moving `geminiRequest.ts`

The move map moves `core/geminiRequest.ts` to agents (`project-plans/issue1592/analysis/move-map.md:30`). The preflight task for `geminiRequest` explicitly greps only non-test consumers (`project-plans/issue1592/plan/00a-preflight-verification.md:10` says `grep ... | grep -v test`), and the P03 stayer-test audit is limited to `AgentClient|ChatSession|CoreToolScheduler|SubAgentScope|SubagentOrchestrator|TaskTool|vi.mock(...)` (`project-plans/issue1592/plan/03-code-move.md:9`).

Actual code has a core stayer test importing the moved module:

- `packages/core/src/tools/glob.test.ts:9` imports `partListUnionToString` from `../core/geminiRequest.js`.
- `packages/core/src/tools/glob.test.ts:194` calls `partListUnionToString(result.llmContent)`.
- `packages/core/src/core/geminiRequest.ts:15-17` defines `GeminiCodeRequest` and `partListUnionToString`.

Because core must not import agents after P03 (`project-plans/issue1592/specification.md:143-145`; `project-plans/issue1592/plan/00-overview.md:80-88`), the plan needs an explicit disposition for this test before moving `geminiRequest.ts`: move the test if it exercises moved behavior, replace the helper usage with local assertion logic, or keep a core-owned type/helper if justified. As written, the audit commands are too narrow and can end P03 with a broken core test or an illicit core→agents test import.

### MAJOR — Core scheduler test coupling inventory misses `telemetry/uiTelemetry.test.ts`

The reverse dependency map lists `telemetry/loggers.test.circular.ts` as a test importing scheduler types (`project-plans/issue1592/analysis/reverse-dependency-map.md:38`), and P03 lists known large-blast-radius tests that must appear in the disposition table (`project-plans/issue1592/plan/03-code-move.md:9`). However, actual code also has:

- `packages/core/src/telemetry/uiTelemetry.test.ts:21` importing from `../core/coreToolScheduler.js`.

After `core/coreToolScheduler.ts` moves (`project-plans/issue1592/analysis/move-map.md:45`), this test must be retargeted to `core/toolSchedulerContract.ts` or otherwise structurally faked. It is not currently called out in the reverse map or mandatory disposition list, so execution can miss it until typecheck. Add it to P00a/P03 stayer-test blast-radius inventory and specify the intended disposition.

### MAJOR — Integration contract incorrectly states `Config` constructs `AgentClient` in the constructor; the actual construction is in `initialize()` / `initializeContentGeneratorConfig()`

The integration contract states that `Config`'s constructor currently does `new AgentClient(...)` and therefore factories must be constructor parameters with “no safe post-construction window” (`project-plans/issue1592/analysis/integration-contract.md:14-16`, `82-90`). Actual code shows:

- `packages/core/src/config/config.ts:103-107`: the constructor only calls `applyConfigParams(...)`.
- `packages/core/src/config/config.ts:196-198`: `initialize()` creates `this.agentClient = new AgentClient(this, this.runtimeState)`.
- `packages/core/src/config/config.ts:306-315`: `initializeContentGeneratorConfig` creates a replacement `new AgentClient(this, this.runtimeState)`.

Constructor-parameter injection remains a reasonable design because composition roots can supply factories when constructing `Config`, and many tests construct `Config` without initializing. But the plan should correct the stated rationale. The current false claim conflicts with P01's more accurate statement that factories should throw at use time, not construction time, for non-initializing tests (`project-plans/issue1592/plan/01-contracts-inversion.md:3-4`). Leaving the inaccurate rationale risks unnecessary churn across the 251 `new Config(` call sites and may cause implementers to treat factory absence as a construction-time error, breaking non-initializing tests.

### MINOR — Core package dependency leakage is not hard-scanned in the authoritative battery

The spec forbids any production or dev dependency from core to agents (`project-plans/issue1592/specification.md:129-131`) and no core imports from agents in production or tests (`project-plans/issue1592/specification.md:143-145`). The full battery scans TypeScript files for `llxprt-code-agents` under `packages/core` (`project-plans/issue1592/plan/00-overview.md:64-73`), and P03/P03a include anti-shim/import scans (`project-plans/issue1592/plan/03-code-move.md:80-88`; `project-plans/issue1592/plan/03a-code-move-verification.md:10`).

However, the authoritative scan does not explicitly inspect `packages/core/package.json` dependency sections. Current `packages/core/package.json:98-103` shows workspace dependencies on auth/mcp/settings/telemetry, demonstrating that package-level workspace dependencies are declared separately from TS imports. Add a hard check such as:

```bash
node -e "const p=require('./packages/core/package.json'); for (const s of ['dependencies','devDependencies','peerDependencies','optionalDependencies']) if (p[s]?.['@vybestack/llxprt-code-agents']) process.exit(1)"
```

This is a verification rigor gap, not evidence the current plan adds the dependency.

## Verified factual claims and code evidence

I verified these claims independently against the working tree:

1. **`Config` currently imports `AgentClient` directly** — `packages/core/src/config/config.ts:17` imports from `../core/client.js`.
2. **`Config.initialize()` constructs an `AgentClient`** — `packages/core/src/config/config.ts:196-198`.
3. **`initializeContentGeneratorConfig()` constructs a replacement `AgentClient` and transfers history** — `packages/core/src/config/config.ts:306-325` and assigns it at `345`.
4. **`ConfigBaseCore` stores `agentClient` as concrete `AgentClient` today** — `packages/core/src/config/configBaseCore.ts:19` imports the type, and `126` declares `protected agentClient!: AgentClient`.
5. **`schedulerSingleton` dynamically imports `CoreToolScheduler` and constructs it** — `packages/core/src/config/schedulerSingleton.ts:273-287`.
6. **`schedulerSingleton` keeps session-keyed singleton state** — `packages/core/src/config/schedulerSingleton.ts:78-79` maps entries/init state, and `318-357` returns existing/in-flight/new scheduler.
7. **`toolRegistryFactory` imports `TaskTool` directly** — `packages/core/src/config/toolRegistryFactory.ts:38`.
8. **Current TaskTool ToolRecord semantics use class name for `toolName` and static `Name` for `displayName`** — generic registration at `packages/core/src/config/toolRegistryFactory.ts:101-105` and `131-138`; missing-manager path at `251-258`.
9. **`TaskTool.Name` is `task`** — `packages/core/src/tools/task.ts:1342-1350`.
10. **Core exports moved implementations today** — `packages/core/src/index.ts:73`, `76`, `81-84`, and `461` are listed in the reverse map and confirmed by grep output during review.
11. **Providers implementation depends on `core/prompts.js`, supporting the deviation that `prompts.ts` stays** — e.g. `packages/providers/src/gemini/GeminiProvider.ts:22`, `packages/providers/src/openai/OpenAIRequestPreparation.ts:23`, `packages/providers/src/anthropic/AnthropicRequestPreparation.ts:34`, `packages/providers/src/openai-responses/OpenAIResponsesProviderCore.ts:27`, and `packages/providers/src/openai-vercel/OpenAIVercelProvider.ts:61` import `getCoreSystemPromptAsync` from core prompts.
12. **`contentGenerator.ts` is consumed by providers and core stayers, supporting the deviation that it stays** — `packages/providers/src/ProviderContentGenerator.ts:10`, `packages/core/src/config/config.ts:10`, `packages/core/src/runtime/AgentRuntimeLoader.ts:30`, and `packages/core/src/code_assist/server.ts:29`.
13. **`tokenLimits.ts` is consumed by staying core runtime code** — `packages/core/src/runtime/createAgentRuntimeContext.ts:21` imports `tokenLimit` from `../core/tokenLimits.js`.
14. **`buildContinuationDirective` has an external CLI test consumer via core root export** — `packages/cli/src/integration-tests/compression-todo.integration.test.ts:31` imports it, and `226-310` exercise it; current implementation is in `packages/core/src/core/compression/utils.ts:194-217`.
15. **Moved chatSession tests currently import providers** — `packages/core/src/core/chatSession.issue1729.test.ts:8`, `chatSession.runtime.test.ts:15`, and `chatSession.thinking-toolcalls.test.ts:46`, matching the plan’s provider-test-coupling concern.
16. **`packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts` imports `ChatSession` from core** — line `11`, matching the plan’s relocation requirement.
17. **There are 251 `new Config(` matches across packages** — confirmed by grep; this supports the plan’s requirement for a classified construction-site table.
18. **a2a-server directly constructs `AgentClient`** — `packages/a2a-server/src/agent/task.ts:9-20` imports it from core, `103-109` stores it, and `154` constructs it.
19. **CLI auto-prompt constructs detached `AgentClient`** — `packages/cli/src/ui/utils/autoPromptGenerator.ts:7-12`, `19-31`, and `74-82` rely on concrete client methods including `generateDirectMessage`.
20. **Root workspaces currently have no agents package** — `package.json:8-19` lists auth/settings/telemetry/mcp/core/providers/cli/a2a-server/test-utils/vscode/lsp, no `packages/agents`.

## Assessment against requested review areas

### 1. Integration-first

Mostly passes. The plan identifies concrete consumers and composition roots in the spec (`project-plans/issue1592/specification.md:101-111`), old code removal (`113-117`), and user access points (`119-121`). The P03 phase is deliberately atomic, moving code and updating consumers in one change set (`project-plans/issue1592/plan/03-code-move.md:13-18`, `11-11b`). This rejects an isolated build. The remaining concern is not isolation but incomplete consumer/test inventory (findings above).

### 2. Factual accuracy of reverse-dependency and move inventory

Generally strong, but not complete. The plan correctly captures the three production construction couplings (`Config`→`AgentClient`, `schedulerSingleton`→`CoreToolScheduler`, `toolRegistryFactory`→`TaskTool`) and the provider/test couplings. It misses at least two test couplings (`tools/glob.test.ts`→`geminiRequest`, `telemetry/uiTelemetry.test.ts`→`coreToolScheduler`) and has one incorrect statement about constructor-time `AgentClient` creation.

### 3. Deviations from issue literal file list

The deviations are justified and supported by code evidence:

- `contentGenerator.ts` staying is justified by provider/core consumers (`packages/providers/src/ProviderContentGenerator.ts:10`; `packages/core/src/config/config.ts:10`; `packages/core/src/runtime/AgentRuntimeLoader.ts:30`).
- `prompts.ts` staying is justified by provider implementation imports (`packages/providers/src/gemini/GeminiProvider.ts:22`; `openai/OpenAIRequestPreparation.ts:23`; `anthropic/AnthropicRequestPreparation.ts:34`; `openai-responses/OpenAIResponsesProviderCore.ts:27`; `openai-vercel/OpenAIVercelProvider.ts:61`).
- `tokenLimits.ts` staying is justified by `packages/core/src/runtime/createAgentRuntimeContext.ts:21`.
- `loggingContentGenerator.ts` not existing was not re-globbed in detail by me, but the targeted search for `loggingContentGenerator` found no implementation file; the plan should still rely on P00a to paste a glob result.

### 4. Dependency direction soundness

The intended direction is sound: core must not import agents; agents must not import providers or CLI; agents may import core and directly proven auth/settings/etc. The plan has good scans for TS imports and package dependency leakage in agents. Add the missing core package.json dependency scan noted above.

A key dependency risk is moved tests importing providers. The plan correctly identifies and forbids that for chatSession tests and the OpenAI stopReason test. It also correctly forbids root barrel imports from agents and requires subpath exports.

### 5. Executable phase ordering and construction inversion feasibility

The overall P01→P02→atomic P03 ordering is executable. The construction-inversion design is feasible with the current code:

- `ConfigParameters` can be extended in `configTypes.ts`; `applyConfigParams` is the central assignment point (`packages/core/src/config/configConstructor.ts:20-38`, `87-212`).
- `Config` construction currently does not need an agent factory until initialization, so optional constructor params with use-time errors are feasible (`packages/core/src/config/config.ts:103-107`, `196-198`, `306-315`).
- `schedulerSingleton` can replace its dynamic import with an injected factory while retaining singleton maps and callback refresh behavior (`packages/core/src/config/schedulerSingleton.ts:78-79`, `201-263`, `318-357`).
- TaskTool descriptor semantics are necessary and correctly designed around current `ToolRecord` behavior (`packages/core/src/config/toolRegistryFactory.ts:101-149`, `247-260`, `308-309`; `packages/core/src/tools/task.ts:1342-1350`).

The inaccurate constructor claim should be fixed to avoid misimplementation, but it does not invalidate the architecture.

### 6. Verification rigor

Strong overall: full battery is defined centrally (`project-plans/issue1592/plan/00-overview.md:50-73`), P03a includes behavior-preservation audits and no-shim/no-root-barrel scans, and P04/P05 add bundle/smoke/release checks. Gaps: add core package.json dependency scan, broaden test audit beyond the current class-name regex, and explicitly disposition the missed `geminiRequest` and `uiTelemetry` tests.

### 7. TDD discipline in P01

P01 is acceptable for this refactor: it restricts TDD to the new inversion seams and requires behavior assertions beyond `toHaveBeenCalled` (`project-plans/issue1592/plan/01-contracts-inversion.md:1`). It avoids reverse testing and requires parity tests for TaskTool records. This aligns with PLAN.md for new code while acknowledging the extraction is behavior-preserving existing code.

## Required revisions before approval

1. Add `packages/core/src/tools/glob.test.ts` / `partListUnionToString` to P00a/P03 test-coupling inventory and specify the disposition.
2. Add `packages/core/src/telemetry/uiTelemetry.test.ts` to the scheduler/coreToolScheduler stayer-test blast-radius list and specify the disposition.
3. Correct `analysis/integration-contract.md` to state `AgentClient` is constructed during `initialize()` and `initializeContentGeneratorConfig()`, not in the `Config` constructor; keep constructor-param injection if desired, but update the rationale.
4. Add a hard scan ensuring `packages/core/package.json` has no `@vybestack/llxprt-code-agents` in any dependency section.

After those revisions, the plan should be approvable.