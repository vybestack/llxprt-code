# W24 lifecycle proof map

## First-slice inventory, 2026-10-20

Starting HEAD: `52a0749bc3ed2f9d65a358d8ed4525e776edda1c`. This inventory precedes the scenario test. Authority: original W24 at `fragments/stdout/seq-450.txt:33-35`, D-ORCH-7 in DECISIONS, recovered RULES and `journal-db-design.md`. Current directive permits independent W24 evidence while eight unchanged W23 planning/header assertions depend on phases 5/6 through 7.

One common lifecycle will use the public Agent and actual CLI slash dispatch, with the production journal adapter selected explicitly. Helpers belong under CLI `src/__tests__/support/`; no replacement history algorithm or mocked session owner.

| Step | Production entry / existing fixture | Required observation |
| --- | --- | --- |
| Start | `createAgent`, `session.setRecording`, locked recorder | Native recording, held session lock, journal-bound client |
| Send / tool round | `Agent.stream`, shipped FakeProvider, real scheduler/tool | Human/AI/tool rows, matched tool call/result channel and real filesystem result |
| Save / fork | `processSlashCommand`, `chatOwnerCommand` through `native-command-fixture.commandDeps` | Durable checkpoint, child ancestry, independent rows and current owner |
| Explicit switch | Public session resume with old owner still bound | New native owner, released old lock, unchanged old source |
| Compression | Public `Agent.compress` through `CompressionHandler` | Active native rows replaced, durable compression facts, checkpoint/source preserved |
| Subagent | Actual task tool/orchestrator, child profile with deterministic local transport if required | Separate native child recording and identity facts, child results through tool channel |
| Package | Public session export/import | Intentional portable package artifacts, imported identity/current owner, same durable contents |
| Shutdown / reopen | `dispose`, fresh Agent listing/resume | All owned locks released; discoverable, resumable rows/facts/checkpoints |
| File boundary / G7 | Typed `JournalSession` and native metadata reader, explicit directory inventory | No user-facing whole-session JSON snapshot; no unexpected recording artifacts |

Existing isolated proofs to reuse as fixtures, not whole-product closure: CLI `native-command-protocol.test.ts` and `native-command-*.test.ts`; agents `subagent-child-config-journal-integration.test.ts`, compression native publication suites; W17/W21 discovery/replay/service proofs; W23 provider byte and retained-memory receipts. The new common scenario must exercise the actual fields across these boundaries.

BeforeModel array hooks are an opt-in design exception, not the default tested path. Existing phase-4 provider spools and compression candidates remain intermediate W26/phase-6 work. An intentional exported package is not a forbidden operation temporary file. Artifact assertions will identify the exact observed directories and must not imply global scratch removal.

## Explicit remaining obligations

The first green lifecycle piece is to be committed before extending the performance lane. W24 remains partial until the complete common lifecycle, 50-turn retained-heap proof with the original 1 MiB allowance and rejecting retaining control, primary-plus-mirror measured write bytes/CPU and resulting recorder-as-primary decision, and journal smoke are accepted. W23's eight existing RED assertions remain unchanged. No W25/default flip, W26 scratch closure or later-phase closure follows. Review skipped per Andrew 2026-10-09.
