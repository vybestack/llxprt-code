# Phase 15: Impl — createAgent + Core Conversation + Initial Loop [GREEN: T1, T16, T25, T9]

## Phase ID

`PLAN-20260617-COREAPI.P15`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 14a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P14a.md`

## Requirements Implemented (Expanded)

### REQ-001: createAgent bootstrap/composition

**Full Text**: `createAgent(config)` composes shipped primitives through a shared runtime context: validate `AgentConfig`; build `ConfigParameters` with an injected `agentClientFactory`; construct one `Config`; construct one shared `MessageBus`; create an isolated runtime context that adopts the same `Config`, `SettingsService`, `ProviderManager`, `OAuthManager`, `runtimeId`, and `MessageBus`; `await handle.activate()`; `await config.initialize({messageBus})`; `await config.refreshAuth(authType)`; create runtime state with the required `runtimeId`; bind only the post-auth `config.getAgentClient()`; build the initial `AgenticLoop` through `rebuildLoop()`; record ownership; trigger SessionStart.

**Behavior**:
- GIVEN: an `AgentConfig` with provider/model/auth/sandbox/tool fields
- WHEN: `createAgent(config)` resolves
- THEN: a ready Agent exists, using a shared runtime context and shared MessageBus, with a post-auth AgentClient and an AgenticLoop bound to that current client

**Why This Matters**: this is the one-call bootstrap that lets clients avoid the hand-rolled multi-step setup and prevents provider/auth/tool channels from diverging.

### REQ-003: typed AgentEvent stream wired into chat()/stream()

**Full Text**: `stream()` maps `AgenticLoop.run` output through the event-adapter; `chat()` drains `stream()` into `AgentResult` with text/toolCalls/finishReason/error/usage sufficient for non-interactive output handling.

**Behavior**:
- GIVEN: a model turn yields AgenticLoop events, including terminal and non-terminal variants
- WHEN: a client calls `agent.stream()` or `agent.chat()`
- THEN: `stream()` yields public `AgentEvent` values with exactly one terminal `done`, and `chat()` returns an `AgentResult` that preserves text, tool calls, finish reason, error, and usage.

**Why This Matters**: This is the public runtime contract used by scripts, non-interactive CLI, and the future thin UI; it must not expose internal stream events.

## Implementation Tasks

### Files to Modify

- `packages/providers/src/runtime/runtimeContextFactory.ts`
  - Add/confirm optional `messageBus?: MessageBus` on `IsolatedRuntimeContextOptions` and use it instead of constructing a private bus when provided.
- This is the B2 shared-bus seam required by `createAgent.md` steps 33-58.
- Implement exactly per `analysis/pseudocode/createAgent.md`:
- `@pseudocode createAgent.md steps 10-27` — validate config, resolve auth, runtimeId, inject agentClientFactory, and wrap optional `toolSchedulerFactory`
- `@pseudocode createAgent.md steps 31-37` — construct Config and one shared MessageBus
- `@pseudocode createAgent.md steps 41-58` — `createIsolatedRuntimeContext({ runtimeId, settingsService, config, model, messageBus })` and `await handle.activate()`
- `@pseudocode createAgent.md steps 61-70` — apply initial provider/auth/baseUrl through verified runtime mutators, not unsupported context options
- `@pseudocode createAgent.md steps 76-91` — initialize and refresh auth in order
- `@pseudocode createAgent.md steps 101-113` — call `createAgentRuntimeState` with required runtimeId and bind the post-auth client
- `@pseudocode createAgent.md steps 125-150` — initial `rebuildLoop()` binding and facade construction
- `@pseudocode createAgent.md steps 160-170` — SessionStart then return Agent
- `packages/providers/src/runtime/runtimeContextFactory.ts`
  - Implement the `messageBus?: MessageBus` seam required by the RED contract tests from P12 (`runtimeContextFactory.messageBus.test.ts`).
  - Do not create these contract tests in P15; P15 makes the already-written RED tests pass.

- `packages/agents/src/api/agent.ts`
  - Implement `stream()` and `chat()` using `loopHolder.current.run(...)`; never hold a separate cached `AgentClient`.
  - Implement the initial `rebuildLoop` helper shared by switch/auth/profile phases: it disposes the old loop/subscriptions and constructs `new AgenticLoop({ agentClient: config.getAgentClient(), config, messageBus, ... })`.
  - Implement an initial `dispose()` covering loop/subscriptions/config/runtime handle; full teardown table lands in P24.
  - MUST include `@plan:PLAN-20260617-COREAPI.P15`, `@requirement:REQ-001`/`REQ-003`, and the `@pseudocode` references above.

### Implementation Rules

- Do not pass `provider`, `apiKey`, or `baseUrl` to `createIsolatedRuntimeContext`; they are not valid `IsolatedRuntimeContextOptions`. Apply them through the verified runtime mutators after `handle.activate()`.

- Use `createIsolatedRuntimeContext`; do NOT use bare `createHeadlessProviderManager` in createAgent.
- `await handle.activate()` before any runtime switch/auth/profile mutator can run.
- One `MessageBus` instance must be used by runtime context/OAuthManager, `Config.initialize`, every AgenticLoop, tool control, and hooks.
- `createAgentRuntimeState` must include `runtimeId`; never call it with only provider/model.
- The initial loop must be built by `rebuildLoop()` because the same routine is required after switches; `AgenticLoop` caches its constructor client.

## Verification Commands

```bash
missing=0
npm test -- --testNamePattern "@plan:.*P15" || missing=1
npm test -- --testNamePattern "T1\b\|T9\b\|T16\b\|T25\b" || missing=1
npm test -- --testNamePattern "runtime context.*messageBus\|@plan:.*P12.*messageBus" || { echo "FAIL runtimeContextFactory messageBus seam tests"; missing=1; }

