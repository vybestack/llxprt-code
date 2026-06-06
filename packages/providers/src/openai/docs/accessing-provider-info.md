# Accessing OpenAI Provider Information

This document explains how to access the OpenAI provider instance, conversation cache, and remote token information from within the React components.

## Overview

The OpenAI provider information can be accessed through the Config object that's passed to the App component. We've created utilities to make this access type-safe and convenient.

## Key Components

### 1. `getOpenAIProviderInfo()` Function

Located in `src/providers/openai/getOpenAIProviderInfo.ts`, this function extracts OpenAI provider information from the Config object:

```typescript
import { getOpenAIProviderInfo } from '../../providers/openai/getOpenAIProviderInfo.js';

// In your component
const openAIInfo = getOpenAIProviderInfo(config);

if (openAIInfo.provider) {
  console.log('OpenAI provider is active');
  console.log('Current model:', openAIInfo.currentModel);
  console.log('Using Responses API:', openAIInfo.isResponsesAPI);
}
```

### 2. `useOpenAIProviderInfo()` Hook

Located in `src/ui/hooks/useOpenAIProviderInfo.ts`, this React hook provides reactive access to provider information:

```typescript
import { useOpenAIProviderInfo } from './hooks/useOpenAIProviderInfo.js';

function MyComponent({ config }) {
  const openAIInfo = useOpenAIProviderInfo(config);

  // Access conversation cache
  const cachedMessages = openAIInfo.getCachedConversation(
    conversationId,
    parentId,
  );

  // Check if using Responses API
  if (openAIInfo.isResponsesAPI) {
    // Handle Responses API specific logic
  }
}
```

### 3. `OpenAIProviderContext`

Located in `src/ui/contexts/OpenAIProviderContext.tsx`, this context provides global access to OpenAI provider state including remote token tracking:

```typescript
// Wrap your app
<OpenAIProviderContextProvider config={config}>
  <App {...props} />
</OpenAIProviderContextProvider>

// Use in components
import { useOpenAIProviderContext } from '../contexts/OpenAIProviderContext.js';

function TokenDisplay() {
  const { remoteTokenStats, isResponsesAPI } = useOpenAIProviderContext();

  if (isResponsesAPI && remoteTokenStats.lastUpdated) {
    return (
      <div>
        Remote Tokens: {remoteTokenStats.totalTokenCount}
      </div>
    );
  }

  return null;
}
```

## Integration Example

Here's how to integrate OpenAI provider information access in the App component:

```typescript
// In App.tsx
import { useOpenAIProviderInfo } from './hooks/useOpenAIProviderInfo.js';

const App = ({ config, settings, startupWarnings = [] }: AppProps) => {
  // Access OpenAI provider info
  const openAIInfo = useOpenAIProviderInfo(config);

  // Use in your component logic
  useEffect(() => {
    if (openAIInfo.isOpenAIActive && openAIInfo.isResponsesAPI) {
      console.log(
        'OpenAI Responses API is active for model:',
        openAIInfo.currentModel,
      );
    }
  }, [openAIInfo]);

  // Access conversation cache when needed
  const handleConversationLookup = (
    conversationId: string,
    parentId: string,
  ) => {
    const cached = openAIInfo.getCachedConversation(conversationId, parentId);
    if (cached) {
      console.log('Found cached conversation:', cached);
    }
  };

  // ... rest of component
};
```

## Tracking Remote Tokens

To track remote tokens from the Responses API, you need to update the token stats when receiving responses:

```typescript
// In your API response handler
const handleResponsesAPIResponse = (response: any) => {
  // Extract token information from response
  const usage = response.usage;

  if (usage) {
    // Update remote token stats in context
    updateRemoteTokenStats({
      promptTokenCount: usage.prompt_tokens,
      candidatesTokenCount: usage.completion_tokens,
      totalTokenCount: usage.total_tokens,
    });
  }
};
```

## Type Safety

All interfaces are properly typed:

```typescript
interface OpenAIProviderInfo {
  provider: OpenAIProvider | null;
  conversationCache: ConversationCache | null;
  isResponsesAPI: boolean;
  currentModel: string | null;
  remoteTokenInfo: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}
```

## Best Practices

1. **Check for null values**: Always check if the provider is active before accessing its properties
2. **Use the hook in components**: Prefer `useOpenAIProviderInfo` hook over direct function calls for reactive updates
3. **Context for global state**: Use `OpenAIProviderContext` when you need to share provider state across multiple components
4. **Handle provider switches**: The utilities automatically handle when users switch between providers

## Accessing Internal Properties

Since some properties of OpenAIProvider are private, we use type casting to access them:

```typescript
// Access private properties (use with caution)
const conversationCache = (openaiProvider as any).conversationCache;
const shouldUseResponses = (openaiProvider as any).shouldUseResponses;
```

This approach provides type safety where possible while still allowing access to necessary internal state.
