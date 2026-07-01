# Phase 09a: Runtime Factory Contract Verification

## Phase ID
`PLAN-20260629-ISSUE2285.P09a`

## Prerequisites
- Required: Phase 09 completed.
- Verification: `test -f project-plans/issue2285/.completed/P09.md`.

## Verification Tasks

The deepthinker verifier confirms:

### Single-source path (default)

1. **Exactly ONE `interface AgentRuntimeFactoryBindings` declaration** exists,
   in core.
2. **Both agents and providers import it from the core root**
   (`@vybestack/llxprt-code-core`), not deep paths.
3. **Decision record documents the core-ownership choice** and references the
   P08 type-proof.
4. **`npm run typecheck` passes**.
5. **No cycle introduced**.
6. **No marker comment blocks in production source** (finding 5).
7. **No deferred language**.
8. **No lint loosening / suppression directives**.

### Retained-duplication path (only if P01 proved a concrete blocker)

1. **Decision record exists** referencing the P08 type-proof and drift-proof
   results.
2. **Drift guard file exists** and is NOT a `.test.ts` (participates in
   `tsc --noEmit`).
3. **Non-distributive tuple-wrapped equality** (finding 4): the guard uses
   `[X] extends [Y]` (tuple-wrapped), NOT naked `X extends Y`. The verifier
   MUST read the guard source and confirm the tuple-wrapping.
4. **Guard resolves under typecheck** (Guard-location note from P08).
5. **Exact drift detection** (finding 4): the verifier MUST reproduce the
   drift-proof perturbing BOTH a required AND an optional member, showing
   typecheck fails on BOTH. Naked distributing conditionals would MISS the
   optional case — tuple-wrapped `Equal` catches it.
6. **Cross-referencing comments** present at BOTH declarations (in existing
   JSDoc, not new marker blocks — finding 5).
7. **`npm run typecheck` passes** in committed state.
8. **No marker comment blocks in production source** (finding 5).
9. **No deferred language**.
10. **No lint loosening / suppression directives**.

## Verification Commands

```bash
# Decision record exists and declares a decision (revision 3 findings 12, 14) — fail-closed
test -f project-plans/issue2285/analysis/runtime-factory-contract-decision.md || { echo "FAIL: decision record missing"; exit 1; }
cat project-plans/issue2285/analysis/runtime-factory-contract-decision.md
DECISION="$(grep -E '^decision:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md | head -1 | sed 's/^decision:[[:space:]]*//')"
test -n "$DECISION" || { echo "FAIL: decision record has no 'decision:' line"; exit 1; }

# Interface declaration count via Node (robust, revision 3 finding 13)
DECL_COUNT="$(node -e "
const { execSync } = require('child_process');
const fs = require('fs');
const out = execSync('grep -rln "interface AgentRuntimeFactoryBindings" packages/ --include=*.ts || true', {encoding:'utf8'}).split('
').filter(Boolean);
let n = 0;
for (const f of out) { if (f.includes('node_modules') || f.includes('dist')) continue; const s = fs.readFileSync(f, 'utf8'); if (/interface\s+AgentRuntimeFactoryBindings/.test(s)) n++; }
process.stdout.write(String(n));
")"

if [ "$DECISION" = "single-source" ]; then
  # Finding 12: single-source branch
  test "$DECL_COUNT" -eq 1 || { echo "FAIL: single-source decision but $DECL_COUNT declarations"; exit 1; }
  echo "OK: single-source (1 declaration)"
  # Finding 13: robust multiline-aware core-import check via Node
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
if (n < 2) { console.error('FAIL: both packages must import from core root (found '+n+')'); process.exit(1); }
console.log('OK: both packages import from core root ('+n+')');
"
elif [ "$DECISION" = "retained-duplication" ]; then
  # Finding 12: retained-duplication branch — do NOT assert core imports
  test "$DECL_COUNT" -ge 2 || { echo "FAIL: retained-duplication but $DECL_COUNT declarations"; exit 1; }
  echo "OK: retained-duplication ($DECL_COUNT declarations)"
  # Finding 14: read guard path from the decision record
  GUARD_PATH="$(grep -E '^drift-guard-path:' project-plans/issue2285/analysis/runtime-factory-contract-decision.md | head -1 | sed 's/^drift-guard-path:[[:space:]]*//')"
  test -n "$GUARD_PATH" || { echo "FAIL: retained-duplication missing 'drift-guard-path:' line"; exit 1; }
  test -f "$GUARD_PATH" || { echo "FAIL: drift guard not found at $GUARD_PATH"; exit 1; }
  echo "OK: drift guard present at recorded path: $GUARD_PATH"
else
  echo "FAIL: unknown decision '$DECISION'"; exit 1
fi

# Full typecheck passes (fail-closed)
npm run typecheck
test $? -eq 0 || { echo "FAIL: typecheck"; exit 1; }

# eslint-guard (fail-closed)
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }

# No suppression directives — fail-closed
SUPP="$(grep -rn -E "(eslint-disable|ts-ignore|ts-expect-error|ts-nocheck)" packages/agents/src/api/runtimeFactories.ts packages/providers/src/runtime/runtimeContextFactory.ts packages/core/src 2>/dev/null || true)"
test -z "$SUPP" || { echo "FAIL: suppression directives:"; echo "$SUPP"; exit 1; }

# No NEW issue2285 marker comment blocks in production source (finding 5 +
# architect review finding 5) — fail-closed. Uses PLAN-20260629-ISSUE2285
# prefix so pre-existing markers from other issues are NOT matched.
MARKERS="$(grep -rn "@plan:PLAN-20260629-ISSUE2285" packages/agents/src/api/runtimeFactories.ts packages/providers/src/runtime/runtimeContextFactory.ts packages/core/src 2>/dev/null || true)"
test -z "$MARKERS" || { echo "FAIL: NEW issue2285 marker comment blocks in production source:"; echo "$MARKERS"; exit 1; }
```

