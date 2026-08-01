# Issue #2929 — Upgrade OCR 1.7.17 → 1.8.4 and reconcile duplicated upstream fixes

## Target

Bump `OCR_VERSION` in `.github/workflows/ocr-review.yml` from `1.7.17` to
**`1.8.4`** (latest published upstream release).

Upstream 367 (run-manifest coverage contract, commit `0ce730a`) is **merged but
unreleased**: `gh api compare/v1.8.4...0ce730a` reports `ahead_by: 5`,
`behind_by: 0`. It therefore cannot arrive with this bump and is deferred to
sub-issue #2932 with a follow-up bump when upstream releases it.

## CLI/contract verification performed against real 1.8.4 and 1.7.17 binaries

Both versions were installed exactly the way CI installs them
(`npm install --prefix <tmp> --ignore-scripts @alibaba-group/open-code-review@<v>`)
and exercised directly.

| Surface we depend on | 1.7.17 | 1.8.4 | Verdict |
| --- | --- | --- | --- |
| npm wrapper `bin/ocr.js`, `scripts/platform.js` | — | byte-identical | unchanged |
| `optionalDependencies` platform-binary layout | 6 targets | 6 targets | unchanged |
| `ocr version` first line `open-code-review vX.Y.Z (<sha>) <os>/<arch>` | ✓ | ✓ | parser regex unchanged |
| `ocr config set llm.extra_body <json>` / `ocr config set language <lang>` | ✓ | ✓ exit 0, same config.json shape | unchanged |
| `ocr llm test` (env-driven `OCR_LLM_URL`/`OCR_LLM_TOKEN`/`OCR_LLM_MODEL`/`OCR_USE_ANTHROPIC`) | ✓ | ✓ exit 0, clean stderr | unchanged |
| `ocr review` flags `--from --to --format --audience --timeout --concurrency --preview --background` | ✓ | ✓ all present after Cobra migration | unchanged |
| `ocr review --preview` text layout (`Will review (N):`, `Excluded from review (N):`) | ✓ | byte-identical on the same range | parser unchanged |
| review JSON envelope (`status`, `message`, `summary`, `tool_calls`, `comments`, `warnings`, `session_id`) | ✓ | ✓ | parser unchanged |
| `warnings[].type === 'subtask_error'` for review failures | ✓ | ✓ (upstream added `scan_subtask_error` for `ocr scan` only) | unchanged |
| `all %d file review(s) failed` stderr string | ✓ | ✓ | grep unchanged |
| non-zero exit on failure (`main` → `os.Exit(1)`) | ✓ | ✓ | unchanged |

## Behavioural deltas that DO affect us

### D1 — New structured usage record on stderr when a review fails (blocking)

