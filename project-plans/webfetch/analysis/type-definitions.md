# Web Fetch TypeScript Interface Definitions

## Overview

This document contains comprehensive TypeScript interface definitions for the web-fetch refactoring, based on:
- The current implementation in `packages/core/src/tools/web-fetch.ts`
- The Gemini provider's response types from `@google/genai`
- The server tool invocation pattern used by GeminiProvider

## Core Response Types

### WebFetchServerToolResponse

```typescript
/**
 * Response structure from Gemini's web_fetch server tool (urlContext)
 * This matches the GenerateContentResponse structure from @google/genai
 */
interface WebFetchServerToolResponse {
  /** Response variations returned by the model */
  candidates?: Array<{
    /** Generated content from the model */
    content?: {
      /** Array of content parts (text, function calls, etc.) */
      parts?: Array<{
        /** Text content if this is a text part */
        text?: string;
      }>;
      /** Role of the content generator */
      role?: string;
    };
    /** Reason why generation stopped */
    finishReason?: string;
    /** Metadata related to URL context retrieval tool */
    urlContextMetadata?: UrlContextMetadata;
    /** Metadata for grounding/citations */
    groundingMetadata?: GroundingMetadata;
    /** Safety ratings for the response */
    safetyRatings?: SafetyRating[];
    /** Index of this candidate in the response */
    index?: number;
  }>;
  /** Timestamp when the request was made */
  createTime?: string;
  /** Unique identifier for this response */
  responseId?: string;
  /** Model version used to generate the response */
  modelVersion?: string;
  /** Usage metadata about tokens consumed */
  usageMetadata?: GenerateContentResponseUsageMetadata;
}
```

### URL Context Metadata Types

```typescript
/**
 * Metadata related to URL context retrieval tool
 * Contains information about URLs that were fetched
 */
interface UrlContextMetadata {
  /** List of URL metadata for each retrieved URL */
  urlMetadata?: UrlMetadata[];
}

/**
 * Context and status for a single URL retrieval
 */
interface UrlMetadata {
  /** The URL that was retrieved by the tool */
  retrievedUrl?: string;
  /** Status of the URL retrieval operation */
  urlRetrievalStatus?: UrlRetrievalStatus;
}

/**
 * Enum for URL retrieval status values
 */
enum UrlRetrievalStatus {
  /** Default/unspecified status */
  URL_RETRIEVAL_STATUS_UNSPECIFIED = 'URL_RETRIEVAL_STATUS_UNSPECIFIED',
  /** URL was successfully retrieved */
  URL_RETRIEVAL_STATUS_SUCCESS = 'URL_RETRIEVAL_STATUS_SUCCESS',
  /** URL retrieval failed */
  URL_RETRIEVAL_STATUS_FAILED = 'URL_RETRIEVAL_STATUS_FAILED',
  /** URL was not found (404) */
  URL_RETRIEVAL_STATUS_NOT_FOUND = 'URL_RETRIEVAL_STATUS_NOT_FOUND',
  /** Access to URL was forbidden */
  URL_RETRIEVAL_STATUS_FORBIDDEN = 'URL_RETRIEVAL_STATUS_FORBIDDEN',
  /** Request timed out */
  URL_RETRIEVAL_STATUS_TIMEOUT = 'URL_RETRIEVAL_STATUS_TIMEOUT'
}
```

### Grounding Metadata Types

```typescript
/**
 * Metadata for grounding/citation information
 * Used to track sources and attributions in generated content
 */
interface GroundingMetadata {
  /** List of supporting references retrieved from grounding sources */
  groundingChunks?: GroundingChunk[];
  /** List of grounding support segments with citation indices */
  groundingSupports?: GroundingSupport[];
  /** Retrieval metadata for the grounding operation */
  retrievalMetadata?: RetrievalMetadata;
  /** Queries executed by retrieval tools */
  retrievalQueries?: string[];
  /** Google search entry point for follow-up searches */
  searchEntryPoint?: SearchEntryPoint;
  /** Web search queries for follow-up web searches */
  webSearchQueries?: string[];
}

/**
 * Individual grounding chunk representing a source
 */
interface GroundingChunk {
  /** Grounding chunk from context retrieved by retrieval tools */
  retrievedContext?: GroundingChunkRetrievedContext;
  /** Grounding chunk from the web */
  web?: GroundingChunkWeb;
}

/**
 * Web-based grounding chunk information
 */
interface GroundingChunkWeb {
  /** Domain of the original URI */
  domain?: string;
  /** Title of the chunk/page */
  title?: string;
  /** URI reference of the chunk */
  uri?: string;
}

/**
 * Context-based grounding chunk from retrieval tools
 */
interface GroundingChunkRetrievedContext {
  /** Additional context for RAG retrieval */
  ragChunk?: RagChunk;
  /** Text of the attribution */
  text?: string;
  /** Title of the attribution */
  title?: string;
  /** URI reference of the attribution */
  uri?: string;
}

/**
 * Grounding support linking content segments to source chunks
 */
interface GroundingSupport {
  /** Confidence scores for each reference (0-1 range) */
  confidenceScores?: number[];
  /** Indices into groundingChunks array for citations */
  groundingChunkIndices?: number[];
  /** Content segment this support belongs to */
  segment?: Segment;
}

/**
 * Segment of content with position information
 */
interface Segment {
  /** End index in the Part, measured in bytes (exclusive) */
  endIndex: number;
  /** Index of the Part within its parent Content */
  partIndex?: number;
  /** Start index in the Part, measured in bytes (inclusive) */
  startIndex: number;
  /** Text corresponding to this segment */
  text?: string;
}
```

