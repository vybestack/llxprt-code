# Phase 08a: Runtime Factory Contract Type-Proof/Drift-Guard Verification

## Phase ID
`PLAN-20260629-ISSUE2285.P08a`

## Prerequisites
- Required: Phase 08 completed.
- Verification: `test -f project-plans/issue2285/.completed/P08.md`.

## Verification Tasks

The deepthinker verifier confirms:

### Revision 4 architect finding 5: branch on the recorded decision

The decision record (`runtime-factory-contract-decision.md`, created in P01)
is the single source of truth. The verifier reads the `decision:` line and
runs the matching branch. It does NOT require both paths' artifacts
unconditionally.

### Single-source path (if `decision: single-source`)

1. **Migration proof document exists** documenting the exact core target
   module, re-export path, no-cycle proof, and P09 import plan.
2. **EXECUTABLE structural typecheck proof exists and passes against the REAL
   production resolution path** (revision 4 finding 6 + revision 5 architect
   finding 4): the file
   `project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs`
   exists, is runnable, and passes — it uses a **disposable full-repo
   worktree/copy** to make the EXACT production changes P09 will make (add the
   interface to the real core module, add the re-export to the real core root
   barrel, update agents/providers imports via the REAL bare specifier), then
   runs `npm run typecheck` in the disposable copy. This proves the actual
   production core export path and real package tsconfigs typecheck — not a
   temp-fixture approximation with a temp path mapping. No production source
   mutation (the disposable copy is deleted on exit).
3. **No production interface change** in this phase — the interface is NOT
   yet in core; the declarations in agents and providers are unchanged.
4. **`npm run typecheck` passes** (no production change yet).
5. **No drift guard required** (single source — nothing to drift).
6. **No deferred language** added by this phase.
7. **No lint loosening / suppression directives**.

### Retained-duplication path (if `decision: retained-duplication`)

1. **Drift guard `.types.ts` file exists** and is NOT a `.test.ts` (must
   participate in `tsc --noEmit`).
2. **Non-distributive tuple-wrapped equality** (finding 4): the guard uses
   `[X] extends [Y]` (tuple-wrapped) to prevent distribution over unions,
   NOT naked `X extends Y`. The verifier MUST read the guard source and
   confirm the tuple-wrapping.
3. **Guard resolves under typecheck** (Guard-location note from P08): the guard's imports resolve
   under `npm run typecheck` from a clean state.
4. **Exact drift detection** (finding 4): the drift-proof catches BOTH a
   required AND an optional member perturbation. The verifier MUST reproduce
   the drift proof, confirming typecheck FAILS on BOTH perturbations and
   PASSES after revert.
5. **Bidirectional property compatibility**: the guard checks property types
   both directions using the non-distributive `Equal` helper.
6. **`npm run typecheck` passes** in the committed state.
7. **No production declaration change** — the cross-referencing comments at
   the two declarations are NOT yet applied (those are P09).
8. **No deferred language** added by this phase.
9. **No lint loosening / suppression directives**.

## Verification Commands

