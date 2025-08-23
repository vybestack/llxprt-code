# Sequence Diagrams for Gemini OAuth Fallback Implementation

## 1. Normal Authentication Flow (Without Fallback)

```mermaid
sequenceDiagram
    participant U as User
    participant A as App.tsx
    participant G as GeminiProvider
    participant C as llxprt-code-core
    participant B as Browser

    U->>A: Execute command requiring Gemini auth
    A->>G: generateChatCompletion()
    G->>C: getAuthToken()
    C->>G: Returns API key
    G->>C: createCodeAssistContentGenerator()
    C->>B: Automatically opens browser
    B->>U: Google OAuth page
    U->>B: Authenticates with Google
    B->>C: OAuth completion
    C->>G: Returns authenticated client
    G->>A: Returns response stream
    A->>U: Displays response
```

## 2. Current OAuth Fallback Flow

```mermaid
sequenceDiagram
    participant U as User
    participant A as App.tsx
    participant G as GeminiProvider
    participant C as llxprt-code-core
    participant T as Terminal

    U->>A: Execute command requiring Gemini auth
    A->>G: generateChatCompletion()
    G->>C: getAuthToken()
    C->>G: Returns 'USE_LOGIN_WITH_GOOGLE'
    G->>C: createCodeAssistContentGenerator()
    C->>T: Prints OAuth URL to console
    Note over T: URL wraps and shows decoration chars
    T->>U: Displays wrapped URL
    Note over U: Difficult/impossible to copy
    U->>U: Cannot authenticate
```

## 3. Enhanced OAuth Fallback Flow (Proposed)

```mermaid
sequenceDiagram
    participant U as User
    participant A as App.tsx
    participant G as GeminiProvider
    participant C as llxprt-code-core
    participant CL as Clipboard
    participant D as OAuthCodeDialog

    U->>A: Execute command requiring Gemini auth
    A->>G: generateChatCompletion()
    G->>C: getAuthToken()
    C->>G: Returns 'USE_LOGIN_WITH_GOOGLE'
    G->>C: createCodeAssistContentGenerator()
    C->>CL: Copies clean OAuth URL to clipboard
    C->>G: Browser opening fails/NO_BROWSER set
    G->>A: Sets __oauth_needs_code=true<br/>__oauth_provider='gemini'
    A->>D: Displays OAuthCodeDialog
    D->>U: Shows instructions for browser paste
    U->>U: Pastes URL in browser manually
    U->>D: Pastes verification code in dialog
    D->>G: Submits verification code
    G->>C: Exchanges code for tokens
    C->>G: Returns authenticated client
    G->>A: Returns response stream
    A->>U: Displays response
```

## 4. Clipboard Copy Failure Flow

```mermaid
sequenceDiagram
    participant U as User
    participant A as App.tsx
    participant G as GeminiProvider
    participant C as llxprt-code-core
    participant CL as Clipboard
    participant T as Terminal
    participant D as OAuthCodeDialog

    U->>A: Execute command requiring Gemini auth
    A->>G: generateChatCompletion()
    G->>C: getAuthToken()
    C->>G: Returns 'USE_LOGIN_WITH_GOOGLE'
    G->>C: createCodeAssistContentGenerator()
    C->>CL: Attempts to copy OAuth URL
    CL->>C: Copy fails
    C->>T: Prints clean OAuth URL to console
    T->>U: Displays clean URL (no wrapping)
    G->>A: Sets __oauth_needs_code=true<br/>__oauth_provider='gemini'
    A->>D: Displays OAuthCodeDialog
    D->>U: Shows fallback instructions
    U->>U: Pastes URL in browser manually
    U->>D: Pastes verification code in dialog
    D->>G: Submits verification code
    G->>C: Exchanges code for tokens
    C->>G: Returns authenticated client
    G->>A: Returns response stream
    A->>U: Displays response
```

## 5. Dialog Cancellation Flow

```mermaid
sequenceDiagram
    participant U as User
    participant D as OAuthCodeDialog
    participant A as App.tsx
    participant G as GeminiProvider

    Note over A,G: OAuth flow initiated
    A->>D: Displays OAuthCodeDialog
    U->>D: Presses Escape key
    D->>G: cancelAuth() or equivalent
    G->>A: Cancellation exception
    A->>U: Displays cancellation message
```

## 6. Invalid Verification Code Flow

```mermaid
sequenceDiagram
    participant U as User
    participant D as OAuthCodeDialog
    participant A as App.tsx
    participant G as GeminiProvider
    participant C as llxprt-code-core

    Note over A,G: OAuth flow initiated
    A->>D: Displays OAuthCodeDialog
    U->>D: Pastes invalid code
    D->>G: submitAuthCode()
    G->>C: Attempts to exchange code
    C->>G: Returns error
    G->>A: Throws exception
    A->>U: Displays error message<br/>Dialog remains open for retry
```