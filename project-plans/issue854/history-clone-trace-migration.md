# History clone and chronology return migration

`HistoryService.clone()` and `getChronologyTrace()` now return cold
`AsyncGenerator` values instead of synchronous arrays. This is an external API
compatibility break. The absence of production callers in this checkout does
not establish that external callers are safe. External consumers must use
`for await` and close iterators they abandon. `Array.fromAsync` can support
small test fixtures or explicitly eager consumers, but collecting the full
result loses the bounded-memory property. There is no eager compatibility shim.

Membership is captured on the first `next()`, not when the method is called.
Mutations before that first read are included; mutations after it are excluded.
Returning an unstarted iterator opens no journal cursor. Completion, early
return, iterator throw, consumer break, and consumer throw release the row
reader and disk-backed fold scratch.

Clone sanitization is row-local. Each row preserves the existing sanitizer's
content/block copies, shallow metadata copy, tool payload sanitization, and
media representation. Repeated object references inside one tool payload
still receive the existing `_circular` marker. A fresh sanitation traversal is
used for each block, as before. There is no cross-row transform requiring
whole-array atomicity. Error delivery changes with the asynchronous return
contract: a later row's failure can occur after earlier rows have been yielded.

Chronology uses the same single-row projection as the eager pure helper, with
ordered marker fields, structural descriptors, tool identifiers, summary flag,
and replacement span. Rows lacking chronology markers are skipped. The stream
does not include message text or tool parameters/results.

The iterators retain one decoded source row and one output at a suspension
point, with arrays bounded by the blocks of that single row. They contain no
history-array construction. The 440-owner and 8 MiB checks are bounded-input
fixtures, not limits on valid input size. The statistical retained-growth
allowance remains 1 MiB; eager negative controls retain the full result and
must fail that allowance.

Verification evidence is kept under
`tmp/verify854/p05d/history-clone-trace-20260929-1422/`. Criterion 1 is not
claimed complete by this migration. The unchanged AST scanner still reports
the other collection-returning methods.

## Verification results

The exact-path structural audit progresses from 10 findings to 9 after clone
migration, then to 8 after chronology migration. The scanner and its controls
were not changed. Three production-file audit tests remain red because of the
other eight findings.

The final history suite has 637 passing tests and those three audit failures.
The recording suite has 1,057 passes and no failures. The migrated agent suites
have 23 passes, isolated CLI/plugin dump suites have 38 passes, and the provider
dump contract has 18 passes. The new facade coverage includes 512/8192-row
text/tool/media parity, marker filtering, pinned membership, independent clone
objects, cold start, early return/throw, consumer exits, and disk scratch/owner
release.

Each retained-growth result uses five small/large pairs. The clone stream's
heap/external upper bounds are 79,277/76,949 bytes; trace bounds are
91,636/90,564 bytes. Both pass the unchanged 1,048,576-byte allowance. Eager
clone and trace heap medians are 18,144,138 and 2,495,739 bytes, respectively;
both controls fail that allowance.

Official core and CLI package typechecks pass after refreshing core's emitted
declarations. Forced 800/80 and normal ESLint both pass across all 397 dirty
TypeScript files. Existing oversized test containers at migrated callsites
were extracted into hoisted assertion-bearing functions; their lifecycle
registration and assertions remain in place. Prettier and `git diff --check`
pass. Test audit reports 2,126 findings before and after, with zero new findings
using stable file/test/flag/detail identity rather than relocated line numbers.

The remaining Criterion 1 findings are `HistoryServiceCore.materializeHistory`,
`HistoryServiceCore.stampHistory`, `HistoryService.getRawHistory`,
`HistoryService.getAll`, `HistoryService.getCurated`,
`HistoryService.getComprehensive`, `HistoryService.getCuratedForProvider`, and
`RecordingIntegration.takePersistenceFailuresThrough`.
