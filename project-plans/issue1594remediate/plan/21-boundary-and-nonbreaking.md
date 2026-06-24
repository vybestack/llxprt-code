<!-- @plan:PLAN-20260621-COREAPIREMED.P21 @requirement:REQ-006,REQ-INT-004 -->
# Phase 21: No-Deep-Import Boundary + Full Non-Breaking Characterization

## Phase ID

`PLAN-20260621-COREAPIREMED.P21`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 20a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P20a.md`

## Requirements Implemented (Expanded)

### REQ-006: Non-breaking guarantee

**Full Text**: The remediation MUST be purely additive. The shipped
`createAgent(AgentConfig): Promise<Agent>` signature and behavior, every current public export, and
every current `./internals.js` / `./app-service.js` export MUST keep working unchanged.
**Behavior**:
- GIVEN: a consumer written against the #1594 public surface
- WHEN: this remediation lands
- THEN: that consumer compiles and behaves identically (no removed/renamed/retyped export)
**Why This Matters**: existing #1594 consumers (and the in-flight a2a server) must not break.

### REQ-INT-004: No-deep-import boundary

**Full Text**: The PUBLIC-CONSUMER path (Path A — the `fromConfig`/`agent.stream` surface under test
AND the eventual #1595 production CLI) MUST be reachable using ONLY the public root
(`@vybestack/llxprt-code-agents`) and NON-internals documented subpaths (e.g. `/app-service.js`);
Path A MUST NOT import `./internals.js`. The documented `./internals.js` subpath is reserved for the
TEST-ONLY reference-drive path (Path B — the comparison `AgenticLoop` drive) when a public re-export
is unavailable; it is NOT part of the Path A public-consumer contract. No path (Path A or Path B) may
ever import `/src/`, `core/src`, or `providers/src`.
**Behavior**:
- GIVEN: the remediated surface
- WHEN: a Path A consumer imports everything #1595 needs
- THEN: every import resolves from the public root (or a non-internals documented subpath) — never
  `./internals.js`, and never `/src/`, `core/src`, or `providers/src`
- AND: the only `./internals.js` consumer permitted anywhere in the remediated set is the single
  Path B reference-drive file
**Why This Matters**: deep imports are exactly what #1595 must eliminate; the public API must make
them unnecessary, and Path A must not lean on internals.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts` — a comprehensive
  characterization test that snapshots the FULL set of public root exports (and the
  `./internals.js` re-export list relevant to this change) and asserts every #1594-era symbol is
  still present with a compatible shape. Marker `@plan:PLAN-20260621-COREAPIREMED.P21`,
  `@requirement:REQ-006`.
