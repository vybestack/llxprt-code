# Behavioral Test Matrix — issue #3113

Plan ID: PLAN-20260807-ISSUE3113
Generated: 2026-08-07

Every accepted requirement is marked and mapped to concrete evidence. Each row
states whether the test is **RED** (fails against the base commit `2ae245b8d`,
proving the accepted behavior) or **GUARD** (passes today and must keep passing,
proving a preserved contract or protecting against over-correction). A plan with
only RED rows silently permits regressions; a plan with only GUARD rows proves
nothing new. Both are required.

A GUARD row may additionally be annotated **"fails against \<rejected
design\>"**. That is the strongest form of GUARD: the base commit cannot
exercise the behavior at all, so no RED classification is available, but the row
still discriminates the accepted design from a specific rejected one. D11 is
such a row.

Every row must also survive the question *"could this pass against unchanged
code for an incidental reason?"* — see the self-check at the end of this file.
Two incidental-pass mechanisms exist in this codebase and are neutralized
explicitly below: the millisecond-resolution filename collapsing two writes onto
one path, and rotation pinning the matching-file count at `MAX_REPORT_FILES`
regardless of deduplication.

## Test files

| File | Framework import | Purpose |
|---|---|---|
| `packages/core/src/utils/errorReporting.bounding.bun.test.ts` | `bun:test` (direct) | REQ-3113-1.2/1.3/1.4, REQ-3113-2, REQ-3113-5 |
| `packages/core/src/utils/errorReporting.rotation.bun.test.ts` | `bun:test` (direct) | REQ-3113-3 |
| `packages/core/src/utils/errorReporting.dedupe.bun.test.ts` | `bun:test` (direct) | REQ-3113-4 |
| `packages/agents/src/core/turn.errorReport.bun.test.ts` | `bun:test` (direct) | REQ-3113-1.1 end to end |
| `packages/agents/src/core/turn.test.ts` | unchanged (`../testApi.js`, a typed re-export of `bun:test`) | **Deletion only** of the superseded assertion at lines 298-303 |
| `packages/core/src/utils/errorReporting.test.ts` | Vitest | **NOT MODIFIED.** Compatibility audited in `specification.md` section 10. |

### Why the split into three core files

Each Bun test file runs in its own process (`packages/core/run-bun-tests.ts`
spawns `bun test <file>` per file), so the module-private dedupe registry cannot
leak between files. Rotation cases therefore never contend with dedupe state and
vice versa.

### Distinct-fingerprint discipline (all four new files)

The dedupe registry is **process-scoped**, not directory-scoped: a fresh
`mkdtemp` directory per test does **not** reset it. Two tests in the same file
that report the same `(type, baseMessage, message)` triple within 60 s would see
the second one suppressed, so no report file would be written and the assertion
would fail for a reason unrelated to what it tests.

Therefore every test in every new file uses a distinct error message (or a
distinct `type`) unless the row is deliberately exercising coalescing. This
binds hardest in `turn.errorReport.bun.test.ts`, where `type`
(`Turn.run-sendMessageStream`) and `baseMessage`
(`Error when talking to ${providerName} API`) are fixed by the production code:
there, **the error message is the only free component**, so each of T1-T8 must
throw a distinctly-worded error from its `ChatSession` fixture.

### Why `turn.test.ts` is only edited by deletion

Its assertion at lines 298-303 encodes the defective contract
(`[...historyContent, reqParts]`). RULES.md forbids leaving a passing test that
asserts superseded behavior. The replacement assertion is stronger — it reads
the real report file instead of inspecting mock arguments — and lives in the new
file that imports `bun:test` directly, so **every changed or added assertion for
this issue sits in a direct-`bun:test` file**. `turn.test.ts` keeps its
`reportError` import, which is still used by its lines 243 and 271, and its
`vi.mock` is process-local so it cannot affect the new file.

### Shared setup discipline

