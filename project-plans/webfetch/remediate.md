# Web-Fetch Remediation Plan

## Overview

This plan fixes web-fetch by simplifying it to match the successful web-search pattern while maintaining the core functionality from Google's original implementation.

## Root Cause Analysis (from failure-analysis.md)

1. **Overly aggressive error checking**: Treats `URL_RETRIEVAL_STATUS_ERROR` as failure even when content is provided
2. **Unnecessary fallback**: Falls back to local fetch which can't use AI processing
3. **Not using utility functions**: Manual text extraction instead of `getResponseText()`
4. **Complex logic**: Over-engineered compared to the simple web-search pattern

## Requirements

### 1. Follow Web-Search Pattern

Web-search shows the correct approach:
```typescript
// 1. Get server tools provider
const serverToolsProvider = contentGenConfig.providerManager.getServerToolsProvider();

// 2. Call server tool
const response = await serverToolsProvider.invokeServerTool('web_fetch', { prompt }, { signal });

// 3. Extract text using utility
const responseText = getResponseText(response);

// 4. Simple check - if no text, return error
if (!responseText || !responseText.trim()) {
  return { llmContent: 'No content found', returnDisplay: 'No content found' };
}

// 5. Process grounding metadata and return
```

### 2. Preserve Core Functionality

From Google's original implementation, keep:
- URL validation (must contain http:// or https://)
- Grounding metadata processing (citations and sources)
- Prompt truncation for display
- GitHub URL transformation (in fallback only)

### 3. Simplify Error Handling

- Remove complex `processingError` logic
- Remove checking of `URL_RETRIEVAL_STATUS`
- Trust the response - if there's text, use it
- Only fall back for private IPs (localhost, 192.168.x.x)

### 4. Fix Fallback

The fallback should only be used for private IPs and should return a clear message that AI processing isn't available for local URLs.

## Implementation Plan

### Phase 1: Simplify web-fetch.ts

**Task**: Refactor web-fetch.ts to match web-search pattern

**Changes**:
1. Import and use `getResponseText` from `generateContentResponseUtilities.js`
2. Remove complex error checking logic
3. Simplify text extraction to use `getResponseText()`
4. Keep fallback ONLY for private IPs
5. Update fallback to clearly indicate it's for private IPs only

**Code structure**:
```typescript
async execute(params: WebFetchToolParams, signal: AbortSignal): Promise<ToolResult> {
  // 1. Validate params
  
  // 2. Check for private IPs - use fallback
  const urls = extractUrls(params.prompt);
  if (urls.length > 0 && isPrivateIp(urls[0])) {
    return this.executeFallback(params, signal);
  }
  
  // 3. Get server tools provider (existing code)
  
  // 4. Call server tool (existing code)
  
  // 5. Extract text using getResponseText()
  const responseText = getResponseText(response as any);
  
  // 6. Simple check - if no text, return error
  if (!responseText || !responseText.trim()) {
    return {
      llmContent: `No content found for the provided URL(s).`,
      returnDisplay: 'No content found.',
    };
  }
  
  // 7. Process grounding metadata (existing code)
  
  // 8. Return result
}
```

### Phase 2: Update imports

**Task**: Add missing import for getResponseText

**Changes**:
```typescript
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
```

### Phase 3: Fix fallback message

**Task**: Update fallback to be clear about its purpose

**Changes**:
- Change error message to: "Private/local URLs cannot be processed with AI. Raw content provided below."
- Keep the existing fetch logic but improve the message

## Verification Plan

### Phase 1 Review: Code Quality Check

**Reviewer**: typescript-code-reviewer

**Check**:
1. No complex error checking logic remains
2. Uses `getResponseText()` utility
3. Fallback only triggers for private IPs
4. No 'any' types (except controlled cast for response)
5. Follows web-search pattern

### Phase 2 Review: Functional Testing

**Tests**:
1. Public URL: `https://example.com` - Should use server tool and return summary
2. Private URL: `http://localhost:3000` - Should use fallback with clear message
3. Invalid URL in prompt - Should return appropriate error
4. URL with retrieval error - Should still return content if available

### Phase 3 Review: Integration Testing

**Verify**:
1. Works with all providers (Gemini, OpenAI, Anthropic as active)
2. Always uses Gemini as server tools provider
3. No regression in existing functionality

## Success Criteria

1. **Simplified code**: Remove ~50 lines of unnecessary error checking
2. **Consistent behavior**: Works like web-search - trusts the response
3. **Clear fallback**: Only for private IPs with clear messaging
4. **No breaking changes**: Maintains public API and behavior
5. **Type safety**: No new 'any' types, proper typing throughout

## Execution Steps

1. **Backup current state**: Git commit current implementation
2. **Implement Phase 1**: Simplify execute() method
3. **Implement Phase 2**: Add imports
4. **Implement Phase 3**: Fix fallback messaging
5. **Run verification**: All three review phases
6. **Test commands**: Verify the three test scenarios work
7. **Commit and push**: Final implementation

## Risk Mitigation

- Keep original functionality for private IPs
- Preserve all grounding metadata processing
- Maintain backward compatibility
- Test thoroughly before committing