## Drift-Proof Reproduction (retained-duplication path — fixture-based, NO production source mutation)

The verifier MUST reproduce the drift proof WITHOUT editing production source.
Use a temp fixture directory with COPIES of the declarations + guard, perturb
the COPIES, and confirm typecheck FAILS. Production source is never touched.

```bash
# Fixture-based drift reproduction (revision 3 finding 18 — Node-generated
# perturbations, NOT sed -i; no production source mutation).
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
# Reverse direction: perturb the providers-side fixture copy (via Node)
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

Also prove the reverse direction. Record both directions AND both member kinds.

If the drift proof does NOT fail on optional-member perturbation, the guard is
using naked distributing conditional types — BLOCKING failure. Return to P08.

## Semantic Verification Checklist

### Single-source path
- [ ] Exactly ONE `interface AgentRuntimeFactoryBindings` in core.
- [ ] Both agents and providers import it from the core root.
- [ ] Decision record references the P08 type-proof.
- [ ] `npm run typecheck` passes; no cycle.
- [ ] No NEW issue2285 marker blocks in production source (finding 5 +
      architect review finding 5). Pre-existing markers from other issues are
      tolerated.

### Retained-duplication path
- [ ] I read the drift guard: it uses NON-DISTRIBUTIVE tuple-wrapped `Equal`
      (finding 4), not naked distributing conditionals.
- [ ] I reproduced the drift proof in BOTH directions AND for BOTH member kinds.
- [ ] I read both declaration comments: each names the guard and typecheck (in
      existing JSDoc, not new marker blocks).
- [ ] No NEW issue2285 marker blocks in production source (finding 5 +
      architect review finding 5). Pre-existing markers tolerated.

## Non-Deferral Gate 5 (Runtime Factory Contract) Evidence

Fill in execution-tracker.md Gate 5 verifier evidence with:
- decision record path + summary.
- single-source: grep confirming 1 declaration in core + both importing from
  core root.
- retained-duplication: grep confirming 2 declarations + drift guard file path
  + confirmation it uses non-distributive tuple-wrapped equality (finding 4) +
  the P08 drift-proof output for BOTH directions AND BOTH member kinds.
- confirmation of no suppression directives.
- confirmation of no marker blocks in production source (finding 5).

## Success Criteria
- PASS: single-source in core verified (default), OR retained-duplication with
  non-distributive tuple-wrapped drift guard (finding 4) in a proven-resolving
  location, drift proof reproduced for both member kinds in both directions,
  `npm run typecheck` green, no marker churn in production source (finding 5),
  gate 5 evidence recorded.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P09a.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
