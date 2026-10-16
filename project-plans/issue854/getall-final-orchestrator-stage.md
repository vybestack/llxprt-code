# The per-turn orchestrator read streams; public history removal remains RED

This stage removes the invoked message-orchestrator eager read. It does not remove
`HistoryService.getAll`. The two exact production calls remain, along with fifteen
raw or dynamically forwarded `getHistory` calls and four structural findings.
Deleting the public method now would break their array contracts or require a
replacement eager collector. No such production adapter was added.

Evidence is under `tmp/verify854/p05d/getall-final-20261001T1325-sol/`. The starting
dirty tree, complete source hashes, symbol-resolved callers, structural findings,
host process list and full test audit were captured before production edits.
`stage.diff` separates this stage from earlier work. Starting versions of all eight
changed existing files were reconstructed from the captured dirty patch and HEAD,
then verified against their starting SHA-256 hashes. Five additional TypeScript
files contain the new tests and fixture. The receipt document is separate.

## Invoked production lane

`AgentClient._buildOrchestratorDeps` supplies the existing public `streamHistory`
reader. `MessageStreamOrchestrator.execute` passes the request signal to its IDE
history scan. That scan visits each raw row and retains two scalar decisions:
whether the pinned membership is empty and whether its final row is AI content
containing a tool call. It never stores the last row or a full input collection.
It preserves the old final-row decision, including a final tool-response row
allowing IDE context even when an earlier AI row contained a call.

The public reader still waits for the active chat's idle boundary, then opens the
existing raw journal cursor. Membership pins at that cursor's first iteration.
There is no read-ahead while its producer is paused. The source and cursor close
before IDE publication, and source failure or cancellation prevents IDE
publication. Errors keep their original object identity. The existing synchronous
`addHistory` and `recordSentContext` operations remain in their previous order
inside the post-scan IDE decision. The scan still runs when IDE mode is disabled,
matching the old unconditional history read.

This is a demand-driven traversal, not a constant-work tail lookup: decoding work
still grows with history length. The retained reader row is bounded by the actual
row size, not by an imposed input limit. Existing pending-writer identity owners,
deferred arrays, request conversion and SDK retry bodies are not bounded by this
change.

## Behavioral and ownership evidence

Fail-first real client sends at 512 and 8,192 mixed rows rejected the old array
read through a real facade subclass. The fixture includes text, inline media,
call/response blocks, response errors, chronology and historical model metadata.
An independent fixture constructor supplies the complete serialized-history digest.

Nine lifecycle tests cover both history sizes and one valid nine-MiB row. They
pause the actual producer at row 31, prove that it owns one decoded row and does
not advance while paused, append and commit a concurrent row, then verify that the
scan's original membership and complete digest remain unchanged. Additional cases
pause the outward event consumer after ModelInfo: no history scan starts during
that pause, and explicit return leaves no registered row owner. Producer and abort
errors propagate as the same original objects; a failed scan publishes no history
row. The nine-MiB row is preserved without truncation or admission rejection.

Five real IDE tests cover pending-call suppression, exact full IDE text and JSON,
and empty history. They observe actual `contentAdded` values. The selected
512/8,192 histories end with AI tool calls; an appended human row changes the
final-row decision and permits the expected context publication.

Ordinary controls retain borrowed rows or distinct copies in the source delivery
participant at both sizes. They detect growth beyond the unchanged 440-row and
eight-MiB positive bounds and release all charged objects. The separate
`ORCHESTRATOR_HISTORY_RETAINING_TRAP=1` run fails all four cases against those same
positive bounds. It has zero passes and four required adverse failures. The
positive paused reader has one registered row and returns to zero after closure.
These counters measure named owners, not arbitrary references or the whole heap.

The initial real-send fixture consumed its sole canned provider response during
unrelated automatic compression. Final large-history tests set a test-only high
context limit before chat initialization, so they exercise the selected read and
send without requiring an additional canned summary response. Production context
limits and compression enforcement were not changed. Initial failures and the
cancelled premature rejection-expectation run remain in the evidence directory.

## Focused verification

The final selected ordinary union has 197 passing cases and no failures across
23 isolated suites. This includes the original 31 atomicity/density rollback
cases, nine final lifecycle cases, five IDE cases, four ordinary retaining
controls, real client sends, eager identity compatibility, client media lifecycle,
send/error/overflow regressions, merge failure and chronology cleanup cases.
Repeated lifecycle and fixture confirmations are not added to the union.

