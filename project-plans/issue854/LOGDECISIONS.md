# Issue 854 decision log, 2026-10-20

## Phase 5 Kimi correction facts

Implement the persisted mapping boundary before request-tail and summary integration. The first green group is `4d88b25211a7d1b4ac5999afaf88797dbafc05f3`. The production native writer owns emitted positions, counts, last-eligible pointers and exception admission under the existing acknowledgement/poison contract.

Keep namespace-0 and the original namespace-4 occurrence fields source-based. Use separately encoded namespace-4 emitted fields and the existing namespace-5 sparse list. Raw identities remain distinct even when OpenAI/Anthropic normalized IDs collide. Keep the existing bounded batch/cache and no per-operation file or history-wide retained map.

Reject format 5 rather than interpreting its Kimi activation marker as proof that emitted mapping facts exist. Format 6 introduces those persisted semantics without a migration or shim. Keep mapping activation separate from format/settings registration.

Store source block references for last-eligible names, then read one block and own the returned name string. Preserve exact UTF-16 code units when copying. This avoids retaining the parsed block's JSON backing storage and avoids changing lone surrogates through UTF-8 conversion.

Count mapping eligibility across all speakers, but distinguish consumed fallback uses from written IDs. The actual converter drops a response to an unnamed call when its new fallback ID differs from the preceding call ID. Versioned global AI-call count also handles the first-AI-call transition for earlier human-target responses without scanning those rows.

Expose mapped digit corrections and raw-ID holder streams now. Keep request-only tail continuation, complete unmapped digit ranks/dropped-use subtraction, row-prefix unmapped aggregates, format-dependent name bytes/tokens and stored holder remeasurement open. Do not call the mapped correction term a full byte/token measurement. No settings/LENS or provider/default cutover is included.

The actual converter and old mapper supply independent expectations. Controls reject wrong last eligible/name/ordinal, wrong written uses and retaining all IDs. Read-budget rejection is not a retained-heap result. Preserve frozen inputs and all initial failure receipts. See [PHASE5-KIMI-DECISIONS.md](PHASE5-KIMI-DECISIONS.md) for field layouts and lifecycle behavior.

Review skipped per Andrew 2026-10-09. No cleanup, .llxprt edit/staging, unrelated declaration/recovery staging, OCR, push or merge.
