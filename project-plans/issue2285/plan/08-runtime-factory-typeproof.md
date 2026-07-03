# Phase 08: Runtime Factory Contract — Type-Proof/Drift-Guard Phase

## Phase ID
`PLAN-20260629-ISSUE2285.P08`

## Prerequisites
- Required: Phase 07a completed.
- Verification: `test -f project-plans/issue2285/.completed/P07a.md`.

## Purpose

Architect finding 3: the prior revision combined test/type-proof and
production changes for the runtime factory contract into a single phase,
weakening test-first sequencing. This phase establishes the type-proof (drift
guard or single-source migration proof) BEFORE P09 changes any production
interface declaration. The type-proof establishes the mechanical contract
that P09's production change must satisfy.

This phase is the TYPE-PROOF / GUARD phase. P09 applies the production change
(single-source migration or retained-duplication with the proven guard).

## Requirements Implemented (Expanded)

### REQ-005.1/.2: Runtime Factory Contract Gate (type-proof/guard first)

**Full Text**: Duplicated `AgentRuntimeFactoryBindings` must be replaced by
one source of truth if dependency direction allows. Retained duplication is
acceptable only with a documented no-cycle decision record, comments at both
declarations referencing the drift guard, and a compile-time drift guard that
participates in `npm run typecheck`.

**Behavior**:
- GIVEN: `AgentRuntimeFactoryBindings` is structurally re-declared in two
  packages — `packages/agents/src/api/runtimeFactories.ts` and
  `packages/providers/src/runtime/runtimeContextFactory.ts`. Both packages
  depend on `core`; agents depends on providers; providers does NOT depend on
  agents.
- WHEN: the type-proof/guard is established FIRST, BEFORE P09 changes any
  production interface declaration.
- THEN: the guard or migration-proof is in place, participating in
  `npm run typecheck`, and the drift detection is proven to catch both
  required and optional member drift (architect finding 4 — non-distributive
  tuple-wrapped equality).

**Why This Matters**: establishing the type-proof first means the verifier
can confirm the guard catches drift BEFORE the production interface changes.
P09 then migrates to single-source (making the guard unnecessary) or applies
the retained-duplication guard with confidence it works.

## Decision (from preflight P01)

**DEFAULT: core single-source.** Core already owns `AgentClientFactory`,
`ToolSchedulerFactory`, and `TaskToolRegistration`. Adding the structural
`AgentRuntimeFactoryBindings` interface to core alongside them is an additive,
non-breaking change. Both agents and providers already depend on core, so
there is no cycle.

P01 MUST attempt core ownership first and record the decision in
`runtime-factory-contract-decision.md` (machine-greppable `decision:` line).
Only if P01 documents a **concrete blocker** does this phase prepare a
retained-duplication drift guard.

**Revision 4 architect finding 5 (branch on recorded decision):** P08/P08a
verification MUST branch on the recorded decision. If `decision: single-source`,
this phase requires the single-source proof and does NOT require a drift guard.
If `decision: retained-duplication`, this phase requires the drift guard and
drift-proof and does NOT require the single-source proof. Prior revisions were
internally inconsistent: they said retained duplication is allowed if P01 proves
a blocker, but verification ALWAYS required the single-source proof to exist
AND pass, and expected exactly two declarations (contradicting
single-source). This revision fixes that contradiction by branching.

## Implementation Tasks

### Single-source path (preferred default — EXECUTABLE type-proof against REAL workspace)

**Revision 4 architect finding 6 (strengthen the proof):** the prior revision's
single-source proof created a TEMP FIXTURE core module rather than proving the
ACTUAL core package export path, actual package tsconfigs, and actual
agents/providers imports can compile under the real workspace typecheck. The
strengthened proof must verify the REAL target: the actual core module that
will receive the interface, the actual core root re-export path, and the actual
agents/providers tsconfigs — WITHOUT mutating production source.

