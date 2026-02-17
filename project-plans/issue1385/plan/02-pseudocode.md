# Phase 02: Pseudocode Development

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P02`

## Prerequisites
- Required: Phase 01a completed
- Verification: `test -f project-plans/issue1385/.completed/P01a.md`

## Purpose
Review and validate the pseudocode files at `project-plans/issue1385/analysis/pseudocode/`. Each file contains numbered pseudocode lines, interface contracts, integration points, and anti-pattern warnings.

## Implementation Tasks

### Review All Pseudocode Files
Review the following pseudocode files for completeness, correctness, and traceability:

1. `session-discovery-extensions.md` — `listSessionsDetailed()`, `hasContentEvents()`, `readFirstUserMessage()`
2. `use-session-browser.md` — Hook state, derived state, loadSessions, loadPreviewsForPage, handleKeypress, initiateResume, executeResume, executeDelete
3. `session-browser-dialog.md` — React/Ink component rendering for wide/narrow modes
4. `perform-resume.md` — Two-phase swap, session ref resolution, error handling
5. `continue-command.md` — /continue slash command, tab completion, action function
6. `resume-progress-overlay.md` — Simple "Resuming..." indicator
7. `integration-wiring.md` — DialogType, UIState, UIActions, DialogManager, slashCommandProcessor, BuiltinCommandLoader, statsCommand, config removal, relative time formatter
8. `legacy-cleanup.md` — --resume flag removal, sessionUtils cleanup
9. `stats-session-section.md` — /stats session info section

### Verify Pseudocode Quality
For each file:
- All lines are numbered
- Interface contracts define INPUTS/OUTPUTS/DEPENDENCIES
- Integration points reference specific files and line numbers
- Anti-pattern warnings use [ERROR] DO NOT / [OK] DO format
- Algorithms match specification behavior
- Error paths are defined

### Cross-Reference with Requirements
- Every REQ-* from requirements.md should be addressable by at least one pseudocode file
- Document any requirement gaps

## Deliverables
- Reviewed and updated pseudocode files (if gaps found)
- Gap analysis if any requirements lack pseudocode coverage

## Verification Commands
```bash
# All pseudocode files exist
for file in session-discovery-extensions use-session-browser session-browser-dialog perform-resume continue-command resume-progress-overlay integration-wiring legacy-cleanup stats-session-section; do
  test -f "project-plans/issue1385/analysis/pseudocode/${file}.md" || echo "MISSING: ${file}.md"
done

# Each file has numbered lines
for file in project-plans/issue1385/analysis/pseudocode/*.md; do
  NUMBERED=$(grep -cE "^[0-9]+:" "$file" 2>/dev/null || echo 0)
  echo "$file: $NUMBERED numbered lines"
done

# Interface contracts present
for file in project-plans/issue1385/analysis/pseudocode/*.md; do
  grep -q "Interface Contracts\|INPUTS\|OUTPUTS" "$file" || echo "MISSING CONTRACT: $file"
done
```

## Success Criteria
- All 9 pseudocode files complete with numbered lines
- Interface contracts defined for each component
- Integration points reference real files
- Anti-pattern warnings present
- Requirements fully covered

## Failure Recovery
No code changes to revert — this is a pseudocode review phase.

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P02.md`

## Requirements Implemented (Expanded)

- This phase advances PLAN-20260214-SESSIONBROWSER with requirement-traceable outputs for the stated phase scope.

## Deferred Implementation Detection

```bash
rg -n "TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented" [modified-files]
```

## Feature Actually Works

- Manual verification is required for this phase before completion is marked.

## Integration Points Verified

- Verify caller/callee boundaries for every touched integration point.
