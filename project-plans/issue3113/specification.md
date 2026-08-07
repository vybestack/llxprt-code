# Specification: Bounded, Rotated, Rate-Limited Error Reports (issue #3113)

Plan ID: PLAN-20260807-ISSUE3113
Generated: 2026-08-07
Branch: `issue3113`
Requirements: REQ-3113-1, REQ-3113-2, REQ-3113-3, REQ-3113-4, REQ-3113-5

## 1. Purpose

`reportError` in `packages/core/src/utils/errorReporting.ts` writes one
pretty-printed JSON file per API failure into `os.tmpdir()`. The payload embeds
the **entire curated conversation**, so report size scales with context size,
and nothing ever deletes, caps, or coalesces the files.

Live reproduction on the development machine at plan time (see
`preflight-verification.md` for the command):

```
count       = 4,380 files
total       = 57,597,083 bytes (54.9 MB)
largest     = 11,421,098 bytes (10.9 MB, one report)
by type     = 4,076 Turn.run-sendMessageStream / 301 generateJson-api / 3 startChat
```

This is the same directory the issue reported at 3,565 files / 62 MB; it has
continued to grow. The failure mode is unbounded disk consumption proportional
to (error rate) x (context size), plus an unmanaged accumulation of full
conversation text in a shared temp directory.

## 2. Accepted behavior (exactly four behaviors)

The issue proposes four remedies. All four are accepted, and nothing else is.

| # | Accepted behavior | Requirement |
|---|---|---|
| 1 | A default report contains the normalized error, the failed request, and only a bounded recent history tail — never the complete curated conversation. All report output stays bounded as context grows. | REQ-3113-1 |
| 2 | Report JSON is compact, not pretty-printed, including the minimal fallback report. | REQ-3113-2 |
| 3 | The shared core report writer rotates every `llxprt-client-error-*.json` file in its reporting directory under a small fixed count budget and a total-byte budget, removing oldest reports during a write. | REQ-3113-3 |
| 4 | Identical failures repeated within a bounded interval are coalesced/rate-limited so a retry loop does not produce one file per attempt. | REQ-3113-4 |

REQ-3113-5 is the preservation contract that constrains all four.

## 3. Non-goals and explicit exclusions

- **No new dependency.** Only Node built-ins: `node:fs/promises`, `node:os`,
  `node:path`, `node:buffer`, and `node:crypto`. All five are available in both
  Node and Bun, and `node:crypto`/`createHash` is already used elsewhere in
  `packages/core` (for example `services/loopDetectionService.ts:7`). A Node
  built-in import is **not** a dependency and **not** a public abstraction: it
  adds nothing to `package.json`, nothing to the lockfile, and nothing to the
  module's export surface.
- **No new setting, flag, env var, or config key.** The limits are internal constants; a debug/opt-in "full history" mode is explicitly *not* implemented.
- **No new public abstraction.** Every constant and helper introduced is module-private. `reportError` remains the only export of `errorReporting.ts`.
- **No workflow, agent-memory, or quality-tool change.**
- **`packages/mcp/src/client/mcp-client-manager-helpers.ts` is out of scope.** Its `reportError` is a locally injected `(error: unknown) => void` callback (see `mcp-client-manager.ts:339`, `:782`, `:944`) that logs; it is not the core disk writer and shares no code with it. `packages/cli/src/ui/hooks/usePermissionsTrustDialogFlow.ts:43` and `packages/cli/src/config/extensions/extensionLoader.ts:44` are likewise unrelated local helpers of the same name.
- **Other core-`reportError` callers are not rewritten.** They inherit the centralized cap, rotation, and rate limit. Only the Turn caller changes, because accepted behavior 1 requires the request and the bounded history tail to be *semantically separate*, and only Turn currently concatenates them.
- **No age-based expiry.** The issue offers "count and/or total bytes and/or age". Count + total bytes are sufficient, deterministic, and testable without clock control in the rotation path; age adds a third knob with no additional guarantee. Rejected as scope.
- **The report filename format is frozen.** `llxprt-client-error-${type}-${timestamp}.json` is unchanged. Adding a uniqueness suffix would break `errorReporting.test.ts`, which must not be modified.

## 4. Preserved contract (REQ-3113-5)

**Requirement text:** `reportError`'s public call signature, its report filename
format, and its existing fallback behavior must be unchanged.

```typescript
export async function reportError(
  error: Error | unknown,
  baseMessage: string,
  context?: unknown[] | Record<string, unknown>,
  type = 'general',
  reportingDir = os.tmpdir(),
): Promise<void>;
```

