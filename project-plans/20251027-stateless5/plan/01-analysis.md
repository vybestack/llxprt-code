# Phase 01: Deep Analysis of Foreground Agent State Coupling

## Phase ID
`PLAN-20251027-STATELESS5.P01`

## Prerequisites
- Required: Phase 00a completed.
- Verification: `grep -r "@plan:PLAN-20251027-STATELESS5.P00a" project-plans/20251027-stateless5`
- Expected files: `.completed/P00.md`, `.completed/P00a.md`, updated tracker row for P01 status.

## Implementation Tasks

### Files to Create
- `project-plans/20251027-stateless5/analysis/state-coupling.md`
  - Document all current touchpoints where `Config` stores provider/model/auth info used by foreground agent.
  - Produce an exhaustive inventory (line/identifier list) of call sites mutating/reading provider/model/auth values (goal: ≥50 entries expected).
  - Map call graphs between CLI runtime helpers, slash commands, `GeminiClient`, `GeminiChat`, and `ProviderRuntimeContext`.
  - Identify risks and open questions tagged with `@requirement:REQ-STAT5-00X` references.
- `project-plans/20251027-stateless5/analysis/design-questions.md`
  - Capture answers to the core design prompts: AgentRuntimeState field contract, interaction with `ProviderRuntimeContext`, migration strategy for Config call sites, slash-command/test migration scope, and Config augmentation vs. replacement boundaries.
- `project-plans/20251027-stateless5/analysis/risk-register.md`
  - Capture mitigation strategies and validation hooks per risk.

### Files to Modify
- `project-plans/20251027-stateless5/execution-tracker.md`
  - Update phase status after completion.

### Required Code Markers
- Within analysis docs, include inline references to requirements (e.g., `@requirement:REQ-STAT5-001`).

## Verification Commands

### Automated Checks
```bash
rg "REQ-STAT5" project-plans/20251027-stateless5/analysis
```

### Manual Verification Checklist
- [ ] Every identified dependency from CLI runtime helpers to `Config` documented.
- [ ] Inventory enumerates provider/model/auth call sites with identifiers/links.
- [ ] Design questions document resolved answers for AgentRuntimeState contract, ProviderRuntimeContext integration, migration strategy, slash-command/test scope, and Config boundaries.
- [ ] Risks include mitigation/owner references for future phases.
- [ ] Analysis highlights expected test deltas for TDD phases.

## Success Criteria
- Stakeholders have a clear dependency map guiding pseudocode design.

## Failure Recovery
1. Augment analysis docs with missing dependencies.
2. Repeat verification steps.

## Phase Completion Marker
Create `project-plans/20251027-stateless5/.completed/P01.md` summarizing analysis findings and key risks.
