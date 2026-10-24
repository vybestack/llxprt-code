# Issue #854: what remains

This file replaces PHASE5-STATUS, PHASE6-STATUS, W26-STATUS and the per-slice proof JSON as the working status. Those files are historical and are not updated any more.

## Goal (Andrew, 2026-10-16)

Keep history out of memory. Hold only what converting one row to the provider's native format needs. No temp files, no repeated whole-file reads. Clean, maintainable, efficient code.

## How each slice is done

1. Write a behavioral test that fails on the current code.
2. Fix the code.
3. Run the touched test files, scoped lint and types.
4. Commit.

No per-slice proof JSON, preservation hash checks, mutation-control runs or status rewrites. Full verification happens once, before the PR.

Rules that stay: no compatibility shims, no eslint-disable, no type-escape casts, no skipped tests, no weakened assertions or limits, Bun tests only, no push or merge without Andrew.

## Remaining work, in order

| # | Item | State |
|---|---|---|
| 1 | Kimi native request route | Done in `01b957933` |
| 2 | OpenAI Responses native request route | Done: stateless `4dc55e707`, stateful `be3ecbcda` |
| 3 | Anthropic native request route | Done. Uncached `88e8ab2e6`, caching `781dae82b`, recovery without media `558608de4`, stored media aggregate `95d7c5725`/`7d823b208`, tails `b816a22bf`, persisted media `f60921f05`, media estimates `a6cfbe72b`, media tails `888a16754`, image budgets `fad44fbb8`, image recovery `455b4dfbf`, views `7d4e1c01b`, affected-span repair replacing the shape whitelist `a033ba8fc` |
| 4 | Native request log/dump | Done: Anthropic `29522b461`, Chat/Mistral/Kimi `20a7e03f3`, Responses `7c63e0c6c` |
| 5 | Floating-promise lint errors | Done in `df03074e1`. Pinned requests failing with "History changed before the native request format fill" after any history change (from `e912dba1d`) fixed in `a02a55af1` |
| 6 | Performance and memory | Tool-heavy send test passes again at 168.3 s against its 170 s budget (narrow): prefetch read amplification `546d529ef` (protocol reads 2.90 GB to 570 MB), shallow trie paths kept during cold scans `c7545c069`. Restore/rollback now reuses stored fact roots `ca410d88c`, `f291b9fe7` (inside-group pop at 8,192 rows: 224,318 reads to 22); compensation restores saved mirror roots `d2882d2cc`; mirror adoption reads each header once `a7202650d`; trie cache fixes `9b34662aa`, `a2d23100c`. Open: under-limit send reads 2 full rows against a limit of 1; retained-growth late gate fails; several 8,192-row cases exceed 5 s default budgets under load average 20 |
| 7a | Default flip | Done in `3341b7673`. Test conversion since then fixed about 70 production bugs. Outstanding: agents 37 files (`tmp/agents-r7/remaining.txt`), cli about 12; semantic purge creates `store.lock` on media release |
| 7b | Deletion | Every provider entry requires native or caller-owned rows (`f3208abce`). Deleted: Anthropic spool preparation, old dump builders, keyed tool ID store, wire body spool, old Responses serializer, `KeyedRowIndex` and Anthropic message table, provider normalization disk/storage/curated stream, old JSONL `HistoryJournalStore` (36 modules, `36a165259`), `HistoryMutationService`, JSONL resume cursor, fold checkpoint cache, JSONL header readers. Left: JSONL `SessionRecordingService` writer, `ReplayEngine`/`replaySession`, `journalResolver`, `resolverScan`, `journalCursor`, `durableRowFold`, `CommitAckRegistry`; about 120 test files still use them (`tmp/delete16/reference-counts.txt`) |
| 7c | Merge main | origin/main moved Bun to 1.4.4 (#3930) plus 5 other fixes. Memory tests pinned to 1.3.14 must follow |
| 8 | Branch cleanup | PR diff contains product code, tests, fixtures and the design doc, not proof receipts or evidence logs |
| 9 | Ship | test, lint, typecheck, format, build, lunahigh smoke; PR; CI green |

No provider request reaches a body spool or per-request file; a request without native or caller-owned rows is rejected at the provider entry.

## Known failures tracked separately

- #3917: `sanitizeParams` drops an own `"__proto__"` key.
- Two old-backend durable capture/replay cases at 512/8192 rows.
- Blanket no-create compaction test at 8192 rows (recorder `.llxj.compact` is legitimate).
- Public fake-provider fixture exhausts on its second call.
- `packages/providers/src/anthropic/anthropic-stream-repair-scale.test.ts`: three failures at `150d36e02`, one with the native-route changes.
- `packages/providers/src/anthropic/journal-anthropic-append-lifecycle.test.ts`: two failures at `150d36e02`.
- `packages/providers/src/anthropic/journal-anthropic-lifecycle.test.ts`: "bounds live auxiliary metadata" fails at `150d36e02` with 10 entries against a limit of 7.
- `core` `formatTables.test.ts`: `mediaContribRows` design-table mismatch, 7 pass/1 fail at `df03074e1`.
- `journal-responses-frozen.test.ts`: 500-seed batches exceed Bun's default 5 s per-test budget under load, at `13e905415` as well (was filed as #3941, closed as branch-only).
- `send-peak.native-full-tools.test.ts`: times out at its 170 s budget at `13e905415` (was filed as #3942, closed as branch-only).
- `native-anthropic-spans-send.test.ts`: first case's 5 s budget fails under load; passes 6/6 alone.
- `bun:ffi` type error in `core/src/journal/flushRecords.ts` under providers `tsconfig.test-bun.json`.

Several of these are old-backend paths and may disappear with item 7. Whatever survives gets fixed or filed before the PR.

## Done earlier

Native: plain OpenAI Chat (initial and continuation), Mistral, semantic purge, Agent/CLI clear and restore, compression inputs, provider fallback, pending-token tool ranking, annotated append. #3929 fixed on this branch (`795ea443d`, `c11673be5`).
