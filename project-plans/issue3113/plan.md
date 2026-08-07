# Execution Plan — issue #3113

Plan ID: PLAN-20260807-ISSUE3113
Generated: 2026-08-07
Branch: `issue3113`
Base commit: `2ae245b8d`

Artifacts: [`specification.md`](./specification.md) ·
[`preflight-verification.md`](./preflight-verification.md) ·
[`pseudocode.md`](./pseudocode.md) ·
[`test-matrix.md`](./test-matrix.md)

Preflight gate: **PASSED**, no blocking issues (`preflight-verification.md`
section 7).

---

## Scope, in one paragraph

`packages/core/src/utils/errorReporting.ts` gains a bounded serialization
pipeline, compact output, oldest-first rotation under a count and total-byte
budget, and fixed-window duplicate coalescing — all module-private, with its
public signature, filename format, and both fallbacks preserved.
`packages/agents/src/core/turn.ts` stops concatenating the request onto the full
curated history and instead passes `{ request, recentHistory, omittedHistoryCount }`
with an 8-entry tail. Nothing else changes.

---

## Phases

Phases run in order. A phase may not start until the previous one is verified.

### P01 — RED: core bounding, compact output, and preserved contract

Create `packages/core/src/utils/errorReporting.bounding.bun.test.ts` importing
`describe`, `it`, `expect`, `beforeEach`, `afterEach`, `spyOn` from `bun:test`.
Implement matrix rows **B1-B13**. One temp-dir lifecycle for the file.

Run and record output. Rows marked RED must fail; rows marked GUARD must pass.

```bash
cd packages/core && bun test src/utils/errorReporting.bounding.bun.test.ts
```

**Gate:** every RED row observed failing, with the failure message captured into
`## RED evidence` below. A RED row that passes means the test does not actually
exercise the accepted behavior — fix the test, do not proceed.

### P02 — RED: rotation

Create `packages/core/src/utils/errorReporting.rotation.bun.test.ts`. Implement
rows **R1, R2, R3, R4, R6, R7, R8**. Seed pre-existing reports directly with
`fs.writeFile` using zero-padded ordinals. Same gate as P01.

### P03 — RED: duplicate coalescing

Create `packages/core/src/utils/errorReporting.dedupe.bun.test.ts` importing
`setSystemTime` directly from `bun:test`; reset it in `afterEach`. Implement
rows **D1-D11**, observing the mandatory clock discipline in `test-matrix.md`:
pin `t0` in `beforeEach` and advance the clock through the single `advanceTo`
helper before every subsequent `reportError` call into the same directory.

Two incidental-pass traps are in force in this phase and the gate below checks
both:

- Without a clock advance, two same-millisecond writes of one `type` collapse
  onto one path on the base commit, so D1 and D7 would pass with no
  deduplication at all.
- With rotation capping the directory at `MAX_REPORT_FILES`, a file-count
  assertion proves nothing about the registry, which is why D9 asserts
  observable suppression instead.

**Gate:** as P01, plus an explicit check that D1, D7, and D9 fail on the base
commit for the stated reason and not for a filename collision — the recorded
failure message must show the *two distinct advanced filenames* (D1, D7) or the
`Full report available at:` line where `Duplicate error report suppressed` was
expected (D9).

### P04 — RED: Turn payload, end to end

Create `packages/agents/src/core/turn.errorReport.bun.test.ts` importing from
`bun:test` directly. Real `Turn`, real core `reportError`, `ChatSession`
fixture, `process.env.TMPDIR` redirected to a `mkdtemp` directory and restored
in `afterEach`. Compare against `fs.realpath` of that directory when asserting
paths, because `os.tmpdir()` returns `TMPDIR` verbatim. Implement rows
**T1-T8**.

```bash
cd packages/agents && bun test src/core/turn.errorReport.bun.test.ts
```

Same gate as P01.

### P05 — Implement the core writer

Modify `packages/core/src/utils/errorReporting.ts` only, following
`pseudocode.md` component 1 line by line. Each helper carries
`@plan PLAN-20260807-ISSUE3113.P05`, its `@requirement`, and its `@pseudocode`
line range.

Order of work, each step keeping the file compiling:

1. Add the `node:buffer` and `node:crypto` imports and the module-private constants (constants block). Both are Node built-ins already used in `packages/core`; neither is a dependency or a public abstraction.
2. `clampString`, `stringifyClamped` (lines 010-029) — REQ-3113-1.2, REQ-3113-2.
3. `serializeBoundedReport` (lines 040-061) — REQ-3113-1.2/1.3/1.4.
4. `buildFingerprint` (lines 070-079, fixed-size SHA-256 over the complete framed components — no slice), `consumeDuplicate`, `rememberReport` (lines 080-111) — REQ-3113-4.
5. `collectReportFiles`, `rotateReports` (lines 120-161) — REQ-3113-3.
6. `writeMinimalReport` returns `boolean` and emits compact JSON (lines 170-182).
7. Rewire `reportError` (lines 190-240).

