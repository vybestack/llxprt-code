# Tool Replay Mode Support Missing Analysis Report

## Executive Summary

This report documents the critical missing functionality of Tool Replay Mode support in Pipeline mode. The Legacy mode implements comprehensive tool replay capabilities for models requiring textual format (like `openrouter/polaris-alpha`), but Pipeline mode completely lacks this feature, causing tool call failures for these specific models.

**Key Findings**: Pipeline mode always defaults to 'native' tool format, making it incompatible with models that require textual tool replay representation.

---

## 1. Problem Discovery and Evidence Collection

### 1.1 Initial Problem Identification

#### Discovery Method
During comprehensive analysis of Pipeline vs Legacy mode differences, we identified that Pipeline mode lacks critical tool replay mode functionality that exists in Legacy mode.

#### Affected Models
- **Primary**: `openrouter/polaris-alpha`
- **Potential**: Any future models requiring textual tool replay format

### 1.2 Code Evidence Analysis

#### Legacy Mode Implementation (Complete)

**Location**: `packages/core/src/providers/openai/OpenAIProvider.ts:658-667`

```typescript
private determineToolReplayMode(model?: string): ToolReplayMode {
  if (!model) {
    return 'native';
  }
  const normalized = model.toLowerCase();
  if (TEXTUAL_TOOL_REPLAY_MODELS.has(normalized)) {
    return 'textual';
  }
  return 'native';
}
```

**Location**: `packages/core/src/providers/openai/OpenAIProvider.ts:63`

```typescript
const TEXTUAL_TOOL_REPLAY_MODELS = new Set(['openrouter/polaris-alpha']);
```

**Location**: `packages/core/src/providers/openai/OpenAIProvider.ts:934-965`

```typescript
const toolReplayMode = this.determineToolReplayMode(model);
const messages = this.convertToOpenAIMessages(
  contents,
  toolReplayMode,  // ✅ Mode parameter passed
  configForMessages,
);
if (logger.enabled && toolReplayMode !== 'native') {
  logger.debug(
    () =>
      `[OpenAIProvider] Using textual tool replay mode for model '${model}'`,
  );
}
```

#### Pipeline Mode Implementation (Missing)

**Location**: `packages/core/src/providers/openai/OpenAIProvider.ts:1992`

```typescript
const messages = this.convertToOpenAIMessages(contents);  // ❌ No mode parameter
```

**Critical Gap**: Pipeline mode calls `convertToOpenAIMessages()` without the `toolReplayMode` parameter, always defaulting to 'native' mode.

### 1.3 Functional Impact Analysis

#### Tool Replay Mode Types

**Location**: `packages/core/src/providers/openai/OpenAIProvider.ts:62`

```typescript
type ToolReplayMode = 'native' | 'textual';
```

#### Native Mode (Current Pipeline Behavior)
- Uses structured OpenAI tool call format
- Tool calls: `{"role": "assistant", "tool_calls": [...]}`
- Tool responses: `{"role": "tool", "tool_call_id": "...", "content": "..."}`

#### Textual Mode (Missing in Pipeline)
- Converts tool calls to readable text format
- Tool calls: `{"role": "assistant", "content": "[TOOL CALL] tool_name args=..."}`
- Tool responses: `{"role": "user", "content": "[TOOL RESULT] tool_name (success)\n..."}`

### 1.4 Test Coverage Evidence

**Location**: `packages/core/src/providers/openai/OpenAIProvider.convertToOpenAIMessages.test.ts:161-204`

Legacy mode has comprehensive test coverage for textual tool replay:

```typescript
it('replays tool transcripts as text when textual mode is requested', () => {
  const contents: IContent[] = [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'please inspect file' }],
    },
    {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'Checking file contents' },
        {
          type: 'tool_call',
          id: 'hist_tool_001',
          name: 'read_file',
          parameters: { path: '/tmp/file.txt' },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'hist_tool_001',
          toolName: 'read_file',
          result: 'line1\nline2',
        },
      ],
    },
  ];

  const messages = callConvert(provider, contents, 'textual');
  expect(messages).toHaveLength(3);
  expect(messages[1]?.content).toContain('[TOOL CALL');
  expect(messages[2]?.content).toContain('[TOOL RESULT]');
});
```

---

## 2. Problem Situation Analysis

### 2.1 Technical Architecture Impact

#### Data Flow Comparison

**Legacy Mode Data Flow**:
```
Contents → determineToolReplayMode() → convertToOpenAIMessages(contents, mode) → OpenAI API
```

