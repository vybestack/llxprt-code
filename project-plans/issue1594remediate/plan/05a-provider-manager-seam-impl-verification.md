<!-- @plan:PLAN-20260621-COREAPIREMED.P05a @requirement:REQ-005,REQ-001.2 -->
# Phase 05a: Providers `providerManager?` Adoption Seam — Implementation Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P05a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 05 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P05.md`
- This is ALSO a pseudocode-compliance gate: verify the impl matches
  `analysis/pseudocode/provider-manager-seam.md` line-by-line.

## Verification Commands

```bash
set -e
T=packages/providers/src/runtime/__tests__/providerManagerAdoption.behavior.test.ts
F=packages/providers/src/runtime/runtimeContextFactory.ts

# 1. Adoption tests GREEN
npx vitest run "$T"

# 2. Exactly one construction site (no second manager on adopt path)
COUNT=$(grep -cE "new ProviderManager\(" "$F")
if [ "$COUNT" -ne 1 ]; then echo "FAIL: expected one 'new ProviderManager(', found $COUNT"; exit 1; fi

# 3. Adoption ?? seam intact (MIN-4: formatting-tolerant — Prettier may split the nullish
#    coalescing across lines, e.g. `options.providerManager ??\n  new ProviderManager(`). Normalize
#    ALL whitespace (incl. newlines) to single spaces before matching so a multi-line `??` still
#    counts. `tr` collapses newlines; `-z`/`-Pzo` alternatives also work but tr is portable.)
NORM=$(tr -s '[:space:]' ' ' < "$F")
if ! printf '%s' "$NORM" | grep -qE "options\.providerManager \?\? new ProviderManager\("; then
  echo "FAIL: adoption ?? seam missing (checked whitespace-normalized to tolerate formatter line splits)"; exit 1
fi

# 4. Pseudocode citation present
if ! grep -q "@pseudocode" "$F"; then echo "FAIL: missing @pseudocode citation"; exit 1; fi

# 4b. CRIT-1 TYPE-SAFETY GATE (grep-enforced). The seam must be type-safe with NO `any`/unsafe-`as`
#     on the manager adoption path; this is what lets P09 pass config.getProviderManager() (which is
#     RuntimeProviderManager | undefined) with ZERO assertion.
#  (i) Option declared as the STRUCTURAL interface, NOT the concrete class.
grep -q "providerManager?: RuntimeProviderManager" "$F" || { echo "FAIL: option not typed RuntimeProviderManager (CRIT-1)"; exit 1; }
if grep -nE "providerManager\?:\s*ProviderManager\b" "$F"; then echo "FAIL: option typed as concrete ProviderManager (CRIT-1)"; exit 1; fi
#  (ii) Handle/context manager field widened to the structural interface.
grep -qE "providerManager:\s*RuntimeProviderManager" "$F" || { echo "FAIL: handle/context manager field not widened to RuntimeProviderManager (CRIT-1)"; exit 1; }
#  (iii) Adoption expression is assertion-free.
if printf '%s' "$NORM" | grep -qE "options\.providerManager (as |!)"; then echo "FAIL: unsafe assertion/non-null on adopted option (CRIT-1)"; exit 1; fi
#  (iv) No `as ProviderManager`/`as any`/`as unknown as ProviderManager` added on changed lines.
if git diff HEAD -- "$F" | grep -E "^\+" | grep -nE "as (any|ProviderManager)\b|as unknown as ProviderManager"; then echo "FAIL: unsafe cast added on manager path (CRIT-1)"; exit 1; fi
echo "PASS: CRIT-1 type-safety gate."

# 5. Default-path providers runtime suite still green (non-breaking)
npx vitest run packages/providers/src/runtime/

# 6. Whole providers package typechecks + builds
npm run typecheck
```

### Deferred Implementation Detection (MANDATORY — scoped to changed lines)

```bash
set -e
F=packages/providers/src/runtime/runtimeContextFactory.ts
if git diff HEAD -- "$F" | grep -E "^\+" | grep -nE "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|in a real|in production|ideally|for now|placeholder|not yet|will be)"; then
  echo "FAIL: deferred-implementation marker on changed lines"; exit 1
fi
echo "PASS: no deferred markers on changed lines."
```

## Pseudocode Compliance Gate (line-by-line)

Confirm each numbered step of `analysis/pseudocode/provider-manager-seam.md` is realized in the
implementation; cite the source line(s) realizing each pseudocode line. Any unrealized or diverging
step is a FAIL.

## Semantic Verification Checklist (BLOCKS progression)

- [ ] All Phase 04 adoption tests PASS.
- [ ] Exactly one `new ProviderManager(` construction site.
- [ ] Adopted instance identity preserved on `handle.providerManager`.
- [ ] `linkProviderManager` idempotent for already-linked adopted manager.
- [ ] Cleanup introduces NO new manager disposal for either path (the shipped buildCleanupClosure disposes no ProviderManager today — runtimeContextFactory.ts:400-447); the adopted manager is not force-disposed and the default path is unchanged; `onCleanup` receives the same manager instance activation used.
- [ ] CRIT-1: `providerManager?` option + handle field + closures + bindings + prepare/onCleanup contexts are typed `RuntimeProviderManager` (structural), NOT the concrete class; adoption is assertion-free; NO `any`/unsafe-`as` added on the manager path (grep gate PASS).
- [ ] Default-path runtime suite green (non-breaking).
- [ ] Pseudocode compliance confirmed line-by-line.
- [ ] No deferred markers on changed lines.

## Verdict

Record PASS/FAIL with pasted evidence for every command and the pseudocode-compliance table.
PASS only if ALL commands exit 0 and ALL checklist items hold.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P05a.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P05a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
