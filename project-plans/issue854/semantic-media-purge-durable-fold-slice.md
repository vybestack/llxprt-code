# The real 8192-row purge now commits and rolls back through the shared journal

The unchanged production session suite moved from three passes and one failure
to four passes. Its 512-row and 8192-row cases both persist into the same recorder
used by live history, commit the candidate, hold the next attempt's lease, restore
every original row on rollback and release that lease. This fixes the oversized
v2 durable-fold blocker described in `semantic-media-purge-production-slice.md`.
It does not complete the request-array or retained-memory migration.

Evidence is under
`tmp/verify854/p05d/purge-durable-fold-20260930T1453-branch3/`. Earlier evidence
and reports were left unchanged.

## The v2 path uses the existing streaming projection

`scanResolverLines` already reads at most 64 KiB at a time through a UTF-8 decoder
and incremental JSON projector. The projector discards row bodies while keeping
speaker, block count, chronology and exact byte offsets. Each completed purge row
is staged in `ResolverDiskIndex`, a disk-backed fixed-width index. The projected
history array has no retained row members. The live row directory changes only
after the complete event has parsed and every row has the supported shape.

`durableRowFold.ts` now permits that indexed path for oversized v2 purge events.
The former 8 MiB whole-event refusal remains for v1 events. The numerical
`MAX_PURGE_SNAPSHOT_BYTES` value is unchanged. It also limits the projector's
encoded/decoded retained token allowance: four bytes per encoded UTF-16 unit,
checked before token growth. Ignored row text is validated incrementally without
being accumulated into a token. A corrupt oversized retained type token fails
with `RangeError` and releases the scan's descriptors and scratch files.

An additional filesystem control exposed a row-sized encoding Buffer in staging:
`writeFile` received the entire serialized row before journal preflight began.
The test first failed at the unchanged 8 MiB buffer bound. Staging now writes
64 KiB UTF-16 slices without splitting surrogate pairs, keeping encoded writes
below 256 KiB. A 14,000,000-byte Unicode text row stages, passes live-fold
preflight and lazily decodes exactly, without changing the row or the bound.
Per-row `JSON.stringify` strings remain allocated.

The fold does not read a complete event Buffer or string, deserialize the history
array, or introduce an eager recovery route. `readRow` remains a separate lazy
operation that decodes the selected row from its exact journal byte interval.
The event is not rewritten. Envelope version, event order, sequence, timestamp,
frontier representation and the single `payload.history` JSONL event remain
unchanged. `SessionRecordLine` has no length or CRC field; no CRC algorithm or
CRC-bearing recording format exists in these codecs to change or certify.

Live-fold preflight still writes the staged event to a temporary disk file and
uses the real fold before admission. Valid oversized v2 replacements now pass.
A separate negative control checks unsupported chronology, preserving exact
journal bytes, sequence and membership on rejection. The valid 8192-row
preflight fixture was not reduced or changed into a corrupt fixture.

## Cancellation, admission and durability controls

The fold accepts an optional abort signal, checks it before and after each read,
and closes its pinned handles and scratch files on cancellation. The recording
row API also accepts a signal for staging, preflight and its final admission
check. Cancellation before admission preserves the original reason and leaves
journal bytes and pending membership unchanged. A later successful replacement
uses the next sequence without a gap. Cancellation does not revoke an already
admitted append or prevent required compensation.

An interleaving test enqueues ordinary content while the real preflight is
scanning. The recorder repeats preflight when its tentative sequence is stale
and admits exactly one purge after the intervening content. It retains the
existing lifecycle and queue-room rechecks.

Two additional shared-journal controls cancel after an acknowledged candidate
append, at 512 and 8192 rows. The coordinator compensates with the complete
previous history. Every live and reopened row matches the original fixture,
without reaching `getAll`, `materializeHistory` or `transformAll`. These cases
preserve the primary cancellation error, observe two successful persistence
callbacks and release explicit owners.

Existing recorder controls still cover partial source rejection, disposal,
physical append failure and poisoning without acknowledgement. New fold controls
cover a valid individual row larger than 8 MiB, torn row and envelope tails,
invalid row and block schemas, complete records without a newline, older v1
records, suffix order, read failure, scan cancellation and scratch cleanup.
Recovery continues to skip malformed records atomically rather than publish a
partially staged purge. Unsupported chronology remains a typed fold failure.

