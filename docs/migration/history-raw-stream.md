# Raw history API migration

`HistoryService.getRawHistory(): readonly IContent[]` has been removed. This
breaks external code that calls the method, overrides it, or derives a type from
its return value. There is no eager replacement or compatibility method.

Use `streamRawHistory(signal?: AbortSignal)` to process rows as they arrive:

```typescript
for await (const row of history.streamRawHistory(signal)) {
  await processRow(row);
}
```

The cursor captures journal membership on its first `next()` call. Later
appends do not become part of that traversal. Rows are borrowed read-only inputs.
Pending caller-owned rows can retain their object identity; durable rows are
journal values. Keeping a row or a copy after delivery makes it the consumer's
retained owner. A consumer that manually drives an iterator must call `return()`
in cleanup when it stops early. Cancellation is checked when iteration resumes.

Use `IContent` for the row type rather than a return type derived from the removed
method. Read-only diagnostics should fold the cursor to scalar results. Full
history mutations need an addressed candidate or the scoped
`detachedValues.transform` source and sink, rather than an array read followed
by replacement.

Continuous high-density optimization now invokes `optimizeRows` over a pinned
disk snapshot through `HistoryService.optimizeDensityRows`. Its row, path,
call-ID, inclusion and recency decisions live on disk. The existing
`HighDensityStrategy.optimize` and `applyDensityResult` array contracts remain
available for explicit array callers. They are separate from this production
route and still carry their collection ownership.

Repository tests that need whole-fixture assertions use the explicitly eager
`test-utils/collect-raw-history` helper. It collects a cursor into a test-owned
array and is not a production migration pattern. Avoid replacing the removed
method with `getAll`, an array-backed iterator, or another full-history wrapper.

## Public agent and client readers

`Agent` and `AgentClientContract` require `streamHistory(signal?)`. External
implementations must provide the method. `Agent.getHistory()` has been removed;
use the scoped stream instead. `AgentClientContract.getHistory()` and
`getHistory(false, signal?)` now return the same cold raw-row stream. Exhaust the
stream or call `return()` to close its reader. Implementations of the client
contract must return an async generator, not a promise of an array.
`ChatSession.getHistory()`, `getHistory(false, signal?)`, and the corresponding
`ConversationManager` and `AgentChatContract` methods now return cold raw-row
streams too. This is an internal return-type change: callers must consume rows
asynchronously. `getHistory(true, signal?)` remains a separate curated stream.
Direct chat reads do not wait for the chat to become idle. Pending rows keep
their caller identity and ownership costs until their writers settle.

CLI `/chat debug` counts the default client stream. API session clear captures
that stream into a disk candidate, keeps the first complete human-led turn, and
resets from a disk prefix. Its rollback snapshot reserves reference media until
replacement or rollback ownership settles, then releases those reservations.
No full transcript array is passed to reset or rollback. CLI chat clear/restore
also capture a scoped disk candidate, determine the same human-turn boundaries,
validate the retained prefix, and persist the rewind before publishing from disk.
Reference media remain reserved until publication or rollback settles. Restore
updates UI items incrementally after publication, including thinking blocks and
the display emoji filter. It no longer returns a full `load_history` payload.
Initialized array updates and deferred startup no longer retain a second chat
history array. Streamed replacements and rollback estimate tokens for the active
runtime model. Explicit array input APIs still have their own ownership costs.

An active client waits for its selected chat to become idle before opening that
chat's raw journal cursor. Membership is pinned when the underlying reader opens,
not when `streamHistory` is called. Cancellation is checked before and after the
idle wait; it does not interrupt an idle promise already in flight. An inactive
client snapshots its retained deferred history to disk on first traversal, or
opens the stored journal when no deferred history exists. Replacing deferred
history does not change an open snapshot. The snapshot holds serialized row
values rather than original caller identities. The existing deferred input array
and its media admission remain owned by the client until its normal lifecycle
releases them.

Exhaustion, early return, source failure and resumed cancellation close the
reader. Abort alone cannot unwind a consumer paused between `next` calls. Raw
rows and metadata are not curated. ACP live replay and configuration's
post-authentication history-count report use this method directly, without a
full-history result array. ACP tool-pair tracking still has its existing pending
ID Map, so this change does not certify bounded whole-replay metadata.

