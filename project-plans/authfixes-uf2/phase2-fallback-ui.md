# Phase 2: Fix Fallback Flow UI

## Problem
The fallback OAuth flow (when browser can't open) is incomplete:
1. Shows URL in console.log (wrong place)
2. No input mechanism for verification code
3. Function returns without completing auth

## Solution

### 1. Complete authWithUserCode Implementation
**File**: `packages/core/src/code_assist/oauth2.ts`

**Current** (lines ~520-530):
```typescript
async function authWithUserCode(client: OAuth2Client): Promise<boolean> {
  // ... generates URL ...
  console.log(
    'Please paste it into your browser to authenticate.\n' +
    'After authenticating, paste the verification code you receive below:\n\n',
  );
  // FUNCTION ENDS - NO INPUT MECHANISM!
}
```

**Fixed**:
```typescript
async function authWithUserCode(client: OAuth2Client): Promise<boolean> {
  // ... generate URL and copy to clipboard ...
  
  // Import prompt utilities
  const { prompt } = await import('../../prompt/index.js');
  
  // Show URL in a dialog/prompt, not console
  const authCode = await prompt({
    type: 'input',
    name: 'code',
    message: 'Authentication Required',
    hint: `URL copied to clipboard: ${authUrl}\n\nOpen this URL in your browser, authenticate, and paste the verification code here:`,
  });
  
  if (!authCode || !authCode.trim()) {
    console.error('No verification code provided');
    return false;
  }
  
  try {
    // Exchange the code for tokens
    const { tokens } = await client.getToken({
      code: authCode.trim(),
      redirect_uri: redirectUri,
      codeVerifier: codeVerifier.verifier,
    });
    
    client.setCredentials(tokens);
    
    // Cache the credentials
    await cacheCredentials(tokens);
    
    // Fetch and cache user info
    await fetchAndCacheUserInfo(client);
    
    return true;
  } catch (error) {
    console.error('Failed to exchange verification code:', error);
    return false;
  }
}
```

### 2. Create Prompt Utility (if not exists)
**File**: `packages/core/src/prompt/index.ts`

```typescript
import * as readline from 'readline';

export interface PromptOptions {
  type: 'input' | 'confirm';
  name: string;
  message: string;
  hint?: string;
}

export async function prompt(options: PromptOptions): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    const question = options.hint 
      ? `${options.message}\n${options.hint}\n> `
      : `${options.message}\n> `;
      
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
```

## Alternative: Use Existing CLI Prompt
If the CLI already has a prompt/dialog system, use that instead of creating a new one.

## Testing
1. Set `LLXPRT_NO_BROWSER=1` to force fallback
2. Verify URL is displayed clearly
3. Verify clipboard contains URL
4. Verify can paste code and complete auth
5. Test cancellation (empty input)