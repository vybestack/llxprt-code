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

| Dimension                   | Upstream (`post-review-comments.js`, `action.yml`)                                                                                                                                                                                                                                       | Ours (`ocr-review.yml`)                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch sizing                | `review_comment_batch_size` input, default `50`, integer >= 1; non-numeric or < 1 falls back to 50. `chunkArray(sorted, batchSize)` over every comment.                                                                                                                                  | `OCR_INLINE_COMMENT_CAP` repository variable, default `50`, non-integer or <= 0 falls back to 50. A **cap**, not a chunker.                                                                                                 |
| Determinism                 | `sortToSendDeterministically(toSend)` before chunking, so identical reruns produce identical batches (this is what makes per-batch reconciliation work).                                                                                                                                 | `sortInlineComments` orders by severity rank before the cap, so the highest-priority findings are the ones posted inline.                                                                                                   |
| Comments beyond the first N | Posted, in later sequential `createReview` batches. Nothing is left unposted.                                                                                                                                                                                                            | Not posted inline. Moved to `overflowRouted` and rendered in the sticky summary with the original finding object intact.                                                                                                    |
| Findings dropped            | None.                                                                                                                                                                                                                                                                                    | None.                                                                                                                                                                                                                       |
| 422 handling                | Tri-state: `isLineResolutionFailure` gates a diff-hunk filter; comments outside the hunks are routed to the summary-failure list, unknown-patch comments are posted individually, and the remaining valid ones go in **one** secondary filtered `createReview` (the 1.8.4 grouping fix). | Batch failure of any kind falls back to posting each capped comment individually, with `existingInlineCommentKeys()` dedup and a reconciliation retry that clears `batchPublicationAmbiguous`. No diff-hunk classification. |
| Idempotency / dedup         | Per-run `REVIEW_TAG` in the review body; on batch failure, re-reads to prove which comments already landed.                                                                                                                                                                              | Trusted-marker comment plus per-head exact inline key dedup (`inlineCommentKey`), and reconcile-with-retry after an ambiguous batch. Upstream has no notion of our trusted marker.                                          |
| Observability               | `comments_total` / `comments_inline` / `comments_skipped` / `comments_routed` / `comments_failed` / `summary_comment_url` action outputs.                                                                                                                                                | Sticky-summary counters plus `ocr-routing-decisions.json`, `ocr-coverage-report.json`, `ocr-reviewed-range-manifest.json` artifacts.                                                                                        |
| Cost of adoption            | Requires running upstream's composite action, which owns checkout, install and posting. Our fork-safety sequencing (`pull_request_target` with no PR-supplied code in scope), checkpoint read/advance, auto-review counter and suspension all live in our workflow around those steps.   | —                                                                                                                                                                                                                           |

**Decision: DEFER, keep ours.** Both designs are deterministic and neither
drops a finding; the difference is that upstream posts everything across
batches while we cap inline volume deliberately and route the remainder to the
sticky summary, which is the behaviour #2649/#2666 asked for. Adoption is
all-or-nothing on the composite action and would cost the fork-safety,
checkpointing and suspension logic that only exists in our workflow.

**Partial-adoption candidate (not taken here):** upstream's 422 handling is
genuinely better than ours — it distinguishes a line-resolution 422 from any
other 422, filters against the PR's diff hunks, and re-groups the survivors
into a single review instead of N individual calls. That is a bounded,
self-contained improvement to our fallback path and is worth its own issue; it
does not require the composite action.

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
