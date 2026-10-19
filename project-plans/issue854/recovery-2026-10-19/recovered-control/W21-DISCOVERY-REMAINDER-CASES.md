# W21 ten-file discovery remainder case map

The pre-edit AST inventory is retained at `initial-case-map.json` and `.md` under `tmp/854-notes/p4/w21/discovery-remainder/run-20261019-HGigU4/`. This final map replaces provisional references there with exact executed native case locations. All 102 original runtime cases remain: `integration.advanced.test.ts` has eleven curried `itProp` cases, despite the earlier zero plain-`it` declaration count. Its generators, domains and iteration counts are unchanged. The ten files run as twenty serial isolated processes, 204 passes, no failures/skips.

Seven JSONL files receive only an explicit old backend import/pin. AST comparison removes only those two statements and proves equality to `6ed0dfbe2`. Two files are already native and one explicitly tests both backend front doors; those three remain byte-identical. An outer journal environment never turns a pinned JSONL test into native proof.

## Exact original cases and native counterparts

Each proof ID resolves below to a native case and both current run PIDs. SELF means the original case itself runs native; SELF-NATIVE names an existing native recorder case. TYPE-ONLY and LOCAL-ONLY are examples of local values and are not counted as production behavior proof. JSONL event-line/seq/version/warning assertions remain explicitly old; linked native proofs establish the corresponding public membership, identity, refusal and durability contracts, not binary line skipping.

### integration-advanced-addendum.test.ts

| Original line | Exact case title                                                       | Native proof |
| ------------: | ---------------------------------------------------------------------- | ------------ |
|            49 | '24: flush persists all committed content events'                      | CORE TOOL    |
|           104 | '25: only committed content survives cancellation flush'               | U            |
|           156 | '26: cancel mid-tool → resume loads partial turn, can append'          | U REPLAY     |
|           207 | '27: truncated last line → replay succeeds, new events append cleanly' | RC Z         |
|           260 | '28: concurrent resume fails while lock is held'                       | RL RN        |
|           308 | '29: both paths produce structurally identical JSONL'                  | CORE RANDOM  |
|           373 | 'addendum: truncated last line is silently discarded'                  | RC Z         |
|           405 | 'addendum: mid-file garbage line is skipped with warning'              | Z E          |
|           467 | 'addendum: only .jsonl files discovered, .json ignored'                | D X          |

### SessionTransitionService.frontDoor.test.ts

| Original line | Exact case title                                                                            | Native proof |
| ------------: | ------------------------------------------------------------------------------------------- | ------------ |
|            54 | 'on the journal backend returns a journal recorder and a boot that streams the cloned rows' | SELF         |
|            83 | 'on the journal backend leaves no child file and no lock when the checkpoint is not live'   | SELF         |
|           122 | 'on the old backend returns the JSONL recorder and a cursor boot'                           | FF FK        |

### recorderConsumers.port.test.ts

| Original line | Exact case title                                                               | Native proof |
| ------------: | ------------------------------------------------------------------------------ | ------------ |
|            42 | 'RecordingIntegration hands back the recorder it was given, typed as the port' | SELF         |

### firstUserMessageScan.test.ts

| Original line | Exact case title                                               | Native proof |
| ------------: | -------------------------------------------------------------- | ------------ |
|           102 | 'stops reading at the first user message of a large journal'   | P B          |
|           117 | 'reads proportionally to the position of the first user row'   | P B          |
|           135 | 'skips a record over the record cap without buffering it'      | P B          |
|           147 | 'keeps only the capped title of a large first message'         | PL B         |
|           158 | 'decodes multi-byte text split across chunk boundaries'        | P            |
|           173 | 'cuts a multi-byte title at the character cap'                 | PL           |
|           183 | 'returns null for empty, header-only and torn journals'        | PE Z         |
|           196 | 'skips damaged lines and still finds the first valid user row' | Z E          |
|           209 | 'accepts an unterminated final row that is complete JSON'      | P            |
|           217 | 'returns null for a missing file'                              | PE           |
|           221 | 'never lists child sessions, so their titles are not scanned'  | D P          |

### recordingMetadata.integration.test.ts

