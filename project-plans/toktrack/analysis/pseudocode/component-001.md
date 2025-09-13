# Pseudocode: ProviderPerformanceMetrics interface enhancement

10: INTERFACE ProviderPerformanceMetrics
11:   PROPERTY providerName: string
12:   PROPERTY totalRequests: number
13:   PROPERTY totalTokens: number
14:   PROPERTY averageLatency: number
15:   PROPERTY timeToFirstToken: number | null
16:   PROPERTY tokensPerSecond: number - DEPRECATED, will be replaced with tokensPerMinute
17:   PROPERTY tokensPerMinute: number - NEW FIELD for tracking tokens per minute rate
18:   PROPERTY chunksReceived: number
19:   PROPERTY errorRate: number
20:   PROPERTY errors: Array<{ timestamp: number; duration: number; error: string }>
21:   PROPERTY throttleWaitTimeMs: number - NEW FIELD for cumulative 429 wait time
22:   PROPERTY sessionTokenUsage: object - NEW FIELD for cumulative session token usage
23:     PROPERTY input: number
24:     PROPERTY output: number
25:     PROPERTY cache: number
26:     PROPERTY tool: number
27:     PROPERTY thought: number
28:     PROPERTY total: number
29: END INTERFACE