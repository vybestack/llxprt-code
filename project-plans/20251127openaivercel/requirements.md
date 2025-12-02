# Requirements: OpenAI Vercel Provider

Plan ID: PLAN-20251127-OPENAIVERCEL

## Requirements Index

| REQ-ID | Title | Priority | Phases |
|--------|-------|----------|--------|
| REQ-OAV-001 | Provider Registration | High | P02, P03, P17-P20 |
| REQ-OAV-002 | Standard Authentication | High | P07, P08 |
| REQ-OAV-003 | BaseURL Configuration | Medium | P07, P08 |
| REQ-OAV-004 | Tool ID Normalization | High | P04, P06 |
| REQ-OAV-005 | Message Format Conversion | High | P05, P06 |
| REQ-OAV-006 | Chat Completion Generation | High | P09, P10 |
| REQ-OAV-007 | Streaming Support | High | P11, P12 |
| REQ-OAV-008 | Error Handling | High | P13, P14 |
| REQ-OAV-009 | Model Listing | Medium | P15, P16 |
| REQ-INT-001 | Integration Requirements | Critical | P17-P20 |

---

## REQ-OAV-001: Provider Registration

**Priority**: High

### REQ-OAV-001.1: Provider Selection via CLI
**Full Text**: Provider MUST be selectable via `/provider openaivercel` command
**Behavior**:
- GIVEN: The CLI application is running
- WHEN: User executes `/provider openaivercel`
- THEN: The OpenAIVercelProvider becomes the active provider
**Why This Matters**: Users need explicit control over which provider implementation to use

### REQ-OAV-001.2: IProvider Interface Implementation
**Full Text**: Provider MUST implement the IProvider interface completely
**Behavior**:
- GIVEN: OpenAIVercelProvider class exists
- WHEN: Type checking is performed
- THEN: All IProvider methods are implemented
**Why This Matters**: Ensures compatibility with existing provider infrastructure

### REQ-OAV-001.3: ProviderManager Registration
**Full Text**: Provider MUST be registered in ProviderManager for discovery
**Behavior**:
- GIVEN: Application initializes
- WHEN: ProviderManager loads available providers
- THEN: 'openaivercel' appears in the provider list
**Why This Matters**: Provider won't be accessible without registration

---

## REQ-OAV-002: Standard Authentication

**Priority**: High

### REQ-OAV-002.1: API Key via /key Command
**Full Text**: MUST support `/key` command for API key input
**Behavior**:
- GIVEN: OpenAIVercelProvider is active
- WHEN: User executes `/key sk-test123`
- THEN: API key is stored and used for subsequent requests
**Why This Matters**: Primary authentication mechanism for OpenAI API

### REQ-OAV-002.2: API Key via /keyfile Command
**Full Text**: MUST support `/keyfile` command for file-based key
**Behavior**:
- GIVEN: OpenAIVercelProvider is active
- WHEN: User executes `/keyfile ~/.openai/key`
- THEN: Key is read from file, trimmed, and stored
**Why This Matters**: Enables secure key management via files

### REQ-OAV-002.3: Key Validation Before API Calls
**Full Text**: MUST validate key presence before making API calls
**Behavior**:
- GIVEN: No API key has been set
- WHEN: generateChatCompletion is called
- THEN: Clear error thrown: "API key is required"
**Why This Matters**: Prevents confusing API errors from missing credentials

---

## REQ-OAV-003: BaseURL Configuration

**Priority**: Medium

### REQ-OAV-003.1: Custom Endpoint Support
**Full Text**: MUST support `/baseurl` command for custom endpoints
**Behavior**:
- GIVEN: OpenAIVercelProvider is active
- WHEN: User executes `/baseurl https://custom.api.com/v1`
- THEN: All API requests use the custom endpoint
**Why This Matters**: Enables use with Azure OpenAI, local models, proxies

