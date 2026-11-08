# Issue #4000: media budget overflow ends the turn instead of recovering

## Problem

An interactive session (uqm, claudecode/claude-opus-5-5, nightly
`0.12.0-nightly.261103.31cf646665`) returned to the prompt with:

```
The selected request media has reached at least 18011948 bytes ... over the
15728640 byte budget ... crossed at content sha256:2b3b2a76... in turn
turn_2540291c-...
```

The request that failed was a user reply sent between 05:14 and 05:46 UTC on
2026-11-05; it was never committed (the agent later said "their reply was lost
to the API error"). A later user turn at 05:49 with the same history went
through, so the normal text-only stream path does retire images. The failed
request therefore took a branch where retirement or recovery did not apply.

## Evidence (session log replay)

Curated history at the failure point (after the compression at seq 4796) holds
30 media blocks totalling about 26.9 MB: eight pasted PNG screenshots of
2.96 to 3.32 MB each (seq 4822, 4889, 4892 x2, 4895 x3, 4913) and 22 small
agent-read JPEGs (1.67 MB total). Replaying the resolver over unretired history
crosses the budget at exactly the reported content (`sha256:2b3b2a76`, the
first image of seq 4895). With `retireHistoricalImages` applied, that content
cannot be the crossing point. So the resolver saw unretired history, and the
one bounded recovery pass did not rescue the request.

## Where a turn can still end on history media

`ProviderContentEnforcer.enforce`
(`packages/agents/src/compression/providerContentEnforcement.ts`):

1. `retireEnvelopeImages` returns the envelope contents untouched when
   `pendingContents` is undefined (hook boundary unrecoverable) or when the
   envelope tail is not structurally identical to `pendingContents` (any
   normalization or hook rewrite of the pending region). Retirement is then off
   for the whole request.
2. `recoverFromByteOverflow` throws the overflow when `pendingContents` is
   undefined, when compression fails or is skipped (cooldown, compression
   provider failure), and when the request is still over budget after the one
   recovery pass.

None of these exits has a fallback, so the overflow propagates as an API error
and the loop ends.

## Required behavior

- History IMAGE pressure never ends a turn. The request is sent with older
  images replaced by the existing retirement notes in the request view only;
  canonical history and stored media are untouched. The guarantee is about
  images. Historical NON-image media (PDF, audio) cannot be dropped by
  retirement, so when it alone keeps the request over the media budget or the
  native body cap, the typed byte error can still surface (for example
  `RequestMediaByteOverflowError`).
- Only media that the request itself cannot drop may produce an error:
  `PendingMediaBudgetError` when the declared pending region alone exceeds the
  budget. When the pending boundary is unknown, the newest content is kept and
  everything older is eligible.
- Existing behavior from #3984 stays: normal retirement to 75% of budget, the
  one bounded compression pass when it helps, no retry of an unchanged request,
  no rewrite of pending media, zero budget still means "reject any media".

## Design

Add a final, deterministic media fallback in the enforcer used whenever a
request-media byte overflow would otherwise escape `enforce`:

1. Retirement without a trusted pending boundary: when `pendingContents` is
   undefined or the tail does not match, retire over the full contents with the
   last content treated as the protected region (oldest-first retirement, same
   notes, same 75% target). This never drops text and never touches the newest
   content.
2. Byte recovery fallback: if compression is unavailable, fails, or leaves the
   request over budget, retire every historical image (all images outside the
   protected pending region) and project again. Throw only if the protected
   region alone is over budget (`PendingMediaBudgetError`) or the resulting
   request still fails for a non-media reason.
3. Apply the same fallback to `RequestBodyByteOverflowError` when images are
   present outside the protected region (the native Anthropic 32,000,000-byte
   body cap).
4. The compression-callback path (`compressAndRecompose`) and every
   recomposition keep going through `recomposeProviderContents`, so retired
   pixels never come back.

## Tests (behavioral, bun:test, real HistoryService / LocalMediaStore /
enforcer / provider projection; only HTTP stubbed; see dev-docs/RULES.md)

Use `packages/agents/src/compression/__tests__/image-retirement-harness.ts` and
the `provider-content-enforcement-byte-pressure` and
`historical-image-retirement.pending-boundary` suites as the pattern.

1. Incident replay: history shaped like the uqm session (eight 3 MB PNGs plus
   small JPEGs, about 26.9 MB) and a text-only pending turn. The request is
   sent, contains retirement notes, carries at most the budget in media, and
   the newest images are the ones kept.
