# Issue #2678 — Iterate rule.json prompt instructions to suppress low-value maintainability/test nits

## Scope Ledger

### In scope
- `.github/workflows/ocr-review.yml`: extend the inline `OCR_RULES_JSON`
  (the committed source of `~/.opencodereview/rule.json` in CI) with a
  `rules` array carrying generation-time prompt-calibration text. This
  includes both the **baseline** calibration (senior-engineer review
  guidance, JSDoc suppression, severity calibration, test-wishlist
  prevention, resource-leak emphasis) that currently lives only in the
  local `~/.opencodereview/rule.json` and the **five new suppressions**
  requested by the issue. Preserves the existing `include`/`exclude`
  glob arrays unchanged.
- `scripts/tests/ocr-review-workflow-features.test.js`: regression tests
  that parse the `OCR_RULES_JSON` step and assert the calibration
  schema and key suppression phrases are present.
- This rationale/measurement document.

### Explicit non-goals
- NOT changing the checkpoint logic, telemetry code (`buildOcrMetadata`),
  notifier workflow, or auto-review-gate.
- NOT changing the OCR version (`OCR_VERSION` stays as-is).
- NOT changing the `include`/`exclude` glob arrays (test-file
  re-inclusion policy is preserved verbatim).
- NOT building new measurement or diffing infrastructure (measurement
  relies on the existing `#2676` telemetry surface).
- NOT modifying the local `~/.opencodereview/rule.json` as a committed
  artifact (it is user-level external config; the committed source is
  the workflow).
- NOT adding new public abstractions, subsystems, or dependencies.

### Hard scope budget
- Target: ≤ 3 files, ≤ 600 net changed lines (well under the 25-file /
  1500-line soft cap and 40-file / 2500-line hard cap).
- The bulk of the line count is the calibration text itself, which is
  free-text prompt guidance — there is no way to reduce its size without
  dropping required suppression instructions.

## Problem context

Production OCR run 29946076923 produced 75 findings. The distribution
showed 22 low-severity maintainability findings (29% of total) and 5
low-severity test findings (7%). Only 4 high-severity and 3 security
findings — the actual signal — were present.

Root cause: the CI workflow's `OCR_RULES_JSON` (lines ~912-929 of
`ocr-review.yml`) contains **only** `include`/`exclude` glob arrays. It
has **no** prompt-calibration text at all. The local
`~/.opencodereview/rule.json` has rich calibration, but that file is not
committed and is not used by CI. As a result, CI reviews run with OCR's
built-in defaults, which produce high volumes of low-value
maintainability nits.

## Architectural decision

Commit the full calibration set — both the baseline instructions that
the issue describes as "current" (which exist only locally) and the five
new suppressions — into the workflow's `OCR_RULES_JSON` as a top-level
`rules` array of `{ "path": ..., "rule": ... }` entries. This makes CI
reproducible and satisfies the "instructions are committed" acceptance
criterion.

The `rules` array uses the OCR-native schema (`merge_system_rule: true`
so OCR's built-in system prompt is preserved, with the calibration
layered on top). A single global `**` entry carries the full calibration
text; the `include`/`exclude` arrays are preserved verbatim so the
test-file re-inclusion policy is unchanged.

## Acceptance Matrix

| AC | Behavior | Trigger / State | Expected outcome |
|----|----------|-----------------|------------------|
| 1 | Calibration `rules` array committed in workflow | Parse `OCR_RULES_JSON` from "Configure OCR review rules" step | Valid JSON with top-level `rules` array present |
| 2 | `include`/`exclude` arrays preserved | Parse `OCR_RULES_JSON` | Both arrays present with original glob entries unchanged |
| 3 | Baseline: senior-engineer review priority guidance | rules text | Contains correctness/bug prioritization phrases |
| 4 | Baseline: JSDoc/documentation suppression | rules text | Contains JSDoc/documentation-only suppression phrase |
| 5 | Baseline: severity calibration | rules text | Contains high/medium/low severity calibration |
| 6 | Baseline: test-wishlist churn prevention | rules text | Contains test-wishlist suppression phrase |
| 7 | New: hardcoded build/test-fixture constant suppression | rules text | Contains build-time/test-fixture constant suppression phrase |
| 8 | New: diagnostic verbosity suppression | rules text | Contains diagnostic verbosity suppression phrase |
| 9 | New: naming style suppression | rules text | Contains naming style suppression phrase |
| 10 | New: extract-to-shared suppression | rules text | Contains modularity refactor suppression phrase |
| 11 | New: tightened test-suggestion suppression | rules text | Contains tightened test-suggestion phrase |
| 12 | Protective clause: bug/correctness/security never suppressed | rules text | Contains explicit never-suppress clause for these categories |
| 13 | Before/after comparison on same SHA + same OCR version | Local OCR run | Low-maintainability findings reduced by ≥ 40%; bug/correctness/security not reduced |
| 14 | Rules documented with rationale | This document | Present |

