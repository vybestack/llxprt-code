# PLAN-20251213issue490: OAuth Buckets for Standard Profiles

## 1. Overview

### Feature Summary
Enable multiple OAuth logins per provider with named buckets, allowing users to switch between different OAuth accounts and assign profiles to specific buckets. This addresses issue #490 which is part of the Phase 4 OAuth enhancements (parent issue #485).

### Key Features
- Multiple OAuth logins per provider (e.g., `anthropic:work@company.com`, `anthropic:personal@gmail.com`)
- Named buckets scoped to each provider
- Model profiles with multiple buckets for simple sequential failover
- Runtime bucket switching for active profile session
- Enhanced `/auth status` to show all buckets with expiry info
- New `/stats buckets` subcommand
- Enhanced `/diagnostics` with per-bucket information
- Bucket-aware multi-authentication flows with user-controlled timing

### Storage Structure (Flat - Zero Migration)
```
~/.llxprt/oauth/
  anthropic.json                    # Default bucket (existing file, unchanged)
  anthropic-work@company.com.json   # Named bucket
  anthropic-personal@gmail.com.json # Named bucket
  gemini.json                       # Default bucket
  gemini-work@example.com.json      # Named bucket
  qwen.json                         # Default bucket
```

### Files Affected

**Core Package (packages/core):**
- `packages/core/src/types/modelParams.ts` - Add `AuthConfig` interface to Profile
- `packages/core/src/auth/token-store.ts` - Extend `TokenStore` interface and `MultiProviderTokenStore` for buckets
- `packages/core/src/auth/types.ts` - Add bucket-related types

**CLI Package (packages/cli):**
- `packages/cli/src/auth/oauth-manager.ts` - Add bucket parameter to all token methods
- `packages/cli/src/auth/anthropic-oauth-provider.ts` - Support bucket parameter and multi-bucket auth flow
- `packages/cli/src/auth/qwen-oauth-provider.ts` - Support bucket parameter and multi-bucket auth flow
- `packages/cli/src/auth/gemini-oauth-provider.ts` - Support bucket parameter and multi-bucket auth flow
- `packages/cli/src/ui/commands/authCommand.ts` - Add login/logout bucket, status all buckets, switch
- `packages/cli/src/ui/commands/profileCommand.ts` - Support positional bucket arguments
- `packages/cli/src/ui/commands/statsCommand.ts` - Add `buckets` subcommand
- `packages/cli/src/ui/commands/diagnosticsCommand.ts` - Expand OAuth section for buckets
- `packages/cli/src/runtime/profileApplication.ts` - Resolve profile buckets and handle failover

### Dependencies Between Phases
```
Phase 1 (Types) <- Phase 2 (TokenStore) <- Phase 3 (OAuthManager) <- Phase 4 (Providers)
                                                                    <- Phase 5 (authCommand)
                                                                    <- Phase 6 (profileCommand)
Phase 5 + Phase 6 <- Phase 7 (profileApplication)
Phase 3 <- Phase 8 (stats/diagnostics)
Phase 4 <- Phase 9 (Non-Interactive Auth)
All Phases <- Phase 10 (Integration Testing)
```

---

## 2. Implementation Phases

### Phase 1: Core Types and Interfaces

#### Purpose
Define the `AuthConfig` interface and extend the `Profile` type to support multiple buckets specification.

#### Files to Modify/Create
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/core/src/types/modelParams.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/core/src/auth/types.ts`

#### Test Specification
Write tests FIRST in `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/core/src/types/__tests__/modelParams.bucket.spec.ts`:

1. **Test AuthConfig type structure validation**
   - `it('should accept valid AuthConfig with oauth type and single bucket')` - Verify `{type: 'oauth', buckets: ['work@company.com']}` passes Zod validation
   - `it('should accept AuthConfig with oauth type and multiple buckets')` - Verify `{type: 'oauth', buckets: ['bucket1', 'bucket2']}` passes validation
   - `it('should accept AuthConfig with apikey type')` - Verify `{type: 'apikey'}` passes validation
   - `it('should accept AuthConfig with oauth type and no buckets (defaults to default)')` - Verify `{type: 'oauth'}` passes validation
   - `it('should reject invalid auth type')` - Verify `{type: 'invalid'}` fails Zod validation
   - `it('should reject oauth and apikey types together')` - Verify profiles cannot have both

2. **Test Profile with auth field**
   - `it('should accept StandardProfile with optional auth field')` - Verify profile with auth config passes
   - `it('should accept StandardProfile without auth field for backward compatibility')` - Verify existing profiles still work
   - `it('should reject Profile with malformed auth field')` - Verify bad auth config fails

#### Implementation Specification
1. Add `AuthConfig` interface:
   ```typescript
   export interface AuthConfig {
     type: 'oauth' | 'apikey';
     buckets?: string[];  // OAuth bucket names, defaults to ['default']
   }
   ```

2. Add `AuthConfigSchema` Zod schema in `types.ts`

3. Extend `StandardProfile` interface with optional `auth?: AuthConfig`

4. Add type guard `hasAuthConfig(profile: Profile): boolean`

#### Verification Criteria
- [ ] All new tests pass
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Existing profile tests still pass (backward compatibility)
- [ ] No `any` types used
- [ ] No type assertions used

---

### Phase 2: TokenStore Bucket Support

#### Purpose
Extend `TokenStore` interface and `MultiProviderTokenStore` to support bucket-scoped token storage.

#### Files to Modify/Create
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/core/src/auth/token-store.ts`

#### Test Specification
Write tests FIRST in `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/core/src/auth/token-store.bucket.spec.ts`:

1. **Token CRUD with buckets**
   - `it('should save token to named bucket with correct filename pattern')` - `saveToken('anthropic', token, 'work@company.com')` creates `anthropic-work@company.com.json`
   - `it('should retrieve token from named bucket')` - `getToken('anthropic', 'work@company.com')` returns correct token
   - `it('should use default bucket when bucket is undefined')` - `saveToken('anthropic', token)` creates `anthropic.json`
   - `it('should use default bucket when bucket is "default"')` - `saveToken('anthropic', token, 'default')` creates `anthropic.json`
   - `it('should remove token from specific bucket')` - `removeToken('anthropic', 'work@company.com')` removes correct file

2. **Bucket listing**
   - `it('should list all buckets for a provider')` - `listBuckets('anthropic')` returns `['default', 'work@company.com', 'personal@gmail.com']`
   - `it('should return empty array when no buckets exist')` - `listBuckets('nonexistent')` returns `[]`
   - `it('should not include other providers buckets')` - Only anthropic buckets when listing anthropic

3. **Bucket isolation**
   - `it('should maintain isolation between buckets')` - Different tokens in different buckets are independent
   - `it('should maintain isolation between providers')` - `anthropic-work@company.com` and `gemini-work@company.com` are separate

4. **Security**
   - `it('should sanitize bucket names for filesystem')` - Handle special characters safely
   - `it('should create bucket files with 0600 permissions')` - Security constraint

#### Implementation Specification
1. Extend `TokenStore` interface:
   ```typescript
   interface TokenStore {
     saveToken(provider: string, token: OAuthToken, bucket?: string): Promise<void>;
     getToken(provider: string, bucket?: string): Promise<OAuthToken | null>;
     removeToken(provider: string, bucket?: string): Promise<void>;
     listProviders(): Promise<string[]>;
     listBuckets(provider: string): Promise<string[]>;  // NEW
   }
   ```

