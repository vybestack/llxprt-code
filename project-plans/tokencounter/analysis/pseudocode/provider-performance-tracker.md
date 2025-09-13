# Pseudocode: ProviderPerformanceTracker Enhancements

10: CLASS ProviderPerformanceTracker
11:   PROPERTY metrics: ProviderPerformanceMetrics[] = []
12:   PROPERTY burstTracker: BurstTracker = new BurstTracker()
13: 
14: 20: METHOD logApiResponse(provider: string, model: string, tokensIn: number, tokensOut: number, durationMs: number)
25:   VALIDATE inputs are non-negative integers
26:   IF validation fails
27:     THROW ValidationError with details
28: 
29: 30:   COMPUTE tokensPerSecond = (tokensIn + tokensOut) / (durationMs / 1000)
31:   HANDLE division by zero case when durationMs = 0
32:   IF durationMs = 0 THEN tokensPerSecond = 0
33: 
34: 35:   UPDATE burstTracker with (tokensIn + tokensOut, timestamp)
35:   COMPUTE burstTokensPerSecond from burstTracker
36: 
37: 40:   CREATE metricEntry: ProviderPerformanceMetrics = {
41:     provider,
42:     model,
43:     timestamp: Date.now(),
44:     durationMs,
45:     tokensIn,
46:     tokensOut,
47:     tokensPerSecond,
48:     burstTokensPerSecond,
49:     throttleWaitTimeMs: 0, // Initially zero, updated externally
50:     sessionTokenUsage: {
51:       input: 0, // Updated externally
52:       output: 0, // Updated externally
53:       total: 0 // Updated externally
54:     }
55:   }
56: 
57: 50:   APPEND metricEntry to metrics array
58:   RETURN metricEntry
59: 
60: 65: METHOD getLatestMetrics(): ProviderPerformanceMetrics | null
70:   IF metrics array is empty
71:     RETURN null
72:   RETURN last element in metrics array
73: 
74: 75: METHOD updateThrottleWaitTime(throttleWaitTimeMs: number)
80:   VALIDATE throttleWaitTimeMs is non-negative integer
81:   IF validation fails
82:     THROW ValidationError with details
83: 
85: 90:   GET latestMetrics = getLatestMetrics()
95:   IF latestMetrics is null
96:     THROW Error("No metrics to update with throttle wait time")
97: 
98: 100:  UPDATE latestMetrics.throttleWaitTimeMs += throttleWaitTimeMs
101:   RETURN latestMetrics
102: 
103: 110: CLASS BurstTracker
115:   PROPERTY windowSizeMs: number = 1000 // 1 second window
116:   PROPERTY tokenCounts: Array<{count: number, timestamp: number}> = []
117: 
118: 120: METHOD addTokens(tokenCount: number, timestamp: number)
125:   APPEND {count: tokenCount, timestamp} to tokenCounts
126: 
127: 130:  CLEANUP old entries outside window
135:   FILTER tokenCounts to keep only entries within windowSizeMs of timestamp
136: 
140: 145: METHOD computeBurstRate(): number
150:   IF tokenCounts is empty
151:     RETURN 0
152: 
153: 155:  COMPUTE sum of token counts in tokenCounts
156:   RETURN sum as tokens per second (tokenCounts within 1 second window)