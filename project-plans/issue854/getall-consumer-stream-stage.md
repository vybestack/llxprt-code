# Active reinitialization and Config rebuild stream; getAll remains RED

## Public client default completed; chat default remains RED (2026-10-02)

The public client reader cohort now returns a cold async generator from both
`AgentClient.getHistory()` and `getHistory(false, signal?)`. The eager
`readClientHistory` helper and its stored-service `getAll` call are removed.
API session clear captures the default stream into disk rows, keeps the first
complete human-led turn, and resets or rolls back from disk. Its rollback media
references stay reserved until replacement or rollback ownership settles.
CLI `/chat debug` counts the default client stream. Production consumers and
symbol-resolved client test callers use the generator contract.

This is the permitted single-direct-caller completion. The final inventory has
6,436 source roots and 312 direct `HistoryService.getAll` calls, including tests.
Exactly one is production: `ConversationManager.ts:500`. The four invoked
ChatSession default/false cases at 512/8192 rows remain RED, charging 512 or 8192
external identities. Structural audit remains at eighteen passes and two
failures. `getAll`, `Core.materializeHistory` and `captureChronology` are retained;
no scanner exclusion or compatibility array adapter was added.

Evidence is in `tmp/verify854/p05d/getall-public-20261002T1850-sol/`. Its closing
manifest has 115 focused passes, the original 31 chronology/rollback passes,
four default-reader BODY cases covering 24 independent pairs, two existing
transfer BODY cases, and eighteen provider ownership/body passes. Twelve adjacent
media-lifecycle cases pass separately. Public default/false active/inactive
reader peaks are one external row, 2,507 bytes at 512 rows and 2,515 bytes at
8192 rows, settling to zero. A valid nine-MiB row passes separately. Source
fault, consumer fault, return, resumed abort, pinned writer publication, reset,
rollback and removed-media reservation tests pass. Borrowed and copied retaining
traps each fail all eight default-reader cases; pending and public retaining
traps fail two and four cases. Package and script typechecks, lint, formatting,
diff-check and duplicate-preserving audit comparison pass with no new findings.
Saved BODY artifacts are losslessly compressed with decoded-byte SHA-256 pairs.

These measurements cover registered reader and recipient owners. They do not
certify whole-session retained heap or whole-provider memory. The remaining raw
chat callers and all unresolved/dynamic calls are recorded in the final symbol
inventory. The sections below retain the preceding transfer stage's results.

The invoked active-client reinitialization and Config replacement cohorts now
use disk-backed history sources through startup and provider consumption. This
stage does not remove `HistoryService.getAll()` or certify all public history
consumers. One eager facade method and its two direct production callers remain.

Evidence is in
`tmp/verify854/p05d/getall-consumer-stream-20261002-sol-active/`.
Starting dirty sources, fail-first logs, intermediate failures, saved request
bodies and final receipts remain there. No checkout, commit, push, GitHub action,
OCR, PR or merge was performed.

## Complete invoked cohorts

`AgentClient.initialize` previously called the active chat's default
`getHistory`, which forwarded through `ChatSession` and `ConversationManager`
to `HistoryService.getAll`. Its replacement waits for the active chat to become
idle and passes `chat.streamHistory(signal)` to
`prepareDeferredHistorySource`. That existing admission route writes a private
disk candidate, admits media one row at a time, estimates tokens before
publication and awaits durable acknowledgement. Only after candidate completion
does the transfer clear the old chat, publish the candidate and release prior
admissions. Source, tokenizer and abort errors preserve the active chat and
history. Clear failure disposes the candidate and releases its media reservations.
The unused array-based `RetainedHistoryAdmissions.transferActiveHistory` method
is removed.

The actual production rebuild caller is
`Config.initializeContentGeneratorConfig`, not a test-only invocation of
`AgentClient.initialize`. Its `extractExistingState` previously read an active
chat's default `getHistory`, or an inactive client's eager `getHistory`.
It now supplies a cold source. Active extraction uses `chat.streamHistory`
directly, preserving the existing no-idle-wait rebuild behavior. Inactive
extraction uses `client.streamHistory`. `transferHistoryToNewClient` consumes
that source through the awaited disk admission overload. Signature removal for
GenAI-to-Vertex happens one row at a time. The original row is charged while its
projected value is delivered; the admission route charges that projected value.
A scalar count replaces history-array length diagnostics. Config publishes its
new runtime and client after replacement preparation succeeds.

Both cohorts proceed through reused-service `createChatSessionSafe`,
`ChatSession`, token recalculation and media-owner settlement. Tests then invoke
real sends. The separate BODY lane takes the history produced by the real
Config rebuild through Anthropic, OpenAI Responses and Gemini converters with
caching disabled/enabled and retry.

No production collector, `Array.fromAsync`, full-history stringify, array-return
adapter or compatibility shim was introduced. Provider SDK bodies and other
preexisting owners remain separate proof surfaces.

## Explicit stream contract

These transfer paths no longer publish a caller-owned history array or retain
`_previousHistory` as their handoff. They publish a disk HistoryService and scoped
media reservations. Stream membership pins when consumption starts, not when a
cold generator is created. Returned rows are detached journal values; pending
source object identity is not the transfer result's identity. A paused outward
consumer retains only its delivered row and does not request another. Iterator
return, source failure and abort close the cursor and release registered owners.
Startup may perform its own token and media traversals while a previously opened
output cursor remains pinned. That work is measured separately from read-ahead
on the paused cursor.