Constraints enforced while writing, not afterwards: no export beyond
`reportError`; no `JSON.stringify` call before pseudocode line 209 (the digest
adds none); the fingerprint is never sliced, truncated, or built by
concatenating its components into one string; helpers each well under
`max-lines-per-function: 80`; swallowing uses `} catch {` with a justifying
comment; no suppression directive of any kind.

```bash
cd packages/core && bun test src/utils/errorReporting.bounding.bun.test.ts \
  src/utils/errorReporting.rotation.bun.test.ts \
  src/utils/errorReporting.dedupe.bun.test.ts src/utils/errorReporting.test.ts
```

**Gate:** all four files green, including the **unmodified** Vitest-importing
`errorReporting.test.ts`. `git diff --stat` shows `errorReporting.test.ts` with
zero changes.

### P06 — Implement the Turn caller

Modify `packages/agents/src/core/turn.ts` only: add the module-private
`TURN_REPORT_HISTORY_TAIL = 8` and replace lines 588-594 per `pseudocode.md`
component 2 (lines 300-322). Delete the superseded assertion at
`packages/agents/src/core/turn.test.ts:298-303` — deletion only; no other line
of that file changes and its framework import is untouched.

```bash
cd packages/agents && bun test src/core/turn.errorReport.bun.test.ts src/core/turn.test.ts
```

**Gate:** both green. `git diff packages/agents/src/core/turn.test.ts` shows only
removed lines.

### P07 — Full verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Plus the defect-closure check — run a real session that provokes a provider
error and confirm the reporting directory stays inside both budgets:

```bash
T=$(node -p 'require("os").tmpdir()')
find "$T" -maxdepth 1 -name 'llxprt-client-error-*.json' -type f -exec stat -f '%z' {} + \
  | awk '{s+=$1; n++} END {printf "count=%d total_bytes=%d\n", n, s}'
# Expected after the change, for reports written by the new build:
#   count <= 20 and total_bytes <= 1048576
```

Note: the ~4,380 files already on disk predate the fix. Move them aside before
measuring; migrating existing accumulation is **Defer** (rubric section below).

**Gate:** all commands exit 0; no new lint warning (`lint:ci` runs
`--max-warnings 0`).

### P08 — Review

1. DeepThinker review for issue intent and specification compliance.
2. Open Code Review, detached, with test files included:

```bash
nohup ocr review --audience agent --timeout 20 > /tmp/ocr_review_3113.log 2>&1 & echo PID=$!
```

Poll the log and the PID until the process exits. Do not run it in the
foreground. If stdout is lost, recover findings from
`~/.opencodereview/sessions/*/*.jsonl` by grepping for `code_comment`.

3. Triage every finding with the rubric below, then re-run P07.

### P09 — PR and CI

Push, open the PR with `gh` including `Fixes #3113`, then watch CI with a
5-minute interval and a tool timeout comfortably above it. Triage CodeRabbit
findings with the same rubric, fix, re-verify, push, and watch again until every
check is green and every required thread is resolved. Do not merge; report status
and wait for explicit confirmation.

---

## Requirement -> evidence map

| Requirement | Production change | Behavioral evidence |
|---|---|---|
| REQ-3113-1.1 Turn separates request from bounded tail | `turn.ts` lines 300-322 of pseudocode | T1, T2, T3, T4 |
| REQ-3113-1.2 Per-string clamp | `clampString` / `stringifyClamped` | B3, B4, B9 |
| REQ-3113-1.3 Array-context tail clamp | `serializeBoundedReport` S3 | B5, B5b |
| REQ-3113-1.4 Hard payload cap | `serializeBoundedReport` S4 | B6, B7, B8, T5 |
| REQ-3113-2 Compact JSON | both `JSON.stringify` sites | B1, B2, T6 |
| REQ-3113-3 Rotation | `collectReportFiles` / `rotateReports` | R1, R2, R3, R4, R6, R7, R8 |
| REQ-3113-4 Coalescing | `buildFingerprint` / `consumeDuplicate` / `rememberReport` | D1-D11 (D9 registry bound, D10 eviction direction, D11 no truncation collision) |
| REQ-3113-5 Preserved contract | signature, filename, both fallbacks untouched | B10, B11, B12, B13, T7, T8, and `errorReporting.test.ts` unmodified and green |

---

## RED evidence

Filled in during P01-P04, before any production edit. Each entry records the
test ID and the observed failure against the base commit.