```bash
# Type-proof document exists — fail-closed
test -f project-plans/issue2285/analysis/runtime-factory-typeproof.md || { echo "FAIL: type-proof doc missing"; exit 1; }
cat project-plans/issue2285/analysis/runtime-factory-typeproof.md

# Revision 4 architect finding 5: BRANCH on the recorded decision. Do NOT
# require both paths' artifacts unconditionally.
test -f project-plans/issue2285/analysis/runtime-factory-contract-decision.md || { echo "FAIL: decision record missing (P01 must create it)"; exit 1; }
DECISION="$(grep -E '^decision:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md | head -1 | sed 's/^decision:[[:space:]]*//')"
test -n "$DECISION" || { echo "FAIL: decision record has no 'decision:' line"; exit 1; }
echo "Recorded decision: $DECISION"

if [ "$DECISION" = "single-source" ]; then
  # Single-source EXECUTABLE proof against REAL workspace (revision 4 finding 6) — fail-closed
  test -f project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs || { echo "FAIL: single-source proof script missing"; exit 1; }
  node project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs
  test $? -eq 0 || { echo "FAIL: single-source executable proof failed"; exit 1; }
  # No production change yet (fail-closed)
  DECL_COUNT="$(node -e "
const { execSync } = require('child_process');
const fs = require('fs');
const out = execSync('grep -rln \"interface AgentRuntimeFactoryBindings\" packages/ --include=*.ts || true', {encoding:'utf8'}).split('\n').filter(Boolean);
let n = 0;
for (const f of out) { if (f.includes('node_modules') || f.includes('dist')) continue; const s = fs.readFileSync(f,'utf8'); if (/interface\s+AgentRuntimeFactoryBindings/.test(s)) n++; }
process.stdout.write(String(n));
")"
  test "$DECL_COUNT" -eq 2 || { echo "FAIL: expected 2 declarations (agents+providers) pre-migration, found $DECL_COUNT"; exit 1; }
  echo "OK: single-source path verified (proof passes, no production change yet)"

elif [ "$DECISION" = "retained-duplication" ]; then
  # Retained-duplication: drift guard exists and uses tuple-wrapped equality (finding 4)
  GUARD_PATH="$(grep -E '^drift-guard-path:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md | head -1 | sed 's/^drift-guard-path:[[:space:]]*//')"
  test -n "$GUARD_PATH" || { echo "FAIL: retained-duplication missing 'drift-guard-path:' line"; exit 1; }
  test -f "$GUARD_PATH" || { echo "FAIL: drift guard not found at $GUARD_PATH"; exit 1; }
  echo "OK: retained-duplication path — drift guard present at recorded path"
  # Verify non-distributive equality pattern
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

# Revision 6 architect finding 6: deferred-language scan is decision-dependent.
# The single-source proof artifact only exists when decision is single-source.
# The prior revision unconditionally scanned runtime-factory-single-source-proof.mjs
# which does not exist when retained-duplication is chosen.
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

# eslint-guard (fail-closed)
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }

# No suppression directives (fail-closed) — decision-dependent artifact set
if [ -n "$PROOF_FILES" ]; then
  SUPP="$(grep -rn -E "(eslint-disable|ts-ignore|ts-expect-error|ts-nocheck)" $PROOF_FILES || true)"
  test -z "$SUPP" || { echo "FAIL: suppression directives:"; echo "$SUPP"; exit 1; }
fi

# Revision 6 architect finding 6: marker-free check is decision-dependent.
# Only check the single-source proof script when it exists (single-source path).
if [ "$DECISION" = "single-source" ] && [ -f project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs ]; then
  grep -E "@plan:|@requirement:" project-plans/issue2285/analysis/runtime-factory-single-source-proof.mjs && { echo "FAIL: executable .mjs proof script has markers (revision 5 finding 5)"; exit 1; } || echo "OK: .mjs proof script is marker-free"
fi
```

## Drift-Proof Reproduction (retained-duplication path — fixture-based, NO production source mutation)

The verifier MUST reproduce the drift proof WITHOUT editing production source.
Use a temp fixture directory with COPIES of the declarations + guard, perturb
the COPIES, and confirm typecheck FAILS. Production source is never touched.

