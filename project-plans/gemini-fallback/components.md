# Components and Modifications for Gemini OAuth Fallback

## Core Components Overview

### 1. GeminiProvider (packages/core/src/providers/gemini/GeminiProvider.ts)
The main provider class that handles authentication and API calls for Gemini models.

**Current OAuth behavior:**
- Calls `getAuthToken()` which returns 'USE_LOGIN_WITH_GOOGLE' when no API key is available
- Relies on `createCodeAssistContentGenerator()` from `@vybestack/llxprt-code-core` to handle the OAuth flow
- When browser fails to open, the OAuth URL with verification instructions is printed to console

**Required modifications:**
- Integrate with OAuthCodeDialog flow when browser fails or is suppressed
- Handle clipboard copying of OAuth URL
- Implement code verification submission mechanism
- Set global state variables to trigger dialog in CLI UI

### 2. App.tsx (packages/cli/src/ui/App.tsx)
The main UI application component that handles user interactions and component rendering.

**Current behavior:**
- Checks for `__oauth_needs_code` global state variable
- Displays OAuthCodeDialog when needed for Anthropic/Qwen providers
- Handles onSubmit and onClose dialog events for existing providers

**Required modifications:**
- Ensure proper detection and handling of Gemini provider OAuth flow
- Update dialog invocation to work with Gemini provider

### 3. OAuthCodeDialog (packages/cli/src/ui/components/OAuthCodeDialog.tsx)
Reusable dialog component for entering OAuth verification codes.

**Current behavior:**
- Handles provider-specific OAuth code entry for Anthropic/Qwen
- Paste-only input field for security
- Provider name is passed as prop for display

**Required modifications:**
- Add provider-specific messaging for Gemini OAuth flow
- Ensure dialog instructions guide users through Google OAuth process

## Detailed Component Modifications

### 1. BaseProvider OAuth Integration Points
```typescript
// In packages/core/src/providers/BaseProvider.ts
// Existing pattern:
protected async getAuthToken(): Promise<string> {
  // Uses AuthPrecedenceResolver to determine authentication method
  // Returns 'USE_LOGIN_WITH_GOOGLE' when Gemini needs OAuth authentication
}

// This is already working correctly and doesn't need modification
```

### 2. GeminiProvider Changes
```typescript
// In packages/core/src/providers/gemini/GeminiProvider.ts
// Within generateChatCompletion method when authMode === 'oauth':

case 'oauth': {
  // Use createCodeAssistContentGenerator but modify how it handles OAuth
  const contentGenerator = await createCodeAssistContentGenerator(
    httpOptions,
    AuthType.LOGIN_WITH_GOOGLE,
    configForOAuth as Config,
    this.baseURL,
  );
  
  // Modify OAuth initiation to work with our dialog system
  // This will require changes to how the OAuth URL is handled
  // when browser opening is not possible
  
  // Continue with existing request processing...
}
```

### 3. App.tsx Integration
```typescript
// In packages/cli/src/ui/App.tsx render method:
// Existing code that handles OAuth dialog display:

{(() => {
  // Detect if any provider needs OAuth code input
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

// This should already work for Gemini provider as it uses the same
// global state pattern. If not, minimal changes would be required.
```

### 4. OAuthCodeDialog Enhancement

#### Current Implementation
```typescript
// In packages/cli/src/ui/components/OAuthCodeDialog.tsx:

export const OAuthCodeDialog: React.FC<OAuthCodeDialogProps> = ({
  provider,
  onClose,
  onSubmit,
}) => {
  const [code, setCode] = useState('');

  const handleInput = useCallback(
    (key: Key) => {
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

      // Handle clear
      if ((key.ctrl && key.name === 'l') || (key.meta && key.name === 'k')) {
        setCode('');
        return;
      }

      // ONLY accept pasted input - ignore ALL typed characters
      if (key.paste && key.sequence) {
        const cleanInput = key.sequence.replace(/[^a-zA-Z0-9\-_#]/g, '');
        if (cleanInput) {
          setCode(cleanInput);
        }
        return;
      }
    },
    [code, onClose, onSubmit],
  );

  useKeypress(handleInput, { isActive: true });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={Colors.AccentCyan}>
      <Text bold color={Colors.AccentCyan}>
        {provider.charAt(0).toUpperCase() + provider.slice(1)} OAuth Authentication
      </Text>
      <Text color={Colors.Foreground}>
        Please check your browser and authorize the application.
      </Text>
      <Text color={Colors.Foreground}>
        After authorizing, paste the authorization code below:
      </Text>
      {/* ... rest of component ... */}
    </Box>
  );
};
```

#### Required Enhancement
```typescript
// Provider-specific instructions:
const getInstructions = () => {
  switch(provider) {
    case 'gemini':
      return [
        "The OAuth URL has been copied to your clipboard.",
        "Please paste it into your browser to authenticate with Google.",
        "After authenticating, paste the verification code you receive below:"
      ];
    case 'anthropic':
    case 'qwen':
    default:
      return [
        "Please check your browser and authorize the application.",
        "After authorizing, paste the authorization code below:"
      ];
  }
};

// Updated component rendering:
return (
  <Box flexDirection="column" borderStyle="round" borderColor={Colors.AccentCyan}>
    <Text bold color={Colors.AccentCyan}>
      {provider.charAt(0).toUpperCase() + provider.slice(1)} OAuth Authentication
    </Text>
    {getInstructions().map((instruction, index) => (
      <Text key={index} color={Colors.Foreground}>
        {instruction}
      </Text>
    ))}
    {/* ... rest of component ... */}
  </Box>
);
```

## Integration Points Summary

1. **OAuth URL Generation and Clipboard Copying**:
   - Needs to be implemented in the core OAuth flow in `llxprt-code-core` package
   - Or intercepted in `GeminiProvider` after URL generation but before console printing

2. **Global State Management**:
   - Already implemented pattern in both core and CLI packages
   - Gemini provider needs to utilize the same pattern as Anthropic/Qwen providers

3. **UI Dialog Display**:
   - Existing implementation should work with minimal or no changes
   - May require provider-specific messaging updates in `OAuthCodeDialog`

4. **Code Submission and Flow Completion**:
   - Shared callback mechanism in App.tsx for onSubmit/onClose
   - Core OAuth implementation should handle verification code exchange transparently