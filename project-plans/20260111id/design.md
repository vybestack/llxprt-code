# Canonical Tool ID Design (Cross-Provider, Deterministic)

## Goal
Create a single, cross-provider tool call ID format that is deterministic, collision-safe, and compatible with all provider constraints (Anthropic, OpenAI, OpenAI Responses, Kimi K2, Mistral). Eliminate point-to-point conversions by normalizing once at ingestion and mapping only canonical → provider format at the edge.

## Current State (Key Touchpoints)
- History ingestion uses `ContentConverters.normalizeToHistoryId` to strip known prefixes and preserve suffixes (lossless but not sanitized).
- Provider-specific formatting:
  - `OpenAIProvider.normalizeToHistoryToolId` / `normalizeToOpenAIToolId` for OpenAI/Qwen.
  - `OpenAIVercelProvider` uses `normalizeToHistoryToolId` / `normalizeToOpenAIToolId` + `ToolIdStrategy` for Kimi/Mistral.
  - `OpenAIResponsesProvider` uses `normalizeToOpenAIToolId` for `function_call` / `function_call_output`.
  - `AnthropicProvider.normalizeToAnthropicToolId` for `tool_use` / `tool_result`.
- `ToolIdStrategy` introduces model-specific ID formats:
  - Kimi K2: `functions.{toolName}:{index}`
  - Mistral: 9-char alphanumeric

Problem: history suffixes preserve provider-specific characters (Kimi `:`/`.`), which violate Anthropic’s stricter `^[a-zA-Z0-9_-]+$` rule when switching.

## Proposed Canonical Format
### Canonical ID (history storage)
- Use a deterministic, collision-safe canonical ID on ingestion.
- Format: `hist_tool_${id}` where `${id}` is base64url (or base32) of a hash.
- Allowed chars: `[a-zA-Z0-9_-]` (Anthropic-safe).
- Length: 24–32 chars (enough entropy, short enough for readability).

### Canonicalization Function
```
canonicalToolId({
  providerName,
  rawId,
  toolName,
  turnKey,
  callIndex
}) => hist_tool_${base64url(sha256("${providerName}|${rawId}|${toolName}|${turnKey}|${callIndex}"))[:24]}
```
Notes:
- `providerName` prevents collisions across providers.
- `rawId` retains provider identity even if malformed.
- `toolName` and indices ensure stable pairing when raw IDs are missing or duplicated.
- `turnKey` is a stable per-turn identifier (not derived from mutable history order).

## Deterministic Turn Keys
- Introduce a per-turn stable ID in history (e.g., `turnId` stored in `IContent.metadata`).
- `turnKey` should be preserved through replay and provider switches.
- Avoid relying on array indices since history ordering can change under compression, retries, or pruning.

## Where Canonicalization Happens
### Ingestion Layer (History)
- Replace `ContentConverters.normalizeToHistoryId` with `canonicalizeToolCallId` and `canonicalizeToolResponseId`.
- Persist only canonical IDs in `ToolCallBlock.id` and `ToolResponseBlock.callId`.
- Store original raw ID + provider metadata in `metadata` if needed for debugging (not required for pairing).

### Scheduler
- Scheduler consumes canonical IDs only. No changes required if IDs are already canonical.

## Provider Output Mapping
All providers should map **canonical → provider-specific** format only, no reverse conversion needed.

### OpenAI (Chat Completions)
- Convert `hist_tool_*` → `call_*` by stripping prefix and adding `call_`.
- No further sanitization required (canonical already safe).

### OpenAI Responses
- Same as OpenAI: `call_id` uses canonical suffix with `call_` prefix.

### Anthropic
- Convert `hist_tool_*` → `toolu_*` by stripping prefix and adding `toolu_`.
- No sanitization required (canonical already safe).

### Kimi K2
- `ToolIdStrategy` still required for format `functions.{toolName}:{index}`.
- Mapper should map **canonical IDs** to Kimi IDs deterministically using the request tool call order.
- Canonical IDs remain in history; only Kimi output uses mapped ID.

### Mistral
- `ToolIdStrategy` used to map canonical IDs to strict 9-char IDs.
- Mapping stored in strategy-local table keyed by canonical ID to preserve pairing.
- Collision handling must be explicit (rehash with salt or maintain a fallback map).

## Determinism & Collision Safety
- Hash-based IDs are deterministic per `(provider, rawId, toolName, turnKey, callIndex)`.
- Collision probability negligible (sha256 truncated to 24 chars base64url gives ~144 bits).
- Mistral mapping requires explicit collision detection and fallback since 9-char base62 is smaller.

## Handling Missing/Invalid IDs
- If provider gives no ID, canonicalizer produces stable ID using `(provider, toolName, turnKey, callIndex)`.
- If `toolName` is absent, fall back to a stable placeholder (e.g., empty string) and require `callIndex` to disambiguate.
- Responses without raw IDs should use a position-based matcher to resolve the canonical ID of the corresponding call.

## Legacy Compatibility
- Canonicalization should be idempotent for existing canonical IDs (`hist_tool_*`).
- If legacy IDs are encountered, canonicalize once and preserve a mapping for paired responses within the same turn.

## Integration Points (Concrete)
- `ContentConverters.normalizeToHistoryId` → replace with canonicalizer (with stable `turnKey`).
- `HistoryService.getIdGeneratorCallback()` should generate canonical IDs (no timestamp/random).
- `ToolIdStrategy` should consume canonical IDs (no special handling needed except for Kimi/Mistral mapping).
- `normalizeToOpenAIToolId`, `normalizeToAnthropicToolId` become trivial prefix transformers.

## Testing Plan (High-Level)
- Unit: canonicalizer determinism, collision avoidance with differing inputs.
- Integration: cross-provider switch (Kimi → Anthropic) uses canonical IDs and yields Anthropic-safe tool_use/tool_result.
- Mistral mapping: canonical → 9-char mapping stable across tool_call/tool_response with collision handling.
- Responses API: `function_call` and `function_call_output` IDs match.
- Replay stability: tool IDs remain consistent across history compression and replay.

## Expected Benefits
- Single canonical ID format, no point-to-point conversions.
- Provider-specific constraints met at the edge with simple prefixing or mapping.
- Deterministic pairing across provider switches without sanitization drift.