## Bounded vertical slices (TDD)

1. **Slice 1 — Tests (RED)**: Add regression tests asserting the
   `rules` array exists and contains each suppression theme. These fail
   because the current `OCR_RULES_JSON` has no `rules` array.
2. **Slice 2 — Calibration text (GREEN)**: Add the full `rules` array
   (baseline + 5 new suppressions + protective clause) to the workflow's
   `OCR_RULES_JSON`. Tests pass.
3. **Slice 3 — Measurement**: Run local before/after OCR on a
   representative diff with controlled variables (same SHA, same OCR
   version) and record the category/severity distribution comparison.
4. **Slice 4 — Documentation**: This rationale document (already
   drafted, finalized after measurement).

## Measurement results

### Procedure
1. Selected PR #2327 (commit 316db4c24, MCP lazy schema loading, 14 files,
   1450 insertions) as a representative diff.
2. **Before run**: `ocr review --audience agent --timeout 20 --from
   85098a65 --to 316db4c2` with the baseline local
   `~/.opencodereview/rule.json` (has baseline calibration, no new
   suppressions).
3. **After run**: same command with updated
   `~/.opencodereview/rule.json` (baseline + 5 new suppressions).
4. Both runs: same git range (same SHA), same OCR version (1.8.0), same
   model (`glm-5.2` via z.ai).
5. Compared finding counts by category and severity.
6. Manual spot-check of all findings before and after.

### Before/after comparison

| Category | Severity | Before | After |
|----------|----------|--------|-------|
| bug | high | 0 | 1 |
| bug | medium | 1 | 0 |
| test | medium | 1 | 2 |
| test | low | 1 | 0 |
| maintainability | low | 2 | 0 |
| documentation | low | 0 | 1 |
| **Total** | | **5** | **4** |

### Findings

- **maintainability · low: 2 → 0 (100% reduction)**. Both nit findings
  ("constant not re-exported from types barrel", "Reflect.has prototype
  chain traversal") were suppressed. Neither represented a defect.
- **bug finding retained and escalated**: the `refreshMcpContext` outside
  try-catch finding was kept and correctly reclassified from medium to
  high — the severity calibration is working as intended.
- **Bug/correctness/security: NOT reduced.** Signal was preserved and
  improved (the bug was escalated to high).
- **Remaining test findings are actionable**: the after-run test findings
  flag plausible defects (test name contradicts production behavior,
  untested failure path leaves inconsistent state) — these pass the
  "plausible defect" bar in the tightened test-suggestion rule.
- **documentation · low**: one finding surfaced about a describe-block
  name ("ephemeral") that contradicts the actual persistent behavior.
  This is a contract/intent mismatch (name actively misleads), which the
  rules explicitly allow through — not a suppression failure.

### Caveats

This comparison uses a single representative diff (5 baseline findings),
not the full 75-finding production run cited in the issue. The
qualitative improvement is clear (100% maintainability-nit suppression,
signal preserved and escalated), but the 25-40% total reduction target
can only be definitively validated against a larger sample after
deployment. The CI workflow will produce the production-scale evidence
once merged and the `OCR_RULES_HASH` repo variable is bumped.

### Operational note
When the rule content changes, the `OCR_RULES_HASH` repository variable
must be bumped so incremental-review checkpoints invalidate and the
updated rules take full effect. This is a repo variable (not file
content), so it is an operational step performed after merge, not part
of this PR's diff.

## Relationship to other issues
- Depends on: #2676 (structured telemetry — COMPLETED, provides
  `category_distribution`/`severity_distribution` artifacts).
- Parent tracker: #2658.
- Complementary: #2672 (publication routing is a post-generation filter;
  rule.json is a generation-time filter).
