# Phase 29: Final Plan-Quality Evaluation

## Phase ID

`PLAN-20260617-COREAPI.P29`

## LLxprt Code Subagent: deepthinker

## Prerequisites

- Required: Phase 28a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P28a.md`

## Purpose

Final holistic evaluation of the delivered Core Public API against PLAN.md quality
gates and the overview's acceptance criteria. This is the last-todo evaluation.

## Evaluation Checklist (deepthinker — clean full review, no rubber-stamp)

### Integration-first (MOST CRITICAL — fail here = reject)

- [ ] The API is NOT an isolated feature: the harness (and #1595 as the downstream
      gate) consumes it; specification Integration Points name cli (#1595) + a2a-server
      and the deep imports they stop needing.
- [ ] `builds_in_isolation` is FALSE (the feature requires real integration; the
      no-deep-import guard T17 and app-service boundary T23/T24 enforce it).

### TDD + test quality

- [ ] Harness was written test-first (RED) against stubs before any impl phase.
- [ ] No reverse testing anywhere (no assert on NotYetImplemented/stub).
- [ ] No mock theater: real Agent + real FakeProvider + real CoreToolScheduler/
      MessageBus; only infra (HTTP/FS) mocked.
- [ ] Behavioral asserts (values/sequences/history/provider), never "method was called".
- [ ] Property-based tests ≥30% — **computed, not eyeballed** (see "Mutation & Property
      Gates" below); the printed percentage is ≥30 and the script exited 0.
- [ ] Mutation score ≥80% on `packages/agents/src/api/**` — **consumed from the actual
      Stryker report** (see below); the printed score is ≥80 and Stryker exited 0.

### Pseudocode usage

- [ ] Each pseudocode-backed impl phase (P14 adapters / P15 createAgent / P16 switch /
      P17 tools-approval / P24 dispose) references numbered pseudocode step labels and
      deepthinker verified compliance (P14a/P15a/P16a/P17a/P24a).
- [ ] No unused pseudocode files.

### Coverage completeness

- [ ] All harness rows T1–T25 are allocated to a phase + REQ and made green.
- [ ] The 21 GeminiEventType variants each have a characterization assertion (T16/P10).
- [ ] Exactly-one-done invariant + synthesized-done terminal paths covered.
- [ ] Context-preservation (T4d/T4e/T4f) asserts SAME HistoryService identity.
- [ ] Auth precedence (T18) matches the verified chain exactly.
- [ ] dispose ownership table (T13) asserts per-row teardown.

### Sequencing / structure

- [ ] Phases numbered with NO gaps; each NN has a NNa verifier; one subagent per phase.
- [ ] Worker=typescriptexpert; verifier=typescriptreviewer; deepthinker for
      pseudocode-backed impl verifiers + this eval.
- [ ] core/index.ts trim correctly deferred to #1595 (not done here).

- [ ] Every worker phase with `## Requirements Implemented (Expanded)` has local `**Full Text**`, `**Behavior**`, and `**Why This Matters**` headings for its expanded requirement(s).

### Expanded requirement format gate

```bash
python3 - <<'PY'
from pathlib import Path
missing=[]
for p in sorted(Path('project-plans/issue1594/plan').glob('*.md')):
    if p.name in {'00-overview.md','00a-preflight-verification.md'}:
        continue
    s=p.read_text()
    if '## Requirements Implemented' in s:
        for heading in ['**Full Text**','**Behavior**','**Why This Matters**']:
            if heading not in s:
                missing.append((p.name, heading))
if missing:
    for item in missing:
        print('MISSING', item[1], 'in', item[0])
    raise SystemExit(1)
PY
```

## Mutation & Property Gates (hard fail, tooling prepared in P08)

P08 installed/configured Stryker and created the property-ratio script, and P08a
proved Stryker viability on a tiny target. This final phase is a **pure evaluator**:
it does not install dependencies or write config. It consumes the actual reports and
commands from the already-established quality tooling.

### B8 — Mutation ≥80% (hard fail)

```bash
missing=0
test -f packages/agents/stryker.conf.json || { echo "MISSING stryker config from P08"; missing=1; }
npm exec --workspace @vybestack/llxprt-code-agents -- stryker run stryker.conf.json || missing=1
node -e 'const r=require("./packages/agents/reports/mutation/mutation.json");const f=r.files||{};let k=0,s=0;for(const p in f){for(const m of f[p].mutants){if(m.status==="Ignored")continue;k++;if(m.status==="Killed"||m.status==="Timeout")s++;}}const pct=k?(100*s/k):0;console.log("mutation%=",pct.toFixed(1));process.exit(pct>=80?0:1);' || missing=1
exit $missing
```

If Stryker is non-viable, P08/P08a must fail before implementation proceeds and the
coordinator must stop for maintainer decision. P29 does not silently substitute a weaker
manual spot-check.

### B9 — Property-based ≥30% (hard fail, computed)

Numerator/denominator are defined by the P08 script: denominator = total harness test
cases tagged with `@plan:PLAN-20260617-COREAPI`; numerator = cases using `fc.assert`,
`test.prop`, or `it.prop`.

```bash
node packages/agents/scripts/verify-api-property-ratio.js || node scripts/verify-agent-api-property-ratio.js
```

The script must print the ratio and exit 0 only when property-based coverage is ≥30%.

## Output

Write `project-plans/issue1594/plan-evaluation.json`:

The block below is an example shape only; do not copy placeholder numeric values into the final file.

```json
{
  "compliant": true,
  "has_integration_plan": true,
  "builds_in_isolation": false,
  "pseudocode_used": true,
  "reverse_testing_found": false,
  "mock_theater_found": false,
  "mutation_testing": true,
  "mutation_score_pct": "<ACTUAL computed mutation score, e.g. 85.4 — do NOT leave 0>",
  "mutation_command_exit": "<ACTUAL exit code from B8 script, MUST be 0>",
  "property_testing": true,
  "property_pct": "<ACTUAL computed property-test percentage, e.g. 34.2 — do NOT leave 0>",
  "property_command_exit": "<ACTUAL exit code from B9 script, MUST be 0>",
  "all_t_rows_covered": true,
  "event_variants_covered": 21,
  "violations": []
}
```

`mutation_score_pct` and `property_pct` MUST be the ACTUAL computed numbers from the
B8/B9 scripts above (not placeholders); `*_command_exit` MUST be 0. If either gate
script exits non-zero, set `compliant=false` and add the failure to `violations`.

If `builds_in_isolation` is true OR any critical gate fails: REJECT and list required
remediation phases.

## Success Criteria

- plan-evaluation.json emitted with compliant=true and no critical violations.

## Failure Recovery

- File remediation phases for any failed gate; loop until compliant.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P29.md`
