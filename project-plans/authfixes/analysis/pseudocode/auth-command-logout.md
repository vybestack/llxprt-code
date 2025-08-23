# Pseudocode: AuthCommand Logout Functionality

## @requirement REQ-002.3, REQ-004.4

```
1: CLASS AuthCommand
2:   // Existing properties and methods...
3:
4: METHOD execute(args: string[]): MessageActionReturn
5:   // Existing parsing logic...
6:   SET provider = args[0]
7:   SET action = args[1]
8:   
9:   // Handle enable/disable actions (existing)
10:   IF action === 'enable' OR action === 'disable' THEN
11:     RETURN this.setProviderOAuth(provider, action === 'enable')
12:   END IF
13:   
14:   // Handle logout action (NEW)
15:   IF action === 'logout' OR action === 'signout' THEN
16:     RETURN this.logoutProvider(provider)
17:   END IF
18:   
19:   // Invalid action
20:   RETURN {
21:     type: 'message',
22:     messageType: 'error',
23:     content: 'Invalid action: ' + action + '. Use enable, disable, or logout'
24:   }
25:
26: METHOD async logoutProvider(provider: string): Promise<MessageActionReturn>
27:   TRY
28:     // Check if provider is supported
29:     SET supportedProviders = this.oauthManager.getSupportedProviders()
30:     IF NOT supportedProviders.includes(provider) THEN
31:       RETURN {
32:         type: 'message',
33:         messageType: 'error',
34:         content: 'Unknown provider: ' + provider + '. Supported: ' + supportedProviders.join(', ')
35:       }
36:     END IF
37:     
38:     // Check if user is authenticated
39:     SET isAuthenticated = AWAIT this.oauthManager.isAuthenticated(provider)
40:     IF NOT isAuthenticated THEN
41:       RETURN {
42:         type: 'message',
43:         messageType: 'info',
44:         content: 'You are not logged in to ' + provider
45:       }
46:     END IF
47:     
48:     // Perform logout
49:     AWAIT this.oauthManager.logout(provider)
50:     
51:     RETURN {
52:       type: 'message',
53:       messageType: 'info',
54:       content: 'Successfully logged out of ' + provider
55:     }
56:   CATCH error
57:     SET errorMessage = error.message OR String(error)
58:     RETURN {
59:       type: 'message',
60:       messageType: 'error',
61:       content: 'Failed to logout from ' + provider + ': ' + errorMessage
62:     }
63:   END TRY
64:
65: METHOD async showProviderStatus(provider: string): Promise<MessageActionReturn>
66:   // Update existing method to show token expiry
67:   SET isOAuthEnabled = this.oauthManager.isOAuthEnabled(provider)
68:   SET isAuthenticated = AWAIT this.oauthManager.isAuthenticated(provider)
69:   
70:   IF isAuthenticated THEN
71:     SET token = AWAIT this.oauthManager.getOAuthToken(provider)
72:     IF token THEN
73:       SET expiryDate = new Date(token.expiry * 1000)
74:       SET timeUntilExpiry = Math.max(0, token.expiry - Date.now() / 1000)
75:       SET hours = Math.floor(timeUntilExpiry / 3600)
76:       SET minutes = Math.floor((timeUntilExpiry % 3600) / 60)
77:       
78:       RETURN {
79:         type: 'message',
80:         messageType: 'info',
81:         content: provider + ' OAuth: Enabled and authenticated\n' +
82:                 'Token expires: ' + expiryDate.toISOString() + '\n' +
83:                 'Time remaining: ' + hours + 'h ' + minutes + 'm\n' +
84:                 'Use /auth ' + provider + ' logout to sign out'
85:       }
86:     END IF
87:   END IF
88:   
89:   // Rest of existing status logic...
90:   RETURN existing status message
91:
92: END CLASS
```