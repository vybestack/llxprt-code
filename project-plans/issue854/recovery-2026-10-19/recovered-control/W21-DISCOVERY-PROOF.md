# W21 discovery inventory and native proofs, 2026-10-19

**Current addendum:** the ten whole-file inventory-only gaps listed at the end of this earlier run are now executed and accounted for by `W21-DISCOVERY-REMAINDER-PROOF.md` and `W21-DISCOVERY-REMAINDER-CASES.md`. The addendum verifies 102 original cases per outer setting, native counterparts, the allocation fix at `ba9c1829a` and remaining native proofs at `05c4bc046`. Earlier execution tables below retain their original scope. W21's owned named contract queue is DONE, without a full-package claim; `W21-REMAINING-CONTRACTS.md` states the current boundary.

The named discovery cluster now has native behavioral and fault proofs. The original 306-candidate list is not a current native-port queue. This pass inventories actual production branches and their test callers, preserves format-specific regressions, and supplies missing native contracts. It does not claim a full-package, affected-shard execution or monorepo result. W22, W23 and W24 remain separate.

Starting production revision was `88dd7f8f00ab3c7e1c6e005673ff001ea25c3aa3`. The four already-staged exact-replay proof documents were committed first at `dbb6b27d8`, after checking status, staged diff, recent history and the absent index lock. No existing lock was deleted. Other recovery artifacts and `.llxprt/` were left untouched.

## Production causes