Preserved verbatim:

1. **Signature and arity.** No parameter added, removed, reordered, or retyped.
2. **Filename.** `path.join(reportingDir, \`llxprt-client-error-${type}-${timestamp}.json\`)` with `timestamp = new Date().toISOString().replace(/[:.]/g, '-')`.
3. **Serialization-failure fallback.** When `JSON.stringify` throws (BigInt, circular), the same three stderr messages are emitted and `writeMinimalReport` writes `{ error }` to the same path.
4. **Write-failure fallback.** When `fs.writeFile` rejects, the same stderr messages are emitted and `logContextFallback` prints the original context truncated to 1000 characters.
5. **Minimal-write-failure fallback.** Same stderr message.
6. **Never throws.** `reportError` continues to resolve on every path.

Consequence: `packages/core/src/utils/errorReporting.test.ts` (Vitest-importing,
must not be modified) keeps passing unchanged. Section 9 audits each of its six
cases against the new design.

## 5. REQ-3113-1: Bounded report payload

**Requirement text:** A default report contains the normalized error, the failed
request, and only a bounded recent history tail. Report output must remain
bounded as context grows, for every caller.

Boundedness is enforced at two levels, because the two levels answer two
different questions:

- The **caller-side tail** (Turn) answers *"what is worth reporting?"* — it keeps
  the report semantically meaningful and small in the common case.
- The **writer-side cap** (core) answers *"what is the hard ceiling?"* — it is the
  guarantee that holds for `startChat`, `generateJson-api`,
  `generateContent-api`, and any future caller, without rewriting them.

### REQ-3113-1.1 — Turn separates request from bounded history tail

- GIVEN a `Turn.run` stream failure with curated history of length `n`
- WHEN the error report is produced
- THEN the context passed to `reportError` is the object
  `{ request, recentHistory, omittedHistoryCount }`
- AND `recentHistory` is the last `min(n, 8)` curated entries
- AND `omittedHistoryCount === max(0, n - 8)`
- AND `request` is the failed `TurnRequest`, not appended to history

Current code (`packages/agents/src/core/turn.ts:588`) passes
`[...this.chat.getHistory(true), req]` — one flat array in which the request is
indistinguishable from history and the history is unbounded.

### REQ-3113-1.2 — Per-string clamp in the writer

- GIVEN any string value anywhere in the serialized report
- WHEN its length exceeds `MAX_REPORT_STRING_CHARS`
- THEN the stored value is its first `MAX_REPORT_STRING_CHARS` characters
  followed by `` ` [truncated: ${originalLength} chars]` ``
- AND this applies uniformly to `error.message`, `error.stack`, and every
  context string

### REQ-3113-1.3 — Array-context tail clamp in the writer

- GIVEN a serialized report larger than `MAX_REPORT_BYTES` whose `context` is an array of length `n`
- WHEN the report is written
- THEN `context` is replaced by its last `min(n, MAX_REPORT_CONTEXT_ENTRIES)` entries
- AND a sibling field `contextTruncated: { omittedEntries: n - kept }` records what was dropped

### REQ-3113-1.4 — Hard payload cap in the writer

- GIVEN a serialized report still larger than `MAX_REPORT_BYTES` after 1.2 and 1.3
- WHEN the report is written
- THEN the `context` key is absent
- AND the report is `{ error, contextOmitted: { reason: 'payload-exceeded-limit', serializedBytes, limitBytes } }`
- AND the written file is smaller than `MAX_REPORT_BYTES`

This is a hard bound: the fallback payload contains only the normalized error,
whose `message` and `stack` are each already clamped by 1.2, so its size is
bounded by roughly `2 * MAX_REPORT_STRING_CHARS` plus a fixed envelope.

**Ordered serialization pipeline** (exactly one attempt per stage, no loops):

```
S1  text = stringify({ error, context? }, clampStrings)
S2  if byteLength(text) <= MAX_REPORT_BYTES            -> emit text
S3  if context is Array:
      text = stringify({ error, context: tail, contextTruncated }, clampStrings)
      if byteLength(text) <= MAX_REPORT_BYTES          -> emit text
S4  emit stringify({ error, contextOmitted }, clampStrings)
```

`JSON.stringify` is called at most three times and **the first call is S1**, so
`errorReporting.test.ts`'s call-count-based stringify mock keeps behaving
exactly as before (section 9, case 5).

## 6. REQ-3113-2: Compact JSON