- `packages/agents/src/api/__tests__/boundary.adequacy.test.ts` — a static scan over the
  remediation's harness + any new public modules asserting only public specifiers are imported
  (the executable form of REQ-INT-004 across the whole remediated set, not just one file). It MUST
  encode the Path A vs Path B distinction (MIN-3): the PUBLIC-AGENT path under test (the
  `agent.stream`/`fromConfig` side — and the eventual #1595 production CLI) imports ONLY the curated
  public root `@vybestack/llxprt-code-agents` (no `./internals.js`, no `/src/`); the TEST-ONLY
  reference-drive path (the comparison `AgenticLoop`) MAY import the public root or the documented
  `./internals.js` subpath, but NEVER a deep `/src/`/`core/src`/`providers/src` import. The scan
  asserts BOTH: (a) no file in the set deep-imports `/src/`/`core/src`/`providers/src` (Path A AND
  Path B); (b) NO Path-A (agent-under-test / production-like) file imports `./internals.js` — the
  ONLY permitted `./internals.js` consumer is the single reference-drive file (Path B), identified by
  the `*.reference-drive.*` filename convention. The in-test scan MUST use this same convention so it
  agrees with the shell boundary scan below.

### Files to Modify

- None in production unless the boundary scan reveals a leak introduced by this plan; if so, route
  the symbol through the public root / documented subpath (additive) and record it here.

### Constraints

- Characterization enumerates the actual current exports (read from `api/index.ts` and
  `internals.ts`); does NOT hardcode a guessed list.
- No mock theater; behavioral/structural-identity assertions only.
- MIN-3 (Path A vs Path B): the boundary scan permits the TEST-ONLY reference-drive side to import
  the documented `./internals.js` subpath for comparison, but the PUBLIC-AGENT path under test (and
  the eventual #1595 production CLI) MUST import ONLY the curated public root. Neither path may use a
  deep `/src/`/`core/src`/`providers/src` import.

## Verification Commands

```bash
set -e
set -o pipefail   # MIN-1: a piped test/typecheck FAILURE must propagate (not be masked by tail)
test -f packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts
test -f packages/agents/src/api/__tests__/boundary.adequacy.test.ts
# Whole-package boundary: no new deep imports introduced by this plan's test/helper set (BLOCKING)
# Deep '/src/' paths are forbidden EVERYWHERE (Path A AND Path B).
if grep -rnE "from '[^']*(/src/|core/src|providers/src)" packages/agents/src/api/__tests__/ | grep -vE "node_modules"; then
  echo "FAIL: deep import present in test/helper surface"; exit 1
fi
# CRIT-6: Path A (production-like / agent-under-test) files MUST NOT import './internals.js'.
# TWO categories of TEST-ONLY meta files are the permitted './internals.js' consumers (neither is a
# Path-A public-consumer surface):
#   (1) the reference drive (Path B), named '*.reference-drive.*' — the comparison AgenticLoop drive
#       when a public re-export is unavailable; and
#   (2) the non-breaking export-surface characterization test(s), named '*nonbreaking*'/'*nonBreaking*'
#       — these EXIST to assert (REQ-006) that the './internals.js' subpath STILL exports its
#       #1594-era symbols (e.g. AgentClient/PostTurnAction), which is ONLY provable by importing the
#       subpath at runtime. They do NOT drive an agent; they introspect the export surface itself, so
#       they are neither Path A (consumer) nor Path B (reference drive).
# EVERY OTHER parity/adequacy harness file is treated as Path A and is FORBIDDEN from importing
# './internals.js'. (The in-test boundary.adequacy.test.ts MUST encode this SAME exemption set.)
PATHA_INTERNALS=$(grep -rlnE "from '@vybestack/llxprt-code-agents/internals(\.js)?'|from '\.\./internals(\.js)?'|from '\./internals(\.js)?'" \
  packages/agents/src/api/__tests__/ 2>/dev/null | grep -vE "\.reference-drive\.|[Nn]on[Bb]reaking" || true)
if [ -n "$PATHA_INTERNALS" ]; then
  echo "FAIL: Path-A (production-like) harness file imports './internals.js' (only the *.reference-drive.* drive or a *nonbreaking* export-surface characterization may):"; echo "$PATHA_INTERNALS"; exit 1
fi
echo "OK: Path A imports only the curated public root; './internals.js' confined to the reference drive + non-breaking export-surface characterization."
npx vitest run packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts packages/agents/src/api/__tests__/boundary.adequacy.test.ts 2>&1 | tail -30
npm run typecheck
```

### Deferred Implementation Detection (BLOCKING)

```bash
if grep -rnE "(TODO|FIXME|HACK|STUB|XXX|placeholder|for now|in a real)" packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts packages/agents/src/api/__tests__/boundary.adequacy.test.ts; then
  echo "FAIL: deferred-implementation marker present"; exit 1
fi
echo "no deferred-implementation patterns"
```

### Semantic Verification Checklist

- [ ] Characterization enumerates every current root export and asserts presence/compatible shape.
- [ ] `createAgent(AgentConfig)` signature unchanged (asserted by a compiling usage).
- [ ] `fromConfig` is a SEPARATE export, not an overload that altered `createAgent`'s type.
- [ ] Boundary test scans the whole remediated set and passes.
- [ ] Path A asserted: no deep `/src/` anywhere; no Path-A (production-like) file imports
      `./internals.js` (only the `*.reference-drive.*` Path-B file may).

## Success Criteria

- Non-breaking characterization + boundary tests pass; no deep imports introduced.

## Failure Recovery

- If a removed/renamed export is detected, restore it additively; if a deep import leaked, route it
  through the public surface.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P21.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P21
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```