[#3901](https://github.com/vybestack/llxprt-code/issues/3901), fixed at `0981cc19d`: native start-fact decoding converted arbitrary workspace values with `String`, accepted empty required strings and silently omitted malformed optional paths. Session identity accepted an empty string, and malformed names used the title diagnostic. The unchanged-production input suite recorded nine passes and ten failures. The fix validates the external start value with the project's existing Zod dependency, rejects empty identity, and reports the actual nullable-string key. Unknown provider and empty model remain valid. Unicode workspace paths and the difference between immutable start directories and current directories are preserved.

[#3902](https://github.com/vybestack/llxprt-code/issues/3902), fixed at `9f176b7ab16cb0bd067c290f4fee7dd08b02dfb3`: native summary reading isolated per-file errors, but the subsequent checkpoint read escaped the directory loop. A real second-open positional read failure aborted healthy siblings. The unchanged-production fault suite recorded nine passes and one failure at that read. The fix isolates the external checkpoint read per session, records its identity/path/reason, excludes that failed target, and continues. A small native-target helper keeps the existing function-size rule; sessions still precede checkpoints. This catch is at the external file-read boundary, not a wrapper around history mutations.

No production row materialization, temporary operation file, repeated whole-journal pass or default change is introduced. Native discovery still reads the header, trailer, bounded roots and selected state entries; count comes from the trailer aggregate.

## Actual branch map

Paths in this table are relative to `packages/core/src/recording/` unless otherwise stated. `final-inventory.json` in the evidence root contains file hashes, source line references, AST test-title inventories and backend markers. `extension-matchers.txt` records the actual extension consumers, including exceptions; it is not a one-regex claim.

| Production boundary | Retained regression and native executed proof |
| --- | --- |
| `SessionDiscovery.listSessions`, detailed listing, project filter, child exclusion, mtime/id sorting, missing directory | `SessionDiscovery.test.ts`, `SessionDiscovery.unreadable.test.ts`, native contracts, native inputs, `journalSessionListing.test.ts`. Native ties, numeric identity, distinct project and newer subagent are explicit. |
| `boundedSessionScan` version/sequence/header/name/checkpoint metadata folding | `sessionDiscovery.p05d.test.ts`, `metadata-budget.test.ts`, `sessionMetadata.test.ts`. These remain explicitly old. Native equivalent uses final state facts, aggregate count and live checkpoint descriptors in native contracts/bounds and `sessionDiscovery.journalScans.test.ts`; JSONL sequences, malformed-line tolerance and versions 1/2 are not binary-format contracts. |
| Public detailed/bounded/simple continue-target entry points and checkpoint read isolation | Native contracts/faults, `sessionDiscovery.journalScans.test.ts`, checkpoint service/factory suites. Healthy targets remain beside unreadable files; second-read failure produces exact diagnostics rather than aborting the directory. |
| Exact identity, index, prefix, latest, session name, checkpoint name/id, ambiguity and invalid name resolution | Original discovery/P05d/metadata suites plus native contracts and `journalResume.test.ts`. Numeric session identity takes precedence over numeric index; session ordering excludes children before index assignment. |
| `unreadableRecordings` matching, formatting and no-readable-session diagnostics | Original unreadable suite plus native faults. Full path, basename, validated identity prefix, unknown identity, empty/numeric/unrelated reference and ambiguity branches are explicit. Exact retired JSONL text is asserted independently as a literal sentence. |
| `readSessionHeader`, start/facts shape and mutable metadata | Native inputs/contracts/faults and `sessionDiscovery.journalScans.test.ts`. Required/optional fields, malformed arrays and scalar values, title/name null/absent/string, current provider/directories versus original start, project and session identity are checked. |
| `hasContentEvents`, preview and metadata-title helpers | Original extensions suite plus native extensions/bounds, `sessionDiscovery.journal.test.ts` and `sessionMetaKeys.preview.test.ts`. Native uses current row count and persisted first nonempty human text preview; assistant/media-only rows do not supply a preview. Mixed text, Unicode, 119/120/121/500-character requests, zero-length request, absent/damaged/empty files and directory I/O are exercised. |
| Native public resume, lock acquisition/release, healthy sibling selection and continuation identity | Native faults, `journalResume.test.ts`, native integration replay and `journalResumeAdoption.bound.test.ts`. Actual rows, file path, owned lock, provider/start/workspace facts and subsequent adoption remain native. No rows are recovered from an older committed version under an intact damaged latest trailer. |
| Checkpoint/fork identity, namespace, deletion/rename/overwrite and source/child ownership | `journalCheckpointService.test.ts`, `checkpointServiceFactory.test.ts`, `journalFork.test.ts`, `session-fork-offset-audit.test.ts`, `session-fork-late-ownership.test.ts`. Original checkpoint/fork integration suites remain explicitly old. Native source and child files/locks are not extra session/checkpoint targets. |
| Session cleanup listing and live-lock disposition | `sessionCleanupUtils.test.ts`, `sessionCleanupUtils.journal.test.ts`, native contracts and `sessionFileExtension.test.ts`. Native cleanup lists `.llxj`, including children, but leaves retired `.jsonl` out of the deletion helper. Live locks yield skip, not extra discovered recordings. |
| Global janitor raw/archive matchers, grouping, current identity, protection and bounded candidate scan | `janitor/sessionScanner.test.ts`, `janitor/sessionScanner.bounds.test.ts`, `janitor/journalJanitor.test.ts`, native contracts. `.llxj` and `.llxj.gz` are recognized; retired raw/archive files are separately accounted for and protected when unreadable. File/aggregate-byte caps and symlink/project-directory rejection are exercised with native fixtures. |

The eleven newly pinned legacy files are AST-identical to the starting revision after removing only the backend pin import and call. `legacy-ast-proof.json` records each comparison. No assertions, generator bounds, iteration counts or tests were removed or skipped.

## Extension consumer inventory

`sessionFileName.ts` writes `.llxj`. `sessionFileExtension.ts` provides active/retired/archive decisions. `SessionLockManager.getLockPathFromFilePath` uses the selected extension; the extension suite tests both settings. Native summary/header listing dispatches through `journalSessionListing.ts`; the JSONL filter still inside `SessionDiscovery.ts` belongs exclusively to its old branch.

`sessionCleanupUtils.ts` uses the selected active extension and native header reader. Global janitor `sessionScanner.ts` separately handles active raw files, archives and retired raw/archive files. `sessionGrouping.ts` removes only `.gz`, so a native raw/archive pair shares the `.llxj` basename. `sessionHeaderReader.ts` dispatches by native suffix. `mediaReclamation.ts` recognizes native raw/archive names independently of the selected backend; its native behavior is exercised by the existing journal janitor media cases in this run.

`archiveCompressor.ts` temporary archive grammar ends in `.gz.tmp`, rather than requiring JSONL. `sessionJanitor.ts` also has a deliberately JSONL-specific UUID `.portable.tmp` grammar. That producer writes the portable JSONL transfer representation; it is not the native recorder or fork filename. This pass does not rename that grammar to `.llxj` or claim it as native deletion proof. Existing janitor safety, portable-package and compressor test families outside the executed matrix are inventory-only here.

## Native corruption and bounded-read proofs

The fault suite tests empty/damaged siblings, retired JSONL siblings, current-format headers cut at 8, 12 and 63 bytes, row/state root frame CRC damage, root body CRC damage, and a CRC-valid frame declaring a body past the physical file end. The latest trailer remains intact for the root cases, and older saved rows/checkpoints exist. Listing excludes the damaged file, explicit resume rejects, no lock leaks, and the bytes remain unchanged. A separate corrupt ROW body may still have readable metadata; public resumed streaming rejects that row instead of silently returning older history.

The native bounds suite creates 40-row and 4,000-row files with an 8 MiB first body and records a small preview/name/checkpoint. It instruments the real positional-reader infrastructure. Each of five operations has positive read activity, total reads below 512 KiB and a largest request no greater than 64 KiB: continue targets, header, content eligibility, preview and title. Per-operation figures and file sizes are retained in each fixture's `read-stats.json`. A deliberate eager-row-read control must exceed the same budget and fail. No measurement threshold is weakened.

## Failures and preservation

Fixture failures remain distinct from production RED: checkpoint fixtures initially had no conversation rows; the extensions fixture flushed the recorder before admitted history/fanout settled; and readonly `it.each` input typing needed a fresh array. The corrected fixtures use real rows and the public turn-boundary flush. Initial type/lint failures remain preserved. The checkpoint helper extraction and table-driven helper-read assertions satisfy existing function-size, nesting and conditional-assertion rules without changing policy.

Generated test-utils declarations obstructed Bun module loading. Only each exact individually verified ignored, untracked, nonsymlink `packages/test-utils/dist` directory was moved intact to a unique held path. Move records retain original path, destination and unchanged inode. Nothing was deleted. Final declaration outputs are left intact after tests.

Raw new evidence is under `tmp/854-notes/p4/w21/discovery/run-20261019-a/`, with unique retained fixtures under the sibling `fixtures/`. Historical deleted logs are still missing. No cleanup command, `.llxprt/` edit, broad recovery staging, pattern kill, weakened check, OCR, push or merge is part of this increment. Review skipped per Andrew 2026-10-09.

## Scope limits

The current related-test inventory contains 34 files selected by actual discovery/checkpoint/scanner callers, not the earlier 306-path count. Not every caller is a missing native port. The executed matrix also includes directly relevant resume, extension, preview, fork, checkpoint and ownership proofs that are not selected by that textual caller query. Inventory-only related files include broader integration/recorder/front-door suites, the JSONL first-user scanner and janitor safety; their discovery branches are covered at the named public boundaries above, but their entire test files were not executed here.

This closes the bounded discovery cluster's stated native contracts and fault obligations. It does not establish cumulative W21 full-package closure. W21's prior service/replay/caller increments retain their documented scopes. W22 agents-wide parity, W23 send/planning-envelope and transport expansion, W24 whole-product/write-amplification/topology measurement, W25 default/deletion work, W26 and later phases remain separate. No default flip is authorized by this proof.

## Confirmed execution tables

Final matrix: **66 serial isolated processes, 710 passes, zero failures/skips across 33 files**. The five new native suites contribute 92 executions; 618 are reused regressions. All 1854 captured core TypeScript source hashes match the final worktree. The exact commands, logs and source census are in confirmed-tests/matrix.json and source-hashes.json. Each file runs alone from packages/core, with LLXPRT_HISTORY_BACKEND set to the named outer setting. Native suites select native internally; explicitly old fixtures remain old under both settings.

| File | old pass / PID | journal pass / PID |
| --- | --- | --- |
| src/recording/session-discovery-native-inputs.test.ts | 19 / 31273 | 19 / 31761 |
| src/recording/session-discovery-native-contracts.test.ts | 5 / 31283 | 5 / 31768 |
| src/recording/session-discovery-native-faults.test.ts | 13 / 31284 | 13 / 31777 |
| src/recording/session-discovery-native-bounds.test.ts | 2 / 31290 | 2 / 31779 |
| src/recording/session-discovery-native-extensions.test.ts | 7 / 31308 | 7 / 31793 |
| src/recording/SessionDiscovery.test.ts | 23 / 31326 | 23 / 31803 |
| src/recording/SessionDiscovery.unreadable.test.ts | 12 / 31469 | 12 / 31930 |
| src/recording/__tests__/SessionDiscovery.extensions.spec.ts | 32 / 31472 | 32 / 31934 |
| src/recording/sessionDiscovery.p05d.test.ts | 13 / 31480 | 13 / 31937 |
| src/recording/metadata-budget.test.ts | 5 / 31488 | 5 / 31938 |
| src/recording/subagentDiscoveryFilter.p05c.test.ts | 6 / 31502 | 6 / 31945 |
| src/recording/sessionCleanupUtils.test.ts | 28 / 31504 | 28 / 31948 |
| src/recording/sessionMetadata.test.ts | 16 / 31513 | 16 / 31951 |
| src/recording/sessionManagement.test.ts | 25 / 31516 | 25 / 31959 |
| src/recording/janitor/sessionScanner.test.ts | 17 / 31658 | 17 / 32097 |
| src/recording/janitor/sessionScanner.bounds.test.ts | 3 / 31664 | 3 / 32100 |
| src/recording/checkpointLifecycle.integration.test.ts | 13 / 31667 | 13 / 32103 |
| src/recording/sessionForking.integration.test.ts | 10 / 31670 | 10 / 32111 |
| src/recording/journalCheckpointService.test.ts | 17 / 31673 | 17 / 32122 |
| src/recording/checkpointServiceFactory.test.ts | 14 / 31680 | 14 / 32127 |
| src/recording/journalFork.test.ts | 4 / 31701 | 4 / 32142 |
| src/recording/session-fork-offset-audit.test.ts | 1 / 31702 | 1 / 32153 |
| src/recording/session-fork-late-ownership.test.ts | 1 / 31706 | 1 / 32164 |
| src/recording/sessionFileExtension.test.ts | 3 / 31713 | 3 / 32170 |
| src/recording/journalSessionListing.test.ts | 4 / 31716 | 4 / 32174 |
| src/recording/sessionDiscovery.journalScans.test.ts | 4 / 31718 | 4 / 32182 |
| src/recording/sessionDiscovery.journal.test.ts | 6 / 31723 | 6 / 32188 |
| src/recording/journalResume.test.ts | 12 / 31726 | 12 / 32196 |
| src/recording/sessionCleanupUtils.journal.test.ts | 3 / 31735 | 3 / 32203 |
| src/recording/janitor/journalJanitor.test.ts | 10 / 31739 | 10 / 32206 |
| src/recording/sessionMetaKeys.preview.test.ts | 4 / 31742 | 4 / 32216 |
| src/recording/recording-integration-native-replay.test.ts | 8 / 31745 | 8 / 32219 |
| src/recording/journalResumeAdoption.bound.test.ts | 15 / 31757 | 15 / 32233 |

| Gate | PID | Exit |
| --- | --- | --- |
| build-types | 32904 | 0 |
| core-tsc | 34046 | 0 |
| core-runner-tsc | 34171 | 0 |
| touched-tsc | 34176 | 0 |
| eslint | 34241 | 0 |
| prettier | 34312 | 0 |
| affected-graph | 34318 | 0 |
| audit | 34378 | 0 |

Affected-graph validation is not affected-shard execution. Audit has 0 touched high-risk findings and 1 total touched notices; the scanner policy is unchanged. Exact findings, controls, source checks and PID observations are retained in summary.json.

| Rejecting control, full native test file | PID | Pass | Fail | Exit |
| --- | --- | --- | --- | --- |
| malformed-fact-admission | 32725 | 9 | 10 | 1 |
| checkpoint-read-escape | 32736 | 12 | 1 | 1 |
| eager-history-read | 32740 | 0 | 2 | 1 |
| fallback-under-intact-trailer | 32777 | 7 | 6 | 1 |

Every control restored byte-identically. The eager-row-read control fails the same bounded-byte assertions; the intact-trailer control fails all six latest-root corruption cases. Source hashes are checked after restoring controls.

| Rows / file bytes | Operation | Bytes read | Largest request |
| --- | --- | --- | --- |
| 4000 / 14199035 | continue-targets | 167111 | 65536 |
| 4000 / 14199035 | header | 83106 | 65536 |
| 4000 / 14199035 | has-content | 83106 | 65536 |
| 4000 / 14199035 | preview | 83106 | 65536 |
| 4000 / 14199035 | title | 83106 | 65536 |
| 40 / 8454864 | continue-targets | 159718 | 65536 |
| 40 / 8454864 | header | 79410 | 65536 |
| 40 / 8454864 | has-content | 79410 | 65536 |
| 40 / 8454864 | preview | 79410 | 65536 |
| 40 / 8454864 | title | 79410 | 65536 |
| 40 / 8454864 | continue-targets | 159718 | 65536 |
| 40 / 8454864 | header | 79410 | 65536 |
| 40 / 8454864 | has-content | 79410 | 65536 |
| 40 / 8454864 | preview | 79410 | 65536 |
| 40 / 8454864 | title | 79410 | 65536 |
| 4000 / 14199035 | continue-targets | 167111 | 65536 |
| 4000 / 14199035 | header | 83106 | 65536 |
| 4000 / 14199035 | has-content | 83106 | 65536 |
| 4000 / 14199035 | preview | 83106 | 65536 |
| 4000 / 14199035 | title | 83106 | 65536 |

The 239 distinct recorded process IDs are checked in summary.json; 0 remain present. Managed supervisors are checked separately by the task tool. These are new run artifacts, not recovered historical proof.

## Related files not executed in the earlier cluster

This table records the earlier run's gaps. All ten have since run, with exact native accounting in `W21-DISCOVERY-REMAINDER-CASES.md`; none remains a current whole-file execution gap in the owned ten-file set.

These were explicit whole-file execution gaps, not silently counted native proof. Recording/integration and transition consumers have their public discovery branches covered by the executed native discovery/resume/checkpoint proofs; their other behavior belongs to the earlier service/recording increments or remains outside this bounded run. The JSONL first-message scanner is an old-format implementation. Janitor safety is broader than the native filename/header/listing branch proved here.

| Related file | Declared case sites in inventory | Classification |
| --- | --- | --- |
| src/recording/integration-advanced-addendum.test.ts | 9 | Broader recorder/integration/transition consumer, inventory only at whole-file scope |
| src/recording/SessionTransitionService.frontDoor.test.ts | 3 | Broader recorder/integration/transition consumer, inventory only at whole-file scope |
| src/recording/recorderConsumers.port.test.ts | 1 | Broader recorder/integration/transition consumer, inventory only at whole-file scope |
| src/recording/firstUserMessageScan.test.ts | 11 | JSONL streaming implementation, no native port needed; native preview helper has executed proof |
| src/recording/recordingMetadata.integration.test.ts | 29 | Broader recorder/integration/transition consumer, inventory only at whole-file scope |
| src/recording/journalRecordingService.test.ts | 13 | Broader recorder/integration/transition consumer, inventory only at whole-file scope |
| src/recording/integration.advanced.test.ts | 0 | Broader recorder/integration/transition consumer, inventory only at whole-file scope |
| src/recording/integration.basic.test.ts | 16 | Broader recorder/integration/transition consumer, inventory only at whole-file scope |
| src/recording/recording-instance-path-isolation.test.ts | 3 | Broader recorder/integration/transition consumer, inventory only at whole-file scope |
| src/recording/janitor/sessionJanitor.safety.test.ts | 6 | Broader cleanup safety, inventory only in this run |

A declaration-site count is not an expanded runtime case count. Generated suites and imported helpers can add cases. Unmodified JSONL lazy/property/regular lock suites are also outside this matrix; the executed extension, native resume/fork and live-lock cases prove the selected native extension/ownership contract without reclassifying those old fixtures. The unaffected CLI picker/bootstrap, provider, zed and a2a suites are not included in this core discovery matrix.
