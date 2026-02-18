# Pseudocode: ProxyOAuthAdapter

Plan ID: PLAN-20250214-CREDPROXY
Component: ProxyOAuthAdapter (Inner-Side, drives login/refresh via proxy protocol)

## Interface Contracts

```typescript
// INPUTS
interface LoginRequest {
  provider: string;
  bucket?: string;
}

// OUTPUTS
interface LoginResult {
  access_token: string;
  expiry: number;
  token_type: string;
  scope?: string;
}

// DEPENDENCIES (NEVER stubbed)
interface Dependencies {
  socketClient: ProxySocketClient;  // Shared with ProxyTokenStore
}
```

## Integration Points

```
Line 20: CALL socketClient.sendRequest('oauth_initiate', {provider, bucket}) — starts flow
Line 35: CALL socketClient.sendRequest('oauth_exchange', {session_id, code}) — PKCE exchange
Line 50: CALL socketClient.sendRequest('oauth_poll', {session_id}) — polls for completion
Line 65: CALL socketClient.sendRequest('oauth_cancel', {session_id}) — cancels flow
Line 80: CALL socketClient.sendRequest('refresh_token', {provider, bucket}) — on-demand refresh
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: await oauthManager.login(provider)  // Direct login in proxy mode
[OK]    DO: await proxyOAuthAdapter.login(provider, bucket)  // Via proxy protocol

[ERROR] DO NOT: await provider.refreshToken(token)  // No refresh_token in proxy mode
[OK]    DO: await proxyOAuthAdapter.refresh(provider, bucket)  // Via proxy

[ERROR] DO NOT: while (true) { poll() }  // No backoff
[OK]    DO: while (pending) { await sleep(pollIntervalMs); poll() }
```

## Pseudocode

```
 10: CLASS ProxyOAuthAdapter
 11:   PRIVATE socketClient: ProxySocketClient
 12:
 13:   CONSTRUCTOR(socketClient: ProxySocketClient)
 14:     STORE socketClient
 15:
 16:   ASYNC METHOD login(provider: string, bucket?: string): SanitizedOAuthToken
 17:     // Step 1: Initiate the login flow
 18:     LET initResponse = AWAIT socketClient.sendRequest('oauth_initiate', { provider, bucket })
 19:     LET { session_id, flow_type } = initResponse.data
 20:
 21:     TRY
 22:       SWITCH flow_type
 23:         CASE 'pkce_redirect':
 24:           RETURN AWAIT handlePkceRedirect(session_id, initResponse.data)
 25:
 26:         CASE 'device_code':
 27:           RETURN AWAIT handleDeviceCode(session_id, initResponse.data)
 28:
 29:         CASE 'browser_redirect':
 30:           RETURN AWAIT handleBrowserRedirect(session_id, initResponse.data)
 31:
 32:         DEFAULT:
 33:           THROW "Unknown flow type: ${flow_type}"
 34:     CATCH error
 35:       // On any error, try to cancel the session
 36:       TRY
 37:         AWAIT socketClient.sendRequest('oauth_cancel', { session_id })
 38:       CATCH
 39:         // Best effort cancel
 40:       THROW error
 41:
 42:   ASYNC METHOD handlePkceRedirect(sessionId: string, data: InitiateResponse): SanitizedOAuthToken
 43:     // Display auth URL to user in TUI
 44:     PRINT "Open this URL in your browser to authorize:"
 45:     PRINT data.auth_url
 46:     PRINT ""
 47:
 48:     // Prompt user to paste the authorization code
 49:     LET code = AWAIT promptForInput("Paste the authorization code here: ")
 50:     IF NOT code OR code.trim() === ''
 51:       THROW "Authorization cancelled — no code provided"
 52:
 53:     // Exchange the code for a token
 54:     LET exchangeResponse = AWAIT socketClient.sendRequest('oauth_exchange', {
 55:       session_id: sessionId,
 56:       code: code.trim()
 57:     })
 58:     RETURN exchangeResponse.data
 59:
 60:   ASYNC METHOD handleDeviceCode(sessionId: string, data: InitiateResponse): SanitizedOAuthToken
 61:     // Display verification URL and user code
 62:     PRINT "Go to: ${data.verification_url}"
 63:     PRINT "Enter code: ${data.user_code}"
 64:     PRINT "Waiting for authorization..."
 65:
 66:     LET pollIntervalMs = data.pollIntervalMs ?? 5000
 67:
 68:     // Poll until complete, error, or timeout
 69:     LOOP
 70:       AWAIT sleep(pollIntervalMs)
 71:       LET pollResponse = AWAIT socketClient.sendRequest('oauth_poll', { session_id: sessionId })
 72:       LET pollData = pollResponse.data
 73:
 74:       SWITCH pollData.status
 75:         CASE 'pending':
 76:           // Update poll interval if server suggests different
 77:           IF pollData.pollIntervalMs
 78:             SET pollIntervalMs = pollData.pollIntervalMs
 79:           CONTINUE
 80:
 81:         CASE 'complete':
 82:           PRINT "Successfully authenticated!"
 83:           RETURN pollData  // Contains access_token, expiry, token_type, scope
 84:
 85:         CASE 'error':
 86:           THROW "Authentication failed: ${pollData.error}"
 87:
 88:   ASYNC METHOD handleBrowserRedirect(sessionId: string, data: InitiateResponse): SanitizedOAuthToken
 89:     // Display auth URL
 90:     PRINT "Open this URL in your browser to authorize:"
 91:     PRINT data.auth_url
 92:     PRINT "Waiting for browser authorization..."
 93:
 94:     LET pollIntervalMs = 2000  // Default for browser redirect
 95:
 96:     // Poll until complete, error, or timeout
 97:     LOOP
 98:       AWAIT sleep(pollIntervalMs)
 99:       LET pollResponse = AWAIT socketClient.sendRequest('oauth_poll', { session_id: sessionId })
100:       LET pollData = pollResponse.data
101:
102:       SWITCH pollData.status
103:         CASE 'pending':
104:           IF pollData.pollIntervalMs
105:             SET pollIntervalMs = pollData.pollIntervalMs
106:           CONTINUE
107:
108:         CASE 'complete':
109:           PRINT "Successfully authenticated!"
110:           RETURN pollData
111:
112:         CASE 'error':
113:           THROW "Authentication failed: ${pollData.error}"
114:
115:   ASYNC METHOD refresh(provider: string, bucket?: string): SanitizedOAuthToken
116:     // On-demand refresh via proxy — fallback when proactive renewal hasn't fired yet
117:     LET response = AWAIT socketClient.sendRequest('refresh_token', { provider, bucket })
118:     RETURN response.data
119:
120:   ASYNC METHOD cancel(sessionId: string): void
121:     AWAIT socketClient.sendRequest('oauth_cancel', { session_id: sessionId })
```
