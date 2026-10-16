# CLI checkpoint restore now admits disk rows without an eager history array

The invoked CLI save and restore routes now use scoped history sources. This
stage removes whole-file `readFile`/`JSON.parse` and eager `setHistory` admission
from `restoreCommand.ts`. It does not remove the exported core checkpoint
utility or the public array-returning history APIs.

Evidence is in
`tmp/verify854/p05d/checkpoint-restore-stream-20261002-sol-bc42/`.
`final/manifest.json` records the full verification cycle;
`final/closing-manifest.json` records gates repeated after the final test-only
extraction and active-client acknowledgement coverage. Earlier failed runs,
including the provider deadline regression, remain available. No previous stage
receipt, original restore assertion, enforcement rule, protected file, or
`.llxprt` content was changed by this stage. No GitHub operation, commit, push,
OCR, PR, or merge was performed.

## Invoked route and ownership

The route is `restoreAction` → `restoreCheckpoint` → `openDiskCheckpoint` →
`CheckpointJsonReader`. The reader frames JSON in 16,384-byte UTF-8 reads and
parses one metadata value or native client-history row. It never parses the
whole checkpoint or client-history array. The byte framer handles chunk splits
inside multibyte Unicode, escape sequences, and strings larger than a read
buffer. Syntax validation remains native JSON parsing of the framed value.

The declared dependencies, lockfile, and installed modules had no
`stream-json`, `jsonparse`, `clarinet`, or `@streamparser` candidate. The reader
uses established Node file handles and Buffer support, without a new package.
The dependency search and route references are recorded in
`final/route-dependencies.log`.

Preflight reads the complete object before any restoration side effect, retains
UI history and checkpoint metadata, and records only the client-history array's
byte range and count. Duplicate fields retain JSON's last-value semantics; an
own `__proto__` property does not modify the metadata object's prototype.
Native row speaker and blocks shape are checked, then existing history/media
admission performs its usual validation. Unknown checkpoint fields, version,
messageId, filePath, tool arguments, snapshot metadata, and native row values
are preserved. Checkpoint bytes are not rewritten.

Consumption rereads that range through the pinned file handle. It verifies
count, range end, and file size/mtime/ctime before publication. Truncation or
in-place change rejects the candidate. Preflight and yielded rows have explicit
optional ownership charges; iterator return and abort release their charges.
The file closes before project restoration and publication. Close is idempotent
and shares its result, including failure.

`AgentClient.setHistoryFromSource` → `replaceClientHistorySource` →
`admitDeferredHistorySource` → `HistoryService.transformRows` performs media
admission and detached disk-candidate writes one row at a time. Both initialized
chat history and deferred stored history use this route. It awaits the final
durable acknowledgement, clears obsolete deferred-array state, and resets IDE
context without calling an eager history reader. Existing reservation cleanup
covers source failure, abort, and journal failure. The UI publishes only after
admission succeeds; snapshot failure rejects the admission source before that
publication. Git snapshot filesystem effects are not a cross-resource
transaction with journal durability.

No whole-history collection or parser-side stringify is used. A whole individual
row and each non-history metadata value are still materialized. UI history
remains the existing array contract. These owners are not claimed to be bounded
by client-history length. This is row ownership and aggregate payload accounting,
not a new retained-heap or whole-process memory proof.

## Publication correction and immutable failure evidence

The first implementation reused ordinary marked-prefix mutation planning.
Converting inline images to media references changed every row, producing one
density mutation per row. The 8192-row provider oracle exceeded its unchanged
180,000 ms deadline. Profiling placed the delay after restore: each subsequent
journal fold scanned the complete directory once per density event.

Whole-source replacement now explicitly plans rewind/content operations through
`HistoryBatchOptions.replaceAll`. Only the new source replacement caller opts
in; existing deferred append and generic transform behavior keep their defaults.
The candidate still uses the same atomic mutation and durable acknowledgement
path. Chronology values remain unchanged. The original provider test now passes
at both sizes without altering its assertions, timeout, or fixture.

