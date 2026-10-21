# Native Responses stored lengths: parentless first slice

Base: `c2629b1b47078117bf16e90d422ab8ac99648355`. First production piece: `eef2544c29260889e1539c4d6c8269d0853114ae`; pairing/lifecycle follow-up: `f62afa9a0894fd12b5da82c6f7d730bf9d943cc0`. This is an opt-in format registered through `JournalSession.registerRowFormat`, not a provider send cutover. Both HTTP Responses routes continue to use their existing body builder. Phase 5 and W23 remain incomplete. Final acceptance is bound in [PHASE5-RESPONSES-FORMAT-PROOF.json](PHASE5-RESPONSES-FORMAT-PROOF.json); the earlier Responses normalization proof remains separate.

## Existing writer and converter path

The provider injects `responsesLengthRegistration` into the existing native three-slot writer. Core does not import providers. The registration captures the existing typed settings object before asynchronous publication; model, endpoint, output limits and every other declared setting remain key inputs. The slot uses the existing `responses` summary kind, two boundary states and two reasoning variants. Existing plain-chat registrations and mapping-only reservations keep their meanings.

The measurer reads `journalEntryPlans` for one contribution, materializes one normalized unit, resolves only that unit's pairing questions through `IndexedJournalRequestSnapshot`, and invokes the actual Responses input converter. `buildOpenAIResponsesUnit` exposes the converter's existing unit operation with injected pair membership and a generated-ID callback. The old array builder still uses its own whole-input pair lookup. No new raw-history array entry point is added.

LENS stores numeric per-unit byte/item/generated-ID/PDF facts for the two variants. It stores neither request text nor all selected units. The native writer persists LENS, summary, PDF metric and generation stamps in the same commit group. A callback failure preserves the acknowledged version and propagates its original cause; the existing started-writer poison rule requires reopen before later writes.

## Pair membership and mutation maintenance

Full-history membership comes from namespace 1 normalized occurrences, including empty IDs, `call_` collisions, reconstructed calls, relocated results and speaker eligibility. A nonempty-ID shortcut is not used. Journal normalization already completes orphan calls with null results. Measurement never runs the raw-source cancellation scan or synthesizes its different cancellation text.

A lifecycle differential exposed a dependency outside the raw-ID normalization holder: an empty AI call initially has no emitted response, but appending a response for `call_` makes that earlier call eligible through their shared OpenAI-normalized ID. Ordinary contribution invalidation does not cover that change. Before incremental Responses fill, `responsesPairChanges` compares old and tentative normalized membership for IDs on missing contributions. A change from absent to present, or the reverse, invalidates counterpart holders obtained from indexed occurrence lists. It streams one holder at a time and path-copies the affected entries. No history-sized holder collection or history-prefix walk is introduced. Existing contribution invalidation still handles changed result bytes and media. Rebuilds remeasure surviving contributions.

## Exact request length and supported inputs

`planStoredResponsesRequest` reads the pinned aggregate, refuses missing or stale base/image stamps, and finalizes the selected variant. Generated reasoning ID members are omitted during measurement. The planner adds their actual timestamp spelling and the closed-form digit sum for ordinals `0..r-1`; genuine server IDs remain in measured bytes. The timestamp must be a nonnegative safe integer and must be supplied unchanged to the eventual writer.

The request envelope uses `responsesRequestParts`, extracted from the existing disk-body serializer's member/framing loop. Input brackets and separators come from the summary. Instructions, tools, sampling/reasoning options and other JSON envelope members are counted once with the existing progressive JSON value length function. No history serialization is performed to obtain a warm length. The request model must equal the registered settings model, and input must be the existing empty placeholder, not an override. The returned length describes UTF-8 serialized body bytes; it does not install an HTTP Content-Length header.

PDF enabled and disabled variants are distinct keys. The measured provider-effective decoded PDF byte metric is stored in the existing per-slot aggregate and checked with the existing 50 MB error message. Inline base64 and URL media use the actual converter, including file names, data-URI wrappers and unsupported-media notices. Stored media references fail explicitly: exact projection and image generations are not implemented in this slice.

Supported settings are Responses revision 1, non-OAuth, tool-name transform `none`, URL-image support enabled, reasoning-enabled flag false, reasoning field `reasoning_content`, and unsupported-media policy `notice`. Both PDF flag values and captured output-limit configurations are implemented. Other declared settings fail at registration and planning rather than being silently ignored. Reasoning inclusion selects variant 0 or 1. Responses does not read the chat thinking-strip policy.

## Unsupported request scope and cost boundary

A previous-response parent, nonzero cursor, or pending input fails explicitly. Parent selection, cursor-after-AI semantics, pair-sensitive selected-range correction, and indexed tail recomposition remain open. The full-history pair facts stored here must not be reused for those ranges. Raw non-journal sources retain their existing cancellation behavior and are outside this stored-format API.

Cold registration streams and measures contributions explicitly once for a new key, with both reasoning variants produced from the current unit. Warm full-history planning reads only the pinned trailer aggregate and no ROW or LENS payload. Append prunes missing/stale tree paths and additionally repairs indexed pair-membership holders. Reattaching the complete newest key requires no new trailer or conversion. These are read-cost properties, not a retained-heap proof.

The first frozen-input harness compared the journal's curated stream with uncurated input. Seed 2 showed an AI row with an empty thinking block being removed by the existing `isCuratedContent` predicate. The differential now applies that same pre-normalization predicate to the old oracle. Frozen inputs and golden fixtures are unchanged. Raw frozen wire parity remains a separate existing test lane and is not relabeled as native stored-format coverage.

Remaining work includes parent/range/tail planning, stored-media reference projection, separate image generations and metrics, LENS-based recomputation/live-byte accounting, tokens, all-format revision pins, the production first-byte byte guard, actual header installation and every provider route cutover. W23's eight large-overlimit zero-decode cases are not closed. No full-product zero-decode or retained-memory acceptance follows from the helper and native registration tests. Codec #3917 remains separately RED without retry or suppression. Review skipped per Andrew 2026-10-09.
