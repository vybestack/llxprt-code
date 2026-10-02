# Runner-local prereview replaces hosted inference

Issue #3781 now has one production path through `pr-review.yml` and the existing
`pr-review-walkthrough.ts` entry point. The separate pilot and the failed
mandatory line-selection experiment are removed. No additional independent
local review or OCR was run during delivery. The earlier two review cycles
remain recorded in the finding ledger.

## Production behavior and trust boundary

Walkthrough, release notes, grouped changes, applicable diagrams, magnitude,
verified Related discovery, and title/description/issue/scope checks remain.
The five automatic events, mergeability gate, missing-issue draft behavior,
advisory failures, bot-owned comment marker and update/create/404 handling are
retained. No defect verdict, Ready/Needs Work status or Luther automation was
restored. The required CI jobs retain their enforcement.

`pull_request_target` checks out base scripts. PR head and base revisions are
fetched and read as Git objects, never executed. The expected immutable head is
checked at fetch and immediately before publication. Registered `ci.yml`
dispatch can invoke the same review workflow on a trusted implementation ref
with a selected PR and expected head. This is validation wiring, not a second
production pipeline.

Inference is static, tool-free and credential-free over loopback. One owned
Ollama server and model store serve every stage in the job. There is no hosted
fallback or hosted quota selector. The workflow pins Ollama 0.31.1 and checks
archive SHA-256 `d297381efc136451f6fabb9dd644a67f70fe51c16815a0c4a95ff0e327a3afb4`.
Qwen3.5 4B is pinned by digest
`2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd`.
CPU-only residency, Intel Haswell backend mapping, worker peak memory, timings
and owned-resource cleanup have explicit evidence steps.

## Model configuration and limits

The selected model uses native `/api/chat` with context 32768, one parallel
slot, temperature zero and stage-specific structured outputs. Mapping,
grouping, synthesis, diagram and Related run without thinking. Acceptance uses
thinking. Output ceilings are 1024 tokens for ordinary stages, 2048 for
synthesis and the original 8192 for acceptance. The trial 4096 acceptance
ceiling truncated control reasoning and was discarded.

The original shared inference ceiling remains 2700000 ms and the per-call
ceiling 600000 ms. Mapping receives at most one third of that shared allowance,
with individual calls capped at 120000 ms; later non-acceptance calls are capped
at 180000 ms. Missing packets remain listed. A map-stage failure cannot consume
all later inference merely by retrying. Context overflow and unavailable
stages are incomplete, while deterministic description checks and remaining
useful sections remain visible. Failed Related inference is never rendered as
“No related items found.”

Source kind, diff hashes, packet identities and bounded immutable context
remain. The collector includes enclosing `include`/`exclude` keys and surviving
implementations behind deleted local barrels, including `.js` import specifiers
for TypeScript source. Descriptions need not supply exhaustive line proof.
Small acceptance inputs retain raw diffs; larger inputs use grouped,
deduplicated summaries and context. Inputs beyond the bounded context are
explicitly unverified rather than silently dropped. Documentation reports and
test assertions are static evidence, not independently observed test runs.

Qwen was chosen from the existing measurements because its thinking acceptance
handled clean and missing-behavior controls. Its historical all-thinking
pipeline exhausted budgets; mandatory line extraction made completeness worse.
The current split removes those measured costs without introducing another
model or runtime. Gemma's fast descriptive stages informed this choice, but a
second model was not retained.

## Actual evidence and remaining differences

Real native-chat replay accepted the clean retry control and rejected the known
gap and misleading-body controls. These are synthetic controls, not GitHub
PRs, and no expected answer was seeded into prompts. Their fulfillment
conclusions do not establish perfect descriptive prose. Some map responses
still confuse attempts with retries or overstate the call count.

