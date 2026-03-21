# Issue #1572: Decompose AnthropicProvider.ts

## Overview

Decompose `packages/core/src/providers/anthropic/AnthropicProvider.ts` (3,198 lines) into focused, single-responsibility modules following the pattern established by the OpenAI provider decomposition (issue #1570).

### Acceptance Criteria (from issue)

- No single file exceeds 800 lines
- No single function exceeds 80 lines
- All existing tests pass
- Test coverage does not decrease

### Guiding Principles

- **SoC (Separation of Concerns)**: Each module owns exactly one responsibility
- **DRY**: Use shared `providers/utils/` modules instead of private reimplementations
- **Strict TDD**: Each new exported function is introduced through its own RED -> GREEN -> REFACTOR cycle. Large extractions must be split into small behavior slices; do not move hundreds of lines in one GREEN step.
- **Pure functions preferred**: Extracted modules export pure functions, not classes. Functions that would need side effects (logging, sleeping) instead return data structures that the coordinator acts on.
- **Immutability**: Functions return new values rather than mutating inputs. No `void` functions that modify passed-in arrays.
- **Behavioral tests**: Test input->output transformations, not implementation details. Tests describe what behaviors are preserved, not which helper was called.
- **No type assertions**: Do not reproduce the `as any` private-method-access testing pattern. Remove tests that rely on it and replace with behavioral tests on extracted public functions.
- **Function size enforcement**: No newly extracted or created function may exceed 80 lines. This is enforced during each extraction step, not only at final validation.
- **Import convention**: All new imports must follow existing local convention, including `.js` extension style for relative imports.

## Current State

### AnthropicProvider.ts Method Map

| Method | Lines | Size | Concern |
|--------|-------|------|---------|
| Types & helper functions (top-level) | 1-258 | 258 | Types, media conversion, cache control |
| `modelTokenPatterns` (static) | 262-276 | 15 | Model metadata |
| Constructor + logger factories | 277-342 | 65 | Initialization |
| `instantiateClient` | 343-372 | 30 | Client lifecycle |
| `buildProviderClient` | 373-444 | 72 | Client lifecycle |
| `clearAuthCache` | 445-449 | 5 | Auth |
| `getModels` | 450-618 | 169 | Model listing |
| `getCurrentModel` / `getDefaultModel` | 619-707 | 89 | Model info |
| `getMaxTokensForModel` | 708-738 | 31 | Model info |
| `getContextWindowForModel` | 739-761 | 23 | Model info |
| `isPaidMode` / `getServerTools` / `invokeServerTool` | 762-784 | 23 | Provider interface |
| `getToolFormat` | 785-882 | 98 | Tool format detection |
| `normalizeToHistoryToolId` | 883-903 | 21 | Tool ID normalization (DRY target) |
| `unprefixToolName` / `findToolSchema` / `sortObjectKeys` | 904-975 | 72 | Request helpers |
| `mergeBetaHeaders` | 976-995 | 20 | Request helpers |
| **`generateChatCompletionWithOptions`** | **996-2896** | **1,901** | **THE MONSTER -- contains 5+ concerns** |
| `getRetryConfig` | 2897-2910 | 14 | Rate limiting |
| `extractRateLimitHeaders` | 2911-2987 | 77 | Rate limiting |
| `checkRateLimits` | 2988-3041 | 54 | Rate limiting |
| `normalizeToAnthropicToolId` | 3042-3074 | 33 | Tool ID normalization (DRY target) |
| `waitForRateLimitIfNeeded` | 3075-3194 | 120 | Rate limiting |
| `sleep` | 3195-3199 | 5 | Utility |

### Monster Method Breakdown (lines 996-2896)

The 1,901-line `generateChatCompletionWithOptions` contains these distinct concerns:

| Sub-concern | Approx Lines | Description |
|-------------|-------------|-------------|
| Message conversion | 996-1850 (~854) | IContent[] to AnthropicMessage[] with thinking redaction, orphan filtering, same-role merging, tool_use/tool_result adjacency repair |
| System prompt assembly | 1850-2060 (~210) | Core prompt, user memory, MCP instructions, prompt caching markers, beta headers |
| Request body assembly | 2060-2340 (~280) | Thinking config, effort mapping, request overrides, max tokens, tool stabilization |
| Streaming response | 2340-2790 (~450) | SSE event state machine, tool call accumulation, thinking block accumulation, stream retry, cache metrics logging |
| Non-streaming response | 2790-2896 (~106) | Batch response parsing, tool call extraction, usage metadata |

### Shared Utils Currently Used by Anthropic (5 of 17)

- `userMemory.ts`
- `toolResponsePayload.ts`
- `mediaUtils.ts`
- `dumpSDKContext.ts`
- `dumpContext.ts` (type only)

### Shared Utils Anthropic Should Use But Doesn't (DRY debt)

- `toolIdNormalization.ts` -- has `normalizeToHistoryToolId` and `normalizeToOpenAIToolId` but lacks `normalizeToAnthropicToolId`; Anthropic reimplements `normalizeToHistoryToolId` privately
- `cacheMetricsExtractor.ts` -- already handles `cache_read_input_tokens` / `cache_creation_input_tokens` (Anthropic's format); Anthropic reimplements inline in 3 places

## Target Decomposition

### Module Map

```
packages/core/src/providers/anthropic/
  AnthropicProvider.ts              (~700 lines, coordinator)
  AnthropicRateLimitHandler.ts      (~200 lines, NEW)
  AnthropicRequestBuilder.ts        (~650 lines, NEW)
  AnthropicStreamProcessor.ts       (~450 lines, NEW)
  AnthropicResponseParser.ts        (~200 lines, NEW)
  schemaConverter.ts                (291 lines, existing, unchanged)
  usageInfo.ts                      (206 lines, existing, unchanged)
  test-utils/                       (existing, unchanged)
```

### Dependency Rules

These rules prevent circular imports and maintain clean architecture:

1. `AnthropicProvider.ts` (coordinator) may import all Anthropic submodules
2. Submodules must **never** import `AnthropicProvider.ts`
3. Submodules may import from `providers/utils/` (shared utilities)
4. Submodules may import from each other only if one-way and justified:
   - `AnthropicStreamProcessor.ts` may import types from `AnthropicResponseParser.ts` (for shared response types)
   - No other cross-submodule imports
5. If shared Anthropic types are needed by multiple submodules, they live in the module that owns the concept (e.g., `AnthropicMessage` types live in `AnthropicRequestBuilder.ts` since that's where message conversion happens)
6. Prefer `import type` for cross-module type references

### Module Responsibilities

#### 1. `AnthropicRateLimitHandler.ts` (~200 lines)

Responsibility: "Extract rate limit state from response headers and compute wait decisions."

**Exports:**
- `AnthropicRateLimitInfo` interface
- `RateLimitDecision` interface -- `{ shouldWait: boolean; waitMs: number; reason: string }`
- `RateLimitWarning` interface -- `{ level: 'info' | 'warn'; message: string }`
- `extractRateLimitHeaders(headers: Headers): AnthropicRateLimitInfo`
- `getRetryConfig(ephemeralSettings: Record<string, unknown>): { maxAttempts: number; initialDelayMs: number }`
- `calculateWaitTime(info: AnthropicRateLimitInfo, settings: RateLimitSettings): RateLimitDecision` -- pure function returning decision data; coordinator calls `sleep()`
- `evaluateRateLimits(info: AnthropicRateLimitInfo): RateLimitWarning[]` -- returns warnings; coordinator logs them (no logger parameter, truly pure)

**Why separate**: Rate limiting is infrastructure orthogonal to message format. All functions are truly pure -- they return data, never log or sleep.

#### 2. `AnthropicRequestBuilder.ts` (~650 lines)

Responsibility: "Normalize internal history into Anthropic-ready message blocks, and assemble the complete request payload and headers."

**Exports (types):**
- `AnthropicImageBlock`, `AnthropicDocumentBlock`, `AnthropicToolResultContent`, `AnthropicMessageBlock`, `AnthropicMessage`, `CachedAnthropicBlock`
- `MessageConversionOptions`, `SystemPromptOptions`, `ThinkingConfigOptions`, `RequestBodyOptions`, `BetaHeaderOptions`

**Exports (message conversion functions):**
- `mediaBlockToAnthropicImage(media: MediaBlock): AnthropicImageBlock`
- `mediaBlockToAnthropicDocument(media: MediaBlock): AnthropicDocumentBlock`
- `sanitizeBlockForCacheControl(block: ContentBlock, ttl: string): CachedAnthropicBlock`
- `convertToAnthropicMessages(contents: IContent[], options: MessageConversionOptions): AnthropicMessage[]` -- delegates to per-role helpers, each under 80 lines
- `filterOrphanedToolResults(messages: AnthropicMessage[]): AnthropicMessage[]`
- `reorderToolResults(messages: AnthropicMessage[]): AnthropicMessage[]`
- `mergeSameRoleMessages(messages: AnthropicMessage[]): AnthropicMessage[]`
- `mergeOrphanedThinkingBlocks(contents: IContent[]): IContent[]`
- `sanitizeEmptyMessages(messages: AnthropicMessage[]): AnthropicMessage[]`

**Exports (request assembly functions):**
- `buildSystemPrompt(options: SystemPromptOptions): string | Array<{type: string; text: string}>` -- returns new value
- `withPromptCaching(messages: AnthropicMessage[], systemPrompt: unknown, ttl: string): { messages: AnthropicMessage[]; systemPrompt: unknown }` -- returns new copies, never mutates inputs
- `buildThinkingConfig(options: ThinkingConfigOptions): Record<string, unknown>`
- `buildBetaHeaders(options: BetaHeaderOptions): string`
- `buildRequestBody(options: RequestBodyOptions): Record<string, unknown>`

**Private (unexported) helpers:**
- `sortObjectKeys<T>(obj: T): T` -- internal implementation detail, tested indirectly through `buildRequestBody`

**Why combined**: Message conversion and request assembly are tightly coupled -- the request body needs the converted messages. The OpenAI provider splits these into `RequestBuilder` + `RequestPreparation`, but OpenAI has a much larger request preparation concern (Responses API, Completions API, two streaming modes). Anthropic's request assembly is simpler and fits naturally alongside message conversion. If this module grows beyond 800 lines during implementation, split into `AnthropicRequestBuilder.ts` (messages) + `AnthropicRequestPreparation.ts` (request body).

#### 3. `AnthropicStreamProcessor.ts` (~450 lines)

Responsibility: "Process the SSE event stream from Anthropic's API into IContent blocks."

**Exports:**
- `StreamProcessorOptions` interface
- `processAnthropicStream(stream: AsyncIterable, options: StreamProcessorOptions): AsyncGenerator<IContent>` -- delegates to per-event-type handlers, each under 80 lines:
  - Text delta handling
  - Tool call accumulation from `content_block_start` + `input_json_delta`
  - Thinking block accumulation from `thinking_delta`
  - Stop reason / finish handling from `message_delta`
  - Cache metrics extraction (delegates to shared `extractCacheMetrics`)

Uses shared `normalizeToHistoryToolId` from `providers/utils/toolIdNormalization.ts`.
Uses shared `extractCacheMetrics` from `providers/utils/cacheMetricsExtractor.ts`.

**Why separate**: Streaming is a complex stateful concern with its own state machine lifecycle. The OpenAI provider extracts this identically to `OpenAIStreamProcessor.ts` (726 lines).

#### 4. `AnthropicResponseParser.ts` (~200 lines)

Responsibility: "Parse non-streaming Anthropic API responses into IContent blocks and extract usage metadata."

**Exports:**
- `ResponseParserOptions` interface
- `parseNonStreamingResponse(message: Anthropic.Message, options: ResponseParserOptions): IContent` -- delegates to per-block parsers
- `extractUsageMetadata(message: Anthropic.Message): Record<string, unknown>` -- delegates to shared `extractCacheMetrics`

Uses shared `normalizeToHistoryToolId` from `providers/utils/toolIdNormalization.ts`.
Uses shared `extractCacheMetrics` from `providers/utils/cacheMetricsExtractor.ts`.

**Why separate**: Non-streaming response handling is a distinct concern from streaming, exactly as the OpenAI provider splits `OpenAINonStreamHandler.ts` from `OpenAIStreamProcessor.ts`. If this module needs orchestration beyond pure parsing, rename to `AnthropicNonStreamHandler.ts`.

#### 5. `AnthropicProvider.ts` (slimmed coordinator, ~700 lines)

What stays:
- Class declaration and constructor
- Static `modelTokenPatterns`
- Logger factory methods
- Client lifecycle: `instantiateClient`, `buildProviderClient`
- Provider interface overrides: `clearAuthCache`, `getModels`, `getCurrentModel`, `getDefaultModel`, `getDefaultModels`, `getMaxTokensForModel`, `getContextWindowForModel`, `isPaidMode`, `getServerTools`, `invokeServerTool`, `getToolFormat`, `getModelParams`, `isAuthenticated`
- `findToolSchema` (uses provider state -- the tool list)
- `unprefixToolName` -- verified as stateless in current code; if so, move to `AnthropicResponseParser.ts`. If it uses provider state, keep here.
- Thin `generateChatCompletionWithOptions` that orchestrates the extracted modules (~100-150 lines):
  - Calls `convertToAnthropicMessages()` for message conversion
  - Calls `buildRequestBody()` / `buildSystemPrompt()` / etc. for request assembly
  - Calls `processAnthropicStream()` for streaming
  - Calls `parseNonStreamingResponse()` for non-streaming
  - Calls `calculateWaitTime()` and then `sleep()` for rate limiting
  - Calls `evaluateRateLimits()` and then logs the returned warnings
  - Keeps retry loop inline (uses shared `isNetworkTransientError` and `delay`)

### OpenAI Parity Points vs Anthropic-Specific Deviations

**Parity (same pattern as OpenAI):**
- Coordinator class with thin `generateChatCompletionWithOptions`
- Separate stream processor module
- Separate non-stream handler/parser module
- Request builder with message conversion
- Pure functions exported, coordinator is only stateful thing
- Uses shared `toolIdNormalization`, `cacheMetricsExtractor`

**Anthropic-specific deviations (intentional):**
- Thinking block format: `thinking` / `redacted_thinking` content blocks (vs OpenAI's `reasoning_content`)
- Prompt caching: `cache_control` markers on messages and system prompt (OpenAI doesn't have this)
- `tool_use` / `tool_result` adjacency constraints (stricter than OpenAI's tool message format)
- Beta headers: `anthropic-beta` header merging (OpenAI uses standard headers)
- Rate limiting: Anthropic has proactive rate limit headers that OpenAI doesn't expose
- No combined `AnthropicRequestPreparation.ts` -- Anthropic's request assembly is simpler and fits in `AnthropicRequestBuilder.ts`

### DRY Actions

#### Action 1: Extend shared `toolIdNormalization.ts`

Add `normalizeToAnthropicToolId(id: string): string` to `packages/core/src/providers/utils/toolIdNormalization.ts`:
- `hist_tool_xxx` -> `toolu_xxx`
- `call_xxx` -> `toolu_xxx`
- `toolu_xxx` -> `toolu_xxx` (pass-through)
- Empty -> `toolu_` + generated hash (preserving existing behavior)
- Sanitizes invalid characters (replacing with `-`)

Also update Anthropic to use the shared `normalizeToHistoryToolId` instead of its private reimplementation.

#### Action 2: Use shared `extractCacheMetrics`

Replace the 3 inline cache metrics extraction sites in Anthropic with calls to `extractCacheMetrics` from `providers/utils/cacheMetricsExtractor.ts`. The shared function already handles `cache_read_input_tokens` and `cache_creation_input_tokens`.

#### Action 3: Pre-implementation DRY checkpoint

Before extracting any module, search `providers/utils/` for existing:
- Header merge utilities (for `buildBetaHeaders`)
- Sorting/canonicalization helpers (for `sortObjectKeys`)
- Thinking/cache-control sanitizers

If found, use them. If not, keep helpers local and private.

## Execution Plan

Full verification suite after every step:
```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

### Per-Step Definition of Done

Every step must meet ALL of these before proceeding:
1. Target module exists (or shared util is extended)
2. Old provider code for that concern is removed
3. No duplicate logic remains between old and new
4. All old integration tests pass unchanged
5. New behavioral tests pass
6. No file exceeds 800 lines
7. No function exceeds 80 lines
8. Full verification suite passes

### Step 0: Baseline Metrics

Record before starting:
- Total test count and pass rate
- TypeScript error count
- Lint warning count
- Line counts for all files in `providers/anthropic/`

### Step 1: DRY -- Extend Shared `toolIdNormalization.ts`

#### Step 1a: Test `normalizeToAnthropicToolId` (RED)
- Add test cases to `providers/utils/toolIdNormalization.test.ts`:
  - `hist_tool_abc123` -> `toolu_abc123`
  - `call_def456` -> `toolu_def456`
  - `toolu_xyz789` -> `toolu_xyz789` (pass-through)
  - `rawId` -> `toolu_rawId`
  - Empty string -> `toolu_` + hash pattern
  - Sanitizes invalid characters
- Tests fail because function doesn't exist

#### Step 1b: Implement `normalizeToAnthropicToolId` (GREEN)
- Add function to `toolIdNormalization.ts`
- Tests pass

#### Step 1c: Update consumers (REFACTOR)
- Add behavioral test for "Anthropic provider normalizes tool IDs for history" that calls the shared function directly
- Update `AnthropicProvider.ts` to import from shared module
- Remove private `normalizeToAnthropicToolId` and `normalizeToHistoryToolId` methods
- Remove `AnthropicProvider.normalizeToAnthropicToolId.test.ts` (it tested a private method via type assertion -- anti-pattern per RULES.md)
- Verify full suite passes

### Step 2: Extract `AnthropicRateLimitHandler.ts`

#### Step 2a: Test header extraction (RED)
- Create `AnthropicRateLimitHandler.test.ts`
- Test `extractRateLimitHeaders`: parses real header values, handles missing headers, handles malformed dates
- Tests fail because module doesn't exist

#### Step 2b: Implement header extraction (GREEN)
- Create `AnthropicRateLimitHandler.ts` with `AnthropicRateLimitInfo` interface and `extractRateLimitHeaders`
- Tests pass

#### Step 2c: Test rate limit evaluation (RED)
- Test `evaluateRateLimits`: returns warnings at various threshold levels, returns empty array when healthy
- Tests fail

#### Step 2d: Implement rate limit evaluation (GREEN)
- Add `evaluateRateLimits` (returns `RateLimitWarning[]`, no logger -- truly pure)
- Tests pass

#### Step 2e: Test retry config (RED)
- Test `getRetryConfig`: returns defaults, respects ephemeral overrides
- Tests fail

#### Step 2f: Implement retry config (GREEN)
- Add `getRetryConfig`
- Tests pass

#### Step 2g: Test wait time calculation (RED)
- Test `calculateWaitTime`: correct wait times at thresholds, respects maxWaitMs cap, returns `shouldWait=false` when healthy
- Tests fail

#### Step 2h: Implement wait time calculation (GREEN)
- Add `calculateWaitTime` returning `RateLimitDecision`
- Tests pass

#### Step 2i: Wire coordinator (REFACTOR)
- Update `AnthropicProvider.ts` to import from new module
- Remove extracted methods from provider
- Update `waitForRateLimitIfNeeded` in coordinator to:
  - Call `calculateWaitTime` for the decision
  - Call `evaluateRateLimits` and log warnings itself
  - Call `sleep()` itself
- Verify full suite passes

### Step 3: Extract `AnthropicRequestBuilder.ts` (message conversion)

This is the largest extraction. Broken into small behavior slices.

#### Characterization test gate
Before extracting, verify that existing provider-level tests cover these behaviors:
- User content -> Anthropic user message
- Assistant content with tool_calls -> Anthropic assistant message
- Thinking block redaction (strip all, strip but last, include all)
- Orphaned tool_result filtering
- Same-role merging
- tool_use/tool_result adjacency repair

If any behavior is NOT covered by existing provider tests, add a provider-level characterization test first.

#### Step 3a: Test media block conversion (RED)
- Create `AnthropicRequestBuilder.test.ts`
- Test `mediaBlockToAnthropicImage`: converts internal MediaBlock to Anthropic image format
- Test `mediaBlockToAnthropicDocument`: converts internal MediaBlock to Anthropic document format
- Test `sanitizeBlockForCacheControl`: applies cache_control markers
- Tests fail because module doesn't exist

#### Step 3b: Implement media block conversion (GREEN)
- Create `AnthropicRequestBuilder.ts` with types and media conversion functions
- Move `AnthropicImageBlock`, `AnthropicDocumentBlock`, etc. types from top of `AnthropicProvider.ts`
- Tests pass

#### Step 3c: Test basic message conversion (RED)
- Test `convertToAnthropicMessages` for user text -> user message
- Test for assistant text -> assistant message
- Test for tool responses -> user message with tool_result blocks
- Tests fail

#### Step 3d: Implement basic message conversion (GREEN)
- Add `convertToAnthropicMessages` with per-role helper functions (each under 80 lines)
- Tests pass

#### Step 3e: Test thinking block redaction (RED)
- Test "converts assistant thinking blocks according to strip-all redaction policy"
- Test "converts assistant thinking blocks according to strip-all-but-last policy"
- Test "includes all thinking blocks when policy allows"
- Tests fail

#### Step 3f: Implement thinking redaction in conversion (GREEN)
- Add thinking redaction logic to the assistant message conversion helper
- Tests pass

#### Step 3g: Test message sanitization (RED)
- Test `filterOrphanedToolResults`: removes tool_results without matching tool_use
- Test `reorderToolResults`: ensures tool_results follow their tool_use
- Test `mergeSameRoleMessages`: consolidates consecutive same-role messages
- Test `mergeOrphanedThinkingBlocks`: handles split thinking+tool_call patterns
- Test `sanitizeEmptyMessages`: removes empty messages
- Tests fail

#### Step 3h: Implement message sanitization (GREEN)
- Add all sanitization/filtering functions
- Tests pass

#### Step 3i: Test request assembly (RED)
- Test `buildSystemPrompt`: OAuth vs API key, with/without caching
- Test `withPromptCaching`: returns new message array with cache_control markers (immutable)
- Test `buildThinkingConfig`: enabled/disabled, adaptive thinking, effort levels
- Test `buildBetaHeaders`: merges headers correctly
- Test `buildRequestBody`: assembles correct payload from options
- Tests fail

#### Step 3j: Implement request assembly (GREEN)
- Add request assembly functions
- `withPromptCaching` returns new copies of messages/systemPrompt (immutable)
- `sortObjectKeys` stays private (unexported), tested indirectly through `buildRequestBody`
- Tests pass

#### Step 3k: Wire coordinator (REFACTOR)
- Update `AnthropicProvider.ts` to import types and functions from `AnthropicRequestBuilder.ts`
- Remove all extracted code from the monster method
- The monster method now calls `convertToAnthropicMessages()`, `buildSystemPrompt()`, `buildRequestBody()`, etc.
- Verify all existing provider tests pass unchanged
- Verify no file exceeds 800 lines, no function exceeds 80 lines

### Step 4: Extract `AnthropicStreamProcessor.ts` + `AnthropicResponseParser.ts`

#### Characterization test gate
Before extracting, verify existing provider tests cover:
- Text content streaming
- Tool call streaming and accumulation
- Thinking block streaming
- Stream retry on transient errors
- Non-streaming tool call extraction
- Non-streaming usage metadata extraction

If any behavior is NOT covered, add provider-level characterization test first.

#### Step 4a: Test text delta handling (RED)
- Create `AnthropicStreamProcessor.test.ts`
- Test: text content_block_delta events produce text IContent blocks
- Tests fail because module doesn't exist

#### Step 4b: Implement text delta handling (GREEN)
- Create `AnthropicStreamProcessor.ts` with `processAnthropicStream` generator
- Implement text delta handler
- Tests pass

#### Step 4c: Test tool call accumulation (RED)
- Test: content_block_start(tool_use) + input_json_delta events accumulate into tool call IContent
- Tests fail

#### Step 4d: Implement tool call accumulation (GREEN)
- Add tool call accumulation to stream processor
- Uses shared `normalizeToHistoryToolId`
- Tests pass

#### Step 4e: Test thinking delta accumulation (RED)
- Test: thinking_delta events accumulate into thinking IContent blocks
- Tests fail

#### Step 4f: Implement thinking delta accumulation (GREEN)
- Add thinking delta handling
- Tests pass

#### Step 4g: Test stop/finish handling (RED)
- Test: message_delta with stop_reason produces final IContent
- Test: cache metrics extracted from message events (using shared `extractCacheMetrics`)
- Tests fail

#### Step 4h: Implement stop/finish handling (GREEN)
- Add message_delta handler, cache metrics via shared utility
- Tests pass

#### Step 4i: Test non-streaming parsing (RED)
- Create `AnthropicResponseParser.test.ts`
- Test `parseNonStreamingResponse`: text blocks, tool_use blocks with name unprefixing, thinking blocks
- Test `extractUsageMetadata`: token counts including cache metrics
- Test: handles empty/missing content
- Tests fail because module doesn't exist

#### Step 4j: Implement non-streaming parsing (GREEN)
- Create `AnthropicResponseParser.ts`
- Implement per-block parsers (each under 80 lines)
- Uses shared `normalizeToHistoryToolId` and `extractCacheMetrics`
- Tests pass

#### Step 4k: Wire coordinator (REFACTOR)
- Update `AnthropicProvider.ts` to import stream processor and response parser
- Remove extracted streaming/non-streaming code from the monster method
- The monster method now calls `processAnthropicStream()` and `parseNonStreamingResponse()`
- Move `unprefixToolName` to `AnthropicResponseParser.ts` if it is stateless (verify first)
- Verify all existing provider tests pass unchanged
- Verify no file exceeds 800 lines, no function exceeds 80 lines

### Step 5: Final Slim + DRY Pass

#### Step 5a: Verify coordinator size
- Confirm `AnthropicProvider.ts` is under 800 lines
- Confirm no function exceeds 80 lines in any file
- If any violation, split further

#### Step 5b: DRY cleanup
- Verify all 3 inline cache metrics sites use shared `extractCacheMetrics`
- Verify `normalizeToHistoryToolId` and `normalizeToAnthropicToolId` use shared module
- Remove any remaining dead code
- Search for and eliminate any other duplicated logic between new modules and shared utils

#### Step 5c: Full verification
- Run entire verification suite
- Record final metrics and compare with Step 0 baseline
- Verify acceptance criteria:
  - `wc -l` on every file -- none exceeds 800
  - Grep for functions exceeding 80 lines -- none found
  - `npm run test` -- all pass, count matches or exceeds baseline
  - `npm run lint` -- no new warnings
  - `npm run typecheck` -- clean
  - `npm run format` -- clean
  - `npm run build` -- succeeds
  - Smoke test passes

## Test Strategy

### Existing tests are the contract
- Do NOT rewrite existing provider-level tests to target extracted modules
- Only adjust existing tests if they directly import a private method that has moved
- The 4,352-line `AnthropicProvider.test.ts` and all issue-specific test files test through the public `generateChatCompletion()` API -- they must all pass without modification

### New tests supplement, not replace
- New module tests verify pure function behavior in isolation
- They cover edge cases that are difficult to exercise through the full provider
- They use minimal focused fixtures -- do NOT copy large transcript fixtures from provider tests
- Reuse existing test utilities from `test-utils/` where available

### Characterization tests before risky extraction
- Before extracting message conversion (Step 3) or streaming (Step 4), verify existing coverage
- If subtle behavior (thinking redaction, orphan filtering, adjacency repair, stream retry) is not covered by existing tests, add provider-level characterization tests first
- This locks down current behavior before the code moves

### Test naming -- behavior not implementation
Tests should read like:
- "converts user text content to Anthropic user message with text block"
- "redacts all thinking blocks except the last when strip policy is 'all_but_last'"
- "filters tool_result blocks that have no matching tool_use in the conversation"

NOT like:
- "calls mergeOrphanedThinkingBlocks correctly"
- "invokes sanitizeBlockForCacheControl with right parameters"

## Risk Mitigation

### Circular dependency risk
**Risk**: Cross-module imports between new Anthropic modules create cycles.
**Mitigation**: Strict dependency rules (see "Dependency Rules" section). Types live in the owning module. Use `import type` for cross-module type references. If cycles emerge, introduce `AnthropicTypes.ts` as a type-only boundary module.

### Existing test breakage
**Risk**: The large test files break after extraction.
**Mitigation**: These tests call through `provider.generateChatCompletion()` which still delegates to the same logic. The coordinator wires the modules exactly as the monolith did. Only `AnthropicProvider.normalizeToAnthropicToolId.test.ts` needs adjustment (tests private method via type assertion).

### Import path changes
**Risk**: External consumers break.
**Mitigation**: No external consumers import from inside `providers/anthropic/` except through the provider class and `core/index.ts`. The provider class stays in the same file.

### Test fixture duplication
**Risk**: New module tests clone huge Anthropic request/response fixtures.
**Mitigation**: Use minimal focused fixtures for extracted module tests. Reuse `test-utils/` where available. Do not copy large transcript fixtures.

### Import extension drift
**Risk**: New modules use wrong import extension style.
**Mitigation**: Follow existing convention -- all relative imports use `.js` extension.

### Function size violations after extraction
**Risk**: Moving a 200-line function to a new file still violates the 80-line limit.
**Mitigation**: Enforce 80-line limit during extraction (each step), not after. Large functions must be split into delegate helpers during the GREEN phase.

### Public-vs-private coverage drift
**Risk**: Coverage shifts from observable behavior tests to helper-only tests.
**Mitigation**: Existing provider tests remain the primary contract. New module tests are behavioral supplements. Never replace end-to-end provider tests with helper-only tests.

### Mutability violations
**Risk**: Extracted functions mutate input arrays/objects.
**Mitigation**: All functions return new values. `withPromptCaching` returns new message arrays. No `void` functions that modify passed-in data structures.

## Subagent Execution Model

Each step is delegated to subagents:

1. **typescriptexpert** -- Implements the step following strict TDD (RED->GREEN->REFACTOR)
   - Must run full verification suite before returning
   - Must fix any failures before returning
   - Must verify no file exceeds 800 lines and no function exceeds 80 lines
2. **deepthinker** -- Reviews the result for:
   - RULES.md compliance (TDD, pure functions, no `any`, behavioral tests)
   - SoC violations (mixed concerns)
   - DRY violations (reimplemented shared logic)
   - Acceptance criteria
   - Missing test coverage
   - Circular dependency violations
3. **typescriptexpert** -- Remediates any deepthinker findings
4. Loop until deepthinker passes or remaining issues are purely stylistic
