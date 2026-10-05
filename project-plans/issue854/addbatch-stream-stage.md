# Disk-prefix batch publication works; aggregate ownership remains RED

`HistoryServiceCore.addBatch` no longer materializes the previous history or
builds a combined history array. It captures previous membership through
`HistoryMutationSnapshot`, serializes durable prefix rows to `HistoryDensityRows`,
and publishes that candidate through the existing transaction. The three invoked
agents callers explicitly enable journal backpressure. Array event and exact
marker rollback contracts still pin every caller row and original marker, so the
unchanged 440-row aggregate gate remains RED.

Evidence is under `tmp/verify854/p05d/addbatch-stream-20261002T0008-sol/`.
The starting dirty diff and source snapshots precede implementation. This stage
preserves previous evidence, protected sources, enforcement rules and unrelated
changes. There was no GitHub, commit, push, OCR, PR or merge action.

## Publication and completion contracts

The batch API remains `Promise<void>` and snapshots the input array at invocation.
Whole-batch validation and token estimation precede admission. Appended token
estimates are added to the existing history total; the prefix is not silently
recounted. Speaker, blocks, media, tool data, timestamps and attribution survive.
Marked rows preserve their exact marker references. Fresh stamps retain their
existing in-place behavior, including repeated caller identities. Duplicate rows
and duplicate marker identities are not deduplicated.

`HistoryBatchOptions.streamPublication` is an explicit addBatch opt-in. Turn
history commits, `ConversationManager.recordHistory`, and extra-history loading
pass `true`. The default remains `false`: existing callers can await batch
publication while holding their journal writer paused. An initial automatic
backpressure implementation blocked the original rollback suite after its first
17 cases. The default publication and compensation path now completes before
writer release, as the original contract requires. A separate controlled writer
pause proves opted-in publication admits one row and waits before the next.

The previous prefix and candidate values are disk-backed. Pending previous rows
and incoming array rows remain identity pins. There is no eager-prefix fallback,
batch-size rejection, truncated input or row-size cap. A valid nine-MiB row is
accepted and preserved. The eight-MiB fixture gate is not a maximum record size.
Synchronous `add` and `addAll` were not migrated or made asynchronous.

Partial admission, later serialization failure and observer rejection compensate
membership before queued appends run. The existing transaction restores tokens,
span state, chronology counters, caller markers and media effects. Default batch
compensation does not await the caller-paused writer. Opted-in compensation over
settled previous history retains per-row durability waits. Other mutation inputs
retain their prior compensation selection when `streamPublication` is absent.

## Measured owners and remaining retention

The positive fixture keeps the complete external 512/8,192-row input array alive
while appending it to a settled prefix of the same size. Its real mixed rows
contain text, tool calls, responses, media and chronology. The aggregate census
still receives every acquisition. A separate weak-key classifier reports
pre-existing input rows and markers separately from internally created values;
it does not remove borrowed pins from aggregate accounting.

| Input rows | Aggregate live / peak rows | External live / peak rows | Internal live / peak rows | Internal live / peak serialized bytes |
| --- | ---: | ---: | ---: | ---: |
| 512 | 1,025 / 1,026 | 1,024 / 1,024 | 1 / 2 | 2,521 / 5,041 |
| 8,192 | 16,385 / 16,386 | 16,384 / 16,384 | 1 / 2 | 2,529 / 5,057 |

The corresponding aggregate live serialized charges are 1,320,946 and 21,227,194
bytes. The full aggregate gate fails at both sizes; the large fixture fails its
byte bound as well. Registered owners settle to zero after completion and writer
acknowledgement. These are registered transaction/read/publication owners, charged
by UTF-8 JSON at acquisition. They are not whole-heap measurements. Direct indexed
comparison reads, arbitrary consumer references, serialized buffers and default
publication/compensation queues are not comprehensively instrumented by this
census, so the two-row registered peak does not establish a bound for every owner.

The disk probe wraps actual synchronous filesystem reads and writes while running
the owner suite, including its fixture and row/index files. Its receipts report
logical syscall counts and transferred bytes, not physical disk seeks or peak
buffer memory. Asynchronous recorder writes and OS caching are outside that
counter. No aggregate byte total is presented as a peak resident charge.
The eight-case confirmation records 282,040 synchronous reads transferring
388,324,405 bytes and 165,389 synchronous writes transferring 71,862,813 bytes.
These include repeated scans across separate tests. The final disk and owner
numbers are in `confirmation/` and `receipt.json`.

