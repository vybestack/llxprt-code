# P05d bounded production slice: deferred-history source boundary

## Candidate lane

The production `HistoryService.replaceAll` call selected by the AST search is in `packages/agents/src/core/client.ts`, in `AgentClient.replaceDeferredHistory`:

```ts
await journal.replaceAll(this._previousHistory);
```

That call is reached by `setHistory` and `storeHistoryForLaterUse`, used for resume-before-authentication/deferred adoption. The established `HistoryService.transformRows` sink can persist rows incrementally, but this caller receives `history: readonly IContent[]`. Its caller's data therefore already occupies a context-sized array before the service boundary.

## Blocking producer statement

The input is first made retained in `HistoryAdmissions.replaceRetainedHistory(history, ...)`, then assigned here:

```ts
this._previousHistory = retained?.history ?? history;
```

Replacing only the `replaceAll` call with `transformRows` would iterate an already-materialized array and would not make the invoked pathway bounded. The caller tree also includes array-only `AgentClientContract.setHistory` and `storeHistoryForLaterUse` signatures, `ChatSession.setHistory`, and restore/resume producers. Migrating just one function would leave the producer allocation and admission/media retention untouched, violating the requirement to move the producer boundary one level earlier and preserve ordered/durable publication.

## Existing relevant evidence

The dirty workspace already contains `packages/agents/src/api/__tests__/public-history-stream.test.ts`, which exercises 512- and 8192-row deferred/active streams, consumer pause ownership, failure/abort cleanup, and a 9 MiB valid row. It verifies the reader stream, not production streamed deferred-history adoption. It does not establish that `setHistory` accepts a cold `AsyncIterable`, performs disk-backed media admission, or publishes a detached journal candidate atomically. Existing negative-identity/pending traps and 1 MiB/8 MiB/440 contracts must remain unchanged.

## Required next implementation boundary

Add a cold `AsyncIterable<IContent>` admission operation at the resume/deferred-history producer boundary. It must feed media admission and a detached history candidate without retaining the whole transcript; the candidate must publish only after durable completion, preserving chronological order, token accounting, media leases, cache markers, and provider body. Then route deferred adoption through that producer. Add behavioral Bun tests against that production entry point before implementation, covering both 512 and 8192 rows, paused-consumer live ownership, a 9 MiB row, source/write failure cleanup and rollback. Keep existing memory/trap evidence and confirm `replaceAll` remains out of this adopted path.

No production change was made in this slice because the inspected boundary cannot satisfy bounded-source ownership while its input remains a `readonly IContent[]`.