2. Update `MultiProviderTokenStore`:
   ```typescript
   private getTokenPath(provider: string, bucket?: string): string {
     const bucketSuffix = bucket && bucket !== 'default' ? `-${this.sanitizeBucketName(bucket)}` : '';
     return join(this.basePath, `${provider}${bucketSuffix}.json`);
   }

   private sanitizeBucketName(bucket: string): string {
     // Replace filesystem-unsafe characters: : / \ and others
     return bucket.replace(/[/\\<>:"|?*]/g, '_');
   }

   async listBuckets(provider: string): Promise<string[]> {
     const files = await fs.readdir(this.basePath);
     const providerPrefix = `${provider}`;
     return files
       .filter(f => f.startsWith(providerPrefix) && f.endsWith('.json'))
       .map(f => {
         const name = f.slice(0, -5); // Remove .json
         if (name === provider) return 'default';
         return name.slice(provider.length + 1); // Remove "provider-" prefix
       })
       .sort();
   }
   ```

#### Verification Criteria
- [ ] All new tests pass
- [ ] All existing token-store tests still pass (backward compatibility)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] File permissions are 0600 on non-Windows platforms

---

### Phase 3: OAuthManager Bucket Support

#### Purpose
Extend `OAuthManager` to accept bucket parameters in all token-related methods.

#### Files to Modify/Create
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/auth/oauth-manager.ts`

#### Test Specification
Write tests FIRST in `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/auth/oauth-manager.bucket.spec.ts`:

1. **Authentication with bucket**
   - `it('should authenticate to specific bucket')` - `authenticate('anthropic', 'work@company.com')` stores token in bucket
   - `it('should authenticate to default bucket when no bucket specified')` - Backward compatibility
   - `it('should track session bucket override')` - After `setSessionBucket`, use that bucket

2. **Token retrieval with bucket**
   - `it('should get token from specific bucket')` - `getToken('anthropic', 'work@company.com')` returns bucket token
   - `it('should get token from default bucket when no bucket specified')` - Backward compatibility
   - `it('should return null for non-existent bucket')` - Graceful handling

3. **Bucket status**
   - `it('should return auth status for all buckets')` - `getAuthStatusWithBuckets('anthropic')` returns all bucket statuses
   - `it('should include expiry info per bucket')` - Each bucket shows expiry

4. **Session bucket switching**
   - `it('should set session bucket override')` - `setSessionBucket('anthropic', 'work@company.com')` affects subsequent calls
   - `it('should clear session bucket')` - `clearSessionBucket('anthropic')` restores default behavior
   - `it('should not persist session bucket across restarts')` - In-memory only

5. **Logout with bucket**
   - `it('should logout from specific bucket')` - `logout('anthropic', 'work@company.com')` removes only that bucket
   - `it('should logout from all buckets')` - `logoutAllBuckets('anthropic')` removes all
   - `it('should clear session bucket on logout')` - Session state cleared

#### Implementation Specification
1. Add bucket parameter to methods:
   ```typescript
   async authenticate(providerName: string, bucket?: string): Promise<void>
   async getToken(providerName: string, bucket?: string): Promise<string | null>
   async getOAuthToken(providerName: string, bucket?: string): Promise<OAuthToken | null>
   async isAuthenticated(providerName: string, bucket?: string): Promise<boolean>
   async logout(providerName: string, bucket?: string): Promise<void>
   async logoutAllBuckets(providerName: string): Promise<void>
   ```

2. Add session bucket management:
   ```typescript
   private sessionBuckets: Map<string, string> = new Map();

   setSessionBucket(provider: string, bucket: string): void {
     this.sessionBuckets.set(provider, bucket);
   }

   clearSessionBucket(provider: string): void {
     this.sessionBuckets.delete(provider);
   }

   getSessionBucket(provider: string): string | undefined {
     return this.sessionBuckets.get(provider);
   }
   ```

3. Add bucket status method:
   ```typescript
   async getAuthStatusWithBuckets(providerName: string): Promise<BucketAuthStatus[]>
   ```

#### Verification Criteria
- [ ] All new tests pass
- [ ] All existing oauth-manager tests still pass
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Session bucket is properly scoped and cleared

---

### Phase 4: OAuth Providers Bucket Support and Multi-Bucket Auth Flow

#### Purpose
Update all OAuth providers (Anthropic, Gemini, Qwen) to:
1. Pass bucket parameter through to TokenStore
2. Support multi-bucket authentication with user-controlled timing
3. Handle browser-based and device-code flows with multiple accounts

#### Files to Modify/Create
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/auth/anthropic-oauth-provider.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/auth/gemini-oauth-provider.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/auth/qwen-oauth-provider.ts`

#### Test Specification
Write tests FIRST in `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/auth/__tests__/oauth-providers.bucket.spec.ts`:

1. **Single bucket support**
   - `it('should store token in specified bucket after auth')` - Token saved to correct bucket file
   - `it('should retrieve token from specified bucket')` - `getToken('work@company.com')` works
   - `it('should logout from specified bucket only')` - Other buckets unaffected

2. **Multi-bucket authentication flow**
   - `it('should authenticate multiple buckets sequentially with prompts')` - Interactive flow with pauses
   - `it('should respect auth-bucket-delay ephemeral setting')` - Delay between auths
   - `it('should respect auth-bucket-prompt ephemeral setting')` - Show prompts instead of delay
   - `it('should identify bucket name in all auth prompts')` - User knows which account to use

3. **Device code flow with buckets**
   - `it('should display bucket name with device code URLs')` - Clear bucket identification
   - `it('should pause between device code requests for multiple buckets')` - Controlled timing
   - `it('should show clickable/pastable links per bucket')` - Accessibility

4. **Ephemeral settings**
   - `it('should use auth-bucket-delay for delay duration')` - Configurable delay (default 5s)
   - `it('should skip auto-open when auth-browser-open is false')` - Manual URL copy
   - `it('should show confirmation prompt when auth-bucket-prompt is true')` - Interactive confirmation

#### Implementation Specification
1. Add bucket parameter to provider methods:
   ```typescript
   async getToken(bucket?: string): Promise<OAuthToken | null>
   async refreshIfNeeded(bucket?: string): Promise<OAuthToken | null>
   async logout(bucket?: string): Promise<void>
   async authenticateMultipleBuckets(buckets: string[]): Promise<void>  // NEW
   ```

2. Store bucket in provider state during auth flow:
   ```typescript
   private currentBucket?: string;

   async initiateAuth(bucket?: string): Promise<void> {
     this.currentBucket = bucket;
     // ... existing auth flow
   }

   async completeAuth(authCode: string): Promise<void> {
     // ... get token
     await this._tokenStore.saveToken(this.name, token, this.currentBucket);
   }
   ```

3. Multi-bucket authentication with controlled timing:
   ```typescript
   async authenticateMultipleBuckets(buckets: string[]): Promise<void> {
     const delay = getEphemeralSetting('auth-bucket-delay') ?? 5000; // default 5s
     const showPrompt = getEphemeralSetting('auth-bucket-prompt') ?? false;
     const autoOpen = getEphemeralSetting('auth-browser-open') ?? true;

     for (let i = 0; i < buckets.length; i++) {
       const bucket = buckets[i];

       if (i > 0) {
         // Pause before subsequent authentications
         if (showPrompt) {
           await this.showBucketAuthPrompt(bucket);
         } else {
           await this.delayBeforeAuth(delay, bucket);
         }
       }

       console.log(`Authenticating bucket ${i + 1}/${buckets.length}: ${bucket}`);
       await this.initiateAuth(bucket);

       if (autoOpen) {
         await this.openBrowser();
       } else {
         this.displayManualAuthUrl(bucket);
       }

       await this.waitForAuthCompletion();
     }
   }

   private async showBucketAuthPrompt(bucket: string): Promise<void> {
     // Display: "Ready to auth anthropic for work@company.com? Press enter"
     // Wait for user input
   }

   private async delayBeforeAuth(ms: number, bucket: string): Promise<void> {
     console.log(`Switching to ${bucket} in ${ms/1000} seconds...`);
     await new Promise(resolve => setTimeout(resolve, ms));
   }
   ```

