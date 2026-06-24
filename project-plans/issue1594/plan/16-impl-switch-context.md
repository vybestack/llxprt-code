# Phase 16: Impl — Provider/Model/Param Switch + Context Preservation [GREEN: T4, T4b–f, T5]

## Phase ID

`PLAN-20260617-COREAPI.P16`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 15a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P15a.md`

## Requirements Implemented (Expanded)

### REQ-004: provider/model/param switching wrapping providers/runtime

**Full Text**: `setProvider`, `setModel`, `setModelParam`, `clearModelParam`, and `getModelParams` wrap shipped runtime mutators from `@vybestack/llxprt-code-providers/runtime.js` in the shared runtime context. Provider/profile switches and model changes must rebind the Config-owned AgentClient, then call `rebuildLoop()` because `AgenticLoop` caches its constructor client. Model-param changes are lazy runtime param updates and must reach the next provider call.

**Behavior**:
- GIVEN: a live Agent with conversation history
- WHEN: provider/model/profile/auth rebinds the client
- THEN: the same HistoryService is preserved, the current client changes, the old loop is torn down, and the next `AgenticLoop.run` uses the new client

**Why This Matters**: Provider/model switching is only useful if the public Agent uses the shipped runtime pipeline and never runs future turns on a stale AgenticLoop client.

### REQ-005: context preservation across switch

**Full Text**: Switching provider/model/profile/load-balancer bucket continues the same conversation: the same `HistoryService` instance is reused, chat is not reset, the next provider call includes prior context, and provider-incompatible artifacts are normalized (stripThoughts) rather than blindly copied.

**Behavior**:
- GIVEN prior conversation turns on provider A
- WHEN the Agent switches provider/model/profile or load-balancer bucket
- THEN the next turn on provider B receives prior context through the same HistoryService, with provider-incompatible artifacts normalized

**Why This Matters**: The headline user benefit is continuing a conversation on a fallback provider when the current provider is overloaded.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/agent.ts` and/or `packages/agents/src/api/control/providerControl.ts`
  - Implement `setProvider`, `setModel`, `setModelParam`, `clearModelParam`, `getModelParams`, `getProvider`, `getModel`, `getProviderStatus`, `getCurrentSequenceModel`, `getUserTier` exactly per `analysis/pseudocode/switch-rebind.md`:
- `@pseudocode switch-rebind.md steps 10-26` — shared `rebuildLoop()` contract (dispose old loop/subscriptions; construct new `AgenticLoop` with current client)
- `@pseudocode switch-rebind.md steps 30-37` — `setProvider`: `switchActiveProvider` rebuilds content generator internally; then assert continuity/client change and rebuild loop
- `@pseudocode switch-rebind.md steps 50-58` — `setModel`: `setActiveModel` does not rebuild, so call `config.initializeContentGeneratorConfig()` then rebuild loop
- `@pseudocode switch-rebind.md steps 70-78` — `applyProfile`: `applyProfileSnapshot` rebuilds internally; then rebuild loop
- `@pseudocode switch-rebind.md steps 90-111` — model-param lazy mutators/getter
  - MUST include `@plan:PLAN-20260617-COREAPI.P16` + `@requirement:REQ-004`/`REQ-005`.

### Implementation Rules

- Do not redesign the rebuild path. Use the pinned switch-rebind.md algorithms exactly.
- Do not invent or call a non-existent switch-refresh helper.
- Do not call `config.initializeContentGeneratorConfig()` after `switchActiveProvider` or `applyProfileSnapshot`; those rebuild internally.
- Do call `config.initializeContentGeneratorConfig()` after model-only `setActiveModel`.
- Do call `rebuildLoop()` after every client-rebinding mutation, because `AgenticLoop` caches its client.
- Do not rebuild the content generator or loop on `setModelParam`/`clearModelParam`; assert params reach the next provider call.

## Verification Commands

```bash
missing=0
npm test -- --testNamePattern "@plan:.*P16" || missing=1
npm test -- --testNamePattern "T4\b\|T4b\|T4c\|T4d\|T4e\|T4f\|T5\b" || missing=1
# Must use real runtime mutators and rebuildLoop
grep -rn "switchActiveProvider\|setActiveModel\|setActiveModelParam\|clearActiveModelParam\|getActiveModelParams\|applyProfileSnapshot" packages/agents/src/api || { echo "MISSING runtime mutators"; missing=1; }
grep -rn "rebuildLoop" packages/agents/src/api || { echo "MISSING loop rebuild"; missing=1; }
# Must not use stale design paths
grep -rn "createHeadlessProviderManager" packages/agents/src/api && { echo "FAIL stale path"; missing=1; }
# Pseudocode markers must cite actual ranges
grep -rn "@pseudocode switch-rebind.md steps 10-26\|@pseudocode switch-rebind.md steps 30-37\|@pseudocode switch-rebind.md steps 90-111" packages/agents/src/api || { echo "MISSING switch pseudocode refs"; missing=1; }
exit $missing
```

### Deferred Implementation Detection (MANDATORY)

```bash
missing=0
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP)" packages/agents/src/api/control/*.ts packages/agents/src/api/agent.ts | grep -v ".spec.ts" && { echo FAIL; missing=1; }
grep -rnE "(in a real|for now|placeholder|not yet|will be)" packages/agents/src/api/control/*.ts packages/agents/src/api/agent.ts | grep -v ".spec.ts" && { echo FAIL; missing=1; }
exit $missing
```

### Semantic Verification Checklist

- [ ] T4c proves the next `AgenticLoop.run` uses the new client after a switch.
- [ ] T4d/T4e assert SAME HistoryService identity and prior context visible after switch/failover.
- [ ] T4f asserts stripThoughts normalization on provider-incompatible history.
- [ ] T5 proves model params reach the next provider call, not just getters.
- [ ] Old loop/subscriptions are torn down before the new loop is installed.
- [ ] Pseudocode refs use the real numbered step labels.

## Success Criteria

- Switch + context preservation working; T4*/T5 green; no deferred implementation.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agent.ts packages/agents/src/api/control/`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P16.md`
