# Pseudocode: GeminiOAuthProvider

## @requirement REQ-001, REQ-003

```
1: CLASS GeminiOAuthProvider implements OAuthProvider
2:   PRIVATE tokenStore: TokenStore
3:   PRIVATE oauth2Client: OAuth2Client
4:   PRIVATE name: string = 'gemini'
5:
6: METHOD constructor(tokenStore: TokenStore)
7:   SET this.tokenStore = tokenStore
8:   
9:   // Initialize Google OAuth2 client
10:   SET clientId = process.env.GOOGLE_CLIENT_ID OR 'default-client-id'
11:   SET clientSecret = process.env.GOOGLE_CLIENT_SECRET OR undefined
12:   SET redirectUri = 'urn:ietf:wg:oauth:2.0:oob' // For device flow
13:   
14:   SET this.oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri)
15:   CALL this.initializeToken()
16:
17: METHOD async initializeToken()
18:   IF NOT this.tokenStore THEN
19:     RETURN
20:   END IF
21:   
22:   TRY
23:     SET savedToken = AWAIT this.tokenStore.getToken('gemini')
24:     IF savedToken AND NOT this.isTokenExpired(savedToken) THEN
25:       // Set credentials in Google OAuth client
26:       this.oauth2Client.setCredentials({
27:         access_token: savedToken.access_token,
28:         refresh_token: savedToken.refresh_token,
29:         expiry_date: savedToken.expiry * 1000 // Convert to milliseconds
30:       })
31:     END IF
32:   CATCH error
33:     LOG "Failed to load Gemini token: " + error
34:   END TRY
35:
36: METHOD isTokenExpired(token: OAuthToken): boolean
37:   SET now = Date.now() / 1000
38:   SET buffer = 30 // 30-second buffer
39:   RETURN token.expiry <= (now + buffer)
40:
41: METHOD async initiateAuth(): Promise<void>
42:   // Generate auth URL with appropriate scopes
43:   SET scopes = [
44:     'https://www.googleapis.com/auth/generative-language.retriever',
45:     'https://www.googleapis.com/auth/cloud-platform'
46:   ]
47:   
48:   SET authUrl = this.oauth2Client.generateAuthUrl({
49:     access_type: 'offline', // Get refresh token
50:     scope: scopes
51:   })
52:   
53:   PRINT "Google OAuth Authentication for Gemini"
54:   PRINT "─" * 40
55:   PRINT "Visit this URL to authorize:"
56:   PRINT authUrl
57:   PRINT "─" * 40
58:   
59:   IF shouldLaunchBrowser() THEN
60:     TRY
61:       AWAIT openBrowserSecurely(authUrl)
62:     CATCH error
63:       PRINT "Failed to open browser automatically"
64:     END TRY
65:   END IF
66:   
67:   // Prompt for authorization code
68:   PRINT "Enter the authorization code:"
69:   SET code = AWAIT this.promptForCode()
70:   
71:   // Exchange code for tokens
72:   SET response = AWAIT this.oauth2Client.getToken(code)
73:   SET tokens = response.tokens
74:   
75:   // Set credentials in client
76:   this.oauth2Client.setCredentials(tokens)
77:   
78:   // Save to token store
79:   SET oauthToken = {
80:     access_token: tokens.access_token,
81:     refresh_token: tokens.refresh_token OR undefined,
82:     expiry: Math.floor((tokens.expiry_date OR Date.now() + 3600000) / 1000),
83:     token_type: 'Bearer',
84:     scope: tokens.scope OR undefined
85:   }
86:   
87:   IF this.tokenStore THEN
88:     AWAIT this.tokenStore.saveToken('gemini', oauthToken)
89:   END IF
90:   
91:   PRINT "Authentication successful!"
92:
93: METHOD async promptForCode(): Promise<string>
94:   SET readline = createInterface(process.stdin, process.stdout)
95:   SET code = AWAIT readline.question('Authorization code: ')
96:   CLOSE readline
97:   RETURN code
98:
99: METHOD async getToken(): Promise<OAuthToken | null>
100:   IF this.tokenStore THEN
101:     RETURN AWAIT this.tokenStore.getToken('gemini')
102:   END IF
103:   
104:   SET credentials = this.oauth2Client.credentials
105:   IF NOT credentials OR NOT credentials.access_token THEN
106:     RETURN null
107:   END IF
108:   
109:   RETURN {
110:     access_token: credentials.access_token,
111:     refresh_token: credentials.refresh_token OR undefined,
112:     expiry: Math.floor((credentials.expiry_date OR Date.now() + 3600000) / 1000),
113:     token_type: 'Bearer',
114:     scope: credentials.scope OR undefined
115:   }
116:
117: METHOD async refreshIfNeeded(): Promise<OAuthToken | null>
118:   SET currentToken = AWAIT this.getToken()
119:   
120:   IF NOT currentToken THEN
121:     RETURN null
122:   END IF
123:   
124:   IF this.isTokenExpired(currentToken) THEN
125:     IF currentToken.refresh_token THEN
126:       TRY
127:         // Use Google OAuth client to refresh
128:         SET response = AWAIT this.oauth2Client.refreshAccessToken()
129:         SET credentials = response.credentials
130:         
131:         SET refreshedToken = {
132:           access_token: credentials.access_token,
133:           refresh_token: credentials.refresh_token OR currentToken.refresh_token,
134:           expiry: Math.floor((credentials.expiry_date OR Date.now() + 3600000) / 1000),
135:           token_type: 'Bearer',
136:           scope: credentials.scope OR currentToken.scope
137:         }
138:         
139:         IF this.tokenStore THEN
140:           AWAIT this.tokenStore.saveToken('gemini', refreshedToken)
141:         END IF
142:         
143:         RETURN refreshedToken
144:       CATCH error
145:         LOG "Failed to refresh Gemini token: " + error
146:         IF this.tokenStore THEN
147:           AWAIT this.tokenStore.removeToken('gemini')
148:         END IF
149:         RETURN null
150:       END TRY
151:     ELSE
152:       // No refresh token available
153:       IF this.tokenStore THEN
154:         AWAIT this.tokenStore.removeToken('gemini')
155:       END IF
156:       RETURN null
157:     END IF
158:   END IF
159:   
160:   RETURN currentToken
161:
162: METHOD async logout(): Promise<void>
163:   // Clear credentials from Google OAuth client
164:   this.oauth2Client.setCredentials({})
165:   
166:   // Remove from storage
167:   IF this.tokenStore THEN
168:     AWAIT this.tokenStore.removeToken('gemini')
169:   END IF
170:   
171:   PRINT "Successfully logged out from Gemini"
172:
173: END CLASS
```