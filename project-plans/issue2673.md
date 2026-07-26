# Issue #2673 — StepFun-Aware OCR Concurrency Canary

## Goal

Run a controlled OCR concurrency experiment at 2, 3, and 4 against one fixed
pull-request head, preserve comparable measurements, and document the default
concurrency decision from the evidence.

## Acceptance Matrix

| Acceptance criterion | Observable behavior |
|---|---|
| Run concurrency 2/3/4 on the same PR head | A manual workflow input accepts only 2, 3, or 4; all three dispatches target PR 2610 at head `cdd6a6cbd7169894d2ad67c7cb8fc5520d86d4d8` |
| Hold configuration fixed | Every metrics artifact records complete safe provenance; the canonical configuration fingerprint, exact workflow SHA, exact OCR 1.7.16 version, trusted checkout base SHA, merge-base SHA, and head SHA must be exactly equal across canaries so concurrency is the only intentional variable |
| Record wall time and tokens | Canonical comparison time is the independently measured synchronous `ocr review` command wall seconds, including nonzero exits; OCR `summary.elapsed` is retained only as secondary internal runtime, and OCR 1.7.16 token counters include `cache_write_tokens ?? 0` |
| Record 429 and retry events | Authoritative 429 values are actual upstream statuses; retries are counted only from canonical positive `X-Stainless-Retry-Count` values on monitored SDK requests, while any missing or malformed retry-count header invalidates telemetry |
| Record finding distribution | Metrics count the real OCR result comments by category and severity |
| Avoid cross-run account contention | Before each dispatch, query active OCR workflow runs and proceed only when none are active; run canaries sequentially |
| Document a recommendation | Add a comparison document containing run URLs, artifacts, calculations, caveats, and the decision criteria from the issue |
| Isolate a default change | If evidence supports 3, change only `OCR_CONCURRENCY`'s default expression; do not alter OCR version, model, timeout, rules, or review scope |

## Scope Ledger

### In scope

- `.github/workflows/ocr-review.yml`
  - Add a required `workflow_dispatch` concurrency choice with values 2, 3, and 4.
  - Preserve 2 as the automatic-run fallback until the experiment decides otherwise.
  - Wrap only the manual canary review call in a trusted loopback transport monitor and require positive, fully accounted traffic.
  - Record OCR's configured extra-body/language settings separately from the effective environment-resolved endpoint metadata (normalized model, protocol, provider URL hash, and language); the extra body is configured but is not effective for OCR 1.7.16's environment endpoint.
  - Hash the actual OCR config file and fail dispatch preflight if it contains a complete endpoint/provider that could take precedence over environment resolution.
  - Preserve the trusted PR API base SHA and the computed merge-base SHA as distinct evidence.
  - Emit and separately upload a dispatch-only sanitized `ocr-canary-metrics.json`; invalid evidence remains parseable but fails the canary.
- `scripts/tests/`
  - Add behavioral coverage for input validation, fallback behavior, real metrics normalization, counting semantics, malformed external data, and artifact wiring.

### Explicit non-goals

- No dynamic cross-PR concurrency controller.
- No changes to OCR version, model, rules, timeout, prompt, review range, or trigger authorization.
- No upload of raw OCR session JSONL; it contains prompts and responses and is unnecessary because OCR's result JSON already includes elapsed time, token totals, and findings.
- No attempt to treat finding counts as deterministic quality scores; distributions are a sanity check and must be interpreted with model variance.
- No lint-rule weakening, suppression directives, ignored source paths, or complexity-threshold increases.

### Scope budget

Target no more than five changed files and no unrelated refactoring.

## Fixed Canary Target

Use merged PR 2610 because it is the source of the issue's latest 63-file
reference run and its retained PR head is fixed at
`cdd6a6cbd7169894d2ad67c7cb8fc5520d86d4d8`. Record the resolved merge base
from each run and reject the comparison if the base or head differs.

## Test-First Vertical Slices

### Slice 1 — Manual concurrency selection

1. RED: Add workflow behavior tests requiring a `workflow_dispatch` choice
   input limited to 2/3/4 and a default/fallback of 2.
2. GREEN: Wire the input to `OCR_CONCURRENCY` while leaving non-manual runs at
   2.
3. REFACTOR only if the expression can be simplified without changing event
   predicates or fork-safety.

### Slice 2 — Comparable metrics artifact

1. RED: Execute the real metrics normalizer, exact embedded monitor, endpoint preflight, and synchronous timing wrapper extracted from the workflow. Exercise real chunked request/SSE response streaming against a local upstream, exact retry headers 0/1, repeated 429s, a connection-error retry, concurrent identical initial requests, a later unrelated identical request, and malformed/missing retry headers.
2. RED: Cover a zero-request monitor, incomplete request accounting, nonzero exit, non-success status, warnings, malformed/empty result, summary/comment mismatch, invalid timing, invalid SHA provenance, and incomplete provenance so invalid evidence is sanitized and rejected.
3. GREEN: Add bounded trusted workflow instrumentation that writes aggregate transport telemetry, command wall timing, configured/effective provenance, and `ocr-canary-metrics.json` only for manual dispatches.
4. RED/GREEN: Verify final JSON validation, conditional redaction, and separate dispatch-only upload without placeholders or raw session logs.

### Slice 3 — Execute and document the experiment

1. Run the focused workflow tests and full repository verification.
2. Complete review gates and remediate material findings.
3. Make the trusted instrumentation revision available for workflow dispatch.
4. Before each future evidence run, use `gh` to verify that no OCR Review run is queued or in
   progress. Dispatch one run for PR 2610 at concurrency 2, wait for completion,
   download metrics, then repeat for 3 and 4.
5. Verify all three metrics artifacts report exact equality for head SHA, trusted checkout base SHA, merge-base SHA, exact `github.workflow_sha`, exact OCR 1.7.16 version, and the canonical safe configuration fingerprint. Require the trusted checkout base SHA to equal the merge-base SHA in every run, and reject comparison on any mismatch.
6. Compare the canonical `timing.command_wall_seconds`; retain `timing.ocr_internal_elapsed_seconds` only as secondary diagnostic context. Require positive monitored traffic with every request accounted for by a response status or upstream error, environment endpoint resolution, and zero missing/malformed retry-count headers.
7. Apply the issue's decision rules:
   - adopt 3 only if it has no observed 429s and is more than 30% faster than 2;
   - keep 2 if 3 has observed 429s;
   - discuss 4 only if it materially beats 3 without observed 429s, while
     clearly noting the account-wide five-request cap.
8. If a later evidence-backed change is approved, keep it isolated to the fallback concurrency value and its behavioral expectation.
9. Re-run focused and full verification plus review gates for that later diff.

## Verification

Run from the repository root:

- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`

The canary itself is valid only when each GitHub Actions run completes, uploads
parseable metrics, and passes the fixed-configuration equality checks.