4. Device code flow with bucket identification:
   ```typescript
   async initiateAuthDeviceCode(bucket?: string): Promise<void> {
     const deviceCode = await this.getDeviceCode();
     console.log(`\nAuthentication required for bucket: ${bucket ?? 'default'}`);
     console.log(`Provider: ${this.name}`);
     console.log(`\nVisit this URL to authenticate:`);
     console.log(`  ${deviceCode.verificationUri}`);
     console.log(`\nEnter code: ${deviceCode.userCode}`);
     console.log(`\nEnsure you authenticate with the correct account for bucket: ${bucket ?? 'default'}`);
   }
   ```

#### Verification Criteria
- [ ] All new tests pass
- [ ] All existing provider tests still pass
- [ ] Each provider correctly uses bucket parameter
- [ ] Multi-bucket auth flow works with delays and prompts
- [ ] Ephemeral settings control auth behavior correctly
- [ ] Device code flow clearly identifies buckets
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

---

### Phase 5: Auth Command Bucket Support

#### Purpose
Extend `/auth` command to support bucket login, logout, status, and switch operations.

#### Files to Modify/Create
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/ui/commands/authCommand.ts`

#### Test Specification
Write tests FIRST in `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/ui/commands/__tests__/authCommand.bucket.spec.ts`:

1. **Login with bucket**
   - `it('should login to specific bucket')` - `/auth anthropic login work@company.com` triggers OAuth with bucket
   - `it('should prompt for bucket name if not provided')` - `/auth anthropic login` prompts
   - `it('should login to default bucket when bucket is "default"')` - Explicit default

2. **Logout with bucket**
   - `it('should logout from specific bucket')` - `/auth anthropic logout work@company.com` removes bucket
   - `it('should logout from all buckets with --all flag')` - `/auth anthropic logout --all`
   - `it('should show error for non-existent bucket')` - Graceful error

3. **Status with buckets**
   - `it('should show all buckets in status')` - Lists default, work, personal buckets
   - `it('should show expiry for each bucket')` - Expiry dates displayed
   - `it('should indicate active bucket')` - Current session bucket marked

4. **Switch bucket**
   - `it('should switch session bucket')` - `/auth anthropic switch work@company.com`
   - `it('should error on non-existent bucket')` - Cannot switch to missing bucket
   - `it('should not modify profile file')` - Temporary override only
   - `it('should work without profile loaded')` - Session-level override

#### Implementation Specification
1. Extend command parsing:
   ```typescript
   // Format: /auth <provider> <action> [bucket] [--all]
   const parts = trimmedArgs.split(/\s+/);
   const provider = parts[0];
   const action = parts[1]; // login, logout, status, switch
   const bucket = parts[2]; // optional bucket name
   const flags = parts.slice(3); // --all, etc.
   ```

2. Add action handlers:
   ```typescript
   private async loginWithBucket(provider: string, bucket?: string): Promise<MessageActionReturn>
   private async logoutBucket(provider: string, bucket?: string, all?: boolean): Promise<MessageActionReturn>
   private async showBucketStatus(provider: string): Promise<MessageActionReturn>
   private async switchBucket(provider: string, bucket: string): Promise<MessageActionReturn>
   ```

3. Update status display:
   ```
   Authentication Status (anthropic):
     Default Key: [set]
     OAuth Buckets:
       - default (active, expires: 2025-11-07 10:30 AM)
       - work@company.com (expires: 2025-11-08 02:15 PM)
       - personal@gmail.com (expired)
   ```

#### Verification Criteria
- [ ] All new tests pass
- [ ] All existing authCommand tests still pass
- [ ] Command parsing handles all formats correctly
- [ ] Status output is clear and informative
- [ ] Switch command works without profile loaded
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

---

### Phase 6: Profile Command Multi-Bucket Support

#### Purpose
Support positional bucket arguments in `/profile save` command, similar to load balancer syntax.

#### Files to Modify/Create
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/ui/commands/profileCommand.ts`

#### Test Specification
Write tests FIRST in `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/ui/commands/__tests__/profileCommand.bucket.spec.ts`:

1. **Save with single bucket**
   - `it('should save profile with single bucket')` - `/profile save model myprofile bucket1`
   - `it('should save profile with auth.buckets field')` - Type set to oauth with buckets array
   - `it('should validate bucket exists before saving')` - Error if bucket not authenticated

2. **Save with multiple buckets**
   - `it('should save profile with multiple buckets')` - `/profile save model myprofile bucket1 bucket2 bucket3`
   - `it('should save buckets in order for failover sequence')` - Bucket order preserved
   - `it('should validate all buckets exist')` - Error if any bucket missing

3. **Save without buckets (backward compat)**
   - `it('should save profile without auth field when no buckets specified')` - Existing behavior unchanged

4. **Load profile with buckets**
   - `it('should display bucket info when loading profile')` - Info message shows all buckets
   - `it('should show bucket order for failover')` - Order displayed

5. **Autocomplete support**
   - `it('should suggest available buckets for autocomplete')` - Tab completion of bucket names
   - `it('should allow ESC to stop adding buckets')` - Like load balancer profiles

#### Implementation Specification
1. Parse positional bucket arguments:
   ```typescript
   // Format: /profile save model <name> [bucket1] [bucket2] [bucket3] ...
   // Parse all remaining arguments after profile name as buckets
   const commandParts = trimmedArgs.split(/\s+/);
   const profileName = commandParts[2];
   const buckets = commandParts.slice(3); // All remaining args are buckets
   ```

2. Validate and save buckets:
   ```typescript
   if (buckets.length > 0) {
     // Validate all buckets exist
     const providerBuckets = await tokenStore.listBuckets(provider);
     for (const bucket of buckets) {
       if (!providerBuckets.includes(bucket) && bucket !== 'default') {
         return {
           type: 'message',
           messageType: 'error',
           content: `Bucket '${bucket}' not found for provider ${provider}`
         };
       }
     }

     // Validate bucket names are filesystem-safe
     for (const bucket of buckets) {
       const validation = validateBucketName(bucket);
       if (!validation.valid) {
         return { type: 'message', messageType: 'error', content: validation.error };
       }
     }

     profile.auth = {
       type: 'oauth',
       buckets: buckets
     };
   }
   ```

3. Autocomplete support:
   ```typescript
   // In autocomplete handler:
   if (context.tokens.length >= 3 && context.tokens[0] === 'save' && context.tokens[1] === 'model') {
     // Suggest available buckets
     const provider = getCurrentProvider();
     const availableBuckets = await tokenStore.listBuckets(provider);
     return availableBuckets.filter(b => !context.tokens.includes(b));
   }
   ```

#### Verification Criteria
- [ ] All new tests pass
- [ ] All existing profileCommand tests still pass
- [ ] Bucket validation prevents invalid saves
- [ ] Multiple buckets saved in correct order
- [ ] Autocomplete suggests available buckets
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

---

### Phase 7: Profile Application Bucket Resolution and Failover

#### Purpose
Resolve profile buckets when loading and implement simple sequential failover on rate limits and quota errors.