The batch suite passes all eight cases on this starting/final source. Earlier
stage documents reported a frozen-metadata failure on older source; their raw
receipts were preserved, and no batch production code or assertions were changed
in this stage. Catastrophic rollback and compensation behavior is covered by the
unchanged original31 and adjacent mutation suites. No new control/checkpoint
transaction or compensation contract was implemented here.

The adjacent three-provider byte suite passes both size cases. All twelve saved
actual/expected request BODY files match byte-for-byte: Anthropic, OpenAI
Responses and Gemini, caching disabled/enabled at both sizes. The suite also
checks first-attempt and retry SDK body identity. These are adjacent provider
regression receipts; they do not prove bounded whole-provider memory or new
checkpoint/restore byte parity.

Official agents production and Bun-test TypeScript checks pass. The isolated API
surface declaration guard passes with 190 exported names matching its unchanged
snapshot. All thirteen changed/new code files pass forced 800 effective lines per
file and 80 per function, with zero ESLint warnings. Formatting and diff-check
pass. Root tests, a full build and model smoke were not run on the busy host.

The full test audit has 2,117 findings before and after, with zero new or removed
duplicate-preserving identities after excluding line drift. Fixture extraction
preserves the exact legacy test-title and assertion-matcher multisets. Only
non-audited suite group labels change where needed to meet existing registration
function limits. Test-only scripted chat fixtures provide their existing eager
fixture values to streams; that compatibility wiring is outside production.

## Exact remaining public graph

Both direct production calls remain:

| Call | Public eager contract |
| --- | --- |
| `packages/agents/src/core/ConversationManager.ts:499` | Default/false `getHistory` calls `HistoryService.getAll`; ChatSession dynamically forwards raw versus curated reads. |
| `packages/agents/src/core/client.ts:470` | Inactive eager client read falls back to its stored service after checking its retained array. |

The final fifteen raw/dynamic production `getHistory` calls are:

| File under `packages/` | Lines | Array owner or forwarding chain |
| --- | --- | --- |
| `agents/src/api/agentImpl.ts` | 876, 1229 | Public eager Agent read; carried-history startup. |
| `agents/src/api/control/sessionControl.ts` | 573 | Clear cut and prefix slice; media preflight; reset; original array rollback. |
| `agents/src/core/chatSession.ts` | 753 | Dynamic ConversationManager forwarding, including synchronous raw reads. |
| `agents/src/core/client.ts` | 336, 464, 501, 834 | Active-client transfer; public eager read; retained initialized history; deferred-startup transfer. |
| `cli/src/ui/commands/chatCommand.ts` | 453, 502 | Durable clear and restore; returned UI/client arrays. |
| `cli/src/ui/hooks/agentStream/checkpointPersistence.ts` | 101 | Whole-history checkpoint JSON and full output string. |
| `cli/src/utils/sessionCleanup.ts` | 70 | Active-history media reachability input for the janitor. |
| `core/src/config/agentClientLifecycle.ts` | 116, 117 | Existing client history extraction and replacement transfer. |
| `core/src/utils/checkpointUtils.ts` | 124 | Eager checkpoint utility receipt and output string. |

`remaining-chains.json` records each statement and local result use. Immediate
returns and dynamic forwarding are included rather than dismissed as having no
local owner. Curated explicit-true consumers are in the complete caller artifact,
but not counted as raw calls. ACP live replay already uses the public stream; its
pending tool-ID Map remains a separate possible growth owner. Checkpoint restore
and continuation still pass decoded history/UI arrays onward; converting only
checkpoint serialization would not migrate that restore ownership.

The same twenty-three internal production `materializeHistory` calls remain.
Their exact methods and locations are in the artifact. The structural findings
remain `HistoryServiceCore.materializeHistory`,
`HistoryServiceCore.captureChronology`, `HistoryService.getAll` and
`HistoryService.getCurated`. The unchanged structural suite has eighteen passes
and two failing production assertions, including passing mutation controls. No
scanner exemption or root AST whitelist was added.

## Acceptance limits and next work

Public API removal, synchronous caller-owned identity migration, deferred client
media transfer, control/CLI clear and restore, streaming checkpoint persistence
and cursor restore remain incomplete. Each requires its own invoked transaction
lane with failure compensation, identity preservation where callers own pending
rows, and independent output-byte evidence. Relabeling arrays or full JSON output
strings as snapshots would not resolve those owners.

No quiet-host statistical retained-heap, whole-session, whole-provider or no-leak
acceptance is claimed. The retention allowance and estimator were not changed.
All starting files outside the eight selected edits are byte-identical to their
captured hashes, including `.llxprt`, structural controls, test-audit code,
enforcement and the public surface snapshot. Earlier raw evidence was preserved.
No GitHub, commit, push, OCR, PR or merge action was performed.
