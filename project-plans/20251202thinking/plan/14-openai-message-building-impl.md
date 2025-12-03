# Phase 14: OpenAIProvider Message Building Implementation

## Phase ID

`PLAN-20251202-THINKING.P14`

## What This Phase Implements

### Concrete Implementation Goal

Modify OpenAIProvider's `convertToOpenAIMessages` method to conditionally add `reasoning_content` field to assistant messages based on ephemeral settings (`reasoning.includeInContext` and `reasoning.stripFromContext`). This enables round-trip preservation of reasoning content when sending history back to the API.

### Expected Code Structure

```typescript
// packages/core/src/providers/openai/OpenAIProvider.ts

// FIRST: Add import at top of file
import {
  extractThinkingBlocks,
  filterThinkingForContext,
  thinkingToReasoningField,
  type StripPolicy,
} from '../reasoning/reasoningUtils.js';

// MODIFY: convertToOpenAIMessages signature (add optional options parameter)
private convertToOpenAIMessages(
  contents: IContent[],
  mode: ToolReplayMode = 'native',
  config?: Config,
  options?: NormalizedGenerateChatOptions  // NEW: optional parameter
): OpenAI.Chat.ChatCompletionMessageParam[] {

  // Inside method, when building assistant messages:
  if (content.speaker === 'ai') {
    const textBlocks = content.blocks.filter(b => b.type === 'text');
    const text = textBlocks.map(b => b.text).join('\n');

    // NEW: Extract thinking blocks if options provided
    const thinkingBlocks = options ? extractThinkingBlocks(content) : [];
    const includeInContext = options
      ? (options.settings.get('reasoning.includeInContext') as boolean) ?? false
      : false;

    // Build message
    const message: any = {
      role: 'assistant',
      content: text,
    };

    // NEW: Conditionally add reasoning_content
    if (includeInContext && thinkingBlocks.length > 0) {
      message.reasoning_content = thinkingToReasoningField(thinkingBlocks);
    }

    messages.push(message);
  }
}

// UPDATE: Call sites (before calling convertToOpenAIMessages)
const stripPolicy = (options.settings.get('reasoning.stripFromContext') as StripPolicy) ?? 'none';
const filteredContents = filterThinkingForContext(contents, stripPolicy);
const messages = this.convertToOpenAIMessages(filteredContents, mode, config, options);
```

### Integration Points

**Called by:**
- `OpenAIProvider.generateChat()` - calls convertToOpenAIMessages with options parameter
- `OpenAIProvider.generateChatStream()` - calls convertToOpenAIMessages with options parameter

**Calls:**
- `extractThinkingBlocks()` from reasoningUtils - extracts thinking blocks from each IContent
- `filterThinkingForContext()` from reasoningUtils - applies strip policy before conversion
- `thinkingToReasoningField()` from reasoningUtils - converts blocks to reasoning_content string
- `options.settings.get()` - reads ephemeral settings

**Data flow:**
1. Read settings: `includeInContext` and `stripFromContext`
2. Apply `filterThinkingForContext` to contents array
3. For each filtered IContent, call `convertToOpenAIMessages`
4. Inside conversion, if AI message and `includeInContext=true`:
   - Call `extractThinkingBlocks` to get thinking from this content
   - Call `thinkingToReasoningField` to convert to string
   - Add `reasoning_content` field to message
5. Return array of ChatCompletionMessageParam with conditional reasoning_content

### Success Criteria

**What should happen when this code runs correctly:**
1. When `includeInContext=true`, assistant messages include `reasoning_content` field with joined thinking blocks
2. When `includeInContext=false`, assistant messages have NO `reasoning_content` field
3. When `stripFromContext='allButLast'`, only the last assistant message with thinking retains it in reasoning_content
4. When `stripFromContext='all'`, no messages have reasoning_content (even if includeInContext=true)
5. All P13 tests pass without modification
6. All existing OpenAIProvider tests continue to pass
7. Both call sites of convertToOpenAIMessages are updated to pass options parameter

## Prerequisites

- Required: Phase 13a completed
- Verification: `cat project-plans/20251202thinking/.completed/P13a.md`
- Expected: Tests exist and fail

## Requirements Implemented (Expanded)

### REQ-THINK-004.1: Read includeInContext Setting
**Full Text**: Message builder MUST read reasoning.includeInContext ephemeral setting
**Behavior**:
- GIVEN: Ephemeral settings contain reasoning.includeInContext value
- WHEN: buildMessagesWithReasoning is called
- THEN: The includeInContext value is read and used to determine output format
**Why This Matters**: User control over whether reasoning is sent back to API