1.8.x adds `emitFailureUsage` (`cmd/opencodereview/output.go`). On the review
failure path with `--format json`, OCR now writes a pretty-printed JSON object
to **stderr** carrying `files_reviewed`, `total_tokens`, `input_tokens`,
`output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `elapsed`,
`budget_exceeded` and `session_id`, followed by
`[ocr] Session: <uuid> (retry with: --resume <uuid>)`.

Our "Run OpenCodeReview" step classifies the failure cause by grepping
`ocr-stderr.log` with **bare, unanchored numbers**:

    grep -Eqi "429|rate limit"
    grep -Eqi "529|overloaded"
    grep -Eqi "401|403|auth|..."

A token counter such as `"total_tokens": 214295` contains `429`; a session UUID
such as `...-429b-...` contains `429` too. After the bump these will
mis-classify genuine failures (e.g. a config error reported as
"HTTP 429 rate limit"), corrupting the sticky-comment reason, the
`ocr-infrastructure-failure.txt` artifact and the telemetry failure reason.

**Fix (in scope, required by acceptance criterion 3):** anchor the numeric
alternatives at token boundaries so a status code only matches when it is not
embedded in a larger number or hex/identifier token:

    (^|[^0-9A-Za-z_-])429([^0-9A-Za-z_-]|$)

Hyphen and alphanumerics are excluded on both sides so hex UUID segments
(`-429b-`, `9f429b`) and long integers (`214295`) never match, while genuine
diagnostics (`HTTP 429`, `status_code=429`, `{"status":429}`, `429 Too Many
Requests`) still do. The non-numeric alternatives (`rate limit`, `overloaded`,
`auth`, …) are untouched.

### D2 — New terminal status `budget_exceeded` (verify, no change expected)

1.8.1 adds token-cost budget guardrails; `output.go` can now emit
`status: "budget_exceeded"` and `summary.budget_exceeded: true`. We never pass
`--max-tokens-budget` (upstream default `0` = unlimited), so it cannot trigger
today. Our completeness resolution is fail-closed — only `success`/`completed`
with exit 0 and an exact file count yields `complete` — so an unrecognised
status degrades to `partial`. This must be pinned by a regression test so a
future upstream default change cannot silently mark a truncated run complete.

### D3 — `.gitignore` negation patterns now honoured (documented)

1.8.4 `fix(diff): honor .gitignore negation patterns`. Verified empirically:
`ocr review --preview --commit 6f52360c2` reports 3 changed files on 1.7.17 and
4 on 1.8.4, the extra entry being `.llxprt/LLXPRT.md` (un-ignored by
`!/.llxprt/`). It lands in *Excluded* (`unsupported_ext`), so the "Will review"
set is unchanged for that commit, but files under a negated path with an
allowlisted extension (e.g. `.llxprt/settings.json`, `docs/reference/**`) will
now enter review scope. This is a correctness improvement, not a regression.

### D4 — Allowlist additions (no impact)

Bicep/HCL/tfvars (1.8.0), Prisma (1.8.1), Protocol Buffers (1.8.2). `git ls-files`
finds zero files of each extension in this repository, so review scope is
unaffected.

### D5 — Cobra migration (1.8.3) (no impact)

`review` is now a `cobra.Command` with `Args: cobra.NoArgs`. Every flag we pass
survives; we pass no positional arguments. `main` still prints `Error: %v` to
stderr and exits `1`.

### D6 — `fix(llm): drop extra_body.stream from non-streaming requests` (1.8.4)

Our default `llm.extra_body` is `{"thinking": {"type": "disabled"}}` — no
`stream` key — so behaviour is unchanged. Noted for the `OCR_LLM_EXTRA_BODY`
repository-variable override path.

## Accepted behaviour to deliver

1. `.github/workflows/ocr-review.yml` pins `OCR_VERSION: '1.8.4'`; the install
   step resolves that exact version (`@alibaba-group/open-code-review@${OCR_VERSION}`).
2. The review failure classifier no longer mis-classifies a failure because the
   1.8.x structured usage record on stderr contains a digit run or hex token
   that embeds `429`, `529`, `401` or `403`.
3. Existing OCR CLI wiring (flags, subcommands, preview parser, JSON envelope
   parser, exit codes) is unchanged and stays asserted by tests.
4. A durable version-delta record exists covering 1.7.17 → 1.8.4, following the
   precedent of `dev-docs/ocr-version-1.7.16-comparison.md`, and carries the
   explicit adopt/defer decisions for sub-issues #2930, #2931 and #2932.

## Out of scope (explicit)

- Migrating to upstream's composite action (`action.yml`,
  `scripts/github-actions/post-review-comments.js`).
- Adopting `--max-tokens-budget`, `--background-file`, `--model`,
  `--max-git-procs`, remote MCP transport, or new allowlist languages.
- Changing checkpoint, routing, manifest or coverage behaviour beyond what the
  bump requires.
- Any follow-up bump for upstream 367 (tracked by #2932).

## Test plan (behavioural, no mock theatre)

All tests operate on the **real** `.github/workflows/ocr-review.yml`, extracting
and executing the real script fragments — the established pattern in
`scripts/tests/ocr-review-workflow-helpers.ts`.

### T1 — pin

- `scripts/tests/ocr-concurrency-canary-2673.test.ts`: assert
  `workflow.env.OCR_VERSION === '1.8.4'`.
- `scripts/tests/ocr-review-workflow.test.ts`: assert the install command
  contains the pinned-version install and rejects `@latest` / stale pins,
  including `1.7.17`.

### T2 — failure classification (new, behavioural)

New test file `scripts/tests/ocr-failure-classification.test.ts`. It extracts
the real classification block from the "Run OpenCodeReview" step of the
workflow, executes it under `bash` against a synthetic `ocr-stderr.log`, and
asserts the reason written to `ocr-infrastructure-failure.txt`.

Cases:

| Input stderr | Expected reason |
| --- | --- |
| 1.8.4 usage JSON with `"total_tokens": 214295` and no real error text | generic `OCR review command failed` (not 429) |
| usage JSON with `"input_tokens": 240123` (embeds `401`) | generic, not auth |
| usage JSON with `"cache_read_tokens": 105295` (embeds `529`) | generic, not overloaded |
| `[ocr] Session: 7c1d429b-...-403a...` line only | generic, not 429/auth |
| `HTTP 429 Too Many Requests` | `HTTP 429 rate limit` |
| `{"status":429}` | `HTTP 429 rate limit` |
| `rate limit exceeded` (no digits) | `HTTP 429 rate limit` |
| `HTTP 529 overloaded` | `HTTP 529 provider overloaded` |
| `401 Unauthorized` | authentication/configuration error |
| `403 Forbidden` | authentication/configuration error |
| `invalid api key` | authentication/configuration error |
| `context deadline exceeded: timed out` | timeout |
| `all 15 file review(s) failed` | all per-file reviews failed |
| usage JSON **plus** a real `HTTP 429` line | `HTTP 429 rate limit` (real signal still wins) |

### T3 — terminal-status regression (new cases in existing suites)

In the reviewed-range-manifest suite, add cases proving the fail-closed
contract holds for the 1.8.x envelope:

- `status: 'budget_exceeded'` + exit 0 + full `files_reviewed` ⇒ completeness
  is **not** `complete`, completed-file set is empty.
- `status: 'completed_with_errors'` + one `subtask_error` warning ⇒ that file is
  reported as failed and completeness is partial.
- `summary.budget_exceeded: true` (an unknown extra field) does not invalidate
  summary parsing or the telemetry summary projection.

### T4 — preview parser fixtures

Add the captured real 1.8.4 preview output (identical layout to 1.7.17,
including the `[A]`/`[M]` markers and `Excluded from review (N):` terminator) as
a fixture case in `scripts/tests/ocr-review-coverage-preview.test.ts` so the
parser is pinned against the shipped version.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, plus the CLI smoke
(`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`).
The PR's own OCR run on 1.8.4 is the end-to-end acceptance evidence
(acceptance criterion 6).

## Sub-issue decisions (recorded in the version-delta doc)

- **#2930 (upstream 479, inline-comment batching, 1.8.0): DEFER.** Composite-action
  only; adopting it means taking `action.yml`, losing our fork-safety sequencing,
  checkpointing, counter/suspension and sticky-summary overflow routing. Our
  `OCR_INLINE_COMMENT_CAP` never drops a finding. Upstream's 1.8.4 422
  single-review grouping is the one candidate worth a separate bounded change.
- **#2931 (upstream 478, fail-open publication controls, 1.8.1): DEFER.**
  Composite-action only. Our severity/category routing plus
  `OCR_ROUTING_SHADOW_MODE` and the pre-dedup `ocr-routing-decisions.json`
  artifact are strictly more conservative and observable than a boolean input.
- **#2932 (upstream 367, run-manifest coverage contract): DEFER — blocked.**
  Commit `0ce730a` is 5 commits ahead of `v1.8.4` and in no published release.
  Re-evaluate (adopt vs cross-check) when it ships.
