# Plan: Delete DEFAULT_GEMINI_* constants and dead utilities; neutral FakeProvider fixtures + internal telemetry vocabulary

Plan ID: PLAN-20260826-ISSUE2627
Generated: 2026-08-26
Issue: #2627 (part of umbrella #2614)
Branch: issue2627

## Preflight Verification (completed 2026-08-26)

All evidence in the issue verified against the working tree at `main`:

- Constants defined at `packages/core/src/config/models.ts:7-11`; barrel-exported at
  `packages/core/index.ts:10-13`; imported/re-exported at
  `packages/core/src/config/config.ts:28,1020`; alias `DEFAULT_FLASH_MODEL` at
  `packages/core/src/config/index.ts:30,35` (zero consumers).
- `packages/cli/src/config/providerModelResolver.ts:7,103` — level-6 gemini fallback
  `DEFAULT_GEMINI_MODEL`. `GeminiProvider.getDefaultModel()` returns `'gemini-2.5-pro'`
  (`GeminiProvider.ts:184-186`). `resolveApprovalAndProvider`
  (`packages/cli/src/config/config.ts:118-156`) receives `runtimeState: BootstrapRuntimeState`
  which has `providerManager: ProviderManager` with sync `getProviderByName` (ProviderManager.ts:557).
- `packages/core/src/utils/summarizer.ts:13,92` — passes `DEFAULT_GEMINI_FLASH_LITE_MODEL`;
  `llmSummarizer` at :58-63 has zero external consumers (grep-verified: only its own definition).
  Caller: `CoreShellToolHostAdapter.trySummarizeOutput` (`tools-adapters/CoreShellToolHostAdapter.ts:219`).
  Config exposes `getSettingsService()` (config.ts:384).
- `packages/cli/src/ui/hooks/usePromptCompletion.ts:11,135` — same pattern.
  `PromptCompletionRuntime.getEnablePromptCompletion` defined in `ui/cliUiRuntime.ts:420`.
- `packages/core/src/utils/llm-edit-fixer.ts` — zero importers (only a doc-comment mention at
  `clientContract.ts:20`). `AgentClientContract.generateJson` has a live caller
  (`agents/src/api/agentImpl.ts`) and STAYS.
- `packages/providers/src/logging/ProviderContentExtractor.ts` — zero callers; only its two
  allowlist entries (`providerAgnosticNamingAllowlist.ts:103-104`).
- `packages/core/src/utils/errorParsing.ts:15,43,52,57,197` — DEFAULT_GEMINI_MODEL defaults.
  All production callers go through `getErrorFallbackModel` (`cli/src/utils/apiErrorFormatting.ts:32`)
  which returns the actual config model (or undefined for non-gemini providers).
- `packages/core/src/hooks/hookTranslator.ts:8,338-339,423` — DEFAULT_GEMINI_FLASH_MODEL.
- `packages/a2a-server/src/config/config.ts:21,83` — DEFAULT_GEMINI_EMBEDDING_MODEL embedding
  default. Test title at `config.test.ts:171` contains the constant name.
- Fixture corpus: exactly 22 legacy `{"method","response"}`-shaped files (21 `hooks-system.*`
  + `flicker-detector.max-height.responses`); `hooks-system.before-tool-selection.responses`
  and both `json-output.*.responses` are already chunks-format (format-detection verified).
- FakeProvider decode machinery at `FakeProvider.ts:24-25,36-53,89-206,211-226`;
  `FakeProvider.test.ts` has three legacy-format tests (`supports legacy method/response
  fixture lines`, `preserves stopReason for metadata-only legacy candidates`,
  `throws on invalid legacy response payloads`).
- Telemetry type at `packages/telemetry/src/telemetry/types/usage-metadata.ts:24-34`;
  ApiResponseEvent reads at `api-events.ts:119-124`; `ServerUsageMetadataEvent` at
  `core/src/core/turn.ts:259-267`; `RuntimeUsageMetadata` at
  `core/src/runtime/AgentRuntimeContext.ts:151,311-320`; bridge construction at
  `core/src/runtime/runtimeAdapters.ts:91-97`; openai UI chain
  `providers/src/openai/getOpenAIProviderInfo.ts:47-52` →
  `cli/src/ui/contexts/OpenAIProviderContext.tsx:28-88` →
  `cli/src/ui/components/ContextUsageDisplay.tsx:11-21`; `useGemini` local const at
  `telemetry/src/telemetry/events/session-events.ts:32,48` (allowlist pair
  `telemetry/src/telemetry/events/session-events.ts::useGemini` exists);
  `eventAdapter.ts` UsageMetadata case at :323-324 uses bare `value as UsageMetadataValue`.
