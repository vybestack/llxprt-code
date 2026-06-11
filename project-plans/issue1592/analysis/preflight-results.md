# Preflight Results: PLAN-20260610-ISSUE1592.P00A

Generated: 2026-06-10
Branch: issue1592

---

## Item 1: Move-Set Inventory

**Command:**
```bash
ls packages/core/src/core packages/core/src/agents packages/core/src/scheduler
ls packages/core/src/core/compression
ls packages/core/src/tools/task.ts
```

**Result:** PASS

**Non-test files in `core/` (39 files):**
```
AgentHookManager.ts        baseLlmClient.ts           bucketFailoverIntegration.ts
chatSession.ts             ChatSessionFactory.ts       chatSessionTypes.ts
client.ts                  clientHelpers.ts            clientLlmUtilities.ts
clientToolGovernance.ts    compression-config.ts       contentGenerator.ts
ConversationManager.ts     coreToolHookTriggers.ts     coreToolScheduler.ts
DirectMessageProcessor.ts  geminiRequest.ts            googleGenAIWrapper.ts
IdeContextTracker.ts       lifecycleHookTriggers.ts    logger.ts
MessageConverter.ts        MessageStreamOrchestrator.ts MessageStreamTerminalHandler.ts
nonInteractiveToolExecutor.ts prompts.ts               StreamProcessor.ts
subagent.ts                subagentExecution.ts        subagentOrchestrator.ts
subagentRuntimeSetup.ts    subagentScheduler.ts        subagentToolProcessing.ts
subagentTypes.ts           TodoContinuationService.ts  tokenLimits.ts
toolGovernance.ts          turn.ts                     turnLogging.ts
TurnProcessor.ts
```

**Non-test files in `agents/` (8 files):**
```
executor-prompt-builder.ts  executor-termination.ts  executor-validation.ts
executor.ts                 invocation.ts            recovery.ts
types.ts                    utils.ts
```

**Non-test files in `scheduler/` (7 files):**
```
confirmation-coordinator.ts  result-aggregator.ts  status-transitions.ts
tool-dispatcher.ts           tool-executor.ts      types.ts
utils.ts
```

**Non-test files in `compression/` (11 files):**
```
compressionBudgeting.ts  CompressionHandler.ts  compressionStrategyFactory.ts
HighDensityStrategy.ts   index.ts               MiddleOutStrategy.ts
OneShotStrategy.ts       reasoningUtils.ts      TopDownTruncationStrategy.ts
types.ts                 utils.ts
```

**`tools/task.ts` exists.**

**Inventory vs move-map reconciliation:**

STAYS in core (correctly NOT in move-map):
- `chatSessionTypes.ts` — stays (consumed by `utils/generateContentResponseUtilities.ts`)
- `contentGenerator.ts` — stays (deviation; providers depends on it)
- `googleGenAIWrapper.ts` — stays (used by contentGenerator)
- `logger.ts` — stays (session logger)
- `prompts.ts` — stays (deviation; providers imports it)
- `tokenLimits.ts` — stays (deviation; consumed by `runtime/createAgentRuntimeContext`)
- `geminiRequest.ts` — stays (zero move-set consumers)
- `coreToolHookTriggers.ts` — stays (consumed by staying hooks test)
- `lifecycleHookTriggers.ts` — stays (hooks/index.ts re-export)
- `subagentTypes.ts` — stays (consumed by `services/asyncTaskManager`)
- `compression/types.ts` — stays (consumed by `services/history/HistoryService`)
- `scheduler/types.ts` — stays (consumed by `confirmation-bus/types.ts`, `policy/policy-helpers`)

