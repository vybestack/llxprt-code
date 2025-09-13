# Pseudocode: Retry system throttling integration

10: FUNCTION retryWithBackoff
11:   PROPERTY maxAttempts: number
12:   PROPERTY initialDelayMs: number
13:   PROPERTY maxDelayMs: number
14:   PROPERTY consecutive429Count: number = 0
15:   PROPERTY shouldRetry: function - predicate for determining if retry should occur
16: 
17:   WHILE attempt < maxAttempts
18:     INCREMENT attempt
19:     TRY to execute fn()
20:       RETURN result
21:     CATCH error
22:       GET error status using getErrorStatus(error)
23:       
24:       IF errorStatus is 429
25:         INCREMENT consecutive429Count
26:       ELSE
27:         RESET consecutive429Count to 0
28:       END IF
29: 
30:       IF errorStatus is 429
31:         GET delayDurationMs using getDelayDurationAndStatus(error)
32:         
33:         IF delayDurationMs > 0
34:           LOG explicit delay with delayDurationMs
35:           AWAIT delay(delayDurationMs)
36:           // NEW - Track throttling wait time
37:           CALL trackThrottleWaitTime with delayDurationMs
38:           RESET currentDelay to initialDelayMs
39:         ELSE
40:           LOG retry attempt
41:           CALCULATE delayWithJitter using jitter formula
42:           AWAIT delay(delayWithJitter)
43:           UPDATE currentDelay using exponential backoff formula
44:         END IF
45:       END IF
46: 
47:       // Check if we've exhausted retries or shouldn't retry
48:       IF attempt >= maxAttempts OR NOT shouldRetry(error)
49:         THROW error
50:       END IF
51:     END TRY
52:   END WHILE
53: 
54:   THROW error with message "Retry attempts exhausted"
55: END FUNCTION
56: 
57: FUNCTION trackThrottleWaitTime(waitTimeMs: number)
58:   GET active provider from provider manager
59:   CALL addThrottleWaitTime(waitTimeMs) on provider's performance tracker
60: END FUNCTION