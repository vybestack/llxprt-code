<!-- @plan:PLAN-20260621-COREAPIREMED.P02 @requirement:REQ-001..REQ-005,REQ-INT-001..004 -->
# Phase 02: Pseudocode

## Phase ID

`PLAN-20260621-COREAPIREMED.P02`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 01a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P01a.md`

## Purpose

Produce/confirm contract-first NUMBERED pseudocode for every new/changed component. NO TypeScript.

## Implementation Tasks

### Files to Create / Confirm (under `analysis/pseudocode/`)

- `config-injection-seam.md` — `fromConfig` adopt path + shared `finalizeAgent` extraction
  (REQ-001, REQ-005, REQ-INT-001).
- `settings-surface.md` — `getConfig`/`getEphemeralSetting`/`setEphemeralSetting`/
  `getEphemeralSettings` delegation (REQ-002, REQ-INT-003).
- `get-current-sequence-model.md` — delegate to `resolveClient()` (REQ-003).
- `client-contract-promotion.md` — type-only root re-export (REQ-004).
- `provider-runtime-seam.md` — `getRuntimeId` + adopted-runtime providers wiring (REQ-005).
- `cli-integration-adapter.md` — CLI-parity harness scenarios (REQ-INT-001..004).

Each file MUST contain the three mandatory sections: **Interface Contracts**, **Integration
Points (line-by-line)**, **Anti-Pattern Warnings**, plus NUMBERED pseudocode lines.

### Required Markers

Each pseudocode file's top comment MUST include `@plan:PLAN-20260621-COREAPIREMED.P02`.

## Verification Commands

```bash
cd project-plans/issue1594remediate/analysis/pseudocode
for f in config-injection-seam settings-surface get-current-sequence-model client-contract-promotion provider-runtime-seam cli-integration-adapter; do
  test -f "$f.md" || { echo "MISSING $f.md"; exit 1; }
  grep -q "Interface Contracts" "$f.md" || { echo "$f MISSING Interface Contracts"; exit 1; }
  grep -q "Integration Points" "$f.md" || { echo "$f MISSING Integration Points"; exit 1; }
  grep -q "Anti-Pattern Warnings" "$f.md" || { echo "$f MISSING Anti-Pattern Warnings"; exit 1; }
  grep -qE "^[0-9]+:" "$f.md" || { echo "$f MISSING numbered lines"; exit 1; }
  grep -q "@plan:PLAN-20260621-COREAPIREMED.P02" "$f.md" || { echo "$f MISSING plan marker"; exit 1; }
done
echo "OK"
```

### Anti-Pattern Self-Check

- [ ] No actual TypeScript (only numbered pseudocode + contract sections).
- [ ] Pseudocode references REAL symbols/lines (finalizeAgent L210, assembleFacade L327,
      resolveClient L257, configBase ephemeral L173/191/265, clientContract L118).
- [ ] No hardcoded responses; dependencies are injected, errors propagate.

## Success Criteria

- All six pseudocode files present, each with the three mandatory sections + numbered lines.

## Failure Recovery

- Revise the deficient pseudocode file(s); re-run verification.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P02.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P02
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```