MOVES per move-map (all accounted for):
- core/: 28 production files move (client.ts, clientHelpers.ts, clientLlmUtilities.ts, clientToolGovernance.ts, baseLlmClient.ts, ConversationManager.ts, DirectMessageProcessor.ts, MessageConverter.ts, MessageStreamOrchestrator.ts, MessageStreamTerminalHandler.ts, StreamProcessor.ts, TurnProcessor.ts, IdeContextTracker.ts, TodoContinuationService.ts, AgentHookManager.ts, bucketFailoverIntegration.ts, turnLogging.ts, chatSession.ts, ChatSessionFactory.ts, turn.ts, coreToolScheduler.ts, nonInteractiveToolExecutor.ts, toolGovernance.ts, subagent.ts, subagentOrchestrator.ts, subagentScheduler.ts, subagentExecution.ts, subagentRuntimeSetup.ts, subagentToolProcessing.ts, compression-config.ts)
- compression/: 9 files move (CompressionHandler.ts, compressionBudgeting.ts, compressionStrategyFactory.ts, HighDensityStrategy.ts, MiddleOutStrategy.ts, OneShotStrategy.ts, TopDownTruncationStrategy.ts, reasoningUtils.ts, utils.ts, index.ts)
- agents/: 8 files move (entire directory)
- scheduler/: 6 files move (tool-executor.ts, tool-dispatcher.ts, result-aggregator.ts, confirmation-coordinator.ts, status-transitions.ts, utils.ts)
- tools/: 1 file moves (task.ts)

**No files present in directories but absent from move-map dispositions.** Every file has an explicit MOVE or STAY disposition.

## Item 2: Class-Construction Couplings

**Commands:**
```bash
grep -rn "new AgentClient(" packages/core/src --include="*.ts" | grep -v test
grep -rn "import('../core/coreToolScheduler.js')\|new CoreToolScheduler(" packages/core/src --include="*.ts" | grep -v test | grep -v "src/core/"
grep -rn "TaskTool" packages/core/src/config --include="*.ts" | grep -v test
```

**Output:**

2a. `new AgentClient(` in core production code:
```
packages/core/src/config/config.ts:198:    this.agentClient = new AgentClient(this, this.runtimeState);
packages/core/src/config/config.ts:315:    const newAgentClient = new AgentClient(this, this.runtimeState);
```
Exactly 2 sites in `config/config.ts` — matches plan claim.

2b. `coreToolScheduler` references outside `src/core/` (non-test):
```
packages/core/src/config/schedulerSingleton.ts:17:} from '../core/coreToolScheduler.js';
packages/core/src/config/schedulerSingleton.ts:274:      '../core/coreToolScheduler.js'
packages/core/src/config/config.ts:101:import type { CoreToolScheduler } from '../core/coreToolScheduler.js';
packages/core/src/index.ts:82:export * from './core/coreToolScheduler.js';
```
- `schedulerSingleton.ts` — dynamic import at line 274 (REQ-INV-002 target)
- `config/config.ts:101` — type-only import
- `index.ts:82` — barrel export

Note: The grep command in the plan was overly narrow (looked for `import('../core/coreToolScheduler.js')` or `new CoreToolScheduler(` outside `src/core/`), and the `schedulerSingleton.ts` match DID NOT appear because the dynamic import is `await import('../core/coreToolScheduler.js')` which the grep pattern captured at line 274 but the `grep -v "src/core/"` excluded it. However, expanding the search confirms schedulerSingleton.ts IS the coupling point, exactly as claimed.

2c. TaskTool in config:
```
packages/core/src/config/toolRegistryFactory.ts:38:import { TaskTool } from '../tools/task.js';
packages/core/src/config/toolRegistryFactory.ts:249:    registerCoreTool(TaskTool, config, taskToolArgs);
packages/core/src/config/toolRegistryFactory.ts:252:      toolClass: TaskTool,
packages/core/src/config/toolRegistryFactory.ts:253:      toolName: 'TaskTool',
packages/core/src/config/toolRegistryFactory.ts:255:      displayName: TaskTool.Name || 'TaskTool',
packages/core/src/config/toolRegistryFactory.ts:308:  ensureCoreToolIncluded(effectiveCoreTools, 'TaskTool');
packages/core/src/config/toolRegistryFactory.ts:309:  ensureCoreToolIncluded(effectiveCoreTools, TaskTool.Name);
```
Exactly `toolRegistryFactory.ts` — matches plan claim.

**Result:** PASS — exactly three class-construction couplings in core production code: `config/config.ts` -> AgentClient (2 sites), `config/schedulerSingleton.ts` -> CoreToolScheduler (dynamic import), `config/toolRegistryFactory.ts` -> TaskTool.