**Revision 5 architect finding 4 (production-resolution dry run):** the
revision 4 proof still used temp copies and a temp path mapping for
`@vybestack/llxprt-code-core`, which does NOT prove the actual production
core export path and real package tsconfigs will typecheck after P09. The
strengthened proof uses a **disposable worktree** (a `git worktree add` of the
current branch to a temporary path, OR a recursive `cp` of the full repo to a
temp dir) so that the REAL workspace `tsconfig.json` path mappings, REAL
`node_modules` symlinks/links, and REAL package root barrels are all in place.
Inside the disposable copy, the proof makes the EXACT production changes P09
will make (add the interface to the real core module, add the re-export to the
real core root barrel, update the real agents/providers import sites), then
runs `npm run typecheck` against the disposable copy. This proves the exact
production-resolution path typechecks end-to-end — not a temp-fixture
approximation. The disposable copy is deleted on exit; production source is
never touched.

For the single-source path, this phase prepares an EXECUTABLE type-proof
WITHOUT changing production interface declarations (those change in P09):

#### Files to Create
- `project-plans/issue2285/analysis/runtime-factory-typeproof.md` — the
  migration proof documenting:
  1. The exact core module where the interface will be added (alongside
     `AgentClientFactory`/`ToolSchedulerFactory`/`TaskToolRegistration`).
  2. The exact core root re-export path.
  3. Proof that both agents and providers already depend on core (no cycle).
  4. The exact import statements that P09 will use at both sites.
  5. Confirmation that no drift guard is needed (single source — nothing to
     drift).

- `project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs` —
  the EXECUTABLE structural typecheck proof. **Revision 4 architect finding 6 +
  revision 5 architect finding 4**: this proof MUST verify the REAL production
  resolution path using a **disposable full-repo copy**, NOT a temp fixture
  with a temp path mapping. The script:
  1. Identifies the ACTUAL core module that will receive the interface (via
     `grep -rln "AgentClientFactory\|ToolSchedulerFactory\|TaskToolRegistration"
     packages/core/src`).
  2. Creates a **disposable full-repo copy** via one of:
     - `git worktree add --detach <tmp-worktree>` (preferred — shares the
       object store, fast, clean teardown via `git worktree remove`); OR
     - `cp -r <repo-root> <tmp-copy>` (fallback if worktree is unavailable;
       the copy must include `node_modules` symlinks or be re-linked via
       `npm ci` in the copy if needed).
     The disposable copy preserves the REAL workspace `tsconfig.json` path
     mappings, REAL package root barrels, and REAL inter-package dependency
     graph.
  3. Inside the disposable copy, makes the EXACT changes P09 will make:
     - Adds the proposed `AgentRuntimeFactoryBindings` interface to the real
       core module identified in step 1 (the COPY, not the original).
     - Adds the re-export to the REAL core root barrel (the COPY).
     - Updates the agents and providers import sites to import
       `AgentRuntimeFactoryBindings` from `@vybestack/llxprt-code-core` (the
       COPIES — using the REAL bare specifier, NOT a temp path mapping).
  4. Runs `npm run typecheck` (or `npx tsc -b` if the workspace typecheck is
     project-references based) in the disposable copy. This exercises the REAL
     production tsconfig resolution — the same resolution that P09's changes
     will undergo.
  5. Exits 0 if the disposable copy typechecks (the proposed core interface is
     structurally sound, the REAL core export path resolves, and the REAL
     agents/providers tsconfigs compile with the new import); exits nonzero
     otherwise.
  6. Cleans up the disposable copy (`git worktree remove --force` or `rm -rf`)
     on exit via a trap handler.
  This proves the proposed core interface resolves under the ACTUAL production
  workspace typecheck — the same resolution P09 will exercise — BEFORE P09
  touches production source. **Revision 5 architect finding 5 (marker policy):
  the executable `.mjs` proof script is MARKER-FREE.**
  `runtime-factory-single-source-proof.mjs` is an executable script — the same
  marker-free policy that applies to all executable scripts applies here.
  Attribution lives in the adjacent plan artifact
  (`runtime-factory-typeproof.md`), not in the executable file itself.
  Markers are restricted to test files and plan artifacts only.

#### Single-source executable proof (runs today, no production source edit)

