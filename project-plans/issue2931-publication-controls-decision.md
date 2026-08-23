# Plan: OCR 1.8.1 publication-controls decision

Plan ID: PLAN-20260823-OCR-PUBLICATION-CONTROLS
Generated: 2026-08-23
Issue: #2931

## Current state

PR #2939 merged the requested comparison and a `DEFER, keep ours` decision into
`dev-docs/ocr-version-1.8.4-comparison.md`. Issue #2931 remains open. The merged
comparison has three acceptance gaps:

1. Its Markdown table is malformed because the severity alternatives contain
   unescaped pipe characters.
2. Its configuration row does not compare all three repository variables named
   by the issue. It covers `OCR_ROUTING_SHADOW_MODE`, but omits the interaction
   with `OCR_INLINE_COMMENT_CAP` and `OCR_COVERAGE_THRESHOLD`.

A third gap was verified after the merge: upstream's inline batch failures are
caught and retried, but its sticky-summary writes (`ensureSummaryAnchor` and
`finalizeSummary`) are not wrapped by `runPostReviewComments`. A failed anchor
create stops before inline publication; a failed final write rejects the step
after inline comments may have landed. Our workflow catches
`createOrUpdateMarkerComment` failures instead. The plan and comparison must
therefore compare inline and sticky-summary publication errors separately and
must not claim fully equivalent fail-open outcomes. This difference supports the
`DEFER` decision. No other evidence found during preflight contradicts the
merged decision.

## Accepted behavior

### REQ-2931-1: Readable, source-grounded comparison

**Requirement text:** The version-delta document must compare upstream OCR
1.8.1 publication controls with the repository's routing and shadow mode.

**Behavior:**

- Given the version-delta document is rendered as Markdown,
- when a reader opens the #2931 comparison,
- then the comparison table has exactly three columns and remains readable.
- The comparison covers fail-open routing, non-destructive publication,
  inline-publication errors, sticky-summary publication errors, rollout safety,
  observability, configuration, and
  the cost of taking the composite action.

### REQ-2931-2: Complete configuration comparison

**Requirement text:** Compare upstream inputs with
`OCR_ROUTING_SHADOW_MODE`, `OCR_INLINE_COMMENT_CAP`, and
`OCR_COVERAGE_THRESHOLD`.

**Behavior:**

- Given upstream's optional `route_severity_below` and `route_categories`
  inputs,
- when neither axis has a valid configuration or a finding's metadata does not
  match its active axis,
- then the document states that the axes are independent and OR-combined: unknown
  metadata cannot match only its own axis, while another active axis with known
  matching metadata can still route the finding, and a line-addressable finding
  stays inline only when no active axis matches. Unknown category tokens are ignored
  while valid tokens in the same list stay active.
- Given this repository's variables,
- when routing is evaluated,
- then the document distinguishes their separate roles: shadow mode controls
  whether routing is applied, the inline cap routes post-dedup overflow to the
  sticky summary, and the coverage threshold controls incomplete-review
  warnings rather than finding placement.
- The document records the defaults and invalid-input behavior supported by the
  real workflow.

### REQ-2931-3: Explicit decision and adoption consequence

**Requirement text:** Record an adopt, partially-adopt, or defer decision with
rationale in the version-delta document from #2929.

**Behavior:**

- Given fail-open routing and non-destructive publication on both sides, and a
  sticky-summary write failure that only ours absorbs,
- when rollout safety, audit detail, publication-error handling, and integration
  cost are considered,
- then the document retains `DEFER, keep ours`.
- The rationale states that upstream applies configured routing immediately,
  exposes only aggregate routed-comment output, packages the controls in a
  composite action that also owns checkout, installation, review invocation,
  and publication, and lets a sticky-summary write failure reject its
  github-script step.
- The document states that this issue adopts no workflow behavior.

## Inputs and boundary cases

