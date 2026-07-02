# Phase 09: Runtime Factory Contract Implementation (core single-source or drift guard)

## Phase ID
`PLAN-20260629-ISSUE2285.P09`

## Prerequisites
- Required: Phase 08a completed.
- Verification: `test -f project-plans/issue2285/.completed/P08a.md`.

## Purpose

Architect finding 3: the prior revision combined type-proof and production
changes for the runtime factory contract. P08 established the type-proof
(drift guard or migration proof); this phase applies the production change
based on the P08 proof.

## Requirements Implemented (Expanded)

### REQ-005.1/.2: Runtime Factory Contract Gate

**Full Text**: Duplicated `AgentRuntimeFactoryBindings` must be replaced by
one source of truth if dependency direction allows. Retained duplication is
acceptable only with a documented no-cycle decision record, comments at both
declarations referencing the drift guard, and a compile-time drift guard that
participates in `npm run typecheck` (NOT a `.test.ts` excluded from
`tsc --noEmit`). The plan must name the exact package/tsconfig command that
includes the guard and include a verifier step proving `npm run typecheck`
fails on drift.

**Behavior**:
- GIVEN: the type-proof (P08) is in place — either the migration proof
  (single-source) or the proven drift guard (retained-duplication).
- WHEN: the production change is applied.
- THEN: the duplication is eliminated (single-source) or the retained
  duplication is guarded with cross-referencing comments and the proven
  non-distributive drift guard.

## Decision (from preflight P01 + P08 type-proof)

**DEFAULT: core single-source.** Core already owns `AgentClientFactory`,
`ToolSchedulerFactory`, and `TaskToolRegistration`. Adding the structural
`AgentRuntimeFactoryBindings` interface to core alongside them is an additive,
non-breaking change. Both agents and providers already depend on core, so
there is no cycle.

### Single-source path (preferred default)

P08 documented the migration proof. This phase applies it:

1. Add `AgentRuntimeFactoryBindings` to the appropriate core module (alongside
   `AgentClientFactory`/`ToolSchedulerFactory`/`TaskToolRegistration`) and
   re-export it from core's public root surface.
2. Delete the agents-side and providers-side interface declarations; replace
   with `import type { AgentRuntimeFactoryBindings } from
   '@vybestack/llxprt-code-core'` at both sites.
3. No drift guard is needed (single source — nothing to drift).
4. Record the single-source decision in
   `runtime-factory-contract-decision.md`.

### Retained-duplication path (only if P01 proves a concrete blocker)

P08 created the drift guard with non-distributive tuple-wrapped equality
(architect finding 4). This phase applies the cross-referencing comments at
both declarations and finalizes the decision record.

#### Finding 4: non-distributive tuple-wrapped equality

The P08 drift guard uses **non-distributive** exact key-set equality. Naked
conditional types like `A extends B ? true : false` DISTRIBUTE over unions,
making the check imprecise. The P08 guard wraps the equality in a tuple to
prevent distribution:

```typescript
// Non-distributive: [X] extends [Y] prevents distribution over unions
type Equal<X, Y> =
  [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;

// Exact key-set: fails if either side has extra/missing members
const _sameKeys: Equal<keyof A, keyof B> = true;

// Per-key bidirectional: fails if any property type drifts
const _prop0: Equal<A['agentClientFactory'], B['agentClientFactory']> = true;
// ... one assertion per known member ...
```

This phase confirms the P08 guard uses this pattern and applies the
cross-referencing comments at both declarations.

## Implementation Tasks

### Single-source path (default)

#### Files to Modify
- The appropriate core module (alongside `AgentClientFactory`/
  `ToolSchedulerFactory`/`TaskToolRegistration`) — add the
  `AgentRuntimeFactoryBindings` interface.
- `packages/core/src/index.ts` (or the core root barrel) — ensure the
  interface is re-exported from the core root.
- `packages/agents/src/api/runtimeFactories.ts` — delete the local
  `interface AgentRuntimeFactoryBindings`; replace with
  `import type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core'`.
- `packages/providers/src/runtime/runtimeContextFactory.ts` — delete the local
  `interface AgentRuntimeFactoryBindings`; replace with
  `import type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core'`.

#### Files to Create
- `project-plans/issue2285/analysis/runtime-factory-contract-decision.md` —
  **architect review finding 1: P09 FINALIZES this record; it does NOT create
  it.** P01 created the decision record with the `decision:` line (and the
  intended `drift-guard-path:` for retained-duplication). P09 updates it with
  the APPLIED outcome: for single-source, documenting that core ownership is
  feasible (the default), single-source chosen, and no drift guard is needed
  (nothing to drift), referencing the P08 type-proof. For retained-duplication,
  P09 finalizes the `drift-guard-path:` line with the confirmed guard path and
  records the P08 drift-proof results.

### Retained-duplication path (only if P01 proves a concrete blocker)

#### Files to Modify
- `packages/agents/src/api/runtimeFactories.ts` — update EXISTING JSDoc to
  cross-reference the drift guard and the no-cycle/no-core decision record.
  Do NOT add new decorative `@plan` marker comment blocks (finding 5).