#### Files to Modify/Create
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/runtime/profileApplication.ts`

#### Test Specification
Write tests FIRST in `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/runtime/__tests__/profileApplication.bucket.spec.ts`:

1. **Bucket resolution**
   - `it('should use first bucket token when profile has auth.buckets')` - Loads primary bucket
   - `it('should use default bucket when profile has no auth field')` - Backward compatibility
   - `it('should use session bucket override if set')` - Runtime override takes precedence

2. **Failover triggers**
   - `it('should failover on 429 rate limit error')` - Rate limit triggers next bucket
   - `it('should failover on quota exceeded error')` - Quota triggers next bucket
   - `it('should failover on 402 payment required')` - Payment error triggers next bucket
   - `it('should failover on token renewal failure')` - Auth error triggers next bucket
   - `it('should NOT failover on 400 bad request')` - Non-auth errors do not failover

3. **Failover sequence**
   - `it('should try buckets in order bucket1 -> bucket2 -> bucket3')` - Sequential order
   - `it('should notify user on failover')` - Display which bucket switching to
   - `it('should error when all buckets exhausted')` - Fail with comprehensive error

4. **Multi-bucket authentication on load**
   - `it('should authenticate all expired buckets on profile load')` - Multi-bucket auth flow
   - `it('should use auth-bucket-delay and auth-bucket-prompt settings')` - Ephemeral control
   - `it('should show bucket name in each auth prompt')` - Clear identification

5. **Error handling**
   - `it('should error when bucket not found')` - Clear error message with help
   - `it('should error when all bucket tokens are expired')` - Prompt for re-auth
   - `it('should suggest auth command in error message')` - Actionable error

6. **Non-interactive mode**
   - `it('should fail gracefully in non-interactive mode when bucket missing')` - No auth prompt
   - `it('should use session bucket in non-interactive mode if set')` - Pre-set bucket works

#### Implementation Specification
1. Add bucket resolution function:
   ```typescript
   async function resolveAuthForProfile(
     profile: Profile,
     oauthManager: OAuthManager,
     sessionBucket?: string
   ): Promise<{ buckets: string[]; tokens: Map<string, OAuthToken> } | { error: string }> {
     const buckets = sessionBucket
       ? [sessionBucket]
       : (profile.auth?.buckets ?? ['default']);

     if (profile.auth?.type === 'apikey') {
       return { error: 'Profile uses API key auth, not OAuth' };
     }

     const tokens = new Map<string, OAuthToken>();
     const expiredBuckets: string[] = [];

     for (const bucket of buckets) {
       const token = await oauthManager.getOAuthToken(profile.provider, bucket);

       if (!token) {
         return {
           error: `OAuth bucket '${bucket}' for provider '${profile.provider}' not found. ` +
                  `Use /auth ${profile.provider} login ${bucket}`
         };
       }

       if (token.expiry < Date.now() / 1000) {
         expiredBuckets.push(bucket);
       } else {
         tokens.set(bucket, token);
       }
     }

     // If some buckets expired, trigger multi-bucket re-auth
     if (expiredBuckets.length > 0 && tokens.size === 0) {
       // All expired - need re-auth
       return {
         error: `All OAuth buckets expired. Re-authenticate: ${expiredBuckets.join(', ')}`
       };
     }

     return { buckets, tokens };
   }
   ```

2. Integrate failover logic:
   ```typescript
   async function executeWithFailover(
     request: APIRequest,
     buckets: string[],
     tokens: Map<string, OAuthToken>
   ): Promise<APIResponse> {
     let lastError: Error | null = null;

     for (let i = 0; i < buckets.length; i++) {
       const bucket = buckets[i];
       const token = tokens.get(bucket);

       if (!token) continue; // Skip expired buckets

       try {
         // Use token for this bucket
         const response = await makeRequest(request, token.access_token);
         return response;
       } catch (error) {
         // Check if should failover
         if (shouldFailover(error)) {
           if (i < buckets.length - 1) {
             const nextBucket = buckets[i + 1];
             console.log(`Bucket '${bucket}' quota exceeded, switching to '${nextBucket}'`);
             lastError = error;
             continue; // Try next bucket
           }
         }
         // Non-failover error or last bucket - throw
         throw error;
       }
     }

     // All buckets exhausted
     throw new Error(`All buckets exhausted. Last error: ${lastError?.message}`);
   }

   function shouldFailover(error: Error): boolean {
     // Failover triggers:
     // - 429 rate limit
     // - Quota exceeded
     // - 402 payment required
     // - Token renewal failure
     // - "Would exceed your quota" messages
     const message = error.message.toLowerCase();
     return (
       message.includes('429') ||
       message.includes('rate limit') ||
       message.includes('quota') ||
       message.includes('402') ||
       message.includes('payment') ||
       message.includes('token') && message.includes('expired')
     );
   }
   ```

3. Multi-bucket authentication on load:
   ```typescript
   async function authenticateExpiredBuckets(
     provider: string,
     expiredBuckets: string[],
     oauthManager: OAuthManager
   ): Promise<void> {
     if (expiredBuckets.length === 0) return;

     // Use multi-bucket auth flow with ephemeral settings
     const delay = getEphemeralSetting('auth-bucket-delay') ?? 5000;
     const showPrompt = getEphemeralSetting('auth-bucket-prompt') ?? false;

     for (let i = 0; i < expiredBuckets.length; i++) {
       const bucket = expiredBuckets[i];

       if (i > 0) {
         if (showPrompt) {
           await promptForBucketAuth(provider, bucket);
         } else {
           console.log(`Authenticating next bucket in ${delay/1000}s...`);
           await sleep(delay);
         }
       }

       console.log(`Authenticating bucket ${i + 1}/${expiredBuckets.length}: ${bucket}`);
       await oauthManager.authenticate(provider, bucket);
     }
   }
   ```

#### Verification Criteria
- [ ] All new tests pass
- [ ] All existing profileApplication tests still pass
- [ ] Bucket resolution is correct
- [ ] Failover triggers on correct errors only
- [ ] Sequential failover works in order
- [ ] User notified on failover
- [ ] Multi-bucket auth on load works with timing controls
- [ ] Error messages are actionable
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

---

### Phase 8: Stats and Diagnostics Enhancement

#### Purpose
Add `/stats buckets` subcommand and enhance `/diagnostics` to show all buckets per provider.

#### Files to Modify/Create
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/ui/commands/statsCommand.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/ui/commands/diagnosticsCommand.ts`

#### Test Specification
Write tests FIRST in `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/ui/commands/__tests__/statsCommand.bucket.spec.ts`:

1. **Stats buckets subcommand**
   - `it('should display bucket statistics per provider')` - Shows request count per bucket
   - `it('should show percentage distribution')` - Percentage of requests
   - `it('should show last used timestamp per bucket')` - When bucket was last used
   - `it('should handle empty buckets')` - No buckets gracefully

2. **Diagnostics enhancement**
   - `it('should show all buckets in OAuth section')` - Lists all buckets per provider
   - `it('should show bucket status and expiry')` - Status and time remaining
   - `it('should show current OAuth bucket in provider info')` - Active bucket displayed