**Pipeline Mode Data Flow**:
```
Contents → convertToOpenAIMessages(contents) → OpenAI API (always native mode)
```

#### Missing Components in Pipeline

1. **Model Detection**: No `determineToolReplayMode()` call
2. **Mode Parameter**: No `toolReplayMode` parameter passed to `convertToOpenAIMessages()`
3. **Debug Logging**: No logging when textual mode is used
4. **Configuration**: No awareness of `TEXTUAL_TOOL_REPLAY_MODELS`

### 2.2 Functional Consequences

#### Immediate Impact
- **openrouter/polaris-alpha**: Tool calls completely ignored by the model
- **User Experience**: Tools appear to not work for specific models
- **Debugging Difficulty**: No clear indication of why tools fail

#### Long-term Impact
- **Model Compatibility**: Cannot support new models requiring textual format
- **Provider Limitations**: Restricted to native-format compatible models only
- **Feature Parity**: Pipeline mode cannot fully replace Legacy mode

### 2.3 Business Impact Assessment

#### User Impact
- **Model Selection**: Users cannot use certain models with Pipeline mode
- **Functionality Loss**: Critical tool calling features unavailable
- **Migration Barrier**: Cannot migrate from Legacy to Pipeline for affected models

#### Development Impact
- **Code Maintenance**: Dual implementation paths required
- **Testing Complexity**: Need to maintain both modes
- **Feature Development**: New features must be implemented twice

---

## 3. Recommended Solution

### 3.1 Implementation Strategy

#### Phase 1: Add Tool Replay Mode Detection

**File**: `packages/core/src/providers/openai/OpenAIProvider.ts`

**Location**: Pipeline mode implementation (around line 1990)

```typescript
// Add tool replay mode detection
const toolReplayMode = this.determineToolReplayMode(model);
const messages = this.convertToOpenAIMessages(
  contents,
  toolReplayMode,  // ✅ Add mode parameter
  configForMessages,
);

// Add debug logging for transparency
if (logger.enabled && toolReplayMode !== 'native') {
  logger.debug(
    () =>
      `[OpenAIProvider] Using textual tool replay mode for model '${model}'`,
  );
}
```

#### Phase 2: Verify Integration Points

**Verification Points**:
1. Ensure `determineToolReplayMode()` method is accessible
2. Verify `convertToOpenAIMessages()` signature supports mode parameter
3. Confirm `TEXTUAL_TOOL_REPLAY_MODELS` constant is available
4. Test with `openrouter/polaris-alpha` model

### 3.2 Implementation Details

#### Required Code Changes

**Change 1**: Add mode detection in Pipeline mode
```typescript
// Before (Pipeline mode)
const messages = this.convertToOpenAIMessages(contents);

// After (Pipeline mode)
const toolReplayMode = this.determineToolReplayMode(model);
const messages = this.convertToOpenAIMessages(
  contents,
  toolReplayMode,
  configForMessages,
);
```

**Change 2**: Add debug logging
```typescript
if (logger.enabled && toolReplayMode !== 'native') {
  logger.debug(
    () =>
      `[OpenAIProvider] Using textual tool replay mode for model '${model}'`,
  );
}
```

#### Dependencies Check

**Required Existing Components**:
- ✅ `determineToolReplayMode()` method (already exists)
- ✅ `TEXTUAL_TOOL_REPLAY_MODELS` constant (already exists)
- ✅ `convertToOpenAIMessages()` with mode parameter (already exists)
- ✅ `ToolReplayMode` type definition (already exists)

**No New Dependencies Required**: All necessary components already exist in Legacy mode.

### 3.3 Testing Strategy

#### Unit Tests

**Test Case 1**: Verify textual mode detection
```typescript
it('detects textual tool replay mode for polaris-alpha in Pipeline mode', () => {
  const provider = new OpenAIProvider();
  const mode = provider['determineToolReplayMode']('openrouter/polaris-alpha');
  expect(mode).toBe('textual');
});
```

**Test Case 2**: Verify Pipeline mode uses textual mode
```typescript
it('uses textual tool replay mode in Pipeline implementation', async () => {
  const provider = new OpenAIProvider();
  const mockConvertToOpenAIMessages = jest.spyOn(provider, 'convertToOpenAIMessages');
  
  // Test with polaris-alpha model
  await provider.generatePipelineChatCompletion({
    model: 'openrouter/polaris-alpha',
    messages: [{ role: 'user', content: 'test' }],
    tools: []
  });
  
  expect(mockConvertToOpenAIMessages).toHaveBeenCalledWith(
    expect.any(Array),
    'textual',  // Should pass textual mode
    expect.any(Object)
  );
});
```