```bash
# Fixture-based drift reproduction (revision 3 finding 18 — Node-generated
# perturbations, NOT sed -i which is nonportable; no production source mutation).
TMPDIR_DRIFT="$(mktemp -d)"
mkdir -p "$TMPDIR_DRIFT/agents" "$TMPDIR_DRIFT/providers"
cp packages/agents/src/api/runtimeFactories.ts "$TMPDIR_DRIFT/agents/" 2>/dev/null || true
cp packages/providers/src/runtime/runtimeContextFactory.ts "$TMPDIR_DRIFT/providers/" 2>/dev/null || true
cp <guard-file-path> "$TMPDIR_DRIFT/" 2>/dev/null || true
# Required member drift on the fixture copy (via Node — finding 18)
node -e "
const fs=require('fs'), p='$TMPDIR_DRIFT/agents/runtimeFactories.ts';
let s=fs.readFileSync(p,'utf8');
s=s.replace(/}(?=\s*(?:export|$))/, '  __driftProbeRequired: string;
}');
fs.writeFileSync(p, s);
"
npx tsc --noEmit --strict "$TMPDIR_DRIFT"/*.ts "$TMPDIR_DRIFT"/agents/*.ts "$TMPDIR_DRIFT"/providers/*.ts 2>/dev/null
test $? -ne 0 || { echo "FAIL: required drift not caught"; rm -rf "$TMPDIR_DRIFT"; exit 1; }
# Optional member drift on the fixture copy (finding 4 — naked conditionals miss this)
cp packages/agents/src/api/runtimeFactories.ts "$TMPDIR_DRIFT/agents/"
node -e "
const fs=require('fs'), p='$TMPDIR_DRIFT/agents/runtimeFactories.ts';
let s=fs.readFileSync(p,'utf8');
s=s.replace(/}(?=\s*(?:export|$))/, '  __driftProbeOptional?: string;
}');
fs.writeFileSync(p, s);
"
npx tsc --noEmit --strict "$TMPDIR_DRIFT"/*.ts "$TMPDIR_DRIFT"/agents/*.ts "$TMPDIR_DRIFT"/providers/*.ts 2>/dev/null
test $? -ne 0 || { echo "FAIL: optional drift not caught (naked distributing conditionals?)"; rm -rf "$TMPDIR_DRIFT"; exit 1; }
# Reverse direction: perturb the providers-side fixture copy (optional member, via Node)
cp packages/providers/src/runtime/runtimeContextFactory.ts "$TMPDIR_DRIFT/providers/"
node -e "
const fs=require('fs'), p='$TMPDIR_DRIFT/providers/runtimeContextFactory.ts';
let s=fs.readFileSync(p,'utf8');
s=s.replace(/}(?=\s*(?:export|$))/, '  __driftProbeOptional?: string;
}');
fs.writeFileSync(p, s);
"
npx tsc --noEmit --strict "$TMPDIR_DRIFT"/*.ts "$TMPDIR_DRIFT"/agents/*.ts "$TMPDIR_DRIFT"/providers/*.ts 2>/dev/null
test $? -ne 0 || { echo "FAIL: reverse optional drift not caught"; rm -rf "$TMPDIR_DRIFT"; exit 1; }
rm -rf "$TMPDIR_DRIFT"
echo "OK: drift reproduced in both directions for both member kinds (fixture-based)"
```

Record BOTH directions AND BOTH member kinds. If the drift proof does NOT fail
on optional-member perturbation, the guard is using naked distributing
conditional types — this is a BLOCKING failure of Gate 5. Return to P08 to
upgrade to tuple-wrapped `Equal`.

## Semantic Verification Checklist

### Single-source path
- [ ] I read the migration proof: it names the exact core module, re-export
      path, and proves no cycle.
- [ ] The EXECUTABLE structural typecheck proof
      (`runtime-factory-single-source-proof.mjs`) exists and passes — it uses
      a disposable full-repo worktree/copy to make the EXACT production changes
      (add interface to real core, re-export from real root barrel, update
      agents/providers imports via REAL bare specifier) and runs
      `npm run typecheck` in the copy. No production source mutation
      (revision 5 architect finding 4).
- [ ] The proof script is marker-free (revision 5 architect finding 5 —
      executable `.mjs` scripts carry no `@plan`/`@requirement` markers;
      attribution is in the adjacent `.md` plan artifact).
- [ ] No production interface declaration was changed in this phase.
- [ ] `npm run typecheck` passes.

### Retained-duplication path
- [ ] I read the drift guard: it uses NON-DISTRIBUTIVE tuple-wrapped `Equal`
      (finding 4), not naked distributing conditionals.
- [ ] I confirmed the guard resolves under `npm run typecheck` from a clean
      state (Guard-location note from P08).
- [ ] I reproduced the drift proof in BOTH directions AND for BOTH member kinds
      (required + optional): typecheck FAILS on each, PASSES after revert.
- [ ] No production declaration comments changed yet (those are P09).

## Success Criteria
- PASS: single-source migration proof documented (default), OR retained-
  duplication drift guard with non-distributive tuple-wrapped equality (finding 4)
  in a proven-resolving location (Guard-location note from P08), drift proof reproduced for both
  member kinds in both directions, `npm run typecheck` green in committed state.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P08a.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