#### Implementation Specification
1. Add `buckets` subcommand to statsCommand:
   ```typescript
   {
     name: 'buckets',
     description: 'Show OAuth bucket usage statistics.',
     kind: CommandKind.BUILT_IN,
     action: async (context: CommandContext) => {
       // Get bucket stats from OAuthManager
       const providers = ['anthropic', 'gemini', 'qwen'];
       const stats = [];

       for (const provider of providers) {
         const buckets = await tokenStore.listBuckets(provider);
         if (buckets.length === 0) continue;

         stats.push(`\n${provider}:`);
         for (const bucket of buckets) {
           const requestCount = await getRequestCount(provider, bucket);
           const percentage = await getPercentage(provider, bucket);
           const lastUsed = await getLastUsed(provider, bucket);
           stats.push(`  - ${bucket}:`);
           stats.push(`    - Requests: ${requestCount} (${percentage}%)`);
           stats.push(`    - Last used: ${lastUsed ?? 'Never'}`);
         }
       }

       return { type: 'message', messageType: 'info', content: stats.join('\n') };
     },
   },
   ```

2. Enhance diagnostics OAuth section:
   ```typescript
   // In diagnostics output:
   diagnostics.push('\n## OAuth Tokens');
   diagnostics.push('### Provider Tokens');
   for (const provider of supportedProviders) {
     const buckets = await tokenStore.listBuckets(provider);
     diagnostics.push(`- ${provider}:`);
     diagnostics.push(`  - Buckets: ${buckets.length}`);
     for (const bucket of buckets) {
       const token = await oauthManager.peekStoredToken(provider, bucket);
       const status = token ? (token.expiry > Date.now()/1000 ? 'Authenticated' : 'Expired') : 'None';
       diagnostics.push(`  - ${bucket}:`);
       diagnostics.push(`    - Status: ${status}`);
       if (token) {
         diagnostics.push(`    - Expires: ${new Date(token.expiry * 1000).toISOString()}`);
       }
     }
   }
   ```

#### Verification Criteria
- [ ] All new tests pass
- [ ] All existing stats/diagnostics tests still pass
- [ ] Bucket statistics are accurate
- [ ] Diagnostics output is comprehensive
- [ ] Request counts and percentages tracked per bucket
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

---

### Phase 9: Non-Interactive Auth Flow

#### Purpose
Implement authentication flows for CI/CD, SSH, and other environments without browser access.

#### Files to Modify/Create
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/auth/oauth-manager.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/auth/anthropic-oauth-provider.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/auth/gemini-oauth-provider.ts`
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/auth/qwen-oauth-provider.ts`

#### Test Specification
Write tests FIRST in `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/auth/__tests__/non-interactive.bucket.spec.ts`:

1. **Device code flow**
   - `it('should display auth URL when browser unavailable')` - Manual URL shown
   - `it('should include bucket name in auth URL display')` - User knows which account
   - `it('should show clickable/pastable link')` - Accessibility
   - `it('should timeout after 5 minutes with actionable error')` - Clear timeout

2. **Environment variable configuration**
   - `it('should read bucket from LLXPRT_AUTH_BUCKET_ANTHROPIC env var')` - Env config
   - `it('should prefer env var over profile config')` - Priority order
   - `it('should error if env bucket not found')` - Clear error

3. **Token file transfer**
   - `it('should use pre-authenticated token file')` - Copy tokens work
   - `it('should validate token file format')` - Corrupt file handling

4. **Multi-bucket device code**
   - `it('should pause between device code displays for multiple buckets')` - Controlled timing
   - `it('should clearly identify which bucket user should auth with')` - No confusion
   - `it('should support manual code entry per bucket')` - Copy-paste workflow

#### Implementation Specification
1. Environment variable bucket selection:
   ```typescript
   getBucketForProvider(provider: string, profileBuckets?: string[]): string[] {
     const envKey = `LLXPRT_AUTH_BUCKET_${provider.toUpperCase()}`;
     const envBucket = process.env[envKey];
     if (envBucket) {
       return [envBucket]; // Env var overrides
     }
     return profileBuckets ?? ['default'];
   }
   ```

2. Device code flow display:
   ```typescript
   async initiateAuthNoBrowser(bucket?: string): Promise<void> {
     const deviceCode = await this.getDeviceCode();
     console.log(`\nAuthentication required for bucket: ${bucket ?? 'default'}`);
     console.log(`Provider: ${this.name}`);
     console.log(`\nVisit this URL to authenticate:`);
     console.log(`  ${deviceCode.verificationUri}`);
     console.log(`\nEnter code: ${deviceCode.userCode}`);
     console.log(`\nIMPORTANT: Authenticate with the account for bucket: ${bucket ?? 'default'}`);
     console.log(`\nWaiting for authentication... (timeout in 5 minutes)`);
     // Poll for completion
   }
   ```

3. Multi-bucket device code flow:
   ```typescript
   async authenticateMultipleBucketsDeviceCode(buckets: string[]): Promise<void> {
     const delay = getEphemeralSetting('auth-bucket-delay') ?? 5000;
     const showPrompt = getEphemeralSetting('auth-bucket-prompt') ?? false;

     for (let i = 0; i < buckets.length; i++) {
       const bucket = buckets[i];

       if (i > 0) {
         if (showPrompt) {
           console.log(`\nReady to authenticate ${this.name} for ${bucket}?`);
           await waitForEnter();
         } else {
           console.log(`\nNext bucket in ${delay/1000} seconds...`);
           await sleep(delay);
         }
       }

       console.log(`\n=== Bucket ${i + 1}/${buckets.length}: ${bucket} ===`);
       await this.initiateAuthNoBrowser(bucket);
       await this.waitForDeviceCodeCompletion();
     }
   }
   ```

#### Verification Criteria
- [ ] Device code flow works without browser
- [ ] Environment variables override profile settings
- [ ] Token file transfer works for CI/CD
- [ ] Multi-bucket device code flow has clear bucket identification
- [ ] Timing controls work for device code
- [ ] Clear timeout and error messages
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes

---

### Phase 10: Integration Testing and CI Verification

#### Purpose
End-to-end integration tests and full CI verification.

#### Files to Modify/Create
- `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/auth/__tests__/oauth-buckets.integration.spec.ts`

#### Test Specification
1. **Full workflow integration**
   - `it('should complete login-save-load-switch cycle')` - Full user journey
   - `it('should maintain bucket isolation across providers')` - No cross-contamination
   - `it('should handle multiple buckets concurrently')` - Parallel bucket operations

2. **Multi-bucket profile workflow**
   - `it('should create and load profile with multiple buckets')` - End-to-end multi-bucket
   - `it('should failover between buckets on quota errors')` - Failover integration
   - `it('should authenticate all expired buckets on load')` - Multi-bucket auth flow

3. **Backward compatibility**
   - `it('should work with existing profiles without auth field')` - Legacy profiles work
   - `it('should migrate single-bucket usage seamlessly')` - Existing tokens become default

#### Verification Criteria
- [ ] All tests pass: `npm run test`
- [ ] Lint passes: `npm run lint:ci`
- [ ] Typecheck passes: `npm run typecheck`
- [ ] Format passes: `npm run format`
- [ ] Build succeeds: `npm run build`
- [ ] Bundle succeeds: `npm run bundle`
- [ ] Integration test passes with real OAuth flow
- [ ] Multi-bucket failover works end-to-end

---

## 3. Subagent Execution Protocol

### Subagent Assignment Rules

**CRITICAL CONSTRAINTS:**
- A subagent that writes tests for a phase CANNOT implement that phase
- A subagent that implements a phase CANNOT verify that phase
- Same subagent CAN write tests for multiple phases in parallel

### Subagent Types
1. **Test Subagent (typescript-coder)**: Creates tests for phases
2. **Implementation Subagent (typescript-coder)**: Implements code to pass tests
3. **Verification Subagent (typescript-code-reviewer)**: Verifies work quality

### Execution Order

