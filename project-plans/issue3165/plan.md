# Issue #3165: Preserve tool-turn metadata in provider history

Plan ID: PLAN-20260822-PROVIDER-HISTORY-METADATA

## Accepted behavior

### AC-1: Preserve already-adjacent tool contents

Given a real `HistoryService` containing an AI tool call followed immediately by its
matching tool response, `getCuratedForProvider()` preserves the tool content's
`metadata.id`, `turnId`, `promptId`, `chronology`, and `cacheAnchor` values.

The unchanged tool content is not marked synthetic and is not assigned
`reason: 'reordered_tool_responses'`. A tool content created earlier by the missing
response repair keeps its truthful `reason: 'orphaned_tool_call'` metadata when it is
already adjacent.

This preservation applies when one adjacent tool content carries one or more matching
responses and any associated media blocks. It also applies when the tool content is in
the pending tail passed to `getCuratedForProvider()`.

### AC-2: Mark only responses that adjacency normalization changes

When a tool response is separated from its call, combined from multiple source
contents, or replaced during duplicate-response selection, adjacency normalization
still emits one provider-valid tool content immediately after the matching AI call.
That rebuilt content is marked `synthetic: true` with
`reason: 'reordered_tool_responses'`.

A response already adjacent to its call is not marked reordered. The normalizer keeps
its existing response scoring, duplicate removal, media assignment, missing-call
repair, and missing-response repair behavior.

Tool contents that include blocks other than tool responses and media retain the
existing provider serialization behavior. Preserving metadata must not reintroduce
blocks that the current normalization intentionally omits.

### AC-3: Preserve and diagnose the compression cache anchor

A compression boundary advanced past a tool round-trip stamps the last preserved-head
tool content with `metadata.cacheAnchor: true`. That marker survives
`getCuratedForProvider()` and causes the Anthropic request to contain the preserved-head
`cache_control` breakpoint on the message derived from the tool result.

If `buildProviderContent()` receives an expected cache anchor but its output contains no
anchor, it emits one warning with enough context to identify the normalization loss. It
does not warn when no input content carried an anchor. This check belongs in the core
pipeline, where both the input expectation and final curated output are observable.
The Anthropic message-level accepted-degradation behavior remains unchanged.

### AC-4: Keep provider behavior stable

Tool response adjacency remains provider-valid, including parallel calls, sequential
calls, out-of-order responses, duplicate responses, and media-bearing responses. For
already-correct histories, provider wire content remains unchanged except for the
restored Anthropic anchor breakpoint. Client-only metadata continues to stop at the
provider converter.

### AC-5: Name and test provider sanitization explicitly

The final provider-history step is named to expose its required cycle-sanitization
invariant. Cycles in tool call parameters and tool response results are replaced with
the established serializable marker before any provider request can receive them.

The copy remains because `getCurated()` returns stored content references and in-process
BeforeModel hooks can mutate the prepared contents they receive. The implementation
comment records that isolation reason. This issue does not broaden the existing shallow
copy of nested metadata.

The unused `sanitizeParamsWithLogger` export is removed.

## Inputs and boundary cases

Accepted inputs and cases are:

1. Already-adjacent single and parallel tool responses, with and without media.
2. An adjacent synthetic missing-response repair whose original reason must survive.
3. A distant response moved next to its call.
4. Multiple response contents merged for one AI tool-call content.
5. Duplicate responses where selection keeps the adjacent source or a remote source.
6. Tool contents containing additional block kinds, which must keep current wire output.
7. Tool contents in stored history and in pending tail contents.
8. Cache anchors on tool contents, AI contents, and no content.
9. Compression split points advanced past one or more tool responses.
10. Cyclic tool-call parameters and cyclic tool-response results.
11. Existing missing-call, missing-response, media, and adjacency scenarios.

## Behavioral evidence

All changed tests use Bun and `bun:test`, exercise real production components, and avoid
mocking the behavior under test.

### Core history behavior

Add focused coverage in
`packages/core/src/services/history/HistoryService.issue3165.adjacency-metadata.test.ts`
and retain the narrow stale-expectation updates in
`HistoryService.idnormalization.test.ts`. Through a real `HistoryService`, prove that:

