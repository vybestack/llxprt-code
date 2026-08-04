# Issue #2743 — Modularize and de-duplicate manual OCR canary workflow machinery

## Research findings (grounding)

### F1. The repo already has a safe modularization pattern

`.github/scripts/ocr-trusted-marker.cjs` holds canonical logic between sentinels:

    // --- BEGIN OCR TRUSTED MARKER SNIPPET ---
    ... pure functions ...
    // --- END OCR TRUSTED MARKER SNIPPET ---
    module.exports = { ... };

The workflow **embeds that snippet verbatim inline** (4 sites). Tests
(`scripts/tests/ocr-trusted-marker-workflow.test.ts` AM1) assert each inline site
`.toContain(readCanonicalSnippet())`, and `ocr-trusted-marker.test.ts` executes the
real module.

This is the required answer to "modularize **without** allowing target PR-head code to
execute while secrets are available": the workflow still carries its own code, pinned by
`github.workflow_sha`. Nothing is `require()`d from the checked-out tree at runtime, so a
PR head can never supply the validator. The `.cjs` file is the reviewable/testable
canonical source, kept in sync by a failing test.

**Non-negotiable:** do NOT change the workflow to `require()`/`node` a repo script for the
canary validator. That would regress the fork-safety keystone.

### F2. The duplicated event-dependent expressions are provably redundant

`Resolve review range` (line 1163) runs `resolveReviewRange`, which begins:

    if (input.eventName !== 'pull_request_target' || input.eventAction !== 'synchronize') {
      return full();   // FROM_SHA: input.mergeBase, RANGE_MODE: 'full'
    }

So for `workflow_dispatch` and `issue_comment`, the resolver ALREADY returns
`FROM_SHA = MERGE_BASE_SHA` and `RANGE_MODE = 'full'`.

The duplicated inline expressions are therefore belt-and-braces:

| Line | Expression |
|---|---|
| 1674, 2172, 2540 | `FROM_SHA: ${{ github.event_name == 'workflow_dispatch' && env.MERGE_BASE_SHA \|\| steps.resolve-range.outputs.FROM_SHA }}` |
| 2173, 2541 | `RANGE_MODE: ${{ github.event_name == 'workflow_dispatch' && 'full' \|\| steps.resolve-range.outputs.RANGE_MODE }}` |
| 1676, 5420 | `RANGE_MODE: ${{ steps.resolve-range.outputs.RANGE_MODE }}` (raw — same value on every event) |

The raw-vs-effective asymmetry at 1676/5420 is NOT a behavioral difference. `noop`
requires `pull_request_target` + `synchronize`, so dispatch can never reach it.

**One residual difference to preserve:** if `resolve-range` fails, `always()` steps still
run; the dispatch expression then still yields `MERGE_BASE_SHA` while the raw output is
empty. The consolidating step must therefore run with `if: always()` and apply the same
event-dependent rule so this failure-path value is preserved exactly.

### F3. Existing canary tests bind to the inline copy

`scripts/tests/ocr-concurrency-canary-2673-helpers.ts:447` does
`extractFunctionSource(metricsScript(), 'buildCanaryMetrics')` and VM-runs it. After
modularization this must execute the **real module** instead.

## Accepted behavior

- **A1** Canary metrics normalizer lives in `.github/scripts/ocr-canary-metrics.cjs`
  (sentinel-delimited, `module.exports`), embedded verbatim in the `Build OCR canary
  metrics` step. Behavior byte-identical.
- **A2** One consolidated, tested resolver for effective review context
  (from SHA, range mode, PR number, trusted base), replacing the repeated expressions.
- **A3** `pull_request_target` still executes only trusted workflow/base code with
  secrets in scope; no PR-head script or config is executed.
- **A4** Manual dispatch keeps explicit PR targeting and fixed full merge-base..head range.
- **A5** Automatic incremental/checkpoint ranges unchanged.
- **A6** Metrics schema, provenance validation, redaction, fail-fast, transport
  accounting, artifact contents behaviorally equivalent.