### REQ-OAV-003.2: URL Normalization
**Full Text**: MUST normalize URLs by removing trailing slashes
**Behavior**:
- GIVEN: User provides URL with trailing slash
- WHEN: setBaseUrl is called with "https://api.com/v1/"
- THEN: Stored URL is "https://api.com/v1"
**Why This Matters**: Prevents double-slash issues in URL construction

### REQ-OAV-003.3: Custom URL in Client Creation
**Full Text**: MUST use custom URL when creating Vercel SDK client
**Behavior**:
- GIVEN: Custom baseURL is configured
- WHEN: createOpenAIClient is called
- THEN: Client is configured with the custom baseURL
**Why This Matters**: Custom endpoint must actually be used in requests

---

## REQ-OAV-004: Tool ID Normalization

**Priority**: High

### REQ-OAV-004.1: History to OpenAI Conversion
**Full Text**: MUST convert hist_tool_ IDs to call_ format for API
**Behavior**:
- GIVEN: Tool ID "hist_tool_abc123" from history
- WHEN: normalizeToOpenAIToolId is called
- THEN: Returns "call_abc123"
**Why This Matters**: OpenAI API expects call_ prefixed IDs

### REQ-OAV-004.2: OpenAI to History Conversion
**Full Text**: MUST convert call_ IDs to hist_tool_ format from API
**Behavior**:
- GIVEN: Tool ID "call_abc123" from API response
- WHEN: normalizeToHistoryToolId is called
- THEN: Returns "hist_tool_abc123"
**Why This Matters**: History system uses hist_tool_ prefixed IDs

### REQ-OAV-004.3: Anthropic Format Handling
**Full Text**: MUST handle toolu_ (Anthropic) format
**Behavior**:
- GIVEN: Tool ID "toolu_xyz789" (from mixed history)
- WHEN: normalizeToOpenAIToolId is called
- THEN: Returns "call_xyz789"
**Why This Matters**: History may contain IDs from other providers

### REQ-OAV-004.4: Round-trip Integrity
**Full Text**: MUST preserve ID content through round-trip conversion
**Behavior**:
- GIVEN: Original ID "hist_tool_test123"
- WHEN: Converted to OpenAI then back to history format
- THEN: Result equals original "hist_tool_test123"
**Why This Matters**: Tool responses must match original tool calls

---

## REQ-OAV-005: Message Format Conversion

**Priority**: High

### REQ-OAV-005.1: IContent to CoreMessage Conversion
**Full Text**: MUST convert IContent array to CoreMessage array
**Behavior**:
- GIVEN: Array of IContent from history
- WHEN: convertToVercelMessages is called
- THEN: Returns CoreMessage[] compatible with Vercel SDK
**Why This Matters**: Vercel SDK expects different message format

### REQ-OAV-005.2: User Text Messages
**Full Text**: MUST handle user text-only messages
**Behavior**:
- GIVEN: IContent with speaker:'human', blocks:[{type:'text'}]
- WHEN: Converted
- THEN: CoreMessage with role:'user', content:string
**Why This Matters**: Basic user input handling

### REQ-OAV-005.3: User Image Messages
**Full Text**: MUST handle user messages with images
**Behavior**:
- GIVEN: IContent with text and image blocks
- WHEN: Converted
- THEN: CoreMessage with content array including image parts
**Why This Matters**: Vision model support

### REQ-OAV-005.4: Assistant Text Messages
**Full Text**: MUST handle assistant text messages
**Behavior**:
- GIVEN: IContent with speaker:'ai', text blocks
- WHEN: Converted
- THEN: CoreMessage with role:'assistant', content:string
**Why This Matters**: Conversation history replay

### REQ-OAV-005.5: Assistant Tool Call Messages
**Full Text**: MUST handle assistant tool call messages
**Behavior**:
- GIVEN: IContent with tool_call blocks
- WHEN: Converted
- THEN: CoreMessage with tool-call parts, normalized IDs
**Why This Matters**: Tool execution replay

