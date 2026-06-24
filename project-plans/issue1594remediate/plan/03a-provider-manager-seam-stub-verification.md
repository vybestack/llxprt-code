<!-- @plan:PLAN-20260621-COREAPIREMED.P03a @requirement:REQ-005,REQ-001.2 -->
# Phase 03a: Providers `providerManager?` Adoption Seam — Stub Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P03a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 03 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P03.md`

## Verification Commands

```bash
set -e
F=packages/providers/src/runtime/runtimeContextFactory.ts

# 1. Optional option declared (additive — the ONLY surface this stub adds) as the STRUCTURAL
#    core interface RuntimeProviderManager (CRIT-1), NOT the concrete ProviderManager class.
if ! grep -q "providerManager?: RuntimeProviderManager" "$F"; then
  echo "FAIL: providerManager? option not declared as RuntimeProviderManager on IsolatedRuntimeContextOptions (CRIT-1)"; exit 1
fi
# CRIT-1: it must NOT be typed as the concrete class.
if grep -nE "providerManager\?:\s*ProviderManager\b" "$F"; then
  echo "FAIL: option typed as concrete ProviderManager — must be structural RuntimeProviderManager (CRIT-1)"; exit 1
fi
# CRIT-1: RuntimeProviderManager imported (type-only) — additive type usage compiles.
if ! grep -qE "RuntimeProviderManager" "$F"; then echo "FAIL: RuntimeProviderManager not imported/referenced"; exit 1; fi
# CRIT-1: no unsafe assertion/any introduced on the new field/path by the stub.
if git diff HEAD -- "$F" | grep -E "^\+" | grep -nE "as (any|ProviderManager)\b|as unknown as ProviderManager|:\s*any\b"; then
  echo "FAIL: unsafe cast/any added on providerManager path (CRIT-1)"; exit 1
fi

# MIN-4: normalize ALL whitespace (incl. newlines) so a formatter splitting `??` across lines
# cannot defeat these greps in either direction.
NORM=$(tr -s '[:space:]' ' ' < "$F")

# 2. CRIT-2: adoption `??` seam MUST NOT be present yet (it lands in P05 so P04 RED is genuine).
if printf '%s' "$NORM" | grep -qE "options\.providerManager \?\? new ProviderManager\("; then
  echo "FAIL: adoption '?? new ProviderManager(' present in stub — adoption must be withheld until P05 (checked whitespace-normalized)"; exit 1
fi

# 3. The messageBus ?? seam STILL present (non-breaking sanity)
if ! printf '%s' "$NORM" | grep -qE "options\.messageBus \?\? new MessageBus\("; then
  echo "FAIL: existing messageBus ?? seam disturbed (checked whitespace-normalized)"; exit 1
fi

# 4. Construction site stays UNCONDITIONAL and unique (exactly one 'new ProviderManager(' in factory)
COUNT=$(grep -cE "new ProviderManager\(" "$F")
if [ "$COUNT" -ne 1 ]; then
  echo "FAIL: expected exactly one 'new ProviderManager(' construction site, found $COUNT"; exit 1
fi

# 5. Marker present
if ! grep -q "@plan:PLAN-20260621-COREAPIREMED.P03" "$F"; then
  echo "FAIL: P03 plan marker missing"; exit 1
fi

# 6. Providers typechecks
npm run typecheck

echo "PASS: providerManager? stub seam verified."
```

### Deferred Implementation Detection (MANDATORY)

```bash
set -e
F=packages/providers/src/runtime/runtimeContextFactory.ts
# Only scan lines this phase touched (git diff against HEAD) for placeholder language.
if git diff HEAD -- "$F" | grep -E "^\+" | grep -nE "(TODO|FIXME|HACK|STUB|XXX|in a real|for now|placeholder|not yet)" ; then
  echo "FAIL: deferred-implementation marker on changed lines"; exit 1
fi
echo "PASS: no deferred-implementation markers on changed lines."
```

## Semantic Verification Checklist (BLOCKS progression)

This checklist is BLOCKING: if any box cannot be checked from real evidence, mark the phase FAIL.

- [ ] `providerManager?: RuntimeProviderManager` (structural interface, CRIT-1) declared on the options interface (additive) — NOT the concrete `ProviderManager` class.
- [ ] `RuntimeProviderManager` imported type-only; no `any`/unsafe-`as` added on the providerManager path.
- [ ] Construction site stays UNCONDITIONAL — the `options.providerManager ?? new ProviderManager(...)` adoption is NOT present yet (withheld to P05).
- [ ] Existing `messageBus?` seam untouched.
- [ ] Exactly one `new ProviderManager(` construction site remains.
- [ ] Providers package typechecks.
- [ ] No deferred-implementation markers on changed lines.

## Verdict

Record PASS/FAIL with pasted evidence for every command above. PASS only if ALL commands exit 0
and ALL checklist items are satisfied.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P03a.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P03a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