The old size-refusal assertions in the fold, preflight and live-row tests were
replaced with successful v2 behavior assertions. Their valid row fixtures retain
the same sizes and content. Unsupported chronology is tested separately. The
16 MiB selected-row decoder limit and its existing failure-cleanup test were
not changed; this slice does not promise arbitrary-sized lazy row hydration.

## Bounds and verification

The unchanged production fixtures enforce 440 active owners and 8 MiB of
serialized owner charge. Both scales pass. Additional deterministic controls
observe bounded scan buffers, parser chunk strings, retained tokens and projected
slots. A deliberate decoded-row retaining control exceeds both owner bounds and
is rejected by the same predicate.

The unchanged semantic purge owner probe reports:

| Probe | Peak owners | Peak serialized bytes |
| --- | ---: | ---: |
| 512 rows, normal | 2 | 4,940 |
| 8192 rows, normal | 2 | 4,940 |
| 8192 rows, retaining control | 16,386 | 20,585,809 |

Only the three logical-owner cases were selected from the memory suite. Their
heap/external samples are incidental output, not statistical retained-growth
acceptance. No paired heap/GC sweep ran while competing suites and CLI sessions
were active.

`gates-settled/manifest.json` records all 51 final-source commands;
`final-summary.json` records test counts, protected hashes and audit identities.
The only nonzero final-source command is the unchanged structural scanner.
The command manifests and raw logs record these settled results:

- Original atomicity/density: 31 passes; semantic stream: 18 passes.
- Unchanged real production session suite: four passes, including 8192 rows.
- Durable fold: 17 passes; recorder wire/failure controls: seven passes;
  preflight: two passes; request isolation: two passes.
- Existing Responses byte comparisons: four passes; the production transport
  BODY BYTES matrix: twelve passes, with actual and expected bodies saved.
- Twenty selected adjacent suites pass all 158 cases. The fold/codec rerun
  passes 110 cases across eleven files. The final new controls pass 17 cases
  across five files, including acknowledged-append compensation and bounded
  Unicode row staging. An earlier combined control run passes 30 cases across
  six files.
- Official root typecheck and root lint pass. Forced 800/80 ESLint over all
  522 dirty TypeScript files passes with zero
  warnings. Prettier and `git diff --check` pass.
- The test audit retains the same 2,102 stable file/test/flag/detail/area
  identities, with zero additions or removals. An initial pair of byte
  preservation assertions was flagged as deriving its oracle from the same
  file reads. The settled oracle instead assembles expected byte length and
  digest from fixture inputs before comparing the folded file.
- The unchanged structural scanner remains at 18 passes and two failures,
  with the same six facade findings. No structural acceptance is claimed.

The earlier failed adjacent run expected the obsolete v2 size refusal. Its raw
log remains in the evidence directory. The final run uses the same fixture and
requires successful streaming plus descriptor and scratch release. Intermediate
lint, formatting and test-helper syntax failures also remain in the logs; the
settled checks pass.

## Remaining scope and untouched inputs

The request boundary still materializes arrays, and provider conversions and
request telemetry retain their existing request-scoped representations.
Staging and lazy row hydration still have row-sized strings and decoded values.
The token guard bounds individual projected tokens, not all engine heap
allocations. Explicit owner measurements do not prove retained-heap growth,
all-reference ownership or general leak freedom. Pending identity pins, ordinary
record queues, chronology ledgers and the other transaction surfaces keep their
existing contracts and limitations.

A signal cannot interrupt an arbitrary source promise that never settles; it is
observed when the source or file operation returns. The production session's
existing construction and completion cancellation wiring was not expanded.
The optional recorder and fold signal controls are independently exercised.

No acceptance fixture size, memory allowance, estimator, structural scanner,
lint threshold or enforcement configuration was changed. Protected hashes cover
the original atomicity/density and memory controls, scanner, lint configuration,
and already-dirty `.llxprt` files. Their contents remain unchanged. No `.llxprt`
file or preceding evidence was edited. No GitHub action, commit, push, OCR, PR or
merge was performed. These are selected behavior and static gates, not a full
repository test/build/smoke run or end-to-end memory certification.