### REQ-OAV-005.6: Tool Result Messages
**Full Text**: MUST handle tool result messages
**Behavior**:
- GIVEN: IContent with speaker:'tool', tool_response blocks
- WHEN: Converted
- THEN: CoreMessage with role:'tool', tool-result parts
**Why This Matters**: Tool response context for model

### REQ-OAV-005.7: System Messages
**Full Text**: MUST handle system messages
**Behavior**:
- GIVEN: IContent with speaker:'system' (if applicable)
- WHEN: Converted
- THEN: CoreMessage with role:'system'
**Why This Matters**: System prompt handling

---

## REQ-OAV-006: Chat Completion Generation

**Priority**: High

### REQ-OAV-006.1: Non-Streaming Generation
**Full Text**: MUST use Vercel AI SDK generateText for non-streaming
**Behavior**:
- GIVEN: options.streaming === false
- WHEN: generateChatCompletion is called
- THEN: Uses generateText from Vercel SDK
**Why This Matters**: Some use cases need complete response before processing

### REQ-OAV-006.2: IContent Block Yielding
**Full Text**: MUST yield IContent blocks from response
**Behavior**:
- GIVEN: API returns text response
- WHEN: Iterating generateChatCompletion result
- THEN: Yields IContent with type:'text'
**Why This Matters**: Unified response format for consumers

### REQ-OAV-006.3: Usage Metadata
**Full Text**: MUST include usage metadata (tokens)
**Behavior**:
- GIVEN: API returns usage information
- WHEN: Generation completes
- THEN: Yields IContent with type:'usage', inputTokens, outputTokens
**Why This Matters**: Cost tracking and analytics

### REQ-OAV-006.4: Parameter Passing
**Full Text**: MUST pass temperature/maxTokens parameters
**Behavior**:
- GIVEN: options.temperature=0.7, options.maxTokens=1000
- WHEN: API call is made
- THEN: Parameters are included in request
**Why This Matters**: User control over generation behavior

### REQ-OAV-006.5: Tool Call Handling
**Full Text**: MUST handle tool calls in response
**Behavior**:
- GIVEN: API returns tool_calls
- WHEN: Iterating generateChatCompletion result
- THEN: Yields IContent with tool_call blocks, normalized IDs
**Why This Matters**: Enables tool execution flow

---

## REQ-OAV-007: Streaming Support

**Priority**: High

### REQ-OAV-007.1: Streaming Generation
**Full Text**: MUST use Vercel AI SDK streamText for streaming
**Behavior**:
- GIVEN: options.streaming !== false (default)
- WHEN: generateChatCompletion is called
- THEN: Uses streamText from Vercel SDK
**Why This Matters**: Low-latency user experience

### REQ-OAV-007.2: Text Chunk Streaming
**Full Text**: MUST yield text chunks as they arrive
**Behavior**:
- GIVEN: Stream produces text chunks
- WHEN: Iterating generateChatCompletion result
- THEN: Yields IContent blocks for each chunk
**Why This Matters**: Progressive UI updates

### REQ-OAV-007.3: Tool Calls After Stream
**Full Text**: MUST yield tool calls after stream completes
**Behavior**:
- GIVEN: Stream completes with tool calls
- WHEN: Text stream exhausted
- THEN: Yields tool_call IContent blocks
**Why This Matters**: Tool calls available after streaming text

### REQ-OAV-007.4: Usage at End
**Full Text**: MUST yield usage metadata at end
**Behavior**:
- GIVEN: Stream completes
- WHEN: All content yielded
- THEN: Final IContent has usage metadata
**Why This Matters**: Usage tracking for streaming responses

### REQ-OAV-007.5: Default Streaming
**Full Text**: Streaming SHOULD be the default mode
**Behavior**:
- GIVEN: options.streaming not specified
- WHEN: generateChatCompletion is called
- THEN: Uses streaming mode
**Why This Matters**: Better default UX

---

## REQ-OAV-008: Error Handling

**Priority**: High

### REQ-OAV-008.1: ProviderError Wrapping
**Full Text**: MUST wrap API errors in ProviderError
**Behavior**:
- GIVEN: Any API error occurs
- WHEN: Error is caught
- THEN: Wrapped in ProviderError with original message
**Why This Matters**: Consistent error handling

