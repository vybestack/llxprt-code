# ServerToolsProvider Pattern Analysis

## Overview

The ServerToolsProvider pattern separates the concept of the "active provider" (used for chat completions) from the "server tools provider" (used for native provider tools like web search). This allows users to use different providers for different purposes while maintaining authentication state.

## Architecture Flow

### 1. Tool → Provider Manager → Server Tools Provider → Response

The flow for server tools (like web search) follows this pattern:

```
WebSearchTool.execute()
    ↓
config.getContentGeneratorConfig().providerManager
    ↓
providerManager.getServerToolsProvider()
    ↓
serverToolsProvider.invokeServerTool('web_search', params, config)
    ↓
Response (with grounding metadata)
```

## Key Components

### 1. IProvider Interface

The `IProvider` interface defines the contract for server tools:

```typescript
export interface IProvider {
  // ... other methods ...
  
  // ServerTool methods for provider-native tools
  getServerTools(): string[];
  invokeServerTool(
    toolName: string,
    params: unknown,
    config?: unknown,
  ): Promise<unknown>;
}
```

### 2. ProviderManager

The ProviderManager maintains separate references for active provider and server tools provider:

```typescript
export class ProviderManager implements IProviderManager {
  private providers: Map<string, IProvider>;
  private activeProviderName: string;
  private serverToolsProvider: IProvider | null;

  getServerToolsProvider(): IProvider | null {
    // If we have a configured serverToolsProvider, return it
    if (this.serverToolsProvider) {
      return this.serverToolsProvider;
    }

    // Otherwise, try to get Gemini if available
    const geminiProvider = this.providers.get('gemini');
    if (geminiProvider) {
      this.serverToolsProvider = geminiProvider;
      return geminiProvider;
    }

    return null;
  }
}
```

### 3. WebSearchTool Implementation

The web-search tool demonstrates the complete pattern:

```typescript
async execute(params: WebSearchToolParams, signal: AbortSignal): Promise<WebSearchToolResult> {
  // Step 1: Get content generator config
  const contentGenConfig = this.config.getContentGeneratorConfig();

  // Step 2: Check for provider manager
  if (!contentGenConfig?.providerManager) {
    return {
      llmContent: `Web search requires a provider. Please use --provider gemini with authentication.`,
      returnDisplay: 'Web search requires a provider.',
    };
  }

  // Step 3: Get server tools provider
  const serverToolsProvider = contentGenConfig.providerManager.getServerToolsProvider();
  if (!serverToolsProvider) {
    return {
      llmContent: `Web search requires Gemini provider to be configured. Please ensure Gemini is available with authentication.`,
      returnDisplay: 'Web search requires Gemini provider.',
    };
  }

  // Step 4: Check if provider supports the specific tool
  const serverTools = serverToolsProvider.getServerTools();
  if (!serverTools.includes('web_search')) {
    return {
      llmContent: `Web search is not available. The server tools provider does not support web search.`,
      returnDisplay: `Web search not available.`,
    };
  }

  // Step 5: Invoke the server tool
  const response = await serverToolsProvider.invokeServerTool(
    'web_search',
    { query: params.query },
    { signal },
  );

  // Step 6: Process response (with type casting)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geminiResponse = response as any;
  const responseText = getResponseText(geminiResponse);
  const groundingMetadata = geminiResponse?.candidates?.[0]?.groundingMetadata;
  
  // ... process grounding metadata and format response ...
}
```

## Error Handling Patterns

### 1. Missing Provider Manager

```typescript
if (!contentGenConfig?.providerManager) {
  return {
    llmContent: `Web search requires a provider. Please use --provider gemini with authentication.`,
    returnDisplay: 'Web search requires a provider.',
  };
}
```

### 2. Missing Server Tools Provider

```typescript
const serverToolsProvider = contentGenConfig.providerManager.getServerToolsProvider();
if (!serverToolsProvider) {
  return {
    llmContent: `Web search requires Gemini provider to be configured. Please ensure Gemini is available with authentication.`,
    returnDisplay: 'Web search requires Gemini provider.',
  };
}
```

### 3. Unsupported Tool Check

