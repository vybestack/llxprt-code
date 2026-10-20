# Phase 5 native Mistral increment, 2026-10-20

Native Mistral mappings now persist through append, rebuild, pop, owner changes, clone and compaction. Implementation is `819ca78dbeac092dfea8ad4e165ee17ebd4b3a90`, starting from `2bba0b8e3`. This is a partial Phase 5 increment. Production provider sends still use the complete existing normalizer, and the default backend is unchanged.

## Implemented boundary

A separate `{ kind: 'mistral', slot }` fill activates mapping bookkeeping in one of slots 0 through 2. Versioned metadata holds the active mapping-slot mask. This is not a complete format/settings-slot registration, summary fill or provider send route.

The group writer assigns mappings for nonempty observed calls, including reconstructed calls, non-AI calls and unnamed calls. It uses the raw ID from the ROW id piece and the injected deterministic tools candidate generator. Nine-character alphanumeric IDs pass through, including the existing converter's pass-through collision policy. Other IDs select the first unused salted candidate in namespace **3**. The raw fact's `mappedRef` points at a bounded VALUE holding the per-slot ID and retained insertion salt. Its owner header is the raw ID's namespace-0 hash. Reads validate owner, framing, body CRC and bounded codec fields.

Rebuild reassigns from the surviving raw IDs with a fresh used set. Removing the first collision holder changes `toolu_alpha-1` from `4Uq1sY29c` at salt 1 to `4SftZvDMX` at salt 0. Middle insertion rebuilds when mapping bookkeeping is active. Activation starts a mapped lineage so pop cannot select a pre-fill root. Prefix rebuilds retain the mask even when the prefix is empty. Clone/compaction remap `mappedRef` through the existing OFFSET_FIELDS rule; no alternate index or offset rule was added.

`VersionSnapshot.mistralMapping(rawId, slot)` reads the held version pin. Earlier pins retain their salt/mapping after later mutations, and closed-pin reads fail. The incremental path touches added rows and affected ID/tree paths, using the existing 65536-byte fact batch and fixed node caches. Mapping reads hold a maximum 52-byte body. Rebuild streams source headers and ID pieces without decoding payloads or retaining all historical IDs. No new operation scratch file or per-send scan was introduced.

## Fields and APIs

| Field or API                                               | Current boundary                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 through R8, target/slot/media/metadata rules            | Existing lazy and indexed units retained.                                                                                                      |
| Native C, Ca, R, Rt, best                                  | Source facts retained; empty ID has Rt for reconstruction, but no real R or best.                                                              |
| Contribution flags, reconBlocks, answered, aggregate units | Existing native count/rank/selection and tail-bounded pending metadata retained.                                                               |
| Normalized namespaces 1/2                                  | Persisted emitted OpenAI/Anthropic counts and unit positions retained. Older source-only views reject normalized queries.                      |
| Namespace 0 counters and namespace 4 occurrences           | Still source-based. They do not establish emitted Kimi bookkeeping.                                                                            |
| Mistral                                                    | Native explicit mapping-only slot activation, used namespace 3, raw-owned mappedRef/salt, append/rebuild/pop/copy maintenance now implemented. |
| Kimi                                                       | Emitted callBlocks, last eligible/name, exception list, ordinal/digit corrections and holder remeasurement remain open.                        |
| Format/settings and lengths                                | Keys/generations, summary maintenance and LENS remain incomplete. No unfilled zero is claimed as a measured length.                            |
| Request-only tails                                         | No normalized occurrence-query overlay or Mistral lazy/tail continuation API is claimed. Existing unit/pending overlays remain.                |
| Provider routing/default                                   | Unchanged.                                                                                                                                     |

## Verification

Final acceptance is **110 isolated serial processes over 55 files, 856 passes, 933836 assertions, zero failures or skips**, under both outer backend settings. Each file runs alone from its package with `--timeout 180000`. Eight gates pass on source hashes matching acceptance: tools/core declaration-only builds, strict core test-inclusive types, tools types, zero-warning scoped ESLint, Prettier, affected-shard graph and AST test audit. Graph validation does not establish that every affected shard test ran.

The independent native mapping oracle uses the existing complete normalizer and tools mapper. Added coverage includes **160 collision-heavy mapping comparisons**, late activation in slot 2, reopen/append, multiple slot isolation, pass-through collisions, first-holder removal, insertion, pop across the fill boundary, empty-prefix pop, owner changes, fork/compaction offset audit, closed pins and a CRC-valid wrong-owner reference. The unchanged **5000-case** normalization/occurrence/count/rank/pending corpus remains exact. Its twelve structural families and frozen hashes remain unchanged; the new mapping differential is additive, not a replacement.

At 4000 calls, response append stays below 150 positional reads and a pinned selected mapping lookup below 20. Native controls reject a wrong salted mapping, accepting another raw ID's VALUE, and an all-history retained-ID map. All mutated control targets restore with cmp and SHA-256 before final acceptance. The all-ID control fails the unchanged read bound at 14193 reads; it is not retained-heap proof. One touched DUP_ASSERT is retained because it checks the old pinned mapping before and after density mutation. No touched MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING or NO_ASSERT finding remains.

Initial failures are preserved separately: missing activation/read API, declaration/exhaustive recording-boundary failures, lint refactors, pop losing pre-fill mappings and empty-prefix masks, and a test-authoring failure from an omitted slot argument. Final gates and acceptance follow the corrections. The recording boundary now admits the separate mapping fill without relaxing owner-sensitive edits.

[PHASE5-MISTRAL-PROOF.json](PHASE5-MISTRAL-PROOF.json) binds 16 committed product/test paths, the 8846-entry package/script inventory, log/JUnit/control/gate hashes and **302 absent recorded PIDs, none live**. Raw receipts remain under `tmp/854-notes/p5/mapping-run-f/`. The old normalizer, frozen unit corpus and eight provider fixtures/manifests are byte-identical to starting HEAD. Earlier proof files remain historical evidence. See [PHASE5-MISTRAL-DECISIONS.md](PHASE5-MISTRAL-DECISIONS.md).

## Remaining work

Implement Kimi emitted facts, eligible-name/ordinal/digit correction and holder remeasurement. Add a typed request query view merging persisted normalized occurrences with virtual tail units and affected journal contributions, without claiming that persisted-only queries already accept tails. Continue Mistral's tail used set and lazy conversion-order IDs, then integrate format/settings generations, summaries, LENS and provider consumers. Keep whole provider send routing on the old complete normalizer until the required behavior, heap and corruption proof is ready.

Full mutation/10k-100k-1M retained-heap acceptance and row-range whole-record CRC closure remain open. Stage A completion, W26 scratch removal, W23's eight zero-decode planning/header cases, provider spool deletion and W25/default requirements remain dependent on later work.

No cleanup, obstruction move, .llxprt staging, generated-declaration staging, recovery bulk staging, OCR, push or merge. The 293 pre-existing untracked agent declarations and raw recovery artifacts remain excluded. The implementation uses the recorded per-command `git -c core.hooksPath=/dev/null` slice policy after explicit gates, without changing repository enforcement settings. Review skipped per Andrew 2026-10-09.
