# Issue #3447: Nightly workflow failed — macos_ci (scripts shard)

## Investigation summary

**Failed run:** 33389396733 (2026-08-31 11:57 UTC), job `macOS CI (Nightly) [scripts]`,
commit `393a0080f` on `main`.

**Failing test:** `scripts/tests/nightly-bun-native-smoke.test.ts` →
`Bun native-module smoke harness > passes its real checks for the current platform`
at exactly 300024.73 ms.

**Evidence chain:**

1. The harness subprocess (`bun scripts/bun-native-modules-smoke.ts`) stdout stops
   after `[PASS] web-tree-sitter + tree-sitter-pwsh WASM` (#3181). On POSIX the
   next check is `checkBunPty` (Bun.Terminal PTY adapter, POSIX-only). Neither its
   `[PASS]`/`[FAIL]` line, nor the harness's own 5 s exit-promise fail-safe, nor
   the final summary ever appeared.
2. A 5 s in-process timer failing to fire means the harness event loop was
   blocked — consistent with a synchronous/loop-blocking hang inside
   `Bun.spawn(..., { terminal })` (the adapter's own header documents Bun PTY
   edge cases, e.g. oven-sh/bun#25822). No in-process guard can bound this.
3. The test's 300 s `AbortSignal` killed the subprocess; the test converted that
   into a clean assertion failure; `bun test` exited 1; the job went red.
4. The exact same commit passed the previous nightly (run 33335701069,
   2026-08-30 21:10 UTC, all jobs green). **Flaky, load-dependent** — not a
   code regression.
5. Not reproducible locally: 20/20 clean sub-second runs on macOS.
6. Prior nightly failures (8/25–8/30) were the Windows classes fixed by #3441;
   this is a distinct macOS class.
7. Precedent: #3439/#3441 established the repo's remedy for exactly this flake
   family — **timeout-only retry** ("a child killed by the per-file timeout gets
   one fresh attempt; a genuine assertion failure never times out and is never
   retried"), owned in `scripts/lib/bun-test-retry.ts`. That policy cannot catch
   this case: the runner classifies timeouts by SIGTERM/SIGKILL kill signals, but
   this test converts its timeout into a normal exit-1 assertion failure.

**Budget math (drives the design):**

- Runner per-file process kill: `processTimeoutFor(entry.timeout ?? run.timeout)`
  = `max(120s, 2 × 180s)` = 360 s for this file today — why the 300.27 s file run
  survived.
- A bounded retry inside the test raises worst-case file time to
  ~2 × 300 s + overhead > 360 s; without a matching per-file override the runner
  would kill the file mid-attempt and convert the flake into a different failure
  class.
- `macos_ci` job budget is 45 min; the shard currently uses ~15 min. A 2-attempt
  worst case (~620 s) fits comfortably.

## Acceptance criteria

- **AC1 — Timeout retry:** When a harness attempt is aborted by the subprocess
  timeout (`ABORT_ERR`/`AbortError`), the test retries the harness subprocess
  within a bounded timeout-retry budget (default 1 retry → 2 attempts, mirroring
  `bun-test-retry.ts`), and passes when a later attempt succeeds.
- **AC2 — Timeout-only policy:** Non-timeout failures (real check failures with
  non-zero exit codes, ENOENT, other execution errors) are never retried; they
  fail on the first attempt with today's diagnostics, preserving deterministic
  breakage detection (identical policy statement to #3439).
- **AC3 — Fail-closed on persistent hang:** When every attempt times out, the
  test fails with a diagnostic naming the per-attempt timeout, the attempt
  count, and each attempt's captured output.
- **AC4 — Knob:** `LLXPRT_BUN_SMOKE_TIMEOUT_RETRIES` — non-negative integer,
  default 1; `0` restores exact single-attempt behavior; invalid values throw a
  clear error (loud-misconfiguration convention of `LLXPRT_BUN_TEST_TIMEOUT_RETRIES`).
  The existing `LLXPRT_BUN_SMOKE_TIMEOUT_MS` knob and its 300 s default are
  unchanged.
- **AC5 — Budget coherence:** The test's bun-test timeout covers the worst case
  `(retries + 1) × (HARNESS_TIMEOUT_MS + 10_000)`, and the `scripts-tests` root
  gains a `timeoutOverrides` entry for `nightly-bun-native-smoke.test.ts` sized
  to the same worst case (issue-2603 pattern), so the runner's per-file kill
  (`2 × entry.timeout`) never fires first.
- **AC6 — Coverage preserved:** The main test still runs the real harness and
  requires `All native-module smoke checks passed under Bun`; the three
  workflow-contract tests in the file are unchanged.

## Test plan (behavioral; real subprocesses, no mock theater)

New fixture `scripts/tests/fixtures/bun-smoke-harness-fixture.ts` — a real bun
script controlled by `SMOKE_FIXTURE_MODE`:

- `pass` → prints `All native-module smoke checks passed under Bun.`, exit 0
- `fail` → prints a `[FAIL]` line, exit 1
- `hang` → stays alive forever (real event-loop hang)
- `hang-once` → hangs unless a marker file exists (created on first hang), so
  attempt 2 passes — drives the retry-then-pass path end-to-end

Tests (in `scripts/tests/nightly-bun-native-smoke.test.ts`, next to the code they
cover, using a small per-attempt timeout of ~1.5–2 s so the suite stays fast):

1. **timeout then pass** — `hang-once` fixture + 1 retry → resolves; exactly 2
   attempts ran.
2. **persistent hang fails closed** — `hang` fixture + 1 retry → fails; message
   names the timeout and both attempts.
3. **no retry on check failure** — `fail` fixture + retries available → fails
   immediately, 1 attempt, exit-code diagnostic.
4. **no retry on ENOENT** — nonexistent executable → install-hint error, 1 attempt.
5. **retries=0 is today's behavior** — `hang` fixture, budget 0 → fails after
   exactly 1 attempt.
6. **knob resolution** — default 1; `0` → 0; `3` → 3; `abc`/`-1`/`1.5` → throw.
7. **root override wiring** — extend the existing
   `applies the slow timeout override to the release-install smoke` meta-test in
   `bun-test-roots.bun.test.ts` to also assert the smoke file's override value
   (and keep the negative case).

## Implementation shape

- New `scripts/lib/bun-smoke-harness.ts`: one-attempt execution (execFileAsync +
  AbortSignal) with discriminated outcome classification, the timeout-only retry
  loop, and knob resolution; exported pure decision parts for unit tests. This
  mirrors the placement and role of `scripts/lib/bun-test-retry.ts` (created for
  the analogous #3439 fix) — the established pattern, not a new subsystem.
- `scripts/tests/nightly-bun-native-smoke.test.ts`: the harness-execution test
  delegates to the lib; new behavioral tests as listed.
- `scripts/bun-test-roots.ts`: `timeoutOverrides` +=
  `{ pattern: /nightly-bun-native-smoke\.test\.ts$/, timeout: 620_000 }`
  (620_000 = 2 × (300_000 + 10_000)).

## Out of scope

- No changes to `bunPtyAdapter.ts`, the harness checks, or the Bun pin — no
  root-cause access to the runtime flake; retry is the repo's established remedy
  for this class.
- No changes to the Windows smoke job, other runners, or `bun-test-retry.ts`.
- No workflow/YAML changes.

## Verification

Full cycle per the issue workflow: `npm run test`, `npm run lint`,
`npm run typecheck`, `npm run format`, `npm run build`, then the smoke test
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

## Review round 1 (deepthinker)

- **MEDIUM:** The static `620_000` registry override was coherent only with the
  default knobs. Non-default retries or harness timeouts could collide with the
  runner's per-file kill budget.
- **Disposition:** In-scope-Fix.
- **Remediation:** Use one shared `smokeTestFileTimeoutMs` formula for both the
  registry override and the test timeout.

## Review round 2 (deepthinker)

- **MEDIUM:** Extreme accepted knob values could push the shared budget past
  Bun's `--timeout` domain of 2^32-1, such as timeout `2147473648` or retries
  `13854`.
- **Disposition:** In-scope-Fix.
- **Remediation:** Fail fast when the computed budget exceeds Bun's maximum and
  cover the rejected values and accepted boundary with tests.
- Review rounds are capped at two per policy, so no third review round runs.

## OCR review round 1 (local, pre-push)

- **MEDIUM (bug):** On attempt timeout, `execFile`'s `AbortSignal` kills only
  the direct child, so a genuinely hung harness could leak PTY-backed
  grandchildren across retry attempts.
- **Disposition:** Defer (documented known follow-up).
- **Rationale:**
  - Pre-existing boundary: the original test used the identical
    `execFileAsync` + `AbortSignal.timeout` single-attempt kill semantics;
    retries only marginally amplify a narrow scenario on an already-red
    pipeline.
  - In the observed nightly hang the PTY child (`sh -c echo ...`) completes in
    milliseconds; when the harness dies, the PTY master fd closes and the
    kernel SIGHUPs the slave's process group, covering the common leak path.
  - The suggested remediation (detached session-leader spawn + group kill)
    plausibly changes Bun.Terminal PTY allocation semantics for the real
    harness — the exact subsystem whose flake this change routes around — and
    cannot be validated against macOS CI runners locally. That is a behavioral
    change beyond this issue's scope.
- OCR rounds used: 1 of 2.
