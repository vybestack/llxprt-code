# Phase 09: Harness Layer 1 — Static / Boundary (T17, T23, T24) [RED]

## Phase ID

`PLAN-20260617-COREAPI.P09`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 08a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P08a.md`

## Requirements Implemented (Expanded)

### REQ-019: No-deep-import / package-boundary guard (T17)

**Full Text**: A static check (AST scan / lint) asserts the harness (and, as #1595's
gate, the CLI) imports ONLY the public entry + documented subpaths — no `…/dist/…` or
deep `src` internal imports.
**Behavior**: GIVEN the harness sources, WHEN scanned, THEN only
`@vybestack/llxprt-code-agents` and documented subpaths appear.

**Why This Matters**: This is the enforceable guard that keeps #1595 from quietly
recreating deep internal imports after the public API exists.

### REQ-021: Runtime-vs-app-service boundary (T23, T24)

**Full Text**: Durable mutations (`/mcp add|remove`, `/extensions`, `/skills`,
`/memory`, settings mutation, diagnostics) resolve to **importable public subpaths**
(not the runtime Agent); completion data is reachable via a documented public path or
explicitly classified CLI-local. The command→API map has no orphan.
**Behavior**: GIVEN the command→API map, WHEN tested, THEN every durable command and
completion entry resolves to a public, importable path.

**Why This Matters**: Durable app-service concerns must have public import paths
without bloating the live Agent runtime facade.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/boundary.spec.ts` — T17: AST/scan test asserting
  consumer-facing API/harness test files import only the public root entry and documented
  app-service subpaths. Helper files under `__tests__/helpers/` may import
  `@vybestack/llxprt-code-agents/internals.js` only for fixture construction (FakeProvider,
  scheduler, MessageBus) and never to perform the behavior under test.
  - `@plan:PLAN-20260617-COREAPI.P09` `@requirement:REQ-019`
- `packages/agents/src/api/__tests__/app-service-boundary.spec.ts` — T23/T24:
  contract test that each durable command in the command→API map resolves to an
  importable public subpath; completion boundary classified.
  - `@plan:PLAN-20260617-COREAPI.P09` `@requirement:REQ-021`
- `packages/agents/src/api/__tests__/command-api-map.ts` — the command→API map data
  (slash command → method | subpath | CLI-local) consumed by the test. NOTE: app
  -service subpaths themselves are IMPLEMENTED in P27; here the test encodes the
  expected mapping and FAILS until P27 provides the subpaths.

### Test Rules (RULES.md)

- Behavioral: assert resolvability/imports + absence of deep imports (real file
  scan), never "method was called".
- These tests MUST FAIL naturally now (subpaths/map targets not implemented yet) —
  NOT a reverse test (do not assert NotYetImplemented).
- Tag each `it(...)` with `@plan:` + `@requirement:` markers.

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P09"
# Expect: tests RUN and FAIL naturally (missing subpaths), not "cannot find module" for the harness itself
grep -rc "@plan:PLAN-20260617-COREAPI.P09" packages/agents/src/api/__tests__/
grep -rn "toThrow('NotYetImplemented')\|not\.toThrow" packages/agents/src/api/__tests__/ && echo "FAIL reverse test" || echo "OK"
```

### Semantic Verification Checklist

- [ ] T17 scans real imports: consumer-facing tests use curated/app-service imports only; helper-only `./internals.js` imports are allowed solely for fixture construction; no deep `src`/`dist` imports
- [ ] T23/T24 encode the full command→API map (no orphan command)
- [ ] Tests fail naturally (not reverse tests)

## Success Criteria

- Layer-1 tests exist, tagged, fail naturally pending P27.

## Failure Recovery

- `git checkout -- packages/agents/src/api/__tests__/`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P09.md`
