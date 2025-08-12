# GLM-4.5 Tool Format Implementation Plan

## ⚠️ CRITICAL: INTEGRATION REQUIRED

**This feature MUST be integrated into the existing OpenAIProvider, not built as isolated classes.**

## Overview

This plan implements tool format detection for GLM-4.5 models by:
1. Adding toolFormat to the existing SettingsService
2. Modifying OpenAIProvider to detect and apply formats
3. Actually using it in API calls
4. Testing with real GLM-4.5 models

## Key Components (ALL IN EXISTING PROVIDER)

1. **detectToolFormat() method**: Added to OpenAIProvider to detect format
2. **formatToolsForAPI() method**: Added to OpenAIProvider to format tools
3. **parseToolResponse() method**: Added to OpenAIProvider to parse responses
4. **SettingsService integration**: Use existing service for toolFormat setting

## Implementation Phases

### Phase 1: Settings Integration
- Add toolFormat field to ProviderSettings type
- Update SettingsService to handle toolFormat

### Phase 2: OpenAIProvider Enhancement
- Add detectToolFormat() method to check settings and auto-detect
- Add formatToolsForAPI() method to apply correct format
- Add parseToolResponse() method for format-specific parsing

### Phase 3: Actual Integration
- Update generateChatCompletion() to use formatToolsForAPI()
- Update generateChatCompletionStreaming() to use formatToolsForAPI()
- Ensure tool responses are parsed correctly

### Phase 4: Integration with Existing CLI
- Use existing /toolformat command (already implemented)
- Store override in SettingsService for persistence
- Update diagnostics to show current tool format

### Phase 5: Testing & Verification
- Test with actual GLM-4.5 model
- Verify Qwen format is applied
- Ensure settings override works

## Success Criteria

- ✅ GLM-4.5 uses Qwen format automatically when detected
- ✅ Settings override works via `/toolformat qwen`
- ✅ Changes are IN OpenAIProvider, not separate classes
- ✅ Actually works with real GLM-4.5 API calls
- ✅ No unused code or isolated classes