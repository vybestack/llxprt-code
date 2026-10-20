# Native Mistral bookkeeping decisions, 2026-10-20

Implement persisted Mistral mapping assignment before expanding into Kimi or request-tail queries. The earlier copy tests populated mappings from test code; they did not establish production assignment. The native group writer now owns assignment, and the existing id trie remains the only mapping index.

## Activation and ownership

A separate `{ kind: 'mistral', slot }` commit activates bookkeeping for one of the three defined format slots. It rebuilds mappings from surviving raw IDs and records the active slot mask in versioned metadata under `mistral:slots`. It publishes a fill mutation. Mixed activation groups are refused so a streaming replacement cannot be consumed before a later activation edit. This is a mapping-only fill, not registration of a complete format/settings key or valid length summaries. The existing refusal to write rows with unfinished active summary slots remains unchanged.

Activation starts a new lineage. A pop must not select a pre-fill ancestor whose trie has no mappings. A pop that rebuilds a prefix carries the mapping mask from the source version, including when that prefix is empty. The added pop regression first exposed the missing pre-fill mapping and then the lost mask on an emptied base; each failure preceded its fix. Clear and explicit saved-version restoration retain their existing version semantics.

The `mappedRef` VALUE has the raw ID's namespace-0 hash as its owner header. Its bounded body holds a slot mask and, for each present slot, the nine ASCII alphanumeric bytes plus the insertion salt. Salt zero in the encoded u64 means pass-through; generated salt `s` is stored as `s + 1`. Reads reject wrong raw ownership, wrong kind, malformed masks/IDs, truncated or trailing bytes and oversized bodies. VALUE body reads validate the full body CRC. This does not close CRC coverage of unrelated row range reads.

## Assignment policy

Use the tools package's existing deterministic candidate generator as a pure injected function. Journal code imports no provider implementation. Nonempty call IDs are observed in emitted unit order, including non-AI calls and reconstructed calls. An unnamed call still maps under Mistral. Empty calls and response IDs without observed calls remain conversion-time work, not persisted observe mappings.

A nine-character alphanumeric raw ID passes through and marks the candidate used, even when another raw ID already maps to that string. This is the current converter's collision policy. Other raw IDs try salts from zero until the candidate is free in namespace 3 for that slot. A later occurrence reads the prior mapping rather than assigning another salt. Rebuild starts with a fresh used set and raw IDs from ROW id pieces. Removing `4SftZvDMX` therefore changes `toolu_alpha-1` from `4Uq1sY29c` at salt 1 to `4SftZvDMX` at salt 0.

Middle insertion with active mapping bookkeeping rebuilds instead of keeping insertion-order-dependent old mappings. Pop restores mappings from its selected mapped version or rebuilds the retained prefix. Owner/fill operations preserve raw mapping ownership. Clone and compaction use the existing `IdFact.mappedRef` entry in `OFFSET_FIELDS`; mapping bodies contain no file offsets and require no new relocation rule.

## Bounds and remaining work

Assignment uses the existing bounded fact writer and node caches, one raw ID and a maximum 52-byte mapping body. Incremental append visits the added row and existing affected paths. Rebuild streams headers and ID pieces. No retained all-history map, new operation file or per-send scan is introduced. The response-append and selected-mapping read bounds are tested separately from retained heap. Deliberately retaining all IDs fails the existing read budget; it is not a 10k/100k/1M heap result.

The snapshot read API is pinned and persisted-only. It does not claim to answer normalized namespace queries with request-only tails, or to continue Mistral's lazy conversion-time used set. That work needs a typed request view combining pending IDs, emitted tail units and affected journal contributions. Kimi's emitted counters, eligible-name replacement, exception corrections and holder remeasurement remain open, as do format/settings generations, summaries and LENS. Provider sends still use the complete old normalizer. W26 scratch, W23's eight planning/header cases, full heap acceptance, range CRC closure and W25/default requirements remain open.

Keep the frozen corpus and provider fixtures unchanged. Compare native mappings with the independent existing normalizer/tools mapper, not the new assignment function. Preserve initial failures and byte-checked controls. The repeated pinned mapping assertion before and after density mutation is intentional snapshot-stability coverage. Review skipped per Andrew 2026-10-09. No cleanup, .llxprt staging, declaration/recovery bulk staging, OCR, push or merge.