The old array overloads of `setHistory`, deferred storage, restore and public
`getHistory` are unchanged. Their caller and pending identities remain owners;
this stage does not label them bounded.

## Fail-first and real-consumer evidence

- `red.log` records new 512/8192 active-client tests failing at the forbidden
  eager read. The foreground run was externally terminated before completing
  the whole suite; it is not a complete baseline-suite receipt.
- `config-caller-red.log` records both actual Config rebuild sizes failing at
  `extractExistingState`'s active `getHistory` call.
- `consumer-closing.log` has 13 passing active-transfer tests. These include
  successful startup/send, independently expected full-history digests and
  token totals, source error and cancellation at both sizes, an actual paused
  tokenizer consumer with fault injection, copied/borrowed identity controls,
  and one valid nine-MiB row.
- `config-isolated-8192.log` has the complete 8192-row Config replacement,
  paused output, startup and provider send passing with its unchanged deadline.
  `config-other-isolated.log` has the other six Config cases passing, including
  both source-failure modes at both sizes and a valid nine-MiB row.
- `config-caller-green-final.log` preserves an earlier combined-run timeout
  after the 8192-row startup/output-pause receipt. Its subsequent source-fault
  case also timed out. That process was cancelled; isolated final receipts
  are used instead. No deadline or assertion was relaxed.
- `signatures-final.log` checks GenAI-to-Vertex signature removal and Vertex
  preservation through actual deferred admission, including text, media,
  metadata and unchanged source values.

The row and byte limits remain 440 rows and 8 MiB. For small-row active and
Config routes, registered peaks are four rows and 7,503 bytes at 512 rows,
and four rows and 7,527 bytes at 8192 rows. Paused output/source/actual-tokenizer
consumers retain one row. Settled ownership returns to zero. A single valid
nine-MiB row is accepted separately; the aggregate small-row budget is not an
input rejection limit.

Borrowed and copied retaining controls charge 512 or 8192 identities. The
8192-row controls charge 20,513,451 serialized bytes. Their trap lane fails all
four cases against the same positive bounds. Pending and public-history
identity traps still fail two and four cases respectively. Named ownership
counters do not establish a whole-process heap limit or discover arbitrary
unregistered references. No new 1 MiB retained-heap or whole-provider proof is
claimed.

## Verification and preserved legacy RED

Final manifests and saved BODY pair comparisons identify the exact checked
sources and commands. Gates include the original 31 chronology/rollback tests,
targeted agents/core suites, public-history tests, provider BODY regression
suites, strict scoped and package TypeScript, forced 800/80 zero-warning lint,
formatting, diff-check, and duplicate-preserving test-audit comparison. The
structural scanner and negative traps are kept separate from ordinary passes.

`legacy-array-red.log` preserves the media lifecycle test's obsolete expectation
that reinitialization stores a reference in `_previousHistory`. That test now
reads the public stream and keeps its original content-ID, raw-data absence,
reservation and disposal assertions. `legacy-assertion-inventory.json` preserves
all twelve leaf test titles and the original matcher counts. Registration was
extracted to meet the unchanged function-size rule. All twelve media cases pass.

`client.model-profile.test.ts` remains untouched. Its selected run has seven
passes and two failures: the active reinitialization fake lacks `waitForIdle`
and expects a retained array; the stored-tools-refresh case also fails with the
starting client implementation. The isolated historical initialize comparison
has eight passes and that one tools-refresh failure. These are not counted as
passing tests.

`config.b.test.ts` also remains untouched. The preserved starting-source
comparison has 23 passes. Under the new stream contract, nine cases fail old
array/mock-interaction expectations, including mocks that never consume the
supplied source, a partial chat without `streamHistory`, and one-argument
`initialize` expectations. The new production-route and signature tests exercise
real consumption rather than replacing these assertions with weaker checks.
The legacy suite remains explicitly RED and needs contract-aware fixture
migration. Its no-idle-wait active rebuild requirement is retained in production.

## Exact remaining surface

`remaining-calls.json` records symbol-resolved direct calls and the raw/dynamic
wrapper inventory. The two direct calls still are:

| Direct call | Remaining owner |
| --- | --- |
| `ConversationManager.ts:500` | Default/false `getHistory`, dynamically forwarded by ChatSession. |
| `clientHistoryReader.ts:16` | Inactive eager public read from a stored service after checking the retained array. |

The eager `HistoryService.getAll` method at line 378 still calls
`materializeHistory`. The scanner has eighteen passes and two failing production
assertions, with exactly three findings: `HistoryService.getAll`,
`HistoryServiceCore.materializeHistory`, and
`HistoryServiceCore.captureChronology`. HistoryServiceCore and scanner/enforcement
files were not changed by this stage.

Remaining raw/dynamic consumers include eager Agent reads and carried startup;
control clear/rollback; ChatSession and public client forwarding; initialized
`setHistory` and array-deferred startup snapshots; CLI chat clear/restore;
checkpoint persistence and checkpoint utilities; and session cleanup media
reachability. Config extraction is no longer one of these eager callers.
`getAll` cannot be removed while these contracts remain. Full public removal,
legacy fixture migration, whole-session retained memory and provider retention
remain unfinished.
