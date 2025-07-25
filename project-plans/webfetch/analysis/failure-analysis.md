# Web-Fetch Failure Analysis

## Executive Summary

Web-fetch is broken because it has overly aggressive error checking that triggers fallback for most URLs, even when they succeed. The fallback mechanism can't use AI processing, so users get raw HTML instead of summaries.

## Root Cause

The problem is in the error checking logic (lines 348-379 in web-fetch.ts):

```typescript
// Error Handling
let processingError = false;

if (urlContextMeta?.urlMetadata && urlContextMeta.urlMetadata.length > 0) {
  const allStatuses = urlContextMeta.urlMetadata.map(
    (m: UrlMetadata) => m.urlRetrievalStatus,
  );
  if (allStatuses.every((s: string | undefined) => s !== 'URL_RETRIEVAL_STATUS_SUCCESS')) {
    processingError = true;  // <-- TRIGGERS FALLBACK
  }
} else if (!responseText.trim() && !sources?.length) {
  processingError = true;
}

if (processingError) {
  return this.executeFallback(params, signal);  // <-- FALLS BACK TO LOCAL FETCH
}
```

## Comparison: Web-Search vs Web-Fetch

### Web-Search (WORKING) - Simple and Clean

```typescript
// 1. Call server tool
const response = await serverToolsProvider.invokeServerTool('web_search', { query }, { signal });

// 2. Extract text using utility function
const responseText = getResponseText(geminiResponse);

// 3. Simple check - if no text, return error
if (!responseText || !responseText.trim()) {
  return {
    llmContent: `No search results or information found for query: "${params.query}"`,
    returnDisplay: 'No information found.',
  };
}

// 4. Process grounding metadata and return
```

### Web-Fetch (BROKEN) - Overly Complex

```typescript
// 1. Call server tool
const response = await serverToolsProvider.invokeServerTool('web_fetch', { prompt }, { signal });

// 2. Manual text extraction (not using getResponseText)
let responseText = '';
if (candidate?.content?.parts) {
  responseText = candidate.content.parts
    .filter((part): part is { text: string } => ...)
    .map((part) => part.text)
    .join('');
}

// 3. Complex error checking that triggers fallback
if (urlContextMeta?.urlMetadata) {
  // Check URL retrieval status
  if (allStatuses.every(s => s !== 'URL_RETRIEVAL_STATUS_SUCCESS')) {
    processingError = true;  // PROBLEM: This triggers for many valid responses!
  }
}

// 4. Falls back to local fetch which can't use AI
if (processingError) {
  return this.executeFallback(params, signal);
}
```

## Why Web-Fetch Fails

1. **URL_RETRIEVAL_STATUS_ERROR doesn't mean failure** - Gemini often returns this status but still provides valid content (as we saw in the debug output)

2. **Fallback can't use AI** - The executeFallback method does a local HTTP fetch but can't process the content with AI, so it returns raw HTML

3. **Over-engineering** - Web-search works perfectly with just a simple text check. Web-fetch added unnecessary complexity.

## Evidence from Debug Output

From the user's example:
```json
{
  "urlRetrievalStatus": "URL_RETRIEVAL_STATUS_ERROR",
  "text": "I am sorry, but I am unable to access the content..."
}
```

Despite the "ERROR" status, Gemini actually DID provide a summary of the content! But web-fetch's error checking triggered the fallback.

## The Pattern That Works

Web-search demonstrates the correct pattern:
1. Call serverToolsProvider.invokeServerTool()
2. Use getResponseText() to extract text
3. Check if text exists
4. Process grounding metadata
5. Return result

No complex error checking. No fallback. Just trust the response.

## Conclusion

Web-fetch is broken because:
1. It doesn't trust Gemini's responses
2. It has unnecessary error checking that triggers fallback
3. The fallback mechanism makes things worse by returning raw HTML
4. It doesn't use the proven pattern from web-search

The fix is simple: Make web-fetch work exactly like web-search - remove the complex error checking and fallback mechanism.