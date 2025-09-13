# Pseudocode: LoggingProviderWrapper metrics collection

10: CLASS LoggingProviderWrapper
11:   PROPERTY wrapped: IProvider - The wrapped provider instance
12:   PROPERTY config: Config - Configuration instance
13: 
14:   METHOD async *generateChatCompletion(content: IContent[], tools: Array)
15:     GENERATE promptId
16:     INCREMENT turnNumber
17:     
18:     IF conversation logging enabled
19:       CALL logRequest with content, tools, promptId
20:     END IF
21:     
22:     GET stream from wrapped provider
23:     
24:     IF conversation logging NOT enabled
25:       YIELD all chunks from stream
26:       RETURN
27:     END IF
28:     
29:     YIELD from logResponseStream with stream and promptId
30:   END METHOD
31: 
32:   METHOD async logRequest(content: IContent[], tools: Array, promptId: string)
33:     TRY to log conversation request
34:     CATCH error and log warning
35:   END METHOD
36: 
37:   METHOD async *logResponseStream(stream: AsyncIterableIterator, promptId: string)
38:     RECORD startTime using performance.now()
39:     INITIALIZE responseContent as empty string
40:     INITIALIZE responseComplete as false
41:     
42:     TRY to iterate through stream
43:       FOR each chunk in stream
44:         EXTRACT content from chunk
45:         IF content exists
46:           APPEND content to responseContent
47:         END IF
48:         YIELD chunk
49:       END FOR
50:       SET responseComplete to true
51:     CATCH error
52:       CALL logResponse with error details
53:       THROW error
54:     END TRY
55:     
56:     IF responseComplete
57:       CALCULATE totalTime as performance.now() - startTime
58:       CALL logResponse with responseContent, promptId, totalTime, true
59:     END IF
60:   END METHOD
61: 
62:   METHOD async logResponse(content: string, promptId: string, duration: number, success: boolean, error: unknown)
63:     TRY to log conversation response
64:     CATCH logError and log warning
65:   END METHOD
66: 
67:   METHOD extractTokenCountsFromResponse(response: unknown): TokenCounts
68:     INITIALIZE token counts as zeros
69:     TRY to extract token usage from response object or headers
70:       EXTRACT input_token_count, output_token_count, cached_content_token_count,
71:             thoughts_token_count, tool_token_count from response
72:       RETURN object with these counts
73:     CATCH error
74:       RETURN zero counts
75:     END TRY
76:   END METHOD
77: 
78:   METHOD accumulateTokenUsage(tokenCounts: TokenCounts)
79:     GET provider manager instance
80:     CALL accumulateSessionTokens on provider manager with tokenCounts
81:   END METHOD
82: END CLASS