## Item 3: Type-Only Stayer Imports

**Command:** `grep "import" <stayer-file>` for each file in reverse-dep-map section 1.

**Evidence:**

| Stayer file | Import | Type-only? | Stays? |
|---|---|---|---|
| `adapters/IStreamAdapter.ts` | `import { type ServerGeminiStreamEvent } from '../core/turn.js'` | YES (inline type) | turn.ts types stay |
| `hooks/tool-render-suppression-hook.ts` | `import { DEFAULT_AGENT_ID } from '../core/turn.js'` | VALUE import of constant | turn.ts stays, constant stays |
| `policy/policy-helpers.ts` | no turn import (imports from `scheduler/types.js`) | N/A | scheduler/types stays |
| `confirmation-bus/types.ts` | `import type { ToolCall } from '../scheduler/types.js'` | YES | scheduler/types stays |
| `services/asyncTaskManager.ts` | `import type { OutputObject } from '../core/subagentTypes.js'` | YES | subagentTypes stays |
| `services/history/HistoryService.ts` | `import type { DensityResult } from '../../core/compression/types.js'` + `import { CompressionStrategyError } from '../../core/compression/types.js'` | MIXED: type + value (error class) | compression/types stays |
| `utils/checkpointUtils.ts` | `import type { AgentClient } from '../core/client.js'` | YES | -> contract post-move |
| `utils/summarizer.ts` | `import type { AgentClient } from '../core/client.js'` | YES | -> contract post-move |
| `utils/llm-edit-fixer.ts` | `import { type AgentClient } from '../core/client.js'` | YES (inline type) | -> contract post-move |
| `config/configBaseCore.ts` | `import type { AgentClient } from '../core/client.js'` + `import type { SubagentSchedulerFactory } from '../core/subagentScheduler.js'` | YES | -> contract post-move |
| `config/config.ts` | `import type { CoreToolScheduler } from '../core/coreToolScheduler.js'` | YES | -> contract post-move |
| `hooks/index.ts` | `from '../core/lifecycleHookTriggers.js'` (re-export) | VALUE re-export | lifecycleHookTriggers STAYS in core |
| `core/lifecycleHookTriggers.ts` | imports only `Config` (type), hook types, `DebugLogger` | All staying modules | Stays in core |

**Notes:**
- `lifecycleHookTriggers.ts` consumers: `chatSession.ts` (moves), `AgentHookManager.ts` (moves), `hooks/index.ts` (stays). Decision confirmed: stays in core; movers deep-import via core subpath.
- `HistoryService.ts` imports `CompressionStrategyError` as a value from `compression/types.js` — this module stays in core, so no issue.
- `DEFAULT_AGENT_ID` from `turn.js` is a value import (constant) — `turn.ts` types stay in core, and the constant will remain in the types-only module after the Turn class moves out.

**Result:** PASS — all stayer imports resolve to staying modules or to type-only imports of modules being split (turn.ts keeps types/constants, client.ts type -> contract).

## Item 4: agents/ Directory Isolation

**Command:**
```bash
grep -rn "from '.*agents/'" packages/core/src --include="*.ts" | grep -v "packages/core/src/agents/"
grep -rn "from '\.\./\.\./agents/" packages/core/src --include="*.ts"
grep -rn "from '\./agents/" packages/core/src --include="*.ts"
grep -n "agents/" packages/core/src/index.ts
```

**Output:** All commands returned zero matches. No external imports of agents/ directory from outside it. No exports from index.ts.

**Result:** PASS — `agents/` is fully isolated. Moves wholesale with zero external consumer impact.

---

## Item 5: scheduler/types.ts Consumers

**Command:**
```bash
grep -rn "from.*scheduler/types" packages/core/src --include="*.ts" | grep -v test | grep -v "packages/core/src/scheduler/"
```

**Output:**
```
packages/core/src/core/coreToolScheduler.ts:56:} from '../scheduler/types.js';
packages/core/src/core/coreToolScheduler.ts:79:} from '../scheduler/types.js';
packages/core/src/confirmation-bus/types.ts:6:import type { ToolCall } from '../scheduler/types.js';
packages/core/src/policy/policy-helpers.ts:15:import type { PolicyContext } from '../scheduler/types.js';
```

