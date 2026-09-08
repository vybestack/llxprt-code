# Plan: Cache-aware media lifecycle

Plan ID: PLAN-20260822-ISSUE3199
Generated: 2026-08-22
Issue: https://github.com/vybestack/llxprt-code/issues/3199

## Goal

New image-bearing history entries retain immutable content-addressed references instead of long-lived inline base64. Provider requests resolve only the media selected for that physical request. The same bytes, MIME type, image options, block order, and message order remain available for stateless replay and recovery.

Lossless memory eviction and semantic removal are separate operations. Missing data, corruption, quota exhaustion, and storage failure stop the turn before history mutation or network submission. Provider file storage remains explicit and never becomes a pressure-triggered fallback.

## Scope

### In scope

- Media-aware structural cloning that does not JSON-round-trip immutable media data.
- A provider-neutral, content-addressed local media store with atomic admission, restrictive permissions, deduplication, quotas, verification, recovery, and reclamation.
- A reference form in neutral media blocks and backward-compatible support for existing inline recordings.
- Reference-aware history sizing, image token estimation, recording, persistence, replay, export, diagnostics, and compression behavior.
- One request-preparation boundary that resolves selected references before provider conversion.
- Provider-specific selection and transport driven by explicit continuation, cache, file-reference, retention, and streaming capabilities.
- Exact recovery for OpenAI Responses and Codex state loss, parent rejection, endpoint changes, provider switching, and stateless fallback.
- Full logical media replay for Anthropic and Chat Completions unless an explicit semantic-purge policy applies.
- An optional provider-neutral semantic-purge frontier, with Anthropic pre-image cache-breakpoint placement and Kimi cache-affinity behavior.
- Explicit provider Files modes and cleanup behavior.
- Bounded request materialization and streaming request serialization where inline media is required.
- Memory and lifecycle metrics plus isolated Node and Bun memory evidence.

### Out of scope

- General Bun, Ink, Tree-sitter, or native allocator work from issue #2852.
- Silent image removal, replacement, downscaling, re-encoding, or summarization as recovery from missing data or memory pressure.
- Enabling provider-side storage without explicit user policy.
- Treating provider cache keys as conversation state or addressable cache records.
- Unrelated provider, history, recording, storage, or transport cleanup.
- Dependency, workflow, agent-memory, or quality-rule changes.

## Preflight findings

- `MediaBlock` currently stores `data` with `encoding: 'base64' | 'url'` in `packages/core/src/services/history/IContent.ts`.
- `HistoryService` retains those blocks. `historyCloneUtils.ts` JSON-stringifies generic blocks, including media, during provider curation.
- OpenAI Responses already selects the suffix after a usable parent before provider conversion, but the full history was cloned before it reached that provider seam.
- OpenAI Responses, Chat Completions, and Anthropic converters read inline media data directly.
- Session recording and persisted sessions serialize inline media. Replay currently passes those values through.
- Existing building blocks include image-size admission gates, cumulative tool-image budgets, one-time resize policy, Kimi content-hash upload caching, OpenAI stateful recovery, Anthropic cache anchors, project temp storage, the session janitor, and the memory harness.
- No local media store or neutral media-reference type exists.
- Bun and `bun:test` are the required test stack. TDD is mandatory.

## Design decisions

1. **Reference shape:** `MediaBlock` becomes a discriminated union. Existing inline base64 and URL forms remain readable. New local media uses a reference form carrying content ID, MIME type, raw and encoded sizes, dimensions, selected derived-variant identity, semantic metadata, and optional provider file identifiers. A block owns either inline data, a URL, or a local reference, never redundant long-lived forms.
2. **Storage identity:** immutable original bytes are addressed by a cryptographic content hash. A transformed variant is addressed by the original ID plus transformation policy and version. A conversation block records the selected variant so later policy changes cannot alter replay bytes.
3. **Storage root:** blobs live below a dedicated media directory under project temporary storage. History and recording contain content IDs, not absolute paths. Session export packages referenced blobs. Import and replay derive paths from the destination project root.
4. **Admission ordering:** known source size and disk quota are checked before read where possible. Bytes are normalized, hashed, committed by restrictive temporary file plus atomic rename, and verified before history mutation.
5. **Resolution boundary:** provider-neutral selection runs first. One request-scoped media resolver verifies and materializes only selected blocks. Provider converters reject unresolved local references as programming errors.
6. **Bounds:** resident encoded bytes, aggregate request media, recording and persistence queue bytes, local spool bytes, decoded-image cache entries and bytes, and provider-file retention are accounted independently. Defaults preserve exact context or fail before submission. They do not silently remove content.
7. **Continuation:** durable OpenAI continuation and transport-scoped Codex continuation are separate capability values. A usable parent prevents pre-parent blob reads. Recovery and full replay resolve the exact stored variant.
8. **Stateless providers:** Anthropic and Chat Completions resolve full logical media history by default. Inline transports use bounded streaming serialization so multiple whole-history representations do not coexist.
9. **Semantic purge:** purge is opt-in policy. It selects the oldest eligible image, preserves required structured text, writes a stable pre-image prefix where supported, then removes or summarizes the image and advances the frontier. Missing data never invokes this policy.
10. **Anthropic cache placement:** use the remaining fourth breakpoint immediately before the purge frontier. If the preserved-head anchor is already at that boundary, reuse it. Never place the purge breakpoint on or after the image.
11. **Kimi behavior:** cache-affinity keys are capability-driven and stable per task. `cached_tokens` is measured. Dynamic `ms://` references remain in message content. Provider Files use requires explicit retention policy and is disabled as a memory-pressure fallback.
12. **Compatibility:** legacy inline media remains loadable. New recording events carry references and a format version. Replay accepts both forms. Import verifies every referenced blob before use.
13. **Memory evidence:** deterministic behavioral bounds run in the normal test suite. Isolated Node and Bun probes report post-GC heap, external memory, ArrayBuffers, RSS, retained blob bytes, resident encoded bytes, request materialization bytes, and queued bytes. OS-sensitive RSS and peak-footprint results are recorded as evidence rather than compared to a fixed cross-platform number.

