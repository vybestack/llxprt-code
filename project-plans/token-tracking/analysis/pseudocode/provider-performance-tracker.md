# ProviderPerformanceTracker Pseudocode

10: CLASS ProviderPerformanceTracker
11:   PROPERTY metrics: ProviderPerformanceMetrics
12:   PROPERTY providerName: string
13: 
14: 20: CONSTRUCTOR(providerName: string)
15:   SET this.providerName = providerName
16:   INITIALIZE this.metrics with default values
17: 
18: 30: METHOD initializeMetrics(): ProviderPerformanceMetrics
19:   RETURN object with:
20:     providerName: this.providerName
21:     totalRequests: 0
22:     totalTokens: 0
23:     averageLatency: 0
24:     timeToFirstToken: null
25:     tokensPerSecond: 0
26:     burstTokensPerSecond: 0
27:     throttleWaitTimeMs: 0
28:     sessionTokenUsage: {
29:       input: 0
30:       output: 0
31:       cache: 0
32:       tool: 0
33:       thought: 0
34:       total: 0
35:     }
36:     chunksReceived: 0
37:     errorRate: 0
38:     errors: empty array
39: 
40: 50: METHOD recordChunk(chunkNumber: number, contentLength: number)
41:   SET this.metrics.chunksReceived = chunkNumber
42: 
43: 60: METHOD recordCompletion(
44:     totalTime: number,
45:     timeToFirstToken: number | null,
46:     tokenCount: number,
47:     chunkCount: number
48:   )
49:   INCREMENT this.metrics.totalRequests
50:   ADD tokenCount to this.metrics.totalTokens
51:   UPDATE this.metrics.averageLatency using rolling average formula
52:   IF timeToFirstToken is not null
53:     SET this.metrics.timeToFirstToken = timeToFirstToken
54:   END IF
55:   IF totalTime > 0
56:     SET this.metrics.tokensPerSecond = tokenCount / (totalTime / 1000)
57:   END IF
58:   SET this.metrics.chunksReceived = chunkCount
59: 
60: 70: METHOD recordError(duration: number, error: string)
61:   ADD error object to this.metrics.errors with timestamp, duration and truncated error
62:   INCREMENT this.metrics.errorRate using rolling average formula
63: 
64: 80: METHOD getLatestMetrics(): ProviderPerformanceMetrics
65:   RETURN deep clone of this.metrics
66: 
67: 90: METHOD reset()
68:   SET this.metrics = initializeMetrics()
69: 
70: 100: METHOD estimateTokenCount(text: string): number
71:   RETURN rough token estimation (Math.ceil(text.length / 4))
72: 
73: 110: METHOD getPerformanceSummary(): string
74:   RETURN human-readable summary of metrics including:
75:     providerName
76:     totalRequests
77:     averageLatency
78:     tokensPerSecond
79:     errorRate
80: 
81: 120: METHOD recordSessionTokenUsage(
82:     category: 'input' | 'output' | 'cache' | 'tool' | 'thought',
83:     count: number
84:   )
85:   ADD count to this.metrics.sessionTokenUsage[category]
86:   UPDATE this.metrics.sessionTokenUsage.total with sum of all categories
87: 
88: 130: METHOD recordBurstRate(tokens: number, durationMs: number)
89:   IF durationMs > 0
90:     CALCULATE currentRate = tokens / (durationMs / 1000)
91:     IF currentRate > this.metrics.burstTokensPerSecond
92:       SET this.metrics.burstTokensPerSecond = currentRate
93:     END IF
94:   END IF
95: 
96: 140: METHOD recordThrottleWait(durationMs: number)
97:   ADD durationMs to this.metrics.throttleWaitTimeMs