- Carve-out consumers verified: `eventAdapter.ts:237-249` (usageStatsToPublicUsageMetadata),
  `event-schema.ts:41-46`, `event-types.ts:32-36`, `agentEventDispatcher.ts:424-425`,
  `zedIntegration.ts:674-682` (passes public-wire usage into `buildUsageUpdate`),
  `zed-helpers.ts:307-327` (`buildUsageUpdate` reads `totalTokenCount`/`candidatesTokenCount`
  from the public-wire shape — internal helper, must be neutralized with the Gemini read kept
  inside zedIntegration.ts to satisfy the acceptance grep), hook wire (`hookTranslator.ts:93-95,153-155,474-477`,
  `hookWireAdapter.ts:67-76`), gemini SDK readers (`geminiResponseMapper.ts`, `neutralConverters.ts`),
  `code_assist`, `backendMetrics.ts`.
- `ProviderContentGenerator.generateContent` throws unconditionally
  (`providers/src/ProviderContentGenerator.ts:47-58`) — confirms the dead-feature analysis.
- Allowlist entries naming DEFAULT_GEMINI_*/DEFAULT_FLASH_MODEL (prune all except
  `core/src/hooks/hookTranslator.ts::../config/models.js::DEFAULT_GEMINI_FLASH_MODEL`):
  pairs :52-57; import tuples :169-199 region (incl. already-stale `contentGenerator.ts` and
  `runtimeStateFactory.ts` entries — no actual imports remain) and :222-226 region incl.
  a2a entries; export tuples :222-226. `providerAgnosticNaming.test.ts:822-861` export-tuple
  fixtures use the dying `DEFAULT_FLASH_MODEL` alias and must switch to a surviving tuple
  (e.g. `providers/src/index.ts::./gemini/GeminiProvider.js::GeminiProvider::GeminiProvider`).
  `scripts/genai-enclave/config.ts:176-243` name entries for the constants.

## Requirements / Acceptance Criteria

### REQ-001: Zero DEFAULT_GEMINI_*/DEFAULT_FLASH_MODEL constants
- GIVEN the repo, WHEN `grep -rnE "DEFAULT_GEMINI|DEFAULT_FLASH_MODEL" packages scripts
  --include='*.ts' --include='*.tsx' --exclude-dir=dist --exclude-dir=node_modules` runs,
  THEN it returns nothing.
- The four constants, the `DEFAULT_FLASH_MODEL` alias, barrel lines, and re-exports are
  deleted. `PLACEHOLDER_MODEL`, `UNCONFIGURED_PROVIDER`, `isGemini2Model`, `isGemini3Model`
  stay (F owns relocation).

### REQ-002: CLI model resolution sources the gemini default from the provider
- `resolveProviderAndModel` gains a new input (e.g. `providerDefaultModel?: string`)
  consumed ONLY at level 6 (`provider === 'gemini'`).
- `resolveApprovalAndProvider` threads
  `runtimeState.providerManager.getProviderByName('gemini')?.getDefaultModel()`.
- Guardrails: `getAliasDefaultModel`'s `alias !== baseProvider` filter unchanged; level 6
  stays gemini-scoped; precedence UNCHANGED; pinned `'no provider → empty model'` behavior
  (`providerModelPrecedenceParity.test.ts:403-405`) keeps passing.
- Behavior tests: gemini with no configured model → `'gemini-2.5-pro'` (from provider);
  no provider → `''`; non-gemini provider → `''` (unchanged).

### REQ-003: Summarizer honestly disabled without a utility model
- `summarizeToolOutput(text, agentClient, abortSignal, maxOutputTokens?, utilityModel?)`:
  `utilityModel === undefined` → return input unsummarized + one-line info log
  ("summarizeToolOutput enabled but no utilityModel configured — skipping");
  NO `agentClient.generateContent` call.
- `CoreShellToolHostAdapter.trySummarizeOutput` passes
  `this.config.getSettingsService().get('utilityModel')` as string | undefined, with a
  code comment referencing the companion feature issue. The gemini gate in front of the
  call is NOT touched (subissue D owns it).