**Analysis:**
- `coreToolScheduler.ts` (2 imports) — MOVES to agents; imports via core deep module post-move
- `confirmation-bus/types.ts` — STAYS; type-only import
- `policy/policy-helpers.ts` — STAYS; type-only import

Matches plan claim: exactly `confirmation-bus/types.ts` + `policy/policy-helpers.ts` (+ scheduler internals that move).

**Result:** PASS

---

## Item 6: providers Package — Zero Imports of Moved Modules

**Command:**
```bash
grep -rn "core/client\.js\|coreToolScheduler\|chatSession\.js\|subagent" packages/providers/src --include="*.ts"
```

**Output (trimmed to non-false-positive hits):**
```
packages/providers/src/openai/OpenAIStreamProcessor.stopReason.test.ts:11:import { ChatSession } from '@vybestack/llxprt-code-core/core/chatSession.js';
```

Plus references to `subagent` which are all about `subagent-delegation` / `subagentConfig` variables — NOT imports of moved subagent runtime modules. Confirmed: providers imports `core/prompts.js` (staying), `core/contentGenerator.js` (staying), and `prompt-config/subagent-delegation.js` (staying) — all correct.

The single moved-module import is the test file `OpenAIStreamProcessor.stopReason.test.ts` importing `ChatSession` — exactly as documented in the move-map. This test relocates to agents.

**No production code in providers imports any moved module.**

**Result:** PASS — providers has zero production imports of moved modules. One test file imports ChatSession (documented for relocation).

## Item 7: Config Construction-Site Classification

**Commands:**
```bash
grep -rn "new Config(" packages --include="*.ts" | wc -l     # 251
grep -rln "new Config(" packages --include="*.ts" | wc -l     # 54 files
grep -rn "new Config(" packages --include="*.ts" | grep -v "test\.\|spec\."  # non-test
grep -rln "new Config(" packages --include="*.ts" | xargs grep -l "initialize()\|initializeContentGeneratorConfig\|getOrCreateScheduler\|getAgentClient\|refreshAuth"  # files crossing seam
```

**Counts:** 251 occurrences across 54 files.

### (a) Composition Roots — Must Wire Concrete Factories

| File | `new Config(` line | Crosses seam? | Notes |
|---|---|---|---|
| `packages/cli/src/config/configBuilder.ts` | :318 | YES (config passed to callers that call initialize) | CLI composition root; must wire all 3 factories |
| `packages/cli/src/runtime/runtimeContextFactory.ts` | :224 | YES (calls initialize later) | CLI runtime context; must wire all 3 factories |
| `packages/a2a-server/src/config/config.ts` | :43 | YES (calls initializeConfig + refreshConfigAuth at :44-45) | a2a composition root; must wire all 3 factories |

### (b) Initializing Tests — Need Test Factories/Fakes

| File | Seam crossings | Notes |
|---|---|---|
| `packages/core/src/test-utils/config.ts` | `initializeTestConfig()` calls `config.initialize()` | Needs test fakes for agentClient |
| `packages/core/src/config/config.test.ts` | 10 crossings (initialize, getAgentClient, etc.) | Already vi.mock's AgentClient |
| `packages/core/src/config/config.scheduler.test.ts` | 3 crossings (getOrCreateScheduler) | Uses dynamic import of CoreToolScheduler |
| `packages/core/src/core/client.test.ts` | 2 crossings | Constructs AgentClient in tests |
| `packages/core/src/core/subagent.test.ts` | 1 crossing | Moves to agents |
| `packages/cli/src/integration-tests/consumer-migration-p13.integration.test.ts` | 2 crossings | CLI integration test |

### (c) Non-Initializing Tests — No Change Needed

All remaining ~48 test files that construct `new Config(` but never call `initialize()`, `initializeContentGeneratorConfig()`, `getOrCreateScheduler()`, `getAgentClient()`, or `refreshAuth()`. These sites only build a Config with mock params for test fixtures and will require ZERO changes.

### Known Production Non-Test Site: GeminiProvider.ts:958

**Classification: (c) — Non-initializing.**