## Acceptance criteria and behavioral evidence

### AC-1: Admission and long-lived representation

**Behavior:** New base64 image media is normalized once, content-addressed, committed to local storage, and replaced by a lightweight reference before entering history or recording.

- **Given** image bytes, MIME type, semantic metadata, and a source with known or unknown size,
- **when** the media is admitted,
- **then** the stored blob and selected variant are immutable and verifiable,
- **and** history and recording contain no inline base64 or absolute source path,
- **and** duplicate bytes reuse one stored object.

**Boundaries:** URL media remains a URL and is not copied into the local store. Empty data, unsupported reference shape, known-size quota failure, read failure, commit failure, and verification failure do not mutate history.

**Evidence:**

- Admission property tests cover identical bytes, different bytes, URL media, semantic metadata, dimensions, and selected variants.
- Filesystem behavior tests cover pre-read quota rejection, restrictive modes, temporary-file cleanup, atomic rename, interruption, and duplicate admission.
- History and recording tests inspect stored values and prove the absence of base64 and absolute paths.

### AC-2: Clone and accounting behavior

**Behavior:** Provider-history curation copies mutable block metadata while structurally sharing immutable media data or references. Tool call and tool response circular-value sanitization remains unchanged. History sizing and image-token estimation use reference metadata without reading blobs.

**Boundaries:** Mutating a cloned caption, filename, provider metadata, or surrounding content cannot mutate source history. Immutable content identity remains shared.

**Evidence:**

- Clone mutation-isolation tests break if the media block is JSON-round-tripped or mutable metadata aliases the source.
- Existing circular-reference tests remain green.
- Size and token-estimation tests use a store that fails any read and still return the expected values from recorded metadata.

### AC-3: Request selection and materialization

**Behavior:** Logical provider history is selected before media resolution. Aggregate media size is checked before blob loading. Only blocks that will appear in the physical request are resolved. Request-scoped encoded data and request graphs are released after success, failure, cancellation, or retry handoff.

**Boundaries:** An unresolved reference reaching a provider converter fails with the content ID and affected turn. Missing, corrupt, or hash-mismatched blobs stop before network submission. No placeholder or lossy transformation is substituted.

**Evidence:**

- Resolver tests cover aggregate limits, ordering, duplicate references, missing files, corrupt bytes, hash mismatch, cancellation, and release accounting.
- Provider converter tests reject unresolved references.
- Transport tests prove no network call occurs after resolution failure.

### AC-4: Provider request equivalence

**Behavior:** Resident legacy inline media and stored media references produce byte-equivalent provider requests for OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages, including MIME type, image detail/options, block order, tool-image placement, message order, and surrounding serialization.

**Boundaries:** Base64 images, URLs, PDFs where already supported, tool-response images, captions, filenames, and provider metadata retain current semantics.

**Evidence:**

- Provider parity tests compare serialized requests from legacy inline fixtures and referenced fixtures.
- Property tests vary bytes, MIME type, ordering, dimensions, captions, filenames, and supported provider options.
- Existing provider media tests remain green.

### AC-5: OpenAI Responses and Codex recovery

**Behavior:** A normal request with a usable OpenAI or Codex parent does not read, encode, or transmit media before that parent. Parent rejection, chain invalidation, endpoint change, provider switch, WebSocket loss, HTTP fallback, and forced stateless replay reconstruct the exact selected variant.

**Boundaries:** Durable stored continuation and transport-scoped continuation use separate capabilities. Codex never depends on durable provider state. A rejected parent receives the existing bounded recovery attempt rather than repeated retry.

**Evidence:**

- Stateful suffix tests place media before and after the parent and prove that only post-parent references are read.
- Recovery tests compare full-replay request bytes with the original request after parent rejection, invalidation, endpoint change, provider switch, WebSocket loss, and HTTP fallback.
- Tests prove the same derived variant is reused after resize-policy changes.

### AC-6: Stateless replay and bounded transport

**Behavior:** Anthropic and Chat Completions send the full logical media history unless explicit semantic purge applies. Aggregate request media and request serialization are bounded. Inline-media request bodies are streamed so raw bytes, base64, provider objects, JSON text, and transport buffers do not all remain live for the whole request.

**Boundaries:** Budget rejection occurs before network submission and identifies the contributing turns. Streaming cancellation and transport failure release open readers and accounting reservations. Automatic cache behavior does not authorize omission.

**Evidence:**

- Full-history provider tests verify all logical image blocks remain present.
- Aggregate budget tests reject before blob reads when metadata already proves the request is too large.
- Streaming transport tests use multiple large fixtures and assert bounded high-water accounting, exact wire bytes, cleanup after failure, and no duplicate whole-request serialization.

