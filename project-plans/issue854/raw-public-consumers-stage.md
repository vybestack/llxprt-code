# CLI copy and diagnostics stream rows; the raw facade remains RED

This stage converts the complete read-only CLI clipboard and chat-diagnostics
lane. `/copy` and `/chat debug` no longer materialize the conversation through
`ChatSession.getHistory()`. Clear/restore, ACP live replay, checkpoint receipts,
client deferred history and the exact raw facade remain RED. No full-session
bounded-memory acceptance is claimed.

Evidence is under
`tmp/verify854/p05d/raw-public-consumers-20260930-sol/`. The starting dirty diff,
protected hashes, source AST inventory and test-audit findings were captured
before implementation. Earlier dirty work and evidence were preserved. The
starting scanner has five findings, rather than the six described by the earlier
compression-annotation stage. This stage leaves those five findings unchanged:
`materializeHistory`, `captureChronology`, `getRawHistory`, `getAll`, `getCurated`.
The requested five-to-four reduction is not achieved.

## Invoked production lane and public contract

`AgentChatContract` now requires
`streamHistory(signal?: AbortSignal): AsyncGenerator<IContent, void, unknown>`.
`ChatSession` delegates to `ConversationManager`, which delegates directly to
`HistoryService.streamRawHistory`. Membership is pinned at the first `next`, not
at generator creation. Rows are borrowed read-only inputs for the consumer;
retaining or copying them remains the consumer's responsibility. Exhaustion,
`return`, consumer failure or source failure unwinds the journal cursor;
cancellation is forwarded to the same source. There
is no whole-history collection or array-to-cursor adapter in this production
path. Cancellation is observed when iteration resumes; abort alone does not
force a suspended consumer callback to settle. A public caller that abandons
manual iteration must call `return` in cleanup.

This is an interface break for external implementations of `AgentChatContract`:
they must supply the required method. The repository's typed scripted contracts
and core test client were updated. Array-valued `getHistory`, `setHistory`,
`AgentClientContract.getHistory` and `Agent.getHistory` remain unchanged. The
new cursor does not consume `_previousHistory` or deferred client arrays.

`/copy` folds each AI row to text immediately and retains only the latest AI
text. Human and tool rows do not replace that value; a later AI row without
text does replace it with empty text, preserving the old no-text response.
Thinking, tool and media blocks are not copied. Multiple text blocks are
concatenated without separators. No selected `IContent` or array of AI rows is
kept for clipboard publication. The clipboard receives the complete selected
string, including UTF-8 text. Memory for that output remains proportional to
one message's text; an arbitrary message is not subject to an 8 MiB limit.

`/chat debug` counts rows with a scalar and preserves the existing diagnostic
text. Cancellation is no longer swallowed by the existing unavailable-history
catch. Both commands forward the invocation signal and check it after traversal.
A source failure in copy propagates before any clipboard publication. Clipboard
infrastructure failures retain the existing user-facing error. An already
started clipboard write is not interrupted or rolled back by this change.

## Behavior and ownership evidence

Fail-first logs with a valid runtime fixture show the old copy action invoking
the forbidden raw-array read, absent public cursor behavior and debug's swallowed
cancellation. Earlier fixture-setup errors are retained separately and are not
counted as behavioral RED evidence.

The behavioral suites instantiate real ChatSession, ConversationManager,
HistoryService and disk journals with 512 and 8192 mixed rows. They include
human/AI/tool speakers, multiple text blocks, media, tool calls/results/errors,
thinking and chronology metadata. Clipboard expected bytes are generated from
fixture position and text rules independently of the reader output. Full
printed diagnostic text is assembled independently from the fixture size.
Existing clipboard edge cases use the same real path; only clipboard I/O and
unrelated command-context access are replaced.

At the paused clipboard callback, the journal reader, borrowed-row observer and
external distinct-copy observer have each released all rows. Each peaked at one
row. The clipboard's retained output string is measured separately. At a paused
row delivery callback, each registered row owner holds one row and exactly five
rows have been decoded, with no read-ahead while paused. A separate public
consumer callback holds the yielded row and a distinct shallow copy: the three
source-side owners each hold one row, the callback owns two distinct objects,
and only one row has been decoded. A thrown callback error closes the entire
iterator chain and releases all four owners to zero. Cancellation reads no
sixth row and releases every registered row owner. Clearing live history while
paused still produces the independent original snapshot's clipboard bytes.

The public cursor tests also verify an unused cursor acquires no rows, first-next
membership, early return, pre-abort and deterministic release. Producer failure
and clipboard failure tests check cleanup. A valid row with text larger than
8 MiB is read and copied without truncation; the arbitrary-row case does not
apply the controlled-fixture byte bound.

The fixed controlled limits remain 440 rows and 8 MiB of serialized payload.
Positive tests register reader, borrowed and external-copy owners. Deliberate
consumers retain every borrowed row or a distinct shallow copy. Separate adverse
probes assert the normal bounds and must fail: both 512-row probes exceed the
row bound, and both 8192-row probes exceed row and byte bounds. Their finally
blocks release the retained objects to zero. The passing source tests also
assert that those deliberate owners are out of bounds. Registered ownership
counters measure named owners, not arbitrary JavaScript references or heap size.

The tests exercise the chat cursor and CLI consumer, not a real client's entire
previous/deferred-history lifecycle. Existing client retained arrays are listed
below. No provider BODY ownership change is claimed.

## Exact remaining raw calls and retained ownership

The exact `HistoryService.getRawHistory(): readonly IContent[]` production/script
call count remains eight. There are no direct plugin calls. These are call sites,
not eight distinct functions:

