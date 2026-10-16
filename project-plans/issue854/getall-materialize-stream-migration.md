# Token accounting is row-wise; the getAll/materialize migration remains RED

This run implements a bounded token-accounting stage needed by streamed history
transactions. It does not complete the requested migration of
`HistoryServiceCore.materializeHistory(): IContent[]` and
`HistoryService.getAll(): IContent[]`. Both signatures and their eager bodies
remain. No accessor was renamed, hidden behind an iterator, or exempted by the
structural scanner.

Evidence is under
`tmp/verify854/p05d/getall-materialize-stream-20260930-branch3-sol/`.
Existing dirty work, `.llxprt` content, and earlier raw evidence were preserved.

## Implemented stage

Both token-recalculation paths now consume `journal.streamRows` directly.
`recalculateTotalTokensInternal` keeps the total and entry count as scalars;
`recalculateTokens` keeps only the total. Each stream captures pending and
durable membership at its first iteration and uses the existing disk-backed
fold. It closes the fold and releases the active row after exhaustion,
cancellation, tokenizer failure, or a source failure. Token totals are published
only after successful exhaustion. Existing token serialization, model selection,
image estimation, base offsets, FIFO ordering, and event behavior are retained.

`HistoryServiceCore.estimateTokensForContents` and the shared estimation helper
accept synchronous or asynchronous iterables and consume them directly. The
core wrapper no longer copies an input array. Existing mutation callers still
supply their array snapshots; this change does not make those callers bounded.
The new contract borrows input membership during iteration. A caller needing
snapshot isolation must supply a pinned journal stream or an immutable input,
not mutate a borrowed array while estimation is suspended.

The recalculation and hypothetical-estimation methods accept an optional
`AbortSignal`. Cancellation is checked before traversal, at row boundaries,
after tokenization, and at block boundaries. It does not interrupt a tokenizer
promise already in flight. Initial journal folding also remains noninterruptible;
the existing reader observes cancellation after the fold opens.

`pop()` now awaits its recalculation inside the mutation FIFO before returning.
The first adjacent run exposed two clone/trace ownership failures because the
new disk reader was still active after `pop` resolved. A suspended-tokenizer
RED test reproduces that early return. The correction keeps the eager pop
mutation in a synchronous helper, then awaits recalculation with only the
removed row in the caller. Tokenizer failure is returned to the caller, and
reader ownership is released. The removal remains applied if its subsequent
accounting fails; this stage does not add a pop rollback transaction.

No production row-size cap was added. A valid row exceeding 8 MiB is read and
estimated in the regression suite. The 8 MiB and 440-row assertions apply to the
controlled mixed fixture, not arbitrary accepted rows.

## Remaining complete caller chains

| Seam | Remaining context-length owners and required migration |
| --- | --- |
| Core mutation and rollback | `addBatch`, `replaceBatch`, `transformAll`, `replaceAll`, `applyDensityResult`, `commitHistoryMutation`, `planHistoryMutation`, and `compensateMutation` still own full arrays. `captureChronology` retains original caller objects and marker identities. Streamed replacement must operate on detached row values and pinned rollback membership, with journal admission and cleanup in the same transaction. The prior chronology identity report explains why restoring arbitrary displaced caller identities requires retaining those originals. |
| Media ownership | `registerMediaOwner`, `settleMediaOwnership`, synchronous reconciliation, and `HistoryMediaOwner.prepareReplacement` still expose full arrays. `HistoryMediaOwnership` uses disk-backed reference indexes, but array-valued preparation/rollback closures keep their inputs. Its existing reference-replacement protocol can participate in a streamed transaction; array fallback would preserve the defect. |
| Uncurated conversation and chat | `ConversationManager.getHistory(false)` and `ChatSession.getHistory(false)` still return raw readonly arrays, including invalid/empty content and metadata. Their return signatures and all indexing/slicing callers must move together. The wire semantics must remain raw, without adding provider curation or sanitization. |
| Client continuation and snapshots | `GeminiClient._previousHistory`, deferred history admission, provider/model rebuilds, `MessageStreamOrchestrator.getPreviousHistory`, reset/restore, and `ChatSessionFactory` still carry arrays. Replace them with explicitly owned, reusable disk-backed snapshots and release them on replacement, reset, abort, and disposal. A one-shot generator cannot replace a reusable previous-history snapshot. |
| Semantic-media purge | `SemanticMediaPurgeCoordinator` restores the frontier from `getAll`, and `begin` retains base and candidate arrays. `SemanticMediaPurgeTransaction`, persistence callbacks, request candidates, commit/rollback comparisons, and compensation all need a disk-backed transaction. Preserve frontier rebasing, pre-image boundaries, Responses suffix invalidation, concurrent-history rejection, media reservations, and primary/compensation errors. |
| Public consumers | `AgentClientContract.getHistory`, the agent API, context switches, checkpoint helpers, session cleanup, configuration lifecycle, CLI chat/copy commands, and Zed session loading still consume arrays. Changing `getAll` alone would either break these callers or encourage eager collection. Document an external API break when this complete chain changes. |
| Other hidden eager reads | `length`, `isEmpty`, last-speaker queries, clear/pop, context-range snapshots, validation, summarization, statistics, and JSON serialization still call `materializeHistory`. `getCuratedForProviderStream` still materializes before yielding. Recording already has disk-backed persistence snapshots on its streaming path, but legacy array-valued mutation events and purge persistence remain separate seams. |

