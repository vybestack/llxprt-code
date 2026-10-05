# Recording persistence failures now use a disk-backed report

The `RecordingIntegration.takePersistenceFailuresThrough(): unknown[]` method and its failure map have been removed. Persistence failures are written incrementally to generation-numbered diagnostic files. A rejected boundary or disposal promise transfers a `RecordingFailureReport` to its caller. Its count and first generation are scalars; it has no `errors` array. The report's `details()` cursor reads one bounded record at a time in increasing generation order.

This changes the internal rejection API. A multi-failure report is no longer an `AggregateError` containing all original rejection objects. A report's `cause` is a weak reference to the first original object when it is still alive. A single boundary also passes its own weak cause to the reporting store, preserving causal identity when another owner retains it. Primitive rejection values are represented in the diagnostic stream rather than retained as potentially large summary fields. Disk records are descriptors, not reconstructed original objects.

## Descriptor contract

Each failure starts with a `failure` record identifying its persistence generation and the fact that subsequent records describe the rejection. Error names, messages, stacks, causes and aggregate error contents are described. Enumerable own properties, strings, primitive values, arrays, Map entries, Set values and dates receive typed records. Strings and property names are split into 2,048-code-unit pieces. The reader has a 16KiB input buffer and rejects a record beyond its 32KiB limit. A malformed, incomplete or missing owned report rejects its consumer instead of being presented as a complete report.

The projection does not recreate identity, prototypes, symbol properties or general non-enumerable properties. Accessors are identified without evaluating them. Ancestor cycles are identified by path. Traversal beyond depth 32 emits an explicit diagnostic-depth-limit record. Inspection failures are also represented explicitly. These are diagnostic limitations, not a promise of arbitrary JavaScript object serialization. Functions and symbols receive their type and textual description; they are not recreated. Large property names also have separate full-name chunks, while their display path uses a bounded prefix.

A summary message keeps only a copied, bounded first-error message. Original row graphs are not strong fields of the store or report. Files use owner-only permissions when created. The reporting path performs synchronous file writes before releasing each original failure, so an asynchronous spool queue cannot retain all rejected payloads.

## Ownership and callers

`details()` is single-consumer. Exhaustion, an iteration error and `for await` early return close its file descriptor and remove its owned generation files. Explicit `close()` also terminates a suspended reader and removes its files. It is idempotent after success and retryable after cleanup failure. Closing an undrained report is an explicit abandonment action, not evidence that its details were consumed.

Reports own generation ranges, not the entire integration directory. Closing an earlier report cannot delete a newer failure. The directory is removed when the last range leaves it empty. The store recreates that directory for a later failure if needed. Successfully reported generations are not replayed after recovery.

`withRecordingFailureReport()` drains reports, including reports inside fixed-size cleanup aggregates, and awaits a backpressured stderr write for each detail. It then propagates the original rejection. A failed sink is attempted for subsequent records too; the first sink failure is propagated after the original rejection. Checkpoint, package export, recording rollback, resume rollback, CLI shutdown and the non-fatal turn-boundary caller use this consumer. The lifecycle tests also close reports they capture.

Concurrent boundaries can claim shared diagnostics once. Each boundary whose own save failed still rejects, using a scalar `RecordingFailureNotice` if another boundary owns the report. Disposal counts failures that settle while disposal is active and rejects a scalar notice when concurrent boundaries already own those diagnostics. Concurrent disposal calls share their in-flight promise. Later disposal calls retain the existing idempotent resolved behavior.

If writing a report fails, `RecordingFailureStorageError` preserves the original persistence cause, the storage error and any scratch cleanup error in that order. Every affected boundary gets its own rejection. New persistence admission then fails fast, and shutdown also propagates the reporting failure. This state requires integration disposal; ordinary persistence failures remain recoverable after the underlying I/O problem is repaired.

## Scope limits

The existing pending-persistence map is still proportional to concurrently admitted boundaries. Detachment can still build a nested aggregate across repeated failed detachments. These pre-existing paths are not made bounded by this migration, and the existing structural whitelist is unchanged. Neither is a reason to claim that all of Criterion 1 has passed.

A caller that accepts a report directly must consume or close it. All identified production callers do so through the helper, but a newly introduced caller can leak diagnostic files by discarding a rejection. Process crashes can leave scratch directories. A disk that cannot store diagnostics and a sink that cannot accept them cannot provide durable complete reports; the operation propagates those failures rather than claiming successful delivery. Descriptor projection and a weak live cause cannot preserve every arbitrary original identity after its last strong external owner disappears.

## Verification

Raw logs and baseline snapshots are in `tmp/verify854/p05d/recording-failure-stream-20260930-branch3/`. The real-recorder RED run exercised 512 and 8,192 genuine persistence I/O failures and rejected the old rejection contract. Separate RED runs cover concurrent shutdown propagation, explicit cursor abandonment, missing diagnostic files and Map/Set details. The report tests exercise a single ordered 8,192-failure stream as well as generation isolation, cleanup retry and live-cause identity.

The memory probe runs in pinned-Bun child processes at 512 and 8,192 failures. It pauses a report cursor on a row diagnostic, forces GC and counts original row liveness through WeakRefs. The unchanged controls are 1MiB retained growth, 8MiB live payload/diagnostic bytes and 440 live row/detail objects. The trap uses an eager `AggregateError.errors` owner and must fail the same predicates. This is a scoped reporting probe, not the complete Issue854 acceptance harness or a population-level statistical certification. Recorder, agent and CLI adjacent suites run in separate processes. Full acceptance was not run while changing source. Enforcement, `.llxprt`, prior evidence, commits, pushes, reviews and merges were not changed.
