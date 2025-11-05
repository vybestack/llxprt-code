# Master Plan: Consistent Authentication & Profile Architecture

**Issues**: #458, #443
**Date**: 2025-11-05
**Last Updated**: 2025-11-05 (Revised with Codex and GPT feedback)
**Goal**: Fix authentication inconsistencies, profile loading bugs, establish consistent stateless provider architecture, and remove vestigial AUTH_TYPE code

---

## START HERE: Implementation Guide for Fresh Context

**If you're implementing this plan without the original conversation history, READ THIS FIRST.**

### Required Reading (in order)

1. **dev-docs/profileandsettings.md** - Documents expected behavior for profiles, CLI args, OAuth timing, and ephemeral settings. This is the specification.

2. **GitHub Issues**:
   - Issue #458: Authentication and profile loading failures
   - Issue #443: Remove vestigial AUTH_TYPE code

3. **Example Profiles** (demonstrating the bugs):
   - `~/.llxprt/profiles/zai.json` - Anthropic profile with keyfile that incorrectly triggers OAuth
   - `~/.llxprt/profiles/synthetic.json` - OpenAI profile that works correctly

### Current Broken Behavior

Run these commands to see the bugs this plan fixes:

```bash
# Bug 1: Gemini ignores keyfile, says "no API key"
node scripts/start.js --provider gemini --keyfile ~/.foogle_key
# Current: ❌ Error: "no API key configured"
# Expected: ✓ Uses keyfile successfully

# Bug 2: Anthropic profile triggers OAuth popup despite having keyfile
node scripts/start.js --profile-load zai
# Current: ❌ OAuth browser window opens
# Expected: ✓ Loads keyfile silently, no OAuth
```

### Root Causes (What You're Fixing)

1. **GeminiProvider.determineBestAuth()** (line 282-377) checks `process.env.GEMINI_API_KEY` directly, bypassing AuthResolver where keyfile-loaded keys are stored
2. **Profile loading** calls `switchActiveProvider()` which calls `config.refreshAuth()` which triggers OAuth BEFORE keyfile is processed
3. **CLI arguments** (`--key`, `--keyfile`) processed AFTER provider switch instead of before

### Implementation Approach

**TEST-FIRST DEVELOPMENT**: Every phase follows a→b→c→d pattern:
- **a)** Write failing test
- **b)** Run test, prove it fails
- **c)** Implement fix
- **d)** Run test, prove it passes

Follow the implementation order: Sprint 1 → Sprint 2 → Sprint 3 → Sprint 4

### Key Architecture Decisions

This plan incorporates feedback from multiple AI reviewers (Codex, GPT-5, GLM-4.6) and establishes:

- **Providers delegate to AuthResolver** - Never read process.env directly for API keys
- **OAuth is lazy** - Only triggers on actual prompt send, never during config/startup
- **Stash→Switch→Apply pattern** - Profile auth must be read before provider switch, applied after
- **Keep methods, fix behavior** - Don't remove `hasGeminiAPIKey()` or `refreshAuth()`, just fix their implementation

### Quick Validation

After completing each sprint, run:
```bash
npm test -- GeminiProvider.test.ts
npm test -- BaseProvider.test.ts
npm test -- profileApplication.test.ts
npm run lint
npm run typecheck
```

All tests must pass before moving to next sprint.

---

## Executive Summary

### Problems Identified