### AC-7: Recording, persistence, export, and replay

**Behavior:** New recordings and persisted sessions store content IDs and semantic metadata. Logical records identify original and selected variant IDs. Physical diagnostics identify full, delta, provider-file, or URL transport. Export includes referenced blobs. Import and replay verify every referenced blob. Legacy inline recordings remain loadable.

**Boundaries:** Project directory moves and cross-platform path separators do not change content identity. Missing export blobs, corruption, unsupported versions, and interrupted persistence fail before replay or network use.

**Evidence:**

- Recording and persisted-session round trips cover reference media and legacy inline fixtures.
- Export/import tests move the package to a different root and verify exact request bytes.
- Corruption and missing-blob tests report the content ID and turn.
- Queue-bound tests prove queued byte accounting returns to zero without dropping records.

### AC-8: Storage lifecycle and privacy

**Behavior:** Local media storage has restrictive permissions, atomic commits, independent quotas, deduplication, crash recovery, and reclamation of unreferenced objects. Diagnostics and ordinary logs omit raw media and local source paths. Explicit raw diagnostic mode is the only path that emits media bytes.

**Boundaries:** Active sessions, recordings, persisted sessions, imports, and in-flight requests retain references during reclamation. Partial files and abandoned reservations are recoverable. Provider Files cleanup follows the configured retention policy.

**Evidence:**

- Store and janitor tests cover active references, orphan reclamation, deduplicated references, interrupted writes, stale temporary files, quotas, and concurrent admission.
- Diagnostic tests verify redaction by default and exact inclusion only in explicit raw mode.
- Provider Files policy tests verify default-off behavior, retention, deletion, workspace scope, and ZDR metadata.

### AC-9: Explicit provider capabilities

**Behavior:** Provider continuation, cache, cache-affinity, file-reference, retention, and streaming behavior is selected from independent capability fields. Unknown providers use exact full replay, no remote storage, and no lossy conversion.

**Boundaries:** Endpoint shape and provider name heuristics cannot silently confer state, cache, or storage semantics. Cache keys remain affinity hints only.

**Evidence:**

- Capability tests cover durable continuation, transport-scoped continuation, stateless replay, explicit breakpoints, automatic prefix caching, cache-affinity support, file references, retention policy, and streaming.
- Unknown-provider tests prove strict replay and remote storage disabled.
- Cache-key tests prove changing a key does not alter logical history or parent selection.

### AC-10: Semantic purge and cache behavior

**Behavior:** Optional semantic purge advances an explicit frontier only after a successful request writes the intended stable prefix. It preserves configured structured text, removes the selected image from later logical requests, and records that pixel semantics changed. Earlier deliberately cached prefixes remain eligible for reuse.

**Boundaries:** Lossless eviction never moves the purge frontier. Missing media never triggers purge. Purge failure leaves history unchanged. A provider without suitable cache control may still purge explicitly but receives no assumed cache-preservation claim.

**Evidence:**

- Provider-neutral policy tests cover oldest eligibility, preserved extraction, failed prefix write, successful advance, repeated advance, and no-op lossless eviction.
- Anthropic tests cover automatic and explicit caching, bounded lookback, base64 and stable file IDs, fourth-breakpoint placement before the image, preserved-head coincidence, rolling-tail interaction, and usage counters.
- Kimi tests cover exact replay, append-only turns, image removal, stable and changed `prompt_cache_key`, stable `ms://` references, stable system instructions, and `cached_tokens` telemetry. Credentialed behavior uses the existing real-integration pattern; deterministic request and parsing tests run without credentials.

### AC-11: Bounds and metrics

**Behavior:** Independent limits and measurements exist for long-lived resident media bytes, request materialization bytes, recording/persistence queue bytes, local spool bytes, decoded-image cache entries and bytes, and provider-file retention.

**Boundaries:** Limit exhaustion is observable and identifies the limit. Limits do not silently alter model-visible content. Accounting reservations are released on all terminal paths.

**Evidence:**

- Boundary-value tests cover zero, exact limit, one byte over, deduplicated content, cancellation, retry, and concurrent requests.
- Telemetry tests distinguish heap, external memory, ArrayBuffers, RSS, retained blob bytes, resident encoded bytes, request materialization bytes, queue bytes, and physical request mode.

### AC-12: Memory plateau

**Behavior:** Repeated image-heavy turns do not grow long-lived media in process memory with turn count. After warm-up and forced GC, heap, external memory, ArrayBuffers, and RSS working-set trends remain bounded by configured resident and request limits. Local blob growth follows disk quota and deduplication.

**Boundaries:** Node and Bun run in isolated processes. The first settled sample is warm-up. Missing metrics or insufficient samples fail the probe. OS peak footprint is reported separately from JavaScript memory.

**Evidence:**

- A deterministic test exercises the real history, curation, provider preparation, recording, and persistence paths with unique and duplicate images.
- Isolated Node and Bun probes report every required metric and a per-limit verdict.
- The candidate head includes captured local results in the plan verification record, without committing generated dumps or media.

## Test-first implementation sequence

### Phase 0: Preflight and contracts

- Verify all call paths, configuration seams, storage roots, provider transports, stateful recovery paths, recording formats, janitor references, diagnostics, and test helpers listed above.
- Define the neutral reference union, store dependency, request resolver contract, capability fields, accounting reservations, recording version, and export package format in tests before production implementation.
- Write cross-component integration tests before unit tests so the store, history, resolver, converter, transport, recording, and replay contracts cannot drift.

