# Recorded Anthropic table expectations

`retired-table-wire.json.gz` stores 6,421 request-input hashes mapped to the exact message-array JSON emitted by the retired table builder. `retired-table-evidence.json` stores its 54 nonempty cache-preparation observations. These are test expectations, not product request storage.

The source was the table implementation at `23676f1fd`, while its modules were still present. A recording-only change appended the original builder results after table finishing and emission. The inputs include all 5,000 independently normalized cache-off corpus seeds, the retained native Anthropic byte-oracle suites, and the scale inputs that timed-out tests did not reach, and the first 600 raw seeds of the cache-off and purge-boundary reference-machine comparisons. The original frozen wire corpora and counterexamples were not changed.

Each lookup hashes `JSON.stringify([rows, settings, cache])` with SHA-256. An unrecorded input fails the test. No native serializer generates a replacement expectation. Duplicate input hashes were checked for identical output before the gzip fixture was written. Gzip timestamps are fixed at zero.

The length-model reference, frozen-corpus and counterexample tests remain under `../wire-reference/`. Retained direct cache, media, image-budget, reasoning and residency cases now exercise native Anthropic stream repair. Native wire-oracle suites and the reference-machine comparison read these recorded expectations through `recorded-wire-oracle.ts`; their assertions are unchanged.

The append-lifecycle repair made previously blocked test branches reachable. Their 13 additional inputs were recorded using the original table modules and harness extracted from `bbb6fee53`, with only relative module imports relocated into the recording directory. No native output was used. All original 6,408 entries remain byte-identical. The capture script, original-output records and passing capture run are preserved in `tmp/delete5/record-old.py`, `tmp/delete5/additional-original-wire.jsonl` and `tmp/delete5/lifecycle-capture.log`.