# No rejected bootstrap path: inspect the whole createIsolatedRuntimeContext call block, not a fixed line window
python3 - <<'PY' || missing=1
from pathlib import Path
s = Path('packages/agents/src/api/createAgent.ts').read_text()
idx = s.find('createIsolatedRuntimeContext({')
if idx < 0:
    raise SystemExit('MISSING createIsolatedRuntimeContext call')
depth = 0
end = None
for pos in range(idx, len(s)):
    ch = s[pos]
    if ch == '{': depth += 1
    elif ch == '}':
        depth -= 1
        if depth == 0:
            end = pos
            break
block = s[idx:end + 1 if end is not None else len(s)]
for forbidden in ('provider:', 'apiKey:', 'baseUrl:'):
    if forbidden in block:
        raise SystemExit(f'FAIL unsupported context option {forbidden}')
PY

grep -rn "createHeadlessProviderManager" packages/agents/src/api packages/providers/src/runtime/runtimeContextFactory.ts && { echo "FAIL bare headless factory in createAgent path"; missing=1; }
# Required bootstrap invariants visible
grep -rn "await .*activate" packages/agents/src/api/createAgent.ts || { echo "MISSING await activate"; missing=1; }
runtime_state_lines=$(grep -n "createAgentRuntimeState" packages/agents/src/api/createAgent.ts | cut -d: -f1)
test -n "$runtime_state_lines" || { echo "MISSING createAgentRuntimeState"; missing=1; }
for line in $runtime_state_lines; do
  sed -n "${line},$((line+12))p" packages/agents/src/api/createAgent.ts | grep -q "runtimeId" || { echo "MISSING runtimeId near createAgentRuntimeState at line $line"; missing=1; }
done
grep -rn "messageBus" packages/agents/src/api/createAgent.ts packages/providers/src/runtime/runtimeContextFactory.ts || { echo "MISSING shared messageBus"; missing=1; }
grep -rn "rebuildLoop" packages/agents/src/api/createAgent.ts packages/agents/src/api/agent.ts || { echo "MISSING rebuildLoop"; missing=1; }
# Pseudocode markers must cite actual numbered steps
grep -rn "@pseudocode createAgent.md steps 41-58\|@pseudocode createAgent.md steps 125-150" packages/agents/src/api packages/providers/src/runtime || { echo "MISSING pseudocode refs"; missing=1; }
grep -rn "toolSchedulerFactory" packages/agents/src/api packages/providers/src/runtime || { echo "MISSING scheduler factory pass-through"; missing=1; }
grep -rn "@plan:PLAN-20260617-COREAPI.P12" packages/providers/src/runtime/runtimeContextFactory.messageBus.test.ts || { echo "MISSING providers runtime messageBus RED contract test markers"; missing=1; }

exit $missing
```

### Deferred Implementation Detection (MANDATORY)

```bash
missing=0
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP)" packages/agents/src/api/createAgent.ts packages/agents/src/api/agent.ts packages/providers/src/runtime/runtimeContextFactory.ts | grep -v ".spec.ts" && { echo FAIL; missing=1; }
grep -rnE "(in a real|for now|placeholder|not yet|will be)" packages/agents/src/api/createAgent.ts packages/agents/src/api/agent.ts packages/providers/src/runtime/runtimeContextFactory.ts | grep -v ".spec.ts" && { echo FAIL; missing=1; }
exit $missing
```

### Semantic Verification Checklist

- [ ] Shared runtime context, SettingsService, ProviderManager, OAuthManager, Config, and MessageBus identities are asserted by T25/T18c/T2.
- [ ] `handle.activate()` is awaited.
- [ ] `AgenticLoop` is built through `rebuildLoop()` and bound to the current post-auth client.
- [ ] `stream()` maps via event-adapter and emits exactly one `done`.
- [ ] `chat()` returns an `AgentResult` sufficient for T22/P26.
- [ ] Pseudocode refs use the real numbered step labels.
- [ ] Optional `toolSchedulerFactory` is passed through without taking ownership of the factory function; created scheduler instances are recorded for Agent-owned disposal.

## Success Criteria

- T1/T9/T16/T25 green; bootstrap is shared-context/shared-bus; no rejected headless-factory path; no stale client loop.

## Failure Recovery

- `git checkout -- packages/providers/src/runtime/runtimeContextFactory.ts packages/agents/src/api/createAgent.ts packages/agents/src/api/agent.ts`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P15.md`
