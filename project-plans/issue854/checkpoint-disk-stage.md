# CLI checkpoint save now streams; restore and the core utility remain eager

This stage completes the invoked CLI checkpoint save caller using the permitted
partial-delivery route. It removes one production eager `getHistory` wrapper,
reducing the raw/dynamic wrapper inventory from eleven to ten. Both direct
production `HistoryService.getAll` calls remain. It does not certify checkpoint
restore, the exported core checkpoint preparation utility, or the public eager
history APIs as bounded.

Evidence is in
`tmp/verify854/p05d/checkpoint-disk-stage-20261002-sol-76ad/`. The directory retains
starting sources and the dirty diff, the fail-first receipts, exact commands and
exit codes, source hashes, owner censuses, provider byte pairs, audit comparison,
and the remaining-call inventory. Existing protected files, `.llxprt`, prior
stage evidence and enforcement were not changed. No GitHub action, commit, push,
OCR, PR or merge was performed.

## Persistence format and completed route

The actual CLI checkpoint object has these ordered properties:

1. `history`: the supplied UI history array.
2. `clientHistory`: native `IContent` rows from the agent's raw scoped reader.
3. `toolCall`: `name`, then `args`.
4. `commitHash`: the resolved snapshot hash.
5. `filePath`: the supplied tool argument.

The format remains the exact output of `JSON.stringify(object, null, 2)`, with no
final newline. The file name remains the timestamp, target basename and tool
name, with a `.json` suffix. JSON syntax does not require collecting its history
array in memory. The previous whole-object stringify was an implementation
choice.

`createToolCheckpoint` now supplies a cold `Agent.streamHistory(signal)` source
to a pretty JSON encoder. The encoder traverses one row at a time, including
nested arguments and blocks. It preserves property order, omission and array
null semantics, `toJSON`, boxed primitive handling, string escapes, paired and
unpaired surrogates, and empty containers. Cycles and BigInt reject. String
serialization uses slices of at most 2,048 UTF-16 code units, preserving surrogate
pairs at slice boundaries. Output chunks hold at most 16,384 UTF-16 code units,
with a tested 64-KiB UTF-8 ceiling. There is no production whole-history array,
whole-checkpoint string, `Array.fromAsync`, or whole-row encoded string.

The disk writer opens a unique `wx`, mode-0600 staged file beside the destination,
handles partial writes, fsyncs and closes it, then renames it to the final name.
A zero-byte write rejects. Aborts are checked before opening, during encoding
and writes, and before rename. Rename is the publication point; abort does not
promise to undo an already issued rename. Errors and cancellation close nested
iterators and file handles and remove staged output. The React hook passes a
mount-lifetime abort signal, so unmount cancels in-flight work. Existing git
fallback, debug reporting and reservation/retry behavior remain.

The UI history array is still supplied by the UI and is not claimed to be a
bounded owner. Deferred array-backed clients and the existing provider media
resolver also remain separate owners. The positive proof covers the invoked
save route on active and inactive stored-journal clients.

## Fail-first and byte contracts

`cli-save-red.log` records one pass and seventeen failures before production
changes. Both 512 and 8192 sizes fail on the real eager public reader. The
original exact-byte test and nine-MiB row test remain present. The later hook
unmount case has its own failing receipt in `hook-cancel-red.log`; boxed BigInt
has a failing compatibility receipt in `encoder-red.log`.

The CLI closing lane has 44 passes: 26 disk save cases, three encoder cases,
fourteen original checkpoint cases and one real hook cancellation case. The
fourteen original titles and all original assertion expressions are unchanged,
as recorded in `legacy-assertion-inventory.json`. Their filesystem fixture now
consumes chunks, and their fake agent exposes an empty cold reader. Named test
callbacks keep the original assertions visible to the test-audit scanner while
satisfying the forced 80-line function bound.