The agent facade's carried startup consumes `AgentClient.streamHistory()` with
`setHistoryFromSource()` before calling `startChat()` without an extra-history
array. Detached admission completes its durable acknowledgement before startup.
Admission failure leaves the carried journal available; startup failure keeps
it available for retry. Existing explicit array input APIs still retain their
caller-owned inputs until their lifecycle releases them. Repository value tests
use the explicitly eager, test-only `collectAgentHistory` recipient; production
readers must not use it.

## Asynchronous history merge

`HistoryService.merge(other)` now returns `Promise<void>`. Await it to observe
publication or a rejected transaction:

```typescript
await history.merge(other);
```

The target mutation FIFO captures its previous membership, then captures the
source membership in a scoped disk snapshot. Capture happens when the queued
mutation executes, after any compression lock is released. A source mutation
after capture cannot change the candidate. Self-merge appends the pinned rows
once; repeated merges still append duplicates, matching the former `addAll`
behavior. Zero-block source rows are skipped. Existing timestamps and chronology
markers survive, while unmarked accepted source rows receive new markers.

A rejected publication compensates admitted journal operations and restores
chronology and token accounting before queued target mutations run. Pending
source and target rows retain their caller identities. Those pending owners can
grow with unsettled work. Durable candidate rows are serialized to disk, and
durable publication advances one row at a time. The existing synchronous
`addAll(readonly IContent[])` contract remains an explicitly array-owned API.

`SessionPersistenceService.saveRows` consumes an asynchronous row source into a
temporary session file and renames it after successful traversal. Each row uses
the existing media admission and reservation lifecycle; queue accounting charges
encoded writes under the configured byte limit. Traversal failure leaves the
previous target intact. The media probe supplies its single accepted journal row
to this method and counts settled history with a scalar. Neither operation reads
`getAll`.

## Whole-history rewrites: `detachedValues.transform`

`HistoryService.transformRows` and `transformAll` are removed. A rewrite of the
whole history uses `history.detachedValues.transform(transform, modelName?,
options?)` (or `detachedValues.replace` when the new rows do not depend on the
old ones). The callback takes a scoped asynchronous source and sink and returns
`Promise<void>`, not a history array:

```typescript
await history.detachedValues.transform(async (source, sink) => {
  let index = 0;
  for await (const row of source.streamRows()) {
    await sink.appendDerived(index++, row);
  }
});
```

The source is repeatable and ordered. Omitting rows removes them; sink append
order determines output order. Use `appendValue` for changed row values or
insertions: it serializes a sanitized value without stamping the caller object.
`appendDerived(index, row)` carries a source row over, possibly rewritten, and
keeps that row's owner and chronology marker. Each sink call resolves when the
candidate has taken the row. Newly appended rows must pass the existing batch
validation.

Source and sink handles expire when the callback completes. Candidate values
and rollback snapshots are disk-backed; publication and compensation preserve
membership, chronology, tokens and media participant rollback before queued
mutations run. There is no array-callback compatibility route.

## Array batch publication and backpressure

`addBatch(readonly IContent[], modelName?, options?)` still returns
`Promise<void>`. It snapshots the input array, validates the whole batch,
estimates appended tokens, and emits one ordered `contentBatchAdded` event.
The event exposes detached values rather than caller row or chronology marker
identity. The previous history is captured and traversed through disk rows
instead of being materialized into a combined array.

Batch backpressure is explicit: pass `{ streamPublication: true }` to wait for
journal acknowledgements between admissions. An opted-in caller must not hold
the writer paused while awaiting the batch. Turn history commits,
`ConversationManager.recordHistory`, and extra-history loading use this option.
The default remains non-backpressured so publication and error compensation
can finish before a caller releases its writer. Synchronous `add` and `addAll`
contracts have not changed.

Submitting an array still introduces context-sized input ownership. Streaming
the event does not bound borrowed inputs or synchronous pending publication
queues. Use the scoped detached row-transform API for value-based publication
that does not require a complete caller array or exact caller marker identity.