```typescript
// packages/providers/src/gemini/GeminiProvider.ts:958
return new Config({
  sessionId: randomUUID(),
  targetDir: process.cwd(),
  debugMode: false,
  cwd: process.cwd(),
  model: 'gemini-2.5-flash',
});
```

**Verification:** This Config is constructed with only minimal params (sessionId, targetDir, debugMode, cwd, model). It is used SOLELY for OAuth resolution in `resolveOAuthConfig()`. It does NOT call:
- `initialize()` — NO
- `initializeContentGeneratorConfig()` — NO
- `getOrCreateScheduler()` — NO
- `getAgentClient()` — NO
- `refreshAuth()` — NO

**Confirmed:** This site NEVER crosses the seam. It constructs a minimal Config for OAuth plumbing only. providers must NOT depend on agents, so this classification as (c) is correct. No agent factories needed.

**Result:** PASS — all 54 `new Config(` sites classified. 3 composition roots, 6 initializing tests, ~45 non-initializing tests, 1 non-initializing production site (GeminiProvider). Plan assumptions validated.

## Item 8: a2a-server TaskTool/Task Usage

**Commands:**
```bash
grep -rn "TaskTool\|task\.ts\|taskTool\|toolRegistryFactory\|toolRegistry" packages/a2a-server/src --include="*.ts"
grep -n "initialize\|Config\|agentClient\|AgentClient" packages/a2a-server/src/config/config.ts
grep -rn "AgentClient\|new AgentClient" packages/a2a-server/src --include="*.ts"
```

**Findings:**

1. a2a-server does NOT directly import or reference `TaskTool` anywhere. It uses `config.getToolRegistry()` in `agent/task.ts:179,185,192` to get available tools.

2. a2a-server constructs Config at `config/config.ts:43`:
   ```
   const config = new Config(configParams);
   await initializeConfig(config);
   await refreshConfigAuth(config);
   ```
   `initializeConfig` calls `config.initialize()` which triggers `toolRegistryFactory.buildToolRegistry()` internally. The tool registry creation includes TaskTool registration (when managers are present). Since a2a's `resolveManagers` auto-creates ProfileManager/SubagentManager, TaskTool IS registered in a2a today.

3. a2a-server directly constructs `AgentClient` at `agent/task.ts:154`:
   ```
   this.agentClient = new AgentClient(this.config, runtimeState);
   ```
   And imports `CoreToolScheduler` type at `agent/task.ts:32` for scheduler creation.

4. a2a-server's Config construction at `config/config.ts:43` is a COMPOSITION ROOT — it calls `initialize()` and must wire all three factories.

**Expected behavior when TaskToolRegistration is not wired (post-P03):** During P01-P02, the core-local default registration covers a2a automatically. Post-P03, a2a MUST pass `taskToolRegistration` — since `resolveManagers` auto-creates managers, the registered path is the NORMAL outcome in a2a, and absence would be a behavior regression.

**Result:** PASS — a2a-server is a composition root. It does not directly reference TaskTool but relies on Config's tool registry to register it. Plan's REQ-INV-003.2 (every composition root must pass taskToolRegistration post-P03) is validated.

---

## Item 9: buildContinuationDirective Relocation

**Commands:**
```bash
grep -n "buildContinuationDirective" packages/core/src/core/compression/utils.ts
grep -n "^import" packages/core/src/core/compression/utils.ts
grep -rn "buildContinuationDirective" packages --include="*.ts"
```

**Findings:**

`buildContinuationDirective` is defined at `compression/utils.ts:194`.

Its imports are:
```typescript
import type { ContentBlock, IContent, MediaBlock, TextBlock } from '../../services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '../../runtime/contracts/RuntimeProvider.js';
import { classifyMediaBlock } from '../../tools/mediaUtils.js';
import type { CompressionContext } from './types.js';
```

ALL dependencies are staying modules: `services/history/IContent.js`, `runtime/contracts/RuntimeProvider.js`, `tools/mediaUtils.js`, `./types.js` (compression/types.ts stays).

`buildContinuationDirective` itself only uses basic string operations — no chat-loop dependencies. Confirmed pure string-building util.

