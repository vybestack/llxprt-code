# Audit Details: Subagent Deep Analysis Results

## Subagent 1: Agent Skills Feasibility (typescriptexpert)

**Verdict: CHERRY-PICK** with branding changes (~580 LoC modifications)

Key findings:
- Zero dependencies on removed infrastructure (ClearcutLogger, SmartEdit, FlashFallback)
- All required LLxprt infrastructure exists (ToolRegistry, MessageBus, PolicyEngine, Storage, Settings, Extensions)
- Linear commit chain — must be picked in order
- One verification needed: `config.getAgentRegistry().getDirectoryContext()` in prompts.ts

Recommended cherry-pick phases:
1. Core Infrastructure (de1233b8, 958284dc)
2. Integration (764b1959, e78c3fe4, f0a039f7)
3. Extensions & Commands (bdb349e7, d3563e2f)
4. Reload & Enhancements (2cb33b2f, 0c541362, 5f027cb6)
5. Documentation (59a18e71)

---

## Subagent 2: Deferred Items Analysis (reviewer)

| Commit | Verdict | Confidence | Key Finding |
|--------|---------|------------|-------------|
| 9a3ff651 | NO_OP | HIGH | LLxprt toml-loader already allows modes — no tier restriction exists |
| 6f4b2ad0 | REIMPLEMENT | HIGH | Both cli+core config diverged (`settings.folderTrust` vs `settings.security?.folderTrust?.enabled`) |
| 9172e283 | REIMPLEMENT | MEDIUM | SettingsDialog has diverged; no description handling exists |
| 334b813d | NO_OP | HIGH | Migration code already removed; only yolo.toml `allow_redirection=true` is new |
| 61dbab03 | REIMPLEMENT | MEDIUM | No hook lifecycle events in LLxprt's CoreEventEmitter |
| 56092bd7 | REIMPLEMENT | MEDIUM | LLxprt has `tools.enableHooks`, upstream moves to `hooks.enabled` |
| dd84c2fb | REIMPLEMENT | MEDIUM | Needs new AgentExecution event types in streaming protocol |
| 6d1e2763 | REIMPLEMENT | MEDIUM | sessionHookTriggers.ts doesn't exist in LLxprt |
| 687ca40b | PICK | HIGH | Same `void` → `await` bug exists in LLxprt |
| 588c1a6d | PICK | HIGH | Same rendering order bug; depends on 687ca40b |
| 3441b883 | SKIP | HIGH | LLxprt client.ts doesn't emit ModelInfo events at all |
| 2fe45834 | REIMPLEMENT | MEDIUM | No admin settings section in LLxprt |
| 881b026f | REIMPLEMENT | HIGH | Trivial — add `@vybestack/llxprt-code-core` path to tsconfig |
| def09778 | NO_OP | HIGH | LLxprt already removed bracketedPaste detection |
| 4b270119 | SKIP | HIGH | Race condition doesn't exist in LLxprt's different completion pattern |

---

## Subagent 3: MessageBus/RemoteAgents/ToolScheduler (typescriptreviewer)

### MessageBus: SKIP
LLxprt uses `config.getMessageBus()` (centralized accessor). Upstream's 3-phase migration makes MessageBus a mandatory constructor param everywhere. Both achieve the same goal. LLxprt's approach is arguably simpler. Only cleanup: remove dead `setMessageBus()` stubs (~10 LoC).

### Remote Agents: REIMPLEMENT (~1500-2000 LoC)
Completely incompatible agent architecture. LLxprt has SubagentOrchestrator, no TOML loader for agents, no A2A client. Missing: `@a2a-js/sdk`, A2AClientManager, a2aUtils, ADCHandler, RemoteAgentInvocation, kind discriminator on AgentDefinition.

Phases: Types+Client → Registry Integration → Execution.

### Tool Scheduler: REIMPLEMENT our own way (~800-1200 LoC moved)
LLxprt's 2139-line file is a maintenance burden. Upstream's extraction concepts are good: types → `scheduler/types.ts`, utilities → separate files, ToolExecutor → `scheduler/tool-executor.ts`. But cherry-picking is impossible due to parallel batching divergence. Do our own extraction.

---

## Subagent 4: User-Flagged Commits (deepthinker)

| Commit | Verdict | Key Finding |
|--------|---------|-------------|
| dced409a | REIMPLEMENT | Hooks reimplemented — port folder trust behavior |
| 308aa707 | SKIP | Deprecated aliases don't exist in LLxprt's reimplemented hooks |
| 563d81e0 | REIMPLEMENT | Extensions reimplemented — port install/uninstall UX |
| 546baf99 | NO_OP | Already implemented in LLxprt |
| ec79fe1a | REIMPLEMENT | Extensions reimplemented |
| ec11b8af | REIMPLEMENT | Extensions reimplemented |
| 4c67eef0 | REIMPLEMENT | Extensions reimplemented |
| 7edd8030 | REIMPLEMENT | Extensions diverged |
| 07e597de | SKIP | Redundant with RetryOrchestrator |
| 15c9f88d | REIMPLEMENT | Core hook execution semantics in diverged client.ts |
| 006de1dd | REIMPLEMENT | Docs have Gemini-specific paths/terminology |
| 384fb6a4 | NO_OP | OSC 52 already implemented |
| 4086abf3 | SKIP | Google code_assist oauth2 — not applicable |
| fd7b6bf4 | SKIP | Same — oauth2 test fix |
