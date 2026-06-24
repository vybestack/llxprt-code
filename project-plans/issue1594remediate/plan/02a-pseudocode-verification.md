<!-- @plan:PLAN-20260621-COREAPIREMED.P02a @requirement:REQ-001..REQ-005,REQ-INT-001..004 -->
# Phase 02a: Pseudocode Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P02a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 02 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P02.md`

## Verification Tasks

Read all six pseudocode files IN FULL. Confirm contract-first structure and fidelity to the
ACTUAL source (cross-check the cited line numbers against the real files).

```bash
# Structural presence (same loop as P02)
cd project-plans/issue1594remediate/analysis/pseudocode
for f in config-injection-seam settings-surface get-current-sequence-model client-contract-promotion provider-runtime-seam cli-integration-adapter; do
  grep -q "Interface Contracts" "$f.md" && grep -q "Integration Points" "$f.md" && grep -q "Anti-Pattern Warnings" "$f.md" || echo "$f INCOMPLETE"
done
cd - >/dev/null
# Fidelity spot-checks against real source
grep -n "function finalizeAgent" packages/agents/src/api/createAgent.ts
grep -n "function assembleFacade" packages/agents/src/api/createAgent.ts
grep -n "resolveClient" packages/agents/src/api/createAgent.ts
grep -nE "getEphemeralSetting\(|setEphemeralSetting\(|getEphemeralSettings\(" packages/core/src/config/configBase.ts
grep -n "getCurrentSequenceModel" packages/core/src/core/clientContract.ts
```

### Semantic Verification Checklist

- [ ] Every pseudocode file has all three mandatory sections + numbered lines.
- [ ] Cited symbols/line numbers MATCH actual source (finalizeAgent, assembleFacade, resolveClient,
      configBase ephemeral methods, clientContract.getCurrentSequenceModel).
- [ ] `fromConfig` pseudocode REUSES the shared finalize path (does not duplicate it).
- [ ] Settings pseudocode delegates (no parallel store, no re-normalization).
- [ ] Sequence-model pseudocode resolves the client each call (no caching).
- [ ] Contract-promotion pseudocode is type-only at root; class stays on internals.
- [ ] Parity-harness pseudocode uses a real FakeProvider and compares projected events (no mock
      theater) and imports only the public surface.

## Holistic Assessment (MANDATORY — into completion marker)

Explain whether the pseudocode, if implemented faithfully, would produce a surface adequate for
#1595. Note any line-number drift found and corrected. Verdict PASS/FAIL.

## Success Criteria

- All checks pass; line numbers reconciled; holistic assessment written.

## Failure Recovery

- Return to Phase 02 with specific corrections; do NOT proceed to Phase 03 until PASS.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P02a.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P02a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