The save lane checks exact legacy pretty JSON bytes, complete row delivery,
paused consumption without read-ahead, pre-abort, source failure, write failure,
fsync failure, close failure, rename failure and preservation of an existing
checkpoint. A valid nine-MiB row remains accepted without a large encoding
chunk. Small-row reader peaks are one row and 3,047 serialized bytes at 512 rows,
and one row and 3,050 bytes at 8192 rows. Readers settle at zero live rows.

The provider oracle invokes the actual Agent save and CLI restore commands at
512 and 8192 rows. Twelve expected/actual BODY byte pairs cover Anthropic,
OpenAI Responses and Gemini, caching off/on, with retry on the restored route.
Inline audio/image history becomes media references during compatible restore;
the oracle uses the real local media resolver to compare transport bytes. UI
history, tool arguments and cache anchors survive the round trip. Token counts
are checked before and after against the independent fixture contract of six
counted blocks plus the 1,000-token image charge per row. The oracle does not
claim that the existing restore allocation is bounded.

The initial provider oracle exposed two fixture errors, preserved in its logs:
token counts needed explicit initial recalculation, and restored reference media
needed an explicit resolver. The shared test-only BODY helper gained an optional
resolver argument; existing callers retain their prior behavior. The auditor
then rejected same-reader and duplicated token assertions. The final grouped
assertion checks both counts against the independent fixed expectation, without
removing either comparison.

## Checks and trap controls

`manifest.json` records the closing commands and expected failures. The original
31 chronology/rollback cases pass. Adjacent CLI checkpoint/restore tests have
32 passes; core checkpoint utilities/lifecycle have 36; checkpoint/replay has
39; public scoped history has 29; provider BODY regressions have 18. The invoked
checkpoint BODY and adjacent export BODY lanes each have two passes.

Strict scoped core, agents and CLI TypeScript pass. Forced 800/80 zero-warning
lint, Prettier and diff-check pass. The duplicate-preserving audit comparison
has zero added findings and zero removed findings. No assertion, threshold,
deadline, exclusion or enforcement rule was weakened. The positive bounds stay
at 440 rows and 8 MiB. This stage does not claim a new retained-heap or
whole-process memory proof.

The borrowed/copied checkpoint retaining trap has eight required failures. Its
external owner retains all 512 or 8192 rows while reader counters have settled
to zero. The pending-row trap has two required failures. The structural scanner
remains RED with eighteen passes and two failures, covering the unchanged
`HistoryService.getAll`, `HistoryServiceCore.materializeHistory` and
`HistoryServiceCore.captureChronology` findings.

## Remaining RED surface

`remaining-checkpoint-red.log` records four deliberate failures at 512 and 8192:

- CLI `restoreCommand.ts` still uses `readFile` and whole-file `JSON.parse`, then
  passes the complete `clientHistory` array to `setHistory`. Its real invocation
  admits 512 or 8192 eager rows. The 8192-row external array charges 17,909,349
  serialized bytes. A complete migration needs a disk JSON reader and deferred
  journal admission with UI/project restoration error behavior preserved.
- Core `checkpointUtils.ts:124` still calls `agentClient.getHistory`. Its exported
  `processRestorableToolCalls` returns `Map<string, string>` with whole-checkpoint
  strings. It also preserves `messageId`, unlike the CLI save object's `filePath`.
  A complete migration must replace the public string-map contract and provide
  a durable consumption/cleanup owner. No production consumer of that utility
  was found in this checkout.

The core utility's existing validation schema still describes legacy
`role`/`parts` content; the invoked CLI writer uses native `speaker`/`blocks`
rows and restore performs no schema validation. Neither format was changed in
this stage.

The remaining direct `getAll` callers are
`ConversationManager.ts:500` and `clientHistoryReader.ts:16`. Public default and
false `getHistory` contracts still return eager arrays. The ten outstanding
raw/dynamic wrapper sites, including public forwarding, carried startup,
clear/rollback, initialized `setHistory`, chat restore and the core utility, are
listed in `remaining-calls.json`. No remaining eager API was relabeled as
streamed.
