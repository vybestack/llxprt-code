<!-- @plan:PLAN-20260707-AGENTNEUTRAL.P02 -->
<!-- @requirement:REQ-012.2 -->

# Agents Neutral Gate — Central Allow-list

> **Authoritative exemption mechanism (OQ-17).** This file is the SINGLE source
> of truth for exemptions to `scripts/agents-neutral-gate.ts`. An inline
> `// gate-exempt` comment in source code grants **NOTHING** — only a matching
> entry in this artifact exempts a hit. The gate subtracts allow-listed hits
> via AST-context matching (file + subkind + context-pattern).

## Format Specification

Each entry is a markdown table row:

| File              | Subkind         | Context Pattern    | Justification                     |
| ----------------- | --------------- | ------------------ | --------------------------------- |
| `path/to/file.ts` | `F3-role-parts` | `toGeminiContents` | why this bounded exception exists |

- **File** — repo-relative file path (or suffix match). `*` = any file.
- **Subkind** — the check subkind (`A-raw-genai-import`, `B-banned-symbol`,
  `C-contract-alias`, `E-enum-redeclaration`, `F1-candidates-content`,
  `F3-role-parts`, `F5-parts-access`, `G-call-toGeminiContent`, etc.). `*` =
  any subkind (use sparingly — subkind must match unless explicitly `*`).
- **Context Pattern** — a snippet that must appear in the hit's AST-context
  snippet for the exemption to apply. `*` or empty = match any context for
  this file+subkind.
- **Justification** — written rationale for why this bounded exception exists.

### Rules

1. An inline `// gate-exempt` comment grants **nothing** (OQ-17).
2. A structural hit with no matching allow-list entry **FAILS** regardless of
   any inline comment.
3. File-level exemptions (`subkind: *`) are REJECTED for hooks/usage-keys —
   the exemption is AST-context keyed, not file-level.

## Entries

### P13 — Named hook-wire boundary exports in hookWireAdapter.ts (AST-context-keyed)

<!-- @plan:PLAN-20260707-AGENTNEUTRAL.P13 -->
<!-- @requirement:REQ-012.2 -->