**Requirement text:** Report JSON must be compact, not pretty-printed, in both
the main report and the minimal fallback report.

- GIVEN any successfully written report
- WHEN the file bytes are read as text
- THEN the text contains no `\n` and no indentation
- AND `JSON.parse(text)` yields the same value the pretty-printed form would have

Both `JSON.stringify(..., null, 2)` call sites drop the `null, 2` arguments:
the main serialization (`errorReporting.ts:100`) and `writeMinimalReport`
(`errorReporting.ts:60`).

## 7. REQ-3113-3: Rotation

**Requirement text:** During a write, the shared core report writer removes the
oldest `llxprt-client-error-*.json` files in its reporting directory until the
directory satisfies a fixed count budget and a total-byte budget.

- GIVEN a `reportingDir` containing report files and unrelated files
- WHEN `reportError` **successfully** writes a report
- THEN afterwards the directory holds at most `MAX_REPORT_FILES` files matching `/^llxprt-client-error-.*\.json$/`
- AND their combined size is at most `MAX_REPORT_TOTAL_BYTES`
- AND deletions happened oldest-first
- AND the report just written was not deleted
- AND no file that does not match the pattern was touched

### Exact semantics

| Aspect | Decision | Rationale |
|---|---|---|
| Trigger point | After a **successful** `fs.writeFile`, in the same `reportError` call, for both the main and the minimal report. Never after a failed write. | "Removing oldest reports during a write". Post-write accounting makes the post-condition exact: the just-written file is included in the totals. |
| Passes per call | Exactly one. | Determinism; no re-entrancy. |
| Candidate set | Directory entries matching `/^llxprt-client-error-.*\.json$/` that `fs.stat` reports as regular files. | Matches the writer's own filename format. Directories and every other name are excluded, so unrelated temp files survive. |
| Age key | `stat.mtimeMs`. | Works for foreign/pre-existing files that may not carry a parseable embedded timestamp. |
| Ordering | `mtimeMs` ascending. | Oldest first. |
| Tie-break | Filename ascending (lexicographic `<`). | `mtimeMs` ties are common on fast writes. The embedded ISO-8601 timestamp sorts lexicographically in chronological order, so the tie-break agrees with creation order for same-`type` files. Fully deterministic. |
| Protected file | The path just written is never a deletion candidate. | A report that deletes itself is useless. Safe because one report is at most `MAX_REPORT_BYTES` (128 KiB) < `MAX_REPORT_TOTAL_BYTES` (1 MiB), so the budget is always reachable while keeping it. |
| Loop | `while (candidates.length > 0 && (count > MAX_REPORT_FILES \|\| total > MAX_REPORT_TOTAL_BYTES))`: shift the oldest candidate, unlink it, decrement `count`, subtract its size from `total`. | `count` and `total` include the protected file. The candidate list strictly shrinks, so the loop terminates. |
| Error handling | `readdir`, `stat`, and `unlink` failures are swallowed individually. A file whose `stat` fails is skipped; an `unlink` failure still removes the entry from the candidate list and still decrements the running totals. Rotation never throws and never changes `reportError`'s stderr output. | Genuine filesystem/external-input handling — the only place defensive handling is permitted. A missing directory (`ENOENT`) must not convert the existing write-failure fallback into a different failure. |
| Concurrency | No lock is added. Two concurrent calls may enumerate the same oldest file; the loser's `unlink` fails with `ENOENT` and is swallowed. Each call always preserves its own file. | A lock would be a public abstraction and a new failure mode for a best-effort janitor. |

**Concurrency post-condition (the guarantee under test):** concurrent
`reportError` calls never reject, never delete a non-matching file, and never
delete a caller's own report. The count and byte budgets are guaranteed after
any **completed non-concurrent** write. Interleaved passes may transiently
observe more than `MAX_REPORT_FILES` files; a single subsequent sequential
report restores the budget.

## 8. REQ-3113-4: Duplicate coalescing / rate limiting

**Requirement text:** Identical failures repeated within a bounded interval must
not each produce a report file.

- GIVEN a report was written for fingerprint `F` at time `t0`
- WHEN `reportError` is called again with fingerprint `F` at time `t` where `t - t0 < REPORT_DEDUPE_WINDOW_MS`
- THEN no file is written and no existing file is modified
- AND exactly one stderr line is emitted carrying the occurrence count and the path of the report that represents the group
- WHEN `t - t0 >= REPORT_DEDUPE_WINDOW_MS`
- THEN a new report is written and a new window opens at `t`
- AND a call whose fingerprint differs is never suppressed

