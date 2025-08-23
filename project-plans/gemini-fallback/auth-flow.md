# Gemini OAuth Flow Implementation Details

## Overview of Current Authentication Flow

```
[User Request] --> [BaseProvider.getAuthToken()]
                     |
                     ├── If API key available --> [Return API key]
                     |
                     └── If no API key --> [Return 'USE_LOGIN_WITH_GOOGLE']
                                           |
                                           └── [GeminiProvider.generateChatCompletion()]
                                                |
                                                └── [Initiate Google OAuth flow]
                                                     |
                                                     ├── Opens browser automatically (if possible)
                                                     |
                                                     └── Fallback to console URL display (if browser fails)
```

## Current Fallback Behavior

When `process.env.NO_BROWSER` is set or browser opening fails:
1. URL is printed to console wrapped in decoration characters
2. In debug console, URL wraps across lines making it difficult to copy
3. User must manually copy URL and paste in browser
4. User gets verification code from Google's OAuth page
5. User must manually enter code in terminal (which may not be possible in some debug consoles)

## Proposed Enhanced Flow

```
[User Request] --> [BaseProvider.getAuthToken()]
                     |
                     ├── If API key available --> [Return API key]
                     |
                     └── If no API key --> [Return 'USE_LOGIN_WITH_GOOGLE']
                                           |
                                           └── [GeminiProvider.generateChatCompletion()]
                                                |
                                                └── [Initiate Google OAuth flow]
                                                     |
                                                     ├── Try to open browser automatically
                                                     |    |
                                                     |    └── If success --> [Normal OAuth flow]
                                                     |
                                                     └── If browser opening fails/NO_BROWSER set
                                                          |
                                                          ├── Copy clean OAuth URL to clipboard
                                                          |
                                                          ├── Set global state:
                                                          |    ├── __oauth_needs_code = true
                                                          |    └── __oauth_provider = 'gemini'
                                                          |
                                                          └── [CLI UI displays OAuthCodeDialog]
                                                               |
                                                               ├── User pastes URL in browser manually
                                                               |
                                                               ├── User gets verification code from Google
                                                               |
                                                               └── User enters code in OAuthCodeDialog input field
                                                                    |
                                                                    ├── Submit code to complete OAuth flow
                                                                    |
                                                                    └── Close dialog and continue processing
```

## Key Components

### 1. Gemini Provider OAuth Integration
```typescript
// In GeminiProvider
private async initiateOAuthFlow() {
  // Generate OAuth URL using Google OAuth library
  const oauthUrl = await generateAuthUrl();
  
  // Try to open browser
  try {
    await openBrowserSecurely(oauthUrl);
    // Continue with normal OAuth flow
  } catch (error) {
    // Browser opening failed or NO_BROWSER is set
    // Copy URL to clipboard
    await copyToClipboard(oauthUrl);
    
    // Set global state to trigger OAuthCodeDialog in CLI UI
    (global as any).__oauth_needs_code = true;
    (global as any).__oauth_provider = 'gemini';
    
    // Wait for verification code from UI
    const verificationCode = await this.waitForVerificationCode();
    
    // Complete OAuth flow with verification code
    await this.completeOAuthFlow(verificationCode);
  }
}
```

### 2. CLI UI Detection and Dialog Display
```typescript
// In App.tsx render function
{(() => {
  const needsOAuthCode = (global as any).__oauth_needs_code;
  const oauthProvider = (global as any).__oauth_provider || 'anthropic';
  
  if (needsOAuthCode) {
    return (
      <OAuthCodeDialog
        provider={oauthProvider}
        onClose={this.handleOAuthCodeDialogClose}
        onSubmit={this.handleOAuthCodeSubmit}
      />
    );
  }
  return null;
})()}
```

### 3. Enhanced OAuth Code Dialog
```typescript
// In OAuthCodeDialog.tsx
export const OAuthCodeDialog: React.FC<OAuthCodeDialogProps> = ({
  provider,
  onClose,
  onSubmit,
}) => {
  // Provider-specific messaging
  const getInstructions = () => {
    if (provider === 'gemini') {
      return "The OAuth URL has been copied to your clipboard. Please paste it in your browser to authenticate with Google. After authenticating, paste the verification code you receive back here:";
    } else {
      return "Please check your browser and authorize the application. After authorizing, paste the authorization code below:";
    }
  };
  
  // Handle input for verification code
  const handleInput = useCallback((key: Key) => {
    // Handle escape to close
    if (key.name === 'escape') {
      onClose();
      return;
    }
    
    // Handle enter to submit
    if (key.name === 'return') {
      if (code.trim()) {
        onSubmit(code.trim());
        onClose();
      }
      return;
    }
    
    // Handle paste operations (verification code)
    if (key.paste && key.sequence) {
      const cleanInput = key.sequence.replace(/[^a-zA-Z0-9\-_#]/g, '');
      if (cleanInput) {
        setCode(cleanInput);
      }
      return;
    }
  }, [code, onClose, onSubmit]);
};
```

## Detailed Flow Implementation Steps

### Step 1: Gemini Provider OAuth Initiation
1. When `getAuthToken()` returns 'USE_LOGIN_WITH_GOOGLE'
2. In `generateChatCompletion()`, initiate OAuth flow through `@vybestack/llxprt-code-core`
3. If browser launch suppressed or fails, copy URL to clipboard

### Step 2: Global State Management
1. Set `__oauth_needs_code = true` to signal OAuth flow needs user input
2. Set `__oauth_provider = 'gemini'` to identify which provider needs authentication
3. CLI UI will detect these global variables and display appropriate dialog

### Step 3: CLI UI OAuth Code Dialog Display
1. Monitor global state variables in UI render loop
2. When `__oauth_needs_code` is true, display `OAuthCodeDialog`
3. Pass provider name to dialog for provider-specific messaging

### Step 4: User Interaction
1. Dialog informs user OAuth URL was copied to clipboard
2. User manually pastes URL in browser to authenticate
3. User receives verification code on Google's OAuth page
4. User pastes verification code into dialog input field

### Step 5: Code Submission and Flow Completion
1. Dialog onSubmit handler passes code back to provider
2. Provider exchanges verification code for OAuth tokens
3. Global state variables reset (`__oauth_needs_code = false`)
4. Dialog closes and normal processing continues