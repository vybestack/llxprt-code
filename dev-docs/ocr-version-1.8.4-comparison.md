# OCR 1.8.4 upgrade and version-delta record

This document records the version bump from OpenCodeReview (OCR) `1.7.17` to
`1.8.4` and the behavioural deltas between those versions that informed this
change.

It is the durable record referenced by issue #2929 (acceptance criterion 4),
following the precedent of `dev-docs/ocr-version-1.7.16-comparison.md`.

## Scope of this change

- **In scope (this issue/PR):**
  - Version pin bump in `.github/workflows/ocr-review.yml`
    (`OCR_VERSION: '1.7.17'` → `OCR_VERSION: '1.8.4'`).
  - Hardening of the review failure classifier so the numeric status patterns
    are token-boundary-anchored (the one behavioural code change; see D1).
- **Out of scope (explicit):**
  - Migrating to the upstream composite action (`action.yml`,
    `scripts/github-actions/post-review-comments.js`).
  - Adopting `--max-tokens-budget`, `--background-file`, `--model`,
    `--max-git-procs`, remote MCP transport, or new allowlist languages.
  - Changing checkpoint, routing, manifest, coverage, inline-comment-cap, or
    sticky-comment behaviour beyond what the bump requires.
  - Any follow-up bump for upstream 367 (run-manifest coverage contract;
    tracked by #2932).

## Version delta (1.7.17 → 1.8.4)

Five releases shipped between our previous pin and the new one, crossing a
minor version boundary. The notable changes are grouped below.

### 1.8.0

- `feat(allowlist)`: Bicep support.
- `feat(allowlist)`: HCL / Terraform (`.hcl`, `.tfvars`) support.
- `feat(mcp)`: remote MCP via Streamable HTTP transport.
- `feat(actions)`: chunk inline comments into bounded batches (upstream 479).
- `fix`: align Go module path with the actual GitHub repository.
- `fix(actions)`: clarify ambiguous batch review log output.
- `fix(vscode)`: workspace review before first commit.
- `fix(vscode)`: `js-yaml` >= 5.2.2 for GHSA DoS advisory.

### 1.8.1

- `feat(agent)`: token-cost budget guardrails on the review path.
- `feat(action)`: fail-open category/severity publication controls
  (upstream 478).
- `feat(allowlist)`: Prisma support.
- `feat(rules)`: built-in Go review guidance.
- `fix(vscode)`: brace-expansion DoS via `minimatch` 10.2.6 (CVE-2026-14257).
- `fix(cli)`: align help text and aliases with actual behavior.
- `fix`: `ensureMessagesSuffix` double-paths URLs ending with `/v1`.

### 1.8.2

- `feat(viewer)`: modernized web UI.
- `feat(allowlist)`: Protocol Buffers support.
- `feat(rules)`: PHP and Composer rules.
- `fix(config)`: warn when an active provider shadows `llm` settings.
- `refactor(diff)`: strip index headers from review prompts.

### 1.8.3

- `feat(viewer)`: review comments on session detail.
- `fix`: honor per-file review terminal states (upstream PR 582).
- `fix(vscode)`: force-kill unresponsive reviews.
- `refactor(cli)`: migrate to Cobra for shell completion support.

### 1.8.4

- `fix(llm)`: drop `extra_body.stream` from non-streaming requests.
- `fix(diff)`: honor `.gitignore` negation patterns.
- `fix(action)`: group 422 fallback inline comments into a single review.

## CLI / contract verification

Both versions were installed exactly the way CI installs them
(`npm install --prefix <tmp> --ignore-scripts @alibaba-group/open-code-review@<v>`)
and exercised directly.

| Surface we depend on                                                                                      | 1.7.17 | 1.8.4                                              | Verdict   |
| --------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------- | --------- |
| npm wrapper `bin/ocr.js`, `scripts/platform.js`                                                           | ✓      | byte-identical to 1.7.17                           | unchanged |
| `optionalDependencies` platform-binary layout                                                             | ✓      | ✓ same 6 targets                                   | unchanged |
| `ocr version` first line `open-code-review vX.Y.Z (<sha>) …`                                              | ✓      | ✓                                                  | unchanged |
| `ocr config set llm.extra_body <json>` / `language <lang>`                                                | ✓      | ✓ exit 0, same config.json                         | unchanged |
| `ocr llm test` (env-driven credentials)                                                                   | ✓      | ✓ exit 0, clean stderr                             | unchanged |
| `ocr review` flags (`--from --to --format --audience --timeout --concurrency --preview --background`)     | ✓      | ✓ all present after Cobra migration                | unchanged |
| `ocr review --preview` text layout                                                                        | ✓      | byte-identical on the same range                   | unchanged |
| review JSON envelope (`status`, `message`, `summary`, `tool_calls`, `comments`, `warnings`, `session_id`) | ✓      | ✓                                                  | unchanged |
| `warnings[].type === 'subtask_error'` for review failures                                                 | ✓      | ✓ (`scan_subtask_error` added for `ocr scan` only) | unchanged |
| `all %d file review(s) failed` stderr string                                                              | ✓      | ✓                                                  | unchanged |
| per-file read-failure stderr line                                                                         | ✓      | ✓ identical source                                 | unchanged |
| finding object schema (`model.LlmComment`)                                                                | ✓      | ✓ identical source                                 | unchanged |
| non-zero exit on failure                                                                                  | ✓      | ✓ (`main` → `os.Exit(1)`)                          | unchanged |

Two of those rows are contracts the workflow parses but the captured sample
runs did not happen to produce (no file was unreadable, and no run generated a
finding), so they were verified against the tagged upstream sources instead:

- **Read-failure line.** `internal/telemetry/events.go` formats every tool
  failure as `[ocr]   ✘ %s failed: %v` and `internal/tool/file_read.go`
  produces `file %q not found: %w`. Both files are byte-identical at `v1.7.17`
  and `v1.8.4`, so the composed line the coverage report's read-failure
  extractor consumes —
  `[ocr]   ✘ file_read failed: file "<path>" not found: …` — is unchanged. The
  classification suite pins that this line still classifies as a generic
  failure rather than a provider status.
- **Finding schema.** `internal/model/review.go` (which declares
  `LlmComment` with `path`, `content`, `suggestion_code`, `existing_code`,
  `start_line`, `end_line`, `thinking`, `category`, `severity`) is
  byte-identical at `v1.7.17` and `v1.8.4`, so the inline-comment and routing
  paths see the same finding fields.

## Behavioural deltas

### D1 — New structured usage record on stderr when a review fails (the change)

1.8.x adds `emitFailureUsage` (`cmd/opencodereview/output.go`). On the review
failure path with `--format json`, OCR now writes a pretty-printed JSON object
to **stderr** carrying `files_reviewed`, `total_tokens`, `input_tokens`,
`output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `elapsed`,
`budget_exceeded` and `session_id`, followed by
`[ocr] Session: <uuid> (retry with: --resume <uuid>)`.

Our "Run OpenCodeReview" step classifies the failure cause by grepping
`ocr-stderr.log` with **bare, unanchored numbers**:

```bash
grep -Eqi "429|rate limit" ocr-stderr.log
grep -Eqi "529|overloaded" ocr-stderr.log
grep -Eqi "401|403|auth|..." ocr-stderr.log
```

That is wrong against the 1.8.x stderr in two independent ways:

1. **Embedded digits.** A token counter such as `"total_tokens": 214295`
   contains `429`; a session UUID such as `...-429b-...` contains `429` too.
2. **Exact values.** A counter whose value _is_ a status code — for example
   `"files_reviewed": 429`, `"total_tokens": 401`, or a `tool_calls.by_tool`
   tally of `403` — is indistinguishable from a real status by any
   boundary rule, because it is a standalone integer.

Either one mis-classifies a genuine failure (e.g. a config error reported as
"HTTP 429 rate limit"), corrupting the sticky-comment reason, the
`ocr-infrastructure-failure.txt` artifact and the telemetry failure reason. The
first-match-wins branch order also means a spurious `429` masks a real
diagnostic of a different class that appears later in the same stderr.

**Fix applied (in scope), two targeted rules for the two distinct causes:**

1. **Drop the usage record before classifying.** Go's encoder emits it with
   `SetIndent("", "  ")`, so the record is a top-level object whose braces sit
   alone at column 0 and whose members are indented. Everything from a bare
   `{` line to the matching bare `}` line is accounting, not diagnostics:

   ```bash
   ocr_diagnostics="$(awk '/^\{$/ { in_usage = 1 } in_usage != 1 { print } /^\}$/ { in_usage = 0 }' ocr-stderr.log)"
   ```

   Only an object carrying the record's own signature is dropped: both the
   `"summary"` and `"tool_calls"` members at the encoder's two-space indent,
   which `emitFailureUsage` always sets. Any other column-0 JSON object is
   buffered and replayed, so a pretty-printed provider error payload keeps its
   status code and still classifies. Single-line payloads
   (`{"error":{"code":429,…}}`) never enter the buffer at all because their
   braces are not alone on a line. All three shapes are pinned by tests.

2. **Anchor the numeric alternatives at token boundaries** so a status code
   only matches when it is not embedded in a larger number or hex identifier.
   This applies to the four status-code patterns only; the phrase patterns
   (`rate limit`, `overloaded`, `timeout`, `timed out`,
   `all N file review(s) failed`) stay unanchored deliberately, since anchoring
   them would reject real diagnostics such as `ReadTimeout`:

   ```bash
   (^|[^0-9A-Za-z_-])429([^0-9A-Za-z_-]|$)
   (^|[^0-9A-Za-z_-])529([^0-9A-Za-z_-]|$)
   (^|[^0-9A-Za-z_-])(401|403)([^0-9A-Za-z_-]|$)
   ```

   Hyphen and alphanumerics are excluded on both sides so hex UUID segments
   (`-429b-`, `9f429b`) and long integers (`214295`) never match — this is what
   keeps the `[ocr] Session: <uuid> (retry with: --resume <uuid>)` line, which
   is emitted _outside_ the JSON object, from matching. Genuine diagnostics
   (`HTTP 429`, `status_code=429`, `{"status":429}`, `429 Too Many Requests`)
   still do.

The non-numeric alternatives (`rate limit`, `overloaded`, `auth`, …), the
branch order, the reason strings, `grep -Eqi`, and the surrounding
`mark_infrastructure_failure` calls are untouched. Both rules were exercised
against GNU grep 3.11 and mawk on `ubuntu:24.04` (the CI runner combination)
as well as BSD grep/awk on darwin.

### D2 — New terminal status `budget_exceeded` (verify, no change expected)

1.8.1 adds token-cost budget guardrails; `output.go` can now emit
`status: "budget_exceeded"` and `summary.budget_exceeded: true`. We never pass
`--max-tokens-budget` (upstream default `0` = unlimited), so it cannot trigger
today. Our completeness resolution is fail-closed — only `success`/`completed`
with exit 0 and an exact file count yields `complete` — so an unrecognised
status degrades to `partial`. This is pinned by a regression test so a future
upstream default change cannot silently mark a truncated run complete.

### D3 — `.gitignore` negation patterns now honoured (documented)

1.8.4 `fix(diff): honor .gitignore negation patterns`. Verified empirically:
`ocr review --preview --commit 6f52360c2` reports **3 changed files** on 1.7.17
and **4 on 1.8.4**, the extra entry being `.llxprt/LLXPRT.md` (un-ignored by
the `!/.llxprt/` negation). It lands in _Excluded_ (`unsupported_ext`), so the
"Will review" set is unchanged for that commit, but files under a negated path
with an allowlisted extension (e.g. `.llxprt/settings.json`,
`docs/reference/**`) will now enter review scope. This is a correctness
improvement, not a regression.

### D4 — Allowlist additions (no impact)

Bicep / HCL / tfvars (1.8.0), Prisma (1.8.1), Protocol Buffers (1.8.2).
`git ls-files` finds **zero** files of each extension in this repository, so
review scope is unaffected.

### D5 — Cobra migration (1.8.3) (no impact)

`review` is now a `cobra.Command` with `Args: cobra.NoArgs`. Every flag we pass
survives; we pass no positional arguments. `main` still prints `Error: %v` to
stderr and exits `1`.

### D6 — `fix(llm): drop extra_body.stream from non-streaming requests` (1.8.4)

Our default `llm.extra_body` is `{"thinking": {"type": "disabled"}}` — no
`stream` key — so behaviour is unchanged. Noted for the `OCR_LLM_EXTRA_BODY`
repository-variable override path.

## Upstream PR 582 detail

The per-file review terminal-state fix (upstream PR 582, shipped in 1.8.3)
added distinct warning types:

- `subtask_error` — remains the review-warning type for per-file review
  failures on the `ocr review` path (the only path we use).
- `scan_subtask_error` — added for the `ocr scan` path only, which we do **not**
  use.

Our `failedFilesFromResult` correctly extracts paths from `subtask_error`
warnings; no change is required, and this is pinned by a regression test using
the exact real 1.8.4 `completed_with_errors` envelope.

## Sub-issue decisions

Both #2930 and #2931 concern upstream code that lives **only** in the composite
action (`action.yml` and `scripts/github-actions/post-review-comments.js`).
Neither arrives with a version bump. The comparisons below are against
upstream at tag `v1.8.4` and our `ocr-review.yml` at the head of this change.

### #2930 — upstream bounded inline-comment batching (1.8.0) vs our inline cap

Upstream's batching lives entirely in the composite action — `action.yml` (the
`review_comment_batch_size` input) and
`scripts/github-actions/post-review-comments.js` (`resolveBatchSize`,
`sortToSendDeterministically`, `chunkArray`, `publishBatch`). Neither file ships
in the npm package we install, so none of it arrives with a version bump. Ours
lives in the `Post OCR results` step of `.github/workflows/ocr-review.yml`.

Everything below was read from upstream at tag `v1.8.4` and from our workflow at
the head of this change, not inferred from release notes.

#### Batch sizing and determinism

|                       | Upstream                                                                                                                   | Ours                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Knob                  | `review_comment_batch_size` action input → `OCR_REVIEW_COMMENT_BATCH_SIZE`                                                 | `OCR_INLINE_COMMENT_CAP` repository variable                                                                           |
| Default               | 50                                                                                                                         | 50                                                                                                                     |
| Parse                 | `parseInt(raw, 10)`, accepted when finite and >= 1, else 50. `parseInt` tolerates trailing garbage, so `"50abc"` yields 50 | `Number(raw \|\| 50)`, accepted when `Number.isInteger` and > 0, else 50. `Number("50abc")` is `NaN`, so it falls back |
| Meaning               | Chunk size. Every comment is posted, across `ceil(n / size)` sequential `createReview` calls                               | Hard cap. At most `size` comments are posted inline in one `createReview`; the rest never attempt an inline post       |
| Ordering before split | `sortToSendDeterministically`: path → `start_line` → `end_line` → original index                                           | `sortInlineComments`: `severityRank` → path → (`start_line` \|\| `line`) → `line`                                      |
| Tiebreak              | Explicit original-index tiebreak                                                                                           | No explicit index tiebreak; relies on `Array.prototype.sort` stability, guaranteed by ES2019 and by V8                 |

**Verdict: both are deterministic, and the orderings differ for a principled
reason.** Upstream must _not_ order by severity: nothing is truncated, so the
sort's only job is to make the partition reproducible across reruns, which is
what lets per-batch reconciliation match already-posted comments. We _must_
order by severity, because our tail is truncated — the sort decides which
findings get an inline comment and which are relegated to the summary.
Upstream's own comment records that severity ordering is deliberately absent
because its comment objects carry no severity field; ours carry `_severity`
precisely so the cap can be priority-aware.

The absence of an explicit index tiebreak on our side is not a determinism
defect: sort stability has been specified since ES2019, and two findings that
tie on all four keys (severity, path, start line, end line) also tie on
everything a reader could observe.

#### Overflow behaviour — does either side drop a finding?

**Neither drops anything.** They differ in where the excess goes:

- **Upstream** posts every comment, spread over N sequential reviews. Nothing is
  relegated. Cost: a large review produces N timeline entries.
- **Ours** posts at most `cap` inline, then pushes each remaining pair's
  original finding object onto `overflowRouted`, which the sticky summary
  renders under `### Inline overflow (exceeds inline comment cap)` with the
  finding's path, category/severity label and body preserved. Cost:
  lower-severity findings lose line anchoring.

This is a deliberate divergence, not a gap: bounding _inline_ volume is what
#2649 and #2666 asked for. Upstream bounds request size; we bound reader burden.
The two are not mutually exclusive, but at a cap of 50 a single `createReview`
is always within GitHub's practical per-request limit, so chunking is currently
unreachable for us.

#### 422 handling

This is the one dimension where upstream is materially better than ours.

| Step                           | Upstream (`publishBatch`)                                                                                                                                                                                                                         | Ours                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Gate                           | Status must be 422 **and** `isLineResolutionFailure(e)` must hold. It scans `error.message` plus `errors[]` (string entries and `{field}` entries) against five patterns, the load-bearing one being `/could not be resolved/i`                   | None. **Any** batch error takes the same fallback                        |
| Why the gate                   | GitHub documents 422 on this endpoint as "Validation failed, **or** the endpoint has been spammed". Re-sending into a spam-throttled endpoint deepens the incident                                                                                | n/a                                                                      |
| Diff knowledge                 | `getPrDiffHunks` walks `pulls.listFiles` (100/page, 30 pages) and parses each `patch` into per-hunk RIGHT-side `{start, end}` ranges                                                                                                              | None                                                                     |
| Provability guards             | The inventory is marked incomplete — so nothing is discarded — when pagination is truncated, when `listFiles` returns empty, when a `patch` is clipped (observed line count != hunk header count), or when the PR head SHA moved during the walk  | n/a                                                                      |
| Classification                 | Tri-state `classifyCommentAgainstDiff`: `invalid` only when provable (path not in the PR, reversed span, or span not contained in a **single** hunk); `unknown` for missing patch, LEFT side, no line, or an incomplete inventory                 | n/a                                                                      |
| Recovery shape                 | `invalid` → summary; `valid` → **one** secondary `createReview`, but only when filtering actually removed something (otherwise the payload would be byte-identical to the one just rejected); `unknown` and secondary failures → per-comment loop | Every capped comment is re-posted individually via `createReviewComment` |
| Best case for the grouped path | 1 secondary review covering every provably in-diff comment                                                                                                                                                                                        | n/a before this change                                                   |
| Worst case                     | Still degrades to the per-comment loop: comments it cannot judge, and survivors of a failed secondary write, are posted individually                                                                                                              | Up to `cap` (50) individual writes, paced 1 s apart                      |

Our _outcome_ is already correct — an out-of-diff comment 422s individually,
increments `failedInline`, and its finding is pushed to `overflowRouted`, so it
still reaches the reader through the sticky summary. What we lack is the
_efficiency and quietness_ of the recovery: on a line-resolution 422 with a full
cap we make up to 50 API writes and produce up to 50 separate timeline entries,
where upstream collapses the provably in-diff ones into a single review.

#### Interaction with our markers, dedup and trust model

| Concern          | Upstream                                                                                                                                                                                                                                                                              | Ours                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sticky summary   | `SUMMARY_TAG` in an issue comment                                                                                                                                                                                                                                                     | `MARKER` = `<!-- llxprt-code-ocr-review -->`                                                                                                                                                                                                                      |
| Inline identity  | A per-run `REVIEW_TAG` in the **review body**, plus a **random per-comment id** embedded in each comment body as an HTML comment (`newCommentId(RUN_TAG)` / `formatComment(comment, id)`). Random rather than content-derived, so two findings sharing path/line/content still differ | Every inline body is prefixed with `INLINE_MARKER` = `<!-- llxprt-code-ocr-inline -->` plus a per-finding `<!-- ocr-fp:… -->` fingerprint                                                                                                                         |
| Dedup key        | Reconciliation re-reads the review carrying `REVIEW_TAG` and matches those per-comment ids                                                                                                                                                                                            | `inlineCommentKey` = path ∥ line ∥ start_line ∥ un-rendered body, over every trusted-marker review comment on the PR (`existingInlineCommentKeys()` does not filter by SHA; it takes `line`/`start_line` and falls back to `original_line`/`original_start_line`) |
| Author trust     | **None.** Any comment carrying the tag is treated as the action's own                                                                                                                                                                                                                 | `OCR_DEFAULT_TRUSTED_MARKER_LOGINS` gates marker recognition, so a forged marker from an untrusted author cannot spoof dedup, the sticky summary, or embedded checkpoint state                                                                                    |
| Ambiguity signal | `reconciled` flag per batch, surfaced as `batches_reconciled`                                                                                                                                                                                                                         | `batchPublicationAmbiguous`, cleared only by `reconcileWithRetry()` (two attempts, 3 s apart, tolerating GitHub's eventual consistency)                                                                                                                           |

So upstream does have a per-comment identity, and its reconciliation is
comparable to ours in mechanism. The material difference is **author trust**:
upstream treats any comment bearing its tag as its own, whereas we only trust
markers from an allow-listed login. That filter is load-bearing for a
`pull_request_target` workflow and has no upstream equivalent.

#### What adopting upstream would actually cost

Upstream ships a _composite action_: it owns checkout, install, review
invocation and posting as one unit. Our workflow deliberately calls the `ocr`
CLI directly so the surrounding logic stays ours.

To be accurate about one point: upstream's action is **not** fork-unsafe. Its
`Checkout base` step checks out the trusted base rather than the PR head and
fetches the head commit's objects separately (`action.yml`), which is the same
principle our workflow follows. Adopting it would not introduce a fork-safety
hole; it would replace our sequencing with theirs.

What it would displace is the surrounding logic, which has no upstream
equivalent and would have to be rebuilt around the action:

- checkpoint read/advance (`shouldAdvanceCheckpoint`, `buildCheckpoint`, and the
  checkpoint embedded in the sticky comment body),
- the auto-review counter and suspension logic,
- the reviewed-range manifest (#2575), coverage report and
  `ocr-routing-decisions.json` artifacts,
- the routing / shadow-mode publication policy (see #2931).

There is also a hard coupling that constrains _any_ port, wholesale or partial:
`shouldAdvanceCheckpoint` refuses to advance unless `failedFindings === 0` and
`publicationState === 'complete'`, and `publicationState` is derived from
`failedInline` and `batchPublicationAmbiguous`. So a comment we decline to post
must keep incrementing `failedInline` — exactly as today's per-comment fallback
does when an individual post fails. Any adopted 422 path that routed a
provably-out-of-diff comment to the summary _without_ counting it as failed
would silently let the checkpoint advance past a push whose findings were never
published. Upstream has no such invariant, so its accounting offers no guidance
here.

#### Decision: PARTIALLY ADOPT

**Batching: DEFER, keep ours.** Both designs are deterministic and neither drops
a finding. The batching difference is a deliberate product choice — upstream
bounds request size, we bound reader burden — and ours is the behaviour
#2649/#2666 specified.

Two distinct adoption routes exist, and neither is attractive for batching.
Consuming upstream's action _as a maintained dependency_ is all-or-nothing,
because the chunking is not separable from the action that owns checkout,
install and posting; that would displace the checkpointing, suspension,
manifest, coverage and routing logic listed above, plus the trusted-marker
author filter. _Vendoring_ the chunking logic into our workflow is possible —
that is exactly what we do below for the 422 grouping — but it buys nothing
today, since at a cap of 50 a single `createReview` is always within GitHub's
practical limit, so a chunker would never split anything.

**422 line-resolution grouping: ADOPT**, implemented under #2930. It is
self-contained,
needs no composite action, and replaces a burst of up to `cap` (50) individual
`createReviewComment` writes with a single grouped `createReview`. On a
`pull_request_target` workflow that burst is itself a secondary-rate-limit risk,
so this is a reliability fix rather than a cosmetic one.

The port is deliberately conservative:

- **Doubly gated.** The new path runs only when the batch error's status is 422
  **and** `isLineResolutionFailure` matches the error text. Every other failure
  — 5xx, network, spam-throttle 422, unrecognised 422 — takes the pre-existing
  per-comment loop untouched.
- **Tri-state, fail-`unknown`.** A comment is skipped only when the diff
  inventory is complete and proves the span is out of diff. Truncated
  pagination, an empty file list, a missing or clipped `patch`, a LEFT-side
  comment, a missing line, or a head SHA that moved during the walk all degrade
  to `unknown`, which means today's behaviour.
- **Patch completeness is proved on both axes.** Each hunk's observed body lines
  must match the header's declared old _and_ new counts — checking only the new
  side would miss a patch truncated inside a run of deletions — and the parsed
  totals must equal the file entry's own `additions`/`deletions`, which is what
  catches a patch truncated exactly on a hunk boundary. A file that fails either
  check is not indexed, so its comments classify `unknown`.
- **No secondary batch unless filtering removed something**, since an unfiltered
  resend would be byte-identical to the payload GitHub just rejected.
- **Dedup runs before either recovery path.** The refreshed key set is applied
  to the candidate pairs before the grouped retry, so the grouped review cannot
  repost a comment the per-comment loop would have skipped. If the grouped write
  itself throws, it may still have been committed, so the key set is re-read
  before the per-comment loop is allowed to repost the survivors.
- **Counters preserved.** A provably-out-of-diff comment still increments
  `failedInline` and still pushes its finding onto `overflowRouted`, exactly as
  the per-comment failure path does today. Working the cases through,
  `publicationState` resolves to `ambiguous` in every branch where it does
  today, so `shouldAdvanceCheckpoint` behaviour is unchanged. The port is
  strictly "same outcomes, fewer API writes".

We do **not** adopt upstream's separate failed-comment summary block; routed
findings continue to render in our existing `### Inline overflow` section so the
sticky summary keeps one shape.

### #2931 — upstream fail-open publication controls (1.8.1) vs our routing

| Dimension             | Upstream (`route_severity_below`, `route_categories`)                                                                                         | Ours (`routeFinding` + `OCR_ROUTING_SHADOW_MODE`)                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration surface | Two string inputs. `route_severity_below` is one of `critical                                                                                 | high                                                                                                                                                       | medium | low`and routes at-or-below that severity;`route_categories` is a case-insensitive comma list drawn from the eight documented categories. Either may be empty. | No routing inputs. The policy is fixed in the workflow: `bug`/`security`/`correctness` are always inline; `high`/`medium` severity is always inline; unknown category or severity is inline; only `info` severity in `maintainability`/`test`/`style`/`other` is routed to the summary. |
| Malformed policy      | `buildPolicy` returns the `NO_ROUTING` sentinel; unknown severity or category tokens are ignored, so a bad policy routes nothing (fail-open). | Every unknown/absent category or severity takes an explicit fail-safe **inline** branch, so a malformed finding is never routed away from inline.          |
| Non-destructive       | Routed findings are pushed to `commentsRouted` and rendered in the summary; nothing is deleted.                                               | Routed findings go to the sticky summary with the original finding object preserved; nothing is deleted.                                                   |
| Publication errors    | Batch failure degrades to reconciliation and per-comment retry; failures are counted in `comments_failed` rather than failing the run.        | Batch failure warns, falls back to per-comment posting, and never fails the workflow; ambiguity is recorded and reconciled.                                |
| Rollout safety        | The policy takes effect as soon as an input is set. There is no dry-run mode.                                                                 | `OCR_ROUTING_SHADOW_MODE` defaults to on: routing decisions are computed and recorded but **not** applied until the variable is explicitly set to `false`. |
| Observability         | `comments_routed` output only.                                                                                                                | Every pre-dedup routing decision (finding, destination, reason) is persisted to `ocr-routing-decisions.json` and uploaded as an artifact.                  |

**Decision: DEFER, keep ours.** Upstream's controls are a real routing policy
rather than a boolean, and their fail-open semantics match ours, but they are
composite-action-only and offer no shadow-mode rollout and no per-decision
audit trail. Our fixed policy is intentionally narrower (it can only route
`info`-severity findings in non-protected categories) and is already wired into
the sticky summary, telemetry and the routing-decisions artifact. Making our
policy configurable along upstream's two axes is a plausible future change, but
it is a behaviour change to publication and is out of scope for a version bump.

- **#2932 (upstream 367, run-manifest coverage contract): DEFER — blocked.**
  Commit `0ce730a` is **5 commits ahead of tag `v1.8.4`**: comparing
  `v1.8.4...0ce730a` through the GitHub compare API reports `ahead_by: 5`,
  `behind_by: 0`, so it is in **no published release** and cannot arrive with
  this bump. Re-evaluate (adopt vs cross-check) when it ships in a tagged
  release.

## Acceptance criteria for this change

1. `OCR_VERSION` is `1.8.4` in `.github/workflows/ocr-review.yml`; the install
   step resolves that exact version
   (`@alibaba-group/open-code-review@${OCR_VERSION}`).
2. The review failure classifier no longer mis-classifies a failure because the
   1.8.x structured usage record on stderr contains a digit run or hex token
   that embeds `429`, `529`, `401` or `403`.
3. Existing OCR CLI wiring (flags, subcommands, preview parser, JSON envelope
   parser, exit codes) is unchanged and stays asserted by tests.
4. This durable version-delta record exists covering 1.7.17 → 1.8.4, following
   the precedent of `dev-docs/ocr-version-1.7.16-comparison.md`, and carries
   the explicit adopt/defer decisions for sub-issues #2930, #2931 and #2932.
5. The PR's own OCR run on 1.8.4 succeeds (end-to-end acceptance evidence).
