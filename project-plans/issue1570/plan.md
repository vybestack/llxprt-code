# Issue #1570: Break Up OpenAIProvider.ts (4,619 lines)

**Parent issue**: #1568 (0.10.0 Code Improvement Plan)
**Branch**: `issue1570`
**Goal**: Decompose `packages/core/src/providers/openai/OpenAIProvider.ts` from 4,619 lines to ≤800 lines per file, ≤80 lines per function, all tests passing, no coverage decrease.

---

## Architecture Decision: Remove Legacy Path

The `generateLegacyChatCompletionImpl` method (1,459 lines) is a parallel implementation of `generatePipelineChatCompletionImpl` (1,486 lines) that uses inline tool call accumulation instead of the `ToolCallPipeline`. The pipeline mode is mature and handles all cases. The legacy path is removed in Step 1, instantly eliminating ~1,460 lines and the dispatch switch.

**What changes**: The `toolCallProcessingMode` config option (`'legacy' | 'pipeline'`) is removed. The pipeline path becomes the only path. The config field defaults to `'legacy'` today but will be deleted entirely.

**Files affected by legacy removal** (found via grep):
- `packages/core/src/providers/openai/OpenAIProvider.ts` — field, constructor init, dispatch switch, entire method
- `packages/core/src/providers/types/IProviderConfig.ts` — type definition
- `packages/cli/src/config/settingsSchema.ts` — schema definition and type export
- `packages/cli/src/config/settings.ts` — re-export
- `packages/cli/src/providers/providerManagerInstance.ts` — passing config
- `packages/cli/src/config/settings-validation.test.ts` — validation tests
- `packages/cli/src/config/settings.test.ts` — settings tests
- `packages/core/src/providers/openai/__tests__/openai.stateless.test.ts` — mode tests
- `packages/cli/src/config/settingsSchema.test.ts` — schema field test
- `packages/cli/src/utils/settingsUtils.test.ts` — util test
- `schemas/settings.schema.json` — JSON schema
- `docs/cli/configuration.md` — documentation

---

## Execution Model

Each step follows:

```
typescriptexpert (execute) → full verification suite → deepthinker (review) → PASS/FAIL
  ↓ (FAIL)
typescriptexpert (remediate with feedback) → full verification suite → deepthinker (review)
  (repeat until PASS or blocked → escalate to user)
```

**Remediation cap**: 3 attempts per step. If still failing after 3 remediation cycles, pause and escalate.

---

## Full Verification Suite (run after EVERY step)

These commands must ALL pass before the deepthinker review. If any fail, the step fails without needing LLM review.

```bash
npm run test          # All tests pass
npm run typecheck     # Zero type errors
npm run lint          # No new errors (existing warnings OK)
npm run build         # Successful build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"  # Smoke test
```

---

## Step 0: Baseline

**Executor**: Coordinator (you, not a subagent)
**Purpose**: Establish baseline metrics before any changes.

### Actions

```bash
npm run test 2>&1 | tail -5                    # Record test count / pass count
npm run typecheck 2>&1 | tail -3               # Record current type errors (should be 0)
npm run lint 2>&1 | tail -5                    # Record current warning count
wc -l packages/core/src/providers/openai/OpenAIProvider.ts   # Record starting line count
wc -l packages/core/src/providers/openai/*.ts  # Record all file sizes
```

Record these numbers. Every subsequent step must maintain or improve them (test count ≥ baseline, type errors = 0, lint errors = 0, line counts decreasing toward targets).

---

## Step 1: Remove Legacy Generation Path

**Executor**: `typescriptexpert`
**Verifier**: `deepthinker`
**Risk**: Medium — deleting ~1,460 lines of code plus config surface area
**Expected line reduction**: ~1,460 lines from OpenAIProvider.ts

### Task Description

Remove the legacy tool call processing path entirely. The pipeline path (`generatePipelineChatCompletionImpl`) becomes the sole implementation.

### What To Do