Each file declares **exactly one** temp-directory lifecycle
(`beforeEach` create via `fs.mkdtemp`, `afterEach` `fs.rm(..., { recursive: true, force: true })`)
at the top of its single `describe`. No `beforeEach` block is duplicated across
`describe` blocks (RULES.md, "DRY setup").

---

## REQ-3113-1 — Bounded report payload

### REQ-3113-1.1 — Turn separates request from bounded history tail

File: `packages/agents/src/core/turn.errorReport.bun.test.ts`.
Real `Turn` + real core `reportError`; `reportError` is **not** mocked. The
`ChatSession` collaborator is a fixture because it is the provider/network
boundary. `process.env.TMPDIR` is set to the realpath of a fresh `mkdtemp`
directory in `beforeEach` and restored in `afterEach`; `os.tmpdir()` was
verified to resolve `TMPDIR` at call time under Bun (see
`preflight-verification.md` section 4). Assertions read the file that
`reportError` actually wrote.

| ID | Given / When / Then | Evidence | Base-commit result |
|---|---|---|---|
| T1 | GIVEN curated history of 25 entries; WHEN `Turn.run` fails; THEN `context.recentHistory` has length 8 and deep-equals `history.slice(-8)`, and `context.omittedHistoryCount === 17` | parsed report file | **RED** — today `context` is a flat 26-element array with no `recentHistory` key |
| T2 | GIVEN the same failure; THEN `context.request` deep-equals the request blocks and is not an element of `context.recentHistory` | parsed report file | **RED** — today the request is the last element of the flat array |
| T3 | GIVEN empty curated history; THEN `context.recentHistory` is `[]` and `context.omittedHistoryCount === 0` and `context.request` is present | parsed report file | **RED** — today `context` is `[reqParts]` |
| T4 | GIVEN 3 curated entries (shorter than the tail); THEN `context.recentHistory` has all 3 and `omittedHistoryCount === 0` | parsed report file | **RED** |
| T5 | GIVEN 200 curated entries each carrying a 20,000-character text block; THEN the written report file is at most 131,072 bytes and still contains 8 `recentHistory` entries | `fs.stat().size` of the written file | **RED** — today the file is multiple MB (the defect: size scales with context) |
| T6 | GIVEN any Turn failure; THEN the written report text contains no `\n` | raw file text | **RED** — today pretty-printed |
| T7 | GIVEN any Turn failure; THEN exactly one `AgentEventType.Error` event is yielded with the unchanged structured error | yielded events | **GUARD** — the surrounding `handleRunError` behavior must not change |
| T8 | GIVEN a Turn failure; THEN exactly one `llxprt-client-error-Turn.run-sendMessageStream-*.json` file exists in the reporting directory | directory listing | **GUARD** — reporting is not accidentally disabled |

### REQ-3113-1.2 — Per-string clamp

File: `errorReporting.bounding.bun.test.ts`.

| ID | Given / When / Then | Evidence | Base-commit result |
|---|---|---|---|
| B3 | GIVEN `context = { blob: 'a'.repeat(10_000) }`; THEN the stored string starts with the first 4,096 `'a'`s, ends with `' [truncated: 10000 chars]'`, and its length is `4096 + marker.length` | parsed report | **RED** — today all 10,000 characters are stored |
| B4 | GIVEN a string of exactly 4,096 characters; THEN it is stored verbatim with no marker | parsed report | **GUARD** — boundary: the clamp must be `>` not `>=` |
| B9 | GIVEN an `Error` whose `stack` is 10,000 characters; THEN `error.stack` in the report is clamped with the same marker | parsed report | **RED** — proves the clamp is uniform, not context-only |

### REQ-3113-1.3 — Array-context tail clamp

| ID | Given / When / Then | Evidence | Base-commit result |
|---|---|---|---|
| B5 | GIVEN `context` = 200 entries of `{ text: 'x'.repeat(3_000) }` (serializes far above 128 KiB); THEN `context` has 8 entries deep-equal to the last 8 inputs and `contextTruncated.omittedEntries === 192` | parsed report | **RED** — today all 200 entries are written |
| B5b | GIVEN the same report; THEN the file is at most 131,072 bytes | `fs.stat().size` | **RED** |

