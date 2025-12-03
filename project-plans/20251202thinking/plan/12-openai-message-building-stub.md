# Phase 12: OpenAIProvider Message Building Stub

## Phase ID

`PLAN-20251202-THINKING.P12`

## Prerequisites

- Required: Phase 11a completed
- Verification: `cat project-plans/20251202thinking/.completed/P11a.md`
- Expected: Parsing implementation complete

## Requirements Implemented (Expanded)

### REQ-THINK-004: OpenAI Provider Message Building

**Full Text**: OpenAIProvider must include reasoning_content in outgoing messages based on settings
**Behavior**:

- GIVEN: History with ThinkingBlocks and `reasoning.includeInContext=true`
- WHEN: Building messages for API request
- THEN: Include `reasoning_content` field in assistant messages

**Why This Matters**: Kimi K2 Thinking requires reasoning in context or it breaks

### REQ-THINK-006: Ephemeral Settings Integration

**Full Text**: Message builder must read from ephemeral settings
**Behavior**:

- GIVEN: User has set `reasoning.includeInContext = true`
- WHEN: Building messages
- THEN: Settings are respected

## Implementation Tasks

### Files to Modify

#### `packages/core/src/providers/openai/OpenAIProvider.ts`

Add new method (stub):

```typescript
/**
 * Build messages with optional reasoning_content based on settings.
 *
 * @plan PLAN-20251202-THINKING.P12
 * @requirement REQ-THINK-004, REQ-THINK-006
 * @pseudocode openai-provider-reasoning.md lines 110-143
 */
private buildMessagesWithReasoning(
  contents: IContent[],
  options: NormalizedGenerateChatOptions
): ChatCompletionMessageParam[] {
  // STUB: Will be implemented in P14
  // For now, delegate to existing message building
  // Note: options contains settings via options.settings.get('key')
  return this.convertToOpenAIMessages(contents);
}
```

### Integration Points

- Identify where `buildMessages` is called in request preparation
- Plan to call `buildMessagesWithReasoning` instead when settings indicate reasoning support
- Ensure settings are passed from geminiChat context

### Required Imports

```typescript
import {
  filterThinkingForContext,
  thinkingToReasoningField,
  extractThinkingBlocks,
  type StripPolicy,
} from '../reasoning/reasoningUtils.js';
```

**Note**: `NormalizedGenerateChatOptions` is already imported in OpenAIProvider.ts via BaseProvider. The method will receive options containing `settings` which has a `get(key: string): unknown` method for accessing ephemeral settings.

**Settings Access Pattern**: In OpenAIProvider, settings are accessed via `options.settings.get('reasoning.includeInContext')` where `options` is `NormalizedGenerateChatOptions`. This is different from geminiChat which uses `this.runtimeContext.ephemerals.reasoning.includeInContext()`. Providers receive settings through the normalized options parameter, not through direct runtime context access.

## Verification Commands

### Automated Checks

```bash
# Check new method exists
grep "buildMessagesWithReasoning" packages/core/src/providers/openai/OpenAIProvider.ts

# Check plan markers
grep "@plan.*THINKING.P12" packages/core/src/providers/openai/OpenAIProvider.ts
# Expected: 1+ occurrences

# Check imports from reasoningUtils
grep "from.*reasoningUtils" packages/core/src/providers/openai/OpenAIProvider.ts

# TypeScript compiles
npm run typecheck

# Existing tests still pass
npm test -- --run packages/core/src/providers/openai/
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Run ALL of these checks - if ANY match, phase FAILS:

# Check stub delegates to existing method with STUB comment
grep -A 5 "buildMessagesWithReasoning" packages/core/src/providers/openai/OpenAIProvider.ts | grep -E "(STUB|buildMessages)"
# Expected: Stub delegates to existing buildMessages method

# Verify no premature reasoning logic in stub
grep -A 10 "buildMessagesWithReasoning" packages/core/src/providers/openai/OpenAIProvider.ts | grep -E "(filterThinkingForContext|thinkingToReasoningField|reasoning_content)"
# Expected: No matches (implementation is P14)

# Check for TODO/FIXME markers outside of stub comments
grep -rn -E "(TODO|FIXME|HACK|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai/OpenAIProvider.ts | grep -i "buildMessagesWithReasoning\|message.*reason" | grep -v "STUB\|Will be implemented"
# Expected: No matches
```

### Semantic Verification Checklist (MANDATORY)

**Go beyond markers. Actually verify the behavior exists.**

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read REQ-THINK-004 and verified buildMessagesWithReasoning signature accepts contents and settings
   - [ ] I read REQ-THINK-006 and verified settings parameter allows reading ephemeral settings
   - [ ] Stub signature matches final implementation needs (contents, settings)
   - [ ] Return type is ChatCompletionMessageParam[] as expected

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed - stub delegates to existing buildMessages
   - [ ] No premature reasoning logic (no filterThinkingForContext calls yet)
   - [ ] No reasoning_content field construction in stub (that's P14)
   - [ ] STUB comments clearly indicate implementation phase (P14)

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests will fail when expecting reasoning_content in messages
   - [ ] Tests verify stub is called but doesn't yet include reasoning
   - [ ] Tests prepared to pass in P14 when real implementation added

4. **Is the feature REACHABLE by users?**
   - [ ] Method is private but identified where it will be called
   - [ ] Integration points documented (replace buildMessages calls)
   - [ ] reasoningUtils imports present for future use
   - [ ] No compile errors preventing OpenAIProvider from working

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1]
   - [ ] [gap 2]

#### Feature Actually Works

```bash
# Manual verification: Show stub method exists
grep -A 8 "buildMessagesWithReasoning" packages/core/src/providers/openai/OpenAIProvider.ts | head -12
# Expected: Method delegating to existing buildMessages

# Verify reasoningUtils imported
grep "from.*reasoningUtils" packages/core/src/providers/openai/OpenAIProvider.ts
# Expected: Import statement present
```

#### Stub Quality Verified

- [ ] Method has JSDoc with @plan markers
- [ ] Method has @requirement markers (REQ-THINK-004, REQ-THINK-006)
- [ ] Method has @pseudocode reference
- [ ] Stub is minimalist (just delegate to existing method)
- [ ] Private method (will be called by request building logic)

### Structural Verification Checklist

- [ ] buildMessagesWithReasoning method added
- [ ] Plan marker present
- [ ] Requirement markers present
- [ ] Pseudocode reference present
- [ ] Import from reasoningUtils added
- [ ] TypeScript compiles
- [ ] Existing tests pass

## Success Criteria

- Stub method exists with correct signature
- Imports from reasoningUtils in place
- TypeScript compiles
- Ready for TDD tests in P13

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/providers/openai/OpenAIProvider.ts`
2. Review existing buildMessages implementation
3. Re-attempt

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P12.md`
