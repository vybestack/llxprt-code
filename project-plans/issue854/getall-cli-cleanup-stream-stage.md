# CLI cleanup now streams history; both getAll callers remain

This stage uses the task's partial-delivery option. It completes the invoked CLI
cleanup caller across active and inactive stored-service clients. It does not
remove `HistoryService.getAll`, change public eager `getHistory` contracts, or
certify the remaining consumers. The production wrapper inventory falls from
twelve calls to eleven; both direct production `getAll` calls remain.

Evidence is in
`tmp/verify854/p05d/getall-final-stream-20261002-sol-cli-cleanup-3b72/`.
The starting dirty diff, starting sources, fail-first runs, ownership records,
BODY pairs, command manifests and final inventories are preserved there. No
GitHub operation, commit, push, OCR, PR or merge was performed. Existing changes
in `.llxprt` and the scanner/enforcement sources were left unchanged.

## Completed caller and external contract

`cleanupExpiredSessions` now passes a cold `AgentClient.streamHistory(signal)`
source to `runSessionCleanup`. On an active client, the existing reader waits for
idle and delegates through ChatSession and ConversationManager to the scoped
raw journal stream. On an inactive stored-service client, it reads the stored
journal directly. Membership pins at first consumption, rather than at generator
creation. Disabled cleanup and a busy janitor lease do not open the source.

`SessionCleanupParams.activeHistory` and `reclaimSessionMedia` accept asynchronous
or synchronous iterables. The latter validates media references one row at a
time and completes the source before deleting media. Both original and selected
content IDs remain protected. The existing content-ID reachability sets remain
in memory and scale with unique media identities; they are a separate metadata
owner, not a bounded whole-process proof. The source-row and reference-array
owners no longer hold the complete conversation.

An optional abort signal is checked before consumption, between rows and after
source completion. Exhaustion and source errors close the nested iterators. A
paused source retains one decoded row and does not read ahead. Abort and source
failure leave media reclamation unstarted, retain its blobs and release the
janitor lease. Cleanup retains its existing best-effort result contract: failures
are reported in `failed`, with the resolved configured byte limit preserved.
The signal does not promise interruption after media deletion has begun.

No production history collector, `Array.fromAsync`, eager array-return adapter,
full-history stringify or caller-owned row array was introduced. Existing
array-deferred and pending-row owners are unchanged and remain outside the
positive stored-service proof.

## Fail-first and behavior evidence

`cli-red-real.log` records one pass and 23 failures before production changes.
Both sizes and client states fail the actual CLI cleanup behavior, rather than a
mocked public reader. The earlier `cli-red.log` records a fixture import-path
error; it is not the fail-first behavior receipt.

The final CLI lane includes 24 new cleanup cases, six original cleanup-boundary
cases and two continuation integration cases. It checks complete ordered history
digests, unchanged token totals, preserved original and selected media bytes,
orphan deletion, source failure, paused source/abort, closed cursors, cold-source
skip behavior, retaining controls and a valid nine-MiB row.

The original cleanup fixture changed only its reader from an eager empty array
to an empty async generator. Its six titles and all fifteen matchers are unchanged
in `legacy-assertion-inventory.json`. `legacy-boundary-baseline.log` preserves the
starting six-case run; `cli-green-first.log` preserves the two fixture-contract
failures before that fixture migration.

Strict CLI TypeScript initially read stale referenced core declarations. After
rebuilding those declarations, it exposed the existing continuation fixture's
spread of an array-or-async-source union. That test-only fixture now consumes its
input with `for await`. Its assertions were not changed; the starting and closing
two-case behavior receipts are preserved. Production continuation code was not
changed. Test fixtures may retain arrays and are not included in bounded
production claims.

Small-row registered reader peaks are one row and 3,047 serialized bytes at 512
rows, and one row and 3,050 bytes at 8192 rows. At the pause, one row is decoded
and live. Every settled or aborted reader returns to zero live rows. The fixed
positive bounds remain 440 rows and 8 MiB. The valid nine-MiB row is separately
accepted, with a one-row peak and a 9,438,180-byte serialized charge.

The borrowed and copied CLI retaining trap has eight required failures against
those unchanged bounds. The pending-row trap has two required failures. Actual
legacy public arrays are measured independently: both active and inactive eager
reads retain 512 or 8192 caller-owned rows while their journal reader counters
are already zero. The 8192-row arrays charge 17,920,772 serialized bytes. All four
legacy eager-array traps fail the positive bounds. These controls prevent settled
reader counters from being mistaken for absence of external retention. No new
1 MiB retained-heap or whole-provider proof is claimed.

## Verification receipts

`manifest.json` and `closing-manifest.json` retain exact commands and exit codes.
The original 31 chronology/rollback tests pass. The core cleanup lane has 55
passes; checkpoint/replay has 39; public scoped history has 29; provider BODY
regressions have 18. The Config and export/summary BODY lanes save 36
expected/actual byte pairs covering three converters, both history sizes,
caching disabled/enabled and retry. These remain separate provider surfaces.

Strict core, agents and CLI TypeScript, forced 800/80 zero-warning lint,
Prettier, diff-check and duplicate-preserving test-audit comparison are recorded
in the closing receipts. Initial lint and duplicate-assertion findings remain
in their earlier logs. Equivalent grouped assertions retain all checked values;
no assertion, threshold, deadline, exclusion or enforcement rule was weakened.

The structural scanner is separately RED: eighteen passes and two failing
production assertions, with three findings. The unchanged findings are
`HistoryService.getAll`, `HistoryServiceCore.materializeHistory` and
`HistoryServiceCore.captureChronology`. The two Core findings remain independent
of the facade's outstanding callers.

## Remaining production surface and work

`remaining-calls.json` records the two symbol-resolved direct production calls:

| Direct call | Contract still requiring migration |
| --- | --- |
| `packages/agents/src/core/ConversationManager.ts:500` | Default and false `getHistory` return an eager array, forwarded by ChatSession. |
| `packages/agents/src/core/clientHistoryReader.ts:16` | Inactive public eager read returns the retained array or materializes the stored service. |

`remaining-api-red-final.log` preserves eight failures on real 512/8192 clients:
active and inactive `AgentClient.getHistory`, and explicit default and false
ChatSession reads. No default API is relabeled as streamed.

The eleven raw/dynamic wrapper calls remain in client-history forwarding,
AgentImpl public forwarding and carried startup, SessionControl clear/rollback,
ChatSession forwarding, initialized client `setHistory`, array-deferred startup,
CLI chat clear/restore, CLI tool checkpoint persistence and core checkpoint
utilities. Their complete paths and statements are in `remaining-calls.json`.

Finishing the public cohort requires coordinated return-contract changes across
ConversationManager, ChatSession, AgentClient and Agent. Carried startup must
consume deferred journals without creating a public array. Clear/restore must
use scoped disk candidates for retained prefixes and rollback, while preserving
durable rewind publication and media preflight. Checkpoint writers must consume
scoped sources into disk-backed JSON output while preserving replay bytes. Their
current array and JSON-string contracts cannot be replaced by a streaming return
type alone. Removing `getAll` also requires migrating its remaining test callers.
The eager method and its callers are therefore left present and explicitly RED.