| Test ID | Observed failure on base commit |
|---|---|
| B1 | `expect(raw.includes('
')).toBe(false)` — Received: true (pretty-printed) |
| B2 | `expect(raw.includes('
')).toBe(false)` — Received: true (minimal report pretty-printed) |
| B3 | `context.blob.endsWith(expectedMarker)` — Received: false (no clamping; full 10k chars stored) |
| B5 | `expect(context.length).toBe(8)` — Received: 200 (no array tail clamp) |
| B5b | `expect(stat.size).toBeLessThanOrEqual(131072)` — Received: 610151 |
| B6 | `expect(stat.size).toBeLessThanOrEqual(131072)` — Received: 32156957 |
| B7 | `expect(stat.size).toBeLessThanOrEqual(131072)` — Received: 803759 |
| B9 | `err.stack.endsWith(expectedMarker)` — Received: false (stack not clamped) |
| R1 | `expect(files.length).toBe(20)` — Received: 21 (no rotation) |
| R2 | `seed00Name` expected undefined — Received: "llxprt-client-error-seed-00-..." (oldest not deleted) |
| R3 | `seed00Name` expected undefined — Received: "llxprt-client-error-seed-00-..." (byte cap not enforced) |
| R4 | `expect(files.length).toBe(20)` — Received: 22 (no rotation; dir not excluded) |
| R8 | `expect(files.length).toBeLessThanOrEqual(20)` — Received: 31 (no rotation) |
| D1 | `expect(filesAfterSecond.length).toBe(1)` — Received: 2 (two distinct filenames T00-00-00-000Z and T00-00-01-000Z) |
| D5 | `expect(after59999.length).toBe(1)` — Received: 2 (no dedupe) |
| D6 | `expect((await listMatchingFiles()).length).toBe(1)` — Received: 2 (no fixed window) |
| D7 | `expect(files.length).toBe(1)` — Received: 2 (suppressed call writes new file) |
| D9 | `expectStderrContaining('Duplicate error report suppressed')` — false (no registry; stderr shows `Full report available at:` instead) |
| T1 | `report.recentHistory` is undefined — context is flat 26-element array |
| T2 | `report.request` is undefined — request is last element of flat array |
| T3 | `report.recentHistory` is undefined — context is `[reqParts]` |
| T4 | `report.recentHistory` is undefined — context is flat 4-element array |
| T5 | `expect(stat.size).toBeLessThanOrEqual(131072)` — Received: 4026692 (unbounded context) |
| T6 | `raw.includes('
')` — Received: true (pretty-printed) |

GUARD rows passing: B4, B8, B10, B11, B12, B13, R6, R7, D2, D3, D4, D8, D10, D11, T7, T8.

An implementation phase may not begin until this table covers every RED row in
`test-matrix.md`.

---

## Review-finding triage rubric

Every finding from Open Code Review, DeepThinker, CodeRabbit, or a human
reviewer is labeled with **exactly one** category, recorded with a one-line
reason.

| Category | Definition | Action |
|---|---|---|
| **Blocker-Fix** | An accepted behavior (REQ-3113-1..5) is not met, a preserved contract is broken, a test is non-behavioral or would pass against unchanged code, a prohibited construct was introduced (`eslint-disable`, `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`, severity downgrade, ignore-file addition, threshold increase), or verification/CI fails. | Fix before push or merge. Non-negotiable. |
| **In-scope-Fix** | Correct and inside issue #3113's four behaviors: a wrong constant, non-deterministic ordering, a residual unbounded path, a missing boundary test, a misleading name or comment in the changed code. | Fix in this PR. |
| **Reject** | Factually wrong, or contradicts a recorded decision — for example "add a setting for full-history capture", "use a sliding window", "add age-based expiry", "truncate the fingerprint instead of hashing it", "`node:crypto` is a new dependency", "also fix the MCP `reportError`", "export the constants so tests can import them". | Reply citing the deciding section of `specification.md`. No code change. |
| **Defer** | Legitimate but outside issue #3113: the pre-existing filename collision when two distinct errors land in the same millisecond (worked around in tests by clock advancement, not fixed here), a retention/redaction policy for sensitive report content, telemetry for suppressed reports, cleanup of the ~4,380 files already accumulated on developer machines. | File a follow-up issue, link it in the PR thread. No code change here. |

Cap: at most two local OCR passes and two PR OCR passes.

---

## Completion conditions

- Every accepted behavior has direct behavioral evidence, and every RED row was
  observed failing before the corresponding production edit **for the reason the
  row states** — not because two writes collided on one millisecond-resolution
  filename, and not because rotation held a file count constant.
- The fingerprint is a fixed-size digest over the complete `type`,
  `baseMessage`, and normalized message; no code path truncates it or its
  inputs, and D11 demonstrates that two messages differing only after character
  512 are not coalesced.
- `packages/core/src/utils/errorReporting.test.ts` is byte-identical to the base
  commit and still green.
- `reportError`'s signature, filename format, and both fallbacks are unchanged.
- No dependency, setting, workflow, agent memory, quality-tool change, public
  abstraction, unrelated refactor, suppression directive, or threshold change was
  introduced. `package.json` and the lockfile are untouched: the only additions
  are the Node built-ins `node:buffer` and `node:crypto`.
- `packages/agents/src/core/turn.test.ts` is changed by deletion only.
- Full local verification passes on the candidate head.
- Reviews are complete and every finding is triaged into exactly one rubric
  category, with all Blocker-Fix and In-scope-Fix findings resolved.
- CI is green on the candidate head, required threads are resolved, ancestry is
  current, and the PR is conflict-free.
- Merge is **not** performed; status is reported and explicit confirmation is
  awaited.