### Phase 1: Stop clone amplification

1. Add failing clone mutation-isolation and structural-sharing tests.
2. Special-case media blocks in `historyCloneUtils.ts` while preserving tool-value circular sanitization.
3. Prove provider curation no longer JSON-round-trips media data.
4. Add request-envelope release tests and perform the minimal release changes needed by current transports.

### Phase 2: Store, references, and compatibility

1. Add failing admission, quota, atomicity, permission, deduplication, corruption, and crash-recovery tests.
2. Implement the local content-addressed store and selected-variant identity.
3. Add the neutral reference form and reference-aware validation, size accounting, and token estimation.
4. Integrate admission before history mutation at every media creation seam.
5. Add recording, persistence, export, import, replay, and legacy inline compatibility tests, then implement reference serialization and resolution.
6. Extend janitor reclamation for unreferenced media.

### Phase 3: One late-resolution boundary

1. Add failing cross-provider request-equivalence tests.
2. Add failing provider-converter tests for unresolved references.
3. Implement the request-scoped resolver and aggregate reservation.
4. Resolve after OpenAI stateful parent selection and before provider conversion.
5. Resolve full logical history for Anthropic and Chat Completions.
6. Prove exact recovery for parent rejection, invalidation, endpoint and provider changes, WebSocket loss, and HTTP/stateless fallback.

### Phase 4: Capabilities, streaming, and provider Files

1. Add failing capability-default and capability-selection tests.
2. Implement independent continuation, cache, affinity, file-reference, retention, and streaming fields using the existing provider-capability service where its ownership fits.
3. Add bounded streaming JSON/request-body serialization for stateless inline-media transports.
4. Gate provider file uploads behind explicit policy. Add retention and cleanup behavior.
5. Add Kimi cache-affinity and cached-token parsing without moving dynamic media into system instructions.

### Phase 5: Semantic purge and cache anchors

1. Add failing provider-neutral purge-frontier tests.
2. Implement explicit purge transactions with stable-prefix acknowledgement before mutation.
3. Integrate Anthropic pre-image breakpoint placement with system, preserved-head, and rolling-tail breakpoints.
4. Add Anthropic cache usage and Kimi cache-token behavior tests.

### Phase 6: Metrics and memory evidence

1. Add failing accounting and metric tests for every accepted bound.
2. Extend the existing memory harness with image-history workloads that use real history, provider preparation, recording, persistence, recovery, and cleanup.
3. Run isolated Node and Bun probes. Record commands and results in this plan.
4. Verify no generated media, dumps, or result files enter the commit.

### Phase 7: Verification and bounded review

Run focused Bun tests after every RED/GREEN step. Run the full cycle on every candidate and after remediation:

```sh
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Run the test-audit scanner against changed test files. Run DeepThinker review and detached Open Code Review. Run no more than two local DeepThinker rounds and two local OCR rounds.

Classify every finding as:

- **Blocker-Fix:** violates correctness, safety, accepted behavior, architecture, TDD, lint, complexity, source-size, coverage, cross-platform behavior, or CI.
- **In-scope-Fix:** identifies a valid defect in AC-1 through AC-12.
- **Reject:** is factually incorrect or contradicted by source and behavioral evidence.
- **Defer:** may be valid but falls outside the scope above.

Reviewer suggestions do not expand scope. All Blocker-Fix and In-scope-Fix findings must be resolved before completion.

## Completion gate

Issue #3199 is complete only when:

- Every AC-1 through AC-12 behavior has named behavioral evidence and passes locally on the candidate head.
- Legacy inline recording compatibility and exact provider request parity pass.
- Stateful no-read and full-replay recovery tests pass.
- Quota, corruption, interruption, cleanup, privacy, and cross-platform path tests pass.
- Node and Bun memory probes report all required metrics and satisfy configured bounds.
- Full local verification and the profile smoke test pass on the candidate head.
- Local reviews are complete within their limits and every finding is classified.
- All Blocker-Fix and In-scope-Fix findings are resolved.
- The pull request head has correct ancestry, no conflicts, green CI, and no unresolved required review threads.
- No unplanned subsystem, public abstraction, dependency, workflow, agent-memory, quality-tool, unrelated refactor, optional hardening, or behavior outside the scope above was added.

## Issue-intent review ledger

The first DeepThinker review reported seventeen findings. The second permitted review attempt returned no report. Each reported finding was checked against the source and behavioral tests.

| Finding | Classification | Resolution and behavioral evidence |
| --- | --- | --- |
| F1: prompt candidate selection materialized media | Blocker-Fix | Candidate token estimation now uses selected history and reference metadata without preparing provider requests. Covered by request-media resolver and token-estimation tests. |
| F2: admission and migration were incomplete at history and replay boundaries | Blocker-Fix | Async admission now precedes mutation at turn, stream, direct-message, external-history, tool-history, ACP, clipboard, at-command, generated-image, resume, and replay seams. Covered by admission and media-session lifecycle tests. |
| F3: admission lacked aggregate preflight and broad metadata preservation | Blocker-Fix | Admission performs metadata and quota preflight before reads or mutation, preserves presentation metadata, and accepts legacy inline and URL media. Covered by local-store and admission tests. |
| F4: original and transformed identities were not durable | Blocker-Fix | References retain original and selected variant identities plus transformation policy ID, version, and parameters. Covered by file utility, admission, and session-package tests. |
| F5: quota, ownership, and reclamation were not process-safe | Blocker-Fix | Store publication and quota updates use filesystem locks, exact-byte hashes, owner reservations, restrictive permissions, and existing janitor reclamation. Covered by local-store and janitor media tests. |
| F6: resolver disposal and accounting could outlive a request | Blocker-Fix | Request resolution reserves only selected content and releases materialized graphs, bytes, and reservations on success, error, cancellation, and retry handoff. Covered by request-media resolver and provider resolution tests. |
| F7: stateless provider transports were not bounded | Blocker-Fix | Anthropic, OpenAI Chat, Kimi, and Responses use finite JSON-body accounting and bounded byte streams where inline media is required. Capability declarations describe the actual transport. Covered by bounded-body and provider transport tests. |
| F8: recording state updates were not serialized | Blocker-Fix | Recording and persistence use monotonic serialized save generations with bounded queues and failure recovery. Covered by recording bounds and persistence concurrency tests. |
| F9: semantic purge was not reachable or durable | Blocker-Fix | ChatSession owns an explicitly configured purge session, begins candidates from live history, commits only after provider success and required cache evidence, and records durable frontier state. Covered by purge session and recording tests. |
| F10: removing the final image invalidated an earlier stored parent | In-scope-Fix | Suffix invalidation now begins at the actual divergent content after whole-entry removal, preserving earlier usable Responses state. Covered by semantic purge history and session tests. |
| F11: media export and import were not reachable or transactional | Blocker-Fix | Continue/session-control actions invoke package export and import, package exact original and derived blobs, verify hashes before publication, and roll back failed imports. Covered by continue-command and session-package tests. |
| F12: provider Files lacked lifecycle ownership | Blocker-Fix | Provider Files remains explicit opt-in, records retention policy and leases, and performs awaited deletion on history clear and runtime disposal. Covered by provider-file policy, Kimi upload, client contract, and runtime-registry tests. |
| F13: physical request and cache evidence were insufficient | Blocker-Fix | Bounded transports expose exact serialized bytes and physical full/delta/file modes. Kimi cache affinity and observed cached-token counters are covered without treating keys as state. Anthropic requires cache-creation evidence before purge commit. |
| F14: recovery paths lacked exact full-replay proof | Blocker-Fix | Stateful parent rejection, endpoint mismatch, WebSocket loss, HTTP fallback, provider switching, and stateless retry resolve exact stored variants before submission. Covered by OpenAI Responses, Codex, Anthropic, and provider recovery suites. |
| F15: lifecycle metrics and memory evidence were absent | Blocker-Fix | Metrics distinguish spool, resident encoded, request materialization, queue, provider-file, heap, external, ArrayBuffer, and RSS values. Isolated Node and Bun forced-GC probes exercise repeated image turns and apply the post-warm-up plateau verdict. |
| F16: diagnostics could disclose media or source paths | Blocker-Fix | Ordinary dumps and previews redact raw media and local source paths; explicit raw diagnostics remain opt-in. Covered by dump-context, content-preview, and admission privacy tests. |
| F17: formatting did not pass | Blocker-Fix | The full formatter was run on the candidate worktree. Final lint, diff, and verification gates remain recorded below when complete. |

No finding was classified Reject or Defer. Every reported defect was inside the accepted behavior and was remediated.

## Candidate evidence record

| Criterion | Named behavioral evidence |
| --- | --- |
| AC-1 | `local-media-store.test.ts`, `media-admission-service.test.ts`, and `media-session-lifecycle.test.ts` cover exact-byte admission, deduplication, metadata, URL pass-through, quotas, atomic publication, and pre-mutation failures. |
| AC-2 | `history-clone-utils.test.ts` and `media-reference-accounting.test.ts` cover media-aware cloning, mutable metadata isolation, tool-value circular sanitization, reference sizing, and token estimation without blob reads. |
| AC-3 | `request-media-resolver.test.ts` and `request-media-resolution.test.ts` cover aggregate preflight, selected-reference resolution, ordering, missing or corrupt data, cancellation, converter rejection, and terminal-path release. |
| AC-4 | The FastCheck property in `request-media-resolution.test.ts` varies bytes, MIME type, ordering, dimensions, captions, filenames, detail options, and Kimi file IDs across Responses, Chat, Anthropic, Gemini, and Vercel request structures. Existing provider media suites cover URLs, PDFs, and tool-image placement. |
| AC-5 | `openai-responses-media-resolution.stateful.test.ts`, `provider-media-recovery.entry.test.ts`, and the Responses/Codex stateful recovery suites cover no-read parent suffixes and exact fallback replay after parent, endpoint, provider, WebSocket, and HTTP changes. |
| AC-6 | `boundedJsonBody.test.ts`, `AnthropicBoundedHttpTransport.test.ts`, `OpenAIProvider.kimiCacheTransport.test.ts`, and provider request-resolution tests cover full logical replay, metadata-first budget rejection, exact streamed JSON, and release after failure or cancellation. |
| AC-7 | `session-media-package.test.ts`, `session-persistence-concurrency.test.ts`, `SessionRecordingService.bounds.test.ts`, recording replay suites, and `continueCommand.spec.ts` cover versioned references, legacy input, moved roots, transactional import/export, serialized writes, and reachable CLI/API actions. |
| AC-8 | `local-media-store.test.ts`, `sessionJanitor.media.test.ts`, provider-file policy/lifecycle suites, and dump-context/content-preview privacy suites cover permissions, concurrent admission, reclamation, retention ownership, and default redaction. |
| AC-9 | `providerMediaTransportCapabilities.test.ts`, `providerFilePolicy.test.ts`, `kimiCacheAffinity.test.ts`, and request-building tests cover independent capability dimensions, conservative unknown-provider defaults, explicit remote storage, and cache-affinity keys that do not alter logical history. |
| AC-10 | `semantic-media-purge.test.ts`, `semanticMediaPurgeSession.test.ts`, `semantic-media-purge.recording.test.ts`, `AnthropicMediaPurgeCache.test.ts`, Anthropic cache tests, and `OpenAIProvider.kimiCacheTransport.test.ts` cover transactional frontier behavior, cache proof, rollback, breakpoint placement, exact replay, append-only prefixes, image removal, stable and changed affinity keys, stable `ms://` references, stable system instructions, and observed cached tokens. |
| AC-11 | `media-lifecycle-metrics.test.ts`, store/resolver/recording/persistence boundary suites, provider-file tests, and `issue-3199-media-memory-benchmark.test.ts` cover independent limits, exact-limit failures, concurrent reservations, release accounting, and reported process/lifecycle dimensions. |
| AC-12 | `issue-3199-media-memory-benchmark.test.ts` validates the multi-metric verdict. Isolated six-turn Bun and Node forced-GC reports at `/tmp/issue3199-final-bun-candidate-2/media-memory-report.json` and `/tmp/issue3199-final-node-candidate-2/media-memory-report.json` both reported `overallWithinTolerance: true` for every available metric. Each run used six distinct image IDs, retained one history item and one provider file, left no active requests, reservations, pending releases, or superseded owners, and kept spool bytes below quota. |

