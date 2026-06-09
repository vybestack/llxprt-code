# Phase 02: Pseudocode and Integration Contract Validation

## Phase ID

`PLAN-20260608-ISSUE1423.P02`

## Prerequisites

- Required: Phase 01a PASS.
- Verification: `grep -q "PASS" project-plans/issue1423/.completed/P01a.md`.
- Expected files: `analysis/pseudocode/rename-refactor.md`, `analysis/integration-contract.md`.

## Requirements Implemented (Expanded)

### REQ-VERIFY-001: Behavioral and structural verification

**Full Text**: Add verification that fails while targeted old provider-agnostic names remain and pass only when behavior-preserving rename is complete.

**Behavior**:

- GIVEN: the rename requires many mechanical changes
- WHEN: pseudocode is validated
- THEN: implementation phases can follow numbered steps and verification can compare code against those steps

**Why This Matters**: Pseudocode prevents subagents from creating isolated aliases or skipping call-site migration.

## Implementation Tasks

### Files to Modify

- `project-plans/issue1423/analysis/pseudocode/rename-refactor.md`
  - Ensure numbered line ranges cover regression test, chat session rename, CLI rename, agent client rename, and cleanup verification.
- `project-plans/issue1423/analysis/integration-contract.md`
  - Ensure interface boundaries match pseudocode.

## Verification Commands

```bash
grep -n "^10:" project-plans/issue1423/analysis/pseudocode/rename-refactor.md
grep -n "^20:" project-plans/issue1423/analysis/pseudocode/rename-refactor.md
grep -n "^40:" project-plans/issue1423/analysis/pseudocode/rename-refactor.md
grep -n "^60:" project-plans/issue1423/analysis/pseudocode/rename-refactor.md
grep -n "^80:" project-plans/issue1423/analysis/pseudocode/rename-refactor.md
grep -n "getAgentClient" project-plans/issue1423/analysis/integration-contract.md
```

## Semantic Verification Checklist

- [ ] Pseudocode is numbered.
- [ ] Pseudocode references exact files and identifiers.
- [ ] Pseudocode explicitly forbids aliases and wrapper files.
- [ ] Integration contract shows CLI to Config to AgentClient to ChatSession path.

## Phase Completion Marker

Create `project-plans/issue1423/.completed/P02.md` with validation notes.
