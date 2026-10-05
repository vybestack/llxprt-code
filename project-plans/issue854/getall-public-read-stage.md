# Public agent reads and ACP live replay stream rows; four eager findings remain

This stage migrates the invoked read-only client/agent history lane, live ACP
reattachment replay, and configuration's post-authentication count report. It
does not remove `HistoryService.getAll` or `HistoryServiceCore.materializeHistory`.
The unchanged scanner reports the same four findings before and after the stage.
Checkpoint receipts, clear/restore, continuation and client replacement still
carry arrays. Their contracts require a separate transaction and persistence
migration.

Evidence is under
`tmp/verify854/p05d/getall-public-read-20261001T1017-sol/`. Starting source hashes,
dirty changes, AST caller inventory, structural findings and test-audit results
were captured before production changes. Earlier dirty work and immutable
evidence were preserved.

## Invoked reader and ownership

`AgentClientContract` and `Agent` now require `streamHistory(signal?)`.
`AgentImpl` delegates directly to the real client. `AgentClient` installs
`createClientHistoryReader` with accessors for its active chat, retained previous
history and stored service. There is no `Array.fromAsync`, public array adapter,
full-history collector or replacement eager accessor in this route. The old
`getHistory` APIs remain explicitly eager compatibility surfaces.

An active-chat read waits for the same idle boundary as the eager client read,
checks cancellation again, and delegates to the existing chat/conversation/raw
journal cursor. Membership pins when that underlying cursor opens after the
idle wait, not when the public generator is constructed. A stored service
uses the same raw cursor directly.

For an uninitialized client's retained previous history, a synchronous capture
writes each value to the existing `HistoryDensityRows` disk spool. It does not
append identities or keep a new content collection. Its local array reference
ends before any generator suspension. The asynchronous reader retains only the
spool and closes it after exhaustion, early return, abort or failure. Capture
failure also closes the spool. Replacing the live client after first delivery
does not change that snapshot's remaining values. This read-only surface returns
detached disk values, not the old caller row identities. The existing eager API
continues to provide its old array-level isolation and identity behavior.

The client's existing `_previousHistory` field, media-admission reservations and
array-valued continuation paths remain owners. A bounded new reader does not
make those owners bounded. Pending journal identities retain their previous
ownership and transaction semantics. No mutation, rollback, chronology or
Responses-chain policy was changed by this read lane.

Unused generators acquire no row resources. Pre-abort is checked before source
selection. Later cancellation is cooperative: it does not interrupt an idle
promise already in flight or a consumer paused between `next` calls. Consumers
must exhaust or return a manually opened iterator. There is no read-ahead while
row delivery is paused.

## Production consumers and output

`readAgentHistoryAsIContent` and `readAgentHistoryForReplay` now yield the public
agent stream. `zedIntegration` supplies that generator directly to the existing
replay delivery chain. The replay wrapper catches failures during traversal,
not merely at generator construction. Delivery, producer and cancellation
errors retain ACP's `internalError` result and replay metadata. Existing
RequestErrors pass through.

The existing ACP mapping still preserves row/block order, first-response
pairing, repeated call-ID behavior, interrupted-call terminal updates and title
hydration. Independent eager mapping of fixture values is the byte oracle for
the selected replay tests. A paused delivery owns one decoded source row.
However, `streamHistoryToSessionUpdates` still retains its pending tool-ID Map.
That Map can grow with unmatched calls; this stage does not certify bounded
whole-replay memory or rename that owner into a bounded structure.

`Config.initializeContentGeneratorConfig` counts the new client's stream with a
scalar for its existing post-authentication diagnostic. It no longer asks for a
whole array just to read `.length`. Its original-history capture and replacement
transfer remain eager. The diagnostic count, preserved-history flag, tokenizer
installation and fallback reset retain their existing behavior.

The public interface break, detached deferred values, pin timing and cleanup
contract are documented in `docs/migration/history-raw-stream.md`. External
implementations must supply the required client/agent stream method. Test-only
scripted contracts provide their own streams; their existing array fixtures are
not production bounded-history evidence.

## Tests and limitations

