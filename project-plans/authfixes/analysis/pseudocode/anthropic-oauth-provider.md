# Pseudocode: AnthropicOAuthProvider

## @requirement REQ-001, REQ-002

```
1: CLASS AnthropicOAuthProvider implements OAuthProvider
2:   PRIVATE tokenStore: TokenStore
3:   PRIVATE deviceFlow: AnthropicDeviceFlow
4:   PRIVATE name: string = 'anthropic'
5:   PRIVATE authCancelled: boolean = false
6:
7: METHOD constructor(tokenStore: TokenStore)
8:   SET this.tokenStore = tokenStore
9:   SET this.deviceFlow = new AnthropicDeviceFlow()
10:   CALL this.initializeToken()
11:
12: METHOD async initializeToken()
13:   TRY
14:     SET savedToken = AWAIT this.tokenStore.getToken('anthropic')
15:     IF savedToken AND NOT this.isTokenExpired(savedToken) THEN
16:       RETURN // Token is valid, ready to use
17:     END IF
18:   CATCH error
19:     LOG "Failed to load Anthropic token: " + error
20:   END TRY
21:
22: METHOD isTokenExpired(token: OAuthToken): boolean
23:   SET now = Date.now() / 1000
24:   SET buffer = 30 // 30-second buffer
25:   RETURN token.expiry <= (now + buffer)
26:
27: METHOD async initiateAuth(): Promise<void>
28:   SET this.authCancelled = false
29:   SET deviceResponse = AWAIT this.deviceFlow.initiateDeviceFlow()
30:   
31:   PRINT "Anthropic OAuth Authentication"
32:   PRINT "─" * 40
33:   PRINT "Visit this URL to authorize:"
34:   PRINT deviceResponse.verification_uri_complete
35:   PRINT "─" * 40
36:   
37:   IF shouldLaunchBrowser() THEN
38:     TRY
39:       AWAIT openBrowserSecurely(deviceResponse.verification_uri_complete)
40:     CATCH error
41:       PRINT "Failed to open browser automatically"
42:     END TRY
43:   END IF
44:   
45:   PRINT "Waiting for authorization..."
46:   PRINT "Enter authorization code (or 'cancel' to abort):"
47:   
48:   SET authCode = AWAIT this.promptForCode()
49:   
50:   IF authCode === 'cancel' THEN
51:     SET this.authCancelled = true
52:     THROW new Error('Authentication cancelled by user')
53:   END IF
54:   
55:   SET token = AWAIT this.deviceFlow.exchangeCodeForToken(authCode)
56:   AWAIT this.tokenStore.saveToken('anthropic', token)
57:   PRINT "Authentication successful!"
58:
59: METHOD async promptForCode(): Promise<string>
60:   // Implementation uses readline to get user input
61:   SET readline = createInterface(process.stdin, process.stdout)
62:   SET code = AWAIT readline.question('Authorization code: ')
63:   CLOSE readline
64:   RETURN code
65:
66: METHOD async getToken(): Promise<OAuthToken | null>
67:   RETURN AWAIT this.tokenStore.getToken('anthropic')
68:
69: METHOD async refreshIfNeeded(): Promise<OAuthToken | null>
70:   SET currentToken = AWAIT this.tokenStore.getToken('anthropic')
71:   
72:   IF NOT currentToken THEN
73:     RETURN null
74:   END IF
75:   
76:   IF this.isTokenExpired(currentToken) THEN
77:     IF currentToken.refresh_token THEN
78:       TRY
79:         SET refreshedToken = AWAIT this.deviceFlow.refreshToken(currentToken.refresh_token)
80:         AWAIT this.tokenStore.saveToken('anthropic', refreshedToken)
81:         RETURN refreshedToken
82:       CATCH error
83:         LOG "Failed to refresh Anthropic token: " + error
84:         AWAIT this.tokenStore.removeToken('anthropic')
85:         RETURN null
86:       END TRY
87:     ELSE
88:       AWAIT this.tokenStore.removeToken('anthropic')
89:       RETURN null
90:     END IF
91:   END IF
92:   
93:   RETURN currentToken
94:
95: METHOD async logout(): Promise<void>
96:   // Try to revoke token with provider (may not be supported yet)
97:   SET token = AWAIT this.tokenStore.getToken('anthropic')
98:   IF token THEN
99:     TRY
100:       AWAIT this.deviceFlow.revokeToken(token.access_token)
101:     CATCH error
102:       LOG "Token revocation not supported or failed: " + error
103:     END TRY
104:   END IF
105:   
106:   AWAIT this.tokenStore.removeToken('anthropic')
107:   PRINT "Successfully logged out from Anthropic"
108:
109: METHOD cancelAuth(): void
110:   SET this.authCancelled = true
111:
112: END CLASS
```