## Open Code Review ledger

The first local OCR round reviewed 243 files and returned 199 zero-based comments. Every comment was checked against the issue scope, source, and behavioral tests. The classifications are:

- **Blocker-Fix (78):** 3, 4, 5, 6, 12, 14, 20, 22, 25, 26, 33, 35, 36, 37, 38, 39, 40, 41, 44, 50, 60, 61, 63, 64, 65, 66, 67, 70, 74, 75, 76, 78, 81, 84, 87, 88, 89, 92, 98, 102, 103, 106, 107, 108, 109, 114, 117, 118, 121, 123, 126, 127, 128, 129, 132, 133, 136, 137, 140, 143, 145, 149, 150, 153, 156, 168, 170, 171, 173, 174, 175, 176, 177, 181, 185, 191, 192, 198.
- **In-scope-Fix (30):** 16, 23, 45, 48, 49, 54, 56, 62, 73, 104, 105, 113, 122, 125, 134, 138, 139, 146, 152, 160, 161, 162, 166, 178, 183, 189, 193, 194, 196, 197.
- **Reject (62):** 0, 8, 9, 10, 11, 13, 15, 17, 19, 21, 28, 29, 30, 31, 32, 43, 46, 47, 51, 52, 55, 57, 58, 59, 68, 69, 77, 79, 83, 85, 90, 93, 94, 95, 96, 97, 99, 111, 112, 119, 141, 142, 144, 148, 151, 154, 157, 158, 159, 163, 164, 165, 167, 169, 172, 179, 182, 184, 187, 188, 190, 195.
- **Defer (29):** 1, 2, 7, 18, 24, 27, 34, 42, 53, 71, 72, 80, 82, 86, 91, 100, 101, 110, 115, 116, 120, 124, 130, 131, 135, 147, 155, 180, 186.

All Blocker-Fix and In-scope-Fix comments were remediated. Source and behavioral evidence for the storage/package cluster includes bounded per-project reclamation, serialized provider-file history transforms, concrete reference metadata, dedup-aware rollback, single-close directory sync, recording and persisted-state manifest verification, destination-local import staging, success/error reservation release, bounded package reads, lock heartbeats, instance leases, malformed-reservation cleanup, per-object reclamation revalidation, no verified-read buffer copy, dimension-conflict rejection, guaranteed child-process cleanup, stable purge-frontier rebasing, known-object rollback consistency, malformed-reference validation before dereference, immediate persistence-promise rejection handling, platform-aware peak-RSS conversion, configurable media quota, and distinct malformed/missing/corrupt lifecycle tests.

The second and final local OCR round completed successfully and returned 233 zero-based comments across 255 files. Nine model tasks failed inside OCR, so each emitted comment was reconciled directly against the source and behavioral tests. No further OCR round is permitted. The final classifications are:

- **Blocker-Fix (96):** 1, 3, 4, 8, 9, 13, 16, 20, 21, 22, 24, 26, 27, 28, 30, 31, 32, 36, 37, 39, 40, 44, 46, 47, 48, 50, 52, 53, 55, 58, 60, 61, 62, 65, 68, 69, 70, 72, 75, 77, 78, 82, 84, 85, 86, 87, 100, 102, 103, 104, 105, 106, 110, 112, 116, 124, 125, 126, 134, 142, 143, 145, 147, 148, 149, 151, 153, 159, 162, 163, 166, 169, 170, 172, 173, 176, 177, 178, 182, 183, 184, 185, 189, 196, 198, 201, 207, 209, 210, 211, 214, 218, 219, 220, 229, 231.
- **In-scope-Fix (49):** 5, 6, 12, 18, 23, 33, 38, 41, 51, 64, 66, 67, 74, 81, 90, 93, 94, 101, 109, 115, 117, 121, 123, 127, 128, 129, 135, 136, 137, 138, 141, 150, 152, 155, 157, 160, 164, 187, 192, 193, 195, 197, 202, 204, 208, 212, 213, 215, 232.
- **Reject (36):** 0, 2, 11, 14, 15, 17, 19, 25, 34, 49, 54, 56, 63, 79, 80, 96, 97, 99, 108, 120, 122, 132, 133, 154, 158, 165, 167, 179, 186, 190, 205, 221, 222, 226, 227, 230.
- **Defer (52):** 7, 10, 29, 35, 42, 43, 45, 57, 59, 71, 73, 76, 83, 88, 89, 91, 92, 95, 98, 107, 111, 113, 114, 118, 119, 130, 131, 139, 140, 144, 146, 156, 161, 168, 171, 174, 175, 180, 181, 188, 191, 194, 199, 200, 203, 206, 216, 217, 223, 224, 225, 228.

All Blocker-Fix and In-scope-Fix comments were remediated with focused behavioral evidence. The principal remediation clusters were temporary-to-history ownership transfer, atomic batch publication, rollback-safe persistence and package import, lower-bound queue preflight, unresolved-reference rejection, exact Kimi Files failure behavior, provider-file unbinding and retryable deferred deletion, serialized purge transactions, exact Anthropic cache-write attribution, process-safe media-store publication and leases, bounded JSON cleanup, and unique-image Node/Bun lifecycle probes. Rejected comments were contradicted by the source or required behavior. Deferred comments were valid maintenance or test-style suggestions outside AC-1 through AC-12 and were not used to expand the issue.

## Candidate verification before integrating current main

The candidate at baseline `38d9fb9f74749b2b83e5f6a7d7f643af7940aa17` completed the implementation and review gates below. Final verification will be repeated after integration with current `origin/main`.

### Transaction, ownership, and publication evidence

- `HistoryService` serializes asynchronous replacement, transformation, density, and ownership work through one mutation queue. Behavioral tests cover execution-time transforms, synchronous additions queued behind replacement, chronology rollback, token rollback, observer ordering, and transactional participant rollback.
- Atomic batch publication and recording participation are covered by `HistoryService.addBatch.test.ts`, `HistoryService.recording-transaction.test.ts`, `HistoryService.media-ownership.test.ts`, and the chronology and density suites.
- Media ownership tests cover temporary owner transfer, retained-reference adoption, exact reservation release after density removal, replacement rollback, runtime disposal, resumed sessions, persistence admission, and retryable cleanup.
- Every changed compression path publishes with awaited `HistoryService.replaceAll()`. Focused compression and token-lifecycle runs passed 45 tests with 132 expectations. Production scans found no clear-and-re-add publication path.
- Semantic purge tests passed 28 tests with 81 expectations. They cover explicit default-off behavior, serialized leases, candidate isolation, durable frontier updates, exact Anthropic boundary proof, stale transactions, rollback, provider failure, cancellation, retry handoff, and finalization after history publication.
- Density, chronology, ownership, and token-lifecycle tests passed 57 tests with 176 expectations. Kimi transport tests passed 8 tests with 31 expectations. Provider cleanup tests passed 104 tests with 224 expectations. `ChatSessionFactory.test.ts` passed 34 tests with 53 expectations.

### Static and build gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Root lint | Passed | `/tmp/issue3199-final-lint-3.log`, status 0 |
| Root typecheck | Passed | `/tmp/issue3199-final-typecheck.log`, status 0 |
| Root format | Passed | `/tmp/issue3199-final-format-2.log`, status 0 |
| Root build | Passed | `/tmp/issue3199-final-build.log`, status 0 |
| Diff whitespace | Passed | `git diff --check`, status 0 |
| Protected scope | Passed | No `.github/workflows`, lockfile, root `package.json`, or `.llxprt` changes |
| Changed TypeScript policy scan | Passed | `/tmp/issue3199-final-policy-hits.txt` is empty; no suppressions, `any`, focused tests, or disabled tests |
| Deferred-work marker scan | Passed | `/tmp/issue3199-final-added-markers.txt` and `/tmp/issue3199-final-untracked-markers.txt` are empty |
| Changed-test assertion scan | Passed | `/tmp/issue3199-final-test-nonnull.txt` is empty |

### Test-audit evidence

The final candidate test-audit scan covered 2,736 files and exited 0. The normalized candidate-only comparison against the same paths on main is empty. Evidence is in:

- `/tmp/issue3199-test-audit-candidate-postformat`
- `/tmp/issue3199-test-audit-candidate-only-postformat.tsv`
- `/tmp/issue3199-test-audit-main-finalpaths-normalized.tsv`

### Full-suite evidence

The fresh root run in `/tmp/issue3199-final-root-test-2.log` exercised every workspace. The CLI phase passed all 715 test files. The root command returned status 1 for two independently classified groups:

1. Five PowerShell workers could not load the grammar, and four ripgrep resolver cases observed ambient user configuration. Current `origin/main` contains fixes for both groups in `bd2cba80a` and `30071dada`.
2. Four agents files reached the 180-second per-file timeout under aggregate contention. Each file passed when rerun alone: 4 MessageBus tests, 29 auth-profile tests, 22 MCP-discovery tests, and 6 skills-control tests, with zero failures across 61 tests.