Fail-first public tests exercised the real public agent, client, chat and disk
journal route. The old implementation lacked the public method or invoked the
forbidden array read. ACP's first fixture lacked `getEmbeddingModel`; that
setup failure remains recorded separately from its subsequent array-forbidden
RED. Configuration's real streamed-report tests also failed before migration.

Real 512/8192-row mixed fixtures include text, media, calls, responses, errors,
chronology and historical model attribution. Digest checks compare complete
raw values against independent fixture construction. Tests cover active and
stored histories, pinned membership across clear, demand-driven decoding,
consumer failure, source failure, early break and resumed cancellation. A valid
nine-MiB row survives without truncation. Deferred snapshot tests at both sizes
verify detached values and pinned replay after client replacement.

Controlled positive readers peak at one decoded row and release registered
ownership to zero. The fixture limits remain 440 rows and 8 MiB serialized
payload. Deliberate borrowed-row and distinct-copy consumers exceed those
bounds. The separate `PUBLIC_HISTORY_RETAINING_TRAP=1` run has four required
failures at the unchanged positive bounds, and cleanup still releases every
charged object. Named ownership counters do not measure arbitrary JavaScript
references, the retained client array, or the ACP pending-ID Map.

Statistical retained-heap testing is deferred on the busy host. The 1,048,576-byte
allowance and its estimator were not changed. There is no statistical retained
heap, whole-session, no-leak or whole-provider acceptance claim in this stage.

## Exact remaining public and mutation chains

The symbol-resolved AST inventory distinguishes history methods from the model
registry's unrelated `getAll`. It resolves both source and emitted declaration
symbols. `callers-before.json`, `callers-after.json` and `remaining-chains.json`
record source positions, receiver types, declarations, enclosing statements and
uses of local results, including shorthand object properties.

Five exact production/script `HistoryService.getAll` calls remain:

| File and line | Remaining chain |
| --- | --- |
| `packages/agents/src/core/ConversationManager.ts:499` | Raw `getHistory(false/default)` array contract delegates to `getAll`. `ChatSession.getHistory(curated)` forwards that contract. |
| `packages/agents/src/core/client.ts:470` | Eager `AgentClient.getHistory` uses stored-service `getAll` when there is no active chat or previous array. Public eager agent reads still delegate here. |
| `packages/core/src/services/history/HistoryService.ts:787` | `merge` supplies `other.getAll()` to `addAll`, preserving its synchronous eager mutation contract. |
| `scripts/issue-3199-media-memory-target.ts:156` | Probe supplies full history to `persistence.save`. |
| `scripts/issue-3199-media-memory-target.ts:236` | Probe materializes history just to count settled contents. |

There are no explicit production `getHistory(false)` calls. The five explicit
false calls are tests, and their result uses are inventoried. Raw production
calls use the default argument, plus the dynamic chat forwarding call. Sixteen
non-explicit-true production calls remain:

| File and lines | Downstream array owner |
| --- | --- |
| `agents/src/api/agentImpl.ts:876,1229` | Eager compatibility read and carried-history startup. |
| `agents/src/api/control/sessionControl.ts:573` | Clear cut, prefix slice, media admission, reset and rollback. |
| `agents/src/core/chatSession.ts:753` | Dynamic raw/curated forwarding contract. |
| `agents/src/core/client.ts:223,336,464,501,834` | Orchestrator dependency, active-history transfer, eager read, initialized set-history ownership and deferred startup ownership. |
| `cli/src/ui/commands/chatCommand.ts:453,502` | Clear and restore mutators. |
| `cli/src/ui/hooks/agentStream/checkpointPersistence.ts:101` | Whole client-history JSON receipt. |
| `cli/src/utils/sessionCleanup.ts:70` | Cleanup's active-history input. |
| `core/src/config/agentClientLifecycle.ts:116,117` | Existing-history extraction and replacement transfer. |
| `core/src/utils/checkpointUtils.ts:124` | Whole client-history checkpoint serialization. |

Paths in the second table are relative to `packages/`. Immediate-return calls
still expose eager downstream ownership even if there is no local binding.
Checkpoint helpers additionally retain complete output strings; merely replacing
the input array with another full-context buffer would not meet this migration's
bounded-read goal.