| Input or condition | Boundary case | Expected documented result |
| --- | --- | --- |
| Upstream `route_severity_below` | Empty or unknown value | The severity axis is disabled; an active category axis can still route the finding. |
| Upstream `route_categories` | Empty list or only unknown tokens | The category axis is disabled; valid tokens remain active when mixed with unknown tokens, and an active severity axis can still route the finding. |
| Finding category or severity | Missing or unknown metadata | Upstream: unknown metadata cannot match its own axis, but another active axis with known matching metadata can still route; the finding stays inline only when no active axis matches. Ours: the unknown or absent value takes an explicit fail-safe inline branch. |
| Repository `OCR_ROUTING_SHADOW_MODE` | Unset or any value other than literal `false` | Shadow mode remains enabled and routing decisions are recorded but not applied. |
| Repository `OCR_INLINE_COMMENT_CAP` | Unset, non-integer, zero, or negative | Effective cap is 50. |
| Repository `OCR_COVERAGE_THRESHOLD` | Unset, non-finite, below 0, or above 100 | Effective threshold is 90; this affects coverage warnings, not finding placement. |
| Inline batch publication | Batch write fails | Both implementations reconcile and retry without deleting findings; failed inline findings remain represented in the summary/accounting. |
| Sticky-summary publication | Summary read or write fails | Upstream separates reads from writes: `ensureSummaryAnchor` logs and returns null on its existence-check read failure, so finalization gets another opportunity; an attempted anchor create write rejects before inline publication. `finalizeSummary` logs and returns null when its existence-check read fails and there is no anchor; an attempted final update or create write rejects after inline comments may have landed. All paths remain non-destructive. Ours catches the `createOrUpdateMarkerComment` failure, warns, leaves publication ambiguous, and continues with the raw result and routing artifacts available. The document does not claim fully equivalent fail-open outcomes. |
| Adoption route | Consume upstream control | Requires taking or porting composite-action-only publication code; a package version bump does not provide it. Consuming the action replaces local checkout/install/review/publication sequencing plus the integrated checkpoint, suspension, manifest, coverage, routing/shadow and trusted-marker behavior. |

## Scope

### In scope

- Correct the malformed #2931 Markdown table.
- Complete the configuration-surface comparison.
- Preserve and sharpen the already merged defer rationale.
- Record the separately compared inline and sticky-summary publication-error
  behavior, including the accepted gap where ours absorbs a sticky-summary write
  failure and upstream's step rejects.
- Record the composite-action adoption cost.
- Record that no behavior or tests are adopted under this issue.

### Out of scope

- Changes to `.github/workflows/ocr-review.yml`.
- New repository variables, workflow inputs, actions, dependencies, or public
  abstractions.
- Changes to routing policy, shadow-mode defaults, inline caps, coverage
  thresholds, publication retries, telemetry, or artifacts.
- An upstream issue or pull request requesting shadow mode or decision-level
  output. The issue discussion suggests that follow-up, but #2931 does not
  require it.
- Adjacent documentation cleanup.

## Behavioral evidence

Because the decision is `DEFER`, issue #2931 requires no new workflow behavior
and its conditional test criterion does not activate. Evidence consists of:

1. Source inspection of upstream tag `v1.8.4`:
   - `action.yml` inputs and action outputs,
   - `scripts/github-actions/post-review-comments.js` policy partition,
     summary routing, `publishBatch` reconciliation and retry,
     `ensureSummaryAnchor` and `finalizeSummary` summary writes (not
     wrapped by `runPostReviewComments`).
2. Source inspection of `.github/workflows/ocr-review.yml`:
   - `routeFinding`,
   - default-on shadow-mode branch,
   - pre-dedup `ocr-routing-decisions.json`,
   - inline cap parsing and overflow routing,
   - coverage-threshold parsing and warning paths,
   - the `createOrUpdateMarkerComment` catch at lines 5131-5141 that
     keeps a sticky-summary write failure from failing the workflow.
3. Existing behavioral suites against the real workflow script:
   - `scripts/tests/ocr-review-routing.test.ts`,
   - `scripts/tests/ocr-review-phase2.test.ts`,
   - `scripts/tests/ocr-review-coverage-integration.test.ts`.
4. Markdown formatting plus the repository's complete verification cycle.

## Verification

Run the focused existing behavioral suites, then the complete issue-workflow
verification cycle:

```bash
bun test scripts/tests/ocr-review-routing.test.ts \
  scripts/tests/ocr-review-phase2.test.ts \
  scripts/tests/ocr-review-coverage-integration.test.ts
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

## Review finding classification

Every local, OCR, CodeRabbit, and CI finding will be classified as follows:

- **Blocker-Fix:** Prevents an accepted behavior, required verification, safe
  publication, correct ancestry, or a conflict-free candidate head.
- **In-scope-Fix:** Corrects the #2931 comparison, decision rationale, plan, or
  evidence without changing workflow behavior.
- **Reject:** Factually incorrect, already satisfied, or proposes behavior that
  conflicts with the accepted decision.
- **Defer:** Plausible work outside #2931, including upstream enhancements,
  workflow changes, additional controls, or adjacent cleanup.

The effort stops after accepted behavior and required gates pass. Local OCR and
PR OCR are each limited to two runs.