```
PHASE 1:
  - Subagent A (Test): Write Phase 1 tests
  - Subagent B (Implement): Implement Phase 1 to pass tests
  - Subagent C (Verify): Verify Phase 1 quality

PHASE 2:
  - Subagent A (Test): Write Phase 2 tests (can parallel with Phase 1 implementation)
  - Subagent D (Implement): Implement Phase 2 (DIFFERENT from Phase 1 implementer)
  - Subagent E (Verify): Verify Phase 2 (DIFFERENT from implementer)

... continue pattern ...
```

### Subagent Prompt Requirements

All subagent prompts MUST include:

```
REQUIREMENTS:
1. Follow dev-docs/RULES.md strictly - TDD is mandatory
2. Write correct, production-ready code
3. Actually implement the functionality - no placeholder implementations
4. NO TODO comments
5. NO HACK comments
6. NO STUB implementations
7. NO "will be implemented later" code
8. NO "future phase" placeholders
9. All code must compile (npm run typecheck)
10. All code must pass lint (npm run lint)
11. All tests must pass
12. Use proper TypeScript types - no `any`
13. Use the project's DebugLogger, NOT console.log
14. Before running vitest, kill any existing vitest processes:
    ps -ef | grep vitest | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true
15. Tests must test BEHAVIOR, not implementation details
16. Follow immutability patterns
17. Self-documenting code - no comments needed
```

---

## 4. Verification Checklist

For each phase, the verification subagent must check:

- [ ] Tests exist and test behavior (not implementation)
- [ ] Tests were written BEFORE implementation (TDD)
- [ ] Implementation passes all tests
- [ ] No `any` types
- [ ] No type assertions
- [ ] No TODOs, stubs, "skip", "future phase" placeholders
- [ ] Code is self-documenting (no comments needed)
- [ ] Follows immutability patterns
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] Feature works as intended
- [ ] Backward compatibility maintained
- [ ] Error messages are actionable

---

## 5. User-Facing Behavior

### Login Flow with Buckets

```bash
# Login with default bucket
/auth anthropic login
# Prompts for email/bucket name, uses as bucket identifier

# Login with explicit bucket
/auth anthropic login work@company.com
# Opens OAuth flow, stores token in work@company.com bucket

# Subsequent logins to same bucket refresh the token
/auth anthropic login work@company.com
# Updates existing bucket token
```

### Multi-Bucket Profile with Simple Failover

```bash
# Create profile with multiple buckets (simple sequential failover)
/profile save model multi-claude work@company.com personal@gmail.com

# Load the multi-bucket profile
/profile load multi-claude
# If work@company.com hits quota → automatically uses personal@gmail.com
# Notification: "Bucket 'work@company.com' quota exceeded, switching to 'personal@gmail.com'"
```

### Multi-Bucket Authentication Flow

```bash
# When loading profile with expired buckets (interactive browser):
/profile load multi-claude

# If both buckets expired:
# "Ready to auth anthropic for work@company.com? Press enter"
# [User presses enter, browser opens with work@company.com session]
# [Auth completes]
#
# "Ready to auth anthropic for personal@gmail.com? Press enter"
# [User switches browser window/profile, presses enter]
# [Browser opens, user auths with personal@gmail.com]
# [Auth completes]
#
# Profile loaded with 2 buckets

# With configurable delay instead:
# Set delay ephemeral: auth-bucket-delay=10000 (10 seconds)
# "Authenticating work@company.com in 10 seconds..."
# [10 second delay, user switches browser]
# [Browser opens for work@company.com]
# [Auth completes]
# "Authenticating personal@gmail.com in 10 seconds..."
# [Browser opens for personal@gmail.com]
```

### Non-Interactive/No-Browser Scenarios

```bash
# In CI/CD or SSH without browser
# Pre-authenticate with browser on another machine, then copy tokens
# On machine WITH browser:
/auth anthropic login ci-service
# Token saved to ~/.llxprt/oauth/anthropic-ci-service.json

# Copy to CI machine:
scp ~/.llxprt/oauth/anthropic-ci-service.json ci-server:~/.llxprt/oauth/

# On CI machine, use via profile:
/profile load my-ci-profile  # Profile has auth.buckets: ["ci-service"]
```

**Option 2: Environment variable bucket selection**
```bash
export LLXPRT_AUTH_BUCKET_ANTHROPIC=ci-service
node scripts/start.js --prompt "..."
```

**Option 3: Device code flow (no browser auto-open)**
```bash
/auth anthropic login work@company.com
# Output:
# Browser unavailable. Visit this URL to authenticate:
# https://anthropic.com/oauth/device?code=ABCD-1234
# Bucket: work@company.com (use this account to authenticate)
#
# Waiting for authentication... (timeout in 5 minutes)
```

### Token Renewal and Expiry Handling

- Tokens are automatically refreshed when within 30 seconds of expiry
- If refresh fails on one bucket, failover to next bucket in list
- If ALL bucket refreshes fail, user is prompted to re-authenticate
- `/auth status` shows remaining time for each bucket
- Expired buckets are marked in status output

### Session Persistence

- Bucket tokens persist in `~/.llxprt/oauth/` across sessions
- Session bucket override (via `/auth switch`) is in-memory only
- Profile's `auth.buckets` setting is persistent

---

## 6. Edge Cases and Error Handling

### Expired Tokens in Buckets

```typescript
// Error message when all buckets expired:
`All OAuth buckets expired: work@company.com, personal@gmail.com
Please re-authenticate: /auth anthropic login work@company.com personal@gmail.com`
```

### Missing Buckets

```typescript
// Error message when bucket not found:
`OAuth bucket 'nonexistent' for provider 'anthropic' not found.
Use /auth anthropic login nonexistent`
```

### Non-Interactive Authentication

```typescript
// When shouldLaunchBrowser() returns false:
// 1. Display auth URL to console/TUI
// 2. Copy URL to clipboard if possible
// 3. Show bucket name clearly: "Authenticate with account for bucket: work@company.com"
// 4. Wait for manual code entry or callback
// 5. Timeout after 5 minutes with actionable error
```

### No-Browser Environments

```typescript
// SSH/headless detection:
if (!shouldLaunchBrowser()) {
  // Show manual auth flow
  // Provide URL for external browser
  // Support copy-paste of auth code
  // Clearly identify which bucket/account to use
}
```

### Multiple Bucket Auth Prompts

```typescript
// When loading profile that requires unavailable buckets:
// 1. Check which buckets are expired
// 2. Prompt to authenticate all expired buckets sequentially
// 3. Use auth-bucket-delay or auth-bucket-prompt to control timing
// 4. Show bucket name in each prompt so user can switch accounts
// 5. If user declines, fail with clear error
// 6. Never silently fall back to different bucket than specified
```

### Bucket Name Validation

```typescript
// Sanitize for filesystem:
const sanitizedBucket = bucket.replace(/[/\\<>:"|?*]/g, '_');
// Warn if bucket name was modified
if (sanitizedBucket !== bucket) {
  console.warn(`Bucket name sanitized: '${bucket}' -> '${sanitizedBucket}'`);
}

// Reject reserved words:
const RESERVED = ['login', 'logout', 'status', 'switch', '--all'];
if (RESERVED.includes(bucket.toLowerCase())) {
  throw new Error(`'${bucket}' is a reserved word and cannot be used as a bucket name`);
}
```

### Failover Notification

```typescript
// When failover happens mid-session:
console.log(`Bucket 'work@company.com' quota exceeded, switching to 'personal@gmail.com'`);

// When all buckets exhausted:
throw new Error(
  `All buckets exhausted for provider 'anthropic':\n` +
  `  - work@company.com: rate limited until 2:30 PM\n` +
  `  - personal@gmail.com: quota exceeded\n` +
  `Try again later or add more buckets to the profile.`
);
```

