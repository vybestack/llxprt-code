# Integration Contract: Agents Package Extraction

Plan ID: PLAN-20260610-ISSUE1592

## Component Interaction (post-extraction)

```mermaid
sequenceDiagram
    participant CLI as CLI composition root (gemini.tsx / config.ts)
    participant Agents as @vybestack/llxprt-code-agents
    participant Core as @vybestack/llxprt-code-core (Config)
    participant Prov as @vybestack/llxprt-code-providers

    CLI->>Agents: import { AgentClient, CoreToolScheduler, TaskTool, wiring helpers }
    CLI->>Core: new Config({ ...params, agentClientFactory, toolSchedulerFactory, taskToolRegistration })
    Note over CLI,Core: factories are ConfigParameters constructor params (NOT setters). Precise rationale: Config's constructor itself only applies params (config.ts:103-107); AgentClient construction happens in initialize() (config.ts:196-198) and again in initializeContentGeneratorConfig() (config.ts:306-315). Constructor params are chosen because composition roots already pass ConfigParameters and there is no reliable ordering guarantee that a setter would run before initialize(). CRITICAL semantics: factory ABSENCE is an error at USE time (when initialize()/initializeContentGeneratorConfig() would construct), NEVER at Config construction time — non-initializing tests construct Config without factories and must keep working unchanged.
    CLI->>Core: config.initialize()
    Core->>Agents: agentClientFactory(config, runtimeState) [indirect, via injected fn]
    Agents->>Core: deep imports (turn types, scheduler types, services, utils, runtime contracts)
    Core->>Prov: (unchanged post-#1584) structural runtime contracts only
    CLI->>Core: config.getAgentClient(): AgentClientContract
    CLI->>Core: config.getOrCreateScheduler(...): ToolSchedulerContract
```

## Contracts (core-owned)

