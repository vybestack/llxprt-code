# Phase 15a: createAgent + Core Conversation Verification

## Phase ID

`PLAN-20260617-COREAPI.P15a`

## LLxprt Code Subagent: deepthinker

## Prerequisites

- Required: Phase 15 completed
- Verification: `grep -c "@pseudocode" packages/agents/src/api/createAgent.ts`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P15"
npm test -- --testNamePattern "@plan:.*P10"
npm test -- --testNamePattern "T1\b\|T9\b\|T25\b"
npm run typecheck
npm test -- --testNamePattern "runtime context.*messageBus\|@plan:.*P12.*messageBus"
grep -rn "@plan:PLAN-20260617-COREAPI.P12" packages/providers/src/runtime/runtimeContextFactory.messageBus.test.ts

grep -rnE "(TODO|FIXME|HACK|STUB)" packages/agents/src/api/createAgent.ts packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

## Pseudocode Compliance Review (MANDATORY — deepthinker)

- Compare createAgent.ts and runtimeContextFactory.ts with `analysis/pseudocode/createAgent.md` numbered step labels.
- Confirm shared-context bootstrap: one runtimeId, shared Config/SettingsService/ProviderManager/OAuthManager, `await handle.activate()`, one shared MessageBus.
- Confirm provider-runtime contract tests prove both `messageBus` paths: no option preserves old private-bus behavior, provided option binds the exact bus instance to OAuth/runtime context, and `handle.activate()` registers the same runtimeId/config/settings/providerManager.

- Confirm `createAgentRuntimeState` receives the required runtimeId.
- Confirm the initial AgenticLoop is built via `rebuildLoop()` from `config.getAgentClient()` and that the facade never stores a separate cached AgentClient.
- Confirm optional `toolSchedulerFactory` is passed through as caller-owned factory / Agent-owned created scheduler instances.

## Semantic Verification Checklist (MANDATORY)

1. Is the bootstrap order exactly as pseudocode (trace each await, including `await handle.activate()`)?
2. Is the transient pre-auth client never bound (post-auth only)?
3. Is the same MessageBus passed into runtime context/OAuthManager, `Config.initialize`, AgenticLoop, hooks, and tools?
4. Is AgenticLoop rebuilt through `rebuildLoop()` and bound to the current client?
5. Does stream() produce the documented AgentEvent sequence on a real FakeProvider?
6. Does chat() return a complete AgentResult (text/toolCalls/finishReason/usage)?
7. Is optional scheduler-factory ownership correct (factory not disposed; created scheduler instances recorded for Agent.dispose)?
8. Are T1/T9/T25 + full P10 green?

### Holistic Functionality Assessment (completion marker)

- Trace input prompt → AgenticLoop → event-adapter → public stream.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if pseudocode followed, ordering correct, named T-rows + P10 green.

## Failure Recovery

- Return to Phase 15.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P15a.md`
