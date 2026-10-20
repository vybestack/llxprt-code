# W24 status

## First-piece acceptance checkpoint

Four isolated serial executions passed: the common lifecycle and unchanged native-command protocol each ran with initial `old` and `journal` environments. The common lifecycle pins journal itself. Total: four passes, zero failures/skips, 290 assertions. `first-green-driver.log` records the commands' results. Build declarations, core/agents/CLI noemit, agents/CLI test-bun with `--types node,bun`, scoped ESLint/Prettier, affected graph and test audit passed. The audit has no finding for the new test. Core noemit includes its supported source/test set; the attempted separate core test configs were invalid (one absent, one with no inputs), not hidden passing gates.

Source bindings: `first-source-sha256.txt` (tracked packages/scripts), `first-new-source-sha256.txt` (four new TypeScript files), under the raw root below. Drivers 98874 and 5637 are absent after completion. No test or mutation remains active. This checkpoint precedes the child-journal extension; the remaining obligations below still apply.

## 2026-10-20: first lifecycle piece

W24 is in progress. Starting HEAD `52a0749bc3ed2f9d65a358d8ed4525e776edda1c` matches the directive. The first common scenario uses the real Agent, shipped FakeProvider, production native history adapter, scheduler/write-file tool and CLI slash dispatcher. It covers normal send, successful tool round, `/chat save`, `/chat resume` fork, explicit `/continue` while the fork is bound, public compression, package export/import, shutdown, discovery and cold resume. Helpers are bounded modules under CLI `src/__tests__/support/`.

The authoring run `author-07.log` passed with 105 assertions. Subsequent scoped gates are being recorded under `tmp/854-notes/p4/w24/lifecycle-run-a/`. This is not acceptance for the complete W24 lifecycle: the actual subagent-child stage still needs integration into this common scenario, and startup-lock observation before first send is not yet explicit. These are implementation follow-ups, not waived requirements.

Fixture corrections were required for lazy recorder materialization, FakeProvider's process-CWD substitution versus the explicit Agent workspace, tool-call/result UI grouping and the public SessionInfo `id` field. No production defect has been established by these authoring failures, and no production source has changed. Every failed attempt is retained separately. Native rows are read with JournalSession; facts/checkpoints use the typed native readers. Bounded oracle arrays live only in test support, not the production history path.

`npm run build:types` and core/agents/CLI production no-emit checks passed. The first gate command incorrectly requested a nonexistent core test-bun config, and agents/CLI test-bun checks need explicit Bun types for `bun:ffi`; corrected commands and receipts remain separate. No config or enforcement changes were made. Recorded drivers: 98874 (first type lane), 5637 (serial first-green lane); check their liveness before continuing. No production mutation is active.

Still open: subagent integration and stronger startup/file-boundary observations, 50-turn flat-heap proof with the original 1 MiB retained allowance and rejecting retaining control, measured primary-plus-mirror bytes/CPU and evidence-based recorder-as-primary decision, journal smoke and final source-bound acceptance receipts. Eight unchanged W23 planning/header RED assertions remain assigned to phases 5/6 through 7. Existing provider spools/compression candidates remain W26/phase-6 work. The intentional portable package is outside recording-artifact assertions. No global no-scratch claim, W24 completion or default flip follows. Review skipped per Andrew 2026-10-09.