```typescript
// packages/core/src/core/clientContract.ts (NEW staying module — core/client.ts moves wholesale) — exact member list derived
// from the union of: Config usage, utils/{summarizer,llm-edit-fixer,checkpointUtils} usage,
// CLI usage (14 files), a2a usage. Enumerated mechanically during P03 from call sites.
export interface AgentClientContract {
  initialize(config: ContentGeneratorConfig): Promise<void>;
  isInitialized(): boolean;
  getHistory(): Promise<Content[]>;
  getHistoryService(): HistoryService | null;
  storeHistoryServiceForReuse(s: HistoryService): void;
  storeHistoryForLaterUse(h: Content[]): void;
  sendMessageStream(...): AsyncGenerator<ServerGeminiStreamEvent, Turn...>; // exact signature copied from class
  dispose(): void;
  // ...complete surface from call-site audit (P03 task)
}

export type AgentClientFactory = (
  config: Config,
  runtimeState: AgentRuntimeState,
) => AgentClientContract;

// packages/core/src/core/toolSchedulerContract.ts (NEW staying module — core/coreToolScheduler.ts moves wholesale; distinct path keeps scans unambiguous, same rule as clientContract.ts)
export interface ToolSchedulerContract { /* schedule/cancel/dispose surface from call sites */ }
export type ToolSchedulerFactory = (options: CoreToolSchedulerOptions) => ToolSchedulerContract;

// packages/core/src/config/toolRegistryFactory.ts
// TaskTool registration seam. toolRegistryFactory.ts builds ToolRecord entries with
// { toolClass, toolName, displayName, isRegistered, reason, args } and the coreTools
// allow-list matches on class name AND static Name ("ensureCoreToolIncluded('TaskTool')"
// and TaskTool.Name). A bare instance factory loses toolClass/static-Name semantics.
// Therefore the seam is a DESCRIPTOR, not a bare factory:
export interface TaskToolRegistration {
  toolClass: unknown;            // concrete class constructor for ToolRecord.toolClass
  className: string;             // ToolClass.name ('TaskTool') — becomes ToolRecord.toolName; allow-list/exclude matching (toolRegistryFactory.ts:101-105, 112-123, and disabled-record path 251-255 which sets toolName:'TaskTool')
  staticName: string;            // static ToolClass.Name ('task', task.ts:1343) — becomes ToolRecord.displayName; also matched by allow-list
  buildArgs(config: Config, taskToolArgs: TaskToolArgs): unknown[];  // constructor args, stored in ToolRecord.args (toolRegistryFactory.ts:131-149)
  create(config: Config, args: TaskToolArgs): AnyDeclarativeTool;
}
// CRITICAL semantics mapping (do NOT swap these):
//   ToolRecord.toolName    = className   ('TaskTool')
//   ToolRecord.displayName = staticName  ('task' via TaskTool.Name)
// Swapping them would change settings/UI allPotentialTools metadata.
// Core keeps TASK_TOOL_CLASS_NAME='TaskTool' / TASK_TOOL_NAME='task' constants so
// ensureCoreToolIncluded (toolRegistryFactory.ts:308-309 force-includes BOTH names)
// and the missing-manager ToolRecord (lines 251-260, which today carries the concrete
// class even when disabled) work without importing the class.
// WIRING RULE (binding, TWO-STAGE): TaskTool has NO public import path until P03
// (absent from core barrel, core exports map, and all CLI/a2a imports — verified),
// so external roots cannot import the concrete class during P01/P02.
//   STAGE 1 (P01-P02): toolRegistryFactory consumes an injected TaskToolRegistration
//   when present, else falls back to a CORE-LOCAL DEFAULT registration module
//   (config/defaultTaskToolRegistration.ts — the only core-config file still
//   importing ../tools/task.js). Byte-identical behavior; deleted in P03.
//   STAGE 2 (P03+): default module deleted with tools/task.ts; EVERY composition
//   root that initializes Config passes taskToolRegistration — CLI AND a2a-server,
//   importing TaskTool from @vybestack/llxprt-code-agents.
// resolveManagers (toolRegistryFactory.ts:207-226) AUTO-CREATES ProfileManager/
// SubagentManager, so the registered path (lines 247-250) is the NORMAL outcome in
// both CLI and a2a today. Post-P03, registration absence is NOT equivalent to the
// missing-manager path and must not be treated as a preserved fallback — it is a
// configuration error surfaced as an explicit disabled/diagnostic record
// (production wiring makes it unreachable).
// MANDATORY TEST MATRIX (assert allPotentialTools entries identical to today):
//   (a)  managers present + registration injected -> registered record (normal path);
//   (a2) managers present + no injection + default present (P01-P02) -> registered
//        record byte-identical to (a);
//   (b)  managers present + registration absent + no default (post-P03 misconfig)
//        -> explicit config-error/disabled diagnostic (documented non-runtime fallback);
//   (c)  managers missing -> missing-manager record preserved
//        (constants + toolClass: undefined);
//   plus coreTools allow-list and excludeTools scenarios on top of (a).
// Scope note: ListSubagentsTool STAYS in core (move-map §D2), so this descriptor
// remains a single-purpose TaskTool seam — no generalization needed.
```

## Lifecycle (order preserved from today)

1. CLI parses args, builds `Config` (constructor) — the constructor itself only applies params (config.ts:103-107); NO AgentClient is constructed here. Factories arrive via ConfigParameters at this step (DECIDED: constructor params, not setters — composition roots already pass ConfigParameters and a setter has no ordering guarantee vs. step 2).
2. `config.initialize()` → first `new AgentClient(this, this.runtimeState)` happens HERE today (config.ts:196-198) → post-inversion: created via injected factory.
3. Auth/profile application → `initializeContentGeneratorConfig()` → replacement `new AgentClient(...)` (config.ts:306-315) → via factory + history handoff (behavior identical).
4. Tool registry creation → TaskTool via registration descriptor when gating satisfied.
5. Scheduler creation on demand via `getOrCreateScheduler` → factory.

FACTORY-ABSENCE SEMANTICS (binding): a missing factory is an error at USE time — i.e. when step 2/3/4/5 would actually construct — never at Config construction time. Non-initializing Config sites (the vast majority of the ~251 `new Config(` occurrences, classified in preflight item 7) require ZERO changes. Only composition roots (CLI, a2a) and initializing tests wire factories.

## Test boundary

- Core tests that construct Config and exercise AgentClient/scheduler behavior either (a) move to agents package, or (b) inject a factory from agents devDependency — FORBIDDEN: core cannot devDepend on agents (would create install cycle; npm allows it but boundary rule REQ-CLEAN-001.1 forbids). Therefore tests needing concrete classes MOVE to agents.
- `packages/core/src/test-utils/config.ts` (makeFakeConfig) must produce a Config whose factories are test fakes defined IN core test-utils (structural fakes implementing contracts, not the moved classes).