1. **In `OpenAIProvider.ts`**:
   - Delete the `toolCallProcessingMode` field (line 99)
   - Remove its initialization from the constructor (line 143)
   - Delete `generateLegacyChatCompletionImpl` entirely (lines 1313–2771, ~1,459 lines)
   - Simplify `generateChatCompletionImpl` (lines 2818–2840) to directly call the pipeline method instead of dispatching. Then inline or rename `generatePipelineChatCompletionImpl` → `generateChatCompletionImpl` (merging the dispatch method and the pipeline method into one, since there's no longer a switch).

2. **In `IProviderConfig.ts`** (`packages/core/src/providers/types/IProviderConfig.ts`):
   - Remove `toolCallProcessingMode` from the interface

3. **In `settingsSchema.ts`** (`packages/cli/src/config/settingsSchema.ts`):
   - Remove the `toolCallProcessingMode` schema field definition
   - Remove the `ToolCallProcessingMode` type export

4. **In `settings.ts`** (`packages/cli/src/config/settings.ts`):
   - Remove the re-export of `ToolCallProcessingMode`

5. **In `providerManagerInstance.ts`** (`packages/cli/src/providers/providerManagerInstance.ts`):
   - Remove the `toolCallProcessingMode` property from the config type (line 98)
   - Remove passing `toolCallProcessingMode` to provider config (line 376)

6. **In `schemas/settings.schema.json`**:
   - Remove the `toolCallProcessingMode` entry

7. **In `docs/cli/configuration.md`**:
   - Remove the `toolCallProcessingMode` documentation section

8. **Update tests**:
   - `openai.stateless.test.ts`: Remove the `getToolCallProcessingMode` helper and all tests that assert on legacy/pipeline mode selection. Any test that was specifically testing legacy mode behavior should be deleted. Tests that were testing pipeline mode behavior should remain but no longer need to specify the mode.
   - `settings-validation.test.ts`: Remove validation tests for `toolCallProcessingMode`
   - `settings.test.ts`: Remove any test fixtures that include `toolCallProcessingMode`
   - `settingsSchema.test.ts`: Remove `toolCallProcessingMode` from schema field lists
   - `settingsUtils.test.ts`: Remove `toolCallProcessingMode` from any field lists

### Deterministic Verification (automated, binary pass/fail)

```bash
# Full verification suite (must all pass)
npm run test && npm run typecheck && npm run lint && npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"

# Legacy code is fully gone
grep -rn 'toolCallProcessingMode' packages/core/src/ packages/cli/src/ --include='*.ts'
# MUST return 0 results (exit code 1 from grep = no matches = PASS)

grep -n 'generateLegacyChatCompletionImpl' packages/core/src/providers/openai/OpenAIProvider.ts
# MUST return 0 results

# Line count check
wc -l packages/core/src/providers/openai/OpenAIProvider.ts
# MUST be ≤3,200 (was 4,619, removing ~1,460)
```

### Semantic Verification (deepthinker judgment)

The deepthinker must READ the modified files and answer:

1. **Is the legacy path completely gone?** No dead code, no orphaned helpers that were only used by the legacy path, no vestigial comments referencing legacy mode.
2. **Is the pipeline path now the sole path?** The `generateChatCompletionImpl` method should either directly contain the pipeline logic or clearly delegate to it — no dispatch switch, no mode check.
3. **Are the test changes minimal and correct?** Tests should only be removed/modified if they specifically tested legacy mode selection or legacy-specific behavior. No behavioral test coverage for the pipeline path should have been lost.
4. **Is the config surface clean?** No references to `toolCallProcessingMode` remain in types, schemas, settings, docs, or test fixtures.

---

## Step 2: Extract Pure Helpers (RequestBuilder + ResponseParser)

**Executor**: `typescriptexpert`
**Verifier**: `deepthinker`
**Risk**: Low — these are pure functions with no instance state
**Expected new files**: 2 production + 2 test files

### Task Description

Extract pure transformation functions from `OpenAIProvider` into two focused modules. These functions access no instance state (they use `this.getLogger()` at most, which will be converted to a parameter).

### What To Do

1. **Create `OpenAIRequestBuilder.ts`** with these functions extracted from OpenAIProvider:
   - `buildMessagesWithReasoning()` (~281 lines) — convert IContent[] to OpenAI message format
   - `validateToolMessageSequence()` (~123 lines) — remove orphan tool messages
   - `normalizeToolCallArguments()` (~32 lines) — normalize parameters to JSON string
   - `buildToolResponseContent()` (~21 lines) — serialize tool response blocks
   - `buildContinuationMessages()` (~62 lines) — construct follow-up message sequences
   - Convert `this.getLogger()` calls to a `logger` parameter
   - Convert any `this.methodName()` calls to direct calls to co-extracted functions or imports

2. **Create `OpenAIResponseParser.ts`** with these functions extracted from OpenAIProvider:
   - `coerceMessageContentToString()` (~34 lines) — normalize content to string
   - `sanitizeToolArgumentsString()` (~51 lines) — strip think tags, extract JSON
   - `extractKimiToolCallsFromText()` (~99 lines) — parse Kimi K2 inline tool calls
   - `cleanThinkingContent()` (~9 lines) — remove Kimi tokens from thinking content
   - `parseStreamingReasoningDelta()` (~48 lines) — extract reasoning_content from streaming deltas
   - `parseNonStreamingReasoning()` (~41 lines) — extract reasoning_content from complete messages
   - Same `this.getLogger()` → parameter conversion

3. **Update `OpenAIProvider.ts`**:
   - Import extracted functions from both new modules
   - Replace method bodies with delegation calls, passing `this.getLogger()` as the logger argument
   - Keep the methods on the class as thin wrappers OR remove them and update all call sites within the class to call the imported functions directly (whichever produces cleaner code — prefer removing the wrappers if call sites are few)

4. **Write behavioral unit tests**:
   - `OpenAIRequestBuilder.test.ts` — test each function with real inputs and expected outputs. Cover: normal messages, tool call messages, media blocks, Kimi/Mistral format variations, orphan tool message removal, continuation message construction.
   - `OpenAIResponseParser.test.ts` — test each function with real inputs and expected outputs. Cover: think-tag stripping, Kimi tool call extraction, malformed JSON handling, streaming vs non-streaming reasoning, content normalization.

### Deterministic Verification

```bash
# Full verification suite
npm run test && npm run typecheck && npm run lint && npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"

# New files exist
test -f packages/core/src/providers/openai/OpenAIRequestBuilder.ts || echo "FAIL: RequestBuilder missing"
test -f packages/core/src/providers/openai/OpenAIResponseParser.ts || echo "FAIL: ResponseParser missing"
test -f packages/core/src/providers/openai/OpenAIRequestBuilder.test.ts || echo "FAIL: RequestBuilder tests missing"
test -f packages/core/src/providers/openai/OpenAIResponseParser.test.ts || echo "FAIL: ResponseParser tests missing"

# Extracted functions are no longer defined as class methods (thin wrappers OK if they just delegate)
# At minimum, the bulk logic must live in the new files:
wc -l packages/core/src/providers/openai/OpenAIRequestBuilder.ts
# MUST be ≥400 (the extracted functions total ~520 lines)
wc -l packages/core/src/providers/openai/OpenAIResponseParser.ts
# MUST be ≥150 (the extracted functions total ~280 lines)

# Extracted functions must not reference 'this.'
grep -n 'this\.' packages/core/src/providers/openai/OpenAIRequestBuilder.ts
grep -n 'this\.' packages/core/src/providers/openai/OpenAIResponseParser.ts
# MUST return 0 results each

# New tests actually have assertions
grep -c 'expect(' packages/core/src/providers/openai/OpenAIRequestBuilder.test.ts
grep -c 'expect(' packages/core/src/providers/openai/OpenAIResponseParser.test.ts
# MUST be ≥10 assertions each
```

### Semantic Verification

1. **Are the extracted functions genuinely pure?** No `this` references, no module-level mutable state, all dependencies passed as parameters.
2. **Is the API clean?** Function signatures are well-typed with explicit parameter and return types. No `any` types. Logger parameter is consistently typed.
3. **Do the unit tests test behavior?** Tests verify input→output transformations with real data, not mock interactions. Tests cover edge cases and error conditions.
4. **Is OpenAIProvider cleaner?** The class is noticeably shorter. Delegation calls are clean and readable.

---

## Step 3: Extract Client Infrastructure

**Executor**: `typescriptexpert`
**Verifier**: `deepthinker`
**Risk**: Medium — involves HTTP client lifecycle, auth, and caching
**Expected new files**: 1 production + 1 test file

### Task Description

Extract HTTP client creation and management into a dedicated module.

### What To Do

1. **Create `OpenAIClientFactory.ts`** with these functions/class extracted from OpenAIProvider:
   - `createHttpAgents()` (~73 lines) — create HTTP/HTTPS agents with socket timeout
   - `instantiateClient()` (~36 lines) — create OpenAI client instance
   - `mergeInvocationHeaders()` (~25 lines) — merge custom headers for invocations
   - `resolveRuntimeKey()` (~25 lines) — compute cache key for client instances
   - Consider whether `getClient()` (~31 lines) can also be extracted. It manages a client cache (`Map`) — this could become a class (`OpenAIClientFactory`) with the cache as instance state, or remain on the provider. Use judgment for what produces the cleanest result.

2. **Update `OpenAIProvider.ts`**:
   - Import and delegate to the extracted functions/class
   - If `getClient()` stays on the provider, it should delegate to the extracted factory for actual client creation

3. **Write behavioral unit tests**:
   - `OpenAIClientFactory.test.ts` — test HTTP agent creation with various timeout settings, client instantiation with various configs, header merging logic, runtime key computation

### Deterministic Verification

```bash
# Full verification suite
npm run test && npm run typecheck && npm run lint && npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"

# New files exist
test -f packages/core/src/providers/openai/OpenAIClientFactory.ts || echo "FAIL: ClientFactory missing"
test -f packages/core/src/providers/openai/OpenAIClientFactory.test.ts || echo "FAIL: ClientFactory tests missing"

# Extracted code has substance
wc -l packages/core/src/providers/openai/OpenAIClientFactory.ts
# MUST be ≥100

# New tests have assertions
grep -c 'expect(' packages/core/src/providers/openai/OpenAIClientFactory.test.ts
# MUST be ≥5
```

### Semantic Verification

1. **Is the separation clean?** Client creation concerns (HTTP agents, timeouts, headers, auth token handling) are in the factory. Provider concerns (model selection, message building, streaming) stay in the provider.
2. **Is the cache management sensible?** If the client cache was extracted, is it properly encapsulated? If it stayed on the provider, is the boundary between "create client" and "cache client" clean?
3. **Are the tests behavioral?** Tests verify actual client configuration (base URL, headers, timeout values) not internal implementation details.

---

## Step 4: Slim OpenAIProvider to Coordinator

**Executor**: `typescriptexpert`
**Verifier**: `deepthinker`
**Risk**: High — restructuring the core generation method (the largest remaining piece)
**Target**: OpenAIProvider.ts ≤800 lines, every function ≤80 lines

### Task Description

The generation method (`generatePipelineChatCompletionImpl`, ~1,486 lines) is now the dominant remaining piece. Break it into focused functions. Also clean up any remaining large methods and ensure the provider is a thin coordinator.

### What To Do

1. **Extract shared request preparation**:
   - The ~110-line preamble of the generation method (tool formatting, tool name flattening, streaming detection, system prompt construction, user memory resolution) should become a `prepareGenerationRequest()` function in a suitable location (could be in `OpenAIRequestBuilder.ts` or a new file if it doesn't fit thematically).

2. **Break the streaming loop into focused functions**:
   - The generation method contains a massive streaming loop. Identify the logical sub-sections:
     - Request construction and execution (building the HTTP request, calling the API)
     - Chunk processing (SSE event handling, delta accumulation)
     - Tool call finalization (pipeline processing, Kimi tool call extraction)
     - Response assembly (building final IContent from accumulated state)
     - Continuation handling (requesting continuation after tool calls)
   - Extract each into a focused function (≤80 lines each). These can be module-level functions in a new `OpenAIStreamProcessor.ts` or similar — use judgment for what produces the cleanest result.

3. **Clean up remaining methods**:
   - Any method on `OpenAIProvider` that exceeds 80 lines must be decomposed
   - `getModels()` (59 lines), `isAuthenticated()` (53 lines) are fine
   - `getClient()` and others should already be small after Step 3

4. **Final provider shape**:
   - `OpenAIProvider.ts` should be a class with:
     - Constructor
     - Public API methods (`getModels`, `isAuthenticated`, `getClient`, `generateChatCompletionWithOptions`, etc.)
     - Each method ≤80 lines, delegating to extracted modules for heavy lifting
   - Total file ≤800 lines

### Deterministic Verification

```bash
# Full verification suite
npm run test && npm run typecheck && npm run lint && npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"

# Line count targets
PROVIDER_LINES=$(wc -l < packages/core/src/providers/openai/OpenAIProvider.ts)
echo "OpenAIProvider.ts: $PROVIDER_LINES lines"
[ "$PROVIDER_LINES" -le 800 ] || echo "FAIL: OpenAIProvider.ts exceeds 800 lines ($PROVIDER_LINES)"

# No file in the openai directory exceeds 800 lines
for f in packages/core/src/providers/openai/*.ts; do
  lines=$(wc -l < "$f")
  [ "$lines" -le 800 ] || echo "FAIL: $f exceeds 800 lines ($lines)"
done

# No function exceeds 80 lines (use eslint check — it's already configured as a warning)
# Run lint specifically on the openai directory and check for max-lines-per-function
npx eslint packages/core/src/providers/openai/OpenAIProvider.ts --rule '{"max-lines-per-function": ["error", {"max": 80, "skipBlankLines": true, "skipComments": true}]}' 2>&1
# MUST have 0 errors

# All existing OpenAIProvider test files still pass
npm run test -- --reporter=verbose packages/core/src/providers/openai/ 2>&1 | tail -20
```

### Semantic Verification

1. **Is OpenAIProvider now a coordinator?** The class should read like a table of contents — each method is short, delegates to clearly-named extracted functions, and the flow is easy to follow.
2. **Is the streaming logic understandable?** The extracted streaming functions should each have a clear single responsibility. A developer reading them for the first time should understand what each does without reading the full 1,486-line context.
3. **Are the function boundaries sensible?** Extractions should follow natural seams in the logic, not arbitrary line-count splits. Each function should represent a coherent concept.
4. **Has any behavioral logic been lost?** Compare the overall structure to the pre-refactoring code. All special cases (Kimi K2, Qwen, Mistral, DeepSeek reasoning, think tags, text tool parsing) must still be handled.
5. **Is the test coverage maintained?** The existing 15 test files should still exercise all the same code paths, just through different file boundaries. New unit tests for extracted modules should add coverage, not replace it.

---

## Step 5: Final Review and Cleanup

**Executor**: Coordinator (you) + `deepthinker` for final review
**Purpose**: Holistic review, commit preparation

### Actions

1. Run the full verification suite one final time
2. Run `git diff --stat` to review all changes
3. Have `deepthinker` do a final holistic review:
   - Read ALL new files created during the refactoring
   - Read the final state of `OpenAIProvider.ts`
   - Verify the module structure is coherent and maintainable
   - Check that the public API of `OpenAIProvider` (what external consumers see via `packages/core/src/index.ts`) is unchanged
   - Confirm acceptance criteria from issue #1570 are met:
     - [ ] No single file exceeds 800 lines
     - [ ] No single function exceeds 80 lines
     - [ ] All existing tests pass
     - [ ] Test coverage does not decrease

4. Commit with descriptive message referencing the issue

---

## File Impact Summary

### Files Deleted
- None (code is moved, not deleted; legacy path code is deleted but within OpenAIProvider.ts)

### Files Modified
- `packages/core/src/providers/openai/OpenAIProvider.ts` — primary target, from ~4,619 to ≤800 lines
- `packages/core/src/providers/types/IProviderConfig.ts` — remove `toolCallProcessingMode`
- `packages/cli/src/config/settingsSchema.ts` — remove `toolCallProcessingMode` schema
- `packages/cli/src/config/settings.ts` — remove re-export
- `packages/cli/src/providers/providerManagerInstance.ts` — remove config passthrough
- `schemas/settings.schema.json` — remove setting
- `docs/cli/configuration.md` — remove documentation
- Various test files — remove legacy-mode-specific tests, update fixtures

### Files Created
- `packages/core/src/providers/openai/OpenAIRequestBuilder.ts` — pure request/message building functions
- `packages/core/src/providers/openai/OpenAIRequestBuilder.test.ts` — unit tests
- `packages/core/src/providers/openai/OpenAIResponseParser.ts` — pure response parsing functions
- `packages/core/src/providers/openai/OpenAIResponseParser.test.ts` — unit tests
- `packages/core/src/providers/openai/OpenAIClientFactory.ts` — HTTP client creation/management
- `packages/core/src/providers/openai/OpenAIClientFactory.test.ts` — unit tests
- `packages/core/src/providers/openai/OpenAIStreamProcessor.ts` (or similar) — streaming loop decomposition
- `packages/core/src/providers/openai/OpenAIStreamProcessor.test.ts` — unit tests (if applicable)
