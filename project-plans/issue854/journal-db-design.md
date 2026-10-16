# Journal as a database: design for issue #854

Branch `issue854`, PR #3852, GitHub issue #854. Status: design only, no code changed.

The history journal becomes a small database file (append-only, copy-on-write, with indexes inside it) and each provider send becomes a streaming filter from that file to the socket. This document describes the file format, the indexes, the mutation rules, the filter, and the proof plan. It follows the owner's rules:

- No whole-history arrays in memory.
- No in-memory map that scales with the history, even one that holds only ids.
- No per-send temp files: no spool, no normalization snapshot, no per-request index on scratch disk. The one exception is a send with a registered BeforeModel hook (Section 15.1).
- The format carries what readers need. A reader that wants the running counts reads the last trailer and nothing else.
- Old journals are not resumed. They fail fast with a clear message. There is no upgrade path.
- Content-Length is computed from per-row transfer summaries stored in the journal. No counting pass, no spool.
- Request bytes stay identical to today's for the same history. The oracles are `packages/providers/src/__tests__/wireBodyGolden.test.ts` with `fixtures/wire-bodies` (about 315 cases over 7 route files), the Anthropic wire-builder tests (`packages/providers/src/anthropic/message-table/__tests__/wire-builder.test.ts` and its cache and emit counterparts), and a 5,000-seed wire corpus per provider format that phase 0 freezes from today's builders before anything is deleted (14.3). `message-table-golden.test.ts` is a 600-case `/dump` golden with dump semantics and is not a wire oracle.