- `llmSummarizer` deleted.
- Behavioral test: enabled + no utilityModel → passthrough with notice, generateContent
  never called.

### REQ-004: Prompt completion honestly disabled without a utility model
- No `utilityModel` (interim: settings lookup) → hook inert: no request constructed, no
  ghost text. Constant import deleted.

### REQ-005: errorParsing carries no model-name default
- The three `currentModel: string = DEFAULT_GEMINI_MODEL` defaults and the
  `effectiveModel` constant fallback are removed; callers' actual model flows through.
- Edge pinned by test: empty-string model interpolates into the pro-quota message
  (exact expected string asserted).

### REQ-006: a2a-server embedding model explicit-only
- `embeddingModel: DEFAULT_GEMINI_EMBEDDING_MODEL` → `undefined` (matches CLI's
  `embeddingModel: undefined` at `cli/src/config/configBuilder.ts`). Test title updated
  to stop naming the constant.

### REQ-007: hookTranslator interim literal
- Import replaced by literal `'gemini-2.5-flash'` + comment pointing at subissue B.
  Behavior unchanged. (Its allowlist import-tuple entry dies with the import; the pair
  entry `hookTranslator.ts` line stays only if still needed by the gate after the change —
  final state: no DEFAULT_GEMINI identifiers remain, so ALL related allowlist entries die.)

### REQ-008: Test/tooling sweep
- All ~20 agents test files + helpers (`coreToolScheduler.*.test.ts`,
  `subagent-test-helpers.ts`, `subagent.stream-idle.test.ts`, `tool-dispatcher.test.ts`,
  `coreToolScheduler-test-helpers.ts`) use literal `'gemini-2.5-pro'`.
- `flashFallback.test.ts` uses literals.
- Allowlist: prune every DEFAULT_GEMINI_*/DEFAULT_FLASH_MODEL pair/import-tuple/export-tuple
  entry (incl. stale `contentGenerator.ts`/`runtimeStateFactory.ts`/a2a-server entries and
  the ProviderContentExtractor entries); prune `providerAgnosticNaming.test.ts` export-tuple
  fixtures of the dead alias and re-anchor the exact-tuple mutation test on a surviving
  export tuple; prune `scripts/genai-enclave/config.ts` name entries for the constants.

### REQ-009: Dead code deleted
- `packages/core/src/utils/llm-edit-fixer.ts` deleted; `clientContract.ts:20` doc-comment
  line removed. `generateJson` contract member STAYS.
- `packages/providers/src/logging/ProviderContentExtractor.ts` deleted.
- `test ! -f packages/core/src/utils/llm-edit-fixer.ts && test ! -f packages/providers/src/logging/ProviderContentExtractor.ts` passes.

### REQ-010: FakeProvider is IContent-native; fixtures converted
- One-shot conversion script in `scripts/` (deleted after committing converted fixtures)
  keys on FORMAT (`response` envelope presence), not filename; replicates decode semantics
  EXACTLY (usageMetadata → metadata.usage with promptTokens/completionTokens/totalTokens/
  cache_* naming; finishReason lowercased into stopReason; empty-candidates → metadata-only
  chunk; shared usage duplicated onto EVERY candidate; array-valued response lines
  flat-mapped). The 22 legacy fixtures become chunks-format; byte-stable replay.
- FakeProvider: `GeminiContent`/`ContentConverters` imports, `LegacyResponseLine`/
  `LegacyGenerateContentResponse` types, decode pipeline, legacy `normalizeTurn` branch
  deleted. Only `{chunks}` accepted (invalid line → clear error).
- `FakeProvider.test.ts` legacy tests replaced: the legacy-decode assertions move to
  "converted fixture" equivalents only where they still apply (chunks passthrough);
  invalid-line error still tested.
- `grep -rn "GeminiContent\|convertLegacyResponseChunk" packages/providers/src/fake` returns nothing.
- Hooks-system + flicker-detector integration suites pass against converted fixtures
  with identical replayed conversations.
- `core/src/llm-types/geminiContent.ts` NOT deleted (subissue F sequencing).

### REQ-011: Internal telemetry usage vocabulary neutral
Field mapping (telemetry `UsageMetadata` type and all internal ripple):
- promptTokenCount → inputTokenCount
- candidatesTokenCount → outputTokenCount
- cachedContentTokenCount → cachedTokenCount
- totalTokenCount → totalTokenCount (unchanged)
- thoughtsTokenCount → thinkingTokenCount
- toolUsePromptTokenCount → toolUseInputTokenCount
- cacheTokensDetails → cachedTokensDetails; candidatesTokensDetails → outputTokensDetails;
  promptTokensDetails → inputTokensDetails; toolUsePromptTokensDetails → toolUseInputTokensDetails