```typescript
const serverTools = serverToolsProvider.getServerTools();
if (!serverTools.includes('web_search')) {
  return {
    llmContent: `Web search is not available. The server tools provider does not support web search.`,
    returnDisplay: `Web search not available.`,
  };
}
```

## Authentication Requirements

### GeminiProvider Authentication Modes

The GeminiProvider supports multiple authentication modes, each with different capabilities:

```typescript
async invokeServerTool(toolName: string, params: unknown, _config?: unknown): Promise<unknown> {
  if (toolName === 'web_search') {
    switch (this.authMode) {
      case 'gemini-api-key': {
        // Uses GEMINI_API_KEY environment variable
        genAI = new GoogleGenAI({
          apiKey: this.apiKey || process.env.GEMINI_API_KEY,
          httpOptions,
        });
        // ... generate content with googleSearch tool ...
        break;
      }
      
      case 'oauth': {
        // Uses OAuth authentication via code assist
        const oauthContentGenerator = await createCodeAssistContentGenerator(
          httpOptions,
          AuthType.LOGIN_WITH_GOOGLE,
          this.config!,
        );
        // ... generate content with googleSearch tool ...
        break;
      }
      
      case 'vertex-ai': {
        // Uses Vertex AI with Google API key
        genAI = new GoogleGenAI({
          apiKey: process.env.GOOGLE_API_KEY,
          vertexai: true,
          httpOptions,
        });
        // ... generate content with googleSearch tool ...
        break;
      }
      
      default:
        throw new Error(`Web search not supported in auth mode: ${this.authMode}`);
    }
  }
}
```

## Separation of Active and Server Tools Provider

The ProviderManager maintains this separation:

1. **Active Provider**: Used for chat completions and regular tool calls
2. **Server Tools Provider**: Used specifically for native provider tools

Key logic in `setActiveProvider`:

```typescript
setActiveProvider(name: string): void {
  // ... validation and state clearing logic ...

  this.activeProviderName = name;

  // If switching to Gemini, use it as both active and serverTools provider
  // BUT only if we don't already have a Gemini serverToolsProvider with auth state
  if (name === 'gemini') {
    // Only replace serverToolsProvider if it's not already Gemini or if it's null
    if (!this.serverToolsProvider || this.serverToolsProvider.name !== 'gemini') {
      this.serverToolsProvider = this.providers.get(name) || null;
    }
  }
  // If switching away from Gemini but serverToolsProvider is not set,
  // configure a Gemini provider for serverTools if available
  else if (!this.serverToolsProvider && this.providers.has('gemini')) {
    this.serverToolsProvider = this.providers.get('gemini') || null;
  }
}
```

This ensures:
- Gemini provider is preferred for server tools
- Authentication state is preserved when switching providers
- Server tools remain available even when using a different active provider

## Implementation Pattern for web-fetch

To implement web-fetch following this pattern:

1. **Check for provider manager**:
   ```typescript
   const contentGenConfig = this.config.getContentGeneratorConfig();
   if (!contentGenConfig?.providerManager) {
     return { error: 'Provider manager not available' };
   }
   ```

2. **Get server tools provider**:
   ```typescript
   const serverToolsProvider = contentGenConfig.providerManager.getServerToolsProvider();
   if (!serverToolsProvider) {
     return { error: 'Server tools provider not available' };
   }
   ```

3. **Check tool support**:
   ```typescript
   const serverTools = serverToolsProvider.getServerTools();
   if (!serverTools.includes('web_fetch')) {
     return { error: 'web_fetch not supported by provider' };
   }
   ```

4. **Invoke the tool**:
   ```typescript
   const response = await serverToolsProvider.invokeServerTool(
     'web_fetch',
     { url: params.url },
     { signal }
   );
   ```

5. **Process response with proper type handling**:
   ```typescript
   // eslint-disable-next-line @typescript-eslint/no-explicit-any
   const fetchResponse = response as any;
   // Extract and process the response content
   ```

## Summary

The ServerToolsProvider pattern provides:
- Clean separation between chat and tool providers
- Consistent authentication handling
- Graceful fallbacks for missing providers
- Type-safe interfaces with controlled any usage
- Clear error messages for users

This pattern ensures that server-native tools like web search and web fetch can be used regardless of the active chat provider, while maintaining proper authentication and error handling throughout the system.