### REQ-THINK-004.2: Read stripFromContext Setting
**Full Text**: Message builder MUST read reasoning.stripFromContext ephemeral setting
**Behavior**:
- GIVEN: Ephemeral settings contain reasoning.stripFromContext value ('all'|'allButLast'|'none')
- WHEN: buildMessagesWithReasoning is called
- THEN: The stripFromContext value is applied via filterThinkingForContext
**Why This Matters**: Token optimization - allows stripping old reasoning while keeping recent

### REQ-THINK-004.3: Include reasoning_content When Enabled
**Full Text**: When includeInContext=true, assistant messages MUST include reasoning_content field
**Behavior**:
- GIVEN: IContent with ThinkingBlocks and includeInContext=true
- WHEN: buildMessagesWithReasoning converts to API format
- THEN: Resulting ChatCompletionMessageParam includes reasoning_content field
**Why This Matters**: Critical for Kimi K2 - model breaks if reasoning_content omitted after tool calls

### REQ-THINK-004.4: Exclude reasoning_content When Disabled
**Full Text**: When includeInContext=false, assistant messages MUST NOT include reasoning_content
**Behavior**:
- GIVEN: IContent with ThinkingBlocks and includeInContext=false
- WHEN: buildMessagesWithReasoning converts to API format
- THEN: Resulting ChatCompletionMessageParam has no reasoning_content field
**Why This Matters**: Default behavior for models that don't need reasoning in context, saves tokens

### REQ-THINK-004.5: Apply Strip Policy Before Building
**Full Text**: Message builder MUST apply stripFromContext policy before building
**Behavior**:
- GIVEN: History with multiple IContent containing ThinkingBlocks
- WHEN: buildMessagesWithReasoning processes with policy='allButLast'
- THEN: Only the last IContent retains ThinkingBlocks in output
**Why This Matters**: Prevents unbounded context growth from accumulated reasoning tokens

### REQ-THINK-006.2: includeInContext Default
**Full Text**: reasoning.includeInContext MUST default to false
**Behavior**:
- GIVEN: No explicit setting for reasoning.includeInContext
- WHEN: buildMessagesWithReasoning reads settings
- THEN: Uses false as default value
**Why This Matters**: Safe default - most models don't need reasoning in context

### REQ-THINK-006.5: stripFromContext Default
**Full Text**: reasoning.stripFromContext MUST default to 'none'
**Behavior**:
- GIVEN: No explicit setting for reasoning.stripFromContext
- WHEN: buildMessagesWithReasoning reads settings
- THEN: Uses 'none' as default value
**Why This Matters**: Preserves all reasoning by default for display purposes

## Implementation Tasks

### Files to Modify

#### `packages/core/src/providers/openai/OpenAIProvider.ts`

**FIRST: Add import statement at the top of the file:**

```typescript
// Add this import with other imports (find the import section using grep -n "^import" to locate line numbers)
import {
  extractThinkingBlocks,
  filterThinkingForContext,
  thinkingToReasoningField,
  type StripPolicy,
} from '../reasoning/reasoningUtils.js';
```

**Verification of import location:**
```bash
# Find where to add the import (look for existing provider imports)
grep -n "^import.*from.*provider" packages/core/src/providers/openai/OpenAIProvider.ts
# Add the reasoning import near other provider-related imports
```

Replace stub with real implementation:

```typescript
/**
 * Build messages with optional reasoning_content based on settings.
 *
 * @plan PLAN-20251202-THINKING.P14
 * @requirement REQ-THINK-004, REQ-THINK-006
 * @pseudocode openai-provider-reasoning.md lines 110-143
 */
private buildMessagesWithReasoning(
  contents: IContent[],
  options: NormalizedGenerateChatOptions
): ChatCompletionMessageParam[] {
  // Read settings with defaults from NormalizedGenerateChatOptions
  // GAP 10 FIX: Use ?? (nullish coalescing) for consistency, not || (logical OR)
  const stripPolicy = (options.settings.get('reasoning.stripFromContext') as StripPolicy) ?? 'none';
  const includeInContext = (options.settings.get('reasoning.includeInContext') as boolean) ?? false;

  // Apply strip policy first
  const filteredContents = filterThinkingForContext(contents, stripPolicy);

  const messages: ChatCompletionMessageParam[] = [];

  for (const content of filteredContents) {
    if (content.speaker === 'human') {
      messages.push({
        role: 'user',
        content: this.getTextContent(content),
      });
    } else if (content.speaker === 'ai') {
      const textContent = this.getTextContent(content);
      const thinkingBlocks = extractThinkingBlocks(content);

      if (includeInContext && thinkingBlocks.length > 0) {
        const reasoningContent = thinkingToReasoningField(thinkingBlocks);
        messages.push({
          role: 'assistant',
          content: textContent,
          reasoning_content: reasoningContent,
        } as ChatCompletionMessageParam);
      } else {
        messages.push({
          role: 'assistant',
          content: textContent,
        });
      }
    } else if (content.speaker === 'tool') {
      // Handle tool responses (existing logic)
      // ... delegate to existing tool handling
    }
  }

  return messages;
}

/**
 * Helper to extract text content from IContent.
 */
private getTextContent(content: IContent): string {
  return content.blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b as TextBlock).text)
    .join('');
}
```