## Fail-first and compatibility contracts

`restore-red.log` records four failures before the route change: 512 and 8192
rows, each with active and inactive clients. The same four cases pass with eager
`setHistory` forbidden, digest equality against saved rows, exact UI history,
and bounded admission ownership. At 512 rows, reader and admission peaks are
one row and 3,047 serialized bytes. At 8192, they are one row and 3,050 bytes.
All live row charges settle at zero. The aggregate bounds remain 440 rows and
8 MiB. A valid nine-MiB row is accepted, charged, and compared without truncation;
only its individual size is exempt from the aggregate gate.

`preflight-owner-red.log` retains the failing preflight ownership receipt. The
closing parser suite includes byte-sized UTF-8 and escape boundaries, lone
surrogates, duplicate keys, corrupt JSON, truncated files, iterator return,
paused consumption, cancellation, and the oversized row.

The original `restoreCommand.test.ts` titles and assertions are unchanged.
Its `should restore a tool call and project state` case remains RED: the fixture
supplies legacy role/parts rows and requires an eager mock-array call. The real
client uses native speaker/blocks rows; this stage does not reinterpret
role/parts as native content. Replacement integration contracts verify the
actual bounded route with old version/messageId/filePath/commitHash fields,
legacy string tool arguments, native thinking signatures, exact UI and row
values, snapshot selection, unchanged cwd, and unchanged checkpoint bytes.
The preserved original test is not represented as GREEN.

## Closing gates and controls

The closing restore contract lane has 42 passes. It includes active and inactive
512/8192 invocations, twelve recovery failures, traversal rejection, nine-MiB
real save/restore, historical snapshot compatibility, and four paused durable
acknowledgement/cancellation cases. Recovery cases preserve prior history and
UI and leave no media reservation or temporary media file. Restored media
survives startup and releases on disposal in both client states.

The other passing lanes are the original 31 chronology/rollback cases, 39
checkpoint/replay cases, 44 CLI save cases, 36 core checkpoint utility/lifecycle
cases, 29 public scoped history cases, 18 provider BODY regression cases, 39
deferred/client cases, four restored-media/resume integration cases, and two
adjacent export BODY cases. The real save/restore provider oracle has two passes
and twelve exact BODY pairs across Anthropic, OpenAI Responses, and Gemini,
caching off/on and retries. Token counts retain the independent per-row oracle.

Strict scoped core, agents, and CLI TypeScript pass. Forced 800/80 lint with zero
warnings, Prettier, and diff-check pass after test helper extraction. The final
audit comparison has zero added and zero removed findings; its
duplicate-preserving report is stored alongside the closing manifest. No threshold, exclusion, deadline,
assertion, or enforcement rule was relaxed.

The original save retaining trap has eight required failures. The new restore
retaining trap has four required failures and charges the external owner even
when reader counters settle at zero. The pending-row trap retains its two
required failures. The structural scanner remains at eighteen passes and two
failures for the unmigrated eager history services.

## Remaining surface

The preserved four-case checkpoint receipt now yields two CLI passes and two
core failures in a copied current-run test. The historical four-failure receipt
and its source remain unchanged. `checkpointUtils.ts:124` still calls
`agentClient.getHistory`, and `processRestorableToolCalls` still returns whole
checkpoint strings through `Map<string, string>`. It needs a separate public
contract migration and durable consumption owner.

The direct `getAll` callers remain `ConversationManager.ts:500` and
`clientHistoryReader.ts:16`. Public default/false `getHistory`, forwarding,
startup, initialized array `setHistory`, chat restore, and rollback wrappers
remain eager. The initialized array wrapper's read moved to
`clientHistoryReplacement.ts`; extraction did not migrate that API.
`final/remaining-call-sites.log` records the current source locations. The CLI
checkpoint route no longer uses those owners, but none is relabeled as bounded.