---

## 7. User Perspective Questions - Complete Answers

### Q1: How will a user use two Claude Max subscriptions together in one profile? What happens if they hit quota on one?

**Setup:**
```bash
# Login to both accounts
/auth anthropic login work@company.com
/auth anthropic login personal@gmail.com

# Create profile with both buckets (simple failover: work first, personal second)
/profile save model multi-claude work@company.com personal@gmail.com

# Load the profile
/profile load multi-claude
```

**On quota hit (429 rate limit):**
- Profile uses work@company.com for all requests initially
- When work@company.com hits rate limit → automatic failover to personal@gmail.com
- User sees message: `Bucket 'work@company.com' quota exceeded, switching to 'personal@gmail.com'`
- All subsequent requests use personal@gmail.com
- If personal@gmail.com ALSO hits quota → Error with both rate limit times shown

**Key Points:**
- Simple sequential failover (not load balancing)
- Buckets tried in order specified in profile
- Failover triggers: 429, quota exceeded, 402 payment required, token renewal failure
- Does NOT failover on: 400 bad request, other API errors
- No API key fallback - profiles are OAuth OR API key, not both

### Q2: How will a user with two Gemini subscriptions use it?

**Identical to Q1:**
```bash
/auth gemini login work@company.com
/auth gemini login personal@gmail.com
/profile save model multi-gemini work@company.com personal@gmail.com
/profile load multi-gemini
```

Same failover behavior: work@company.com used first, automatic switch to personal@gmail.com on quota/rate limit.

### Q3: How will it work in a no-browser environment? Non-interactive mode?

**Option 1: Pre-authenticate and copy tokens**
```bash
# On machine WITH browser:
/auth anthropic login ci-service
# Token saved to ~/.llxprt/oauth/anthropic-ci-service.json

# Copy to CI machine:
scp ~/.llxprt/oauth/anthropic-ci-service.json ci-server:~/.llxprt/oauth/

# On CI machine, use via profile:
/profile load my-ci-profile  # Profile has auth.buckets: ["ci-service"]
```

**Option 2: Environment variable bucket selection**
```bash
export LLXPRT_AUTH_BUCKET_ANTHROPIC=ci-service
node scripts/start.js --prompt "..."
```

**Option 3: Device code flow (no browser auto-open)**
```bash
/auth anthropic login work@company.com
# Output:
# Browser unavailable. Visit this URL to authenticate:
# https://anthropic.com/oauth/device?code=ABCD-1234
# Bucket: work@company.com (use this account to authenticate)
#
# Paste the URL into a browser on another machine
# Authenticate with work@company.com account
#
# Waiting for authentication... (timeout in 5 minutes)
```

**Multi-bucket device code:**
```bash
# If profile has multiple buckets and all expired:
/profile load multi-claude

# Bucket 1 of 2: work@company.com
# Visit: https://anthropic.com/oauth/device?code=ABCD-1234
# Use account: work@company.com
# [User authenticates on separate machine]
#
# Ready to authenticate personal@gmail.com? Press enter
# [User presses enter]
#
# Bucket 2 of 2: personal@gmail.com
# Visit: https://anthropic.com/oauth/device?code=EFGH-5678
# Use account: personal@gmail.com
# [User authenticates with different account]
```

### Q4: How can I tell which bucket is being authenticated?

**During OAuth flow:**
```
Authenticating bucket 'work@company.com' for provider 'anthropic'...
Ready to auth anthropic for work@company.com? Press enter
Browser opening to: https://anthropic.com/oauth/authorize?...
```

**In status:**
```
/auth anthropic status

Authentication Status (anthropic):
  OAuth Buckets:
    * default (active, expires: 2025-12-14 10:30 AM)  <- * marks session bucket
      work@company.com (expires: 2025-12-15 02:15 PM)
      personal@gmail.com (expired)
```

**In diagnostics:**
```
## Provider Information
- Active Provider: anthropic
- Current Model: claude-sonnet-4
- OAuth Buckets: work@company.com, personal@gmail.com (failover order)
- Current Bucket: work@company.com
```

**During device code flow:**
```
Authentication required for bucket: work@company.com
Provider: anthropic

Visit this URL to authenticate:
  https://anthropic.com/oauth/device?code=ABCD-1234

IMPORTANT: Authenticate with the account for bucket: work@company.com
```

### Q5: Walk through auth, renewal, expiry

**Initial Authentication:**
1. `/auth anthropic login work@company.com`
2. OAuth flow opens in browser (or shows URL if no browser)
3. User logs in with work@company.com Google account
4. Token saved to `~/.llxprt/oauth/anthropic-work@company.com.json`
5. Token contains: `access_token`, `refresh_token`, `expiry` (1 hour typically)

**Automatic Renewal (silent):**
1. Before each API call, check `token.expiry`
2. If within 30 seconds of expiry AND has `refresh_token`:
   - Call token refresh endpoint silently
   - Update stored token file
   - Use new access_token
3. If refresh fails → failover to next bucket (if available)
4. If no next bucket → prompt for re-auth

**Expiry Handling (profile load):**
1. User loads profile with multiple buckets
2. System checks all bucket tokens
3. If some expired:
   - Trigger multi-bucket re-auth flow
   - Show prompt/delay before each bucket auth
   - User switches browser window/account between auths
   - Bucket name shown in each prompt
4. Interactive mode: Prompt to re-auth now
5. Non-interactive: Fail with actionable error message

**Multi-bucket auth timing:**
- Use `auth-bucket-delay` ephemeral (default 5s) for automatic delay
- Use `auth-bucket-prompt` ephemeral (default false) for manual "press enter" prompts
- Use `auth-browser-open` ephemeral (default true) to control browser auto-open

### Q6: What happens when user closes TUI and reopens with same multi-bucket profile?

**Scenario:** User has `multi-claude` profile with buckets `['work@company.com', 'personal@gmail.com']`.

**Reopening TUI:**
1. `/profile load multi-claude` (or auto-load from settings)
2. System checks each bucket token:
   - `work@company.com` → valid until 3 PM
   - `personal@gmail.com` → valid until 5 PM
3. **If all tokens valid:** Profile loads immediately, no auth required
4. **If one expired:**
   - Only re-auth the expired bucket
   - Other buckets still work for failover
5. **If both expired:** See Q7

**Auto-renewal during session:**
- Tokens auto-renew silently when within 30s of expiry
- If auto-renew fails → failover to next bucket
- Only re-prompt user if ALL buckets need re-auth

### Q7: If all buckets are expired, how is this handled for a profile that is loaded?

**Strategy: Multi-Bucket Sequential Re-Auth with Timing Control**

**Standard Profile (multiple buckets):**
```
/profile load multi-claude
# Checking buckets...
# - work@company.com: EXPIRED
# - personal@gmail.com: EXPIRED
#
# All OAuth buckets expired. Re-authenticate?
# (y/n): y
#
# === Bucket 1 of 2: work@company.com ===
# Ready to auth anthropic for work@company.com? Press enter
# [User switches to work browser/account, presses enter]
# [OAuth flow for work@company.com]
# Bucket work@company.com authenticated successfully
#
# === Bucket 2 of 2: personal@gmail.com ===
# Ready to auth anthropic for personal@gmail.com? Press enter
# [User switches to personal browser/account, presses enter]
# [OAuth flow for personal@gmail.com]
# Bucket personal@gmail.com authenticated successfully
#
# Profile loaded successfully with 2 buckets.
```