**Consumers:**
- `compression/MiddleOutStrategy.ts:42` (MOVES) — imports at line 42, uses at line 403
- `compression/OneShotStrategy.ts:41` (MOVES) — imports at line 41, uses at line 139
- `compression/__tests__/continuation-directive.test.ts` (MOVES)
- `core/src/index.ts:85` — exports from core barrel (KEEPS)
- `cli/src/integration-tests/compression-todo.integration.test.ts:31` — imports from core barrel

**Plan decision:** Extract `buildContinuationDirective` into a staying core module (e.g., `core/compression/continuationDirective.ts` or alongside `compression/types.ts`). Moved strategies import it via `@vybestack/llxprt-code-core/core/compression/continuationDirective.js` subpath. CLI test import unchanged.

**Result:** PASS — `buildContinuationDirective` has only staying-module deps. Extraction to staying module is viable. Needs one new exports-map entry.

---

## Item 10: geminiRequest Consumers

**Command:**
```bash
grep -rn "geminiRequest\|GeminiCodeRequest\|partListUnionToString" packages/*/src --include="*.ts"
```

**Output:**
```
packages/core/src/tools/glob.test.ts:9:import { partListUnionToString } from '../core/geminiRequest.js';
packages/core/src/tools/glob.test.ts:194:      const llmContent = partListUnionToString(result.llmContent);
packages/core/src/core/__tests__/config-regression-guard.test.ts:83:      const filePath = resolve(__dirname, '../geminiRequest.ts');
packages/core/src/core/__tests__/providerAgnosticNaming.test.ts:47:  { pattern: 'geminiRequest', reason: 'Gemini provider request module' },
packages/core/src/core/geminiRequest.ts:15:export type GeminiCodeRequest = PartListUnion;
packages/core/src/core/geminiRequest.ts:17:export function partListUnionToString(value: PartListUnion): string {
packages/core/src/index.ts:81:export * from './core/geminiRequest.js';
```

**Analysis:**
- `tools/glob.test.ts:9,194` — STAYING test importing `partListUnionToString` (staying module)
- `__tests__/config-regression-guard.test.ts:83` — only checks file existence, not import
- `__tests__/providerAgnosticNaming.test.ts:47` — only pattern matching, not import
- Source `geminiRequest.ts` defines the exports
- `index.ts:81` re-exports

**Zero move-set consumers.** The STAYS disposition holds. Confirmed: only staying `tools/glob.test.ts:9` and `index.ts:81` are real consumers.

**Result:** PASS


---

## Item 11: CLI Turn / ServerGemini Usage

**Commands:**
```bash
grep -rln "@vybestack/llxprt-code-core" packages/cli/src --include="*.ts" | xargs grep -n "Turn\|ServerGemini\|GeminiEventType" | head -120
grep -rln "ServerGemini\|GeminiEventType" packages/cli/src --include="*.ts" | xargs grep -n "@vybestack/llxprt-code-core" | head -60
```

**Representative output:**
```text
packages/cli/src/ui/hooks/geminiStream/contentEventProcessor.ts:16:  type ServerGeminiContentEvent as ContentEvent,
packages/cli/src/ui/hooks/geminiStream/streamEventDispatcher.ts:15:  GeminiEventType as ServerGeminiEventType,
packages/cli/src/ui/hooks/geminiStream/streamEventDispatcher.ts:16:  type ServerGeminiStreamEvent as GeminiEvent,
packages/cli/src/ui/hooks/geminiStream/useSubmitQuery.ts:21:  type ServerGeminiStreamEvent,
packages/cli/src/ui/hooks/geminiStream/useStreamEventHandlers.ts:19:  type ServerGeminiStreamEvent as GeminiEvent,
packages/cli/src/nonInteractiveCli.slashCommandsAndThinking.test.ts:10:  ServerGeminiStreamEvent,
packages/cli/src/nonInteractiveCli.slashCommandsAndThinking.test.ts:16:  GeminiEventType,
packages/cli/src/config/interactiveContext.ts:18:} from '@vybestack/llxprt-code-core';
packages/cli/src/nonInteractiveCliSupport.ts:17:} from '@vybestack/llxprt-code-core';
```

