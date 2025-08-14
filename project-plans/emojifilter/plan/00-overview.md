# Emoji Filter Implementation Plan Overview

## Purpose
Implement configurable emoji filtering for LLM outputs and tool calls to ensure professional, emoji-free code and interactions.

## Implementation Sequence

### Phase 1: Core Filter (03-05)
- Stub: Create EmojiFilter class skeleton
- TDD: Write behavioral tests for filtering logic
- Impl: Implement filter following pseudocode lines 1-181

### Phase 2: Configuration Integration (06-08)
- Stub: Add config methods to Config class
- TDD: Test configuration hierarchy and /set command
- Impl: Implement config integration (config-integration.md lines 1-74)

### Phase 3: Stream Integration (09-11)
- Stub: Hook into useGeminiStream
- TDD: Test stream filtering with chunks
- Impl: Implement stream filtering (stream-integration.md lines 1-65)

### Phase 4: Tool Integration (12-14)
- Stub: Hook into nonInteractiveToolExecutor
- TDD: Test tool parameter filtering and blocking
- Impl: Implement tool filtering (tool-integration.md lines 1-133)

### Phase 5: File Tool Protection (15-17)
- Stub: Modify edit.ts, write-file.ts, replace.ts
- TDD: Test file content filtering
- Impl: Implement strict file filtering

### Phase 6: Integration Testing (18-20)
- Integration stub: Wire all components together
- Integration TDD: End-to-end tests
- Integration impl: Final connections

### Phase 7: Migration & Cleanup (21-23)
- Migration: Update existing settings schemas
- Deprecation: (None - new feature)
- Final verification: Complete system test

## Critical Requirements

1. **NO NotYetImplemented** - Stubs return empty values
2. **Behavioral Tests Only** - Test data transformation, not mocks
3. **Follow Pseudocode** - Reference line numbers in implementation
4. **Update Existing Files** - No ServiceV2 or parallel versions
5. **Integration Required** - Must modify existing stream/tool code

## Files to Modify (NOT create new versions)

- `/packages/core/src/filters/EmojiFilter.ts` (NEW)
- `/packages/core/src/config/config.ts` (UPDATE)
- `/packages/cli/src/ui/hooks/useGeminiStream.ts` (UPDATE)
- `/packages/core/src/core/nonInteractiveToolExecutor.ts` (UPDATE)
- `/packages/core/src/tools/edit.ts` (UPDATE)
- `/packages/core/src/tools/write-file.ts` (UPDATE)
- `/packages/cli/src/ui/commands/setCommand.ts` (UPDATE)

## Success Criteria

- [ ] Emojis filtered from LLM responses
- [ ] Emojis blocked from code files
- [ ] Configuration works at all levels
- [ ] Warn mode provides feedback
- [ ] Error mode blocks execution
- [ ] User input never filtered
- [ ] 80% mutation test score
- [ ] 30% property-based tests