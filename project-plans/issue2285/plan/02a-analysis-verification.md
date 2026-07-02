# Phase 02a: Analysis Verification

## Phase ID
`PLAN-20260629-ISSUE2285.P02a`

## Prerequisites
- Required: Phase 02 completed.
- Verification: `test -f project-plans/issue2285/.completed/P02.md`.

## Verification Tasks

The deepthinker verifier confirms:

1. **api-surface-guard.md**: build-order step present; declaration parse
   approach finalized; DENY_SET includes `AgentClient`, `CoreToolScheduler`,
   `AgenticLoop`; snapshot compare logic present; anti-pattern warnings include
   the "not only Object.keys" rule.
2. **boundary-checker-replacement.md**: `PUBLIC_AGENT_SYMBOLS` deletion
   enumerated; internals subpath deep-import rule confirmed; fixture test
   conversion list finalized.
3. **cli-session-split.md**: six cli.tsx exports listed; extraction order
   finalized; `validateDnsResolutionOrder` explicitly excluded; quarantine
   language purge step present.
4. **runtime-factory-drift.md**: matches the preflight decision (core-ownership
   OR retained duplication with drift guard); if duplication, the guard file
   is a `.types.ts` (typecheck-visible) with **non-distributive tuple-wrapped
   equality** (`[X] extends [Y]`, not naked `X extends Y`) and bidirectional
   per-key assignability (architect finding 4).

## Verification Commands

```bash
# api-surface-guard anti-pattern — fail-closed
grep -iq "Object.keys" project-plans/issue2285/analysis/pseudocode/api-surface-guard.md || { echo "FAIL: api-surface-guard.md missing Object.keys anti-pattern warning"; exit 1; }
grep -iq "declaration" project-plans/issue2285/analysis/pseudocode/api-surface-guard.md || { echo "FAIL: api-surface-guard.md missing declaration approach"; exit 1; }

# boundary checker PUBLIC_AGENT_SYMBOLS deletion — fail-closed
grep -iq "PUBLIC_AGENT_SYMBOLS" project-plans/issue2285/analysis/pseudocode/boundary-checker-replacement.md || { echo "FAIL: boundary-checker-replacement.md missing PUBLIC_AGENT_SYMBOLS deletion"; exit 1; }

# cli-session-split six exports — fail-closed
EXPORT_HITS="$(grep -c "dispatchInteractiveOrNonInteractive\|formatNonInteractiveError\|initializeOutputListenersAndFlush\|installNonInteractiveSigintHandler\|setupUnhandledRejectionHandler\|startInteractiveUI" project-plans/issue2285/analysis/pseudocode/cli-session-split.md || true)"
test "$EXPORT_HITS" -ge 6 || { echo "FAIL: cli-session-split.md missing six exports ($EXPORT_HITS/6)"; exit 1; }
# validateDnsResolutionOrder exclusion — fail-closed
grep -iq "validateDnsResolutionOrder" project-plans/issue2285/analysis/pseudocode/cli-session-split.md || { echo "FAIL: cli-session-split.md missing validateDnsResolutionOrder exclusion"; exit 1; }

# runtime-factory-drift matches preflight decision — fail-closed
# Architect review finding 9: do NOT use a loose keyword grep that can pass
# on prose/comments. Branch on the ACTUAL decision record and require concrete
# structural content (headings, code blocks), not keyword hits.
DECISION_FILE="project-plans/issue2285/analysis/runtime-factory-contract-decision.md"
DRIFT_PSEUDO="project-plans/issue2285/analysis/pseudocode/runtime-factory-drift.md"
test -f "$DECISION_FILE" || { echo "FAIL: decision record missing (P01 creates it)"; exit 1; }
test -s "$DRIFT_PSEUDO" || { echo "FAIL: runtime-factory-drift.md missing or empty"; exit 1; }
# Read the ACTUAL decision from the record (machine-greppable line).
DECISION="$(grep -E '^decision:' "$DECISION_FILE" | head -1 | sed 's/^decision:[[:space:]]*//' || true)"
if [ -z "$DECISION" ]; then
  echo "FAIL: decision record has no machine-greppable 'decision:' line"; exit 1
fi
echo "Decision from record: $DECISION"
# Require CONCRETE pseudocode content: at least one code block (```), not just prose.
test "$(grep -c '```' "$DRIFT_PSEUDO")" -ge 1 || { echo "FAIL: runtime-factory-drift.md has no code blocks (finding 9 — require concrete pseudocode, not keyword hits)"; exit 1; }
# Branch on the actual decision value.
case "$DECISION" in
  single-source)
    # Must reference core ownership concretely (heading or code), not just the word "core" in prose.
    grep -qE '^#+.*[Cc]ore|createAgentClient|AgentRuntimeFactoryBindings' "$DRIFT_PSEUDO" || { echo "FAIL: single-source decision but pseudocode has no concrete core-ownership heading/code"; exit 1; }
    echo "OK: single-source pseudocode verified"
    ;;
  retained-duplication)
    # Must have concrete non-distributive equality pseudocode ([X] extends [Y]).
    grep -qE '\[.*\] extends \[.*\]|extends \[' "$DRIFT_PSEUDO" || { echo "FAIL: retained-duplication but pseudocode lacks non-distributive tuple-wrapped equality ([X] extends [Y])"; exit 1; }
    # Must reference the drift guard path concretely.
    grep -qE 'drift.guard|\.types\.ts' "$DRIFT_PSEUDO" || { echo "FAIL: retained-duplication but pseudocode lacks drift-guard file reference"; exit 1; }
    echo "OK: retained-duplication pseudocode verified"
    ;;
  *)
    echo "FAIL: unknown decision value '$DECISION' (expected single-source or retained-duplication)"; exit 1
    ;;
esac
```

## Semantic Verification Checklist

- [ ] Pseudocode aligns with preflight-results.md decisions.
- [ ] Each implementation phase (P03-P12) can cite specific pseudocode line
      numbers.
- [ ] No contradictions between pseudocode and specification.md.

## Success Criteria
- PASS: all four pseudocode files verified and aligned with preflight.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P02a.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
