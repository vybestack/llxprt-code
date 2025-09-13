# RetryService Pseudocode

10: FUNCTION retryWithBackoff<T>(fn: () => Promise<T>, options?: Partial<RetryOptions>): Promise<T>
11:   MERGE options with DEFAULT_RETRY_OPTIONS
12:   INITIALIZE attempt counter to 0
13:   INITIALIZE currentDelay to initialDelayMs
14:   INITIALIZE consecutive429Count to 0
15:   
16: 20: WHILE attempt < maxAttempts
17:   INCREMENT attempt counter
18:   TRY
19:     CALL fn()
20:     RETURN result
21:   CATCH error
22:     GET errorStatus using getErrorStatus
23:     
24:     // Check for Pro quota exceeded error first - immediate fallback for OAuth users
25:     IF errorStatus == 429 AND authType == AuthType.LOGIN_WITH_GOOGLE AND isProQuotaExceededError(error) AND onPersistent429 exists
26:       TRY
27:         CALL onPersistent429 with authType and error
28:         STORE fallbackModel result
29:         IF fallbackModel !== false AND fallbackModel !== null
30:           RESET attempt counter to 0
31:           RESET consecutive429Count to 0
32:           RESET currentDelay to initialDelayMs
33:           CONTINUE to next attempt (with new model)
34:         ELSE
35:           THROW error (stop retry process)
36:         END IF
37:       CATCH fallbackError
38:         LOG warning about failed fallback
39:         // Continue with original error
40:       END TRY
41:     END IF
42:     
43:     // Check for generic quota exceeded error (but not Pro, which was handled above) - immediate fallback for OAuth users
44:     IF errorStatus == 429 AND authType == AuthType.LOGIN_WITH_GOOGLE AND NOT isProQuotaExceededError(error) AND isGenericQuotaExceededError(error) AND onPersistent429 exists
45:       TRY
46:         CALL onPersistent429 with authType and error
47:         STORE fallbackModel result
48:         IF fallbackModel !== false AND fallbackModel !== null
49:           RESET attempt counter to 0
50:           RESET consecutive429Count to 0
51:           RESET currentDelay to initialDelayMs
52:           CONTINUE to next attempt (with new model)
53:         ELSE
54:           THROW error (stop retry process)
55:         END IF
56:       CATCH fallbackError
57:         LOG warning about failed fallback
58:         // Continue with original error
59:       END TRY
60:     END IF
61:     
62:     // Track consecutive 429 errors
63:     IF errorStatus == 429
64:       INCREMENT consecutive429Count
65:     ELSE
66:       RESET consecutive429Count to 0
67:     END IF
68: 
69:     // If we have persistent 429s and a fallback callback for OAuth
70:     IF consecutive429Count >= 2 AND onPersistent429 exists AND authType == AuthType.LOGIN_WITH_GOOGLE
71:       TRY
72:         CALL onPersistent429 with authType and error
73:         STORE fallbackModel result
74:         IF fallbackModel !== false AND fallbackModel !== null
75:           RESET attempt counter to 0
76:           RESET consecutive429Count to 0
77:           RESET currentDelay to initialDelayMs
78:           CONTINUE to next attempt (with new model)
79:         ELSE
80:           THROW error (stop retry process)
81:         END IF
82:       CATCH fallbackError
83:         LOG warning about failed fallback
84:         // Continue with original error
85:       END TRY
86:     END IF
87:     
88:     // Check if we've exhausted retries or shouldn't retry
89:     IF attempt >= maxAttempts OR shouldRetry(error) returns false
90:       THROW error
91:     END IF
92:     
93:     GET delayDurationMs and errorStatus using getDelayDurationAndStatus
94:     
95:     IF delayDurationMs > 0
96:       LOG warning about retry after explicit delay
97:       CALL delay function with delayDurationMs
98:       RESET currentDelay to initialDelayMs (for next potential non-429 error)
99:     ELSE
100:       // Fall back to exponential backoff with jitter
101:       CALL logRetryAttempt with attempt, error and errorStatus
102:       CALCULATE jitter as +/- 30% of currentDelay
103:       CALL delay function with (currentDelay + jitter)
104:       UPDATE currentDelay to min of (maxDelayMs, currentDelay * 2)
105:     END IF
106:   END TRY
107: END WHILE
108:   
109: 110: FUNCTION getErrorStatus(error: unknown): number | undefined
110:   IF error is object AND not null
111:     IF error has status property AND it's a number
112:       RETURN error.status
113:     END IF
114:     // Check for error.response.status (common in axios errors)
115:     IF error has response property AND response is object AND not null
116:       GET response object
117:       IF response has status property AND it's a number
118:         RETURN response.status
119:       END IF
120:     END IF
121:   END IF
122:   RETURN undefined
123:   
124: 120: FUNCTION getRetryAfterDelayMs(error: unknown): number
125:   IF error is object AND not null
126:     // Check for error.response.headers (common in axios errors)
127:     IF error has response property AND response is object AND not null
128:       GET response object
129:       IF response has headers property AND headers is object AND not null
130:         GET headers object
131:         GET retry-after header
132:         IF retry-after is string
133:           TRY to parse as integer seconds
134:           IF valid number
135:             RETURN number * 1000 (convert to milliseconds)
136:           END IF
137:           // It might be an HTTP date
138:           TRY to parse as Date object
139:           IF valid date
140:             RETURN max of (0, retryAfterDate.getTime() - Date.now())
141:           END IF
142:         END IF
143:       END IF
144:     END IF
145:   END IF
146:   RETURN 0
147:   
148: 130: FUNCTION getDelayDurationAndStatus(error: unknown): {
149:   delayDurationMs: number,
150:   errorStatus: number | undefined
151: }
152:   GET errorStatus using getErrorStatus
153:   INITIALIZE delayDurationMs to 0
154:   IF errorStatus == 429
155:     GET delay from getRetryAfterDelayMs
156:     SET delayDurationMs
157:   END IF
158:   RETURN { delayDurationMs, errorStatus }
159:   
160: 140: FUNCTION logRetryAttempt(attempt: number, error: unknown, errorStatus?: number)
161:   INITIALIZE message based on errorStatus:
162:     IF errorStatus exists: "Attempt {attempt} failed with status {errorStatus}. Retrying with backoff..."
163:     ELSE: "Attempt {attempt} failed. Retrying with backoff..."
164:     
165:   IF errorStatus == 429
166:     LOG warning with message and error
167:   ELSE IF errorStatus >= 500 AND errorStatus < 600
168:     LOG error with message and error
169:   ELSE IF error is instanceof Error AND error.message exists
170:     IF error.message includes "429"
171:       LOG warning with specific message about 429 and error
172:     ELSE IF error.message matches 5xx pattern
173:       LOG error with specific message about 5xx and error
174:     ELSE
175:       LOG warning with message and error
176:     END IF
177:   ELSE
178:     LOG warning with message and error
179:   END IF
180:   
181: 150: FUNCTION recordRetryWait(provider: string, duration: number)
182:   GET ProviderManager singleton instance
183:   GET ProviderPerformanceTracker for provider
184:   CALL tracker.recordThrottleWait with duration