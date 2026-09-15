# Plan: Neutral versioned v2 hook wire format + provider-owned finish reasons

Plan ID: PLAN-20260914-HOOKWIREV2
Issue: #2624 (part of #2614; depends on #2623 — verified landed: `packages/core/src/code_assist/` absent on this branch)
Branch: `issue2624`

## Verified current state (drift corrections vs. issue text)

The issue was written against July 2026 line numbers. The tree has drifted; these
corrections are verified against the CURRENT head and supersede the issue's line refs:

- `DEFAULT_GEMINI_FLASH_MODEL` in hookTranslator.ts is now named `HOOK_FALLBACK_MODEL`
  (value still `'gemini-2.5-flash'`), with a comment naming subissue B (#2624) as its
  deleter. No naming-allowlist entry exists for it (rename already removed the entry).
- The streaming BeforeModel fire site now lives in `packages/agents/src/core/beforeModelHookFire.ts`
  (`fireBeforeModelEvent({contents, tools})` at ~line 92), not StreamProcessor.ts.
- BeforeToolSelection fire sites: `streamRequestHelpers.ts:133`, `TurnProcessor.ts:818`,
  `DirectMessageProcessor.ts:614` — all pass the bare tools array.
- AfterModel fire sites: `StreamProcessor.ts:750`, `DirectMessageProcessor.ts:787`.
- Naming allowlist entries to remove live at
  `packages/agents/src/core/__tests__/providerAgnosticNamingAllowlist.ts` lines 158
  (hookWireAdapter::mapGeminiFinishReason), 162-163 (finishReasons.test.ts map entries —
  die with the test rewrite), 164 (modelEnvelope::GEMINI_FINISH_MAP).
- `OpenAIStreamProcessor.ts` calls `mapFinishReasonToStopReason` at :665 (not 608);
  `OpenAIStreamProcessorState.ts` at :423 and :469.
- cli `streamUtils.ts` already consumes canonical finishReason + rawStopReason (the
  RECITATION/BLOCKLIST/SPII messaging) — only its upstream metadata feed changes.
- Telemetry `packages/providers/src/logging/streamChunkUtils.ts:27-31` reads
  `metadata.finishReason ?? metadata.stopReason` as raw string — must switch to the
  canonical field only.
- openai `finishReasonMapping.ts` exports `mapFinishReasonToStopReason` (single export).
- Integration fixtures with v1 shapes: `integration-tests/hooks-system.test.ts:320-340`
  (llm_request.messages), `:488-500` (llm_response.candidates), `:545-560`
  (toolConfig mode ANY). Additional scripted-response fixtures may exist in
  `integration-tests/hooks-system.*.responses` — audit all of them for
  llm_request/llm_response/toolConfig shapes during Step 5.

## Accepted behavior (acceptance criteria)

### AC-A — Provider-owned finish reasons (typed IContent.metadata contract)

1. `ContentMetadata` in `core/src/services/history/IContent.ts`:
   - `finishReason?: CanonicalFinishReason` (typed; doc: REQUIRED on terminal
     chunks from every provider — behavioral contract, not a TS-required field,
     because ContentMetadata is shared with non-terminal content),
   - `rawStopReason?: string` (provider-native, diagnostics),
   - `stopReason` field DELETED (no re-export, no alias).
2. OpenAI family (`packages/providers/src/openai/finishReasonMapping.ts` rewritten):
   emits `{finishReason: CanonicalFinishReason, rawStopReason}`. Mapping:
   stop→stop, length→max_tokens, tool_calls→tool_calls,
   function_call→tool_calls, content_filter→safety, refusal→refusal,
   Responses-API statuses completed→stop, incomplete→max_tokens, failed→error.
   Unmapped/unknown → `'other'` with rawStopReason preserved (replaces the
   return-raw fallthrough). openai-vercel routes through it
   (`vercelMetadataMapper.ts` stamps `metadata.finishReason` via the shared
   mapping — hyphenated `'tool-calls'` must normalize to `tool_calls`).
   All 4 call sites updated: OpenAINonStreamHandler.ts:355,
   OpenAIStreamProcessor.ts:665, OpenAIStreamProcessorState.ts:423,469,
   parseResponsesStream.ts:449.
3. Anthropic (`AnthropicResponseParser.ts:182` area): stamps canonical
   `finishReason` + `rawStopReason` (end_turn→stop, max_tokens→max_tokens,
   tool_use→tool_calls, refusal→refusal, stop_sequence→stop; pause_turn/tool_use
   etc. per table; unknown→other).
4. Gemini (`geminiResponseMapper.ts` createGeminiResponseMapper): NEW behavior —
   reads `response.candidates[0].finishReason`, maps via a provider-local table
   (relocated from finishReasons.ts GEMINI_FINISH_MAP) to canonical, stamps
   `metadata.finishReason`/`rawStopReason` on the LAST chunk it emits for the
   response (terminal chunk). Behavioral test required.
5. `core/src/llm-types/finishReasons.ts`: three maps + three wrapper fns +
   `mapWithTable` DELETED. KEEP `CanonicalFinishReason`, `FinishInfo` (if still
   used — else delete), `CANONICAL_FINISH_REASONS`, `isCanonicalFinishReason`.
6. `core/src/llm-types/modelEnvelope.ts` `toModelStreamChunk`: reads typed
   `meta?.finishReason` (canonical, already canonical — pass through) +
   `meta?.rawStopReason`; `tryAllMappers` DELETED.
7. Ripples updated in the same PR: telemetry streamChunkUtils (canonical values
   only — CHANGELOG note for log consumers), provider tests asserting
   `end_turn`/`tool_use`, `validateStreamCompletion` MALFORMED check reads
   rawStopReason (semantics unchanged), compression diagnostics
   (OneShotStrategy.ts:315-380, MiddleOutStrategy.ts — switch to
   finishReason/rawStopReason), OpenAIStreamProcessor debug logs.

### AC-B — v2 hook wire format

1. v2 request envelope (BeforeModel input, BeforeToolSelection input):
   `{version: 2, model: string, contents: IContent[], tools?: ToolDeclaration[],
   settings?: ModelGenerationSettings}` — field names identical to
   `ModelGenerationRequest` (core/src/llm-types/modelRequest.ts); `contents`
   omitted/empty for BeforeToolSelection (tools populated).
2. v2 response payload (AfterModel input `llm_response`, and hook-returned
   responses): `{version: 2, content: IContent, finishReason?:
   CanonicalFinishReason, rawStopReason?: string, usage?: UsageStats}`.
   `finishReason` optional on the wire (AfterModel fires per chunk;
   non-terminal chunks carry none).
3. BeforeToolSelection output: `hookSpecificOutput.toolChoice?: ToolChoice`
   (existing neutral type: `{mode: 'auto'|'required'|'none',
   allowedToolNames?: string[]}`). Gemini AUTO|ANY|NONE vocabulary and
   `allowedFunctionNames` DELETED. Migration: ANY→required, NONE→none,
   AUTO→auto, allowedFunctionNames→allowedToolNames. Aggregation
   (hookAggregator.mergeToolSelectionOutputs) preserves none-wins +
   allowlist-intersection semantics over the single toolChoice field.
4. From-hook full-fidelity decode: hook-returned llm_request replaces
   `contents: IContent[]` directly (v2 decode, zod-validated); hook-returned
   llm_response is `content: IContent` (+optional finishReason/rawStopReason/
   usage). Tool calls/thinking blocks in hook replacements are PRESERVED
   (security note: hooks are trusted extension seams — documented in docs).
5. `hookEventHandler.ts` fire signatures accept typed v2 envelopes and stamp
   `version: 2` centrally (no call site can forget it).
6. `hookValidators.ts` rewritten against v2 envelopes; BeforeToolSelection
   input is now an OBJECT (fixes the latent array-vs-object isObject failure).
7. `hookRunner.applyBeforeModelOutput` merges `Partial` v2 request shapes.
8. `llm_request_boundary` zod schema: `version: z.literal(2).optional()`,
   indices interpreted over `contents`. Parse-result semantics (absent/valid/
   malformed, onInvalidBoundary) unchanged.
9. v1 DTOs DELETED: `HookPart`, `HookContent`, `HookGenerateContentConfig`,
   `HookFinishReason`, `HookGenerateContentParameters`, `HookCandidate`,
   `HookGenerateContentResponse`, `HookFunctionCallingConfig`,
   `HookSdkToolConfig`, `LLMRequest`, `LLMResponse`, `HookToolConfig`,
   the `HookTranslator` abstract class + `HookTranslatorGenAIv1` +
   `defaultHookTranslator` (the whole dead to-hook direction dies; from-hook
   direction becomes v2 zod validation/decode). No dual emission, no v1
   fallback decode.
10. `hooks/index.ts` barrel updated (deleted symbols removed, v2 names exported).

### AC-C — partUtils cleanup

`getResponseText` + `LegacyGenerateContentResponseLike` DELETED from
`core/src/utils/partUtils.ts`. `LegacyPartLike`/`partToString` REMAIN
(subissue E owns them).

### AC-D — Gate cleanup

Naming allowlist entries removed: hookWireAdapter::mapGeminiFinishReason,
finishReasons.test.ts::GEMINI_FINISH_MAP + mapGeminiFinishReason (dies with
test rewrite), modelEnvelope::GEMINI_FINISH_MAP. Zero NEW hook-related
allowlist entries added.

### AC-E — Tests + docs

1. Behavioral round-trip tests per hook event type on v2 (BeforeModel
   modify/synthetic, AfterModel modify, BeforeToolSelection toolChoice).
2. Tool-call-preserving replacement tests (a hook replacement containing
   tool_call blocks survives into the provider request).
3. None-wins toolChoice merge tests (aggregation semantics).
4. Per-provider terminal-chunk finishReason behavioral tests (openai,
   openai-vercel incl. hyphenated 'tool-calls', anthropic, gemini NEW).
5. Integration fixtures updated to v2 payloads; integration tests pass.
6. `docs/hooks/api-reference.md`, `docs/hooks/index.md`,
   `docs/hooks/writing-hooks.md` rewritten for v2 with a migration table keyed
   on ACTUAL v1 emissions (input side was already `{contents}`; output side
   moves from candidates[].content.parts / messages to content / contents).
   CHANGELOG breaking-change entry (hook wire v2 + canonical finish-reason
   telemetry values).

### Acceptance greps (must all return nothing)

```bash
grep -rnE "\bHookPart\b|\bHookContent\b|HookGenerateContent|\bHookToolConfig\b|HookSdkToolConfig" packages/*/src --include='*.ts' | grep -v test
grep -rnE "\bgetResponseText\b|LegacyGenerateContentResponseLike" packages/*/src --include='*.ts' | grep -v test | grep -v getResponseTextFromBlocks
grep -rnE "GEMINI_FINISH_MAP|OPENAI_FINISH_MAP|ANTHROPIC_STOP_MAP|tryAllMappers|mapGeminiFinishReason|mapOpenAIFinishReason|mapAnthropicStopReason" packages/*/src --include='*.ts'
```

## Out of scope (hard)

- Which hook events exist / trigger semantics.
- `partToString`/`LegacyPartLike`/summarizer (subissue E).
- Public agent-API usage-metadata wire (`eventAdapter.ts` UsageMetadataValue) (E).
- `ContentGenerator` neutralization (#2616/#2618).
- `DEFAULT_GEMINI_FLASH_MODEL` deletion (E owns the constant elsewhere; here we
  only remove hookTranslator's usage via the translator rewrite).
- No new .js files, no vitest/node tests — TS/Bun only.
- No OCR runs (disabled by Andrew until re-enabled).

## Phases

### Phase 1 — metadata contract + provider-owned mapping (AC-A)

Test-first:
1. RED: provider behavioral tests asserting terminal-chunk
   `metadata.finishReason` (canonical) + `metadata.rawStopReason` per provider:
   - openai chat-completions (stop/length/tool_calls/content_filter/unknown)
   - openai responses-API statuses (completed/incomplete/failed)
   - openai-vercel (incl. raw 'tool-calls' → tool_calls)
   - anthropic (end_turn/max_tokens/tool_use/stop_sequence/unknown)
   - gemini (STOP/MAX_TOKENS/SAFETY/RECITATION/MALFORMED_FUNCTION_CALL — NEW)
2. RED: `toModelStreamChunk` test — canonical metadata.finishReason passes
   through, rawStopReason honored, no probing.
3. GREEN: type ContentMetadata (finishReason: CanonicalFinishReason,
   rawStopReason; delete stopReason); rewrite openai finishReasonMapping.ts;
   update its 4 call sites; anthropic parser; gemini mapper terminal-chunk
   stamping (provider-local map under providers/src/gemini/); delete maps +
   wrappers + tryAllMappers from finishReasons.ts/modelEnvelope.ts.
4. Update ripples: streamChunkUtils telemetry, compression diagnostics,
   OpenAIStreamProcessor debug logs, streamValidationHelpers raw field reads,
   provider tests asserting end_turn/tool_use, hookWireAdapter is NOT touched
   yet (Phase 2 rewrites it wholesale).

### Phase 2 — v2 DTOs + core hooks rewrite (AC-B.9/B.10, validators, eventHandler)

1. RED: v2 decode tests (zod) for from-hook request/response; boundary schema
   v2; validator tests incl. BeforeToolSelection object-envelope.
2. GREEN: rewrite hookTranslator.ts as v2 (delete Gemini DTOs + dead to-hook
   direction + HOOK_FALLBACK_MODEL + 15-through-5 cast); rewrite types.ts
   (BeforeModelInput/Output, AfterModelInput/Output,
   BeforeToolSelectionInput/Output on v2 shapes; getSyntheticResponse/
   getModifiedResponse return v2; applyLLMRequestModifications over v2);
   hookEventHandler typed v2 envelopes + central version stamping;
   hookValidators v2; hookAggregator over toolChoice; hookRunner
   applyBeforeModelOutput v2 merge; hooks/index.ts barrel.
3. finishReasons.test.ts rewritten (canonical-only surface).

### Phase 3 — agents-side rewrite (AC-B call sites)

1. RED: hookWireAdapter v2 tests (modified/synthetic responses as v2 content);
   applyRequestModifications tests (no Gemini round-trip; tool-call-preserving
   replacement); fire-site envelope tests (version stamped).
2. GREEN: hookWireAdapter.ts rewritten (deletes mapGeminiFinishReason usage;
   neutral usage fields); streamRequestHelpers applyRequestModifications on
   IContent[] directly (delete ContentConverters double conversion; update H2/F1
   comments); beforeModelHookFire/StreamProcessor/DirectMessageProcessor/
   TurnProcessor fire sites construct v2 envelopes; applyToolConfigModifications
   (3 sites) + getModifiedResponse (3 sites) v2 shapes.

### Phase 4 — partUtils + gates (AC-C, AC-D)

Delete getResponseText + LegacyGenerateContentResponseLike; remove the four
allowlist entries; run the naming gate + agents-neutral gate to confirm zero
hook-related exemptions.

### Phase 5 — integration fixtures + docs + CHANGELOG (AC-E.5/E.6)

Convert integration-tests/hooks-system.* fixtures to v2; rewrite docs/hooks
api-reference.md/index.md/writing-hooks.md with migration table; CHANGELOG
breaking-change entry.

## Verification cycle (after every phase batch + before push)

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"
```

Plus the three acceptance greps above, and:

```bash
grep -rn "stopReason" packages/core/src/services/history/IContent.ts  # must not appear as a ContentMetadata field
```

## Review

deepthinker compliance review (1 round + at most 1 remediation round).
OCR is DISABLED per Andrew's standing instruction — do not run it.