The complete suite will be rerun after rebasing onto current main so the upstream PowerShell and ripgrep fixes are present and the aggregate run starts without an orphaned prior test worker.

### Memory and lifecycle evidence

The final six-turn forced-GC Bun and Node probes both exited 0:

- `/tmp/issue3199-final-bun-candidate-2/media-memory-report.json`
- `/tmp/issue3199-final-node-candidate-2/media-memory-report.json`

Both reports contain six distinct deterministic image IDs and `overallWithinTolerance: true` for every available process metric. Each ended with one retained history item, one provider file, no active requests, no reservations, no pending releases, no superseded owners, 524,288 retained bytes, and 3,145,728 spool bytes under the 3,670,016-byte quota.

### Review outcome

The issue-intent review and both permitted local OCR rounds are complete. Every Blocker-Fix and In-scope-Fix was remediated with focused behavioral evidence. Rejected findings were contradicted by source or required behavior. Deferred findings were outside AC-1 through AC-12. No further local reviewer or OCR round is permitted.

### Profile smoke

The StepFun smoke command reached the configured API and returned HTTP 400 because the account has no active Step plan subscription. The report is `/var/folders/qd/962lhrjj0232rjykgg3lgmrw0000gn/T/llxprt-client-error-Turn.run-sendMessageStream-2026-08-25T13-26-21-912Z.json`. This is an external account blocker. No implementation or configuration change can turn that provider response into a successful smoke result.

## Verification after integrating current main

The source candidate at `9587a2718d0931a59b5d70601d7f2c07140918be` was verified on top of `origin/main` at `e84a100a96c7bc6c474049e0392a5f37075fdfab`. `origin/main` is an ancestor of the candidate, and the branch contains one issue commit. The verification-evidence amendment changes only this plan.

### Static, build, and repository gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Root format | Passed | `/tmp/issue3199-rebase-format.log`, status 0 |
| Root lint | Passed | `/tmp/issue3199-rebase-lint.log`, status 0 |
| Root build | Passed | `/tmp/issue3199-rebase-build.log`, status 0 |
| Post-build root typecheck | Passed | `/tmp/issue3199-rebase-typecheck-after-build.log`, status 0 |
| Diff whitespace | Passed | `git diff --check origin/main...HEAD`, status 0 |
| Protected scope | Passed | `/tmp/issue3199-rebase-protected-scope.txt` is empty; no workflow, `.llxprt`, root package, or lockfile changes |
| TypeScript policy scan | Passed | `/tmp/issue3199-rebase-policy-hits.txt` is empty; no added suppressions, `any` types, focused tests, or disabled tests |
| Deferred-work marker scan | Passed | `/tmp/issue3199-rebase-added-markers.txt` is empty |
| Changed-test assertion scan | Passed | `/tmp/issue3199-rebase-test-nonnull.txt` is empty |

The first post-integration typecheck ran before the coordinated build refreshed telemetry declarations and saw the old generated declaration. The full build passed, refreshed workspace declarations, and the authoritative post-build typecheck passed.

### Test evidence

The root run in `/tmp/issue3199-rebase-root-test.log` exercised all workspaces and returned status 1 for one aggregate-only timeout. `packages/agents/src/api/__tests__/scheduler-factory.spec.ts` reached the 180-second per-file limit during the full run. The same file passed immediately by itself with 1 test, 5 expectations, and status 0; evidence is in `/tmp/issue3199-rebase-scheduler-isolated.log`. No other failure marker appears in the root log.

Conflict-sensitive suites were also exercised with per-file isolation, matching the root runner's process model. Provider media, Anthropic cache, Kimi transport, provider-file policy, and cleanup coverage passed 61 tests with 190 expectations. The five compression files affected by same-process fixture leakage passed independently with 59 tests and zero failures. Telemetry passed 3 tests with 10 expectations in isolation. Ripgrep acquisition and resolver coverage passed 124 tests with one Windows-only skip and 299 expectations. The integrated PowerShell change converted unavailable-grammar cases into explicit skips rather than worker failures.

### Test-audit evidence

The post-integration candidate audit scanned 2,755 files with zero scanner errors. Current main was scanned from a temporary detached worktree with the same scanner and dependencies. Findings for the 184 changed test files were normalized without line numbers and compared under bytewise collation. The candidate-only result is empty.

- `/tmp/issue3199-test-audit-rebase-candidate`
- `/tmp/issue3199-test-audit-rebase-main`
- `/tmp/issue3199-test-audit-rebase-candidate-normalized.tsv`
- `/tmp/issue3199-test-audit-rebase-main-normalized.tsv`
- `/tmp/issue3199-test-audit-rebase-candidate-only.tsv`

### Post-integration memory evidence

Fresh six-turn forced-GC probes passed under Bun and Node:

- `/tmp/issue3199-rebase-bun-memory/media-memory-report.json`
- `/tmp/issue3199-rebase-node-memory/media-memory-report.json`

Both reports use six distinct image IDs and report `overallWithinTolerance: true`. Each ends with one retained history item, one provider file, zero active requests, zero reservations, zero pending releases, zero superseded owners, 524,288 retained bytes, and 3,145,728 spool bytes below the 3,670,016-byte quota.

### Final external smoke status

The profile smoke remains blocked by the configured StepFun account's inactive subscription. The request reached the API and returned HTTP 400. This external result does not indicate a local startup, build, or media-lifecycle failure.