Borrowed-reference and distinct-shallow-copy retaining controls consume and hold
all rows. Their adverse lane must fail the same 440-row/eight-MiB gate, with cleanup
asserted in `finally`. A separate aggregate-input lane fails on the actual batch
pins. The actual pending-window route also retains its positive aggregate gate:
its fallback and queued replay finish while the writer is paused, exact pending
caller and marker identities survive, and owners settle to zero after release.
Its final historical peak check remains RED at both input sizes.

## Behavioral and transport checks

The original 31 atomicity/density cases and all eight original atomic batch cases
pass, including frozen chronology metadata. The adjacent seven frozen-pending
rollback cases and three addAll cases pass. New partial-admission and observer
rollback/retry cases use complete 512/8,192-row mixed batches and queued synchronous
adds. Later serialization rollback/retry is exercised at both sizes. Scaled marker
displacement replaces every marker before GC and checks restoration through
WeakRefs, including duplicate row and shared marker identities. Fresh stamping
reclaims the failed transaction's next sequence.

The new addBatch BODY suite exercises Responses, Anthropic and Gemini at both
sizes, caching off/on. It traverses actual batch publication and real provider
conversion, uses an independent eager fixture oracle, and replaces only the
network boundary. All 12 saved request pairs match byte-for-byte; retry bodies
must match and Anthropic cache markers are checked. Existing pending, fallback,
hard-limit, curated recomposition and tool truncation BODY lanes are included in
the scoped release manifests. Saved-pair counts and subprocess results are in
`receipt.json`; all 168 saved pairs match: 120 request BODY pairs and 48 SDK
response-content pairs. Overlapping confirmations replace earlier failures rather
than being added to totals. The fallback confirmation repeats the 20 affected or
overlapping scenarios; the four remaining 8,192-row Gemini cases passed in the
initial release. Together they cover the full 24-case fallback matrix.

Two unchanged adjacent suites expose five failures: the neutral-tool recording
case requires zero instrumented reads although snapshot capture reports two, and
four token-usage lifecycle cases fail to produce their expected compression
records. Both failure sets also reproduce with captured starting modules. The
baseline harness records the executed eager addBatch method and checks that its
materialization call is present before running those tests. Their assertions
were not changed to accept current behavior.

Initial verification errors remain in raw logs: automatic backpressure blocked
the caller-owned writer, a Bun preload option placement invoked the root test
script recursively instead of the selected test, and a fallback artifact directory
was missing. The corrected disk probe uses an explicit test entry. Missing-output
fallback cases are rerun with their output directory present. None of those failed
attempts is counted as a passing release receipt.

## Static checks and acceptance limits

Scoped source TypeScript uses the existing core and agents no-emit configurations,
plus a strict stage configuration for new tests and BODY code. A build-config
attempt resolved stale core declaration output and is retained separately. Forced
800/80 ESLint uses zero warnings; formatting, the unchanged test-audit scanner and
`git diff --check` are checked on stage files. Splitting test registrations meets
the function-size rule without removing assertions or changing limits.

The scoped passing union is 263 cases, with five adjacent failures reproduced on
the captured baseline. It uses final ten-case atomicity and eight-case owner
confirmations rather than their earlier seven-case versions. Expected adverse
lanes are separate: four retaining failures, two aggregate-input failures, two
pending aggregate failures and the scanner's 18 passes/two production failures.
The final static run passes core/agents/stage TypeScript, forced 800/80 ESLint,
formatting and diff checks. The full audit parses 3,336 files without errors and
finds no smells on stage tests. All 17 protected hashes match; density candidate
and mutation snapshot source hashes also match their starting snapshots.

The structural scanner's original production assertions remain RED. Eager
`materializeHistory`, `captureChronology` and `getAll` surfaces remain. The direct
production `getAll` consumers are still `ConversationManager` and `client`.
Other array mutations, synchronous single-add reads, media adoption/reconciliation,
clear/restore, checkpoint/continuation, compression queues, provider conversion,
hooks and transport retries remain outside this subset. Strong caller/marker pins
and unsettled writer work can grow with context or queued work.

Fully bounded aggregate addBatch acceptance requires changing the array event and
exact-reference rollback ownership contracts or migrating those callers to a
value/stream contract. This stage makes that migration boundary explicit and does
not replace the original aggregate check with the internal-only measurement.
No full repository suite, build, model smoke, statistical retained-growth sweep,
whole-session memory acceptance or no-leak result is claimed on this busy host.
The fixed row/byte gates and one-MiB retained-growth allowance are unchanged.
