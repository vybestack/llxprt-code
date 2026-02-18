# Phase 02a: Pseudocode Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P02a`

## Prerequisites
- Required: Phase 02 completed
- Verification: `test -f project-plans/issue1385/.completed/P02.md`

## Verification Commands

```bash
# All 9 pseudocode files exist
EXPECTED=9
ACTUAL=$(ls project-plans/issue1385/analysis/pseudocode/*.md | wc -l)
test "$ACTUAL" -ge "$EXPECTED" || echo "FAIL: Expected $EXPECTED files, found $ACTUAL"

# Each file has at least 20 numbered lines
for file in project-plans/issue1385/analysis/pseudocode/*.md; do
  NUMBERED=$(grep -cE "^[0-9]+:" "$file" 2>/dev/null || echo 0)
  test "$NUMBERED" -ge 20 || echo "FAIL: $file has only $NUMBERED numbered lines (expected 20+)"
done

# Key algorithms present
grep -q "listSessionsDetailed" project-plans/issue1385/analysis/pseudocode/session-discovery-extensions.md || echo "MISSING: listSessionsDetailed"
grep -q "readFirstUserMessage" project-plans/issue1385/analysis/pseudocode/session-discovery-extensions.md || echo "MISSING: readFirstUserMessage"
grep -q "hasContentEvents" project-plans/issue1385/analysis/pseudocode/session-discovery-extensions.md || echo "MISSING: hasContentEvents"
grep -q "handleKeypress" project-plans/issue1385/analysis/pseudocode/use-session-browser.md || echo "MISSING: handleKeypress"
grep -q "loadPreviewsForPage" project-plans/issue1385/analysis/pseudocode/use-session-browser.md || echo "MISSING: loadPreviewsForPage"
grep -q "performResume" project-plans/issue1385/analysis/pseudocode/perform-resume.md || echo "MISSING: performResume"
grep -q "two-phase\|Phase 1\|Phase 2" project-plans/issue1385/analysis/pseudocode/perform-resume.md || echo "MISSING: two-phase swap"
grep -q "CommandKind" project-plans/issue1385/analysis/pseudocode/continue-command.md || echo "MISSING: CommandKind"
grep -q "formatRelativeTime" project-plans/issue1385/analysis/pseudocode/integration-wiring.md || echo "MISSING: formatRelativeTime"
grep -q "RESUME_LATEST" project-plans/issue1385/analysis/pseudocode/legacy-cleanup.md || echo "MISSING: RESUME_LATEST"
```

### Semantic Verification Checklist
- [ ] Every pseudocode file has numbered lines
- [ ] Interface contracts define clear INPUTS/OUTPUTS
- [ ] Integration points reference actual existing files
- [ ] Anti-pattern warnings prevent common Claude errors
- [ ] Algorithms match specification behavior
- [ ] Error handling paths are complete
- [ ] Two-phase swap ordering is clearly documented
- [ ] Escape/modal priority stacks match requirements exactly

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P02a.md`

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

## Failure Recovery

- Revert this phase files and re-run verification before proceeding.

### Semantic Verification Questions (YES required)

1. YES/NO — Does the implementation satisfy the phase requirements behaviorally, not just structurally?
2. YES/NO — Would phase tests fail if the implementation were removed or broken?
3. YES/NO — Are integration boundaries validated with real caller/callee data flow checks?
4. YES/NO — Are error and edge-case paths verified for this phase scope?
5. YES/NO — Is this phase complete without deferred placeholders or hidden TODO work?