### Exact semantics

| Aspect | Decision | Rationale |
|---|---|---|
| Fingerprint | A lowercase-hex **SHA-256 digest** (`FINGERPRINT_ALGORITHM`), always 64 characters, computed over the **complete, untruncated** `type`, `baseMessage`, and normalized `error.message`. | Fixed size for any input length, and it discriminates on the whole message. `type` alone is far too coarse (4,076 of the 4,380 observed files share one `type`). `baseMessage` carries the provider name, so a simultaneous `claudecode` and `codex` outage — exactly the reported scenario — yields two independent groups. |
| Why not a truncated concatenation | **Rejected.** `` `${type}\u0000${baseMessage}\u0000${message}` `` sliced to 512 characters was the earlier design. | It violates the accepted behavior. Two *different* long errors sharing a 512-character prefix produce the same key, so a real, distinct failure is silently suppressed and never reported. Verified: with a 1,024-character shared prefix, the truncated form collides while the digest does not (`preflight-verification.md` section 3). Truncation trades a correctness property for a size property that hashing gives for free. |
| Digest framing | For each component in the fixed order `type`, `baseMessage`, `message`: `update(String(utf8ByteLength))`, `update(FINGERPRINT_FIELD_SEPARATOR)`, `update(utf8Bytes)`, `update(FINGERPRINT_FIELD_SEPARATOR)`. | Length-prefixed framing is injective. The decimal byte count is terminated by a separator that cannot be a decimal digit, so each component's extent is unambiguous even if the component itself contains U+0000. Bare separator-joining is *not* injective. Verified: `('ab','c','x')` and `('a','bc','x')` digest differently, and a component containing U+0000 does not alias a different split. |
| Incremental computation | Components are fed to the hash one `update` at a time. No concatenated intermediate string or buffer is materialized. | The error message can be megabytes. Building `type + SEP + baseMessage + SEP + message` would allocate a full copy of precisely the payload this issue exists to stop copying. |
| Coalescing precision | Two fingerprints are equal **iff** the `(type, baseMessage, message)` triple is identical, up to SHA-256 collision resistance. | This is the exact statement of accepted behavior 4: only identical failures coalesce. No non-identical pair is suppressed. |
| Not fingerprinted | `error.stack`, `context`. | Stacks vary by frame across retries of the same failure, which would defeat coalescing. Context is unbounded and hashing it would reintroduce the cost being removed. |
| Window type | **Fixed**, anchored at the last written report. Suppressed occurrences never extend it. | A sliding window can suppress forever during a sustained outage. Fixed gives the exact bound: at most one report per fingerprint per window. |
| Window length | `REPORT_DEDUPE_WINDOW_MS = 60_000` | A provider retry loop with backoff completes within tens of seconds, so one window collapses a whole storm. A genuinely persistent outage still yields a fresh report each minute: at most 60/hour/fingerprint versus the 327/hour observed. |
| When recorded | Only after a **successful** write (main or minimal). | A failed write must not silence the next attempt. |
| Registry | Module-private `Map<string, { windowStartMs, suppressedCount, lastReportPath }>`. |  |
| Registry bound | On insert, first drop entries whose window has expired; if still at `MAX_TRACKED_FINGERPRINTS`, evict the smallest `windowStartMs`. Eviction therefore removes the **oldest** window and never the entry being inserted. | Keeps the registry at 64 entries of a fixed 64-character key plus a short path — a few kilobytes — with no unbounded retention. The digest's fixed size is what makes the bound exact: an entry can no longer be as large as the error message it represents. |
| Clock | `Date.now()` for the window; the pre-existing `new Date().toISOString()` for the filename. | Both are controllable in tests via `setSystemTime` from `bun:test`, and both move together (verified, `preflight-verification.md` section 4). Advancing the clock between calls is what makes a duplicate test observable: without it, two same-millisecond calls of the same `type` resolve to the *same* frozen filename and the second silently overwrites the first. |
| Suppressed output | One stderr line: `` `${baseMessage} Duplicate error report suppressed (${suppressedCount} within ${REPORT_DEDUPE_WINDOW_MS / 1000}s). Previous report: ${lastReportPath}` `` | Preserves the issue's "occurrence count" intent without rewriting a file per retry, which would reintroduce per-attempt disk writes. |
| Not done | The written file is **not** rewritten to update an occurrence counter. | Rewriting per retry is the write amplification the issue is about. |
| Scope of state | Process-lifetime module state. Each Bun test file runs in its own process (both `packages/core/run-bun-tests.ts` and `scripts/run_bun_tests.ts` spawn one process per file), so tests are isolated by construction; within a file, tests use distinct fingerprints. |  |

