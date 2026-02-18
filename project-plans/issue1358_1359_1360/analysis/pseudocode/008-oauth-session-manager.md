# Pseudocode: PKCESessionStore & OAuth Session Handlers

Plan ID: PLAN-20250214-CREDPROXY
Component: PKCESessionStore + oauth_initiate/oauth_exchange/oauth_poll/oauth_cancel handlers

## Interface Contracts

```typescript
// SESSION STATE
interface OAuthSession {
  sessionId: string;
  provider: string;
  bucket: string;
  flowType: 'pkce_redirect' | 'device_code' | 'browser_redirect';
  flowInstance: AnthropicDeviceFlow | CodexDeviceFlow | QwenDeviceFlow | OAuth2Client;
  codeVerifier?: { codeVerifier: string };  // Gemini PKCE verifier
  deviceCode?: string;
  pollIntervalMs?: number;
  abortController?: AbortController;
  result?: { token: OAuthToken } | { error: string; code: string };
  createdAt: number;
  peerIdentity: PeerInfo;
  used: boolean;
}

// OUTPUTS
interface InitiateResponse {
  session_id: string;
  flow_type: string;
  auth_url?: string;
  verification_url?: string;
  user_code?: string;
  pollIntervalMs?: number;
}

// DEPENDENCIES (NEVER stubbed)
interface Dependencies {
  flowFactories: Map<string, () => OAuthFlow>;
  tokenStore: KeyringTokenStore;
}
```

## Integration Points

```
Line 30: CALL crypto.randomBytes(16).toString('hex') — session ID generation
Line 50: CALL flowFactory() — creates fresh provider flow instance per session
Line 60: CALL flow.initiateDeviceFlow() — Anthropic/Qwen flow initiation
Line 70: CALL flow.buildAuthorizationUrl(redirectUri, state) — Codex browser redirect
Line 80: CALL flow.requestDeviceCode() — Codex device code fallback
Line 90: CALL client.generateCodeVerifierAsync() — Gemini PKCE generation
Line 110: CALL flow.exchangeCodeForToken(code) — Anthropic/Codex/Gemini code exchange
Line 120: CALL flow.pollForToken() — Qwen/Codex background polling
Line 140: CALL tokenStore.saveToken(provider, fullToken, bucket) — stores full token on host
Line 150: CALL sanitizeTokenForProxy(token) — strips refresh_token for response
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: sessions.set(id, { flowInstance: sharedFlow })  // Shared PKCE state
[OK]    DO: sessions.set(id, { flowInstance: flowFactory() })    // Fresh instance per session

[ERROR] DO NOT: return { session_id, auth_url, device_code }  // Leaks PKCE verifier
[OK]    DO: return { session_id, auth_url }  // Only safe fields

[ERROR] DO NOT: if (session.used) { session.used = false; doExchange() }  // Allows replay
[OK]    DO: if (session.used) { throw SESSION_ALREADY_USED }
```

## Pseudocode