### Integration with Existing convertToOpenAIMessages

**Strategy Decision**: Modify `convertToOpenAIMessages` to optionally handle reasoning instead of replacing all call sites.

**Rationale**:
- `convertToOpenAIMessages` is called from 2 locations in OpenAIProvider.ts (lines ~1274, ~2447)
- Both call sites have access to settings via `this.resolveSettingsService()`
- Modifying the existing method reduces code duplication and maintains existing test coverage

**Integration Point Verification:**
```bash
# Verify exact call site line numbers before implementation:
grep -n "convertToOpenAIMessages" packages/core/src/providers/openai/OpenAIProvider.ts
# Expected output format:
#   989:  private convertToOpenAIMessages(    <- Method definition
#   1274:    const messages = this.convertToOpenAIMessages(    <- Call site 1
#   2447:    const messages = this.convertToOpenAIMessages(    <- Call site 2
```

**Required reasoningUtils Functions:**
The implementation will call these functions from reasoningUtils:
- `extractThinkingBlocks(content)` - Extract thinking blocks from IContent (called in convertToOpenAIMessages for each AI message)
- `filterThinkingForContext(contents, stripPolicy)` - Apply strip policy before conversion (called before convertToOpenAIMessages)
- `thinkingToReasoningField(blocks)` - Convert thinking blocks to reasoning_content string (called when building assistant messages)

These functions MUST be imported at the top of OpenAIProvider.ts (see import statement above).

**Approach**:
1. Add optional `options` parameter to `convertToOpenAIMessages`:
   ```typescript
   private convertToOpenAIMessages(
     contents: IContent[],
     mode: ToolReplayMode = 'native',
     config?: Config,
     options?: NormalizedGenerateChatOptions  // NEW: optional for backward compatibility
   ): OpenAI.Chat.ChatCompletionMessageParam[]
   ```

2. Inside `convertToOpenAIMessages`, when processing `content.speaker === 'ai'` blocks:
   ```typescript
   } else if (content.speaker === 'ai') {
     // NOTE: Filter only 'text' blocks - ThinkingBlocks are handled separately below
     // ThinkingBlocks are NEVER included in the content field, only in reasoning_content
     const textBlocks = content.blocks.filter((b) => b.type === 'text') as TextBlock[];
     const text = textBlocks.map((b) => b.text).join('\n');
     const toolCalls = content.blocks.filter((b) => b.type === 'tool_call') as ToolCallBlock[];

     // NEW: Extract thinking blocks and conditionally add reasoning_content
     // These are added to a SEPARATE field, not mixed with text
     const thinkingBlocks = options ? extractThinkingBlocks(content) : [];
     const includeInContext = options ? (options.settings.get('reasoning.includeInContext') as boolean) ?? false : false;

     if (toolCalls.length > 0) {
       if (mode === 'textual') {
         // ... existing textual mode ...
       } else {
         // Assistant message with tool calls
         const message: any = {
           role: 'assistant',
           content: text || null,
           tool_calls: toolCalls.map(/* ... */),
         };
         // NEW: Add reasoning_content if enabled
         if (includeInContext && thinkingBlocks.length > 0) {
           message.reasoning_content = thinkingToReasoningField(thinkingBlocks);
         }
         messages.push(message);
       }
     } else if (textBlocks.length > 0) {
       // Plain assistant message
       const message: any = {
         role: 'assistant',
         content: text,
       };
       // NEW: Add reasoning_content if enabled
       if (includeInContext && thinkingBlocks.length > 0) {
         message.reasoning_content = thinkingToReasoningField(thinkingBlocks);
       }
       messages.push(message);
     }
   }
   ```

