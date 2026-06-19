# Phase 28: Docs — docs/agent-api.md [REQ-020]

## Phase ID

`PLAN-20260617-COREAPI.P28`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 27a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P27a.md`

## Requirements Implemented (Expanded)

### REQ-020: docs/agent-api.md

**Full Text**: A documented public API guide covering: `createAgent`/`AgentConfig`;
the `Agent` control plane (all sub-surfaces); the `AgentEvent` union + DoneReason +
exactly-one-done invariant + terminal-vs-intermediate table; auth precedence;
context-preservation guarantee; the non-breaking root entry vs `./internals.js` power-user
subpath + documented providers/core subpaths; the runtime-vs-app-service boundary +
command→API map; quick-start example (createAgent + stream).

**Naming (B11):** the doc is `docs/agent-api.md` and its FIRST section MUST state
explicitly that the public API is exported from `@vybestack/llxprt-code-agents` (NOT
`-core`); the old "core API" wording is rejected (it would imply a `core → agents`
cycle).

**Behavior**:
- GIVEN a user wants to consume the public Agent API
- WHEN they read `docs/agent-api.md`
- THEN they can identify the correct package entry, create an Agent, consume events,
  use control sub-surfaces, understand auth/profile/sandbox boundaries, and avoid
  deep/internal imports

**Why This Matters**: The API is only usable outside the CLI if consumers have a
clear stable contract and know which internals are intentionally excluded.

## Implementation Tasks

### Files to Create

- `docs/agent-api.md` — the guide above. Examples MUST compile against the shipped API
  (provider:'fake' or documented injection for runnable snippets).
  - `@plan:PLAN-20260617-COREAPI.P28` + `@requirement:REQ-020`.

### Implementation Rules

- Document decisions made for the overview open questions (entry wording =
  `@vybestack/llxprt-code-agents`, control-plane scope, sub-surface publicness,
  **no-handler confirmation = safe denial matching `AgenticLoop` (B7), NOT throw on
  the public path**, idle-timeout terminal, stats source =
  `@vybestack/llxprt-code-core/telemetry/uiTelemetry.js`, core/index trim sequenced
  into #1595).
- Document the unstable `settings` escape hatch as NOT semver-covered.

## Verification Commands

```bash
test -f docs/agent-api.md && echo OK || { echo FAIL; exit 1; }
grep -q "@vybestack/llxprt-code-agents" docs/agent-api.md || { echo "FAIL: entry pkg not stated"; exit 1; }
grep -c "createAgent\|AgentEvent\|DoneReason\|internals.js" docs/agent-api.md
grep -c "@plan:PLAN-20260617-COREAPI.P28" docs/agent-api.md
```

## Semantic Verification Checklist

- [ ] First section states entry is `@vybestack/llxprt-code-agents` (not core)
- [ ] Quick-start example present and accurate
- [ ] AgentEvent union + DoneReason + invariant documented
- [ ] Auth precedence + context-preservation documented
- [ ] No-handler confirmation documented as safe denial (B7), not throw
- [ ] Subpath strategy + runtime-vs-app boundary documented
- [ ] Open-question decisions recorded with rationale

## Success Criteria

- docs/agent-api.md complete and accurate; covers REQ-020.

## Failure Recovery

- `git checkout -- docs/agent-api.md`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P28.md`