```bash
# Decision branch (revision 4 finding 5): only run if single-source.
DECISION="$(grep -E '^decision:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md 2>/dev/null | head -1 | sed 's/^decision:[[:space:]]*//' || echo 'single-source')"
if [ "$DECISION" = "single-source" ]; then
  # Executable structural typecheck proof against the REAL workspace resolution
  # path (revision 4 finding 6 — no synthetic fixture disconnected from real packages).
  node project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs
  test $? -eq 0 || { echo "FAIL: single-source structural typecheck proof failed"; exit 1; }
else
  echo "Decision is retained-duplication — single-source proof not required (revision 4 finding 5)"
fi
```

Record the proof output in `runtime-factory-typeproof.md`. If the proof does
NOT typecheck, the proposed interface shape or re-export path is wrong — fix
the proof (and the documented shape/path) before P09. This is a BLOCKING
failure.

#### Files NOT to Modify (single-source path)
- `packages/core/src/*` — NOT modified in this phase. P09 adds the interface.
- `packages/agents/src/api/runtimeFactories.ts` — NOT modified.
- `packages/providers/src/runtime/runtimeContextFactory.ts` — NOT modified.

### Retained-duplication path (only if P01 proves a concrete blocker)

For the retained-duplication path, this phase WRITES the drift guard (the
type-proof) and PROVES it catches drift — BEFORE P09 applies the cross-
referencing comments to the production declarations.

#### Files to Create
- The compile-time drift guard `.types.ts` file in a proven-resolving location
  (see Guard-location note below). The guard uses **non-distributive
  tuple-wrapped equality** (architect finding 4) + bidirectional property compatibility.
- `project-plans/issue2285/analysis/runtime-factory-typeproof.md` — the
  type-proof document recording the drift-proof results.

#### Finding 4: non-distributive tuple-wrapped equality

The drift guard MUST use **non-distributive** exact key-set equality. Naked
conditional types like `A extends B ? true : false` DISTRIBUTE over unions,
making the check imprecise. Instead, wrap the equality in a tuple to prevent
distribution:

```typescript
import type { AgentRuntimeFactoryBindings as A } from '...agents...';
import type { AgentRuntimeFactoryBindings as B } from '...providers...';

// ── Exact key-set equality (NON-DISTRIBUTIVE: tuple-wrapped) ──
// Wrapping in [T] prevents distribution over unions so the check is exact.
type Equal<X, Y> =
  [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;

type KeysA = keyof A;
type KeysB = keyof B;

// If key-sets differ in EITHER direction, this resolves to false → type error.
const _sameKeys: Equal<KeysA, KeysB> = true;

// ── Per-key bidirectional assignability (NON-DISTRIBUTIVE) ──
// For each key K in KeysA, A[K] must be assignable to B[K] AND vice versa.
// This catches type-level drift on individual properties even if key-sets match.
type BiDirAssignable<K extends keyof A & keyof B> =
  Equal<A[K], B[K]>;

// Assert for every shared key (expand at the guard site for each known member)
const _prop0: BiDirAssignable<'agentClientFactory'> = true;
// ... one assertion per known member ...
```

The `Equal` helper uses `[X] extends [Y]` (tuple-wrapped) to prevent
distribution. Naked `X extends Y` would distribute over union-typed members
and silently pass when it should fail.

#### Guard-location note: guard location/import resolution

The agents tsconfig has NO providers path mapping. A guard in the agents
package that imports from providers via a bare specifier would fail to resolve.
Two acceptable placements:
- **(5a) Core single-source**: eliminates the need for the guard entirely
  (preferred — this is the default).
- **(5b) Guard in a stable non-test source path with proven resolution**: if
  retained duplication is required, the guard must be placed where it can
  import BOTH sides without a path-mapping failure. The worker MUST prove the
  guard resolves under `npm run typecheck` from a clean state (no prior
  `dist`/build artifacts) before relying on it. The guard MUST be a `.types.ts`
  (typecheck-included), NOT a `.test.ts` (which is excluded from `tsc --noEmit`).

#### Drift-proof (retained-duplication path — fixture-based, NO production source mutation, revision 3 finding 18: Node-generated fixtures, not sed)