```
 10: CLASS PKCESessionStore
 11:   PRIVATE sessions: Map<string, OAuthSession>
 12:   PRIVATE sessionTimeoutMs: number
 13:   PRIVATE gcInterval: NodeJS.Timeout | null
 14:
 15:   CONSTRUCTOR(sessionTimeoutMs: number = 600_000)  // 10 minutes default
 16:     LET envTimeout = process.env.LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS
 17:     IF envTimeout
 18:       SET sessionTimeoutMs = parseInt(envTimeout, 10) * 1000
 19:     SET sessions = new Map()
 20:     STORE sessionTimeoutMs
 21:
 22:   METHOD startGC(): void
 23:     SET gcInterval = setInterval(() => sweepExpired(), 60_000)
 24:
 25:   METHOD sweepExpired(): void
 26:     LET now = Date.now()
 27:     FOR EACH [id, session] IN sessions
 28:       IF now - session.createdAt > sessionTimeoutMs OR session.used
 29:         IF session.abortController
 30:           session.abortController.abort()
 31:         sessions.delete(id)
 32:
 33:   METHOD createSession(provider: string, bucket: string, flowType: string,
 34:                         flowInstance: OAuthFlow, peerIdentity: PeerInfo): string
 35:     LET sessionId = crypto.randomBytes(16).toString('hex')
 36:     sessions.set(sessionId, {
 37:       sessionId, provider, bucket, flowType, flowInstance,
 38:       createdAt: Date.now(), peerIdentity, used: false
 39:     })
 40:     RETURN sessionId
 41:
 42:   METHOD getSession(sessionId: string, peerIdentity: PeerInfo): OAuthSession
 43:     LET session = sessions.get(sessionId)
 44:     IF NOT session
 45:       THROW SESSION_NOT_FOUND
 46:     IF session.used
 47:       THROW SESSION_ALREADY_USED
 48:     IF Date.now() - session.createdAt > sessionTimeoutMs
 49:       sessions.delete(sessionId)
 50:       THROW SESSION_EXPIRED
 51:     // Verify peer identity matches session creator
 52:     IF session.peerIdentity.type === 'uid' AND peerIdentity.uid !== session.peerIdentity.uid
 53:       THROW UNAUTHORIZED "Session peer identity mismatch"
 54:     RETURN session
 55:
 56:   METHOD markUsed(sessionId: string): void
 57:     LET session = sessions.get(sessionId)
 58:     IF session
 59:       session.used = true
 60:
 61:   METHOD removeSession(sessionId: string): void
 62:     LET session = sessions.get(sessionId)
 63:     IF session AND session.abortController
 64:       session.abortController.abort()
 65:     sessions.delete(sessionId)
 66:
 67:   METHOD clearAll(): void
 68:     FOR EACH [id, session] IN sessions
 69:       IF session.abortController
 70:         session.abortController.abort()
 71:     sessions.clear()
 72:     IF gcInterval
 73:       clearInterval(gcInterval)
 74:
 75:
 80: // === OAuth Handlers (methods on CredentialProxyServer) ===
 81:
 82: ASYNC METHOD handleOAuthInitiate(payload, peerInfo): InitiateResponse
 83:   LET { provider, bucket } = payload
 84:   LET flowFactory = flowFactories.get(provider)
 85:   IF NOT flowFactory
 86:     THROW PROVIDER_NOT_FOUND
 87:
 88:   // Determine flow type per provider
 89:   SWITCH provider
 90:     CASE 'anthropic':
 91:       LET flow = flowFactory()  // new AnthropicDeviceFlow(config)
 92:       LET response = AWAIT flow.initiateDeviceFlow()  // NO arguments
 93:       // WARNING: response.device_code IS the PKCE verifier — MUST NOT return it
 94:       LET authUrl = response.verification_uri_complete
 95:       LET sessionId = sessionStore.createSession(provider, bucket, 'pkce_redirect', flow, peerInfo)
 96:       RETURN { session_id: sessionId, flow_type: 'pkce_redirect', auth_url: authUrl }
 97:
 98:     CASE 'gemini':
 99:       LET client = flowFactory()  // creates OAuth2Client
100:       LET codeVerifierResult = AWAIT client.generateCodeVerifierAsync()
101:       LET authUrl = client.generateAuthUrl({
102:         redirect_uri: 'https://codeassist.google.com/authcode',
103:         code_challenge_method: 'S256',
104:         code_challenge: codeVerifierResult.codeChallenge,
105:         access_type: 'offline',
106:         scope: GEMINI_SCOPES
107:       })
108:       LET sessionId = sessionStore.createSession(provider, bucket, 'pkce_redirect', client, peerInfo)
109:       // Store codeVerifier on session for exchange
110:       LET session = sessionStore.sessions.get(sessionId)
111:       session.codeVerifier = codeVerifierResult
112:       RETURN { session_id: sessionId, flow_type: 'pkce_redirect', auth_url: authUrl }
113:
114:     CASE 'qwen':
115:       LET flow = flowFactory()  // new QwenDeviceFlow(config)
116:       LET response = AWAIT flow.initiateDeviceFlow()
117:       LET sessionId = sessionStore.createSession(provider, bucket, 'device_code', flow, peerInfo)
118:       // Start background polling
119:       LET session = sessionStore.sessions.get(sessionId)
120:       session.pollIntervalMs = 5000  // Qwen omits interval
121:       session.abortController = new AbortController()
122:       // Fire-and-forget background poll
123:       CALL startBackgroundPoll(sessionId, flow, provider, bucket)
124:       RETURN {
125:         session_id: sessionId, flow_type: 'device_code',
126:         verification_url: response.verification_uri,  // Map verification_uri → verification_url
127:         user_code: response.user_code,
128:         pollIntervalMs: 5000
129:       }
130:
131:     CASE 'codex':
132:       // Determine primary (browser_redirect) vs fallback (device_code)
133:       // For proxy mode, use browser_redirect as primary
134:       LET flow = flowFactory()  // new CodexDeviceFlow()
135:       TRY
136:         // Primary: browser redirect
137:         LET { redirectServer, port } = AWAIT startRedirectServer()
138:         LET redirectUri = `http://localhost:${port}/callback`
139:         LET state = crypto.randomBytes(16).toString('hex')
140:         LET authUrl = flow.buildAuthorizationUrl(redirectUri, state)
141:         LET sessionId = sessionStore.createSession(provider, bucket, 'browser_redirect', flow, peerInfo)
142:         LET session = sessionStore.sessions.get(sessionId)
143:         session.abortController = new AbortController()
144:         // Start background listener for redirect callback
145:         CALL startRedirectListener(sessionId, flow, redirectServer, redirectUri, state, provider, bucket)
146:         RETURN { session_id: sessionId, flow_type: 'browser_redirect', auth_url: authUrl }
147:       CATCH
148:         // Fallback: device code
149:         LET response = AWAIT flow.requestDeviceCode()
150:         LET sessionId = sessionStore.createSession(provider, bucket, 'device_code', flow, peerInfo)
151:         LET session = sessionStore.sessions.get(sessionId)
152:         LET pollMs = (response.interval ?? 5) * 1000
153:         session.pollIntervalMs = pollMs
154:         session.abortController = new AbortController()
155:         CALL startDeviceCodePoll(sessionId, flow, response, provider, bucket)
156:         RETURN {
157:           session_id: sessionId, flow_type: 'device_code',
158:           verification_url: 'https://auth.openai.com/deviceauth/callback',
159:           user_code: response.user_code,
160:           pollIntervalMs: pollMs
161:         }
162:
163:
164: ASYNC METHOD handleOAuthExchange(payload, peerInfo): SanitizedOAuthToken
165:   LET { session_id, code } = payload
166:   LET session = sessionStore.getSession(session_id, peerInfo)
167:   IF session.flowType !== 'pkce_redirect'
168:     THROW INVALID_REQUEST "oauth_exchange is not valid for flow type ${session.flowType}"
169:   sessionStore.markUsed(session_id)  // Mark before attempt (single-use)
170:   TRY
171:     LET token: OAuthToken
172:     IF session.provider === 'anthropic'
173:       token = AWAIT session.flowInstance.exchangeCodeForToken(code)
174:     ELSE IF session.provider === 'gemini'
175:       LET success = AWAIT authWithCode(session.flowInstance, code, session.codeVerifier, 'https://codeassist.google.com/authcode')
176:       IF NOT success
177:         THROW EXCHANGE_FAILED "Gemini code exchange failed"
178:       LET credentials = session.flowInstance.credentials
179:       token = convertGeminiCredentials(credentials)
180:     ELSE
181:       token = AWAIT session.flowInstance.exchangeCodeForToken(code)
182:     // Validate token schema
183:     CALL OAuthTokenSchema.passthrough().parse(token)
184:     // Store full token on host
185:     AWAIT tokenStore.saveToken(session.provider, token, session.bucket)
186:     // Clean up session
187:     sessionStore.removeSession(session_id)
188:     RETURN sanitizeTokenForProxy(token)
189:   CATCH error
190:     sessionStore.removeSession(session_id)
191:     IF error.code is already a proxy error code
192:       THROW error
193:     THROW EXCHANGE_FAILED sanitizeErrorMessage(error)
194:
195:
196: ASYNC METHOD handleOAuthPoll(payload, peerInfo): PollResponse
197:   LET { session_id } = payload
198:   LET session = sessionStore.getSession(session_id, peerInfo)
199:   IF session.flowType === 'pkce_redirect'
200:     THROW INVALID_REQUEST "oauth_poll is not valid for flow type pkce_redirect"
201:   // Check if background task has completed
202:   IF session.result
203:     IF 'token' IN session.result
204:       sessionStore.markUsed(session_id)
205:       LET sanitized = sanitizeTokenForProxy(session.result.token)
206:       sessionStore.removeSession(session_id)
207:       RETURN { status: 'complete', ...sanitized }
208:     ELSE
209:       sessionStore.markUsed(session_id)
210:       LET { error, code } = session.result
211:       sessionStore.removeSession(session_id)
212:       RETURN { status: 'error', error, code }
213:   // Still pending
214:   RETURN {
215:     status: 'pending',
216:     pollIntervalMs: session.pollIntervalMs ?? 2000
217:   }
218:
219:
220: ASYNC METHOD handleOAuthCancel(payload): {}
221:   LET { session_id } = payload
222:   sessionStore.removeSession(session_id)
223:   RETURN {}
224:
225:
226: // === Background polling helpers ===
227:
228: ASYNC METHOD startBackgroundPoll(sessionId, flow, provider, bucket): void
229:   LET session = sessionStore.sessions.get(sessionId)
230:   TRY
231:     LET token = AWAIT flow.pollForToken()  // Blocks until authorized or error
232:     CALL OAuthTokenSchema.passthrough().parse(token)
233:     AWAIT tokenStore.saveToken(provider, token, bucket)
234:     session.result = { token }
235:   CATCH error
236:     session.result = { error: sanitizeErrorMessage(error), code: mapOAuthErrorCode(error) }
237:
238: ASYNC METHOD startDeviceCodePoll(sessionId, flow, deviceResponse, provider, bucket): void
239:   LET session = sessionStore.sessions.get(sessionId)
240:   TRY
241:     LET pollResult = AWAIT flow.pollForDeviceToken(deviceResponse.device_auth_id, deviceResponse.user_code, deviceResponse.interval)
242:     LET token = AWAIT flow.completeDeviceAuth(pollResult.authorization_code, pollResult.code_verifier, CODEX_CONFIG.deviceAuthCallbackUri)
243:     CALL OAuthTokenSchema.passthrough().parse(token)
244:     AWAIT tokenStore.saveToken(provider, token, bucket)
245:     session.result = { token }
246:   CATCH error
247:     session.result = { error: sanitizeErrorMessage(error), code: mapOAuthErrorCode(error) }
248:
249: ASYNC METHOD startRedirectListener(sessionId, flow, server, redirectUri, state, provider, bucket): void
250:   LET session = sessionStore.sessions.get(sessionId)
251:   TRY
252:     LET code = AWAIT waitForRedirectCode(server, session.abortController.signal)
253:     LET token = AWAIT flow.exchangeCodeForToken(code, redirectUri, state)
254:     CALL OAuthTokenSchema.passthrough().parse(token)
255:     AWAIT tokenStore.saveToken(provider, token, bucket)
256:     session.result = { token }
257:   CATCH error
258:     session.result = { error: sanitizeErrorMessage(error), code: mapOAuthErrorCode(error) }
259:   FINALLY
260:     server.close()
```
