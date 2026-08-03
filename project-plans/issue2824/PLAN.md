# Issue #2824 — OCR review infrastructure failure on docs-only PRs

## Diagnosis (evidence-backed)

`ocr-infrastructure-notifier.yml` files/updates issue #2824 every time an OCR
review run is classified `infrastructure-failure`. The recurring classification
is **not** an infrastructure problem — it is a parser bug in
`.github/workflows/ocr-review.yml`.

### Failure chain

1. Step **“Verify review scope includes changed tests”** runs
   `ocr review --preview` and pipes stdout to `ocr-preview.txt`.
2. The inline `node` heredoc parses that file with
   `previewSelectionFromOutput()`.
3. That function collects every line matching `/^Will review\s*\(/` and then
   hard-fails when the count is not exactly 1:

   ```js
   if (headingIndexes.length !== 1) {
     throw new Error('OCR preview must contain exactly one Will review heading');
   }
   ```

4. When a PR changes **only files OCR cannot review** (e.g. a docs-only PR
   where every path is `unsupported_ext`), OCR **omits the `Will review`
   section entirely**. There are zero headings, so the parser throws.
5. The heredoc exits non-zero → `mark_infrastructure_failure "preview"` →
   `ocr-exit-code.txt=1` → every later step short-circuits →
   `Resolve OCR production evidence` adds a second infra reason because
   `ocr-preview-succeeded.txt` was never written → run classified
   `infrastructure-failure` → notifier posts to #2824.

### Production evidence

Artifact `ocr-review-output/ocr-preview.txt` from run
[30725255161](https://github.com/vybestack/llxprt-code/actions/runs/30725255161)
(PR branch `issue2685`, docs-only):

```
Preview: 26 file(s) changed  |  +4646  -5033

Excluded from review (26):
  [M]  dev-docs/agent-api.md                       (unsupported_ext)
  ...
  [A]  project-plans/20260801-issue2685/PLAN.md    (unsupported_ext)
```

No `Will review (N):` heading anywhere. Corresponding job log:

```
Error: OCR preview must contain exactly one Will review heading
    at previewSelectionFromOutput ([stdin]:12:11)
...
##[warning]Skipping OCR output parsing because phase preview already recorded exit code 1.
```

`ocr-infrastructure-failure.txt`:

```
phase=preview; reason=OCR preview extraction or cardinality validation failed
phase=preview; reason=OCR preview evidence was unavailable or unsuccessful
```

Reproduced identically on runs 30725089201 (26 docs files) and 30554832360
(1 docs file). Confirmed still present on `main` @ 8b8abeb3a at
`.github/workflows/ocr-review.yml:1740`.

### Why existing tests missed it

`scripts/tests/ocr-review-coverage-preview.test.ts` has two real-output
fixtures (1.7.16 and 1.8.4). **Both contain a `Will review` section.** There is
no fixture for the zero-reviewable-files case, so all 9 tests pass while
production fails.

## Fix

### 1. Accept a legitimately empty selection (fail-open only on valid output)

In `previewSelectionFromOutput`:

- `headingIndexes.length > 1` → still throw (genuinely ambiguous output).
- `headingIndexes.length === 0` → return `[]`, **but only when the output is
  recognizably a well-formed preview**. Guard on the presence of either the
  `Preview: N file(s) changed` banner or an `Excluded from review (N):`
  heading. Anything else (empty string, truncated stdout, garbage) must still
  throw so the workflow keeps failing closed on real infrastructure faults.
- Exactly 1 heading → unchanged behaviour.

### 2. Do not classify “nothing to review” as a failure

With the parser fixed, `ocr-preview-succeeded.txt` is written, so
`Resolve OCR production evidence` no longer flags the run. Add an explicit
short-circuit in **“Run OpenCodeReview”** mirroring the existing
`RANGE_MODE=noop` branch (`ocr-review.yml:2138`): when the preview succeeded and
`ocr-selected-files.txt` is empty, write a `status: "skipped"` `ocr-result.json`
with a “no reviewable files” message, set exit code `0`, and skip invoking the
LLM. This keeps the run green, avoids a pointless LLM call, and produces
deterministic downstream artifacts.

### 3. Preserve the changed-test policy gate

The `changed_tests` guard must keep working: if a PR changes test files and the
preview selects none of them, that is still a **policy** failure, not success.
An empty selection must not be allowed to bypass that check.

## Test plan (behavioral, no mock theater)

Extend `scripts/tests/ocr-review-coverage-preview.test.ts` using the existing
`loadPreviewParser` / `useWorkflowFixture` harness, with the **verbatim**
production preview text from run 30725255161:

1. Docs-only preview (zero `Will review`, 26 excluded) → parser returns `[]`
   instead of throwing. This test fails before the fix.
2. Single-file docs-only preview (run 30554832360 output) → returns `[]`.
3. Empty string / whitespace-only output → still throws.
4. Truncated garbage with no preview banner and no excluded heading → still
   throws.
5. Two `Will review` headings → still throws.
6. All existing 9 assertions continue to pass unchanged.

Plus workflow-level assertions in the appropriate
`scripts/tests/ocr-review-workflow*.test.ts` file for the new
no-reviewable-files short-circuit in “Run OpenCodeReview”.

## Notes / constraints

- The change is confined to a **bash step heredoc**, not to any
  `github-script` body, so `scripts/re-embed-trusted-marker.cjs` does **not**
  need to be re-run. Verify the trusted-marker tests still pass regardless.
- `.github/workflows/ocr-review.yml` is LF-only per `.gitattributes`.
