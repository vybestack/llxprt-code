# Public transform remains RED; the disk candidate cursor and durable compensation are bounded

This is the permitted partial stage. It does not change the public
`HistoryServiceCore.transformAll` callback signature, migrate its production
callers, or fix its full-array ownership. No array adapter was introduced. The
three exact public-transform owner tests remain executable and RED.

Evidence is under
`tmp/verify854/p05d/public-transform-stream-20260930T1211Z-branch3-sol/`.
Earlier stage reports, original atomicity tests, strict-memory tests and child
probe, the structural scanner, and `.llxprt` contents were not edited.

## Implemented contract and production use

The existing `HistoryDensityRows` disk ledger now has two explicit writer
operations. `append(row)` serializes a detached value onto the indexed candidate
file. `appendIdentity(row)` preserves and charges the original row object as an
identity pin. Neither operation takes or collects a whole-history array.
Density capture uses these operations instead of duplicating their storage and
pinning logic. This remains an internal candidate contract, not the public
transform callback contract.

`streamRows(signal?)` opens a repeatable async traversal over the disk candidate.
Its underlying iterator captures the row count when traversal starts, so writes
to that source during traversal cannot make it chase its own appends. Reads own
one decoded row until advancement, return, or cancellation. Cancellation before
traversal acquires no row. A cancelled traversal does not change membership;
a later cursor can read every row again. Closed candidates reject new cursors
and writes, including identity writes that would otherwise reacquire owners
without a subsequent release.

The existing disk chronology file and marker pins are reused. Value writes are
explicitly detached. Identity writes retain the original content and preserve
the original displaced marker during rollback through the existing chronology
ledger. No weak handle substitutes for a marker that must survive displacement.
Identity pins can still grow with the number of identity writes. The new
8192-row identity trap retains and charges all of them, rather than treating
them as bounded borrowed rows.

`compensateMutation` is now awaitable. For disk candidates with a fully durable
previous snapshot, it waits for the rewind acknowledgement and then admits and
acknowledges one restored row at a time. It does not build an inverse array.
`HistoryMutationSnapshot.hasPendingRows` is a scalar derived during capture;
it selects whether this bounded durable compensation is compatible with the
captured source semantics.

Pending previous rows keep the existing synchronous compensation admission.
They must retain their original identities and settle rollback while the writer
is still blocked. Their pending fold, candidate pins and replay admissions
remain potentially context-sized. Array-based mutation callers also retain
synchronous compensation admission. This is not a global queue bound.

Forward density admission still follows the existing journal plan. A density
plan normally contains one operation, but that operation can carry a
context-sized replacement payload. A generic fallback plan can admit many
operations without awaiting each acknowledgement. Those paths remain unfinished.

## RED tests and corrections

The candidate behavioral RED run failed all six initial cases because the
writer and async cursor operations did not exist. The cases use complete 512
and 8192-row mixed media/tool fixtures with 2048-byte text payloads. They replace
one row, remove one row, append another, check every unchanged source row, and
read the candidate repeatedly. Separate cases cover cancellation, early return,
source appends, original row/marker identity, and the retained identity trap.

A lifecycle RED case caught an identity write after closure reacquiring an owner.
It now fails fast before acquisition. Pre-aborted traversal has a separate
behavioral test.

The compensation admission RED cases retained 514 queued records at 512 rows
and 8194 records at 8192 rows while the writer was blocked. They restore and
verify every source row after releasing the writer. Their queue assertions were
not weakened.

An initial implementation also awaited forward density durability. The adjacent
23-case density suite caught seven reference-identity failures because pending
caller rows had become decoded durable values before the method returned.
That added forward wait was removed. Its failed log remains in `final-gates/`.
A new pending-source RED test then caught rollback failing to settle while the
writer remained blocked. Durable compensation is now selected only when the
captured previous membership has no pending rows. The pending-source test checks
settlement, all three original row references, primary error and token total.
The original density tests pass without changing their assertions.

## Ownership and verification limits

The standalone candidate cursor has a one-row decoded-owner peak on the fixed
fixtures. Its eager identity control owns all 8192 rows and exceeds both fixture
bounds. These observations do not certify every possible owner in a public
transform, the pending overlay, serializer buffers, or general retained heap
growth. An arbitrary accepted row can itself exceed the fixture byte bound;
no production row-size cap was added.

The public-transform pause still owns the complete callback/candidate array and
chronology ledger. The accepted 8192-row source still has 20,157,099 serialized
bytes. Its transaction census still has 16,384 row/marker owners and 20,580,869
charged bytes at the pause. No owner was excluded or renamed as borrowed to
change those observations.