#### Integration Tests

**Test Scenario**: End-to-end tool call with polaris-alpha
```bash
# Test command
DEBUG=llxprt:* node scripts/start.js --profile-load polaris-alpha --prompt "read file /tmp/test.txt"
```

**Expected Results**:
- Tool calls should be converted to textual format
- Model should process and respond to tool calls
- Debug logs should show textual mode usage

### 3.4 Risk Assessment and Mitigation

#### Risk Identification

**Low Risk**:
- All required components already exist
- Change is minimal and well-contained
- Legacy mode provides proven implementation

**Medium Risk**:
- Potential interaction with other Pipeline features
- Need to ensure consistent behavior across all Pipeline paths

#### Mitigation Measures

1. **Incremental Implementation**: Add feature step by step
2. **Comprehensive Testing**: Test with multiple models and scenarios
3. **Rollback Capability**: Keep original code as fallback
4. **Monitoring**: Add logging to track mode usage

### 3.5 Success Criteria

#### Functional Verification
- [ ] `openrouter/polaris-alpha` tool calls work in Pipeline mode
- [ ] Debug logs show textual mode activation
- [ ] No regression for native mode models
- [ ] All existing Pipeline tests pass

#### Quality Assurance
- [ ] TypeScript compilation successful
- [ ] No ESLint warnings
- [ ] Test coverage maintained
- [ ] Documentation updated

#### Performance Standards
- [ ] No performance degradation
- [ ] Memory usage unchanged
- [ ] Processing time comparable to Legacy mode

---

## 4. Implementation Timeline

### Phase 1: Core Implementation (2-4 hours)
- Add tool replay mode detection to Pipeline mode
- Implement mode parameter passing
- Add debug logging

### Phase 2: Testing and Validation (2-3 hours)
- Create unit tests
- Perform integration testing with polaris-alpha
- Verify no regression for other models

### Phase 3: Documentation and Cleanup (1-2 hours)
- Update documentation
- Code review and cleanup
- Final validation

**Total Estimated Time**: 5-9 hours

---

## 5. Conclusion

### 5.1 Key Insights

1. **Critical Missing Feature**: Tool replay mode support is essential for certain models
2. **Simple Implementation**: All required components already exist
3. **Low Risk**: Minimal changes with high impact
4. **Complete Compatibility**: Enables full Legacy-to-Pipeline migration

### 5.2 Business Value

- **Model Compatibility**: Enables support for all OpenAI-compatible models
- **User Experience**: Consistent tool call behavior across all models
- **Migration Path**: Removes barrier for complete Pipeline adoption
- **Future Proof**: Ready for new models requiring textual format

### 5.3 Next Steps

1. **Immediate**: Implement core tool replay mode detection
2. **Short-term**: Comprehensive testing with affected models
3. **Long-term**: Monitor for new models requiring textual support

---

## Implementation Status Update (2025-11-15)

### ❌ NOT IMPLEMENTED
- **Pipeline Mode**: Still missing `determineToolReplayMode()` integration
- **convertToOpenAIMessages()**: Called without `toolReplayMode` parameter in Pipeline
- **openrouter/polaris-alpha**: Cannot use tool calls in Pipeline mode
- **Debug Logging**: Missing textual mode activation logs

### Current Code State
```typescript
// Pipeline mode (line 1990) - MISSING tool replay mode
const messages = this.convertToOpenAIMessages(contents);
// Should be:
const toolReplayMode = this.determineToolReplayMode(model);
const messages = this.convertToOpenAIMessages(contents, toolReplayMode, configForMessages);
```

### Impact
- **Model Compatibility**: polaris-alpha and similar models broken in Pipeline
- **Migration Barrier**: Cannot fully migrate from Legacy to Pipeline
- **Feature Parity**: Incomplete - Legacy supports textual mode, Pipeline doesn't

---

**Report Creation Date**: 2025-11-13
**Status Update Date**: 2025-11-15
**Problem Severity**: High (blocks specific model usage)
**Implementation Priority**: High (enables full Pipeline compatibility)
**Expected Resolution**: 1-2 days
**Actual Status**: NOT STARTED - Critical feature missing