## 9. Constants

All constants are **module-private** in `packages/core/src/utils/errorReporting.ts`
except the Turn tail, which is module-private in
`packages/agents/src/core/turn.ts`. Nothing is exported; tests restate the
values so the tests are the specification.

| Constant | Value | Justification |
|---|---|---|
| `MAX_REPORT_STRING_CHARS` | `4_096` | Long enough for a full stack trace or a substantial prompt fragment; short enough that no single string can dominate a report. |
| `MAX_REPORT_CONTEXT_ENTRIES` | `8` | The failing exchange plus the few turns that shaped it. Matches the Turn tail so a report looks the same however it was bounded. |
| `MAX_REPORT_BYTES` | `131_072` (128 KiB) | Comfortably holds an 8-entry tail whose strings are each clamped at 4 KiB (worst realistic case ~100 KiB), so the common Turn report is never degraded to `contextOmitted`. 87x smaller than the largest observed report (10.9 MB). |
| `MAX_REPORT_FILES` | `20` | Enough history to diagnose a burst; small enough that a directory listing stays readable. |
| `MAX_REPORT_TOTAL_BYTES` | `1_048_576` (1 MiB) | 1.8% of the 54.9 MB observed. Deliberately less than `MAX_REPORT_FILES * MAX_REPORT_BYTES` (2.5 MiB) so **both** budgets are reachable: many small reports hit the count cap, few large reports hit the byte cap. Neither is dead code. |
| `REPORT_DEDUPE_WINDOW_MS` | `60_000` | Section 8. |
| `MAX_TRACKED_FINGERPRINTS` | `64` | Section 8. |
| `FINGERPRINT_ALGORITHM` | `'sha256'` | Section 8. Ships with `node:crypto`; produces a fixed 64-character hex key for any input size. Not a security control — it is a collision-resistant identity key for grouping — but a truncated or non-cryptographic hash would reintroduce exactly the false-coalescing failure this constant exists to prevent. |
| `FINGERPRINT_FIELD_SEPARATOR` | `'\u0000'` | Section 8. Terminates each decimal length prefix and each component. Chosen because it is not a decimal digit, so the length prefix is self-delimiting. |
| `TURN_REPORT_HISTORY_TAIL` (agents) | `8` | Matches `MAX_REPORT_CONTEXT_ENTRIES`. |

**Resulting worst case:** at most 1 MiB of reports on disk plus one in-flight
report of at most 128 KiB, and at most one written report per distinct
fingerprint per 60 s. Against the measured incident: 54.9 MB -> <=1.125 MiB, and
327 files/hour -> <=60 files/hour/fingerprint.

## 10. Compatibility audit of `errorReporting.test.ts` (unmodifiable)

| # | Existing case | Effect of the new design | Verdict |
|---|---|---|---|
| 1 | `should generate a report and log the path` — context `{ data: 'test context' }`, `toStrictEqual({ error, context })` | Payload is far below `MAX_REPORT_BYTES`; strings are far below `MAX_REPORT_STRING_CHARS`; compact output parses identically; filename unchanged; fresh `mkdtemp` dir holds one report so rotation deletes nothing; fingerprint unique in file. | PASSES |
| 2 | plain-object error, `type='general'` | Same. Message `'Test plain object error'` differs from every other case, so no suppression. | PASSES |
| 3 | string error, `type='general'` | Same; message `'Just a string error'`. | PASSES |
| 4 | write failure into a non-existent dir | Rotation runs only after a **successful** write, so it never runs here. Both stderr fallbacks are unchanged. | PASSES |
| 5 | BigInt stringify failure, `JSON.stringify` mocked to throw on call #1 | S1 is still the first `JSON.stringify` call. Fingerprinting is a `node:crypto` digest over three strings and rotation performs no serialization, so neither adds a `JSON.stringify` call. The minimal report is call #2 and passes through; dropping `null, 2` does not change its parsed value. | PASSES |
| 6 | no context supplied | `{ error }` only; unchanged. | PASSES |

Cross-case interference is impossible: every case uses its own `mkdtemp`
directory, and all six error messages are distinct, so their digests are
distinct and no case is ever suppressed.

## 11. Integration points

