# Phase 06a: Session Discovery Extensions — Stub Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P06a`

## Prerequisites
- Required: Phase 06 completed
- Verification: `test -f project-plans/issue1385/.completed/P06.md`

## Verification Commands

```bash
# All three methods exist
grep "static.*async.*listSessionsDetailed" packages/core/src/recording/SessionDiscovery.ts || echo "FAIL: listSessionsDetailed"
grep "static.*async.*hasContentEvents" packages/core/src/recording/SessionDiscovery.ts || echo "FAIL: hasContentEvents"
grep "static.*async.*readFirstUserMessage" packages/core/src/recording/SessionDiscovery.ts || echo "FAIL: readFirstUserMessage"

# Plan markers present (one per method)
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P06" packages/core/src/recording/SessionDiscovery.ts
# Expected: 3

# Requirement markers present
grep "@requirement:REQ-SB-005" packages/core/src/recording/SessionDiscovery.ts || echo "FAIL: REQ-SB-005"
grep "@requirement:REQ-SB-008" packages/core/src/recording/SessionDiscovery.ts || echo "FAIL: REQ-SB-008"
grep "@requirement:REQ-PV-002" packages/core/src/recording/SessionDiscovery.ts || echo "FAIL: REQ-PV-002"

# Pseudocode references
grep -c "@pseudocode" packages/core/src/recording/SessionDiscovery.ts
# Expected: 3

# No duplicate files created
find packages/core/src/recording -name "*SessionDiscoveryV2*" -o -name "*SessionDiscoveryNew*" | head -1
# Expected: no output

# TypeScript compiles
cd packages/core && npx tsc --noEmit 2>&1 | grep -i error | head -5

# Existing tests still pass
cd packages/core && npx vitest run src/recording 2>&1 | tail -5
```

### Semantic Verification Checklist
- [ ] Methods added to existing SessionDiscovery class (not a new file)
- [ ] Signatures match specification exactly
- [ ] Stubs return safe values (not throwing)
- [ ] Existing functionality unbroken

#### Holistic Functionality Assessment
| Question | Answer |
|----------|--------|
| What do these methods do? | Extend session discovery with detailed listing, empty detection, and preview extraction |
| Do stubs compile? | [Verify] |
| Are existing tests still passing? | [Verify] |
| What could go wrong? | Type mismatches with SessionSummary, wrong return types |
| Verdict | |

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionDiscovery.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P06a.md`

## Requirements Implemented (Expanded)

- This phase advances PLAN-20260214-SESSIONBROWSER with requirement-traceable outputs for the stated phase scope.

## Implementation Tasks

- Execute the scoped file updates for this phase only.
- Preserve @plan, @requirement, and @pseudocode traceability markers where applicable.

## Deferred Implementation Detection

```bash
rg -n "TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented" [modified-files]
```

## Feature Actually Works

- Manual verification is required for this phase before completion is marked.

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
