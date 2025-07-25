# Web-Fetch ServerToolsProvider Pattern Requirements

## Overview

The web-fetch tool must be refactored to follow the ServerToolsProvider pattern established by web-search.ts. This will enable web-fetch to work with any active provider (OpenAI, Anthropic, or Gemini) by delegating the actual URL fetching to Gemini through the ServerToolsProvider abstraction.

## Core Architecture Requirements

### 1. ServerToolsProvider Pattern

The web-fetch tool must follow the exact pattern used by web-search.ts:

```typescript
// Get the serverToolsProvider from the provider manager
const contentGenConfig = this.config.getContentGeneratorConfig();
if (!contentGenConfig?.providerManager) {
  // Handle missing provider manager
}

const serverToolsProvider = contentGenConfig.providerManager.getServerToolsProvider();
if (!serverToolsProvider) {
  // Handle missing server tools provider
}

// Check if the provider supports web_fetch
const serverTools = serverToolsProvider.getServerTools();
if (!serverTools.includes('web_fetch')) {
  // Handle unsupported tool
}

// Invoke the server tool
const response = await serverToolsProvider.invokeServerTool(
  'web_fetch',
  { prompt: params.prompt },
  { signal }
);
```

### 2. Provider Implementation

#### Gemini Provider Changes

The GeminiProvider must implement the `web_fetch` server tool:

1. Add 'web_fetch' to the array returned by `getServerTools()`
2. Implement web_fetch handling in `invokeServerTool()`:
   - Pass the prompt directly to urlContext without modification
   - Use the urlContext tool with appropriate auth mode
   - Return the response in the expected format
   - NO URL extraction or transformation in the provider
   - NO special handling for any specific domains

### 3. Provider-Agnostic Design

The web-fetch tool must work regardless of which provider is active:

- **Active Provider**: Handles the main conversation and tool calls
- **ServerToolsProvider**: Always Gemini (for now), handles web_fetch execution
- **Authentication**: Each provider uses its own authentication, but Gemini must be authenticated for web_fetch to work

### 4. Authentication Flow

The authentication must work exactly like web-search:

1. The active provider uses its own authentication (OpenAI key, Anthropic key, or Gemini auth)
2. The ServerToolsProvider (Gemini) must be separately authenticated
3. If Gemini is not authenticated, return appropriate error messages
4. Support all Gemini auth modes: OAuth, API key, and Vertex AI

## Code Quality Requirements

### 1. TypeScript Strict Mode

- **NO `any` types**: All types must be properly defined
- **NO type assertions without validation**: Use type guards instead
- **NO `//@ts-ignore` or `//@ts-expect-error`**
- **NO relaxing of lint rules**
- **NO test fitting**: No special handling for specific URLs or domains
- **NO hardcoded patterns**: Implementation must be generic and work for all URLs

### 2. Proper Type Definitions

Instead of:
```typescript
const geminiResponse = response as any;
```

Use:
```typescript
interface GeminiWebFetchResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    groundingMetadata?: {
      groundingChunks?: GroundingChunkItem[];
      groundingSupports?: GroundingSupportItem[];
    };
    urlContextMetadata?: {
      urlMetadata?: Array<{
        url?: string;
        urlRetrievalStatus?: string;
      }>;
    };
  }>;
}

const geminiResponse = response as GeminiWebFetchResponse;
```

### 3. Error Handling

- Proper error types and handling
- Clear error messages for missing authentication
- Graceful fallback for failures

## Implementation Changes

### 1. Remove Direct Gemini Client Usage

Current code to remove:
```typescript
const geminiClient = this.config.getGeminiClient();
```

### 2. Keep Fallback Mechanism in WebFetch

The fallback mechanism should remain in web-fetch.ts. The GeminiProvider should NOT implement any fallback logic or URL transformations.

### 3. Simplify Tool Logic

The tool should only:
1. Validate parameters
2. Get the ServerToolsProvider
3. Invoke the server tool
4. Process and return the response

## Test Requirements

The following test commands MUST work exactly as specified:

### Test 1: Gemini Provider
```bash
node scripts/start.js --provider gemini --model gemini-2.5-pro --keyfile ~/.google_key --prompt "do a web-fetch of https://vybestack.dev/blog/rendered/2025-07-21-llxpt-code-12.html and summarize"
```

### Test 2: OpenAI Provider
```bash
node scripts/start.js --provider openai --model gpt-4.1 --keyfile ~/.openai_key --prompt "do a web-fetch of https://vybestack.dev/blog/rendered/2025-07-21-llxpt-code-12.html and summarize"
```

### Test 3: Anthropic Provider
```bash
node scripts/start.js --provider anthropic --keyfile ~/.anthropic_key --model claude-sonnet-4-latest --prompt "do a web-fetch of https://vybestack.dev/blog/rendered/2025-07-21-llxpt-code-12.html and summarize"
```

**IMPORTANT**: 
- Do NOT change the URLs
- Do NOT change the model names or numbers
- Do NOT modify the prompts
- The exact strings must be used as provided

## Expected Behavior

1. **When Gemini is active provider**: Uses Gemini for both conversation and web-fetch
2. **When OpenAI is active provider**: Uses OpenAI for conversation, Gemini for web-fetch
3. **When Anthropic is active provider**: Uses Anthropic for conversation, Gemini for web-fetch

## Error Messages

Consistent with web-search error messages:

- Missing provider manager: "Web fetch requires a provider. Please use --provider gemini with authentication."
- Missing server tools provider: "Web fetch requires Gemini provider to be configured. Please ensure Gemini is available with authentication."
- Unsupported tool: "Web fetch is not available. The server tools provider does not support web fetch."

## Migration Checklist

- [ ] Remove direct Gemini client usage from web-fetch.ts
- [ ] Implement ServerToolsProvider pattern in web-fetch.ts
- [ ] Add web_fetch to GeminiProvider's getServerTools()
- [ ] Implement web_fetch in GeminiProvider's invokeServerTool()
- [ ] Move fallback logic to GeminiProvider
- [ ] Define proper TypeScript interfaces for all responses
- [ ] Remove all `any` types
- [ ] Ensure all lint rules pass
- [ ] Test with all three provider scenarios
- [ ] Verify error messages match requirements