The drift proof MUST NOT edit production source files
(`runtimeFactories.ts`, `runtimeContextFactory.ts`). Instead it uses a
temporary fixture directory containing COPIES of the two declarations plus the
drift guard, perturbs the COPIES, and confirms typecheck FAILS. The production
source is never touched. **Revision 3 (finding 18): the fixture files and the
perturbations are generated by a Node script, NOT by `sed -i` (which is
nonportable across macOS/GNU sed and brittle). The Node script reads the copy,
injects the drift probe member programmatically, and writes the perturbed
fixture.**

```bash
# Fixture-based drift proof (revision 3 finding 18 — Node-generated perturbations).
# 1. Create a temp fixture with COPIES of both declarations + the drift guard.
TMPDIR_DRIFT="$(mktemp -d)"
mkdir -p "$TMPDIR_DRIFT/agents" "$TMPDIR_DRIFT/providers"
cp packages/agents/src/api/runtimeFactories.ts "$TMPDIR_DRIFT/agents/" 2>/dev/null || true
cp packages/providers/src/runtime/runtimeContextFactory.ts "$TMPDIR_DRIFT/providers/" 2>/dev/null || true
# Copy the drift guard into the fixture as well.
cp <guard-file-path> "$TMPDIR_DRIFT/" 2>/dev/null || true
# 2. Perturb the fixture COPY via Node (add a REQUIRED member to the agents-side copy).
node -e "
const fs=require('fs'), p='$TMPDIR_DRIFT/agents/runtimeFactories.ts';
let s=fs.readFileSync(p,'utf8');
s=s.replace(/}(?=\s*(?:export|$))/, '  __driftProbeRequired: string;
}');
fs.writeFileSync(p, s);
"
# 3. Typecheck the fixture — MUST fail (exact key-set detects extra member).
npx tsc --noEmit --strict "$TMPDIR_DRIFT"/*.ts "$TMPDIR_DRIFT"/agents/*.ts "$TMPDIR_DRIFT"/providers/*.ts 2>/dev/null
test $? -ne 0 || { echo "FAIL: drift guard did not catch REQUIRED member drift"; rm -rf "$TMPDIR_DRIFT"; exit 1; }
# 4. Restore the fixture copy, perturb with an OPTIONAL member (via Node).
cp packages/agents/src/api/runtimeFactories.ts "$TMPDIR_DRIFT/agents/"
node -e "
const fs=require('fs'), p='$TMPDIR_DRIFT/agents/runtimeFactories.ts';
let s=fs.readFileSync(p,'utf8');
s=s.replace(/}(?=\s*(?:export|$))/, '  __driftProbeOptional?: string;
}');
fs.writeFileSync(p, s);
"
# 5. Typecheck the fixture — MUST STILL fail (exact key-set catches optional
#    drift; naked distributing conditionals would MISS this — finding 4).
npx tsc --noEmit --strict "$TMPDIR_DRIFT"/*.ts "$TMPDIR_DRIFT"/agents/*.ts "$TMPDIR_DRIFT"/providers/*.ts 2>/dev/null
test $? -ne 0 || { echo "FAIL: drift guard did not catch OPTIONAL member drift (naked distributing conditionals?)"; rm -rf "$TMPDIR_DRIFT"; exit 1; }
# 6. Cleanup the temp fixture (production source was never touched).
rm -rf "$TMPDIR_DRIFT"
echo "OK: drift guard catches both required and optional member drift"
```

Record the fixture PASS→FAIL(required)→FAIL(optional)→clean-cleanup output in
`runtime-factory-typeproof.md`. This proves the guard catches BOTH required
and optional extra-member drift using non-distributive tuple-wrapped equality
WITHOUT editing any package source.

### Files NOT to Modify
- `packages/agents/src/api/runtimeFactories.ts` — the production interface
  declaration is NOT modified in this phase. P09 applies the single-source
  migration or the cross-referencing comments.
- `packages/providers/src/runtime/runtimeContextFactory.ts` — same.
- `packages/core/src/*` — NOT modified in this phase (P09 adds the interface
  for the single-source path).

