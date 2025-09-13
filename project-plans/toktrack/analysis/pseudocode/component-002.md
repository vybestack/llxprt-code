# Pseudocode: ProviderPerformanceTracker enhancement

10: CLASS ProviderPerformanceTracker
11:   PROPERTY metrics: ProviderPerformanceMetrics - Performance metrics storage
12:   PROPERTY tokenTimestamps: Array<{timestamp: number, tokenCount: number}> - NEW for tracking token rates
13: 
14:   CONSTRUCTOR(providerName: string)
15:     INITIALIZE this.metrics with all fields including new ones
16:     INITIALIZE this.tokenTimestamps as empty array
17:   END CONSTRUCTOR
18: 
19:   METHOD initializeMetrics(): ProviderPerformanceMetrics
20:     RETURN object with all required metrics fields initialized to zero/null
21:   END METHOD
22: 
23:   METHOD recordChunk(chunkNumber: number, contentLength: number)
24:     UPDATE this.metrics.chunksReceived with chunkNumber
25:   END METHOD
26: 
27:   METHOD recordCompletion(totalTime: number, timeToFirstToken: number|null, tokenCount: number, chunkCount: number)
28:     INCREMENT this.metrics.totalRequests by 1
29:     INCREMENT this.metrics.totalTokens by tokenCount
30:     CALCULATE new average latency using existing requests and totalTime
31:     UPDATE this.metrics.averageLatency with new average
32:     
33:     IF timeToFirstToken is not null
34:       UPDATE this.metrics.timeToFirstToken with timeToFirstToken
35:     END IF
36:     
37:     UPDATE this.metrics.chunksReceived with chunkCount
38:     
39:     // NEW - Track token timestamps for calculating TPM
40:     ADD {timestamp: Date.now(), tokenCount} to this.tokenTimestamps array
41:     CALL calculateTokensPerMinute to update this.metrics.tokensPerMinute
42:   END METHOD
43: 
44:   METHOD calculateTokensPerMinute(): number
45:     GET current timestamp
46:     FILTER this.tokenTimestamps to keep only entries within last 60 seconds
47:     UPDATE this.tokenTimestamps with filtered array
48:     SUM tokenCount from all entries in this.tokenTimestamps
49:     RETURN sum as tokens per minute
50:   END METHOD
51: 
52:   METHOD recordError(duration: number, error: string)
53:     ADD error object {timestamp: Date.now(), duration, error} to this.metrics.errors
54:     CALCULATE new error rate using total requests and error count
55:     UPDATE this.metrics.errorRate with new rate
56:   END METHOD
57: 
58:   METHOD getLatestMetrics(): ProviderPerformanceMetrics
59:     RETURN copy of this.metrics
60:   END METHOD
61: 
62:   METHOD reset()
63:     REINITIALIZE this.metrics with initializeMetrics()
64:     CLEAR this.tokenTimestamps array
65:   END METHOD
66: 
67:   METHOD estimateTokenCount(text: string): number
68:     RETURN rough estimation of tokens in text
69:   END METHOD
70: 
71:   METHOD getPerformanceSummary(): string
72:     FORMAT and return human-readable performance summary including TPM
73:   END METHOD
74: 
75:   METHOD addThrottleWaitTime(waitTimeMs: number)
76:     INCREMENT this.metrics.throttleWaitTimeMs by waitTimeMs
77:   END METHOD
78: END CLASS