**Finding:** The rough analysis claim "5 CLI Turn/ServerGemini files" understates total root-barrel event-type usage when tests and all `ServerGemini*` types are included. This is NOT blocking: `GeminiEventType`, `ServerGemini*` interfaces, `ServerGeminiStreamEvent`, `DEFAULT_AGENT_ID`, and tool-call protocol types are explicitly staying in `core/turn.ts`. The class `Turn` itself has no direct CLI import requiring migration. P03's generated CLI/a2a inventory remains the authoritative consumer list.

**Result:** PASS WITH NON-BLOCKING DISCREPANCY — update mental model: CLI event/protocol usage is broader than the shorthand, but it targets staying root-barrel exports.

---

## Item 12: Dynamic Imports / vi.mock Paths

**Commands:**
```bash
grep -rn "vi\.mock('.*core/\(client\|chatSession\|coreToolScheduler\|subagent\)" packages/*/src --include="*.ts"
grep -rn "await import(" packages/core/src/core packages/core/src/agents --include="*.ts" | head -120
```

**vi.mock output:**
```text
packages/core/src/tools/edit.test.ts:17:vi.mock('../core/client.js', () => ({
packages/core/src/tools/write-file.test.ts:34:vi.mock('../core/client.js');
packages/core/src/config/config-lsp-integration.test.ts:96:vi.mock('../core/client.js', () => ({
packages/core/src/config/config.test.ts:90:vi.mock('../core/client.js', () => ({
packages/core/src/agents/executor.test.ts:44:vi.mock('../core/chatSession.js', async (importOriginal) => {
packages/core/src/utils/summarizer.test.ts:21:vi.mock('../core/client.js');
packages/core/src/lsp/__tests__/e2e-lsp.test.ts:82:vi.mock('../../core/client.js', () => ({
packages/core/src/lsp/__tests__/system-integration.test.ts:81:vi.mock('../../core/client.js', () => ({
```

**Dynamic import output (moved-path relevant subset):**
```text
packages/core/src/core/chatSession.runtime.test.ts:818:      const { Turn, GeminiEventType } = await import('./turn.js');
packages/core/src/core/subagentRuntimeSetup.issue1844.test.ts:28:    const mod = await import('./subagentRuntimeSetup.js');
packages/core/src/core/subagentRuntimeSetup.test.ts:33:    const mod = await import('./subagentRuntimeSetup.js');
packages/core/src/agents/executor.test.ts:967:      const { resolveStreamIdleTimeoutMs } = await import(
```

**Result:** PASS — P04/P03 test audit must retarget stale vi.mock paths and dynamic imports. These are documented fraud vectors for silent mock no-ops.

---

## Item 13: Core Export-Map Needs for Moved Code

**Command:** Generated imports from moved production files and compared normalized core subpaths with `packages/core/package.json` exports.

**Output summary:**
```text
Moved files scanned: 64
Needed core subpaths: 195
Missing export-map entries: 189 (raw unnormalized list includes intra-move imports and paths with .. segments)
```

**Analysis:** The raw mechanical extraction over-counts because many imports are intra-move references that become local `packages/agents/src` imports, and paths with `..` segments require normalization after the move. P03 task 12 remains the authoritative final dependency/export reconciliation after real import rewrites. Preflight confirms the key risk: many existing core-adjacent utilities/types used by moved code will require either local rewritten paths (when also moved) or explicit core export-map entries (when staying). No new blocker beyond the existing P03 reconciliation gate.

**Result:** PASS — risk identified and already covered by P03/P03a final reconciliation.

---

## Item 14: Build/CI References to Mirror for Agents

**Command:**
```bash
grep -n "providers" .github/workflows/release.yml .github/workflows/build-sandbox.yml scripts/build_sandbox.js scripts/version.js Dockerfile scripts/tests/release-process.test.js | head -80
```