| Original line | Exact case title                                                                       | Native proof      |
| ------------: | -------------------------------------------------------------------------------------- | ----------------- |
|           134 | 'writes a checkpoint_created event with a stable checkpointId and name'                | K0 C              |
|           156 | 'preserves the checkpoint event timestamp in replay metadata'                          | K0                |
|           167 | 'returns each concurrently created checkpoint event sequence'                          | K0                |
|           192 | 'rejects checkpoint creation on an empty/unmaterialized conversation'                  | SELF-NATIVE-EMPTY |
|           201 | 'materializes an unstarted recording when naming the session'                          | K1                |
|           213 | 'rejects rename and delete on an unmaterialized recording'                             | K2                |
|           225 | 'rejects checkpoint creation on an inactive recorder'                                  | K2                |
|           237 | 'appends a checkpoint_deleted event by checkpointId'                                   | CD                |
|           254 | 'appends a session_named event with the name and null clears it'                       | K1                |
|           273 | 'replays only events up to and including the checkpoint sequence'                      | FK FF             |
|           296 | 'skips a malformed line while replaying through a later checkpoint'                    | Z E               |
|           321 | 'metadata events never appear in replayed history'                                     | REPLAY            |
|           340 | 'skips events without valid sequence numbers during bounded replay'                    | Z K3              |
|           367 | 'does not treat an unsafe sequence as a completed bounded replay'                      | Z K3              |
|           395 | 'keeps the maximum sequence and marks [1,5,3] recordings corrupt'                      | Z                 |
|           425 | 'folds create/delete/rename by stable checkpointId'                                    | C                 |
|           442 | 'marks deleted checkpoints and excludes them from live view'                           | CD FD             |
|           455 | 'warns when lifecycle metadata references an unknown checkpoint'                       | CU K3             |
|           482 | 'warns when lifecycle metadata targets a deleted checkpoint'                           | CU FD             |
|           517 | 'warns and skips a checkpoint creation event without a name'                           | K3                |
|           544 | 'warns and skips a checkpoint rename event without a usable name'                      | K3                |
|           571 | 'does not revive a tombstoned checkpoint when a duplicate create event is encountered' | CD FD             |
|           608 | 'records ancestry metadata when a fork is seeded'                                      | FK                |
|           649 | 'rejects fork ancestry with an unsafe parent sequence'                                 | Z                 |
|           682 | 'exposes folded checkpoints and session name from ReplayResult'                        | REPLAY K0         |
|           703 | 'is a readonly record with the expected shape'                                         | TYPE-ONLY         |
|           719 | 'lists and resolves named sessions and checkpoints without changing titles'            | D N               |
|           753 | 'rejects reserved and project-duplicate names'                                         | N CC              |
|           774 | 'creates a fresh active recorder with a full-session-ID lock released by disposal'     | SELF-NATIVE-LOCK  |

### journalRecordingService.test.ts

| Original line | Exact case title                                                                                    | Native proof |
| ------------: | --------------------------------------------------------------------------------------------------- | ------------ |
|            68 | 'creates no file until something needs it'                                                          | SELF         |
|            79 | 'creates the file on first use with the start facts and the provider in effect then'                | SELF         |
|           115 | 'writes each fact as its own acked group, in the order asked'                                       | SELF         |
|           160 | 'keeps an explicitly untitled session distinct from one never titled'                               | SELF         |
|           172 | 'rejects an empty session name and writes nothing for it'                                           | SELF         |
|           180 | 'keeps session facts when the rows are popped'                                                      | SELF         |
|           196 | 'creates a checkpoint of the version it was asked on, and renames it'                               | SELF         |
|           227 | 'deletes a checkpoint: the entry is gone, the version it kept is released, a second delete refuses' | SELF         |
|           258 | 'reopens a file with its facts, and refuses another session'                                        | SELF         |
|           286 | 'reports a failed write once at flush, then stops being active'                                     | SELF         |
|           306 | 'leaves no partial file when creating the journal fails'                                            | SELF         |
|           326 | 'holds the session lock until disposed'                                                             | SELF         |
|           341 | 'closes the file on dispose and ignores later facts'                                                | SELF         |

### integration.advanced.test.ts

| Original line | Exact case title                                                            | Native proof |
| ------------: | --------------------------------------------------------------------------- | ------------ |
|            64 | '17: (property) any content sequence roundtrips through record → replay'    | RANDOM GEN   |
|           101 | '18: (property) resume preserves original history length for N turns'       | REPLAY GEN   |
|           130 | '19: (property) seq numbers monotonic after N resumes'                      | GEN          |
|           174 | '20: (property) discovery returns sessions sorted newest-first'             | D            |
|           210 | '21: (property) compression with N pre + M post → replay has 1+M items'     | GCOMP COMP   |
|           246 | '22: (property) N provider switches → last switch is reflected in metadata' | GEN META     |
|           279 | '23: (property) N non-content events → no file until first content'         | IDLE EVENTS  |
|           322 | 'P1: (property) rewind N from M items → max(0, M-N) remain'                 | MUT COMP     |
|           354 | 'P2: (property) record N + resume + record M → replay has N+M items'        | GEN REPLAY   |
|           396 | 'P3: (property) delete removes file for session with N content items'       | CLEAN X      |
|           429 | 'P4: (property) session ID preserved through record → replay'               | GEN REPLAY   |