### Required Code Markers (plan artifacts only — NOT executable scripts or production source)

```typescript
/**
 * @plan PLAN-20260629-ISSUE2285.P08
 * @requirement REQ-005
 */
```

The marker goes in the type-proof analysis document
(`runtime-factory-typeproof.md`) and, if the retained-duplication path is
chosen, in the drift-guard `.types.ts` file (which is typecheck infrastructure,
not production logic). Do NOT add marker comment blocks to:
- production source files (`runtimeFactories.ts`,
  `runtimeContextFactory.ts`, core modules) — architect finding 5
- executable `.mjs` scripts (`runtime-factory-single-source-proof.mjs`) —
  revision 5 architect finding 5: executable scripts are marker-free;
  attribution lives in the adjacent `.md` plan artifact

Markers are restricted to test files (`.test.ts`, `.spec.ts`) and plan
artifacts (`.md`) only.

## Reachability

`createAgentRuntimeFactoryBindings` (agents) is called by the CLI composition
root. The drift guard (if retained-duplication) is reachable via
`npm run typecheck`. This is not an isolated feature.

## Verification Commands

```bash
# Type-proof document exists — fail-closed
test -f project-plans/issue2285/analysis/runtime-factory-typeproof.md || { echo "FAIL: type-proof doc missing"; exit 1; }

# Revision 4 architect finding 5: BRANCH on the recorded decision. The decision
# record (created in P01) is the single source of truth for which path was
# chosen. Do NOT require both unconditionally.
test -f project-plans/issue2285/analysis/runtime-factory-contract-decision.md || { echo "FAIL: decision record missing (P01 must create it)"; exit 1; }
DECISION="$(grep -E '^decision:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md | head -1 | sed 's/^decision:[[:space:]]*//' 2>/dev/null || echo '')"
test -n "$DECISION" || { echo "FAIL: decision record has no 'decision:' line"; exit 1; }
echo "Recorded decision: $DECISION"

if [ "$DECISION" = "single-source" ]; then
  # Single-source path: EXECUTABLE proof against REAL workspace (finding 6) — fail-closed
  test -f project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs || { echo "FAIL: single-source proof script missing"; exit 1; }
  node project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs
  test $? -eq 0 || { echo "FAIL: single-source executable proof failed"; exit 1; }
  # Migration proof documents the target (fail-closed)
  grep -q "core" project-plans/issue2285/analysis/runtime-factory-typeproof.md || { echo "FAIL: type-proof doc missing core target"; exit 1; }
  echo "OK: single-source path verified (proof + type-proof doc)"
elif [ "$DECISION" = "retained-duplication" ]; then
  # Retained-duplication path: drift guard + drift-proof required — fail-closed
  # (revision 4 finding 5: do NOT require the single-source proof here)
  GUARD_PATH="$(grep -E '^drift-guard-path:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md | head -1 | sed 's/^drift-guard-path:[[:space:]]*//')"
  test -n "$GUARD_PATH" || { echo "FAIL: retained-duplication decision missing 'drift-guard-path:' line"; exit 1; }
  test -f "$GUARD_PATH" || { echo "FAIL: drift guard not found at recorded path: $GUARD_PATH"; exit 1; }
  # Guard uses non-distributive tuple-wrapped equality (finding 4)
  EQUAL_GUARD="$(grep -rn "\[.*\] extends \[.*\]\|Equal<" "$GUARD_PATH" || true)"
  EQUAL_DOC="$(grep -c "\[.*\] extends \[.*\]\|Equal<" project-plans/issue2285/analysis/runtime-factory-typeproof.md || true)"
  test -n "$EQUAL_GUARD" -o "$EQUAL_DOC" -ge 1 || { echo "FAIL: retained-duplication but no non-distributive tuple-wrapped Equal pattern"; exit 1; }
  # Revision 6 architect finding 4: EXECUTE the drift-perturbation proof here,
  # not just check for the guard file and Equal pattern. The prior revision's
  # verification commands only checked for the guard file + tuple-wrapped Equal
  # pattern + normal typecheck — without actually perturbing declarations and
  # proving typecheck fails. This is the same fixture-based drift proof from
  # the implementation section, executed as a concrete verification step.
  TMPDIR_DRIFT_V="$(mktemp -d)"
  mkdir -p "$TMPDIR_DRIFT_V/agents" "$TMPDIR_DRIFT_V/providers"
  cp packages/agents/src/api/runtimeFactories.ts "$TMPDIR_DRIFT_V/agents/" 2>/dev/null || true
  cp packages/providers/src/runtime/runtimeContextFactory.ts "$TMPDIR_DRIFT_V/providers/" 2>/dev/null || true
  cp "$GUARD_PATH" "$TMPDIR_DRIFT_V/" 2>/dev/null || true
  # Required member perturbation (via Node — finding 18)
  node -e "
const fs=require('fs'), p=process.argv[1]+'/agents/runtimeFactories.ts';
let s=fs.readFileSync(p,'utf8');
s=s.replace(/}(?=\s*(?:export|$))/, '  __driftProbeRequired: string;\n}');
fs.writeFileSync(p, s);
" "$TMPDIR_DRIFT_V"
  npx tsc --noEmit --strict "$TMPDIR_DRIFT_V"/*.ts "$TMPDIR_DRIFT_V"/agents/*.ts "$TMPDIR_DRIFT_V"/providers/*.ts 2>/dev/null
  test $? -ne 0 || { echo "FAIL: drift guard did not catch REQUIRED member drift (revision 6 finding 4)"; rm -rf "$TMPDIR_DRIFT_V"; exit 1; }
  # Optional member perturbation (finding 4 — naked distributing conditionals miss this)
  cp packages/agents/src/api/runtimeFactories.ts "$TMPDIR_DRIFT_V/agents/"
  node -e "
const fs=require('fs'), p=process.argv[1]+'/agents/runtimeFactories.ts';
let s=fs.readFileSync(p,'utf8');
s=s.replace(/}(?=\s*(?:export|$))/, '  __driftProbeOptional?: string;\n}');
fs.writeFileSync(p, s);
" "$TMPDIR_DRIFT_V"
  npx tsc --noEmit --strict "$TMPDIR_DRIFT_V"/*.ts "$TMPDIR_DRIFT_V"/agents/*.ts "$TMPDIR_DRIFT_V"/providers/*.ts 2>/dev/null
  test $? -ne 0 || { echo "FAIL: drift guard did not catch OPTIONAL member drift (revision 6 finding 4)"; rm -rf "$TMPDIR_DRIFT_V"; exit 1; }
  rm -rf "$TMPDIR_DRIFT_V"
  echo "OK: retained-duplication path verified (drift guard catches required + optional drift — revision 6 finding 4)"
else
  echo "FAIL: unknown decision '$DECISION' (expected single-source or retained-duplication)"; exit 1
fi

# typecheck passes (guard resolves if present, no production change yet, fail-closed)
npm run typecheck
test $? -eq 0 || { echo "FAIL: typecheck"; exit 1; }

# Revision 6 architect finding 5: deferred-language scan is decision-dependent.
# The single-source proof artifact only exists when decision is single-source.
# Scanning for it unconditionally (as the prior revision did) causes a spurious
# grep error when retained-duplication is chosen and the file does not exist.
# Revision 6 finding 9: .md analysis docs are excluded (planning vocabulary).
PROOF_FILES=""
if [ "$DECISION" = "single-source" ]; then
  PROOF_FILES="project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs"
elif [ "$DECISION" = "retained-duplication" ]; then
  PROOF_FILES="$GUARD_PATH"
fi
if [ -n "$PROOF_FILES" ]; then
  DEFERRED="$(grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" $PROOF_FILES || true)"
  test -z "$DEFERRED" || { echo "FAIL: deferred language:"; echo "$DEFERRED"; exit 1; }
fi

# Revision 6 architect finding 5: marker-free check is decision-dependent.
# Only check the single-source proof script if it exists (single-source path).
if [ "$DECISION" = "single-source" ] && [ -f project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs ]; then
  grep -E "@plan:|@requirement:" project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs && { echo "FAIL: executable .mjs proof script has markers (revision 5 finding 5)"; exit 1; } || echo "OK: .mjs proof script is marker-free"
fi

# eslint-guard (fail-closed)
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }
```

