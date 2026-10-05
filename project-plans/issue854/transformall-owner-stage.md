# Public `transformAll` ownership controls pass; Issue 854 acceptance remains RED

`HistoryService.transformAll` now accepts the scoped asynchronous row source and
disk sink used by `transformRows`. The callback returns `Promise<void>`, rather
than a history array. The production delta removes the eager input read, returned
array copy and array tokenization/commit route. Model selection and cancellation
options pass through to the existing mutation FIFO, snapshot, candidate and
compensating publication transaction. There is no array fallback or input-size
ban. All invoked repository array callbacks have been migrated.

Evidence is under `tmp/verify854/p05d/transformall-owner-20261001T152214Z-sol/`.
`stage.diff` isolates this stage from the already dirty repository. Its baseline
provenance is recorded per file in `receipt.json`. Three test files have a
reconstructed baseline from their sole method-name substitution, and the migration
document baseline is its unchanged prefix. The other existing source baselines
were captured before editing. This stage changes 13 code/document files before
this receipt document, adding 538 lines and removing 75. Only the public method in
`HistoryServiceCore.ts` changes production behavior.

## Ownership and valid inputs

The original three public-transform positive test bodies are byte-identical to
their captured starting versions. The helper migrates its callback to detached
sink writes and pauses the actual media participant's final yielded candidate
row during publication. Sampling after iterator exhaustion had reported zero live
owners, which failed the original positive-live-owner assertion. The final pause
measures an actual live row, rather than creating a retained measurement object.

| Fixture | Traversed input bytes | Live transaction owners | Live serialized charge | Peak serialized charge |
| --- | ---: | ---: | ---: | ---: |
| 512 rows | 1,255,401 | 1 | 2,452 | 2,455 |
| 8,192 rows | 20,157,099 | 1 | 2,460 | 2,463 |

Previous-snapshot ownership peaks at one row and is zero at the publication
pause. Both registered owner sets return to zero after rejection, and every
restored row is checked against the complete fixture. These are named owner
counters, not whole-heap measurements. The 440-owner and eight-MiB bounds are
unchanged.

Borrowed and distinct-copy identity sinks still accept the complete fixtures.
Both modes hold 1,024 owners and 1,280,785 serialized bytes at 512 rows, and
16,384 owners and 20,580,869 serialized bytes at 8,192 rows. The extra owners are
strong rollback marker references. Ordinary controls verify detection, restored
membership and zero ownership after rollback. The separate retaining-trap run
fails all four cases against the unchanged positive bounds, after cleanup checks.
It has zero passes and four expected failures, with three unrelated tests filtered
out. Both detached and borrowed nine-MiB single rows are accepted and preserved.

Marker displacement followed by GC restores the exact original marker object.
Repeated fresh identities restore absent metadata, and a subsequent successful
transaction receives the restored next sequence. Pending source identity,
blocked writer release and a queued append are exercised together. Full partial
admission rollback and complete retry pass at both fixture sizes, with live and
durable membership compared against independently built input rows. Token and
range expectations use independent fixture totals. Provider byte tests prohibit
`materializeHistory` through a real facade subclass.

## Verification and adverse evidence

The isolated release manifest has 84 passes, zero failures and zero skips across
12 suites. It includes all original 31 atomicity/density cases. An additional
isolated migrated row-semantics suite has seven passes. The distinct passing union
is therefore 91 cases. Final helper extraction confirmation passes 15 overlapping
cases and is not added to that union. Full retry is confirmed after replacing
snapshot-derived token/range expectations with independent fixture expectations.

All 12 saved provider actual/expected body pairs match byte-for-byte: Responses,
Anthropic and Gemini at 512/8,192 rows, caching off/on. Actual requests exercise
RetryOrchestrator with a first-attempt transport failure; the capture helper also
checks identical first/retry SDK bodies. Network boundaries are replaced, not the
provider conversion. These body pairs are scenarios within two test cases, not
12 additional test cases.

Core no-emit TypeScript passes. The two changed script entries pass separate
scoped TypeScript configurations using their respective runtime types: narrow
Bun test declarations for the provider body test, full Bun declarations for the
JSC child. A combined configuration failed because Bun's global `fetch.preconnect`
requirement conflicts with existing plain-fetch wrappers. The raw failed attempts
remain; no project type or enforcement configuration was changed. Scoped ESLint
uses the existing 800/80 nonblank, noncomment line limits and zero warnings.
Formatting and `git diff --check` pass. Protected memory, skill and structural-test
hashes match their starting values.

The scoped AST test audit has no new MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING or
NO_ASSERT findings on changed suites. It retains the existing context-range
DUP_ASSERT and adds one DUP_ASSERT for token-total checks before and after retry.
Both checks execute at separate transaction boundaries. No assertion was deleted
to silence it. Initial snapshot-derived assertions were replaced with independent
expectations before confirmation.

Earlier RED and attempt commands omitted the leading `./` in Bun suite paths.
Bun matched archived tests under `tmp/`, so those logs are not isolated starting
receipts. They retain observed public callback/ownership failures, but their totals
are not used for final acceptance. All release and confirmation invocations use
explicit `./` paths. The first new 8,192-row retry timed out during competing
work; its new test deadline was extended to match the longer full-history workload.
Existing positive bounds, original assertions and legacy row-suite deadline were
not changed. No quiet-host retained-growth sweep is claimed.

## Remaining failures and interfaces

The unchanged structural suite has 18 passes and two failures, reporting the same
four eager interfaces: `HistoryServiceCore.materializeHistory`,
`HistoryServiceCore.captureChronology`, `HistoryService.getAll` and
`HistoryService.getCurated`. There are now 23 direct `materializeHistory` calls in
the two facade files, down from 24. The transform call is gone;
`remaining-materializations.json` lists each remaining method and location.

The two direct production `getAll` consumers remain
`ConversationManager.ts:499` and `client.ts:470`. Array add/replace/batch APIs,
legacy strategy contexts/results, media adoption, clear/restore,
checkpoint/continuation and deferred client transfer still carry their existing
contracts. Provider conversion and retry request bodies remain request owners.
Explicit identity sink pins and pending writer/caller rows can grow with unsettled
work and are not certified as bounded durable-history state.

Full repository tests, build, model smoke, statistical retained-heap, whole-provider,
whole-session and no-leak acceptance were not run or claimed on the busy host.
No `.llxprt` contents, earlier immutable evidence, owner bounds, scanner exemptions
or enforcement policy were modified. No commit, push, OCR, PR or merge was performed.