Historical replay uses immutable source for
[PR #3465](https://github.com/vybestack/llxprt-code/pull/3465) and
[PR #3673](https://github.com/vybestack/llxprt-code/pull/3673), with byte-checked
Git diffs. The sandbox case produced useful sections but failed Related
selection and could not fit acceptance evidence. It remains incomplete.
Verification reports committed in historical source are not new engine test
runs. The dead-code case and Linux validation outcomes are recorded in the
final delivery evidence rather than inferred from macOS runs.

Raw experiments and earlier documents remain under
`tmp/verify3781-deliver/`, excluded from the commit. The durable history index
retains their sizes and hashes. The source judgments above preserve the
observed failures without bundling raw prompts or model reasoning. The Gemini
plugin install documentation and real local-HTTP CLI regression remain from
the verification remediation; no provider assertions were weakened.

Same-job reuse already avoids per-stage downloads. Two Linux Actions jobs
measured runtime installation at 12 and 7 seconds, model startup/pull at 18 and
20 seconds, and warm-up at 7 seconds each. Their walkthrough stages took 1334
and 1359 seconds. Runtime plus model setup accounts for about 2% of those job
runtimes. The remediation log's registry pull window was 16.82 seconds,
including digest verification; its main weight blob was reported as 3.4 GB.
The loaded model reports 4283726559 bytes, which is residency evidence rather
than an exact cache-storage measurement. Restoring a cross-run cache would
still transfer gigabytes and require digest validation, trusted cache writers,
eviction policy and cleanup ownership. These measurements do not justify a
cache redesign or an optimization issue. No cross-run cache was added.

## Final local verification

Format, lint, typecheck, build, gpt-6-luna smoke, AST audit, script types,
Actions lint, YAML lint and whitespace checks passed after remediation.
The full scripts shard passed all 310 isolated files. The three migration/setup
failures in its earlier run were corrected: obsolete hosted quota assertions,
real-Git fixture wiring for the data-only PR ref, and absent optional MCP-auth
plugin dependencies. No assertions or enforcement were relaxed.

The preceding full package run passed, including all 765 CLI files and 9812
cases. The final rerun passed the same CLI suite but recorded two unchanged
core failures under concurrent workstation verification: SessionDiscovery's
30-second property deadline (#3790) and a live media publisher's 2000 ms lock
contention. Both unchanged suites then passed individually, 23 and 15 tests,
using the existing runner timeout. The full-rerun exit remains recorded as 1;
it is not rewritten as a clean run. Linux CI remains independent evidence.

Historical current-source replay took 98732 ms for #3465 and 528268 ms for
#3673 on macOS. All 10 and 64 packets were mapped. The six and 45 changed paths
remain in output, including fallback grouping. Both assessments are incomplete:
Related and acceptance unavailable for #3465, and group, synthesis, Related
and acceptance unavailable for #3673. Their useful sections do not establish
whole-review completion.

## Linux Actions and review remediation

The trusted candidate `f579735bca06e83a2e6edacb8bf19eb097ea99cd` ran on Linux
through the registered CI dispatch. The
[isolated historical run](https://github.com/vybestack/llxprt-code/actions/runs/36894401357)
completed successfully, including every ordinary CI gate and the prereview job.
It reviewed immutable PR #3682 head
`b56c4b15daf6e6b99a5bad70c7d7a64398fc8460` without executing that head.
The [bot comment](https://github.com/vybestack/llxprt-code/pull/3682#issuecomment-5673168005)
retained a source-based walkthrough, release notes, all three changed paths,
magnitude and verified Related. It was explicitly incomplete: three of four
packets were summarized, one documentation packet failed, and acceptance was
unavailable. Successful infrastructure does not make those missing stages
complete.

The AMD runner used the pinned runtime/model, context 32768 and zero VRAM.
The worker high-water mark was 6080020 KiB and final RSS 5839556 KiB.
The loaded backend was `libggml-cpu-haswell.so` on this AMD host; the Intel
backend restriction was not exercised by this run. Seven completed HTTP
requests are retained in the timing artifact. Their individual durations range
from 61451 to 123256 ms. Both Related attempts completed at the HTTP layer;
only validated selections were published. Cleanup confirmed the listening port
closed and the owned server/model store removed. Resource artifacts and hashes
are indexed in `delivery-actions-evidence.json`.

The [first own-PR dispatch](https://github.com/vybestack/llxprt-code/actions/runs/36891692225)
was cancelled during prereview by a newer same-PR run. Its ordinary CI jobs,
including CodeQL analysis, completed successfully, while the overall run remained
cancelled. Cleanup and an incomplete fallback comment were still published.
The separate [E2E run](https://github.com/vybestack/llxprt-code/actions/runs/36891675471)
passed both Linux sandbox lanes. Default-branch automatic prereview still runs
trusted base scripts until this PR is merged; the candidate dispatch is the
migration evidence.

CodeRabbit findings prompted three bounded corrections: disable checkout
credential persistence, preserve punctuation while sanitizing Related text,
and reserve input headroom for the shared corrective retry suffix. CodeQL
findings prompted a single optional-source read with ENOENT handling and
validated inference metadata plus an envelope hash instead of persisting
arbitrary network response bodies. Existing raw experiment evidence remains
excluded from Git. These changes do not increase the input, deadline or output
ceilings or reduce required CI enforcement.

The automatic OCR wrapper published an infrastructure diagnostic rather than
a review: preflight returned HTTP 401 and used no review tokens. This is tracked
in [#3700](https://github.com/vybestack/llxprt-code/issues/3700).
No additional manual OCR or independent local review was requested.

The follow-up verification in `tmp/verify3781-deliver/full-codeql/` passed
format, lint, typecheck, full package tests, build, `gpt-6-luna` smoke, AST audit,
the full scripts shard, script types, Actions lint and whitespace checks.
The scripts shard passed 311 files; the focused prereview suites passed 635
tests with 1678 assertions across 29 files. Earlier package failures remain
recorded; this later full package run exited 0. The driver's bare `yamllint`
command was unavailable (exit 127); rerunning the same YAML files with the
existing verification virtual environment exited 0. No rules were excluded
beyond the repository's existing Actions-lint exclusions.

## Delivery recovery diagnosis

The trusted remediation run on `f2a7dcb17` also succeeded:
[Actions run 36905034867](https://github.com/vybestack/llxprt-code/actions/runs/36905034867).
All ordinary CI jobs and local setup, inference, publication and cleanup
completed. It updated the same historical PR #3682 comment, retained all three
paths and summarized three of four packets. The missing documentation packet
and acceptance remain explicitly unavailable. Worker peak memory was 6084992
KiB, final RSS 5845268 KiB, context 32768 and VRAM zero. The measured output is
useful but still incomplete.

The failed host E2E run
[36905037000](https://github.com/vybestack/llxprt-code/actions/runs/36905037000/job/110513550713)
failed `replace.test.ts` on every native-runner attempt. The test specified
`tools.core: ['replace', 'read_file']`, but `configBuilder.ts` read only the
legacy top-level `coreTools`. The first attempt invoked an exposed
`apply_patch`, then completed the replacement; the unchanged no-unrelated-tools
assertion correctly failed. Three failing tests through `loadCliConfig`
reproduced the lost nested setting and incorrect precedence. The correction
honors `tools.core` before the existing top-level fallback. No E2E assertion,
timeout, retry count, skip or enforcement setting was changed. This defect is
tracked in [#3799](https://github.com/vybestack/llxprt-code/issues/3799).

CodeQL analysis 1876514395 examined `f2a7dcb17` and still reported alert 780.
Its SARIF path identifies `response.status`, not the now-hashed response body,
as the remaining network-to-file flow. The correction validates integer HTTP
status range 100 through 599 and normalizes it to a number before persistence.
Malformed metadata is rejected, while successful and failed transport evidence
remain. No suppression, alert dismissal or security rule change was used.

The existing branch CI dispatch
[36905674894](https://github.com/vybestack/llxprt-code/actions/runs/36905674894)
finished successfully on `f2a7dcb17`; its branch CodeQL analysis is 1876633411.
That successful job still contained alert 780, so job success alone was not
used to resolve the security thread.

The default-branch automatic prereview
[36905759913](https://github.com/vybestack/llxprt-code/actions/runs/36905759913)
was cancelled at its existing job deadline. Logs show trusted base checkout
`f3839b881`, installation of the nightly CLI and hosted Zai inference rather
than candidate local inference. Its uploaded error log was empty; no completed
review was recovered. This is preserved as a cancelled hosted-path result, not
a successful candidate run or proof of a credential failure.

Final source revision, current CI/E2E conclusions, head-specific CodeQL alert
state, review-thread outcomes and latest-source Linux publication/resource/
cleanup evidence are maintained in the durable
[delivery status comment](https://github.com/vybestack/llxprt-code/pull/3796#issuecomment-5939004550).
The evidence index links this status record so final Actions observations can
be recorded after the source commit without changing the revision under test.

Recovery verification in `tmp/verify3781-deliver/full-recovery/` passed format,
lint, typecheck, full package tests, build, `gpt-6-luna` smoke, AST audit, all
311 scripts files, script types, Actions lint, YAML lint and whitespace checks.
The CLI suite passed all 765 files and 9816 cases. The additional focused
prereview run passed 380 tests across 21 files with 1128 assertions; the config
suite passed 38 tests with 89 assertions. Existing config-test audit findings
were unchanged, and the inference-artifact suite had no findings. Test-file
coverage, affected-shard, copyright, no-new-JS, no-Vitest and documentation
placement guards also passed. Earlier failed runs remain documented rather
than being relabeled successful.
