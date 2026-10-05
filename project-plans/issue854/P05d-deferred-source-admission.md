# Deferred disk-source admission is implemented; full 8192-row startup remains unproven

The new production source and its invoked first caller pass at 512 and 8192
rows. The complete CLI restore plus ChatSession startup passes at 512 rows. The
8192-row complete-route test reaches journal adoption, then times out during
`AgentClient.startChat([])`. It remains a failing test. This slice does not close
P05d or certify whole-session retained memory.

## Invoked route

`setupSessionRecording` in `packages/cli/src/cliSessionBootstrap.ts` gets the
`ResumeCursorBoot` returned by `resumeSession`, then calls:

1. `restoreResumeBoot` in `packages/cli/src/services/restoreResumeBoot.ts`.
2. Its invoked `admitResumeHistorySource` operation, when the chat is inactive.
3. `AgentClient.storeHistoryForLaterUse(boot.streamRows(), options)`.
4. `prepareDeferredHistorySource` in `packages/agents/src/core/deferredHistorySource.ts`.
5. A private disk HistoryService candidate, with a scoped disk merge of prior
   membership to preserve chronology reconciliation, followed by one-row media
   admission and `transformRows` / `sink.appendDetached`.
6. Stream publication with `awaitDurableCommit: true`, including its final
   durable acknowledgement. Only then does AgentClient swap the stored service
   and clear `_previousHistory`. Media reservations remain in a disk index.
7. `restoreResumeBoot` adopts the recorder through `HistoryService.adoptResumeBoot`.
8. `AgentClient.startChat` passes the stored service to `createChatSessionSafe`.
   The factory reuses it, configures token accounting and constructs ChatSession.
   The client settles chat media ownership before releasing source reservations.
9. `streamHistory` returns scoped detached journal values. Consumer pause,
   replacement and clear cannot change an already opened snapshot.

The source overload returns `Promise<void>`, not caller rows or a history array.
`streamHistory` supplies returned rows after durable admission. Input identity is
not preserved on this overload. The migration document records these semantics.

## Fail-first evidence

Evidence directory:
`tmp/verify854/p05d/deferred-stream-admission-20261002-sol-854/`.

- `red.log`: four streamed-input tests fail at the eager `history.some` boundary.
- `caller-red.log`: a real new client is initialized by the previous resume
  caller instead of remaining deferred.
- `media-red.log`: streamed media reservations survive client disposal.
- `durable-red.log`: admission returns before its final acknowledgement.
- `visibility-red.log`: in-place journal mutation exposes the new row while the
  final acknowledgement is paused. A separate disk candidate fixes this.
- `admission-final.log`: seven admission tests pass, including 512/8192 rows,
  source throw, cancellation, valid 9 MiB row, producer pause, startup
  failure/retry/disposal and final durable acknowledgement.
- `ack-final.log`: the final acknowledgement test additionally verifies public
  history remains unchanged while the final write is paused and a write failure
  preserves committed rows and independently expected token accounting.
- `first-caller-green-final.log`: three real disk-caller tests pass: full 512-row
  startup, 512-row first-caller admission and 8192-row first-caller admission.
- `caller-green-final.log`: complete 8192-row startup remains RED. No timeout or
  assertion was relaxed, and that case remains in the test file.

The durable test gates the actual recorder acknowledgement with an explicit
entry signal. It does not depend on a sleep to decide whether publication is
paused. The write-failure injection stays failed for repeated acknowledgements
of that event, including the recorder's background observer.

## Ownership and unchanged limits

| Source rows | Peak registered rows | Peak registered serialized bytes | Paused live rows | Paused serialized bytes |
| --- | --- | --- | --- | --- |
| 512 | 3 | 6555 | 1 | 2179 |
| 8192 | 3 | 6564 | 1 | 2179 |

`owners-final.jsonl` records the production admission tests.
`first-caller-owners-final.jsonl` records matching peaks from real
`resumeSession` cursors. Both release registered source ownership after
admission and return ownership to zero after closing the paused consumer.

The 440-row and 8 MiB ownership limits remain unchanged. A single valid 9 MiB
row is accepted; the aggregate byte gate is not redefined to reject it.
The 1 MiB retained-memory allowance also remains unchanged. Registered ownership
is not a heap-retention measurement: this slice does not supply a new whole
process 1 MiB retained-memory proof.

## Focused verification

`manifest.json` records command exit statuses:

- Original chronology rollback suites: 31 pass.
- Public history stream/pause/deferred/fault/ownership suites: 29 pass.
- Provider BODY equivalence/backpressure/lease/request-scope suites: 18 pass.
- Restore helper regressions: 2 pass.
- Negative pending control: expected 2 failures.
- Negative retaining-identity control: expected 4 failures.

`legacy-media-regression-final.log` records 12 passing existing array-media
lifecycle tests. The earlier root-level legacy command accidentally included
archived fixtures under ignored tmp; the package-scoped run is the result used.

`static-final-manifest.json` records successful agents noemit, scoped noemit,
strict zero-warning lint with unchanged 800/80 limits, Prettier and
`git diff --check`. `source-hashes-final.json` records checked source hashes.
`final-audit-summary.json` contains no MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING
or NO_ASSERT findings in the touched tests. Its DUP_ASSERT findings are repeated
checks before/after different lifecycle transitions, not duplicate checks at
one program state.

No whole workspace suite, OCR, GitHub operation, commit, push, PR or merge was
performed. Protected paths and enforcement settings were not changed.

## Remaining callers and proof gates

The next complete-route caller is `restoreResumeBoot`'s
`history.adoptResumeBoot(recording, boot, publish)` followed by
`AgentClient.startChat([])`. The failing large-route receipt places the stall
after adoption and before startup completion. The factory's reused-service
branch calls `recalculateTotalTokens`, whose internal loop reads the adopted
journal through `journal.streamRows`; media-owner installation and settlement
also traverse that journal. This is the next boundary to isolate. The existing
sample is native Bun stack evidence, not sufficient to assign the stall to one
TypeScript function.

Package `/continue import` still enters through validated package data and
`performResume` / journal adoption. It was traced but not certified as a bounded
package producer by this slice; package recording bytes remain a separate
ownership gate.

The eager `setHistory`, array `storeHistoryForLaterUse`, `resumeChat`,
`restoreHistory`, factory `extraHistory` and authentication-rebuild
`retrieveExistingState` / `transferHistoryToNewClient` callers remain
array-owning. They are not counted as bounded or excused from ownership tests.
Their exact-reference/pending semantics and negative controls remain intact.
The complete 8192-row startup test, whole-process retained-memory gate and full
repeated production resume-to-provider BODY proof still need to pass before
P05d acceptance.
