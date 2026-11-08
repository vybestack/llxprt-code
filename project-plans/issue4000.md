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