2. Same history with a pending turn that carries one pasted 3 MB screenshot.
   Sent; pending screenshot kept intact.
3. Pending boundary undefined (BeforeModel hook restructured contents): sent
   with older images retired; newest content untouched.
4. Pending tail does not match the declared pending blocks: sent with older
   images retired.
5. Compression fails (provider error) during byte recovery: sent via the
   fallback, no error to the caller.
6. Compression skipped by cooldown: sent via the fallback.
7. Still over budget after one compression pass: sent via the fallback.
8. Pending region alone over budget: still `PendingMediaBudgetError`, history
   unchanged (regression guard).
9. Zero budget: still rejects encoded media (regression guard).
10. Canonical history and stored media are unchanged after every case above.

## Out of scope

- Ctrl+Enter steering race (#3998).
- Raising the default budget.

## Implementation notes

- `retireEnvelopeImages` no longer turns retirement off for an unproven
  boundary. `protectedRegionStart` (now in pendingBoundary.ts) protects the
  proven pending tail; otherwise it locates the declared pending items by
  stable identity (see Review round 2) and protects from the earliest one
  found to the end, or only the newest content when none is identified.
  Everything older is eligible for the normal oldest-first, 75% retirement.
- `relieveMediaPressure` (mediaPressureFallback.ts) is the final fallback. It
  runs at every exit where a relievable byte overflow (media or body, not
  `PendingMediaBudgetError`) would escape `ProviderContentEnforcer.enforce`:
  initial projection with recovery already spent or no pending boundary,
  compression failed or skipped, the post-compression projection, the
  re-enforcement after compression, and every projection stage after the
  initial one. It retires every image outside the protected region and
  projects once. If the protected region alone is over the budget it throws
  `PendingMediaBudgetError`; any other remaining overflow rethrows the original
  typed error. A zero budget keeps the reject-any-media policy.
- After a failed compression the fallback relieves the pre-compression request
  rather than history the failed compression may have half rewritten. After a
  completed compression it recomposes from the curated history.
- `compressAndRecompose` (provider compression callback) recomposes through
  `recomposeProviderContents`, which re-applies retirement, so retired pixels
  never return. Review round 2 gave it the same bounded media relief (below).

## Review round 2

An independent reviewer reproduced six gaps through the public API. Each has a
failing behavioral regression test that was run red before the fix.

1. **The fallback skipped token-limit enforcement.** `relieveMediaPressure`
   (mediaPressureFallback.ts) now returns the relieved contents together with
   their token projection. The enforcer continues the existing bounded
   escalation (density, compression, truncation) on that state through
   `enforceBeyondInitialProjection`, run on an enforcer constructed with
   `retiresAllHistoricalImages`. That flag makes every recomposition retire all
   historical images, so retired pixels never come back, and the continuation
   never enters `enforce`, so there is no second byte pass and no loop. An
   unknown boundary over the limit throws `buildUnrecoverableBoundaryError`;
   the ladder ends in the context overflow error. A request is never returned
   over the limit.
2. **`protectedRegionStart` guessed from equal content.** The boundary now
   lives in pendingBoundary.ts. A proven tail is unchanged. Otherwise each
   declared pending item is located from the newest content backwards, in
   order, by stable identity: metadata `id`, `turnId`, `promptId`, and media
   identity (the `contentId` of a reference block, the payload of an inline
   block). Conflicting provenance disproves identity even when the same image
   appears again, and a shared turn does not vouch for a different attachment
   set. Equal text is never proof. The region starts at the earliest identified
   item and runs to the end, so hook-added items stay protected; with no
   identified item only the newest content is protected.
3. **A failed compression could send half-rewritten history.** The byte
   recovery path now classifies the compression outcome (`runCompression`:
   exception, FAILED, NOOP, SKIPPED or confirmed COMPRESSED) before any
   projection. Anything but COMPRESSED relieves the saved pre-compression
   envelope. History is recomposed only after a confirmed COMPRESSED. Abort
   propagation is preserved.
4. **Retirement left a stale Responses parent in the protected tail.**
   `retireEnvelopeImages` now runs `invalidateResponsesStatefulChainForRetainedRewrite`
   over the complete rejoined view, starting at the first rewritten entry, so a
   stored parent in the tail no longer continues the server-side chain that
   holds the original pixels. Only the view's copies lose markers; canonical
   entries keep them. The fallback's `retireEveryHistoricalImage` already
   rejoins before invalidating and is covered by a test. The providers package
   does not export `computeStatefulConversation`, so the tests assert on the
   view the provider receives: no AI entry that can serve as a parent remains.
5. **One exit threw without the fallback.** The `!compressionCanRelieve` branch
   classifies with the same `protectedRegionStart` boundary retirement uses
   and routes through the fallback. The fallback itself keeps the two final
   outcomes: the protected region alone over budget gives
   `PendingMediaBudgetError`, and a zero budget keeps the reject-any-media
   policy.
6. **The compression callback had no media relief.** `compressAndRecompose`
   repeats once on the retire-all enforcer when a relievable byte overflow
   escapes and history holds an image to retire, under the same guard-derived
   limits. A pending-only overflow becomes `PendingMediaBudgetError`; token
   limits are validated by the same escalation. To stay under the 800-line cap
   the context-limit computation moved to enforcementLimits.ts and the overflow
   error builders to overflowReduction.ts.

Remaining by design: historical non-image media can still surface the typed
byte error, and when a failed compression half-rewrote history, a relieved
request that is still over the context window escalates from the curated
history as it stands, as any compression failure already does.

Regression tests (all run red before their fix):

- `historical-image-retirement.pending-identity.test.ts`: findings 2 and 4
  (identity of rewritten pending items, stale Responses parent in the tail,
  fallback retirement path).
- `provider-content-enforcement.media-relief.test.ts`: findings 1, 2 (false
  pending overflow through the production seam), 3, 5 and 6, including the
  32,000,000 byte body cap through the compression callback.

## Review round 3 (final)

A second independent review reproduced three HIGH blockers through public
APIs. Each has failing behavioral regression tests that were run red before
the fix. The new tests share `__tests__/media-relief-fixtures.ts` (real
LocalMediaStore, HistoryService, ProviderContentEnforcer, production send seam
and AnthropicProvider projection; only HTTP is stubbed).

### H1. A failed compression could still return partially rewritten history

Relief already used the saved pre-compression request, but the token ladder
that ran afterwards (density optimization, the callback's compression
projection) read the shared curated history, which a failed compression may
have half rewritten.

Fix: every compression now runs through `runGuardedCompression`
(guardedCompression.ts). It captures the raw history, cache-anchor sequence and
prompt-token baseline (historyStateRollback.ts, the pattern
`fallbackTruncationCommit.ts` already used, now shared by both) before calling
`performCompression`. On an exception or any outcome other than COMPRESSED the
state is restored through `HistoryService.replaceAll`, `setCacheAnchorSeq` /
`resetCacheAnchorSeq` and `restorePromptTokenBaseline` before anything is
recomposed. Nothing is written when the compression changed nothing, so a
skipped compression never re-stamps history. When the rollback itself fails the
request is rejected with an `AggregateError` of the compression failure and the
rollback failure. Cancellation is rethrown after the rollback. Because the
guard sits in the one place that runs compression, it covers the byte-recovery
path in `enforce`, the escalation ladder, the ineffective-compression retry
and `compressAndRecompose`.

Tests (`provider-content-enforcement.failed-compression.test.ts`):

- enforce, a later compression succeeds: the real summary is sent, never the
  failed one (red: the partial summary was sent, one compression run).
- enforce, every compression fails after rewriting: `ContextOverflowError`,
  nothing sent, canonical history equals the pre-compression history (red:
  the request was sent with the partial summary).
- enforce, cancellation after a partial rewrite: the abort propagates and
  history is restored (red: history left rewritten).
- enforce, the rollback fails: rejects with both causes, nothing sent (red:
  continued and sent).
- compressAndRecompose: `ContextOverflowError` and restored history instead of
  returning the partial summary (red: returned it).

### H2. A split pending item could lose a current-turn image

`protectedRegionStart` consumed a declared pending item at its newest matching
fragment, so a hook that split one item (images A and B) into two contents left
fragment A outside the protected region and enforcement retired it.

Fix (pendingBoundary.ts): for each declared item the search continues backwards
until every attachment identity of the item is placed, and the region starts at
the earliest fragment. A later fragment must carry an attachment not yet
placed, so an older copy of an already-placed image (or a shared turn alone)
cannot drag history into the region. Conflicting provenance still rejects a
fragment. The attachment identities of each declared item are now computed once
instead of rebuilding arrays and sets on every comparison.

Tests (`historical-image-retirement.split-pending.test.ts`): two fragments plus
an appended hook note keep both current images and retire only the older one
(red: A retired, only B kept); a hook note between the fragments (red, same);
guards that an unrelated history image and a conflicting-provenance copy are
not protected.

### H3. Retire-all recomposition exposed stale Responses parents

`recomposeProviderContents` retired and invalidated the curated prefix and then
appended the pending contents, so a stored parent in the pending tail survived
and `computeStatefulConversation` selected it, trimming the provider input to
the entries after it and dropping the retirement notes.

Fix: when retirement changed the history view, the fully rejoined provider
request (pending included) goes through
`invalidateResponsesStatefulChainForRetainedRewrite(composed, 0)`. Normalization
in `buildProviderContent` can shift indexes, so no narrower start is provably
correct. The copy-on-write contract keeps canonical entries marked.
`retireEnvelopeImages` and the fallback's `retireEveryHistoricalImage` already
invalidated over the rejoined array (round 2) and are unchanged.

Tests (`provider-content-enforcement.responses-parent.test.ts`) call the real
`computeStatefulConversation` (providers package, imported by relative path as
other agents tests already do for providers sources): the callback path and the
enforce path (after a compression) must select no parent and keep all three
retirement notes (red: `resp_stale_pending_tail` selected, zero notes,
`responsesStored` kept); canonical history and pending entries keep their
markers.

### Not fixed in this round

- MEDIUM, guard overhead calibration (`computeCallbackLimits`): on the relieved
  retry the overhead is `guard.estimatedTokens - ownEstimate(relieved)`, so the
  image-token savings are counted as fixed overhead and a request that fits can
  still be rejected. Keeping the pre-relief calibration needs the own estimate
  of the unrelieved request, which the finalized estimator cannot return
  because the provider rejects that request on bytes. Estimating it with the
  history estimator would mix two estimators. The correct fix is for the guard
  to pass its fixed overhead (finalized estimate minus contents-only estimate)
  in `CompressionGuardInfo`, a contract change in core and the load-balancing
  provider. Documented as a follow-up.
- `DirectMessageProcessor` sends a `historyPrefix` without provider-content
  enforcement. This gap exists outside this incident and is untouched.
- Historical non-image media can still surface the typed byte error, and a
  hook that dropped an attachment of a declared item while an unlabeled older
  copy remains in history can widen the protected region to that copy (the
  safe direction: it never retires current media).

## CodeRabbit round (PR #4015)

Six review threads, each verified against the code before acting. Every FIXED
thread has a regression test that was run red before the fix and green after.

### T5 (Major) FIXED: cancellation during compression after relief

`runGuardedCompression` rethrew an abort only for the byte-recovery call; the
escalation ladder, the ineffective-compression retry, the post-relief
continuation and `compressAndRecompose` passed `propagateAbort = false`, so an
abort after relief became a failed compression and enforcement went on to
truncation or `ContextOverflowError`. The flag is gone: an abort is rolled back
and then rethrown on every path (guardedCompression.ts).

Tests (`provider-content-enforcement.abort-after-relief.test.ts`, red:
`ContextOverflowError` instead of `AbortError`): escalation ladder, ineffective
retry (third run aborts), callback after relief, callback without relief. Each
asserts the `AbortError`, nothing sent and history equal to the pre-compression
history.

### T3 (Major) FIXED: pending images when the hook boundary is unknown

`ProviderContentEnvelope` gains an optional `protectedContents`: the user's
original pending items, carried when `pendingContents` is undefined. It is not a
compression boundary; `envelopeProtectedStart` (pendingBoundary.ts) feeds it to
the identity-based `protectedRegionStart` only when no boundary is declared, in
`retireEnvelopeImages` and in the media-pressure fallback. Compression stays
unavailable. `fireBeforeModelHook` returns it, `StreamProcessor` threads it via
`prepareStreamEnvelope`. `TurnProcessor` needed no change: its envelope always
declares `pendingContents` (no hook runs there), so `protectedContents` would
only repeat it.

Tests (`historical-image-retirement.protected-contents.test.ts`,
`historical-image-retirement.hook-boundary.test.ts`; red: all three images
retired, zero kept): a split pending turn with an unrecoverable boundary keeps
both pending images and retires only the older one, at the unit level, through
the production send seam, and through a real `BeforeModelHookOutput` handled by
`fireBeforeModelHook`. Guards: no carried turn means the old behavior, an
unrelated history image is not protected, compression still does not run.

### T6 (Minor) FIXED: valid Responses parents before retired images

`recomposeProviderContents` invalidated from index 0. It now composes the
unretired history through the same `buildProviderContent` normalization and
invalidates from the first entry whose blocks differ
(`invalidateParentsFromFirstRetirement`, historicalImageRetirement.ts), only
when retirement changed something. A parent before every retired image stays
selectable; a parent at or after the first one is not. Limitation kept by the
existing helper: when a stored parent also sits after the first retired image,
`invalidateResponsesStatefulChainForRetainedRewrite` clears every marker, so the
earlier parent is dropped as well (full history, still correct).

Tests (`provider-content-enforcement.responses-parent.test.ts`, real
`computeStatefulConversation`; red: parent undefined): parent before all images
selected with three notes; parent after the first image not selected. The
existing round-3 tests stay green.

### T4 (Major) FIXED: relieved request rechecked against the guard

The callback now receives its original contents. `compressAndRecompose` takes
them as an optional fifth argument and calibrates the guard's fixed overhead
once (`calibrateGuardOverhead`, guardCalibration.ts) as
`guard.estimatedTokens - estimate(original)`, then reuses it for the relieved
retry instead of recomputing it from relieved contents. When the finalized
estimator rejects the original on bytes, the overhead is measured with the
content estimator and the enforcer measures its fit checks with that same
estimator (`measuresByContents`; the finalized estimator still runs to validate
bytes). A caller that does not pass the original keeps the old derivation. No
`CompressionGuardInfo` or `LoadBalancingProvider` change was needed.

Tests (`provider-content-enforcement.guard-calibration.test.ts`; red:
`ContextOverflowError` at 251 against 250): a relieved request that fits
`limit - overhead` is returned; one over it is still rejected.

### T2 (Major) FIXED: rollback dropped independent writes

Verified: (a) `HistoryService.add` queues under the compression lock
(historyCompressionQueue.ts) and `endCompression` applies the queue inside
`performCompression`'s `finally`, before our rollback runs, while `addBatch`
(appendGeneration) is not gated by the lock at all. (b) The real apply path is
one atomic `replaceAll` (cacheAnchor.ts:98-102), so a partial rewrite needs a
failure after the commit (anchor update, telemetry); the rollback is mostly
defense in depth, yet any failure after a queued add flushed made history differ
from the snapshot and `replaceAll(snapshot)` dropped that add. (c) `generate`
with `writeHistory` (session-text-generation.ts) writes to the same
`HistoryService` as an interactive turn.

Fix: `watchIndependentWrites` records the entries announced through
`contentAdded` and `contentBatchAdded` during the attempt (compression applies
through `replaceAll`, which announces none). The rollback restores the snapshot
and appends the surviving announced entries, and treats history as untouched
when it equals the snapshot apart from them.

Tests (`provider-content-enforcement.rollback-independent-writes.test.ts`, red:
the entry was missing): an add queued under the lock and an `addBatch` during a
failing compression both survive; the partial summary does not. The simulated
partial rewrites in `provider-content-enforcement.failed-compression.test.ts`
now use `replaceAll` like the production apply path (assertions unchanged); a
`clear()` plus `add()` rewrite is indistinguishable from a concurrent writer.
The fallback-truncation restore (`restoreHistoryState` without independent
entries) is unchanged.

### T1 (Minor) DECLINED: bind stored parents to the request view

A response stored from a retired request holds notes server-side; a later
request that selects it as parent sends only what follows it, so the model
continues from what it actually saw. Stateful mode never resends content the
server already holds, with or without retirement. Retirement is deterministic
and monotone for a fixed budget (`requestMediaBudgetBytes` is fixed at
construction), so a later request never offers the parent with pixels it lacks,
and a compression rewrite strips the markers. A marker bound to the request view
would need the provider to know whether the request was retired: a new mechanism
for no observable defect.

Test (`historical-image-retirement.monotone.test.ts`, passes): every image an
earlier request retired is retired again after the conversation grows.

## CodeRabbit round 2 (PR #4015)

Four review threads, each verified against the code before acting. Every
thread had a regression test that was run red before the fix and green after.

### A (Minor) FIXED: guard fit limit floored at one token

`limitsForGuard` (enforcementLimits.ts) computed
`Math.max(1, contextLimit - overhead)`. With the calibrated overhead at or above
the guard's context limit it still admitted a candidate whose estimate was one
token, which breaks the documented predicate
`ownEstimate(contents') + overhead <= guard.contextLimit`; the load balancer
then rejected it on recheck. The floor is now 0. No ratio or division uses the
value: `marginAdjustedLimit` and `compressionThreshold` are only compared with
`<=` / `>` (providerContentEnforcement.ts, pendingContextWindowEnforcement.ts)
or subtracted (`computeHistoryTruncationTarget`, `buildContextOverflowError`),
and the latter already clamp at 0. With a limit of 0 nothing non-empty fits and
the existing `ContextOverflowError` path runs.

Tests (`provider-content-enforcement.guard-overhead-floor.test.ts`; the
tokenizer boundary reports one token for the tiny request; red: the candidate
was returned, `Expected operation to reject`): overhead equal to the guard
limit gives `ContextOverflowError` and no candidate; a candidate that fits
exactly in the room the overhead leaves is still returned. The harness's
`recomposeViaCallback` gained an optional estimator argument for this.

### B (Major) FIXED: rollback lost an entry the failed rewrite removed

Verified: `surviving()` kept an announced entry only when it was still in the
history at rollback time. An `addBatch` that commits before the compression's
`replaceAll` (built from an older snapshot) is removed by that replace, so the
rollback restored the snapshot without it. `watchIndependentWrites` now exposes
`announced()`: every entry announced through `contentAdded` and
`contentBatchAdded` during the attempt, in announcement order, without repeats.
The rollback target is the snapshot followed by the announced entries the
snapshot does not hold. History counts as untouched only when it equals that
target (and the cache anchor matches the snapshot).

Test (`provider-content-enforcement.rollback-serialization.test.ts`; red: the
entry was missing): an `addBatch` committed during a failing compression whose
partial rewrite, done through `replaceAll`, removed it. The entry survives the
rollback and the partial summary does not.

### C (Major) FIXED: read and replace were two queue slots

Verified in HistoryServiceCore.ts: `add` (`runSynchronousHistoryMutation`),
`addBatch`, `replaceAll` and `transformAll` all go through one FIFO
(`historyMutationQueue`), so an `addBatch` or `add` queued before the
rollback's `replaceAll` commits between the rollback's read and its replace,
and the replace drops it. The public `transformAll` already runs a transform of
the latest history as one queued mutation (it reads `this.history` inside the
queue slot), so no new core method was needed. The rollback now reads, checks
the independent writes, checks "untouched" and returns the restored history
inside one `transformAll` call. An untouched history is reported by throwing a
private sentinel from the transform, which commits nothing, so a skipped
compression still never re-stamps history. The write watcher now stops after
the rollback (`runGuardedCompression`), because writes queued ahead of the
rollback commit after the compression returned.

Tests (`provider-content-enforcement.rollback-serialization.test.ts`; red: the
entry was missing, and for the queued `add` behind an in-flight `replaceAll`
the request was sent with the partial summary because the rollback read the
pre-commit history and saw nothing to undo): an `addBatch` still in flight when
the compression fails survives; an `add` queued behind an in-flight rewrite
survives and the partial summary is rolled back. A core contract test
(`HistoryService.transformAll.test.ts`) pins the two properties the rollback
relies on: the transform sees entries committed by writes queued before it, and
a throwing transform commits nothing and leaves the queue usable.

Changed existing test: in `provider-content-enforcement.failed-compression.test.ts`
("rejects instead of continuing when the rollback itself fails") the rollback
failure was injected by stubbing `history.replaceAll`. The rollback now commits
through `transformAll`, so the stub moved to `transformAll`. The assertion is
unchanged; the injection point is the mutation the rollback performs.

### D (Minor) FIXED: repeated image in a split pending item

Verified: `DeclaredItem.identities` was a `Set`, so an item carrying the same
image twice was fully "placed" by the newest fragment and the earlier fragment
fell outside the protected region. Identities are now a multiset (identity to
count). The backward search places one occurrence per matching attachment and
continues until every occurrence is placed; a later fragment must carry a
still-unplaced occurrence, and surplus copies are ignored, so an older history
copy beyond the count is not pulled in. Conflicting-provenance rejection is
unchanged.

Tests (`historical-image-retirement.repeated-pending.test.ts`; red: the earlier
copy was retired, 2 notes instead of 1): a split item with the same image twice
keeps both copies (declared boundary, carried `protectedContents`, and the
production send seam with one stored reference repeated); an older history copy
beyond the occurrence count is still retired; a single content carrying both
copies keeps both (guard, green before and after).
