# Phase 02: Pseudocode Finalization

## Phase ID

`PLAN-20260617-COREAPI.P02`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 01a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P01a.md`
- Expected files: 6 pseudocode files already drafted in `analysis/pseudocode/`.

## Requirements Implemented (Expanded)

### REQ-PSEUDO: Contract-first pseudocode for implementation requirements

**Full Text**: Finalize the six contract-first pseudocode files that implementation
phases cite by numbered step label. Each file MUST have INPUTS / OUTPUTS /
DEPENDENCIES sections, numbered-step integration points, and anti-pattern warnings.
No production code is written in this phase.

**Behavior**:
- GIVEN: the domain model and P00a corrections
- WHEN: pseudocode is finalized
- THEN: every implementation requirement has an unambiguous numbered algorithm,
  every dependency is explicit, and implementation phases can cite exact numbered
  step labels.

**Why This Matters**: Implementation phases must follow pseudocode precisely; vague
or uncited pseudocode permits isolated implementations and breaks PLAN.md's
pseudocode-compliance gate.

| File | Component | Cited by impl phase |
|---|---|---|
| `createAgent.md` | bootstrap composition | P15 (REQ-001) |
| `config-adapter.md` | AgentConfig→ConfigParameters | P14 (REQ-002) |
| `event-adapter.md` | AgenticLoopEvent/Server*→AgentEvent + synthesized done | P14 implements adapter; P15 consumes it through stream/chat (REQ-003) |
| `switch-rebind.md` | switch + history-transfer/rebind | P16 (REQ-004/005) |
| `tool-confirmation-merge.md` | tool/confirm merge + respondToConfirmation(correlationId) | P17 (REQ-006) |
| `dispose.md` | dispose/teardown ownership table | P24 (REQ-016) |


## Implementation Tasks

### Files to Modify

- `analysis/pseudocode/createAgent.md` — confirm ordering (provider-manager set on
  Config BEFORE refreshAuth; bind post-auth client only; never transient).
- `analysis/pseudocode/config-adapter.md` — confirm classification table + escape
  hatch THROW-on-shadow.
- `analysis/pseudocode/event-adapter.md` — confirm 21-variant table + terminal
  decision table + exactly-one synthesized `done` at AgenticLoop boundary.
- `analysis/pseudocode/switch-rebind.md` — confirm same-HistoryService assertion +
  stripThoughts normalization + reattach subscriptions; pin rebuild-hook name from
  P00a B1 (anchor: `initializeContentGeneratorConfig`).
- `analysis/pseudocode/tool-confirmation-merge.md` — confirm dedup by confirmationId,
  respond keyed on correlationId, editor-modify new-correlationId, public Agent
  no-handler safe denial, and raw coordinator internals throw only for the
  power-user subpath.
- `analysis/pseudocode/dispose.md` — confirm idempotent awaited teardown + ownership
  table + net-new cleanup flags.
- Each file header: `<!-- @plan:PLAN-20260617-COREAPI.P02 @requirement:REQ-XXX -->`

## Verification Commands

```bash
# All six files present + numbered lines
for f in createAgent config-adapter event-adapter switch-rebind tool-confirmation-merge dispose; do
  test -f project-plans/issue1594/analysis/pseudocode/$f.md || echo "MISSING $f";
  grep -qE "^[0-9]+:" project-plans/issue1594/analysis/pseudocode/$f.md || echo "NO NUMBERED LINES $f";
done
# Contract sections present
for f in createAgent config-adapter event-adapter switch-rebind tool-confirmation-merge dispose; do
  grep -qi "INPUTS" project-plans/issue1594/analysis/pseudocode/$f.md || echo "NO INPUTS $f";
  grep -qi "OUTPUTS" project-plans/issue1594/analysis/pseudocode/$f.md || echo "NO OUTPUTS $f";
  grep -qi "DEPENDENCIES" project-plans/issue1594/analysis/pseudocode/$f.md || echo "NO DEPS $f";
done
# No real TS impl
grep -rnE "import .* from|const .*= async|=> \{ *$" project-plans/issue1594/analysis/pseudocode/ && echo "POSSIBLE IMPL CODE" || echo "OK"
```

### Structural Verification Checklist

- [ ] All six files numbered, contract-first
- [ ] Anti-pattern warnings present
- [ ] Rebuild-hook name pinned (P00a B1)
- [ ] No TypeScript implementation

## Success Criteria

- Six finalized pseudocode files; impl phases cite exact numbered pseudocode step labels (the `10:`, `20:` labels inside each pseudocode block), not ambiguous prose sections.

## Failure Recovery

- Re-edit the offending file; re-run verification.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P02.md`
