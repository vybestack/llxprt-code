# Phase 14: Impl — Config + Event Adapters [GREEN: adapter units]

## Phase ID

`PLAN-20260617-COREAPI.P14`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 13a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P13a.md`

## Requirements Implemented (Expanded)

### REQ-002: AgentConfig → ConfigParameters translation (full field classification)

**Full Text**: A pure adapter `toConfigParameters(config)` maps every classified
AgentConfig field to ConfigParameters / sub-surface / documented `settings` escape
hatch; the `settings` hatch THROWS if a key shadows a typed target; callbacks are not
copied; output is frozen and the input is never mutated.

**Behavior**:
- GIVEN an `AgentConfig` containing provider/model, typed config fields, callbacks,
  and an unstable `settings` hatch
- WHEN `toConfigParameters(config)` runs
- THEN it returns an immutable `ConfigParameters` object with only valid config
  fields mapped, callbacks excluded, and shadowing settings rejected with AdapterError

**Why This Matters**: This is the package-boundary translation layer. If it is
impure or lossy, clients cannot use the public API without reaching into Config
internals.

### REQ-003: AgentEvent mapping/adapter (21 variants + AgenticLoopEvent + synthesized done)

**Full Text**: `mapLoopStream(loopEvents)` consumes `AgenticLoopEvent` and yields the
public `AgentEvent` union per the §4.4 mapping + terminal table, with exactly one
synthesized `done`.

**Behavior**:
- GIVEN an `AgenticLoopEvent` stream containing model, scheduler, terminal, and
  error events
- WHEN `mapLoopStream` is drained
- THEN every internal variant is projected to the documented public shape and the
  public stream ends with exactly one `done`

**Why This Matters**: The public event stream is the main compatibility contract for
GUI/CLI/a2a consumers. Incorrect or ambiguous mapping forces consumers back to deep
internal imports.

## Implementation Tasks

### Files to Create/Modify

- `packages/agents/src/api/adapters/config-adapter.ts` — implement `toConfigParameters`
  EXACTLY per `analysis/pseudocode/config-adapter.md`:
  - `@pseudocode config-adapter.md steps 10-24` — fresh params, provider/model/modelParams
  - `@pseudocode config-adapter.md steps 30-44` — working context, tools, MCP
  - `@pseudocode config-adapter.md steps 50-72` — approval/policy and full typed-field classification
  - `@pseudocode config-adapter.md steps 80-87` — settings hatch shadow-check → AdapterError
  - `@pseudocode config-adapter.md steps 90-101` — callbacks excluded; freeze output
- `packages/agents/src/api/adapters/event-adapter.ts` — implement `mapLoopStream` +
  `mapStreamEvent` EXACTLY per `analysis/pseudocode/event-adapter.md`:
  - `@pseudocode event-adapter.md steps 10-12` — state init
  - `@pseudocode event-adapter.md steps 30-49` — loop-kind dispatch using real fields (`event`, `toolCalls`, `callId`, `chunk`, `completed`)
  - `@pseudocode event-adapter.md steps 200-205` — loop-end synthesize exactly one `done`
  - `@pseudocode event-adapter.md steps 210-245` — 21-variant mapStreamEvent table
  - `@pseudocode event-adapter.md steps 250-252` — makeDone helper
  - MUST include `@plan:PLAN-20260617-COREAPI.P14` + `@requirement:REQ-002`/`REQ-003`
    + the exact `@pseudocode` step refs above.

### Implementation Rules (PLAN.md)

- Follow pseudocode step-by-step; cite numbered pseudocode steps in comments.
- No `any`/assertions; explicit return types; immutable.
- Do NOT modify the harness tests.

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P14"
# event-characterization (P10) should now start passing for pure-mapping variants
npm test -- --testNamePattern "@plan:.*P10"
grep -c "@pseudocode" packages/agents/src/api/adapters/event-adapter.ts
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP)" packages/agents/src/api/adapters/*.ts | grep -v ".spec.ts" && echo FAIL || echo OK
grep -rnE "(in a real|for now|placeholder|not yet|will be|should be)" packages/agents/src/api/adapters/*.ts | grep -v ".spec.ts" && echo FAIL || echo OK
grep -rnE "return \[\]|return \{\}|return null|return undefined" packages/agents/src/api/adapters/*.ts | grep -v ".spec.ts" && echo "CHECK empty returns" || echo OK
```

### Pseudocode Compliance (deepthinker — invoked in P14a)

- Every numbered pseudocode step label in config-adapter.md / event-adapter.md implemented in order.

### Semantic Verification Checklist

- [ ] toConfigParameters is pure (input unchanged, output frozen)
- [ ] settings hatch shadow-check throws AdapterError
- [ ] mapLoopStream yields exactly one `done`
- [ ] 21-variant table fully implemented
- [ ] Pseudocode step refs present

## Success Criteria

- Adapter impls complete; relevant P10 variant tests pass; no deferred-impl markers.

## Failure Recovery

- `git checkout -- packages/agents/src/api/adapters/`; redo per pseudocode.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P14.md`
