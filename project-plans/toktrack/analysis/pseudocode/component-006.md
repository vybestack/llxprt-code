# Pseudocode: UI metrics displays

10: COMPONENT Footer
11:   PROPERTY model: string
12:   PROPERTY historyTokenCount: number
13:   PROPERTY detailed: boolean - Display mode (detailed vs compact)
14:   
15:   // NEW - Properties for token tracking display
16:   PROPERTY tokensPerMinute: number
17:   PROPERTY throttleWaitTimeMs: number
18:   PROPERTY sessionTokenTotal: number
19:   
20:   METHOD render()
21:     RENDER branch information
22:     RENDER memory usage information
23:     
24:     // NEW - Render token metrics
25:     RENDER tokensPerMinute with appropriate formatting
26:     RENDER throttleWaitTimeMs with appropriate formatting
27:     RENDER sessionTokenTotal with appropriate formatting
28:     
29:     RENDER timestamp IF detailed mode
30:   END METHOD
31: END COMPONENT
32: 
33: COMPONENT StatsDisplay
34:   PROPERTY metrics: SessionMetrics
35:   
36:   METHOD render()
37:     RENDER title
38:     RENDER interaction summary section
39:     RENDER performance section with existing metrics
40:     
41:     // NEW - Add token tracking section
42:     RENDER token tracking section with:
43:       TOKENS PER MINUTE AVERAGE
44:       THROTTLE WAIT TIME
45:       SESSION TOKEN USAGE BREAKDOWN with input, output, cache, tool, thought counts
46:     
47:     RENDER model usage table
48:   END METHOD
49: END COMPONENT
50: 
51: FUNCTION formatTokensPerMinute(tpm: number): string
52:   IF tpm < 1000
53:     RETURN "TPM: {tpm}"
54:   ELSE
55:     RETURN "TPM: {(tpm/1000).toFixed(1)}k"
56:   END IF
57: END FUNCTION
58: 
59: FUNCTION formatThrottleWaitTime(waitTimeMs: number): string
60:   IF waitTimeMs < 1000
61:     RETURN "Wait: {waitTimeMs}ms"
62:   ELSE IF waitTimeMs < 60000
63:     RETURN "Wait: {(waitTimeMs/1000).toFixed(1)}s"
64:   ELSE
65:     RETURN "Wait: {(waitTimeMs/60000).toFixed(1)}m"
66:   END IF
67: END FUNCTION
68: 
69: FUNCTION formatSessionTokenUsage(usage: object): string
70:   RETURN formatted string showing cumulative session token usage
71: END FUNCTION