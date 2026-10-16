# The unused eager checkpoint preparation API is removed

`processRestorableToolCalls` and its private `processSingleToolCall` helper had
no executable production consumer in this repository. This stage takes the
removal option authorized by the task. It removes their eager
`agentClient.getHistory`, whole-object stringify and returned
`Map<string, string>` checkpoint aggregate. It does not add another unused
streamed export or migrate the remaining public history array APIs.

Evidence is in
`tmp/verify854/p05d/core-checkpoint-stream-20261002-sol-71fa/`.
`closing-manifest.json`, `assertion-inventory.json`, `audit-closing-delta.json`,
`body-pairs.json` and `final-source-hashes.json` record the closing checks.
Earlier failed lint, audit and source-control attempts remain in their logs.
No GitHub action, commit, push, OCR, PR or merge was performed. No enforcement,
threshold, deadline, protected source or `.llxprt` content was edited.

## Consumer proof and scope

The built-in AST search warned that discovery was truncated. That result was
not used as proof. `route.ts` instead uses the TypeScript compiler to parse all
6,385 TypeScript and JavaScript source files across packages, plugins, scripts
and integration-tests, without a file limit. `route.json` records every file,
identifier and string reference, symbol aliases, calls, package imports and
barrel exports. All five resolved calls are in `checkpointUtils.test.ts`.
The only production identifier is the declaration. Core's public barrel exports
it through `export *`; an export is not an executable caller.

Historical `gmerge-0.21.3/1f813f6a060e-plan.md` requested a CLI consumer of this
helper. The actual CLI has no such import or call. Its invoked route is
`saveRestorableToolCalls` → exported `createToolCheckpoint` →
`streamPrettyCheckpointJson` → `writeCheckpointAtomically`, with cold
`Agent.streamHistory(signal)`. The source and package export manifests were
examined rather than assuming an absent text match meant an absent caller.
The final census parses 6,387 files and finds no remaining call to the removed
symbol. The two new test files account for the count increase.

This proof covers this repository's executable consumers. It cannot establish
what an unpublished external program imports. Removing the export is a public
contract break for such a consumer; no compatibility shim is left behind.
The task's explicit unused-API removal option governs this change.

Only the five tests of the removed preparation API were deleted. The remaining
18 utility test titles and assertion expressions are unchanged. Their describe
registration was extracted into short functions to pass forced 800/80 lint.
The validation schema, checkpoint metadata reader, display utilities and
`ToolCallData` array shape remain unchanged. The core barrel source itself is
unchanged. The stale client-contract comment naming this utility as a
`getHistory` caller was removed; no client member was removed.

## Durable output and cleanup ownership

The actual exported writer returns `Promise<void>`, not checkpoint strings.
It resolves after the existing staged-file writes, fsync, close and rename.
`writeCheckpointAtomically` owns the file handle and staged-path removal;
`streamPrettyCheckpointJson` owns nested iterator cleanup. The hook owns its
mount-lifetime abort controller and retry reservation. The checkpoint directory
retains the final published file for restore. No history-sized string-map
owner is introduced.

The CLI save format remains the exact legacy pretty JSON object containing
UI history, native client history, tool call, commit hash and file path, with
no final newline. No save, restore, JSON encoder, disk writer, history admission,
token calculation or tool-pairing production code changed in this stage.
Existing version-1 restore coverage verifies messageId, filePath, snapshot,
legacy string arguments, native thinking signatures and unchanged input bytes.
The removed helper's messageId-producing output was not an invoked save path.

## Fail-first and replacement evidence

`public-route-red.log` records the fail-first contract: four actual exported
writer invocations pass at 512/8192 rows with active/inactive clients, while the
unused export-absence assertion fails. The writer was already streamed before
this stage. These four successes are not represented as new writer RED-to-GREEN
changes. The new removal assertion now checks both the direct utility and core
barrel namespaces.

The final new lane has nine passes: public-export absence, four independent
expected-byte comparisons through direct `createToolCheckpoint` invocation,
and four paused disk-sink cancellation cases. The expected checkpoint is built
from fixture rows rather than actual stream output or a checkpoint reread.
The cold reader decodes no row before iteration. Paused sink tests verify a
positive partial read count below the fixture size, zero further decoding while
the sink is blocked, no published file, bounded reader charges, source close
and staged cleanup on abort. The unchanged save suite also covers paused source,
pre-abort, source/write/fsync/close/rename failure and existing-file preservation.