- already-adjacent tool metadata and the cache anchor survive curation;
- untouched tool turns are not labeled reordered;
- genuinely moved, merged, or remotely selected responses are labeled reordered;
- an adjacent orphan repair retains `reason: 'orphaned_tool_call'`;
- parallel responses and media remain intact;
- pending-tail behavior follows the same rules;
- a moved anchored source that cannot retain its anchor produces one warning, while an
  input without an anchor produces none.

### Compression boundary behavior

Extend `packages/agents/src/compression/cacheAnchor.test.ts` to prove that a preserved
head ending after a tool round-trip places its sole anchor on the last tool content.

### Anthropic request behavior

Extend the existing Anthropic cache and adjacency suites to compose the package-level
path:

- `AnthropicMessageNormalizer.anchorCache.test.ts` passes real curated tool history
  through request preparation and asserts the tool-result message carries
  `cache_control`, the breakpoint count remains within Anthropic's limit, and the
  private marker does not leak.
- `AnthropicProvider.issue1150.toolresult.adjacency.test.ts` keeps the existing request
  adjacency assertions green and verifies the provider request built from curated,
  anchored tool history contains the restored breakpoint.

Together with the compression-boundary test, these prove the flow from compression
anchor placement through provider curation to Anthropic request serialization without
creating a reverse dependency between package layers.

### Sanitization behavior

Extend `packages/core/src/services/history/circular-reference.test.ts` to prove the
separately named provider sanitizer makes cyclic tool-call parameters and cyclic
response results serializable through `getCuratedForProvider()`. Repeated calls remain
serializable and do not mutate stored history.

### Regression evidence

Run the affected core, agents, and provider suites first, then the complete verification
gate. Existing chronology-isolation, synthetic-response, tool-continuity, media,
duplicate-response, and issue #1150 tests must remain green.

## Test-first implementation sequence

1. Add the real `HistoryService` metadata, synthetic-label, anchor-loss diagnostic, and
   boundary-case assertions. Confirm they fail for the current strip-and-reassemble
   implementation.
2. Carry source-content provenance through adjacency normalization. Reuse an eligible
   adjacent source's metadata and synthesize only when the selected output differs from
   that source.
3. Add the tool-boundary compression test and confirm the existing compression code
   already stamps the expected tool entry.
4. Add the provider-request anchor tests and make only the core metadata-preservation
   change needed for them to pass.
5. Add direct provider-sanitization behavior tests, rename the final pipeline operation,
   retain the justified copy, and remove `sanitizeParamsWithLogger`.
6. Run targeted tests, the test-audit delta, the full verification cycle, review, and
   candidate-head checks.

Every production change follows a naturally failing behavioral test.

## Review classification

Every review finding is classified as one of:

- **Blocker-Fix**: breaks an accepted behavior, safety requirement, architecture rule,
  build, or required verification gate.
- **In-scope-Fix**: a defect in the files or behavior changed for this issue.
- **Reject**: factually incorrect, already covered, or conflicts with accepted behavior.
- **Defer**: valid work outside these acceptance criteria. Record it without expanding
  this implementation.

Reviewer suggestions do not expand scope. Local Open Code Review is limited to two
rounds, and PR Open Code Review is limited to two rounds.

## Explicitly outside this issue

- Changing provider adjacency requirements or tool response scoring.
- Preserving metadata on genuinely rebuilt or merged tool contents beyond the expected
  anchor-loss warning.
- Changing the Anthropic symbol-marker accepted-degradation contract.
- Adding provider-side telemetry or changing #3130 token attribution.
- Broadening nested metadata copy semantics or changing BeforeModel hook mutation rules.
- Performance work, a new dependency, public API, subsystem, workflow, or agent memory.
- Cleanup of unrelated comments, tests, or normalization code.

## Verification gate

Run on the candidate head:

    npm run test
    npm run lint
    npm run lint:eslint-guard
    npm run typecheck
    npm run format
    npm run build
    bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"

Also run `bun scripts/test-audit/scan.ts` against main and the candidate branch and inspect
the findings delta for changed tests. Completion requires behavioral evidence for every
accepted behavior, a green local gate and CI, completed and triaged reviews, no unresolved
Blocker-Fix or In-scope-Fix finding, correct ancestry, and a conflict-free pull request.