- `packages/providers/src/runtime/runtimeContextFactory.ts` — same
  cross-reference to EXISTING JSDoc. Do NOT add marker blocks (finding 5).

#### Files to Create
- `project-plans/issue2285/analysis/runtime-factory-contract-decision.md` —
  **architect review finding 1: P09 FINALIZES this record; it does NOT create
  it.** P01 created the decision record with the `decision:` line. P09
  finalizes it with:
  - confirmation of the machine-greppable `decision: retained-duplication`
    line (created in P01),
  - confirmation/finalization of the machine-greppable
    `drift-guard-path: <exact-relative-path>` line naming the drift-guard
    `.types.ts` file (P01 recorded the intended path; P08 created the guard;
    P09 confirms the final path) so verification reads the guard path from
    the record, not a hard-coded location (finding 14),
  - the dependency-direction evidence, the core-ownership evaluation, the
    CONCRETE BLOCKER proven by P01, the P08 drift-proof results, and the
    chosen (retained-duplication + exact drift guard with non-distributive
    equality) outcome with the exact typecheck command named.

### Marker Discipline (architect finding 5 + architect review finding 5)

Markers (`@plan`/`@requirement`) are RESTRICTED to test files and plan
artifacts. Do NOT add NEW `@plan:PLAN-20260629-ISSUE2285` marker comment blocks
to production source files (`runtimeFactories.ts`, `runtimeContextFactory.ts`,
core modules) or to the drift guard `.types.ts` file (which is typecheck
infrastructure, not a test file or plan artifact). The marker goes in the
decision-record analysis document only. Update only existing JSDoc where the
cross-reference to the drift guard is semantically relevant.

**Pre-existing marker debt (architect review finding 5):** production source
files may already contain `@plan`/`@requirement` markers from prior issues.
The policy prohibits only NEW issue2285 markers — it does NOT imply existing
markers must be removed unless the line they annotate is changed for issue
#2285 scope.

## Reachability

`createAgentRuntimeFactoryBindings` (agents) is called by the CLI composition
root. The drift guard (if retained-duplication) is reachable via
`npm run typecheck`.

## Verification Commands (revision 3 — findings 12, 13, 14: branch by recorded decision, robust import checks, guard path from decision record)

The verification MUST branch on the RECORDED DECISION in
`runtime-factory-contract-decision.md` (finding 12). The decision record must
contain a machine-greppable `decision: single-source` OR
`decision: retained-duplication` line, and for retained-duplication, the
exact drift-guard file path (finding 14). The verification reads the decision
and runs the matching branch; it does NOT unconditionally assert core imports.

