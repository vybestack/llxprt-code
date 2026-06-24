# Phase 19: Impl — Profiles CRUD + Apply [GREEN: T18d, T4b]

## Phase ID

`PLAN-20260617-COREAPI.P19`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 18a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P18a.md`

## Requirements Implemented (Expanded)

### REQ-009: profiles CRUD + apply (standard + load-balancer)

**Full Text**: `agent.profiles` wraps the runtime apply pipeline
(`applyProfileWithGuards`) and the durable profile store
(`saveProfileSnapshot`, `saveLoadBalancerProfile`, `loadProfileByName`,
`deleteProfileByName`, `listSavedProfiles`, `getProfileByName`,
`setDefaultProfileName`); apply preserves precedence + context (ties T4d/T4e).
**Behavior**:
- GIVEN: a saved standard or load-balancer profile
- WHEN: `agent.profiles.apply(name)` runs
- THEN: provider/model/params/auth match the profile AND chat is NOT reset
  (same context-preserving switch path as Phase 16)
**Why This Matters**: `/profile` is both a live-runtime command and a durable
app-service command; without this #1595 deep-imports the profile store.

## Implementation Tasks

### Files to Create / Modify

- `packages/agents/src/api/control/profiles.ts` — profiles sub-surface wrapping
  `applyProfileWithGuards` (runtime apply) + `profileSnapshot` durable ops
  (saveCurrent/create/delete/list/get/setDefault).
  - `@plan:PLAN-20260617-COREAPI.P19` + `@requirement:REQ-009`.

### Implementation Rules

- Profile apply uses the SAME context-preserving switch path as Phase 16 — no chat
  reset; the same `HistoryService` instance is reused (T4b ties to T4d/T4e).
- `saveCurrent` stores a key reference (from Phase 18 auth), never the raw secret.
- Applying standard AND load-balancer profiles preserves full precedence
  (auth-key-name/keyfile/base-url/model-params/preserved ephemerals).
- Call shipped functions via documented providers subpaths; do not re-implement.

## Verification Commands

```bash
set -e
missing=0
npm test -- --testNamePattern "@plan:.*P19"
npm test -- --testNamePattern "T18d\|T4b\b" || { echo "profile T-rows not green"; missing=1; }
exit $missing
```

### Deferred Implementation Detection (MANDATORY)

```bash
missing=0
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP)" packages/agents/src/api/control/profiles.ts | grep -v ".spec.ts" && { echo FAIL; missing=1; } || echo OK
grep -rnE "(in a real|for now|placeholder|not yet|will be)" packages/agents/src/api/control/profiles.ts | grep -v ".spec.ts" && { echo FAIL; missing=1; } || echo OK
exit $missing
```

### Semantic Verification Checklist

- [ ] profiles apply (standard + LB) preserves context, no chat reset (T18d/T4b)
- [ ] saveCurrent stores reference not secret
- [ ] Same HistoryService reused on apply (identity)
- [ ] Delegates to providers subpaths (no re-impl)

## Success Criteria

- Profiles CRUD + apply working; T18d/T4b green; no deferred-impl.

## Failure Recovery

- `git checkout -- packages/agents/src/api/control/profiles.ts`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P19.md`
