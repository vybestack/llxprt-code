# Phase 01: Core Contracts + Construction Inversion (in place)

## Phase ID

`PLAN-20260610-ISSUE1592.P01`

## Prerequisites

- P00a completed with PASS verdict (`project-plans/issue1592/.completed/P00A.md` exists).
- Read: specification.md, analysis/integration-contract.md, analysis/reverse-dependency-map.md, preflight-results.md.

## Requirements Implemented (Expanded)

### REQ-INV-001: AgentClient inversion
**Full Text**: `Config` no longer imports or constructs class `AgentClient`. It holds an injected `AgentClientFactory` and calls it wherever it previously did `new AgentClient(...)`. CLI/a2a-server/test composition roots register the factory.
**Behavior**:
- GIVEN: a Config constructed with `agentClientFactory` in ConfigParameters
- WHEN: `config.initialize()` / `initializeContentGeneratorConfig()` run
- THEN: the factory is invoked with `(config, runtimeState)` and the returned client behaves exactly as before (history handoff, dispose of previous client, initialization order preserved)
**Why This Matters**: removes the only hard class dependency blocking the move of client.ts out of core.

### REQ-INV-002: CoreToolScheduler inversion
**Full Text**: `config/schedulerSingleton.ts` replaces its dynamic `import('../core/coreToolScheduler.js')` with an injected `ToolSchedulerFactory`. `Config.getOrCreateScheduler` keeps its public signature, returning the contract type.
**Behavior**:
- GIVEN: Config with registered `ToolSchedulerFactory`
- WHEN: `getOrCreateScheduler(sessionId, callbacks, options, deps)` is called twice for the same session
- THEN: factory invoked once; same instance returned (singleton invariant #1060 preserved); cancellation/disposal behavior unchanged
**Why This Matters**: severs the second class dependency.

### REQ-INV-003: TaskTool inversion
**Full Text**: `config/toolRegistryFactory.ts` no longer imports `TaskTool`. It uses an injected `TaskToolRegistration` descriptor (see integration-contract.md) + core-owned `TASK_TOOL_CLASS_NAME`/`TASK_TOOL_NAME` constants with today's gating preserved.
**Behavior**:
- GIVEN: profileManager + subagentManager present AND registration wired
- WHEN: tool registry is built
- THEN: task tool registered exactly as today — identical `ToolRecord` shape (`toolClass` = concrete class, `toolName`='TaskTool', `displayName`=TaskTool.Name), identical coreTools/excludeTools allow-list matching (which matches on BOTH class name and static `Name`), identical `ensureCoreToolIncluded` behavior, same constructor args
- GIVEN: managers present but registration NOT wired (configuration error — unreachable in production since BOTH composition roots wire it, see below)
- THEN: explicit config-error/disabled diagnostic ToolRecord (constants + toolClass: undefined; reason names the missing wiring) — this is NOT today's missing-manager path and the test must assert it as a distinct, documented fallback
- GIVEN: managers missing (registration wired or not)
- THEN: today's missing-manager ToolRecord path preserved exactly (toolRegistryFactory.ts:250-260)
**WIRING RULE — TWO-STAGE (critical for P01 executability)**: `TaskTool` has NO public import path today (absent from core barrel src/index.ts, core package.json exports map, and all CLI/a2a imports — verified), so external composition roots CANNOT legally import the concrete class until P03 creates the agents package API. Therefore P01 does NOT wire `taskToolRegistration` from CLI/a2a. Instead, P01 extracts today's TaskTool registration into a CORE-LOCAL DEFAULT registration module (e.g. `config/defaultTaskToolRegistration.ts` — the ONLY core-config file still importing `../tools/task.js`), used by `toolRegistryFactory` when no registration is injected. Behavior is byte-identical (REQ-INV-003.3 row a2). This is NOT a shim: it is the pre-move implementation in its pre-move package, DELETED in P03 when both composition roots flip to importing `TaskTool` from `@vybestack/llxprt-code-agents`. `resolveManagers` (toolRegistryFactory.ts:207-226) auto-creates ProfileManager/SubagentManager, so the registered path is the NORMAL outcome in CLI AND a2a-server today (a2a initializes Config at a2a-server/src/config/config.ts:44,135-145) — which is why post-P03 BOTH roots must wire the registration; full matrix in REQ-INV-003.3 (specification) and integration-contract.md.
**Why This Matters**: severs the third class dependency without breaking ToolRecord/allow-list semantics that `registerCoreTool` and `getTaskToolMissingReason` rely on (toolRegistryFactory.ts lines 110-150, 240-262), and without silently disabling TaskTool in a2a.

### REQ-API-001 (partial): Core-owned contracts
Define `AgentClientContract`, `AgentClientFactory`, `ToolSchedulerContract`, `ToolSchedulerFactory`, `TaskToolRegistration` in core — in NEW staying modules `core/clientContract.ts` and `core/toolSchedulerContract.ts` (decided paths; do NOT place contracts in `core/client.ts`/`core/coreToolScheduler.ts`, which move wholesale in P03 — distinct paths keep P03a dependency scans unambiguous). Contract member lists MUST be derived mechanically from actual call sites (Config, utils/{summarizer,llm-edit-fixer,checkpointUtils}, CLI files, a2a files) — enumerate them in the phase notes. `AgentClient` class declares `implements AgentClientContract`; `CoreToolScheduler` declares `implements ToolSchedulerContract`.

## Implementation Tasks

1. **TDD first** (behavioral, no mock theater). Each seam MUST have at least one real behavior assertion — `toHaveBeenCalled`-style assertions alone are insufficient:
   - AgentClient seam: the factory-produced object IS the object `config.getAgentClient()` returns, and history handoff across `initializeContentGeneratorConfig()` transfers REAL history content (assert on history items, not on mock invocation).
   - Scheduler seam: repeated `getOrCreateScheduler` for the same session returns the SAME real object; callbacks update behavior observably (#1060 invariant).
   - TaskTool seam: registry output (registered tool name, ToolRecord metadata, enabled/disabled reason strings) is identical to today's output with and without wiring.
   - Tests live where their subjects live today (core). Mark with `@plan:PLAN-20260610-ISSUE1592.P01`.
2. Create contract types (core-owned modules per integration-contract.md). Type-only imports of `AgentClient` in `utils/summarizer.ts`, `utils/llm-edit-fixer.ts`, `utils/checkpointUtils.ts`, `configBaseCore.ts` switch to the contract.
3. Add `agentClientFactory`, `toolSchedulerFactory`, `taskToolRegistration` to ConfigParameters. (Accurate rationale: Config's constructor only applies params — config.ts:103-107; AgentClient construction happens in `initialize()` at :196-198 and `initializeContentGeneratorConfig()` at :306-315. Constructor params are chosen because composition roots already pass ConfigParameters and a setter has no ordering guarantee vs. initialize().) Absence semantics: clear error at USE time (when initialize/initializeContentGeneratorConfig/getOrCreateScheduler would construct), NEVER at Config construction — non-initializing test sites need zero changes. TaskTool: behavior matrix per REQ-INV-003.3 (config-error diagnostic when managers present but registration absent; missing-manager record when managers missing).
4. Update Config construction sites SELECTIVELY based on the preflight item 7 classification (~54 files / ~251 occurrences — blanket edits are forbidden churn). Three classes:
   - **Composition roots** (CLI bootstrap, a2a config, test-utils helpers used by initializing tests): MUST pass concrete factories via ConfigParameters.
   - **Tests that initialize the client** (call `initialize()` / `initializeContentGeneratorConfig()` or otherwise cross the seam): pass test factories/fakes.
   - **Tests that never cross the seam** (construct Config only for accessors/unrelated tools): NO change — factories are optional params with a clear error thrown at USE time (not construction time), so these sites stay untouched.
   At this phase the concrete classes still live in core, so wiring imports them from core — the POINT is the seam, not the package move.
   - **a2a-server special case**: `a2a-server/src/agent/task.ts:154` directly constructs `new AgentClient(this.config, runtimeState)` OUTSIDE Config. a2a-server is a composition root, so direct concrete construction is architecturally acceptable (like CLI's `autoPromptGenerator.ts`) — it does NOT need a factory seam. P01 scope for a2a: its Config construction site(s) get factory params (so Config-internal client creation works), and `task.ts` keeps importing the class from core unchanged. In P03 the import flips to `@vybestack/llxprt-code-agents`. Document both in the consumer audit.
5. `Config.getAgentClient()` return type becomes the contract. `getOrCreateScheduler` returns contract type.
6. Keep all existing exports working (`export * from './core/client.js'` still exports the class at this stage).

### Required Code Markers

All new/modified functions: `@plan PLAN-20260610-ISSUE1592.P01` + `@requirement REQ-INV-00x`.

## Verification Commands

```bash
grep -rn "new AgentClient(" packages/core/src --include="*.ts" | grep -v test | grep -v "src/core/"   # expect: none (factories only)
# Multi-form concrete-import scans (same style as P03a — static single/double quotes, export-from, dynamic import(), require(), vi.mock()):
grep -rnE "(from|import\(|require\(|vi\.mock\()\s*['"][^'"]*core/coreToolScheduler\.js['"]" packages/core/src/config --include="*.ts" | grep -v test   # expect: none (factory only)
grep -rnE "(from|import\(|require\(|vi\.mock\()\s*['"][^'"]*tools/task\.js['"]" packages/core/src/config --include="*.ts" | grep -v test   # expect: EXACTLY ONE hit — the core-local default registration module (defaultTaskToolRegistration.ts); toolRegistryFactory.ts itself must have ZERO
grep -rnE "(from|import\(|require\(|vi\.mock\()\s*['"][^'"]*(tools/task|core/client|core/coreToolScheduler)\.js['"]" packages/core/src/config/toolRegistryFactory.ts packages/core/src/config/config.ts packages/core/src/config/schedulerSingleton.ts   # expect: none (contracts/factories only)
# FULL BATTERY (authoritative definition in 00-overview.md — all six items, no subsets)
npm run format && git diff --exit-code && npm run typecheck && npm run build && npm run test && npm run lint
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Success Criteria

- All three inversions complete; full battery green; smoke test produces a haiku; no behavior change observable in tests.

## Failure Recovery

`git checkout -- packages/` and re-run with corrected seam design.

## Completion Marker

`project-plans/issue1592/.completed/P01.md` with files changed, test counts, verification outputs.