**Output (key lines):**
```text
.github/workflows/release.yml:344:      - name: Publish @vybestack/llxprt-code-providers
.github/workflows/release.yml:368:          mkdir -p ... packages/providers/dist
.github/workflows/release.yml:377:          npm pack -w @vybestack/llxprt-code-providers --pack-destination ./packages/providers/dist
.github/workflows/build-sandbox.yml:65:          npm pack -w @vybestack/llxprt-code-providers --pack-destination ./packages/providers/dist
scripts/build_sandbox.js:97:const providersPackageDir = join('packages', 'providers');
scripts/build_sandbox.js:159:  console.log('packing @vybestack/llxprt-code-providers ...');
scripts/build_sandbox.js:225:    providersPackageDir,
scripts/version.js:50:  '@vybestack/llxprt-code-providers',
Dockerfile:58:COPY --chown=node:node packages/providers/dist/vybestack-llxprt-code-providers-*.tgz /tmp/
Dockerfile:70:      /tmp/vybestack-llxprt-code-providers-*.tgz \
scripts/tests/release-process.test.js:70:      '@vybestack/llxprt-code-providers',
scripts/tests/release-process.test.js:109:  it('publishes auth, settings, and telemetry before MCP, core, providers, and CLI', () => {
scripts/tests/release-process.test.js:166:  it('prepares settings and providers tarballs for sandbox images', () => {
scripts/tests/release-process.test.js:204:  it('copies auth, settings, telemetry, MCP, core, providers, and CLI tarballs in dependency order', () => {
```

**Result:** PASS — P02 must mirror these providers precedents for agents and run `npm run test:scripts`.

---

## Item 15: Stayer-Test Blast Radius

**Command:**
```bash
grep -rn "AgentClient\|ChatSession\|CoreToolScheduler\|SubAgentScope\|SubagentOrchestrator\|TaskTool\|vi\.mock(.*core/" packages/core/src --include="*.test.ts" --include="*.spec.ts" | head -200
```

**Representative output:**
```text
packages/core/src/tools/task.test.ts:10:import { TaskTool, type TaskToolParams } from './task.js';
packages/core/src/tools/task.test.ts:12:import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
packages/core/src/tools/write-file.test.ts:25:import { AgentClient } from '../core/client.js';
packages/core/src/tools/write-file.test.ts:34:vi.mock('../core/client.js');
packages/core/src/core/coreToolScheduler.test.ts:18:import { CoreToolScheduler } from './coreToolScheduler.js';
packages/core/src/core/chatSession.contextlimit.test.ts:8:import { ChatSession } from './chatSession.js';
packages/core/src/core/turn.test.ts:24:import type { ChatSession } from './chatSession.js';
packages/core/src/config/config.test.ts:90:vi.mock('../core/client.js', () => ({
packages/core/src/lsp/__tests__/e2e-lsp.test.ts:82:vi.mock('../../core/client.js', () => ({
```

**Disposition:** P03 task 9 binding audit remains required. Obvious move-set tests under `packages/core/src/core`, `packages/core/src/agents`, and `packages/core/src/tools/task.test.ts` move with their subjects; staying tests with AgentClient mocks retarget to `clientContract`/structural fake or agents depending on subject; lsp/config/utils/tool tests are explicitly covered by the P03 table gate.

**Result:** PASS — audit input generated; P03 must produce the complete table before move.

---

## Item 16: Move-Set Import Inventory

**Command:** generated external/workspace imports from non-test moved production files and sampled test files.

**Key workspace dependency findings:**
- Allowed/expected direct deps for agents: core; settings (`subagentOrchestrator.ts`, `tools/task.ts`); auth (`StreamProcessor.ts`); telemetry/mcp if final inventory proves direct imports.
- Forbidden direct deps: providers, cli. No provider production dependency found in moved-set production files during preflight; provider references observed are test coupling that must become structural fakes or move targets per move-map.

**Result:** PASS — P02 provisional dependency inventory and P03 final reconciliation are still required.

---

## Blocking Issues

None.

## Non-Blocking Discrepancies

1. CLI `Turn`/`ServerGemini*` root-barrel usage is broader than the shorthand "5 files" when tests and all event types are included. Since the protocol/event exports stay in `core/turn.ts`, this does not invalidate the architecture. P03's generated CLI/a2a inventory is the authoritative migration input.
2. The raw export-map extraction over-counts missing exports before import rewrites; this is expected and covered by P03 final reconciliation.

## Overall Verdict

GO. All P00a assumptions required before P01 are verified or have non-blocking discrepancies already covered by later hard gates.