Three exceptions to these rules are declared and bounded, and each is described where it arises: a BeforeModel hook that rewrites the request (Section 15.1), request sources that are not journal history (7.5), and the SDK arrays of the Vercel provider and the Gemini plugin, which are kept by decision (#3869, 7.5). The Codex WebSocket route has no exception: it sends the request as fragments of one message, streamed from the filter (7.3).

Section 0 summarizes the code that was read. Sections 1 to 14 describe the design. Section 15 holds the decisions that closed the open choices and the residual risks. Revision r2 of this document folds in the Responses, normalized-id, Kimi and Mistral prototypes (`tmp/854-notes/r2-proto/`, untracked; numbers in Section 15). Revision r3 settles root corruption, blob lifetime under a pin, clone and compaction relocation, owner fan-out, mirror recovery, compaction memory, the deletion schedule and the Windows swap, and records a flush and write-volume measurement (`tmp/854-notes/r3-probe/`).

## 0. The current code, in brief

What exists today, with the paths that matter for this design.

**Record framing and reading.**
- The journal is JSONL. Each line is a `SessionRecordLine { v, seq, ts, type, payload }` (`packages/core/src/recording/types.ts`). Types include `content`, `compressed`, `rewind`, `density_mutation`, `synthetic_insert`, `chronology_bind`, `semantic_media_purge`, `replace_begin/commit/abort`, and metadata events.
- `packages/core/src/recording/journalCursor.ts` defines `MAX_RECORD_BYTES = 16 * 1024 * 1024`. A line longer than that is skipped with an oversize diagnostic. That is defect #5. `RangeError` is also thrown in `resumeCursorBoot.ts`, `journalResolver.ts` and `durableRowFold.ts` for invalid watermarks.
- State is derived by folding every line. `durableRowFold.ts` (`foldLine`) maintains a `MutableRowDirectory` (`mutableRowDirectory.ts`): one 64-byte entry per row on scratch disk (source, offset, bytes, chronology overlay, `invalidateResponses`, origin id). `durableFoldCheckpoint.ts` caches a directory keyed by journal inode, projection and watermark, validated by a SHA-256 of the last 4 KiB. `pendingRowFold.ts` folds the not-yet-acked writer queue over it.
- `foldRewind` cuts at `directory.firstChronology(cutSeq)`, the first row carrying that chronology marker (defect #2). `compressed` truncates to zero and appends the summary. `semantic_media_purge` carries a whole-history snapshot in one line.

**Writer and commit point.**
- `SessionRecordingService.ts` queues lines (`enqueue`), drains them with `appendFile` (no fsync), and acks each record with a `{seq, byteOffset}` watermark (`CommitWatermark` in `types.ts`). `replaceWriteGuard.ts` and `replaceTransaction.ts` implement the replace grammar: `replace_begin`, tagged `content` rows, `replace_commit`, with abandon-on-unrelated-record on read.
- `detachedHistoryPublication.ts` `publishReplacement` writes the transaction. `admitOp` runs the `onDurable` callback in the `!awaitCommit` branch right after `waitForDurable()` is created and before the ack arrives, so `replacementDurable` becomes true before the commit record is durable (defect #1). `compensate` then chooses between `replaceAbort` and `restorePrevious` from that flag.

**Owners.**
- `historyRecorderFanout.ts`: per-origin recorder bindings. `deliver` filters by `payloadOrigin` and `acceptsHistoryOrigin` (an unowned row goes to every mirror). `historyOriginId.ts` maps origin objects to 8-character ids written on rows. `historyRowOrigins.ts` captures one 4-byte origin per row into a scratch file for compensation. `durableRowFold.ts` carries an `origin` number per row.

**Normalization.**
- `packages/core/src/services/history/provider-curated-stream.ts` (`prepareProviderContentSnapshot`) runs four stages over `ProviderNormalizationDisk` (hash-indexed scratch, `provider-normalization-disk.ts`): continuity (`seen:`/`responded:` keys, reconstructed calls), `completeResponses` (orphan synthetic responses), `indexResponses` (`call:`, `slot:`, `response:`, `media:` keys, best-score duplicate selection), `stageOutput` (strip responses from their rows, re-emit them next to the call via `adjacentResponse`, which reads completed row `i+1`). The tail (pending turn rows) is passed in memory and carries `pending:`/`tail:`/`origin:` keys.
- `tmp/854-notes/perf3/STATUS.md` records why a prefix cannot be cached: `responded` is global, a later duplicate response can replace an earlier response, and tail rows change meaning once committed.
- `historyCuration.ts` `isCuratedContent` is a per-row predicate. `canonicalToolIds.ts` makes history tool ids unique per call (`hist_tool_...`), so repeated ids are an anomaly, not the norm. `normalizeToOpenAIToolId` and `normalizeToHistoryToolId` (`packages/tools/src/formatters/toolIdNormalization.ts`) are many-to-one (`call_x`, `toolu_x`, `hist_tool_x` collapse).
- Callers: `packages/agents/src/core/streamprocessor-disk-source.ts` (`streamDiskSource`: prepare snapshot with the pending rows as tail, run hooks, estimate, enforce compression, reopen after compression, send).

**Send preparation.**
- `packages/providers/src/utils/wire-body-spool.ts`: `WireBodySpool` writes the whole body into a scratch file, seals it, and the sealed size is the Content-Length. `envelope-writer.ts` writes the small envelope members and a `StreamedSegment` for the message array. Envelope limit `DEFAULT_HTTP_JSON_ENVELOPE_BYTES = 128 MiB` (`boundedJsonBody.ts`).
- OpenAI chat: `openai/OpenAIRequestPreparation.ts` (`spoolChatBody`), `openai/OpenAIChatBodyBuilder.ts` (`streamChatMessages`: pass 1 `observeRows` computes `rowCount`, `lastThinking`, `hasCalls` and feeds the Kimi/Mistral id mapper; pass 2 converts one row at a time). Mapper facts go to `utils/keyed-row-tool-id-store.ts` over `utils/keyed-row-index.ts` (a scratch directory per request).
- Responses: `runtime/responses-source-input.ts` (`ResponsesSourceInput`, `findDanglingCalls` holds an `open` Set and a `names` Map in the heap; `ToolPairIndex` in `runtime/responses-tool-pair-index.ts` is a scratch `KeyedRowIndex`), `openai-responses/openAIResponsesStateful.ts` (parent scan, `skipRows`), `openAIResponsesStatefulRecovery.ts`.
- Anthropic: `anthropic/AnthropicSpooledRequest.ts` builds a `MessageTable` (`message-table/message-table.ts`, disk-backed linked lists of message and block records) through `wire-builder.ts`, `validation.ts` (`filterOrphans`, `repairAdjacency`, `mergeRoles`), `finish.ts`, `cache-controls.ts` (anchor, purge boundary, tail breakpoints), `tool-id-index.ts` (scratch), `recovery-images.ts`.
- Estimators: `providers/src/runtime/prompt-estimator-files.ts` and `anthropic/AnthropicEstimatorFiles.ts` write a second copy of the prompt in "key" form during body construction. Tokenizers are in `providers/src/tokenizers/`.
- Telemetry: `providers/src/logging/requestSizeReport.ts` passes the size through a function stored in a metadata record under `REQUEST_SIZE_SINK_KEY`; `LoggingProviderWrapper.ts` consumes it through `DeferredApiRequest`.
- Scratch: 31 non-test modules create directories through `packages/core/src/storage/scratch-root.ts`. The root is process-owned and swept by a later process.

## 1. Problem and constraints

### 1.1 Defects this design must fix

| # | Defect | Where it comes from now | Fixed by |
|---|--------|-------------------------|----------|
| 1 | A replace transaction is marked closed before its close record is durable. | `detachedHistoryPublication.ts` `admitOp`: `onDurable` runs before the ack in the `!awaitCommit` branch; `compensate` branches on `replacementDurable`. | Section 4.1: the trailer is the commit point and the in-memory "closed" state advances only from the trailer ack. |
| 2 | A pop after a self-merge cuts at the first duplicate marker. | `durableRowFold.ts` `foldRewind` uses `firstChronology(cutSeq)`; a merged row repeats a chronology seq. | Sections 2 and 4.3: rewind is addressed by row label, which is unique, never by chronology marker. |
| 3 | Edits over 64 rows are written unowned and leak to other agents. | Reported in the dogfood run. Traced: `preferDetachedReplay` in `planHistoryMutation.ts` returns true when a disk-density result changes more than `MAX_RETAINED_VALUE_OPS = 64` rows, and then `planHistoryMutation` calls `replacementOps(previous, next, nextOrigins)` with `nextOrigins` undefined, so the replacement rows carry no origin. | Section 5: owner is a required field of every row record and of every row entry; there is no unowned fast path keyed on row count. |
| 4 | A late-attached agent uses the original tag, not the current owner. | `historyRowOrigins.ts` captures origins at one moment; payload tags are write-time values. | Section 5.3: attach reads the current owner from the row entry in the current version. |
| 5 | Rows over 16 MiB are unreadable. | `journalCursor.ts` `MAX_RECORD_BYTES` skips the line. | Section 2.2: length-prefixed frames with a 64-bit length and no ceiling. |
| 6 | Responses `previous_response_id` recovery uses closed rows. | The parent scan (`openAIResponsesStateful.ts`) walks rows without a notion of which version is current; reported against rows from a version a later mutation closed. Not reproduced from the code read for this design: the scan walks the rows it is handed. The reproduction test is written against the old code first (Section 14, phase 6b), and the defect stays in this table only if it fails there. | Section 3.5 and 7.3: the parent is a lookup in the current version's meta map, restored with the version on pop. |
| 7 | Temp directory leak. | 31 scratch users; a killed process leaves `llxprt-scratch-<pid>-*`; the bare history store makes its own temp directory (`historyJournalStore.ts` `ensureRecorder`). | No per-send scratch exists (Section 12). A bare store uses an unlinked file. |
| 9 | Media rows are held for the whole request. | Reported. The request-scoped media reservations in `request-media-resolver.ts` and the table passes keep media across rows. | Section 10.3: media resolves per row inside the filter and is released after that row's bytes are written. |
| 8a | Responses unanswered tool calls held in memory. | `findDanglingCalls` `open` Set and `names` Map. | Sections 6 and 7.3: answered by id facts for journal history. A source that is not journal history keeps the scan (7.3, 7.5). |
| 10 | Rejected Responses parents held in a growing in-memory set. | `OpenAIResponsesProviderCore.ts:72` `rejectedStatefulParents`, one id per backend rejection for the life of the provider instance. | Section 3.5: the provider instance owns a disk-backed hash table of rejected ids, created on the first rejection and deleted by `clearState()` and disposal. No set and no journal fact exists. |
| 8b | Anthropic thinking chains held in memory. | `wire-builder.ts` pass 1 and the run re-reads; chain rows are buffered. | Section 7.4: aggregates plus cursors. |

### 1.2 Constraints, restated as checks

C1. No array or map holding one entry per row or per id is created in the send path or the resume path, apart from the declared SDK arrays of the Vercel provider and the Gemini plugin (7.5) and the Responses dangling scan of a source that is not journal history (7.3).
C2. No file is created for a send, except for a send with a registered BeforeModel hook that rewrites the request (Section 15.1), and the provider instance's rejection table, created once on the instance's first backend rejection of a parent and never per send (Section 3.5). The test plan counts directory creations during a send (Section 13).
C3. A reader finds the current state with one pread of the file tail and four preads of the root nodes (Section 3.1).
C4. The filter's memory is a function of the largest single row, the tail size, the tool calls in one row, the fanout and tree depth, never of the number of rows (Section 6.5).
C5. Content-Length is a composition of stored transfer summaries (Section 8).
C6. Wire bytes are identical to the current implementation for the same history, route and settings (Section 13.1).
C7. A journal in the old format fails with an error that names the file and says it cannot be resumed (Section 2.1).

## 2. File format

One session is one file. The file is a header followed by records. Nothing is rewritten in place. All integers are little-endian.

### 2.1 File header and the refusal of old journals

The first 64 bytes:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 8 | magic `LLXJRNL\0` |
| 8 | 4 | `formatVersion`, 3 (the JSONL journals were versions 1 and 2, see `recordingVersion.ts`) |
| 12 | 4 | flags, zero |
| 16 | 16 | `fileId`, random |
| 32 | 8 | `syncMarker`, random, used to find trailers (Section 3.1) |
| 40 | 8 | `createdAtMs` |
| 48 | 12 | reserved, zero |
| 60 | 4 | CRC-32 of bytes 0 to 59 |

A file whose first byte is `{` (a JSONL line), whose magic differs, or whose `formatVersion` is not 3 is refused with one error, thrown before any other read:

`Session file <path> was recorded in the retired JSONL journal format (versions 1 and 2) and cannot be resumed. Start a new session.`

There is no reader for the old format, no converter, and no "legacy" branch anywhere else. Session discovery (`SessionDiscovery.ts`, `firstUserMessageScan.ts`, `boundedHeaderReader.ts`) lists such files as unreadable with the same message, through the existing `unreadableRecordings.ts` path.

**File extension.** New sessions are `session-<timestamp>-<id>.llxj`. A binary file named `.jsonl` would be opened by tools and globs that expect text, and the new extension also keeps old and new files apart without reading either. The name is one constant, `SESSION_FILE_EXTENSION`, and it replaces the `.jsonl` matchers that exist today: `SessionDiscovery.ts:549`, `sessionCleanupUtils.ts:147`, `janitor/sessionScanner.ts:26`, `janitor/sessionGrouping.ts:44`, `janitor/mediaReclamation.ts:125`, the lock-name regex in `SessionLockManager.ts:165` and the file name built in `SessionTransitionService.ts:127`. A second constant, `RETIRED_SESSION_EXTENSION` (`.jsonl`), is read in one place: discovery lists `session-*.jsonl` files as unreadable with the message above, and the janitor treats them as expired by the same age rules without opening them. That is the whole of the old-format handling.

### 2.2 Record framing

Every record has the same frame. There is no line terminator and no size ceiling. CRC-32 here is the zlib polynomial.

```
u8   kind
u8   frameFlags            bit 0: body present
u16  reserved              zero
u32  headerLen             bytes of the kind header
u64  bodyLen               bytes of the body, no upper bound
u32  frameCrc              CRC-32 over the 16 bytes above and the kind header
[kind header: headerLen bytes]
[body: bodyLen bytes]
u32  bodyCrc               CRC-32 over the body, folded while the body is streamed
```

**CRC function.** CRC-32C is not available natively: neither Bun 1.3.14 (`Bun.hash` offers `crc32`, `adler32`, `xxHash*`, `wyhash` and others, and `crypto.getHashes()` lists no CRC) nor Node v25.2.1 has it. Both have `zlib.crc32` (Node since v22), and both return `0xcbf43926` for the string `123456789`, which is the CRC-32 check value. `zlib.crc32(data, previous)` takes a running value, which was checked (`crc32('ab') === crc32('b', crc32('a'))`), so the body CRC folds while the body streams. On this machine Bun's `zlib.crc32` ran 256 MiB in 41 ms, about 6 GiB/s, so a 200 MiB row costs about 35 ms. A CRC-32C would have to be written in TypeScript and would run as JavaScript rather than native code, and for detecting torn writes and bit flips the two polynomials serve equally well here.

The frame head is 20 bytes. `headerLen` is a `u32` and `bodyLen` a `u64`, each at its natural alignment inside the head, which is why 2 reserved bytes (zero, covered by `frameCrc`, refused when nonzero) sit after `frameFlags`. A `u16` `headerLen` would have capped a `ROW` header at 65,535 bytes, which a row with about 3,850 blocks, or about 1,070 blocks that each carry two ids, already exceeds. With a `u32`, the kind header of any record that exists fits, and a `ROW` header is limited only by the 4 GiB `headerLen` itself (Section 2.4).

The record length is `20 + headerLen + bodyLen + 4`. A reader validates a frame in this order: the frame fits in the file (`offset + length <= fileSize`, otherwise it is a torn tail), `frameCrc` matches, then the kind header is parsed. The body CRC is checked by whoever consumes the body, while it streams.

Two outcomes are kept apart. A frame that does not fit in the file, or whose `frameCrc` fails, is a torn or incomplete write. That is tolerated only at the tail of the file, where trailer recovery (3.1) may step back over it. A record reached through a trailer whose own frame is valid (a root, a node below a root, a `ROW`, a `LENS`, a `VALUE`) that fails its frame CRC or body CRC is corruption. The read throws `JournalCorruptionError` naming the file, the record's offset and the trailer that led to it. It is never skipped, never repaired, and never answered by falling back to an older trailer.

`bodyLen` is a `u64`. Nothing allocates a buffer from `bodyLen`. The 16 MiB constant `MAX_RECORD_BYTES` in `journalCursor.ts`, the oversize-skip diagnostic, and the `RangeError` guards that exist only to bound line assembly are deleted with the JSONL reader. A row is decoded piece by piece (Section 2.4), so the largest allocation on the read side is one block of one row. The send path still refuses a body above the 128 MiB envelope limit, at planning time, from the stored totals, before any byte is streamed (Section 8.4).

### 2.3 Record kinds

| Kind | Name | Purpose |
|------|------|---------|
| 0x01 | `ROW` | One history row. Immutable. |
| 0x02 | `RTNODE` | A node of the row tree (Section 3.2). Immutable. |
| 0x03 | `ITNODE` | A node of the id trie (Section 3.3). Immutable. Also used for the versioned meta map and the state map (Section 3.5). |
| 0x04 | `LENS` | Per-block serialized lengths of one row for one format slot and variant (Section 8). Immutable; a newer one supersedes through the row entry. |
| 0x05 | `VALUE` | A small value referenced from the meta map or the state map: session title, name, provider and model, workspace dirs, checkpoint descriptors, owner dictionary, mapped tool ids. JSON body. |
| 0x06 | `EVENT` | An audit event with no effect on history state: provider switch, session event, directories changed. JSON body. Nothing reads these to derive state. |
| 0x7F | `TRAILER` | The commit record. Carries the running-state header. |

The JSONL record types `replace_begin`, `replace_commit`, `replace_abort`, `rewind`, `compressed`, `compression_detail`, `density_mutation`, `synthetic_insert`, `chronology_bind` and `semantic_media_purge` have no counterpart. Each is a mutation expressed as a commit group (Section 4), and `trailer.mutation` names which one it was. A whole-history snapshot line (`semantic_media_purge`, bounded by `MAX_PURGE_SNAPSHOT_BYTES` in `resolverProjection.ts`) is no longer possible: a purge writes the changed rows.

### 2.4 The `ROW` record

The kind header (fixed part, then arrays):

```
u64  label            order key, unique among live rows (Section 2.6)
u32  owner            owner dictionary id, 0 = unowned (Section 5)
u8   speaker          0 human, 1 ai, 2 tool
u8   reserved
u16  flags            curated, hasThinking, hasToolCall, hasToolResponse, hasMedia,
                      hasImage, hasCacheableBlock, cacheAnchor, synthetic,
                      invalidateResponses, responseParent
u32  blockCount
u32  idCount
u32  idsLen           bytes of the id piece (first piece of the body)
u32  metaLen          bytes of the row metadata piece (second piece)
u64  chronologySeq    0xFFFFFFFFFFFFFFFF = none
u32  chronologyUserTurn, u32 chronologyStep, u64 chronologyRecordedAt
u64  parentEndpoint   on a row with the responseParent flag: hash of metadata.providerBaseURL after
                      stripping trailing slashes, 0 when the recorded URL is absent or empty (a wildcard
                      parent, Section 3.5); else 0
blockDir[blockCount]  { u64 offset, u64 length, u8 type }   offsets relative to body start
idTuples[idCount]     { u8[16] idHash, u8 kind (call|response), u32 block, u8 score, u32 nameLen }
```

The fixed part is 64 bytes, a block directory entry 17 and an id tuple 26, so the kind header is `64 + 17 * blockCount + 26 * idCount` bytes. Every count and index is a `u32` so that a row of any size round-trips: a row with 100,000 blocks and 100,000 ids has a 4,300,064-byte header, which the `u32` `headerLen` of Section 2.2 describes. The only bound is that `headerLen` itself, 4,294,967,295 bytes, and the encoder throws a `JournalFormatError` for a header above it.

A row header holds nothing that depends on any other row. The occurrence chain and the parent chain are not stored here. A link to "the previous row" written into an immutable record is wrong after any compression, density or purge, so both chains are entries of the versioned id trie and meta map (3.3, 3.5). The `responseParent` flag is set at write time when the row is an AI row with `metadata.responsesStored === true`, a non-empty string `metadata.id`, and a self unit (R7 yields a unit for the row, which is a function of the row alone).

The body is the id piece, the metadata JSON piece (`{"speaker":..., "metadata":...}` without the blocks), then one standalone JSON value per block, in order. The pieces are what `JSON.stringify` yields for the same objects, so a decoded piece re-serializes to the same bytes it was parsed from, which is the property the current wire builders already rely on when they parse journal lines. The **id piece** holds the raw id string of every id tuple in tuple order, each as `u32 length` and UTF-8 bytes. It exists because a rebuild must recompute facts from the exact string: the Mistral mapped id is `sha256(raw + "|" + salt)` and the provider-normalized ids of 3.3 are functions of the raw id, and neither is a function of `idHash`, which is `sha256(raw)[0..16)` (prototype `mistral17.ts`: a stale or hash-derived mapping is wrong in 148 of 2,000 removal cases, and rebuilding from the raw id equals the real mapper in 2,000 of 2,000). The id piece comes first in the body so that the kind header and the id piece are adjacent bytes: a rebuild reads them with one `pread` of the record's first 4 KiB, and a second only for a row whose header and id piece are larger. The prototype's ids averaged 7.8 bytes with a maximum of 12; provider ids are longer (typically 20 to 40 bytes, not measured here), so the id piece costs about 25 to 45 bytes per tuple. It is not in the header so that the header holds fixed-width entries only.

Why the directory and the id tuples exist:
- A reader that needs one block (a best response relocated next to its call, Section 6.3) preads that block's range and does not read the row.
- Rebuilding an index (Section 4) reads the record's header and id piece and never a block: the id tuples carry everything the id trie needs (`idHash` is the first 128 bits of the SHA-256 of the exact id string (3.3), `score` is the response score used for best-response selection, `nameLen` feeds the synthetic-unit lengths), and the id piece supplies the raw strings for the facts that cannot be derived from the hash.
- `curated` is `isCuratedContent(row)` (`historyCuration.ts`) computed once at write time.

A row never changes. Anything about a row that changes after it is written (owner, token counts, lengths, answered count) lives in the row entry (Section 3.2), which is copy-on-write.

### 2.5 The `TRAILER` record: the running-state header

A trailer is the last record of every commit group. The writer flushes the group's records before it writes the trailer (Section 4.1), so a trailer on disk never names a node that is missing from the disk. Its kind header is fixed size, 1,480 bytes, and holds the whole state, so a reader that wants "the current state" reads the last trailer and stops. The trailer record is 1,504 bytes with its 20-byte frame head and 4-byte body CRC. Its last 8 bytes before the body CRC are the file's `syncMarker`, so every trailer ends with `syncMarker` and the CRC (3.1).

```
u64  selfOffset          offset of this record, used to validate a candidate (Section 3.1)
u64  commitSeq           1, 2, 3, ...
u64  parent              trailer this state extends by append; 0 for a lineage start
u64  skip[3]             ancestors 8, 64 and 512 parent-hops back
u64  lineage             changes whenever a group starts a new lineage (Section 4.3)
u64  lineageDepth        parent-hops since the lineage start
u8   mutation            append | pop | compress | replace | density | purge | clear | insert | owner |
                         fill | state | clone | restore
u56  groupTag            random per commit group, in the 7 bytes after `mutation`. With `commitSeq` it
                         names one version, so a version that was lost and rewritten cannot be mistaken
                         for the original (Section 5.2).
u64  mutationArg0, mutationArg1     e.g. pop: cut label and removed count
u64  rowRoot             RTNODE root offset, 0 = empty
u64  idRoot              ITNODE root offset, 0 = empty
u64  metaRoot            ITNODE root of the versioned meta map, 0 = empty
u64  stateRoot           ITNODE root of the unversioned state map, 0 = empty
u64  nextLabel           next label to hand out, never reused
u64  firstLabel          label of the first live row: the context range start
u64  lastRowOffset       offset of the last live ROW record: the last content offset
u32  lastOwner           owner of the last live row           (+ 4 bytes padding)
u64  ckptBytes           estimated live bytes of the retained checkpoint versions (Section 4.11)
Aggregate rootAggregate  copy of the row tree root's aggregate (below), 1,144 bytes
SlotTable slots          3 format slots of 32 bytes (each names the summary kind it holds) and 4 family
                         slots of 16 bytes (Section 8.5), 160 bytes
u64  durableEnd          offset just past this record (also the frame end)
u8[8] syncMarker         the file's marker, so the record ends with it (Section 3.1)
```

`mutation` has no `bind` value (4.6) and has `state` for a group that changes only the state map (checkpoint create, delete or rename, title, mirror sequence).

`Aggregate` is one fixed layout, 1,144 bytes, used in the trailer and in every row-tree child slot. It has a 256-byte plain part and three transfer-summary slots of 296 bytes each (888 bytes).

The plain part:

| Field | Size | Combine | Use |
|-------|------|---------|-----|
| `rows`, `curated`, `units` | 12 | sum | row count, curated row count, units in the normalized stream (Section 6) |
| `tokens[4]`, `tokensMissing[4]` | 48 | sum | tokens per tokenizer family slot (Section 9), and rows still missing |
| `liveBytes` | 8 | sum | bytes of live `ROW` and `LENS` records (compaction trigger, Section 4.11) |
| `mediaChars` | 8 | sum | normalized-selection media metric for media other than images, in base64 characters (media budget, Section 8.4) |
| `imageChars[3]` | 24 | sum | the same metric for images, per format slot; image-dependent (Section 8.5) |
| `pdfBytes[3]` | 24 | sum | provider-effective PDF metric per format slot (Responses PDF aggregate check, Sections 7.3 and 8.4) |
| `imageRows`, `thinkingRows`, `callRows`, `reconRows`, `pairSensitiveRows`, `imageContribRows` | 24 | sum | counts (`reconRows` counts rows with `reconBlocks > 0`; `pairSensitiveRows` counts the entries with the derived `pairSensitive` flag, Section 7.3; `imageContribRows` counts the entries with the derived `imageContrib` flag: any image in the entry's emitted contribution, Section 8.5; `imageRows` counts source rows with images) |
| `callBlocks`, `unmappedBlocks` | 8 | sum | eligible call blocks (id and name both non-empty, any speaker, reconstructed blocks included) in unit order and conversion-time counter uses, for Kimi ids (Section 7.2) |
| `lastThinking`, `lastInvalidate`, `lastCacheable` | 24 | max label, 0 = none | facts the builders need from "the whole history" |
| `firstAnchor`, `firstImage` | 16 | min label, 0 = none | Anthropic cache placement (Section 7.4) |
| `ownerBloom` | 8 | or | 64-bit filter of owner ids present |
| `missingBase[3]`, `missingImg[3]` | 24 | sum | per format slot: rows without a budget-independent summary, and entries with `imageContrib` without a valid image-dependent part (Section 8.5) |
| `stamp[3]` | 24 | equal | per format slot, the `{gen, imageGen}` pair (two `u32`) the node was computed for (Section 8.5) |

**Empty label fields.** Labels are 1-based (Section 2.6), so a label field with value 0 means that no row qualifies. This holds for the max-label fields (`lastThinking`, `lastInvalidate`, `lastCacheable`) and the min-label fields (`firstAnchor`, `firstImage`). Composition treats 0 as the identity: the max of 0 and `x` is `x`, and a min skips an operand that is 0, so the min of 0 and `x` is `x` and the min of 0 and 0 is 0. A composition that used 0 as an ordinary minimum would report no anchor for every range that contains an empty child. The empty aggregate (no rows) is all zero bytes. The codec stores the value it is given, and the composition helpers of phase 2 implement the rule above and are tested against it. A node whose range holds no qualifying row therefore stores 0 and never a sentinel like `2^64-1`.

The plain fields add up to 252 bytes, and 4 reserved zero bytes bring the part to 256. (`lastCall` of the earlier draft is gone: on a pin the Responses dangling set is empty, 7.3. `pairSensitiveRows` is new.)

**Transfer summaries.** Each format slot holds a `SlotSummary` of 296 bytes (Sections 7.2, 7.3, 7.4 and 8.2). It holds two variants, each a table over the boundary states of the format, plus side tables for Anthropic. The variant dimension is thinking present or absent for Anthropic and chat, and reasoning items present or absent for Responses (8.2). A variant with `K` states stores, in this order:

| Part | Anthropic, K = 10 | Chat, K = 6 | Responses, K = 2 |
|------|-------------------|-------------|------------------|
| `bytes[K]`, `u64` each: bytes written from this incoming state | 80 | 48 | 16 |
| `count[K]`, `u32` each: Anthropic run openings (wire messages, so also items), chat messages, Responses items | 40 | 24 | 8 |
| `out[K]`, `u8` each: outgoing state | 10 | 6 | 2 |
| `p[K]`, `u64` each, and `carry`, a `u8` bit mask: the P offset and 0/1 coefficient | none | 49 | none |
| `r`, `u32`: reasoning items without a genuine `rs` id (additive) | none | none | 4 |
| One variant, padded to 8 | 136 | 128 | 32 |
| Two variants | 272 | 256 | 64 |
| `cOut[2]` (`u8`, padded to 8) and `lastL[2]` (`u64` labels) | 24 | none | none |
| Slot summary | 296 | 256, in a 296 slot | 64, in a 296 slot |

A slot is not tied to a provider (Section 8.5), and the bytes do not say which layout they use. The slot table does: format slot `i` records the `summaryKind` of the summaries in `summaries[i]` of every aggregate (2.7), so a reader decodes `summaries[i]` with `slots.formatSlots[i].summaryKind` and needs nothing from outside the trailer. The kind is written when a base key is assigned to the slot and changes only with it, in the same group that raises `gen`; a slot that has never been assigned has kind 0 and all-zero summaries. Each slot is sized for the largest summary and a smaller format leaves the tail zero. Responses needs 64 of the 296 bytes. The aggregate stays at 256 + 3 * 296 = 1,144 bytes, because Anthropic needs the full slot and a per-format slot size would make the node layout depend on the active keys. The Responses PDF metric is not in the summary: `pdfBytes[P]` in the plain part already carries it.

The plain fields are monoids under concatenation of row ranges. Transfer summaries compose as functions, which is associative with an identity, so they give the same guarantee. That is the rule that keeps the header correct under every mutation: a prefix or range total is derived from the tree in `O(depth)` preads by combining nodes, never by remembering a previous value and never by subtracting one.

Slot counts, state counts and the field list are frozen for format version 3. They set the size of every node, so they are not tunable at run time. Changing one is a format bump, which costs nothing because old journals are not resumed (2.1).

**Open replace transaction.** The earlier request listed it as a header field. It is not carried. A replacement is a commit group, and a group is visible only through its trailer, so "a transaction is open" cannot be a durable state. Uncommitted records after the last trailer are invisible to every reader and are skipped or removed by the next writer (4.1, 4.12). A multi-step replacement committed in pieces is not designed and is not needed: a crash discards an incomplete replacement and leaves the previous version complete, which is the right result, and memory stays bounded because rows stream into the writer and the id trie is built in batches (4.5).

### 2.6 Labels

A label is a 64-bit order key assigned to a row when it is written. Live rows are ordered by label, and a label is never reused (the trailer's `nextLabel` only grows). Labels are 1-based: no row has label 0, so 0 is free to mean "none" in the aggregate fields of Section 2.5.

- Append: `label = nextLabel; nextLabel += 2^20`.
- Insert between two live rows (`synthetic_insert`): the midpoint. If there is no midpoint, the mutation relabels the affected run inside the same group (it is a rebuild, Section 4.6).
- Compression puts the summary below the first retained row: `label = firstRetained - 1`, or `nextLabel` when nothing is retained.

Labels replace three things the JSONL design used: positions in the row directory (which shift on every prefix drop), chronology markers as cut points (defect #2), and the `seq` of the envelope. Chronology fields stay on the row (they are data), and `chronologySeq` keeps its existing meaning for the UI. It is no longer an address.

### 2.7 Normative codes and field widths

The tables below are the format. The prose of Sections 2.1 to 2.6 explains them, and where a number differs the tables win. The journal library (`packages/core/src/journal/`) holds the same values as constants, and `formatTables.test.ts` reads these tables from this file and fails when a constant differs. All integers are little-endian, offsets are bytes from the start of the structure, and fields are packed in the order listed. A `Type` that is `uN` or `uN[k]` must have a size of `N / 8 * k`, which the test also checks; a `u56` is 7 bytes.

#### Frame head

| Field | Offset | Size | Type |
|-------|--------|------|------|
| kind | 0 | 1 | u8 |
| frameFlags | 1 | 1 | u8 |
| reserved | 2 | 2 | u16 |
| headerLen | 4 | 4 | u32 |
| bodyLen | 8 | 8 | u64 |
| frameCrc | 16 | 4 | u32 |

The head is 20 bytes. `frameCrc` covers bytes 0 to 15 and the kind header. `reserved` is zero.

#### Frame flag bits

| Bit | Name |
|-----|------|
| 0 | body present |

Every other bit is zero.

#### Record kinds

| Code | Name |
|------|------|
| 1 | ROW |
| 2 | RTNODE |
| 3 | ITNODE |
| 4 | LENS |
| 5 | VALUE |
| 6 | EVENT |
| 127 | TRAILER |

#### ROW fixed part

| Field | Offset | Size | Type |
|-------|--------|------|------|
| label | 0 | 8 | u64 |
| owner | 8 | 4 | u32 |
| speaker | 12 | 1 | u8 |
| reserved | 13 | 1 | u8 |
| flags | 14 | 2 | u16 |
| blockCount | 16 | 4 | u32 |
| idCount | 20 | 4 | u32 |
| idsLen | 24 | 4 | u32 |
| metaLen | 28 | 4 | u32 |
| chronologySeq | 32 | 8 | u64 |
| chronologyUserTurn | 40 | 4 | u32 |
| chronologyStep | 44 | 4 | u32 |
| chronologyRecordedAt | 48 | 8 | u64 |
| parentEndpoint | 56 | 8 | u64 |

The fixed part is 64 bytes. `reserved` is zero.

#### ROW block directory entry

| Field | Offset | Size | Type |
|-------|--------|------|------|
| offset | 0 | 8 | u64 |
| length | 8 | 8 | u64 |
| type | 16 | 1 | u8 |

An entry is 17 bytes. `type` is an opaque `u8` until the block types are fixed in phase 2.

#### ROW id tuple

| Field | Offset | Size | Type |
|-------|--------|------|------|
| idHash | 0 | 16 | u8[16] |
| kind | 16 | 1 | u8 |
| block | 17 | 4 | u32 |
| score | 21 | 1 | u8 |
| nameLen | 22 | 4 | u32 |

A tuple is 26 bytes.

#### ROW speaker codes

| Code | Name |
|------|------|
| 0 | human |
| 1 | ai |
| 2 | tool |

#### ROW id kind codes

| Code | Name |
|------|------|
| 0 | call |
| 1 | response |

#### ROW flag bits

| Bit | Name |
|-----|------|
| 0 | curated |
| 1 | hasThinking |
| 2 | hasToolCall |
| 3 | hasToolResponse |
| 4 | hasMedia |
| 5 | hasImage |
| 6 | hasCacheableBlock |
| 7 | cacheAnchor |
| 8 | synthetic |
| 9 | invalidateResponses |
| 10 | responseParent |

Bits 11 to 15 are zero.

#### Trailer kind header

| Field | Offset | Size | Type |
|-------|--------|------|------|
| selfOffset | 0 | 8 | u64 |
| commitSeq | 8 | 8 | u64 |
| parent | 16 | 8 | u64 |
| skip | 24 | 24 | u64[3] |
| lineage | 48 | 8 | u64 |
| lineageDepth | 56 | 8 | u64 |
| mutation | 64 | 1 | u8 |
| groupTag | 65 | 7 | u56 |
| mutationArg0 | 72 | 8 | u64 |
| mutationArg1 | 80 | 8 | u64 |
| rowRoot | 88 | 8 | u64 |
| idRoot | 96 | 8 | u64 |
| metaRoot | 104 | 8 | u64 |
| stateRoot | 112 | 8 | u64 |
| nextLabel | 120 | 8 | u64 |
| firstLabel | 128 | 8 | u64 |
| lastRowOffset | 136 | 8 | u64 |
| lastOwner | 144 | 4 | u32 |
| padding | 148 | 4 | u8[4] |
| ckptBytes | 152 | 8 | u64 |
| rootAggregate | 160 | 1144 | Aggregate |
| slots | 1304 | 160 | SlotTable |
| durableEnd | 1464 | 8 | u64 |
| syncMarker | 1472 | 8 | u8[8] |

The kind header is 1,480 bytes and the trailer record 1,504. `padding` is zero. `mutation` and `groupTag` share the `u64` at offset 64: the low byte is `mutation`.

#### Mutation codes

| Code | Name |
|------|------|
| 1 | append |
| 2 | pop |
| 3 | compress |
| 4 | replace |
| 5 | density |
| 6 | purge |
| 7 | clear |
| 8 | insert |
| 9 | owner |
| 10 | fill |
| 11 | state |
| 12 | clone |
| 13 | restore |

Code 0 is invalid.

#### Aggregate

| Field | Offset | Size | Type |
|-------|--------|------|------|
| rows | 0 | 4 | u32 |
| curated | 4 | 4 | u32 |
| units | 8 | 4 | u32 |
| tokens | 12 | 32 | u64[4] |
| tokensMissing | 44 | 16 | u32[4] |
| liveBytes | 60 | 8 | u64 |
| mediaChars | 68 | 8 | u64 |
| imageChars | 76 | 24 | u64[3] |
| pdfBytes | 100 | 24 | u64[3] |
| imageRows | 124 | 4 | u32 |
| thinkingRows | 128 | 4 | u32 |
| callRows | 132 | 4 | u32 |
| reconRows | 136 | 4 | u32 |
| pairSensitiveRows | 140 | 4 | u32 |
| imageContribRows | 144 | 4 | u32 |
| callBlocks | 148 | 4 | u32 |
| unmappedBlocks | 152 | 4 | u32 |
| lastThinking | 156 | 8 | u64 |
| lastInvalidate | 164 | 8 | u64 |
| lastCacheable | 172 | 8 | u64 |
| firstAnchor | 180 | 8 | u64 |
| firstImage | 188 | 8 | u64 |
| ownerBloom | 196 | 8 | u64 |
| missingBase | 204 | 12 | u32[3] |
| missingImg | 216 | 12 | u32[3] |
| stamp | 228 | 24 | u32[6] |
| reserved | 252 | 4 | u8[4] |
| summaries | 256 | 888 | u8[888] |

Counts are `u32`. Token, byte and character totals are `u64`. The five label fields are `u64` labels, 0 meaning none (Section 2.5). `ownerBloom` is a `u64` bit set. `stamp` is three `{gen, imageGen}` pairs of `u32`. `reserved` is zero. Nothing is padded for alignment.

#### Format slot

| Field | Offset | Size | Type |
|-------|--------|------|------|
| formatKeyHash | 0 | 8 | u64 |
| formatRev | 8 | 4 | u32 |
| gen | 12 | 4 | u32 |
| imageKeyHash | 16 | 8 | u64 |
| imageGen | 24 | 4 | u32 |
| summaryKind | 28 | 1 | u8 |
| pad | 29 | 3 | u8[3] |

A format slot is 32 bytes. `pad` is zero.

#### Family slot

| Field | Offset | Size | Type |
|-------|--------|------|------|
| familyKeyHash | 0 | 8 | u64 |
| estimatorRev | 8 | 4 | u32 |
| gen | 12 | 4 | u32 |

A family slot is 16 bytes. The slot table is three format slots followed by four family slots, 160 bytes.

#### Summary kind codes

| Code | Name |
|------|------|
| 0 | unassigned |
| 1 | anthropic |
| 2 | chat |
| 3 | responses |

#### Slot summary layout

| Kind | States | Variant size | Variant offsets | bytes | count | out | p | carry | r | cOut | lastL |
|------|--------|--------------|-----------------|-------|-------|-----|---|-------|---|------|-------|
| anthropic | 10 | 136 | 0, 136 | 0 | 80 | 120 | - | - | - | 272 | 280 |
| chat | 6 | 128 | 0, 128 | 0 | 48 | 72 | 78 | 126 | - | - | - |
| responses | 2 | 32 | 0, 32 | 0 | 16 | 24 | - | - | 26 | - | - |

`bytes`, `count`, `out`, `p`, `carry` and `r` are offsets inside a variant. `cOut` and `lastL` are offsets inside the slot summary. The element widths are in Section 2.5: `bytes` and `p` are `u64` per state, `count` is `u32` per state, `out` is `u8` per state, `carry` is a `u8` bit mask, `r` is a `u32`, `cOut` is two `u8` and `lastL` two `u64`. Bytes not covered are zero.

## 3. Indexes inside the journal

Four persistent structures live in the file: the row tree, the id trie, the versioned meta map and the state map (the last three are tries over the same node kind). All four are copy-on-write. A node is written once and never changed. A mutation writes the nodes on the changed paths, plus a new trailer that names the new roots. Old versions stay readable because their nodes are still in the file, and the new version shares every untouched subtree with them. That is how rewind, compression, replace, purge and density create a new version "pointing back at shared structure" without touching old bytes.

### 3.1 Finding the current root: the last trailer

A trailer record has a fixed size of 1,504 bytes (a 20-byte frame head, a 1,480-byte kind header whose last 8 bytes are the file's `syncMarker`, no body, and the 4-byte body CRC). A trailer record therefore ends with `syncMarker` followed by the 4-byte CRC. To open a journal a reader does this:

1. `pread` the last 64 KiB of the file (one call; the file is at least that long, or the whole file is read).
2. Search backwards for `syncMarker`. For each hit, the record end is the hit plus 12 bytes and the record start is the end minus 1,504. A hit whose record start would fall before the window is read directly with one `pread` of the 1,504 bytes.
3. Accept the first structurally valid trailer: the record fits in the file, its kind is `TRAILER`, its `frameCrc` is valid, its `selfOffset` equals its start and it ends with `syncMarker`. A candidate that fails any of these is a torn tail or a quoted marker and sends the search on to the next hit. This is the only case in which an older trailer is used.
   The trailer is the commit point and is written only after its group's records are flushed (4.1), so a structurally valid trailer has its roots on disk. Read the roots back, `rowRoot`, `idRoot`, `metaRoot` and `stateRoot`, each when non-zero, which is four `pread`s with CRC checks. A root that is missing, past the end of the file or fails its CRC is corruption, because the trailer that names it is intact. Open throws `JournalCorruptionError` with the file, the root's name and offset, and the trailer's offset. It does not step back to an older trailer, which would drop a committed version without a word, and the owner truncates nothing. The same trailer is the current state when the roots read cleanly.
4. If no candidate is found in the window, step back through the file in 4 MiB chunks that overlap by 12 bytes, up to the whole file. This happens only after a crash that left a long uncommitted tail, such as a half-written large row. Each byte is read at most once, so a half-written 200 MiB row costs one 200 MiB sequential read, once, because the next owner removes or skips the tail (4.12).

Typical cost: one `pread` for the window and four for the roots. A candidate inside a row body (a row that quotes the marker) fails the CRC or `selfOffset` test and the search continues. Bytes after the accepted trailer are an uncommitted tail. A read-only opener ignores them. The writer that owns the session lock (`SessionLockManager.ts`) tries to truncate the tail before its first append and otherwise appends after it (4.12).

A damaged node found below the roots, when a read needs it later, is corruption under the same rule (2.2). The error names the file and the offset. It is not skipped and not repaired.

A live writer keeps its last acked trailer in memory and never searches.

### 3.2 The row tree

The row tree is an order-statistic B+tree over live rows, keyed by label. Leaves hold up to 8 entries and internal nodes up to 8 children. An internal child slot holds `{childOffset, maxLabel, count, Aggregate}` (8 + 8 + 4 + 1,144 bytes, padded to 1,168), so every subtree knows its row count and its range aggregate (Section 2.5). Node records are `RTNODE`. The arity is 8 because the `Aggregate` in every child slot dominates the node size, so a smaller fan-out writes fewer bytes per path copy, at the price of more levels. The transfer summaries made the aggregate 1,144 bytes where the scalar layout needed 296, which moves the optimum toward a smaller arity. Arity 4 would write about 25 percent fewer bytes per path copy at 100k rows (about 41.9 KB against 55.8 KB, with 7 internal levels instead of 5). Phase 2 measures both before the layout is frozen, and the write budget test (13.6) decides.

A leaf entry is the row's index entry, 1,104 bytes at format version 3:

| Field | Size | Mutable by copy-on-write? | Content |
|-------|------|---------------------------|---------|
| `label`, `recordOffset`, `recordLength` | 24 | no | identity and location of the `ROW` record |
| `speaker`, `flags`, `reconBlocks`, `answered` | 7 (pad 8) | `answered`, `pairSensitive`, `imageContrib`: yes | `speaker` and `flags` are copied from the row header, plus the derived bits `pairSensitive` (Section 7.3) and `imageContrib` (Section 8.5). `reconBlocks`: how many reconstructed call blocks precede this row (Section 6.2, R1), fixed when the row is written. `answered`: for any row that carries call blocks, whatever its speaker (R4), how many of its call ids have a slot, a real response or an orphan (`R(X)` absent and `Ca(X)` exists, R4); drives whether the adjacent unit exists. The derived bits are recomputed in the same step as `answered`. |
| `chronologySeq`, `chronologyUserTurn`, `chronologyStep`, `chronologyRecordedAt` | 24 | no | copied from the row header; `invalidateResponses` is in `flags` |
| `owner`, `callBlocks`, `unmappedBlocks` | 4 + 2 + 2 | yes | current owner id (Section 5). The two `u16` are the row's share of the Kimi aggregate fields (Section 7.2), recomputed with the summary; a row whose count exceeds 65,535 is refused at append. |
| `lensRef[3]` | 24 | yes | offset of the `LENS` record for each format slot |
| `summary[3]` | 888 | yes (`fill`, and when a response arrives) | per format slot, the transfer summary of everything the row contributes to the unit stream: its reconstructed units, its stripped self unit and its adjacent response unit, composed in emission order (Section 8.2). A `SlotSummary` of 296 bytes (Section 2.5). |
| `media` | 56 | yes | the row's contribution to `mediaChars`, `imageChars[3]` and `pdfBytes[3]` (Section 8.4) |
| `tokens` | 48 | yes | per vector (stripped self, reconstructed, adjacent response) and tokenizer slot a `u32` token count, 4 slots, 3 vectors |
| `stamp[3]` | 24 | yes | per format slot, the `{gen, imageGen}` the summary and media numbers were computed for (Section 8.5) |

Node sizes follow: a leaf is 8 * 1,104 + 16 = 8,848 bytes of body (8,872 with the 20-byte frame head and 4-byte body CRC), an internal node is 8 * 1,168 + 16 = 9,360 bytes (9,384 with the frame).

Cost model:
- Ordinal to entry, label to entry, and prefix or range aggregate: `O(depth)` preads. Depth is `1 + ceil(log8(rows / 8))`: 4 for 1k rows, 6 for 100k rows, 7 for 1M rows and 14 for 2^40 rows. The right spine is kept by the writer, so an append reads nothing.
- Sequential scan: an iterator holds the path of nodes from the root to the current leaf (`depth` nodes, at most about 128 KiB at depth 14, and 64 KiB at 1M rows) and advances leaf by leaf. There are no sibling pointers because nodes are immutable; the parent stack is the cursor.
- A path copy writes one leaf and one node per internal level: 37.0 KB at 1k rows (8,872 + 3 * 9,384), 55.8 KB at 100k rows (8,872 + 5 * 9,384) and 65.2 KB at 1M rows (8,872 + 6 * 9,384). The scalar layout wrote 11 KB, 16.2 KB and 18.8 KB. A group with one appended row and one id adds the row (about 1 KB), about 6 KB of trie nodes for that id (the namespace 0 fact, its namespace 4 occurrence entry, and the count and occurrence entries of namespaces 1 and 2, each about 1 KB, 3.3) and the 1,504-byte trailer, so it writes about 64 KB at 100k rows; each further id in the row adds about 6 KB. A group whose edits touch a second leaf, such as a response that arrives for an earlier call row, writes a second path, about 120 KB. The write budget test (13.6) fixes limits of 72 KiB and 128 KiB for those two cases with one id per row. Edits that queue during a write share one group (4.1), and compaction (4.11) removes the superseded paths.
- A bulk build (replace, rebuild after compression) fills nodes bottom-up from a stream of entries holding one in-progress node per level, so it needs memory proportional to the depth.

### 3.3 The id trie

The id trie is a persistent hash array mapped trie. The lookup key is the first 128 bits of `SHA-256(namespace byte, key bytes)`, where the key bytes are the id string for an id fact. Each level consumes 4 bits, an internal node is `{u16 bitmap, children[popcount]}` (at most 16 child offsets), and a leaf node holds up to 8 facts. Node records are `ITNODE`. Equal 128-bit hashes are treated as the same key.

The hash is unkeyed on purpose. SHA-256 is collision resistant, so a model or a tool that emits ids cannot craft two ids with equal 128-bit prefixes without about 2^64 work, and the accidental collision probability at 10^6 ids is about 10^-27. A keyed hash would add nothing against that and would make ids hash differently per file, which breaks the byte-for-byte copy of `ROW` records in a clone (4.8) and in compaction (4.11). `node:crypto` `createHash('sha256')` is available in Bun (listed by `getHashes()`), and 1,000,000 short ids hashed in about 0.7 seconds on this machine, so the cost is under a microsecond per id.

Cost model: lookup is `1 + ceil(log16(ids / 8))` preads: 5 for 100k ids, 6 for 1M. The reader and the writer keep a fixed-capacity node cache (256 nodes, about 64 KiB, which holds the top three levels), so a lookup usually costs 2 to 3 preads. The cache holds only nodes below the published `durableEnd`, which are immutable, so nothing in it can go stale. A path-copy insert writes one node per level, about 100 to 200 bytes each, so about 1 KiB per changed id.

Namespaces:

| ns | Key hashed | Fact |
|----|------------|------|
| 0 | the exact id (`block.id` or `block.callId`) | `IdFact` below. Used by the normalizer, OpenAI chat (Kimi and Mistral included) and the Responses parent rules. |
| 1 | `normalizeToOpenAIToolId(rawId)` and a kind, `call` or `resp` | Responses pair facts. `call`: positions of tool_call blocks in AI-speaker units. `resp`: positions of tool_response blocks in tool-speaker units. Layout below. |
| 2 | `normalizeToAnthropicToolId(rawId)` and a kind, `use` or `res` | Anthropic facts. `use`: tool_use occurrences in assistant messages (AI-speaker units). `res`: tool_result occurrences in every unit the assembler admits, whatever its speaker: all non-tool units (a human row with tool responses is a result source, `wire-builder.ts:312-320`) and tool units after the first non-tool unit. Layout below. |
| 3 | a format slot byte and a mapped id (Mistral) | `{rawIdHash}`; the used-set of the id mapper. Not used for Kimi (7.2). |
| 4 | the exact id, the kind (call or response) and an occurrence ordinal `k` | `{label, part, block, eligible, ai}` of the `k`-th occurrence in position order. `eligible`: a call block with a non-empty id and name. `ai`: the unit is AI-speaker. |
| 5 | an ordinal `k` | `{idHash}` of the `k`-th Kimi exception id (7.2). |
| 6 | an old record offset | compaction only: the new offset of a record already copied for an earlier version (4.8, 4.11). |

The two normalizers are many-to-one (`call_x`, `toolu_x` and `hist_tool_x` collapse; the empty id normalizes to `call_` for OpenAI and `toolu_empty` for Anthropic). A fact keyed by the raw id cannot answer a question about the normalized id, so namespaces 1 and 2 are written and are keyed by the normalized form. They replace the earlier "reserved, not written" counters and the empty-id omission rule: `''` is an ordinary key in these namespaces. Prototype evidence (`idfacts.ts`): for one AI unit with call ids `''` and `'call_'` the Responses body is 263 bytes today and 263 with the fact model, and 181 with the omission rule (counts: `call_` has 2 calls and 1 response); on 800 raw Anthropic histories (2,720 tool results over 14 id shapes) the fact decisions are wrong in 0 and a raw-id lookup is wrong in 627.

Layout of namespaces 1 and 2. For a normalized id `n` and kind `x`, the entry `(n, x, 0)` holds the count `m` and the entries `(n, x, k)`, `k = 1..m`, hold the unit position of the `k`-th occurrence in unit order. A unit position is `(label, part, u)`, where `u` is the unit's index among the units that part emits (reconstructed unit, its adjacent unit, stripped self, adjacent of its calls). Reconstructed call blocks (R1) are AI-speaker occurrences at the position of their reconstructed unit. A question over a unit range `[a, b)` is answered from the last occurrence: it exists in the range iff the entry `k = m` has a position `>= a` (and below `b`, which is the end of the stream for a send). Anthropic's `repairAdjacency` successor query ("the first `res` after position P") is a binary search over `k`. Both namespaces are maintained on every append, whatever format is active, because a pop restores `idRoot` and a root without them would make a later fill indistinguishable from a complete one.

**Anthropic `repairAdjacency` consumption (not modeled in the prototype).** The unit of consumption is the conversion message, not the call (`validation.ts:120-126,148-161,179-185`). For an assistant message M whose next message N is a user message, the walk gathers every tool use of M whose id has no result in N, in call order, and only then removes sources. Calls of one id inside M therefore share the earliest available later result: each call gets a copy, and the shared source block is removed once. The earliest available later result is the first `res` occurrence of the converted id in an original message after N that no earlier assistant message took. The control `followup-source-controls.out:1` (two calls of X in one assistant message, later results ONE and TWO) writes ONE, ONE, TWO today; a pointer advanced per call would write ONE, TWO. Later assistant messages see the moved results: a taken block has left its source and sits at the front of its N, so it is not a candidate again. One pointer per id covers this, `pick = first res occurrence of n after max(N, q_n)` and then `q_n = pick`, advanced once per message and not once per call, because each message's bound N does not decrease along the walk. The product keeps no pointer map. The walk derives `q_n` by replaying the earlier assistant messages that use n over the `use` and `res` occurrence lists of that id, a cursor over entries of one id. This replay is needed only for an id whose uses span two or more assistant messages (none in sessions this CLI recorded, because `canonicalToolIds.ts` makes history ids unique per call, Section 0), so memory stays constant. Message boundaries come from the conversion-group scan (7.4 step 2): results of consecutive tool units share the open results message, so two such occurrences are in one message. Namespace 2 includes human-row results so that raw-history parity (13.1) holds: the facts are the same for raw and normalized rows, and the normalized-pin path simply never produces such a row. Phase 0 and 6c compare the walk with the current table on raw histories that put results in human rows and on the duplicate-id controls (13.6, 14.3).

`IdFact` (about 96 bytes), for a raw id X, the empty id included:

| Field | Meaning |
|-------|---------|
| `C` | the first position of a call block with id X in the live curated rows and the tail, any speaker: `{label, part, block}` or none. `part` is 0 for the calls part of a row and 1 for the remainder of a tool row that carried calls (the row is split, Section 6.1). |
| `Ca` | the first position of a call block with id X in an AI-speaker part, or none. R3 orphans a call at `Ca(X)`, not at `C(X)` (6.2). |
| `R` | the first response block with callId X in any live curated row: `{label, part, block}` or none. |
| `Rt` | the first response block with callId X in a tool-speaker row, or none. Stage 1 reconstructs calls only from tool rows. |
| `best`, `bestScore` | the response block with the highest score; the earliest wins a tie. This is the current `assignResponse` rule (`provider-curated-stream.ts`). |
| `callCount`, `respCount` | occurrence counts, `u32`, over the unit stream (reconstructed call blocks included). They are also the highest occurrence ordinal of each kind. |
| `Ke` | Kimi: the last eligible occurrence, `{label, part, block}` with its name length, or none (7.2). |
| `aiWire`, `unnamed`, `nonAiElig` | Kimi counters, `u32` each: call blocks in AI-speaker units, call blocks with no name, eligible call blocks in non-AI units (7.2). |
| `mappedRef` | offset of a `VALUE` record with the mapped ids per format slot (Mistral), or 0 |

**Occurrences.** The `k`-th call occurrence of X is the namespace 4 entry with key `(X, call, k)`, and likewise for responses. Positions grow with `k`, so "the last call block of X" is the entry `k = callCount`. These entries are part of the trie, so they are restored by a pop and rebuilt by a rebuild. An earlier draft stored a `prevOcc` link inside each immutable `ROW`. After compression, density or purge such a link points at a row that is gone or at a row that is no longer the previous occurrence, so the chain is a property of a version and lives in the version's trie.

The empty id `''` is an ordinary id for the continuity and orphan rules (the current code keys `seen:`/`responded:` with it) and is never a call target (the current `call:` index ignores it, so such a response is dropped). It is not a response key either: `R` counts responses with a truthy callId. The fact for `''` is stored like any other and the rules in Section 6 exclude it where the current code does.

How a fact is maintained: when a `ROW` is appended, each of its id tuples updates the fact (set `C`, `Ca`, `R` or `Rt` when absent, replace `best` when the score is strictly higher, bump the count, write the occurrence entry, and update the namespace 1 and 2 entries of the normalized ids). The first response for an id whose call row exists also does a copy-on-write update of that call row's entry (`answered`, `pairSensitive`, `A`), whatever the call row's speaker. The same update happens when a later AI call first sets `Ca(X)` for an id with `R(X)` absent and an earlier `C(X)`: the orphan is created at `Ca(X)` and attached to the row at `T(X)`, so that row's `answered`, `pairSensitive`, `A` and summary are replaced in the group that appends the AI call (the cross-speaker control of R4). This is one extra leaf path, and in the common case the call row and its response are in the same or adjacent leaf, so the group's path copies merge.

Why facts never need an undo: a fact can be wrong only for a version it does not belong to. Pop restores the trie root of an earlier version; every other mutation that removes or replaces rows rebuilds the trie from the row headers (Section 4). Nothing decrements a counter or recomputes a minimum.

### 3.4 What normalization and the builders need, and where it lives

| Dependence on rows far away | Source today | Stored as |
|-----------------------------|--------------|-----------|
| "Has call X been seen before this row" (continuity) | `seen:` | `C(X)`, `R(X)` compared with the row position |
| "Has X got a response anywhere" (orphan completion) | `responded:` over the whole stream and the tail | `R(X)` present, plus the tail overlay (Section 6.6) |
| "Which row is the call target of X" | `call:` | derived from `C(X)` (any speaker) and `Rt(X)` (Section 6.2) |
| "Is this the first AI-speaker holder of call X" (orphan completion) | `appendMissingResponses` | `Ca(X)` (Section 6.2, R3) |
| "Does the normalized id have a call or a response in the sent range" (Responses pair tests) | `ToolPairIndex` | namespace 1 occurrence lists (Sections 3.3 and 7.3) |
| "Does a tool use exist for this converted id, which result follows a position" (Anthropic `filterOrphans`, `repairAdjacency`) | `tool-id-index.ts` | namespace 2 occurrence lists (Sections 3.3 and 7.4) |
| "Best response for X" | `response:`, `slot:`, scores | `best(X)` |
| "Slot order of the responses of one call row" | `responses:`, `slot:` | sort of the call row's ids by `R(X)` (Section 6.3) |
| Last thinking row, any tool call exists (chat) | `observeRows` | `lastThinking`, `callRows` aggregates |
| Last group with thinking (Anthropic `allButLast`) | `wire-builder.ts` pass 1 | `lastL` in the Anthropic slot summary, plus a forward cursor over the chain (Section 7.4) |
| First anchored message, oldest image, last cacheable block before an image | `cache-controls.ts` scans | `firstAnchor`, `firstImage`, and a range maximum of `lastCacheable` (Section 7.4). The purge tag is a request overlay and has no stored form (7.4). |
| Unanswered calls of a journal history (Responses synthetic cancel outputs) | `findDanglingCalls` | nothing: the set is empty on the unit stream (7.3) |
| Mapped tool ids and the used-set (Mistral) | `KeyedRowToolIdStore` | namespace 3 facts and the id piece of each `ROW`, which a rebuild reads (7.2) |
| Kimi ids | `KeyedRowToolIdStore` | `Ke`, the Kimi counters of `IdFact`, the exception list (namespace 5) and the `callBlocks` aggregate (7.2) |
| Responses parent for `previous_response_id` | parent scan | versioned meta map lists `parent:<endpointHash>:<k>` (Section 3.5) |
| Parents the backend refused | `rejectedStatefulParents` Set | the provider instance's on-disk rejection table, outside every journal (Section 3.5) |

### 3.5 The meta map and the state map

Everything that is not a row lives in one of two persistent tries over `VALUE` records. They are separate because a pop treats them differently (4.3).

**The versioned meta map** (`metaRoot`) holds facts that are properties of a row set. It is restored with the roots by a pop and recomputed by a rebuild. Its keys are:
- `parent:<endpointHash>:<k>`: the label of the `k`-th usable Responses parent row of one endpoint class, in label order, and `parent:<endpointHash>:count`. There are two kinds of list. `parent:0:*` is the wildcard list: rows whose recorded endpoint is absent or empty, which `isSameEndpoint` accepts for every request URL. `parent:<hash>:*` holds the rows whose recorded URL, after stripping trailing slashes, hashes to `<hash>`. A row joins a list when its header has the `responseParent` flag (an AI row with a stored response id and a self unit, 2.4), and `parentEndpoint` selects the list. Hashing the exact recorded URL, or admitting only rows with a known endpoint, picks a different parent than today in 374 of 1,200 prototype histories per run. The selection (`selectRowsStateful`, `isEligibleParent`) becomes: take the tail of the wildcard list and of the list for the stripped request URL, step each down while its candidate is rejected (a lookup in the provider instance's rejection table, below), and keep the candidate with the larger label. The prototype needed at most 6 rejection lookups, which is the number of rejected candidates plus 2. The chosen row's metadata piece gives its response id and observed usage. `selectStatefulParent` is then applied unchanged in unit terms: when the cursor (7.3) is at or past the unit count there is no content after the parent and the send is full history with no parent (61 of 1,200 prototype histories per run hit this). `lastInvalidate` in the aggregate gives the `invalidateResponses` cut: a candidate with a label below it is not usable. Because the entries belong to a version, a parent from a closed version cannot be returned (defect #6). An earlier draft put a `prevParent` link in each immutable `ROW`, which a compression would leave pointing at rows that are gone.
- `kimi:exc`: the length of the Kimi exception-id list (namespace 5, 7.2).

**The unversioned state map** (`stateRoot`) holds what survives every pop and restore: session title and name, `firstUserMessage` (the preview string that session pickers show today, written in the same group as the first user row, with the truncation `firstUserMessageScan.ts` applies now), start metadata (`session_start` fields: provider, model, workspace dirs, `kind`, `parentSessionId`), the owner dictionary (id to origin string, replacing `rowOriginDictionary.ts`), checkpoint descriptors (4.9), fork metadata, `mirror:primary` (5.2) and the deferred blob releases `rel:head`, `rel:tail` and `rel:<k>` (10.1). Owner ids are never reused, so a row that survives a pop never refers to a missing dictionary entry. Rejected parents are not in the state map (below). A pop takes the roots of an ancestor but the current `stateRoot`, so a checkpoint made after the ancestor, a rename, and new owner dictionary entries are kept.

All meta and state values are written in the same commit group as the mutation that changes them, so metadata and rows cannot disagree after a crash.

**Rejected parents** (finding 4). The current behavior, read from the code, is this. A response id enters `rejectedStatefulParents` (`OpenAIResponsesProviderCore.ts:72`) only in `retryWithoutStatefulness` (`openAIResponsesExecutor.ts:337`), when the stream throws a previous-response-not-found error before any content was yielded, and the id is the `previous_response_id` that the failed request actually sent. That happens at most once per turn. The only reader is the parent scan: `planStatefulConversation` builds `isUsableParent = isEligibleParent && !isRejectedParent(id)`, and `selectRowsStateful` (`responses-disk-text-projection.ts:91`) keeps the newest row that passes. The set is a private field of one provider instance, so its scope is that instance for as long as it lives. It is not keyed by connection or by session: a socket recycle does not touch it, and two sessions served by one instance share it. It is cleared only by `clearState()` (`OpenAIResponsesProviderCore.ts:161`), which runs when `ProviderManager.setActiveProvider` switches away from the provider and on OAuth logout. It grows by one id per rejection and keeps every id until then, so it is a history-sized set in a long session with many rejections.

The replacement keeps today's scope, the provider instance, and moves the membership to disk. It is not a journal fact. A set that belongs to the provider instance is visible to every session that instance serves, to two stores that hold the same parent id, and to a call with no journal at all (a `stream` or `rows` source). A fact in one journal's state map is visible to that journal only, and an epoch would tell instances apart without making separate state maps share membership. Only an instance-owned structure reproduces the Set.

- *Structure.* A `RejectedParentSet` owned by the provider instance: an open-addressing hash table in one file under the process scratch root (`getScratchRoot()`, so a killed process's file is swept by a later process). The file has a 64-byte header (magic, capacity, count) and `capacity` slots of 16 bytes. A slot holds the first 128 bits of `SHA-256(responseId)` (as in 3.3), and an all-zero slot is empty (a digest that is all zero is stored as 1). Capacity is a power of two, 1,024 slots at first. Probing is linear from the first 8 bytes of the key modulo capacity.
- *Lookup and insert.* A lookup reads one 4 KiB window (256 slots) around the home slot and scans to the key or the first empty slot, reading the next window only when a run crosses the window edge. At load factor 0.5 or less the expected probe run is about 2.5 slots, so a lookup is one `pread` in practice and a bounded number in the worst case, and memory is one window. An insert is a lookup plus one slot write. Operations of one instance run one at a time through an in-instance queue, because a rehash is several steps.
- *Overflow and rehash.* When `(count + 1) * 2 > capacity`, the insert first builds a new file of twice the capacity next to the old one: it streams the old file in 1 MiB chunks, writes each key into the new table, then switches the instance to the new descriptor and unlinks the old file. Memory is one chunk. Each insert pays amortized O(1) writes, and disk use is about 32 bytes per rejected id at load 0.5. Rejections happen at most once per turn, so this path is rare.
- *Lifetime.* The file is created lazily on the first rejection, so an instance that never sees one has no file, and the file is per provider instance, never per send. `clearState()` (which runs when `ProviderManager.setActiveProvider` switches away from the provider and on OAuth logout) and the provider's disposal close and unlink the file; the next rejection creates a fresh one. A process that dies leaves the file to the scratch sweep, and nothing reloads it, so a restart starts empty, as the Set does.
- *Visibility.* Every store and every non-journal call that sends through that instance reads the same table through `ResponsesExecutorDeps.isRejectedStatefulParent` and `markStatefulParentRejected`, which stay as the injection seam and are backed by the table. The journal, its state map, its clones and its compaction hold nothing about rejections, so a pop keeps the rejection exactly as the Set does, and no `epoch`, no `rej:` entry and no clone or compaction rule exists. `markStatefulParentRejected` returns a promise that resolves when the slot write returns, and `retryWithoutStatefulness` awaits it before `rebuildFromRows`. A failed write fails the turn; nothing falls back to a heap set.
- *Selection runs per send.* Parent selection is not part of a stored summary. Each send runs it from the pin's parent lists (above), the table and the cursor (7.3). A retry after a rejection therefore selects the next candidate even when the format key is unchanged (10.1).

Reading costs one lookup per probe of the parent scan, at most rejected candidates plus 2 probes (6 at most in the prototype), so O(1) preads each, and memory is O(1) whatever the number of rejections. A session resumed in a new process starts with an empty table, which means it spends the one rejected request that the comment at `openAIResponsesExecutor.ts:334` accepts, as today. The prototype (`pstate.ts`, `rstate.ts`) compares selection with the real provider's set: 1,200 histories per run, 562 of them with rejections, the selected parent matching in 2,400 of 2,400 sends over both settings. It models membership with one shared Set, so it supports the selection rule and does not exercise the table; the table is covered by the tests of 13.6.

## 4. Mutation semantics

### 4.1 Commit groups, the commit point, and derived state

**Commit group.** A commit group is zero or more `ROW`, `LENS`, `VALUE`, `EVENT`, `RTNODE` and `ITNODE` records followed by exactly one `TRAILER`. Each history mutation call is at most one group, and queued edits may share one (Turn, below). A group may contain several primitive edits (for example a pop followed by an append, which is how a self-merge is written); they apply in order to the writer's tentative state and become visible together.

**Turn.** Commit groups follow main's history-mutation calls, not the model request. Each call that main makes to the history is at most one commit group, so it costs one trailer, one set of path copies and one flush for each file it writes. The groups of a model request are these:
- The response is one group, written when the response is complete. It is main's `commitTurnHistory` `addBatch`, which passes the user entries and the model output together (`turnHistoryCommit.ts:138-152`), so the new user message and the model output are one group. A request that fails writes nothing, as 6.6 requires.
- Tool results that main persists eagerly are one group per main call, written at the same point in the send as on main. `ChatSession.recordCompletedToolCalls` (reached from `toolControl.ts:181` and `subagent.ts:713`) makes one call, so it is one group. The todo-pause path (`AgenticLoop.ts:736`, `recordCompletedToolHistory` in `loopHelpers.ts`) makes two calls, one for the tool-call rows and one for the tool-response rows, so it is two groups. These groups are not carried into the next response group.
- A context row that main writes before a request is one group per call: the IDE context from `_injectIdeContext` (`MessageStreamOrchestrator.ts`, written only when `getContextParts` returns parts) and the directory context from `client.addDirectoryContext` (`client.ts:778`).

Tool results that main does not persist eagerly stay pending input (Section 6.6) and go into the next response group, as they do on main. A typical request is therefore one to three groups: a plain response, a response followed by its eager tool-result group, and a context-row group before the request.

**Coalescing.** An edit joins a group only when it arrives while an earlier group is still being written. It then shares that group's trailer and flush (Commit point, below). Coalescing never holds back an edit that main would have written by itself: an edit that arrives when nothing is being written starts its own group at once. A send calls `settle()` before it pins (the reads rule below), so every group that a tool round queued is acked before the next request starts.

Every other operation is its own group with its own flush: rewind, compression, density, purge, insert, owner change, clear, replace, fill, checkpoint, rename, mirror sequence and the `rel` drain. A send that reads one of them settles it first, so such a group is committed before the send that depends on it. Compaction is not a group (4.11).

**Writer.** There is one writer per file (the session lock and `historyMutationFifo.ts` already enforce this). The writer keeps two states in memory, both single trailers (about 1.5 KB): the tentative state, which includes queued groups, and the published state, which is the last acked trailer. New groups are built on the tentative state. Every edit in a group is acked by that group's trailer. The writer writes at a tracked offset (4.12). Records of a group are written in order, the group's records are flushed with `flushRecords` (15.1), and the trailer is the last record written.

**Commit point.** A group is committed when the write that contains its trailer's last byte has returned. Before that write, the writer calls `flushRecords` on the group's records, which empties the drive's write cache on every platform, so a trailer on disk always has its whole tree on disk (Section 15.1). The edits that joined the group share that one flush. The trailer is not flushed on its own, so a power loss can lose the newest group and nothing before it. The ack carries `{commitSeq, durableEnd}` (replacing `CommitWatermark {seq, byteOffset}`).

**State is derived only from committed records.**
- A reader's state is the last valid trailer in the file (Section 3.1). The invariant that makes any crash safe: every offset stored in a record points to a record that was written earlier in the same file, so every prefix of the file that ends at a trailer's `durableEnd` contains everything reachable from that trailer. The flush before each trailer (Commit point above) makes this hold after a power loss as well. Bytes after the last valid trailer are not part of any version.
- The published state, and every flag that says "this mutation is done" (transaction closed, replacement durable, checkpoint exists), changes only inside the ack handler for the group's trailer. Nothing sets such a flag at enqueue time or when an acknowledgement promise is created. This removes the code path of defect #1.
- Reads that need rows (`send`, export, resume, dump) first call `settle()`, which awaits the acks of every queued group, then pin the published trailer. They never see queued rows. Scalar reads that are synchronous today (length, token totals) are answered from the tentative trailer, which equals the published one when the queue is empty. `pendingRowFold.ts`, `pendingFoldSnapshot.ts` and the synchronous overlay in `HistoryJournalStore` are deleted.

**Failure.** A failed write or flush poisons the writer as today (`transitionToFailure`) and it writes nothing more. A group whose flush fails never gets a trailer, so no trailer points at its records. The published state does not move. The bytes it wrote after the last trailer stay as an invisible tail. The next owner of the file tries to truncate them at open (4.12) and, if it cannot, appends after them, because no reader can reach them.

**Resume after a crash.** Open, read the last trailer, done. A torn tail is dropped; corruption under an intact trailer throws (3.1). There is no replay, no `unfinishedReplaceTxId`, no `replace_abort` written on resume (`SessionRecordingService.initializeForResume` loses that parameter).

### 4.2 Append

New `ROW` records get `label = nextLabel` (then `+= 2^20`), the owner of the operation, `curated` computed once, and id tuples. For each row, the id trie facts update (Section 3.3), the right spine of the row tree is path-copied, and transfer summaries are filled for the slots that are active (Section 8.2). Lineage is unchanged: `parent` is the previous trailer, `lineageDepth += 1`, and the `skip` pointers are filled from the parent's.

### 4.3 Rewind and pop

The operation is `pop(cutLabel, expectedRemoved)`: remove every live row with `label >= cutLabel`. The cut is a label, never a chronology marker and never a bare count, so a merged row that repeats a chronology `seq` cannot move the cut (defect #2). `expectedRemoved` is checked against the tree (a prefix query on `rows`) and a mismatch throws.

**Lineage.** A lineage is a run of trailers linked by `parent` in which every row set is a prefix of the next one in label order. Only a group that keeps that property stays in the lineage: append, pop, fill, and a state-only group (checkpoint create or delete, rename, mirror sequence). Every other group starts a new lineage with `parent = 0`: replace, compress, density, purge, clear, owner change, synthetic insert, restore of a version. A synthetic insert writes a row at a middle label, so the row set is no longer a prefix extension. An owner change edits the entry of a row that a pop could keep. In both cases restoring an older ancestor would silently undo the change, so a pop never crosses them (case 5 below). There is no `bind` mutation (4.6). A pop that restores an older root discards fills made after it, which costs a refill at the next send and not correctness.

Algorithm:
1. Let `keep` be the number of live rows below `cutLabel` (prefix count from the tree, `O(depth)`).
2. Walk from the current trailer up the `parent` chain, using `skip[]` pointers for `O(log)` hops, to the nearest ancestor `V` in the same lineage whose `rows <= keep`. Row counts never increase going up the chain, so binary lifting is valid.
3. If `V.rows == keep`, the new trailer carries `V`'s `rowRoot`, `idRoot` and `metaRoot` and `V`'s aggregate, and the **current** `stateRoot`. Nothing is re-indexed: facts, occurrence entries, counters, parent chain entries and metrics come back exactly as they were. The state map is not versioned, so a checkpoint, a rename or an owner dictionary entry made after `V` survives the pop (3.5). Cost: `O(log lineageDepth)` preads.
4. If `V.rows < keep` (the cut falls inside a group that appended several rows), the new state is `V` plus the rows `V.rows .. keep-1`, appended as existing records: read their entries from the current tree and insert them as in an append, without writing new `ROW` records. Cost: bounded by that group's size.
5. If no ancestor in the lineage has `rows <= keep` (the cut is below the lineage start, for example below a compression, an owner change or a compaction), the pop is a rebuild (Section 4.6) of the first `keep` rows, with entries copied from the current tree, so owner changes and inserted rows are kept.

In case 3 the new trailer's `parent` is `V.parent` and in case 4 it is `V`, so row counts still never increase going up the chain and later pops walk past the removed group. Rows between `cutLabel` and the old end stay in the file as garbage until compaction (4.11).

### 4.4 Compression

Compression replaces a prefix by a summary and keeps a suffix. It writes the summary `ROW` (its `metadata` carries the replaced span that `IContent` already defines as `ChronologyReplacedSpan`), then builds a new row tree bottom-up from the summary entry plus the entries of the retained range, read with an iterator. Retained rows are not rewritten; their entries are copied, which keeps labels, owners, chronology and `S` metrics (a row-local property). The id trie, the `R` and `A` vectors, the `answered` counts and the parent chain are rebuilt from the retained rows' headers (Section 4.6). Lineage changes. `compression_detail` has no record: the span goes in the summary row's metadata and in `mutationArg0/1`.

### 4.5 Replace transaction

The streamed replacement (`publishReplacement`, used by profile adoption, restore, large rewrites) is a single commit group:
1. Rows of the candidate stream are written as `ROW` records as they are produced, each with the owner the candidate gives it (Section 5).
2. The row tree is built bottom-up as rows are written. The id trie is built from batches: id updates accumulate in a bounded batch (4,096 updates, a constant), are sorted by hash and applied in one pass, then the next batch starts.
3. The trailer is written last.

Until step 3 completes the previous version is the only version. A crash, an error or a cancellation before the trailer leaves an uncommitted tail that nothing reads. `replace_begin`, `replace_commit`, `replace_abort`, `ReplaceTransactionFold` and `ReplaceWriteGuard` are deleted; their single-transaction grammar is carried by the trailer.

Compensation. When a later step of a larger operation fails after a replacement committed, the previous version is still in the file. Compensation is `restore(version)`: a one-trailer group whose `rowRoot`, `idRoot` and `metaRoot` are those of the saved previous trailer and whose `stateRoot` is the current one. It starts a new lineage. It replaces `restorePrevious`, which today re-appends every previous row, and it needs no scratch copy (`historyRowOrigins.ts`, `HistoryMutationSnapshot`'s scratch rows). The saved previous trailer is a 1,504-byte value held by the operation.

### 4.6 Density, purge, insert, owner change, fill

| Mutation | What the group contains | Index work |
|----------|-------------------------|------------|
| density (`density_mutation`) | new `ROW` for each replacement, with the label of the row it replaces; removed labels dropped | row tree rebuilt over the surviving entries; id trie and `R`/`A` rebuilt (below). New lineage. |
| purge (`semantic_media_purge`) | new `ROW` for each rewritten row, same label, owner, and id tuples | If every rewritten row keeps its id tuples and block indices, entries are replaced in place, `lensRef` and metrics of those rows reset to missing, and `A` of affected call rows recomputed. Otherwise rebuild. New lineage. |
| insert (`synthetic_insert`) | one `ROW` with a midpoint label | Always a new lineage (4.3). A monotone add if, for every id tuple of the row, the id has no occurrence of the same kind yet, a response has a call at or before the new label, and no format slot with mapped ids (Kimi or Mistral) is active. Then facts take the new occurrence and the call row's `A` is recomputed. Otherwise rebuild. The first-occurrence and occurrence-ordinal rules make the facts independent of arrival order, so the add and the rebuild agree. |
| owner change | a `RTNODE` path with the new `owner` | entry replacement only, plus fan-out deltas (Section 5.4). New lineage. |
| fill | `LENS` records, `RTNODE` path with summaries | entry replacement only; no row content changes (Section 8.2). Same lineage. |

There is no `bind` mutation. The only producer of `chronology_bind` records is `historyResumeProjection.ts` (line 125), which gives rows from an old journal a chronology marker when it resumes them. Old journals are not resumed, and every row in the new format carries its chronology fields and `invalidateResponses` in the `ROW` header from the moment it is written (2.4). Those fields are therefore immutable, and the entry copies them.

Rebuild. A rebuild creates a new id trie from scratch by streaming the surviving entries in label order and reading each row's header and id piece (one `pread` of the record's first 4 KiB in the usual case, not the body, 2.4). It applies the Section 3.3 update rule to each id tuple, which writes the occurrence entries, the first-occurrence facts, the namespace 1 and 2 lists (the normalized ids are computed from the raw strings of the id piece) and the Kimi exception list, recomputes `reconBlocks`, `answered`, `pairSensitive`, the Kimi counters and `A` using `LENS` records and the new facts, rebuilds the parent lists of the versioned meta map, and reassigns Mistral mapped ids from the raw ids in unit order (7.2). The unversioned state map is carried forward unchanged. Memory is the tree builders (depth entries each) and one bounded batch: the id fact batch merges its pending writes into the group's trie, through the group's appender, whenever they charge more than 64 KiB, so a rebuild holds one chunk of facts and never the facts of the whole history. The nodes a later chunk supersedes stay in the file as unreachable garbage and are reclaimed by compaction. Cost is one header `pread` per surviving row and one `LENS` `pread` per call row. Rebuild is the only path that removes facts, so no fact ever needs an undo.

A rebuild is more work than the mutation it follows, so it is the right place to look if profiling shows a cost. It runs at compression, density and replacement, which already stream all rows; none of them is on the per-turn path. It also runs for a pop below a lineage start (4.3 case 5), which is how a rewind right after a compaction behaves (4.11). Residual risk 8 in 15.2 covers it.

### 4.7 Clear

A group with empty roots and a new lineage. `nextLabel` carries on, so labels of cleared rows are not reused. Cost `O(1)`. The media store and the media reference accounting (`history-media-index.ts`, `media-metric-byte-index.ts`) are separate and keep their own release rules.

### 4.8 Clone, fork and attach

A clone of version `V` into a new file F2 (`cloneHistoryJournal.ts`, session fork, late attach of a bare store to a session file) is a streaming copy:
1. Write F2's header with a new `fileId` and `syncMarker`.
2. Copy the `ROW` records of `V`'s live rows in label order. A `ROW` holds no file offsets (its block directory is relative to its body), so the bytes are copied unchanged. The id hash in an id tuple is unkeyed (3.3), so the copy is valid in any file.
3. Build F2's row tree bottom-up from the copied records' new offsets. Entries keep owners, chronology and metrics; `lensRef` points at copied `LENS` records.
4. Walk `V`'s id trie in hash order into a bottom-up builder (the walk is sorted, so no sort is needed). Each fact and node is copied with every offset-bearing field remapped by the table below. Fields that hold labels, hashes or counts are copied as they are, so no `ROW` is read. Occurrence entries and the versioned meta entries are copied the same way. A copy of a subset of the rows of `V` (the mirror seed of 5.3) cannot reuse facts, because a Mistral mapping depends on every earlier id; it builds the trie by the rebuild path of 4.6 from the id pieces.
5. Build F2's state map from the `stateRoot` of `V`'s own trailer, so a clone of a checkpoint carries the owners and metadata the checkpoint had: the owner dictionary, start metadata (provider, model, workspace dirs, `kind`), title and name, and fork metadata. Then write the trailer.

**Offset-bearing fields and their remap rule.** The record codec declares them once in a table, `OFFSET_FIELDS`, per record kind. Clone, compaction and the offset audit test (13.6) all read that table, so a field cannot be added without a rule.

| Record | Field | Rule in a copy |
|--------|-------|----------------|
| `TRAILER` | `rowRoot`, `idRoot`, `metaRoot`, `stateRoot` | the new roots. `stateRoot` is 0 only for an empty state map. |
| `TRAILER` | `selfOffset`, `durableEnd`, `lastRowOffset` | the new trailer's start and end, and the new offset of the last live `ROW`. |
| `TRAILER` | `parent`, `skip[3]` | 0. A copied version starts a lineage, `lineageDepth` is 0. |
| `TRAILER` | `mutationArg0/1` | labels and counts, never offsets. The codec asserts this. |
| `RTNODE` internal | `childOffset` of each slot | new offset of the copied child. Children are written before their parent. |
| `RTNODE` leaf entry | `recordOffset`, `lensRef[3]` | new offset of the copied `ROW` and `LENS`, known when the entry is built because they are copied with it. A `lensRef` of 0 stays 0. `recordLength` is unchanged: records are copied byte for byte. |
| `ITNODE` internal | `children[popcount]` | new child offsets. |
| `ITNODE`, ns 0 `IdFact` | `mappedRef` (Mistral `VALUE`) | copy the `VALUE`, take its new offset. This is the only offset in an `IdFact`: `C`, `Ca`, `R`, `Rt`, `best` and `Ke` are `{label, part, block}`, and the counters are counts. |
| `ITNODE`, ns 1, 2, 4 | positions `(label, part, u or block)` | labels, unchanged. |
| `ITNODE`, ns 3, 5 | `rawIdHash`, `idHash` | hashes, unchanged. Raw-id pieces live in the `ROW` and are copied with it. |
| meta map leaf | `valueRef` | copy the `VALUE`, new offset. Parent lists hold labels; `kimi:exc` is a count. |
| state map leaf | `valueRef` | copy the `VALUE`, new offset. Inside a `VALUE`, `ckpt:<id>.trailerOffset` becomes the new trailer offset of that version. Owner dictionary, fork metadata and `mirror:primary` entries hold no offsets. |
| `ROW`, `LENS`, `EVENT` | none | the `ROW` block directory is relative to the body, id tuples hold hashes. `EVENT` records are not copied. |

**Several versions.** A clone of several versions (compaction, 4.11) copies them serially, one version at a time, and never merges iterators. A record that several versions share (`ROW`, `LENS`, `VALUE`, `RTNODE`, `ITNODE`) is copied once. After a record is copied, the pair (old offset, new offset) goes into the relocation trie of the new file, namespace 6 of the id trie, in batches of 4,096 sorted by hash as in 4.5. The next version looks a record up before copying it, and a node that is found is not read again, nor are its children. Memory is the walk stacks and builders of one version (depth entries each), one batch, one row and the node cache, whatever the number of versions. The relocation entries stay in the new file as garbage that the next compaction drops. A compaction with no checkpoints has one version and writes none.

Cost is the size of the live data. Memory is the builders plus one row. Fork metadata (`parentSessionId`, source `fileId`, source `commitSeq`) goes in the state map; the `session_forked` event is an `EVENT`.

### 4.9 Checkpoint

A named checkpoint is a state map entry `ckpt:<id>` whose `VALUE` holds `{name, trailerOffset, commitSeq, createdAtMs, liveBytes}`. Creating one is a state-only group of one `VALUE`, one state-map path and a trailer, `O(1)` regardless of history size. The trailer's `ckptBytes` grows by the checkpoint's `liveBytes` estimate, and deleting a checkpoint shrinks it. Renaming edits the entry.

Restoring a checkpoint does what it does today. `CheckpointService.ts` and `SessionTransitionService.ts` call `copyCheckpointRange`, which copies the history records through the checkpoint's sequence into a new child session file. In the new store that is a clone (4.8) of the saved version into the child file: one `pread` of the saved trailer at `trailerOffset`, then the streaming copy. There is no in-session "restore the checkpoint's roots" operation, so a checkpoint never rewrites the file it lives in. `restore(version)` (4.5) exists only to compensate a failed operation.

The version a checkpoint names must stay readable. Compaction (4.11) keeps it by copying it as a retained version, and nothing else retains old versions, so every other old byte is garbage. The saved trailer's `stateRoot` is the state map at creation. A clone of the checkpoint takes its owner dictionary and start and fork metadata from it (4.8 step 5), and compaction keeps that map in the retained trailer, so a restore after a compaction sees the same owners as one before it.

### 4.10 Primitive summary

| Mutation | New lineage | Index work | Cost beyond writing the changed rows |
|----------|-------------|------------|---------------------------------------|
| append | no | facts for the new ids; right spine | `O(depth)` |
| pop | no (within lineage) | restore roots of an ancestor, re-append at most one group | `O(log)` plus one group |
| pop below lineage start | yes | rebuild | one header `pread` per kept row |
| compress | yes | rebuild | one header `pread` per retained row |
| replace | yes | bulk build | streamed |
| density | yes | rebuild | one header `pread` per surviving row |
| purge | yes | in place, or rebuild | affected rows only, or rebuild |
| insert | yes | add, or rebuild | `O(depth)` or rebuild |
| clear | yes | none | `O(1)` |
| owner change | yes | entry replacement | `O(depth)` per changed leaf |
| fill | no | entry replacement | `O(depth)` per changed leaf |
| clone, fork | new file | bulk build | live size |
| checkpoint create, delete, rename | no (state-only group) | state-map entry | `O(1)` |
| restore (compensation) | yes | roots reuse | `O(1)` |
| compaction | new file, new lineage | serial memoized copy of the checkpoint versions and the current version (4.8) | distinct records of all versions |

### 4.11 Compaction

**Why it is needed.** The file keeps garbage that nothing else frees: the path nodes that every group supersedes (about 56 KB per group at 100k rows, Section 3.2), rows removed by pop, rows replaced by purge, density and replace, and uncommitted tails. The old JSONL file also never shrank, but it grew by the rows written. This format grows by the index as well, so compaction ships in this PR (phase 4).

**What a file holds.** Exactly one live version, the one named by the last trailer, plus the retained versions of named checkpoints. Everything else is garbage. A pin never retains an older version across compaction (10.1).

**Trigger.** It is computed from the last trailer alone, after each acked group and at owner open:

```
durableEnd > 2 * (liveBytes + ckptBytes + rows * 1550) + 64 MiB
```

`liveBytes` is the `Aggregate` sum of the record lengths of live `ROW` and `LENS` records. `rows * 1550` stands for the entry (1,104 bytes), its share of internal nodes (about 170 bytes) and its id facts (about 250 bytes: the namespace 0 and 4 entries and the namespace 1 and 2 count and occurrence entries). `ckptBytes` is the trailer field that sums the same estimate over retained checkpoint versions. The factor 2 and the 64 MiB floor are tuned by the write budget test (13.6) and nowhere else. A session below the floor never compacts. When the condition holds the store sets `compactionDue`. Compaction runs at the next idle point: queue empty, pin count zero, mutation FIFO held. It never runs during a send, so a session in a continuous tool loop compacts at the end of the turn.

**Procedure.** The FIFO is held, so no group is accepted while it runs, and a send's `settle()` waits behind it.
1. Create `<file>.compact` in the same directory with exclusive create. Owner open deletes a stale one first.
2. Write a header with a new `fileId` and `syncMarker`.
3. Copy the versions serially with the memoized clone of 4.8: each checkpoint version, oldest first, then the current version. Each version gets its own row tree, id trie, versioned meta entries and `LENS` records, and records it shares with an earlier version are found through the relocation trie and not copied again. Memory is the walk stacks and builders of one version, one batch of the relocation trie and one row. It depends on neither the number of checkpoints nor the length of history.
4. Each checkpoint version ends in a trailer that keeps its own `commitSeq` and carries a state map built from the saved one: the owner dictionary, start metadata, title and name, and fork metadata, which are what a clone needs (4.8 step 5). `stateRoot` is never 0 for a checkpoint whose saved map had those entries. `ckpt`, `mirror` and `rel` entries are not part of a checkpoint's map. Then build the current version's state map over the new offsets (`ckpt:<id>` now points at the new trailers, entries of deleted checkpoints are dropped) and write the current version's trailer last. Its `commitSeq` continues from the old file, its `groupTag` is new, its `parent` is 0, and it starts a lineage. `ckptBytes` is recomputed.
5. `flushRecords` on the new file. This flush is separate from the per-group flush in 4.1 and is unconditional: the rename publishes the whole file at once, so its data must be on disk first. It costs one flush per compaction.
6. Read the new file's last trailer and compare its `rootAggregate` (rows, curated rows, units, tokens, `liveBytes`) with the old one. A mismatch deletes `.compact` and throws. It is a bug in the copy, and nothing recovers from it silently.
7. Swap the files with the state machine below. One code path serves every platform, so the Windows branch is exercised on POSIX too.

**Crash safety.** Until the rename the old file is untouched, so a crash leaves the old file and a stale `.compact` that owner open deletes. After the rename the new file is complete and was verified in step 6. There is no moment at which either file is partly valid. On POSIX a process that opened the old path before the rename keeps reading the old inode, which is a complete version.

**Pins.** Compaction waits for pin count zero, so a pin never spans a swap, and a pin requested during compaction waits behind the FIFO (10.1). With no pin live the deferred blob release queue (10.1) is empty, so a compacted state map carries no `rel` entries.

**Swap state machine (step 7).** The FIFO is held, the pin count is zero, and nothing else uses the descriptors. The writer's state before the swap is saved as `snapshot = {path, fileId, publishedTrailer (commitSeq, groupTag, selfOffset), writeOffset}`.

| Step | Action | On success | On failure |
|------|--------|------------|------------|
| A. Detach | close the write descriptor and the store's read descriptor; mark the published identity `swapping` (it still holds the old `fileId`) | B | close errors are unexpected: restore (R), then rethrow |
| B. Rename | `rename(<file>.compact, <file>)` | C | a recognized refusal: R, then abandon quietly. Any other error: R, then rethrow |
| C. Attach | open new write and read descriptors on `<file>`, read the header and last trailer, require the `fileId` and trailer of the verified candidate; replace the published identity and the counted read descriptor; on POSIX `fsync` the directory | serving the new file | the old file no longer exists: poison the writer with the cause and rethrow |
| R. Restore | open write and read descriptors on `<file>`; read the header and last trailer; require `fileId == snapshot.fileId` and the trailer to equal `snapshot.publishedTrailer`; put the descriptors back into the same store slots, clear `swapping`, restore the write offset to the larger of the file size and `snapshot.writeOffset`; unlink the candidate | serving the old file | poison the writer; the error aggregates the original error and the restore error |

A recognized refusal is `process.platform === 'win32'` with `error.code` of `EPERM`, `EACCES` or `EBUSY` from the rename. On any other platform, or with any other code, the error is unexpected, but the store still restores its descriptors before the error propagates, so no exit from step A leaves it without them. A refusal is logged at debug level, the candidate is deleted (a failed unlink is left to owner open, which removes a stale `.compact`), and the trigger is evaluated again after another 16 MiB of growth. The published identity changes only inside step C, so a reader waiting behind the FIFO sees either the old identity with live descriptors or the new one. The file operations go through an injected `fileOperations` seam (`close`, `rename`, `open`) so a test can refuse the rename after the descriptors are closed (13.6).

**Effect on pop.** The compacted file starts a lineage with no ancestors, so a pop into the current version after a compaction is a rebuild (4.3 case 5). A rewind right after resuming a compacted session therefore costs one header read per kept row.

**Mirrors.** Each mirror compacts by the same rule in its own file. Labels do not change, so mirrors stay aligned with the primary, and `mirror:primary` is in the state map and carries over. A compacted mirror keeps the primary's `groupTag` pair as it was, so compaction alone never triggers a resynchronization.

### 4.12 File I/O rules and Windows

- **Explicit offsets everywhere.** Every read and write names its offset. Node's `fs` documentation says that with a non-negative `position` a read leaves the current file position unchanged. libuv's documentation says `uv_fs_read` and `uv_fs_write` with an offset other than -1 are `preadv` and `pwritev`, and that -1 uses and updates the current offset. No code depends on the file pointer, so a read through one descriptor cannot disturb a write through another, and the Windows question of whether a positional read moves the pointer does not matter.
- **The writer never opens in append mode.** Node's documentation states: "On Linux, positional writes don't work when the file is opened in append mode. The kernel ignores the position argument and always appends." The writer creates the file with `wx`, opens it read-write, and tracks its own `writeOffset`. It starts at the file size at owner open, not at the last `durableEnd`, so a tail that could not be truncated is skipped over.
- **Readers have their own descriptors**: the store's counted read-only descriptor (10.1), and short-lived ones in other processes.
- **Truncating the tail is best effort.** Owner open calls `ftruncate` to the last `durableEnd`. Correctness does not depend on it: no reader can reach the tail bytes (3.1) and compaction removes them. If `ftruncate` fails, for example on Windows when another process has the file open without share-write access, the writer continues from the file size.
- **Flush points.** There are exactly two kinds of data flush, and both call `flushRecords` (15.1). The writer calls it on a group's records before writing the group's trailer (4.1), once for each group, so a tool round that writes a response group and an eager tool-result group flushes twice. Compaction calls it on the new file before the rename (4.11). The tail truncation above is not flushed. The directory `fsync` in 4.11 step C orders a name change, not data, so it is not counted here. The per-group flush is measured on this machine (15.1) and on the Windows runner (phase 1, Section 14).
- **Windows facts, from documentation only.** libuv documents `UV_FS_O_EXLOCK` as the option that takes an exclusive lock on Windows, which implies that an ordinary open does not. The Node `fs` documentation lists `UV_FS_O_TEMPORARY` as Windows-only and as deleting the file when the last handle closes (used for the bare store, Section 12). Whether Bun opens files with `FILE_SHARE_DELETE` was not checked, and nothing here was run on Windows. The rename in 4.11 and the truncate above are therefore written to tolerate refusal, and the format, torn-tail and compaction tests run on the `windows-latest` job in `.github/workflows/ci.yml` (15.2 risk 9).
- **Supported filesystems.** The visibility argument in 3.1 (a trailer is written only after the awaited writes of its group, so a reader that sees the trailer sees its nodes) relies on one machine's page cache, which is coherent between a writer and readers on the same host. A session directory on a network filesystem is unsupported.

## 5. Multi-agent ownership

### 5.1 Owner tags

An owner is a small integer id from the owner dictionary in the state map (id to origin string, from `historyOriginId.ts`). Id 0 means unowned, and an unowned row belongs to every agent, as `acceptsHistoryOrigin` says today. The owner is stored twice:
- in the `ROW` header, as the owner at write time, and
- in the row entry, as the current owner. The entry is the authority. Any reader that needs "who owns this row now" reads the entry in the version it pinned.

Owner assignment is part of the mutation, never of the row count:

| Operation | Owner of new rows |
|-----------|-------------------|
| append | the owner the operation names (explicitly 0 if it names none) |
| replace, density, purge | each rewritten row keeps the owner of the entry it replaces, unless the operation names an owner. This is the rule `durableRowFold.ts` applies today for in-place rewrites. |
| compression summary | the owner the operation names |
| synthetic insert | the operation's owner, else the owner of the anchor row (today's `foldSyntheticInsert` rule) |
| restore of a saved version | the owners in that version's entries |

A mutation API that produces rows without an owner argument does not compile; unowned is spelled `owner: 0`. Defect #3 (edits over 64 rows written unowned) cannot appear through a threshold, because there is one code path for any row count and the owner is a required field of the row record.

### 5.2 Fan-out to per-agent recordings

The primary journal keeps every row and is the system of record. Each agent has a mirror file in the same format, containing the rows it accepts. `HistoryRecorderFanout` keeps its role, but what it delivers changes. It no longer re-sends JSONL records with a `payloadOrigin`. After the primary group is acked, the fan-out receives the group's edit list, expressed with labels:

| Primary edit | Mirror for owner `o` applies |
|--------------|------------------------------|
| append rows | append the rows where `owner == 0 || owner == o`, keeping their labels |
| pop to label L | pop to label L (a no-op when the mirror has nothing at or above L). No row count has to be translated, which is why pop is label-addressed. |
| compress (summary, retained from label L) | drop mirror rows below L; add the summary if it is accepted |
| replace, density, purge | the same operation over the accepted subset of rows |
| owner change of labels S from `a` to `b` (either may be 0) | for each mirror `m`: `old = accepts(m, a)` and `new = accepts(m, b)`, with `accepts(m, o) = (o == 0 \|\| o == m)`, the rule of `acceptsHistoryOrigin` (`historyOriginId.ts:34-38`). `old && !new`: remove S (a density-style removal). `!old && new`: insert S with the original labels, copying the `ROW` records as a late attach does (5.3). Otherwise `m` receives nothing. |

With mirrors A, B and C the owner-change rule gives:

| Change | A | B | C |
|--------|---|---|---|
| 0 to A | nothing | remove | remove |
| A to 0 | nothing | insert | insert |
| A to B | remove | insert | nothing |
| A to A, 0 to 0 | nothing | nothing | nothing |

A mirror entry records the owner as of the last change that affected what the mirror accepts. It is not the authority for the current owner (5.1 reads the primary), so a mirror that accepts a row under both the old and the new owner receives no delta, and mirror equality means the same labels and the same `ROW` bytes.

Mirror groups commit in the mirror's own file. `fanout.flush()` still awaits every mirror and aggregates failures. Mirrors keep the primary's labels, so a label means the same row in every file.

Mirrors are written only through this fan-out, so nothing rewinds a mirror that the primary did not rewind, and `pop` to a label with nothing at or above it is a no-op by definition. Each mirror is created through `SessionRecordingService.createLocked`, which takes the session lock for its own file (`SessionRecordingService.ts:166`, the call `childJournal.ts:100` also makes), so the one-writer-per-file rule of 4.1 holds for mirrors as well.

The primary and a mirror commit in separate files, and the newest trailer of neither is flushed (4.1). After a crash or a power loss the mirror can therefore be behind the primary, ahead of it, or on a history that the primary has since rewritten. Every mirror group stores the identity of the primary version it applied in the unversioned state map: `mirror:primary = {commitSeq, groupTag}` (2.5). On resume the fan-out compares it with the pair of the published primary trailer. Any difference, in either direction, resynchronizes the mirror with a replace group (4.5) whose rows are the accepted rows of the primary, found by the same scan as a late attach (5.3). Equal pairs mean in sync and write nothing.

The sequence number alone proves nothing. If the primary loses its newest group, the next group reuses that `commitSeq`, while a mirror that had applied the lost group holds rows the primary no longer has. The new group has a different random `groupTag` (56 bits, a collision chance of about 1.4e-17 per rollback), so the pair differs and the mirror is rebuilt. There is one code path for "mirror is wrong", and it does not depend on which side is ahead or by how much.

### 5.3 Late attach

Attaching an agent after history exists (the foreground CLI builds history before recording) is a seed followed by a bind, under the mutation FIFO:
1. `settle()`, then pin the primary's published trailer.
2. Iterate the row tree. Use the `ownerBloom` aggregate to skip subtrees that contain neither owner `o` nor unowned rows. For each entry, accept it if its current `owner` is 0 or `o`. Copy the accepted `ROW` records into the mirror as in a clone (Section 4.8), with the tree built bottom-up and the facts built from the headers.
3. Bind the mirror. Any group enqueued after step 1 is delivered after the bind, because the FIFO holds it behind the attach.

The seed reads the owner from the entry in the pinned version, so a row that changed hands after it was written goes to its current owner (defect #4). `historyRowOrigins.ts` (a scratch file of origins captured at one moment) is deleted.

### 5.4 Owner change

An owner change is an entry replacement in the primary (Section 4.6), plus the mirror deltas in the table above. It does not rewrite the row.

### 5.5 What the owner index costs

Owner is a field of the entry, so "row to current owner" is a tree lookup (`O(depth)`) and a scan reads it in passing. There is no separate owner-to-rows index. The only operation that needs "all rows of an agent" is seeding a mirror, which is an `O(accepted subtrees)` scan done once per attach.

## 6. Normalization without later rows

This section replaces the four stages in `provider-curated-stream.ts`. The goal is a lazy stream of the same units the current snapshot yields, produced by looking at a row, one row ahead, and a few index facts.

### 6.1 Definitions

- **Row stream**: the live curated rows in label order (`curated` flag in the entry), followed by the tail rows (Section 6.6) in order. Uncurated rows take no part in anything below, including the id trie.
- **Part**: stage 0 of the current code (`HistoryToolNormalization.splitToolCallsOutOfToolMessages`) splits a tool-speaker row that carries `tool_call` blocks into an ai part holding the calls (part 0, metadata `extracted_tool_call_from_tool_message`) and a tool part holding the rest (part 1). Every other row is a single part 0. The split is a function of the row alone. Block indices in facts are indices within the part.
- **Position**: `(label, part)` ordered lexicographically. The tail follows all journal labels.
- **Unit**: one element of the ordered stream, which is what `NormalizedProviderRequestSnapshot.openReader` yields today.
- **Facts of an id X** (Section 3.3): `C(X)`, `Ca(X)`, `R(X)`, `Rt(X)`, `best(X)`. The empty id has the same record, with the exclusions noted there.

### 6.2 The rules

Each rule is the closed form of one stage of the current code.

**R1, reconstruction (stage 1, `appendContinuity`).** For a tool-speaker part `p` and a response block `b` with callId `X`, the block is reconstructed iff `C(X)` is not before `p` and `Rt(X)` is `p`. In words: no call for X exists before this part, and this is the first tool part that answers X. All reconstructed blocks of the part, in block order, form one synthetic ai unit (`metadata {synthetic: true, reason: 'reconstructed_tool_call'}`, `parameters {reconstructed: true}`, name `toolName || 'unknown_tool'`, description `'Reconstructed tool call after compression'`) that precedes the part. Two blocks with the same unseen X in one part both reconstruct, as today. The check uses the facts as they are at the end of the stream; they agree with the prefix-only definition because appends only add later positions and an insert that could change it triggers a rebuild (Section 4.6).

**R2, call target (stage 3, `call:`).** `T(X)` is the unit that the responses of X attach to. Call-target indexing applies to a call block in a part of any speaker (`appendCompleted` records it for every row), so `C(X)` can be a human or tool part. If `Rt(X)` exists and (`C(X)` is absent or `Rt(X)` is before `C(X)`), then `T(X)` is the reconstructed unit at `Rt(X)`. Otherwise, if `C(X)` exists, `T(X)` is the real call part at `C(X)`. Otherwise (a response from a non-tool row with no call anywhere, or the empty id) there is no target and the response is dropped, as today.

**R3, orphan completion (stage 2, `appendMissingResponses`).** For an ai part `p` and each call block with id `X` that is not empty, the block is orphaned iff `R(X)` is absent and `Ca(X)` is `p`, the first AI-speaker part that holds a call of X. Today's code completes a call at the first AI-speaker row that holds it, even when an earlier non-AI row held the call first, so testing `C(X) == p` is wrong: it differs from today in 168 of 3,000 prototype histories. All orphaned blocks of the part, in block order, form one synthetic tool unit (`metadata {synthetic: true, reason: 'orphaned_tool_call'}`, `result: null`, `error: 'Tool call interrupted or cancelled'`, `isComplete: true`, `toolName` the call's name or `'unknown_tool'`). The unit is not emitted on its own. Stage 4 strips it, and its blocks become candidates of the adjacent unit of `T(X)` (R4), which is `p` only when `C(X)` is also `p`. When `C(X)` is a non-AI part earlier than `p`, the orphan response is created at `Ca(X)` and attached to the part `T(X) = C(X)`, which was already emitted by the time `p` is reached. The filter therefore needs no knowledge of `p` at `T(X)`: R4 reads `Ca(X)` from the fact (a stored-fact read, not a look-ahead). `R(X)` is taken over the stream including the tail (Section 6.6), and over response blocks in any row, which is what `recordBlocks` marks as `responded:` today.

**R4, adjacent unit (stages 3 and 4, `assignResponse`, `adjacentResponse`).** R4 emission applies to every part that carries call blocks, whatever its speaker: `stageOutput` calls `adjacentResponse` for each completed row, and a response whose call sits in a human or tool part is relocated next to that part, not dropped (restricting R4 to AI parts differs from today in 595 of 3,000 prototype histories, and for `[human(text q, call X), tool(response X)]` removes the tool message from the OpenAI chat body). For a call unit `u` (a real part with calls of any speaker, or a reconstructed unit), let `ids(u)` be the distinct non-empty ids of its call blocks with `T(X) == u`. A candidate slot exists for X if `R(X)` is present (a real response) or (`R(X)` is absent and `Ca(X)` exists). The orphan is created at `Ca(X)` (R3) and attached to `T(X)`, so the slot belongs to `u` even when `Ca(X)` is a later AI part and `u` is an earlier human or tool part; requiring the orphan to be created at `u` drops that synthetic result. In the control `[human(text q, call a), ai(call a)]`, today's normalizer emits human, a synthetic tool response, then the ai part; the earlier rule (`C(X) == p`) emits only human and ai and loses the response. Slots are ordered by the position of their first response in the completed stream: a real response by `R(X)`; an orphan by the position of its `Ca(X)` part followed by its block index. The slot order of orphans is taken from `Ca`, wherever `u` sits. The block in a slot is the block at `best(X)` for a real response, or the synthetic block for an orphan. Media blocks come after all slots: for each distinct row `ρ` that holds the first response of some `X` in `ids(u)`, in position order, if the target of `ρ`'s media is `u` (R5), append the media blocks of `ρ` in block order. If there is at least one slot, the unit is `{speaker: 'tool', blocks, metadata}` where `metadata` follows R6, then `sanitizeProviderContentForSerialization` is applied. The count of slots for a row with calls is also the entry's `answered` field, for any speaker of that row; the `answered` and summary bookkeeping is not gated on `speaker`.

**R5, media target.** For a response part `ρ`, scan its response blocks in block order. The first block `b` with a non-empty callId `X` such that `R(X)` is exactly `b`'s position, and `T(X)` exists, gives `target(ρ) = T(X)`. All media blocks of `ρ` go to `target(ρ)`. If no block qualifies, the media of `ρ` is dropped. This is `mediaTarget` in `indexRowResponses`.

**R6, metadata of the adjacent unit, the one-row look-ahead (stage 4, `retained`).** Let `next` be the normalized row that follows `u` in the completed stream: the synthetic orphan unit if the part of `u` completes orphans of its own (R3), else the reconstructed unit of the next part if that part has `reconBlocks > 0`, else the next part. The adjacent unit is "retained" iff `next` is a tool-speaker row whose blocks are all response or media blocks, the number of blocks equals `slots + media`, and every slot and media pointer equals `(next, same index)`. A retained unit takes `next.metadata`. Otherwise its metadata is `{synthetic: true, reason: 'reordered_tool_responses'}`. The only row the check reads other than `u` and the blocks it assembles is `next`: its header and block directory give types, ids and indices. This is the whole look-ahead of normalization, one row.

**R7, stripped self (stage 4, `stripped`).** For a part with at least one tool_response block, remove all response and media blocks. If the speaker is tool or no blocks remain, the part emits nothing. Otherwise it emits the part with the remaining blocks. A part with no response blocks emits itself unchanged. This is a function of the part alone.

**R8, curation.** A row with `curated == 0` is skipped before everything else.

**Emission order for a part `p`:** reconstructed unit and its adjacent unit (if R1 fired), then the stripped self (R7), then, for a part with calls of any speaker, the adjacent unit of `p` (R4). This reproduces the order in which `stageOutput` walks the completed rows.

### 6.3 Why the facts are enough

Every global question in the four stages is a question about one id or about the position of one part, and the id trie answers both:
- "seen before this row": `C(X)` against the position (R1).
- "responded anywhere": `R(X)` present (R3). The global set is exactly the presence of `R(X)`.
- "a later duplicate response rewrites the response of an earlier call": `best(X)` is a function of all responses of X, so the call row reads the current best when it is emitted (R4). Nothing needs to be rewritten, because nothing was materialized for the earlier row.
- "slot order": a sort of at most `k` ids by `R(X)` (R4).
- "stripped rows and relocated responses": each response part drops its responses (R7) and the call part fetches the blocks it needs by `(label, block)` with one `pread` of the block's range (R4). A block is read twice in the whole stream: once at the call and, as part of its row, at its own position where the responses are stripped.

### 6.4 The per-part procedure

```
for part of parts(rowTreeIterator(from), tailRows):          // skips uncurated rows
  if part is tool-speaker with responses:
    recon = blocks b where R1(b)                              // facts of b.callId
    if recon: emit reconCallUnit(recon); emit adjacent(reconAsCall)
  self = R7(part); if self: emit self
  if part has calls (any speaker):
    ids = distinct non-empty call ids of part with T(id) == part
    slots = sort(ids with a response or an orphan, by first-response position; an orphan sits after Ca(id))
    media = rows of first responses whose R5 target is part, in position order
    next = peek()                                              // one part ahead
    if slots: emit adjacentUnit(slots, media, metadata(R6, next))
```

`peek()` returns the next part's header, its block directory and its `reconBlocks` count from the entry, without decoding its blocks. The generator holds the current part, `next`, and the working set of the current adjacent unit.

### 6.5 The state of the filter, and why it is bounded

| State | Bound | Depends on history length? |
|-------|-------|----------------------------|
| Row tree iterator (path of nodes) | `depth` nodes, a leaf of 8,872 bytes and internal nodes of 9,384 bytes; depth at most 14 for any row count under 2^40 | only through `log8`, capped at about 128 KiB |
| Node cache for the id trie | 256 nodes, fixed capacity | no |
| Current part (decoded) | one row, at most the largest row | no |
| Look-ahead (`next`) | one row header and block directory | no |
| Facts of the current call part | `k` facts of about 96 bytes, `k` = call blocks in one row | no |
| Slot list and media refs of the current adjacent unit | `k` slot refs and the media block refs of at most `k` rows, 16 bytes each. Block bytes are not held, they are read when written. | no |
| `lastCallIds` of the chat builder (`validToolMessage`) | the ids of the previous assistant message, at most `k` | no |
| Tail overlay (Section 6.6) | one fact per id tuple of the pending rows | no, it depends on the pending input of the turn |
| Scalars: label cursor, message counter, separator flag, `rs_` counter, strip policy, marker plan (at most 5 locations) | constant | no |

The claim "bounded by a constant independent of history length" holds with two qualifications. The tree path has `depth` nodes and `depth` is `O(log N)`; it is 6 at 100k rows, 7 at 1M rows and at most 14 for any row count below 2^40, and the test in Section 13.4 measures heap at 10k, 100k and 1M rows to show the curve is flat. The tail and the largest row are not constants either; they are bounded by the input of the current turn and by the row, not by the number of earlier rows.

Proof sketch. The generator's output for a part depends on (a) the part, (b) the next part's header, (c) facts of ids that occur in the part, (d) the blocks and rows the facts point to, at most `k` of them, and (e) scalars from the trailer. None of these is a function of how many parts precede or follow. The generator keeps no value derived from a previous part except the cursor, the previous assistant message's call ids and the counters in the last row of the table. Each of these is a constant-size value, so the memory of the generator is the sum of the constant-size rows above.

I/O cost per part: the tree advance (amortized one node read per 32 entries), one `pread` for the part, one for `next`'s header, `k` fact lookups at 2 to 3 preads each, and one block `pread` for each relocated block. The whole stream is read once plus the relocated blocks, with no write.

### 6.6 The tail

The tail is the pending input of the request: the new user message, hook-recomposed rows, and any tool results that main does not persist eagerly. It is passed to the filter as rows and is not in the journal, since main writes none of it before the response completes. Tool results that main does persist eagerly are not tail rows. Main writes them before the next request, or on the todo-pause path before the loop ends (`ChatSession.recordCompletedToolCalls` and `recordCompletedToolHistory`, Section 4.1). The design writes them as their own groups at the same point, so they are journal rows when the next request starts. Main then marks their call ids as recorded (`chatSession.ts:938-939`), which keeps the next send from adding them a second time. The filter treats the tail as a continuation of the row stream with labels above every journal label. A tail row has an id tuple list like any row, built when the send starts.

The tail overlay is a map from id to a virtual fact, holding only ids that occur in tail rows. For such an id, the virtual fact is the journal fact merged with the tail occurrences (positions in the tail are later than any journal position, so `C` and `R` keep the journal's value when it exists, and `best` is replaced when a tail block scores strictly higher). Every lookup of an id first checks the overlay and then the trie. A journal call row whose id has a tail response reads the overlay when it is emitted, so its adjacent unit contains the tail response in the right place. This is what lets a tool result sitting in the tail resolve an orphan in the journal, and a tail duplicate replace a journal response.

Why this is allowed under "no map that scales with the history": the overlay size is the number of id tuples in the tail rows, fixed before the first journal row is read, and independent of the journal. A send with a very large pending input (hundreds of parallel tool results that main does not persist eagerly) has a proportionally larger overlay; that is the same order as holding the pending rows, which the current code also does.

The alternative, appending the tail to the journal and popping it on failure, is rejected. It writes a group (about 64 KB of index, Section 3.2) on every send before the model has answered. Eager tool results are not this case: main writes them before the request too, and the design writes them as their own groups (4.1). A crash between the append and the pop would persist a half turn that the user never completed. A failed send would leave a pop and its garbage in the file. The cost of the overlay is that every fact has two sources, a journal fact and a tail overlay entry. The Stage A differential (13.1) therefore includes tail rows that resolve journal orphans and tail duplicates that beat journal responses.

The prelude also computes which units are pending: a unit is pending if any block in it comes from a tail row. `pending.inputCount` is the tail length. `pending.firstOutputIndex` is the minimum unit ordinal of pending units: the ordinal of the earliest affected journal call row, from a prefix sum of `units` over the tree (`O(depth)` per affected id), or the first tail unit. `isPending(index)` is answered from the same two numbers plus the overlay, as `NormalizedProviderRequestSnapshot` does with `pending:` keys.

## 7. Per-provider streaming filter

### 7.1 Common shape

One object, built per send, is shared by every provider:

```
RowStreamPin {
  readFd, trailer        // the shared, counted read descriptor and the pinned version (Section 10.1)
  tail                   // pending rows and their overlay (Section 6.6)
  formatKey              // which length slot and variants apply (Section 8.5)
  reasoningIdTime        // read once, used by both the length arithmetic and the writer
  units(from?)           // lazy units, Section 6
  readAt(ordinal)        // one unit by ordinal: tree descent on `units`, then the Section 6.4 step for that part
  count                  // unit count: trailer aggregate plus tail adjustment
  aggregates             // lastThinking, callRows, reconRows, firstAnchor, ... from the trailer
}
```

`units()` and `readAt()` replace `NormalizedProviderRequestSnapshot.openReader` and `readAt`. Provider builders keep their per-message converters (`processUserMessage`, `processAssistantMessage`, `processToolResponses`, `buildOpenAIResponsesInput`, the Anthropic block converters), because those functions define the bytes. What is replaced is how rows reach them and how global facts reach them. Equality of bytes is therefore argued in two independent steps and tested in both (Section 13.1): the unit stream equals today's snapshot stream, and each builder over a given unit stream equals today's builder over that stream.

The envelope (model, tools, system prompt, sampling parameters, `stream`, and every other small member) is written by the existing `writeEnvelope` with a `StreamedSegment` for the message array. The sink is a collector with two byte buffers: the members before the array (`head`) and the members after it (`tail`). The envelope is serialized once per send. Its length is `head.length + tail.length`, and the body stream writes `head`, the array, then `tail` through a length-checked stream instead of a `WireBodySpool`. The two buffers hold configuration (system prompt and tools), not history, and are bounded by the 128 MiB envelope limit that `boundedJsonBody.ts` already enforces. Serializing once also means the envelope cannot differ between a counting run and a writing run. A search of `utils/envelope-writer.ts`, the chat and Anthropic builders and the message table found no `Date.now`, `Math.random` or `randomUUID`. The one clock read in the three routes is `Date.now()` in `runtime/responses-source-input.ts:137`, which `context.reasoningIdTime` overrides, and the pin supplies it (10.1).

**Key order and purity.** The converters keep building every object themselves, and lengths are measured by running those same converters, so key order is whatever the converter emits and the stored length equals it. The one rule is that a converter reads only its unit, `RowFormatSettings` and the pin's scalars. Each of phases 6a to 6c starts with an audit of its converters for reads of other rows, and the goldens and the stream guard judge the result.

### 7.2 OpenAI chat (plain, Kimi, Mistral and the other tool formats)

- Entry point: `OpenAIRequestPreparation.spoolChatBody` becomes `prepareChatBody`, returning `{ contentLength, writeTo(sink) }`. There is no spool, no `KeyedRowIndex`, no `estimate`/`dump` file pair. The `RequestContext` loses `spool`, `estimate`, `dump` as files and gains `wireBytes`.
- Pass 1 of `streamChatMessages` (`observeRows`) is removed. Its outputs come from the pin:
  - `lastThinking`: the position of the last unit with a thinking block. Only an ai part's own stripped unit can hold thinking, so this is the `lastThinking` aggregate (max label over curated rows), compared with the tail overlay. The converter test `index !== lastThinking` becomes `unit.position !== lastThinkingPosition`.
  - `hasCalls`: `callRows > 0 || reconRows > 0 || tailHasCalls`.
  - `rowCount`: used only to assert that the two passes saw the same rows. With one pass the assertion disappears.
  - `mapper.observe(row)` for every unit: see the Kimi and Mistral bullet.
- Pass 2 is unchanged in logic: `ChatConversion.convert(unit, ...)` per unit, `validToolMessage` with `lastCallIds` (at most `k` ids), the tool-media message flushed when a non-tool unit arrives. Because the unit stream places each response unit right after its call unit, two tool units are never adjacent, so the pending media of a flush is the media of one adjacent unit. Pending media is held as `(label, block)` references and resolved when written, one block at a time (replacing `DumpScratch<MediaBlock>`).
- **Length model** (prototype `tmp/854-notes/r1-proto/chat.ts`, mirroring `OpenAIRequestBuilder.ts` and `OpenAIChatBodyBuilder.ts`). Every message is serialized independently, and there is one effect across units: tool media. The media of a tool message is held and written as one user message, `{"role":"user","content":[<text part>,<parts>]}`, when the next non-tool unit arrives or the stream ends. The text part is `[Images from tool response]`, or `[Media from tool response]` if any pending part is a video. The boundary state has 6 values: `sep` (a message has been written, so a comma is due) times `media` (none, images only, has video). One additive counter, P, holds the bytes of the pending parts (each with its comma), and it is the only quantity that is not bounded by the state. A unit applied to a state flushes first if media is pending and the unit is not a tool unit, then writes its messages, then adds its media parts to P. A flush writes the frame, the text part and P, so it reads P from before the unit. A node's transfer function is therefore affine in the incoming P with a 0/1 coefficient: `P_out = carry * P_in + p`, where `carry` is 1 when no flush happens inside the node and the pending media passes through, and `p` is the media the node adds. Bytes change by `P_in` when a flush inside the node consumes it, so that coefficient is `[media pending in s] - carry` and is not stored. The summary stores per incoming state `out`, `bytes`, `messages`, `carry` and `p` (2.5), and composes as in 8.2. START is `sep` 0 with no media, so P is 0 at the root and the root needs no outside value. The facts per unit come from the real converters (`processUserMessage`, `processAssistantMessage`, `processToolResponses`, `convertBlockToPart`): the bytes of each message, and the bytes and video flag of each pending part. A tool message that `validToolMessage` drops occurs in raw histories (4,104 prototype cases) and also in normalized ones: a human row that holds a call X, whose result is relocated beside it (R4), is followed by a tool message with no assistant message before it, and the converter drops that message when the stream has calls (`followup-kimi-control.out:26-29`). The drop is the converter's own decision, taken by replaying `validToolMessage` over `lastCallIds` in the pair measurement; the `LENS` record keeps a dropped flag per message, and a dropped message writes no bytes and no id. Evidence: 10,854 cases pass with 0 failures and 299,466 associativity checks over seeded histories under plain, `openai` and `mistral` tool formats, strip `none`, `all` and `allButLast`, reasoning included and not, raw and normalized, plus video and leading-tool-unit scenarios (6,138 cases carry tool media). Five of the six states are reached from START in the corpus; the sixth is needed because interior nodes begin in any state. Kimi ids were not in the corpus, so the Kimi digit arithmetic below is unchanged and still to be checked against it.
- Kimi and Mistral ids (`packages/tools/src/formatters/ToolIdStrategy.ts`). The two strategies are different problems, so they get different designs. Both were run in the chat prototype (`tmp/854-notes/r2-proto/chat2.ts`): 9,760 cases (4,880 per strategy, normalized and raw histories) pass with 0 failures and 438,108 associativity checks. The Kimi controls below are counts over 640 control cases in the full run (a 220-case quick run gave 148 for own name, 26 for last raw name, 131 for no exception list and 30 for AI-only count); the design's facts are wrong in 0 of them. The `ToolIdStore` view over the id trie is kept only for Mistral.
  - **Kimi** (`kimiStrategy`, line 152). `observe` runs over every unit before conversion, with no speaker test, and it sees reconstructed units (R1). A call block with a non-empty id **and** a non-empty name is *eligible*: it is mapped to `functions.<name>:<n>`, where `n` is the number of eligible blocks before it in unit order. A later eligible block with the same id overwrites the mapping, name and index. A block that has an id but no name does not overwrite it. So every use of id X on the wire is `functions.<name of the last eligible occurrence of X>:<index of that occurrence>`. A call or response whose id has no mapping takes `functions.<name>:<counter>`, and the counter continues from `N`, the number of eligible blocks. A stored mapping would be wrong after any prefix change, so Kimi ids are **not stored**. The filter derives them from facts:
    - **Last eligible occurrence.** `IdFact.Ke` (3.3) is the last eligible occurrence of X, with its name length. An append that adds an eligible block replaces it. The occurrence entries of namespace 4 carry an `eligible` bit and an `ai` bit, so the eligible indices of X can be listed. Using the last *raw* occurrence instead (which ignores eligibility, so an unnamed duplicate would win) is wrong in 87 of 640 control cases.
    - **Index.** `index(c)` of an eligible block is the prefix of the `callBlocks` aggregate up to the unit that holds it (`O(depth)` preads) plus its rank among the eligible blocks of that unit (id tuples with `nameLen > 0` and a non-empty id). The aggregate counts eligible blocks of every speaker, reconstructed blocks included. Counting AI-speaker blocks only is wrong in 114 of 640 control cases.
    - **Name prefix.** Stored lengths leave out the index digits and keep the prefix `functions.<name>:`. For a mapped use the prefix carries the name of `Ke(X)`; for an unmapped use it carries the use's own name. A later eligible duplicate with another name changes the prefix of every earlier use of X (`functions.much_longer:1` for both calls and the response in the review example), and an eligible block that follows unnamed ones turns their uses from unmapped to mapped. An append that changes `Ke(X)` in name or presence re-measures every earlier wire-use holder of X in the same group: every call row and every response row that holds X, not only the call target `T(X)`. Two call rows of one duplicated id, in different journal rows, both change prefix. The holders are found by walking the namespace 4 occurrence lists of X for both kinds, and each holder's row summary, token counts (`tokens`) and media numbers (`media`, aggregates) are replaced with the re-measured ones along its leaf path, as a response arrival replaces `A` (8.2). It costs one leaf path per holder and happens only for exception ids. A tail occurrence that changes `Ke` re-measures the same holder set, found the same way, in the tail re-measure of 8.4. Baking each use's own name instead is wrong in 454 of 640 control cases.
    - **Exception ids.** An id is *clean* when it is non-empty and has exactly one call block, that block has a name, and it sits in an AI-speaker unit. A clean id prints once on its call and once on its single response (R3 and R4 guarantee one). Every other id is an *exception*: the empty id, a duplicate id, an id with an unnamed block, an id with an eligible block in a non-AI unit. When an append first takes an id out of the clean state it writes the id into the exception list (namespace 5, key `hash(5, k)`, value the id hash), and the list length is the versioned meta key `kimi:exc`. `canonicalToolIds.ts` makes history ids unique per call, so the list is empty for sessions this CLI recorded, and it exists so that imported or corrupted histories still produce exact bytes. The prototype's largest history had 10 exception ids among 107 ids. Without the list the total is wrong in 416 of 640 control cases.
    - **Closed form.** Let `S(n)` be the sum of `digits(i)` for `i` in `0 .. n-1`, `N` the root `callBlocks` plus the tail's eligible blocks, and `u` the root `unmappedBlocks` plus the tail's. `unmappedBlocks` counts uses of ids with no eligible occurrence: one per call block with an empty id, and for an id that is non-empty but never eligible one per AI call block plus one for its response. The digit total is `2 * S(N) + sum over exception ids X with Ke(X) of ( uses(X) * digits(i_last(X)) - 2 * sum of digits(j) over the eligible indices j of X ) + ( S(N + u) - S(N) )`, where `uses(X)` counts only **written** uses: the AI call blocks of X (named or not) plus one when a tool message for X is written, which means one that `validToolMessage` does not drop (`chat2.ts:324-367,394-410`), and `i_last(X)` is the index of `Ke(X)`. A response whose tool message is dropped writes nothing, so it adds no digits; an id whose response is dropped is an exception id, because a clean id has exactly one written response. The unmapped counter is consumed at conversion even when the message is then dropped, so `u` and `S(N + u)` keep every unmapped use and the third term subtracts `digits(N + r)` for each unmapped use at rank `r` inside a dropped message (the rank is a prefix of `unmappedBlocks`, `O(depth)` preads per such use). The first term is every eligible block printing its own index on its call and its response, which is exact for clean ids; the second term replaces that for each exception id; the third is the counter sequence. The correction holds one id at a time and reads `m` occurrence entries and `m` index computations per exception id (at most 41 uses read in the prototype). The closed form held on all 2,440 normalized Kimi cases that were checked against it.
  - **Mistral** (`mistralStrategy`, `toMistralToolId`, line 227). The mapped id is a function of the raw id and a salt, and the salt is the first one whose candidate `sha256(raw + "|" + salt)` is not in the used set, so a mapped id depends on every id mapped before it. `observe` maps call ids in unit order of first call occurrence, and the ids it skips (the empty id, responses whose id no call carries) are mapped lazily in conversion order. A raw id of nine alphanumeric characters passes through unchanged and is marked used. Every mapped id is 9 characters (0 violations in the 4,880 prototype Mistral cases), so stored lengths do not change when a salt changes. The salt changes the bytes on the wire, though, so the mappings are stored: `getMappedId(callId)` reads `IdFact.mappedRef` (a `VALUE` with the mapped id per active format slot), `setMappedId` writes it, `isUsed` and `markUsed` use namespace 3. The rules that keep the stored mapping equal to what the current code would compute for the rows that exist:
    - At append, the mapping is assigned for the active slot when a row contains the first call occurrence of an id, in append order, which is unit order. Mappings of ids that `observe` skips are not stored: the filter computes them at send start against the used set, in conversion order.
    - A rebuild (4.6) reassigns every Mistral mapping in unit order of first call occurrence over the surviving rows, with a fresh used set, **from the raw id strings of the id piece** (2.4). After compression or density removes an earlier holder of a candidate, a later id may need a lower salt, and the candidate is not a function of `idHash` or of the old mapped id. The prototype (`mistral17.ts`) removes the first collision holder: the stored mapping of the later id is `4Uq1sY29c` and the real mapper gives `4SftZvDMX` (same length, other bytes). Over 2,000 collision-heavy histories (289 with a salted id) a stale stored mapping is wrong in 148 of 2,000 removal cases, and a rebuild from the raw ids equals the real mapper in 2,000 of 2,000.
    - Pop restores the trie root, and with it the mappings of exactly the rows that remain.
    - An insert while a mapped-id slot is active is a rebuild (4.6), because the inserted row can sit before ids that were mapped already.
    - Ids in the tail are mapped at send start by continuing the used set through the overlay. A non-empty call id with no mapping when a unit is converted is a bug and throws.
    - The `openai-chat-mistral.json` fixtures only exercise this when a case contains a salt collision, so phase 6a adds one (14.3).
- `ChatContinuation` (the follow-up request after a reply of tool calls and no text, built as a second spool over the same rows with `omitReasoning`): a second call of the same filter on the same pin with `omitReasoning`. It uses the "no reasoning" length variant from the stored lengths, so no second body is materialized.
- Reasoning: `reasoning_content` placement and the `includeInContext` and strip policies are per-unit decisions. Two stored length variants cover the policy space for thinking-bearing rows (Section 8.2).

### 7.3 OpenAI Responses, both routes

The two routes in the golden (`openai-responses.json`, `openai-responses-via-openai.json`) run `ResponsesSourceInput` (`runtime/responses-source-input.ts`) and `responses-source-serializer.ts`, over `buildOpenAIResponsesInput`. The filter changes how pair logic and global values are obtained.

The Responses model was prototyped in r2 (`tmp/854-notes/r2-proto/`: `rmodel.ts`, `rgen.ts`, `rrun.ts`, `rstate.ts`, `pstate.ts`, `rpdf.ts`) against the real send path. Stateless body length: 10,428 cases, 0 failures (176 golden histories over both routes and four settings, 5,200 random Responses-style histories, 1,732 chat-corpus and 1,732 message-table histories, and raw histories whose dangling set is empty). Stateful (parent, cursor and `previous_response_id`): 2,400 cases (1,200 histories times 2 settings), 0 failures, with the selected parent equal to the sent `previous_response_id` in 2,400 of 2,400. Associativity held at every split of every case and on a random tree each: 156,896 stateless and 29,774 stateful checks, 0 failures. Coverage: 2,278 cases with reasoning items (1,898 with generated `rs_` ids), 1,306 with PDF parts or the disabled notice, 1,260 where the pair test dropped a `function_call`. The id pools included `''`, `call_`, `call_a`, `hist_tool_a`, `toolu_a` and `x!y`.

- **Boundary states and the summary.** There are two states: `E` (no item written yet) and `W` (an item was written, so a comma is due). Both are reached from START. A leaf for a unit that emits `n` items of `B` item bytes is, from `E`: `out = n > 0 ? W : E`, `bytes = n > 0 ? B + (n - 1) : 0`; from `W`: `out = W`, `bytes = B + n`. `items` counts the same `n`. Two summaries compose as `out[s] = b.out[a.out[s]]`, `bytes[s] = a.bytes[s] + b.bytes[a.out[s]]`, `items` likewise, and `r` adds. The layout is 64 bytes per slot (2.5).
- **Content-Length.** `F.bytes = root.bytes[E] + 2` (the brackets), plus, when `serverSideParentActive` is false, `root.r * (len(',"id":"rs_') + len(time) + len('_') + len('"')) + sumDigits(root.r)`, where `sumDigits(R)` is the sum of `digits(n)` for `n` in `0 .. R-1` and `digits(0) = 1`. `r` counts reasoning items whose block has no genuine `rs` id. The `rs_` counter is not part of the state: the digit sum depends only on the total `R` and not on how the stream was split (verified at every split). When `serverSideParentActive` is true the item has no id key and its stored bytes need no variant.
- **Variant dimension.** Only `reasoning.includeInContext`: reasoning items present or absent. `media.pdf.enabled` is a format-key input (an `input_file` or a text notice) and `serverSideParentActive` is a send input; neither is a stored variant. `reasoning.stripFromContext` is not read by this route, so the three-piece last-kept composition of 8.2 does not apply to it.
- **Per-unit LENS facts.** The Responses `LENS` record of a unit holds the list of items it can emit, each `{kind: plain|rs|call|out, bytes (rs: without the generated id), genuine, nid (OpenAI-normalized id), pdf bytes}`; the tool-row media item `{bytes, pdf}`, which is written if and only if at least one `out` item is written; and the unit's `callNids` (AI-speaker units) and `respNids` (tool-speaker units). A media reference is measured by the estimator's own content-free substitution (`toEstimationContents`), so only its `normalizedBase64Length` characters are needed and no blob is read.
- **Pair tests are facts.** `ToolPairIndex` (`hasCall(id)`, `hasResponse(id)` over the OpenAI-normalized id, built by a pass over all rows into a scratch `KeyedRowIndex`) is removed. `hasResponse(n)` and `hasCall(n)` are lookups in namespace 1 (3.3): a `function_call` is kept iff the last `resp` occurrence of its normalized id is at or after the cursor, and a `function_call_output` iff the last `call` occurrence is. Eligibility is the speaker of the unit and not the block type alone (`ToolPairIndex.recordPairs` requires `ai` with `tool_call` and `tool` with `tool_response`). `function_call_output` needs no range test in practice: with a parent every output is written, and without one the range is the whole stream. The earlier shortcut (every response has a call, every non-empty call id has a response, the empty id omitted) is wrong in 2,312 of the 10,428 stateless cases; the fact model is wrong in 0. A concrete case is one AI unit with call ids `''` and `'call_'`: both normalize to `call_`, today's body has two `function_call` items and one output (263 bytes) and the shortcut writes 181.
- **Stateful range correction.** A stored unit summary is computed with pair facts over the whole stream. For a send with a parent (cursor `c > 0`) that is wrong when a call item at a position at or after `c` has a normalized id whose responses all lie before `c`. This is not limited to the empty id: a duplicate raw id (its response attached to the first call) and the ids `''` and `call_` do it. Reusing whole-history answers is wrong in 87 of 457 prototype sends that had a parent. The rule that reproduced today's bytes in 457 of 457: an AI unit is *pair-sensitive* if one of its call blocks has an empty raw id or is not answered by the unit that immediately follows it. The entry carries a `pairSensitive` flag and the aggregate a sum `pairSensitiveRows` (2.5). For a send with `c > 0` the planner descends only into subtrees at or after the cursor whose count is non-zero, re-measures those rows one at a time with facts restricted to `[c, end)`, and composes every other row from its stored summary. In the corpus there were 686 flagged rows in all and never more than 6 after the cursor in one send. The cost is one re-measure per flagged row after the cursor, which is zero for sessions with unique non-empty ids and grows only with imported histories.
- **Cursor (finding 11).** `cursor = unitOrdinal(selected AI unit) + 1`, where `unitOrdinal = prefix(units of rows before the parent row) + selfOffset` and `selfOffset` is the number of units the parent row emits before its stripped self unit (2 for a row with `reconBlocks > 0`, a reconstructed call unit and its adjacent unit; otherwise 0). The unit after the selected AI unit is its adjacent result unit and is **sent**. A cursor after the whole source row skips that output and is wrong in 191 of 191 prototype cases where the parent row has an adjacent result (382 of 382 over both runs). The prototype located the self unit by a tag as a stand-in for the prefix sum; the formula was checked through that control and the selected cursor reproduced today's bytes in 2,400 of 2,400.
- **Stateful parent.** The parent scan is the versioned meta-map lookup of 3.5: the wildcard list and the stripped-URL list, rejection facts, the larger label, then the `selectStatefulParent` no-following-content rule (cursor at or past the unit count sends full history with no parent). `skipRows` is the cursor, and the filter starts there (a unit position from a tree descent on `units`), not at the first row.
- **Dangling calls: pins and other sources.** On every unit stream of a journal pin the dangling set is empty (0 violations in 10,428 prototype cases): R3 completes every orphan and R1 reconstructs a call for every orphan response. So `findDanglingCalls` (an `open` Set and a `names` Map) and the `lastCall` aggregate are not used on a pin, and the synthetic outputs for a stateful parent row are never written for one. The raw-row branch is not dead code in production, however. `ResponsesSourceInput.cancelledResponses` writes `SyntheticToolResponseHandler.createSyntheticResponses` rows for dangling calls, with result `'Tool execution cancelled by user'` and error `'Cancelled by user'` (`openai/syntheticToolResponses.ts:224`), which is not R3's text; the same history through the normalized stream sends `"output":"null"`, 28 bytes shorter per orphan (295 against 267, 675 against 647 and 263 against 235 bytes for the three golden histories below). Where production normalizes first: `streamDiskSource` (`packages/agents/src/core/streamprocessor-disk-source.ts:113` and the `reopen` at `:133`) calls `prepareCuratedForProviderSnapshot` (`HistoryServiceCore.ts:275-280`), which calls `prepareProviderContentSnapshot` (`provider-curated-stream.ts:459`), and the provider receives that snapshot as `requestRows`; `openRequestContentsSnapshot` (`streamRequestHelpers.ts:127`) and `getCuratedForProviderStream` (`HistoryService.ts:738`) do the same. Where production can send raw rows: (1) a request rewritten by a BeforeModel hook, whose rows (`boundary.contents`, `source-before-model-hook.ts:70-83`) are returned without another normalization; (2) `DirectMessageProcessor._createDirectProviderStream` (`DirectMessageProcessor.ts:515-517`), which sends `contents: replayableContents(contentsForApi)`, where `contentsForApi` is the caller's rows or the rows a hook returned (`:557-584`); (3) small internal prompts built from arrays. Compression summaries also bypass normalization, but `sanitizeHistoryForCompression` (`compression/utils.ts:359`) turns every tool call, tool response and media block into text and re-tags tool rows as human, so they carry no call blocks and cannot dangle. **Decision:** the raw-row cancel branch is kept, and it runs only for a `RowSource` that reports `lengthsAvailable: false` (7.5); a pin never runs it. Its `open` Set and `names` Map are then sized by a hook replacement or a direct prompt, which is the declared exception for sources that are not journal history (7.5, 15.1). `wireBodyGolden` feeds raw rows through `ROW_SOURCES = ['stream', 'rows']`, which are such sources, so the three fixtures `orphan-tool-call`, `displaced-tool-result` and `responses-stateful-parent` keep their frozen `'Tool execution cancelled by user'` bytes and are not regenerated. The same three histories are added as new pin-path cases whose expected input is today's normalized-stream output (267, 647 and 235 bytes), so both outputs stay under test (13.1 item 7).
- **Reasoning items.** The `rs_<time>_<n>` id counter is a scalar incremented in stream order for each non-genuine encrypted reasoning item when `serverSideParentActive` is not set. Streaming in unit order keeps it exact. Its effect on length is the arithmetic above.
- **PDF aggregate.** `#pdfBytes > PDF_AGGREGATE_MAX_BYTES` is checked at the end of the stream today, after all bytes were produced. The `pdfBytes[P]` aggregate (Section 2.5) gives the same total up front, so the request is refused before any byte is sent. It is the provider-effective metric of 8.4: only `input_file` parts that the converter emits count, and a PDF that becomes a text notice, sits in an ignored or stripped block, or is dropped by selection counts zero. The thrown message is unchanged. The prototype (`rpdf.ts`) agrees with the real error message in 4 of 4 cases: a total of 49,999,997 bytes against the 50,000,000 limit passes, 50,000,003 throws with that total in the message, the same PDFs with PDF input disabled count 0, and tool-row PDFs count when their output is emitted.
- **Unsupported media report.** `unsupported()` appends a JSON line per unsupported media block to a scratch file (`unsupportedPath`). It becomes a per-category counter on the result (`image`, `pdf`, `other`), because the lines of one category are identical.
- **Codex WebSocket (finding 3).** The route stops using the undici `WebSocket` and uses the `ws` package, so the request goes out as one message in several frames streamed from the filter, with no body-sized buffer. The cause today: undici's `send` takes one whole message, so `assembleFrame` (`responses-websocket-frame.ts`) joins the chunks into a `Uint8Array` before `socket.send` (`openAIResponsesWebSocketTransport.ts:611-617`). `ws` exposes continuation frames. `WebSocket.prototype.send(data, options, cb)` takes `options.fin`, "whether the fragment is the last one", default true (`ws/lib/websocket.js` in ws 8.21.0, doc at line 449 and `send` at line 455; the same option is documented at line 392 of the hoisted 7.5.11). `Sender.send` (`ws/lib/sender.js:351-390`) sends the first call with the data opcode, every later call with opcode 0 (continuation, line 387), and sets the FIN bit from `options.fin` (line 144), starting a new message after a call with `fin` true (line 390). The transport therefore sends `ws.send(chunk, { binary: true, fin: false }, cb)` for each chunk the filter yields, awaiting each callback ("executed when data is written out") so that one chunk and `ws`'s own queue are all that is held, and finishes with `ws.send(new Uint8Array(0), { fin: true })`. The message is binary, as undici's `send(Uint8Array)` makes it today. Before the final frame the transport compares the bytes sent with the declared `contentLength` (the guard of 8.4); a mismatch calls `ws.terminate()` and throws, so the server never receives a complete message. RFC 6455 section 5.4 makes fragmented messages part of the base protocol, so a conforming server reassembles them. `assembleFrame`, `responses-websocket-frame.ts` and the `BoundedJsonBody.toUint8Array` branch of `sendBoundedRequestEnvelope` are deleted, and the 128 MiB limit is enforced at planning time from the stored totals (8.4), as on HTTP. The existing `TransportSocket` seam (`openSocket`) stays: `WsTransportSocket` replaces `UndiciTransportSocket`, with `sendFragment(chunk, fin)` in place of `send`, and it passes a text message to `onMessage` as a string and a binary one as bytes, so the "non-text frame" check keeps its meaning. `ws` is added as a direct dependency of `packages/providers` (`"ws": "^8.21.0"`, with `@types/ws`). It is in the tree but not at the root: `node_modules/ws` is 7.5.11 and 8.21.0 is nested under `ink`, `@x70102/ink`, `jsdom` and `openai`, and `package.json` has no `ws` override, so the direct dependency is what pins version 8 for this package. Residual risk: Codex may reject a fragmented message. Phase 6b covers it with a test against a local `ws` server (several `fin: false` frames and one `fin: true` frame arrive as one message with the exact bytes; a close in the middle delivers none) and with a live smoke against Codex. If Codex rejects fragments, the route fails fast with an error of its own type that names the fragmented send; that error is not a transient WebSocket failure, so the sticky HTTP fallback counter (`onWebSocketFallback`) does not absorb it, and the body is never buffered.

### 7.4 Anthropic

This provider has the most global logic. The r1 prototype (`tmp/854-notes/r1-proto/`, untracked) mirrors today's table path and checks its predictions against the bytes that path emits. `facts.ts` measures per-unit facts with the real converters. `oracle.ts` is the reference machine: a port of the wire builder, the validators, the finish passes and the cache controls onto plain arrays. `model.ts` is the transducer and its summaries, and `run.ts` holds the corpora and controls. The source files it follows are `message-table/wire-builder.ts`, `validation.ts`, `finish.ts`, `cache-controls.ts` and `project-row.ts`, the converters in `AnthropicMessageNormalizer.ts`, the placeholder text in `AnthropicMessageValidator.ts`, `modelSupportsPrefill` in `AnthropicModelData.ts`, and `sanitizeBlockForCacheControl` and `selectLastCacheableBlockIndex` in `AnthropicRequestBuilder.ts`. Phase 0 (14.3) promotes the prototype harness into a committed test.

**The pipeline, in the order it runs.** Each stage is a function of the previous stage's message list, and the order is part of the behavior.
1. *Projection.* `projectRow` applies the image budget and the cross-model thinking strip to each row. The strip reads the exact model id and the normalized endpoint (8.5). The result is a unit. Normalized units never carry tool results inside an AI row (R7).
2. *Conversion groups* (`wire-builder.ts`). A group is a thinking chain or a single row. A chain starts at an AI unit, with reasoning enabled, whose blocks are all model-bound thinking (`sourceField` `thinking`), and takes every directly following AI unit. It becomes one assistant message: thinking blocks of all its units, then text and code, then other blocks, then tool uses, each kind in unit order (the order does not change the length). Any other unit converts alone into one or two atoms: a results message first when the unit has tool responses, then its other content. Results join the open user message and leave it open, so consecutive tool units share one message, and a following non-tool unit adds its other atoms as separate messages. Tool units before the first non-tool unit are dropped. The redact flag is set per group: for every group under `all` or `includeInContext` false, and for every group except the last kept one under `allButLast`.
3. *The last kept thinking group* is the last group whose start unit holds thinking, and the whole group keeps its thinking, every unit of a chain included. A substitution that keeps only the first unit is wrong: for `[human q, AI thinking(first), AI thinking(second)+text(answer)]` under `allButLast` today's table keeps both thinking blocks. The prototype's control, the old single-unit substitution, is wrong in 94 cases.
4. *Validators* (`validation.ts`), all before any same-role merge, in this order:
   - `filterOrphans` drops a tool result whose tool use appears in no assistant message, then drops user messages left empty.
   - `repairAdjacency` walks the assistant messages in order. When the next message is a user message, each tool use it does not answer takes the result from the earliest original message after it that holds one, and that block is removed from where it was (a message left empty vanishes). Calls of one id in one assistant message share that one result and the source block is removed once; later assistant messages see the results already moved (3.3). With no later result it takes an interrupted result (`[tool execution interrupted]`, `is_error`). Collected results go first in the next message, which becomes array content if it was a string. When the next message is not a user message, or there is none, a new user message holding interrupted results for tool uses with no result anywhere is inserted right after.
   - `mergeRoles` merges adjacent same-role messages, turning string content into text blocks.

   Because repair runs before merging, it can place a user message between two AI units: `[human q, AI call X, AI text after]` yields user q, assistant call, user interrupted result, assistant after. Conversion groups are not final role runs, and grouping consecutive same-role units first gives different bytes.
5. *Finish* (`finish.ts`). Merged messages get the leading-kind partition only (user: `tool_result` first; assistant: `thinking` and `redacted_thinking` first; all other blocks keep their order). Four-kind ordering belongs to chains (step 2). `Continue the conversation` is prepended as a user message when the first message is not a user message, `Hello` stands for an empty list, a trailing assistant message gets a `Continue the conversation` user message when reasoning is enabled or the model lacks prefill, blank text blocks are removed, and a message left empty becomes its placeholder.
6. *Cache controls* (`cache-controls.ts`), below.

**Overlay facts.** The validators decide by tool id over the whole history, which a finite state cannot hold. Their decisions are recorded as per-unit overlay facts: blocks that are dropped (orphans and results pulled earlier), atoms that vanish (messages left empty), and result atoms inserted right after an atom of an assistant message. The transducer consumes each unit with its overlay applied. In the prototype the overlay comes from running the ported validators over the whole history. In the product it comes from namespace 2 of the id trie (3.3), keyed by the converted Anthropic id: `filterOrphans` drops a result iff its converted id has no `use` occurrence, and the successor that `repairAdjacency` pulls is the first `res` occurrence after a position, a binary search over the occurrence list. The raw-id lookup that an earlier draft used is wrong in 627 of 800 raw prototype histories (`hist_tool_X` against `toolu_X`). The message-level consumption of `repairAdjacency` is not modeled in the prototype and is described in 3.3; phase 6c tests it. Overlay facts depend on other rows, so they are version-dependent like `A`: they are recomputed with the row's summary when an occurrence changes (8.2). Without the overlay the prediction is wrong in 4,342 of the prototype cases.

**The transducer** (`model.ts`). The boundary state has 10 values, built from three parts:
- `lead`: no non-tool unit admitted yet. This is START. Tool units are dropped in this state.
- `chain`: the previous unit opened or continued a thinking chain, so a following AI unit joins the chain's message as one array atom.
- `run`: the open final message. `N` is no message yet. For role `U` or `A`: `E` is nothing kept so far (it would print its placeholder), `S` is exactly one non-blank string atom, and `B` is array content with at least one kept block.

The ten states are lead with `N`; `N`; `UE`, `US`, `UB`; `AE`, `AS`, `AB`; and `AE` and `AB` inside a chain. An assertion proves that a unit step from any of them lands in the set. From START the corpus reaches all ten.

A unit contributes through its atoms. An atom has a role and a form, string (its JSON bytes and a blank flag) or array (its kept non-blank blocks and their bytes). Adding an atom to the open run:
- A different role, or no run: the previous message closes (its placeholder if it is `E`, then one comma). If the first message would be an assistant message, the `Continue` user message is written first. A new message opens with its frame bytes. A blank atom leaves it `E`, a string atom makes it `S`, an array atom makes it `B`.
- The same role: `E` becomes `B` with the atom's blocks, `S` becomes `B` by turning the earlier string into a text block (the constant bytes of `{"type":"text","text":` and `}` plus the brackets), and `B` adds a comma and the blocks. A blank atom leaves `E` and `B` unchanged and turns `S` into `B`, because the merge makes the earlier string a text block before the blank block is stripped.

Run openings count the messages opened. Block bytes are the JSON length of the block as the converter emits it, so key order and escaping are the converter's own, and the sums do not depend on block order, so chain ordering and the leading-kind partition of merged messages need no state. The summary of a range is its `(out, bytes, opens)` per incoming state (2.5). Two small side tables ride along: `cOut`, the pure chain automaton (does a chain stay open across the range, from each of the two chain cases), and `lastL`, the label of the last group start that holds thinking for each case.

**Last kept group.** For `allButLast` the planner reads `lastL` from the root, finds the group's end by scanning entries forward over consecutive AI units when the start is a chain start (speaker only, a cursor and no buffer), and composes variant 1 before, variant 0 over the group and variant 1 after (8.2). No chain of rows is held.

**Out of the model.** A thinking chain whose later AI unit carries tool results is outside the model (`oracle.ts:258`). It occurs only in raw rows, in 204 prototype cases, and never in normalized rows (0 cases). Sends always use normalized rows, so the length filter throws on that shape and no code path handles it.

**Anchor provenance** (finding 8). Cache anchors are tags on source blocks or strings, set by the converter and by the row's anchor metadata (an anchored tool row, or a human row made only of tool responses, tags the results message when it is flushed). The tag travels with its block through every stage: conversion, relocation of a result by `repairAdjacency` (an interrupted result has no tag), turning a string into a text block (`anchorText` becomes a tag on the new block), and `mergeRoles`, which concatenates blocks with their tags. The anchor pass marks the first anchored block in final message order, unless that block already carries `cache_control`. Selecting the last cacheable block of a merged run is wrong: with an anchored human A, human B, an assistant reply and a closing human, today's merged first message holds the anchor on A, not B.

**Cache control placement.** `message-table/finish.ts` runs the passes in the order of `finishWireRequest`: the context prefix, the tail breakpoint, the anchor breakpoint, then the media purge boundary. `cache-controls.ts` imports `selectLastCacheableBlockIndex` (`AnthropicRequestBuilder.ts:230`) and `sanitizeBlockForCacheControl` (`AnthropicRequestBuilder.ts:101`), and `finish.ts:242` calls the second for the tail. `message-table.ts` imports the anchor tag from `AnthropicAnchorCache.ts` and the purge evidence from `AnthropicMediaPurgeCache.ts`. The marker plan replaces `cache-controls.ts` and the finish-pass call, and it calls the two `AnthropicRequestBuilder.ts` functions as they are, so what a cacheable block is and what a block with `cache_control` looks like stay defined in one place (Section 12). The filter computes the plan in the prelude, before the first byte of the messages is written, in the same pass order:
1. Tail: the last message after the finish passes (which may have added a trailing user message). The plan records the last cacheable block of that message, or the string-to-array switch of a string message.
2. Anchor: the first effective anchor in final message order, by the provenance rule above. It can sit before the unit that carries the row-level anchor metadata, because a repaired result moves earlier. The prototype finds it by running the reference machine. Locating it from index facts (`firstAnchor` and the namespace 2 overlay) is not prototyped; the phase 0 oracle and the stream guard judge it. If the tail already put `cache_control` on that block, nothing more is added.
3. Purge boundary (`AnthropicMediaPurgeCache.ts`, `message-table/cache-controls.ts:231-266`). The boundary is a request overlay, handled like the tail (6.6). The code gives three reasons. The marker is documented as request-local (`IContent.ts:206-207`). `SemanticPurgeStreamTransaction.requestRows` puts it on one row of one request, and only on the explicit-cache-write request, which reads the pre-purge base rows (`semantic-purge-stream.ts:63-95`). `ProviderNormalizationDisk` carries it through the request's stages with a single identity object and throws on two (`provider-normalization-disk.ts:65-110`). Nothing writes it into history, so it has no `ROW` flag, no aggregate and no state entry, and the stored summaries and the format key do not depend on it.
   The purge transaction pins the base version and hands the filter `{label, blockIndex, boundaryId}`, resolving its content index to a label by an ordinal descent. The plan applies the tag when `firstImage` is present, exactly one tag exists, the tagged block is the exact previous cacheable block before the oldest image, and a breakpoint slot is free after steps 1 and 2 (`MAX_MESSAGE_BREAKPOINTS`, `cache-controls.ts:225,256`). The expected block comes from the last cacheable row before the oldest image, a range maximum of `lastCacheable` over `[first label, firstImage)` in `O(depth)` preads, then regenerating the messages around it. The effect on length is one `cache_control` object on one block, measured like the tail and anchor deltas (8.3). The plan returns the evidence the caller reads, `added`, `reused` or none. This pass is not in the prototype corpus (`cacheHistory` was run with `purgeBoundary: false`), so phase 0 adds it (14.3, 13.1 item 5d).
4. The plan is at most five `(position, block)` locations. While writing, the assembler adds `cache_control` when it emits a block in the plan, by calling `sanitizeBlockForCacheControl`. The planner measures the length change of each touched message (8.3). In the prototype corpus the passes touched at most two messages.

Image recovery (`sanitizeTableImages`, #3216) runs on a retry with a smaller image budget. The budget is the image key (8.5), so only the image-dependent component of the slot is filled, for rows with images, and the retry replaces oversize images with the placeholder at emit time per block.

**Writing the messages.** The summary decides the length. The bytes still have to be written in message order, and block order is not uniform, so the writer follows the three cases of today's table. (a) The blocks of one conversion group keep the order the converter gives them: a single row converts to its atoms in block order, and nothing reorders them. (b) A thinking chain is the only place with four-kind ordering: thinking blocks of all its units, then text and code, then other blocks, then tool uses, each in unit order (`oracle.ts:255-277`). Today's table re-reads the chain's rows once per kind. (c) A final message that `mergeRoles` joined from two or more messages gets only the role-specific leading-kind partition of `finish.ts:27-37,75-95`: in a user message the `tool_result` blocks go first, in an assistant message the `thinking` and `redacted_thinking` blocks go first, and every other block keeps its order in the message, so an ordinary merged assistant message with a tool use followed by later text keeps the tool use before the text (`followup-source-controls.out:3`). A message that was not merged is not partitioned, and a writer that sorted every assistant message into thinking, text, other, tool uses would move the text of that example before the tool use. The assembler finds the message's end by scanning entries forward (roles and flags only, a cursor and no buffer), then streams it from the message's start cursor through `readAt` or the unit generator: one pass for an unmerged group, two passes for a merged message (leading kind, then the rest; a pass is skipped when the entry flags show no leading block), and up to four passes inside a chain, one per kind present. Memory is the cursors and one unit. The entry flags (`hasThinking`, `hasToolCall`, `hasToolResponse`, the media flags) say which passes are needed. A test asserts the pass counts for the three cases, the merged-assistant example above, and that heap stays flat on a 10,000-row run (13.5, #8b).

**Evidence.** The prototype predicts the length of the messages array from the composed summary plus the cache deltas, and compares it with the bytes of today's table. 6,244 cases pass with 0 failures and 207,948 associativity checks. Most corpora run on both raw and normalized rows: the 8 counterexamples of the review, the wire-builder tests' seeded, reasoning-sweep and targeted histories (`wireHistory`, `everyReasoningSetting`), 1,200 raw and 1,200 normalized random histories from `messageTableHistories`, the scale and finish scenarios, and the cache corpus with anchors, with and without a context prefix, at TTL 5m, 1h and no caching. 4,385 cases needed validator repairs, 1,418 had thinking chains and 925 were `allButLast` with thinking. Controls that must fail do fail: the old run monoid has identical fields on the twelve-row pair and the table writes 411 and 461 bytes; dropping the repair overlay is wrong in 4,342 cases; the old single-unit last-kept substitution is wrong in 94.

### 7.5 Everything else that reads history

A provider call takes one history input type, `RowSource`: `{count, openReader(signal), readAt(index, signal)}`, which is the existing `ProviderRequestRows` shape (`provider-request-snapshot.ts`). The pin implements it and adds stored lengths and aggregates. These are the consumers that sections 7.2 to 7.4 do not cover, and how each reads under the new store.

| Consumer | How it reads |
|----------|--------------|
| OpenAI-Vercel provider | Declared exception (#3869): it may build the SDK's own array. It reads through the pin. `BaseProviderNormalization.ts` `materializeCallOptions` gives it `collectContents(historySourceOf(options))`, and `historySourceOf` now returns `pin.openReader()`. `openai-vercel/transportRows.ts` `readTransportRows` already loops over `rows.openReader(signal)` and checks `rows.count`, so it needs no change except its source. The array holds the unit stream, is built one row at a time from the pin, and is dropped by `dropTransportRows` as soon as the SDK body exists. Request size: `vercelRequestSizeFetch.ts` measures the bytes the SDK sends and reports them through the typed `onRequestSized` (Section 11). |
| Gemini plugin | Same exception and the same path. The comment on `materializeCallOptions` names "the Vercel provider and the Gemini plugin" as the two providers handed a collected array. `packages/providers/src` has no Gemini provider directory (the plugin is outside the files read for this design), so what changes for it is only the source behind `collectContents`. |
| Fake provider | `FakeProvider.generateChatCompletion(_optionsOrContent)` ignores its argument (`fake/FakeProvider.ts:107`). It reads no rows and needs no change. The caller that created the pin releases it. |
| Load balancing | `LoadBalancingProvider` passes `options.requestRows`, the pin, unchanged to the selected sub-profile's provider. There is no array and no copy. Today `loadBalancing/stagedCallOptions.ts` passes through a call that has `requestRows` and stages any other call on scratch through `acquireRequestRows`. Under the new store every history-bearing call carries a pin, so the staging branch, `acquireRequestRows` and `stagedCallOptions.ts` are deleted (Section 12). Estimates: `estimatePreparedPrompt` (`loadBalancing/preparedPromptOptions.ts`) asks the delegate for its projection, which reads the stored token counts of the sub-profile's family slot from the pin (Section 9). The fallback `estimateRowSourceTokens` reads the same aggregate and does not iterate rows. A sub-profile whose family has no slot gets a fill group at its first estimate (8.2). |
| Compression prompts built from a range of history (`middleOutDiskPlan.ts`, `compressionBudgeting.ts`) | A pin with a label range. Range aggregates (`O(depth)`) give stored lengths and token counts for any range. |
| A caller that already holds its own prompt as an array (for example `ProviderContentGenerator` for a small internal request) | `memoryRows(array)`, a `RowSource` over the caller's array without a copy. It is not journal history and has no stored lengths, so its Content-Length is measured by one counting pass over that source. This is the only counting pass left, and it applies only to sources that are not in the journal. |
| A BeforeModel hook that replaces the request | A `RowSource` over the hook subsystem's replacement rows (`source-before-model-hook.ts:70-83`), with the same counting pass for its length. The rows are not normalized, so the Responses raw-row dangling scan runs for them (7.3). The scratch it needs is the hook subsystem's own and exists only when a hook is registered (Section 15.1). |
| Direct messages (`DirectMessageProcessor._createDirectProviderStream`) | `memoryRows` over the caller's rows or the rows a hook returned (`DirectMessageProcessor.ts:515-517`). Not normalized, no stored lengths, counted in one pass; the Responses raw-row dangling scan runs for them (7.3). |

The filters never ask which kind of source they were given. A source that has no stored lengths reports `lengthsAvailable: false`, and the planner counts it by running the converters in count mode, so the length is exact even when the source was not normalized and the adjacency assumption of 7.2 does not hold. A pin reports `true` and never counts. The one other place a converter reads the flag is the Responses raw-row dangling scan, which runs only for a source that reports `false` (7.3).

## 8. Content-Length

### 8.1 What is summed

The body of every route is an envelope with one streamed array (`messages` for chat and Anthropic, `input` for Responses) at a fixed position among the other members. Its length is:

```
contentLength = headBytes + tailBytes           // the envelope members before and after the array,
                                                // serialized once into two byte buffers (7.1)
              + arrayBytes

arrayBytes    = F.bytes                         // F = finalize(S): '[' and ']', every history item and the commas between them
              + headItems.bytes                 // items written from small data (the chat system message, Anthropic context prefix, and for a source that is not journal history the Responses synthetic parent outputs, 7.3)
              + joins                           // one comma for each head item that is followed by another item

S             = the composed transfer summary of the written range, read from START (8.3)
```

`joins` is `headItems.count` when the history yields at least one item, and `max(headItems.count - 1, 0)` otherwise. `itemCount` is `F.items + headItems.count`. `S` is a composition of stored summaries, so nothing is serialized to learn the length and no pass over history happens in a send when the summaries are complete.

### 8.2 What is stored per row, per format

**Transfer summary.** A transfer summary describes a range of units as a function of the state at its left edge. Each format has a small closed set of boundary states: 10 for Anthropic (7.4), 6 for chat (7.2), 2 for Responses (7.3). For each incoming state `s` the summary stores the outgoing state, the bytes the range writes, and a count (Anthropic: run openings, which are wire messages and so also the items; chat: messages; Responses: items). Chat adds the P coefficient and offset (7.2). Two summaries compose by function composition: the second summary is applied to the outgoing state of the first, and bytes and counts add. The identity summary leaves every state alone and writes nothing. Composition is associative, which is what lets a tree node hold the summary of its range. The prototype checked this at every split point and on random tree shapes: 207,948 checks for Anthropic, 299,466 for chat (plus 438,108 in the Kimi and Mistral run) and 186,670 for Responses (156,896 stateless and 29,774 stateful), no failures. The byte layout is in 2.5.

The summary replaces the earlier scalar `bytes`, `items` and run-monoid fields. Those could not carry the information that decides the bytes: twelve one-text-block rows arranged into runs of sizes `[1,1,1,1,4,3,1]` and `[1,2,2,2,3,1,1]` have identical sums, counts, runs and end roles, and today's table writes 411 and 461 bytes for them. Under the summary the two arrangements compose to different results, because the state records whether an open message holds one string or an array. The first arrangement writes five string messages and the second three.

**Per entry.** Each row entry stores, per format slot, the summary of everything the row contributes to the unit stream, in emission order (6.2): its reconstructed units with their adjacent responses, its stripped self unit, and the adjacent response unit of its calls. The separate `S`, `R` and `A` byte vectors are no longer stored; the entry stores their composition. The `LENS` record keeps the facts the summary was computed from: for Anthropic, per atom and per block the bytes, blank flag, kind and anchor tag; for chat, per message the bytes and per pending media part its bytes and video flag. A summary is recomputed from `LENS` records when one of its inputs changes: a response arrives for one of the row's call ids, a better duplicate replaces one (7.4 and 6.2 R4: the adjacent unit changes), an overlay fact of the row changes (7.4), or `Ke` of one of its Kimi ids changes (7.2). The recomputation reads the `LENS` records of this row and of the response blocks, and no rows. Block order inside a message (four-kind order in a chain, the leading-kind partition of a merged message, group order otherwise) changes no byte count, so no summary stores it; the writer applies it (7.4).

**Variants.** Two settings change a row's units without changing anything else: whether reasoning is emitted (`reasoning.includeInContext`, and for chat the continuation's `omitReasoning`) and whether thinking is stripped (`reasoning.stripFromContext`: `none`, `all`, or last kept). Responses reads only the first (7.3), so for it variant 0 has reasoning items and variant 1 has none, and the last-kept composition is not used. Each slot holds its summary in two variants. Variant 0 has thinking present and emitted, and variant 1 has thinking absent from the output. For a row without thinking blocks they are equal. The root totals for the policies are:
- `none`: the variant 0 summary of the whole range.
- `all`, or `includeInContext` false: the variant 1 summary of the whole range.
- last kept: the composition of three pieces. The variant 1 summary of the range before the last kept group, the variant 0 summary of the whole group, and the variant 1 summary of the range after it. The last kept group is the last conversion group whose start unit holds thinking, which can be a chain of several units (7.4). Summaries compose and do not subtract, so the earlier rule `sum1 - value1(U) + value0(U)` does not apply. The three pieces are range summaries of `O(depth)` preads each. The group start is read from the root summary (`lastL` in the Anthropic slot, the `lastThinking` aggregate for chat, where the group is one unit).

**When summaries are computed.**
- At append, for the format slots that are active. The provider layer registers a measurer with the history service for its current format key (an interface defined in `packages/core`, implemented in `packages/providers`, so the dependency points the right way). On append, the writer runs the same converter that the send uses, in count mode, over the new row. The converter yields JSON chunks; the measurer adds up their lengths, takes the facts of 7.2 or 7.4, and discards the chunks. The row is in memory anyway, and the cost is one serialization. A converter's output is a function of the unit, the `RowFormatSettings` and the pin's `reasoningIdTime`. A search of the three builders, the message table and the envelope writer found no other clock, random or global read (7.1), and the byte guard (8.4) and the frozen corpus (14.3, phase 0) catch a violation.
- Lazily, for any other slot or slot component, as a fill group at the start of the first send that needs it. The fill finds the rows whose summary is missing by descending the tree on `missingBase[P]` or `missingImg[P]`, processes them leaf by leaf (one leaf of entries and one row in memory), writes `LENS` records and the updated leaf paths, and commits one group. After that the numbers are in the journal for good: the same key is never filled twice, and a later send reads them from the trailer. This first fill is one pass over the affected rows, once per `(journal, key)`, and is the only place a pass over history is needed to learn a length. The fill and the pass over the rows that a first Kimi or Mistral send needs for mapped ids (7.2) are the same pass.
- `A` of a call row, and with it the row's summary, is recomputed when a response arrives for one of its ids, from the `LENS` records of the response blocks (`best(X)` points to the block), in the same group as the response row.

### 8.3 Composition, finalization and the format terms

**Composition.** A node's summary is the composition of its children's summaries in label order, and a leaf's is the composition of its entries'. A range summary is the composition of the `O(depth)` nodes that cover the range. A send reads only the START column of the result, so the planner can apply the covering pieces left to right to one running state.

**OpenAI chat.** Each message is serialized independently (`valueChunks(message)`), so the summary's bytes are message lengths plus the commas between messages, and its count is the message count. The tool-media message that the converter flushes after a run of tool messages is part of the model in 7.2, so the adjacent unit's measurement needs only the pending parts, and the flush is charged where the next non-tool unit or the end of the stream triggers it. The `A` measurement runs `ChatConversion` over the pair `[call part, adjacent unit]`, so `validToolMessage` sees the right previous assistant ids. Mistral lengths include the mapped id, which is always 9 characters, so a stored length stays valid when a salt changes. Kimi ids are not stored and their digit count depends on stream position, so a Kimi length is measured with the index digits left out and the digits are added by the closed form of 7.2 from `callBlocks`, `unmappedBlocks` and the exception-id list. The name prefix of a mapped use is the name of the last eligible occurrence, and the row summaries carry it (7.2). `finalize` adds the end-of-stream flush when the end state has media pending: a comma if a message precedes it, `{"role":"user","content":[` and `]}`, the text part, and P for the root's START column.

**Responses.** The summary is the 2-state transducer of 7.3, and `finalize` adds the brackets: `F.bytes = root.bytes[E] + 2` plus the `rs_` term, with `F.items = root.items[E]`. Items are serialized independently except for the generated reasoning ids `rs_<time>_<n>`. `appendReasoningItems` (`OpenAIResponsesInputBuilder.ts`) assigns `reasoningItem.id` after the item is built, so the key is last in the object, and it assigns it only when the block has no genuine server id and `serverSideParentActive` is not true. The reasoning item emission depends only on the block and those two facts, not on a neighboring item (checked in that file). The stored length is measured with the id omitted and the summary records `r`. When `serverSideParentActive` is not true, the total adds `r_total * (len(',"id":"rs_') + len(time) + len('_') + len('"')) + sumDigits(r_total)`, where `sumDigits(R)` is the sum of digit counts of `0 .. R-1`, closed form. `time` is the `reasoningIdTime` of the pin (10.1), read once and passed to both the length arithmetic and the writer, so the two cannot disagree. A millisecond clock has 13 digits until the year 2286. `r_total` is a range sum over the written range, so a stateful request that starts after the parent counts from zero, as the code does. The stateful range correction of 7.3 re-measures the pair-sensitive rows after the cursor before the range is composed.

**Anthropic.** The summary is the 10-state transducer of 7.4, and `finalize` is its end-of-stream rule. From the root's START column: `F.bytes = bytes + 2` (the brackets) plus the end terms, and `F.items = opens` plus the same. The end terms depend on the end state. No message at all gives the `Hello` user message. A last message that kept nothing gives its placeholder. A last assistant run adds a comma and the `Continue the conversation` user message when reasoning is enabled or the model lacks prefill (`modelSupportsPrefill(currentModel)`, so the exact model id is in the format key, 8.5).

**Cache control deltas.** The passes after the finish passes are the context prefix, the tail breakpoint, the anchor breakpoint and the media purge boundary (`finishWireRequest`). The prefix is a head item. The others add a `cache_control` object to one block, and a location whose message holds string content switches that message to array form. The plan (7.4) touches at most two messages in the prototype corpus (the last message and the message holding the first effective anchor), so the planner measures each exactly instead of using arithmetic: it regenerates the message, takes its length before and after the pass, and adds the difference. The after-length is measured with `sanitizeBlockForCacheControl(block, ttl)` (`anthropic/AnthropicRequestBuilder.ts:101`, the function the table path calls today), so key order is whatever the emitter writes. The deltas depend on the TTL setting, which is part of the plan and not of the stored summaries. The purge boundary pass is not in the prototype corpus and is measured the same way. Section 13.1 item 5 checks the total against the written bytes on the cache-off, 5m and 1h cases.

### 8.4 The total, the tail, and the checks

`S` for the journal part is the trailer's `rootAggregate` summary when the whole stream is written. For a stateful request that skips a prefix it is the composition of the range summaries from the cursor to the end (`O(depth)` preads). Summaries are composed and never subtracted.

The tail adds two things, both bounded by the tail:
- the tail's own units, measured in count mode when the send starts and applied after the journal part, and
- for every id in the tail overlay whose target is a journal call row, a changed contribution of that row (its adjacent unit changes: an orphan synthetic response replaced by a real one, or a better duplicate), and for a Kimi id whose `Ke` changes in name or presence, a changed contribution of every journal call row and response row that holds the id, found through its occurrence lists (7.2). The planner re-measures the row's contribution in count mode with the overlay applied, and composes the range before the row, the new contribution, and the range after the row. With `m` affected rows that is `2m + 1` range summaries. The affected rows are found from the overlay ids by one trie lookup each.

**Media metrics.** Two metrics are defined over the normalized selection, which means over the units the filter will write (6.2), not over raw rows.
- *Normalized-selection media metric.* The sum, over the media blocks in selected units, of the length in base64 characters of the block's normalized data. Inline base64 counts its character length after normalization. A stored reference counts `4 * ceil(n / 3)` for its stored byte count `n`, so a three-byte reference counts 4 and not 3. A URL block counts 0. A block counts once for each selected occurrence, and a block that selection drops (R5) counts 0. This is the quantity that `assertRequestMediaBudget` compares with the aggregate budget (`request-media-resolver.ts`), so the planner's check agrees with today's. It is stored per unit and summed in two parts: `mediaChars` for media other than images, and `imageChars[P]` for images, which depend on the image budget (an image that the budget replaces by its placeholder is text and counts 0).
- *Provider-effective PDF metric.* One per format slot, `pdfBytes[P]`, in the unit that the format's own limit uses. For Responses that is the decoded byte length of the inline `file_data` of each `input_file` part that the converter actually emits (`inlineBase64ByteLength`, `responses-source-input.ts`). A PDF that becomes a text notice because PDF input is disabled for the format or endpoint contributes 0, as does a PDF in a block that the row-local rules ignore or strip, and one that selection drops. PDF enablement is part of the base key (8.5), so the metric is per slot and a raw per-row PDF byte count is not stored. Only Responses has an aggregate PDF limit today (`PDF_AGGREGATE_MAX_BYTES`), so only that route compares it. The other formats store it in the same fill.

Checks made before the first byte is written:
- The length is at most the 128 MiB envelope limit (`envelopeTooLargeError`, now raised at planning time, with the same message).
- The media aggregate budget from `mediaChars + imageChars[P]` over the written range, and on Responses the PDF aggregate from `pdfBytes[P]`.
- Every slot component used is complete: `missingBase[P]` and `missingImg[P]` for the range are zero after the fill, otherwise the planner throws.

While streaming, the body stream counts the bytes it hands to the transport. If the count differs from the declared length at the end it fails the request with an internal error that names the route, the declared and written lengths, and the last unit ordinal written. A mismatch means a stored length is wrong or stale. It is reported, not repaired: there is no fallback that recounts or recomputes silently. The test plan makes the same comparison on every corpus case so that a wrong length is found before a user finds it.

### 8.5 Slots, format keys and versions

The trailer carries a slot table: `FORMAT_SLOTS = 3` entries of `{formatKeyHash, formatRev, gen, imageKeyHash, imageGen, summaryKind}` and `FAMILY_SLOTS = 4` entries of `{familyKeyHash, estimatorRev, gen}`. Both are frozen for format version 3 because they set the size of the aggregate in every node (2.5). `summaryKind` is the layout (anthropic, chat or responses) of the transfer summaries the slot holds, set from the base key's format id when the slot is assigned (2.5, 2.7). A format slot is not tied to a provider. Three slots hold the three keys a session switches among, and a fourth distinct base key evicts the least recently used one. Four family slots hold the tokenizer families of a load-balanced profile with up to four sub-profiles. Changing either constant is a format bump, which costs nothing because old journals are not resumed (2.1). A load-balanced profile that alternates among more than three base keys (for example four Claude models) refills on every switch. That is the cost of keying on the exact model id, and each refill is one pass over the affected rows.

**The base key** is the hash of exactly the inputs that change a row's units or bytes, other than through the image budget:
- the format id (`openai-chat:<toolFormat>`, `responses`, `anthropic`),
- `formatRev`, a constant in the builder's source that is bumped with any change to a converter's output,
- the exact model id, for any format whose converters, projection or finish passes read it. Anthropic reads `currentModel` in two places: the cross-model thinking strip compares it with each row's stamp (`project-row.ts`, `crossModelThinkingStrip.ts`), and the finish pass asks `modelSupportsPrefill(currentModel)`. A model class is not enough: two models of one class can keep or drop the same thinking row,
- the normalized endpoint, meaning `currentBaseURL` normalized as the strip normalizes it before comparing it with each row's stamp. Two endpoints with the same media capabilities are different keys,
- the converter options that change bytes. For Anthropic these are the fields of `AnthropicConversationConversionOptions`: `isOAuth` together with the tool-name transform it drives (`unprefixToolName`), `supportsUrlImages` and `reasoningEnabled`. For chat they are the tool format and the reasoning field name,
- the other settings the converters read per row: the tool output limit config (`buildToolResponseContent(config)`), PDF enablement and unsupported-media placeholders (`mediaPdfEnabled`, the base URL media predicate).

All of these are fields of one typed `RowFormatSettings` object that every converter takes as its only settings input, so the key is the hash of that whole object and a setting added to the type is in the key by construction. A converter callback is represented in the type by a closed enumerated option (for example `toolNameTransform: 'none' | 'oauth'`) and never by a function value, because a function cannot be hashed. The cross-model strip has three inputs: the exact model id, the normalized endpoint and the stamps on the rows. The first two are in the key and the stamps are in the rows.

**The image key** is the per-image dimension or pixel budget (`imageDimensionBudget.ts`) and nothing else. It is kept apart from the base key because it affects only rows that contain images.

What is in neither key: the system prompt, the tool definitions, the model name for a format that never reads it, sampling parameters, and the two variant settings. They change the envelope or select a stored variant, so changing them costs nothing in the journal.

**Budget-independent and image-dependent metrics.** Everything stored for a row without images, and everything for the non-image blocks of a row with images (the `LENS` base facts), is budget independent and carries the slot's `gen`. The facts of the image blocks, the summary of any entry whose contribution includes an image, and `imageChars` are image dependent and carry `imageGen` as well.

Image dependence follows the emitted contribution, not the source `ROW` flag. An entry's summary covers its reconstructed units, its stripped self unit and its adjacent response unit (8.2), and the adjacent unit can hold images relocated from another row (R4, R5: a tool result's media moves next to its call and is stripped from its source). An AI call row with no image in its own `ROW`, followed by a tool result X with an image, owns the image-bearing adjacent unit, while the tool entry emits no self unit. The entry therefore carries a derived flag `imageContrib`, set when any of its self, reconstructed or adjacent units includes an image block that the filter will write, and recomputed in the same step as `answered` and the summary (a response arrival, a better duplicate, a purge). The aggregate `imageContribRows` sums it. A node aggregate is valid for slot `P` when its `gen` matches and either `imageContribRows` is 0 or its `imageGen` matches. `missingBase[P]` counts rows whose budget-independent part is missing, and `missingImg[P]` counts entries with `imageContrib` whose image-dependent part is missing or stale. A node with a stale `gen` reads as all missing in both counters. A node with only a stale `imageGen` reads as `missingImg = imageContribRows` and keeps its stored `missingBase`.

Staleness is handled by `gen` and `imageGen`. A slot is reassigned (least recently used) when a new base key needs one, and its `gen` increases. A change of the image key alone keeps the slot and increases `imageGen`. Every node and every entry stamps the values it was computed for, and a fill rewrites the nodes it touches with the current stamps. Nothing is rewritten when a key is retired.

**Recovery after an image-budget change** (`sanitizeTableImages`, #3216) changes the image key and nothing else, so only `imageGen` moves. The fill descends on `missingImg[P] > 0`, which reaches exactly the entries whose contribution includes an image, including a call entry that owns an image relocated from a later tool row. It re-measures the image blocks of the contribution under the new budget, reading a relocated block from its source row by `(label, block)`, recomputes the entry summaries from the unchanged base facts, and writes those leaf paths with the new `imageGen`. Entries without an image contribution are neither read nor rewritten, and `missingBase[P]` stays zero, so the completeness check of 8.4 passes after this fill alone. If recovery also needs a new base key, for example because the slot was evicted meanwhile, `gen` moves, every row is missing, and the fill is complete. Both cases are tested (13.6).

A mutation that changes a row's bytes (purge, density replacement) writes the new entry with missing summaries for every slot, except the active slots, which are measured in the same group.

`formatRev` is enforced by a test, not by discipline. A second test builds a `RowFormatSettings` for every field in turn with a changed value and asserts that the key changes, so a field that is read but not hashed cannot exist. Three further cases pin the finding 9 inputs: a switch between two models of one class, a switch between two endpoints with the same media capabilities, and a change of the OAuth tool-name transform each change the key. A unit test measures a fixed set of rows through each builder's converter and pins the SHA-256 of the output next to the `formatRev` constant; a change to the converter that is not accompanied by a bump fails that test.

## 9. Estimates and dumps from stored per-row token counts

**Token counts.** A tokenizer family slot holds `(family, estimator version, asset revision)`. Per-entry `S`, `R` and `A` vectors hold `tokens[F]`. The providers register a `RowTokenMeasurer` for the active family, like the length measurer. It counts the same unit content the estimator projects today (`Gpt56SourceProjection`, `claudeContentFeatures`) and writes the count. Counts are filled at append for the active family and lazily by the same fill group for others, so a row is tokenized once. There are four family slots (8.5), so a load-balanced profile with up to four tokenizer families keeps all its counts in one file without slot thrash.

**Estimates.** A prompt estimate is `sum of unit tokens over the written range + tokens of the envelope + per-message overhead`. The unit sums come from the trailer (or a prefix subtraction for a stateful request, plus the tail's units measured at send time). The envelope tokens (system prompt, tool definitions) are counted per send with the family and cached in the process by content hash in a fixed-size cache. The per-message overhead constants are the estimators' own calibration values.

`HistoryService.getTotalTokens` and `historyTokenEstimation.ts` read `rootAggregate.tokens[F]`. Size breakdowns (`historySizeBreakdown`), export summaries and `/stats` style views read entries only.

**What changes in behavior.** A sum of per-unit token counts is not identical to a count over the concatenated prompt. Differences come from merges of tokens across unit boundaries and from estimator features that look at the whole prompt (the Claude calibration features in `tokenizers/claude/`). Estimates decide when to compress, not what is sent, so the wire-byte invariant is unaffected. Decision: an estimator family that reports itself as exact (`estimatorMethod === 'exact'`, today `openai-gpt-5.6`, `tokenUsageEstimateLogger.ts`) must match the whole-prompt count exactly on the corpus, which is plausible because chat messages are separated by role tokens and the sum is additive per message. Every other family must be within the larger of 16 tokens and 0.5 percent. This is a test threshold, set by the corpus test in phase 7. It is not one of the decisions in Section 15.1, because the estimate only decides when compression starts and never changes what is sent.

**Dumps.** `/dump` and `dumpcontext` write the same units in pretty-printed form through `streamPrettyJson.ts`, `dumpRequestContextStream.ts` and `envelopeDumpBody.ts`. A dump is another run of the filter on a pin, with a different sink. It needs no stored lengths. The dump-form file pair that the body writers produce today (`StreamedDumpBody`, `DumpScratch` in `utils/dumpScratch.ts`) and the estimator-form prompt files (`runtime/prompt-estimator-files.ts`) are not written during a send.

## 10. Retry and recovery

### 10.1 The pin

A send starts with one synchronous step after `settle()`:

```
pin = {
  readFd:   the store's read-only descriptor for the current file, with a reference count
            taken in this step (no new open, no path lookup),
  trailer:  the published trailer (its offset and durableEnd),
  tail:     the pending rows,
  key:      the format key and variant settings,
  reasoningIdTime: Date.now() read once here (Section 8.3),
  signal
}
```

The store opens one read-only descriptor when it opens or swaps a file. A pin shares it and counts it. Positional reads on a shared descriptor are safe because every read names its offset (Section 4.12). Because the pin takes no descriptor by path, there is no window in which a rename can make it point at a different file. The descriptor is closed when the count returns to zero after the store has swapped files. The earlier idea of duplicating a descriptor with `pinReadableFile` (`durableRowFold.ts` opens by path and records the inode) is dropped: Node has no `dup`, and a pin that opens by path needs an identity check that sharing makes unnecessary.

Every read through the pin is bounded by `trailer.durableEnd`; a read at or past it is an internal error. All nodes reachable from the trailer are immutable and lie below `durableEnd`, so the pin is a snapshot: later commits and mutations by other agents do not change what the pin reads.

Compaction (4.11) starts only when the pin count is zero and the mutation FIFO is held, and a send's `settle()` waits behind the FIFO, so a compaction never swaps the file under a pin and a pin never starts mid-swap. Pins of other processes do not exist: other processes open the file read-only for discovery and hold no versions across a swap.

**Blob lease.** A pin protects journal bytes. It does not protect media-store blobs: history keeps changing while a send is pinned, and a purge or clear can drop the last reference to a blob that the pinned version still names. Today `HistoryMediaOwnership` releases the history reservation of every blob that leaves the history (`history-media-ownership.ts:141-150`, `:238-248`; also `MediaAdmissionService.releaseReference`, `media-admission-service.ts:247-249`). `reclaimUnreferenced` then deletes any object that no protected id and no reservation of a live instance covers (`local-media-store-reservations.ts:326-334`, `:388-405`), and the janitor calls it at `janitor/mediaReclamation.ts:222`. The pin's lease is the history reservation itself, kept past the release until no live pin can see the blob. This is option (a) of the review. A per-pin set of blob hashes (option b) grows with the history in the pin, which the memory rule forbids.
- *Deferral.* A group that removes blobs from the current version while a pin is live does not issue their release. It appends one entry per removed blob to a FIFO queue in the unversioned state map, `rel:<k> = {contentId, version}`, where `version` is the group's own `commitSeq`, and updates `rel:head` and `rel:tail` in the same group. `version` never decreases with `k`. A group built with no live pin issues the release when it is acked, as today. The queue is on disk, so memory does not depend on the number of blobs.
- *Drain.* The store keeps live pins as a map from pinned `commitSeq` to count, one entry per concurrent send, so the oldest live pin version is its first key, `O(1)`. When a pin is released, and at owner open, the store pops entries from the head while `entry.version <= oldestLivePinVersion` (or no pin is live). For each it calls `store.release(contentId, historyOwnerIdFor(contentId))` unless the current history owns the blob again (`owned.has`, after an undo or a restore), then writes one state-only group per batch of 256 that advances `rel:head`. An empty queue costs two state lookups. After a crash the dead process's reservations expire with its instance lease (`local-media-store-reservations.ts:185-204`), so open resets the queue.
- *Retries.* The pin lives across every transport retry of a send (below), so the blobs it can reach keep their reservation exactly as long. A retry that takes a new pin (image recovery) reads only blobs the current version names, and history reserves those.
- *Gate.* Every history-owner release goes through one `HistoryMediaReleaseGate` that `HistoryMediaOwnership` and `MediaAdmissionService.releaseReference` receive by injection. Releases under other owners (`session-row-media.ts`, `request-media-resolver.ts`, admission rollback of rows that never committed) cannot affect a committed version and bypass it.

A retry for a transport reason (network error, 429, token refresh) re-runs the filter on the same pin. The units, the lengths and the bytes are the same, so the declared length is the same too. Nothing from the failed attempt persists, because nothing was written anywhere: no spool to rewind, no index to rebuild. The pin is released in `finally` (drop the reference count, drop the tail), and `release()` is idempotent as `RequestContext.release()` is today.

A retry that changes the format key or the rows (image-dimension recovery, a prompt-envelope refresh after compression in `streamDiskSource`'s `reopen`) takes a new pin. Those are the cases known today: `retryPromptEnvelopeRefresh.ts`, the #3216 recovery, and a key change cannot be missed because the retry loop passes the key it wants to `pin.refresh(key)`, which returns the same pin when the keys are equal and a new pin otherwise. The reasoning id time is read again with a new pin.

The retry after the backend rejects a Responses parent is not one of these. A rejection changes the provider instance's rejection table (3.5), not the format key or the rows, so `pin.refresh(key)` returns the same pin. That is correct because parent selection is not part of any stored summary: it runs on every send, from the pin's parent lists, the provider's rejection table and the cursor, and so does the range composition from the cursor. The retry therefore re-runs selection on the same pin and skips the rejected parent even though the key is unchanged. No forced refresh is needed, and the test of 13.6 covers the unchanged-key retry.

### 10.2 Cancellation

The abort signal is checked once per unit, as `RowPacer` does now. A cancelled stream closes the pin. There is no temp file to remove.

### 10.3 Media: resolve per unit, stream, release

The media aggregate budget is checked up front from the `mediaChars` and `imageChars` aggregates (Section 8.4), so the per-request reservation set (`RequestMediaReservations` in `request-media-resolver.ts`), which exists to track what has been reserved across rows, is not needed. `request-media-resolver.ts` has no rule that depends on how many media blocks the whole request holds: its only request-wide check is the aggregate byte budget (`aggregateBudgetBytes`), and the Anthropic image rule is a per-image dimension or pixel budget resolved from settings (`packages/tools/src/utils/imageDimensionBudget.ts`), which enters the format key (8.5). A row's media length is therefore a stored per-row number. The unit loop becomes:

```
for unit of units():
  resolved = resolveMedia(unit)        // only this unit's media references are read from the store
  write(serialize(resolved))           // bytes go to the socket
  release(resolved)                    // buffers dropped before the next unit is produced
```

Memory is the media of one unit. For an adjacent unit it is the media of at most `k` rows. The stored size of a media reference is part of the row (and of the length), so the data-URI length is arithmetic: base64 length for the stored byte count plus the mime prefix. A blob that is missing from the media store when its unit is reached is a corruption error. The request is aborted at that point, with the unit's label in the message. A pre-check for presence would need a pass, and the media reference accounting (`history-media-index.ts`) together with the blob lease of 10.1 is what keeps blobs alive.

**Read path for a pinned send.** `RequestMediaResolutionInput.reservations` is replaced by `lease: PinnedMediaLease`. Its only effect is that `readReferenceBytes` (`request-media-resolver.ts:482-499`) always takes the branch it takes today for a content id it already holds (`:487-488`): `store.readReserved(reference)` (`local-media-store.ts:376-384`, `local-media-store-persistence.ts:178-186`). That read is verified (length and hash) and takes no store lock. It creates nothing in the media-store directory: no reservation file (`reserveUnlocked` publishes one at `local-media-store-persistence.ts:730`), no store lock file (`readObjectVerified` goes through `runExclusive`, whose `acquireStoreLock` creates `lockPath` with `open(..., 'wx')` at `:548`), no owner id and no map of held ids. `HeldMediaReservations` (`request-media-resolver.ts:284`) and `openReservations` are deleted with `RequestMediaReservations`. A missing or corrupt blob aborts at its unit with the label, as above. Sources that are not journal history (7.5) keep `reserveAndReadVerified` per resolution, because nothing holds a lease for them. Until phase 8 the pinned path still uses today's request reservations, which also hold the blobs for the request, so the interim is safe.

## 11. Telemetry

`request_chars` is the wire byte count, which it already is today (`requestSizeReport.ts`: "the body's UTF-8 byte length, the exact Content-Length"). The value is the declared `contentLength` from Section 8, checked against the bytes written. The name stays for schema stability (`packages/telemetry`, `core/src/telemetry/loggers*.ts`) and the telemetry reference documents that it counts bytes.

Plumbing changes from a function stored in a metadata record to a typed parameter:

- `NormalizedGenerateChatOptions` (and the Anthropic and Responses equivalents) gain `onRequestSized?: (wireBytes: number) => void`, a typed member of the options.
- `LoggingProviderWrapper` passes the callback it builds for `DeferredApiRequest` through that member. `REQUEST_SIZE_SINK_KEY`, `RequestSizeSink`, `reportRequestSize` and the `isRequestSizeSink` runtime type check in `logging/requestSizeReport.ts` are deleted; the integer check (`Number.isSafeInteger`, non-negative) moves into the single caller that invokes the callback.
- Each provider invokes it exactly once per attempt, after planning and before the first byte is written, with `contentLength`. A route with no HTTP Content-Length (WebSocket) reports the byte length of the message it sends, which is the sum of its fragments (7.3).

The existing expectations in `LoggingProviderWrapper.requestSize.test.ts` (`request_chars` 48213 and the per-request series) stay as they are.

## 12. What gets deleted, by file

Paths are from this reading. The exact list is settled in each phase from the import graph, and a file is removed in the phase that removes its last importer (Section 14). "Replaced" means the file goes and a new module takes its role. "Reduced" means the file stays with less in it.

**`packages/core/src/recording`**
- Deleted with the JSONL reader and the fold: `journalCursor.ts` (and `MAX_RECORD_BYTES`), `journalResolver.ts`, `resolverProjection.ts`, `resolverScan.ts`, `resolverDiskIndex.ts`, `resolverIntervalIndex.ts`, `resolverReplayMetadata.ts`, `durableRowFold.ts`, `durableFoldCheckpoint.ts`, `durableDensityIndex.ts`, `mutableRowDirectory.ts`, `pendingRowFold.ts`, `pendingFoldSnapshot.ts`, `ReplayEngine.ts`, `replayMetadataFold.ts`, `replayCheckpointMetadata.ts`, `resumeCursorBoot.ts`, `appendedRows.ts`, `synchronousHistoryCursor.ts`, `synchronous-value-spool.ts`, `semanticPurgeRecordingRows.ts`, `semanticMediaPurgeReplayValidation.ts`, `metadataJsonLines.ts`, `metadataJsonProjection.ts`, `firstUserMessageScan.ts`, `recordingVersion.ts`, `replaceTransaction.ts`, `replaceWriteGuard.ts`, `chronologyBinding.ts` (the fields move into the row header, 2.4; there is no `bind` mutation).
- Replaced: the JSONL writer inside `SessionRecordingService.ts` (`enqueue`, `drain`, `writeBatchToFile`, the pre-content buffer, `initializeForResume`'s transaction parameter) by a group writer; `CommitAckRegistry.ts` keeps its role with `{commitSeq, durableEnd}`; `types.ts` loses `SessionRecordLine` and the per-record payload types, keeps session summary types; `rowOriginDictionary.ts` becomes the owner dictionary in the meta map.
- Reduced: `boundedSessionScan.ts`, `boundedHeaderReader.ts`, `SessionDiscovery.ts`, `resumeSession.ts`, `journalCounters.ts`, `CheckpointService.ts`, `checkpointJournalTransfer.ts`, `childJournal.ts`, `SessionTransitionService.ts` (they read a trailer and the meta map instead of scanning lines).

**`packages/core/src/services/history`**
- Deleted: `historyJournalFold.ts`, `historyJournalRecordScan.ts`, `historyJournalRowReader.ts`, `historyJournalRows.ts`, `historyJournalEnvelope.ts`, `historyRowOrigins.ts`, `historySharedRowIndex.ts`, `historyRepairIndex.ts`, `tool-pairing-index.ts`, `compression-span-index.ts`, `historyResumeProjection.ts`, `provider-curated-stream.ts`, `provider-normalization-disk.ts`, `provider-normalization-storage.ts`, `provider-request-snapshot.ts` (its selection and snapshot types move to the new pin), `stageRowLog.ts`, `tailBufferedFile.ts`.
- Replaced: `cloneHistoryJournal.ts` (streaming clone, Section 4.8), `attachHistoryJournal.ts` (seed and bind, Section 5.3).
- Reduced: `historyJournalStore.ts` (it becomes the façade over the writer and the pin; no fold, no overlay, no `foldCheckpoint`), `HistoryServiceCore.ts` (`prepareCuratedForProviderSnapshot` returns a pin), `historyRecorderFanout.ts` and `historyFanoutFeed.ts` (group deltas), `detachedHistory*.ts` (a candidate becomes a group builder that streams rows to the writer; `replacementDurable` and `compensate` go), `historyMutationSnapshot.ts` and `historyDensityRows.ts` (scratch copies replaced by `restore(version)`), `historyTokenEstimation.ts`.

**`packages/providers/src`**
- Deleted with the send paths (phases 6a to 7): `utils/wire-body-spool.ts` and its test, `utils/keyed-row-tool-id-store.ts`, `utils/requestScopedBody.ts`, `runtime/responses-tool-pair-index.ts`, `openai-responses/responses-websocket-frame.ts`, `runtime/prompt-estimator-files.ts`, `runtime/prompt-key-tee-writer.ts`, `runtime/prompt-key-disk-writer.ts`, `openai/OpenAIChatEstimatorFiles.ts`, `anthropic/AnthropicEstimatorFiles.ts`, `anthropic/AnthropicSpooledRequest.ts` and `anthropic/message-table/recovery-images.ts` (replaced by the assembler and marker plan, Section 7.4). `anthropic/message-table/emit.ts` is not in this list: the retained oracle tests import it (`wireBuilderHarness.ts:20`, `emit.test.ts:3`), so it goes in phase 9.
- Deleted in phase 9, after phase 7 moves the dumps off them and the oracle tests are retired (14.3): `anthropic/message-table/message-table.ts`, `emit.ts`, `wire-builder.ts`, `validation.ts`, `finish.ts`, `cache-controls.ts`, `tool-id-index.ts`, `project-row.ts` and `utils/dumpScratch.ts`. The Anthropic dump modules import them today (`anthropicDumpRaw.ts:6,9`, `anthropicDumpStream.ts:6-9`, `anthropicDumpTable.ts:2`, `anthropicDumpChainResults.ts:15-16`, `anthropicDumpBlockValue.ts:4`), and so does the chat dump (`openAIDumpStream.ts:4` calls `streamChatMessages`, which uses pass 1 and `DumpScratch`, `OpenAIChatBodyBuilder.ts:19,203,222`). The dump modules themselves are replaced in phase 7.
- Kept: `utils/keyed-row-index.ts`, because Kimi file preparation still imports it (`kimi/kimiMediaProcessing.ts:15`, `openai/kimi-provider-file-preparation.ts:18`). It loses its other importers in phases 6a to 6c; phase 9 deletes it only if the import graph then shows none.
- Kept for the marker plan, because they own what a cacheable block is and what a block looks like with `cache_control`: `anthropic/AnthropicRequestBuilder.ts` (`selectLastCacheableBlockIndex` at line 230 and `sanitizeBlockForCacheControl` at line 101, which `cache-controls.ts` and `finish.ts:242` call today), and `anthropic/AnthropicAnchorCache.ts` and `anthropic/AnthropicMediaPurgeCache.ts` (the anchor tag and purge evidence types that `message-table.ts` imports; `AnthropicRequestPreparation.ts` imports them for the non-table route). Phase 6c recomputes from the import graph whether the last two lose their only importer.
- Deleted with the staging model (Section 7.5): the staging half of `utils/requestRowsLease.ts` (`acquireRequestRows` and its scratch-disk copy of a one-shot stream) and `loadBalancing/stagedCallOptions.ts`. `utils/providerRows.ts` keeps the count check and wraps a `RowSource`.
- Reduced: `openai/OpenAIRequestPreparation.ts` (no spool, no estimate or dump files), `openai/OpenAIChatBodyBuilder.ts` (no pass 1), `runtime/responses-source-input.ts` and `responses-source-serializer.ts` (no pair index, no `unsupportedPath` file; the dangling scan and `cancelledResponses` stay and run only for a source that is not journal history, 7.3), `openai-responses/openAIResponsesWebSocketTransport.ts` (`ws` in place of the undici `WebSocket`, fragmented send, 7.3; `packages/providers/package.json` gains `ws` and `@types/ws`), `openai-responses/OpenAIResponsesProviderCore.ts` and `openAIResponsesExecutor.ts` (the `rejectedStatefulParents` Set is replaced by the on-disk rejection table, 3.5), `utils/envelope-writer.ts` (kept; only its sink changes), `logging/requestSizeReport.ts` (only `RequestSizeSink`'s typed replacement remains), `LoggingProviderWrapper.ts`.

**What remains on scratch disk, and why.** Of the 31 non-test scratch users, about 21 are removed or reduced to no scratch by the lists above. The other ten stay on the process-owned root and its exit sweep, and none of them runs on an ordinary send:
- `agents/src/compression/toolResponseDiskRanking.ts` and `densityDiskIndex.ts` are constructed only when a compression run happens (`toolResponseDiskRanking.ts:304`, `diskDensityOptimization.ts:73`, `highDensityDiskPlan.ts:160`). A send below the compression threshold creates neither.
- `agents/src/core/source-before-model-hook.ts` reaches `getScratchRoot()` only after it has found a registered BeforeModel hook (Section 15.1).
- `storage/history-media-index.ts`, `storage/media-metric-byte-index.ts`, `recording/recording-failure-report.ts`, `cli/src/ui/stores/turn/journal-page-file.ts`, `cli/src/ui/utils/toolResponseIndex.ts`, `providers/src/composition/runtimeTokenizerFactory.ts` and `scratch-root.ts` itself are not part of the send path.
They are not moved to the journal in this PR: moving them is not needed for any fixed decision, and the temp-directory test (13.3) runs below the compression threshold and with no hook. Defect #7 is fixed for the send path and the history store.

The bare history store (no session file) uses an unlinked file: the file is created, opened and unlinked at once on POSIX. On Windows it is opened with `fs.constants.UV_FS_O_TEMPORARY`, which the Node `fs` documentation lists as a Windows-only flag that deletes the file when the last handle closes. The constant is absent from `fs.constants` on macOS and Linux (checked on this machine), so the code reads it from `fs.constants` and throws if it is undefined on `win32`. The Windows runner test (15.2 risk 9) is what proves it under Bun. No directory is created, so there is nothing for a killed process to leave behind.

## 13. Test and proof plan

All tests are TypeScript with `bun test`, per the repository rule. Test-side models (an in-memory array model of history, for example) are allowed to hold whole histories because they are not product code.

### 13.1 Byte identity

1. `wireBodyGolden.test.ts` and `fixtures/wire-bodies` run unchanged. The fixtures are not regenerated. The test records Content-Length only as `present` or `absent` (`contentLength: 'present'` in `wireBodyGolden.test.ts`), never its value, and the filter declares an exact length on every HTTP route, so the recorded behavior does not change. The exactness of the value is checked by item 5.
2. The frozen wire corpus of phase 0 (5,000 seeds per provider format, hash and byte length of today's bodies) runs against each new send path. For Anthropic the histories include raw ones, because the table's validators are exercised by duplicate ids, orphans and displaced calls, and the harness writes each seed's history into a journal and runs the assembler without core normalization for those cases. The old table code is not used as an expected-value generator after phase 0. `message-table-golden.test.ts` (600 `/dump` cases) and `message-table-scale.test.ts` stay on their dump and growth semantics and are not part of this item.
3. Stage A differential: for the corpus histories and for generated sessions (append, pop, compress, density, insert, purge, media, tool pairs, duplicates, orphans, displaced responses, empty ids, call blocks in human and tool rows, tail rows), and the explicit cross-speaker control `[human(text q, call a), ai(call a)]`, whose synthetic response attaches to the human call (6.2 R4), the new unit stream equals the unit stream that `prepareProviderContentSnapshot` returns today: deep equality of every unit and of `count`, `pending.firstOutputIndex` and `isPending`. This test runs while the old normalizer is still in the tree (Phase 5). Before the old code is deleted, the unit streams of N seeds are frozen as SHA-256 of their sorted-key JSON in a fixture, so the oracle survives the deletion. The frozen fixture is generated from the old code in the same commit that freezes it and never regenerated.
4. Stage B: each builder (chat, Responses, Anthropic) fed a given unit stream produces the bytes the current builder produces for that stream. The existing builder-level tests and the `providerBodyEquivalence.p05b4.test.ts` independent eager reference stay.
5. Lengths: for every corpus case and route, `contentLength` computed from the composed summary equals the byte count of the produced body, for each combination of the stored variants (`none`, `all`, last kept; reasoning included or not). The stream guard raises the same comparison at run time. The prototype's controls are part of the test and must fail as designed: the old run monoid gives equal fields and different lengths (411 against 461 bytes) on the twelve-row counterexample, a summary without the repair overlay is wrong, and the single-unit last-kept substitution is wrong when the last group is a chain.
5a. Transfer summaries: composition is associative at every split point and on random tree shapes, the state sets are closed (a unit step from a state in the set lands in the set, checked by assertion), and composing in tree order equals the sequential run. A raw-history thinking chain that carries tool results is outside the model and must throw (7.4).
5b. Media and PDF metrics: normalized-selection media (inline, referenced and URL blocks, a repeated reference counted per selected occurrence, a three-byte reference counted as four), PDF disabled, PDF in an ignored or stripped block, and PDF emitted, for each format (8.4).
5d. Purge boundary overlay (7.4): an Anthropic corpus with a boundary at each of these: a string-content message, an array block, a block inside a merged run, a first block of a message whose previous cacheable block is in an earlier message, a message with no cacheable block before the image; no image; two boundary tags (none applied); all three breakpoint slots in use (skipped); a block that already carries `cache_control` (`reused`); cache off, 5m and 1h. The planned length equals the written bytes, the `preparation` evidence equals what `attachMediaPurgeCacheControl` returns, and a control that ignores the breakpoint limit must fail. It runs in the phase 0 oracle first.
5c. Prototype controls (r2), each part of the committed test and each required to fail: the Responses pair shortcut (wrong in 2,312 of 10,428 cases), a cursor after the whole parent row (191 of 191), a parent lookup by exact recorded URL (374 of 1,200 histories), reuse of whole-history pair answers for a stateful send (87 of 457), a raw-id lookup for the Anthropic orphan filter (627 of 800 histories), R4 limited to AI parts (595 of 3,000) and R3 tested against `C(X)` (168 of 3,000), and for Kimi the own-name prefix (454 of 640), the last raw occurrence's name (87), no exception list (416) and an AI-only block count (114). The fact models are wrong in 0 of each.
6. Claim checks inside the corpus run: on every history through a pin, over the unit stream, `findDanglingCalls` is empty and every non-empty call id has a response (Section 7.3), and `Rt`/`C`/`Ca` rules R1 to R3 agree with the old stages' keys (`seen:`, `responded:`, `call:`). For a source that is not a pin the old scan runs and the claim is not made.
7. Dangling-call golden (finding 7 of the golden review). (a) The three fixtures `orphan-tool-call`, `displaced-tool-result` and `responses-stateful-parent` run unchanged through the raw `stream` and `rows` sources and keep their frozen `'Tool execution cancelled by user'` bytes (295, 675 and 263 input bytes). (b) The same three histories are written into a journal and sent through a pin; the expected input is today's normalized-stream output (`"output":"null"`; 267, 647 and 235 bytes, prototype `goldendangle.ts`), added as new cases and not by regenerating (a). (c) A send-path classification test lists every non-test call site of `generateChatCompletion` under `packages/agents` and `packages/core` and asserts that each is declared as one of: normalized through `prepareCuratedForProviderSnapshot` (`streamDiskSource`), a source that is not journal history and may carry raw rows (hook replacement, direct messages), or sanitized to text (compression prompts, `sanitizeHistoryForCompression`). A new call site fails the test until it is classified. (d) A behavior test sends a history with an unanswered call through a pin and through an unnormalized `RowSource` and asserts the two outputs of (a) and (b).

### 13.2 sendPeak and R3 traps still fail

The existing `sendPeak.*` suite runs against the new send path: `sendPeak.trapArray`, `trapEstimate`, `trapEstimateAnthropic`, `trapFill`, `trapRetain`, and the shape tests (`sendPeak.openaiChatTextOnly`, `responsesDiskText`, `anthropicToolHeavy`). Each trap is a control that deliberately retains or buffers what the product must not, and the suite asserts that the trap fails its predicate. After the migration:
- every trap is kept and must still fail when its leak is injected into the new code path (trap placement is updated to the new module names, the predicate and thresholds are not touched, and the 1 MiB retention allowance stays);
- the repeated-turn retention proof from `finish-plan.md` R3 (many sends with compression, with a retaining control evaluated by the same predicate) runs on the new path;
- two new traps: a control that builds a `Map` keyed by id inside the unit generator, and a control that creates a scratch file during a send. The first must fail the flatness check (13.4) and the second the temp-dir test (13.3).

### 13.3 No temp directory during a send

A test points `TMPDIR`, `os.tmpdir()` and the scratch root at an empty directory it watches, then runs a send for each route with histories that include tool calls, orphans, media and a tail. It asserts:
- `getScratchRoot()` was not called (module state is still unset);
- no call to `mkdtemp*`, `mkdir`, or `open` with a write flag happened during the send, other than appends by the journal writer for a fill group (observed through `spyOn` on the `node:fs` and `node:fs/promises` namespaces, installed in the test only; on Bun 1.3.14 a spy on the namespace sees calls made through named imports, which was checked with `mkdtempSync` and `fs/promises` `mkdtemp`);
- the watched directory is empty afterwards, and the journal directory contains only the journal file (and the checkpoint versions inside it, 4.11);
- in the common case (all slots filled) the journal file did not grow during the send.

A second test starts a send in a child process, kills it with SIGKILL mid-stream, and checks that no `llxprt-scratch-*` directory exists afterwards (defect #7). A third creates a bare history store, appends, closes, and checks that no directory was created.

### 13.4 Heap census and memory flatness

Bun 1.3.14's `bun:jsc` exports `heapStats` and `heapSize` but no heap snapshot function, so the census does not walk collections. It uses what exists: the WeakRef cohort census in `packages/agents/src/core/__tests__/support/streamprocessor-retained-census.ts` counts live `IContent` rows and fails when more than a small constant are alive (the current row, the look-ahead, and the rows of one adjacent unit). `heapStats().objectTypeCounts` (container objects by type) and `heapSize()` are sampled after the send has produced half of its bytes. A history-sized `Map` shows up in `heapSize()` growth across the three row counts below, which is the check that catches it.

The same test runs at 10,000, 100,000 and 1,000,000 rows (built with the bulk builder so test setup stays cheap) and asserts that peak heap during the send differs by less than 1 MiB across the three sizes, which is the "flat curve" check for the depth term. The control from 13.2 that builds a per-id map must fail this test.

### 13.5 Reproductions of the defects

Each defect gets a test that fails on the current code and passes on the new code.

| # | Test |
|---|------|
| 1 | Hold the ack of a replacement's trailer. Assert the replacement is not reported durable and the compensation path chosen on failure is `restore(version)`. Simulate a crash by truncating the file at every byte offset inside the group: opening always yields the previous version or the full new one, never a mix. |
| 2 | Build two rows with the same chronology `seq` (a self-merge), pop to the second row's label, and assert exactly the rows from that label are removed. |
| 3 | Drive a disk-density result that changes 3, 64, 65 and 5,000 rows (the `preferDetachedReplay` path in `planHistoryMutation.ts` switches at more than 64 changed rows) across two agents. Assert that each mirror holds only its own rows and the unowned ones, and that the counts agree across the four sizes. |
| 4 | Change a row's owner after it is written. Attach a second agent. Assert the mirror holds the row by its current owner. |
| 5 | Write rows of 17 MiB, 40 MiB and 200 MiB. Reopen. Read them. Assert the send refuses an over-limit body at planning with the envelope error, and a 40 MiB row is sendable. |
| 6 | Create parent rows, compress so they close, and assert the parent lookup returns the head of the current version. Pop and assert the previous head is back. Written against the old code first (phase 6b). If it passes there, the defect is removed from 1.1. |
| 7 | 13.3. |
| 8a | A history with 100,000 unanswered calls: heap flat across sizes, no `Set` or `Map` growth. |
| 8b | A history with 10,000 consecutive assistant rows merged into one message (thinking chains): heap flat. |
| 9 | A history with many large media rows: assert at most one unit's media is resolved at any time (a counter on the resolver) and that the high-water mark of resolved bytes equals the largest unit. |
| 10 | The rejected-parent tests of 13.6: heap and preads flat over 10,000 distinct rejections, selection equal to the old Set, the cross-store and unchanged-key retry cases, `clearState()` forgets. |

### 13.6 Format and mutation tests

- Old-format refusal: a JSONL file, a file with the wrong magic, and one with the wrong version each fail with the message in Section 2.1, and discovery lists them as unreadable.
- Torn tail: truncate a journal at every byte offset of the last N groups. The opened state equals the last whole trailer at or before the cut (a cut inside a trailer, a node or a row leaves the trailer frame invalid or missing, which is the only case that falls back). Flip every bit class of a trailer, a node and a row header and check that the CRC catches it.
- Flush order: a spy on the writer's file operations records the writes and `flushRecords` calls of each group. Every trailer write follows the `flushRecords` of its group's records, and a failing flush writes no trailer and poisons the writer (Section 4.1).
- Mutation boundaries are durable before the next request (4.1, 15.1): the writer takes an injected flush function that counts its calls and records the last acked `commitSeq`. The test drives four boundaries: one tool round through `ChatSession.recordCompletedToolCalls` (one group), the todo-pause path through `recordCompletedToolHistory` (two groups), an IDE context row injected by `_injectIdeContext` and a directory context row from `client.addDirectoryContext` (one group each), and a turn committed by `commitTurnHistory` (one `addBatch`). A stub transport records, when each request starts, the flush count and the highest acked `commitSeq`. The assertions are that each boundary's groups are flushed and acked before the request that follows them starts (the flush count has risen by the number of groups the boundary writes), and that a fresh reader opened on the file sees them. Controls that must fail: a version that defers the eager tool-result group to the next response group, and a version that acks the group before its flush.
- Crash after an eager tool-result commit (4.1, 15.1): a child process runs a tool round through a pinned send. Its stub transport sends `SIGKILL` to the child when the next request's first call begins, which is after the eager group's ack and before the response stream starts. The parent process opens the journal and asserts that the last valid trailer holds the tool result with its call id and bytes, that no row of the killed response is present, and that a resumed send carries the tool result exactly once (no duplicate from pending input).
- Full flush (Section 15.1): on darwin, `flushRecords` calls `fcntl(fd, F_FULLFSYNC)` and no weaker call. Every runner checks this through an injected flush function that records the call it would make: `F_FULLFSYNC` on darwin, `fdatasync` on Linux, `FlushFileBuffers` on Windows. The macOS runner also spies on the `bun:ffi` `fcntl` symbol and asserts that the real call carries `F_FULLFSYNC`. With the spy returning -1, `flushRecords` throws, the group gets no trailer, the writer is poisoned, and no plain `fsync` follows. The control is a `flushRecords` that retries with `fsync` after an error, which must fail the no-fallback assertion.
- Mutation model test: random sequences of append, pop, compress, density, insert, purge, owner change, clear, replace, clone, restore and compaction, with a test-side array model. After each step, compare the trailer aggregates, the full unit stream, the fact for every id, and the Content-Length against the model.
- Pop: against the naive model, including pops that land inside a group, pops below a lineage start, and pops after a self-merge.
- Write amplification budget: bytes written per commit group at 1k, 10k and 100k rows. A group with one appended row and one id writes at most 72 KiB at 100k rows (the layout gives about 64 KB, Section 3.2). A group that also changes a second leaf, as a response arriving for an earlier call row does, writes at most 128 KiB (the layout gives about 120 KB). Smaller row counts have lower limits from the same formula. If the budget fails, arity 4 is measured before any other change (3.2).
- Slot components: after an image-budget change only the image-dependent component is missing, and the fill touches only entries with an image contribution, with a free slot and with a slot that is evicted during recovery. Relocated tool media, both slot cases: an AI call row with no image of its own and a following tool result X with an image; the smaller budget changes the call entry's summary, `imageChars` and wire bytes, and the sent bytes and Content-Length equal today's `sanitizeTableImages` output (the tool entry is not the one that is filled; a trap that descends on the source `ROW` flag must fail it). After a change of the base key everything is missing and the fill is complete. `missingBase` and `missingImg` are both zero before a send (8.5).
- Compaction (4.11): the trigger fires at the stated ratio and not before; the copy of a history with two checkpoints reproduces the current version and both checkpoint versions (aggregates, unit streams, facts, state maps); a crash at every step of the compaction (before the `.compact` file is complete, after it is complete, after the rename) opens to a valid state; a stale `.compact` file is removed on open; a pin held during the trigger defers compaction. The refused rename is the swap test below.
- Occurrence and parent chains: after compress, density, purge and pop, the chains read back equal a chain recomputed from the rows (the case that a link stored in an immutable row would get wrong).
- Meta split: a pop keeps a checkpoint, a rename and owner dictionary entries made after the popped-to version.
- Lineage: a pop across an owner change or a synthetic insert is a rebuild and keeps the owner change and the inserted row.
- Kimi and Mistral ids: after compress and density, the mapped ids equal what the current `ToolIdStrategy` code produces for the surviving rows, including a Mistral salt collision whose first holder was removed (the stale mapping must differ, as in the prototype). Kimi: a later eligible duplicate with another name (the earlier rows' prefix is re-measured), an unnamed duplicate that must not overwrite the mapping, an eligible call block in a human row, a reconstructed call, digit boundaries at 9, 10, 11, 99, 100 and 101, and a counter that crosses a boundary; a tail eligible duplicate with a different name that changes the prefix of earlier call rows in two journal rows and of their response rows; and the normalized dropped-output control `[human(text q, call X), tool(response X), ai(call Y), tool(Y)]` (`followup-kimi-control.out:26-29`), where the digit total is 2 for Y's two written uses and not 3, with an unmapped dropped response added to check the counter.
- Large row header (2.2, 2.4): a `ROW` with 100,000 blocks and 100,000 ids (a 4,300,064-byte kind header) round-trips through the frame with every block, id and id-piece entry intact, and a 64 MiB body behind that header streams with heap growth below 16 MiB on both write and read. A control that buffers the body must fail the heap bound.
- Format tables (2.7): the codes and field offsets in the code equal the tables of 2.7, which the test reads from this document.
- Id piece: ids of 0, 1, 12, 40 and 100,000 bytes round-trip; a rebuild of ordinary rows issues one `pread` per row; the normalized-id namespaces and the Mistral mappings after a rebuild equal those built by appending.
- Rejected parents (finding 4): (a) over 10,000 distinct rejections on one provider instance, heap is flat across the number of rejections and the number of rows, the `pread` count per lookup is flat, at least one rehash ran, and a trap that keeps a `Set` of rejected ids fails the same heap predicate; (b) the selected parent equals the selection of the old in-memory Set on random histories with random rejection sequences, while the old code exists (phase 6b); (c) cross-store: reject parent P in a send through store A, then send through store B, a different journal holding a row with the same response id and the same provider instance, and B skips P; a non-journal call on that instance skips it too; (d) unchanged-key retry: after a rejection the retry with an equal format key gets the same pin from `pin.refresh(key)` and still selects the next candidate; a trap that caches the chosen parent in the pin must fail; (e) a pop keeps the rejection; `clearState()` forgets it and deletes the file; disposal deletes the file; a second provider instance and a resumed session start empty; no file exists before the first rejection and exactly one exists after any number of them; (f) a failed slot write fails the turn.
- Codex WebSocket fragments (phase 6b): against a local `ws` server, a body of several `fin: false` frames and one `fin: true` frame arrives as one binary message with the exact bytes; a 200 MiB body streams with heap flat; a byte-count mismatch terminates the socket before the final frame; a close in the middle delivers no message. A live smoke against Codex sends one fragmented request. A rejection of fragments raises the dedicated error and is not absorbed by the sticky HTTP fallback.
- Anthropic `repairAdjacency` consumption (phase 6c): histories with one id on several calls in one assistant message and across several messages, whose next message lacks the result, compared with the table, including the control that must write ONE, ONE, TWO (a per-call pointer fails it), results in human rows (raw histories), later messages seeing moved results, and a flat heap with no per-id map.
- Dump: `/dump` output through the new filter equals the current dump bytes (`dump-stream-parity.test.ts`, `dump-golden.json`).
- Root corruption (Section 3.1): flip one bit in each of the four roots of the latest trailer, leaving its frame intact. Open throws `JournalCorruptionError` naming the root's offset, and the file is not truncated. The same flip under an older trailer that no open reaches does not throw. Truncating the latest trailer itself opens at the previous trailer. A control that falls back on a bad root must fail the first assertion. Lost node (risk 10 in 15.2): zero one row record and one tree node that the latest trailer reaches, keeping the trailer frame intact, which is what a drive that dropped an accepted write leaves behind. A read that reaches the zeroed record throws `JournalCorruptionError` naming its offset, and nothing is truncated. A control that skips the CRC check on rows must fail this assertion.
- Offset audit and relocation (4.8): after every clone and compaction, walk the new file and assert that every field in `OFFSET_FIELDS` points at the start of a record of the expected kind that was written earlier in the same file, and that no field of the source file's layout survives (the source file is deleted before the audit). Cases: Mistral clone with a salt collision, so `mappedRef` is exercised, and the mapped ids read from the clone equal the real mapper's; a clone of a subset of rows rebuilds its Mistral mappings from the id pieces; a checkpoint restore (clone of the saved version into a child file) before a compaction and again after it gives child files with equal rows, facts, owner dictionary and start and fork metadata; owner identity after compaction: rows owned by two agents and unowned, an owner change before the compaction, the same origin strings behind the same owner ids in the current version and in the restored checkpoint.
- Compaction memory with growing checkpoints (4.11): checkpoint counts of 1, 10, 100 and 1,000 created while history grows from 1k to 100k rows. Peak heap of the compaction differs by less than 1 MiB across the counts, and the output file holds each shared record once (its size is below live bytes plus the per-version deltas plus the relocation slack). A control that copies each version in full without the relocation trie must fail the size assertion, and a control that keeps one builder per version must fail the heap assertion.
- Swap state machine (4.11): through the injected `fileOperations`, refuse the rename with `EPERM` after both descriptors have been closed (asserted by the order of recorded calls). Then do a real append through the writer and a real read through the shared descriptor, and reopen the file independently to see the appended group. The candidate is gone, the published `fileId` is the old one, and the trigger is re-armed for 16 MiB. Variants: `EIO` from the rename restores the descriptors and rethrows; a failing reopen of the old file poisons the writer with both errors; a failing reopen after a successful rename poisons the writer; on `windows-latest` a child process holds the file open without share-delete and the real refusal is exercised.
- Owner-change fan-out (5.2): three mirrors A, B and C, and the four transitions of the table in 5.2. Each mirror ends equal to the filtered primary (same labels, same `ROW` bytes), exactly the mirrors in the table receive a delta, and the unchanged case writes nothing to any mirror file.
- Mirror recovery (5.2): truncate the primary's last trailer with the mirror intact (mirror ahead), truncate the mirror's last trailer (mirror behind), and truncate both, then commit a different group on the primary so it reuses the `commitSeq` of the lost one. Each case resynchronizes the mirror to the accepted subset of the primary; equal pairs write nothing. A control that compares `commitSeq` only must fail the sequence-reuse case.
- Blob lease (10.1, 10.3): a `LocalMediaStore` on a temporary root and a session with three media rows. Start a pinned send against a transport that fails its first attempt. While it is in flight, clear the history (the ownership diff releases all three blobs) and run `store.reclaimUnreferenced(new Set(), now)`. Assert that all three objects remain, retry on the same pin, and assert identical bytes and Content-Length. Release the pin, assert the `rel` queue is empty and the reservations are gone, and run `reclaimUnreferenced` again to assert that the three objects are now removed, so the deferral cannot hide a blob forever. The media-store directory (objects, reservations, instances, temporary files and the lock file) is listed before and after and observed through `spyOn` on `node:fs` and `node:fs/promises` during both attempts: no file is created, renamed or unlinked there, apart from `utimes` on the instance lease. Controls that must fail: releasing immediately (the retry hits `MediaObjectMissingError`), and reading with `reserveAndReadVerified` per unit (the audit sees reservation files). A further case drops a blob and brings it back through restore while a pin is live, and the drain leaves it reserved. A janitor run over a project directory containing the `.llxj` file finds the content ids of its rows.
- Telemetry: `request_chars` equals the declared length on every corpus case.

## 14. Implementation phases

### 14.1 Rules that apply to every phase

- Every phase ends with the full verification cycle green: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and the startup smoke test from the issue workflow skill.
- Every phase ends with the byte corpus identical. `wireBodyGolden.test.ts` with `fixtures/wire-bodies`, the phase 0 frozen wire corpus, the dump golden and `providerBodyEquivalence.p05b4.test.ts` run unchanged. No fixture is regenerated by an implementer. A fixture that must change is reported to the owner.
- Phase 0 is committed before anything is deleted. A builder is not removed until the frozen corpus passes on its replacement.
- The old implementation of a behavior stays in the tree, and keeps running, until the new implementation of that behavior is byte-identical on the whole corpus and the differential tests. Old code is deleted in the phase named below, never earlier.
- A test that asserts the JSONL layout is deleted with the layout. A test that asserts behavior (rewind removes rows, replace is atomic, resume restores history) is ported to the new store API with its assertions unchanged. Weakening an assertion to make a port pass is not allowed.
- LoC figures are rough magnitudes of non-test source lines. Deleted figures come from `wc -l` on the files named in Section 12 as of this reading. Tests are extra.

### 14.2 Existing tests that stay as oracles throughout

| Oracle | What it fixes | Stays until |
|--------|---------------|-------------|
| `wireBodyGolden.test.ts` and `fixtures/wire-bodies` (7 route files plus manifest) | exact request bytes and Content-Length behavior for chat plain, Kimi, Mistral, Responses, Responses via OpenAI, Anthropic cache off and 1h | never removed |
| `message-table/__tests__/wire-builder.test.ts` (700 seeded histories, 40 thinking-rich seeds under every reasoning setting), `wire-builder.cache.test.ts`, `emit.test.ts` | the table's output equals `convertToAnthropicMessages` on raw histories, with and without cache controls: duplicate ids, orphans, displaced calls, chains | until phase 9 deletes the table (the dump path imports it until phase 7); the expected-value role then rests on the phase 0 corpus |
| `message-table-golden.test.ts` with `fixtures/dump-golden.json` (600 cases) and `message-table-scale.test.ts` | `/dump` output with dump semantics (pretty-printed, dump-specific chain-result behavior); operation growth at 60 and 240 units. Neither is a wire oracle. | never removed; the dump fixtures keep their dump semantics and are not repointed at the wire assembler |
| `providerBodyEquivalence.p05b4.test.ts` | independent eager reference for the three builders | never removed |
| `sendPeak.*` (shape tests and `trapArray`, `trapEstimate`, `trapEstimateAnthropic`, `trapFill`, `trapRetain`) and the repeated-turn retention proof | memory behavior of a send, and that the traps still fail | never removed; trap placement moves with the module names, predicates and thresholds do not |
| `dump-stream-parity.test.ts` and `dump-golden.json` | dump bytes | never removed |
| `LoggingProviderWrapper.requestSize.test.ts` | `request_chars` values | never removed |
| History, compression, rewind, checkpoint and resume behavior tests at `HistoryService`, `SessionRecordingService` and agent level | mutation semantics | ported in phase 4, never weakened |
| The old normalizer (`provider-curated-stream.ts` and its disk helpers) and the old builders | the unit stream and per-unit bytes, as live reference code | phase 9, after the frozen fixtures exist |

Three oracles are created during the work and then also stay:
- the frozen wire corpus (phase 0): for each provider format, 5,000 seeds of hash and byte length of the body today's builders produce, plus the prototype's length checks as a committed test;
- the frozen unit-stream fixture (phase 5): SHA-256 of the sorted-key JSON of the old normalizer's unit stream for N generated sessions, produced from the old code in the commit that freezes it and never regenerated;
- the frozen mutation-sequence fixture (phase 4): for generated operation sequences, the labels and order of live rows after each step as the old fold computes them, produced before the old fold is deleted.

### 14.3 Order of phases and why

The new format cannot sit beside the old one inside one session file. So phases 1 to 3 build the new store as library code under a new directory, wired to nothing, and test it against an in-memory model. Phase 4 is the single cutover of the store. After phase 4 the old normalizer and old builders keep working because they read rows through an adapter over the new row tree. That adapter is the only piece of old plumbing that survives phase 4 and it goes in phase 9. This keeps the byte oracle alive until the end and means the provider phases change one route at a time.

**Deletion follows importers.** A module is deleted in the phase after which nothing imports it, and every phase is green because nothing is deleted while an importer remains. The `/dump` path (the chat dump and the Anthropic dump) keeps its own modules until phase 7 replaces it, and those modules keep the table alive. This is the same rule as "old builders stay as live references until phase 9": the table, the wire builder and the dump scratch are such builders, and phase 9 is where they go.

| Module | Importers after the send switches | Deleted in |
|--------|-----------------------------------|------------|
| `OpenAIChatEstimatorFiles.ts`, `keyed-row-tool-id-store.ts` | none after `OpenAIRequestPreparation.ts` and `OpenAIChatContinuation.ts` switch | 6a |
| `responses-tool-pair-index.ts`, `responses-websocket-frame.ts`, the `rejectedStatefulParents` Set | none | 6b |
| `AnthropicSpooledRequest.ts`, `AnthropicEstimatorFiles.ts`, `recovery-images.ts` | none | 6c |
| `wire-body-spool.ts` | `OpenAIApiExecution.ts`, `OpenAIChatContinuation.ts`, `OpenAIRequestPreparation.ts` until 6a; `AnthropicApiExecution.ts`, `AnthropicSpooledRequest.ts` until 6c | 6c |
| `streamChatMessages` pass 1 and the `DumpScratch` use in `OpenAIChatBodyBuilder.ts`; `openAIDumpStream.ts` | `/dump` (`providerRequestConversion.ts:11-12`) | 7 |
| `anthropicDumpRaw.ts`, `anthropicDumpStream.ts`, `anthropicDumpTable.ts`, `anthropicDumpChainResults.ts`, `anthropicDumpBlockValue.ts` | `providerRequestConversion.ts:12` | 7 |
| `message-table.ts`, `emit.ts`, `wire-builder.ts`, `validation.ts`, `finish.ts`, `cache-controls.ts`, `tool-id-index.ts`, `project-row.ts`, `dumpScratch.ts` | the dump modules until 7 (not `emit.ts`), then only the oracle tests (`wire-builder.test.ts` and its cache and emit counterparts; `emit.ts` through `wireBuilderHarness.ts:20` and `emit.test.ts:3`) | 9 |
| `keyed-row-index.ts` | Kimi file preparation (`kimiMediaProcessing.ts:15`, `kimi-provider-file-preparation.ts:18`) | stays unless 9 finds no importer |

The new assembler (6c) and the new chat filter (6a) import none of the retained modules, so deleting them in phase 9 touches no new code.

One interim step needs a note. Between phase 6 and phase 7 a switched route computes Content-Length by running the filter twice, once into a byte counter and once to the socket. Prompt estimates and dumps likewise run the filter once more into the tokenizer projection or the pretty printer, with no file. No file is written and no memory scales with history, but the length is a counting pass, which the owner's rules rule out as a final state. Phase 7 replaces these passes with stored values. These are commits inside one PR. The PR does not merge before phase 9, and the `sendPeak` and temp-directory tests pass in phase 6 with the interim passes in place.

### Phase 0. Freeze the wire oracle

Built (test code only; no product code changes and nothing is deleted):
- A corpus generator: 5,000 seeds for each provider format (chat plain, Kimi and Mistral; Responses, both routes; Anthropic cache off, 5m and 1h). Histories come from the existing support generators (`wireHistory`, `randomHistory`, `cacheHistory`, `seededHistory`) and settings from a `settingsFor(seed)` style draw, one draw per seed.
- A fixture of the SHA-256 and byte length of the body that today's builders produce for each (format, seed), generated in one commit from today's code and never regenerated. Bodies are not stored.
- A committed oracle test that replays the corpus through the send path and compares hash and length with the fixture, and runs the length checks of the prototype: unit facts to transfer summaries to predicted length equal to the frozen length; associativity at every split and on random trees; closure of the state sets; the negative controls (the old run monoid, no repair overlay, the old single-unit last-kept substitution, and the r2 controls listed in 13.1 item 5c), each of which must fail; and the out-of-domain filter, which must throw.

- Explicit counterexamples, each a named case in the frozen corpus with the output of today's builder as its expected value (hash and bytes, or the unit stream for normalizer cases), and each also required to fail under the wrong rule that the review named:
  - Anthropic ordering: a merged assistant message with a tool use followed by later text and a result that exists later (tool use stays before text); the interrupted-result case `[human q, AI call X, AI text after]`; the 12-row pair that writes 411 and 461 bytes; the A/B anchor example; `[human q, AI thinking(first), AI thinking(second)+text]` under `allButLast`.
  - Anthropic repair: two calls of one id in one assistant message with later results ONE and TWO (writes ONE, ONE, TWO); a result in a human row; later messages seeing moved results; raw ids `hist_tool_X` against `toolu_X`.
  - Normalizer: `[human(text q, call a), ai(call a)]` (synthetic response at the human call); `[human(text q, call X), tool(response X)]`; a call in a human row with its result.
  - Responses: call ids `''` and `call_` in one unit (263 bytes); a parent with a wildcard endpoint and one with a trailing-slash URL; a parent with an adjacent result (cursor after the unit); a parent with no following content; the 50,000,000-byte PDF threshold below and above, and PDF disabled; a rejected parent with a second source on the same provider instance.
  - Chat ids: the Kimi human-call dropped-output case `[human(text q, call X), tool(response X), ai(call Y), tool(Y)]`; a later eligible duplicate with another name, in the tail and in the journal, with earlier call rows in two journal rows; an unnamed duplicate; the Mistral salt collision whose first holder is removed (`4Uq1sY29c` against `4SftZvDMX`).
  - Images: an AI call with no image of its own and a following tool result with an image, under a smaller image budget.
  - Key inputs: two models of one class, two endpoints with the same media capabilities, and the OAuth tool-name transform.

Why. The oracles in 14.2 do not cover this. `wireBodyGolden.test.ts` has about 315 cases. `message-table-golden.test.ts` is a 600-case `/dump` golden with dump semantics and `message-table-scale.test.ts` measures growth at 60 and 240 units, so neither is a frozen wire corpus. The real Anthropic wire oracles are `message-table/__tests__/wire-builder.test.ts` and its cache and emit counterparts, which compare the table with the converter and lose their expected side when the table goes.

The prototypes live in `tmp/854-notes/r1-proto/` and `tmp/854-notes/r2-proto/`, which are untracked. Phase 0 promotes the r1 harness (`facts.ts`, `oracle.ts`, `model.ts`, `chat.ts` and the checks of `run.ts`, about 2k lines) and the r2 harness (`wire.ts`, `rmodel.ts`, `rgen.ts`, `rrun.ts`, `rstate.ts`, `pstate.ts`, `rpdf.ts`, `idfacts.ts`, `emit.ts`, `erun.ts`, `chat2.ts`, `mistral17.ts`, `goldendangle.ts`, about 2.7k lines) into committed tests next to the code they mirror. Every map in the r2 files that stands in for an index entry is labelled `STAND-IN` in its source and is replaced by the real index in the phase that builds it. The reference machine in `oracle.ts` is test-side code and may hold whole histories. From phase 6a on, the same test is pointed at the new send path of each format.

It also adds the purge boundary pass (7.4), which no prototype corpus covered: `oracle.ts` gains the purge pass and `run.ts` the cases of 13.1 item 5d. The pass is validated here, before any product code depends on it.

Defects closed: none. Size: about 5.4k test lines (4.7k promoted, 0.4k generator, 0.3k purge pass), 0 product lines.

### Phase 1. Format, framing, trailer, running state, old-journal refusal

Built (library under a new directory, not wired):
- file header, CRC-32 through `node:zlib` `crc32`, `fileId`, `syncMarker` (Section 2.1);
- frame codec with 64-bit body length and streamed body CRC (2.2);
- record kinds, the `ROW` codec with the id piece and the `TRAILER` codec with the running-state fields and `Aggregate` layout (2.3, 2.4, 2.5);
- last-trailer search: a 64 KiB window, then 4 MiB chunks backward that overlap by 12 bytes (3.1), and read-only open, with `JournalCorruptionError` for a bad root under an intact trailer and the `groupTag` field (2.5);
- `flushRecords` with its platform calls (15.1): `F_FULLFSYNC` through `bun:ffi` under Bun and `fs.fdatasync` under Node on darwin, `fdatasync` on Linux, `FlushFileBuffers` on Windows; an error throws and nothing falls back to plain `fsync`;
- group writer: positional writes at a tracked offset on a read-write descriptor, records first, `flushRecords` on the records before the trailer, trailer last, ack `{commitSeq, durableEnd}`, best-effort truncation of an uncommitted tail on owner open (4.1, 4.12);
- the refusal function and its single error message (2.1), plus a bare-store unlinked-file helper.

Deleted: nothing.

Defects closed: #5 at the format level (a row of any size round-trips). #1 is closed at the library level: the published state advances only in the trailer ack handler. Production still has defects #1 and #5 until phase 4.

Tests:
- JSONL file, wrong magic and wrong version each fail with the Section 2.1 message;
- rows of 17 MiB, 40 MiB and 200 MiB write, close, reopen and read back with CRC checks;
- truncate at every byte offset of the last N groups: the opened state is the last whole trailer at or before the cut;
- flip bits in header, frame, kind header, body and trailer: each is detected;
- root corruption under an intact trailer throws with the root's offset and truncates nothing, a truncated trailer falls back, and the fall-back control fails (13.6);
- a row body that quotes the `syncMarker` does not confuse the trailer search;
- the full-flush tests of 13.6 (darwin call, fail-fast on error, no fallback), and a check that the Node path on darwin also throws on error and does not retry with plain `fsync`;
- measurement of the flush cost per commit group (one `flushRecords` on a group's records, and two for a tool round) on the Windows runner and on both volumes of the macOS machine, under Bun and under Node, next to the numbers in Section 15.1;
- the file I/O rules of 4.12 on the Windows runner: positional reads during appends, truncate while a reader has the file open, `UV_FS_O_TEMPORARY` for the bare store.

Size: about 2k added, 0 deleted.

### Phase 2. Row tree, id trie, meta map, mutation primitives, commit groups

Built (library, not wired):
- `RTNODE` order-statistic tree with aggregates, entry layout, transfer-summary codec and composition (2.5, 8.2), right-spine append, bottom-up bulk builder, forward iterator that holds a path (3.2);
- `ITNODE` hash array mapped trie, fixed-size node cache, batched sorted bulk build, fact update rule with namespaces 0 to 5 (3.3);
- meta map (3.5): a versioned part and an unversioned state part;
- labels (2.6);
- append, pop with skip pointers, compress, replace, density, purge, insert, clear, owner change, fill, restore, checkpoint create, rebuild (4.2 to 4.9);
- streaming clone over one version, and serial memoized clone over several with the relocation trie (4.8), which is also the compaction copy (4.11); the `OFFSET_FIELDS` table in the record codec and the offset audit;
- commit groups with several primitive edits applied to a tentative state.

Deleted: nothing.

Defects closed at the library level: #2 (pop by label), #3 and #4 (owner is a required field of rows and entries; the production wiring is phase 3 and 4).

Tests:
- the mutation model test of Section 13.6: random sequences over all primitives compared with a test-side array model after every step (aggregates, unit stream of the raw rows, facts for every id);
- pop tests: inside a group, below a lineage start, after a self-merge with a repeated chronology `seq`;
- crash test: truncate at every offset inside a replace group;
- write amplification measurement at 1k, 10k and 100k rows, and iterator heap at 10k, 100k and 1M rows built with the bulk builder;
- transfer-summary codec: round trip of both layouts, and composition associative with identity on random summaries;
- a trap: an iterator that collects entries into an array must fail the flatness check;
- the offset audit, Mistral clone, checkpoint restore before and after a compaction copy, owner identity after the copy, and the compaction memory test with growing checkpoint counts (13.6).

Size: about 6.4k added, 0 deleted.

### Phase 3. Ownership and fan-out

Built (library, not wired):
- owner dictionary in the state map, owner required on every row-producing mutation (5.1);
- the group delta feed and label-addressed mirror application (5.2);
- late attach as seed plus bind under the mutation FIFO, using `ownerBloom` (5.3);
- owner change with per-mirror acceptance deltas (5.2, 5.4);
- the mirror version identity `{commitSeq, groupTag}` and resynchronization on any mismatch (5.2).

Deleted: nothing.

Defects closed at the library level: #3 and #4. The 64-row condition behind #3 is traced (Section 1.1), so the test reproduces the real path: a disk-density result that changes more than 64 rows.

Tests:
- Section 13.5 tests for #3 (3, 64, 65 and 5,000 rows, two agents) and #4 (owner changed after write, then attach);
- mirror equals the filtered primary after random sequences, using the model from phase 2;
- mirror labels equal primary labels;
- flush aggregates failures from several mirrors;
- the owner-change fan-out and mirror recovery tests of 13.6 (three mirrors, ahead, behind, sequence reuse).

Size: about 1.7k added, 0 deleted.

### Phase 4. Store cutover

Built:
- `HistoryJournalStore`, `SessionRecordingService`, resume, session discovery, checkpoint services, clone and attach, detached publication and compensation, and the recorder fan-out all run on the new library;
- the refusal is wired into resume and discovery, with discovery listing old `.jsonl` files as unreadable through `unreadableRecordings.ts`, and the extension constant of 2.1 replaces the seven `.jsonl` matchers;
- compaction (4.11): trigger, serial memoized copy over the checkpoint versions and the current version with their state maps, the swap state machine, and the stale `.compact` cleanup on open;
- `restore(version)` replaces `restorePrevious`; the "closed" flag advances from the trailer ack only;
- an adapter that gives the old normalizer and old builders their rows from the new row tree, so the old send path keeps working;
- a test that makes `historyResumeProjection.ts` binding unnecessary: rows carry chronology at write time, so no `bind` mutation exists (4.6).

Deleted (non-test lines, from Section 12): the JSONL reader, resolver and fold stack in `packages/core/src/recording` (about 7.1k lines), `historyRowOrigins.ts`, `historySharedRowIndex.ts`, `historyRepairIndex.ts`, `compression-span-index.ts`, `historyResumeProjection.ts`, `historyJournalFold.ts`, `historyJournalRecordScan.ts` and `historyJournalEnvelope.ts` (together about 1.5k), the JSONL writer parts of `SessionRecordingService.ts` (rewritten, about 1.2k lines in the file), and `pendingRowFold.ts` with the synchronous overlay in the store. The old normalizer and its disk helpers, `provider-request-snapshot.ts`, `tool-pairing-index.ts`, `historyJournalRowReader.ts` and `historyJournalRows.ts` stay behind the adapter until phase 9.

Defects closed in production: #1, #2, #3, #4, #5. #7 for the history store and resume (no fold scratch, bare store uses an unlinked file); the send path still uses scratch until phase 6.

Tests:
- the frozen mutation-sequence fixture is generated from the old fold before it is deleted, and the new store must reproduce it;
- all ported behavior tests, assertions unchanged;
- Section 13.5 tests for #1, #2, #3, #4, #5, including the replace-group truncation test and the 17/40/200 MiB row test through `HistoryService`;
- the whole byte corpus, unchanged, through the adapter;
- `sendPeak.*` and its traps unchanged.

Size: about 3.9k added, about 9k deleted. This is the largest and riskiest phase. If it is too large to review, it can split into 4a (store, recording service, resume and discovery) and 4b (checkpoint, clone, attach, detached publication), with the old fold deleted at 4b. The split point is the only part of phase 4 that may be made later without changing the design.

### Phase 5. Normalization facts and the per-row filter core

Built:
- `reconBlocks`, `answered` and the `A` recomputation hooks on append and on response arrival (3.3, 4.2);
- the unit generator implementing R1 to R8 and the emission order (6.2, 6.4), with the one-row look-ahead, `Ca(X)` orphan completion and adjacent units for parts of any speaker;
- the tail overlay and the pending computation (6.6);
- `RowStreamPin` with `units`, `readAt`, `count` and `aggregates` (7.1), and the pin lifecycle (10.1);
- the frozen unit-stream fixture generator.

Deleted: nothing. The old normalizer remains the reference.

Defects closed: none by itself. It is the base for #6, #8a and #8b.

Tests:
- stage A differential (13.1 item 3) while both implementations exist: the new unit stream equals the old snapshot stream, including `count`, `pending.firstOutputIndex` and `isPending`, on the corpus histories and on generated sessions with duplicates, orphans, displaced responses, empty ids and tail rows;
- the claim checks of 13.1 item 6 (rules R1 to R3 agree with `seen:`, `responded:` and `call:`; `findDanglingCalls` over the unit stream is empty);
- the unit-stream fixture is frozen and committed in this phase;
- heap census and flatness at 10k, 100k and 1M rows for the generator alone, with the per-id-map trap failing.

Size: about 2.5k added, 0 deleted.

### Phase 6. Per-provider filters

Each sub-phase switches one route's send path to the pin, deletes that route's spool, scratch indexes and estimator files, and leaves the other routes on the adapter. Order: chat, Responses, Anthropic. `wire-body-spool.ts` is deleted in the last sub-phase that imports it (6c). `keyed-row-index.ts` stays for Kimi file preparation and `dumpScratch.ts` stays for `/dump` until phases 9 and 7 (the table in 14.3). The `/dump` command and request dumps keep working through each sub-phase: a request dump of a switched route runs the new filter into the pretty printer, and `/dump` of history uses the retained dump modules.

**6a. OpenAI chat (plain, Kimi, Mistral).**
- Built: `prepareChatBody` over the pin; pass 1 replaced by aggregates; the id mappers of 7.2 (Kimi `Ke`, exception list, closed form and the re-measure when `Ke` changes; Mistral reassignment on rebuild from the id piece); the chat media-flush state and its fail-fast on a dropped tool message (7.2); `ChatContinuation` as a second run on the same pin; the interim counting pass for Content-Length.
- Deleted: `OpenAIChatEstimatorFiles.ts`, the spool and index use in `OpenAIRequestPreparation.ts` and `OpenAIChatContinuation.ts`, and `keyed-row-tool-id-store.ts`. Kept: `streamChatMessages` with its pass 1 and its `DumpScratch` use, because `/dump` still calls it (`openAIDumpStream.ts:4`); phase 7 removes them.
- Defects closed: #7 for chat sends.
- Tests: `openai-chat-plain.json`, `openai-chat-kimi.json`, `openai-chat-mistral.json` byte-identical, with one added Mistral case that has a salt collision, and added Kimi cases with duplicate call ids, a later eligible duplicate of another name and an unnamed duplicate; chat `sendPeak` shape tests; the temp-directory and no-scratch-call tests (13.3) for the chat route; chat continuation parity.
- Size: about 2.0k added, about 1.3k deleted.

**6b. OpenAI Responses (both routes, including the Codex WebSocket).**
- Built: pair tests answered by the namespace 1 facts with the stateful range correction on `pairSensitiveRows`; the parent lookup in the versioned meta map (wildcard and stripped-URL lists), the cursor after the selected AI unit and the no-following-content rule (7.3); the provider instance's rejection table with its lazy file, rehash and `clearState()`/disposal deletion (3.5); the `rs_` counter in stream order; the PDF aggregate check before the first byte, on the provider-effective metric (8.4); the 2-state Responses transfer summary and `LENS` facts (7.3); per-category unsupported-media counters; the `ws` transport with fragmented send (7.3), and the raw-row dangling scan restricted to sources that are not journal history (7.3).
- Deleted: `responses-tool-pair-index.ts`, the pin-path use of `findDanglingCalls` (the function stays for non-pin sources), the `unsupportedPath` file, the Responses use of `keyed-row-index.ts`, `responses-websocket-frame.ts` and the undici socket adapter, and the `rejectedStatefulParents` Set. The raw-row dangling branch is **not** deleted (7.3).
- Defects closed: #6, #8a, and #7 for Responses sends.
- Tests: `openai-responses.json` and `openai-responses-via-openai.json` byte-identical; the #6 test (close parents by compression, then pop); the #8a test with 100,000 unanswered calls; Responses `sendPeak` tests; the WebSocket fragment tests and live Codex smoke (13.6, 15.2 risk 7); the rejected-parent tests (13.6); the dangling-call golden tests (13.1 item 7); the stateful, PDF and id-fact controls of 13.1 item 5c. Defect #6 is first reproduced against the old code. If the reproduction passes on the old code, #6 is removed from the table in 1.1 and the version-scoped parent lookup stays.
- Size: about 1.9k added, about 1.4k deleted.

**6c. Anthropic.**
- Built: the assembler (conversion groups and chains, the validator passes in their order on overlay facts, merge and finish passes; group order kept, the leading-kind partition for merged messages only, four-kind passes inside chains only), the marker plan for cache control with anchor provenance and measured length deltas, the image component of the format key and its retry, the last-kept group cursors (7.4), the namespace 2 overlay facts and the `repairAdjacency` consumption walk without a pointer map (3.3).
- Deleted: `AnthropicSpooledRequest.ts`, `AnthropicEstimatorFiles.ts` and `recovery-images.ts` (about 0.3k lines), and `wire-body-spool.ts` once `AnthropicApiExecution.ts` no longer imports it. Kept until phase 9: `message-table.ts`, `emit.ts` (imported by `wireBuilderHarness.ts:20` and `emit.test.ts:3`, which stay live as oracles), `wire-builder.ts`, `validation.ts`, `finish.ts`, `cache-controls.ts`, `tool-id-index.ts` and `project-row.ts`, because the dump modules import them (`anthropicDumpRaw.ts:9`, `anthropicDumpStream.ts:6-9`, `anthropicDumpTable.ts:2`, `anthropicDumpChainResults.ts:15-16`, `anthropicDumpBlockValue.ts:4`) and the table oracle tests run against them. The assembler imports none of them.
- Defects closed: #8b, and #7 for Anthropic sends. The send path then has no scratch.
- Tests: the frozen phase 0 Anthropic wire corpus (5,000 seeds, cache off, 5m and 1h) driven through the new assembler; the oracle tests named in 14.2 (`wire-builder.test.ts` and its cache and emit counterparts) while the table exists; `anthropic-cache-off.json` and `anthropic-cache-1h.json`; Anthropic `sendPeak` tests including `trapEstimateAnthropic`; the #8b test with 10,000 merged assistant rows; image recovery retry test; the `repairAdjacency` consumption test of 13.6; the purge boundary overlay corpus (13.1 item 5d) against the assembler. The dump golden keeps its dump semantics and is not repointed at the wire assembler.
- Size: about 3.5k added, about 0.3k deleted.

**6d. Other consumers (Section 7.5).**
- Built: `RowSource` as the one history input type of a provider call; `historySourceOf` reads the pin for the Vercel provider and the Gemini plugin, which keep their SDK arrays by decision (#3869); the load-balancing wrapper passes the pin through; hook-replaced requests enter as a `RowSource`.
- Deleted: the staging half of `utils/requestRowsLease.ts` (226 lines) and `loadBalancing/stagedCallOptions.ts` (89 lines), after callers pass a `RowSource`.
- Tests: a test that `collectContents` over a pin is reached only from the Vercel provider and the Gemini plugin adapter; a load-balancer test that the delegate receives the same pin object; the BeforeModel hook test, which checks that an unhooked send creates no file and a hooked send creates one hook-owned scratch directory.
- Size: about 0.4k added, about 0.4k deleted.

### Phase 7. Content-Length, estimates and dumps from stored values

Built:
- `LENS` records, the per-row transfer summaries, slot table and the `gen` and `imageGen` stamps (2.5, 8.2, 8.5);
- the length measurer interface in core and its implementations in providers, run at append for active slots and as a fill group for others, with the image-dependent component filled separately (8.5);
- the chat and Anthropic transfer summaries and their composition, finalization and marker deltas (7.2, 7.4, 8.3), the Responses summary, the `rs_` arithmetic and the Kimi digit arithmetic with its exception-id correction (7.2, 7.3);
- planning-time checks: 128 MiB limit, normalized-selection media and provider-effective PDF metrics, completeness of both slot components (8.4);
- the stream byte guard;
- token measurers and aggregate-based estimates (9);
- dumps on the pin (9): `/dump` of history for chat runs the chat filter into the pretty printer, and for Anthropic a dump assembler on the pin implements the dump's own semantics (the chain-result behavior of `anthropicDumpChainResults.ts`), which the wire assembler does not reproduce. Both replace the dump modules of 14.3, and `/dump` takes a pin where it takes a `HistoryDumpSource` today.

Deleted: the interim counting, estimate and dump passes from phase 6, whatever of `prompt-estimator-files.ts`, `prompt-key-tee-writer.ts`, `prompt-key-disk-writer.ts` and `requestScopedBody.ts` still has an importer after phase 6, the dump modules (`anthropicDump*.ts`, `openAIDumpStream.ts`) and pass 1 with the `DumpScratch` use in `OpenAIChatBodyBuilder.ts`. The table modules and `dumpScratch.ts` lose their last non-test importer here and are deleted in phase 9 with their oracle tests, so phase 7 stays green with the table oracles running.

Defects closed: #5 on the send side (the over-limit refusal moves to planning time from stored totals).

Tests:
- length equals written bytes for every corpus case, route and variant combination (13.1 item 5), including the phase 0 prototype checks run against the product summaries;
- stream guard failure test with a deliberately stale length;
- slot staleness: change a setting in the key and check the fill happens once; change only the image budget and check that only the image rows are filled, with a free slot and with an evicted one (8.5);
- the `formatRev` pin test (8.5);
- estimate tolerance test on the corpus (16 tokens or 0.5 percent, Section 9);
- `dump-stream-parity.test.ts`, and `message-table-golden.test.ts` with `dump-golden.json` (600 cases) run against the new dump modules with their fixtures unchanged; `trapEstimate`, `trapEstimateAnthropic` and `trapFill` still fail with the leak injected;
- write amplification and fill cost measurements.

Size: about 4.0k added, about 1.9k deleted.

### Phase 8. Retry, media, telemetry

Built:
- per-unit media resolve, write, release (10.3), the stored-size data-URI arithmetic, the pinned read path through `store.readReserved`, and the blob lease of 10.1 (the `HistoryMediaReleaseGate`, the `rel` queue in the state map, the drain on pin release and at open);
- cancellation check per unit and the retry code that re-runs the filter on the same pin or takes a new one when the key or rows change (10.1, 10.2);
- the typed `onRequestSized` option in place of the metadata record (Section 11).

Deleted: `RequestMediaReservations`, `HeldMediaReservations` and the request-scoped reservation set in `request-media-resolver.ts`, `REQUEST_SIZE_SINK_KEY`, `RequestSizeSink`, `reportRequestSize` and `isRequestSizeSink`.

Defects closed: #9.

Tests: the blob lease test of 13.6 (pinned send, clear, reclamation, retry, with the media-store directory instrumented and both controls failing); the #9 test with a resolver counter (at most one unit's media at any time); retry on 429 and on token refresh reuses the pin and sends the same declared length; cancellation closes the pin; missing blob aborts with the label; `LoggingProviderWrapper.requestSize.test.ts` unchanged.

Size: about 1.3k added, about 0.8k deleted.

### Phase 9. Final deletion and proof

The old implementation goes only when all of these hold on the branch tip:
1. All three routes are byte-identical on the full corpus: the wire-body fixtures, the frozen phase 0 wire corpus (5,000 seeds per format), and the dump golden.
2. The frozen unit-stream fixture passes, and the live stage A differential passed on the last run before deletion.
3. Lengths equal written bytes on every corpus case.
4. The `sendPeak` traps all fail as intended on the new path.
5. The full verification cycle is green.

Then:
- delete the Anthropic table modules (`message-table.ts`, `emit.ts`, `wire-builder.ts`, `validation.ts`, `finish.ts`, `cache-controls.ts`, `tool-id-index.ts`, `project-row.ts`, about 1.9k lines), `utils/dumpScratch.ts` and their table oracle tests, `emit.test.ts` and `support/wireBuilderHarness.ts` included, whose expected-value role the phase 0 corpus now carries, and `keyed-row-index.ts` if the import graph shows no importer;
- delete the old normalizer (`provider-curated-stream.ts`, `provider-normalization-disk.ts`, `provider-normalization-storage.ts`, `provider-request-snapshot.ts`, `tool-pairing-index.ts`, about 1.3k lines), the adapter, `historyJournalRowReader.ts`, `historyJournalRows.ts`, `stageRowLog.ts`, `tailBufferedFile.ts`, and any file with no remaining importer from the Section 12 lists;
- replace the live differential test with the frozen fixture test.

Final proof, all from Section 13: heap census and flatness at 10k, 100k and 1M rows; no scratch call and no directory during a send, for each route; SIGKILL leaves no `llxprt-scratch-*` directory; the defect table of 13.5 passes with every row; the model test runs a long random sequence; the torn-tail tests; the line-count and lint gates are not weakened.

Size: about 0.3k added (frozen-fixture test and census), about 5.0k deleted.

### 14.4 Totals

| Phase | Added | Deleted |
|-------|-------|---------|
| 0 | 0 (tests, about 5.4k) | 0 |
| 1 | ~2k | 0 |
| 2 | ~6.4k | 0 |
| 3 | ~1.7k | 0 |
| 4 | ~3.9k | ~9k |
| 5 | ~2.5k | 0 |
| 6a, 6b, 6c | ~7.4k | ~3.0k |
| 6d | ~0.4k | ~0.4k |
| 7 | ~4.0k | ~1.9k |
| 8 | ~1.3k | ~0.8k |
| 9 | ~0.3k | ~5.0k |
| Total | ~29.9k | ~20.1k |

The deleted figures are measured from the current files. The added figures are guesses and are the weakest numbers in this section. Phase 0 adds test code only. The r3 changes moved about 1.8k deleted lines from phase 6c to phase 9 and about 0.3k to phase 7, and the follow-up check kept `message-table/emit.ts` (about 0.1k) until phase 9, and added about 1.9k lines in phases 2, 3, 4, 7 and 8 for relocation, the swap, the mirror identity, dump modules and the blob lease.


## 15. Decisions and residual risks

Everything else that was open in the earlier drafts is now decided in sections 2 to 14, or checked against the code with the file named where the fact is used. The fixed decisions (this PR, per-row lengths in the journal, old journals refused, no history arrays or history-sized maps or per-send temp files, fail fast) are not reopened here. The one temp-file exception, the hook, is in Section 15.1.

**Review r1.** Findings 1, 2, 8, 9, 10 and 19 are addressed in Sections 2.5, 7.2, 7.4 and 8. Evidence from the prototype (`tmp/854-notes/r1-proto`): the Anthropic model passes 6,244 cases with 0 failures and 207,948 associativity checks, the old run monoid fails its control (411 against 461 bytes), dropping the repair overlay is wrong in 4,342 cases and the old single-unit last-kept substitution in 94; the chat model passes 10,854 cases and 299,466 associativity checks.

**Review r2.** Findings 3, 4, 5, 6, 7, 11 and 17 are addressed in Sections 2.4, 2.5, 3.3, 3.5, 6.2, 7.2, 7.3 and 8, with the prototype numbers below (`tmp/854-notes/r2-proto`, untracked; raw outputs in `out/`).
- Finding 3 (Codex WebSocket): the route uses `ws` and sends one message in continuation frames, so no body-sized buffer remains and the whole-body exception is gone (7.3). The `ws` API is cited from `node_modules`. Codex's acceptance of fragments is not yet tested; the local-server test and a live smoke are in phase 6b.
- Finding 4 (rejected parents): rejection membership is owned by the provider instance as a disk-backed table, outside every journal (3.5; revised after the follow-up check). Selection matched the real provider's set in 2,400 of 2,400 stateful sends (1,200 histories, 562 per run with rejections, at most 6 probes).
- Finding 5 (call target in a non-AI row) and the new R3 finding: 3,000 histories, 2,002 with a call block in a non-AI row; the corrected rules differ from today in 0, R4 limited to AI parts in 595 and R3 tested against `C(X)` in 168 (6.2).
- Finding 6 (provider-normalized ids): namespaces 1 and 2 are written (3.3). The fact decisions were wrong in 0 of 800 raw Anthropic histories (2,720 results) where a raw-id lookup was wrong in 627, and the Responses fact model reproduced all 10,428 stateless and 2,400 stateful bodies, where the empty-id omission rule was wrong in 2,312 stateless cases.
- Finding 7 (Kimi) and the Kimi and Mistral chat corpus: 9,760 cases, 0 failures, 438,108 associativity checks, closed form held on 2,440 cases; controls wrong in 454, 87, 416 and 114 of 640, the design facts in 0 (7.2).
- Finding 11 (parent index and cursor): the parent index with wildcard and stripped-URL lists reproduced today's parent in 1,200 of 1,200 histories per run, where exact-URL lookup was wrong in 374; the cursor after the selected AI unit reproduced today's bytes in 2,400 of 2,400, where a cursor after the whole row was wrong in 191 of 191 (7.3).
- Finding 17 (Mistral rebuild): rebuilding from the raw id equals the real mapper in 2,000 of 2,000 histories and a stale stored mapping is wrong in 148 of 2,000 removal cases; the raw id is kept in the id piece of each `ROW` (2.4, 7.2).

**Review r3.** Findings 12 to 16, 18, 20 and 21, the purge-boundary pass and the write-volume check are addressed: root corruption in 2.2, 3.1 and 13.6; blob lifetime in 10.1 and 10.3; relocation in 4.8; compaction memory and the swap in 4.11; owner fan-out and mirror identity in 5.2; the purge overlay in 7.4; the deletion schedule in 12 and 14.3; measurements in 15.1. What remains open is listed as risks in 15.2.

**Follow-up check.** A second review of the 21 findings against this document found 14 resolved and 7 partial (1, 4, 5, 6, 7, 19, 20). This revision addresses the 7: finding 1 in 7.4 (writer ordering) and 8.2; finding 4 in 3.5, 10.1 and 13.6 (provider-instance rejection table); finding 5 in 3.3 and 6.2 R3 and R4, with the case in 13.1 item 3; finding 6 in 3.3 (message-level repair consumption, human-row result sources) and 7.4; finding 7 in 7.2 (all holders, written uses, dropped outputs) and 8.4; finding 19 in 2.5, 3.2 and 8.5 (`imageContrib`, `imageContribRows`) and 13.6; finding 20 in 12, 14.3 and phase 6c (`emit.ts` until phase 9). Phase 0 (14.3) freezes the named counterexamples. The prototypes were not rerun for this revision.

### 15.1 Decisions with no workable alternative

The two points below were open choices in earlier drafts. Each now has one answer, and the reason is given with it.

**Power-loss durability.** The writer calls `flushRecords` on a group's records before it writes the group's trailer, so every trailer on disk has its whole tree on disk. Each main history mutation is one commit group, so each group is one flush (Section 4.1).

Without the flush, a power loss can leave a trailer that points at nodes that never reached the disk. The old JSONL file lost only its last lines in that case, and the tree format would lose more than that, which is a regression. The flush is therefore required on every platform. The trailer itself is not flushed, so a power loss can lose the newest group and nothing older.

**Measured cost** (`tmp/854-notes/r3-probe/`, Bun 1.3.14, macOS arm64, 200 groups per case, each a pwrite, a flush and a 1,500-byte trailer pwrite, measured before the trailer record grew to 1,504 bytes with the wider frame head). On the external APFS volume that holds this checkout, a 60 KiB pwrite takes 0.011 ms median (p95 0.026), `fdatasync` 0.23 ms median (p95 0.54) and a whole group 0.25 ms median (p95 0.62). At 120 KiB the flush is 0.30 ms median. On the internal volume `fdatasync` is 0.04 ms median (p95 0.08). Flush time hardly depends on size (16 KiB 0.15 ms, 60 KiB 0.23 ms, 120 KiB 0.30 ms), so a smaller path copy buys almost no latency.

Bun's `fdatasync` on macOS hands the data to the drive but does not ask the drive to empty its write cache. Node 25 (libuv) on the same files takes 1.3 ms (external) and 4.3 ms (internal) per flush, and `fcntl(F_FULLFSYNC)` called from Bun takes 1.5 ms (external, p95 5.2) and 4.2 ms (internal, p95 6.7). Without coalescing, a three-group request costs about 0.8 ms with Bun's `fdatasync` and 4.8 to 12.9 ms with `F_FULLFSYNC`. Each commit group pays one full flush, which costs about 1.5 ms median on the external volume and 4.2 ms on the internal volume, per file written.

**Growth** (`growth-groups.ts`, from the layout of 3.2 and the trigger of 4.11, assuming 3 rows of 2 KiB bodies per exchange; both scripts are in the untracked `tmp/854-notes/r3-probe/`). An exchange here is a user prompt, an assistant tool call and a tool result. Under 4.1 it is two groups: the response group (the user and assistant rows, one call id, one path copy) and the eager tool-result group (one row, one id, and a second path for the call row's leaf). At 100k rows the response group of a turn with no tool call is 63 KB (one path, two rows, trailer), the response group with one call id is 69 KB, and the eager tool-result group is 122 KB. Compared with the single coalesced group the earlier layout wrote, the two groups add one path copy and one trailer: 57 KB at 100k rows and 48 KB at 30k rows (KB here is 1,000 bytes, as in 3.2). 10,000 exchanges make 30,000 rows and a tree of depth 5. The two-group layout appends 159 KB per exchange, 1.6 GB over the session, which is about a third more than the single-group layout's 116 KB per exchange. The live data is 132 MiB. Without compaction the file reaches 1,516 MiB; with the 4.11 trigger it peaks at 318 MiB, compacts 10 times and copies 557 MiB in total.

**Decision.** `flushRecords` empties the drive's write cache on every platform. Each main history mutation is one commit group (4.1), so each file a request writes pays one full flush per group. The per-group cost on the primary file is under 10 ms, and a tool round's two groups come to about 8.4 ms at the median on the internal volume, so neither layout change is made. Arity stays 8 and the phase 2 write budget test decides (13.6). If it fails, the fix is arity 4, about 33 percent fewer bytes per path. Moving the per-format summaries out of leaf entries into the parent only is rejected: the leaf is 8,868 of 55,768 bytes of a path copy at 100k rows (16 percent), and internal nodes carry the rest.

The platform calls are these:
- darwin: `fcntl(fd, F_FULLFSYNC)`, where `F_FULLFSYNC` is 51. Under Bun the call goes through `bun:ffi` on libc, as `tmp/854-notes/r3-probe/fsync-probe2.ts` makes it. Under Node it is `fs.fdatasync` or `fs.fsync`, which libuv implements with `F_FULLFSYNC` on Apple platforms. If the call returns an error, `flushRecords` throws. It does not fall back to plain `fsync`, which does not empty the drive cache. Phase 1 checks that the Node path also throws and does not retry with plain `fsync`.
- Linux: `fdatasync`, which flushes the device cache.
- Windows: `FlushFileBuffers`, which flushes the device cache. Phase 1 checks on the Windows runner that the runtime call reaches it.

A throw from `flushRecords` poisons the writer and writes no trailer (4.1). If a drive or filesystem ignores the flush, it can leave an intact trailer over nodes it never persisted. That case is reported at open or read, as risk 10 in 15.2 describes.

The cost is one full flush per commit group per file: about 1.5 ms median on the external volume and 4.2 ms on the internal volume, with p95 values of 5.2 and 6.7 ms (Measured cost above). A plain turn is one group, so one flush. A tool round is two groups on the primary file, so two flushes: about 3.0 ms median on the external volume and 8.4 ms on the internal volume. The eager group also adds one path copy and one trailer to the bytes written, 57 KB at 100k rows. The primary file alone stays under the 10 ms threshold in both cases. Each mirror file that receives rows of a group adds its own flush for that group (5.2). On the internal volume, three flushed files in one group reach 12.6 ms at the median, so the 10 ms threshold does not hold for a group that writes three files. The mirror count per tool round is not yet measured with the real fan-out.

Coalescing does not make the user's prompt less durable than main. A crash while the model is streaming loses the in-flight prompt on main as well, because main does not write it before the response completes. On origin/main the prompt enters history only after the response is complete. `TurnProcessor.ts:191` awaits the model call, then `_commitSendResult` (`TurnProcessor.ts:206-213`) calls `commitTurnHistory`, which passes the user entries and the model output to one `historyService.addBatch` (`turnHistoryCommit.ts:138-152`). The other write path, `ConversationManager.recordHistory` (`ConversationManager.ts:238-296`, called from `streamResponseHelpers.ts:579` and `streamValidationHelpers.ts:196`), also writes the user and model entries together after the response. The JSONL writer follows history: `RecordingIntegration.ts:321-332` calls `recording.recordContent` when history adds an entry, `SessionRecordingService.ts:808-810` queues it, and a background `fs.appendFile` writes it (`SessionRecordingService.ts:494-532`, no fsync). Main's journal therefore gets the prompt only when the turn completes, which is the point at which this design writes the response group. Section 6.6 keeps the pending user message out of the journal until the model answers, and that matches main. The prompt is in the response group, so it adds no flush.

Tool results are decided, and the design follows main. Main persists tool responses eagerly on two paths: `ChatSession.recordCompletedToolCalls` (`chatSession.ts:900-932`), reached from the client tool channel (`toolControl.ts:181`) and from subagents (`subagent.ts:713`), and `recordCompletedToolHistory` on the todo-pause path (`AgenticLoop.ts:736`, `loopHelpers.ts:120-136`). Each of those main calls is one commit group here, written at the same point in the send, so a crash during the next model stream keeps the results, as it does on main. The todo-pause path makes two history calls, so it is two groups. Which tool rounds reach these calls is a property of main, and the design does not change it. Tool results that main does not persist eagerly stay pending input and go into the next response group (4.1, 6.6). The cost is one extra full flush per eager group per file written (two per todo-pause, one per ordinary tool round), at the flush costs measured above, plus one extra path copy and trailer in the write volume (Growth, above). The crash test in 13.6 kills the process after an eager tool-result commit and checks that the result is present on resume.

**BeforeModel hooks.** Hook support stays. A registered BeforeModel hook receives the full request as JSON in an external process and returns an arbitrary replacement, so a send with such a hook needs the serialized request, and the hook subsystem owns the scratch for it. With no hook registered, no file is created: `beforeModelHookFire` returns before any copy. A hooked send creates one scratch directory, staged under `getScratchRoot()` by `resolvePendingBoundarySnapshot` (`source-before-model-hook.ts`). The replacement is read through the `RowSource` interface (Section 7.5), and its Content-Length is one counting pass over it, since it has no stored lengths. The replacement is not normalized, so for Responses the raw-row dangling scan runs for it, with its `open` Set and `names` Map sized by the replacement (7.3). A source that is not journal history is a declared exception to the memory rules, as 7.5 says.

This is the single stated exception to "no temp files per send", and it applies only to opt-in hooked sends.

### 15.2 Residual risks

Each risk is real after the design is complete. The mitigation is in the design. The test is what detects the risk if the mitigation is wrong.

| # | Risk | Mitigation | Test that detects it |
|---|------|------------|----------------------|
| 1 | Write amplification: a one-row group at 100k rows writes about 66 KB. A tool exchange is two groups, 69 KB and 122 KB, and 10,000 exchanges write 1.6 GB before compaction (15.1). The sizes are per group, and a typical request is one to three groups. Flush latency does not depend on size. | Each main history mutation is one commit group (4.1). Compaction (4.11) bounds the file at its trigger, 318 MiB in the two-group projection (15.1). Arity 4 is the fallback (3.2). | Write budget test (13.6): at most 72 KiB for a one-row group and 128 KiB for a group that changes two leaves, at 1k, 10k and 100k rows. Compaction trigger test (13.6). |
| 2 | The unit stream rules R1 to R8 were derived by reading the four stages and checked on prototypes, not on the product generator. | The old normalizer stays until the frozen fixture exists (14.2). | Stage A differential (13.1 item 3) on the corpus and on generated sessions with duplicate ids, empty ids, orphans, displaced responses and tail rows. |
| 3 | The Anthropic transfer summary is validated by a prototype on today's builders. The overlay facts the product reads from namespace 2, the message-level `repairAdjacency` consumption and the purge overlay (7.4) are not covered by it. | The state set is closed and checked by assertion (7.4). Marker deltas, the purge delta included, are measured from the real block (8.3). Phase 0 adds the purge pass to the oracle. | Phase 0 oracle (14.3), length equals written bytes on the frozen 5,000-seed corpus (13.1 items 5 and 5d), the consumption test (13.6) and the stream guard (8.4). |
| 4 | Kimi ids with duplicate call ids make the digit total depend on the last occurrence of each duplicate. | Closed form for clean ids plus a correction for each exception id, kept in the id trie and empty for recorded histories; rows are re-measured when the last eligible occurrence changes (7.2). | A generated duplicate-id corpus for the Kimi route with length equal to written bytes, the prototype controls (13.1 item 5c), and the `openai-chat-kimi.json` golden. |
| 5 | The Responses raw-row dangling branch emits `'Tool execution cancelled by user'` and a pin's unit stream emits `"output":"null"`, 28 bytes apart per orphan. Production can send either (7.3). | A pin never runs the branch because R3 completes every orphan; the branch stays for sources that report `lengthsAvailable: false`. | Claim check in the corpus run (13.1 item 6), the send-path classification test and the two golden outputs (13.1 item 7). |
| 6 | A converter setting missing from the format key gives a stale stored length. | The key is the hash of one typed `RowFormatSettings` object (8.5). | A test that varies every field of that type, and the stream guard. |
| 7 | Codex rejects a request sent as continuation frames (7.3). | The route fails fast with its own error and never buffers the body; fragments are part of RFC 6455 section 5.4. | A local `ws` server test of fragment reassembly and a live Codex smoke (phase 6b, 13.6). |
| 8 | Rebuild at compression, density, replace and pop below a lineage start reads one header per surviving row, 1M small reads at 1M rows. | It runs at those events, not per turn, and streams with depth-bounded memory (4.6). | A rebuild test at 100k rows (1M nightly) that records reads and heap. |
| 9 | Windows positional I/O, share flags, rename over a file and delete-on-close were checked only against documentation (4.12). | Explicit offsets and a descriptor never in append mode; the swap state machine restores the old file on a refusal (4.11); the bare store uses `UV_FS_O_TEMPORARY`. | Format, torn-tail, compaction and swap tests on `windows-latest`, including a real refusal by a child process holding the file. |
| 10 | A filesystem or drive ignores the flush request. After a power loss an intact trailer can then name nodes that never reached the disk. | Corruption is loud and reported with the offset (3.1). `flushRecords` asks for the full flush on every platform (15.1). | Lost-node case of the root corruption test (13.6). |
| 11 | `/dump` of Anthropic history has dump-specific chain-result semantics that the wire assembler does not reproduce, so the phase 7 dump assembler can drift. | Dump fixtures keep their dump semantics and are not repointed (14.2); the table stays a live reference until phase 9. | `message-table-golden.test.ts` with `dump-golden.json` and `dump-stream-parity.test.ts` against the new dump modules. |
| 12 | The blob lease depends on every history-owner release passing the one gate, and on history reserving every blob a version names. The janitor scan must read `.llxj` files, and it refuses a file over 256 MiB (`mediaReclamation.ts:36`), which skips the project and reclaims nothing (a leak, not a loss). | The gate is injected into the only two history-owner release sites (10.1). Compaction keeps the file near twice its live size (4.11). The scan matcher is in the extension list (2.1). | The lease test and its two controls (13.6); a janitor test over a journal with media rows, and over one above the scan limit that reports the error and deletes nothing. |

### 15.3 Decisions recorded during implementation

These were open questions in the PR body. Each is settled by the goal of #854: history stays out of memory, a send holds only what one row's conversion needs, no per-send files, no repeated whole-file reads.

- **`request_chars`.** Always the wire byte count of the attempt, the declared `contentLength` of Section 8, passed through the typed `onRequestSized` option (Section 11). The value no longer depends on whether body logging is on. The interim metadata-record sink and the character count of the redacted copy are removed in phase 8.
- **Request body logging.** The logged request is produced by running the filter on the send's pin a second time into the exporter in bounded chunks, with redaction applied per unit. No copy of the body and no file is kept for it. Logging is fail-open, as on main: a send does not wait for the exporter's acknowledgement, and a logging failure goes to the debug log. The strict pre-send wait existed only because the body lived in a spool that was deleted after the send; the pin lives for the whole call, so the reason is gone. Phase 8 removes `strictPreSend`, `strictTelemetry` and the acknowledged publisher path for request artifacts.
- **`retries`.** Unchanged from main: `retries=N` is N attempts in total. Zero is clamped to one attempt, because on main it sent nothing and returned an empty stream.
- **Codex WebSocket.** Sent as one message in fragments streamed from the filter (7.3). There is no in-memory frame.
- **`/restore`.** Keeps main's checkpoint behavior: one shadow commit per restore, ignored files untouched.
- **PR link.** "Part of #854". The unified scrollback (#3856) is deferred by the owner, so #854 stays open until it lands.