- trafficType unchanged

Ripple (all in one PR):
- `telemetry/src/telemetry/types/usage-metadata.ts`
- `telemetry/src/telemetry/events/api-events.ts:119-124`
- `core/src/core/turn.ts` ServerUsageMetadataEvent value
- `core/src/runtime/AgentRuntimeContext.ts` RuntimeUsageMetadata (+ its usage at :151)
- `core/src/runtime/runtimeAdapters.ts:91-97`
- `providers/src/openai/getOpenAIProviderInfo.ts` remoteTokenInfo
- `cli/src/ui/contexts/OpenAIProviderContext.tsx` RemoteTokenStats
- `cli/src/ui/components/ContextUsageDisplay.tsx` prop
- `telemetry/src/telemetry/events/session-events.ts` `useGemini` → neutral local name
  (e.g. `usesApiKey`); its allowlist pair entry pruned
- `agents/src/api/eventAdapter.ts` UsageMetadata case: replace bare
  `value as UsageMetadataValue` cast with explicit internal→public field mapping
  (mirror of `usageStatsToPublicUsageMetadata`)
- `cli/src/zed-integration/zed-helpers.ts` `buildUsageUpdate` parameter neutralized
  (`totalTokenCount`/`outputTokenCount`); `zedIntegration.ts` maps public-wire Gemini reads
  (carve-out file) into the neutral input
- Tests updated: `core/src/core/__tests__/serverUsageMetadataEvent.shape.test.ts`,
  `core/src/telemetry/loggers.basic.test.ts`, telemetry/agents/cli test suites referencing
  the renamed fields

Carve-outs untouched: `eventAdapter.ts` public mappers/docs, `event-schema.ts`,
`event-types.ts`, `agentEventDispatcher.ts`, `zedIntegration.ts` public-wire reads,
`hookTranslator.ts`/`hookWireAdapter.ts` hook wire, `providers/src/gemini/` SDK readers,
`code_assist/`, `backendMetrics.ts`, the characterization spec.

Acceptance grep returns nothing:
```
grep -rnE "promptTokenCount|candidatesTokenCount|cachedContentTokenCount" packages/*/src \
  --include='*.ts' --include='*.tsx' | grep -v test | \
  grep -vE "eventAdapter|event-schema|event-types|agentEventDispatcher|zedIntegration|hookTranslator|hookWireAdapter|providers/src/gemini/|code_assist|backendMetrics"
```

### REQ-012: Behavioral token-flow tests
- Test A: nonzero token counts flow provider → ApiResponseEvent → cli dispatcher after
  the rename (guards the optional-fields silent-zero hazard).
- Test B: internal usage event → public-wire mapping emits Gemini-named
  `{promptTokenCount, candidatesTokenCount, totalTokenCount, ...}` from the renamed
  internal type (guards the eventAdapter mapping; extends/pins the characterization spec).

### REQ-013: Verification
Full cycle green: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

## Hard rules

1. REMOVE, don't shim — no aliasing old constant names, no dual-format fixture decode,
   no old+new telemetry field emission on renamed internal surfaces.
2. No silent wrong behavior — features needing a utility model and lacking one are visibly
   disabled with a notice; never a guessed model name, never silent catch-and-degrade.
3. Scope discipline — no public agent-API wire changes, no hook-wire changes, no gemini SDK
   reader renames, no geminiContent.ts deletion, no utility-model capability building
   (companion issue), no gemini-gate deletion in the summarizer path (subissue D).

## Phases

Single-phase implementation (this is a deletion/rename/wiring issue with enumerated
consumers; no new subsystems). Implementation order inside the phase:

1. Tests first where behavior changes (resolver level-6, summarizer disable, prompt
   completion disable, errorParsing edge, telemetry mapping) — then implementation.
2. Step 1 (constants + rewire) → Step 2 (dead code) → Step 3 (FakeProvider + fixtures) →
   Step 4 (telemetry rename) → Step 5 (acceptance greps + full verification).

## Review findings triage

(Classify as Blocker-Fix / In-scope-Fix / Reject / Defer; reviewer suggestions do not
authorize scope expansion.)
