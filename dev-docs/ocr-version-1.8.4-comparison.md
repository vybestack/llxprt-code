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
| non-zero exit on failure                                                                                  | ✓      | ✓ (`main` → `os.Exit(1)`)                          | unchanged |

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

A token counter such as `"total_tokens": 214295` contains `429`; a session UUID
such as `...-429b-...` contains `429` too. After the bump these would
mis-classify genuine failures (e.g. a config error reported as
"HTTP 429 rate limit"), corrupting the sticky-comment reason, the
`ocr-infrastructure-failure.txt` artifact and the telemetry failure reason.

**Fix applied (in scope):** anchor the numeric alternatives at token
boundaries so a status code only matches when it is not embedded in a larger
number or hex/identifier token:

```bash
(^|[^0-9A-Za-z_-])429([^0-9A-Za-z_-]|$)
(^|[^0-9A-Za-z_-])529([^0-9A-Za-z_-]|$)
(^|[^0-9A-Za-z_-])(401|403)([^0-9A-Za-z_-]|$)
```

Hyphen and alphanumerics are excluded on both sides so hex UUID segments
(`-429b-`, `9f429b`) and long integers (`214295`) never match, while genuine
diagnostics (`HTTP 429`, `status_code=429`, `{"status":429}`,
`429 Too Many Requests`) still do. The non-numeric alternatives
(`rate limit`, `overloaded`, `auth`, …), the branch order, the reason strings,
`grep -Eqi`, and the surrounding `mark_infrastructure_failure` calls are
untouched.

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

- **#2930 (upstream 479, inline-comment batching, 1.8.0): DEFER.**
  Composite-action only; adopting it means taking `action.yml`, losing our
  fork-safety sequencing, checkpointing, counter/suspension and sticky-summary
  overflow routing. Our `OCR_INLINE_COMMENT_CAP` never drops a finding.
  Upstream's 1.8.4 422 single-review grouping is the one candidate worth a
  separate bounded change.
- **#2931 (upstream 478, fail-open publication controls, 1.8.1): DEFER.**
  Composite-action only. Our severity/category routing plus
  `OCR_ROUTING_SHADOW_MODE` and the pre-dedup `ocr-routing-decisions.json`
  artifact are strictly more conservative and observable than a boolean input.
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
