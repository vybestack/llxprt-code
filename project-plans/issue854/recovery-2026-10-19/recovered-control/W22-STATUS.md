# W22 agents sweep status

Updated 2026-10-19T23:50:37Z. This supersedes the running-collection checkpoint at `31d15cd42`.

**The pending-window cluster is committed and green. W22 remains incomplete.** Source commit: `7ab90bd22e38c6dc4ca685b8269369ac6419637f`, eight test/support paths, no production change. The original-backend run finished normally at 23:46:14Z; there was no hang or timeout increase. Final verification ended at 23:46:25Z. No new repair family was started.

## Complete collection and accepted census

All **806 inventory paths were process-attempted**. Supervisor 25008 finished the final 400/400 at 23:27:11Z, before pending-window source edits. Collection is stopped, not awaiting another sweep. Supervisor 25008, verification driver 71705, journal driver 73406, old driver 77055, trap driver 79898 and all recorded final children/gates are absent. Receipt: `tmp/854-notes/p4/w22/pending-window-run-g/final-owned-processes.log`.

Final accepted census: **806 = 756 green + 45 red + 5 unverified**, with **zero unattempted paths**. There are 1018 retained attempt records, including historical, diagnostic, comparison and control attempts. Inventory paths and attempt records are different counts. These are cumulative accepted per-file source boundaries, not a final-source whole-package pass.

Verified case evidence has **6428 passes, 126 failures and zero skips**. The existing census's recorded pass aggregate is 6435: seven XML passes from an inconsistent runner meta-suite remain unverified and are excluded from verified passes and classification. Passing-case classifications reconcile to 6428: **145 native-history, 260 journal-selected shared/public, 27 explicit-old and 5996 classification-pending**. The separate unclassified bucket is zero. Journal selection alone is not native coverage. Earlier cluster mappings not imported into the cumulative classifier remain pending rather than being inferred.

The accepted repair replaces six latest red files with actual final journal results. Thirteen source-matching final journal files are selected; old comparison and retaining-control attempts remain outside package totals. The census runner now names that final batch explicitly and reads its exact-case map. Its acceptance test was red before this accounting change, then passed: seven tests, 59 assertions, strict types, explicit no-ignore zero-warning lint and formatting all pass. No product tests or completed product gates were rerun during finalization.

Generation: `b851a90a-c2cd-40d3-b591-5df87985232a`. Full ledger, failure table, missing evidence and publication checksums are frozen under `tmp/854-notes/p4/w22/pending-window-run-g/frozen-final/`. `W22-PENDING-WINDOW-PROOF.json` retains final source hashes, case/PID/gate evidence, classification, every unresolved path/case and missing-original boundaries. `W22-REMAINING-FAMILIES.tsv` is the exact 50-path open list.

## Pending-window proof

The shared fixture constructed a JSONL-only recorder while selecting journal history, so six suites failed constructor validation before their assertions. The fixture now selects a real recorder, seeds native primary history through streaming replacement, gates real positional writes, and independently compares committed primary, mirror and public-row digests. Native partial admission fails the tokenizer after one row; old retains its enqueue fault. The publication participant now extends real media ownership for both replacement protocols and holds a pre-publication snapshot. Paused observations use independently reopened committed rows instead of waiting on the operation being paused. No old-only pin supplies native proof.

Final matrix: **13 files per outer backend, 60 passes each, 120 total, zero failures/skips**. The six pending-window suites contribute 27 native cases in the journal run; five reused native fallback suites contribute 31, and facade removal/direct-message regression contribute two shared/public cases. The outer-old run is supplemental: the five explicitly native fallback suites still select journal internally. It is not 60 old-format cases.

The real DirectMessageProcessor additionally consumes the installed caller rows through the transport seam and preserves blocks, chronology and history. The four-case native retaining trap exits one at the unchanged ownership predicate: both 512/8192 scales and reference/copy variants reject deliberate retention. Original test-call domains, all 72 original assertions, bounds and timeouts are preserved; five assertions were added. The 440-row/8 MiB limits and oversized-row cases remain.

All ten saved source-bound gates pass: API surface, declaration build, core types, agents types, agents Bun types, touched-path types, zero-warning ESLint, Prettier, affected graph and test audit. No touched audit findings before or after. Sixteen matrix/helper hashes match the worktree and committed blobs. Affected-graph validation is not affected-shard execution. Proof uses the saved completed runs, not new successful retries.

Intermediate authoring failures remain separate: the empty fixture lacked recording metadata, the prior media participant had no native replacement protocol, and native observations needed a committed baseline. Metadata allocation, real ownership and explicit commit boundaries fix these fixture inputs. No production defect or unrelated-library repair was established in this cluster.

## Unverified evidence stays open

Four latest files lack XML and a complete summary after their recorded outer SIGTERM: `middleout-disk-{large-request,publication-owners}` and `oneshot-disk-{large-request,publication-owners}`. Counts remain unknown. The publication logs contain first-case timeouts; the large-request logs have no completed case summary. They were attempted, not skipped or unrun.

The fifth file is `test-bun/run-bun-tests.issue3253.bun.ts`, PID 62524: exit zero and XML/final outer summary say seven passes, but both existing parsers captured the earlier nested child's one-pass summary. It remains inconsistent-record-unverified. This run did not repair that separate parser family or rerun the suite.

Keep 22 historical missing attempts distinct from four latest missing files. Original profile-admission PID 98836 timed out on an unreachable JSONL disposal gate under journal and has no XML/complete summary. Later selected PID 19211 has three real passes at a different source hash after backend-specific disposal targeting. The missing original stays unverified; later success does not reconstruct it. Exact hashes and references are in the proof.

## Remaining families

These are observed grouping labels, not established shared root causes. The TSV gives exact paths, state, PID, source hash, batch and counts; the proof JSON gives exact failed cases and raw references.

| Family                                          | Red files | Unverified files |
| ----------------------------------------------- | --------: | ---------------: |
| Compression attempt cursor/estimation/lifecycle |         3 |                0 |
| Compression value lifetime/recorder             |         2 |                0 |
| Density capture/lifecycle/span accounting       |         3 |                0 |
| Effective token count                           |         1 |                0 |
| High-density fallback rollback                  |         1 |                0 |
| Middle-out request/publication                  |         5 |                2 |
| One-shot request/publication                    |         5 |                2 |
| Provider fallback/hardlimit                     |         6 |                0 |
| Strategy type contract                          |         1 |                0 |
| Conversation observations/model stamping        |         5 |                0 |
| Child ownership/transport                       |         3 |                0 |
| Retained growth and its controls                |         3 |                0 |
| Send snapshot count                             |         1 |                0 |
| Deferred acknowledgement                        |         1 |                0 |
| Semantic purge                                  |         2 |                0 |
| Stream request demand                           |         2 |                0 |
| Turn media rollback                             |         1 |                0 |
| Runner summary accounting                       |         0 |                1 |
| Total                                           |        45 |                5 |

Next work is classification and one root-caused red family, not another package collection. Provider fallback/hardlimit still has its separately recorded recorder/backend mismatch; preserve its diagnostics and source-stage compensation scope. Do not infer that other cursor, empty-block, token/owner/span, serialization or synchronous-observation failures share that cause. No bounds, retries, expectations or enforcement were relaxed.

Old default unchanged; W23-W26 and scratch removal remain open. Review skipped per Andrew 2026-10-09. No OCR, cleanup/deletion, generated obstruction move, `.llxprt/` edit/staging, raw recovery bulk staging, push or merge. Unrelated dirty memory and recovery artifacts remain untouched.