### REQ-OAV-008.2: Rate Limit Error Detection
**Full Text**: MUST identify rate limit errors (429) as RateLimitError
**Behavior**:
- GIVEN: API returns 429 status
- WHEN: Error is processed
- THEN: Throws RateLimitError instance
**Why This Matters**: Enables retry logic

### REQ-OAV-008.3: Auth Error Detection
**Full Text**: MUST identify auth errors (401) as AuthenticationError
**Behavior**:
- GIVEN: API returns 401 status
- WHEN: Error is processed
- THEN: Throws AuthenticationError with helpful message
**Why This Matters**: Clear guidance for users

### REQ-OAV-008.4: Retry Information
**Full Text**: MUST preserve retry-after information
**Behavior**:
- GIVEN: 429 with retry-after header
- WHEN: RateLimitError created
- THEN: retryAfter property contains value
**Why This Matters**: Intelligent retry timing

### REQ-OAV-008.5: Provider Identification
**Full Text**: MUST include provider name in errors
**Behavior**:
- GIVEN: Any ProviderError
- WHEN: Error is created
- THEN: provider property equals 'openaivercel'
**Why This Matters**: Debugging multi-provider setups

---

## REQ-OAV-009: Model Listing

**Priority**: Medium

### REQ-OAV-009.1: Static Model List
**Full Text**: MUST return static list of common OpenAI models
**Behavior**:
- GIVEN: listModels is called
- WHEN: No API key required
- THEN: Returns array of ModelInfo objects
**Why This Matters**: Model discovery without API call

### REQ-OAV-009.2: Model Coverage
**Full Text**: MUST include GPT-4, GPT-3.5, and O1 models
**Behavior**:
- GIVEN: Model list returned
- WHEN: Checking model IDs
- THEN: Includes gpt-4o, gpt-4-turbo, gpt-3.5-turbo, o1-preview, o1-mini
**Why This Matters**: Covers common use cases

### REQ-OAV-009.3: Context Window Sizes
**Full Text**: MUST include correct context window sizes
**Behavior**:
- GIVEN: Model info for gpt-4o
- WHEN: Checking contextWindow property
- THEN: Returns 128000
**Why This Matters**: Context management

### REQ-OAV-009.4: Provider Field
**Full Text**: MUST set provider field to 'openaivercel'
**Behavior**:
- GIVEN: Any model in list
- WHEN: Checking provider property
- THEN: Equals 'openaivercel'
**Why This Matters**: Model provenance tracking

---

## REQ-INT-001: Integration Requirements

**Priority**: Critical

### REQ-INT-001.1: ProviderManager Registration
**Full Text**: Provider MUST be registered in ProviderManager
**Behavior**:
- GIVEN: Application starts
- WHEN: ProviderManager.getProvider('openaivercel') called
- THEN: Returns OpenAIVercelProvider instance
**Why This Matters**: Provider unusable without registration

### REQ-INT-001.2: CLI Command Compatibility
**Full Text**: Provider MUST work with existing CLI commands
**Behavior**:
- GIVEN: OpenAIVercelProvider active
- WHEN: /key, /keyfile, /baseurl, /model, /models executed
- THEN: Commands work as documented
**Why This Matters**: Consistent user experience

### REQ-INT-001.3: HistoryService Interoperability
**Full Text**: Provider MUST interoperate with HistoryService
**Behavior**:
- GIVEN: History contains IContent from previous turns
- WHEN: generateChatCompletion called with history
- THEN: Messages converted correctly, tool IDs match
**Why This Matters**: Conversation continuity

### REQ-INT-001.4: ToolScheduler Compatibility
**Full Text**: Provider MUST work with ToolScheduler
**Behavior**:
- GIVEN: Provider yields tool_call block
- WHEN: ToolScheduler executes tool
- THEN: Tool result callId matches original tool_call id
**Why This Matters**: Tool execution flow