### REQ-3113-1.4 — Hard payload cap

| ID | Given / When / Then | Evidence | Base-commit result |
|---|---|---|---|
| B6 | GIVEN an **array** context of 200 entries whose last 8 entries still exceed 128 KiB (each entry an object with 40 keys of 4,000-character strings); THEN the report has no `context` key and carries `contextOmitted.reason === 'payload-exceeded-limit'` and `contextOmitted.limitBytes === 131072`, and the file is under 131,072 bytes | parsed report + `fs.stat().size` | **RED** — proves the S3 -> S4 fallthrough |
| B7 | GIVEN a **non-array** context (an object with 200 keys of 4,000-character strings); THEN the same `contextOmitted` shape and size bound hold | parsed report + `fs.stat().size` | **RED** — this is the `generateContent-api` caller shape |
| B8 | GIVEN a small context `{ data: 'test context' }`; THEN the report is exactly `{ error, context }` with no `contextTruncated` and no `contextOmitted` key | parsed report | **GUARD** — over-eager clamping would break the unmodifiable Vitest test |

---

## REQ-3113-2 — Compact JSON

| ID | Given / When / Then | Evidence | Base-commit result |
|---|---|---|---|
| B1 | GIVEN any successful report write; THEN the raw file text contains no `\n`, and `JSON.parse` of it equals the expected object | raw text + parse | **RED** — today `JSON.stringify(..., null, 2)` |
| B2 | GIVEN `context = { big: BigInt(1) }` so serialization throws; THEN the **minimal** fallback file is written, contains no `\n`, and parses to `{ error: { message, stack } }` | raw text of the minimal report | **RED** — the minimal report is pretty-printed today |

---

## REQ-3113-3 — Rotation

File: `errorReporting.rotation.bun.test.ts`. Pre-existing reports are seeded
directly with `fs.writeFile` using zero-padded ordinals
(`llxprt-client-error-seed-00-...json` .. `seed-NN-...json`) so lexicographic
name order equals creation order; this makes oldest-first deletion deterministic
even when `mtimeMs` ties on fast writes. Distinct `type` values also guarantee
distinct fingerprints, so REQ-3113-4 never interferes.

| ID | Given / When / Then | Evidence | Base-commit result |
|---|---|---|---|
| R1 | GIVEN a directory seeded with exactly 20 small report files; WHEN one more report is written; THEN exactly 20 files matching `/^llxprt-client-error-.*\.json$/` remain | directory listing | **RED** — today 21 remain |
| R2 | GIVEN R1's arrangement; THEN the surviving set is exactly `seed-01`..`seed-19` plus the newly written report; `seed-00` is gone and the new report is present and parseable | directory listing + read | **RED** — proves oldest-first and that the new report is never its own victim |
| R3 | GIVEN a directory seeded with 8 report files of 130,000 bytes each (1,040,000 bytes, under both budgets); WHEN one more small report is written; THEN the total size of matching files is at most 1,048,576 and exactly 8 files remain, with `seed-00` deleted | listing + summed `fs.stat().size` | **RED** — today 9 files totalling ~1.04 MB plus the new report |
| R4 | GIVEN a directory seeded with 20 reports plus `unrelated.json`, `llxprt-client-error-x.json.tmp`, `notes.txt`, and a **directory** named `llxprt-client-error-dir.json`; WHEN one more report is written; THEN matching regular files number exactly 20 **and** all four non-matching entries still exist | listing + `fs.stat` | **RED** via the count assertion; simultaneously proves the pattern and `isFile()` guards |
| R6 | GIVEN a directory with 3 reports (well under both budgets); WHEN one more is written; THEN all 4 exist | listing | **GUARD** — rotation must not delete when it has no reason to |
| R7 | GIVEN a fixed system time and a directory seeded with 25 report files, where a **directory** already occupies the exact path the next report would take (so `fs.writeFile` fails with `EISDIR`); WHEN `reportError` is called; THEN it resolves, emits the existing write-failure stderr fragments, and all 25 seeded files still exist | listing + captured stderr | **GUARD** — proves rotation runs only after a **successful** write and that a failed write deletes nothing |
| R8 | GIVEN a directory seeded with 5 reports and one `unrelated.json`; WHEN 25 `reportError` calls with distinct types run under a single `Promise.all`; THEN the aggregate promise resolves with no rejection and `unrelated.json` survives; AND WHEN one further sequential `reportError` with a **26th distinct type** completes; THEN matching files number at most 20 | listing after each stage | **RED** on the final assertion — today the count grows without bound. Encodes the documented concurrency contract: best-effort during overlap, exact after any completed non-concurrent write. The 26 distinct types give 26 distinct fingerprints *and* 26 distinct filenames, so neither REQ-3113-4 suppression nor a same-millisecond path collision can interfere — the final call must actually write and therefore must actually rotate. |

