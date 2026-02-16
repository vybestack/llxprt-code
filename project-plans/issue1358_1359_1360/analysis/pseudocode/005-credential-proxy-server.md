# Pseudocode: CredentialProxyServer

Plan ID: PLAN-20250214-CREDPROXY
Component: CredentialProxyServer (Host-Side)

## Interface Contracts

```typescript
// INPUTS
interface CredentialProxyServerOptions {
  tokenStore: KeyringTokenStore;
  keyStorage: ProviderKeyStorage;
  providers: Map<string, OAuthProvider>;
  flowFactories: Map<string, () => OAuthFlow>;
  allowedProviders: Set<string>;
  allowedBuckets: Map<string, Set<string>>;
}

// OUTPUTS
// Unix domain socket accepting framed JSON requests
// Returns framed JSON responses per operation schema

// DEPENDENCIES (NEVER stubbed)
// KeyringTokenStore — real dependency, injected
// ProviderKeyStorage — real dependency, injected
// OAuthProvider instances — real dependencies, injected
// Node.js net.Server — system dependency
// crypto — system dependency
// fs — system dependency
```

## Integration Points

```
Line 10: CALL net.createServer() — Node.js net module, creates TCP/IPC server
Line 15: CALL fs.mkdirSync(dir, {mode: 0o700, recursive: true}) — per-user subdir
Line 20: CALL crypto.randomBytes(4).toString('hex') — nonce generation
Line 42: CALL server.listen(socketPath) — begins accepting connections
Line 60: CALL fs.chmodSync(socketPath, 0o600) — socket permissions
Line 130: CALL this.tokenStore.getToken(provider, bucket) — delegates to real store
Line 145: CALL sanitizeTokenForProxy(token) — strips refresh_token
Line 200: CALL this.keyStorage.getKey(name) — delegates to real key storage
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: return { access_token: "test", refresh_token: "secret" }  // Leaks refresh_token
[OK]    DO: return sanitizeTokenForProxy(fullToken)

[ERROR] DO NOT: server.listen("/tmp/llxprt-cred.sock")  // Hardcoded path, no nonce
[OK]    DO: server.listen(buildSocketPath(uid, pid, nonce))

[ERROR] DO NOT: socket.on('data', (data) => JSON.parse(data.toString()))  // No framing
[OK]    DO: Use FrameReader to decode length-prefixed frames
```

## Pseudocode