3. Update call sites to pass options:
   ```typescript
   // Find these calls (use grep to locate):
   const messages = this.convertToOpenAIMessages(contents, mode, config);

   // Replace with:
   // options is already available in the scope where convertToOpenAIMessages is called
   const messages = this.convertToOpenAIMessages(contents, mode, config, options);
   ```

4. Apply strip policy BEFORE calling convertToOpenAIMessages:
   ```typescript
   // Access settings via options.settings (NormalizedGenerateChatOptions)
   // GAP 10 FIX: Use ?? (nullish coalescing) instead of || for proper default handling
   const stripPolicy = (options.settings.get('reasoning.stripFromContext') as StripPolicy) ?? 'none';
   const filteredContents = filterThinkingForContext(contents, stripPolicy);
   const messages = this.convertToOpenAIMessages(filteredContents, mode, config, options);
   ```

**Why ?? instead of ||**:
- `??` (nullish coalescing): Only uses default if value is `null` or `undefined`
- `||` (logical OR): Uses default if value is falsy (includes `0`, `''`, `false`)
- For settings, we want to distinguish between "not set" (null/undefined) and "set to falsy value"
- Consistency: `includeInContext` uses `??`, so `stripPolicy` should too

**Alternative Considered**: Create separate `buildMessagesWithReasoning` that duplicates convertToOpenAIMessages logic. **Rejected** due to code duplication and maintenance burden.

**Backward Compatibility**: Making `options` parameter optional ensures existing tests continue to work without modification.

**GAP 12 FIX: Call Site Update Verification**

Before implementing, locate ALL call sites that need updating:

```bash
# Find all call sites of convertToOpenAIMessages
grep -n "this.convertToOpenAIMessages(" packages/core/src/providers/openai/OpenAIProvider.ts
# Expected output (example line numbers - verify actual):
#   989:  private convertToOpenAIMessages(          <- Method definition (NO UPDATE NEEDED)
#   1274:    const messages = this.convertToOpenAIMessages(contents, mode, config);    <- CALL SITE 1 (UPDATE NEEDED)
#   2447:    const messages = this.convertToOpenAIMessages(contents, mode, config);    <- CALL SITE 2 (UPDATE NEEDED)

# If output shows different line numbers or more/fewer call sites, STOP and update the plan
```

**Call Site Update Checklist** (complete ALL before marking phase done):

1. **Call Site 1** (~line 1274):
   ```bash
   # View context around line 1274
   sed -n '1270,1280p' packages/core/src/providers/openai/OpenAIProvider.ts
   # Verify this is in a method that has access to 'options' parameter
   # Update: Add 'options' as 4th parameter to convertToOpenAIMessages call
   ```

2. **Call Site 2** (~line 2447):
   ```bash
   # View context around line 2447
   sed -n '2443,2453p' packages/core/src/providers/openai/OpenAIProvider.ts
   # Verify this is in a method that has access to 'options' parameter
   # Update: Add 'options' as 4th parameter to convertToOpenAIMessages call
   ```

3. **Verify NO call sites were missed**:
   ```bash
   # After updating, verify all call sites now pass 4 parameters
   grep -A 1 "this.convertToOpenAIMessages(" packages/core/src/providers/openai/OpenAIProvider.ts | grep -v "^--$" | grep -v "private convertToOpenAIMessages"
   # Expected: All call sites show 4 parameters: (contents, mode, config, options)
   # If any show only 3 parameters, those were missed - FAIL the phase
   ```

4. **Verify strip policy is applied BEFORE each call**:
   ```bash
   # Check that filterThinkingForContext is called before convertToOpenAIMessages
   grep -B 5 "this.convertToOpenAIMessages(" packages/core/src/providers/openai/OpenAIProvider.ts | grep -E "(filterThinkingForContext|stripPolicy)"
   # Expected: Each call site should have filterThinkingForContext applied to contents first
   ```

**If call sites differ from expected**: Update plan documentation with actual locations before proceeding.

**Settings Access Pattern**:

OpenAIProvider accesses settings through `options.settings.get('key')` where:
- `options` is `NormalizedGenerateChatOptions`
- `options.settings` is a `SettingsService` instance with `.get(key: string)` method
- Example: `options.settings.get('reasoning.includeInContext')`