---

## REQ-3113-4 — Duplicate coalescing

File: `errorReporting.dedupe.bun.test.ts`. `setSystemTime` is imported directly
from `bun:test` (availability verified in `preflight-verification.md` section 4)
and reset to real time in `afterEach`.

### Clock discipline (mandatory, applies to every row in this section)

The report filename is frozen at millisecond resolution
(`llxprt-client-error-${type}-${timestamp}.json`, REQ-3113-5). Two calls with
the same `type` in the same millisecond therefore resolve to the **same path**,
and the second write silently overwrites the first. Measured against the base
commit with a frozen clock, two identical `reportError` calls left exactly one
file (`SAME_MS_FILE_COUNT=1`, `preflight-verification.md` section 4): a naive
"exactly one report file exists" assertion **passes with no deduplication
whatsoever**. That is a false GREEN, not evidence.

Every test in this file therefore:

1. Pins `t0 = new Date('2026-08-07T00:00:00.000Z').getTime()` with
   `setSystemTime(new Date(t0))` in `beforeEach`.
2. Advances the clock via a single module-private `advanceTo(offsetMs)` helper
   before **every** `reportError` call after the first that targets the same
   directory — by the offset the row names, or by `+1_000` ms when the row does
   not depend on the exact offset. Measured against the base commit, the same
   two identical calls separated by 1,000 ms produced two distinct filenames
   (`...T00-00-00-000Z.json` and `...T00-00-01-000Z.json`,
   `ADVANCED_FILE_COUNT=2`), so "exactly one file" is genuinely RED.
3. Keeps every advance strictly inside `REPORT_DEDUPE_WINDOW_MS` unless the row
   is explicitly probing the boundary (D5, D6).
4. Restores real time with `setSystemTime()` in `afterEach`.

`advanceTo` is declared once; no `setSystemTime` call is repeated inline per
assertion (RULES.md, "DRY setup").

