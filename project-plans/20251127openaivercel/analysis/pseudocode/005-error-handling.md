# Pseudocode: Error Handling

## Purpose

Wrap API errors in provider-specific error types with meaningful messages.

## Referenced By

- P13: Error Handling Tests
- P14: Error Handling Implementation
- P10, P12: Generation implementations (error wrapping)

---

## Interface Contracts (TypeScript)

```typescript
// INPUTS
interface WrapErrorInput {
  error: unknown;  // Any error type (APIError, Error, string, object)
}

// OUTPUTS
interface WrapErrorOutput {
  error: ProviderError;  // Always returns a ProviderError subclass
}

// ERROR CLASSES
class ProviderError extends Error {
  provider: string = 'openaivercel';
  statusCode?: number;
  originalError?: Error;
}

class RateLimitError extends ProviderError {
  retryAfter?: number;  // Seconds until retry is allowed
}

class AuthenticationError extends ProviderError {
  // Always has statusCode = 401
}

// DEPENDENCIES
// None - error handling is self-contained
```

## Integration Points (Line-by-Line)

| Line(s) | Integration Point | Connected Component |
|---------|-------------------|---------------------|
| 002-013 | ProviderError class | Base class for all provider errors |
| 016-024 | RateLimitError class | Thrown on 429 status, includes retryAfter |
| 027-032 | AuthenticationError class | Thrown on 401 status |
| 040-088 | wrapError function | Main entry point, called by 003/004 generation |
| 056-058 | createRateLimitError | Extracts retry-after from headers |
| 100-119 | createRateLimitError | Parses retry-after header value |
| 130-152 | isNetworkError | Detects ECONNREFUSED, ETIMEDOUT, etc. |
| 180-186 | Usage in generateNonStreaming | 004-non-streaming-generation.md:030-032 |
| 188-196 | Usage in generateStreaming | 003-streaming-generation.md:068 |

## Anti-Pattern Warnings

```
[WARNING] ANTI-PATTERN: Throwing generic Error instead of ProviderError
   Instead: Always wrap in ProviderError or subclass for consistent handling
   
[WARNING] ANTI-PATTERN: Losing original error context
   Instead: Always preserve originalError property (lines 010-011)
   
[WARNING] ANTI-PATTERN: Hardcoding error messages without original message
   Instead: Include original message in wrapped error (lines 052, 062, etc.)

[WARNING] ANTI-PATTERN: Ignoring retry-after header for rate limits
   Instead: Parse and include retryAfter for client retry logic (lines 107-114)

[WARNING] ANTI-PATTERN: Not detecting network errors by code
   Instead: Check for ECONNREFUSED, ECONNRESET, etc. (lines 136-140)

[WARNING] ANTI-PATTERN: Re-wrapping already-wrapped errors
   Instead: Check instanceof ProviderError first (lines 043-045)
```

---

## Error Class Hierarchy

```
001: // Base error for all provider errors
002: CLASS ProviderError EXTENDS Error
003:   provider: string = 'openaivercel'
004:   statusCode: number | undefined
005:   originalError: Error | undefined
006:   
007:   CONSTRUCTOR(message: string, statusCode?: number, originalError?: Error)
008:     SUPER(message)
009:     this.name = 'ProviderError'
010:     this.statusCode = statusCode
011:     this.originalError = originalError
012:   END CONSTRUCTOR
013: END CLASS
014:
015: // Rate limit error (429)
016: CLASS RateLimitError EXTENDS ProviderError
017:   retryAfter: number | undefined
018:   
019:   CONSTRUCTOR(message: string, retryAfter?: number, originalError?: Error)
020:     SUPER(message, 429, originalError)
021:     this.name = 'RateLimitError'
022:     this.retryAfter = retryAfter
023:   END CONSTRUCTOR
024: END CLASS
025:
026: // Authentication error (401)
027: CLASS AuthenticationError EXTENDS ProviderError
028:   CONSTRUCTOR(message: string, originalError?: Error)
029:     SUPER('Authentication failed: ' + message + '. Please check your API key.', 401, originalError)
030:     this.name = 'AuthenticationError'
031:   END CONSTRUCTOR
032: END CLASS
```

---

## Function: wrapError

Main error wrapping function.

```
040: FUNCTION wrapError(error: unknown) -> ProviderError
041:   
042:   // If already a ProviderError, return as-is
043:   IF error IS INSTANCE OF ProviderError THEN
044:     RETURN error
045:   END IF
046:   
047:   // Cast to error-like object for property access
048:   err = error AS { status?: number, headers?: Record<string, string>, code?: string, message?: string }
049:   
050:   // Extract error details
051:   status = err.status
052:   message = err.message OR 'Unknown error'
053:   
054:   // Classify error by status code
055:   SWITCH status
056:     CASE 429:
057:       // Rate limit error
058:       RETURN createRateLimitError(err)
059:     
060:     CASE 401:
061:       // Authentication error
062:       RETURN NEW AuthenticationError(message, err AS Error)
063:     
064:     CASE 400:
065:       // Bad request
066:       RETURN NEW ProviderError('Invalid request: ' + message, 400, err AS Error)
067:     
068:     CASE 404:
069:       // Not found (usually invalid model)
070:       RETURN NEW ProviderError('Resource not found: ' + message, 404, err AS Error)
071:     
072:     CASE 500:
073:     CASE 502:
074:     CASE 503:
075:       // Server errors
076:       RETURN NEW ProviderError('Server error: ' + message, status, err AS Error)
077:     
078:     DEFAULT:
079:       // Check for network errors
080:       IF isNetworkError(err) THEN
081:         RETURN NEW ProviderError('Network error: ' + message, undefined, err AS Error)
082:       END IF
083:       
084:       // Generic provider error
085:       RETURN NEW ProviderError(message, status, err AS Error)
086:   END SWITCH
087:   
088: END FUNCTION
```