The structural scanner still reports the same six findings:
`materializeHistory`, `captureChronology`, `getRawHistory`, `getAll`,
`getCurated`, and `getCuratedForProvider`. This stage adds scalar candidate
lifecycle and pending-membership state, row-wise writer calls and a scoped async
cursor. It does not remove any of those six findings or their negative controls.

## Final verification

`settled-gates/manifest.json` contains 184 sequential command results.
`settled-peaks/manifest.json` contains the ten isolated owner, identity, peak
and strict-memory commands. Both before/after host-process checks found no
competing suites for the final peak lane. The earlier failed runs remain in
`final-gates/` and `peak-gates/`; they are not presented as final-source proof.

The unchanged original atomicity/density files pass all 31 cases. Cleanup,
snapshot and repeatable-density coverage pass 11 cases. The final new cursor,
identity-lifecycle and admission suites pass 11 cases. Original identity and
traversal coverage pass nine cases. Density pause bounds and its eager trap
pass all six cases. Adjacent core, recording, agents, media and provider
coverage passes 1,797 test executions with zero failures, including the five
independent provider body equivalence/retry assertions. The media group includes
one file also run separately; this count is test executions, not unique cases.

| Final observation | 512 rows | 8192 rows |
| --- | ---: | ---: |
| Detached candidate peak decoded owners | 1 | 1 |
| Detached candidate peak serialized charge | 2,455 | 2,463 |
| Blocked durable-compensation pending records | 2 | 2 |
| Blocked durable-compensation queued bytes | 224 | 228 |
| Public transform paused transaction owners | 1,024 | 16,384 |
| Public transform paused serialized charge | 1,280,785 | 20,580,869 |

The explicit identity-pin trap owns 8192 rows and 20,157,099 charged bytes;
it exceeds both unchanged fixture bounds and releases to zero on closure.
The public transform tests still fail all three assertions. Their complete
source fixture and owner census are unchanged.

Official root `npm run typecheck`, root `npm run lint`, forced 800/80 and normal
ESLint across all 478 dirty code files, dirty-file Prettier and `git diff --check`
pass. The final audit has the same 2102 stable file/test/flag/detail/area
identities as the baseline, with zero added or removed findings. The structural
suite remains 18 passes and two failures, with the same six findings. Protected
file hashes match before and after, including original tests, strict child,
scanner and the preexisting dirty `.llxprt/LLXPRT.md`.

The unchanged strict-memory suite has two passes and three failures. Its normal
paired estimate passes numerically with heap/external upper bounds of -938,944
and -973,712 bytes. The retained-array trap estimate rejects the allowance, but
its separate heap-median assertion fails at -400,948 bytes despite a heap upper
bound of 20,505,210 bytes. The fixed fixture still owns 8192 rows and 20,157,099
bytes, failing both fixed bounds. All 23 raw samples and the unchanged estimator
result are retained in `settled-peaks/strict-memory-raw.jsonl` and
`strict-memory-summary.json`. These mixed results do not certify retained growth
or a general leak bound. No samples, allowances or trap assertions were changed.

## Remaining caller migration

The public break must migrate the two provider-file binding callbacks and the
two semantic-media purge callbacks together. Provider-file binding needs a
repeatable source for its missing-media validation and row-wise block updates.
Semantic-media purge still owns whole base/candidate arrays, compares those
arrays, persists array candidates and captures them during replacement and
compensation. Replacing only its transform callback with an iterator would leave
those owners intact. Its transaction, persistence and provider request candidate
contracts must migrate together.

Six context-range/facade test callbacks, the public owner helper and both
strict-memory child calls still exercise the original array transform contract.
They were not redirected to an eager accessor under another name. The facade
inherits that contract from the core; no child-interface adapter was added.

`addBatch`, `replaceBatch`, `replaceAll`, batch publication arrays, media
adoption/reconciliation arrays, pending fold pins, original-marker pins and
success-path context-range materialization also remain separate escape paths.
The disk candidate's value serializer has the existing density semantics; using
it for arbitrary public inputs requires preserving the public sanitizer and
serialization-failure ordering. None of those migrations is claimed here.

Final exact-path results are recorded in `settled-gates/` and the final isolated
peak lane. Provider BODY BYTES tests are adjacent checks on their existing
fixtures, not a new bounded end-to-end provider claim. No whole-repository test
suite, OCR, commit, push, PR, or merge was performed.