```
 10: CLASS CredentialProxyServer
 11:   PRIVATE server: net.Server
 12:   PRIVATE socketPath: string
 13:   PRIVATE sessionStore: PKCESessionStore
 14:   PRIVATE proactiveScheduler: ProactiveScheduler
 15:   PRIVATE refreshCoordinator: RefreshCoordinator
 16:   PRIVATE rateLimiter: RateLimiter
 17:   PRIVATE connections: Set<net.Socket>
 18:
 19:   CONSTRUCTOR(options: CredentialProxyServerOptions)
 20:     STORE tokenStore, keyStorage, providers, flowFactories
 21:     STORE allowedProviders, allowedBuckets
 22:     CREATE sessionStore = new PKCESessionStore(sessionTimeoutMs)
 23:     CREATE proactiveScheduler = new ProactiveScheduler()
 24:     CREATE refreshCoordinator = new RefreshCoordinator(tokenStore, providers)
 25:     CREATE rateLimiter = new RateLimiter(60)
 26:     SET socketPath = buildSocketPath()
 27:
 28:   METHOD buildSocketPath(): string
 29:     LET tmpdir = fs.realpathSync(os.tmpdir())
 30:     LET uid = process.getuid()
 31:     LET pid = process.pid
 32:     LET nonce = crypto.randomBytes(4).toString('hex')
 33:     LET dir = path.join(tmpdir, `llxprt-cred-${uid}`)
 34:     CALL fs.mkdirSync(dir, { mode: 0o700, recursive: true })
 35:     RETURN path.join(dir, `llxprt-cred-${pid}-${nonce}.sock`)
 36:
 37:   ASYNC METHOD start(): Promise<void>
 38:     IF socket file exists at socketPath
 39:       CALL fs.unlinkSync(socketPath)  // stale socket cleanup
 40:     CREATE server = net.createServer()
 41:     BIND server 'connection' event → handleConnection
 42:     CALL server.listen(socketPath)
 43:     AWAIT listening event
 44:     CALL fs.chmodSync(socketPath, 0o600)
 45:     START sessionStore GC interval (60s)
 46:     LOG debug "Credential proxy listening on ${socketPath}"
 47:
 48:   METHOD handleConnection(socket: net.Socket): void
 49:     ADD socket to connections set
 50:     CREATE frameReader = new FrameReader(socket)
 51:     SET handshakeCompleted = false
 52:     SET peerInfo = verifyPeerCredentials(socket)
 53:
 54:     ON frameReader 'frame' event (data: Buffer):
 55:       LET request = JSON.parse(data)
 56:       IF NOT handshakeCompleted
 57:         IF request.op !== 'handshake'
 58:           SEND error frame: INVALID_REQUEST "Handshake required"
 59:           CLOSE socket
 60:           RETURN
 61:         CALL handleHandshake(socket, request)
 62:         SET handshakeCompleted = true
 63:         RETURN
 64:       IF NOT rateLimiter.allow()
 65:         SEND error: RATE_LIMITED with retryAfter
 66:         RETURN
 67:       CALL dispatchRequest(socket, request, peerInfo)
 68:
 69:     ON socket 'close':
 70:       REMOVE socket from connections set
 71:     ON socket 'error':
 72:       LOG debug "Connection error"
 73:       REMOVE socket from connections set
 74:
 75:   METHOD verifyPeerCredentials(socket: net.Socket): PeerInfo
 76:     IF platform === 'linux'
 77:       READ SO_PEERCRED from socket fd
 78:       IF peerUid !== process.getuid()
 79:         LOG warning "Peer UID mismatch"
 80:         CLOSE socket
 81:         RETURN null
 82:       RETURN { uid: peerUid, type: 'uid' }
 83:     ELSE IF platform === 'darwin'
 84:       READ LOCAL_PEERPID from socket fd (best-effort)
 85:       LOG debug "Peer PID: ${peerPid}"
 86:       RETURN { pid: peerPid, type: 'pid' }
 87:     ELSE
 88:       LOG warning "No peer credential verification available"
 89:       RETURN { type: 'none' }
 90:
 91:   METHOD handleHandshake(socket, request): void
 92:     LET { minVersion, maxVersion } = request.payload
 93:     IF 1 >= minVersion AND 1 <= maxVersion
 94:       SEND { v: 1, op: 'handshake', ok: true, data: { version: 1 } }
 95:     ELSE
 96:       SEND { v: 1, op: 'handshake', ok: false, code: 'UNKNOWN_VERSION' }
 97:       CLOSE socket
 98:
 99:   ASYNC METHOD dispatchRequest(socket, request, peerInfo): void
100:     LET { id, op, payload } = request
101:     TRY
102:       VALIDATE payload schema for op (Zod)
103:       IF op requires provider: CHECK profile scoping (allowedProviders, allowedBuckets)
104:       SWITCH op
105:         CASE 'get_token':     result = AWAIT handleGetToken(payload)
106:         CASE 'save_token':    result = AWAIT handleSaveToken(payload)
107:         CASE 'remove_token':  result = AWAIT handleRemoveToken(payload)
108:         CASE 'list_providers': result = AWAIT handleListProviders()
109:         CASE 'list_buckets':  result = AWAIT handleListBuckets(payload)
110:         CASE 'refresh_token': result = AWAIT handleRefreshToken(payload)
111:         CASE 'get_api_key':   result = AWAIT handleGetApiKey(payload)
112:         CASE 'list_api_keys': result = AWAIT handleListApiKeys()
113:         CASE 'oauth_initiate': result = AWAIT handleOAuthInitiate(payload, peerInfo)
114:         CASE 'oauth_exchange': result = AWAIT handleOAuthExchange(payload, peerInfo)
115:         CASE 'oauth_poll':    result = AWAIT handleOAuthPoll(payload, peerInfo)
116:         CASE 'oauth_cancel':  result = AWAIT handleOAuthCancel(payload)
117:         DEFAULT: THROW INVALID_REQUEST "Unknown operation"
118:       SEND { v: 1, id, ok: true, data: result }
119:     CATCH error
120:       SEND { v: 1, id, ok: false, error: sanitizeErrorMessage(error), code: mapErrorCode(error) }
121:
122:   ASYNC METHOD handleGetToken(payload): SanitizedOAuthToken | null
123:     LET { provider, bucket } = payload
124:     LET token = AWAIT tokenStore.getToken(provider, bucket)
125:     IF token === null
126:       THROW NOT_FOUND
127:     LET sanitized = sanitizeTokenForProxy(token)
128:     CALL proactiveScheduler.scheduleIfNeeded(provider, bucket, token)
129:     RETURN sanitized
130:
131:   ASYNC METHOD handleSaveToken(payload): {}
132:     LET { provider, bucket, token } = payload
133:     DELETE token.refresh_token  // STRIP incoming refresh_token
134:     LET locked = AWAIT tokenStore.acquireRefreshLock(provider, { bucket })
135:     TRY
136:       LET existing = AWAIT tokenStore.getToken(provider, bucket)
137:       IF existing
138:         LET merged = mergeRefreshedToken(existing, token)
139:         AWAIT tokenStore.saveToken(provider, merged, bucket)
140:       ELSE
141:         AWAIT tokenStore.saveToken(provider, token, bucket)
142:     FINALLY
143:       AWAIT tokenStore.releaseRefreshLock(provider, bucket)
144:     RETURN {}
145:
146:   ASYNC METHOD handleRemoveToken(payload): {}
147:     LET { provider, bucket } = payload
148:     LET locked = AWAIT tokenStore.acquireRefreshLock(provider, { bucket })
149:     TRY
150:       AWAIT tokenStore.removeToken(provider, bucket)
151:     CATCH error
152:       LOG debug "Token removal error (best-effort): ${error.message}"
153:     FINALLY
154:       AWAIT tokenStore.releaseRefreshLock(provider, bucket)
155:     RETURN {}
156:
157:   ASYNC METHOD handleListProviders(): { providers: string[] }
158:     TRY
159:       LET all = AWAIT tokenStore.listProviders()
160:       RETURN { providers: all.filter(p => allowedProviders.has(p)) }
161:     CATCH
162:       RETURN { providers: [] }
163:
164:   ASYNC METHOD handleListBuckets(payload): { buckets: string[] }
165:     LET { provider } = payload
166:     TRY
167:       LET all = AWAIT tokenStore.listBuckets(provider)
168:       LET allowed = allowedBuckets.get(provider) ?? new Set()
169:       RETURN { buckets: all.filter(b => allowed.has(b)) }
170:     CATCH
171:       RETURN { buckets: [] }
172:
173:   ASYNC METHOD handleGetApiKey(payload): { key: string }
174:     LET { name } = payload
175:     LET key = AWAIT keyStorage.getKey(name)
176:     IF key === null
177:       THROW NOT_FOUND
178:     RETURN { key }
179:
180:   ASYNC METHOD handleListApiKeys(): { keys: string[] }
181:     TRY
182:       RETURN { keys: AWAIT keyStorage.listKeys() }
183:     CATCH
184:       RETURN { keys: [] }
185:
186:   ASYNC METHOD stop(): Promise<void>
187:     CALL proactiveScheduler.cancelAll()
188:     CALL sessionStore.clearAll()
189:     CLOSE server (stop accepting)
190:     WAIT up to 5s for in-flight requests
191:     CLOSE all connections
192:     IF socketPath exists
193:       CALL fs.unlinkSync(socketPath)
194:     LOG debug "Credential proxy stopped"
195:
196:   METHOD getSocketPath(): string
197:     RETURN socketPath
```