| File and line | Remaining ownership and required migration |
| --- | --- |
| `packages/agents/src/compression/CompressionHandler.ts:201` | Density optimization supplies the whole array to a synchronous strategy. Strategy decisions and addressed application must migrate together. |
| `packages/agents/src/compression/toolResultTruncator.ts:194` | Legacy ranking retains tool candidates, positions and the raw array. It needs bounded ranking and addressed replacement. |
| `packages/agents/src/compression/toolResultTruncator.ts:344` | Captures whole-array length for the concurrency guard. A scalar guard must preserve mutation detection semantics. |
| `packages/agents/src/compression/toolResultTruncator.ts:345` | Re-materializes whole-array length when that guard runs. It shares the same required migration. |
| `packages/agents/src/compression/toolResultTruncator.ts:636` | Unified ranking also owns whole-history candidates and offsets. Pending-tool ranking and recency ties must remain equivalent. |
| `packages/agents/src/compression/providerContentEnforcement.ts:651` | Copies raw history for fallback rollback and copies again for restoration. It needs a reusable owned disk snapshot with release on every exit. |
| `packages/core/src/storage/media-lifecycle-metrics.ts:189` | The synchronous metric source also retains a reference-byte Map. Changing the input alone would leave that index unbounded. |
| `scripts/issue-3199-media-memory-target.ts:205` | Sends a raw array to the media resolver. Its admitted-row probe remains an array-valued public input. |

Other eager public caller chains remain separate from those eight exact calls:

- `ConversationManager.ts:489-500` and `chatSession.ts:745-753` retain the old
  uncurated array contract through `HistoryService.getAll`.
- `client.ts:335,467,498,833` captures active chat history for persistence, returns
  arrays and stores `_previousHistory`; its uninitialized branch copies previous
  arrays or calls stored-service `getAll`.
- `agentImpl.ts:875-876,1223` exposes client arrays and carries them across startup;
  `control/sessionControl.ts:573` uses the array contract at the session boundary.
- `chatCommand.ts:453,502,571` still feeds clear/restore mutation arrays and emits
  a `clientHistory` receipt. `slashCommandHandlers.ts:467` consumes that receipt.
  UI restore projection also collects remaining rows.
- `zed-session-loader.ts:141` spreads `Agent.getHistory` for live replay. The ACP
  replay mapper additionally retains pending tool IDs in a Map.
- `checkpointUtils.ts:17,39,124-127` owns and serializes whole `clientHistory`
  arrays. Its persisted receipt schema still accepts arrays.

Those chains cannot be removed by adapting an eager result into an async
iterator. They need changes to mutation, persistence, replay indexing and
ownership release. This stage leaves them visible and does not rename or exempt
any scanner finding.

## Verification record

Final command results are recorded in `accepted/manifest.json`, which preserves
inherited `final/` invocations and replaces rerun entries with their exact log
paths. Provider byte receipts remain in `final/`. The verification driver runs the inherited regression inventory, the new cursor
suites, all ACP source test files, the original 31 atomicity/density cases,
provider BODY byte matrices, official root typecheck/lint, full-dirty normal and
forced 800/80 zero-warning ESLint, dirty-file Prettier, test-audit comparison,
unchanged structural assertions and mutation controls, protected hashes and
`git diff --check`.

The final ordinary regression record has 1,832 passes and no failures across
191 isolated invocations, including the 19 new cursor/consumer cases and all
31 original atomicity/density cases. All 52 saved actual/expected provider BODY
pairs match byte-for-byte. The unchanged structural suite has 18 passes and two
failing production assertions: its exact five findings match the baseline. With
that suite included, the record has 1,850 passes and two failures across 192
test invocations. The separate retaining-trap run has four expected failures.
Both 512/8192 semantic-purge no-materialization controls pass at their actual
agents-package path.

Official root typecheck and lint pass. All 615 dirty code files pass normal and
forced 800/80 ESLint with zero warnings and Prettier checks. The audit multiset
contains 2,126 findings before and after, with zero NEW and zero removed. All
20 protected hashes match, exact raw-call inventory and structural findings
are unchanged, and `git diff --check` passes. This is selected regression and
gate verification, not the full repository test suite or full Issue854 acceptance.

Adverse logs remain available. The first runtime fixture omitted a tool-registry
method; the fixture was corrected before the behavioral RED run. Initial root
TypeScript errors found scripted chats without the required method and a test
import crossing CLI's declaration-build root. The fixture moved to the existing
CLI test-utils directory and uses the established agents `internals` export.
The erroneous declaration build generated 83 new source-adjacent `.d.ts` files;
only those files, absent from the captured baseline, were moved into this stage's
ignored evidence directory. The corrected official build/typecheck passes.
Initial lint failures were corrected by splitting test groups, using method
shorthand and real cursor-backed clipboard cases, without suppressions. The
first audit found duplicate decode-count assertions; the paused-state assertion
now checks both decoded count and peak reader rows, while the terminal assertion
separately checks no additional reads. No count or ownership check was removed.

The inherited verification driver addressed a semantic-purge test in the wrong
package and received a no-matches error. The final driver uses its existing
agents-package path and preserves the initial failed invocation's log. A separate
CLI import-boundary check reports 19 violations in untouched dirty files, with
no entry for this stage's production or fixture files. These findings were left
unchanged; no boundary allowlist or enforcement was edited.

Statistical retained-heap probes are deferred. The recorded host process list
shows unrelated CPU-bound shells and CLI/Bun sessions. The retained-growth
allowance, estimator, fixture limits and enforcement were not changed. No
retained-heap acceptance claim is made.

No protected source, `.llxprt` content, prior evidence or enforcement was edited.
No GitHub, commit, push, OCR, PR or merge action was performed.