| File                                          | Subkind                 | Context Pattern                    | Justification                                                                                                                                                         |
| --------------------------------------------- | ----------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agents/src/core/hookWireAdapter.ts` | `F1-candidates-content` | `afterModelModifiedToChunk`        | Named external-wire mapping: reads hook JSON-wire candidates to produce neutral ModelStreamChunk; P07 boundary, AST-context-keyed                                     |
| `packages/agents/src/core/hookWireAdapter.ts` | `F1-candidates-content` | `afterModelModifiedToModelOutput`  | Named external-wire mapping: reads hook JSON-wire candidates to produce neutral ModelOutput; P13 direct-path boundary, AST-context-keyed                              |
| `packages/agents/src/core/hookWireAdapter.ts` | `F1-candidates-content` | `beforeModelBlockingToModelOutput` | Named external-wire mapping: reads hook JSON-wire candidates to produce neutral blocking ModelOutput; P13 before-model boundary, AST-context-keyed                    |
| `packages/agents/src/core/hookWireAdapter.ts` | `F1-candidates-content` | `afterModelBlockingToModelOutput`  | Named external-wire mapping: reads hook JSON-wire candidates to produce neutral blocking ModelOutput; P13 streaming AfterModel BLOCK boundary, AST-context-keyed      |
| `packages/agents/src/core/hookWireAdapter.ts` | `F5-parts-access`       | `afterModelModifiedToChunk`        | Named external-wire mapping: reads hook JSON-wire parts to produce neutral ModelStreamChunk; P07 boundary, AST-context-keyed                                          |
| `packages/agents/src/core/hookWireAdapter.ts` | `F5-parts-access`       | `afterModelModifiedToModelOutput`  | Named external-wire mapping: reads hook JSON-wire parts to produce neutral ModelOutput; P13 direct-path boundary, AST-context-keyed                                   |
| `packages/agents/src/core/hookWireAdapter.ts` | `F5-parts-access`       | `beforeModelBlockingToModelOutput` | Named external-wire mapping: reads hook JSON-wire parts to produce neutral blocking ModelOutput; P13 before-model boundary, AST-context-keyed                         |
| `packages/agents/src/core/hookWireAdapter.ts` | `F5-parts-access`       | `afterModelBlockingToModelOutput`  | Named external-wire mapping: reads hook JSON-wire parts to produce neutral blocking ModelOutput; P13 streaming AfterModel BLOCK boundary, AST-context-keyed           |
| `packages/agents/src/core/hookWireAdapter.ts` | `F5-parts-access`       | `extractBlocksFromHookResponse`    | Named hook-wire helper: reads candidate.content.parts from HookGenerateContentResponse wire to extract neutral ContentBlocks; called by all P07/P13 boundary adapters |
| `packages/agents/src/core/hookWireAdapter.ts` | `F5-parts-access`       | `candidate.content.parts`          | Named hook-wire helper: reads candidate.content.parts inside extractBlocksFromHookResponse to build neutral ContentBlocks; AST-context: same function body            |

### P31 — Removed: Legacy hook restrictions compat

The `hookRestrictionsLegacyCompat.ts` file (formerly allow-listed as a bounded
Google-shaped adapter) has been DELETED. Its consumers (`executor-tool-dispatch.ts`
and `subagent.ts`) now use the neutral `hookToolRestrictions.ts` API
(`isToolNameRestricted`). No equivalent shim exists under any other name.

### P25 — Bounded structural adapters (toGeminiContents calls)

| File                                                | Subkind                  | Context Pattern                            | Justification                                                                                                                                                      |
| --------------------------------------------------- | ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/agents/src/core/streamRequestHelpers.ts`  | `G-call-toGeminiContent` | `toGeminiContents`                         | G3 hook-wire adapter: converts neutral IContent[] to Gemini shape ONLY for the hook JSON wire; loop re-enters neutral IContent[]                                   |
| `packages/agents/src/api/control/sessionControl.ts` | `G-call-toGeminiContent` | `toGeminiContents`                         | Checkpoint save boundary: converts IContent[] to Gemini shape for checkpoint serialization; restore converts back via toIContents                                  |
| `packages/agents/src/core/streamRequestHelpers.ts`  | `F5-parts-access`        | `extractSystemInstructionText`             | G3 hook-wire adapter: reads `.parts` from Gemini-shaped systemInstruction (ContentUnion) to extract plain-text instruction for provider forwarding                 |
| `packages/agents/src/core/streamRequestHelpers.ts`  | `F5-parts-access`        | `value.parts`                              | G3 hook-wire adapter: reads `.parts` from Gemini-shaped systemInstruction ContentUnion; AST-context: inside extractSystemInstructionText only                      |
| `packages/agents/src/core/turn.ts`                  | `D-roundtrip-symbol`     | `providerStopReason = chunk.rawStopReason` | Pre-existing local variable name `providerStopReason` reads chunk.rawStopReason; NOT the deleted helper module — reads the neutral ModelStreamChunk field directly |

### P31 — checkH Gemini usage-key boundary exemptions (AST-context-keyed, NOT file-level)

<!-- @plan:PLAN-20260707-AGENTNEUTRAL.P31 -->
<!-- @requirement:REQ-012.1 -->

> **Major 4 (round 8):** these exemptions are AST-CONTEXT keyed. A usage-key
> literal ANYWHERE ELSE in these files (outside the named function/schema/type)
> STILL fires. A bare file-path allow-list key is REJECTED.