```bash
# Decision record exists and declares a decision — fail-closed
test -f project-plans/issue2285/analysis/runtime-factory-contract-decision.md || { echo "FAIL: decision record missing"; exit 1; }
DECISION="$(grep -E '^decision:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md | head -1 | sed 's/^decision:[[:space:]]*//')"
test -n "$DECISION" || { echo "FAIL: decision record has no 'decision:' line"; exit 1; }
echo "Recorded decision: $DECISION"

# Declaration count (robust — counts via Node to avoid multiline/grep edge cases)
DECL_COUNT="$(node -e "
const { execSync } = require('child_process');
const out = execSync('grep -rln "interface AgentRuntimeFactoryBindings" packages/ --include=*.ts || true', {encoding:'utf8'}).split('
').filter(Boolean);
const fs = require('fs');
let n = 0;
for (const f of out) { if (f.includes('node_modules') || f.includes('dist')) continue; const s = fs.readFileSync(f, 'utf8'); if (/interface\s+AgentRuntimeFactoryBindings/.test(s)) n++; }
process.stdout.write(String(n));
")"

if [ "$DECISION" = "single-source" ]; then
  # Finding 12: single-source branch
  test "$DECL_COUNT" -eq 1 || { echo "FAIL: single-source decision but $DECL_COUNT declarations (expected 1)"; exit 1; }
  echo "OK: single-source ($DECL_COUNT declaration)"
  # Finding 13: robust multiline-aware core-import check via Node (NOT grep|grep)
  node -e "
const { execSync } = require('child_process');
const fs = require('fs');
const out = execSync('grep -rln "AgentRuntimeFactoryBindings" packages/agents/src packages/providers/src --include=*.ts || true', {encoding:'utf8'}).split('
').filter(Boolean);
let n = 0;
for (const f of out) {
  const s = fs.readFileSync(f, 'utf8');
  if (/import[\s\S]*?AgentRuntimeFactoryBindings[\s\S]*?from\s+['\"]@vybestack\/llxprt-code-core['\"]/.test(s)) n++;
}
if (n < 2) { console.error('FAIL: both packages must import AgentRuntimeFactoryBindings from core root (found '+n+')'); process.exit(1); }
console.log('OK: both packages import from core root ('+n+')');
"
elif [ "$DECISION" = "retained-duplication" ]; then
  # Finding 12: retained-duplication branch — do NOT assert core imports
  test "$DECL_COUNT" -ge 2 || { echo "FAIL: retained-duplication decision but $DECL_COUNT declarations (expected 2+)"; exit 1; }
  echo "OK: retained-duplication ($DECL_COUNT declarations)"
  # Finding 14: read the guard path from the decision record (NOT hard-coded)
  GUARD_PATH="$(grep -E '^drift-guard-path:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md | head -1 | sed 's/^drift-guard-path:[[:space:]]*//')"
  test -n "$GUARD_PATH" || { echo "FAIL: retained-duplication decision record missing 'drift-guard-path:' line"; exit 1; }
  test -f "$GUARD_PATH" || { echo "FAIL: drift guard file not found at recorded path: $GUARD_PATH"; exit 1; }
  echo "OK: drift guard present at recorded path: $GUARD_PATH"
  # Finding 13: robust check that the guard uses non-distributive equality (via Node read)
  node -e "
const fs=require('fs'); const s=fs.readFileSync('$GUARD_PATH','utf8');
if (!/\[.*\]\s+extends\s+\[.*\]|Equal</.test(s)) { console.error('FAIL: guard does not use non-distributive tuple-wrapped Equal'); process.exit(1); }
console.log('OK: guard uses non-distributive equality');
"
else
  echo "FAIL: unknown decision '$DECISION' (expected single-source or retained-duplication)"; exit 1
fi

# typecheck passes (fail-closed)
npm run typecheck
test $? -eq 0 || { echo "FAIL: typecheck"; exit 1; }

# eslint-guard (fail-closed)
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }

# No suppression directives in production source (fail-closed)
SUPP="$(grep -rn -E "(eslint-disable|ts-ignore|ts-expect-error|ts-nocheck)" packages/agents/src/api/runtimeFactories.ts packages/providers/src/runtime/runtimeContextFactory.ts packages/core/src 2>/dev/null || true)"
test -z "$SUPP" || { echo "FAIL: suppression directives in production source:"; echo "$SUPP"; exit 1; }

# No NEW issue2285 marker comment blocks in production source (finding 5 +
# architect review finding 5) — fail-closed. NOTE: this grep uses the
# PLAN-20260629-ISSUE2285 prefix so it does NOT match pre-existing markers
# from other issues (e.g. PLAN-20260610-ISSUE1592). Pre-existing markers are
# NOT to be removed unless the line they annotate changes for issue #2285 scope.
MARKERS="$(grep -rn "@plan:PLAN-20260629-ISSUE2285" packages/agents/src/api/runtimeFactories.ts packages/providers/src/runtime/runtimeContextFactory.ts packages/core/src 2>/dev/null || true)"
test -z "$MARKERS" || { echo "FAIL: NEW issue2285 marker comment blocks in production source:"; echo "$MARKERS"; exit 1; }
```

## Deferred Implementation Detection (revision 3 — finding 4: scoped to phase-owned files; revision 6 finding 9: exclude .md analysis docs; architect review finding 6: pre-phase baseline)

```bash
# Architect review finding 6: use git diff added-lines so only NEWLY
# INTRODUCED deferred language FAILS (pre-existing debt tolerated).
P09_FILES=""
for f in packages/agents/src/api/runtimeFactories.ts packages/providers/src/runtime/runtimeContextFactory.ts; do [ -f "$f" ] && P09_FILES="$P09_FILES $f"; done
NEW_DEFERRED="$(git diff -- $P09_FILES 2>/dev/null | grep '^+' | grep -v '^+++' | grep -iE '(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)' || true)"
test -z "$NEW_DEFERRED" || { echo "FAIL: newly introduced deferred language:"; echo "$NEW_DEFERRED"; exit 1; }
echo "OK: no newly introduced deferred language (pre-existing baseline tolerated)"
```

## Constraints (restate for the worker)

- NO `eslint-disable`, `ts-ignore`, `ts-expect-error`, `ts-nocheck`, lint
  severity downgrade, complexity threshold increase, or ignore expansion.
- The drift guard (if retained-duplication) must use NON-DISTRIBUTIVE
  tuple-wrapped equality (finding 4), established in P08.
- The drift guard MUST NOT be a `.test.ts` file.
- Core single-source is the default — only fall back to retained-duplication
  if P01 proves a concrete blocker.
- Do NOT add marker comment blocks to production source (finding 5).

## Success Criteria
- **Single-source (default)**: exactly one `AgentRuntimeFactoryBindings`
  declaration in core; both agents and providers import it from the core root;
  `npm run typecheck` passes; decision record documents the core-ownership
  choice and references the P08 type-proof.
- **Retained-duplication (fallback)**: P08 drift guard (non-distributive
  tuple-wrapped equality, finding 4) in place; cross-referencing comments at
  both declarations; `npm run typecheck` passes; decision record documents the
  concrete blocker and references P08 drift-proof.
- No marker comment blocks in production source (finding 5).
- No deferred language, no lint loosening.

## Failure Recovery

This phase does NOT use `git checkout` rollback for failure recovery. Instead:
- If the core single-source migration breaks typecheck: investigate which
  import/site fails and fix it in place.
- If the retained-duplication drift guard does not resolve: return to P08 to
  fix the guard placement or switch to the core single-source path.
- Report any blocking issue to the coordinator.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P09.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