The 24 exact production `materializeHistory` calls remain. In `HistoryService`
they belong to `replaceToolResponseBlockInternal`, `getAll`, `clearInternal`,
`getCurated`, both removal checks, both pop reads, last-user/last-AI queries,
`length`, `isEmpty`, validation, summarization, `toJSON` and statistics. In
`HistoryServiceCore` they belong to add, addBatch, transformAll, media registration,
both ownership-settlement reads, context-range capture and context-range event
publication. The AST artifact records every position. Removing them requires
streamed mutation publication and rollback, not a read-only wrapper.

The unchanged four findings are `HistoryServiceCore.materializeHistory`,
`HistoryServiceCore.captureChronology`, `HistoryService.getAll` and
`HistoryService.getCurated`. The structural suite remains RED with two failing
production assertions. The public transform-owner tests also retain their
original three failures. They were not excluded from the ordinary regression
inventory or weakened.

## Verification evidence

`original31-exact.log` records 31 passes with zero failures. `structural-exact.log`
records 18 passes and the two unchanged failures, including passing mutation
controls. A first unprefixed Bun path also matched archived baseline suites;
that adverse discovery log remains, and the exact `./` invocation is the
source-tree structural receipt.

`cohort-release/manifest.json` records final-source public, client, API, ACP,
configuration, CLI and checkpoint invocations. Supplemental deferred tests and
final config refactor checks have their own logs and exits. The broad regression
manifest includes independent provider BODY byte matrices and adjacent untouched
suites. Current-source summary counts and gate results are recorded in
`verification-summary.json` after the drivers complete.

The API-surface guard fails its isolated declaration build on `import.meta.dir`
in the unchanged provider-fallback and chronology-rollback test helpers. Official
root typecheck is a separate result. That guard failure is preserved and is not
reclassified as passing. Protected code was not edited to address it.

Static runs preserve initial and corrected root typecheck/lint, full-dirty normal
and forced 800/80 zero-warning ESLint, Prettier, audit and diff-check results.
The test audit compares duplicate-preserving identities while ignoring only
line positions. Test callback refactoring retains all 23 config test titles and
matcher counts, as recorded in `config-final-assertion-inventory.json`. Early
mock-contract, generic fixture-return, callback registration, suite-attribution
and lint failures remain in the evidence directory.

No protected source, `.llxprt` contents, immutable evidence, ownership threshold,
scanner whitelist or enforcement policy was changed. No GitHub, commit, push,
OCR, PR or merge action was performed.

## Completed source-tree receipt

Both verification drivers finished. The final isolated ordinary union has 2,664
passes, zero failures and zero skips across 289 invocations after selecting the
latest receipt for each exact suite path. The exact original 31-case run is
reported separately and passes all 31. The union excludes the unchanged
structural suite's two failures and the transform-owner suite's three failures;
both are preserved in `verification-summary.json`, not waived. The separate
retaining-trap receipt has four required failures. The earlier missing-stream
config failures have an exact final-source 23-pass replacement receipt; their
original logs remain.

Nine provider body suites pass 124 cases, including the semantic-purge adjacent
suite. There are 96 saved actual/expected file pairs and no byte differences.
Saved pairs are not a one-to-one count of scenarios: some matrices assert bytes
in-process without saving files, and others reuse a receipt filename for caching
variants. No JSON normalization was used. These are regression parity checks
through existing provider lanes, not a bounded whole-provider certification.

Official root typecheck and lint pass on final source. All 705 dirty code files
pass normal and forced 800/80 ESLint with zero warnings, and all pass Prettier.
The audit has 2,117 findings before and after, zero new and zero removed. Config
callback extraction preserves the individual title multiset, assertion matcher
counts and the one audited full suite path. Other default-only suite paths were
moved into a separate describe to satisfy the unchanged function-size rule.
The supplemental migration-doc Prettier check and final diff-check pass.
All 20 protected hashes, including project memory and skills, match the starting
state. The API-surface declaration guard remains failed for the two unchanged
`import.meta.dir` helper diagnostics described above.

Structural progression is four findings to four. Production caller progression
is five exact `getAll` calls to five, 18 non-explicit-true `getHistory` calls to
16, and 24 internal `materializeHistory` calls to 24. The two removed array reads
are the configuration count and the ACP live-replay bridge. Test
harnesses are excluded from those production counts, while their explicit false
result consumers remain recorded in the complete AST inventory.
