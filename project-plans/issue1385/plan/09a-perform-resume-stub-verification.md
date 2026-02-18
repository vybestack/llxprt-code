# Phase 09a: performResume — Stub Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P09a`

## Prerequisites
- Required: Phase 09 completed
- Verification: `test -f project-plans/issue1385/.completed/P09.md`

## Verification Commands

```bash
# File exists
test -f packages/cli/src/services/performResume.ts || echo "FAIL"

# Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P09" packages/cli/src/services/performResume.ts
# Expected: 3+

# Types are complete (not stubs)
grep "ok: true" packages/cli/src/services/performResume.ts || echo "FAIL: PerformResumeResult missing ok:true branch"
grep "ok: false" packages/cli/src/services/performResume.ts || echo "FAIL: PerformResumeResult missing ok:false branch"
grep "ResumeContext" packages/cli/src/services/performResume.ts || echo "FAIL: ResumeContext missing"

# All exports present
grep "export.*PerformResumeResult" packages/cli/src/services/performResume.ts || echo "FAIL: export"
grep "export.*ResumeContext" packages/cli/src/services/performResume.ts || echo "FAIL: export"
grep "export.*function.*performResume\|export.*async.*function.*performResume\|export.*const.*performResume" packages/cli/src/services/performResume.ts || echo "FAIL: export"

# No V2/duplicate files
find packages/cli/src/services -name "*performResume*V2*" -o -name "*performResumeNew*" | head -1
# Expected: no output

# TypeScript compiles
cd packages/cli && npx tsc --noEmit 2>&1 | grep -i error | head -5
```

### Semantic Verification Checklist
- [ ] Types define the complete contract (ResumeContext fields, PerformResumeResult union)
- [ ] Function exported with correct async signature
- [ ] Stub returns `{ ok: false, error }` (safe failure)
- [ ] Pseudocode reference present
- [ ] Required imports reference real core types

#### Holistic Functionality Assessment
| Question | Answer |
|----------|--------|
| What does this function do? | Resolves session ref, acquires new session via resumeSession(), disposes old, returns result |
| Does the stub compile? | [Verify] |
| Are core imports valid? | [Verify SessionRecordingService, LockHandle, etc. are importable] |
| Verdict | |

## Failure Recovery
```bash
git checkout -- packages/cli/src/services/performResume.ts
rm -f packages/cli/src/services/performResume.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P09a.md`

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
