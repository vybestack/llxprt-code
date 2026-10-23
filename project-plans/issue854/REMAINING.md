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
| 6 | Performance and memory | Done: tool-heavy test 128.7 s inside its 170 s budget (`c5e14b67a`, `85bde6d35`); Anthropic tool-round reads halved (`9d2edb930`). Open: 8,192-row replacement takes about 60 s (two commit groups, 2,276 writes); measure CPU cost per row |
| 7a | Default flip | Done in `3341b7673`: journal is the only backend, selector deleted. Test conversion since then fixed about 30 production bugs. Core inventory with Bun 1.3.14 (`tmp/inventory/core.log`): 999/1054 files pass, 55 fail (`tmp/inventory/core-fail-files.txt`); agents, cli and providers inventories not yet run |
| 7b | Deletion | Waves in `DELETION-PLAN.md` (`377e32fd7`): 4, 106 and 67 files. Blockers: generic `/dump` still uses old dump builders; generic overrides and bare provider streams still reach normalization staging; token tickets still allocate a value spool; Kimi still uses `KeyedRowIndex` for media uploads |
| 7c | Merge main | origin/main moved Bun to 1.4.4 (#3930) plus 5 other fixes. Memory tests pinned to 1.3.14 must follow |
| 8 | Branch cleanup | PR diff contains product code, tests, fixtures and the design doc, not proof receipts or evidence logs |
| 9 | Ship | test, lint, typecheck, format, build, lunahigh smoke; PR; CI green |

On the journal backend no provider request reaches a body spool or per-request file. `AnthropicSpooledRequest`, Chat's `WireBodySpool` paths and the Responses disk serializer are reachable only when `rows.native` is undefined, which is the old backend.

## Known failures tracked separately

- #3917: `sanitizeParams` drops an own `"__proto__"` key.
- Two old-backend durable capture/replay cases at 512/8192 rows.
- Blanket no-create compaction test at 8192 rows (recorder `.llxj.compact` is legitimate).
- Public fake-provider fixture exhausts on its second call.
- `packages/providers/src/anthropic/anthropic-stream-repair-scale.test.ts`: three failures at `150d36e02`, one with the native-route changes.
- `packages/providers/src/anthropic/journal-anthropic-append-lifecycle.test.ts`: two failures at `150d36e02`.
- `packages/providers/src/anthropic/journal-anthropic-lifecycle.test.ts`: "bounds live auxiliary metadata" fails at `150d36e02` with 10 entries against a limit of 7.
- `core` `formatTables.test.ts`: `mediaContribRows` design-table mismatch, 7 pass/1 fail at `df03074e1`.
- `bun:ffi` type error in `core/src/journal/flushRecords.ts` under providers `tsconfig.test-bun.json`.

Several of these are old-backend paths and may disappear with item 7. Whatever survives gets fixed or filed before the PR.

## Done earlier

Native: plain OpenAI Chat (initial and continuation), Mistral, semantic purge, Agent/CLI clear and restore, compression inputs, provider fallback, pending-token tool ranking, annotated append. #3929 fixed on this branch (`795ea443d`, `c11673be5`).
