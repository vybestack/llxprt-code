# Pseudocode: Public-event usage-metadata boundary + telemetry neutralization

Plan: PLAN-20260707-AGENTNEUTRAL — REQ-007.1/.2/.3, REQ-008.1/.2, OQ-2u/OQ-2v/OQ-3t/OQ-14.
Target: `packages/agents/src/api/eventAdapter.ts` (mapper), `api/event-types.ts`/`event-schema.ts` (declared type), `core/turnLogging.ts` (telemetry).

## Interface Contracts

INPUTS: neutral `UsageStats` on `ModelStreamChunk.usage` / `Finished.usageMetadata`.
OUTPUTS: the declared public wire (Gemini-named — committed option (C)) mapped at the outermost edge via `usageStatsToPublicUsageMetadata`; internal loop stays neutral.
DEPENDENCIES (real): `UsageStats` (core), `eventAdapter` forwarding logic (existing), telemetry sink.

## Characterization FIRST (REQ-007.1, OQ-2v) — run before choosing the option

```
10: TEST characterizeFinishedUsageAtRuntime():
11:   run a real agent turn that yields usage on the Finished event
12:   observe done.finished.usageMetadata keys AS EMITTED at runtime
13:   ASSERT which keys are present: neutral (promptTokens/completionTokens) OR Gemini (promptTokenCount/candidatesTokenCount)
14:   // adapter forwards verbatim today (eventAdapter.ts:317-323), so expected = neutral UsageStats keys
15:   RECORD the finding as EVIDENCE ONLY (documents the declared-Gemini-vs-emitted-neutral disagreement that motivates the mapper);
15a:  // it does NOT select a branch — OQ-2u is committed UNCONDITIONALLY to option (C) (Critical 1 round 7). No option-B path exists.
```

## Option (C) bridge mapper (COMMITTED UNCONDITIONALLY per domain-model OQ-2u — no option-B branch) (REQ-007.2)

```
20: FUNCTION usageStatsToPublicUsageMetadata(u?: UsageStats): UsageMetadataValue | undefined   // NEW — does not exist today
21:   IF u === undefined RETURN undefined
22:   RETURN { promptTokenCount: u.promptTokens,
23:            candidatesTokenCount: u.completionTokens,
24:            totalTokenCount: u.totalTokens,
25:            cachedContentTokenCount: u.cachedTokens }
26:   // OQ-14 PUBLIC decision: NO reasoningTokens/thoughtsTokenCount emitted here — UsageMetadataValue (event-types.ts:32-37) declares ONLY the 4 keys above and stays UNCHANGED (option (C)). u.reasoningTokens is preserved INTERNALLY on UsageStats (ModelOutput.usage/ModelStreamChunk.usage), NOT on the public wire. Public reasoning-token exposure is OUT OF SCOPE for #2349.
27: // wire into eventAdapter Finished/UsageMetadata cases:
28: CASE Finished: done.finished.usageMetadata = usageStatsToPublicUsageMetadata(e.value.usageMetadata)   // was verbatim forward
29: CASE UsageMetadata: yield { type:'usage', usage: usageStatsToPublicUsageMetadata(e.value) }
30: // Internal agents state stays neutral UsageStats; Gemini keys exist ONLY here + event-types/event-schema.
31: // These modules are the ONLY §8(h) allow-listed usage-key sites.
```

## Telemetry (REQ-008.1/.2, OQ-3t) — turnLogging.ts

```
40: METHOD logApiRequest(runtimeContext, state, contents: IContent[], ...)   // was Content[]; DELETE toGeminiContents (G4/G5/G7)
41:   text = getRequestTextFromIContents(contents)                           // neutral text extraction
42:   runtimeContext.telemetry.logApiRequest(runtimeContext, state, text, ...)
43: METHOD logApiResponse(..., usage?: UsageStats, ...)                       // was GenerateContentResponseUsageMetadata
44:   telemetry gets neutral UsageStats                                       // OQ-3t COMMITTED NEUTRAL — turnLogging.ts is NOT allow-listed
45:   runtimeContext.telemetry.logApiResponse(..., usage, ...)                // NO Gemini-named serialization; NO usageStatsToPublicUsageMetadata here
```

## Core-owned scope limitation (REQ-007.3, OQ-8)

```
50: // ServerUsageMetadataEvent is core-owned (packages/core/src/core/turn.ts:221-228) and has ZERO production emitters
51: //   (only eventHarness.ts:108 constructs it; eventAdapter.ts:267-269 forwards). The agents gate cannot rewrite it.
52: // DECISION recorded: the agents-owned API UsageMetadataValue/adapter/telemetry surface is neutralized via check (h);
53: //   the core-owned event decision is tracked in the cross-package migration (OQ-8), not enforced by the agents gate.
```

## Integration Points

- Line 10-15: the characterization test runs in the usage-metadata slice's TDD phase BEFORE the mapper is written (REQ-007.1 gates REQ-007.2).
- Line 20-31: the mapper is the ONLY new Gemini-key surface; recorded as a central allow-list entry.
- Line 40-42: neutral telemetry deletes `toGeminiContents` G4/G5/G7.

## Anti-Pattern Warnings

```
[ERROR] DO NOT: retype the public UsageMetadataValue/FinishedValue.usageMetadata to neutral (option B) — it is a public breaking change that breaks the CLI consumers (agentEventDispatcher.ts:406, zedIntegration.ts:614-615) with no owning migration phase; option (C) is committed UNCONDITIONALLY (Critical 1 round 7).
[ERROR] DO NOT: run the OQ-2v characterization as a BRANCH SELECTOR — it records evidence only; the option is fixed at (C).
[ERROR] DO NOT: let Gemini usage keys leak into internal loop files — only boundary modules (gate check h).
[ERROR] DO NOT: assume a UsageStats->Gemini mapper already exists — it must be WRITTEN (§7A fact 3).
[ERROR] DO NOT: claim the agents gate enforces the core-owned ServerUsageMetadataEvent — it cannot (REQ-007.3).
[ERROR] DO NOT: emit thoughtsTokenCount (or reasoningTokens) on the public wire from the mapper (OQ-14 PUBLIC decision) — UsageMetadataValue declares ONLY promptTokenCount/candidatesTokenCount/totalTokenCount/cachedContentTokenCount (event-types.ts:32-37) and stays UNCHANGED; adding a public reasoning field is a public API change (CLI blast radius) that is OUT OF SCOPE for #2349. reasoningTokens is preserved INTERNALLY only.
[OK] DO: keep internal agents usage as neutral UsageStats end-to-end (incl. u.reasoningTokens, OQ-14 INTERNAL decision); expose the Gemini-named public wire (the 4 declared keys only) ONLY via the option-(C) mapper.
```
