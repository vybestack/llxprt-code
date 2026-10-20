# W24 lifecycle proof map

## Accepted common lifecycle, 2026-10-20

`W24-LIFECYCLE-PROOF.json` binds the final sources, nineteen serial test/gate processes, raw logs, typed fixture receipts and absent PIDs. W24 remains partial for the performance obligations below. Test entry: `packages/cli/src/ui/hooks/whole-product-lifecycle.test.ts:16-36`. Support paths below are relative to `packages/cli/src/__tests__/support/`.

| Requirement                               | Actual common-scenario proof                                                                                                                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locked startup, metadata, first send/tool | `whole-product-lifecycle.ts:26-82`; title write materializes an empty locked journal before send, then journal-bound client, six native rows, matched tool events and real receipt                                                                 |
| Checkpoint/fork and switch while bound    | `whole-product-lifecycle.ts:84-120`; actual slash handlers, six-row checkpoint prefix, eight-row independent fork, source suffix unchanged, current owner and released prior locks                                                                 |
| Compression replacement                   | `whole-product-lifecycle.ts:122-146`; public Agent.compress through real CompressionHandler, summary/continuation metadata, old live user row absent, source checkpoint/fork retained                                                              |
| Actual child lifecycle                    | `whole-product-child.ts:23-46,89-246`; real task tool/orchestrator/OpenAI HTTP/SSE, distinct native child facts/parent, held lock, correlated native write-file call/result and actual child receipt, task result, ephemeral journal/lock released |
| Package/import                            | `whole-product-lifecycle.ts:147-166`; slash export and public import, distinct identity/path, exact native rows, title retained, imported directories explicitly scrubbed by production policy                                                     |
| Cold reopen/discovery                     | `whole-product-lifecycle.ts:168-200`; fresh Agent listing/resume iterable, exact replay, preserved checkpoint/facts and next durable send                                                                                                          |
| Native files/G7/ownership                 | `whole-product-observer.ts:18-130`; typed readers and path/lock checks, no `.json` snapshot in exercised project-temp tree, exactly three native recordings after shutdown with no other chat entries                                              |
| Evidence/size                             | `whole-product-observer.ts:132-146`; test-only metadata receipt outside product project-temp tree; largest file 246 lines, largest function 80                                                                                                     |

The common test pins journal in both initial environments. Existing native CLI protocol, native package and child-owner suites provide separate regression evidence, not substitutes for the common scenario. Eight isolated executions: 28 passes/484 assertions, no failure or skip. Eleven scoped gates and journal lunahigh smoke pass. No BeforeModel hook is installed: readonly/rewrite hook array materialization remains an opt-in documented exception, never a default-path assumption. Artifact claims exclude intentional portable packages and do not claim removal of existing provider spools/compression candidates. Original inventory and remaining obligations follow unchanged.

## First-slice inventory, 2026-10-20

Starting HEAD: `52a0749bc3ed2f9d65a358d8ed4525e776edda1c`. This inventory precedes the scenario test. Authority: original W24 at `fragments/stdout/seq-450.txt:33-35`, D-ORCH-7 in DECISIONS, recovered RULES and `journal-db-design.md`. Current directive permits independent W24 evidence while eight unchanged W23 planning/header assertions depend on phases 5/6 through 7.

One common lifecycle will use the public Agent and actual CLI slash dispatch, with the production journal adapter selected explicitly. Helpers belong under CLI `src/__tests__/support/`; no replacement history algorithm or mocked session owner.

| Step               | Production entry / existing fixture                                                         | Required observation                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Start              | `createAgent`, `session.setRecording`, locked recorder                                      | Native recording, held session lock, journal-bound client                                      |
| Send / tool round  | `Agent.stream`, shipped FakeProvider, real scheduler/tool                                   | Human/AI/tool rows, matched tool call/result channel and real filesystem result                |
| Save / fork        | `processSlashCommand`, `chatOwnerCommand` through `native-command-fixture.commandDeps`      | Durable checkpoint, child ancestry, independent rows and current owner                         |
| Explicit switch    | Public session resume with old owner still bound                                            | New native owner, released old lock, unchanged old source                                      |
| Compression        | Public `Agent.compress` through `CompressionHandler`                                        | Active native rows replaced, durable compression facts, checkpoint/source preserved            |
| Subagent           | Actual task tool/orchestrator, child profile with deterministic local transport if required | Separate native child recording and identity facts, child results through tool channel         |
| Package            | Public session export/import                                                                | Intentional portable package artifacts, imported identity/current owner, same durable contents |
| Shutdown / reopen  | `dispose`, fresh Agent listing/resume                                                       | All owned locks released; discoverable, resumable rows/facts/checkpoints                       |
| File boundary / G7 | Typed `JournalSession` and native metadata reader, explicit directory inventory             | No user-facing whole-session JSON snapshot; no unexpected recording artifacts                  |

Existing isolated proofs to reuse as fixtures, not whole-product closure: CLI `native-command-protocol.test.ts` and `native-command-*.test.ts`; agents `subagent-child-config-journal-integration.test.ts`, compression native publication suites; W17/W21 discovery/replay/service proofs; W23 provider byte and retained-memory receipts. The new common scenario must exercise the actual fields across these boundaries.

BeforeModel array hooks are an opt-in design exception, not the default tested path. Existing phase-4 provider spools and compression candidates remain intermediate W26/phase-6 work. An intentional exported package is not a forbidden operation temporary file. Artifact assertions will identify the exact observed directories and must not imply global scratch removal.

## Explicit remaining obligations

The common lifecycle extension is committed at `e3cdf3ec74d7d60c4e57df27d8e1c6f0b2fb4e46`. Its journal lunahigh smoke is accepted at that unchanged source boundary. W24 still owns these subsequent steps, in order:

1. Run 50-turn whole-product retained-heap acceptance with the unchanged 1 MiB allowance and a retaining trap that rejects at the intended memory predicate.
2. Measure write bytes and CPU for both primary and mirror, then make the recorder-as-primary decision from those measurements under D-ORCH-7. No owner approval gate is added.

The common scenario covers text/tool history. Its media boundary is separate native-package regression evidence, including media validation and rollback. Existing W23 controls are separately recorded; no W24 mutation or heap-trap result is claimed. Windows real rename refusal and compaction read/pin behavior are existing design obligations, not newly completed W24 work (design Sections 4.11, 4.12, 13.6 and risk 9). This lane ran on Darwin.

W23's eight existing planning/header RED assertions remain unchanged on phases 5/6 through 7. No W24 closure, W25/default flip, W26 scratch closure or later-phase closure follows. Review skipped per Andrew 2026-10-09.