At 512 rows the reader peak is one row and 3,047 serialized bytes. At 8192 rows
it is one row and 3,050 bytes. Live row and byte charges settle at zero. The
bounds remain 440 rows and 8 MiB. The unchanged nine-MiB row save/restore cases
pass with exact bytes and bounded encoder chunks, without applying the
small-row aggregate size bound to that single valid row. These receipts cover
row ownership and payload accounting, not a retained-heap or whole-process
memory proof.

The original RED fixture source remains unchanged, with its hash recorded in
`before-hashes.json` and `assertion-inventory.json`. Before removal its run had
two CLI passes and two core eager-reader failures. After removal its static
import is incompatible: zero passes and one module-load failure. It is retained
as old-contract failure evidence, not updated to return fake maps or relabeled
GREEN. The original historical failure log is also unchanged.

## Gates and required failures

The passing focused lanes include 44 CLI save cases, 42 restore contracts,
31 remaining core utility/lifecycle cases, the original 31 rollback cases,
39 checkpoint/replay cases, 39 deferred/client cases, 29 public scoped history
cases, four restored-media/resume cases and 18 provider BODY regressions.
The invoked checkpoint BODY lane has two passes and twelve identical expected/
actual BODY pairs for Anthropic, OpenAI Responses and Gemini, caching off/on
and retries. Token counts are checked against the independent fixture contract
of six counted blocks plus the 1,000-token image charge per row. Adjacent export
BODY has two passes. Additional core orphan/adjacency coverage has 19 passes.

Strict scoped core, agents and CLI typechecks pass. Closing forced 800/80 lint
has zero warnings, and scoped Prettier and diff-check pass. The full,
duplicate-preserving audit has zero added findings. It has two removed
MOCK_MIRROR findings, both from the five deleted tests of the removed API.
Those removals are enumerated rather than omitted from the audit comparison.
All 18 surviving utility tests retain their assertion expressions.
The initial new paused-sink test triggered SELF_CONFIRMING for comparing a
counter to its earlier value. Its final assertion checks the temporal counter
difference against zero, preserving the no-read-ahead requirement without an
expected value supplied by the same counter call. The initial finding remains
in `audit-delta.json`; enforcement was not changed.

Required controls still fail: eight save retaining cases, four restore retaining
cases and two pending-row cases. External retained rows remain charged even
when reader live counters settle at zero. The structural scanner remains at
18 passes and two failures for the unrelated eager history services. The
original CLI restore fixture still has its one legacy array-contract failure;
its title, source and assertions remain unchanged.

## Additional failure and evidence side effects

The extra `conversation-tool-pairing.test.ts` lane has four passes and one
failure: neutral recording expects zero recording reads but observes two.
The 512/8192 matching, cursor exhaustion and cleanup cases pass. No source or
assertion in that lane was changed, and the failure is not certified GREEN.
The removed API's consumer census contains no call from that lane.

Two attempted preload controls did not restore the old export into the CLI
namespace: the export-absence assertion still passed. Their receipts are
retained but are not used as baseline proof for this additional failure.
The direct pre-removal RED run and the source hashes provide the removal
contract evidence.

Running the unchanged original RED fixture before removal appended two
all-zero eager-owner records to the previous stage's
`final/restore-eager-owners.jsonl`, because the fixture writes relative to its
own `import.meta.dir`. The historical records were not edited or removed.
Its source and historical RED logs remain unchanged. This generated append is
an evidence-location side effect; the new logs, manifests, BODY files and
owner receipts otherwise live under the current stage directory.

## Remaining public array/read surfaces

The two direct production history `getAll` callers remain
`packages/agents/src/core/ConversationManager.ts:500` and
`packages/agents/src/core/clientHistoryReader.ts:16`.
Public default/false `getHistory`, the Agent forwarding methods, carried startup,
initialized array `setHistory`, chat restore and rollback wrappers remain eager.
`clientHistoryReplacement.ts:58` still reads initialized chat history.
Core `HistoryService.getAll`, `HistoryServiceCore.materializeHistory` and
`captureChronology` remain outside this removal.

`ToolCallData.clientHistory` remains an array-shaped public type. The legacy
role/parts validation schema still materializes its input array.
`getCheckpointInfoList` still accepts a caller-owned map of complete file
strings and parses each string; it was not migrated or removed here.
UI checkpoint history remains an array supplied by the UI. Individual native
rows and non-history restore metadata values are still materialized.
`remaining-calls.json` records the current candidate read/write call sites,
including test-support and unrelated similarly named methods, so it is not
presented as a filtered count of production history wrappers.