This is DIFFERENT from:
- geminiChat.ts which uses: `this.runtimeContext.ephemerals.reasoning.includeInContext()` (function call, not get)
- createAgentRuntimeContext.ts which uses: `options.settings['reasoning.enabled']` (property access on plain object)

Each layer has its own settings access pattern. In OpenAIProvider, ALWAYS use `options.settings.get('key')` with string keys.

## Verification Commands

### Automated Checks

```bash
# GAP 12: Verify all call sites updated BEFORE running tests
grep -c "this.convertToOpenAIMessages.*options" packages/core/src/providers/openai/OpenAIProvider.ts
# Expected: 2 (both call sites now pass options parameter)
# If result is < 2, call sites not updated - tests will fail

# Run all reasoning tests - they should NOW PASS
npm test -- --run packages/core/src/providers/openai/__tests__/OpenAIProvider.reasoning.test.ts

# All OpenAI tests still pass
npm test -- --run packages/core/src/providers/openai/

# No stubs remain
grep "STUB" packages/core/src/providers/openai/OpenAIProvider.ts | grep -i reason
# Expected: No matches

# TypeScript compiles
npm run typecheck

# Lint passes
npm run lint -- packages/core/src/providers/openai/
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Run ALL of these checks - if ANY match, phase FAILS:

# Check for TODO/FIXME/HACK markers left in implementation
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai/OpenAIProvider.ts | grep -v ".test.ts"
# Expected: No matches (or only in comments explaining WHY, not WHAT to do)

# Check for "cop-out" comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/providers/openai/OpenAIProvider.ts | grep -v ".test.ts"
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/providers/openai/OpenAIProvider.ts | grep -v ".test.ts"
# Expected: No matches in buildMessagesWithReasoning (returns messages array - should never be empty if history provided)

# Specific check for delegation without logic
grep -A 5 "buildMessagesWithReasoning" packages/core/src/providers/openai/OpenAIProvider.ts | grep -E "return this\."
# Expected: No simple delegation - must have actual filtering/building logic
```

### Semantic Verification Checklist (MANDATORY)

**Go beyond markers. Actually verify the behavior exists.**

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read REQ-THINK-004.1 and verified includeInContext is read from settings
   - [ ] I read REQ-THINK-004.2 and verified stripFromContext is read from settings
   - [ ] I read REQ-THINK-004.3 and verified reasoning_content added when enabled
   - [ ] I read REQ-THINK-004.4 and verified reasoning_content omitted when disabled
   - [ ] I read REQ-THINK-004.5 and verified filterThinkingForContext is called

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB)
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments
   - [ ] No delegation without transformation

3. **Would the test FAIL if implementation was removed?**
   - [ ] Test verifies reasoning_content field presence/absence
   - [ ] Test verifies strip policy actually filters
   - [ ] Test would catch wrong default values

4. **Is the feature REACHABLE by users?**
   - [ ] buildMessagesWithReasoning called from API request building
   - [ ] Ephemeral settings passed through to method
   - [ ] Path exists from /set command to affecting API calls

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1]
   - [ ] [gap 2]

#### Feature Actually Works

```bash
# Manual verification: Show the implementation
grep -A 30 "buildMessagesWithReasoning" packages/core/src/providers/openai/OpenAIProvider.ts | head -35
# Expected: Real implementation with settings reading and filtering logic
```

#### Integration Points Verified

- [ ] filterThinkingForContext correctly applies strip policy before building
- [ ] extractThinkingBlocks correctly finds ThinkingBlocks in IContent
- [ ] thinkingToReasoningField correctly joins multiple blocks with newlines
- [ ] Settings object properly typed and accessed
- [ ] No mutation of input history array

#### Lifecycle Verified

- [ ] Settings read at start of method (not cached from construction)
- [ ] No async operations in message building (pure transformation)
- [ ] Memory not leaked (no accumulating closures)

#### Edge Cases Verified

- [ ] Empty history: returns empty messages array
- [ ] History with no ThinkingBlocks: messages have no reasoning_content
- [ ] History with only ThinkingBlocks: handles correctly (likely unusual)
- [ ] Multiple ThinkingBlocks in one IContent: concatenated with newlines
- [ ] ThinkingBlock with empty thought: handled without error

## Success Criteria

- All P13 tests pass
- All P10 tests pass
- All existing OpenAI tests pass
- Implementation matches pseudocode
- TypeScript and lint pass

## Failure Recovery

If tests fail:

1. Compare implementation to pseudocode
2. Check reasoningUtils integration
3. Verify settings reading logic
4. Fix implementation (not tests)

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P14.md`
