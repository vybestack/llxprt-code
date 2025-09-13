# Pseudocode: UI Telemetry Enhancements

10: CLASS UITelemetryDisplay
11:   PROPERTY telemetryData: ProviderPerformanceMetrics[] = []
12:   
13: 20: METHOD updateDisplay(newMetrics: ProviderPerformanceMetrics)
25:   APPEND newMetrics to telemetryData array
26:   
27: 30:   TRIGGER UI refresh with latest telemetryData
28:   RENDER token usage metrics in UI components
39: 
40: 45: METHOD formatTokenRate(tokensPerSecond: number): string
50:   IF tokensPerSecond < 1000
51:     RETURN tokensPerSecond.toFixed(1) + " tokens/s"
52:   ELSE IF tokensPerSecond < 1000000
53:     RETURN (tokensPerSecond/1000).toFixed(1) + "K tokens/s"
54:   ELSE
55:     RETURN (tokensPerSecond/1000000).toFixed(1) + "M tokens/s"
56: 60: 
65: 70: METHOD formatWaitTime(waitTimeMs: number): string
75:   IF waitTimeMs < 1000
76:     RETURN waitTimeMs + "ms"
77:   ELSE IF waitTimeMs < 60000
78:     RETURN (waitTimeMs/1000).toFixed(1) + "s"
79:   ELSE
80:     RETURN (waitTimeMs/60000).toFixed(1) + "min"
81: 85: 
85: 90: METHOD renderMetrics(metrics: ProviderPerformanceMetrics)
95:   DISPLAY "Provider: " + metrics.provider
100:   DISPLAY "Model: " + metrics.model
105:   DISPLAY "Tokens In: " + metrics.tokensIn
110:   DISPLAY "Tokens Out: " + metrics.tokensOut
115:   DISPLAY "Rate: " + formatTokenRate(metrics.tokensPerSecond)
120:   DISPLAY "Burst Rate: " + formatTokenRate(metrics.burstTokensPerSecond)
125:   DISPLAY "Throttling Wait: " + formatWaitTime(metrics.throttleWaitTimeMs)
130:   DISPLAY "Session Total: " + metrics.sessionTokenUsage.total
135:   
140: 145: METHOD clearDisplay()
150:   CLEAR telemetryData array
155:   TRIGGER UI refresh to show empty state