None of these chains was redirected to another eager accessor. This run makes
no bounded continuation, purge-transaction, or complete provider-send claim.
A complete migration still needs real 512/8192-row continuation and previous-
history snapshot tests, purge atomicity and ownership tests, and independent
provider BODY BYTES tests through the migrated call chain.

## Tests and evidence limits

The new tests exercise real 512/8192-row journals containing text, media,
tool calls, responses, error markers, and historical model attribution. An
independent block-text oracle checks token totals and traversal order. Suspension,
tokenizer faults, pre-abort, in-row abort, producer faults, and clearing live
history during a pinned estimate cover ownership and cleanup. The registered
reader owns one decoded row. These counters do not discover arbitrary strong
references, so separate pinned-Bun child-process probes measure suspended
retained growth.

The child probes use five small/large pairs per workload, the existing paired
estimator, and the unchanged 1,048,576-byte allowance. Deliberately retained
whole-history controls must fail that allowance. Separate retaining controls
must also exceed the 440-row fixture limit and, at 8192 rows, the 8 MiB fixture
payload limit, then release their ownership to zero.

The initial behavioral RED log includes an incorrect test counter field,
`decodedRows`, which was corrected to the existing `rowsDecoded`. That log is
preserved and is not used to establish the full-row counter regression. Other
initial failures establish missing async input, cancellation, and suspended
ownership behavior. The initial child-process RED suite independently fails
both normal retained-growth certifications while passing both retaining traps.
A second RED run proves block cancellation originally performed four tokenizer
calls instead of stopping after one. No production baseline was reverted to
manufacture RED evidence.

Verification results and the exact structural progression are recorded in the
run manifests. Full acceptance, OCR, commit, push, and merge were not run.

## Final source verification

The final isolated run has 895 passing tests and three failures across 95
separate suite invocations. All 24 new tests pass. The three failures are the
unchanged suspended chronology rollback memory checks: retained-growth
certification, 440-row fixture ownership, and 8 MiB fixture payload. That
transaction exposes 8192 borrowed rows and 20,157,099 serialized bytes.
The ownership assertions and allowance were not weakened. Both retaining
negative controls in that suite pass.

Token-accounting normal upper bounds are 72,683 heap bytes and 69,939 external
bytes for total recalculation, and 76,731 heap bytes and 74,859 external bytes
for legacy recalculation. Their eager controls have heap upper bounds of
22,148,809 and 22,141,429 bytes, respectively. Raw samples, including all
individual deltas, are in `final/verified-memory.jsonl`.

Adjacent continuation, previous-history, semantic-media purge, media ownership,
recording, compression and CLI suites pass. Independent Anthropic and OpenAI
Responses BODY BYTES and Responses retry-body tests pass on their existing
seeded fixtures. These are adjacent parity checks, not a new 512/8192-row
bounded end-to-end provider/continuation/purge certification.

Official root `npm run typecheck` passes after the final source change. Gate
manifests preserve early lint failures and the corrected runs; no lint rule,
compiler option, structural whitelist, or assertion threshold was changed.
The exact structural audit remains RED with six findings: `materializeHistory`,
`captureChronology`, `getRawHistory`, `getAll`, `getCurated`, and
`getCuratedForProvider`. There are no added or removed structural findings.
The structural suite has 18 passes and two failing production assertions.


Full dirty-tree forced 800/80 and normal lint pass across 467 code files.
Repository `npm run lint`, dirty-file Prettier, and `git diff --check` pass.
Test audit initially found one new self-confirming pop assertion. Replacing
that baseline read with an independent fixture-block total removed the finding;
the corrected corpus has the same 2102 stable findings as the starting baseline,
with zero NEW and zero removed. The corrected pop tests still pass. All adverse
logs are retained, including the initial pop fixture timeout that did not
establish a valid RED and the later bound-journal RED that did.

The latest verification artifacts are split between `final/` and
`audit-corrected/`, with fresh gate results in `gates-corrected/`. Protected-path
SHA-256 manifests agree before and after this run. None of these results
certifies the unfinished whole-history chains in the table above.