### integration.basic.test.ts

| Original line | Exact case title                                                             | Native proof |
| ------------: | ---------------------------------------------------------------------------- | ------------ |
|           204 | '1: records 3 turns (6 content) → replays 6 IContent items'                  | CORE RANDOM  |
|           233 | '2: record 3 turns, resume, record 2 more → replay has 10 items'             | GEN REPLAY   |
|           284 | '3: seq numbers are monotonic across resume boundary'                        | GEN          |
|           318 | '4: record, compress, record more → replay shows summary + post-compression' | COMP GCOMP   |
|           369 | '5: record 5, rewind 2 → replay shows 3'                                     | MUT          |
|           396 | '6: provider switch → replay metadata updated'                               | META F       |
|           424 | '7: directories changed → replay metadata has new dirs'                      | META F       |
|           460 | '8: no content events → no file on disk'                                     | IDLE EVENTS  |
|           479 | '9: 3 recorded sessions → discovery finds 3'                                 | D            |
|           507 | '10: CONTINUE_LATEST resumes the most recent session'                        | RN           |
|           540 | '11: resume specific session by ID → correct one'                            | RP REPLAY    |
|           566 | '12: delete session removes the file'                                        | CLEAN X      |
|           586 | '13: lock prevents concurrent resume of same session'                        | RL           |
|           613 | '14: getContinueSessionRef returns string session ref'                       | LOCAL-ONLY   |
|           627 | '15: bare --continue (true) → getContinueSessionRef returns CONTINUE_LATEST' | LOCAL-ONLY   |
|           638 | '16: isContinueSession returns true for string value'                        | LOCAL-ONLY   |

### recording-instance-path-isolation.test.ts

| Original line | Exact case title                                                                                                 | Native proof |
| ------------: | ---------------------------------------------------------------------------------------------------------------- | ------------ |
|            79 | 'keeps simultaneous same-label journals independent through disposal, surviving append and original-path resume' | I0           |
|           147 | 'rejects exclusive allocation collisions without touching an existing journal'                                   | I1           |
|           168 | 'releases a failed empty reservation so the next write can publish'                                              | I1           |

### janitor/sessionJanitor.safety.test.ts

| Original line | Exact case title                                                                        | Native proof |
| ------------: | --------------------------------------------------------------------------------------- | ------------ |
|           123 | 'does not rmdir the global temp root after cleanup'                                     | J0           |
|           152 | 'does not write into or follow a symlinked archive directory during sweep'              | J1           |
|           201 | 'retains data when a session file is replaced with a symlink between scan and mutation' | J2           |
|           246 | 'does not remove non-session temp files during cleanup'                                 | J3           |
|           293 | 'retains a replaced regular file (same session ID) between scan and mutation'           | J4 JAN J6    |
|           361 | 'counts non-benign rmdir failures in the failed counter'                                | J5           |

SELF-NATIVE-EMPTY: `journalRecordingService.test.ts`, "creates a checkpoint of the version it was asked on, and renames it", includes both unmaterialized and materialized-empty refusal. SELF-NATIVE-LOCK: the same file, "holds the session lock until disposed". These are in the final run. Every SELF native recorder case has its exact original title in the table; core/touched tsc also checks the never-called consumer acceptance function. TYPE-ONLY is the old `CheckpointMetadataView` literal, with the native descriptor types checked by tsc. LOCAL-ONLY cases 14–16 in `integration.basic.test.ts` test local boolean/string examples, not Config; actual native reference resolution is D/RP/RN.

## Executed native proof index

Paths are relative to `packages/core/`; run references are under the evidence root’s `settled-tests/`.

