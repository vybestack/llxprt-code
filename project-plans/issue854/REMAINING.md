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

| # | Item | Done when |
|---|---|---|
| 1 | Kimi native request route | Done in `01b957933`: Kimi requests and estimates stream from journal facts without body spooling; publication and one-row retention tests pass |
| 2 | OpenAI Responses native request route | Done: stateless in `4dc55e707`, stateful in `be3ecbcda`. Journal-backed sends, estimates, parentless recovery and caller input overrides no longer use per-segment disk projection |
| 3 | Anthropic native request route | `AnthropicSpooledRequest.ts` and `message-table/tool-id-index.ts` no longer used |
| 4 | Native request log/dump | Logging and dumps read the journal, no body copy |
| 5 | Tool-heavy memory test | Passes inside its existing 170,000 ms budget |
| 6 | Default flip and deletion | `journal` is the default; old JSONL backend, `historyBackendSelect.ts`, `WireBodySpool`, `KeyedRowIndex` and old-only scratch code deleted |
| 7 | Branch cleanup | PR diff contains product code, tests, fixtures and the design doc, not proof receipts or evidence logs |
| 8 | Ship | test, lint, typecheck, format, build, lunahigh smoke; PR; CI green |

Journal-backed Responses requests no longer use disk prompt projection. The non-native Responses route still uses `serializeResponsesPromptEnvelope` for the old backend. Anthropic journal requests still spool their body and estimator prompt files through `AnthropicSpooledRequest.ts`; that remains item 3.

## Known failures tracked separately

- #3917: `sanitizeParams` drops an own `"__proto__"` key.
- Two old-backend durable capture/replay cases at 512/8192 rows.
- Blanket no-create compaction test at 8192 rows (recorder `.llxj.compact` is legitimate).
- Public fake-provider fixture exhausts on its second call.

Several of these are old-backend paths and may disappear with item 6. Whatever survives gets fixed or filed before the PR.

## Done

Native: plain OpenAI Chat (initial and continuation), Mistral, semantic purge, Agent/CLI clear and restore, compression inputs, provider fallback, pending-token tool ranking, annotated append. #3929 fixed on this branch (`795ea443d`, `c11673be5`).
