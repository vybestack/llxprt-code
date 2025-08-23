# Pseudocode: QwenOAuthProvider

## @requirement REQ-001, REQ-002

```
1: CLASS QwenOAuthProvider implements OAuthProvider
2:   PRIVATE tokenStore: TokenStore
3:   PRIVATE deviceFlow: QwenDeviceFlow
4:   PRIVATE name: string = 'qwen'
5:
6: METHOD constructor(tokenStore: TokenStore)
7:   SET this.tokenStore = tokenStore
8:   SET config = {
9:     clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
10:     authorizationEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
11:     tokenEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/token',
12:     scopes: ['openid', 'profile', 'email', 'model.completion']
13:   }
14:   SET this.deviceFlow = new QwenDeviceFlow(config)
15:   CALL this.initializeToken()
16:
17: METHOD async initializeToken()
18:   TRY
19:     SET savedToken = AWAIT this.tokenStore.getToken('qwen')
20:     IF savedToken AND NOT this.isTokenExpired(savedToken) THEN
21:       RETURN // Token is valid, ready to use
22:     END IF
23:   CATCH error
24:     LOG "Failed to load token: " + error
25:   END TRY
26:
27: METHOD isTokenExpired(token: OAuthToken): boolean
28:   SET now = Date.now() / 1000
29:   SET buffer = 30 // 30-second buffer
30:   RETURN token.expiry <= (now + buffer)
31:
32: METHOD async initiateAuth(): Promise<void>
33:   SET deviceCodeResponse = AWAIT this.deviceFlow.initiateDeviceFlow()
34:   SET authUrl = deviceCodeResponse.verification_uri_complete OR
35:                 deviceCodeResponse.verification_uri + "?user_code=" + deviceCodeResponse.user_code
36:   
37:   PRINT "Qwen OAuth Authentication"
38:   PRINT "─" * 40
39:   
40:   IF shouldLaunchBrowser() THEN
41:     PRINT "Opening browser for authentication..."
42:     TRY
43:       AWAIT openBrowserSecurely(authUrl)
44:     CATCH error
45:       PRINT "Failed to open browser automatically."
46:     END TRY
47:   ELSE
48:     PRINT "Visit this URL to authorize:"
49:     PRINT authUrl
50:   END IF
51:   
52:   PRINT "Waiting for authorization..."
53:   
54:   SET token = AWAIT this.deviceFlow.pollForToken(deviceCodeResponse.device_code)
55:   AWAIT this.tokenStore.saveToken('qwen', token)
56:   PRINT "Authentication successful!"
57:
58: METHOD async getToken(): Promise<OAuthToken | null>
59:   RETURN AWAIT this.tokenStore.getToken('qwen')
60:
61: METHOD async refreshIfNeeded(): Promise<OAuthToken | null>
62:   SET currentToken = AWAIT this.tokenStore.getToken('qwen')
63:   
64:   IF NOT currentToken THEN
65:     RETURN null
66:   END IF
67:   
68:   IF this.isTokenExpired(currentToken) THEN
69:     IF currentToken.refresh_token THEN
70:       TRY
71:         SET refreshedToken = AWAIT this.deviceFlow.refreshToken(currentToken.refresh_token)
72:         AWAIT this.tokenStore.saveToken('qwen', refreshedToken)
73:         RETURN refreshedToken
74:       CATCH error
75:         LOG "Failed to refresh Qwen token: " + error
76:         AWAIT this.tokenStore.removeToken('qwen')
77:         RETURN null
78:       END TRY
79:     ELSE
80:       AWAIT this.tokenStore.removeToken('qwen')
81:       RETURN null
82:     END IF
83:   END IF
84:   
85:   RETURN currentToken
86:
87: METHOD async logout(): Promise<void>
88:   AWAIT this.tokenStore.removeToken('qwen')
89:   PRINT "Successfully logged out from Qwen"
90:
91: END CLASS
```