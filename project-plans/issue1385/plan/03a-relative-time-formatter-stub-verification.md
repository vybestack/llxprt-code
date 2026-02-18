# Phase 03a: Relative Time Formatter — Stub Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P03a`

## Prerequisites
- Required: Phase 03 completed
- Verification: `test -f project-plans/issue1385/.completed/P03.md`

## Verification Commands

```bash
# File exists
test -f packages/cli/src/utils/formatRelativeTime.ts || echo "FAIL: file missing"

# Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P03" packages/cli/src/utils/formatRelativeTime.ts
# Expected: 1+

# Requirement markers
grep -c "@requirement:REQ-RT" packages/cli/src/utils/formatRelativeTime.ts
# Expected: 1+

# Pseudocode reference
grep -c "@pseudocode" packages/cli/src/utils/formatRelativeTime.ts
# Expected: 1+

# Function signature correct
grep "export.*function.*formatRelativeTime" packages/cli/src/utils/formatRelativeTime.ts || echo "FAIL: export missing"

# No TODO comments in production code
grep -n "TODO" packages/cli/src/utils/formatRelativeTime.ts && echo "FAIL: TODO found" || echo "OK: no TODO"

# No duplicate/V2 files
find packages/cli/src/utils -name "*RelativeTime*V2*" -o -name "*formatRelativeTimeNew*" | head -1
# Expected: no output

# TypeScript compiles
cd packages/cli && npx tsc --noEmit 2>&1 | grep -i error | head -5
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Does the code DO what the requirement says?**
   - [ ] Function exported with (Date, options?) signature
   - [ ] Returns string type
   - [ ] Stub returns empty string or throws NotYetImplemented
2. **Is this a proper stub (not production code)?**
   - [ ] No real time calculation logic yet
   - [ ] Just the API surface
3. **Would tests written against this API fail?**
   - [ ] Yes — returns '' instead of real time strings

#### Holistic Functionality Assessment
- **What does this function do?** Formats a Date as a human-readable relative time string in long or short form.
- **Does the stub satisfy the contract?** It provides the correct type signature but no logic.
- **What could go wrong?** Wrong parameter types, missing export, wrong file path.
- **Verdict**: PASS if compiles, exports correct signature.

#### Feature Actually Works
```bash
# Can import the function (TypeScript compiles)
cd packages/cli && npx tsc --noEmit
# Expected: No errors related to formatRelativeTime
```

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/formatRelativeTime.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P03a.md`

## Requirements Implemented (Expanded)

- This phase advances PLAN-20260214-SESSIONBROWSER with requirement-traceable outputs for the stated phase scope.

## Implementation Tasks

- Execute the scoped file updates for this phase only.
- Preserve @plan, @requirement, and @pseudocode traceability markers where applicable.

## Deferred Implementation Detection

```bash
rg -n "TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented" [modified-files]
```

## Integration Points Verified

- Verify caller/callee boundaries for every touched integration point.

## Success Criteria

- All phase verification checks pass.
- Scope-complete deliverables are present.

### Semantic Verification Questions (YES required)

1. YES/NO — Does the implementation satisfy the phase requirements behaviorally, not just structurally?
2. YES/NO — Would phase tests fail if the implementation were removed or broken?
3. YES/NO — Are integration boundaries validated with real caller/callee data flow checks?
4. YES/NO — Are error and edge-case paths verified for this phase scope?
5. YES/NO — Is this phase complete without deferred placeholders or hidden TODO work?