## Deferred Implementation Detection (revision 6 finding 5: decision-dependent artifact set; revision 6 finding 9: exclude .md analysis docs)

```bash
# Fail-closed — scans ONLY the executable artifacts that exist for the recorded
# decision. The prior revision unconditionally scanned
# runtime-factory-single-source-proof.mjs which does not exist when
# retained-duplication is chosen. Revision 6 finding 9: .md analysis docs are
# excluded because they legitimately contain planning vocabulary.
DECISION_RD="$(grep -E '^decision:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md 2>/dev/null | head -1 | sed 's/^decision:[[:space:]]*//' || echo '')"
PROOF_FILES=""
if [ "$DECISION_RD" = "single-source" ]; then
  PROOF_FILES="project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs"
elif [ "$DECISION_RD" = "retained-duplication" ]; then
  GUARD_PATH_RD="$(grep -E '^drift-guard-path:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md | head -1 | sed 's/^drift-guard-path:[[:space:]]*//')"
  PROOF_FILES="$GUARD_PATH_RD"
fi
if [ -n "$PROOF_FILES" ]; then
  DEFERRED="$(grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)" $PROOF_FILES || true)"
  test -z "$DEFERRED" || { echo "FAIL: deferred language:"; echo "$DEFERRED"; exit 1; }
fi
```