## Batch event: one row source for both stores

`contentBatchAdded` carries a row source, `HistoryBatchRowSource`, exported from
Core. The file-backed store's payload is `HistoryBatchValues`, which extends it,
so one listener works on both stores. `length` is the complete appended suffix
or replacement cardinality. `rows()` returns an async generator that reads one
row at a time; each call is an independent pass and nothing is retained between
reads. The source is valid from dispatch until the dispatcher calls `retire()`,
which it does once every listener has been handed the payload. A pass must start
during dispatch (call `next()` before the listener returns, which a `for await`
loop in an async function does). Passes already started finish; a pass started
after `retire()` throws.

```typescript
history.on('contentBatchAdded', (batch) => {
  void (async () => {
    for await (const row of batch.rows()) consume(row);
  })();
});
```

The event fires once per published batch, after the batch is committed, and
never for a publication that failed. If a listener throws, the batch is rolled
back and passes it started are allowed to finish before the failure is reported.
Finish or `return()` every pass you start: on the file-backed store the
publication waits for it, because the rows belong to the publication's scope.

The journal store reads the version that was acked when the event fired, so
later mutations do not change what a pass reads. The file-backed store reads the
publication's own rows and closes that scope once the last pass has finished.

### File-backed store: scoped synchronous reader

`HistoryBatchValues` also keeps the scoped synchronous reader that existing
listeners use, exported with `HistoryBatchCursor`:

```typescript
history.on('contentBatchAdded', (batch) => {
  batch.withRows((cursor) => {
    for (let item = cursor.next(); !item.done; item = cursor.next()) {
      consume(item.value);
    }
  });
});
```

Only one `withRows` cursor may be active on a batch at a time. Each listener can
traverse independently. Rows are read through disk without an array cache. Early
`cursor.return()`, callback failure, and the end of the batch release reader
ownership. Both handles expire at the end of their synchronous scope and drop
their source references. An asynchronous `withRows` callback is unsupported;
use `rows()`. The journal store's payload has no `withRows`.

The event name, native ordered dispatch, unsubscribe behavior, reentrant
mutation FIFO, token updates, and observer-failure compensation remain
unchanged. There is no array indexing, array iterator, shared row identity or
cross-listener mutation, and no readable retained handle after the batch.
Consumers outside this checkout must migrate. A consumer that saves every
returned row creates its own unbounded collection. Complete large rows are
still accepted; the controlled fixture's 8 MiB cap is not a row-size limit.

## Deferred disk-source admission

`AgentClient.storeHistoryForLaterUse` also accepts a cold
`AsyncIterable<IContent>` and optional cancellation, decode-counter and
ownership instrumentation. This overload requires an inactive chat. CLI
`--continue` startup calls it through `restoreResumeBoot` and
`admitResumeHistorySource`, using `ResumeCursorBoot.streamRows()` rather than an
array materialization. The source is traversed in order, admitted for local
media one row at a time, and serialized as detached values.

Streamed admission prepares a separate disk journal. Previous membership is
copied through a scoped disk merge to preserve chronology reconciliation. The
client publishes the new service only after source traversal, token accounting
and the final durable acknowledgement finish. Source, tokenizer, write or
cancellation failures leave the previous client service visible. Scoped media
reservations are indexed on disk until the chat has adopted ownership; a failed
startup retains them for retry, and client disposal releases them.

This overload returns `Promise<void>`. Returned rows are obtained through
`streamHistory`, whose scoped snapshot contains detached journal values after
admission completes. Caller object and marker identity are not preserved by
this overload. An open snapshot survives a later replacement and must be
exhausted or returned by its consumer. There is no aggregate row-size rejection;
a valid single row larger than 8 MiB is accepted.

The eager array overload, `setHistory`, `resumeChat` and `restoreHistory` retain
their existing array contracts and ownership costs. Authentication rebuilds and
explicit array mutations have not been certified as bounded. The new
`HistoryBatchOptions.awaitDurableCommit` is opt-in: it awaits the final write in
a stream publication, while existing callers retain their previous defaults.