### Supporting Types

```typescript
/**
 * Safety rating for generated content
 */
interface SafetyRating {
  /** Category of the safety concern */
  category?: string;
  /** Probability level of the safety concern */
  probability?: string;
  /** Whether this content was blocked */
  blocked?: boolean;
}

/**
 * Usage metadata for token consumption
 */
interface GenerateContentResponseUsageMetadata {
  /** Number of tokens in the prompt */
  promptTokenCount?: number;
  /** Number of tokens in the response candidates */
  candidatesTokenCount?: number;
  /** Total number of tokens used */
  totalTokenCount?: number;
  /** Detailed token counts by modality */
  promptTokensDetails?: ModalityTokenCount[];
  /** Detailed candidate token counts by modality */
  candidatesTokensDetails?: ModalityTokenCount[];
}

/**
 * Token count for a specific modality
 */
interface ModalityTokenCount {
  /** Type of modality (text, image, etc.) */
  modality?: string;
  /** Number of tokens for this modality */
  tokenCount?: number;
}

/**
 * Retrieval metadata for grounding operations
 */
interface RetrievalMetadata {
  /** Total number of chunks retrieved */
  chunkCount?: number;
  /** Retrieval scores for chunks */
  scores?: number[];
}

/**
 * Search entry point for follow-up searches
 */
interface SearchEntryPoint {
  /** Rendered search URL for user */
  renderedContent?: string;
  /** SDK-generated search snippet */
  sdkBlob?: string;
}

/**
 * RAG chunk information for retrieval-augmented generation
 */
interface RagChunk {
  /** Source attribution for the chunk */
  sourceAttribution?: {
    /** Source ID or name */
    sourceId?: string;
    /** URI of the source */
    uri?: string;
  };
  /** Text content of the RAG chunk */
  text?: string;
}
```

## Tool Parameter Types

```typescript
/**
 * Parameters for the WebFetch tool
 */
interface WebFetchToolParams {
  /**
   * The prompt containing URL(s) and instructions for processing their content
   * Must contain at least one URL starting with http:// or https://
   * Can contain up to 20 URLs
   */
  prompt: string;
}

/**
 * Result structure returned by the WebFetch tool
 */
interface WebFetchToolResult {
  /** Content to be passed to the LLM */
  llmContent: string;
  /** Display content for the user interface */
  returnDisplay: string;
}
```

## Server Tool Invocation Types

```typescript
/**
 * Parameters for invoking the web_fetch server tool via urlContext
 */
interface WebFetchServerToolParams {
  /** Model to use for content generation */
  model: string;
  /** Content array with user prompt */
  contents: Array<{
    role: 'user';
    parts: Array<{
      text: string;
    }>;
  }>;
  /** Configuration including the urlContext tool */
  config: {
    tools: Array<{
      urlContext: Record<string, never>; // Empty object for urlContext tool
    }>;
  };
}
```

## Type Guards

```typescript
/**
 * Type guard to check if a part has text content
 */
function isTextPart(part: unknown): part is { text: string } {
  return (
    typeof part === 'object' &&
    part !== null &&
    'text' in part &&
    typeof (part as { text: unknown }).text === 'string'
  );
}

/**
 * Type guard to check if metadata has URL retrieval errors
 */
function hasUrlRetrievalError(metadata: UrlContextMetadata | undefined): boolean {
  if (!metadata?.urlMetadata || metadata.urlMetadata.length === 0) {
    return true;
  }
  
  return metadata.urlMetadata.every(
    (m) => m.urlRetrievalStatus !== 'URL_RETRIEVAL_STATUS_SUCCESS'
  );
}

/**
 * Type guard to check if grounding chunk is from web
 */
function isWebGroundingChunk(
  chunk: GroundingChunk
): chunk is GroundingChunk & { web: GroundingChunkWeb } {
  return chunk.web !== undefined;
}
```

## Usage Example

```typescript
// Example of processing a web fetch response
function processWebFetchResponse(response: WebFetchServerToolResponse): WebFetchToolResult {
  const candidate = response.candidates?.[0];
  if (!candidate) {
    return {
      llmContent: 'Error: No response candidate',
      returnDisplay: 'Error: No response candidate'
    };
  }

  // Extract text content
  const textParts = candidate.content?.parts?.filter(isTextPart) || [];
  const responseText = textParts.map(part => part.text).join('');

  // Check for URL retrieval errors
  if (hasUrlRetrievalError(candidate.urlContextMetadata)) {
    return {
      llmContent: 'Error: Failed to retrieve URL content',
      returnDisplay: 'Error: Failed to retrieve URL content'
    };
  }

  // Process grounding metadata for citations
  const groundingChunks = candidate.groundingMetadata?.groundingChunks || [];
  const webSources = groundingChunks
    .filter(isWebGroundingChunk)
    .map(chunk => ({
      title: chunk.web.title || 'Untitled',
      uri: chunk.web.uri || 'Unknown URI'
    }));

  // Format response with citations
  let formattedResponse = responseText;
  if (webSources.length > 0) {
    formattedResponse += '\n\nSources:\n';
    formattedResponse += webSources
      .map((source, i) => `[${i + 1}] ${source.title} (${source.uri})`)
      .join('\n');
  }

  return {
    llmContent: formattedResponse,
    returnDisplay: 'Content processed from URLs'
  };
}
```