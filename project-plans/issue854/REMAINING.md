# Issue #854: what remains

## Goal (Andrew, 2026-10-16)

Keep history out of memory. Hold only what converting one row to the provider's native format needs. No temp files, no repeated whole-file reads. Clean, maintainable, efficient code.

## How each slice is done

1. Write a behavioral test that fails on the current code.
2. Fix the code.
3. Run the touched test files, scoped lint and types.
4. Commit.

Full verification happens once, before the PR. Rules that stay: no compatibility shims, no eslint-disable, no type-escape casts, no skipped tests, no weakened assertions or limits, Bun tests only, no push or merge without Andrew.

## State

| # | Item | State |
|---|---|---|
| 1 | Native request routes | Done for Chat, Mistral, Kimi (`01b957933`), Responses (`4dc55e707`, `be3ecbcda`), Anthropic (through `a033ba8fc`) and request dumps. Every provider entry rejects a request without native or caller-owned rows (`f3208abce`) |
| 2 | Default flip | Done in `3341b7673`: the journal is the only history backend |
| 3 | Deletion | Done. Old request spools, normalization storage, dump builders, message table, `KeyedRowIndex`, the JSONL `HistoryJournalStore`, the JSONL session writer, replay, resolver, cursor, fold, acks and the JSONL pager closure are gone (through `72e69dbda`). `.jsonl` sessions are only detected, to show the retired-format refusal |
| 4 | Performance and memory | Read amplification fixed (`546d529ef`, `c7545c069`, `ca410d88c`, `f291b9fe7`, `d2882d2cc`, `a7202650d`, `9b34662aa`, `a2d23100c`). Token tickets reuse the submitted row encoding (`f80cd277c`). Token-usage logging reads stored row facts instead of a per-session cache that grew to 2,000 rows (`143d60a0b`, `fa1c5dd19`); retained-growth acceptance passes 15/15 |
| 5 | Merge main | Done in `56fce1e39` (Bun 1.4.4; memory guards read `.bun-version`) |
| 6 | Branch cleanup | Working plans, proof receipts and recovery notes removed (`cbf9cc137`); this file, `journal-db-design.md` and `DELETION-PLAN.md` stay |
| 7 | Ship | Full test inventory per workspace, lint, typecheck, format, build, lunahigh smoke; PR; CI green |

## Metadata persistence fix (2026-10-24)

The admitted-workspace regression is fixed. Session facts use an explicit `VALUE` body write behind the existing eight-byte map reference. Ordinary map values still have the 16 KiB ceiling. Large reads fill one result in bounded chunks and do not cache or duplicate it. The record layout and journal version are unchanged, and original small map-value session facts still resume. Tests persist, compact, close, reopen and discover identical directory lists at 1, 513 and 8,193 real admitted directories, then replace the list with a small value. Admission has no finite maximum, so the largest case is a stress case rather than an invented product limit. `wholepeak.test.ts` passes all six tests with its original assertions and limits.

## Known open items

- Retained-growth trap admission is fixed: the wrapper preserves native/caller-owned capabilities and observes native indexed reads. Both trap suites reach and reject the planted retention under the unchanged predicates. The normal worker's verification run completes with zero retained rows and ends 519,718 bytes below baseline, but fails the unchanged late-endpoint gate: 288,161 bytes against 262,144 bytes. The normal path does not construct the changed trap class. No threshold, sampling or warm-up change was made, and no all-green acceptance result is claimed.
- Source-memory suite: one live row after release (also fails before `143d60a0b`).
- Three Gemini plugin integration tests in cli need the installed plugin.
- `issue-2603-release-install.test.ts` copies the repo's gitignored `tmp/` locally and times out; copied Homebrew Node cannot find `libnode`.
- Load-sensitive timeouts on this machine (load average around 20): several 8,192-row cases against Bun's default 5 s budget, `journal-responses-frozen` batches, `native-anthropic-spans-send` first case, `send-peak.native-full-tools` (168.3 s against 170 s).
- #3917: `sanitizeParams` drops an own `"__proto__"` key.
- `bun:ffi` type error in `core/src/journal/flushRecords.ts` under the providers, agents and cli test tsconfigs.