| ID | Given / When / Then | Evidence | Base-commit result |
|---|---|---|---|
| D1 | GIVEN a report written at `t0`; WHEN an identical `error`, `baseMessage`, and `type` are reported at `t0 + 1_000`; THEN exactly one report file exists **and its name is the `t0` name**, and the second call emits a stderr line containing `Duplicate error report suppressed` and the `t0` report's path | listing + captured stderr | **RED** — today two files, measured: `...T00-00-00-000Z.json` and `...T00-00-01-000Z.json`. The clock advance is what makes this RED; without it the base commit overwrites one path and the row would pass unchanged. |
| D2 | GIVEN two calls with different error messages at `t0` and `t0 + 1_000`; THEN two report files exist and neither emits the suppression line | listing + stderr | **GUARD** — coalescing must not swallow distinct failures. The advance is mandatory: same `type` in the same millisecond would collapse both onto one path and fail this GUARD for an unrelated reason. |
| D3 | GIVEN identical messages but different `type`, at `t0` and `t0 + 1_000`; THEN two report files exist | listing | **GUARD** — `type` is part of the fingerprint |
| D4 | GIVEN identical `type` and message but different `baseMessage` (`Error when talking to claudecode API` vs `... codex API`), at `t0` and `t0 + 1_000`; THEN two report files exist | listing | **GUARD** — the exact simultaneous-two-provider scenario from the issue. Same `type`, so the advance is mandatory here too. |
| D5 | GIVEN a report written at `t0`; WHEN an identical call occurs at `t0 + 59_999` ms and another at `t0 + 60_000` ms; THEN exactly two report files exist, named for `t0` and `t0 + 60_000` | listing with `setSystemTime` | **RED** — today three files. Pins the window boundary to `>=`. |
| D6 | GIVEN a report at `t0` and identical suppressed calls at `t0 + 30_000` and `t0 + 59_000`; WHEN another identical call occurs at `t0 + 60_000`; THEN exactly two report files exist, named for `t0` and `t0 + 60_000` | listing with `setSystemTime` | **RED** — today four files. Proves the window is **fixed**, not extended by suppressed occurrences. |
| D7 | GIVEN a report written at `t0` whose bytes are captured; WHEN an identical call is made at `t0 + 1_000`; THEN the `t0` file's bytes are byte-for-byte unchanged, **no file exists at the `t0 + 1_000` path**, and the matching file count is still 1 | file bytes + listing | **RED** — today a second file appears at the advanced path. Proves coalescing neither writes a new report nor rewrites a counter into the existing one. Without the advance both the byte comparison and the count would pass on the base commit, since the overwrite rewrites identical content to the same path. |
| D8 | GIVEN a first call at `t0` whose write fails (non-existent `reportingDir`); WHEN an identical call at `t0 + 1_000` targets a writable directory; THEN a report file **is** written there | listing | **GUARD** — a failing disk must not silence the next attempt |
| D9 | GIVEN 69 (`MAX_TRACKED_FINGERPRINTS + 5`) reports written with 69 distinct error messages under D9's own `type`, the clock advanced `+10` ms per call (680 ms total, so every window is still open), with the newest report's path (deterministic under the pinned clock, and confirmed by its `Full report available at:` stderr line), its bytes, and the sorted listing of matching files all captured; WHEN that newest fingerprint is repeated at the next `+10` ms tick; THEN stderr contains `Duplicate error report suppressed` **and the captured newest path**, AND that file's bytes are byte-for-byte unchanged, AND the sorted listing of matching files is **identical** to the captured one | captured stderr + file bytes + listing set before/after | **RED** — today there is no registry, so the repeat writes a new file at the advanced path: stderr carries `Full report available at:` instead of the suppression line, and the listing gains a name and loses none. Proves eviction never evicts the newest entry. A file-**count** assertion is deliberately not used: rotation pins the count at `MAX_REPORT_FILES` either way, so it would pass without any suppression. |
| D10 | GIVEN the same 69-report arrangement rebuilt under **D10's own `type`** (disjoint fingerprints and filenames from D9, since the registry is process-scoped and only ~700 ms elapse), so D10's 5 oldest fingerprints have been evicted from the 64-entry registry; WHEN D10's **first**, evicted fingerprint is repeated at the next `+10` ms tick; THEN stderr contains `Full report available at:` and does **not** contain `Duplicate error report suppressed`, and a report file exists at the newly reported path | captured stderr + listing | **GUARD** — passes today because nothing is ever suppressed. It fails against an *unbounded* registry (only ~700 ms have elapsed, so an unevicted entry would suppress) and against an eviction policy that discards the newest instead of the oldest. Together D9 and D10 pin the eviction direction from both ends. |
| D11 | GIVEN two errors whose messages share a 1,024-character prefix and differ only after it (`'a'.repeat(1_024) + '-alpha'` vs `+ '-beta'`), with identical `type` and `baseMessage`, reported at `t0` and `t0 + 1_000`; THEN two report files exist, neither call emits `Duplicate error report suppressed`, and the two parsed reports carry the two distinct full messages | listing + stderr + parsed reports | **GUARD**, annotated **fails against the rejected truncated-concatenation fingerprint**. The base commit has no coalescing, so two files appear today. Against a 512-character-sliced key the two fingerprints are byte-identical (measured, `preflight-verification.md` section 3) and the `-beta` failure would be silently suppressed — a real, distinct error never reported. 1,024 < `MAX_REPORT_STRING_CHARS` (4,096), so neither message is clamped and both are readable back verbatim. |