| File                                          | Subkind       | Context Pattern                   | Justification                                                                                                                                                       |
| --------------------------------------------- | ------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agents/src/api/event-types.ts`      | `H-usage-key` | `promptTokenCount`                | Declared `UsageMetadataValue` type member (committed §7A option C public wire type); AST-context: PropertySignature inside type alias only                          |
| `packages/agents/src/api/event-types.ts`      | `H-usage-key` | `candidatesTokenCount`            | Declared `UsageMetadataValue` type member (committed §7A option C public wire type); AST-context: PropertySignature inside type alias only                          |
| `packages/agents/src/api/event-types.ts`      | `H-usage-key` | `totalTokenCount`                 | Declared `UsageMetadataValue` type member (committed §7A option C public wire type); AST-context: PropertySignature inside type alias only                          |
| `packages/agents/src/api/event-types.ts`      | `H-usage-key` | `cachedContentTokenCount`         | Declared `UsageMetadataValue` type member (committed §7A option C public wire type); AST-context: PropertySignature inside type alias only                          |
| `packages/agents/src/api/event-schema.ts`     | `H-usage-key` | `UsageMetadataValueSchema`        | Declared `UsageMetadataValueSchema` zod schema member (runtime equivalent of the committed §7A option C public type); AST-context: inside schema const only         |
| `packages/agents/src/api/eventAdapter.ts`     | `H-usage-key` | `usageStatsToPublicUsageMetadata` | Sole boundary mapper: converts neutral UsageStats to Gemini-named public UsageMetadataValue (committed option-C boundary); AST-context: mapper function body only   |
| `packages/agents/src/core/hookWireAdapter.ts` | `H-usage-key` | `usageFromHookResponse`           | Named hook-wire boundary: reads Gemini-named usageMetadata from the HookGenerateContentResponse wire to produce neutral UsageStats; AST-context: function body only |

### Expected entries at target state (added by migration slices)

- `packages/agents/src/core/streamRequestHelpers.ts` — G3 hook-wire
  `toGeminiContents` adapter — IFF OQ-1a keeps the wire Gemini-shaped
  (AST-context-keyed, NOT file-level). Added by P07/P25.
- `packages/agents/src/core/hookWireAdapter.ts` — the named external-wire
  mapping functions ONLY (AST-context-keyed; Major 3). Added by P07, extended
  P13, finalized P31.
- `packages/agents/src/api/event-types.ts` / `event-schema.ts` — declared
  public usage type (committed §7A option C). Added by P19.
- `packages/agents/src/api/eventAdapter.ts` — the
  `usageStatsToPublicUsageMetadata` mapper module (committed option-(C)
  boundary mapper). Added by P19.
- **NOTE:** `packages/agents/src/core/turnLogging.ts` is NOT allow-listed —
  OQ-3t is COMMITTED NEUTRAL (turnLogging.ts must carry ZERO Gemini usage
  keys).
- Test allow-list: the named characterization tests (added by P28/P30).

### P31 — External hook-wire characterization tests

These tests intentionally construct the public hook JSON wire contract. They
exercise the named production boundary adapters and are not agents-internal
model fixtures.

| File                                                                        | Subkind                 | Context Pattern | Justification                                                                                         |
| --------------------------------------------------------------------------- | ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/agents/src/core/__tests__/directMessage.characterization.test.ts` | `test-structural-allow` | `hook-wire`     | Characterizes AfterModel `llm_response` wire modification through the direct-message boundary adapter |
| `packages/agents/src/core/chatSession.hook-control.test.ts`                 | `test-structural-allow` | `hook-wire`     | Characterizes BeforeModel blocking `llm_response` wire conversion                                     |
| `packages/agents/src/core/chatSession.issue1749.test.ts`                    | `test-structural-allow` | `hook-wire`     | Regression coverage for hook-provided `llm_response` wire conversion                                  |
| `packages/agents/src/core/__tests__/hookWireAdapter.test.ts`                | `test-structural-allow` | `hook-wire`     | Direct characterization of the named external hook JSON-wire adapter                                  |

### P31 — Legacy rejection tests (precise context-allowlist)

These tests construct intentionally malformed/legacy Google-shaped fixtures
inside named test blocks to prove that `getValidatedAfcHistory` rejects them
(fail-closed). The keyword auto-exemption was removed; these are now allowed
via exact file + context-pattern entries (the enclosing `it` block label
identifies the rejection test).

| File                                                              | Subkind                 | Context Pattern                                              | Justification                                                                                     |
| ----------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `packages/agents/src/core/__tests__/afcHistoryValidation.test.ts` | `test-structural-allow` | `rejects ENTIRE payload when any entry lacks a blocks array` | Constructs legacy `{role,parts}` to prove validation rejects non-IContent entries (fail-closed)   |
| `packages/agents/src/core/__tests__/afcHistoryValidation.test.ts` | `test-structural-allow` | `returns undefined when ALL entries are malformed`           | Constructs legacy `{role,parts}` to prove validation rejects all-malformed payloads (fail-closed) |