## Constraints (restate for the worker)

- NO `eslint-disable`, `ts-ignore`, `ts-expect-error`, `ts-nocheck`, lint
  severity downgrade, complexity threshold increase, or ignore expansion.
- The drift guard (if retained-duplication) must use NON-DISTRIBUTIVE
  tuple-wrapped equality (finding 4), not naked conditional types that
  distribute over unions.
- The drift guard MUST NOT be a `.test.ts` file (excluded from `tsc --noEmit`).
- Core single-source is the default — only fall back to retained-duplication
  if P01 proves a concrete blocker.
- This phase does NOT modify production interface declarations (those change
  in P09).

## Success Criteria
- **Revision 4 architect finding 5**: the phase branches on the recorded
  decision and succeeds for the matching path only:
- **Single-source (default)**: migration proof document created documenting the
  exact core target, re-export path, no-cycle proof, and P09 import plan.
  **EXECUTABLE structural typecheck proof** against the REAL workspace
  (`runtime-factory-single-source-proof.mjs` — revision 4 finding 6 + revision
  5 finding 4: uses a **disposable full-repo worktree/copy** making the EXACT
  P09 production changes (add interface to real core module, re-export from
  real core root barrel, update real agents/providers imports via REAL bare
  specifier), then runs `npm run typecheck` against the disposable copy — NOT a
  temp fixture with temp path mappings). Created and passing. **Marker-free**
  (revision 5 finding 5 — executable `.mjs` script, no `@plan`/`@requirement`
  markers; attribution in `runtime-factory-typeproof.md`).
  `npm run typecheck` passes (no production change yet). No drift guard
  required.
- **Retained-duplication (fallback)**: drift guard `.types.ts` created with
  non-distributive tuple-wrapped equality (finding 4) in a proven-resolving
  location (Guard-location note); **fixture-based** drift-proof catches both
  required AND optional member drift (no production source mutation);
  `npm run typecheck` passes in committed state; type-proof document
  records the drift-proof results. Single-source proof NOT required.
- No deferred language, no lint loosening, no suppression directives.

## Failure Recovery

This phase does NOT use `git checkout` rollback for failure recovery. Instead:
- If the drift guard does not resolve (Guard-location note): the guard location is wrong
  — move it to a package whose tsconfig resolves both sides, or switch to the
  core single-source path.
- If the drift proof does not catch optional-member drift (finding 4): the
  guard is using naked conditional types (distributing). Upgrade to
  tuple-wrapped `Equal` and re-run.
- Report any blocking issue to the coordinator.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P08.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