1. **Gemini Provider Bypasses AuthResolver**: Custom auth logic checks `process.env.GEMINI_API_KEY` before SettingsService, reversing precedence and causing keyfile failures
2. **Anthropic OAuth Triggers Too Early**: Profile loading triggers OAuth before applying keyfile credentials
3. **Inconsistent Provider Behavior**: Each provider implements auth differently, violating statelessness
4. **CLI Argument Timing**: `--key`, `--keyfile`, `--set` processed after provider switch instead of before
5. **Vestigial AUTH_TYPE Code**: `LLXPRT_AUTH_TYPE` and related code is legacy complexity that should be removed (Issue #443)

### Architectural Principles

**What's Centralized (Provider-Agnostic)**:
- Key/keyfile storage (SettingsService, Config ephemerals)
- Authentication precedence (AuthResolver)
- Profile loading (ProfileManager)
- CLI argument processing
- OAuth timing/triggering (lazy on prompt send only)

**What's Provider-Specific (Provider-Owned)**:
- OAuth flow implementation (token exchange)
- API key format validation
- Special auth modes (Vertex AI for Gemini, ADC, etc.)
- HTTP request signing

**Critical Rule**: Providers NEVER read keys/keyfiles directly. They ask AuthResolver "what auth should I use?"

### Statelessness Contract

Providers must:
- Query auth state fresh each API call (no caching)
- Delegate to AuthResolver for all standard auth
- Use `includeOAuth: false` for checks (no side effects)
- Only use `includeOAuth: true` on actual API calls

---

## Authentication Precedence (Standard for ALL Providers)

**From AuthResolver** (`packages/core/src/auth/precedence.ts:592-641`):

```
1. SettingsService auth-key (set by --key, /key, profiles)
2. SettingsService auth-keyfile (set by --keyfile, /keyfile, profiles)
3. Constructor apiKey (programmatic usage)
4. Environment variables (OPENAI_API_KEY, GEMINI_API_KEY, etc.)
5. OAuth (only if includeOAuth: true)
```

**When `authOnly` is set**: Skip steps 1-4, go directly to OAuth

**Key Principle**: User-provided auth (CLI, profiles, runtime commands) always overrides environment variables

---

## Key Revisions (Based on Codex Feedback)

### What Changed

1. **Gemini Error Handling**: Don't return `{ authMode: 'none', token: '' }` - this breaks downstream code. **Throw error** when no auth is available.

2. **Keep `hasGeminiAPIKey()` Method**: Don't remove it (used in multiple error paths). **Update implementation** to delegate to AuthResolver (keep method, change implementation).

3. **Keep `config.refreshAuth()`**: Don't remove it from `switchActiveProvider()`. It rebuilds GeminiClient and updates runtime state. **Fix it to not trigger OAuth** instead.

4. **Stash → Switch → Apply Pattern**: Profile/CLI auth must be **stashed** before provider switch, then **applied** after. Can't call `updateActiveProviderApiKey()` before the target provider is active.

5. **CLI Overrides After Provider Manager**: `applyCliArgumentOverrides()` relies on `getCliRuntimeServices()`, so it must run **after** provider manager is created.

6. **Vertex AI**: Keep as-is - it's provider-specific infrastructure auth, not user-managed. Don't spend time rationalizing it.

7. **AUTH_TYPE Cleanup**: Remove vestigial `LLXPRT_AUTH_TYPE` and `AuthType` enum usage (Issue #443). Keep only the hardcoded logic inside GeminiProvider where it belongs.

---

## Phase 1: Centralize Authentication Resolution

### 1.1 Fix GeminiProvider (Highest Priority)

**File**: `packages/core/src/providers/gemini/GeminiProvider.ts`

**Current Problem** (lines 282-377):
- `determineBestAuth()` bypasses AuthResolver
- `hasGeminiAPIKey()` (line 415) only checks `process.env.GEMINI_API_KEY`
- Never checks SettingsService where keyfile-loaded keys are stored

**Changes Required**:

```typescript
// BEFORE (lines 282-377)
private async determineBestAuth(): Promise<{
  authMode: GeminiAuthMode;
  token: string;
}> {
  this.updateOAuthState();

  if (this.hasVertexAICredentials()) {
    this.setupVertexAIAuth();
    return { authMode: 'vertex-ai', token: 'USE_VERTEX_AI' };
  }

  if (this.hasGeminiAPIKey()) {  // ❌ Only checks process.env
    return { authMode: 'gemini-api-key', token: process.env.GEMINI_API_KEY! };
  }

  // Falls through to OAuth...
}

// AFTER (REVISED)
private async determineBestAuth(): Promise<{
  authMode: GeminiAuthMode;
  token: string;
}> {
  this.updateOAuthState();

  // 1. CHECK STANDARD AUTH FIRST (via AuthResolver)
  //    This checks in order:
  //    - SettingsService auth-key
  //    - SettingsService auth-keyfile
  //    - Constructor apiKey
  //    - Environment variables (GEMINI_API_KEY, GOOGLE_API_KEY)
  const standardAuth = await this.authResolver.resolveAuthentication({
    settingsService: this.resolveSettingsService(),
    includeOAuth: false,  // Just checking, not triggering OAuth
  });

  if (standardAuth) {
    return { authMode: 'gemini-api-key', token: standardAuth };
  }

  // 2. CHECK PROVIDER-SPECIFIC AUTH (Vertex AI)
  if (this.hasVertexAICredentials()) {
    this.setupVertexAIAuth();
    return { authMode: 'vertex-ai', token: 'USE_VERTEX_AI' };
  }

  // 3. CHECK IF OAUTH IS ENABLED (for compatibility with downstream code)
  //    invokeServerTool and generateChatCompletionWithOptions expect this
  //    Use the EXACT pattern from current GeminiProvider.ts lines 305-320:
  const manager = this.geminiOAuthManager as OAuthManager & {
    isOAuthEnabled?(provider: string): boolean;
  };
  const isOAuthEnabled =
    manager?.isOAuthEnabled &&
    typeof manager.isOAuthEnabled === 'function' &&
    manager.isOAuthEnabled('gemini');

  if (isOAuthEnabled) {
    return { authMode: 'oauth', token: 'USE_LOGIN_WITH_GOOGLE' };
  }

  // 4. NO AUTH AVAILABLE - throw error (don't return 'none')
  throw new Error(
    'No Gemini authentication configured. ' +
    'Set GEMINI_API_KEY environment variable, use --keyfile, or configure Vertex AI credentials.'
  );
}

// UPDATE hasGeminiAPIKey() method (don't remove - used in error paths)
private async hasGeminiAPIKey(): Promise<boolean> {
  const auth = await this.authResolver.resolveAuthentication({
    settingsService: this.resolveSettingsService(),
    includeOAuth: false,
  });
  return !!auth || !!process.env.GEMINI_API_KEY;  // Check both for backward compat
}

**CRITICAL: Call Site Updates Required**
Current call sites that use `if (this.hasGeminiAPIKey())` synchronously:
- Line 323: Error path check
- Line 363: ServerTools provider check
- Line 752: Web search guard
- Line 938: Web fetch guard

Options:
A) Update all call sites to `if (await this.hasGeminiAPIKey())`
B) Create sync helper `private hasGeminiAPIKeySync(): boolean { return !!process.env.GEMINI_API_KEY }` for error paths only

Recommendation: Option A for consistency, but requires updating ~8 call sites.
```

**Impact**: Gemini will now see keys loaded via `--keyfile`, `/keyfile`, profiles, etc.

**Testing**:
```bash
# Should work after fix
node scripts/start.js --provider gemini --keyfile ~/.foogle_key
> hi
# Expected: Works, no "no API key" error
```

---

### 1.2 Audit All Providers for Consistency

**Action Items**:

1. **Search for direct `process.env` reads** in provider files:
   ```bash
   grep -r "process\.env\." packages/core/src/providers/
   ```

2. **Check each provider** against statelessness requirements:

| Provider | Uses AuthResolver? | Stateless? | No Direct Env Reads? | Fix Needed? |
|----------|-------------------|------------|---------------------|-------------|
| OpenAI | ✓ Yes | ✓ Yes | ✓ Yes | None |
| Anthropic | ✓ Yes | ✓ Yes | ✓ Yes | Timing only (Phase 2) |
| Gemini | ❌ No | ❌ No | ❌ No | **Yes (1.1 above)** |
| Qwen | **Audit needed** | **Audit needed** | **Audit needed** | **TBD** |

3. **For each violation found**:
   - Replace direct env reads with `authResolver.resolveAuthentication()`
   - Remove custom auth checking methods
   - Ensure `includeOAuth: false` for checks

---

### 1.3 Establish AuthResolver as Single Source of Truth

**File**: `packages/core/src/auth/precedence.ts`

**Action**:
1. **Document precedence** in code comments at top of file
2. **Add unit tests** verifying precedence order:
   ```typescript
   describe('AuthResolver Precedence', () => {
     it('prefers SettingsService auth-key over environment variable', async () => {
       process.env.OPENAI_API_KEY = 'env-key';
       settingsService.set('auth-key', 'settings-key');

       const auth = await authResolver.resolveAuthentication();
       expect(auth).toBe('settings-key');
     });
   });
   ```
3. **Document in dev-docs**: All providers must respect this order (no exceptions)

---

## Phase 2: Fix OAuth Timing & Side Effects

### 2.1 Separate "Check" from "Get" Auth

**Problem**: `isAuthenticated()` can trigger OAuth (side effect in query method)

**File**: `packages/core/src/providers/BaseProvider.ts:424-435`

**Changes**:

```typescript
// BEFORE
async isAuthenticated(): Promise<boolean> {
  try {
    const token = await this.authResolver.resolveAuthentication({
      settingsService: this.resolveSettingsService(),
      // includeOAuth defaults to TRUE ❌
    });
    return token !== '';
  } catch {
    return false;
  }
}

// AFTER
async isAuthenticated(): Promise<boolean> {
  try {
    const token = await this.authResolver.resolveAuthentication({
      settingsService: this.resolveSettingsService(),
      includeOAuth: false,  // ✓ Just checking, don't trigger OAuth
    });
    return token !== '';
  } catch {
    return false;
  }
}
```

**Principle**: "Is authenticated?" is a **query**, not an **action**. Should never have side effects.

**Impact**: Prevents OAuth popups during config checks

---

### 2.2 Make OAuth Lazy (Only on Prompt Send)

**Required Behavior** (from `dev-docs/profileandsettings.md`):
> OAuth should ONLY be done if enabled and (no key/keyfile OR authOnly) and ONLY on prompt send

**Implementation Strategy**:

```typescript
// Config Time (startup, profile load, /provider switch)
// → Use includeOAuth: false
const hasAuth = await provider.hasNonOAuthAuthentication();
if (!hasAuth) {
  logger.debug('No non-OAuth auth, OAuth may be needed on first prompt');
}

// Prompt Send Time (actual API call)
// → Use includeOAuth: true
const token = await authResolver.resolveAuthentication({
  includeOAuth: true,  // NOW we can trigger OAuth if needed
});
```

**Files to Update**:

#### File 1: `packages/cli/src/runtime/runtimeSettings.ts:1410`

**Change in `switchActiveProvider()`**:

```typescript
// KEEP this line (it rebuilds GeminiClient and updates runtime state)
await config.refreshAuth(authType);

// But ensure refreshAuth() doesn't trigger OAuth (see File 2)
```

#### File 2: `packages/core/src/config/config.ts:604-715`

**Change in `refreshAuth()` (REVISED - using ACTUAL implementation from the file)**:

```typescript
async refreshAuth(authMethod: AuthType) {
  // Save conversation history and HistoryService
  let existingHistory: Content[] = [];
  let existingHistoryService: HistoryService | null = null;

  if (this.geminiClient && this.geminiClient.isInitialized()) {
    existingHistory = await this.geminiClient.getHistory();
    existingHistoryService = this.geminiClient.getHistoryService();
  }

  // Create new content generator config
  const newContentGeneratorConfig = createContentGeneratorConfig(this, authMethod);

  // Add provider manager if available
  if (this.providerManager) {
    newContentGeneratorConfig.providerManager = this.providerManager;
  }

  // Update runtime state
  const updatedRuntimeState = createAgentRuntimeStateFromConfig(this, {
    runtimeId: this.runtimeState.runtimeId,
    overrides: {
      model: newContentGeneratorConfig.model,
      authType: newContentGeneratorConfig.authType ?? this.runtimeState.authType,
      authPayload: newContentGeneratorConfig.apiKey
        ? { apiKey: newContentGeneratorConfig.apiKey }
        : undefined,
      proxyUrl: newContentGeneratorConfig.proxy ?? this.runtimeState.proxyUrl,
    },
  });
  this.runtimeState = updatedRuntimeState;

  // Instantiate new GeminiClient (NOT using fictional createGeminiClient helper)
  const newGeminiClient = new GeminiClient(this, this.runtimeState);

  // Store HistoryService for reuse
  if (existingHistoryService) {
    newGeminiClient.storeHistoryServiceForReuse(existingHistoryService);
  }

  // Store history for later use (handles Genai to Vertex transition)
  if (existingHistory.length > 0) {
    const fromGenaiToVertex =
      this.contentGeneratorConfig?.authType === AuthType.USE_GEMINI &&
      authMethod === AuthType.LOGIN_WITH_GOOGLE;

    const historyToStore = fromGenaiToVertex
      ? existingHistory.map((content) => {
          // Strip thoughtSignature when moving from Genai to Vertex
          const newContent = { ...content };
          if (newContent.parts) {
            newContent.parts = newContent.parts.map((part) => {
              if (part && typeof part === 'object' && 'thoughtSignature' in part) {
                const newPart = { ...part };
                delete (newPart as { thoughtSignature?: string }).thoughtSignature;
                return newPart;
              }
              return part;
            });
          }
          return newContent;
        })
      : existingHistory;

    newGeminiClient.storeHistoryForLaterUse(historyToStore);
  }

  // Initialize with new config
  await newGeminiClient.initialize(newContentGeneratorConfig);

  // Assign to instance properties after successful initialization
  this.contentGeneratorConfig = newContentGeneratorConfig;
  this.geminiClient = newGeminiClient;

  // CRITICAL: DON'T call isAuthenticated() here - that would trigger OAuth
  // The client is ready, OAuth will trigger on first API call if needed
}
```

#### File 3: Prompt send path

**Wherever API calls are made**, ensure OAuth CAN trigger:

```typescript
// Before making API request
const token = await provider.getAuthToken();  // This CAN trigger OAuth (includeOAuth: true)
```

---

### 2.3 Ensure Profile Loading Doesn't Trigger OAuth

**File**: `packages/cli/src/runtime/profileApplication.ts:158-160`

**Current Problem**:
1. `switchActiveProvider()` is called (may trigger OAuth via `config.refreshAuth()`)
2. Ephemerals are cleared
3. Keyfile is loaded (too late)

**Fix**: We're KEEPING `config.refreshAuth()` in `switchActiveProvider()` but ensuring it doesn't trigger OAuth (see 2.2 File 1 and File 2 above). The refreshAuth() method rebuilds the GeminiClient and updates runtime state, which is necessary. We just need to ensure it doesn't call isAuthenticated() or other methods that would trigger OAuth.

**Impact**: Profile loading will no longer trigger OAuth before keyfile is processed

---

## Phase 3: Fix Profile & CLI Argument Loading Order

### 3.1 Reorder Profile Application

**File**: `packages/cli/src/runtime/profileApplication.ts:95-300`

**Current Order** (broken):
```
1. switchActiveProvider(targetProviderName) → may trigger OAuth
2. Clear ALL ephemerals
3. Apply profile ephemerals (including keyfile)
```

**New Order (REVISED - Stash → Switch → Apply)**:
```
1. Clear ALL ephemerals (except activeProvider)
2. STASH auth credentials from profile (read keyfile but don't apply yet)
3. switchActiveProvider(targetProviderName) → provider is now active
4. APPLY stashed auth credentials (now we can call updateActiveProviderApiKey)
5. Apply other profile ephemerals (context-limit, streaming, etc.)
6. Apply model and modelParams
```

**Why this order**: `updateActiveProviderApiKey()` looks up the active provider from `providerManager`. Can't call it before the target provider is active, or we'd set the wrong provider's credentials.

**Implementation (REVISED)**:

```typescript
export async function applyProfileWithGuards(
  profile: Profile,
  _options: ProfileApplicationOptions = {},
): Promise<ProfileApplicationResult> {
  // ... setup code ...

  // STEP 1: Clear ALL ephemerals first
  const mutatedEphemeralKeys = new Set<string>([
    ...previousEphemeralKeys.filter((key) => key !== 'activeProvider'),
    ...Object.keys(profile.ephemeralSettings ?? {}),
    'auth-key', 'auth-keyfile', 'base-url',
  ]);

  for (const key of mutatedEphemeralKeys) {
    setEphemeralSetting(key, undefined);
  }

  // STEP 2: STASH auth credentials (don't apply yet - provider not active)
  let pendingAuthKey: string | undefined;
  let pendingKeyfilePath: string | undefined;
  let pendingBaseUrl: string | undefined;

  const authKeyfile = profile.ephemeralSettings?.['auth-keyfile'];
  if (authKeyfile && typeof authKeyfile === 'string') {
    const resolvedPath = authKeyfile.replace(/^~(?=$|\/)/, homedir());
    const filePath = path.resolve(resolvedPath);
    try {
      const fileContents = await fs.readFile(filePath, 'utf-8');
      pendingAuthKey = fileContents.trim();
      pendingKeyfilePath = filePath;
    } catch (error) {
      warnings.push(`Failed to load keyfile '${authKeyfile}': ${error}`);
    }
  } else if (profile.ephemeralSettings?.['auth-key']) {
    pendingAuthKey = profile.ephemeralSettings['auth-key'] as string;
  }

  if (profile.ephemeralSettings?.['base-url']) {
    pendingBaseUrl = profile.ephemeralSettings['base-url'] as string;
  }

  // STEP 3: Switch provider (provider is now active)
  const providerSwitch = await switchActiveProvider(targetProviderName);
  const infoMessages = [...providerSwitch.infoMessages];

  // STEP 4: NOW apply stashed auth to the active provider
  if (pendingAuthKey) {
    const result = await updateActiveProviderApiKey(pendingAuthKey);
    if (result.message) infoMessages.push(result.message);

    if (pendingKeyfilePath) {
      setEphemeralSetting('auth-keyfile', pendingKeyfilePath);
    }
  }

  if (pendingBaseUrl) {
    const result = await updateActiveProviderBaseUrl(pendingBaseUrl);
    if (result.message) infoMessages.push(result.message);
  }

  // STEP 5: Apply non-auth ephemerals
  const appliedKeys = new Set(['auth-key', 'auth-keyfile', 'base-url']);
  const otherEphemerals = Object.entries(profile.ephemeralSettings ?? {})
    .filter(([key]) => !appliedKeys.has(key));

  for (const [key, value] of otherEphemerals) {
    setEphemeralSetting(key, value);
  }

  // STEP 6: Apply model and modelParams
  const requestedModel = typeof profile.model === 'string' ? profile.model.trim() : '';
  const fallbackModel = providerRecord?.getDefaultModel?.() ?? config.getModel() ?? '';

  if (!requestedModel && !fallbackModel) {
    throw new Error(`Profile does not specify a model and no default available`);
  }

  await setActiveModel(requestedModel || fallbackModel);

  // Apply model params...
  const profileParams = profile.modelParams ?? {};
  const existingParams = getActiveModelParams();

  for (const [key, value] of Object.entries(profileParams)) {
    setActiveModelParam(key, value);
  }

  for (const key of Object.keys(existingParams)) {
    if (!(key in profileParams)) {
      clearActiveModelParam(key);
    }
  }

  return {
    providerName: targetProviderName,
    modelName: requestedModel || fallbackModel,
    infoMessages,
    warnings,
    providerChanged: providerSwitch.changed,
    authType: providerSwitch.authType,
    baseUrl: pendingBaseUrl,
    didFallback: false,
    requestedProvider: targetProviderName,
  };
}
```

**Impact**: Anthropic profile loading will no longer trigger OAuth popup

**Testing**:
```bash
# Should work after fix (no OAuth popup)
node scripts/start.js --profile-load zai
# Expected: Loads keyfile, no OAuth browser window
```

---

### 3.2 Fix CLI Argument Processing Order

**File**: `packages/cli/src/gemini.tsx:484-562`

**Current Problem**:
```typescript
// Provider already set by config.ts loadCliConfig()
const configProvider = config.getProvider();
if (configProvider) {
  await switchActiveProvider(configProvider);  // Line 488

  // ... much later (lines 545-555) ...
  await applyProviderCredentials({
    cliKey: argv.key,        // Applied AFTER switch
    cliKeyfile: argv.keyfile,
    cliBaseUrl: argv.baseurl,
  });
}
```

**New Order**:
```
1. Parse CLI args (ALL of them)
2. Load profile (if --profile-load)
3. Apply CLI overrides IMMEDIATELY (--key, --keyfile, --set override profile)
4. Switch provider (with auth already in place)
5. Continue initialization
```

**Implementation**:

#### Step 1: Add `applyCliArgumentOverrides()` function

**File**: `packages/cli/src/runtime/runtimeSettings.ts`
**NOTE**: Moving this to runtimeSettings.ts to avoid circular dependency, as it needs to import from runtimeSettings

Add new function:

```typescript
/**
 * Apply CLI argument overrides to configuration
 * Must be called AFTER provider manager creation (so getCliRuntimeServices() works)
 * @param services - Pass services explicitly to avoid circular dependency
 */
export async function applyCliArgumentOverrides(
  config: Config,
  argv: CliArgs,
  services: {
    updateActiveProviderApiKey: typeof updateActiveProviderApiKey,
    updateActiveProviderBaseUrl: typeof updateActiveProviderBaseUrl,
  },
): Promise<void> {
  const { applyCliSetArguments } =
    await import('../config/cliEphemeralSettings.js');

  // 1. Apply --key (overrides profile auth-key)
  if (argv.key) {
    await services.updateActiveProviderApiKey(argv.key);
  }

  // 2. Apply --keyfile (overrides profile auth-keyfile)
  if (argv.keyfile) {
    const resolvedPath = argv.keyfile.replace(/^~/, os.homedir());
    const keyContent = await fs.readFile(resolvedPath, 'utf-8');
    await services.updateActiveProviderApiKey(keyContent.trim());
    config.setEphemeralSetting('auth-keyfile', resolvedPath);
  }

  // 3. Apply --set arguments (overrides profile ephemerals)
  if (argv.set && Array.isArray(argv.set)) {
    await applyCliSetArguments(argv.set, config);
  }

  // 4. Apply --baseurl (overrides profile base-url)
  if (argv.baseurl) {
    await services.updateActiveProviderBaseUrl(argv.baseurl);
  }
}
```

#### Step 2: Update `gemini.tsx` main flow

**File**: `packages/cli/src/gemini.tsx:278-562`

**REVISED - CLI Overrides After Provider Manager**:

```typescript
// After loadCliConfig()
const { settings, config, argv } = await loadCliConfig(cliArgs);

// Create provider manager FIRST (services must exist before calling helpers)
const { manager: providerManager, oauthManager } = createProviderManager(
  {
    settingsService: runtimeSettingsService,
    config,
    runtimeId: 'cli.providerManager',
    metadata: { source: 'cli.getProviderManager' },
  },
  { config, allowBrowserEnvironment: false, settings },
);

// NOW apply CLI overrides (services exist, can call getCliRuntimeServices())
// Import the runtime setting functions and pass them explicitly
const { updateActiveProviderApiKey, updateActiveProviderBaseUrl } =
  await import('./runtime/runtimeSettings.js');
await applyCliArgumentOverrides(config, argv, {
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
});

// ... rest of initialization ...

// REMOVE the old applyProviderCredentials() call at lines 545-555
// It's already been done by applyCliArgumentOverrides()
```

**Why this order**: `applyCliArgumentOverrides()` calls helpers like `updateActiveProviderApiKey()` which use `getCliRuntimeServices()` to look up the provider manager. Must create provider manager first.

---

### 3.3 Wire Up `--set` Processing

**File**: `packages/cli/src/config/cliEphemeralSettings.ts`

**Current**: Exists but never called

**Changes**: Update to be called from `applyCliArgumentOverrides()`

```typescript
export async function applyCliSetArguments(
  setArgs: string[],
  config: Config,
): Promise<void> {
  for (const arg of setArgs) {
    const [key, ...valueParts] = arg.split('=');
    const value = valueParts.join('=');

    if (!key || !value) {
      console.warn(`Invalid --set argument: ${arg}`);
      continue;
    }

    // Parse value (handle JSON, booleans, numbers)
    let parsedValue: unknown = value;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      // Keep as string if not valid JSON
    }

    config.setEphemeralSetting(key, parsedValue);
  }
}
```

**Testing**:
```bash
# Should work after fix
node scripts/start.js --provider gemini --set context-limit=50000
# Expected: context-limit set to 50000 on startup
```

---

## Phase 4: Testing & Validation

### 4.1 Unit Tests

#### Test 1: Gemini Auth Changes

**File**: `packages/core/src/providers/gemini/GeminiProvider.test.ts`

```typescript
describe('GeminiProvider Authentication', () => {
  it('should check AuthResolver before falling back to Vertex AI', async () => {
    // Create mock config with mock authResolver
    const mockConfig = {
      // ... other config methods if needed ...
    } as Config;

    const mockAuthResolver = {
      resolveAuthentication: jest.fn().mockResolvedValue('test-key'),
    };

    // Inject mock authResolver into the config
    (mockConfig as any).authResolver = mockAuthResolver;

    // GeminiProvider constructor signature: constructor(apiKey?, baseURL?, config?, oauthManager?)
    const provider = new GeminiProvider(
      undefined,  // apiKey
      undefined,  // baseURL
      mockConfig, // config (with mocked authResolver)
      undefined   // oauthManager
    );

    const auth = await provider['determineBestAuth']();

    expect(mockAuthResolver.resolveAuthentication).toHaveBeenCalledWith({
      settingsService: expect.anything(),
      includeOAuth: false,
    });
    expect(auth.authMode).toBe('gemini-api-key');
    expect(auth.token).toBe('test-key');
  });

  it('should fallback to Vertex AI if no standard auth', async () => {
    const mockConfig = {} as Config;
    const mockAuthResolver = {
      resolveAuthentication: jest.fn().mockResolvedValue(null),
    };
    (mockConfig as any).authResolver = mockAuthResolver;

    // Mock Vertex AI env vars
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';

    const provider = new GeminiProvider(
      undefined,
      undefined,
      mockConfig,
      undefined
    );

    const auth = await provider['determineBestAuth']();

    expect(auth.authMode).toBe('vertex-ai');
  });

  it('should respect auth precedence (SettingsService over env var)', async () => {
    process.env.GEMINI_API_KEY = 'env-key';

    const mockConfig = {} as Config;
    const mockSettingsService = {
      get: jest.fn((key) => {
        if (key === 'auth-key') return 'settings-key';
        return undefined;
      }),
    };

    const mockAuthResolver = {
      resolveAuthentication: jest.fn().mockResolvedValue('settings-key'),
    };

    (mockConfig as any).authResolver = mockAuthResolver;

    const provider = new GeminiProvider(
      undefined,
      undefined,
      mockConfig,
      undefined
    );

    const auth = await provider['determineBestAuth']();

    expect(auth.token).toBe('settings-key');  // Not 'env-key'
  });
});
```

#### Test 2: OAuth Timing

**File**: `packages/core/src/providers/BaseProvider.test.ts`

```typescript
describe('BaseProvider isAuthenticated', () => {
  it('should not trigger OAuth when checking authentication', async () => {
    const mockAuthResolver = {
      resolveAuthentication: jest.fn().mockResolvedValue(null),
    };

    const provider = new BaseProvider({
      authResolver: mockAuthResolver,
      name: 'test',
    });

    await provider.isAuthenticated();

    expect(mockAuthResolver.resolveAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({
        includeOAuth: false,  // Should NOT trigger OAuth
      })
    );
  });
});
```

---

### 4.2 Integration Tests

#### Test 1: Profile Loading with Authentication

**File**: `packages/cli/src/runtime/profileApplication.test.ts`

```typescript
describe('Profile Loading with Authentication', () => {
  it('should load keyfile before switching provider', async () => {
    const profile = {
      provider: 'anthropic',
      model: 'claude-3-opus',
      ephemeralSettings: {
        'auth-keyfile': '/path/to/.anthropic_key',
      },
    };

    // Mock file read
    jest.spyOn(fs, 'readFile').mockResolvedValue('test-api-key');

    const oauthAuthenticateSpy = jest.fn();
    const mockOAuthManager = {
      authenticate: oauthAuthenticateSpy,
    };

    await applyProfileWithGuards(profile);

    // OAuth should NOT have been triggered
    expect(oauthAuthenticateSpy).not.toHaveBeenCalled();

    // Auth key should be set
    const authKey = config.getEphemeralSetting('auth-key');
    expect(authKey).toBe('test-api-key');
  });

  it('should not trigger OAuth when loading profile with keyfile', async () => {
    const profile = {
      provider: 'anthropic',
      model: 'claude-3-opus',
      ephemeralSettings: {
        'auth-keyfile': '/path/to/.anthropic_key',
      },
    };

    // Mock file read
    jest.spyOn(fs, 'readFile').mockResolvedValue('test-api-key');

    const oauthAuthenticateSpy = jest.fn();
    const mockOAuthManager = {
      authenticate: oauthAuthenticateSpy,
      isOAuthEnabled: jest.fn().mockReturnValue(true),
    };

    // Pass OAuth manager to profile application
    await applyProfileWithGuards(profile, { oauthManager: mockOAuthManager });

    // Assert OAuth was NOT called despite being enabled
    expect(oauthAuthenticateSpy).not.toHaveBeenCalled();

    // Verify keyfile was loaded instead
    const authKey = config.getEphemeralSetting('auth-key');
    expect(authKey).toBe('test-api-key');
  });

  it('should apply auth ephemerals before switching provider', async () => {
    const profile = {
      provider: 'gemini',
      model: 'gemini-pro',
      ephemeralSettings: {
        'auth-key': 'test-key',
        'context-limit': 50000,
      },
    };

    const switchSpy = jest.spyOn(runtimeSettings, 'switchActiveProvider');
    const authSpy = jest.spyOn(runtimeSettings, 'updateActiveProviderApiKey');

    await applyProfileWithGuards(profile);

    // Auth should be applied BEFORE switch
    const authCall = authSpy.mock.invocationCallOrder[0];
    const switchCall = switchSpy.mock.invocationCallOrder[0];
    expect(authCall).toBeLessThan(switchCall);
  });
});
```

#### Test 2: CLI Argument Override

**File**: `packages/cli/src/config/config.test.ts`

```typescript
describe('CLI Argument Overrides', () => {
  it('should override profile keyfile with CLI keyfile', async () => {
    // Load profile with keyfile
    const profile = {
      provider: 'openai',
      ephemeralSettings: {
        'auth-keyfile': '/path/to/profile_key',
      },
    };

    await applyProfileSnapshot(profile);

    // Apply CLI override
    const argv = {
      keyfile: '/path/to/cli_key',
    };

    jest.spyOn(fs, 'readFile').mockResolvedValue('cli-api-key');

    await applyCliArgumentOverrides(config, argv, settingsService);

    // Should use CLI keyfile, not profile keyfile
    const authKey = config.getEphemeralSetting('auth-key');
    expect(authKey).toBe('cli-api-key');
  });

  it('should process --set arguments at startup', async () => {
    const argv = {
      set: ['context-limit=100000', 'streaming=disabled'],
    };

    await applyCliArgumentOverrides(config, argv, settingsService);

    expect(config.getEphemeralSetting('context-limit')).toBe(100000);
    expect(config.getEphemeralSetting('streaming')).toBe('disabled');
  });
});
```

---

### 4.3 E2E Tests (Manual Validation)

Test all scenarios from issue #458:

#### Test Suite

**Note**: OAuth popup prevention in Tests 3 and 4 requires manual verification. For automated testing, see the unit tests in section 4.2 that verify the OAuth authenticate method is not called when a keyfile is present.

```bash
# Test 1: Gemini with keyfile (CLI arg)
node scripts/start.js --provider gemini --keyfile ~/.foogle_key
> hi
# Expected: ✓ Works (no "no API key" error)

# Test 2: Gemini with keyfile (runtime command)
node scripts/start.js --provider gemini
> /keyfile ~/.foogle_key
> hi
# Expected: ✓ Works (no "no API key" error)

# Test 3: Anthropic profile load (zai)
node scripts/start.js --profile-load zai
# Expected: ✓ No OAuth popup (manual verification), loads keyfile silently
> hi
# Expected: ✓ Works

# Test 4: Anthropic runtime profile load
node scripts/start.js
> /profile load zai
# Expected: ✓ No OAuth popup (manual verification)
> hi
# Expected: ✓ Works

# Test 5: OpenAI profile load (synthetic) - verify still works
node scripts/start.js --profile-load synthetic
> hi
# Expected: ✓ Works

# Test 6: CLI override of profile keyfile
node scripts/start.js --profile-load synthetic --key override-key
> /diagnostics
# Expected: ✓ auth-key shows "over********key"

# Test 7: --set processing
node scripts/start.js --provider gemini --set context-limit=50000
> /diagnostics
# Expected: ✓ Context Limit shows 50000

# Test 8: Environment variable fallback
export GEMINI_API_KEY=test-key
node scripts/start.js --provider gemini
> hi
# Expected: ✓ Uses env var

# Test 9: CLI overrides environment variable
export GEMINI_API_KEY=env-key
node scripts/start.js --provider gemini --key cli-key
> /diagnostics
# Expected: ✓ auth-key shows "cli-***"
```

---

## Phase 5: Documentation & Guardrails

### 5.1 Update Documentation

**File**: `dev-docs/profileandsettings.md`

Add new section:

```markdown
## Provider Authentication Implementation Guide

### Rules for Provider Developers

When implementing or modifying a provider, follow these rules:

#### 1. NEVER read `process.env` directly for API keys
Use `authResolver.resolveAuthentication()` instead.

**Bad**:
```typescript
if (process.env.GEMINI_API_KEY) {
  return process.env.GEMINI_API_KEY;
}
```

**Good**:
```typescript
const auth = await this.authResolver.resolveAuthentication({
  settingsService: this.resolveSettingsService(),
  includeOAuth: false,
});
return auth;
```

#### 2. NEVER cache authentication state
Query fresh state each time.

**Bad**:
```typescript
class Provider {
  private cachedKey: string;
  constructor() {
    this.cachedKey = process.env.API_KEY;
  }
}
```

**Good**:
```typescript
class Provider {
  async getAuthToken() {
    return await this.authResolver.resolveAuthentication();
  }
}
```

#### 3. Use `includeOAuth: false` for checks
Checking if auth exists should never trigger OAuth.

**For checks** (no side effects):
```typescript
async isAuthenticated(): Promise<boolean> {
  const auth = await this.authResolver.resolveAuthentication({
    includeOAuth: false,  // Just checking
  });
  return !!auth;
}
```

**For API calls** (can trigger OAuth):
```typescript
async makeApiCall() {
  const auth = await this.authResolver.resolveAuthentication({
    includeOAuth: true,  // Trigger OAuth if needed
  });
  // Use auth for request
}
```

#### 4. Provider-specific auth is a fallback
Check standard auth first, then provider-specific.

**Example**:
```typescript
async determineBestAuth() {
  // 1. Check standard auth FIRST
  const standardAuth = await this.authResolver.resolveAuthentication({
    settingsService: this.resolveSettingsService(),
    includeOAuth: false,
  });

  if (standardAuth) {
    return { authMode: 'api-key', token: standardAuth };
  }

  // 2. Check provider-specific auth (ADC, Vertex AI, etc.)
  if (this.hasSpecialAuth()) {
    return { authMode: 'special', token: await this.getSpecialToken() };
  }

  // 3. No auth available
  throw new Error('No authentication configured');
}
```

#### 5. OAuth is the user's last resort
- Never trigger automatically during config
- Only trigger on actual API call
- Respect `authOnly` setting

### Authentication Precedence

All providers follow this precedence (enforced by AuthResolver):

1. SettingsService auth-key (from --key, /key, profiles)
2. SettingsService auth-keyfile (from --keyfile, /keyfile, profiles)
3. Constructor apiKey (programmatic usage)
4. Environment variables (OPENAI_API_KEY, etc.)
5. OAuth (only if includeOAuth: true)

When `authOnly` is set: Skip 1-4, go directly to OAuth.

### Environment Variables

Environment variables are supported and encouraged for:
- Development/testing convenience
- CI/CD pipelines
- System-wide defaults

Each provider specifies which env vars to check:

```typescript
constructor(config: ProviderConfig) {
  super({
    ...config,
    envKeyNames: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  });
}
```

AuthResolver automatically checks these during step 4 of precedence.

**Key principle**: User-provided auth (CLI args, profiles, runtime commands) always overrides environment variables.
```

---

### 5.2 Add Lint Rules

**File**: `eslint.config.js` or `.eslintrc.js`

```javascript
module.exports = {
  // ... existing config ...

  overrides: [
    {
      files: ['packages/core/src/providers/**/*.ts'],
      rules: {
        // Prevent direct process.env reads for API keys and key storage in provider files
        'no-restricted-syntax': [
          'error',
          {
            // Only flag auth-related env var reads (API_KEY, API_TOKEN, etc.)
            // Allows legitimate reads of NODE_ENV, user-agent, etc.
            selector: 'MemberExpression[object.object.name="process"][object.property.name="env"][property.name=/.*((API|AUTH).*KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS).*/i]',
            message: 'Do not read API keys from process.env directly in providers. Use authResolver.resolveAuthentication() instead.',
          },
          {
            selector: 'PropertyDefinition[key.name=/.*[Kk]ey.*/][value]',
            message: 'Providers should not store API keys directly. Use authResolver for stateless auth.',
          },
        ],
      },
    },
  ],
};
```

**Validation**:
```bash
npm run lint
# Should catch violations in provider files
```

---

## Success Criteria

### All Failures Fixed

| Scenario | Issue # | Before | After |
|----------|---------|--------|-------|
| `--provider gemini --keyfile ~/.foogle_key` | #458 | ❌ "no API key" | ✓ Works |
| `--profile-load zai` (Anthropic) | #458 | ❌ OAuth popup | ✓ Loads keyfile |
| `/keyfile ~/.foogle_key` (Gemini) | #458 | ❌ "no API key" | ✓ Works |
| `/profile load zai` (Anthropic) | #458 | ❌ OAuth popup | ✓ Loads keyfile |
| `--profile-load synthetic` (OpenAI) | N/A | ✓ Works | ✓ Still works |

### Consistency Achieved

- [ ] All providers use AuthResolver for standard auth
- [ ] No direct `process.env` reads in provider code (except for provider-specific like Vertex AI credentials)
- [ ] OAuth only triggers on prompt send, never during config/startup
- [ ] Profile loading applies auth before provider switch
- [ ] CLI args override profile settings correctly
- [ ] `--set` arguments processed at startup
- [ ] Environment variables work as documented (fallback after user-provided auth)

### Tests Pass

- [ ] Unit tests for Gemini auth changes
- [ ] Unit tests for OAuth timing changes
- [ ] Integration tests for profile loading
- [ ] Integration tests for CLI arg overrides
- [ ] E2E manual validation of all 9 test scenarios

### Documentation Complete

- [ ] `dev-docs/profileandsettings.md` updated with provider implementation guide
- [ ] Authentication precedence documented
- [ ] Environment variable behavior clarified
- [ ] Lint rules prevent future violations

---

## Implementation Order

### Sprint 1: Test-First Core Auth Fixes (Week 1)
**Goal**: Fix Gemini and OAuth timing issues using test-first development

- [ ] **Phase 1.1a**: Write failing tests for Gemini keyfile support
  - Write test in `packages/core/src/providers/gemini/GeminiProvider.test.ts`
  - Test that keyfile-loaded keys (via SettingsService) are preferred over env vars
  - Test that AuthResolver is consulted before Vertex AI

- [ ] **Phase 1.1b**: Run tests and confirm they fail
  - Run: `npm test -- GeminiProvider.test.ts`
  - Document the failure messages to prove tests are correctly detecting the bug

- [ ] **Phase 1.1c**: Implement `GeminiProvider.determineBestAuth()` fix
  - Modify `packages/core/src/providers/gemini/GeminiProvider.ts:282-377`
  - Update `hasGeminiAPIKey()` to delegate to AuthResolver (keep method, change implementation)
  - Add OAuth check step before throwing error

- [ ] **Phase 1.1d**: Run tests and confirm they pass
  - Run: `npm test -- GeminiProvider.test.ts`
  - Verify all new tests now pass

- [ ] **Phase 2.1a**: Write failing test for OAuth timing
  - Write test in `packages/core/src/providers/BaseProvider.test.ts`
  - Test that `isAuthenticated()` does NOT trigger OAuth

- [ ] **Phase 2.1b**: Run test and confirm it fails
  - Run: `npm test -- BaseProvider.test.ts`
  - Document failure showing OAuth is incorrectly triggered

- [ ] **Phase 2.1c**: Fix `BaseProvider.isAuthenticated()`
  - Modify `packages/core/src/providers/BaseProvider.ts:424-435`
  - Change to `includeOAuth: false`

- [ ] **Phase 2.1d**: Run test and confirm it passes
  - Run: `npm test -- BaseProvider.test.ts`
  - Verify OAuth is no longer triggered

- [ ] **Phase 2.2a**: Write failing test for refreshAuth() OAuth trigger
  - Write test showing `refreshAuth()` incorrectly triggers OAuth
  - Test that all state is preserved after refresh

- [ ] **Phase 2.2b**: Run test and confirm it fails

- [ ] **Phase 2.2c**: Fix OAuth timing in `refreshAuth()`
  - Keep `config.refreshAuth()` call in `packages/cli/src/runtime/runtimeSettings.ts:1410`
  - Fix `refreshAuth()` itself to not trigger OAuth (preserve full state restoration)

- [ ] **Phase 2.2d**: Run test and confirm it passes

**Deliverable**: Gemini keyfile works, no premature OAuth triggers - ALL TESTS PASSING

---

### Sprint 2: Test-First Profile Loading (Week 2)
**Goal**: Fix profile loading order and Anthropic OAuth issue using test-first development

- [ ] **Phase 2.3a**: Write failing test for profile OAuth trigger
  - Write test showing profile load incorrectly triggers OAuth when keyfile is present
  - Test in `packages/cli/src/runtime/profileApplication.test.ts`

- [ ] **Phase 2.3b**: Run test and confirm it fails
  - Document OAuth being triggered during profile load

- [ ] **Phase 2.3c**: Verify refreshAuth() fix prevents OAuth
  - Ensure `refreshAuth()` changes from Sprint 1 Phase 2.2 prevent OAuth during profile load
  - Test specifically with Anthropic profiles that have keyfile configured

- [ ] **Phase 2.3d**: Run test and confirm it passes

- [ ] **Phase 3.1a**: Write failing test for profile loading order
  - Test that auth credentials are applied BEFORE provider switch
  - Test stash → switch → apply pattern

- [ ] **Phase 3.1b**: Run test and confirm it fails

- [ ] **Phase 3.1c**: Reorder profile application
  - Modify `packages/cli/src/runtime/profileApplication.ts:95-300`
  - Implement stash → switch → apply pattern

- [ ] **Phase 3.1d**: Run test and confirm it passes

- [ ] **Integration tests**: Comprehensive profile loading tests
  - Write full integration test suite
  - Test both working scenarios (OpenAI) and previously broken (Anthropic)
  - Run all tests and ensure 100% pass

**Deliverable**: Profile loading works correctly for all providers - ALL TESTS PASSING

---

### Sprint 3: Test-First CLI Arguments (Week 3)
**Goal**: Fix CLI argument processing and --set support using test-first development

- [ ] **Phase 3.2a**: Write failing test for CLI argument timing
  - Test that CLI args override profile settings
  - Test that args are applied after provider manager creation

- [ ] **Phase 3.2b**: Run test and confirm it fails

- [ ] **Phase 3.2c**: Fix CLI argument processing order
  - Add `applyCliArgumentOverrides()` to `packages/cli/src/runtime/runtimeSettings.ts`
  - Update `packages/cli/src/gemini.tsx:278-562`
  - Remove old `applyProviderCredentials()` call

- [ ] **Phase 3.2d**: Run test and confirm it passes

- [ ] **Phase 3.3a**: Write failing test for --set processing
  - Test: `--set context-limit=50000` should work
  - Test: Multiple --set args should all apply

- [ ] **Phase 3.3b**: Run test and confirm it fails

- [ ] **Phase 3.3c**: Wire up `--set` processing
  - Update `packages/cli/src/config/cliEphemeralSettings.ts`
  - Ensure called from `applyCliArgumentOverrides()`

- [ ] **Phase 3.3d**: Run test and confirm it passes

- [ ] **Phase 1.2**: Audit other providers
  - Check Qwen provider for consistency
  - Fix any violations found
  - Add tests for any fixes

- [ ] **Integration tests**: Full CLI argument override suite
  - Write comprehensive tests in `packages/cli/src/config/config.test.ts`
  - Test precedence (CLI overrides profile)
  - Run all tests and ensure 100% pass

**Deliverable**: All CLI args work correctly at startup - ALL TESTS PASSING

---

### Sprint 4: Hardening (Week 4)
**Goal**: Complete testing, documentation, and guardrails

- [ ] **Phase 4.1**: Complete unit test suite
  - Gemini auth tests
  - OAuth timing tests
  - AuthResolver precedence tests

- [ ] **Phase 4.2**: Complete integration test suite
  - Profile loading tests
  - CLI override tests

- [ ] **Phase 4.3**: E2E validation
  - Run all 9 manual test scenarios
  - Document results

- [ ] **Phase 5.1**: Update documentation
  - Update `dev-docs/profileandsettings.md`
  - Add provider implementation guide

- [ ] **Phase 5.2**: Add lint rules
  - Update `eslint.config.js`
  - Validate on provider files

- [ ] **Final regression testing**
  - Run full test suite
  - Manual testing of common workflows

**Deliverable**: Production-ready, tested, documented solution

---

## Risk Mitigation

### Breaking Changes

**Risk**: Changing Gemini auth logic might break existing setups that rely on env vars

**Mitigation**:
- Environment variables still work (via AuthResolver precedence)
- They just move to correct position in precedence (after user-provided auth)
- Vertex AI fallback preserved
- Add migration guide in release notes

### OAuth Regression

**Risk**: Removing OAuth from config time might break legitimate OAuth flows

**Mitigation**:
- OAuth still triggers on first API call (where it belongs)
- Add explicit tests for OAuth scenarios
- Test with actual OAuth providers (Anthropic, Gemini)
- Document expected behavior clearly

### Performance Impact

**Risk**: Querying auth state on every API call might be slow

**Mitigation**:
- AuthResolver is already efficient (simple key lookups, no I/O)
- Profile small performance impact (<1ms per call)
- OAuth tokens are already cached
- Trade-off: Correctness over micro-optimization

### Test Coverage

**Risk**: Missing edge cases in testing

**Mitigation**:
- Comprehensive unit tests for each component
- Integration tests for workflows
- E2E manual validation
- Test matrix covering all providers × all auth methods

---

## Dependencies

### External
None - all changes internal to codebase

### Internal
- Must maintain backward compatibility with existing profiles
- Must preserve SettingsService interface
- Must not break existing OAuth flows

---

## Rollback Plan

If critical issues discovered after deployment:

1. **Revert Gemini changes**: Restore `hasGeminiAPIKey()` logic temporarily
2. **Revert profile loading order**: Restore original sequence
3. **Document workarounds**: Provide user guidance for manual configuration
4. **Issue hotfix**: Create emergency patch branch

**Monitoring**: Watch for:
- OAuth errors in logs
- "No API key" errors for Gemini
- Profile loading failures

---

## Definition of Done

- [ ] All code changes implemented and reviewed
- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] All E2E scenarios validated manually
- [ ] Documentation updated
- [ ] Lint rules added and enforced
- [ ] No regressions in existing functionality
- [ ] Issue #458 resolved and closed
- [ ] Release notes written

---

**Last Updated**: 2025-11-05
**Status**: Planning
**Next Steps**: Begin Sprint 1 Phase 1.1 (Fix GeminiProvider)