- **A7** Behavioral tests execute the real module logic across `pull_request_target`,
  `issue_comment`, and `workflow_dispatch`.
- **A8** Existing OCR workflow tests + actionlint remain green.

## Design

### Part A — `.github/scripts/ocr-canary-metrics.cjs`

Snippet contains the pure functions only:
- `buildCanaryMetrics(input)` — moved verbatim from workflow lines 4862–5173.
- `parseOcrVersionOutput(output)` — currently in the driver (lines 5189–5202) but pure;
  move it into the snippet so it is unit-testable.

Driver stays inline in the workflow (it needs `context`, `core`, `fs`, `crypto`, env):
`safeRead`, `safeJson`, `sha256`, `hashFile`, `canonicalConfiguration`, the
`buildCanaryMetrics(...)` call, version-parse error prepending, artifact write,
`core.setFailed`.

### Part B — `.github/scripts/ocr-review-context.cjs`

Snippet exports `resolveEffectiveReviewContext(input)`:

    { eventName, mergeBaseSha, rangeFromSha, rangeMode, prNumber, trustedBaseSha }
      -> { fromSha, rangeMode, prNumber, trustedBaseSha }

Rule (exactly reproducing today's expressions):
- `eventName === 'workflow_dispatch'` -> `fromSha = mergeBaseSha`, `rangeMode = 'full'`
- otherwise -> `fromSha = rangeFromSha`, `rangeMode = rangeMode`
- `prNumber` / `trustedBaseSha` pass through (single source of truth).

New workflow step, placed immediately after `Resolve review range` and before
`Initialize OCR artifact files`:

    - name: Resolve effective review context
      id: review-context
      if: always()
      uses: actions/github-script@... (or node inline)
      env: EVENT_NAME, MERGE_BASE_SHA, RANGE_FROM_SHA, RANGE_MODE, PR_NUMBER, TRUSTED_BASE_SHA
      # embeds the sentinel snippet verbatim; writes to $GITHUB_ENV:
      #   OCR_EFFECTIVE_FROM_SHA, OCR_EFFECTIVE_RANGE_MODE,
      #   OCR_EFFECTIVE_PR_NUMBER, OCR_EFFECTIVE_TRUSTED_BASE_SHA

Substitution sites (all AFTER the new step):
- FROM_SHA: 1674, 2172, 2540 -> `${{ env.OCR_EFFECTIVE_FROM_SHA }}`
- RANGE_MODE: 2173, 2541 -> `${{ env.OCR_EFFECTIVE_RANGE_MODE }}`
- RANGE_MODE: 1676, 5420 -> `${{ env.OCR_EFFECTIVE_RANGE_MODE }}` (proven equal per F2)
- PR number: 2181, 2554, 4850, 5575, 5666 -> `${{ env.OCR_EFFECTIVE_PR_NUMBER }}`
- Trusted base: 2538 -> `${{ env.OCR_EFFECTIVE_TRUSTED_BASE_SHA }}`

Sites BEFORE the new step (863, 865, 929, 1171, 851) keep their direct sources — they must,
since the env vars do not exist yet. A test pins this boundary.

## Tests (behavioral, no mock theater)

1. `scripts/tests/ocr-canary-metrics.test.ts` — executes the real `.cjs` module:
   valid metadata -> `valid: true`; each validation rule violated -> specific error;
   transport accounting; elapsed parsing; version parsing.
2. Verbatim-embedding tests: workflow `Build OCR canary metrics` and `Resolve effective
   review context` each `.toContain()` their canonical snippet.
3. `scripts/tests/ocr-review-context.test.ts` — real module across the three event
   contexts, including checkpoint/incremental and the resolve-range-failed path.
4. Fork-safety assertion: the canary/context steps do not `require(` a repo-relative
   script path and the workflow never checks out PR head.
5. Update `ocr-concurrency-canary-2673-helpers.ts::runBuild` to load the real module.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`,
actionlint, and `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

## Out of scope

Rewriting the validator's rules, changing OCR behavior, touching unrelated workflow steps,
consolidating `OCR_LLM_URL` (single use, not duplicated).