---

## Function: createRateLimitError

Creates RateLimitError with retry information.

```
100: FUNCTION createRateLimitError(err: ErrorLike) -> RateLimitError
101:   
102:   message = err.message OR 'Rate limit exceeded'
103:   
104:   // Extract retry-after from headers
105:   retryAfter = undefined
106:   
107:   IF err.headers IS DEFINED THEN
108:     retryAfterHeader = err.headers['retry-after']
109:     IF retryAfterHeader IS DEFINED THEN
110:       retryAfter = PARSE_INT(retryAfterHeader)
111:       IF retryAfter IS NaN THEN
112:         retryAfter = undefined
113:       END IF
114:     END IF
115:   END IF
116:   
117:   RETURN NEW RateLimitError(message, retryAfter, err AS Error)
118:   
119: END FUNCTION
```

---

## Function: isNetworkError

Detects network-related errors.

```
130: FUNCTION isNetworkError(err: ErrorLike) -> boolean
131:   
132:   // Check error codes
133:   code = err.code
134:   IF code IS DEFINED THEN
135:     // Common Node.js network error codes
136:     IF code == 'ECONNREFUSED' THEN RETURN true
137:     IF code == 'ECONNRESET' THEN RETURN true
138:     IF code == 'ETIMEDOUT' THEN RETURN true
139:     IF code == 'ENOTFOUND' THEN RETURN true
140:     IF code == 'ENETUNREACH' THEN RETURN true
141:   END IF
142:   
143:   // Check error message for network-related keywords
144:   message = (err.message OR '').toLowerCase()
145:   IF message CONTAINS 'network' THEN RETURN true
146:   IF message CONTAINS 'timeout' THEN RETURN true
147:   IF message CONTAINS 'connection' THEN RETURN true
148:   IF message CONTAINS 'socket' THEN RETURN true
149:   
150:   RETURN false
151:   
152: END FUNCTION
```

---

## Error Properties

```
160: // All ProviderError instances include:
161: //
162: // - message: Human-readable error description
163: // - provider: Always 'openaivercel'
164: // - statusCode: HTTP status if applicable (429, 401, 500, etc.)
165: // - originalError: The original error for debugging
166: //
167: // RateLimitError additionally includes:
168: // - retryAfter: Seconds to wait before retry (from headers)
169: //
170: // AuthenticationError:
171: // - Always has status 401
172: // - Message includes "Please check your API key"
```

---

## Usage in Generation Functions

```
180: // In generateNonStreaming (004-non-streaming-generation.md):
181: //
182: // TRY
183: //   result = AWAIT generateText(...)
184: // CATCH error
185: //   THROW wrapError(error)  // Line 032
186: // END TRY
187:
188: // In generateStreaming (003-streaming-generation.md):
189: //
190: // TRY
191: //   FOR AWAIT chunk IN stream.textStream
192: //     YIELD ...
193: //   END FOR
194: // CATCH error
195: //   THROW wrapError(error)  // Line 068
196: // END TRY
```

---

## Error Message Guidelines

```
200: // Error messages should be:
201: // - Clear: State what went wrong
202: // - Actionable: Suggest what user can do
203: // - Contextual: Include relevant details
204: //
205: // Examples:
206: // - "Authentication failed: Invalid API key. Please check your API key."
207: // - "Rate limit exceeded. Retry after 30 seconds."
208: // - "Server error: OpenAI service temporarily unavailable."
209: // - "Network error: Connection refused."
```

---

## Error Codes Reference

```
210: // HTTP Status Code Mapping:
211: //
212: // 400 - Bad Request (invalid parameters)
213: // 401 - Unauthorized (bad API key)
214: // 403 - Forbidden (quota exceeded, permissions)
215: // 404 - Not Found (invalid model)
216: // 429 - Too Many Requests (rate limit)
217: // 500 - Internal Server Error
218: // 502 - Bad Gateway
219: // 503 - Service Unavailable
220:
221: // Node.js Error Codes:
222: //
223: // ECONNREFUSED - Connection refused
224: // ECONNRESET - Connection reset
225: // ETIMEDOUT - Connection timed out
226: // ENOTFOUND - DNS lookup failed
227: // ENETUNREACH - Network unreachable
```

---

## Testing Error Handling

```
230: // Test scenarios per P13:
231: //
232: // 1. Rate limit (429) -> RateLimitError with retryAfter
233: // 2. Auth failure (401) -> AuthenticationError with helpful message
234: // 3. Invalid model (404) -> ProviderError
235: // 4. Server error (500, 502, 503) -> ProviderError
236: // 5. Network error (ECONNREFUSED) -> ProviderError with "Network error"
237: // 6. Timeout (ETIMEDOUT) -> ProviderError with "Network error"
238: // 7. Unknown error -> ProviderError with original message
239: //
240: // All errors should:
241: // - Have provider = 'openaivercel'
242: // - Preserve original error in originalError property
243: // - Include original message content
```
