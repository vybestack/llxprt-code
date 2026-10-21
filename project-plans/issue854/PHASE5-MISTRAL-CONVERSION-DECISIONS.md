# Mistral conversion and selected-request facts, 2026-10-20

Starting revision: `b0931635780f2fe4b6e11917fcc1055caf7f3628`.

## Actual conversion order

The tools mapper first observes every nonempty call in normalized unit order, including human calls and unnamed calls. Chat conversion then resolves AI call blocks and tool response blocks. It resolves a tool response before validating whether its message survives. Names do not affect Mistral mapping. Nine alphanumeric characters pass through even if already used.

The complete normalized request has a useful invariant: every converted nonempty result ID already has an observed call. A missing call in a tool row is reconstructed; a result attached to a human call has that observed human call; a result stripped from a human row without a target is never converted. The empty ID is the remaining lazy allocation. `JournalRequestMistral.resolve` therefore reuses native and pending observe mappings and keeps one separate empty-ID allocation, created on first conversion against the entire observed namespace. It does not retain historical response IDs in a pending map. An unexpected unobserved nonempty ID fails and directs the caller to selected conversion facts.

`nativeMistralRow` prepares only the IDs the actual chat converter will request for that row. It uses the real converter for message construction and validation. The prepared synchronous map is row-local. This is an opt-in converter seam; production provider routing and the default backend remain unchanged.

## Fresh selected requests

Filtering normalized units can remove a call while retaining its result, or remove a collision holder while retaining a later call. Native full-request mappings are then wrong. `withMistralSelection(store, slot, indices, consume)` binds increasing selected unit indices to a fresh writer-owned scope, with observe followed by conversion. The scope uses no native full-request mapping as a shortcut.

A cold scope streams selected unit header/ID plans twice, once per phase. It reads no journal block payloads or whole row bodies. The writer fills namespace 7 mappings and namespace 8 used strings through the existing capped `IdFactBatch`, in the same journal. There is no operation file, all-history mapping map, per-ID history scan or full-file pass for each lookup. Subsequent resolution is a trie lookup. Reusing an unchanged scope does not rescan selected units or commit another group.

The query retains its supplied selection indices and one pinned reader, not the selected IDs or used set. Selection descriptors are explicit caller input, not an internally enumerated copy of journal IDs. Distinct selection scopes occupy persistent journal facts; append retains those scopes, while a native fact rebuild discards them. Compaction copies the retained facts. This trades journal space for deterministic fresh selected mapping and avoids request-sized mapper state. A cold arbitrary selection still has metadata work proportional to its selected units. It is not a constant-read filter fill.

## Generation, admission and copying

Mapping scope keys include a version, the native conversion generation, tail ID/header facts, slot and selection indices. Row append/rebuild and index-preserving purge replace the native generation. The purge regression showed why raw ID tuple equality alone does not establish unchanged emitted units: adding non-response content can create a self unit without changing those tuples. Owner/fill and compaction do not change conversion generation. Versioned roots preserve old pins and saved versions.

Scopes carry an explicit version-1 admission marker written only after both phases complete. Mapping values are 18 bytes, containing version, nine ASCII ID bytes and u64 salt-plus-one; used values and markers are one byte. Generation metadata is decimal text under a versioned key. Missing generation requires a fill; there is no old-layout inference or fallback shim.

The new trie values contain no offsets and remain shorter than `ID_FACT_MIN_BYTES`. Existing `IdFact.mappedRef` relocation remains unchanged. Namespace numbering is asserted in the codec contract test. Clone, compaction and reopen tests require identical mappings and cached-scope reuse without another fill.

## Proof and limits

Named inputs cover empty results, unnamed calls, non-AI call output drops, reconstruction before a later result/call, repeated IDs with changed names, nine-character passthrough, a later pending holder reserving the empty ID's salt-zero candidate before earlier emission, first-holder removal, filtered call/result pairs and response-only selections. The independent reference uses the old normalizer, existing tools mapper and actual chat converter. Callback traces come from the actual converter's call/response resolver invocations, including messages subsequently dropped. Salts and exact mapped strings are checked, not just nine-character length.

All 5000 frozen inputs are exercised as complete requests and fresh filtered requests, without eligibility exclusions. Stage A fixtures and old provider fixtures stay unchanged. Read-budget checks are separate from retained-heap acceptance. Kimi fallback/digit arithmetic and holder measurements, settings generations, summary/LENS, range CRC, full retained heap, W26 scratch, W23's eight planning/header cases and W25/default dependencies remain open. Review skipped per Andrew 2026-10-09.
