# Pseudocode: OAuthManager Logout Functionality

## @requirement REQ-002, REQ-004

```
1: CLASS OAuthManager
2:   // Existing properties and methods...
3:
4: METHOD async logout(providerName: string): Promise<void>
5:   VALIDATE providerName is non-empty string
6:   IF NOT providerName OR typeof providerName !== 'string' THEN
7:     THROW Error('Provider name must be a non-empty string')
8:   END IF
9:   
10:   SET provider = this.providers.get(providerName)
11:   IF NOT provider THEN
12:     THROW Error('Unknown provider: ' + providerName)
13:   END IF
14:   
15:   // Call provider's logout method if it exists
16:   IF provider HAS METHOD logout THEN
17:     TRY
18:       AWAIT provider.logout()
19:     CATCH error
20:       LOG "Provider logout failed: " + error
21:       // Continue with local cleanup even if provider logout fails
22:     END TRY
23:   ELSE
24:     // Fallback to just removing token from storage
25:     AWAIT this.tokenStore.removeToken(providerName)
26:   END IF
27:   
28:   // Update settings to disable OAuth for this provider
29:   SET settingsService = getSettingsService()
30:   AWAIT settingsService.updateSetting('auth.' + providerName + '.oauth.enabled', false)
31:   
32:   // Special handling for Gemini - clear auth mode cache
33:   IF providerName === 'gemini' THEN
34:     // Reset any cached auth mode in the provider
35:     // This may require exposing a method on GeminiProvider
36:     LOG "Gemini auth mode cache cleared"
37:   END IF
38:
39: METHOD async logoutAll(): Promise<void>
40:   SET providers = AWAIT this.tokenStore.listProviders()
41:   
42:   FOR EACH provider IN providers DO
43:     TRY
44:       AWAIT this.logout(provider)
45:     CATCH error
46:       LOG "Failed to logout from " + provider + ": " + error
47:       // Continue with other providers even if one fails
48:     END TRY
49:   END FOR
50:
51: METHOD async isAuthenticated(providerName: string): Promise<boolean>
52:   VALIDATE providerName
53:   IF NOT providerName OR typeof providerName !== 'string' THEN
54:     RETURN false
55:   END IF
56:   
57:   SET token = AWAIT this.tokenStore.getToken(providerName)
58:   IF NOT token THEN
59:     RETURN false
60:   END IF
61:   
62:   // Check if token is expired
63:   SET now = Date.now() / 1000
64:   IF token.expiry <= now THEN
65:     RETURN false
66:   END IF
67:   
68:   RETURN true
69:
70: METHOD registerProviders(): void
71:   // Update existing method to pass TokenStore to providers
72:   SET this.providers = new Map()
73:   
74:   // Pass tokenStore to each provider constructor
75:   this.providers.set('qwen', new QwenOAuthProvider(this.tokenStore))
76:   this.providers.set('anthropic', new AnthropicOAuthProvider(this.tokenStore))
77:   this.providers.set('gemini', new GeminiOAuthProvider(this.tokenStore))
78:   
79:   LOG "Registered OAuth providers with token persistence"
80:
81: END CLASS
```