| ID     | File:line and case fragment                                                                                                                      | Old / journal pass count and PID |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| D      | src/recording/session-discovery-native-contracts.test.ts:32, filters project and child sessions before sorting                                   | 5 / 84931; 5 / 85919             |
| N      | src/recording/session-discovery-native-contracts.test.ts:137, validates available names and coordinates                                          | 5 / 84931; 5 / 85919             |
| F      | src/recording/session-discovery-native-contracts.test.ts:195, keeps latest provider, directories, title and name facts                           | 5 / 84931; 5 / 85919             |
| X      | src/recording/session-discovery-native-contracts.test.ts:259, counts locked native sessions once                                                 | 5 / 84931; 5 / 85919             |
| B      | src/recording/session-discovery-native-bounds.test.ts:23, rows with a multi-MiB body under the metadata byte budget                              | 2 / 85050; 2 / 85955             |
| P      | src/recording/session-discovery-native-extensions.test.ts:50, selects the first nonempty human text                                              | 7 / 85159; 7 / 85970             |
| PL     | src/recording/session-discovery-native-extensions.test.ts:87, preserves the 120-character preview boundary                                       | 7 / 85159; 7 / 85970             |
| PE     | src/recording/session-discovery-native-extensions.test.ts:111, returns empty or unreadable results                                               | 7 / 85159; 7 / 85970             |
| Z      | src/recording/session-discovery-native-faults.test.ts:159, never an older committed version                                                      | 13 / 85021; 13 / 85931           |
| E      | src/recording/session-discovery-native-faults.test.ts:282, checkpoint metadata read fails after a successful summary read                        | 13 / 85021; 13 / 85931           |
| RN     | src/recording/journalResume.test.ts:82, resumes the newest session with its facts and its rows                                                   | 12 / 85180; 12 / 85989           |
| RP     | src/recording/journalResume.test.ts:124, resolves a session by id prefix and by list index                                                       | 12 / 85180; 12 / 85989           |
| RL     | src/recording/journalResume.test.ts:247, skips a session another process holds                                                                   | 12 / 85180; 12 / 85989           |
| RC     | src/recording/journalResume.test.ts:298, opens to the previous version when the last group was cut short                                         | 12 / 85180; 12 / 85989           |
| C      | src/recording/journalCheckpointService.test.ts:72, rename preserves ID and sequence                                                              | 17 / 85207; 17 / 86011           |
| CD     | src/recording/journalCheckpointService.test.ts:96, delete removes only the reference                                                             | 17 / 85207; 17 / 86011           |
| CU     | src/recording/journalCheckpointService.test.ts:365, refuses to rename or delete a checkpoint that is not live                                    | 17 / 85207; 17 / 86011           |
| CC     | src/recording/journalCheckpointService.test.ts:130, rejects a second concurrent creator                                                          | 17 / 85207; 17 / 86011           |
| CK     | src/recording/journalCheckpointService.test.ts:464, releases its lock and becomes inactive                                                       | 17 / 85207; 17 / 86011           |
| FK     | src/recording/journalFork.test.ts:64, clones the saved version into a child file                                                                 | 4 / 85197; 4 / 86005             |
| FD     | src/recording/journalFork.test.ts:153, refuses a deleted checkpoint and leaves no child file or lock                                             | 4 / 85197; 4 / 86005             |
| FF     | src/recording/SessionTransitionService.frontDoor.test.ts:54, on the journal backend returns a journal recorder                                   | 3 / 84383; 3 / 85717             |
| CORE   | src/recording/recording-integration-native-core.test.ts:37, records a single service addition exactly once                                       | 19 / 85289; 19 / 86051           |
| TOOL   | src/recording/recording-integration-native-core.test.ts:86, blocks on disk                                                                       | 19 / 85289; 19 / 86051           |
| COMP   | src/recording/recording-integration-native-core.test.ts:128, persists the summary replacing all seven original rows                              | 19 / 85289; 19 / 86051           |
| NOOP   | src/recording/recording-integration-native-core.test.ts:169, records after sequential no-op compression cycles                                   | 19 / 85289; 19 / 86051           |
| REPLAY | src/recording/recording-integration-native-replay.test.ts:101, with session identity, name, facts and checkpoint intact                          | 8 / 85335; 8 / 86094             |
| RANDOM | src/recording/recording-integration-native-replay.test.ts:55, preserves arbitrary row count, order and complete random text                      | 8 / 85335; 8 / 86094             |
| META   | src/recording/recording-integration-native-lifecycle.test.ts:135, persists provider and directory switches made before and after materialization | 14 / 85312; 14 / 86075           |
| IDLE   | src/recording/recording-integration-native-lifecycle.test.ts:204, keeps an idle attached recorder unmaterialized                                 | 14 / 85312; 14 / 86075           |
| EVENTS | src/recording/recording-integration-native-lifecycle.test.ts:176, keeps operational events out of the native session journal                     | 14 / 85312; 14 / 86075           |
| GEN    | src/recording/recording-exact-generated-replay.test.ts:66, preserves generated metadata and flush segments through two resumes                   | 30 / 85459; 30 / 86141           |
| GCOMP  | src/recording/recording-exact-generated-replay.test.ts:120, replaces generated pre-resume membership with summary and post rows                  | 30 / 85459; 30 / 86141           |
| MUT    | src/recording/recording-integration-native-boundary.test.ts:105, holds the ${operation} turn boundary and FIFO additions                         | 14 / 85639; 14 / 86257           |
| OWN    | src/recording/recording-integration-native-ownership.test.ts:30, aggregates write, file close and lock release failures                          | 2 / 85381; 2 / 86121             |
| MEDIA  | src/recording/recording-exact-media-replay.test.ts:122, verifies real referenced bytes without a replay reservation                              | 5 / 85599; 5 / 86220             |
| CLEAN  | src/recording/journal-recording-metadata-contracts.test.ts:155, refuses a live lock and checkpoints before deleting only the selected file       | 10 / 84842; 10 / 85877           |
| CLIST  | src/recording/sessionCleanupUtils.journal.test.ts:17, lists journal files with their session id                                                  | 3 / 85632; 3 / 86248             |
| JAN    | src/recording/janitor/journalJanitor.test.ts:175, keeps the blobs a journal row names                                                            | 10 / 85272; 10 / 86041           |
| K0     | src/recording/journal-recording-metadata-contracts.test.ts:28, returns distinct saved sequences for concurrent checkpoints                       | 10 / 84842; 10 / 85877           |
| K1     | src/recording/journal-recording-metadata-contracts.test.ts:90, materializes a name before rows                                                   | 10 / 84842; 10 / 85877           |
| K2     | src/recording/journal-recording-metadata-contracts.test.ts:118, refuses missing and inactive checkpoint operations                               | 10 / 84842; 10 / 85877           |
| K3     | src/recording/journal-recording-metadata-contracts.test.ts:262, reports malformed descriptor ${index}                                            | 10 / 84842; 10 / 85877           |
| I0     | src/recording/journal-recording-path-isolation.test.ts:32, keeps same-label files independently discoverable                                     | 4 / 84820; 4 / 85869             |
| I1     | src/recording/journal-recording-path-isolation.test.ts:96, preserves an occupied ${bytes.length                                                  | 4 / 84820; 4 / 85869             |
| I2     | src/recording/journal-recording-path-isolation.test.ts:131, preserves an occupied fork destination                                               | 4 / 84820; 4 / 85869             |
| U      | src/recording/discovery-partial-turn-resume.test.ts:24, resumes only committed call/results by original identity                                 | 1 / 84882; 1 / 85899             |
| J0     | src/recording/janitor/journal-janitor-safety.test.ts:58, keeps the global root after actually deleting                                           | 7 / 84859; 7 / 85889             |
| J1     | src/recording/janitor/journal-janitor-safety.test.ts:71, does not follow a symlinked archive directory                                           | 7 / 84859; 7 / 85889             |
| J2     | src/recording/janitor/journal-janitor-safety.test.ts:91, does not follow a native pathname replaced                                              | 7 / 84859; 7 / 85889             |
| J3     | src/recording/janitor/journal-janitor-safety.test.ts:109, retains stale non-session and native-looking portable temp                             | 7 / 84859; 7 / 85889             |
| J4     | src/recording/janitor/journal-janitor-safety.test.ts:132, retains a valid same-ID native replacement by inode                                    | 7 / 84859; 7 / 85889             |
| J5     | src/recording/janitor/journal-janitor-safety.test.ts:173, counts injected non-benign directory I/O errors                                        | 7 / 84859; 7 / 85889             |
| J6     | src/recording/janitor/journal-janitor-safety.test.ts:186, keeps all project media when an unreadable native sibling                              | 7 / 84859; 7 / 85889             |

The reference media, generated replay, service-large-row and crash/transport contracts are already closed within their named W21 scopes. GEN/GCOMP and MEDIA rerun existing proof rather than duplicate it. J4/J6 extend the native media interaction to inode replacement and unreadable-sibling conservation. Z/E/B rerun schema/corruption isolation and metadata budgets unchanged. OWN reruns ordered write/close/lock-release aggregation.