| Location | Change |
|---|---|
| `packages/core/src/utils/errorReporting.ts` | Bounded serialization pipeline, compact output, rotation, dedupe registry. All additions module-private. |
| `packages/agents/src/core/turn.ts:588-594` | Replace the flat `[...history, req]` context with `{ request, recentHistory, omittedHistoryCount }`. |
| `packages/agents/src/agents/executor.ts:753` (`startChat`) | Unchanged. Inherits the cap: an oversized `startHistory` array is tail-clamped by REQ-3113-1.3 rather than written whole. |
| `packages/agents/src/core/ChatSessionFactory.ts:428` (`startChat`) | Unchanged; same inheritance. |
| `packages/agents/src/core/subagentRuntimeSetup.ts:865` (`startChat`) | Unchanged; same inheritance. |
| `packages/agents/src/core/clientLlmUtilities.ts:119` (`generateJson-api`) | Unchanged. Array context, so it gains a meaningful 8-entry tail instead of the full `contents`. 301 of the observed files come from here. |
| `packages/agents/src/core/clientLlmUtilities.ts:178` (`generateContent-api`) | Unchanged. Object context, so an oversized payload degrades to `contextOmitted` — bounded, which is the accepted behavior. |
| `packages/mcp/**`, `packages/cli/**` local `reportError` helpers | Untouched; different functions. |

## 12. Review-finding triage rubric

Every review finding — Open Code Review, DeepThinker, CodeRabbit, human — is
labeled with **exactly one** of these four categories, and the label is recorded
with a one-line reason.

| Category | Definition | Action |
|---|---|---|
| **Blocker-Fix** | The finding shows an accepted behavior (REQ-3113-1..5) is not met, a preserved contract is broken, a test is non-behavioral or would pass against unchanged code, a prohibited construct was introduced (suppression directive, lint downgrade, ignore addition, threshold increase), or CI/local verification fails. | Fix before push/merge. Non-negotiable. |
| **In-scope-Fix** | The finding is correct and lies inside issue #3113's four behaviors — wrong constant, non-deterministic ordering, unbounded growth path, missing boundary test, misleading name or comment in the changed code. | Fix in this PR. |
| **Reject** | The finding is factually wrong, contradicts an explicitly recorded decision in this specification (for example: "add a setting for full history", "use a sliding window", "add age-based expiry", "truncate the fingerprint instead of hashing it", "also fix the MCP `reportError`"), or asks for a prohibited change. | Reply with the specification section that decided it. No code change. |
| **Defer** | The finding is legitimate but outside issue #3113 — the pre-existing filename collision when two distinct errors land in the same millisecond (section 8 "Clock"; it is why every duplicate test advances the clock rather than being fixed here), retention policy for sensitive content, telemetry for suppressed reports, migration of the already-accumulated temp files. | File a follow-up issue, link it in the PR thread, no code change here. |

## 13. Constraints

- No `eslint-disable` of any form, no `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`, no lint severity downgrade, no `.eslintignore`/`.prettierignore`/`.gitignore` addition, no increase to any complexity or size threshold. Current thresholds (`complexity: 25`, `max-lines: 800`, `max-lines-per-function: 80`, `sonarjs/cognitive-complexity: 30`) must be met by decomposing into small named helpers.
- `errorReporting.ts` is 156 lines and `turn.ts` is 912 raw lines; both currently pass ESLint (verified). Helpers stay well under `max-lines-per-function: 80`.
- Fail-fast over defensive layers. The **only** permitted defensive handling is genuine filesystem/external-input handling: `readdir`/`stat`/`unlink` in rotation, and the pre-existing stringify/write fallbacks. No optional-chaining shields, no silent `?? {}` defaults, no try/catch around pure logic.
- `sonarjs/no-ignored-exceptions` is an error: swallowing uses `} catch {` with no binding plus a comment stating why, matching the existing `reportToStderr` pattern in the same file.
- Tests are behavioral, use Bun, and import directly from `bun:test`. No `toHaveBeenCalled*` as a substitute for output verification; assertions read real files and real return values.
- A test that writes more than one report into one directory **must** advance the clock with `setSystemTime` between writes. The frozen filename format is millisecond-resolution, so two same-millisecond writes of the same `type` collapse onto one path and the second silently overwrites the first — which can make a duplicate-suppression assertion pass against unchanged code. Advancing the clock is the difference between evidence and coincidence (`test-matrix.md`, "Clock discipline").
- Strictly issue #3113. No unrelated refactor, rename, or drive-by cleanup.
