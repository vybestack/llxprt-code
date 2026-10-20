# Phase 5 Kimi eligible-count increment, 2026-10-20

The first native Kimi group persists emitted eligible-call counts and answers zero-based ordinals from pinned row-tree aggregates. Implementation is `4dd919d4e8607e8ad304af6f770f3baacc908fb5`, based on `a797ffe5a`; the independent mapper oracle is `440dc3cf996960869833397b5bd283ace52ab081`. This is a partial Phase 5 increment. Provider routing and the backend default are unchanged.

## Implemented boundary

A separate `{ kind: 'kimi' }` fill enables versioned eligible counting. The production native group writer publishes the marker, row counts and ancestor aggregates together. Failure leaves the previous version published and poisons further writes. The recording-primary boundary accepts this owner-neutral fill without relaxing owner-sensitive edits.

Eligible means a named, nonempty call in the final emitted normalized units, across all speakers. Duplicate blocks count separately. R1 reconstruction uses the nonempty default name when the source response's tool name is empty. Raw namespace-0/4 counters remain source-based. `VersionSnapshot.kimiEligibleCount()` rejects an unfilled version rather than reporting a measured zero. `kimiOrdinal(label, eligibleWithinRow)` uses the held tree and the eligible rank within that row's emitted contribution, not a raw block index.

Activation starts a lineage; prefix rebuilds preserve it through pop, including an empty prefix. Reopen, owner changes, clone and compaction retain the counts. Earlier pins stay valid; a closed pin rejects reads. Clear retains empty-root semantics and needs a fresh fill. This activation registers no format/settings slot, summary or LENS record.

| Area | Current boundary |
| --- | --- |
| R1 through R8, source facts, count/rank/pending | Existing lazy/indexed behavior retained. |
| Namespaces 1/2 | Persisted emitted normalized counts and positions retained. No request-only tail-query API claimed. |
| Mistral | Existing explicit per-slot namespace-3 mapping fills, salts and mappedRef copy rules retained. No namespace redesign. |
| Kimi | Native emitted `callBlocks`, explicit fill marker, pinned count and row-eligible ordinal lookup implemented. |
| Kimi last eligible/name, exceptions and corrections | Not implemented here. Namespace-0 lastEligibleCall is still a source fact. Sparse exception entries, written-use/unmapped counters, digit/name token/byte corrections and affected-holder remeasurement remain open. |
| Format/settings and lengths | Keys/generations, summaries and LENS remain incomplete. No unfilled zero is a measured length. |
| Request-only tails | Existing bounded unit/pending overlays remain separate; no Kimi or normalized tail-query continuation claimed. |
| Provider routing/default | Unchanged. |

## Verification

Acceptance is **114 isolated serial processes over 57 files, 872 passes, 938784 assertions, zero failures or skips**, under both outer backend settings and the unchanged `--timeout 180000`. Eight scoped gates pass: tools/core declaration builds, strict core test-inclusive types, tools types, zero-warning ESLint, Prettier, affected-shard graph and AST test audit. Graph validation is not a claim that every affected shard ran.

The eight new native tests include 120 unchanged frozen-source histories and first-row-removed variants, **240 eligible-count comparisons per backend**. Expected counts come from the existing complete normalizer and tools Kimi mapper's fallback counter, not a copied eligibility predicate. Named cases cover the human-call dropped-output input's eligible count, empty/unnamed IDs, reconstructed duplicates/default names, raw/prefix collisions, pins, append/pop/clear/removal, owner/reopen/fork/compaction and ordinal boundaries 9/10 and 99/100. These do not prove written-use digit totals or Kimi mappings. The unchanged **5000-case** normalization/unit/count/rank/occurrence/pending corpus still passes. All frozen hashes remain unchanged.

At 4000 rows, unique append and response arrival each stay below 150 positional reads; an uncached selected ordinal stays below 30. AI-only eligibility, narrowed-ordinal and retained-all-row-map controls fail the intended assertions. The map control takes 581 reads and fails the unchanged lookup bound. This is read-budget evidence, not retained-heap proof. Every control restores with cmp and SHA-256 before acceptance. Two DUP_ASSERT findings span older-pin mutation and separate append measurements; no prohibited touched audit finding remains.

Initial failures remain recorded: missing activation/API, recording-boundary refusal, lint/type authoring fixes, a compact-with-live-pin test mistake, a closed-pin message mismatch and eager access during construction of an uncommitted snapshot. The latter failed an existing regression before the constructor fix.

[PHASE5-KIMI-PROOF.json](PHASE5-KIMI-PROOF.json) binds 13 committed product/test paths, the 8849-entry package/script inventory and 591 raw receipt hashes. All 320 recorded Kimi child/driver PIDs are absent; none live. Fixtures remain byte-identical. Raw logs and PID inventory are under `tmp/854-notes/p5/kimi-run-g/`. Prior Mistral evidence was validated before edits: **540 receipt hashes matched; all 302 recorded PIDs absent**. See [PHASE5-KIMI-DECISIONS.md](PHASE5-KIMI-DECISIONS.md). The prior [Mistral proof](PHASE5-MISTRAL-PROOF.json) remains historical source-bound evidence.

## Remaining work

Finish emitted last-eligible/name bookkeeping, disk exceptions, written-use/unmapped counters and ordinal digit/name corrections, with affected earlier holder paths updated. Add the typed request query view merging persisted normalized occurrences, virtual tail units and changed journal contributions. Continue Mistral's lazy/tail used set, then format/settings generations, summaries, LENS and provider consumers. Keep sends on the complete old normalizer until the required proof is ready.

Full mutation/10k-100k-1M retained-heap acceptance and row-range whole-record CRC closure remain open. Stage A completion, W26 scratch removal, W23's eight zero-decode planning/header cases, provider spool deletion and W25/default requirements remain later dependencies.

No cleanup, obstruction move, .llxprt staging, generated-declaration staging, recovery bulk staging, OCR, push or merge. The 293 pre-existing untracked agent declarations and unrelated recovery artifacts remain excluded. Review skipped per Andrew 2026-10-09.