---

## REQ-3113-5 — Preserved contract

| ID | Given / When / Then | Evidence | Base-commit result |
|---|---|---|---|
| B10 | GIVEN a non-existent `reportingDir`; THEN `reportError` resolves and stderr contains `Additionally, failed to write detailed error report:`, `Original error that triggered report generation:`, and `Original context:` | captured stderr | **GUARD** — write-failure fallback unchanged |
| B11 | GIVEN a BigInt context; THEN stderr contains `Could not stringify report content (likely due to context):`, `Original error that triggered report generation:`, `Original context could not be stringified or included in report.`, and `Partial report (excluding context) available at:` | captured stderr | **GUARD** — serialization-failure fallback unchanged |
| B12 | GIVEN `type = 'contract-check'`; THEN the written file's basename matches `/^llxprt-client-error-contract-check-.*\.json$/` | directory listing | **GUARD** — filename format frozen |
| B13 | GIVEN `context` omitted entirely; THEN the report is exactly `{ error: { message, stack } }` | parsed report | **GUARD** — no `contextOmitted`/`contextTruncated` noise when there was no context |
| — | The six existing cases in `errorReporting.test.ts` continue to pass **unmodified** | `npm run test --workspace @vybestack/llxprt-code-core` | **GUARD** — the primary preservation signal; audit in `specification.md` section 10 |

---

## Anti-mock-theater self-check

Applied to every row above:

1. **If the real implementation is deleted, does the test fail?** Yes — every
   assertion reads a real file written to a real temp directory, real stderr
   text, or a real yielded event.
2. **Is any assertion of the form "a mock was called"?** No. The superseded
   `toHaveBeenCalledWith` in `turn.test.ts` is deleted rather than adapted, and
   its replacement (T1-T8) reads the report file produced by the real writer.
3. **Is the component under test mocked?** No. `reportError` and `Turn` are both
   real in every test. The only fixture is `ChatSession`, which is the
   provider/network boundary.
4. **Could a `return 'expected'` implementation pass?** No — the tests assert
   file counts, byte sizes, deletion identity, ordering, and parsed structure.
5. **Could a RED row pass against unchanged code for an incidental reason?**
   Two such mechanisms exist here and each is neutralized by construction:
   - *Millisecond filename collision.* Two same-millisecond writes of one `type`
     land on one path, so the base commit's second write overwrites the first
     and a "one file" assertion passes with no deduplication. Neutralized by the
     mandatory clock discipline above, and measured both ways against the base
     commit (1 file frozen, 2 files advanced).
   - *Rotation pinning the count.* With `MAX_REPORT_FILES = 20`, any assertion
     of the form "the matching file count is unchanged" is satisfied by rotation
     alone once the directory is at the cap, whether or not the duplicate was
     suppressed. Neutralized in D9 by replacing the count assertion with
     observable suppression: the stderr suppression line carrying the original
     report path, byte-for-byte-unchanged original report bytes, and an
     unchanged directory listing **set** (an unsuppressed write would add one
     name and evict another while leaving the count at 20).
6. **Does every row still discriminate after the production change?** Yes —
   each GUARD row names the specific wrong implementation it rejects, and D11
   additionally names the rejected fingerprint design it rules out.