**With automatic delay (ephemeral: auth-bucket-delay=10000):**
```
/profile load multi-claude
# All buckets expired. Re-authenticating...
#
# === Bucket 1 of 2: work@company.com ===
# [OAuth flow starts immediately]
# Bucket work@company.com authenticated successfully
#
# Authenticating next bucket in 10 seconds...
# [10 second delay - user switches browser window/profile]
#
# === Bucket 2 of 2: personal@gmail.com ===
# [OAuth flow for personal@gmail.com]
# Bucket personal@gmail.com authenticated successfully
```

**Non-Interactive Mode (all expired):**
```
Error: Cannot load profile 'multi-claude' - all OAuth buckets expired:
  - work@company.com: expired 2025-12-12 08:00 AM
  - personal@gmail.com: expired 2025-12-12 09:30 AM

Re-authenticate in interactive mode:
  /auth anthropic login work@company.com personal@gmail.com

Or authenticate individually:
  /auth anthropic login work@company.com
  /auth anthropic login personal@gmail.com
```

**Partial Cancellation:**
- User starts multi-bucket re-auth
- Completes work@company.com
- Cancels personal@gmail.com
- Result: Profile fails to load (not all required buckets available)
- work@company.com token IS saved (not rolled back)
- User can retry later, only needing to auth personal@gmail.com

**Key Ephemeral Settings:**
- `auth-bucket-delay`: Delay in seconds before each auth (default 5s)
- `auth-bucket-prompt`: Boolean - show "Ready?" dialog instead of delay (default false)
- `auth-browser-open`: Boolean - whether to auto-open browser (default true)

---

## 8. Backward Compatibility Strategy

### Interface Changes (Optional Parameters)

All interface changes use **optional parameters with defaults** to maintain backward compatibility:

```typescript
// TokenStore - OLD code continues to work
interface TokenStore {
  saveToken(provider: string, token: OAuthToken, bucket?: string): Promise<void>;
  //        existing calls work: saveToken('anthropic', token)
  //        new calls also work: saveToken('anthropic', token, 'work@company.com')
}

// OAuthProvider - OLD code continues to work
interface OAuthProvider {
  initiateAuth(bucket?: string): Promise<void>;
  getToken(bucket?: string): Promise<OAuthToken | null>;
  // Existing code without bucket param still works
}
```

### Migration Path

1. **Existing token files**: `anthropic.json` becomes the "default" bucket automatically
2. **Existing profiles**: Profiles without `auth` field use default bucket
3. **Existing code**: All existing callers work unchanged (bucket param is optional)
4. **New functionality**: New code can specify buckets explicitly

### No Breaking Changes

- No renamed methods
- No removed methods
- No changed return types
- No changed required parameters

---

## 9. Bucket Name Handling

### Reserved Words
These words cannot be used as bucket names (they conflict with command parsing):
- `login`
- `logout`
- `status`
- `switch`
- `--all`

### Validation
```typescript
const RESERVED_BUCKET_NAMES = ['login', 'logout', 'status', 'switch', '--all'];

function validateBucketName(bucket: string): { valid: boolean; error?: string } {
  if (RESERVED_BUCKET_NAMES.includes(bucket.toLowerCase())) {
    return { valid: false, error: `'${bucket}' is a reserved word and cannot be used as a bucket name` };
  }
  return { valid: true };
}
```

### Sanitization (Single Implementation)
```typescript
function sanitizeBucketNameForFilesystem(bucket: string): string {
  // Replace all filesystem-unsafe characters with underscore
  // Unsafe: : / \ < > " | ? * and control characters
  return bucket.replace(/[/\\<>:"|?*\x00-\x1f]/g, '_');
}
```

### Collision Detection
```typescript
async function checkBucketCollision(
  provider: string,
  bucket: string,
  tokenStore: TokenStore
): Promise<{ collision: boolean; existingBucket?: string }> {
  const sanitized = sanitizeBucketNameForFilesystem(bucket);
  const existingBuckets = await tokenStore.listBuckets(provider);

  for (const existing of existingBuckets) {
    if (sanitizeBucketNameForFilesystem(existing) === sanitized && existing !== bucket) {
      return { collision: true, existingBucket: existing };
    }
  }
  return { collision: false };
}
```

---

## 10. Critical Implementation Notes

### Files for Implementation Reference

1. `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/core/src/auth/token-store.ts` - Core token storage logic to extend with bucket support
2. `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/auth/oauth-manager.ts` - Central OAuth coordination to add bucket parameters
3. `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/core/src/types/modelParams.ts` - Profile type definition to add AuthConfig interface
4. `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/ui/commands/authCommand.ts` - Auth command to extend with bucket operations
5. `/Users/acoliver/projects/llxprt-code-branches/llxprt-code-2/packages/cli/src/runtime/profileApplication.ts` - Profile loading to add bucket resolution

### Anti-Patterns to Avoid

1. **No placeholder code**: Every function must be fully implemented
2. **No TODO comments**: If something needs doing, do it now
3. **No "future phase" references**: Each phase is complete on its own
4. **No stub implementations**: Return values must be real, not mocked
5. **No console.log**: Use DebugLogger from the project
6. **No any types**: Use proper TypeScript types
7. **No type assertions**: Use type guards instead

### Ephemeral Settings for Multi-Bucket Auth

```typescript
// Ephemeral settings that control multi-bucket authentication flow:
interface MultiBucketAuthSettings {
  'auth-bucket-delay': number;        // Delay in ms before each auth (default 5000)
  'auth-bucket-prompt': boolean;      // Show "Ready?" dialog instead of delay (default false)
  'auth-browser-open': boolean;       // Whether to auto-open browser (default true)
}

// Usage:
const delay = getEphemeralSetting('auth-bucket-delay') ?? 5000;
const showPrompt = getEphemeralSetting('auth-bucket-prompt') ?? false;
const autoOpen = getEphemeralSetting('auth-browser-open') ?? true;
```

### Command Syntax Summary

```bash
# Profile with multiple buckets (positional arguments, NOT flags)
/profile save model profilename bucket1 bucket2 bucket3

# Auth commands
/auth <provider> login bucketname
/auth <provider> logout bucketname
/auth <provider> logout --all
/auth <provider> status
/auth <provider> switch bucketname

# Stats
/stats buckets

# Diagnostics (shows all buckets)
/diagnostics
```

### Failover Decision Logic

```typescript
function shouldFailover(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('quota') ||
    message.includes('402') ||
    message.includes('payment') ||
    (message.includes('token') && message.includes('expired'))
  );
}

// Failover triggers: 429, quota exceeded, 402 payment, token renewal failure
// Does NOT failover: 400 bad request, other API errors
```

### Profile Constraints

```typescript
// Profiles have OAuth buckets OR API key, NOT both
interface AuthConfig {
  type: 'oauth' | 'apikey';
  buckets?: string[];  // Only valid if type === 'oauth'
}

// Validation:
if (profile.auth?.type === 'apikey' && profile.auth.buckets) {
  throw new Error('Profile cannot have both API key and OAuth buckets');
}

// Provider support check:
if (profile.auth?.buckets && !providerSupportsOAuth(profile.provider)) {
  throw new Error(`Provider ${profile.provider} does not support OAuth`);
}

// Bucket existence check:
for (const bucket of profile.auth?.buckets ?? []) {
  const exists = await tokenStore.getToken(profile.provider, bucket);
  if (!exists) {
    throw new Error(`Bucket '${bucket}' not found for provider ${profile.provider}`);
  }
}
```
